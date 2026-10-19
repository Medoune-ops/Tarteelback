import { registerOutboxHandler } from '../../core/outbox.js';
import { prisma } from '../../config/prisma.js';
import { recalculateParticipantProgress } from './challenges.progress.js';
import { finishChallenge } from './challenges.progress.js';

/**
 * Quand une leçon est complétée (événement outbox `lesson.completed`), on
 * recalcule la progression de l'utilisateur sur chaque défi ACTIF où il est
 * participant "accepted" :
 *  - recalcul depuis la source de vérité (jamais "+1" incrémental)
 *  - mise à jour de progress + reachedAt (une seule fois)
 *  - tentative de terminaison du défi (3.B7) via finishChallenge (sous verrou,
 *    idempotent)
 *
 * Idempotent : un événement perdu ou rejoué donne le même résultat.
 */
registerOutboxHandler('lesson.completed', async (event) => {
  const userId = event.userId;
  const now = new Date();

  // Défis actifs où l'utilisateur est participant accepté.
  const challenges = await prisma.challenge.findMany({
    where: {
      status: 'active',
      participants: { some: { userId, status: 'accepted' } },
    },
    include: { participants: true },
  });

  for (const challenge of challenges) {
    const participant = challenge.participants.find(
      (p) => p.userId === userId && p.status === 'accepted',
    );
    if (!participant) continue;

    const { progress, reachedAt } = await recalculateParticipantProgress({
      tx: prisma,
      challenge: {
        id: challenge.id,
        type: challenge.type,
        goal: challenge.goal as { sourateNumeros?: number[] },
        startDay: challenge.startDay,
        endDay: challenge.endDay,
        startsAt: challenge.startsAt,
      },
      participant: {
        userId: participant.userId,
        baseline: participant.baseline,
        progress: participant.progress,
        reachedAt: participant.reachedAt,
        target: participant.target,
      },
    });

    await prisma.challengeParticipant.update({
      where: { id: participant.id },
      data: {
        progress,
        ...(reachedAt ? { reachedAt } : {}),
      },
    });

    // Tenter de terminer le défi (sous verrou, idempotent).
    await finishChallenge({ tx: prisma, challengeId: challenge.id, now });
  }
});

export function registerChallengeProgressHandlers(): void {
  // no-op: registration happens on import
}
