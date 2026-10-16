import { prisma } from '../../config/prisma.js';

export const friendsRepository = {
  async findUserByReferralCode(code: string) {
    return prisma.user.findUnique({
      where: { referralCode: code },
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarInitials: true,
        timezone: true,
        bannedAt: true,
        friendsDiscoverable: true,
        streak: true,
        weeklyXp: true,
      },
    });
  },

  findPair(userLowId: string, userHighId: string) {
    return prisma.friendship.findUnique({
      where: { userLowId_userHighId: { userLowId, userHighId } },
    });
  },

  countAcceptedFriends(userId: string) {
    return prisma.friendship.count({
      where: { status: 'accepted', OR: [{ userLowId: userId }, { userHighId: userId }] },
    });
  },

  countPendingSent(userId: string) {
    return prisma.friendship.count({
      where: { requestedById: userId, status: 'pending' },
    });
  },

  countRecentRequests(userId: string, since: Date) {
    return prisma.friendship.count({
      where: { requestedById: userId, createdAt: { gte: since } },
    });
  },

  async listPendingReceived(userId: string) {
    return prisma.friendship.findMany({
      where: { status: 'pending', OR: [{ userLowId: userId }, { userHighId: userId }], NOT: { requestedById: userId } },
      orderBy: [{ createdAt: 'desc' }],
    });
  },

  async listPendingSent(userId: string) {
    return prisma.friendship.findMany({
      where: { requestedById: userId, status: 'pending' },
      orderBy: [{ createdAt: 'desc' }],
    });
  },

  createPending(data: { userLowId: string; userHighId: string; requestedById: string; source: 'code' }) {
    return prisma.friendship.create({
      data: { userLowId: data.userLowId, userHighId: data.userHighId, requestedById: data.requestedById, status: 'pending', source: data.source },
    });
  },

  accept(friendshipId: string) {
    return prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: 'accepted', acceptedAt: new Date() },
    });
  },

  declineOrCancel(friendshipId: string) {
    return prisma.friendship.delete({ where: { id: friendshipId } });
  },

  removeAccepted(meId: string, otherId: string) {
    const { low, high } = orderPair(meId, otherId);
    return prisma.friendship.deleteMany({
      where: { userLowId: low, userHighId: high, status: 'accepted' },
    });
  },

  async listAccepted(meId: string, cursor?: string | null, limit = 20) {
    const where = {
      status: 'accepted' as const,
      OR: [{ userLowId: meId }, { userHighId: meId }],
    };
    const rows = await prisma.friendship.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return rows;
  },

  block(blockerId: string, blockedId: string) {
    return prisma.userBlock.create({ data: { blockerId, blockedId } });
  },

  async isBlockedEither(a: string, b: string) {
    const count = await prisma.userBlock.count({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });
    return count > 0;
  },
};

function orderPair(a: string, b: string) {
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}
