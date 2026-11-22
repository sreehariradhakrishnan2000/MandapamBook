import { test as base, expect } from '@playwright/test';

/**
 * Every journey fails on uncaught page errors and console errors, so a broken screen
 * cannot pass just because the assertion targets happen to be elsewhere.
 */
export const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on('page', (p) => {
        p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
        p.on('console', (m) => {
          // 4xx responses the app handles itself are logged by the browser; not app errors.
          if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
            errors.push(`console: ${m.text()}`);
          }
        });
      });
      await use(errors);
      expect(errors, 'browser errors during the journey').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
