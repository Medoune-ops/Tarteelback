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
import { enqueue } from '../../core/outbox.js';

function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const challengesService = {
  async preview(meId: string, body: { type: 'streak' | 'sourates'; goal: any; inviteeIds: string[] }) {
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

    const now = new Date();
    const startDay = localDayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000), me.timezone);
    const durationDays = 7; // preview par défaut
    const endDay = addDaysKey(startDay, Math.max(1, durationDays) - 1);

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
      computed: { startDay, endDay, startsAt: `${startDay}T00:00:00.000Z`, endsAt: `${endDay}T23:59:59.999Z`, durationDays },
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
    const startDay = localDayKey(new Date(Date.now() + 24 * 60 * 60 * 1000), tz);
    const endDay = addDaysKey(startDay, Math.max(1, body.durationDays) - 1);
    const startsAt = new Date(`${startDay}T00:00:00.000Z`);
    const endsAt = new Date(`${endDay}T23:59:59.999Z`);

    // baseline sourates pour le créateur
    const creatorBaseline = type === 'sourates' ? (await getLearnedSourates(meId)).map((s) => s.numero) : [];

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
          baseline: creatorBaseline.length,
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
          payload: { type, id: c.id },
        });
      }
      return c;
    });

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

  async accept(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const challenge = await challengeRepository.findByIdWithParticipants(id);
    if (!challenge) throw new AppError('NOT_FOUND', 'Challenge not found');
    const meParticipant = challenge.participants.find((p) => p.userId === meId);
    if (!meParticipant) throw new AppError('NOT_FOUND', 'Challenge not found');
    if (challenge.status !== 'pending' || new Date() >= challenge.startsAt) {
      throw new AppError('CHALLENGE_CLOSED', 'Challenge already started');
    }
    if (meParticipant.status !== 'invited') {
      return { status: meParticipant.status };
    }
    const acceptedCount = challenge.participants.filter(
      (p) => p.status === 'accepted',
    ).length;
    if (acceptedCount >= 10) throw new AppError('CHALLENGE_FULL', 'Challenge is full');
    await prisma.challengeParticipant.update({
      where: { id: meParticipant.id },
      data: { status: 'accepted', respondedAt: new Date() },
    });
    return { status: 'accepted' };
  },

  async decline(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const challenge = await challengeRepository.findByIdWithParticipants(id);
    if (!challenge) throw new AppError('NOT_FOUND', 'Challenge not found');
    const meParticipant = challenge.participants.find((p) => p.userId === meId);
    if (!meParticipant) throw new AppError('NOT_FOUND', 'Challenge not found');
    if (challenge.status !== 'pending' || new Date() >= challenge.startsAt) {
      throw new AppError('CHALLENGE_CLOSED', 'Challenge already started');
    }
    if (meParticipant.status !== 'invited') {
      return { status: meParticipant.status };
    }
    await prisma.challengeParticipant.update({
      where: { id: meParticipant.id },
      data: { status: 'declined', respondedAt: new Date() },
    });
    return { status: 'declined' };
  },

  async leave(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const challenge = await challengeRepository.findByIdWithParticipants(id);
    if (!challenge) throw new AppError('NOT_FOUND', 'Challenge not found');
    const meParticipant = challenge.participants.find((p) => p.userId === meId);
    if (!meParticipant) throw new AppError('NOT_FOUND', 'Challenge not found');
    if (meParticipant.status === 'left') {
      return { status: 'left' };
    }
    await prisma.challengeParticipant.update({
      where: { id: meParticipant.id },
      data: { status: 'left', respondedAt: new Date() },
    });
    return { status: 'left' };
  },

  async cancel(meId: string, id: string) {
    requireFriendsEnabled(meId);
    const challenge = await challengeRepository.findByIdWithParticipants(id);
    if (!challenge) throw new AppError('NOT_FOUND', 'Challenge not found');
    if (challenge.creatorId !== meId) throw new AppError('FORBIDDEN', 'Only creator can cancel');
    if (challenge.status !== 'pending' || new Date() >= challenge.startsAt) {
      throw new AppError('CHALLENGE_CLOSED', 'Challenge already started');
    }
    await prisma.challenge.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    return { status: 'cancelled' };
  },

  async list(meId: string, status?: 'active' | 'pending' | 'completed', cursor?: string | null, limit = 20) {
    requireFriendsEnabled(meId);
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
    const challenge = await challengeRepository.findByIdWithParticipants(id);
    if (!challenge) throw new AppError('NOT_FOUND', 'Challenge not found');
    const meParticipant = challenge.participants.find((p) => p.userId === meId);
    if (!meParticipant) throw new AppError('NOT_FOUND', 'Challenge not found');

    const participants = await Promise.all(
      challenge.participants.map(async (p) => {
        const user = await userRepository.findById(p.userId);
        if (!user || user.bannedAt) return null;
        let progress = p.progress;
        const startedAt = challenge.startsAt;
        if (challenge.type === 'streak') {
          const days = await prisma.activityDay.findMany({
            where: { userId: p.userId, day: { gte: challenge.startDay, lte: challenge.endDay } },
            select: { day: true },
          });
          progress = (await import('../../core/challengeRules.js').then((m) => m.streakLongestConsecutive(days.map((d) => d.day), challenge.startDay, challenge.endDay))) as number;
        } else {
          try {
            const learned = await getLearnedSourates(p.userId);
            const mastered = new Set(learned.map((s) => s.numero));
            const wanted = (challenge.goal as { sourateNumeros?: number[] })?.sourateNumeros ?? [];
            progress = wanted.filter((n) => mastered.has(n)).length;
          } catch {
            progress = p.progress;
          }
        }
        const profile = user
          ? await (async () => {
              const learned = await getLearnedSourates(user.id).catch(() => []);
              const week = await leagueRepository.currentWeekForUser(user.id, new Date()).catch(() => null);
              return serializePublicProfile({
                id: user.id,
                displayName: user.displayName,
                username: user.username,
                avatarInitials: user.avatarInitials,
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
        };
      }),
    );

    const valid = participants.filter(Boolean) as any[];
    valid.sort((a, b) => b.progress - a.progress);

    return {
      id: challenge.id,
      type: challenge.type,
      title: challenge.title,
      status: challenge.status,
      startDay: challenge.startDay,
      endDay: challenge.endDay,
      startsAt: challenge.startsAt,
      endsAt: challenge.endsAt,
      participants: valid.map((p, idx) => ({ ...p, rank: idx + 1 })),
    };
  },
};

export { orderPair } from '../../core/friendship.js';