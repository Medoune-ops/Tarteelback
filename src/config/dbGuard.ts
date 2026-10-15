import 'dotenv/config';

/**
 * Ticket 0.B1 — garde-fou base de données.
 *
 * La base de PRODUCTION a déjà été effacée deux fois : un `.env` local pointait
 * sur le VPS de prod pendant un `RUN_DB_TESTS=1` (TRUNCATE CASCADE), un
 * `prisma migrate reset` ou un seed. On rend désormais l'erreur impossible :
 * toute commande DESTRUCTIVE est refusée tant que l'hôte de DATABASE_URL ne
 * ressemble pas EXPLICITEMENT à un environnement local/test.
 *
 * Règle : localhost / 127.0.0.1 / ::1 sont toujours sûrs ; tout autre hôte
 * nécessite une entrée explicite dans DB_TEST_HOSTS. Un hôte nommé contenant
 * « test » ne suffit plus (régression historique).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, '').toLowerCase();
}

export function databaseHost(url: string | undefined = process.env.DATABASE_URL): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname ? normalizeHost(parsed.hostname) : null;
  } catch {
    return null;
  }
}

export function extraAllowedHosts(raw: string | undefined = process.env.DB_TEST_HOSTS): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => normalizeHost(h.trim()))
    .filter((h) => h.length > 0);
}

export function isSafeDatabaseHost(host: string | null, extra: string[] = extraAllowedHosts()): boolean {
  if (!host) return false;
  return LOCAL_HOSTS.has(host) || extra.includes(host);
}

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
