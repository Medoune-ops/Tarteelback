import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { enqueue, scheduleOutboxDrain } from '../../core/outbox.js';
import { MIN_FRIENDSHIP_AGE_MS } from '../../core/gems.js';
import { ensureFriendsConfigFresh } from '../../core/friendsConfig.js';
import {
  determineWinners,
  normalizeSouratesGoal,
  sourateProgressCount,
  streakLongestConsecutive,
} from '../../core/challengeRules.js';

type Db = Prisma.TransactionClient | typeof prisma;

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

/**
 * Pour chaque sourate de `numeros` entièrement maîtrisée (toutes ses leçons
 * taguées `sourateNumero` terminées — même règle que masteredAmong), l'heure à
 * laquelle sa DERNIÈRE leçon a été terminée. Les sourates non maîtrisées sont
 * absentes de la Map. 2 requêtes, quel que soit le nombre de sourates.
 */
export async function masteryTimes(db: Db, userId: string, numeros: number[]): Promise<Map<number, Date>> {
  const result = new Map<number, Date>();
  if (numeros.length === 0) return result;
  const lessons = await db.lesson.findMany({
    where: { sourateNumero: { in: numeros } },
    select: { id: true, sourateNumero: true },
  });
  if (lessons.length === 0) return result;
  const done = await db.lessonProgress.findMany({
    where: { userId, etat: 'completed', lessonId: { in: lessons.map((l) => l.id) } },
    select: { lessonId: true, completedAt: true },
  });
  const doneAt = new Map(done.map((d) => [d.lessonId, d.completedAt ?? new Date(0)]));
  const bySourate = new Map<number, string[]>();
  for (const l of lessons) {
    const arr = bySourate.get(l.sourateNumero!) ?? [];
    arr.push(l.id);
    bySourate.set(l.sourateNumero!, arr);
  }
  for (const [numero, ids] of bySourate) {
    if (!ids.every((id) => doneAt.has(id))) continue;
    const last = Math.max(...ids.map((id) => doneAt.get(id)!.getTime()));
    result.set(numero, new Date(last));
  }
  return result;
}

type ChallengeForProgress = {
  type: 'streak' | 'sourates';
  goal: unknown;
  startDay: string;
  endDay: string;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Progression d'un participant, RECALCULÉE depuis les données écrites par le
 * serveur (jamais de « +1 ») :
 *  - streak : plus longue suite de jours consécutifs dans ActivityDay entre
 *    startDay et endDay (chacun dans son fuseau) ;
 *  - sourates : sourates de l'objectif maîtrisées APRÈS le début du défi et
 *    absentes de la photo de départ (baselineSourates), et avant l'échéance.
 */
export async function computeParticipantProgress(
  db: Db,
  challenge: ChallengeForProgress,
  participant: { userId: string; baselineSourates: number[] },
  now: Date = new Date(),
): Promise<number> {
  if (challenge.type === 'streak') {
    const days = await db.activityDay.findMany({
      where: { userId: participant.userId, day: { gte: challenge.startDay, lte: challenge.endDay } },
      select: { day: true },
    });
    return streakLongestConsecutive(days.map((d) => d.day), challenge.startDay, challenge.endDay);
  }
  const wanted = normalizeSouratesGoal(challenge.goal);
  const times = await masteryTimes(db, participant.userId, wanted);
  return sourateProgressCount({
    goal: challenge.goal,
    baseline: participant.baselineSourates,
    // Maîtrisée après l'échéance : ne compte plus.
    completed: wanted.map((numero) => {
      const at = times.get(numero);
      const inTime = !!at && at.getTime() <= challenge.endsAt.getTime();
      return { numero, allLessonsCompleted: inTime, completedAt: inTime ? at! : null };
    }),
    startedAt: challenge.startsAt,
    now,
  });
}

/**
 * Recalcule et enregistre la progression des participants « accepted » d'un
 * défi ACTIF (tous, ou seulement `onlyUserId`). `reachedAt` n'est posé qu'à la
 * première atteinte de l'objectif. Idempotent.
 */
export async function refreshChallengeProgress(
  challengeId: string,
  now: Date = new Date(),
  onlyUserId?: string,
): Promise<void> {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    include: { participants: true },
  });
  if (!challenge || challenge.status !== 'active') return;
  for (const p of challenge.participants) {
    if (p.status !== 'accepted') continue;
    if (onlyUserId && p.userId !== onlyUserId) continue;
    const progress = await computeParticipantProgress(prisma, challenge, p, now);
    const reached = p.target > 0 && progress >= p.target;
    if (progress === p.progress && (!reached || p.reachedAt)) continue;
    await prisma.challengeParticipant.update({
      where: { id: p.id },
      data: { progress, ...(reached && !p.reachedAt ? { reachedAt: now } : {}) },
    });
  }
}

// --------------------------------------------------------------------------- démarrage

/**
 * Démarre (ou annule) les défis « pending » dont la date de début est passée.
 * Sous verrou ligne : deux passages simultanés ne traitent jamais le même défi.
 *  - au moins 2 participants ont accepté → « active » ; photo de départ prise
 *    pour chaque participant (défi sourates) ; invitations restées sans réponse
 *    → « expired » ; push « challenge_started » ;
 *  - sinon → « cancelled » ; push « challenge_cancelled » aux acceptés.
 * `onlyUserId` limite aux défis de cette personne (démarrage « paresseux » à la
 * lecture, sans attendre le job). Relançable sans effet.
 */
export async function activateDueChallenges(
  now: Date = new Date(),
  onlyUserId?: string,
): Promise<{ activated: number; cancelled: number }> {
  const due = await prisma.challenge.findMany({
    where: {
      status: 'pending',
      startsAt: { lte: now },
      ...(onlyUserId ? { participants: { some: { userId: onlyUserId } } } : {}),
    },
    select: { id: true },
  });
  let activated = 0;
  let cancelled = 0;
  for (const { id } of due) {
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Challenge" WHERE id = ${id} AND status = 'pending' FOR UPDATE`;
      if (locked.length === 0) return null;
      const challenge = await tx.challenge.findUnique({ where: { id }, include: { participants: true } });
      if (!challenge || challenge.status !== 'pending') return null;
      const accepted = challenge.participants.filter((p) => p.status === 'accepted');

      await tx.challengeParticipant.updateMany({
        where: { challengeId: id, status: 'invited' },
        data: { status: 'expired', respondedAt: now },
      });

      if (accepted.length < 2) {
        await tx.challenge.update({ where: { id }, data: { status: 'cancelled', finishedAt: now } });
        for (const p of accepted) {
          await enqueue(tx, {
            type: 'challenge_cancelled',
            userId: p.userId,
            payload: { id, type: 'challenge_cancelled', reason: 'not_enough_participants' },
          });
        }
        return 'cancelled' as const;
      }

      const wanted = challenge.type === 'sourates' ? normalizeSouratesGoal(challenge.goal) : [];
      for (const p of accepted) {
        const baselineSourates = wanted.length > 0 ? [...(await masteryTimes(tx, p.userId, wanted)).keys()] : [];
        await tx.challengeParticipant.update({
          where: { id: p.id },
          data: { baselineSourates, baseline: baselineSourates.length, progress: 0, reachedAt: null },
        });
        await enqueue(tx, {
          type: 'challenge_started',
          userId: p.userId,
          payload: { id, type: 'challenge_started' },
        });
      }
      await tx.challenge.update({ where: { id }, data: { status: 'active' } });
      return 'activated' as const;
    }, TX_OPTIONS);
    if (outcome === 'activated') activated += 1;
    if (outcome === 'cancelled') cancelled += 1;
  }
  if (activated + cancelled > 0) scheduleOutboxDrain();
  return { activated, cancelled };
}

// --------------------------------------------------------------------------- fin

/** Amitié acceptée depuis au moins 24 h avec au moins un des autres participants. */
async function hasOldFriendship(tx: Db, userId: string, others: string[], now: Date): Promise<boolean> {
  if (others.length === 0) return false;
  const cutoff = new Date(now.getTime() - MIN_FRIENDSHIP_AGE_MS);
  const found = await tx.friendship.findFirst({
    where: {
      status: 'accepted',
      acceptedAt: { lte: cutoff },
      OR: [
        { userLowId: userId, userHighId: { in: others } },
        { userHighId: userId, userLowId: { in: others } },
      ],
    },
    select: { id: true },
  });
  return !!found;
}

/** Défis déjà récompensés pour cette personne sur 7 jours glissants. */
async function rewardsThisWeek(tx: Db, userId: string, now: Date): Promise<number> {
  return tx.gemTransaction.count({
    where: {
      userId,
      reason: { in: ['challenge_win', 'challenge_complete'] },
      createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    },
  });
}

function dayCount(startDay: string, endDay: string): number {
  const ms = new Date(`${endDay}T00:00:00.000Z`).getTime() - new Date(`${startDay}T00:00:00.000Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Termine un défi ACTIF, dans une transaction avec verrou sur la ligne du défi
 * (le premier qui écrit gagne, un second appel simultané ne fait rien).
 *
 * Quand :
 *  - dès que TOUS les participants acceptés ont atteint l'objectif ;
 *  - ou à l'échéance (`now >= endsAt`), quoi qu'il arrive.
 *
 * Gagnant : le premier à avoir atteint l'objectif (reachedAt le plus tôt ;
 * égalité parfaite = ex æquo). Si personne ne l'a atteint à l'échéance : la
 * meilleure progression, à condition qu'elle soit > 0.
 *
 * Récompenses (réglables au back-office) : gagnant `challengeWinGems`, objectif
 * atteint sans gagner `challengeCompleteGems`. Créditées au SOLDE et inscrites
 * au journal. Anti-triche : au moins 2 acceptés, défi d'au moins 3 jours,
 * amitié de 24 h+ avec un autre participant, plafond hebdomadaire, jamais deux
 * paiements pour un même (personne, défi).
 *
 * Crée la réussite « challenge_won » des gagnants et émet `challenge.finished`.
 * Le paramètre `tx` est ignoré (gardé pour compatibilité des appels) : la
 * fonction ouvre toujours sa propre transaction, sans quoi le verrou ne tient pas.
 */
export async function finishChallenge({
  challengeId,
  now,
}: {
  tx?: unknown;
  challengeId: string;
  now: Date;
}): Promise<{ finished: boolean; winnerIds?: string[] }> {
  const cfg = await ensureFriendsConfigFresh();
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Challenge" WHERE id = ${challengeId} FOR UPDATE`;
    if (locked.length === 0) return { finished: false } as const;

    const challenge = await tx.challenge.findUnique({
      where: { id: challengeId },
      include: { participants: true },
    });
    if (!challenge || challenge.status !== 'active') return { finished: false } as const;

    const accepted = challenge.participants.filter((p) => p.status === 'accepted');
    const isReached = (p: (typeof accepted)[number]) => p.target > 0 && p.progress >= p.target;
    const deadline = now.getTime() >= challenge.endsAt.getTime();
    const allReached = accepted.length >= 2 && accepted.every(isReached);
    if (!deadline && !allReached) return { finished: false } as const;

    // ── Gagnants ──
    const reached = accepted.filter(isReached);
    let winnerIds: string[] = [];
    if (reached.length > 0) {
      winnerIds = determineWinners(
        reached.map((p) => ({ userId: p.userId, progress: p.progress, target: p.target, reached: true, reachedAt: p.reachedAt })),
      );
    } else if (accepted.some((p) => p.progress > 0)) {
      winnerIds = determineWinners(
        accepted.map((p) => ({ userId: p.userId, progress: p.progress, target: p.target, reached: false })),
      );
    }
    const winners = new Set(winnerIds);

    const closed = await tx.challenge.updateMany({
      where: { id: challengeId, status: 'active' },
      data: { status: 'completed', finishedAt: now, winnerIds },
    });
    if (closed.count === 0) return { finished: false } as const;

    // ── Rangs : objectif atteint d'abord (par heure d'atteinte), puis progression ──
    const ordered = [...accepted].sort((a, b) => {
      const ra = isReached(a);
      const rb = isReached(b);
      if (ra !== rb) return ra ? -1 : 1;
      if (ra && rb) return (a.reachedAt?.getTime() ?? Infinity) - (b.reachedAt?.getTime() ?? Infinity);
      return b.progress - a.progress;
    });
    const sameRank = (a: (typeof ordered)[number], b: (typeof ordered)[number]) =>
      isReached(a) === isReached(b) &&
      (isReached(a) ? a.reachedAt?.getTime() === b.reachedAt?.getTime() : a.progress === b.progress);
    let rank = 0;
    for (let i = 0; i < ordered.length; i++) {
      if (i === 0 || !sameRank(ordered[i - 1]!, ordered[i]!)) rank = i + 1;
      await tx.challengeParticipant.update({ where: { id: ordered[i]!.id }, data: { rank } });
    }

    // ── Récompenses ──
    const durationOk = dayCount(challenge.startDay, challenge.endDay) >= 3;
    if (cfg.challengeRewardsEnabled && accepted.length >= 2 && durationOk) {
      const acceptedIds = accepted.map((p) => p.userId);
      for (const p of accepted) {
        const isWinner = winners.has(p.userId);
        if (!isWinner && !isReached(p)) continue;
        const amount = isWinner ? cfg.challengeWinGems : cfg.challengeCompleteGems;
        if (amount <= 0) continue;
        const others = acceptedIds.filter((id) => id !== p.userId);
        if (!(await hasOldFriendship(tx, p.userId, others, now))) continue;
        if ((await rewardsThisWeek(tx, p.userId, now)) >= cfg.challengeRewardedPerWeek) continue;
        const alreadyPaid = await tx.gemTransaction.findFirst({
          where: { userId: p.userId, ref: challengeId, reason: { in: ['challenge_win', 'challenge_complete'] } },
          select: { id: true },
        });
        if (alreadyPaid) continue;
        await tx.gemTransaction.create({
          data: { userId: p.userId, amount, reason: isWinner ? 'challenge_win' : 'challenge_complete', ref: challengeId },
        });
        await tx.user.update({ where: { id: p.userId }, data: { gems: { increment: amount } } });
        await tx.challengeParticipant.update({ where: { id: p.id }, data: { rewardGems: amount } });
      }
    }

    // ── Réussite « défi gagné » ──
    for (const userId of winnerIds) {
      await tx.achievement.upsert({
        where: { userId_type_refKey: { userId, type: 'challenge_won', refKey: challengeId } },
        create: {
          userId,
          type: 'challenge_won',
          refKey: challengeId,
          payload: {
            challengeId,
            challengeType: challenge.type,
            title: challenge.title,
            goal: challenge.goal as Prisma.InputJsonValue,
            participants: accepted.length,
          },
        },
        update: {},
      });
    }

    await enqueue(tx, {
      type: 'challenge.finished',
      userId: challenge.creatorId,
      payload: { challengeId, winnerIds, participantIds: accepted.map((p) => p.userId) },
    });
    return { finished: true, winnerIds } as const;
  }, TX_OPTIONS);

  if (result.finished) scheduleOutboxDrain();
  return result.finished ? { finished: true, winnerIds: [...result.winnerIds] } : { finished: false };
}

/** Termine tous les défis actifs échus (job + fin « paresseuse » à la lecture). */
export async function finishDueChallenges(now: Date = new Date(), onlyUserId?: string): Promise<number> {
  const due = await prisma.challenge.findMany({
    where: {
      status: 'active',
      endsAt: { lte: now },
      ...(onlyUserId ? { participants: { some: { userId: onlyUserId } } } : {}),
    },
    select: { id: true },
  });
  let finished = 0;
  for (const { id } of due) {
    // Dernière mise à jour de la progression avant de figer le classement.
    await refreshChallengeProgress(id, now);
    if ((await finishChallenge({ challengeId: id, now })).finished) finished += 1;
  }
  return finished;
}
