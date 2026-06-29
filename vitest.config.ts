import { defineConfig } from 'vitest/config';

const DB = process.env.RUN_DB_TESTS === '1';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Ensure the app sees test mode (relaxes rate limits so the shared Redis
    // bucket isn't exhausted by the whole suite hitting auth from one IP).
    env: { NODE_ENV: 'test' },
    // Integration tests hit Postgres and run argon2 (CPU-heavy) — give the
    // hooks/tests generous timeouts and run files sequentially so the forks
    // don't fight over the single DB + CPU. Pure-logic tests are unaffected.
    hookTimeout: DB ? 60_000 : 10_000,
    testTimeout: DB ? 30_000 : 5_000,
    // DB/Redis are shared singletons; integration test files must NOT run
    // concurrently or one file's resetDb()/flushdb() truncates another's data.
    // So in DB mode we disable file parallelism and cap to ONE fork at a time —
    // but keep per-FILE isolation (a fresh module graph per file) so global
    // mocks (e.g. a spied `fetch`) never leak across files.
    fileParallelism: !DB,
    pool: 'forks',
    poolOptions: {
      forks: DB ? { minForks: 1, maxForks: 1, isolate: true } : {},
    },
  },
});
