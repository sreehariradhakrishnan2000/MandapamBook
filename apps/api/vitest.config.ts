import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
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
