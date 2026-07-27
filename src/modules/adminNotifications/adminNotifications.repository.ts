import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

const segmentWhere: Record<'all' | 'premium' | 'free', Prisma.DeviceTokenWhereInput> = {
  all: {},
  premium: { user: { isPremium: true } },
  free: { user: { isPremium: false } },
};

export const adminNotificationsRepository = {
  /** Active device tokens for every user in the given audience segment. */
  async activeTokensForAudience(audience: 'all' | 'premium' | 'free') {
    const rows = await prisma.deviceToken.findMany({
      where: { disabledAt: null, ...segmentWhere[audience] },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  },

  disableTokens(tokens: string[]) {
    if (tokens.length === 0) return Promise.resolve({ count: 0 });
    return prisma.deviceToken.updateMany({
      where: { token: { in: tokens } },
      data: { disabledAt: new Date() },
    });
  },
};
