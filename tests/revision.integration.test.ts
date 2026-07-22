import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';
import { SEGMENT_SIZE } from '../src/core/revision.js';

const d = DB_TESTS ? describe : describe.skip;

/**
 * A sourate taught by ONE completed section/lesson (so `getLearnedSourates`
 * counts it as learned), with `nombreVersets` spanning 3 segments of
 * `SEGMENT_SIZE` (10) verses each: segments 0 and 1 full, segment 2 partial.
 */
async function makeLearnedSourate(userId: string, numero: number, nombreVersets = SEGMENT_SIZE * 2 + 4) {
  const sourate = await prisma.sourate.create({
    data: { numero, nom: `S${numero}`, nomArabe: `س${numero}`, nombreVersets, hizb: 1 },
  });
  const section = await prisma.section.create({
    data: {
      ordre: Math.floor(Math.random() * 1e9),
      kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000',
      degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
    },
  });
  await prisma.sectionSourate.create({ data: { sectionId: section.id, sourateId: sourate.id, ordre: 1 } });
  const lesson = await prisma.lesson.create({
    data: { sectionId: section.id, ordre: 1, titre: 'Test lesson' },
  });
  await prisma.lessonProgress.create({
    data: { userId, lessonId: lesson.id, etat: 'completed', score: 100, completedAt: new Date() },
  });
  return sourate;
}

d('revision: per-segment SRS (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('GET /me/revisions aggregates a freshly learned sourate into 3 segments', async () => {
    const u = await registerUser(app);
    const numero = 2;
    await makeLearnedSourate(u.userId, numero);

    const list = await app.inject({ method: 'GET', url: '/me/revisions', headers: authHeader(u.accessToken) });
    expect(list.statusCode).toBe(200);
    const entry = list.json().revisions.find((r: { numero: number }) => r.numero === numero);
    expect(entry).toMatchObject({ segmentsTotal: 3, segmentsDue: 3, etat: 'revoir' });

    const segments = await app.inject({
      method: 'GET', url: `/me/revisions/${numero}/segments`, headers: authHeader(u.accessToken),
    });
    expect(segments.statusCode).toBe(200);
    const body = segments.json();
    expect(body.segments).toHaveLength(3);
    expect(body.segments[0]).toMatchObject({ segmentIndex: 0, debut: 1, fin: 10, score: 0 });
    expect(body.segments[1]).toMatchObject({ segmentIndex: 1, debut: 11, fin: 20, score: 0 });
    // Last segment is partial: 24 verses total -> segment 2 covers 21..24.
    expect(body.segments[2]).toMatchObject({ segmentIndex: 2, debut: 21, fin: 24, score: 0 });
  });

  it('reviewing one segment leaves the other segments of the same sourate untouched', async () => {
    const u = await registerUser(app);
    const numero = 3;
    const sourate = await makeLearnedSourate(u.userId, numero);
    // Force-create the 3 segment rows up front (mirrors the lazy getOrCreateSegments).
    await app.inject({ method: 'GET', url: `/me/revisions/${numero}/segments`, headers: authHeader(u.accessToken) });

    const reviewed = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/segments/1/review`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json()).toMatchObject({ segmentIndex: 1, score: 15, etat: 'revoir' });

    const rows = await prisma.sourateRevision.findMany({
      where: { userId: u.userId, sourateId: sourate.id },
      orderBy: { segmentIndex: 'asc' },
    });
    expect(rows).toHaveLength(3);
    // Segment 1 changed...
    expect(rows[1]!.score).toBe(15);
    expect(rows[1]!.derniereRevision).not.toBeNull();
    // ...segments 0 and 2 are still in their untouched default state.
    expect(rows[0]!.score).toBe(0);
    expect(rows[0]!.derniereRevision).toBeNull();
    expect(rows[2]!.score).toBe(0);
    expect(rows[2]!.derniereRevision).toBeNull();

    // The aggregated list reflects the worst segment (0 and 2 are still
    // fresh/'revoir'), not just the one that was just reviewed.
    const list = await app.inject({ method: 'GET', url: '/me/revisions', headers: authHeader(u.accessToken) });
    const entry = list.json().revisions.find((r: { numero: number }) => r.numero === numero);
    expect(entry.etat).toBe('revoir');
  });

  it('a bad recall ("oublie") on one segment drags the aggregate etat down without affecting siblings', async () => {
    const u = await registerUser(app);
    const numero = 4;
    await makeLearnedSourate(u.userId, numero);
    await app.inject({ method: 'GET', url: `/me/revisions/${numero}/segments`, headers: authHeader(u.accessToken) });

    // Segment 0: solid recall.
    await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/segments/0/review`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    // Segment 2: forgotten.
    const forgot = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/segments/2/review`,
      headers: authHeader(u.accessToken), payload: { quality: 'oublie' },
    });
    expect(forgot.json()).toMatchObject({ segmentIndex: 2, score: 0, etat: 'difficile' });

    const list = await app.inject({ method: 'GET', url: '/me/revisions', headers: authHeader(u.accessToken) });
    const entry = list.json().revisions.find((r: { numero: number }) => r.numero === numero);
    // Worst segment (difficile) determines the aggregate, even though segment 0 improved.
    expect(entry.etat).toBe('difficile');
  });

  it('rejects an out-of-range segmentIndex', async () => {
    const u = await registerUser(app);
    const numero = 5;
    await makeLearnedSourate(u.userId, numero); // 24 verses -> segments 0..2 only

    const res = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/segments/3/review`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects reviewing a sourate the user has not learned', async () => {
    const u = await registerUser(app);
    const numero = 6;
    await prisma.sourate.create({
      data: { numero, nom: 'S6', nomArabe: 'س٦', nombreVersets: 12, hizb: 1 },
    });

    const res = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/segments/0/review`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    expect(res.statusCode).toBe(403);
  });
});

d('revision: chained verse recitation spans the whole sourate (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  /** Minimal multipart/form-data body with a single `audio` file field. */
  function multipartAudio() {
    const boundary = '----testboundary123';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="audio"; filename="rec.wav"',
      'Content-Type: audio/wav',
      '',
      'fake-audio-bytes',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(body),
    };
  }

  it('accepts a range crossing a segment boundary (recitation is NOT capped at 10 verses)', async () => {
    const u = await registerUser(app);
    const numero = 8;
    // 24 verses -> 3 SEGMENT_SIZE (10) blocks: 1-10, 11-20, 21-24.
    const sourate = await makeLearnedSourate(u.userId, numero, SEGMENT_SIZE * 2 + 4);
    await prisma.verset.createMany({
      data: Array.from({ length: sourate.nombreVersets }, (_, i) => ({
        sourateId: sourate.id, numero: i + 1, texteArabe: `verset ${i + 1}`,
      })),
    });

    // 8..13 straddles the segment-0/segment-1 boundary (verse 10/11): if
    // recite-range were wrongly bounded by SEGMENT_SIZE this would be
    // rejected as invalid instead of reaching the ASR call.
    const mp = multipartAudio();
    const res = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/recite-range?debut=8&fin=13`,
      headers: { ...authHeader(u.accessToken), ...mp.headers }, payload: mp.payload,
    });
    expect(res.statusCode).toBe(503); // reaches transcribeAudio(); ASR isn't configured in tests.
    expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('accepts a "from the start" range spanning the entire sourate', async () => {
    const u = await registerUser(app);
    const numero = 9;
    const sourate = await makeLearnedSourate(u.userId, numero, SEGMENT_SIZE * 2 + 4);
    await prisma.verset.createMany({
      data: Array.from({ length: sourate.nombreVersets }, (_, i) => ({
        sourateId: sourate.id, numero: i + 1, texteArabe: `verset ${i + 1}`,
      })),
    });

    const mp = multipartAudio();
    const res = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/recite-range?debut=1&fin=${sourate.nombreVersets}`,
      headers: { ...authHeader(u.accessToken), ...mp.headers }, payload: mp.payload,
    });
    expect(res.statusCode).toBe(503);
  });

  it('rejects a range beyond the sourate\'s actual verse count', async () => {
    const u = await registerUser(app);
    const numero = 10;
    const sourate = await makeLearnedSourate(u.userId, numero, SEGMENT_SIZE * 2 + 4);
    await prisma.verset.createMany({
      data: Array.from({ length: sourate.nombreVersets }, (_, i) => ({
        sourateId: sourate.id, numero: i + 1, texteArabe: `verset ${i + 1}`,
      })),
    });

    const mp = multipartAudio();
    const res = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/recite-range?debut=1&fin=${sourate.nombreVersets + 5}`,
      headers: { ...authHeader(u.accessToken), ...mp.headers }, payload: mp.payload,
    });
    expect(res.statusCode).toBe(400);
  });
});

/**
 * A sourate learned in full (like `makeLearnedSourate`) but taught by SEVERAL
 * lessons with real `versetDebut`/`versetFin` ranges — the shape the guided
 * revision (chaînage progressif) needs, unlike `makeLearnedSourate`'s single
 * lesson. Ranges default to 2,2,2,1 verses (last one solo, e.g. a long verse).
 */
/**
 * `lessonsApprises` (défaut = toutes) contrôle combien des leçons créées sont
 * marquées `completed` pour `userId` — sert à tester le plafonnement du
 * chaînage guidé par l'apprentissage RÉEL en cours (cf. countLearnedChainLessons),
 * pas seulement le cas "sourate entièrement apprise".
 */
async function makeChainedSourate(
  userId: string,
  numero: number,
  ranges: Array<[number, number]> = [[1, 2], [3, 4], [5, 6], [7, 7]],
  lessonsApprises: number = ranges.length,
) {
  const nombreVersets = ranges[ranges.length - 1]![1];
  const sourate = await prisma.sourate.create({
    data: { numero, nom: `S${numero}`, nomArabe: `س${numero}`, nombreVersets, hizb: 1 },
  });
  const section = await prisma.section.create({
    data: {
      ordre: Math.floor(Math.random() * 1e9),
      kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000',
      degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
    },
  });
  await prisma.sectionSourate.create({ data: { sectionId: section.id, sourateId: sourate.id, ordre: 1 } });

  for (let i = 0; i < ranges.length; i++) {
    const [versetDebut, versetFin] = ranges[i]!;
    const lesson = await prisma.lesson.create({
      data: {
        sectionId: section.id, ordre: i + 1, titre: `Leçon ${i + 1}`,
        sourateNumero: numero, versetDebut, versetFin,
      },
    });
    if (i < lessonsApprises) {
      await prisma.lessonProgress.create({
        data: { userId, lessonId: lesson.id, etat: 'completed', score: 100, completedAt: new Date() },
      });
    }
  }
  return sourate;
}

d('revision: guided chaining (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('GET .../guided starts with no consolidated block and the first lesson as "nouveaux versets"', async () => {
    const u = await registerUser(app);
    const numero = 20;
    await makeChainedSourate(u.userId, numero);

    const res = await app.inject({
      method: 'GET', url: `/me/revisions/${numero}/guided`, headers: authHeader(u.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lessonsTotal: 4,
      lessonsConsolidees: 0,
      terminee: false,
      step: {
        blocConsolide: null,
        nouveauxVersets: { debut: 1, fin: 2 },
        blocAssemble: { debut: 1, fin: 2 },
        lessonIndex: 0,
      },
    });
  });

  it('POST .../guided/advance with "facile" grows the consolidated block by one lesson', async () => {
    const u = await registerUser(app);
    const numero = 21;
    await makeChainedSourate(u.userId, numero);

    const advance = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/guided/advance`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    expect(advance.statusCode).toBe(200);
    expect(advance.json()).toMatchObject({
      lessonsConsolidees: 1,
      terminee: false,
      step: {
        blocConsolide: { debut: 1, fin: 2 },
        nouveauxVersets: { debut: 3, fin: 4 },
        blocAssemble: { debut: 1, fin: 4 },
        lessonIndex: 1,
      },
    });

    const persisted = await prisma.sourateChainProgress.findFirst({ where: { userId: u.userId } });
    expect(persisted?.lessonsConsolidees).toBe(1);
  });

  it('POST .../guided/advance with "oublie" repeats the current cycle instead of advancing', async () => {
    const u = await registerUser(app);
    const numero = 22;
    await makeChainedSourate(u.userId, numero);

    // Advance once to lesson 2, then fail it.
    await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/guided/advance`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    const forgot = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/guided/advance`,
      headers: authHeader(u.accessToken), payload: { quality: 'oublie' },
    });
    expect(forgot.statusCode).toBe(200);
    expect(forgot.json()).toMatchObject({
      lessonsConsolidees: 1,
      step: { blocConsolide: { debut: 1, fin: 2 }, nouveauxVersets: { debut: 3, fin: 4 } },
    });
  });

  it('reaching the last lesson marks the chain as "terminee"', async () => {
    const u = await registerUser(app);
    const numero = 23;
    await makeChainedSourate(u.userId, numero); // 4 lessons

    let last;
    for (let i = 0; i < 4; i++) {
      last = await app.inject({
        method: 'POST', url: `/me/revisions/${numero}/guided/advance`,
        headers: authHeader(u.accessToken), payload: { quality: 'facile' },
      });
    }
    expect(last!.json()).toMatchObject({ lessonsConsolidees: 4, terminee: true, step: null });

    const after = await app.inject({
      method: 'GET', url: `/me/revisions/${numero}/guided`, headers: authHeader(u.accessToken),
    });
    expect(after.json()).toMatchObject({ terminee: true, step: null });
  });

  it('rejects advancing a chain that is already terminee', async () => {
    const u = await registerUser(app);
    const numero = 24;
    await makeChainedSourate(u.userId, numero, [[1, 2]]); // single lesson

    await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/guided/advance`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    const again = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/guided/advance`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    expect(again.statusCode).toBe(400);
  });

  it('rejects guided revision for a sourate the user has not learned', async () => {
    const u = await registerUser(app);
    const numero = 25;
    await prisma.sourate.create({
      data: { numero, nom: 'S25', nomArabe: 'س٢٥', nombreVersets: 4, hizb: 1 },
    });

    const res = await app.inject({
      method: 'GET', url: `/me/revisions/${numero}/guided`, headers: authHeader(u.accessToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('is accessible as soon as the FIRST lesson is learned — not the whole sourate', async () => {
    const u = await registerUser(app);
    const numero = 26;
    // Only lesson 1 of 4 completed (learning still in progress).
    await makeChainedSourate(u.userId, numero, undefined, 1);

    const res = await app.inject({
      method: 'GET', url: `/me/revisions/${numero}/guided`, headers: authHeader(u.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ lessonsTotal: 4, lessonsConsolidees: 0, terminee: false });
  });

  it('advance is capped by what the user has actually learned so far', async () => {
    const u = await registerUser(app);
    const numero = 27;
    // Only 2 of 4 lessons learned so far (still learning in "Apprendre").
    await makeChainedSourate(u.userId, numero, undefined, 2);

    // First advance: consolidates lesson 1 -> allowed (only 1 learned lesson consumed).
    const first = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/guided/advance`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().lessonsConsolidees).toBe(1);

    // Second advance would need lesson 2 learned -> allowed (exactly the cap).
    const second = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/guided/advance`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().lessonsConsolidees).toBe(2);

    // Third advance would require lesson 3, which the user hasn't learned yet
    // in "Apprendre" — the chain must NOT progress past the learned cap.
    const third = await app.inject({
      method: 'POST', url: `/me/revisions/${numero}/guided/advance`,
      headers: authHeader(u.accessToken), payload: { quality: 'facile' },
    });
    expect(third.statusCode).toBe(200);
    expect(third.json().lessonsConsolidees).toBe(2); // unchanged: capped

    const persisted = await prisma.sourateChainProgress.findFirst({ where: { userId: u.userId } });
    expect(persisted?.lessonsConsolidees).toBe(2);
  });
});

d('revision: chained lettre recitation (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  /** Minimal multipart/form-data body with a single `audio` file field. */
  function multipartAudio() {
    const boundary = '----testboundary123';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="audio"; filename="rec.wav"',
      'Content-Type: audio/wav',
      '',
      'fake-audio-bytes',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(body),
    };
  }

  /** An alphabet lesson (sourateNumero: null) with 3 ordered `discovery` letter steps. */
  async function makeAlphabetLesson() {
    const section = await prisma.section.create({
      data: {
        ordre: Math.floor(Math.random() * 1e9),
        kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000',
        degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
      },
    });
    const lesson = await prisma.lesson.create({
      data: { sectionId: section.id, ordre: 1, titre: 'Alphabet test', sourateNumero: null },
    });
    await prisma.lessonStep.createMany({
      data: [
        { lessonId: lesson.id, ordre: 1, type: 'discovery', payload: { arabe: 'ب', ttsText: 'بَاء' } },
        { lessonId: lesson.id, ordre: 2, type: 'discovery', payload: { arabe: 'ت', ttsText: 'تَاء' } },
        { lessonId: lesson.id, ordre: 3, type: 'discovery', payload: { arabe: 'ث', ttsText: 'ثَاء' } },
      ],
    });
    return lesson;
  }

  it('404s on an unknown lesson', async () => {
    const u = await registerUser(app);
    const mp = multipartAudio();
    const res = await app.inject({
      method: 'POST', url: '/me/revisions/lettres/does-not-exist/recite-range?debut=1&fin=2',
      headers: { ...authHeader(u.accessToken), ...mp.headers }, payload: mp.payload,
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s on a sourate lesson (not an alphabet lesson)', async () => {
    const u = await registerUser(app);
    const section = await prisma.section.create({
      data: {
        ordre: Math.floor(Math.random() * 1e9),
        kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000',
        degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
      },
    });
    const lesson = await prisma.lesson.create({
      data: { sectionId: section.id, ordre: 1, titre: 'Sourate lesson', sourateNumero: 1 },
    });
    const mp = multipartAudio();
    const res = await app.inject({
      method: 'POST', url: `/me/revisions/lettres/${lesson.id}/recite-range?debut=1&fin=1`,
      headers: { ...authHeader(u.accessToken), ...mp.headers }, payload: mp.payload,
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid step range (fin before debut)', async () => {
    const u = await registerUser(app);
    const lesson = await makeAlphabetLesson();
    const mp = multipartAudio();
    const res = await app.inject({
      method: 'POST', url: `/me/revisions/lettres/${lesson.id}/recite-range?debut=3&fin=1`,
      headers: { ...authHeader(u.accessToken), ...mp.headers }, payload: mp.payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a range beyond the lesson\'s actual step count', async () => {
    const u = await registerUser(app);
    const lesson = await makeAlphabetLesson(); // 3 steps
    const mp = multipartAudio();
    const res = await app.inject({
      method: 'POST', url: `/me/revisions/lettres/${lesson.id}/recite-range?debut=10&fin=12`,
      headers: { ...authHeader(u.accessToken), ...mp.headers }, payload: mp.payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('reaches ASR scoring for a valid chained range (503 when ASR is not configured)', async () => {
    const u = await registerUser(app);
    const lesson = await makeAlphabetLesson();
    const mp = multipartAudio();
    // debut=1 each time (cumulative from the start) is how the front chains
    // "syllable N" into "everything recited so far" as the learner advances.
    const res = await app.inject({
      method: 'POST', url: `/me/revisions/lettres/${lesson.id}/recite-range?debut=1&fin=3`,
      headers: { ...authHeader(u.accessToken), ...mp.headers }, payload: mp.payload,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
