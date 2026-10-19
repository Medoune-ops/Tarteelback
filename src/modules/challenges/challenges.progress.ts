import { prisma } from '../../config/prisma.js';
import {
  determineWinners,
  streakLongestConsecutive,
} from '../../core/challengeRules.js';

/**
 * Recalcule la progression d'un participant depuis la source de vérité
 * (jamais "+1" incrémental) :
 *  - streak : ActivityDay dans [startDay, endDay]
 *  - sourates : leçons complétées depuis startsAt du défi (baseline exclue)
 *
 * Retourne { progress, reachedAt } où reachedAt n'est défini que si le défi
 * vient d'être atteint pour la première fois (idempotent).
 */
export async function recalculateParticipantProgress({
  tx,
  challenge,
  participant,
}: {
  tx: typeof prisma;
  challenge: {
    id: string;
    type: 'streak' | 'sourates';
    goal: { sourateNumeros?: number[] };
    startDay: string;
    endDay: string;
    startsAt: Date;
  };
  participant: {
    userId: string;
    baseline: number;
    progress: number;
    reachedAt: Date | null;
    target: number;
  };
}) {
  let progress = 0;
  let reachedAt: Date | null = null;

  if (challenge.type === 'streak') {
    const days = await tx.activityDay.findMany({
      where: {
        userId: participant.userId,
        day: { gte: challenge.startDay, lte: challenge.endDay },
      },
      select: { day: true },
    });
    progress = streakLongestConsecutive(
      days.map((d) => d.day),
      challenge.startDay,
      challenge.endDay,
    );
  } else {
    const wanted =
      (challenge.goal as { sourateNumeros?: number[] })?.sourateNumeros ?? [];
    if (wanted.length > 0) {
      // Leçons complétées de l'utilisateur, avec leur date, limitées aux
      // sourates du goal et après le début du défi (baseline exclue).
      const completed = await tx.lessonProgress.findMany({
        where: {
          userId: participant.userId,
          etat: 'completed',
        },
        select: { lessonId: true, completedAt: true },
      });
      const lessons = await tx.lesson.findMany({
        where: {
          id: { in: completed.map((c) => c.lessonId) },
          sourateNumero: { in: wanted },
        },
        select: { id: true, sourateNumero: true },
      });
      const lessonSourate = new Map(
        lessons.map((l) => [l.id, l.sourateNumero!]),
      );
      const masteredSinceStart = new Set<number>();
      for (const c of completed) {
        const numero = lessonSourate.get(c.lessonId);
        if (!numero) continue;
        if (!wanted.includes(numero)) continue;
        if (c.completedAt && c.completedAt >= challenge.startsAt) {
          masteredSinceStart.add(numero);
        }
      }
      progress = masteredSinceStart.size;
    }
  }

  const target = participant.target;
  const reached = target > 0 && progress >= target;
  if (reached && !participant.reachedAt) {
    reachedAt = new Date();
  }

  return { progress, reachedAt };
}

/**
 * Tente de terminer un défi actif quand tous ses participants "accepted"
 * ont atteint leur cible. Passe le défi en "completed" et enregistre les
 * gagnants (déterminés par determineWinners).
 */
export async function tryCompleteChallenge({
  tx,
  challenge,
  participants,
  now,
}: {
  tx: typeof prisma;
  challenge: {
    id: string;
    status: string;
    type: 'streak' | 'sourates';
    participants: Array<{
      userId: string;
      status: string;
      progress: number;
      target: number;
      reachedAt: Date | null;
    }>;
  };
  participants: Array<{
    userId: string;
    status: string;
    progress: number;
    target: number;
    reachedAt: Date | null;
  }>;
  now: Date;
}) {
  if (challenge.status !== 'active') return false;

  const accepted = participants.filter((p) => p.status === 'accepted');
  if (accepted.length === 0) return false;
  const allReached = accepted.every(
    (p) => p.target > 0 && p.progress >= p.target,
  );
  if (!allReached) return false;

  const winnerIds = determineWinners(
    accepted.map((p) => ({
      userId: p.userId,
      progress: p.progress,
      target: p.target,
      reached: true,
      reachedAt: p.reachedAt,
    })),
  );

  await tx.challenge.update({
    where: { id: challenge.id, status: 'active' },
    data: {
      status: 'completed',
      finishedAt: now,
      winnerIds,
    },
  });
  return true;
}


