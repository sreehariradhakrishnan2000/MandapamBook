import { pino } from 'pino';
import { createApp } from '../src/http/app.js';
import type { ReadinessCheck } from '../src/http/routes/health.js';

/** Silent by default; TEST_LOG_LEVEL=error (or debug) shows server-side errors when diagnosing a test. */
export const silentLogger = pino({ level: process.env['TEST_LOG_LEVEL'] ?? 'silent' });

export function buildTestApp(readinessChecks: Record<string, ReadinessCheck> = {}) {
  return createApp({
    env: { CORS_ORIGINS: ['http://localhost:4200'], BODY_LIMIT: '1kb', TRUST_PROXY_HOPS: 0 },
    logger: silentLogger,
    readinessChecks,
  });
}
