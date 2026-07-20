import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

const segmentWhere: Record<'all' | 'premium' | 'free' | 'banned', Prisma.UserWhereInput> = {
  all: {},
  premium: { isPremium: true },
  free: { isPremium: false },
  banned: { bannedAt: { not: null } },
};

export const adminGiftsRepository = {
  /** Resolves a segment to the live list of matching user ids. */
  idsForSegment(segment: 'all' | 'premium' | 'free' | 'banned') {
    return prisma.user
      .findMany({ where: segmentWhere[segment], select: { id: true } })
      .then((rows) => rows.map((r) => r.id));
  },

  /** Filters an explicit id list down to ids that actually exist, to skip silently on typos/stale ids. */
  async existingIds(userIds: string[]) {
    const rows = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } });
    return rows.map((r) => r.id);
  },
};
