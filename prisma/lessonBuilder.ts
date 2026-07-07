/**
 * Logique PARTAGÉE de construction des leçons — utilisée par generateLessons.ts
 * (sourates des sections hizb) ET generateAlphabet.ts (Al-Fatiha en section 1).
 * Garantit que TOUTES les leçons de versets suivent le même format :
 *   - regroupement 1-2 versets par leçon (seuil de mots)
 *   - étapes : discovery + ordering + matching + written
 *
 * Contient aussi `withRetry` : réessaie une opération sur coupure de connexion
 * transitoire (fréquent sur le Postgres free-tier de Render pendant les seeds).
 */
import type { Prisma, PrismaClient, StepType } from '@prisma/client';

export const LONG_VERSE_THRESHOLD = 7;  // mots — au-dessus = leçon solo
export const MIN_ORDERING_WORDS   = 3;  // mots — en dessous = pas d'ordering
export const FR       = 'fr';
export const TRANSLIT = 'la';

// ─── Utilitaires ─────────────────────────────────────────────────────────────

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function pickDistractors(pool: string[], correct: string, n: number): string[] {
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

export function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Réessaie `fn` sur erreur de connexion transitoire (Render free-tier ferme
 * parfois la connexion pendant un seed long). Backoff exponentiel 1s/2s/4s.
 */
const TRANSIENT = [
  'closed the connection',
  'reach database',
  'terminating connection',
  'Connection terminated',
  'ECONNRESET',
  'P1001',
  'P1017',
];

export async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const err = e as { message?: string; code?: string };
      const msg = String(err?.message ?? e);
      const transient = TRANSIENT.some((t) => msg.includes(t) || err?.code === t);
      if (!transient || i === tries) throw e;
      const backoff = 1000 * 2 ** (i - 1);
      console.log(`  ⚠ ${label} — tentative ${i}/${tries} échouée (${msg.split('\n')[0]}), retry dans ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StepRow { ordre: number; type: StepType; payload: Prisma.InputJsonValue }

export interface VersetData {
  id: string;
  numero: number;
  texteArabe: string;
  audioUrl: string | null;
  trad: string;
  translit: string;
  mots: Array<{ position: number; texteArabe: string; audioUrl: string | null }>;
}

export type VerseGroup = [VersetData] | [VersetData, VersetData];

// ─── Constructeurs d'étapes ───────────────────────────────────────────────────

export function makeDiscovery(ordre: number, v: VersetData): StepRow {
  const mots = v.mots.map((m) => ({ position: m.position, texteArabe: m.texteArabe, audioUrl: m.audioUrl }));
  return {
    ordre,
    type: 'discovery',
    payload: { arabe: v.texteArabe, translitteration: v.translit, traduction: v.trad, audioUrl: v.audioUrl, mots },
  };
}

/**
 * Étape remise-en-ordre générique. `items` porte l'ordre CORRECT via `position`
 * (croissant = correct). Sert aux versets (mots) ET à l'alphabet (lettres).
 * `consigne` optionnelle (ex: « Remets les lettres dans l'ordre »).
 */
export function makeOrderingItems(
  ordre: number,
  items: Array<{ position: number; texteArabe: string }>,
  opts?: { arabe?: string; consigne?: string },
): StepRow {
  const payload: Record<string, unknown> = { mots: items };
  if (opts?.arabe) payload.arabe = opts.arabe;
  if (opts?.consigne) payload.consigne = opts.consigne;
  return { ordre, type: 'ordering', payload: payload as Prisma.InputJsonValue };
}

export function makeOrdering(ordre: number, v: VersetData): StepRow {
  return makeOrderingItems(
    ordre,
    v.mots.map((m) => ({ position: m.position, texteArabe: m.texteArabe })),
    { arabe: v.texteArabe },
  );
}

export function makeWritten(ordre: number, v: VersetData, pool: string[]): StepRow | null {
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

/**
 * Étape association générique : relie chaque `arabe` à sa `traduction`.
 * Sert aux versets (verset ↔ sens) ET aux lettres (glyphe ↔ nom).
 */
export function makeMatchingPairs(ordre: number, pairs: Array<{ arabe: string; traduction: string }>): StepRow {
  const paires = shuffle(pairs.map((p) => ({ id: shortId(), arabe: p.arabe, traduction: p.traduction })));
  return { ordre, type: 'matching', payload: { paires } };
}

/**
 * Étape voix : récite le verset, scoré par l'ASR serveur (Whisper base
 * fine-tuné Coran) — voir src/modules/lessons/asr.client.ts côté backend.
 * `seuilReussite` reste indulgent (70) car même un ASR spécialisé n'atteint pas
 * 100% sur une récitation humaine variable (rythme, tajwid, bruit ambiant).
 */
export function makeVoice(ordre: number, v: VersetData): StepRow {
  return {
    ordre,
    type: 'voice',
    payload: {
      arabe: v.texteArabe,
      translitteration: v.translit,
      traduction: v.trad,
      audioUrl: v.audioUrl,
      seuilReussite: 70,
    },
  };
}

export function makeMatching(ordre: number, v1: VersetData, v2: VersetData): StepRow {
  return makeMatchingPairs(ordre, [
    { arabe: v1.texteArabe, traduction: v1.trad },
    { arabe: v2.texteArabe, traduction: v2.trad },
  ]);
}

// ─── Regroupement de versets ──────────────────────────────────────────────────

export function groupVerses(verses: VersetData[]): VerseGroup[] {
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

/** Construit les étapes d'un groupe (1-2 versets) au format standard. */
export function buildGroupSteps(group: VerseGroup, startOrdre: number, pool: string[]): StepRow[] {
  const steps: StepRow[] = [];

  if (group.length === 1) {
    const [v] = group;
    steps.push(makeDiscovery(0, v));
    if (v.mots.length >= MIN_ORDERING_WORDS) steps.push(makeOrdering(0, v));
    const written = makeWritten(0, v, pool);
    if (written) steps.push(written);
    steps.push(makeVoice(0, v));
  } else {
    const [v1, v2] = group;
    steps.push(makeDiscovery(0, v1));
    if (v1.mots.length >= MIN_ORDERING_WORDS) steps.push(makeOrdering(0, v1));
    steps.push(makeDiscovery(0, v2));
    if (v2.mots.length >= MIN_ORDERING_WORDS) steps.push(makeOrdering(0, v2));
    if (v1.trad && v2.trad) steps.push(makeMatching(0, v1, v2));
    const w1 = makeWritten(0, v1, pool);
    if (w1) steps.push(w1);
    const w2 = makeWritten(0, v2, pool);
    if (w2) steps.push(w2);
    steps.push(makeVoice(0, v2));
  }

  // Numérotation propre à partir de startOrdre.
  steps.forEach((s, idx) => { s.ordre = startOrdre + idx; });
  return steps;
}

// ─── Chargement des versets ───────────────────────────────────────────────────

export async function loadVersets(prisma: PrismaClient, sourateId: string): Promise<VersetData[]> {
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
