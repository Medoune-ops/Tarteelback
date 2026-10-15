import { assertSafeDatabase } from '../../src/config/dbGuard.js';

/**
 * Ticket 0.B1 — garde DB au niveau du runner de tests.
 *
 * Dès que les tests d'intégration sont activés (RUN_DB_TESTS=1), on vérifie
 * AVANT tout worker que DATABASE_URL pointe vers un environnement local/test.
 * Un run `RUN_DB_TESTS=1` contre la prod échoue donc immédiatement, sans jamais
 * atteindre le moindre TRUNCATE.
 */
export default function globalSetup(): void {
  if (process.env.RUN_DB_TESTS === '1') {
    assertSafeDatabase("RUN_DB_TESTS=1 (tests d'intégration)");
  }
}
