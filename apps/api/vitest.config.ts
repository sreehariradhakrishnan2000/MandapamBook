import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup/load-env.ts'],
    // Resets the *_test database and applies migrations once per run (skipped without TEST_DATABASE_URL).
    globalSetup: ['test/setup/global-db.ts'],
    // DB tests share one database; run files one at a time to keep them independent.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/db/migrations/**', 'src/db/seed/run.ts', 'src/server.ts'],
      reporter: ['text', 'lcov'],
      // Per-module gates for the security- and money-critical modules (added in later phases).
      thresholds: {
        'src/modules/auth/**': { lines: 80, branches: 80, functions: 80, statements: 80 },
        'src/modules/bookings/**': { lines: 80, branches: 80, functions: 80, statements: 80 },
        'src/modules/payments/**': { lines: 80, branches: 80, functions: 80, statements: 80 },
      },
    },
  },
});
