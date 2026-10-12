/**
 * Ticket 0.B7 — CLI de la garde « migrations additives uniquement » (règle 7).
 *
 * Usage : npm run migrations:guard
 * Parcourt prisma/migrations/<dossier>/migration.sql et refuse toute migration
 * destructive qui ne serait pas explicitement grandfathered.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  findDestructiveMigrations,
  formatViolations,
  type MigrationFile,
} from '../src/config/migrationGuard.js';

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

if (!existsSync(migrationsDir)) {
  // eslint-disable-next-line no-console
  console.error(`⛔ Dossier introuvable : ${migrationsDir}`);
  process.exit(1);
}

const files: MigrationFile[] = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const sqlPath = join(migrationsDir, entry.name, 'migration.sql');
    return { name: entry.name, sql: existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : '' };
  });

const violations = findDestructiveMigrations(files);

if (violations.length > 0) {
  // eslint-disable-next-line no-console
  console.error(formatViolations(violations));
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(`✅ Migration guard : ${files.length} migration(s), aucune destructive non validée.`);
