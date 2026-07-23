import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import {
  computeNextRevision, segmentCount, segmentVerseRange, type RevisionQuality,
} from '../../core/revision.js';
import { computeChainStep, type ChainLesson } from '../../core/revisionChain.js';
import { scoreRecitation } from '../../core/arabic.js';
import { transcribeAudio } from '../lessons/asr.client.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import { getLearnedLettreLessons } from '../me/learnedLettreLessons.js';
import { resolveI18n, type I18nText } from '../content/content.serializer.js';
import type { Sourate, SourateRevision, LettreRevision, RevisionState } from '@prisma/client';

// Ordre de "gravité" d'un état SRS, du pire au meilleur — sert à dériver
// l'état AGRÉGÉ d'une sourate à partir de ses segments (le pire segment
// détermine l'état affiché en liste : on ne masque jamais un segment fragile
// derrière des segments maîtrisés).
const ETAT_SEVERITY: Record<RevisionState, number> = { difficile: 0, revoir: 1, maitrise: 2 };
const worseEtat = (a: RevisionState, b: RevisionState) =>
  ETAT_SEVERITY[a] <= ETAT_SEVERITY[b] ? a : b;

// En dessous de ce score, le verset récité est jugé "manqué" (aide affichée
// côté front). Plus permissif que le seuil des leçons (55) : une session de
// révision porte sur un verset entier, pas un mot isolé.
const FLUENT_THRESHOLD = 40;
// Au-dessus de ce score (sans atteindre la fluidité) : hésitation plutôt
// qu'oubli total — nuance renvoyée au front via `verdict`.
const HESITANT_THRESHOLD = 20;
// Lettres/syllabes isolées : audio très court → transcription Whisper plus
// bruitée que sur un verset. Seuil de réussite plus permissif pour compenser.
const LETTER_FLUENT_THRESHOLD = 35;

/** Résout une sourate par cuid OU par numero (même dispatch que content.service.ts). */
async function resolveSourate(idOrNumero: string): Promise<Sourate> {
  const sourate = /^\d+$/.test(idOrNumero)
    ? await prisma.sourate.findUnique({ where: { numero: Number(idOrNumero) } })
    : await prisma.sourate.findUnique({ where: { id: idOrNumero } });
  if (!sourate) throw new AppError('NOT_FOUND', 'Sourate not found');
  return sourate;
}

/**
 * Charge les leçons de versets d'une sourate, triées par `Lesson.ordre`
 * (donc dans l'ordre RÉEL d'apprentissage), pour piloter le chaînage
 * progressif. Les leçons sans `versetDebut`/`versetFin` (contenu jamais
 * régénéré depuis l'ajout de ces colonnes) sont ignorées plutôt que de
 * planter la révision guidée.
 */
async function loadChainLessons(sourateNumero: number): Promise<ChainLesson[]> {
  const lessons = await prisma.lesson.findMany({
    where: { sourateNumero },
    orderBy: { ordre: 'asc' },
    select: { ordre: true, versetDebut: true, versetFin: true },
  });
  return lessons
    .filter((l): l is typeof l & { versetDebut: number; versetFin: number } =>
      l.versetDebut != null && l.versetFin != null)
    .map((l) => ({ ordre: l.ordre, versetDebut: l.versetDebut, versetFin: l.versetFin }));
}

/**
 * Nombre de leçons de CETTE sourate (dans l'ordre du chaînage) déjà
 * complétées par l'utilisateur dans "Apprendre" — plafonne le chaînage
 * progressif : on ne propose jamais d'assembler des versets que l'utilisateur
 * n'a pas encore appris. Contrairement à `getLearnedSourates` (SRS classique,
 * qui exige la sourate ENTIÈREMENT apprise), la révision guidée doit
 * accompagner l'apprentissage EN COURS, pas seulement s'activer après coup.
 */
async function countLearnedChainLessons(userId: string, sourateNumero: number): Promise<number> {
  const lessons = await prisma.lesson.findMany({
    where: { sourateNumero, versetDebut: { not: null } },
    orderBy: { ordre: 'asc' },
    select: { id: true },
  });
  if (lessons.length === 0) return 0;

  const completed = await prisma.lessonProgress.findMany({
    where: { userId, etat: 'completed', lessonId: { in: lessons.map((l) => l.id) } },
    select: { lessonId: true },
  });
  const done = new Set(completed.map((c) => c.lessonId));

  // Compte le préfixe consécutif appris depuis le début — une leçon plus
  // loin complétée hors-ordre (ne devrait pas arriver, le parcours est
  // linéaire) ne fait pas "sauter" le chaînage en avant.
  let count = 0;
  for (const l of lessons) {
    if (!done.has(l.id)) break;
    count++;
  }
  return count;
}

function serializeSegment(
  revision: SourateRevision,
  sourate: { nombreVersets: number },
) {
  const { debut, fin } = segmentVerseRange(revision.segmentIndex, sourate.nombreVersets);
  return {
    segmentIndex: revision.segmentIndex,
    debut,
    fin,
    score: revision.score,
    etat: revision.etat,
    derniereRevision: revision.derniereRevision,
    prochaineRevision: revision.prochaineRevision,
  };
}

/**
 * Charge tous les segments d'une sourate pour un user, en créant (due
 * immédiatement) les lignes qui n'existent pas encore — même logique paresseuse
 * que l'ancien `list()`, mais une ligne par segment plutôt qu'une par sourate.
 */
async function getOrCreateSegments(
  userId: string,
  sourate: { id: string; nombreVersets: number },
): Promise<SourateRevision[]> {
  const total = segmentCount(sourate.nombreVersets);
  const existing = await prisma.sourateRevision.findMany({
    where: { userId, sourateId: sourate.id },
  });
  const byIndex = new Map(existing.map((r) => [r.segmentIndex, r]));

  const missingIndexes = Array.from({ length: total }, (_, i) => i).filter(
    (i) => !byIndex.has(i),
  );
  if (missingIndexes.length > 0) {
    const now = new Date();
    await prisma.sourateRevision.createMany({
      data: missingIndexes.map((segmentIndex) => ({
        userId, sourateId: sourate.id, segmentIndex, prochaineRevision: now,
      })),
      skipDuplicates: true,
    });
    const created = await prisma.sourateRevision.findMany({
      where: { userId, sourateId: sourate.id, segmentIndex: { in: missingIndexes } },
    });
    for (const r of created) byIndex.set(r.segmentIndex, r);
  }

  return Array.from({ length: total }, (_, i) => byIndex.get(i)!);
}

/**
 * Agrège les segments d'une sourate en une ligne pour l'écran liste : l'état
 * affiché est le PIRE des segments (jamais masquer un segment fragile derrière
 * des segments maîtrisés), la prochaine échéance est la plus proche.
 */
function aggregateSourate(
  segments: SourateRevision[],
  sourate: { numero: number; nom: string; nomArabe: string; nombreVersets: number },
) {
  const now = Date.now();
  const segmentsTotal = segments.length;
  const segmentsDue = segments.filter(
    (s) => !s.prochaineRevision || s.prochaineRevision.getTime() <= now,
  ).length;
  const score = Math.round(segments.reduce((sum, s) => sum + s.score, 0) / segmentsTotal);
  const etat = segments.reduce<RevisionState>((worst, s) => worseEtat(worst, s.etat), 'maitrise');
  const prochaineDates = segments
    .map((s) => s.prochaineRevision)
    .filter((d): d is Date => d != null);
  const derniereDates = segments
    .map((s) => s.derniereRevision)
    .filter((d): d is Date => d != null);

  return {
    numero: sourate.numero,
    nom: sourate.nom,
    nomArabe: sourate.nomArabe,
    nombreVersets: sourate.nombreVersets,
    segmentsTotal,
    segmentsDue,
    score,
    etat,
    derniereRevision:
      derniereDates.length > 0 ? new Date(Math.max(...derniereDates.map((d) => d.getTime()))) : null,
    prochaineRevision:
      prochaineDates.length > 0 ? new Date(Math.min(...prochaineDates.map((d) => d.getTime()))) : null,
  };
}

function serializeLettre(
  revision: LettreRevision,
  lesson: { id: string; titre: unknown; ordre: number },
  lang: string,
  defaultLang: string,
) {
  return {
    lessonId: lesson.id,
    titre: resolveI18n(lesson.titre as I18nText, lang, defaultLang),
    ordre: lesson.ordre,
    score: revision.score,
    etat: revision.etat,
    derniereRevision: revision.derniereRevision,
    prochaineRevision: revision.prochaineRevision,
  };
}

export const revisionService = {
  /**
   * GET /me/revisions — sourates apprises + état SRS AGRÉGÉ (pire segment,
   * score moyen, échéance la plus proche). Crée les lignes `SourateRevision`
   * manquantes (une par segment, cf. `SEGMENT_SIZE`) pour toute sourate
   * apprise pour la première fois.
   */
  async list(userId: string) {
    const learned = await getLearnedSourates(userId);
    if (learned.length === 0) return { revisions: [] };

    const revisions = [];
    for (const s of learned) {
      const segments = await getOrCreateSegments(userId, s);
      revisions.push(aggregateSourate(segments, s));
    }

    return { revisions: revisions.sort((a, b) => a.numero - b.numero) };
  },

  /**
   * GET /me/revisions/:idOrNumero/segments — détail par bloc d'une sourate
   * (nécessaire pour choisir quel segment réviser : les segments fragiles ne
   * doivent jamais rester cachés derrière la moyenne affichée en liste).
   */
  async getSegments(userId: string, idOrNumero: string) {
    const sourate = await resolveSourate(idOrNumero);

    const learned = await getLearnedSourates(userId);
    if (!learned.some((s) => s.id === sourate.id)) {
      throw new AppError('FORBIDDEN', 'Sourate not yet learned');
    }

    const segments = await getOrCreateSegments(userId, sourate);
    return {
      numero: sourate.numero,
      nom: sourate.nom,
      nomArabe: sourate.nomArabe,
      nombreVersets: sourate.nombreVersets,
      segments: segments.map((r) => serializeSegment(r, sourate)),
    };
  },

  /**
   * POST /me/revisions/:idOrNumero/segments/:segmentIndex/review — enregistre
   * le résultat d'auto-évaluation d'UN bloc de versets et recalcule son
   * planning SRS indépendamment des autres segments de la sourate.
   */
  async reviewSegment(
    userId: string,
    idOrNumero: string,
    segmentIndex: number,
    quality: RevisionQuality,
  ) {
    const sourate = await resolveSourate(idOrNumero);

    const learned = await getLearnedSourates(userId);
    if (!learned.some((s) => s.id === sourate.id)) {
      throw new AppError('FORBIDDEN', 'Sourate not yet learned');
    }

    const total = segmentCount(sourate.nombreVersets);
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= total) {
      throw new AppError('VALIDATION_ERROR', `segmentIndex must be between 0 and ${total - 1}`);
    }

    const now = new Date();
    const current = await prisma.sourateRevision.upsert({
      where: { userId_sourateId_segmentIndex: { userId, sourateId: sourate.id, segmentIndex } },
      update: {},
      create: { userId, sourateId: sourate.id, segmentIndex, prochaineRevision: now },
    });

    const next = computeNextRevision(current, quality, now);
    const updated = await prisma.sourateRevision.update({
      where: { userId_sourateId_segmentIndex: { userId, sourateId: sourate.id, segmentIndex } },
      data: {
        score: next.score,
        etat: next.etat,
        intervalleJours: next.intervalleJours,
        derniereRevision: now,
        prochaineRevision: next.prochaineRevision,
      },
    });

    return serializeSegment(updated, sourate);
  },

  /**
   * GET /me/revisions/:idOrNumero/guided — prochain pas de la RÉVISION GUIDÉE
   * (chaînage progressif verset par verset, cf. core/revisionChain.ts) : rejoue
   * l'ordre réel d'apprentissage (Lesson.ordre + versetDebut/versetFin) plutôt
   * que les blocs arithmétiques de 10 versets du SRS classique. Crée le
   * curseur `SourateChainProgress` s'il n'existe pas encore (démarre à 0).
   *
   * Contrairement au SRS classique (`getLearnedSourates`, qui exige la
   * sourate ENTIÈREMENT apprise), la révision guidée doit accompagner
   * l'apprentissage EN COURS : accessible dès la 1ère leçon de la sourate
   * complétée, et son avancée est plafonnée par `countLearnedChainLessons`
   * pour ne jamais assembler des versets pas encore vus dans "Apprendre".
   */
  async getGuided(userId: string, idOrNumero: string) {
    const sourate = await resolveSourate(idOrNumero);

    const learnedCount = await countLearnedChainLessons(userId, sourate.numero);
    if (learnedCount === 0) {
      throw new AppError('FORBIDDEN', 'Sourate not yet learned');
    }

    const lessons = await loadChainLessons(sourate.numero);
    const progress = await prisma.sourateChainProgress.upsert({
      where: { userId_sourateId: { userId, sourateId: sourate.id } },
      update: {},
      create: { userId, sourateId: sourate.id },
    });

    const capped = Math.min(progress.lessonsConsolidees, learnedCount);
    const chain = computeChainStep(lessons, capped);
    if (progress.terminee !== chain.terminee || progress.lessonsConsolidees !== capped) {
      await prisma.sourateChainProgress.update({
        where: { userId_sourateId: { userId, sourateId: sourate.id } },
        data: { lessonsConsolidees: capped, terminee: chain.terminee },
      });
    }

    return {
      numero: sourate.numero,
      nom: sourate.nom,
      nomArabe: sourate.nomArabe,
      lessonsTotal: chain.lessonsTotal,
      lessonsConsolidees: chain.lessonsConsolidees,
      terminee: chain.terminee,
      step: chain.step,
    };
  },

  /**
   * POST /me/revisions/:idOrNumero/guided/advance — clôture le cycle courant
   * de la révision guidée. `facile`/`difficile` avance le curseur d'une leçon
   * (le bloc assemblé devient le nouveau bloc consolidé) ; `oublie` répète le
   * même cycle (on ne fait jamais grossir le bloc sur un échec — l'utilisateur
   * doit d'abord souder les versets déjà en jeu avant d'en ajouter d'autres).
   * Ne peut jamais avancer au-delà de `countLearnedChainLessons` : si
   * l'utilisateur a rattrapé le curseur (dernière leçon apprise déjà
   * consolidée), il doit d'abord apprendre la suite dans "Apprendre".
   */
  async advanceGuided(userId: string, idOrNumero: string, quality: RevisionQuality) {
    const sourate = await resolveSourate(idOrNumero);

    const learnedCount = await countLearnedChainLessons(userId, sourate.numero);
    if (learnedCount === 0) {
      throw new AppError('FORBIDDEN', 'Sourate not yet learned');
    }

    const lessons = await loadChainLessons(sourate.numero);
    const progress = await prisma.sourateChainProgress.upsert({
      where: { userId_sourateId: { userId, sourateId: sourate.id } },
      update: {},
      create: { userId, sourateId: sourate.id },
    });

    const currentCount = Math.min(progress.lessonsConsolidees, learnedCount);
    const current = computeChainStep(lessons, currentCount);
    if (current.terminee || !current.step) {
      throw new AppError('VALIDATION_ERROR', 'Chaînage déjà terminé pour cette sourate');
    }

    const wanted = quality === 'oublie' ? currentCount : currentCount + 1;
    // Plafonné : ne jamais dépasser ce que l'utilisateur a réellement appris —
    // s'il vient de rattraper son retard, il doit d'abord apprendre la
    // prochaine leçon dans "Apprendre" avant de pouvoir avancer plus loin.
    const nextCount = Math.min(wanted, learnedCount);

    const next = computeChainStep(lessons, nextCount);
    const updated = await prisma.sourateChainProgress.update({
      where: { userId_sourateId: { userId, sourateId: sourate.id } },
      data: { lessonsConsolidees: next.lessonsConsolidees, terminee: next.terminee },
    });

    return {
      numero: sourate.numero,
      nom: sourate.nom,
      nomArabe: sourate.nomArabe,
      lessonsTotal: next.lessonsTotal,
      lessonsConsolidees: updated.lessonsConsolidees,
      terminee: next.terminee,
      step: next.step,
    };
  },

  /**
   * GET /me/revisions/lettres — leçons d'alphabet/harakat complétées + état
   * SRS. Même logique paresseuse que `list()` mais sur `LettreRevision`.
   */
  async listLettres(userId: string, lang: string, defaultLang: string) {
    const learned = await getLearnedLettreLessons(userId);
    if (learned.length === 0) return { revisions: [] };

    const lessonIds = learned.map((l) => l.id);
    const existing = await prisma.lettreRevision.findMany({
      where: { userId, lessonId: { in: lessonIds } },
    });
    const byId = new Map(existing.map((r) => [r.lessonId, r]));

    const missing = learned.filter((l) => !byId.has(l.id));
    if (missing.length > 0) {
      const now = new Date();
      await prisma.lettreRevision.createMany({
        data: missing.map((l) => ({ userId, lessonId: l.id, prochaineRevision: now })),
        skipDuplicates: true,
      });
      const created = await prisma.lettreRevision.findMany({
        where: { userId, lessonId: { in: missing.map((l) => l.id) } },
      });
      for (const r of created) byId.set(r.lessonId, r);
    }

    return {
      revisions: learned
        .map((l) => serializeLettre(byId.get(l.id)!, l, lang, defaultLang))
        .sort((a, b) => a.ordre - b.ordre),
    };
  },

  /**
   * POST /me/revisions/lettres/:lessonId/review — enregistre le résultat
   * d'auto-évaluation d'une révision d'alphabet/harakat et recalcule le SRS.
   */
  async reviewLettre(userId: string, lessonId: string, quality: RevisionQuality, lang: string, defaultLang: string) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, titre: true, ordre: true, sourateNumero: true },
    });
    if (!lesson || lesson.sourateNumero !== null) {
      throw new AppError('NOT_FOUND', 'Lettre lesson not found');
    }

    const learned = await getLearnedLettreLessons(userId);
    if (!learned.some((l) => l.id === lesson.id)) {
      throw new AppError('FORBIDDEN', 'Lesson not yet learned');
    }

    const now = new Date();
    const current = await prisma.lettreRevision.upsert({
      where: { userId_lessonId: { userId, lessonId: lesson.id } },
      update: {},
      create: { userId, lessonId: lesson.id, prochaineRevision: now },
    });

    const next = computeNextRevision(current, quality, now);
    const updated = await prisma.lettreRevision.update({
      where: { userId_lessonId: { userId, lessonId: lesson.id } },
      data: {
        score: next.score,
        etat: next.etat,
        intervalleJours: next.intervalleJours,
        derniereRevision: now,
        prochaineRevision: next.prochaineRevision,
      },
    });

    return serializeLettre(updated, lesson, lang, defaultLang);
  },

  /**
   * POST /me/revisions/versets/:versetId/recite — récitation d'un verset en
   * contexte de révision (écran flashcard). Transcrit l'audio via l'ASR serveur
   * (Whisper) et score contre le texte du verset. AUCUN cœur en jeu ici : la
   * révision ne pénalise jamais (contrairement au moteur de leçon).
   */
  async reciteVerset(versetId: string, audio: Buffer, filename: string, mimetype: string) {
    const verset = await prisma.verset.findUnique({
      where: { id: versetId },
      select: { texteArabe: true },
    });
    if (!verset) throw new AppError('NOT_FOUND', 'Verset not found');

    const transcription = await transcribeAudio(audio, filename, mimetype);
    const score = scoreRecitation(verset.texteArabe, transcription);
    const fluide = score >= FLUENT_THRESHOLD;
    const verdict = fluide ? 'fluide' : score >= HESITANT_THRESHOLD ? 'hesitant' : 'oublie';
    return { score, transcription, fluide, verdict };
  },

  /**
   * POST /me/revisions/:idOrNumero/recite-range — récitation ASSEMBLÉE de
   * plusieurs versets consécutifs (exercice de chaînage : après avoir récité
   * quelques versets un par un, l'utilisateur les enchaîne d'un bloc pour
   * consolider la transition entre eux). Score contre le texte concaténé des
   * versets `debut..fin` (inclusifs, 1-based). Même seuils que `reciteVerset`.
   */
  async reciteVersetRange(
    idOrNumero: string,
    debut: number,
    fin: number,
    audio: Buffer,
    filename: string,
    mimetype: string,
  ) {
    const sourate = await resolveSourate(idOrNumero);
    if (
      !Number.isInteger(debut) || !Number.isInteger(fin) ||
      debut < 1 || fin < debut || fin > sourate.nombreVersets
    ) {
      throw new AppError('VALIDATION_ERROR', 'Invalid verse range');
    }

    const versets = await prisma.verset.findMany({
      where: { sourateId: sourate.id, numero: { gte: debut, lte: fin } },
      orderBy: { numero: 'asc' },
      select: { texteArabe: true },
    });
    if (versets.length === 0) throw new AppError('NOT_FOUND', 'No versets found in range');
    const texteAttendu = versets.map((v) => v.texteArabe).join(' ');

    const transcription = await transcribeAudio(audio, filename, mimetype);
    const score = scoreRecitation(texteAttendu, transcription);
    const fluide = score >= FLUENT_THRESHOLD;
    const verdict = fluide ? 'fluide' : score >= HESITANT_THRESHOLD ? 'hesitant' : 'oublie';
    return { score, transcription, fluide, verdict };
  },

  /**
   * POST /me/revisions/lettres/steps/:stepId/recite — prononciation d'une
   * lettre/syllabe (flashcard alphabet/harakat) jugée par Whisper. Le texte
   * attendu reste côté serveur (payload de l'étape) — anti-triche, comme pour
   * les versets. Jamais de cœur en jeu.
   */
  async reciteLettreStep(stepId: string, audio: Buffer, filename: string, mimetype: string) {
    const step = await prisma.lessonStep.findUnique({
      where: { id: stepId },
      select: { type: true, payload: true, lesson: { select: { sourateNumero: true } } },
    });
    if (!step || step.lesson.sourateNumero !== null || step.type !== 'discovery') {
      throw new AppError('NOT_FOUND', 'Lettre step not found');
    }
    const payload = step.payload as { arabe?: string; ttsText?: string | null };
    // L'utilisateur peut prononcer le NOM de la lettre ("bā" → بَاء, ttsText)
    // ou son SON/glyphe (arabe) : on score contre les deux et on garde le max.
    const candidates = [payload.ttsText, payload.arabe].filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    );
    if (candidates.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Step has no expected text');
    }

    const transcription = await transcribeAudio(audio, filename, mimetype);
    const score = Math.max(...candidates.map((t) => scoreRecitation(t, transcription)));
    const fluide = score >= LETTER_FLUENT_THRESHOLD;
    const verdict = fluide ? 'fluide' : score >= HESITANT_THRESHOLD ? 'hesitant' : 'oublie';
    return { score, transcription, fluide, verdict };
  },

  /**
   * POST /me/revisions/lettres/:lessonId/recite-range — récitation ASSEMBLÉE
   * de plusieurs lettres/syllabes CONSÉCUTIVES d'une même leçon alphabet
   * (`ordre` des steps `debut..fin`, inclusifs, 1-based). Même principe de
   * chaînage que `reciteVersetRange` : en avançant dans la leçon lettre par
   * lettre, chaque nouvelle prononciation est vérifiée en même temps que
   * toutes les précédentes — on ne "perd" jamais une lettre déjà vue derrière
   * la nouvelle. Score contre DEUX candidats concaténés (glyphes `arabe` et
   * noms `ttsText`, comme `reciteLettreStep`) et garde le meilleur : on ne
   * sait pas laquelle des deux lectures l'utilisateur choisit de prononcer,
   * mais elle doit être la MÊME sur toute la séquence pour scorer haut.
   */
  async reciteLettreRange(
    lessonId: string,
    debut: number,
    fin: number,
    audio: Buffer,
    filename: string,
    mimetype: string,
  ) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, sourateNumero: true },
    });
    if (!lesson || lesson.sourateNumero !== null) {
      throw new AppError('NOT_FOUND', 'Lettre lesson not found');
    }
    const total = await prisma.lessonStep.count({ where: { lessonId, type: 'discovery' } });
    if (
      !Number.isInteger(debut) || !Number.isInteger(fin) ||
      debut < 1 || fin < debut || fin > total
    ) {
      throw new AppError('VALIDATION_ERROR', 'Invalid step range');
    }

    const steps = await prisma.lessonStep.findMany({
      where: { lessonId, type: 'discovery', ordre: { gte: debut, lte: fin } },
      orderBy: { ordre: 'asc' },
    });
    if (steps.length === 0) throw new AppError('NOT_FOUND', 'No steps found in range');

    const payloads = steps.map((s) => s.payload as { arabe?: string; ttsText?: string | null });
    const join = (pick: (p: { arabe?: string; ttsText?: string | null }) => unknown) =>
      payloads
        .map(pick)
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .join(' ');
    const arabeJoined = join((p) => p.arabe);
    const ttsJoined = join((p) => p.ttsText);
    if (!arabeJoined && !ttsJoined) {
      throw new AppError('VALIDATION_ERROR', 'Steps have no expected text');
    }

    const transcription = await transcribeAudio(audio, filename, mimetype);
    const score = Math.max(scoreRecitation(arabeJoined, transcription), scoreRecitation(ttsJoined, transcription));
    const fluide = score >= LETTER_FLUENT_THRESHOLD;
    const verdict = fluide ? 'fluide' : score >= HESITANT_THRESHOLD ? 'hesitant' : 'oublie';
    return { score, transcription, fluide, verdict };
  },
};
