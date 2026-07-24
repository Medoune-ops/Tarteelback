import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DB_TESTS, makeApp, resetDb, registerUser, authHeader } from './helpers/testApp.js';
import { prisma } from '../src/config/prisma.js';

const d = DB_TESTS ? describe : describe.skip;

/**
 * A section bundling THREE surahs (mirrors a real hizb section, e.g. section
 * 2 = An-Nas + Al-Falaq + Al-Ikhlas + ...): each surah gets its own lessons
 * via Lesson.sourateNumero, but they all share the same Section/SectionSourate.
 */
async function makeMultiSourateSection() {
  const section = await prisma.section.create({
    data: {
      ordre: Math.floor(Math.random() * 1e9),
      kicker: 'T', titre: 'T', sousTitre: '', couleur: '#000',
      degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
    },
  });
  const sourates = [];
  let ordre = 1;
  for (const numero of [114, 113, 112]) {
    const sourate = await prisma.sourate.create({
      data: { numero, nom: `S${numero}`, nomArabe: `س${numero}`, nombreVersets: 4, hizb: 60 },
    });
    await prisma.sectionSourate.create({ data: { sectionId: section.id, sourateId: sourate.id, ordre } });
    await prisma.lesson.create({
      data: { sectionId: section.id, ordre: ordre++, titre: `S${numero} 1-2`, sourateNumero: numero },
    });
    sourates.push(sourate);
  }
  return { section, sourates };
}

d('onboarding: already-mastered surah shows up as learned (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('a surah declared mastered at onboarding appears in GET /me/sourates even though sibling surahs in the same section are not done', async () => {
    const u = await registerUser(app);
    const { sourates } = await makeMultiSourateSection();
    const [declared] = sourates; // numero 114 (An-Nas)

    const res = await app.inject({
      method: 'PATCH', url: '/me',
      headers: authHeader(u.accessToken),
      payload: { onboardingDone: true, sourates: [declared!.numero] },
    });
    expect(res.statusCode).toBe(200);

    const learned = await app.inject({
      method: 'GET', url: '/me/sourates', headers: authHeader(u.accessToken),
    });
    expect(learned.statusCode).toBe(200);
    const numeros = learned.json().sourates.map((s: { numero: number }) => s.numero);
    expect(numeros).toContain(declared!.numero);
    // The sibling surahs (not declared mastered) must NOT appear.
    expect(numeros).not.toContain(sourates[1]!.numero);
    expect(numeros).not.toContain(sourates[2]!.numero);
  });

  it('the mastered surah is immediately accessible via guided revision', async () => {
    const u = await registerUser(app);
    const { sourates } = await makeMultiSourateSection();
    const [declared] = sourates;

    await app.inject({
      method: 'PATCH', url: '/me',
      headers: authHeader(u.accessToken),
      payload: { onboardingDone: true, sourates: [declared!.numero] },
    });

    // Guided revision uses its own learned-lesson counter, but the classic
    // SRS list (per-segment) relies on getLearnedSourates and must see it too.
    const list = await app.inject({
      method: 'GET', url: '/me/revisions', headers: authHeader(u.accessToken),
    });
    expect(list.statusCode).toBe(200);
    const numeros = list.json().revisions.map((r: { numero: number }) => r.numero);
    expect(numeros).toContain(declared!.numero);
  });
});
