import { AppError } from '../../core/errors.js';
import { requireFriendsEnabled } from '../friends/friends.guard.js';
import { canBecomeFriends } from '../../core/friendship.js';
import { dayWindow } from '../../core/friendship.js';
import { orderPair } from '../../core/friendship.js';
import { normalizeStreakGoal, normalizeSouratesGoal, kindOf, streakLongestConsecutive, expandRange } from '../../core/challengeRules.js';
import { isPremiumActive } from '../../core/premium.js';
import { challengeRepository } from './challenges.repository.js';
import { userRepository } from '../me/user.repository.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import { leagueRepository } from '../leagues/league.repository.js';
import { serializePublicProfile } from '../../core/friends.js';
import { prisma } from '../../config/prisma.js';
import { localDayKey } from '../../core/streak.js';
import { enqueue, scheduleOutboxDrain } from '../../core/outbox.js';
import { zonedDayStart, zonedDayEnd, addDaysToKey } from '../../core/zonedTime.js';
import {
  activateDueChallenges,
  finishChallenge,
  finishDueChallenges,
  refreshChallengeProgress,
} from './challenges.progress.js';

/**
 * Démarrage et fin « paresseux » : avant de répondre, on démarre les défis de
 * l'utilisateur dont la date de début est passée et on termine ceux qui sont
 * échus, sans attendre le job périodique.
 */
async function settleUserChallenges(meId: string, now: Date) {
  await activateDueChallenges(now, meId);
  await finishDueChallenges(now, meId);
}

/** Bornes d'un défi : début demain 00:00 dans le fuseau du créateur. */
function challengeWindow(timezone: string, durationDays: number, now: Date) {
  const startDay = localDayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000), timezone);
  const endDay = addDaysToKey(startDay, Math.max(1, durationDays) - 1);
  return {
    startDay,
    endDay,
    startsAt: zonedDayStart(startDay, timezone),
    endsAt: zonedDayEnd(endDay, timezone),
  };
}

async function loadParticipation(meId: string, id: string) {
  const challenge = await challengeRepository.findByIdWithParticipants(id);
  const me = challenge?.participants.find((p) => p.userId === meId);
  // 404 plutôt que 403 : on ne révèle pas l'existence d'un défi dont on n'est pas.
  if (!challenge || !me) throw new AppError('NOT_FOUND', 'Challenge not found');
  return { challenge, me };
}

export const challengesService = {
  async preview(meId: string, body: { type: 'streak' | 'sourates'; goal: any; inviteeIds: string[]; durationDays?: number }) {
    requireFriendsEnabled(meId);
    const me = await userRepository.getOrThrow(meId);
    const invitees = Array.from(new Set(body.inviteeIds || [])).filter((id) => id !== meId);
    if (invitees.length < 1 || invitees.length > 9) {
      return { valid: false, errors: ['invitee count must be 1..9 (2..10 participants)'] };
    }
    const errors: string[] = [];
    // amis vérifiés
    for (const otherId of invitees) {
      try {
        const fri = await challengeRepository.getAcceptedFriendship(meId, otherId);
        if (!fri || fri.status !== 'accepted') throw new Error('not friends');
        const u = await userRepository.findById(otherId);
        if (!u || u.bannedAt) throw new Error('not available');
        const blocked = await (async () => {
          // reuse repository isBlockedEither via friendsRepository? Import lazy
          try {
            const { friendsRepository } = await import('../friends/friends.repository.js');
            return await friendsRepository.isBlockedEither(meId, otherId);
          } catch {
            return false;
          }
        })();
        if (blocked) throw new Error('blocked');
      } catch {
        errors.push(`invalid invitee: ${otherId}`);
      }
    }

    const type = body.type;
    const goal = body.goal;
    let normalizedGoal: unknown = goal;
    if (type === 'streak') {
      const days = normalizeStreakGoal(goal);
      if (!Number.isFinite(days) || days < 3 || days > 100) errors.push('invalid streak days (3..100)');
      normalizedGoal = { type: 'streak', days };
    } else {
      const nums = normalizeSouratesGoal(goal);
      if (nums.length === 0) errors.push('invalid sourate list');
      normalizedGoal = { type: 'sourates', sourateNumeros: nums };
    }

    const durationDays = body.durationDays ?? 7; // 7 jours si l'assistant n'a pas encore choisi
    if (type === 'streak') {
      const days = normalizeStreakGoal(goal);
      if (Number.isFinite(days) && days > durationDays) errors.push('streak days must be <= durationDays');
    }
    const { startDay, endDay, startsAt, endsAt } = challengeWindow(me.timezone || 'UTC', durationDays, new Date());

    // alreadyMasteredBy : sourates déjà maîtrisées par chaque invitee
    const alreadyMasteredBy: Record<string, number[]> = {};
    if (type === 'sourates') {
      const wanted = normalizeSouratesGoal(normalizedGoal);
      for (const otherId of invitees) {
        try {
          const learned = await getLearnedSourates(otherId);
          const mastered = new Set(learned.map((s) => s.numero));
          alreadyMasteredBy[otherId] = wanted.filter((n) => mastered.has(n));
        } catch {
          alreadyMasteredBy[otherId] = [];
        }
      }
    } else {
      for (const otherId of invitees) alreadyMasteredBy[otherId] = [];
    }

    return {
      valid: errors.length === 0,
      errors,
      alreadyMasteredBy,
      computed: { startDay, endDay, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), durationDays },
      normalizedGoal,
    };
  },

  async create(meId: string, body: {
    type: 'streak' | 'sourates';
    goal: any;
    durationDays: number;
    title?: string;
    inviteeIds: string[];
  }) {
    requireFriendsEnabled(meId);
    const me = await userRepository.getOrThrow(meId);
    if (me.bannedAt) throw new AppError('FORBIDDEN', 'Banned');

    const invitees = Array.from(new Set(body.inviteeIds || [])).filter((id) => id !== meId);
    if (invitees.length < 1 || invitees.length > 9) {
      throw new AppError('VALIDATION_ERROR', 'invitee count must be 1..9 (2..10 participants)');
    }
    const allIds = [meId, ...invitees];
    // amis vérifiés + pas bloqués
    for (const otherId of invitees) {
      const fri = await challengeRepository.getAcceptedFriendship(meId, otherId);
      if (!fri || fri.status !== 'accepted') throw new AppError('NOT_FRIENDS', 'Not friends');
      const u = await userRepository.getOrThrow(otherId);
      if (u.bannedAt) throw new AppError('NOT_FOUND', 'User not found');
      const { friendsRepository } = await import('../friends/friends.repository.js');
      if (await friendsRepository.isBlockedEither(meId, otherId)) throw new AppError('BLOCKED', 'Blocked');
      const mePremium = isPremiumActive(me, new Date());
      const otherPremium = isPremiumActive(u, new Date());
      const meCount = await import('../friends/friends.repository.js').then((m) => m.friendsRepository.countAcceptedFriends(meId));
      const otherCount = await import('../friends/friends.repository.js').then((m) => m.friendsRepository.countAcceptedFriends(otherId));
      if (!canBecomeFriends(meCount, mePremium, otherCount, otherPremium)) throw new AppError('FRIEND_LIMIT', 'Friend limit reached');
    }

    // limites créateur
    const open = await challengeRepository.countOpenCreatedBy(meId);
    if (open >= 5) throw new AppError('QUOTA_EXCEEDED', 'Too many open challenges');
    const { start } = dayWindow(me, new Date());
    const createdToday = await challengeRepository.countCreatedToday(meId, start);
    if (createdToday >= 5) throw new AppError('QUOTA_EXCEEDED', 'Daily challenge quota exceeded');

    // normalisation goal
    const type = body.type;
    let goal: any;
    let target: number;
    if (type === 'streak') {
      const n = normalizeStreakGoal(body.goal);
      if (!Number.isFinite(n) || n < 3 || n > 100) throw new AppError('VALIDATION_ERROR', 'invalid streak days (3..100)');
      if (n > body.durationDays) throw new AppError('VALIDATION_ERROR', 'N <= durationDays');
      goal = { type: 'streak', days: n };
      target = n;
    } else {
      const nums = normalizeSouratesGoal(body.goal);
      if (nums.length === 0) throw new AppError('VALIDATION_ERROR', 'invalid sourate list');
      goal = { type: 'sourates', sourateNumeros: nums };
      target = nums.length;
    }

    const tz = me.timezone || 'UTC';
    const { startDay, endDay, startsAt, endsAt } = challengeWindow(tz, body.durationDays, new Date());
    // La photo de départ (sourates déjà maîtrisées) est prise au DÉMARRAGE du
    // défi, pour chaque participant (activateDueChallenges), pas à la création.

    const challenge = await prisma.$transaction(async (tx) => {
      const c = await tx.challenge.create({
        data: {
          creatorId: meId,
          type,
          title: body.title ?? `${type} challenge`,
          goal,
          timezone: tz,
          startDay,
          endDay,
          startsAt,
          endsAt,
          status: 'pending',
          winnerIds: [],
        },
      });
      await tx.challengeParticipant.create({
        data: {
          challengeId: c.id,
          userId: meId,
          status: 'accepted',
          baseline: 0,
          progress: 0,
          target,
          invitedAt: new Date(),
          respondedAt: new Date(),
        },
      });
      for (const otherId of invitees) {
        await tx.challengeParticipant.create({
          data: {
            challengeId: c.id,
            userId: otherId,
            status: 'invited',
            baseline: 0,
            progress: 0,
            target,
            invitedAt: new Date(),
          },
        });
        await enqueue(tx, {
          type: 'challenge_invite',
          userId: otherId,
          payload: { id: c.id, type: 'challenge_invite', challengeType: type },
        });
      }
      return c;
    });
    scheduleOutboxDrain();

    return {
      id: challenge.id,
      status: challenge.status,
      startDay,
      endDay,
      startsAt,
      endsAt,
      participants: allIds.length,
    };
  },

  async list(meId: string, status?: 'active' | 'pending' | 'completed', cursor?: string | null, limit = 20) {
    requireFriendsEnabled(meId);
    await settleUserChallenges(meId, new Date());
    const rows = await challengeRepository.listForUser(meId, status, Math.min(Math.max(1, limit), 50) + 1);
    const safeLimit = Math.min(Math.max(1, limit), 50);
    const hasMore = rows.length > safeLimit;
    const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
    const items = pageRows.map((c) => ({
      id: c.id,
      type: c.type,
      title: c.title,
      status: c.status,
      startDay: c.startDay,
      endDay: c.endDay,
      participants: c.participants.length,
    }));
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? last.id : null;
    return { items, nextCursor };
  },

  async get(meId: string, id: string) {
    requireFriendsEnabled(meId);
    await loadParticipation(meId, id); // 404 avant tout travail si je n'en suis pas
    const now = new Date();
    await settleUserChallenges(meId, now);
    // Classement en direct : progression recalculée avant de répondre.
    await refreshChallengeProgress(id, now);
    await finishChallenge({ challengeId: id, now });
    const { challenge } = await loadParticipation(meId, id);

    const participants = await Promise.all(
      challenge.participants.map(async (p) => {
        const user = await userRepository.findById(p.userId);
        if (!user || user.bannedAt) return null;
        const progress = p.progress;
        const profile = user
          ? await (async () => {
              const learned = await getLearnedSourates(user.id).catch(() => []);
              const week = await leagueRepository.currentWeekForUser(user.id, new Date()).catch(() => null);
              return serializePublicProfile({
                id: user.id,
                displayName: user.displayName,
                username: user.username,
                avatarInitials: user.avatarInitials,
                avatarStyle: user.avatarStyle,
                streak: user.streak,
                learnedSouratesCount: learned.length,
                leagueTier: week?.league?.nom ?? '',
                weeklyXp: user.weeklyXp,
              });
            })()
          : null;
        const target = p.target;
        return {
          userId: p.userId,
          user: profile,
          status: p.status,
          progress,
          target,
          reached: target > 0 && progress >= target,
          reachedAt: p.reachedAt,
          finalRank: p.rank,
          rewardGems: p.rewardGems,
          // Défi sourates : sourates de l'objectif qui ne comptent pas pour lui
          // (déjà maîtrisées au démarrage).
          baselineSourates: p.baselineSourates,
        };
      }),
    );

    const valid = participants.filter(Boolean) as any[];
    // Classement : rang final si le défi est terminé, sinon objectif atteint
    // d'abord (par heure), puis progression.
    valid.sort((a, b) => {
      if (a.finalRank != null && b.finalRank != null) return a.finalRank - b.finalRank;
      if (a.reached !== b.reached) return a.reached ? -1 : 1;
      if (a.reached && b.reached) return new Date(a.reachedAt).getTime() - new Date(b.reachedAt).getTime();
      return b.progress - a.progress;
    });

    return {
      id: challenge.id,
      type: challenge.type,
      title: challenge.title,
      status: challenge.status,
      startDay: challenge.startDay,
      endDay: challenge.endDay,
      startsAt: challenge.startsAt,
      endsAt: challenge.endsAt,
      goal: challenge.goal,
      creatorId: challenge.creatorId,
      winnerIds: challenge.winnerIds,
      finishedAt: challenge.finishedAt,
      participants: valid.map(({ finalRank, ...p }, idx) => ({ ...p, rank: finalRank ?? idx + 1 })),
    };
  },

  /**
   * Accepter une invitation. Possible seulement avant le début du défi
   * (sinon CHALLENGE_CLOSED). Idempotent si déjà accepté.
   */
  async accept(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const { challenge, me } = await loadParticipation(meId, id);
    if (me.status === 'accepted') return { status: 'accepted' as const };
    if (challenge.status !== 'pending' || Date.now() >= challenge.startsAt.getTime() || me.status !== 'invited') {
      throw new AppError('CHALLENGE_CLOSED', 'Challenge is no longer open');
    }
    const { friendsRepository } = await import('../friends/friends.repository.js');
    if (await friendsRepository.isBlockedEither(meId, challenge.creatorId)) throw new AppError('BLOCKED', 'Blocked');
    const updated = await prisma.challengeParticipant.updateMany({
      where: { id: me.id, status: 'invited' },
      data: { status: 'accepted', respondedAt: new Date() },
    });
    if (updated.count === 0) throw new AppError('CHALLENGE_CLOSED', 'Challenge is no longer open');
    return { status: 'accepted' as const };
  },

  /** Refuser une invitation (avant le début). Idempotent si déjà refusée. */
  async decline(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const { challenge, me } = await loadParticipation(meId, id);
    if (me.status === 'declined') return { status: 'declined' as const };
    if (challenge.status !== 'pending' || me.status !== 'invited') {
      throw new AppError('CHALLENGE_CLOSED', 'Challenge is no longer open');
    }
    await prisma.challengeParticipant.update({
      where: { id: me.id },
      data: { status: 'declined', respondedAt: new Date() },
    });
    return { status: 'declined' as const };
  },

  /**
   * Quitter un défi accepté. Le créateur d'un défi pas encore commencé doit
   * l'annuler. Un défi en cours qui retombe sous 2 participants est annulé
   * (sans récompense).
   */
  async leave(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const { challenge, me } = await loadParticipation(meId, id);
    if (me.status === 'left') return { status: 'left' as const };
    if (me.status !== 'accepted' || (challenge.status !== 'pending' && challenge.status !== 'active')) {
      throw new AppError('CHALLENGE_CLOSED', 'Challenge is no longer open');
    }
    if (challenge.status === 'pending' && challenge.creatorId === meId) {
      throw new AppError('VALIDATION_ERROR', 'The creator cancels the challenge instead of leaving it');
    }
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Challenge" WHERE id = ${id} FOR UPDATE`;
      await tx.challengeParticipant.update({ where: { id: me.id }, data: { status: 'left', respondedAt: now } });
      if (challenge.status !== 'active') return;
      const stillIn = await tx.challengeParticipant.findMany({
        where: { challengeId: id, status: 'accepted' },
        select: { userId: true },
      });
      if (stillIn.length >= 2) return;
      const cancelled = await tx.challenge.updateMany({
        where: { id, status: 'active' },
        data: { status: 'cancelled', finishedAt: now },
      });
      if (cancelled.count === 0) return;
      for (const p of stillIn) {
        await enqueue(tx, {
          type: 'challenge_cancelled',
          userId: p.userId,
          payload: { id, type: 'challenge_cancelled', reason: 'not_enough_participants' },
        });
      }
    });
    scheduleOutboxDrain();
    return { status: 'left' as const };
  },

  /** Annuler (créateur seulement, avant le début). */
  async cancel(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const { challenge } = await loadParticipation(meId, id);
    if (challenge.creatorId !== meId) throw new AppError('FORBIDDEN', 'Only the creator can cancel');
    if (challenge.status === 'cancelled') return { status: 'cancelled' as const };
    if (challenge.status !== 'pending') throw new AppError('CHALLENGE_CLOSED', 'Challenge already started');
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const done = await tx.challenge.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'cancelled', finishedAt: now },
      });
      if (done.count === 0) throw new AppError('CHALLENGE_CLOSED', 'Challenge already started');
      await tx.challengeParticipant.updateMany({
        where: { challengeId: id, status: 'invited' },
        data: { status: 'expired', respondedAt: now },
      });
      for (const p of challenge.participants) {
        if (p.userId === meId || (p.status !== 'accepted' && p.status !== 'invited')) continue;
        await enqueue(tx, {
          type: 'challenge_cancelled',
          userId: p.userId,
          payload: { id, type: 'challenge_cancelled', reason: 'creator_cancelled' },
        });
      }
    });
    scheduleOutboxDrain();
    return { status: 'cancelled' as const };
  },

  /**
   * Relance un participant en retard (une fois par ami, par défi et par 24 h
   * via lastNudgedAt). Émet un push challenge_nudge.
   * Le quota global (3 gratuit / 30 premium, ticket D-A) doit être vérifié
   * côté appelant une fois que le ticket D-A sera implémenté.
   */
  async nudge(meId: string, id: string, body: { userId: string }) {
    requireFriendsEnabled(meId);
    const challenge = await challengeRepository.findByIdWithParticipants(id);
    if (!challenge) throw new AppError('NOT_FOUND', 'Challenge not found');

    const meParticipant = challenge.participants.find((p) => p.userId === meId);
    if (!meParticipant) throw new AppError('NOT_FOUND', 'Challenge not found');
    if (challenge.status !== 'active' && challenge.status !== 'pending') {
      throw new AppError('CHALLENGE_CLOSED', 'Challenge is over');
    }

    const targetParticipant = challenge.participants.find(
      (p) => p.userId === body.userId,
    );
    if (!targetParticipant || targetParticipant.status !== 'accepted') {
      throw new AppError('NOT_FOUND', 'Participant not found');
    }

    const now = new Date();
    if (
      targetParticipant.lastNudgedAt &&
      now.getTime() - targetParticipant.lastNudgedAt.getTime() <
        24 * 60 * 60 * 1000
    ) {
      throw new AppError('QUOTA_EXCEEDED', 'Nudge cooldown not elapsed (24h)');
    }

    await prisma.challengeParticipant.update({
      where: { id: targetParticipant.id },
      data: { lastNudgedAt: now },
    });

    await prisma.$transaction(async (tx) => {
      await enqueue(tx, {
        type: 'challenge_nudge',
        userId: body.userId,
        payload: {
          challengeId: id,
          nudgedBy: meId,
        },
      });
    });

    scheduleOutboxDrain();
    return { nudged: true };
  },
};

export { orderPair } from '../../core/friendship.js';