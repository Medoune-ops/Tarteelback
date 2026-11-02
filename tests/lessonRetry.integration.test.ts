import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { lessonService } from '../src/modules/lessons/lesson.service.js';
import { purgeLessonAnswerReceipts } from '../src/jobs/maintenance.js';

vi.mock('../src/modules/lessons/asr.client.js', () => ({
  transcribeAudio: vi.fn(async () => 'mauvaise récitation'),
}));
import { transcribeAudio } from '../src/modules/lessons/asr.client.js';

const d = DB_TESTS ? describe : describe.skip;

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
    data: {
      lessonId: lesson.id, ordre: 2, type: 'voice',
      payload: { arabe: 'بسم الله', translitteration: '', traduction: '', seuilReussite: 70 },
    },
  });
  return { lesson, written, voice };
}

d('renvoi d\'une réponse après une coupure réseau (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); vi.mocked(transcribeAudio).mockClear(); });

  const answer = (token: string, lessonId: string, stepId: string, optionId: string, key?: string) =>
    app.inject({
      method: 'POST',
      url: `/lessons/${lessonId}/steps/${stepId}/answer`,
      headers: { ...authHeader(token), ...(key ? { 'idempotency-key': key } : {}) },
      payload: { optionId },
    });

  it('une mauvaise réponse renvoyée avec la même clé ne coûte qu\'un cœur', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();

    const first = await answer(u.accessToken, lesson.id, written.id, 'B', 'attempt-1-abc');
    const resent = await answer(u.accessToken, lesson.id, written.id, 'B', 'attempt-1-abc');

    expect(first.json()).toMatchObject({ correct: false, heartsLeft: 4, bonneReponse: 'A' });
    expect(resent.statusCode).toBe(200);
    expect(resent.json()).toMatchObject({ correct: false, heartsLeft: 4, bonneReponse: 'A' });
  });

  it('deux envois simultanés avec la même clé ne coûtent qu\'un cœur', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();

    const all = await Promise.all(
      Array.from({ length: 5 }, () => answer(u.accessToken, lesson.id, written.id, 'B', 'attempt-race-1')),
    );

    expect(all.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(all.every((r) => r.json().correct === false)).toBe(true);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(fresh.hearts).toBe(4);
  });

  it('le renvoi récupère son verdict même si la réponse perdue a coûté le dernier cœur', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();
    await prisma.user.update({
      where: { id: u.userId },
      data: { hearts: 1, lastHeartLossAt: new Date() },
    });

    await answer(u.accessToken, lesson.id, written.id, 'B', 'attempt-last-heart');
    const resent = await answer(u.accessToken, lesson.id, written.id, 'B', 'attempt-last-heart');

    expect(resent.statusCode).toBe(200);
    expect(resent.json()).toMatchObject({ correct: false, heartsLeft: 0, outOfHearts: true });

    // Une VRAIE nouvelle réponse reste bloquée à 0 cœur.
    const other = await answer(u.accessToken, lesson.id, written.id, 'A', 'attempt-other-answer');
    expect(other.statusCode).toBe(403);
    expect(other.json().error.code).toBe('OUT_OF_HEARTS');
  });

  it('une clé différente est une nouvelle réponse, et sans clé rien ne change', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();

    await answer(u.accessToken, lesson.id, written.id, 'B', 'attempt-key-one');
    const otherKey = await answer(u.accessToken, lesson.id, written.id, 'B', 'attempt-key-two');
    expect(otherKey.json().heartsLeft).toBe(3);

    const noKey1 = await answer(u.accessToken, lesson.id, written.id, 'B');
    const noKey2 = await answer(u.accessToken, lesson.id, written.id, 'B');
    expect(noKey1.json().heartsLeft).toBe(2);
    expect(noKey2.json().heartsLeft).toBe(1);
  });

  it('la clé est propre à chaque utilisateur et à chaque étape', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const { lesson, written } = await makeLesson();

    await answer(a.accessToken, lesson.id, written.id, 'B', 'attempt-shared-key');
    const other = await answer(b.accessToken, lesson.id, written.id, 'A', 'attempt-shared-key');
    expect(other.json()).toMatchObject({ correct: true, heartsLeft: 5 });
  });

  it('refuse une clé mal formée', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();
    const res = await answer(u.accessToken, lesson.id, written.id, 'B', 'x y');
    expect(res.statusCode).toBe(400);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(fresh.hearts).toBe(5);
  });

  it('récitation renvoyée : verdict rejoué, un seul cœur, pas de 2e transcription', async () => {
    const u = await registerUser(app);
    const { lesson, voice } = await makeLesson();
    const send = () => lessonService.answerVoice(
      u.userId, lesson.id, voice.id, Buffer.from('audio'), 'r.m4a', 'audio/m4a', 'attempt-voice-1',
    );

    const first = await send();
    const resent = await send();

    expect(first).toMatchObject({ correct: false, heartsLeft: 4 });
    expect(resent).toMatchObject({
      correct: false, heartsLeft: 4, score: first.score, transcription: 'mauvaise récitation',
    });
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
  });

  it('une panne de l\'ASR ne consomme ni la clé ni un cœur', async () => {
    const u = await registerUser(app);
    const { lesson, voice } = await makeLesson();
    vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('ASR down'));
    const send = () => lessonService.answerVoice(
      u.userId, lesson.id, voice.id, Buffer.from('audio'), 'r.m4a', 'audio/m4a', 'attempt-voice-2',
    );

    await expect(send()).rejects.toThrow('ASR down');
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(fresh.hearts).toBe(5);

    await expect(send()).resolves.toMatchObject({ correct: false, heartsLeft: 4 });
  });

  it('la complétion rejouée au retour du réseau ne crédite l\'XP qu\'une fois', async () => {
    const u = await registerUser(app);
    const { lesson } = await makeLesson();
    const complete = () => app.inject({
      method: 'POST', url: '/lesson/complete',
      headers: authHeader(u.accessToken),
      payload: { lessonId: lesson.id, correctAnswers: 2, totalAnswers: 2 },
    });

    const first = await complete();
    const replay = await complete();

    expect(first.json().xpGained).toBe(19);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().xpGained).toBe(0);
  });

  it('le job purge les verdicts de plus de 7 jours', async () => {
    const u = await registerUser(app);
    const { lesson, written } = await makeLesson();
    await answer(u.accessToken, lesson.id, written.id, 'B', 'attempt-recent-1');

    await purgeLessonAnswerReceipts(new Date(Date.now() + 6 * 24 * 60 * 60 * 1000));
    expect(await prisma.lessonAnswerReceipt.count()).toBe(1);

    await purgeLessonAnswerReceipts(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    expect(await prisma.lessonAnswerReceipt.count()).toBe(0);
  });
});
