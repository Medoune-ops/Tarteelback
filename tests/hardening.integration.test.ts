import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

async function makeLesson() {
  const section = await prisma.section.create({
    data: { ordre: Math.floor(Math.random() * 1e9), kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000', degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x' },
  });
  const lesson = await prisma.lesson.create({ data: { sectionId: section.id, ordre: 1, titre: 'L' } });
  const written = await prisma.lessonStep.create({
    data: { lessonId: lesson.id, ordre: 1, type: 'written', payload: { consigne: '?', arabe: 'x', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], bonneReponse: 'A' } },
  });
  return { lesson, written };
}

d('hardening: anti-farm & idempotence (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('/complete is idempotent — XP credited only on the FIRST completion', async () => {
    const u = await registerUser(app);
    const { lesson } = await makeLesson();

    // 1 test step, correctCount=1 -> XP = 15 + 1×2 = 17.
    const payload = { correctCount: 1, totalTests: 1 };
    const first = await app.inject({ method: 'POST', url: `/lessons/${lesson.id}/complete`, headers: authHeader(u.accessToken), payload });
    expect(first.json().xpGained).toBe(17);
    expect(first.json().totalXp).toBe(17);

    // Replaying complete 5× must NOT add more XP.
    for (let i = 0; i < 5; i++) {
      const again = await app.inject({ method: 'POST', url: `/lessons/${lesson.id}/complete`, headers: authHeader(u.accessToken), payload });
      expect(again.json().xpGained).toBe(0);
      expect(again.json().alreadyCompleted).toBe(true);
    }
    const me = await app.inject({ method: 'GET', url: '/me', headers: authHeader(u.accessToken) });
    expect(me.json().user.xp).toBe(17); // never farmed past the first completion
    expect(me.json().user.streak).toBe(1);
  });

  it('concurrent wrong answers each remove exactly one heart (no lost update)', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();

    // Fire 3 wrong answers in parallel.
    const calls = Array.from({ length: 3 }, () =>
      app.inject({ method: 'POST', url: `/lessons/${lesson.id}/steps/${written.id}/answer`, headers: authHeader(u.accessToken), payload: { optionId: 'B' } }),
    );
    await Promise.all(calls);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(fresh.hearts).toBe(2); // 5 - 3, not 4 (would be a lost update)
  });
});

d('hardening: timezone & repair-streak (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('rejects an invalid timezone instead of bricking the account', async () => {
    const u = await registerUser(app);
    const bad = await app.inject({
      method: 'PATCH', url: '/me', headers: authHeader(u.accessToken),
      payload: { timezone: 'Mars/Phobos' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');

    // The account still works (GET /me does not 500).
    const me = await app.inject({ method: 'GET', url: '/me', headers: authHeader(u.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.timezone).toBe('UTC'); // unchanged default
  });

  it('repair-streak restores the streak and does not re-break on next /me', async () => {
    const u = await registerUser(app);
    await prisma.user.update({
      where: { id: u.userId },
      // Broken streak from 3 days ago.
      data: { streak: 0, lastStreakValue: 12, lastActivityDate: new Date(Date.now() - 3 * 86400000) },
    });

    const repair = await app.inject({ method: 'POST', url: '/billing/repair-streak', headers: authHeader(u.accessToken) });
    expect(repair.json().streak).toBe(12);

    // Next app-open must NOT re-break the streak the user just paid for.
    const me = await app.inject({ method: 'GET', url: '/me', headers: authHeader(u.accessToken) });
    expect(me.json().user.streak).toBe(12);
  });
});

d('hardening: readiness & Prisma error mapping (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('/ready reports DB connectivity', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ready');
  });

  it('duplicate email returns 409 EMAIL_TAKEN (not a 500)', async () => {
    await registerUser(app, { email: 'dup-h@test.app' });
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email: 'dup-h@test.app', password: 'password123', displayName: 'X', deviceId: 'd' },
    });
    expect(res.statusCode).toBe(409);
  });
});
