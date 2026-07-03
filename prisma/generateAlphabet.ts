/**
 * Génère la section 1 (Alphabet, hizb null) :
 *   - 28 lettres réparties sur LETTER_LESSONS leçons. Chaque leçon de lettres :
 *       • par lettre : `discovery` (glyphe + nom + son + audio) puis `written`
 *         (« Quelle lettre est-ce ? »).
 *       • `matching` en fin de leçon : relier chaque glyphe à son nom.
 *   - Al-Fatiha en DERNIÈRES leçons, AU MÊME FORMAT que les autres sourates
 *     (regroupement 1-2 versets, discovery + ordering + matching + written) via
 *     le module partagé prisma/lessonBuilder.ts.
 *
 * Recrée entièrement les leçons de la section (deleteMany + createMany), donc
 * idempotent. Protégé par withRetry (coupures du Postgres free-tier Render).
 *
 *   DATABASE_URL="…" npx tsx prisma/generateAlphabet.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  FR, buildGroupSteps, groupVerses, loadVersets, withRetry,
  makeMatchingPairs, makeOrderingItems, pickDistractors, shuffle, type StepRow,
} from './lessonBuilder.js';

const prisma = new PrismaClient();

// 28 lettres sur 7 leçons de 4 → leçons plus riches/denses, ~2-3 min chacune,
// au même niveau de temps que les leçons de sourates.
const LETTER_LESSONS = 7;

// Les 28 lettres. `letterKey` = clé audio locale bundlée côté front ;
// `ttsText` = fallback expo-speech.
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

type Letter = typeof LETTERS[number];

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

const allNames = LETTERS.map((l) => l.nom);

/**
 * Étapes d'une leçon de lettres — MÊMES 4 types que les leçons de sourates :
 *   • par lettre : discovery (glyphe + son) + written (« Quelle lettre ? »)
 *   • ordering  : remettre les lettres dans l'ordre alphabétique (≥ 3 lettres)
 *   • matching  : relier chaque glyphe à son nom (≥ 2 lettres)
 * Le groupe est déjà en ordre alphabétique (LETTERS trié) → position = index+1.
 */
function buildLetterSteps(group: Letter[]): StepRow[] {
  const steps: StepRow[] = [];
  let ordre = 1;
  for (const L of group) {
    steps.push({
      ordre: ordre++,
      type: 'discovery',
      payload: { arabe: L.g, translitteration: L.nom, traduction: `Son : « ${L.son} »`, audioUrl: null, letterKey: L.letterKey, ttsText: L.ttsText },
    });
    const distract = pickDistractors(allNames, L.nom, 3);
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
  // Remise en ordre alphabétique (position = rang dans le groupe, déjà trié).
  if (group.length >= 3) {
    const items = group.map((L, i) => ({ position: i + 1, texteArabe: L.g }));
    steps.push(makeOrderingItems(ordre++, items, {
      arabe: group.map((l) => l.g).join(' '),
      consigne: 'Remets les lettres dans l’ordre alphabétique',
    }));
  }
  // Association glyphe ↔ nom (récap).
  if (group.length >= 2) {
    steps.push(makeMatchingPairs(ordre++, group.map((L) => ({ arabe: L.g, traduction: L.nom }))));
  }
  return steps;
}

interface LessonBlueprint { titre: string; sourateNumero: number | null; steps: StepRow[] }

async function main() {
  const section = await prisma.section.findFirst({ where: { hizb: null } });
  if (!section) throw new Error('Section Alphabet (hizb null) introuvable');

  // Pool de distracteurs = toutes les traductions fr (QCM Fatiha plus variés).
  const allTrad = await prisma.versetTraduction.findMany({ where: { langue: FR }, select: { texte: true } });
  const pool = [...new Set(allTrad.map((t) => t.texte).filter((t) => t.length > 0))];

  const blueprints = await withRetry(async () => {
    const bps: LessonBlueprint[] = [];

    // 1) Leçons de lettres.
    const chunks = chunkEven(LETTERS, LETTER_LESSONS);
    for (const group of chunks) {
      if (group.length === 0) continue;
      bps.push({
        titre: group.map((l) => l.g).join(' '),
        sourateNumero: null,
        steps: buildLetterSteps(group),
      });
    }

    // 2) Al-Fatiha au format standard (1-2 versets/leçon).
    const fatiha = await prisma.sourate.findUnique({ where: { numero: 1 } });
    if (fatiha) {
      const versets = await loadVersets(prisma, fatiha.id);
      for (const grp of groupVerses(versets)) {
        const nums = grp.map((v) => v.numero).join('-');
        bps.push({
          titre: `Al-Fātiha ${nums}`,
          sourateNumero: 1,
          steps: buildGroupSteps(grp, 1, pool),
        });
      }
    }
    return bps;
  }, 'Alphabet — collecte');

  // 3) Recréer entièrement les leçons de la section.
  const stepsTotal = await withRetry(async () => {
    await prisma.lesson.deleteMany({ where: { sectionId: section.id } });
    const created = await prisma.lesson.createManyAndReturn({
      data: blueprints.map((bp, i) => ({ sectionId: section.id, ordre: i + 1, titre: bp.titre, sourateNumero: bp.sourateNumero })),
      select: { id: true, ordre: true },
    });
    const idByOrdre = new Map(created.map((l) => [l.ordre, l.id]));
    const allSteps = blueprints.flatMap((bp, i) => {
      const lessonId = idByOrdre.get(i + 1)!;
      return bp.steps.map((s) => ({ lessonId, ordre: s.ordre, type: s.type, payload: s.payload }));
    });
    if (allSteps.length > 0) await prisma.lessonStep.createMany({ data: allSteps });
    return allSteps.length;
  }, 'Alphabet — écriture');

  blueprints.forEach((bp, i) => {
    console.log(`  ✓ Leçon ${i + 1}: ${bp.titre} — ${bp.steps.length} étapes`);
  });
  const fatihaCount = blueprints.filter((b) => b.sourateNumero === 1).length;
  console.log(`\n✓ Section 1: ${LETTERS.length} lettres sur ${LETTER_LESSONS} leçons + Al-Fatiha (${fatihaCount} leçons), ${stepsTotal} étapes`);
}

main()
  .catch((e) => { console.error('❌', e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
