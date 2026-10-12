/**
 * Ticket 0.B1 — wrapper CLI de la garde DB.
 *
 * Usage (voir package.json) :
 *   tsx scripts/guard-db.ts <libellé de la commande>
 *
 * Sortie 0 si DATABASE_URL pointe vers un environnement local/test, 1 sinon
 * (et la commande suivante du script npm n'est alors jamais exécutée).
 */
import { assertSafeDatabase, databaseHost } from '../src/config/dbGuard.js';

const label = process.argv.slice(2).join(' ') || 'commande destructive';

try {
  assertSafeDatabase(label);
  // eslint-disable-next-line no-console
  console.log(`✅ DB guard : hôte « ${databaseHost()} » OK — « ${label} » autorisée.`);
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
