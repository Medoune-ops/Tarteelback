import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { computeNextRevision, type RevisionQuality } from '../../core/revision.js';
import { scoreRecitation } from '../../core/arabic.js';
import { transcribeAudio } from '../lessons/asr.client.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import { getLearnedLettreLessons } from '../me/learnedLettreLessons.js';
import { resolveI18n, type I18nText } from '../content/content.serializer.js';
import type { Sourate, SourateRevision, LettreRevision } from '@prisma/client';

// En dessous de ce score, le verset récité est jugé "manqué" (aide affichée
// côté front). Plus permissif que le seuil des leçons (70) : une session de
// révision porte sur un verset entier, pas un mot isolé.
const FLUENT_THRESHOLD = 60;
// Au-dessus de ce score (sans atteindre la fluidité) : hésitation plutôt
// qu'oubli total — nuance renvoyée au front via `verdict`.
const HESITANT_THRESHOLD = 30;
// Lettres/syllabes isolées : audio très court → transcription Whisper plus
// bruitée que sur un verset. Seuil de réussite plus permissif pour compenser.
const LETTER_FLUENT_THRESHOLD = 50;

/** Résout une sourate par cuid OU par numero (même dispatch que content.service.ts). */
async function resolveSourate(idOrNumero: string): Promise<Sourate> {
  const sourate = /^\d+$/.test(idOrNumero)
    ? await prisma.sourate.findUnique({ where: { numero: Number(idOrNumero) } })
    : await prisma.sourate.findUnique({ where: { id: idOrNumero } });
  if (!sourate) throw new AppError('NOT_FOUND', 'Sourate not found');
  return sourate;
}

function serialize(
  revision: SourateRevision,
  sourate: { numero: number; nom: string; nomArabe: string; nombreVersets: number },
) {
  return {
    numero: sourate.numero,
    nom: sourate.nom,
    nomArabe: sourate.nomArabe,
    nombreVersets: sourate.nombreVersets,
    score: revision.score,
    etat: revision.etat,
    derniereRevision: revision.derniereRevision,
    prochaineRevision: revision.prochaineRevision,
  };
}

function serializeLettre(
  revision: LettreRevision,
  lesson: { id: string; titre: I18nText; ordre: number },
  lang: string,
  defaultLang: string,
) {
  return {
    lessonId: lesson.id,
    titre: resolveI18n(lesson.titre, lang, defaultLang),
    ordre: lesson.ordre,
    score: revision.score,
    etat: revision.etat,
    derniereRevision: revision.derniereRevision,
    prochaineRevision: revision.prochaineRevision,
  };
}

export const revisionService = {
  /**
   * GET /me/revisions — sourates apprises + état SRS. Crée une ligne
   * `SourateRevision` par défaut (due immédiatement) pour toute sourate
   * apprise qui n'en a pas encore.
   */
  async list(userId: string) {
    const learned = await getLearnedSourates(userId);
    if (learned.length === 0) return { revisions: [] };

    const sourateIds = learned.map((s) => s.id);
    const existing = await prisma.sourateRevision.findMany({
      where: { userId, sourateId: { in: sourateIds } },
    });
    const byId = new Map(existing.map((r) => [r.sourateId, r]));

    // Ne crée que les lignes manquantes (sourate apprise pour la 1re fois) —
    // évite un upsert no-op sur chaque sourate à chaque chargement de la page.
    const missing = learned.filter((s) => !byId.has(s.id));
    if (missing.length > 0) {
      const now = new Date();
      await prisma.sourateRevision.createMany({
        data: missing.map((s) => ({ userId, sourateId: s.id, prochaineRevision: now })),
        skipDuplicates: true,
      });
      const created = await prisma.sourateRevision.findMany({
        where: { userId, sourateId: { in: missing.map((s) => s.id) } },
      });
      for (const r of created) byId.set(r.sourateId, r);
    }

    return {
      revisions: learned
        .map((s) => serialize(byId.get(s.id)!, s))
        .sort((a, b) => a.numero - b.numero),
    };
  },

  /**
   * POST /me/revisions/:idOrNumero/review — enregistre le résultat
   * d'auto-évaluation d'une session de révision et recalcule le planning SRS.
   */
  async review(userId: string, idOrNumero: string, quality: RevisionQuality) {
    const sourate = await resolveSourate(idOrNumero);

    const learned = await getLearnedSourates(userId);
    if (!learned.some((s) => s.id === sourate.id)) {
      throw new AppError('FORBIDDEN', 'Sourate not yet learned');
    }

    const now = new Date();
    const current = await prisma.sourateRevision.upsert({
      where: { userId_sourateId: { userId, sourateId: sourate.id } },
      update: {},
      create: { userId, sourateId: sourate.id, prochaineRevision: now },
    });

    const next = computeNextRevision(current, quality, now);
    const updated = await prisma.sourateRevision.update({
      where: { userId_sourateId: { userId, sourateId: sourate.id } },
      data: {
        score: next.score,
        etat: next.etat,
        intervalleJours: next.intervalleJours,
        derniereRevision: now,
        prochaineRevision: next.prochaineRevision,
      },
    });

    return serialize(updated, sourate);
  },

  /**
   * GET /me/revisions/lettres — leçons d'alphabet/harakat complétées + état
   * SRS. Même logique paresseuse que `list()` mais sur `LettreRevision`.
   */
  async listLettres(userId: string, lang: string) {
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
        .map((l) => serializeLettre(byId.get(l.id)!, l, lang, env.DEFAULT_LANG))
        .sort((a, b) => a.ordre - b.ordre),
    };
  },

  /**
   * POST /me/revisions/lettres/:lessonId/review — enregistre le résultat
   * d'auto-évaluation d'une révision d'alphabet/harakat et recalcule le SRS.
   */
  async reviewLettre(userId: string, lessonId: string, quality: RevisionQuality, lang: string) {
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

    return serializeLettre(updated, lesson, lang, env.DEFAULT_LANG);
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
};
