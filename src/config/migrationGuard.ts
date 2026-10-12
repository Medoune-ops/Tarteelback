/**
 * Ticket 0.B7 — garde-fou « migrations additives uniquement » (règle 7).
 *
 * Une migration ne doit JAMAIS détruire de données ni de colonne/table déjà en
 * production : on AJOUTE (colonnes nullables, nouvelles tables/index), on ne
 * retire pas. Une colonne qu'on ne veut plus se laisse en place (nullable /
 * défaut) jusqu'à une migration dédiée et validée.
 *
 * Ce module est PUR (pas d'accès disque) pour rester testable ; le CLI
 * `scripts/guard-migrations.ts` lit le dossier prisma/migrations et l'applique.
 *
 * Historique : 3 migrations antérieures à la règle restent destructives. Elles
 * sont figées dans KNOWN_DESTRUCTIVE_MIGRATIONS : le passé ne se réécrit pas,
 * mais toute NOUVELLE migration destructive est refusée.
 */

export interface DestructivePattern {
  /** Libellé lisible de l'opération interdite. */
  name: string;
  /** Expression recherchée dans le SQL (insensible à la casse). */
  regex: RegExp;
}

/** Opérations qui font perdre données ou schéma : interdites dans une migration. */
export const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
  { name: 'DROP TABLE', regex: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN', regex: /\bDROP\s+COLUMN\b/i },
  { name: 'DROP TYPE', regex: /\bDROP\s+TYPE\b/i },
  { name: 'TRUNCATE', regex: /\bTRUNCATE\b/i },
  { name: 'DELETE FROM', regex: /\bDELETE\s+FROM\b/i },
  // Changement de type de colonne : destructif s'il y a une conversion.
  { name: 'ALTER COLUMN ... TYPE', regex: /\bALTER\s+COLUMN\b[^;]*?\bTYPE\b/i },
];

/**
 * Migrations antérieures à la règle 7, conservées telles quelles (on ne
 * réécrit pas l'histoire). Aucune NOUVELLE entrée ne doit être ajoutée ici sans
 * validation explicite.
 */
export const KNOWN_DESTRUCTIVE_MIGRATIONS: ReadonlySet<string> = new Set([
  '20260630_remove_google_oauth',
  '20260707224215_remove_lifetime_xp_use_weekly_xp_only',
  '20260714104748_section_lesson_titre_i18n',
]);

/** Retire les commentaires SQL (-- ligne et /* bloc *\/) avant analyse. */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ');
}

/** Renvoie les opérations destructives trouvées dans un migration.sql. */
export function scanMigrationSql(sql: string): string[] {
  const cleaned = stripSqlComments(sql);
  return DESTRUCTIVE_PATTERNS.filter((p) => p.regex.test(cleaned)).map((p) => p.name);
}

export interface MigrationFile {
  /** Nom du dossier de migration (ex. « 20261009120000_friends_foundations »). */
  name: string;
  /** Contenu de migration.sql. */
  sql: string;
}

export interface MigrationViolation {
  name: string;
  patterns: string[];
}

/**
 * Renvoie les migrations destructives NON grandfathered. Une migration de
 * l'allowlist est ignorée même si elle est destructive (historique figé).
 */
export function findDestructiveMigrations(
  files: MigrationFile[],
  allowlist: ReadonlySet<string> = KNOWN_DESTRUCTIVE_MIGRATIONS,
): MigrationViolation[] {
  const violations: MigrationViolation[] = [];
  for (const file of files) {
    if (allowlist.has(file.name)) continue;
    const patterns = scanMigrationSql(file.sql);
    if (patterns.length > 0) violations.push({ name: file.name, patterns });
  }
  return violations;
}

/** Message d'erreur lisible listant les migrations fautives. */
export function formatViolations(violations: MigrationViolation[]): string {
  const lines = violations.map((v) => `   - ${v.name} → ${v.patterns.join(', ')}`);
  return [
    `⛔ Migration guard (ticket 0.B7) : ${violations.length} migration(s) destructive(s) détectée(s).`,
    `   Règle 7 : une migration AJOUTE, elle ne détruit pas.`,
    ...lines,
    '',
    `   Retire les opérations DROP/TRUNCATE/DELETE/ALTER TYPE, ou (cas exceptionnel`,
    `   et validé) ajoute la migration à KNOWN_DESTRUCTIVE_MIGRATIONS.`,
  ].join('\n');
}
