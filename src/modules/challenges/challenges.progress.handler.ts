import { registerOutboxHandler } from '../../core/outbox.js';
import { prisma } from '../../config/prisma.js';
import { finishChallenge, refreshChallengeProgress } from './challenges.progress.js';

/**
 * Quand une leçon est terminée (événement `lesson.completed`), on recalcule la
 * progression de l'utilisateur sur chacun de ses défis ACTIFS (participant
 * « accepted »), depuis la source de vérité, puis on tente de terminer le défi
 * (sous verrou, idempotent). Un événement perdu ou rejoué donne le même résultat.
 */
registerOutboxHandler('lesson.completed', async (event) => {
  const userId = event.userId;
  const now = new Date();
  const challenges = await prisma.challenge.findMany({
    where: { status: 'active', participants: { some: { userId, status: 'accepted' } } },
    select: { id: true },
  });
  for (const { id } of challenges) {
    await refreshChallengeProgress(id, now, userId);
    await finishChallenge({ challengeId: id, now });
  }
});

export function registerChallengeProgressHandlers(): void {
  // no-op: registration happens on import
}
