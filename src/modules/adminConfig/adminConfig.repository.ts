import { prisma } from '../../config/prisma.js';

const SINGLETON_ID = 'singleton';

export const adminConfigRepository = {
  /** Reads the singleton row, creating it with defaults if it doesn't exist yet. */
  async get() {
    return prisma.appConfig.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
  },

  async update(data: { paymentsEnabled?: boolean }) {
    return prisma.appConfig.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
  },
};
