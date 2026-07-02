/**
 * Génère le VRAI cours d'alphabet arabe : les 28 lettres réparties sur les
 * leçons de la section Alphabet (section 1, hizb null). Chaque lettre =
 *   1. `discovery` : le glyphe + son nom + son son (pas d'audio : les données
 *      Coran sont par mot/verset, pas par lettre).
 *   2. `written`   : « Quelle lettre est-ce ? » (nom correct vs 3 autres noms).
 *
 * Idempotent (deleteMany + createMany par leçon). Remplace tout contenu
 * précédent des leçons de la section 1 (y compris l'ancienne démo / le
 * remplissage par sourates). Les sourates restent dans les sections 2+.
 *
 *   DATABASE_URL="…" npx tsx prisma/generateAlphabet.ts
 */
import 'dotenv/config';
import { PrismaClient, Prisma, type StepType } from '@prisma/client';

const prisma = new PrismaClient();

// Les 28 lettres de l'alphabet arabe, dans l'ordre, avec nom et indication de son.
const LETTERS = [
  { g: 'ا', nom: 'Alif',  son: 'a / â long' },
  { g: 'ب', nom: 'Bā',    son: 'b' },
  { g: 'ت', nom: 'Tā',    son: 't' },
  { g: 'ث', nom: 'Thā',   son: 'th (anglais « think »)' },
  { g: 'ج', nom: 'Jīm',   son: 'dj' },
  { g: 'ح', nom: 'Ḥā',    son: 'h aspiré fort' },
  { g: 'خ', nom: 'Khā',   son: 'kh (jota)' },
  { g: 'د', nom: 'Dāl',   son: 'd' },
  { g: 'ذ', nom: 'Dhāl',  son: 'dh (anglais « this »)' },
  { g: 'ر', nom: 'Rā',    son: 'r roulé' },
  { g: 'ز', nom: 'Zāy',   son: 'z' },
  { g: 'س', nom: 'Sīn',   son: 's' },
  { g: 'ش', nom: 'Shīn',  son: 'ch' },
  { g: 'ص', nom: 'Ṣād',   son: 's emphatique' },
  { g: 'ض', nom: 'Ḍād',   son: 'd emphatique' },
  { g: 'ط', nom: 'Ṭā',    son: 't emphatique' },
  { g: 'ظ', nom: 'Ẓā',    son: 'z emphatique' },
  { g: 'ع', nom: 'ʿAyn',  son: 'son guttural « ʿa »' },
  { g: 'غ', nom: 'Ghayn', son: 'gh (r grasseyé)' },
  { g: 'ف', nom: 'Fā',    son: 'f' },
  { g: 'ق', nom: 'Qāf',   son: 'q guttural' },
  { g: 'ك', nom: 'Kāf',   son: 'k' },
  { g: 'ل', nom: 'Lām',   son: 'l' },
  { g: 'م', nom: 'Mīm',   son: 'm' },
  { g: 'ن', nom: 'Nūn',   son: 'n' },
  { g: 'ه', nom: 'Hā',    son: 'h léger' },
  { g: 'و', nom: 'Wāw',   son: 'w / ou' },
  { g: 'ي', nom: 'Yā',    son: 'y / î' },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function pickDistinct(pool: string[], correct: string, n: number): string[] {
  const out: string[] = [];
  const seen = new Set([correct]);
  while (out.length < n) {
    const t = pool[Math.floor(Math.random() * pool.length)]!;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Découpe `arr` en `parts` tranches contiguës aussi égales que possible. */
function chunkEven<T>(arr: T[], parts: number): T[][] {
  const base = Math.floor(arr.length / parts);
  const extra = arr.length % parts;
  const res: T[][] = [];
  let idx = 0;
  for (let i = 0; i < parts; i++) {
    const size = base + (i < extra ? 1 : 0);
    res.push(arr.slice(idx, idx + size));
    idx += size;
  }
  return res;
}

async function main() {
  const alphabet = await prisma.section.findFirst({
    where: { hizb: null },
    include: { lessons: { orderBy: { ordre: 'asc' } } },
  });
  if (!alphabet) throw new Error('Section Alphabet (hizb null) introuvable');

  const lessons = alphabet.lessons;
  const chunks = chunkEven(LETTERS, lessons.length);
  const allNames = LETTERS.map((l) => l.nom);

  let stepsTotal = 0;
  for (let i = 0; i < lessons.length; i++) {
    const group = chunks[i] ?? [];
    const steps: { ordre: number; type: StepType; payload: Prisma.InputJsonValue }[] = [];
    let ordre = 1;

    for (const L of group) {
      // 1) Découverte de la lettre (visuelle, sans audio).
      steps.push({
        ordre: ordre++,
        type: 'discovery',
        payload: { arabe: L.g, translitteration: L.nom, traduction: `Son : « ${L.son} »`, audioUrl: null },
      });
      // 2) Test : reconnaître la lettre par son nom.
      const distract = pickDistinct(allNames, L.nom, 3);
      const shuffled = shuffle([{ correct: true, text: L.nom }, ...distract.map((t) => ({ correct: false, text: t }))]);
      const ids = ['A', 'B', 'C', 'D'];
      const options = shuffled.map((o, k) => ({ id: ids[k]!, text: o.text }));
      const bonneReponse = ids[shuffled.findIndex((o) => o.correct)]!;
      steps.push({
        ordre: ordre++,
        type: 'written',
        payload: { consigne: 'Quelle lettre est-ce ?', arabe: L.g, options, bonneReponse },
      });
    }

    await prisma.lessonStep.deleteMany({ where: { lessonId: lessons[i]!.id } });
    if (steps.length > 0) {
      await prisma.lessonStep.createMany({
        data: steps.map((s) => ({ lessonId: lessons[i]!.id, ordre: s.ordre, type: s.type, payload: s.payload })),
      });
    }
    // Titre = les lettres de la leçon (ex: "ا ب ت").
    await prisma.lesson.update({
      where: { id: lessons[i]!.id },
      data: { titre: group.length ? group.map((l) => l.g).join(' ') : `Leçon ${i + 1}` },
    });
    stepsTotal += steps.length;
    console.log(`  ✓ Leçon ${i + 1}: ${group.map((l) => l.nom).join(', ') || '(vide)'} — ${steps.length} étapes`);
  }

  console.log(`\n✓ Alphabet: ${LETTERS.length} lettres sur ${lessons.length} leçons, ${stepsTotal} étapes`);
}

main()
  .catch((e) => { console.error('❌', e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
