import { AppError } from '../../core/errors.js';
import { requireFriendsEnabled } from '../friends/friends.guard.js';
import { prisma } from '../../config/prisma.js';

export const achievementsService = {
  async list(userId: string, since?: string) {
    requireFriendsEnabled(userId);

    const where: any = { userId };
    if (since) {
      where.createdAt = { gt: new Date(since) };
    }

    const achievements = await prisma.achievement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      items: achievements.map((a) => ({
        id: a.id,
        type: a.type,
        refKey: a.refKey,
        payload: a.payload,
        createdAt: a.createdAt,
      })),
    };
  },

  async feed(userId: string, since?: string) {
    requireFriendsEnabled(userId);

    // Récupérer les amis acceptés (les deux sens de la relation Friendship).
    const friendships = await prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ userLowId: userId }, { userHighId: userId }],
      },
      select: {
        userLowId: true,
        userHighId: true,
      },
    });

    const friendIds = friendships.map((f) =>
      f.userLowId === userId ? f.userHighId : f.userLowId,
    );

    // Si aucun ami, retourne un fil vide.
    if (friendIds.length === 0) {
      return {
        items: [],
      };
    }

    const where: any = {
      userId: { in: friendIds },
    };
    if (since) {
      where.createdAt = { gt: new Date(since) };
    }

    const achievements = await prisma.achievement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarInitials: true,
          },
        },
      },
    });

    // Récupérer les réactions de l'utilisateur connecté sur ces réussites.
    const achievementIds = achievements.map((a) => a.id);
    const myReactions = achievementIds.length > 0
      ? (await prisma.achievementReaction.findMany({
          where: {
            achievementId: { in: achievementIds },
            userId,
          },
          select: { achievementId: true, kind: true },
        }))
      : [];

    const myReactionByAchievementId = new Map(
      myReactions.map((r) => [r.achievementId, r.kind]),
    );

    return {
      items: achievements.map((a) => ({
        id: a.id,
        type: a.type,
        refKey: a.refKey,
        payload: a.payload,
        createdAt: a.createdAt,
        user: {
          id: a.user.id,
          displayName: a.user.displayName,
          username: a.user.username,
          avatarInitials: a.user.avatarInitials,
        },
        myReaction: myReactionByAchievementId.get(a.id) ?? null,
      })),
    };
  },

  async react(userId: string, achievementId: string, kind: string) {
    requireFriendsEnabled(userId);

    const achievement = await prisma.achievement.findUnique({
      where: { id: achievementId },
      select: { id: true, userId: true },
    });
    if (!achievement) throw new AppError('NOT_FOUND', 'Achievement not found');

    const existing = await prisma.achievementReaction.findUnique({
      where: { achievementId_userId: { achievementId, userId } },
    });
    if (existing) throw new AppError('ALREADY_FRIENDS', 'Already reacted');

    await prisma.achievementReaction.create({
      data: {
        achievementId,
        userId,
        kind,
      },
    });

    return { reacted: true, kind };
  },

  async unreact(userId: string, achievementId: string) {
    requireFriendsEnabled(userId);

    const achievement = await prisma.achievement.findUnique({
      where: { id: achievementId },
      select: { id: true },
    });
    if (!achievement) throw new AppError('NOT_FOUND', 'Achievement not found');

    await prisma.achievementReaction.delete({
      where: { achievementId_userId: { achievementId, userId } },
    });

    return { reacted: false };
  },
};
