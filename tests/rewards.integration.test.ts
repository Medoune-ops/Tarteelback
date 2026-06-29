import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { streakReward } from '../src/core/rewards.js';

const d = DB_TESTS ? describe : describe.skip;

d('rewards: streak goal (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('sets a goal, then claims the reward only when reached', async () => {
    const u = await registerUser(app);

    const set = await app.inject({ method: 'PUT', url: '/me/streak-goal', headers: authHeader(u.accessToken), payload: { days: 30 } });
    expect(set.json().streakGoal).toBe(30);

    // Not reached yet → claim fails.
    await prisma.user.update({ where: { id: u.userId }, data: { streak: 10 } });
    const early = await app.inject({ method: 'POST', url: '/me/streak-goal/claim', headers: authHeader(u.accessToken) });
    expect(early.statusCode).toBe(409);

    // Reach it → claim credits the (server-computed) reward and clears the goal.
    await prisma.user.update({ where: { id: u.userId }, data: { streak: 30 } });
    const claim = await app.inject({ method: 'POST', url: '/me/streak-goal/claim', headers: authHeader(u.accessToken) });
    expect(claim.json().xpGained).toBe(streakReward(30)); // 600
    expect(claim.json().streakGoal).toBeNull();

    // Second claim does nothing (goal cleared).
    const again = await app.inject({ method: 'POST', url: '/me/streak-goal/claim', headers: authHeader(u.accessToken) });
    expect(again.statusCode).toBe(409);
  });

  it('doubles the streak reward for premium', async () => {
    const u = await registerUser(app);
    await prisma.user.update({
      where: { id: u.userId },
      data: { streak: 30, streakGoal: 30, isPremium: true, premiumUntil: new Date(Date.now() + 86400000) },
    });
    const claim = await app.inject({ method: 'POST', url: '/me/streak-goal/claim', headers: authHeader(u.accessToken) });
    expect(claim.json().xpGained).toBe(streakReward(30) * 2); // 1200
  });
});

d('rewards: podiums (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('lists podiums and claims a reward exactly once', async () => {
    const u = await registerUser(app);
    await prisma.podiumReward.create({
      data: { userId: u.userId, ref: 'w23', semaine: 23, ligue: 'Or', rang: 2, xp: 1250, reward: 300 },
    });

    const list = await app.inject({ method: 'GET', url: '/me/podiums', headers: authHeader(u.accessToken) });
    expect(list.json().podiums).toHaveLength(1);
    expect(list.json().podiums[0]).toMatchObject({ id: 'w23', rang: 2, claimed: false });

    const claim = await app.inject({ method: 'POST', url: '/me/podiums/w23/claim', headers: authHeader(u.accessToken) });
    expect(claim.json().xpGained).toBe(300);

    // Second claim is rejected.
    const again = await app.inject({ method: 'POST', url: '/me/podiums/w23/claim', headers: authHeader(u.accessToken) });
    expect(again.statusCode).toBe(409);

    const me = await app.inject({ method: 'GET', url: '/me', headers: authHeader(u.accessToken) });
    expect(me.json().user.xp).toBe(300);
  });

  it("cannot claim another user's podium", async () => {
    const a = await registerUser(app, { email: 'pa@test.app' });
    const b = await registerUser(app, { email: 'pb@test.app' });
    await prisma.podiumReward.create({ data: { userId: a.userId, ref: 'w9', semaine: 9, ligue: 'Or', rang: 1, xp: 1500, reward: 500 } });

    // B tries to claim A's podium ref → not found for B.
    const res = await app.inject({ method: 'POST', url: '/me/podiums/w9/claim', headers: authHeader(b.accessToken) });
    expect(res.statusCode).toBe(404);
  });
});

d('rewards: daily chest (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('can be opened once per local day', async () => {
    const u = await registerUser(app);

    const status1 = await app.inject({ method: 'GET', url: '/me/daily-chest', headers: authHeader(u.accessToken) });
    expect(status1.json().available).toBe(true);

    const open = await app.inject({ method: 'POST', url: '/me/daily-chest/claim', headers: authHeader(u.accessToken) });
    expect(open.statusCode).toBe(200);
    expect(['xp', 'hearts']).toContain(open.json().reward.type);

    const status2 = await app.inject({ method: 'GET', url: '/me/daily-chest', headers: authHeader(u.accessToken) });
    expect(status2.json().available).toBe(false);

    // Second open the same day → rejected.
    const open2 = await app.inject({ method: 'POST', url: '/me/daily-chest/claim', headers: authHeader(u.accessToken) });
    expect(open2.statusCode).toBe(409);
  });
});
