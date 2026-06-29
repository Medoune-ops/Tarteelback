import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { redis, hasRedis } from '../src/config/redis.js';
import { bumpContentVersion, cached } from '../src/core/cache.js';
import { withLock } from '../src/core/lock.js';

// These tests exercise the Redis layer; they're skipped unless both Postgres
// (RUN_DB_TESTS) and Redis are available.
const d = DB_TESTS && hasRedis ? describe : describe.skip;

d('redis: content cache (integration)', () => {
  beforeEach(async () => {
    if (redis) await redis.flushdb();
  });

  it('serves a second call from cache, and bumping the version misses again', async () => {
    let loads = 0;
    const loader = async () => {
      loads++;
      return { value: loads };
    };

    const a = await cached('test-key', loader);
    const b = await cached('test-key', loader);
    expect(a).toEqual(b);
    expect(loads).toBe(1); // second call hit the cache

    await bumpContentVersion();
    const c = await cached('test-key', loader);
    expect(loads).toBe(2); // version bump invalidated -> loader ran again
    expect(c.value).toBe(2);
  });
});

d('redis: distributed lock (integration)', () => {
  beforeEach(async () => {
    if (redis) await redis.flushdb();
  });

  it('only one holder runs the critical section at a time', async () => {
    let ran = 0;
    const slow = () =>
      withLock('test-lock', 5000, async () => {
        ran++;
        await new Promise((r) => setTimeout(r, 150));
        return 'done';
      });

    const [r1, r2] = await Promise.all([slow(), slow()]);
    // Exactly one acquired the lock; the other returned null.
    expect([r1, r2].filter((x) => x === 'done')).toHaveLength(1);
    expect([r1, r2].filter((x) => x === null)).toHaveLength(1);
    expect(ran).toBe(1);
  });
});

d('redis: league ranking via sorted sets (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await resetDb();
    if (redis) await redis.flushdb();
  });

  async function currentWeek() {
    const league = await prisma.league.create({ data: { nom: 'Or', niveau: 3, ordre: 1 } });
    const now = new Date();
    return prisma.leagueWeek.create({
      data: {
        leagueId: league.id, numeroSemaine: 1,
        dateDebut: new Date(now.getTime() - 86400000),
        dateFin: new Date(now.getTime() + 6 * 86400000),
      },
    });
  }

  it('rank/podium come from Redis after lesson XP flows in', async () => {
    const week = await currentWeek();
    const me = await registerUser(app);

    // Two opponents seeded straight into the sorted set + DB.
    const mk = async (name: string, xp: number) => {
      const u = await prisma.user.create({ data: { email: `${name}@r.app`, displayName: name, weeklyXp: xp } });
      await prisma.leagueMembership.create({ data: { userId: u.id, leagueWeekId: week.id, weeklyXp: xp } });
      if (redis) await redis.zadd(`league:rank:${week.id}`, xp, u.id);
    };
    await mk('Alpha', 1000);
    await mk('Beta', 50);

    await app.inject({ method: 'POST', url: '/leagues/join', headers: authHeader(me.accessToken) });

    // Build a lesson and complete it → +20 XP mirrored into Redis.
    const section = await prisma.section.create({
      data: { ordre: 1, kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000', degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x' },
    });
    const lesson = await prisma.lesson.create({ data: { sectionId: section.id, ordre: 1, titre: 'L' } });
    await app.inject({ method: 'POST', url: `/lessons/${lesson.id}/complete`, headers: authHeader(me.accessToken), payload: {} });

    // Lesson has no test steps → XP = 15 base, mirrored into the sorted set.
    if (redis) {
      const score = await redis.zscore(`league:rank:${week.id}`, me.userId);
      expect(Number(score)).toBe(15);
    }

    const res = await app.inject({ method: 'GET', url: '/leagues/me', headers: authHeader(me.accessToken) });
    const body = res.json();
    // Alpha(1000) > Beta(50) > me(15) → me is rank 3.
    expect(body.participants).toBe(3);
    expect(body.podium[0].weeklyXp).toBe(1000);
    expect(body.myRank).toBe(3);
  });
});
