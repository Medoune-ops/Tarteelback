import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { computeNextRevision, type RevisionQuality } from '../../core/revision.js';
import { scoreRecitation } from '../../core/arabic.js';
import { transcribeAudio } from '../lessons/asr.client.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import type { Sourate, SourateRevision } from '@prisma/client';

// En dessous de ce score, le verset récité est jugé "manqué" (aide affichée
// côté front). Plus permissif que le seuil des leçons (70) : une session de
// révision porte sur un verset entier, pas un mot isolé.
const FLUENT_THRESHOLD = 60;
// Au-dessus de ce score (sans atteindre la fluidité) : hésitation plutôt
// qu'oubli total — nuance renvoyée au front via `verdict`.
const HESITANT_THRESHOLD = 30;

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
};
