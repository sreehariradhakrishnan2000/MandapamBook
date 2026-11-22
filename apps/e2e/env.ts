import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dotenv = join(root, '.env');
// Local runs read secrets from the repo .env; CI passes them as environment variables.
if (existsSync(dotenv)) process.loadEnvFile(dotenv);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set for end-to-end tests`);
  return v;
}

/** The e2e database. Its name must end in _e2e because the setup wipes it. */
export const E2E_DATABASE_URL = required('E2E_DATABASE_URL');
const dbName = new URL(E2E_DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith('_e2e')) {
  throw new Error(`Refusing to use "${dbName}": the e2e database name must end in _e2e`);
}

/** Direct (non-pooled) connection for migrations, pointed at the same e2e database. */
export const E2E_MIGRATION_URL = (() => {
  const base = process.env['E2E_MIGRATION_DATABASE_URL'] ?? process.env['MIGRATION_DATABASE_URL'];
  if (!base) return E2E_DATABASE_URL;
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

export const ROOT = root;
export const API_PORT = Number(process.env['E2E_API_PORT'] ?? 4100);
export const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 4300);
export const WEB_URL = `http://localhost:${WEB_PORT}`;
/** A fresh Redis namespace per run, so rate limits and revocations never carry over. */
const RUN_ID = Date.now().toString(36);

export const MAIL_DIR = process.env['E2E_MAIL_DIR'] ?? join(tmpdir(), 'mandapambook-e2e-mail');

/**
 * Environment for the API under test. Everything that could reach a real system is
 * overridden: e2e database, mock payments, in-memory storage, emails written to files.
 */
export function apiEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return {
    ...env,
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    DATABASE_URL: E2E_DATABASE_URL,
    MIGRATION_DATABASE_URL: E2E_MIGRATION_URL,
    APP_BASE_URL: WEB_URL,
    CORS_ORIGINS: WEB_URL,
    PAYMENT_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'memory',
    EMAIL_PROVIDER: 'file',
    EMAIL_FILE_DIR: MAIL_DIR,
    LOG_LEVEL: process.env['E2E_LOG_LEVEL'] ?? 'warn',
    REDIS_KEY_PREFIX: `e2e:${RUN_ID}:`,
  };
}
