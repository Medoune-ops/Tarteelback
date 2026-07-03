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

// Les 28 lettres de l'alphabet arabe.
// `letterKey` = clé audio locale bundlée côté front (assets/sounds/letters/<key>.wav).
// `ttsText`   = fallback expo-speech si le fichier audio est absent.
const LETTERS = [
  { g: 'ا', nom: 'Alif',  son: 'a / â long',                  letterKey: 'alif',  ttsText: 'أَلِف' },
  { g: 'ب', nom: 'Bā',    son: 'b',                            letterKey: 'ba',    ttsText: 'بَاء' },
  { g: 'ت', nom: 'Tā',    son: 't',                            letterKey: 'ta',    ttsText: 'تَاء' },
  { g: 'ث', nom: 'Thā',   son: 'th (anglais « think »)',       letterKey: 'tha',   ttsText: 'ثَاء' },
  { g: 'ج', nom: 'Jīm',   son: 'dj',                           letterKey: 'jeem',  ttsText: 'جِيم' },
  { g: 'ح', nom: 'Ḥā',    son: 'h aspiré fort',                letterKey: 'ha',    ttsText: 'حَاء' },
  { g: 'خ', nom: 'Khā',   son: 'kh (jota)',                    letterKey: 'kha',   ttsText: 'خَاء' },
  { g: 'د', nom: 'Dāl',   son: 'd',                            letterKey: 'dal',   ttsText: 'دَال' },
  { g: 'ذ', nom: 'Dhāl',  son: 'dh (anglais « this »)',        letterKey: 'dhal',  ttsText: 'ذَال' },
  { g: 'ر', nom: 'Rā',    son: 'r roulé',                      letterKey: 'ra',    ttsText: 'رَاء' },
  { g: 'ز', nom: 'Zāy',   son: 'z',                            letterKey: 'zay',   ttsText: 'زَاي' },
  { g: 'س', nom: 'Sīn',   son: 's',                            letterKey: 'sin',   ttsText: 'سِين' },
  { g: 'ش', nom: 'Shīn',  son: 'ch',                           letterKey: 'shin',  ttsText: 'شِين' },
  { g: 'ص', nom: 'Ṣād',   son: 's emphatique',                 letterKey: 'sad',   ttsText: 'صَاد' },
  { g: 'ض', nom: 'Ḍād',   son: 'd emphatique',                 letterKey: 'dad',   ttsText: 'ضَاد' },
  { g: 'ط', nom: 'Ṭā',    son: 't emphatique',                 letterKey: 'ta2',   ttsText: 'طَاء' },
  { g: 'ظ', nom: 'Ẓā',    son: 'z emphatique',                 letterKey: 'dha2',  ttsText: 'ظَاء' },
  { g: 'ع', nom: 'ʿAyn',  son: 'son guttural « ʿa »',         letterKey: 'ayn',   ttsText: 'عَيْن' },
  { g: 'غ', nom: 'Ghayn', son: 'gh (r grasseyé)',              letterKey: 'ghayn', ttsText: 'غَيْن' },
  { g: 'ف', nom: 'Fā',    son: 'f',                            letterKey: 'fa',    ttsText: 'فَاء' },
  { g: 'ق', nom: 'Qāf',   son: 'q guttural',                   letterKey: 'qaf',   ttsText: 'قَاف' },
  { g: 'ك', nom: 'Kāf',   son: 'k',                            letterKey: 'kaf',   ttsText: 'كَاف' },
  { g: 'ل', nom: 'Lām',   son: 'l',                            letterKey: 'lam',   ttsText: 'لَام' },
  { g: 'م', nom: 'Mīm',   son: 'm',                            letterKey: 'mim',   ttsText: 'مِيم' },
  { g: 'ن', nom: 'Nūn',   son: 'n',                            letterKey: 'nun',   ttsText: 'نُون' },
  { g: 'ه', nom: 'Hā',    son: 'h léger',                      letterKey: 'ha2',   ttsText: 'هَاء' },
  { g: 'و', nom: 'Wāw',   son: 'w / ou',                       letterKey: 'waw',   ttsText: 'وَاو' },
  { g: 'ي', nom: 'Yā',    son: 'y / î',                        letterKey: 'ya',    ttsText: 'يَاء' },
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

const FR = 'fr';
const TRANSLIT = 'la';

interface StepRow { ordre: number; type: StepType; payload: Prisma.InputJsonValue }

/**
 * Construit les étapes de la leçon Al-Fatiha : chaque verset en LECTEUR mot par
 * mot (mots + audio réels) suivi d'un test « Que signifie ce verset ? ».
 * Renvoie null si le Coran n'a pas été importé (sourate 1 absente).
 */
async function buildFatihaSteps(): Promise<StepRow[] | null> {
  const fatiha = await prisma.sourate.findUnique({ where: { numero: 1 } });
  if (!fatiha) return null;
  const versets = await prisma.verset.findMany({
    where: { sourateId: fatiha.id },
    orderBy: { numero: 'asc' },
    include: {
      mots: { orderBy: { position: 'asc' } },
      traductions: { where: { langue: FR } },
      translitterations: { where: { langue: TRANSLIT } },
    },
  });
  if (versets.length === 0) return null;

  // Distracteurs = les traductions fr des versets d'Al-Fatiha.
  const pool = [...new Set(versets.map((v) => v.traductions[0]?.texte).filter((t): t is string => !!t))];

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

    // 2) Test écrit : sens du verset (seulement si assez de distracteurs).
    if (trad && pool.length >= 4) {
      const distract = pickDistinct(pool, trad, 3);
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

async function main() {
  const alphabet = await prisma.section.findFirst({
    where: { hizb: null },
    include: { lessons: { orderBy: { ordre: 'asc' } } },
  });
  if (!alphabet) throw new Error('Section Alphabet (hizb null) introuvable');

  const lessons = alphabet.lessons;
  // La DERNIÈRE leçon de la section = Al-Fatiha (après l'apprentissage des
  // lettres). Les 28 lettres sont réparties sur les leçons précédentes.
  const letterLessons = lessons.length > 1 ? lessons.slice(0, -1) : lessons;
  const fatihaLesson = lessons.length > 1 ? lessons[lessons.length - 1] : null;
  const chunks = chunkEven(LETTERS, letterLessons.length);
  const allNames = LETTERS.map((l) => l.nom);

  let stepsTotal = 0;
  for (let i = 0; i < letterLessons.length; i++) {
    const group = chunks[i] ?? [];
    const steps: { ordre: number; type: StepType; payload: Prisma.InputJsonValue }[] = [];
    let ordre = 1;

    for (const L of group) {
      // 1) Découverte de la lettre (glyphe + nom + son).
      // `ttsText` = texte à prononcer via expo-speech (TTS natif arabe du device).
      steps.push({
        ordre: ordre++,
        type: 'discovery',
        payload: { arabe: L.g, translitteration: L.nom, traduction: `Son : « ${L.son} »`, audioUrl: null, letterKey: L.letterKey, ttsText: L.ttsText },
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

    await prisma.lessonStep.deleteMany({ where: { lessonId: letterLessons[i]!.id } });
    if (steps.length > 0) {
      await prisma.lessonStep.createMany({
        data: steps.map((s) => ({ lessonId: letterLessons[i]!.id, ordre: s.ordre, type: s.type, payload: s.payload })),
      });
    }
    // Titre = les lettres de la leçon (ex: "ا ب ت").
    await prisma.lesson.update({
      where: { id: letterLessons[i]!.id },
      data: { titre: group.length ? group.map((l) => l.g).join(' ') : `Leçon ${i + 1}` },
    });
    stepsTotal += steps.length;
    console.log(`  ✓ Leçon ${i + 1}: ${group.map((l) => l.nom).join(', ') || '(vide)'} — ${steps.length} étapes`);
  }

  // Dernière leçon de la section 1 = Al-Fatiha (après l'alphabet).
  if (fatihaLesson) {
    const fSteps = await buildFatihaSteps();
    await prisma.lessonStep.deleteMany({ where: { lessonId: fatihaLesson.id } });
    if (fSteps && fSteps.length > 0) {
      await prisma.lessonStep.createMany({
        data: fSteps.map((s) => ({ lessonId: fatihaLesson.id, ordre: s.ordre, type: s.type, payload: s.payload })),
      });
      await prisma.lesson.update({ where: { id: fatihaLesson.id }, data: { titre: 'Al-Fātiha', sourateNumero: 1 } });
      stepsTotal += fSteps.length;
      console.log(`  ✓ Leçon ${lessons.length}: Al-Fātiha — ${fSteps.length} étapes`);
    } else {
      console.log(`  ⚠ Leçon ${lessons.length}: Al-Fatiha ignorée (Coran non importé — lancer seed:quran)`);
    }
  }

  console.log(`\n✓ Section 1: ${LETTERS.length} lettres sur ${letterLessons.length} leçons + Al-Fatiha, ${stepsTotal} étapes`);
}

main()
  .catch((e) => { console.error('❌', e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
