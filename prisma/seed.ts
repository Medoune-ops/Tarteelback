/**
 * Seed the database with everything the front currently shows.
 *
 * Order:
 *  1. Ensure Quran reference data exists (run `npm run seed:quran` first for the
 *     full 114 surahs; this seed warns if none are present).
 *  2. Build parcours Sections: Section 1 = Alphabet, then 1 hizb = 1 section in
 *     decreasing order (Section N = Hizb 62 − N), each linked to the surahs that
 *     start in that hizb, with one Lesson per surah.
 *  3. A demo lesson with alternating discovery/written/voice steps (Basmala).
 *  4. Demo user + admin user.
 *  5. Leagues (Bronze…Émeraude) + a current week with fictional participants.
 *
 * Idempotent where practical (upserts on natural keys).
 */
import 'dotenv/config';
import { PrismaClient, type StepType } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

// Visual palette cycle (mirrors constants/parcours.ts).
const COLORS = ['#34C724', '#6B4DFF', '#F0820C', '#1CB0C7', '#E0398B'];
const GRADIENTS: [string, string][] = [
  ['#3FD831', '#22A015'],
  ['#7C5CFF', '#5A38E6'],
  ['#FF9B3D', '#E06D00'],
  ['#27C3DC', '#108EA3'],
  ['#F25BA6', '#C82270'],
];

async function hash(pw: string) {
  return argon2.hash(pw, { type: argon2.argon2id });
}

async function seedUsers() {
  const demo = await prisma.user.upsert({
    where: { email: 'demo@tarteel.app' },
    update: {},
    create: {
      email: 'demo@tarteel.app',
      passwordHash: await hash('demo1234'),
      displayName: 'Yasmine A.',
      avatarInitials: 'YA',
      level: 'debutant',
      objectif: 'hifz',
      dailyMinutes: 10,
      onboardingDone: true,
      timezone: 'Africa/Dakar',
      language: 'fr',
      xp: 1240,
      weeklyXp: 1250,
      hearts: 5,
      streak: 15,
      lastStreakValue: 15,
      lastActivityDate: new Date(),
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@tarteel.app' },
    update: { role: 'admin' },
    create: {
      email: 'admin@tarteel.app',
      passwordHash: await hash('admin1234'),
      displayName: 'Tarteel Admin',
      avatarInitials: 'TA',
      role: 'admin',
      onboardingDone: true,
      timezone: 'UTC',
      language: 'en',
    },
  });

  console.log(`  ✓ users: demo=${demo.email}, admin=${admin.email}`);
  return { demo, admin };
}

async function seedSections() {
  const sourates = await prisma.sourate.findMany({ orderBy: { numero: 'asc' } });
  if (sourates.length === 0) {
    console.warn(
      '  ⚠ No sourates found. Run `npm run seed:quran` first to import the Quran, ' +
        'then re-run the seed to build sections/lessons.',
    );
  }

  // Group surahs by the hizb they start in.
  const byHizb = new Map<number, typeof sourates>();
  for (const s of sourates) {
    const arr = byHizb.get(s.hizb) ?? [];
    arr.push(s);
    byHizb.set(s.hizb, arr);
  }
  // Within a hizb, Mushaf order (ascending surah number).
  for (const arr of byHizb.values()) arr.sort((a, b) => a.numero - b.numero);

  // Section 1 — Alphabet.
  const alphabet = await prisma.section.upsert({
    where: { ordre: 1 },
    update: {},
    create: {
      ordre: 1,
      hizb: null,
      kicker: 'SECTION 1',
      titre: 'Alphabet Arabe',
      sousTitre: 'Apprends à lire les 28 lettres',
      couleur: COLORS[0]!,
      degradeStart: GRADIENTS[0]![0],
      degradeEnd: GRADIENTS[0]![1],
      headerIcon: 'type',
    },
  });
  await ensureLessons(alphabet.id, 10, 'Leçon');
  console.log('  ✓ section 1: Alphabet (10 lessons)');

  // Hizb sections in decreasing order: Section N = Hizb (62 − N).
  // i.e. ordre 2 -> hizb 60, ordre 3 -> hizb 59, …
  const presentHizbs = Array.from(byHizb.keys()).sort((a, b) => b - a); // 60→1
  let ordre = 2;
  for (const hizb of presentHizbs) {
    const list = byHizb.get(hizb)!;
    const colorIdx = ordre % COLORS.length;
    const section = await prisma.section.upsert({
      where: { ordre },
      update: {},
      create: {
        ordre,
        hizb,
        kicker: `SECTION ${ordre}`,
        titre: `Hizb ${hizb}`,
        sousTitre: sousTitre(list.map((s) => s.nom)),
        couleur: COLORS[colorIdx]!,
        degradeStart: GRADIENTS[colorIdx]![0],
        degradeEnd: GRADIENTS[colorIdx]![1],
        headerIcon: 'book-open',
      },
    });

    // Link surahs to the section (context badges).
    await prisma.sectionSourate.deleteMany({ where: { sectionId: section.id } });
    await prisma.sectionSourate.createMany({
      data: list.map((s, i) => ({ sectionId: section.id, sourateId: s.id, ordre: i + 1 })),
    });

    // One lesson per surah.
    for (let i = 0; i < list.length; i++) {
      await prisma.lesson.upsert({
        where: { sectionId_ordre: { sectionId: section.id, ordre: i + 1 } },
        update: { titre: list[i]!.nom },
        create: { sectionId: section.id, ordre: i + 1, titre: list[i]!.nom, iconType: 'star' },
      });
    }
    ordre += 1;
  }
  console.log(`  ✓ ${presentHizbs.length} hizb section(s) built`);
}

async function ensureLessons(sectionId: string, count: number, prefix: string) {
  for (let i = 1; i <= count; i++) {
    await prisma.lesson.upsert({
      where: { sectionId_ordre: { sectionId, ordre: i } },
      update: {},
      create: { sectionId, ordre: i, titre: `${prefix} ${i}`, iconType: 'star' },
    });
  }
}

function sousTitre(noms: string[]): string {
  if (noms.length === 0) return '';
  if (noms.length <= 3) return noms.join(' · ');
  return `${noms.slice(0, 3).join(' · ')} +${noms.length - 3}`;
}

/** Demo lesson: Basmala split into words, alternating discovery → written, then a voice step. */
async function seedDemoLesson() {
  const alphabet = await prisma.section.findUnique({ where: { ordre: 1 } });
  if (!alphabet) return;
  const lesson1 = await prisma.lesson.findUnique({
    where: { sectionId_ordre: { sectionId: alphabet.id, ordre: 1 } },
  });
  if (!lesson1) return;

  const mots = [
    { arabe: 'بِسْمِ', translit: 'Bismi', sens: 'Au nom de' },
    { arabe: 'اللَّهِ', translit: 'Allāhi', sens: 'Allah' },
    { arabe: 'الرَّحْمَٰنِ', translit: 'Ar-Raḥmān', sens: 'Le Tout Miséricordieux' },
    { arabe: 'الرَّحِيمِ', translit: 'Ar-Raḥīm', sens: 'Le Très Miséricordieux' },
  ];

  await prisma.lessonStep.deleteMany({ where: { lessonId: lesson1.id } });

  let ordre = 1;
  const steps: { type: StepType; payload: unknown }[] = [];
  for (const mot of mots) {
    steps.push({
      type: 'discovery',
      payload: { arabe: mot.arabe, translitteration: mot.translit, traduction: mot.sens, audioUrl: null },
    });
    const autres = mots.filter((m) => m.arabe !== mot.arabe).map((m) => m.sens);
    steps.push({
      type: 'written',
      payload: {
        consigne: 'Que signifie ce mot ?',
        arabe: mot.arabe,
        translitteration: mot.translit,
        options: [
          { id: 'A', text: mot.sens },
          { id: 'B', text: autres[0] },
          { id: 'C', text: autres[1] ?? 'Le Guide' },
          { id: 'D', text: autres[2] ?? 'Le Créateur' },
        ],
        bonneReponse: 'A',
      },
    });
  }
  steps.push({
    type: 'voice',
    payload: {
      arabe: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      translitteration: 'Bismi-llāhi r-raḥmāni r-raḥīm',
      traduction: "Au nom d'Allah, le Tout Miséricordieux, le Très Miséricordieux",
      audioUrl: null,
      seuilReussite: 70,
    },
  });

  await prisma.lesson.update({ where: { id: lesson1.id }, data: { titre: 'Al-Fatiha · Basmala' } });
  for (const s of steps.slice(0, 25)) {
    await prisma.lessonStep.create({ data: { lessonId: lesson1.id, ordre: ordre++, type: s.type, payload: s.payload as object } });
  }
  console.log(`  ✓ demo lesson: ${steps.length} alternating steps`);
}

async function seedLeagues(demoUserId: string) {
  const tiers = [
    { nom: 'Bronze', niveau: 1, ordre: 1 },
    { nom: 'Argent', niveau: 2, ordre: 2 },
    { nom: 'Or', niveau: 3, ordre: 3 },
    { nom: 'Émeraude', niveau: 4, ordre: 4 },
  ];
  for (const t of tiers) {
    await prisma.league.upsert({ where: { ordre: t.ordre }, update: {}, create: t });
  }

  const or = await prisma.league.findUnique({ where: { ordre: 3 } });
  if (!or) return;

  // Current week (Mon→Sun around now).
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // Monday
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  const week = await prisma.leagueWeek.upsert({
    where: { leagueId_numeroSemaine: { leagueId: or.id, numeroSemaine: 23 } },
    update: { dateDebut: start, dateFin: end },
    create: { leagueId: or.id, numeroSemaine: 23, dateDebut: start, dateFin: end },
  });

  // Fictional participants (mirrors the front mock) + the demo user.
  const fakes = [
    { name: 'Idriss M.', initials: 'IM', xp: 1620 },
    { name: 'Sarah B.', initials: 'SB', xp: 1480 },
    { name: 'Khadija N.', initials: 'KN', xp: 1320 },
    { name: 'Amine R.', initials: 'AR', xp: 1180 },
    { name: 'Leïla D.', initials: 'LD', xp: 1050 },
    { name: 'Oussama K.', initials: 'OK', xp: 990 },
    { name: 'Maryam T.', initials: 'MT', xp: 870 },
    { name: 'Hicham B.', initials: 'HB', xp: 720 },
  ];

  for (const f of fakes) {
    const email = `${f.initials.toLowerCase()}@league.demo`;
    const u = await prisma.user.upsert({
      where: { email },
      update: { weeklyXp: f.xp },
      create: {
        email,
        displayName: f.name,
        avatarInitials: f.initials,
        weeklyXp: f.xp,
        onboardingDone: true,
      },
    });
    await prisma.leagueMembership.upsert({
      where: { userId_leagueWeekId: { userId: u.id, leagueWeekId: week.id } },
      update: { weeklyXp: f.xp },
      create: { userId: u.id, leagueWeekId: week.id, weeklyXp: f.xp },
    });
  }

  // Enrol the demo user too.
  await prisma.leagueMembership.upsert({
    where: { userId_leagueWeekId: { userId: demoUserId, leagueWeekId: week.id } },
    update: { weeklyXp: 1250 },
    create: { userId: demoUserId, leagueWeekId: week.id, weeklyXp: 1250 },
  });

  console.log('  ✓ leagues: Bronze→Émeraude, Or week 23 with participants');
}

/** Podium history for the demo user (mirrors constants/ligues.ts). */
async function seedPodiums(demoUserId: string) {
  const PODIUM_XP: Record<number, number> = { 1: 500, 2: 300, 3: 150 };
  const history = [
    { ref: 'w23', semaine: 23, ligue: 'Or', rang: 2, xp: 1250 },
    { ref: 'w21', semaine: 21, ligue: 'Or', rang: 3, xp: 1080 },
    { ref: 'w19', semaine: 19, ligue: 'Argent', rang: 1, xp: 1420 },
    { ref: 'w17', semaine: 17, ligue: 'Argent', rang: 1, xp: 1510 },
    { ref: 'w15', semaine: 15, ligue: 'Argent', rang: 3, xp: 990 },
    { ref: 'w12', semaine: 12, ligue: 'Bronze', rang: 1, xp: 1340 },
    { ref: 'w10', semaine: 10, ligue: 'Bronze', rang: 2, xp: 1120 },
    { ref: 'w08', semaine: 8, ligue: 'Bronze', rang: 1, xp: 1280 },
  ];
  for (const p of history) {
    await prisma.podiumReward.upsert({
      where: { userId_ref: { userId: demoUserId, ref: p.ref } },
      update: {},
      create: { userId: demoUserId, ...p, reward: PODIUM_XP[p.rang]! },
    });
  }
  console.log('  ✓ podiums: 8 historical top-3 finishes for the demo user');
}

async function main() {
  console.log('🌱 Seeding Tarteel…');
  const { demo } = await seedUsers();
  await seedSections();
  await seedDemoLesson();
  await seedLeagues(demo.id);
  await seedPodiums(demo.id);
  console.log('✅ Seed complete.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
