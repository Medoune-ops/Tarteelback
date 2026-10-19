import { registerOutboxHandler } from '../../core/outbox.js';
import { prisma } from '../../config/prisma.js';
import { challengeRepository } from './challenges.repository.js';
import {
  recalculateParticipantProgress,
  tryCompleteChallenge,
} from './challenges.progress.js';

/**
 * Quand une leçon est complétée (événement outbox `lesson.completed`), on
 * recalcule la progression de l'utilisateur sur chaque défi ACTIF où il est
 * participant "accepted" :
 *  - recalcul depuis la source de vérité (jamais "+1" incrémental)
 *  - mise à jour de progress + reachedAt (une seule fois)
 *  - tentative de terminaison du défi (3.B7)
 *
 * Idempotent : un événement perdu ou rejoué donne le même résultat, car le
 * recalcul part de la source de vérité et la terminaison est conditionnée
 * par UPDATE ... WHERE status = 'active'.
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

    // Recharge les participants à jour pour la décision de terminaison.
    const updated = await challengeRepository.findByIdWithParticipants(
      challenge.id,
    );
    if (!updated) continue;

    await tryCompleteChallenge({
      tx: prisma,
      challenge: {
        id: updated.id,
        status: updated.status,
        type: updated.type,
        participants: updated.participants.map((p) => ({
          userId: p.userId,
          status: p.status,
          progress: p.progress,
          target: p.target,
          reachedAt: p.reachedAt,
        })),
      },
      participants: updated.participants.map((p) => ({
        userId: p.userId,
        status: p.status,
        progress: p.progress,
        target: p.target,
        reachedAt: p.reachedAt,
      })),
      now,
    });
  }
});

export function registerChallengeProgressHandlers(): void {
  // no-op: registration happens on import
}
