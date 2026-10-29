import type { AchievementReactionKind } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { requireFriendsEnabled } from '../friends/friends.guard.js';
import { prisma } from '../../config/prisma.js';
import { readAvatarStyle } from '../../core/avatar.js';

/** Amis acceptés de `userId`, sans les comptes bannis ni les blocages (dans un sens ou l'autre). */
async function visibleFriendIds(userId: string): Promise<string[]> {
  const [friendships, blocks] = await Promise.all([
    prisma.friendship.findMany({
      where: { status: 'accepted', OR: [{ userLowId: userId }, { userHighId: userId }] },
      select: { userLowId: true, userHighId: true },
    }),
    prisma.userBlock.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    }),
  ]);
  const blocked = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
  return friendships
    .map((f) => (f.userLowId === userId ? f.userHighId : f.userLowId))
    .filter((id) => !blocked.has(id));
}

/**
 * Une réussite est visible par `viewerId` si c'est la sienne, ou si son auteur
 * est un ami (non bloqué, non banni) qui partage ses réussites
 * (friendsVisibility = friends). Sinon : 404, sans révéler qu'elle existe.
 */
async function assertCanSee(viewerId: string, achievementId: string) {
  const achievement = await prisma.achievement.findUnique({
    where: { id: achievementId },
    select: { id: true, userId: true, user: { select: { friendsVisibility: true, bannedAt: true } } },
  });
  if (!achievement) throw new AppError('NOT_FOUND', 'Achievement not found');
  if (achievement.userId === viewerId) return achievement;
  const friends = await visibleFriendIds(viewerId);
  const visible =
    friends.includes(achievement.userId) &&
    achievement.user.friendsVisibility === 'friends' &&
    !achievement.user.bannedAt;
  if (!visible) throw new AppError('NOT_FOUND', 'Achievement not found');
  return achievement;
}

export const achievementsService = {
  async list(userId: string, since?: string) {
    requireFriendsEnabled(userId);

    const achievements = await prisma.achievement.findMany({
      where: { userId, ...(since ? { createdAt: { gt: new Date(since) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { _count: { select: { reactions: true } } },
    });

    return {
      items: achievements.map((a) => ({
        id: a.id,
        type: a.type,
        refKey: a.refKey,
        payload: a.payload,
        createdAt: a.createdAt,
        reactionsCount: a._count.reactions,
      })),
    };
  },

  /**
   * Fil d'activité : réussites de mes amis qui partagent les leurs
   * (friendsVisibility = friends), hors blocages et comptes bannis.
   */
  async feed(userId: string, since?: string) {
    requireFriendsEnabled(userId);

    const friendIds = await visibleFriendIds(userId);
    if (friendIds.length === 0) return { items: [] };

    const achievements = await prisma.achievement.findMany({
      where: {
        userId: { in: friendIds },
        user: { friendsVisibility: 'friends', bannedAt: null },
        ...(since ? { createdAt: { gt: new Date(since) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, displayName: true, username: true, avatarInitials: true, avatarStyle: true } },
        _count: { select: { reactions: true } },
      },
    });

    const ids = achievements.map((a) => a.id);
    const myReactions = ids.length
      ? await prisma.achievementReaction.findMany({
          where: { achievementId: { in: ids }, userId },
          select: { achievementId: true, kind: true },
        })
      : [];
    const mine = new Map(myReactions.map((r) => [r.achievementId, r.kind]));

    return {
      items: achievements.map((a) => ({
        id: a.id,
        type: a.type,
        refKey: a.refKey,
        payload: a.payload,
        createdAt: a.createdAt,
        user: { ...a.user, avatarStyle: readAvatarStyle(a.user.avatarStyle) },
        reactionsCount: a._count.reactions,
        myReaction: mine.get(a.id) ?? null,
      })),
    };
  },

  /** Réagir (PUT) : crée ou remplace ma réaction. */
  async react(userId: string, achievementId: string, kind: AchievementReactionKind) {
    requireFriendsEnabled(userId);
    await assertCanSee(userId, achievementId);
    await prisma.achievementReaction.upsert({
      where: { achievementId_userId: { achievementId, userId } },
      create: { achievementId, userId, kind },
      update: { kind },
    });
    return { reacted: true, kind };
  },

  /** Retirer ma réaction (sans erreur si je n'en avais pas). */
  async unreact(userId: string, achievementId: string) {
    requireFriendsEnabled(userId);
    await assertCanSee(userId, achievementId);
    await prisma.achievementReaction.deleteMany({ where: { achievementId, userId } });
    return { reacted: false };
  },
};
