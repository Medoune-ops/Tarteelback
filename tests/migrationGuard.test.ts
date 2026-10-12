import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  scanMigrationSql,
  findDestructiveMigrations,
  stripSqlComments,
  formatViolations,
  KNOWN_DESTRUCTIVE_MIGRATIONS,
  type MigrationFile,
} from '../src/config/migrationGuard.js';

describe('migration guard (règle 7 — migrations additives)', () => {
  it('détecte les opérations destructives', () => {
    expect(scanMigrationSql('DROP TABLE "Foo";')).toContain('DROP TABLE');
    expect(scanMigrationSql('ALTER TABLE "User" DROP COLUMN "xp";')).toContain('DROP COLUMN');
    expect(scanMigrationSql('TRUNCATE "User" CASCADE;')).toContain('TRUNCATE');
    expect(scanMigrationSql('DELETE FROM "Session";')).toContain('DELETE FROM');
    expect(scanMigrationSql('ALTER TABLE "A" ALTER COLUMN "b" TYPE JSONB;')).toContain(
      'ALTER COLUMN ... TYPE',
    );
  });

  it('ignore les opérations additives', () => {
    const additive = `
      CREATE TABLE "XpEvent" ("id" TEXT PRIMARY KEY);
      ALTER TABLE "User" ADD COLUMN "weeklyXp" INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX "XpEvent_userId_idx" ON "XpEvent"("userId");
    `;
    expect(scanMigrationSql(additive)).toEqual([]);
  });

  it('ne se laisse pas piéger par un commentaire', () => {
    const sql = '-- ne jamais faire un DROP TABLE ici\nADD COLUMN "ok" TEXT;';
    expect(stripSqlComments(sql)).not.toContain('DROP TABLE');
    expect(scanMigrationSql(sql)).toEqual([]);
  });

  it('grandfather les migrations historiques', () => {
    const files: MigrationFile[] = [
      { name: '20260630_remove_google_oauth', sql: 'ALTER TABLE "User" DROP COLUMN "googleId";' },
      { name: '20990101_new_cleanup', sql: 'DROP TABLE "Old";' },
    ];
    const violations = findDestructiveMigrations(files);
    expect(violations.map((v) => v.name)).toEqual(['20990101_new_cleanup']);
    expect(formatViolations(violations)).toContain('20990101_new_cleanup');
  });

  it('le dépôt réel ne contient aucune migration destructive hors allowlist', () => {
    const dir = join(process.cwd(), 'prisma', 'migrations');
    const files: MigrationFile[] = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const sqlPath = join(dir, e.name, 'migration.sql');
        return { name: e.name, sql: existsSync(sqlPath) ? readFileSync(sqlPath, 'utf8') : '' };
      });
    expect(files.length).toBeGreaterThan(0);
    expect(findDestructiveMigrations(files)).toEqual([]);
    // Sanity : l'allowlist ne référence pas de dossier disparu (sinon elle
    // masquerait silencieusement plus tard).
    const names = new Set(files.map((f) => f.name));
    for (const allowed of KNOWN_DESTRUCTIVE_MIGRATIONS) {
      expect(names.has(allowed)).toBe(true);
    }
  });
});
