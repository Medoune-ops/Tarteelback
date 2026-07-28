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

/**
 * Reproduit le parcours réel : Alphabet → An-Nas → Al-Falaq, chacune sa
 * propre section/leçon. `Section.ordre` et `Sourate.numero` sont uniques en
 * base et la suite tourne avec plusieurs workers Vitest partageant la même
 * base (resetDb() n'isole que les tests d'un même fichier, pas entre
 * fichiers concurrents) — d'où l'offset aléatoire, comme les autres tests
 * d'intégration du repo.
 */
async function makeRealTeachingOrder() {
  // Section.ordre est unique en base et d'autres fichiers de test tournent en
  // parallèle sur la même base (resetDb() n'isole que CE fichier) — d'où cet
  // offset aléatoire. Sourate.numero reste dans [1, 114] (contrainte de
  // l'endpoint PATCH /me) : aucun autre test du repo n'utilise 114/113.
  const base = Math.floor(Math.random() * 1e6) * 10;
  const numeroA = 114;
  const numeroB = 113;

  const alphabet = await prisma.section.create({
    data: {
      ordre: base, hizb: null, kicker: 'T', titre: 'Alphabet', sousTitre: '', couleur: '#000',
      degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
    },
  });
  const alphabetLesson = await prisma.lesson.create({
    data: { sectionId: alphabet.id, ordre: 1, titre: 'Alif' },
  });

  const sectionAnNas = await prisma.section.create({
    data: {
      ordre: base + 1, hizb: 60, kicker: 'T', titre: 'An-Nas', sousTitre: '', couleur: '#000',
      degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
    },
  });
  const anNas = await prisma.sourate.create({
    data: { numero: numeroA, nom: 'An-Nas', nomArabe: 'الناس', nombreVersets: 6, hizb: 60 },
  });
  await prisma.sectionSourate.create({ data: { sectionId: sectionAnNas.id, sourateId: anNas.id, ordre: 1 } });
  const anNasLesson = await prisma.lesson.create({
    data: { sectionId: sectionAnNas.id, ordre: 1, titre: 'An-Nas 1-6', sourateNumero: numeroA },
  });

  const sectionAlFalaq = await prisma.section.create({
    data: {
      ordre: base + 2, hizb: 60, kicker: 'T', titre: 'Al-Falaq', sousTitre: '', couleur: '#000',
      degradeStart: '#000', degradeEnd: '#111', headerIcon: 'x',
    },
  });
  const alFalaq = await prisma.sourate.create({
    data: { numero: numeroB, nom: 'Al-Falaq', nomArabe: 'الفلق', nombreVersets: 5, hizb: 60 },
  });
  await prisma.sectionSourate.create({ data: { sectionId: sectionAlFalaq.id, sourateId: alFalaq.id, ordre: 1 } });
  const alFalaqLesson = await prisma.lesson.create({
    data: { sectionId: sectionAlFalaq.id, ordre: 1, titre: 'Al-Falaq 1-5', sourateNumero: numeroB },
  });

  return { alphabetLesson, anNasLesson, alFalaqLesson, numeroA };
}

d('onboarding: declaring a surah mastered also completes everything BEFORE it (integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(); });

  it('cocher An-Nas (apprise en premier dans le parcours) marque aussi acquis l\'alphabet, sans toucher à Al-Falaq (qui suit)', async () => {
    const u = await registerUser(app);
    const { alphabetLesson, anNasLesson, alFalaqLesson, numeroA } = await makeRealTeachingOrder();

    const res = await app.inject({
      method: 'PATCH', url: '/me',
      headers: authHeader(u.accessToken),
      payload: { onboardingDone: true, sourates: [numeroA] },
    });
    expect(res.statusCode).toBe(200);

    const progress = await prisma.lessonProgress.findMany({ where: { userId: u.userId } });
    const doneIds = new Set(progress.filter((p) => p.etat === 'completed').map((p) => p.lessonId));

    // Alphabet ET An-Nas (la sourate cochée elle-même) sont acquis...
    expect(doneIds.has(alphabetLesson.id)).toBe(true);
    expect(doneIds.has(anNasLesson.id)).toBe(true);
    // ...mais PAS Al-Falaq, qui vient APRÈS dans le parcours — elle doit
    // rester la prochaine leçon à apprendre, pas être sautée.
    //
    // Pas de vérification via GET /sections ici : ce endpoint renvoie TOUTES
    // les sections de la base (contentRepository.listSections()), y compris
    // celles créées par d'autres fichiers de test tournant en parallèle sur
    // la même base partagée — la section "active" calculée
    // (content.serializer.ts#firstUnfinished) peut donc être décalée par du
    // contenu hors du contrôle de ce test. La preuve fiable est directement
    // sur LessonProgress, indépendante du reste de la base.
    expect(doneIds.has(alFalaqLesson.id)).toBe(false);
  });
});
