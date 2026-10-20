import { prisma } from '../../config/prisma.js';
import { enqueue } from '../../core/outbox.js';
import {
  GEM_CHALLENGE_COMPLETE,
  GEM_CHALLENGE_WIN,
  MAX_CHALLENGE_REWARDS_PER_WEEK,
  MIN_FRIENDSHIP_AGE_MS,
} from '../../core/gems.js';
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
 * Vérifie (règle D-G) que `userId` a une amitié acceptée depuis au moins 24 h
 * avec au moins un des autres participants `otherUserIds`.
 */
async function hasOldFriendship(
  tx: typeof prisma,
  userId: string,
  otherUserIds: string[],
  now: Date,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - MIN_FRIENDSHIP_AGE_MS);
  const friendships = await tx.friendship.findMany({
    where: {
      status: 'accepted',
      acceptedAt: { lte: cutoff },
      OR: [
        {
          userLowId: userId,
          userHighId: { in: otherUserIds },
        },
        {
          userHighId: userId,
          userLowId: { in: otherUserIds },
        },
      ],
    },
    take: 1,
  });
  return friendships.length > 0;
}

/**
 * Compte combien de défis cette personne a déjà été récompensée (win ou
 * complete) sur la fenêtre glissante de 7 jours.
 */
async function challengeRewardsThisWeek(
  tx: typeof prisma,
  userId: string,
  now: Date,
): Promise<number> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return tx.gemTransaction.count({
    where: {
      userId,
      reason: { in: ['challenge_win', 'challenge_complete'] },
      createdAt: { gte: weekAgo },
    },
  });
}

/**
 * Termine un défi "active" quand tous ses participants "accepted" ont atteint
 * leur cible. Fin sous verrou (SELECT ... FOR UPDATE puis UPDATE ... WHERE
 * status = 'active' pour que le premier qui écrit gagne).
 *
 * Calcule rank, winnerIds, finishedAt. Crédite les gemmes (challenge_win +
 * 50 / challenge_complete + 20) avec contrainte d'unicité sur
 * (userId, ref = challengeId) pour éviter tout double paiement.
 *
 * Anti-triche :
 *  - au moins 2 participants acceptés
 *  - durée d'au moins 3 jours
 *  - au plus 3 défis récompensés par personne et par semaine
 *  - règle D-G : pas de récompense si pas d'amitié de 24 h+ avec un autre
 *    participant accepté
 *
 * Émet l'événement outbox challenge.finished. Idempotent.
 */
export async function finishChallenge({
  tx,
  challengeId,
  now,
}: {
  tx: typeof prisma;
  challengeId: string;
  now: Date;
}): Promise<{ finished: boolean; winnerIds?: string[] }> {
  // ── 1. Verrou ligne sur le défi (premier qui écrit gagne) ──
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Challenge" WHERE id = ${challengeId} FOR UPDATE`;
  if (locked.length === 0) return { finished: false };

  // ── 2. Re-lire le défi avec ses participants ──
  const challenge = await tx.challenge.findUnique({
    where: { id: challengeId },
    include: { participants: true },
  });
  if (!challenge || challenge.status !== 'active') return { finished: false };

  // ── 3. Anti-triche : au moins 2 acceptés ──
  const accepted = challenge.participants.filter(
    (p) => p.status === 'accepted',
  );
  if (accepted.length < 2) return { finished: false };

  // ── 4. Tous les accepted doivent avoir atteint ──
  const allReached = accepted.every(
    (p) => p.target > 0 && p.progress >= p.target,
  );
  if (!allReached) return { finished: false };

  // ── 6. Durée du défi (en jours calendaires) ──
  const start = new Date(challenge.startDay);
  const end = new Date(challenge.endDay);
  const durationDays =
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const durationOk = durationDays >= 3;

  // ── 7. Gagnants (déterminés par determineWinners) ──
  const winnerIds = determineWinners(
    accepted.map((p) => ({
      userId: p.userId,
      progress: p.progress,
      target: p.target,
      reached: true,
      reachedAt: p.reachedAt,
    })),
  );
  const winnerSet = new Set(winnerIds);

  // ── 8. Passer le défi en completed (UPDATE conditionnel) ──
  const updated = await tx.challenge.update({
    where: { id: challengeId, status: 'active' },
    data: {
      status: 'completed',
      finishedAt: now,
      winnerIds,
    },
  });
  if (!updated) return { finished: false }; // déjà terminé par une autre instance

  // ── 8. Rang + récompenses par participant ──
  // Rang : gagnants = 1, puis les autres par progress décroissant.
  const ranked = [...accepted]
    .filter((p) => p.target > 0 && p.progress >= p.target)
    .sort((a, b) => {
      if (winnerSet.has(a.userId) && !winnerSet.has(b.userId)) return -1;
      if (!winnerSet.has(a.userId) && winnerSet.has(b.userId)) return 1;
      return b.progress - a.progress || b.reachedAt!.getTime() - a.reachedAt!.getTime();
    });

  let rank = 1;
  let prevProgress: number | null = null;
  let prevReachedAt: Date | null = null;
  let rankCursor = 1;

  for (const p of ranked) {
    const sameAsPrev =
      prevProgress !== null &&
      p.progress === prevProgress &&
      prevReachedAt !== null &&
      p.reachedAt &&
      p.reachedAt.getTime() === prevReachedAt.getTime();
    if (!sameAsPrev) rankCursor = rank;
    await tx.challengeParticipant.update({
      where: { id: p.id },
      data: { rank: rankCursor },
    });
    prevProgress = p.progress;
    prevReachedAt = p.reachedAt ?? null;
    rank += 1;
  }

  const otherAcceptedIds = accepted.map((p) => p.userId);

  for (const p of ranked) {
    const userId = p.userId;
    const isWinner = winnerSet.has(userId);

    // Règle D-G : amitié de 24 h+ avec au moins un autre participant accepté.
    const others = otherAcceptedIds.filter((id) => id !== userId);
    if (!(await hasOldFriendship(tx, userId, others, now))) continue;

    // Anti-triche : durée d'au moins 3 jours pour recevoir une récompense.
    if (!durationOk) continue;

    // Anti-farm : max 3 défis récompensés par semaine.
    if (await challengeRewardsThisWeek(tx, userId, now) >= MAX_CHALLENGE_REWARDS_PER_WEEK)
      continue;

    // Unicité du paiement : jamais deux récompenses pour un même (user, challenge).
    const alreadyPaid = await tx.gemTransaction.findFirst({
      where: { userId, ref: challengeId },
    });
    if (alreadyPaid) continue;

    const amount = isWinner ? GEM_CHALLENGE_WIN : GEM_CHALLENGE_COMPLETE;
    const reason: 'challenge_win' | 'challenge_complete' = isWinner
      ? 'challenge_win'
      : 'challenge_complete';

    await tx.gemTransaction.create({
      data: { userId, amount, reason, ref: challengeId },
    });
  }

  // ── 9. Événement challenge.finished (push au gagnant et aux perdants) ──
  await enqueue(tx, {
    type: 'challenge.finished',
    userId: challenge.creatorId,
    payload: {
      challengeId,
      winnerIds,
      participantIds: challenge.participants.map((p) => p.userId),
    },
  });

  return { finished: true, winnerIds };
}
