import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

/** Crée une section avec `count` leçons vides (discovery-only, toujours réussies). */
async function makeSectionWithLessons(count: number, sectionOrdre?: number) {
  const section = await prisma.section.create({
    data: {
      ordre: sectionOrdre ?? Math.floor(Math.random() * 1e9),
      kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000',
      degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
    },
  });
  const lessons = [];
  for (let i = 1; i <= count; i++) {
    const lesson = await prisma.lesson.create({
      data: { sectionId: section.id, ordre: i, titre: `Leçon ${i}` },
    });
    await prisma.lessonStep.create({
      data: { lessonId: lesson.id, ordre: 1, type: 'discovery', payload: { arabe: 'x', translitteration: '', traduction: '', audioUrl: null } },
    });
    lessons.push(lesson);
  }
  return { section, lessons };
}

d('lesson order guard (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('allows completing the first lesson of a section directly', async () => {
    const u = await registerUser(app);
    const { lessons } = await makeSectionWithLessons(3);

    const res = await app.inject({
      method: 'POST', url: `/lessons/${lessons[0]!.id}/complete`,
      headers: authHeader(u.accessToken), payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects completing lesson 3 while lesson 2 is not completed yet', async () => {
    const u = await registerUser(app);
    const { lessons } = await makeSectionWithLessons(3);

    await app.inject({
      method: 'POST', url: `/lessons/${lessons[0]!.id}/complete`,
      headers: authHeader(u.accessToken), payload: {},
    });
    // Skips lesson 2 (ordre=2) straight to lesson 3.
    const skip = await app.inject({
      method: 'POST', url: `/lessons/${lessons[2]!.id}/complete`,
      headers: authHeader(u.accessToken), payload: {},
    });
    expect(skip.statusCode).toBe(403);
    expect(skip.json().error.code).toBe('LESSON_LOCKED');

    // Lesson 3 was NOT marked completed.
    const progress = await prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: u.userId, lessonId: lessons[2]!.id } },
    });
    expect(progress).toBeNull();
  });

  it('allows completing lessons strictly in order', async () => {
    const u = await registerUser(app);
    const { lessons } = await makeSectionWithLessons(3);

    for (const lesson of lessons) {
      const res = await app.inject({
        method: 'POST', url: `/lessons/${lesson.id}/complete`,
        headers: authHeader(u.accessToken), payload: {},
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('replaying an already-completed lesson stays idempotent (not blocked)', async () => {
    const u = await registerUser(app);
    const { lessons } = await makeSectionWithLessons(2);

    await app.inject({
      method: 'POST', url: `/lessons/${lessons[0]!.id}/complete`,
      headers: authHeader(u.accessToken), payload: {},
    });
    // Replay the same (already completed) lesson — must stay allowed (idempotent).
    const replay = await app.inject({
      method: 'POST', url: `/lessons/${lessons[0]!.id}/complete`,
      headers: authHeader(u.accessToken), payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().xpGained).toBe(0); // anti-farm: no XP on replay
  });

  it('requires the entire previous section to be completed before unlocking the next one', async () => {
    const u = await registerUser(app);
    const { lessons: sectionALessons } = await makeSectionWithLessons(2, 100);
    const { lessons: sectionBLessons } = await makeSectionWithLessons(2, 101);

    // Complete only the first lesson of section A, then try section B's first lesson.
    await app.inject({
      method: 'POST', url: `/lessons/${sectionALessons[0]!.id}/complete`,
      headers: authHeader(u.accessToken), payload: {},
    });
    const jumpAhead = await app.inject({
      method: 'POST', url: `/lessons/${sectionBLessons[0]!.id}/complete`,
      headers: authHeader(u.accessToken), payload: {},
    });
    expect(jumpAhead.statusCode).toBe(403);

    // Finish section A entirely -> section B's first lesson becomes allowed.
    await app.inject({
      method: 'POST', url: `/lessons/${sectionALessons[1]!.id}/complete`,
      headers: authHeader(u.accessToken), payload: {},
    });
    const nowAllowed = await app.inject({
      method: 'POST', url: `/lessons/${sectionBLessons[0]!.id}/complete`,
      headers: authHeader(u.accessToken), payload: {},
    });
    expect(nowAllowed.statusCode).toBe(200);
  });
});
