import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { HEART_REGEN_MS } from '../src/core/hearts.js';

const d = DB_TESTS ? describe : describe.skip;

/** Build a minimal section + lesson with one written + one voice step. */
async function makeLesson() {
  const section = await prisma.section.create({
    data: {
      ordre: Math.floor(Math.random() * 1e9),
      kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000',
      degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
    },
  });
  const lesson = await prisma.lesson.create({
    data: { sectionId: section.id, ordre: 1, titre: 'Test lesson' },
  });
  const written = await prisma.lessonStep.create({
    data: {
      lessonId: lesson.id, ordre: 1, type: 'written',
      payload: { consigne: '?', arabe: 'x', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], bonneReponse: 'A' },
    },
  });
  const voice = await prisma.lessonStep.create({
    data: { lessonId: lesson.id, ordre: 2, type: 'voice', payload: { arabe: 'x', translitteration: '', traduction: '', seuilReussite: 70 } },
  });
  return { lesson, written, voice };
}

d('lesson engine, hearts & premium (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('does not expose the answer key in GET /lessons/:id', async () => {
    const { lesson } = await makeLesson();
    const res = await app.inject({ method: 'GET', url: `/lessons/${lesson.id}` });
    expect(res.statusCode).toBe(200);
    const steps = res.json().lesson.steps;
    expect(JSON.stringify(steps)).not.toContain('bonneReponse');
  });

  it('wrong written answer costs a heart; correct does not', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();

    const wrong = await app.inject({
      method: 'POST', url: `/lessons/${lesson.id}/steps/${written.id}/answer`,
      headers: authHeader(u.accessToken), payload: { optionId: 'B' },
    });
    // The correct option id is revealed AFTER answering, for the green feedback.
    expect(wrong.json()).toMatchObject({ correct: false, heartsLeft: 4, bonneReponse: 'A' });

    const right = await app.inject({
      method: 'POST', url: `/lessons/${lesson.id}/steps/${written.id}/answer`,
      headers: authHeader(u.accessToken), payload: { optionId: 'A' },
    });
    expect(right.json()).toMatchObject({ correct: true, heartsLeft: 4, bonneReponse: 'A' });
  });

  it('voice step is lenient and never costs a heart (untrusted client score)', async () => {
    const u = await registerUser(app);
    const { lesson, voice } = await makeLesson();
    const pass = await app.inject({
      method: 'POST', url: `/lessons/${lesson.id}/steps/${voice.id}/answer`,
      headers: authHeader(u.accessToken), payload: { score: 70 },
    });
    expect(pass.json().correct).toBe(true);
    expect(pass.json().heartsLeft).toBe(5);

    // Even a clearly-failing voice score must NOT deduct a heart.
    const fail = await app.inject({
      method: 'POST', url: `/lessons/${lesson.id}/steps/${voice.id}/answer`,
      headers: authHeader(u.accessToken), payload: { score: 50 },
    });
    expect(fail.json().correct).toBe(false);
    expect(fail.json().heartsLeft).toBe(5);
  });

  it('blocks at 0 hearts with OUT_OF_HEARTS', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();
    // Drain to 0 with 5 wrong answers.
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST', url: `/lessons/${lesson.id}/steps/${written.id}/answer`,
        headers: authHeader(u.accessToken), payload: { optionId: 'B' },
      });
    }
    const blocked = await app.inject({
      method: 'POST', url: `/lessons/${lesson.id}/steps/${written.id}/answer`,
      headers: authHeader(u.accessToken), payload: { optionId: 'A' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('OUT_OF_HEARTS');
  });

  it('regenerates 1 heart after 4h (via lastHeartLossAt)', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();
    // Lose one heart.
    await app.inject({
      method: 'POST', url: `/lessons/${lesson.id}/steps/${written.id}/answer`,
      headers: authHeader(u.accessToken), payload: { optionId: 'B' },
    });
    // Backdate the loss by just over 4h.
    await prisma.user.update({
      where: { id: u.userId },
      data: { lastHeartLossAt: new Date(Date.now() - HEART_REGEN_MS - 1000) },
    });
    const sync = await app.inject({ method: 'POST', url: '/me/hearts/sync', headers: authHeader(u.accessToken) });
    expect(sync.json().hearts).toBe(5);
  });

  it('premium: unlimited hearts and doubled XP', async () => {
    const u = await registerUser(app);
    await prisma.user.update({
      where: { id: u.userId },
      data: { isPremium: true, premiumUntil: new Date(Date.now() + 86400000) },
    });
    const { lesson, written } = await makeLesson();

    // Wrong answers never reduce hearts.
    const wrong = await app.inject({
      method: 'POST', url: `/lessons/${lesson.id}/steps/${written.id}/answer`,
      headers: authHeader(u.accessToken), payload: { optionId: 'B' },
    });
    expect(wrong.json().unlimited).toBe(true);
    expect(wrong.json().heartsLeft).toBe(5);

    // XP = (15 + correctCount×2), doubled for premium. correctCount=2 -> 19 -> 38.
    const done = await app.inject({
      method: 'POST', url: `/lessons/${lesson.id}/complete`,
      headers: authHeader(u.accessToken), payload: { correctCount: 2, totalTests: 2 },
    });
    expect(done.json().xpGained).toBe(38);
  });

  it('completing a lesson awards XP (15 + correctCount×2) and starts the streak', async () => {
    const u = await registerUser(app);
    const { lesson } = await makeLesson();
    const done = await app.inject({
      method: 'POST', url: `/lessons/${lesson.id}/complete`,
      headers: authHeader(u.accessToken), payload: { correctCount: 2, totalTests: 2 },
    });
    expect(done.json().xpGained).toBe(19); // 15 + 2×2
    expect(done.json().streak).toBe(1);
  });
});
