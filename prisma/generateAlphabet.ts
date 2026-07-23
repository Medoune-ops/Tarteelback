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
 * UPSERT en place par (sectionId, ordre) / (lessonId, ordre) — jamais de
 * deleteMany+recreate, pour préserver Lesson.id/LessonStep.id (donc
 * LessonProgress/LettreRevision des utilisateurs réels). Idempotent.
 * Protégé par withRetry (coupures du Postgres free-tier Render).
 *
 *   DATABASE_URL="…" npx tsx prisma/generateAlphabet.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  FR, buildGroupSteps, groupVerses, i18n, loadVersets, withRetry,
  makeMatchingPairs, makeOrderingItems, pickDistractors, shuffle, type StepRow,
} from './lessonBuilder.js';

const prisma = new PrismaClient();

// 28 lettres sur 7 leçons de 4 → leçons plus riches/denses, ~2-3 min chacune,
// au même niveau de temps que les leçons de sourates.
const LETTER_LESSONS = 7;

// Les 28 lettres. `letterKey` = clé audio locale bundlée côté front ;
// `ttsText` = fallback expo-speech.
const LETTERS = [
  { g: 'ا', nom: 'Alif',  son: 'a / â long',                  sonEn: 'a / long â',                letterKey: 'alif',  ttsText: 'أَلِف', consonne: 'a' },
  { g: 'ب', nom: 'Bā',    son: 'b',                            sonEn: 'b',                          letterKey: 'ba',    ttsText: 'بَاء', consonne: 'b' },
  { g: 'ت', nom: 'Tā',    son: 't',                            sonEn: 't',                          letterKey: 'ta',    ttsText: 'تَاء', consonne: 't' },
  { g: 'ث', nom: 'Thā',   son: 'th (anglais « think »)',       sonEn: 'th (as in "think")',         letterKey: 'tha',   ttsText: 'ثَاء', consonne: 'th' },
  { g: 'ج', nom: 'Jīm',   son: 'dj',                           sonEn: 'j (as in "jam")',            letterKey: 'jeem',  ttsText: 'جِيم', consonne: 'dj' },
  { g: 'ح', nom: 'Ḥā',    son: 'h aspiré fort',                sonEn: 'strong breathy h',           letterKey: 'ha',    ttsText: 'حَاء', consonne: 'h' },
  { g: 'خ', nom: 'Khā',   son: 'kh (jota)',                    sonEn: 'kh (like Spanish "jota")',   letterKey: 'kha',   ttsText: 'خَاء', consonne: 'kh' },
  { g: 'د', nom: 'Dāl',   son: 'd',                            sonEn: 'd',                          letterKey: 'dal',   ttsText: 'دَال', consonne: 'd' },
  { g: 'ذ', nom: 'Dhāl',  son: 'dh (anglais « this »)',        sonEn: 'th (as in "this")',          letterKey: 'dhal',  ttsText: 'ذَال', consonne: 'dh' },
  { g: 'ر', nom: 'Rā',    son: 'r roulé',                      sonEn: 'rolled r',                   letterKey: 'ra',    ttsText: 'رَاء', consonne: 'r' },
  { g: 'ز', nom: 'Zāy',   son: 'z',                            sonEn: 'z',                          letterKey: 'zay',   ttsText: 'زَاي', consonne: 'z' },
  { g: 'س', nom: 'Sīn',   son: 's',                            sonEn: 's',                          letterKey: 'sin',   ttsText: 'سِين', consonne: 's' },
  { g: 'ش', nom: 'Shīn',  son: 'ch',                           sonEn: 'sh',                         letterKey: 'shin',  ttsText: 'شِين', consonne: 'ch' },
  { g: 'ص', nom: 'Ṣād',   son: 's emphatique',                 sonEn: 'emphatic s',                 letterKey: 'sad',   ttsText: 'صَاد', consonne: 's' },
  { g: 'ض', nom: 'Ḍād',   son: 'd emphatique',                 sonEn: 'emphatic d',                 letterKey: 'dad',   ttsText: 'ضَاد', consonne: 'd' },
  { g: 'ط', nom: 'Ṭā',    son: 't emphatique',                 sonEn: 'emphatic t',                 letterKey: 'ta2',   ttsText: 'طَاء', consonne: 't' },
  { g: 'ظ', nom: 'Ẓā',    son: 'z emphatique',                 sonEn: 'emphatic z',                 letterKey: 'dha2',  ttsText: 'ظَاء', consonne: 'z' },
  { g: 'ع', nom: 'ʿAyn',  son: 'son guttural « ʿa »',         sonEn: 'guttural "ʿa" sound',        letterKey: 'ayn',   ttsText: 'عَيْن', consonne: 'ʿ' },
  { g: 'غ', nom: 'Ghayn', son: 'gh (r grasseyé)',              sonEn: 'gh (like French rolled r)',  letterKey: 'ghayn', ttsText: 'غَيْن', consonne: 'gh' },
  { g: 'ف', nom: 'Fā',    son: 'f',                            sonEn: 'f',                          letterKey: 'fa',    ttsText: 'فَاء', consonne: 'f' },
  { g: 'ق', nom: 'Qāf',   son: 'q guttural',                   sonEn: 'guttural q',                 letterKey: 'qaf',   ttsText: 'قَاف', consonne: 'q' },
  { g: 'ك', nom: 'Kāf',   son: 'k',                            sonEn: 'k',                          letterKey: 'kaf',   ttsText: 'كَاف', consonne: 'k' },
  { g: 'ل', nom: 'Lām',   son: 'l',                            sonEn: 'l',                          letterKey: 'lam',   ttsText: 'لَام', consonne: 'l' },
  { g: 'م', nom: 'Mīm',   son: 'm',                            sonEn: 'm',                          letterKey: 'mim',   ttsText: 'مِيم', consonne: 'm' },
  { g: 'ن', nom: 'Nūn',   son: 'n',                            sonEn: 'n',                          letterKey: 'nun',   ttsText: 'نُون', consonne: 'n' },
  { g: 'ه', nom: 'Hā',    son: 'h léger',                      sonEn: 'light h',                    letterKey: 'ha2',   ttsText: 'هَاء', consonne: 'h' },
  { g: 'و', nom: 'Wāw',   son: 'w / ou',                       sonEn: 'w / oo',                     letterKey: 'waw',   ttsText: 'وَاو', consonne: 'w' },
  { g: 'ي', nom: 'Yā',    son: 'y / î',                        sonEn: 'y / long î',                 letterKey: 'ya',    ttsText: 'يَاء', consonne: 'y' },
];

type Letter = typeof LETTERS[number];

// ─── Harakat (signes de voyellation) ─────────────────────────────────────────
// Insérées ENTRE les leçons de lettres et Al-Fatiha (même section, hizb null) :
// une fois l'alphabet connu, on apprend ce qui donne leur SON aux lettres
// (fatha/kasra/damma/sukun/tanwin) avant d'aborder les versets.
// On réutilise un sous-ensemble de lettres simples (non-emphatiques) pour ne
// pas surcharger, et le TTS arabe (`ttsText`) car il n'y a pas de mp3 dédiés
// aux combinaisons lettre+harakat (contrairement aux 28 lettres seules).
const HARAKA_LETTERS = LETTERS.filter((l) =>
  ['ba', 'ta', 'jeem', 'dal', 'ra', 'sin', 'fa', 'kaf', 'lam', 'mim', 'nun'].includes(l.letterKey),
);

interface Haraka {
  nom: string; sigle: string;
  son: string; sonEn: string;
  suffix: string; suffixEn: string;
  combine: (g: string) => string;
}

const FATHA: Haraka = {
  nom: 'Fatha', sigle: 'َ', son: 'a', sonEn: 'a', suffix: 'a', suffixEn: 'a', combine: (g) => g + 'َ',
};
const KASRA: Haraka = {
  nom: 'Kasra', sigle: 'ِ', son: 'i', sonEn: 'i', suffix: 'i', suffixEn: 'i', combine: (g) => g + 'ِ',
};
const DAMMA: Haraka = {
  nom: 'Damma', sigle: 'ُ', son: 'ou', sonEn: 'u', suffix: 'ou', suffixEn: 'u', combine: (g) => g + 'ُ',
};
const SUKUN: Haraka = {
  nom: 'Sukun', sigle: 'ْ', son: '(aucune voyelle)', sonEn: '(no vowel)', suffix: '', suffixEn: '', combine: (g) => g + 'ْ',
};

/** Étape d'intro : met en avant LE signe enseigné dans cette leçon (glyphe seul, en grand). */
function makeHarakaIntro(ordre: number, h: Haraka): StepRow {
  return {
    ordre,
    type: 'discovery',
    payload: {
      arabe: h.sigle,
      translitteration: h.nom,
      traduction: i18n(
        `Nouveau signe : le ${h.nom} — il donne le son « ${h.son} »`,
        `New sign: ${h.nom} — it gives the sound "${h.sonEn}"`,
      ),
      audioUrl: null,
      ttsText: h === SUKUN ? undefined : h.combine('ا'),
    },
  };
}

/** Étapes d'une leçon fatha/kasra/damma/sukun : intro sur le signe, puis discovery + written par lettre, puis matching récap. */
function buildSimpleHarakaSteps(letters: Letter[], h: Haraka): StepRow[] {
  const steps: StepRow[] = [makeHarakaIntro(1, h)];
  let ordre = 2;
  const allSyllables = letters.map((l) => h.combine(l.g));
  for (const L of letters) {
    const syll = h.combine(L.g);
    const ttsText = h === SUKUN ? L.ttsText : syll; // le TTS lit mal un signe seul sans support consonne+voyelle réel
    steps.push({
      ordre: ordre++,
      type: 'discovery',
      payload: {
        arabe: syll,
        translitteration: h.suffix ? `${L.consonne}${h.suffix}` : `${L.consonne} (sans voyelle)`,
        traduction: i18n(`${h.nom} → son « ${h.son} »`, `${h.nom} → sound "${h.sonEn}"`),
        audioUrl: null,
        ttsText,
      },
    });
    const distract = pickDistractors(allSyllables, syll, 3);
    const shuffled = shuffle([{ correct: true, text: syll }, ...distract.map((t) => ({ correct: false, text: t }))]);
    const ids = ['A', 'B', 'C', 'D'];
    const options = shuffled.map((o, k) => ({ id: ids[k]!, text: o.text }));
    const bonneReponse = ids[shuffled.findIndex((o) => o.correct)]!;
    steps.push({
      ordre: ordre++,
      type: 'written',
      payload: {
        consigne: i18n(
          `Quelle syllabe se prononce « ${L.consonne}${h.suffix} » ?`,
          `Which syllable is pronounced "${L.consonne}${h.suffixEn}"?`,
        ),
        arabe: '',
        options,
        bonneReponse,
      },
    });
  }
  if (letters.length >= 2) {
    steps.push(makeMatchingPairs(ordre++, letters.map((L) => ({ arabe: h.combine(L.g), traduction: `${L.consonne}${h.suffix || ' (sukun)'}` }))));
  }
  return steps;
}

/** Étapes de la leçon Tanwin (fin de mot : an/in/oun) — même moule, 3 signes × sous-ensemble de lettres. */
function buildTanwinSteps(letters: Letter[]): StepRow[] {
  const TANWIN = [
    { sigle: 'ً', suffix: 'an',  combine: (g: string) => g + 'ً' },
    { sigle: 'ٍ', suffix: 'in',  combine: (g: string) => g + 'ٍ' },
    { sigle: 'ٌ', suffix: 'oun', combine: (g: string) => g + 'ٌ' },
  ];
  const steps: StepRow[] = [];
  let ordre = 1;
  const allSyllables = letters.flatMap((L) => TANWIN.map((t) => t.combine(L.g)));
  for (const t of TANWIN) {
    // Intro : met en avant LE signe tanwin enseigné dans ce bloc (glyphe seul, en grand).
    steps.push({
      ordre: ordre++,
      type: 'discovery',
      payload: {
        arabe: t.sigle,
        translitteration: `Tanwin ${t.suffix}`,
        traduction: i18n(
          `Nouveau signe : le tanwin « ${t.sigle} » — il donne le son « ${t.suffix} »`,
          `New sign: tanwin "${t.sigle}" — it gives the sound "${t.suffix}"`,
        ),
        audioUrl: null,
        ttsText: t.combine('ا'),
      },
    });
    for (const L of letters) {
      const syll = t.combine(L.g);
      steps.push({
        ordre: ordre++,
        type: 'discovery',
        payload: {
          arabe: syll,
          translitteration: `${L.consonne}${t.suffix}`,
          traduction: i18n(`Tanwin « ${t.sigle} » → son « ${t.suffix} »`, `Tanwin "${t.sigle}" → sound "${t.suffix}"`),
          audioUrl: null,
          ttsText: syll,
        },
      });
      const distract = pickDistractors(allSyllables, syll, 3);
      const shuffled = shuffle([{ correct: true, text: syll }, ...distract.map((s) => ({ correct: false, text: s }))]);
      const ids = ['A', 'B', 'C', 'D'];
      const options = shuffled.map((o, k) => ({ id: ids[k]!, text: o.text }));
      const bonneReponse = ids[shuffled.findIndex((o) => o.correct)]!;
      steps.push({
        ordre: ordre++,
        type: 'written',
        payload: {
          consigne: i18n(
            `Quelle syllabe se prononce « ${L.consonne}${t.suffix} » ?`,
            `Which syllable is pronounced "${L.consonne}${t.suffix}"?`,
          ),
          arabe: '',
          options,
          bonneReponse,
        },
      });
    }
  }
  const recap = letters.slice(0, 2).flatMap((L) => TANWIN.map((t) => ({ arabe: t.combine(L.g), traduction: `${L.consonne}${t.suffix}` })));
  steps.push(makeMatchingPairs(ordre++, recap));
  return steps;
}

/** Leçon de synthèse : associer chaque signe seul (glyphe) à son nom/son + QCM mixte sur des syllabes variées. */
function buildHarakaSummarySteps(letters: Letter[]): StepRow[] {
  const steps: StepRow[] = [];
  let ordre = 1;
  const signs: Haraka[] = [FATHA, KASRA, DAMMA, SUKUN];
  for (const h of signs) {
    steps.push({
      ordre: ordre++,
      type: 'discovery',
      payload: {
        arabe: h.sigle,
        translitteration: h.nom,
        traduction: i18n(`Donne le son « ${h.son} »`, `Gives the sound "${h.sonEn}"`),
        audioUrl: null,
        ttsText: h === SUKUN ? undefined : h.combine('ا'),
      },
    });
  }
  steps.push(makeMatchingPairs(ordre++, signs.map((h) => ({ arabe: h.sigle, traduction: h.nom }))));

  // QCM mixte : syllabes prises sur des lettres/harakat variés.
  const mixed = letters.slice(0, 6).flatMap((L, i) => {
    const h = signs[i % 3]!; // alterne fatha/kasra/damma
    return [{ arabe: h.combine(L.g), reponse: `${L.consonne}${h.suffix}` }];
  });
  const allMixed = mixed.map((m) => m.reponse);
  for (const m of mixed) {
    const distract = pickDistractors(allMixed, m.reponse, 3);
    const shuffled = shuffle([{ correct: true, text: m.reponse }, ...distract.map((t) => ({ correct: false, text: t }))]);
    const ids = ['A', 'B', 'C', 'D'];
    const options = shuffled.map((o, k) => ({ id: ids[k]!, text: o.text }));
    const bonneReponse = ids[shuffled.findIndex((o) => o.correct)]!;
    steps.push({
      ordre: ordre++,
      type: 'written',
      payload: {
        consigne: i18n('Comment se prononce cette syllabe ?', 'How is this syllable pronounced?'),
        arabe: m.arabe,
        options,
        bonneReponse,
      },
    });
  }
  return steps;
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
      payload: {
        arabe: L.g,
        translitteration: L.nom,
        traduction: i18n(`Son : « ${L.son} »`, `Sound: "${L.sonEn}"`),
        audioUrl: null,
        letterKey: L.letterKey,
        ttsText: L.ttsText,
      },
    });
    const distract = pickDistractors(allNames, L.nom, 3);
    const shuffled = shuffle([{ correct: true, text: L.nom }, ...distract.map((t) => ({ correct: false, text: t }))]);
    const ids = ['A', 'B', 'C', 'D'];
    const options = shuffled.map((o, k) => ({ id: ids[k]!, text: o.text }));
    const bonneReponse = ids[shuffled.findIndex((o) => o.correct)]!;
    steps.push({
      ordre: ordre++,
      type: 'written',
      payload: { consigne: i18n('Quelle lettre est-ce ?', 'Which letter is this?'), arabe: L.g, options, bonneReponse },
    });
  }
  // Remise en ordre alphabétique (position = rang dans le groupe, déjà trié).
  if (group.length >= 3) {
    const items = group.map((L, i) => ({ position: i + 1, texteArabe: L.g }));
    steps.push(makeOrderingItems(ordre++, items, {
      arabe: group.map((l) => l.g).join(' '),
      consigne: i18n('Remets les lettres dans l’ordre alphabétique', 'Put the letters back in alphabetical order'),
    }));
  }
  // Association glyphe ↔ nom (récap).
  if (group.length >= 2) {
    steps.push(makeMatchingPairs(ordre++, group.map((L) => ({ arabe: L.g, traduction: L.nom }))));
  }
  return steps;
}

interface LessonBlueprint {
  titre: { fr: string; en: string }; sourateNumero: number | null; steps: StepRow[];
  versetDebut?: number; versetFin?: number;
}

async function main() {
  const section = await prisma.section.findFirst({ where: { hizb: null } });
  if (!section) throw new Error('Section Alphabet (hizb null) introuvable');

  // Pool de distracteurs = toutes les traductions fr (QCM Fatiha plus variés).
  const allTrad = await prisma.versetTraduction.findMany({ where: { langue: FR }, select: { texte: true } });
  const pool = [...new Set(allTrad.map((t) => t.texte).filter((t) => t.length > 0))];

  const blueprints = await withRetry(async () => {
    const bps: LessonBlueprint[] = [];

    // 1) Leçons de lettres — les glyphes arabes sont identiques dans les deux langues.
    const chunks = chunkEven(LETTERS, LETTER_LESSONS);
    for (const group of chunks) {
      if (group.length === 0) continue;
      const titreGlyphes = group.map((l) => l.g).join(' ');
      bps.push({
        titre: i18n(titreGlyphes, titreGlyphes),
        sourateNumero: null,
        steps: buildLetterSteps(group),
      });
    }

    // 1bis) Leçons de harakat — entre l'alphabet et Al-Fatiha : une fois les
    // lettres connues, on apprend ce qui leur donne leur son (fatha/kasra/
    // damma/sukun/tanwin) avant d'aborder les versets. Les noms de signes
    // (Fatha, Kasra, Damma, Tanwin) sont des translittérations universelles ;
    // seuls "Soukoune" et "Révision des signes" ont un équivalent anglais distinct.
    bps.push({ titre: i18n('Fatha ـَ', 'Fatha ـَ'), sourateNumero: null, steps: buildSimpleHarakaSteps(HARAKA_LETTERS, FATHA) });
    bps.push({ titre: i18n('Kasra ـِ', 'Kasra ـِ'), sourateNumero: null, steps: buildSimpleHarakaSteps(HARAKA_LETTERS, KASRA) });
    bps.push({ titre: i18n('Damma ـُ', 'Damma ـُ'), sourateNumero: null, steps: buildSimpleHarakaSteps(HARAKA_LETTERS, DAMMA) });
    bps.push({ titre: i18n('Soukoune ـْ', 'Sukun ـْ'), sourateNumero: null, steps: buildSimpleHarakaSteps(HARAKA_LETTERS, SUKUN) });
    bps.push({ titre: i18n('Tanwin ـً ـٍ ـٌ', 'Tanwin ـً ـٍ ـٌ'), sourateNumero: null, steps: buildTanwinSteps(HARAKA_LETTERS.slice(0, 6)) });
    bps.push({ titre: i18n('Révision des signes', 'Signs review'), sourateNumero: null, steps: buildHarakaSummarySteps(HARAKA_LETTERS) });

    // 2) Al-Fatiha au format standard (1-2 versets/leçon) — "Al-Fātiha N" est un nom propre.
    const fatiha = await prisma.sourate.findUnique({ where: { numero: 1 } });
    if (fatiha) {
      const versets = await loadVersets(prisma, fatiha.id);
      for (const grp of groupVerses(versets)) {
        const nums = grp.map((v) => v.numero).join('-');
        const titreFatiha = `Al-Fātiha ${nums}`;
        bps.push({
          titre: i18n(titreFatiha, titreFatiha),
          sourateNumero: 1,
          steps: buildGroupSteps(grp, 1, pool),
          versetDebut: grp[0].numero,
          versetFin: grp[grp.length - 1]!.numero,
        });
      }
    }
    return bps;
  }, 'Alphabet — collecte');

  // 3) UPSERT en place par (sectionId, ordre) / (lessonId, ordre) — jamais de
  // deleteMany+recreate : ça préserverait le CONTENU mais changerait les ids
  // (Lesson.id, LessonStep.id), cassant LessonProgress/LettreRevision déjà
  // enregistrés pour des utilisateurs réels. Seules les positions en surplus
  // (au-delà du nouveau nombre de blueprints/steps) sont supprimées.
  const stepsTotal = await withRetry(async () => {
    const existingLessons = await prisma.lesson.findMany({
      where: { sectionId: section.id },
      select: { id: true, ordre: true },
    });
    const lessonIdByOrdre = new Map(existingLessons.map((l) => [l.ordre, l.id]));

    let total = 0;
    for (let i = 0; i < blueprints.length; i++) {
      const bp = blueprints[i]!;
      const ordre = i + 1;
      const lesson = await prisma.lesson.upsert({
        where: { sectionId_ordre: { sectionId: section.id, ordre } },
        update: {
          titre: bp.titre, sourateNumero: bp.sourateNumero,
          versetDebut: bp.versetDebut ?? null, versetFin: bp.versetFin ?? null,
        },
        create: {
          sectionId: section.id, ordre, titre: bp.titre, sourateNumero: bp.sourateNumero,
          versetDebut: bp.versetDebut ?? null, versetFin: bp.versetFin ?? null,
        },
      });
      lessonIdByOrdre.set(ordre, lesson.id);

      const existingSteps = await prisma.lessonStep.findMany({
        where: { lessonId: lesson.id },
        select: { id: true, ordre: true },
      });
      const stepIdByOrdre = new Map(existingSteps.map((s) => [s.ordre, s.id]));

      for (const s of bp.steps) {
        await prisma.lessonStep.upsert({
          where: { lessonId_ordre: { lessonId: lesson.id, ordre: s.ordre } },
          update: { type: s.type, payload: s.payload },
          create: { lessonId: lesson.id, ordre: s.ordre, type: s.type, payload: s.payload },
        });
        total++;
      }
      // Supprime les étapes en surplus (positions au-delà du nouveau compte).
      const staleStepOrdres = [...stepIdByOrdre.keys()].filter((o) => o > bp.steps.length);
      if (staleStepOrdres.length > 0) {
        await prisma.lessonStep.deleteMany({
          where: { lessonId: lesson.id, ordre: { in: staleStepOrdres } },
        });
      }
    }

    // Supprime les leçons en surplus (positions au-delà du nouveau compte de blueprints).
    const staleLessonOrdres = [...lessonIdByOrdre.keys()].filter((o) => o > blueprints.length);
    if (staleLessonOrdres.length > 0) {
      await prisma.lesson.deleteMany({
        where: { sectionId: section.id, ordre: { in: staleLessonOrdres } },
      });
    }

    return total;
  }, 'Alphabet — écriture');

  blueprints.forEach((bp, i) => {
    console.log(`  ✓ Leçon ${i + 1}: ${bp.titre.fr} — ${bp.steps.length} étapes`);
  });
  const fatihaCount = blueprints.filter((b) => b.sourateNumero === 1).length;
  const harakaCount = blueprints.length - LETTER_LESSONS - fatihaCount;
  console.log(`\n✓ Section 1: ${LETTERS.length} lettres sur ${LETTER_LESSONS} leçons + ${harakaCount} leçons de harakat + Al-Fatiha (${fatihaCount} leçons), ${stepsTotal} étapes`);
}

main()
  .catch((e) => { console.error('❌', e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
