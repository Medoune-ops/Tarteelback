import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { computeNextRevision, type RevisionQuality } from '../../core/revision.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import type { Sourate, SourateRevision } from '@prisma/client';

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

    const now = new Date();
    await prisma.$transaction(
      learned.map((s) =>
        prisma.sourateRevision.upsert({
          where: { userId_sourateId: { userId, sourateId: s.id } },
          update: {},
          create: { userId, sourateId: s.id, prochaineRevision: now },
        }),
      ),
    );

    const revisions = await prisma.sourateRevision.findMany({
      where: { userId, sourateId: { in: learned.map((s) => s.id) } },
    });
    const byId = new Map(revisions.map((r) => [r.sourateId, r]));

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
};
