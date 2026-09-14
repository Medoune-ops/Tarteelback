/**
 * Ajoute UNIQUEMENT les traductions manquantes. N'écrase jamais rien.
 *
 * Pourquoi ce script existe à côté de importQuran.ts
 * --------------------------------------------------
 * `importQuran.ts` avec FORCE_REIMPORT=1 remplirait bien l'anglais, mais il
 * fait aussi, sur CHAQUE verset traité :
 *   - verset.upsert()        → réécrit le texte arabe et l'URL audio
 *   - versetMot.deleteMany() → EFFACE les mots avant de les recréer
 *   - versetTraduction.deleteMany({ langue }) → efface avant de réécrire
 *
 * Sur une base de production déjà correcte, c'est un risque inutile : si
 * l'API renvoie une réponse partielle au mauvais moment, on remplace du
 * contenu valide par du contenu dégradé — et la suppression des mots ouvre
 * une fenêtre où la donnée n'existe plus.
 *
 * Ce script-ci ne fait qu'AJOUTER. Il ne contient aucun delete, aucun update,
 * aucun upsert. La seule écriture possible est la création d'une ligne de
 * traduction pour un verset qui n'en a pas dans la langue demandée. Tout le
 * reste — texte arabe, audio, mots, traductions existantes — est intouchable
 * par construction, pas par précaution.
 *
 * Usage
 * -----
 *   npx tsx prisma/addMissingTranslations.ts --lang=en --limit=5
 *   npx tsx prisma/addMissingTranslations.ts --lang=en           # tout le Coran
 *   npx tsx prisma/addMissingTranslations.ts --lang=en --dry-run # simulation
 *
 * `--limit=N` traite les N DERNIÈRES sourates (114, 113, …), c'est-à-dire le
 * Juz Amma d'abord — le même ordre que le parcours de l'app, donc ce que les
 * utilisateurs voient en premier.
 *
 * Idempotent : relancer ne crée pas de doublon (les versets déjà traduits
 * sont ignorés).
 */
import { PrismaClient } from '@prisma/client';
import { AlQuranCloudClient } from './alquranCloudClient.js';

/**
 * ⚠️ NE PAS importer `../src/config/env.js` ici.
 *
 * L'image de production ne contient PAS `src/` : le Dockerfile ne recopie que
 * `dist/`, `prisma/`, `node_modules/` et `package*.json`. Un import vers `src/`
 * fait échouer le script au démarrage dans le conteneur
 * (ERR_MODULE_NOT_FOUND '/app/src/config/env.js'), alors qu'il fonctionne en
 * local — constaté sur le serveur.
 *
 * Ce script n'a besoin que de deux URLs publiques, lues directement depuis
 * l'environnement avec les mêmes valeurs par défaut que src/config/env.ts.
 */
const API_BASE = process.env.ALQURAN_CLOUD_API_BASE ?? 'https://api.alquran.cloud/v1';
const CDN_BASE = process.env.ALQURAN_CLOUD_CDN_BASE ?? 'https://cdn.islamic.network';

const prisma = new PrismaClient();

/** Éditions sources, pour renseigner le champ `source` de chaque ligne. */
const SOURCES: Record<string, string> = {
  fr: 'alquran.cloud#fr.hamidullah',
  en: 'alquran.cloud#en.sahih',
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}

async function main() {
  const lang = arg('lang') ?? 'en';
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const dryRun = process.argv.includes('--dry-run');

  if (!SOURCES[lang]) {
    throw new Error(`Langue non supportée : ${lang} (attendu : ${Object.keys(SOURCES).join(', ')})`);
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit doit être un entier positif, reçu : ${arg('limit')}`);
  }

  console.log(`Langue : ${lang} (${SOURCES[lang]})`);
  console.log(`Portée : ${limit ? `${limit} dernières sourates` : 'tout le Coran'}`);
  if (dryRun) console.log('MODE SIMULATION — aucune écriture ne sera faite.\n');
  else console.log('Mode réel — seules des traductions MANQUANTES seront créées.\n');

  const client = new AlQuranCloudClient(API_BASE, CDN_BASE);
  console.log('Téléchargement des traductions depuis Al Quran Cloud…');
  // Le récitateur ne sert qu'à construire les URLs audio, dont ce script ne
  // fait rien : il n'écrit que du texte.
  const verses = await client.allVerses('alafasy');

  // Index (sourate, verset) -> texte traduit, pour un accès direct ensuite.
  const byKey = new Map<string, string>();
  for (const v of verses) {
    const texte = lang === 'fr' ? v.translationFr : v.translationEn;
    if (texte) byKey.set(`${v.numeroSourate}:${v.verseNumber}`, texte);
  }
  console.log(`  ${byKey.size} versets traduits disponibles.\n`);

  // Sourates ciblées, de la dernière vers la première (Juz Amma d'abord).
  const sourates = await prisma.sourate.findMany({
    select: { id: true, numero: true, nom: true },
    orderBy: { numero: 'desc' },
    ...(limit ? { take: limit } : {}),
  });

  let created = 0;
  let already = 0;
  let missingSource = 0;

  for (const s of sourates) {
    // Les versets de cette sourate qui n'ont AUCUNE traduction dans `lang`.
    const versets = await prisma.verset.findMany({
      where: {
        sourateId: s.id,
        traductions: { none: { langue: lang } },
      },
      select: { id: true, numero: true },
      orderBy: { numero: 'asc' },
    });

    const total = await prisma.verset.count({ where: { sourateId: s.id } });
    already += total - versets.length;

    if (versets.length === 0) {
      console.log(`  ${String(s.numero).padStart(3)} ${s.nom} — déjà complet (${total} versets)`);
      continue;
    }

    let n = 0;
    for (const v of versets) {
      const texte = byKey.get(`${s.numero}:${v.numero}`);
      if (!texte) {
        missingSource++;
        continue;
      }
      if (!dryRun) {
        // SEULE écriture du script : une création, jamais un update.
        await prisma.versetTraduction.create({
          data: { versetId: v.id, langue: lang, texte, source: SOURCES[lang]! },
        });
      }
      n++;
    }
    created += n;
    console.log(
      `  ${String(s.numero).padStart(3)} ${s.nom} — ${dryRun ? 'à créer' : 'créées'} : ${n}/${total}`,
    );
  }

  console.log('\n─────────────────────────────');
  console.log(`Traductions ${dryRun ? 'à créer' : 'créées'} : ${created}`);
  console.log(`Déjà présentes (intactes)   : ${already}`);
  if (missingSource) console.log(`Absentes de la source       : ${missingSource}`);
  console.log(dryRun ? '\nSimulation terminée — rien n’a été écrit.' : '\nTerminé.');
}

main()
  .catch((e) => {
    console.error('ÉCHEC :', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
