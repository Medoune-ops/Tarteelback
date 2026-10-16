import { prisma } from '../../config/prisma.js';

export const challengeRepository = {
  countOpenCreatedBy(userId: string) {
    return prisma.challenge.count({
      where: { creatorId: userId, status: { in: ['pending', 'active'] } },
    });
  },

  countCreatedToday(userId: string, since: Date) {
    return prisma.challenge.count({
      where: { creatorId: userId, createdAt: { gte: since } },
    });
  },

  findByIdWithParticipants(id: string) {
    return prisma.challenge.findUnique({
      where: { id },
      include: { participants: true },
    });
  },

  listForUser(userId: string, status?: 'active' | 'pending' | 'completed', take = 20) {
    return prisma.challenge.findMany({
      where: {
        participants: { some: { userId } },
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { participants: true },
    });
  },

  async getAcceptedFriendship(meId: string, otherId: string) {
    const low = meId <= otherId ? meId : otherId;
    const high = meId <= otherId ? otherId : meId;
    return prisma.friendship.findUnique({
      where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
    });
  },
};
