/**
 * Génère le contenu de TOUTES les leçons de sourates à partir des données réelles
 * (Verset + VersetMot + traductions fr + translittérations la).
 *
 * Pour chaque leçon-sourate, on alterne, verset par verset (jusqu'à MAX_VERSES) :
 *   1. `discovery` — le verset en LECTEUR mot par mot (mots + audio réels).
 *   2. `written`   — « Que signifie ce verset ? » : la vraie traduction fr contre
 *                    3 distracteurs tirés au hasard d'autres versets.
 *
 * Sections hizb : 1 leçon = 1 sourate (mapping par `ordre`).
 * Section Alphabet : la leçon 1 (démo Al-Fatiha) est préservée ; les leçons 2→10
 * sont remplies avec 9 courtes sourates pour ne jamais bloquer la progression.
 *
 * Idempotent : chaque leçon ciblée voit ses steps supprimés puis recréés.
 * Lancer avec le DATABASE_URL de la base cible :
 *   DATABASE_URL="…" npx tsx prisma/generateLessons.ts
 */
import 'dotenv/config';
import { PrismaClient, Prisma, type StepType } from '@prisma/client';

const prisma = new PrismaClient();

const MAX_VERSES = 8;        // plafond de versets par leçon (≤ ~16 étapes)
const FR = 'fr';
const TRANSLIT = 'la';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function pickDistractors(pool: string[], correct: string, n: number): string[] {
  const out: string[] = [];
  const seen = new Set([correct]);
  let guard = 0;
  while (out.length < n && guard < 2000) {
    guard++;
    const t = pool[Math.floor(Math.random() * pool.length)]!;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

interface StepRow { ordre: number; type: StepType; payload: Prisma.InputJsonValue }

/** Construit les étapes d'une leçon à partir d'une sourate (versets réels). */
async function buildSteps(sourateId: string, pool: string[]): Promise<StepRow[]> {
  const versets = await prisma.verset.findMany({
    where: { sourateId },
    orderBy: { numero: 'asc' },
    take: MAX_VERSES,
    include: {
      mots: { orderBy: { position: 'asc' } },
      traductions: { where: { langue: FR } },
      translitterations: { where: { langue: TRANSLIT } },
    },
  });

  const steps: StepRow[] = [];
  let ordre = 1;
  for (const v of versets) {
    const trad = v.traductions[0]?.texte ?? '';
    const translit = v.translitterations[0]?.texte ?? '';
    const mots = v.mots.map((m) => ({ position: m.position, texteArabe: m.texteArabe, audioUrl: m.audioUrl }));

    // 1) Découverte : lecteur mot par mot du verset.
    steps.push({
      ordre: ordre++,
      type: 'discovery',
      payload: { arabe: v.texteArabe, translitteration: translit, traduction: trad, audioUrl: v.audioUrl, mots },
    });

    // 2) Test écrit : sens du verset (seulement si on a une traduction).
    if (trad) {
      const distract = pickDistractors(pool, trad, 3);
      const shuffled = shuffle([{ correct: true, text: trad }, ...distract.map((t) => ({ correct: false, text: t }))]);
      const ids = ['A', 'B', 'C', 'D'];
      const options = shuffled.map((o, k) => ({ id: ids[k]!, text: o.text }));
      const bonneReponse = ids[shuffled.findIndex((o) => o.correct)]!;
      steps.push({
        ordre: ordre++,
        type: 'written',
        payload: { consigne: 'Que signifie ce verset ?', arabe: v.texteArabe, translitteration: translit, options, bonneReponse },
      });
    }
  }
  return steps;
}

async function writeLesson(lessonId: string, steps: StepRow[]) {
  await prisma.lessonStep.deleteMany({ where: { lessonId } });
  if (steps.length === 0) return;
  await prisma.lessonStep.createMany({
    data: steps.map((s) => ({ lessonId, ordre: s.ordre, type: s.type, payload: s.payload })),
  });
}

async function main() {
  const allTrad = await prisma.versetTraduction.findMany({ where: { langue: FR }, select: { texte: true } });
  const pool = [...new Set(allTrad.map((t) => t.texte).filter((t) => t.length > 0))];
  console.log(`Pool distracteurs: ${pool.length} traductions fr`);

  let lessons = 0;
  let stepsTotal = 0;

  // ── Sections hizb : 1 leçon = 1 sourate liée ──────────────────────────────
  const hizbSections = await prisma.section.findMany({
    where: { hizb: { not: null } },
    orderBy: { ordre: 'asc' },
    include: {
      lessons: { orderBy: { ordre: 'asc' } },
      sourateLinks: { orderBy: { ordre: 'asc' }, include: { sourate: true } },
    },
  });
  for (const section of hizbSections) {
    const n = Math.min(section.lessons.length, section.sourateLinks.length);
    for (let i = 0; i < n; i++) {
      const steps = await buildSteps(section.sourateLinks[i]!.sourate.id, pool);
      await writeLesson(section.lessons[i]!.id, steps);
      lessons++;
      stepsTotal += steps.length;
    }
    console.log(`  ✓ Hizb ${section.hizb} — ${n} leçons`);
  }

  // La section Alphabet (section 1) est gérée à part par generateAlphabet.ts.
  console.log(`\n✓ ${lessons} leçons de sourates générées, ${stepsTotal} étapes au total`);
}

main()
  .catch((e) => { console.error('❌', e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
