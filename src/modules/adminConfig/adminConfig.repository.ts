import { prisma } from '../../config/prisma.js';
import type { UpdateConfigBody } from './adminConfig.schemas.js';

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

  /** Partial update: only the fields present in `data` (from Zod, always
   *  plain values, never Prisma's `{ increment }`-style operators). */
  async update(data: UpdateConfigBody) {
    return prisma.appConfig.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
  },
};
