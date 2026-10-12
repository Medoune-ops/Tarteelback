import 'dotenv/config';

/**
 * Ticket 0.B1 — garde-fou base de données.
 *
 * La base de PRODUCTION a DÉJÀ été effacée deux fois : un `.env` local pointait
 * sur le VPS de prod pendant un `RUN_DB_TESTS=1` (TRUNCATE CASCADE), un
 * `prisma migrate reset` ou un seed. On rend désormais l'erreur impossible :
 * toute commande DESTRUCTIVE est refusée tant que l'hôte de DATABASE_URL ne
 * ressemble pas EXPLICITEMENT à un environnement local/test.
 *
 * Règle produit (ticket 0.B1) :
 *   - local  : npm run db:up (docker compose) → hôte localhost/127.0.0.1 ;
 *   - prod   : UNIQUEMENT `prisma migrate deploy` (jamais dev/reset/seed) ;
 *   - jamais de allowlist trop permissive : un hôte de prod contenant "test"
 *     ne doit PAS passer. Seul DB_TEST_HOSTS peut autoriser un hôte nommé.
 */

/** Hôtes toujours considérés comme locaux (jamais la prod). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Normalise un hôte : minuscules, sans crochets IPv6. */
function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, '').toLowerCase();
}

/** Hôte de DATABASE_URL, ou `null` si l'URL est absente/illisible. */
export function databaseHost(url: string | undefined = process.env.DATABASE_URL): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname ? normalizeHost(parsed.hostname) : null;
  } catch {
    // URL non parseable : on ne prend AUCUN risque, on bloquera.
    return null;
  }
}

/** Hôtes explicitement autorisés en plus du localhost (DB_TEST_HOSTS=a,b). */
export function extraAllowedHosts(raw: string | undefined = process.env.DB_TEST_HOSTS): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => normalizeHost(h.trim()))
    .filter((h) => h.length > 0);
}

/** Vrai si l'hôte correspond à un environnement local/test connu. */
export function isSafeDatabaseHost(host: string | null, extra: string[] = extraAllowedHosts()): boolean {
  if (!host) return false;
  return LOCAL_HOSTS.has(host) || extra.includes(host);
}

/**
 * Refuse la commande `command` si DATABASE_URL ne pointe pas vers un
 * environnement local/test. Lève une Error explicite (à catcher par le CLI).
 */
export function assertSafeDatabase(command: string): void {
  const host = databaseHost();
  if (isSafeDatabaseHost(host)) return;

  throw new Error(
    [
      `⛔ DB guard (ticket 0.B1) : « ${command} » REFUSÉE.`,
      `   DATABASE_URL pointe vers l'hôte « ${host ?? '(absent ou illisible)'} »,`,
      `   qui ne ressemble PAS à une base locale/test.`,
      `   La prod a déjà été effacée deux fois via ces commandes.`,
      '',
      `   Base locale : npm run db:up`,
      `     DATABASE_URL=postgresql://tarteel:tarteel@localhost:5432/tarteel?schema=public`,
      `   Hôte nommé explicitement autorisé : l'ajouter à DB_TEST_HOSTS (séparé par des virgules).`,
      `   En prod, on n'utilise QUE : npm run prisma:deploy (prisma migrate deploy).`,
    ].join('\n'),
  );
}
