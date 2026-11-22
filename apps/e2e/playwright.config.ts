import { defineConfig, devices } from '@playwright/test';
import { API_PORT, ROOT, WEB_PORT, WEB_URL, apiEnv } from './env.js';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const stringEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );

/**
 * End-to-end journeys against the real API (e2e database, mock payments) and the Angular
 * dev server. Runs serially: the journeys share one database and one set of rate limits.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  // The owner journey creates and gets approval for the venue the customer then books.
  projects: [
    { name: 'owner-desktop', testMatch: /owner-listing/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'customer-mobile',
      testMatch: /customer-booking/,
      dependencies: ['owner-desktop'],
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      command: `${pnpm} --filter @mandapambook/api exec tsx src/server.ts`,
      cwd: ROOT,
      url: `http://localhost:${API_PORT}/health`,
      env: apiEnv(),
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `${pnpm} --filter @mandapambook/web exec ng serve --port ${WEB_PORT} --proxy-config ../e2e/proxy.e2e.json`,
      cwd: ROOT,
      // The Angular CLI prefers PORT over --port, and .env sets PORT for the API.
      env: { ...stringEnv(), PORT: String(WEB_PORT) },
      // A port check tries both 127.0.0.1 and ::1; the dev server listens on ::1 only.
      port: WEB_PORT,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
