import { PrismaClient } from '@prisma/client';
import { isProd } from './env.js';

/**
 * Single shared Prisma client. In dev with tsx-watch we cache it on globalThis
 * so hot reloads don't open a new pool each time.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;
