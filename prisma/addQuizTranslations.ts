/**
 * Traduit les QUIZ (étapes `written`) en anglais, sans fausser la correction.
 *
 * Le problème
 * -----------
 * Les 4 propositions d'un quiz sont stockées en texte FRANÇAIS figé dans
 * `payload.options[].text`. La consigne, elle, était déjà bilingue — d'où
 * l'écran constaté sur appareil : « What does this verse mean? » au-dessus de
 * quatre réponses en français.
 *
 * Pourquoi on ne peut pas simplement traduire les propositions existantes
 * ----------------------------------------------------------------------
 * Ce sont des traductions du Coran : les traduire soi-même inventerait une
 * version qui n'existe nulle part, et le même verset s'afficherait différemment
 * selon l'écran. Il faut donc réutiliser la traduction de référence déjà en
 * base (Sahih International).
 *
 * Mais les relier par le texte français ÉCHOUE : les quiz ont été générés
 * depuis une autre traduction française que celle stockée aujourd'hui.
 * Mesuré sur un quiz réel : 1 correspondance sur 4, même avec une comparaison
 * insensible aux accents et à la ponctuation.
 *
 *     Table (Hamidullah) : « Dis: «Il est Allah, Unique. »
 *     Quiz               : « Dis : « Il est Allah, l'Un. »
 *
 * La solution
 * -----------
 * On ne traduit pas : on REPIOCHE. La bonne réponse est retrouvée par le TEXTE
 * ARABE du verset affiché (méthode fiable, déjà validée), et les 3 distracteurs
 * sont tirés au hasard parmi les traductions anglaises de la base — exactement
 * ce que fait le générateur avec le français.
 *
 * Ce qui est garanti
 * ------------------
 *  - `bonneReponse` n'est JAMAIS modifiée : la bonne traduction anglaise est
 *    placée sur la MÊME lettre (A/B/C/D) que la bonne réponse française. Le
 *    serveur juge sur l'identifiant d'option, pas sur le texte
 *    (`answer.optionId === p.bonneReponse`, voir src/core/lessonJudge.ts) ;
 *  - le français existant est conservé tel quel dans la clé `fr` ;
 *  - seul `options[].text` est réécrit ; consigne, arabe, translittération et
 *    tout le reste du payload sont recopiés à l'identique ;
 *  - aucune étape n'est créée ni supprimée : aucune progression n'est affectée ;
 *  - idempotent : une option déjà au format {fr, en} est ignorée.
 *
 * Conséquence assumée : les 3 distracteurs anglais diffèrent des français. Sans
 * importance — un lecteur ne voit qu'une seule langue, et ce sont de toute
 * façon des versets tirés au hasard.
 *
 * Usage
 * -----
 *   npx tsx prisma/addQuizTranslations.ts --dry-run
 *   npx tsx prisma/addQuizTranslations.ts --limit=200
 *   npx tsx prisma/addQuizTranslations.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

type Payload = Record<string, unknown>;
type Option = { id: string; text: unknown };

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

/**
 * Clé de correspondance sur le texte arabe : réduite au squelette
 * consonantique, seul élément stable entre la table Verset et les payloads
 * (graphies et diacritiques diffèrent d'une source à l'autre).
 */
function key(arabe: string): string {
  return arabe
    .normalize('NFC')
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/** La Basmala préfixe le verset 1 en base, jamais l'étape de leçon. */
const BASMALA_KEY = key('بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ');

function keyVariants(arabe: string): string[] {
  const k = key(arabe);
  const out = [k];
  if (k.startsWith(BASMALA_KEY + ' ')) out.push(k.slice(BASMALA_KEY.length + 1));
  return out;
}

/** Tire `n` textes distincts du pool, en excluant `correct`. */
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

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limit = arg('limit') ? Number(arg('limit')) : undefined;

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit doit être un entier positif, reçu : ${arg('limit')}`);
  }

  console.log(dryRun ? 'MODE SIMULATION — aucune écriture.\n' : 'Mode réel.\n');

  console.log('Chargement des traductions anglaises…');
  const versets = await prisma.verset.findMany({
    select: { texteArabe: true, traductions: { where: { langue: 'en' }, select: { texte: true } } },
  });

  const enByArabe = new Map<string, string>();
  const pool: string[] = [];
  for (const v of versets) {
    const en = v.traductions[0]?.texte;
    if (!en) continue;
    pool.push(en);
    for (const variant of keyVariants(v.texteArabe)) {
      if (!enByArabe.has(variant)) enByArabe.set(variant, en);
    }
  }
  console.log(`  ${pool.length} traductions anglaises (pool de distracteurs).\n`);

  if (pool.length === 0) {
    throw new Error(
      'Aucune traduction anglaise en base. Lancer d’abord :\n' +
      '  npx tsx prisma/addMissingTranslations.ts --lang=en',
    );
  }

  const steps = await prisma.lessonStep.findMany({
    where: { type: 'written' },
    select: { id: true, payload: true },
    orderBy: { id: 'asc' },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`${steps.length} quiz à examiner…`);

  let updated = 0;
  let already = 0;
  let unmatched = 0;
  let skipped = 0;

  for (const step of steps) {
    const payload = { ...(step.payload as Payload) };
    const options = payload.options as Option[] | undefined;
    const bonneReponse = payload.bonneReponse;

    if (!Array.isArray(options) || typeof bonneReponse !== 'string') { skipped++; continue; }
    if (options.some((o) => o.text && typeof o.text === 'object')) { already++; continue; }
    if (typeof payload.arabe !== 'string') { unmatched++; continue; }

    // Traduction anglaise du verset affiché = la BONNE réponse.
    let correctEn: string | undefined;
    for (const variant of keyVariants(payload.arabe)) {
      correctEn = enByArabe.get(variant);
      if (correctEn) break;
    }
    if (!correctEn) { unmatched++; continue; }

    const distract = pickDistractors(pool, correctEn, options.length - 1);
    if (distract.length < options.length - 1) { unmatched++; continue; }

    // La bonne réponse anglaise va sur la MÊME lettre que la française ;
    // les autres reçoivent les distracteurs dans l'ordre. `bonneReponse`
    // reste donc valide sans être touchée.
    let d = 0;
    const newOptions = options.map((o) => ({
      ...o,
      text: {
        fr: typeof o.text === 'string' ? o.text : String(o.text ?? ''),
        en: o.id === bonneReponse ? correctEn! : distract[d++]!,
      },
    }));

    if (!dryRun) {
      await prisma.lessonStep.update({
        where: { id: step.id },
        data: { payload: { ...payload, options: newOptions } as Prisma.InputJsonValue },
      });
    }
    updated++;
  }

  console.log('\n─────────────────────────────');
  console.log(`Quiz ${dryRun ? 'à mettre à jour' : 'mis à jour'} : ${updated}`);
  console.log(`Déjà au format {fr,en}      : ${already}`);
  if (unmatched) console.log(`Verset arabe introuvable    : ${unmatched}`);
  if (skipped) console.log(`Payload inattendu (ignoré)  : ${skipped}`);
  console.log(dryRun ? '\nSimulation terminée — rien n’a été écrit.' : '\nTerminé.');
}

main()
  .catch((e) => {
    console.error('ÉCHEC :', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
