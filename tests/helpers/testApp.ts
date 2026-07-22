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

/**
 * Garde-fou anti-catastrophe : `resetDb()` fait un TRUNCATE CASCADE sur
 * quasiment toutes les tables. Ça a DÉJÀ vidé la base de PRODUCTION deux fois
 * (DATABASE_URL du .env local pointait sur le VPS de prod pendant un
 * RUN_DB_TESTS=1) — voir l'incident du 2026-07-21. On refuse désormais de
 * truncate quoi que ce soit si l'host de DATABASE_URL ne ressemble pas
 * explicitement à un environnement de test/local.
 */
function assertSafeTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // URL non parseable : on ne prend aucun risque, on bloque aussi.
  }
  const looksSafe = /^(localhost|127\.0\.0\.1|::1)$/.test(host) || /test/i.test(host);
  if (!looksSafe) {
    throw new Error(
      `resetDb() refuse de TRUNCATE : DATABASE_URL pointe vers un host qui ne ressemble pas à ` +
        `un environnement de test/local ("${host}"). Si c'est vraiment une base de test, ` +
        `renomme son host pour inclure "test", ou utilise localhost/127.0.0.1 (docker compose).`,
    );
  }
}

/** Truncate all data tables between tests (fast, FK-safe). */
export async function resetDb() {
  assertSafeTestDatabase();
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
