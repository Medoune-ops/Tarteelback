import { prisma } from '../../config/prisma.js';

/** Data access for device push tokens. */
export const notificationRepository = {
  /** Register or refresh a token (upsert by unique token). Re-enables it. */
  upsertToken(data: { userId: string; token: string; deviceId: string; platform?: string }) {
    return prisma.deviceToken.upsert({
      where: { token: data.token },
      create: { ...data, platform: data.platform ?? null },
      update: {
        userId: data.userId,
        deviceId: data.deviceId,
        platform: data.platform ?? null,
        disabledAt: null,
      },
    });
  },

  deleteToken(userId: string, token: string) {
    return prisma.deviceToken.deleteMany({ where: { userId, token } });
  },

  /** Active (non-disabled) tokens of a user. */
  activeTokensForUser(userId: string) {
    return prisma.deviceToken.findMany({
      where: { userId, disabledAt: null },
      select: { token: true },
    });
  },

  disableTokens(tokens: string[]) {
    if (tokens.length === 0) return Promise.resolve({ count: 0 });
    return prisma.deviceToken.updateMany({
      where: { token: { in: tokens } },
      data: { disabledAt: new Date() },
    });
  },
};
