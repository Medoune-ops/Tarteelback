/**
 * Integration test harness. These tests need a running Postgres (the DATABASE_URL
 * in .env). They are SKIPPED unless RUN_DB_TESTS=1 so `npm test` works offline.
 *
 *   docker compose up -d
 *   npx prisma migrate deploy
 *   RUN_DB_TESTS=1 npm test
 */
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';

export const DB_TESTS = process.env.RUN_DB_TESTS === '1';

/** Truncate all data tables between tests (fast, FK-safe). */
export async function resetDb() {
  const tables = [
    'GemTransaction',
    'ActivityDay',
    'Transaction',
    'LeagueMembership',
    'LeagueWeek',
    'League',
    'SourateRevision',
    'LessonProgress',
    'LessonStep',
    'Lesson',
    'SectionSourate',
    'Section',
    'VersetTraduction',
    'VersetTranslitteration',
    'Verset',
    'Sourate',
    'DeviceToken',
    'PodiumReward',
    'PasswordResetToken',
    'RefreshToken',
    'User',
  ];
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
  );
}

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

let counter = 0;
/** Register a fresh user and return its tokens + id. */
export async function registerUser(
  app: FastifyInstance,
  overrides: Partial<{ email: string; password: string; displayName: string; username: string; deviceId: string }> = {},
) {
  const email = overrides.email ?? `user${counter++}_${Date.now()}@test.app`;
  const deviceId = overrides.deviceId ?? 'device-1';
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email,
      password: overrides.password ?? 'password123',
      displayName: overrides.displayName ?? 'Test User',
      ...(overrides.username ? { username: overrides.username } : {}),
      deviceId,
    },
  });
  const body = res.json();
  return {
    email,
    deviceId,
    userId: body.user?.id as string,
    accessToken: body.accessToken as string,
    refreshToken: body.refreshToken as string,
  };
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}
