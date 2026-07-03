/**
 * Génère le contenu de TOUTES les leçons de sourates à partir des données réelles
 * (Verset + VersetMot + traductions fr + translittérations la).
 *
 * Algorithme de regroupement :
 *   - Verset long (> LONG_VERSE_THRESHOLD mots) → leçon solo :
 *       discovery + ordering (si ≥ 3 mots) + written
 *   - Verset court (≤ LONG_VERSE_THRESHOLD mots) → pair avec le suivant court :
 *       discovery_v1 + ordering_v1 + discovery_v2 + ordering_v2 + matching + written_v1 + written_v2
 *     Si c'est le dernier verset non pairé : leçon solo (3 étapes max).
 *
 * Ordering est sauté si le verset a < MIN_ORDERING_WORDS mots (trop court pour être intéressant).
 * Matching est inclus uniquement si le groupe contient 2 versets.
 *
 * Pour chaque section hizb : supprime TOUTES les leçons existantes et les recrée
 * dynamiquement (le nombre de leçons change car un verset = 1-3 étapes, non 1-2).
 *
 * Idempotent (deleteMany + createMany). Lancer avec la DATABASE_URL cible :
 *   DATABASE_URL="…" npx tsx prisma/generateLessons.ts
 *
 * La section Alphabet (section 1, hizb null) est gérée par generateAlphabet.ts.
 */
import 'dotenv/config';
import { PrismaClient, Prisma, type StepType } from '@prisma/client';

const prisma = new PrismaClient();

const LONG_VERSE_THRESHOLD = 7;  // mots — au-dessus = leçon solo
const MIN_ORDERING_WORDS   = 3;  // mots — en dessous = pas d'ordering
const FR      = 'fr';
const TRANSLIT = 'la';

// ─── Utilitaires ─────────────────────────────────────────────────────────────

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

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StepRow { ordre: number; type: StepType; payload: Prisma.InputJsonValue }

interface VersetData {
  id: string;
  numero: number;
  texteArabe: string;
  audioUrl: string | null;
  trad: string;
  translit: string;
  mots: Array<{ position: number; texteArabe: string; audioUrl: string | null }>;
}

// ─── Constructeurs d'étapes ───────────────────────────────────────────────────

function makeDiscovery(ordre: number, v: VersetData): StepRow {
  const mots = v.mots.map((m) => ({ position: m.position, texteArabe: m.texteArabe, audioUrl: m.audioUrl }));
  return {
    ordre,
    type: 'discovery',
    payload: { arabe: v.texteArabe, translitteration: v.translit, traduction: v.trad, audioUrl: v.audioUrl, mots },
  };
}

function makeOrdering(ordre: number, v: VersetData): StepRow {
  return {
    ordre,
    type: 'ordering',
    payload: {
      arabe: v.texteArabe,
      mots: v.mots.map((m) => ({ position: m.position, texteArabe: m.texteArabe })),
    },
  };
}

function makeWritten(ordre: number, v: VersetData, pool: string[]): StepRow | null {
  if (!v.trad) return null;
  const distract = pickDistractors(pool, v.trad, 3);
  const shuffled = shuffle([{ correct: true, text: v.trad }, ...distract.map((t) => ({ correct: false, text: t }))]);
  const ids = ['A', 'B', 'C', 'D'];
  const options = shuffled.map((o, k) => ({ id: ids[k]!, text: o.text }));
  const bonneReponse = ids[shuffled.findIndex((o) => o.correct)]!;
  return {
    ordre,
    type: 'written',
    payload: { consigne: 'Que signifie ce verset ?', arabe: v.texteArabe, translitteration: v.translit, options, bonneReponse },
  };
}

function makeMatching(ordre: number, v1: VersetData, v2: VersetData): StepRow {
  const paires = shuffle([
    { id: shortId(), arabe: v1.texteArabe, traduction: v1.trad },
    { id: shortId(), arabe: v2.texteArabe, traduction: v2.trad },
  ]);
  return {
    ordre,
    type: 'matching',
    payload: { paires },
  };
}

// ─── Regroupement de versets ──────────────────────────────────────────────────

type VerseGroup = [VersetData] | [VersetData, VersetData];

function groupVerses(verses: VersetData[]): VerseGroup[] {
  const groups: VerseGroup[] = [];
  let i = 0;
  while (i < verses.length) {
    const v = verses[i]!;
    if (v.mots.length > LONG_VERSE_THRESHOLD) {
      groups.push([v]);
      i++;
    } else {
      const next = verses[i + 1];
      if (next && next.mots.length <= LONG_VERSE_THRESHOLD) {
        groups.push([v, next]);
        i += 2;
      } else {
        groups.push([v]);
        i++;
      }
    }
  }
  return groups;
}

// ─── Construction des étapes d'un groupe ─────────────────────────────────────

function buildGroupSteps(group: VerseGroup, startOrdre: number, pool: string[]): StepRow[] {
  const steps: StepRow[] = [];
  let ordre = startOrdre;

  if (group.length === 1) {
    const [v] = group;
    steps.push(makeDiscovery(ordre++, v));
    if (v.mots.length >= MIN_ORDERING_WORDS) steps.push(makeOrdering(ordre++, v));
    const written = makeWritten(ordre++, v, pool);
    if (written) { steps.push(written); } else { ordre--; }
  } else {
    const [v1, v2] = group;
    steps.push(makeDiscovery(ordre++, v1));
    if (v1.mots.length >= MIN_ORDERING_WORDS) steps.push(makeOrdering(ordre++, v1));
    steps.push(makeDiscovery(ordre++, v2));
    if (v2.mots.length >= MIN_ORDERING_WORDS) steps.push(makeOrdering(ordre++, v2));
    if (v1.trad && v2.trad) steps.push(makeMatching(ordre++, v1, v2));
    const w1 = makeWritten(ordre++, v1, pool);
    if (w1) { steps.push(w1); } else { ordre--; }
    const w2 = makeWritten(ordre++, v2, pool);
    if (w2) { steps.push(w2); } else { ordre--; }
  }

  // Re-numéroter proprement à partir de startOrdre.
  steps.forEach((s, idx) => { s.ordre = startOrdre + idx; });
  return steps;
}

// ─── Chargement des versets d'une sourate ────────────────────────────────────

async function loadVersets(sourateId: string): Promise<VersetData[]> {
  const versets = await prisma.verset.findMany({
    where: { sourateId },
    orderBy: { numero: 'asc' },
    include: {
      mots: { orderBy: { position: 'asc' } },
      traductions: { where: { langue: FR } },
      translitterations: { where: { langue: TRANSLIT } },
    },
  });
  return versets.map((v) => ({
    id: v.id,
    numero: v.numero,
    texteArabe: v.texteArabe,
    audioUrl: v.audioUrl,
    trad: v.traductions[0]?.texte ?? '',
    translit: v.translitterations[0]?.texte ?? '',
    mots: v.mots.map((m) => ({ position: m.position, texteArabe: m.texteArabe, audioUrl: m.audioUrl })),
  }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allTrad = await prisma.versetTraduction.findMany({ where: { langue: FR }, select: { texte: true } });
  const pool = [...new Set(allTrad.map((t) => t.texte).filter((t) => t.length > 0))];
  console.log(`Pool distracteurs: ${pool.length} traductions fr`);

  const hizbSections = await prisma.section.findMany({
    where: { hizb: { not: null } },
    orderBy: { ordre: 'asc' },
    include: {
      lessons: { orderBy: { ordre: 'asc' } },
      sourateLinks: { orderBy: { ordre: 'asc' }, include: { sourate: true } },
    },
  });

  let totalLessons = 0;
  let totalSteps = 0;

  for (const section of hizbSections) {
    // 1) Collecter tous les groupes de versets pour cette section (toutes sourates).
    type LessonBlueprint = { titre: string; steps: StepRow[] };
    const blueprints: LessonBlueprint[] = [];

    for (const link of section.sourateLinks) {
      const sourate = link.sourate;
      const versets = await loadVersets(sourate.id);
      if (versets.length === 0) continue;

      const groups = groupVerses(versets);
      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi]!;
        const steps = buildGroupSteps(group, 1, pool);
        const nums = group.map((v) => v.numero).join('-');
        blueprints.push({ titre: `${sourate.nom} ${nums}`, steps });
      }
    }

    // 2) Supprimer toutes les leçons existantes de cette section (cascade).
    await prisma.lesson.deleteMany({ where: { sectionId: section.id } });

    // 3) Recréer les leçons avec les bons ordres.
    for (let i = 0; i < blueprints.length; i++) {
      const bp = blueprints[i]!;
      const lesson = await prisma.lesson.create({
        data: { sectionId: section.id, ordre: i + 1, titre: bp.titre },
      });
      if (bp.steps.length > 0) {
        await prisma.lessonStep.createMany({
          data: bp.steps.map((s) => ({ lessonId: lesson.id, ordre: s.ordre, type: s.type, payload: s.payload })),
        });
      }
      totalSteps += bp.steps.length;
    }

    totalLessons += blueprints.length;
    console.log(`  ✓ Hizb ${section.hizb} (section ${section.ordre}) — ${blueprints.length} leçons, ${blueprints.reduce((a, b) => a + b.steps.length, 0)} étapes`);
  }

  // La section Alphabet (hizb null) est gérée par generateAlphabet.ts.
  console.log(`\n✓ ${totalLessons} leçons de sourates générées, ${totalSteps} étapes au total`);
}

main()
  .catch((e) => { console.error('❌', e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
