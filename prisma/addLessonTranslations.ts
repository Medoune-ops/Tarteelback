/**
 * Ajoute la traduction ANGLAISE dans les étapes de leçon, sans rien perdre.
 *
 * Le problème
 * -----------
 * La traduction affichée pendant une leçon n'est PAS lue dans VersetTraduction :
 * c'est une COPIE figée dans le payload de chaque étape au moment où les leçons
 * ont été générées (voir prisma/lessonBuilder.ts, `loadVersets` qui ne charge
 * que `langue: FR`). Remplir la table des versets en anglais ne change donc rien
 * à l'affichage des leçons — constaté sur appareil : interface en anglais, sens
 * du verset en français.
 *
 * Ce que fait ce script
 * ---------------------
 * Il transforme le champ `traduction` de chaque payload :
 *
 *     "Roi des hommes,"
 *  -> { fr: "Roi des hommes,", en: "Sovereign of mankind." }
 *
 * `resolveI18n` (content.serializer.ts) sait déjà lire ce format et choisit la
 * langue demandée, avec repli sur le français. Aucun changement côté app.
 *
 * Ce qui est garanti
 * ------------------
 *  - le français existant est CONSERVÉ tel quel dans la clé `fr` ;
 *  - seul le champ `traduction` est réécrit — arabe, audio, mots, réponses,
 *    translittération et tout le reste du payload sont recopiés à l'identique ;
 *  - la STRUCTURE des leçons ne bouge pas (aucune étape créée ou supprimée),
 *    donc aucune progression utilisateur n'est affectée ;
 *  - idempotent : une étape déjà au format {fr, en} est ignorée.
 *
 * Le rattachement au bon verset se fait par le TEXTE ARABE, présent dans chaque
 * payload — pas par un identifiant, que le payload ne porte pas.
 *
 * Usage
 * -----
 *   npx tsx prisma/addLessonTranslations.ts --dry-run        # simulation
 *   npx tsx prisma/addLessonTranslations.ts --limit=200      # par lots
 *   npx tsx prisma/addLessonTranslations.ts                  # tout
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

type Payload = Record<string, unknown>;

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

/** Normalise un texte arabe pour servir de clé de correspondance. */
function key(arabe: string): string {
  return arabe.replace(/\s+/g, ' ').trim();
}

/**
 * Convertit une valeur de traduction au format {fr, en}.
 * Renvoie null si rien ne doit changer (déjà converti, ou pas d'anglais connu).
 */
function toI18n(
  value: unknown,
  arabe: unknown,
  enByArabe: Map<string, string>,
): { fr: string; en: string } | null {
  if (typeof value !== 'string' || !value) return null; // déjà objet, ou vide
  if (typeof arabe !== 'string' || !arabe) return null; // pas de clé de rattachement
  const en = enByArabe.get(key(arabe));
  if (!en) return null;
  return { fr: value, en };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limit = arg('limit') ? Number(arg('limit')) : undefined;

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit doit être un entier positif, reçu : ${arg('limit')}`);
  }

  console.log(dryRun ? 'MODE SIMULATION — aucune écriture.\n' : 'Mode réel.\n');

  // Index texte arabe -> traduction anglaise, depuis VersetTraduction.
  console.log('Chargement des traductions anglaises depuis la base…');
  const versets = await prisma.verset.findMany({
    select: { texteArabe: true, traductions: { where: { langue: 'en' }, select: { texte: true } } },
  });
  const enByArabe = new Map<string, string>();
  for (const v of versets) {
    const en = v.traductions[0]?.texte;
    if (en) enByArabe.set(key(v.texteArabe), en);
  }
  console.log(`  ${enByArabe.size} versets avec traduction anglaise.\n`);

  if (enByArabe.size === 0) {
    throw new Error(
      'Aucune traduction anglaise en base. Lancer d’abord :\n' +
      '  npx tsx prisma/addMissingTranslations.ts --lang=en',
    );
  }

  const steps = await prisma.lessonStep.findMany({
    select: { id: true, type: true, payload: true },
    orderBy: { id: 'asc' },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`${steps.length} étapes à examiner…`);

  let updated = 0;
  let already = 0;
  let unmatched = 0;
  let untouched = 0;

  for (const step of steps) {
    const payload = { ...(step.payload as Payload) };
    let changed = false;

    // 1) Traduction au premier niveau (discovery, voice).
    if (typeof payload.traduction === 'string') {
      const conv = toI18n(payload.traduction, payload.arabe, enByArabe);
      if (conv) { payload.traduction = conv; changed = true; }
      else unmatched++;
    } else if (payload.traduction && typeof payload.traduction === 'object') {
      already++;
    }

    // 2) Traductions imbriquées dans les paires (matching).
    if (Array.isArray(payload.paires)) {
      const paires = (payload.paires as Payload[]).map((paire) => {
        if (typeof paire?.traduction !== 'string') return paire;
        const conv = toI18n(paire.traduction, paire.arabe, enByArabe);
        if (!conv) { unmatched++; return paire; }
        changed = true;
        return { ...paire, traduction: conv };
      });
      if (changed) payload.paires = paires;
    }

    if (!changed) { untouched++; continue; }

    if (!dryRun) {
      // SEUL champ réécrit : payload. Tout le reste de la ligne est intact,
      // et le payload lui-même est une copie où seules les traductions changent.
      await prisma.lessonStep.update({
        where: { id: step.id },
        // `payload` est une colonne Json : Prisma attend InputJsonValue, que
        // Record<string, unknown> ne satisfait pas structurellement.
        data: { payload: payload as Prisma.InputJsonValue },
      });
    }
    updated++;
  }

  console.log('\n─────────────────────────────');
  console.log(`Étapes ${dryRun ? 'à mettre à jour' : 'mises à jour'} : ${updated}`);
  console.log(`Déjà au format {fr,en}          : ${already}`);
  console.log(`Sans traduction à convertir     : ${untouched}`);
  if (unmatched) console.log(`Arabe sans correspondance       : ${unmatched}`);
  console.log(dryRun ? '\nSimulation terminée — rien n’a été écrit.' : '\nTerminé.');
}

main()
  .catch((e) => {
    console.error('ÉCHEC :', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
