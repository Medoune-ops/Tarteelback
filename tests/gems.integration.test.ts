import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { MAX_HEARTS } from '../src/core/hearts.js';
import {
  GEM_COST_HEART_REFILL,
  GEM_COST_STREAK_FREEZE,
  GEM_COST_DOUBLE_XP,
  MAX_STREAK_FREEZES,
} from '../src/core/gems.js';

const d = DB_TESTS ? describe : describe.skip;

d('gems: balance & packs (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('starts at 0 and credits a bought pack with a ledger row', async () => {
    const u = await registerUser(app);

    const before = await app.inject({ method: 'GET', url: '/me/gems', headers: authHeader(u.accessToken) });
    expect(before.json().gems).toBe(0);

    const buy = await app.inject({ method: 'POST', url: '/billing/gems', headers: authHeader(u.accessToken), payload: { pack: 'p3000' } });
    expect(buy.statusCode).toBe(200);
    expect(buy.json().gems).toBe(3000);

    const after = await app.inject({ method: 'GET', url: '/me/gems', headers: authHeader(u.accessToken) });
    expect(after.json().gems).toBe(3000);
    expect(after.json().transactions[0]).toMatchObject({ amount: 3000, reason: 'pack_purchase' });

    // The money side is recorded too.
    const tx = await prisma.transaction.findFirst({ where: { userId: u.userId, type: 'gem_pack' } });
    expect(tx?.statut).toBe('success');
  });
});

d('gems: heart refill (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('refills to 5 hearts for 350 gems, atomically', async () => {
    const u = await registerUser(app);
    await prisma.user.update({
      where: { id: u.userId },
      data: { gems: 400, hearts: 1, lastHeartLossAt: new Date() },
    });

    const res = await app.inject({ method: 'POST', url: '/me/hearts/refill', headers: authHeader(u.accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().hearts).toBe(MAX_HEARTS);
    expect(res.json().gems).toBe(400 - GEM_COST_HEART_REFILL);
  });

  it('rejects when gems are insufficient or hearts already full', async () => {
    const u = await registerUser(app);

    // Full hearts (fresh user) → 409 even with enough gems.
    await prisma.user.update({ where: { id: u.userId }, data: { gems: 1000 } });
    const full = await app.inject({ method: 'POST', url: '/me/hearts/refill', headers: authHeader(u.accessToken) });
    expect(full.statusCode).toBe(409);

    // Not enough gems → INSUFFICIENT_GEMS.
    await prisma.user.update({
      where: { id: u.userId },
      data: { gems: 100, hearts: 0, lastHeartLossAt: new Date() },
    });
    const poor = await app.inject({ method: 'POST', url: '/me/hearts/refill', headers: authHeader(u.accessToken) });
    expect(poor.statusCode).toBe(409);
    expect(poor.json().error.code).toBe('INSUFFICIENT_GEMS');
  });
});

d('gems: review → heart gate (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  /** A `numero`'d Sourate with a SourateRevision completed just now (fresh review session). */
  async function completeReviewSession(userId: string, numero: number) {
    const sourate = await prisma.sourate.upsert({
      where: { numero },
      update: {},
      create: { numero, nom: `S${numero}`, nomArabe: `س${numero}`, nombreVersets: 7, hizb: 1 },
    });
    await prisma.sourateRevision.upsert({
      where: { userId_sourateId: { userId, sourateId: sourate.id } },
      update: { derniereRevision: new Date() },
      create: { userId, sourateId: sourate.id, derniereRevision: new Date(), prochaineRevision: new Date() },
    });
  }

  it('grants +1 heart per completed review session, max 2 per local day, free', async () => {
    const u = await registerUser(app);
    await prisma.user.update({
      where: { id: u.userId },
      data: { hearts: 0, lastHeartLossAt: new Date() },
    });

    await completeReviewSession(u.userId, 1);
    const r1 = await app.inject({
      method: 'POST', url: '/me/hearts/review-regain',
      headers: authHeader(u.accessToken), payload: { numero: 1 },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().hearts).toBe(1);
    expect(r1.json().reviewHeartsRemaining).toBe(1);

    // Replaying the SAME completed session must not grant a second heart.
    const replay = await app.inject({
      method: 'POST', url: '/me/hearts/review-regain',
      headers: authHeader(u.accessToken), payload: { numero: 1 },
    });
    expect(replay.statusCode).toBe(409);

    // A genuinely new session (different sourate) unlocks the 2nd heart.
    await completeReviewSession(u.userId, 2);
    const r2 = await app.inject({
      method: 'POST', url: '/me/hearts/review-regain',
      headers: authHeader(u.accessToken), payload: { numero: 2 },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().hearts).toBe(2);
    expect(r2.json().reviewHeartsRemaining).toBe(0);

    // Daily cap reached, even for a 3rd genuinely new session.
    await completeReviewSession(u.userId, 3);
    const r3 = await app.inject({
      method: 'POST', url: '/me/hearts/review-regain',
      headers: authHeader(u.accessToken), payload: { numero: 3 },
    });
    expect(r3.statusCode).toBe(409);
  });

  it('rejects when no recently completed review session exists for the sourate', async () => {
    const u = await registerUser(app);
    const res = await app.inject({
      method: 'POST', url: '/me/hearts/review-regain',
      headers: authHeader(u.accessToken), payload: { numero: 1 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a missing or invalid `numero`', async () => {
    const u = await registerUser(app);
    const noBody = await app.inject({
      method: 'POST', url: '/me/hearts/review-regain', headers: authHeader(u.accessToken),
    });
    expect(noBody.statusCode).toBe(400);
  });
});

d('gems: streak freezes (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('buys freezes up to the cap, consumes them instead of breaking the streak', async () => {
    const u = await registerUser(app);
    await prisma.user.update({ where: { id: u.userId }, data: { gems: 1000 } });

    const b1 = await app.inject({ method: 'POST', url: '/me/streak-freezes', headers: authHeader(u.accessToken) });
    expect(b1.json()).toMatchObject({ streakFreezes: 1, gems: 1000 - GEM_COST_STREAK_FREEZE });
    const b2 = await app.inject({ method: 'POST', url: '/me/streak-freezes', headers: authHeader(u.accessToken) });
    expect(b2.json().streakFreezes).toBe(MAX_STREAK_FREEZES);
    // Cap reached.
    const b3 = await app.inject({ method: 'POST', url: '/me/streak-freezes', headers: authHeader(u.accessToken) });
    expect(b3.statusCode).toBe(409);

    // 2 missed days beyond the grace → the 2 freezes protect the streak.
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: u.userId },
      data: { streak: 12, lastActivityDate: threeDaysAgo },
    });
    const me = await app.inject({ method: 'GET', url: '/me', headers: authHeader(u.accessToken) });
    expect(me.json().streak).toBe(12);

    const gems = await app.inject({ method: 'GET', url: '/me/gems', headers: authHeader(u.accessToken) });
    expect(gems.json().streakFreezes).toBe(0);
  });

  it('breaks the streak without freezes (and paid repair still works)', async () => {
    const u = await registerUser(app);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: u.userId },
      data: { streak: 12, lastActivityDate: threeDaysAgo },
    });

    const me = await app.inject({ method: 'GET', url: '/me', headers: authHeader(u.accessToken) });
    expect(me.json().streak).toBe(0);

    const repair = await app.inject({ method: 'POST', url: '/billing/repair-streak', headers: authHeader(u.accessToken) });
    expect(repair.json().streak).toBe(12);
  });
});

d('gems: double XP boost (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('activates for 15 minutes and rejects a second purchase while active', async () => {
    const u = await registerUser(app);
    await prisma.user.update({ where: { id: u.userId }, data: { gems: 250 } });

    const buy = await app.inject({ method: 'POST', url: '/me/boosts/double-xp', headers: authHeader(u.accessToken) });
    expect(buy.statusCode).toBe(200);
    expect(buy.json().gems).toBe(250 - GEM_COST_DOUBLE_XP);
    expect(new Date(buy.json().doubleXpUntil).getTime()).toBeGreaterThan(Date.now());

    const again = await app.inject({ method: 'POST', url: '/me/boosts/double-xp', headers: authHeader(u.accessToken) });
    expect(again.statusCode).toBe(409);
  });
});
