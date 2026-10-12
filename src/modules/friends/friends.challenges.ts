import { prisma } from '../../config/prisma.js';
import { AppError } from '../../core/errors.js';
import { getLearnedSourates } from '../me/learnedSourates.js';
import { notificationService } from '../notifications/notification.service.js';
import { friendsRepository, friendUserSelect } from './friends.repository.js';

export interface ChallengeParticipantView {
  user: { id: string; displayName: string; username: string | null; avatarInitials: string };
  progress: number;
  achieved: boolean;
  isMe: boolean;
}

export interface ChallengeView {
  id: string;
  title: string;
  metric: 'xp' | 'streak' | 'sourates';
  targetValue: number;
  sourateNumeros?: number[];
  startsAt: string;
  endsAt: string;
  status: 'active' | 'ended';
  creator: { id: string; displayName: string; username: string | null; avatarInitials: string };
  isCreator: boolean;
  participants: ChallengeParticipantView[];
  winnerIds: string[];
}

const MAX_TARGET = 100_000;
const MAX_DURATION_DAYS = 60;

  /** Progrès d'un utilisateur pour la métrique d'un défi. */
  async function progressFor(
    user: { id: string; weeklyXp: number; streak: number },
    metric: 'xp' | 'streak' | 'sourates',
    learnedCache: Map<string, number[]>,
    chosen: number[],
  ): Promise<number> {
    if (metric === 'xp') return user.weeklyXp;
    if (metric === 'streak') return user.streak;
    // 'sourates' — nombre de sourates choisies maîtrisées parmi sourateNumeros
    let learnedNums = learnedCache.get(user.id);
    if (learnedNums == null) {
      const learned = await getLearnedSourates(user.id);
      learnedNums = learned.map((s) => s.numero);
      learnedCache.set(user.id, learnedNums);
    }
    const target = chosen;
    if (target.length === 0) return learnedNums.length;
    const set = new Set(learnedNums);
    let count = 0;
    for (const n of target) if (set.has(n)) count++;
    return count;
  }

/**
 * Défis partagés (phase 3). Les participants sont ajoutés à la création (pas
 * d'étape d'acceptation). On quitte un défi définitivement (suppression de la
 * participation). Le gagnant est le premier à atteindre l'objectif ; en cas
 * d'égalité de date, tous les co-vainqueurs sont listés dans `winnerIds`.
 */
export const friendsChallengesService = {
  async create(
    userId: string,
    input: { title: string; metric: 'xp' | 'streak' | 'sourates'; targetValue: number; endsAt: Date; friendIds: string[]; sourateNumeros?: number[] },
  ): Promise<ChallengeView> {
    if (input.metric !== 'sourates') {
      if (input.targetValue < 1 || input.targetValue > MAX_TARGET) {
        throw new AppError('VALIDATION_ERROR', 'Invalid target');
      }
    }
    const now = new Date();
    if (input.endsAt.getTime() <= now.getTime()) {
      throw new AppError('VALIDATION_ERROR', 'End date must be in the future');
    }
    const maxEnd = now.getTime() + MAX_DURATION_DAYS * 24 * 60 * 60 * 1000;
    if (input.endsAt.getTime() > maxEnd) {
      throw new AppError('VALIDATION_ERROR', 'Challenge too long');
    }

    const uniqueFriendIds = [...new Set(input.friendIds)].filter((id) => id !== userId);
    if (uniqueFriendIds.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Select at least one friend');
    }
    if (uniqueFriendIds.length > 19) {
      throw new AppError('VALIDATION_ERROR', 'Too many participants');
    }

    // Tous les invités doivent être des amis, non bloqués.
    for (const friendId of uniqueFriendIds) {
      const friendship = await friendsRepository.findBetween(userId, friendId);
      if (!friendship) throw new AppError('FRIEND_BLOCKED', 'Not a friend');
      if (await friendsRepository.findBlockBetween(userId, friendId)) {
        throw new AppError('FRIEND_BLOCKED', 'Unable to invite this user');
      }
    }

    let sourateNumeros: number[] | undefined = undefined;
    if (input.metric === 'sourates') {
      sourateNumeros = Array.from(new Set(input.sourateNumeros ?? [])).filter((n)=>n>=1&&n<=114).sort((a,b)=>a-b);
      if (sourateNumeros.length === 0) throw new AppError('VALIDATION_ERROR', 'Select at least one sourate');
    }

    const created = await friendsRepository.createChallenge(
      userId,
      { title: input.title, metric: input.metric, targetValue: input.targetValue, endsAt: input.endsAt, sourateNumeros },
      [userId, ...uniqueFriendIds],
    );

    await Promise.all(
      uniqueFriendIds.map((friendId) =>
        notificationService
          .sendToUser(friendId, {
            title: 'Nouveau défi',
            body: `Défi « ${input.title} » — rejoins-le !`,
            data: { type: 'challenge_created', challengeId: created.id },
          })
          .catch(() => {}),
      ),
    );

    return this.toView(created, userId);
  },

  async list(userId: string): Promise<ChallengeView[]> {
    const rows = await friendsRepository.listChallengesForUser(userId);
    return Promise.all(rows.map((r) => this.toView(r, userId)));
  },

  async get(userId: string, challengeId: string): Promise<ChallengeView> {
    const challenge = await friendsRepository.getChallenge(challengeId);
    if (!challenge || !challenge.entries.some((e) => e.userId === userId)) {
      throw new AppError('NOT_FOUND', 'Challenge not found');
    }
    return this.toView(challenge, userId);
  },

  /** Quitte un défi — définitif (le créateur ne peut pas quitter). */
  async leave(userId: string, challengeId: string) {
    const challenge = await friendsRepository.getChallenge(challengeId);
    if (!challenge) throw new AppError('NOT_FOUND', 'Challenge not found');
    if (!challenge.entries.some((e) => e.userId === userId)) {
      throw new AppError('NOT_FOUND', 'Challenge not found');
    }
    if (challenge.creatorId === userId) {
      throw new AppError('VALIDATION_ERROR', 'The creator cannot leave their own challenge');
    }
    await friendsRepository.deleteEntry(challengeId, userId);
    return { left: true };
  },

  /** Recalcule les progrès, persiste les atteintes, résout les gagnants au terme. */
  async   toView(
    challenge: {
      id: string;
      title: string;
      metric: 'xp' | 'streak' | 'sourates';
      targetValue: number;
      sourateNumeros: number[];
      startsAt: Date;
      endsAt: Date;
      status: 'active' | 'ended';
      winnerIds: string[];
      creatorId: string;
      creator: { id: string; displayName: string; username: string | null; avatarInitials: string };
      entries: Array<{
        id: string;
        userId: string;
        progress: number;
        achievedAt: Date | null;
        user: { id: string; displayName: string; username: string | null; avatarInitials: string };
      }>;
    },
    meId: string,
  ): Promise<ChallengeView> {
    const now = new Date();
    const learnedCache = new Map<string, number[]>();
    const chosen = challenge.sourateNumeros ?? [];

    const stats = await prisma.user.findMany({
      where: { id: { in: challenge.entries.map((e) => e.userId) } },
      select: { id: true, weeklyXp: true, streak: true },
    });
    const byId = new Map(stats.map((s) => [s.id, s]));

    const computed = await Promise.all(
      challenge.entries.map(async (e) => {
        const stat = byId.get(e.userId) ?? { id: e.userId, weeklyXp: 0, streak: 0 };
        const progress = Math.max(e.progress, await progressFor(stat, challenge.metric, learnedCache, chosen));
        const achievedAt = e.achievedAt ?? (progress >= challenge.targetValue ? now : null);
        return { entry: e, progress, achievedAt };
      }),
    );

    // Persiste les nouveaux progrès/atteintes (best-effort).
    await Promise.all(
      computed
        .filter((c) => c.progress !== c.entry.progress || c.achievedAt !== c.entry.achievedAt)
        .map((c) =>
          prisma.challengeParticipant
            .update({
              where: { id: c.entry.id },
              data: { progress: c.progress, achievedAt: c.achievedAt },
            })
            .catch(() => {}),
        ),
    );

    const reached = computed.filter((c) => c.achievedAt != null);
    const allReached = reached.length === computed.length && computed.length > 0;
    const timeUp = now.getTime() >= challenge.endsAt.getTime();
    const shouldEnd = challenge.status === 'ended' || timeUp || allReached;

    let winnerIds = challenge.winnerIds;
    if (shouldEnd && winnerIds.length === 0 && reached.length > 0) {
      const earliest = Math.min(...reached.map((c) => c.achievedAt!.getTime()));
      winnerIds = reached.filter((c) => c.achievedAt!.getTime() === earliest).map((c) => c.entry.userId);
    }

    if (shouldEnd && (challenge.status !== 'ended' || challenge.winnerIds.length === 0)) {
      await friendsRepository
        .updateChallenge(challenge.id, { status: 'ended', winnerIds })
        .catch(() => {});
    }

    const participants: ChallengeParticipantView[] = computed
      .map((c) => ({
        user: c.entry.user,
        progress: c.progress,
        achieved: c.achievedAt != null,
        isMe: c.entry.userId === meId,
      }))
      .sort((a, b) => b.progress - a.progress);

    return {
      id: challenge.id,
      title: challenge.title,
      metric: challenge.metric,
      targetValue: challenge.targetValue,
      ...(challenge.sourateNumeros?.length ? { sourateNumeros: challenge.sourateNumeros } : {}),
      startsAt: challenge.startsAt.toISOString(),
      endsAt: challenge.endsAt.toISOString(),
      status: shouldEnd ? 'ended' : 'active',
      creator: challenge.creator,
      isCreator: challenge.creatorId === meId,
      participants,
      winnerIds,
    };
  },

  /** Retire `blockedId` des défis créés par `blockerId` (et réciproquement). */
  async removeAcrossBlocks(blockerId: string, blockedId: string): Promise<void> {
    await Promise.all([
      prisma.challengeParticipant.deleteMany({
        where: { userId: blockedId, challenge: { creatorId: blockerId } },
      }),
      prisma.challengeParticipant.deleteMany({
        where: { userId: blockerId, challenge: { creatorId: blockedId } },
      }),
    ]);
  },
};
