import { pino } from 'pino';
import { createApp } from '../src/http/app.js';
import type { ReadinessCheck } from '../src/http/routes/health.js';

export const silentLogger = pino({ level: 'silent' });

export function buildTestApp(readinessChecks: Record<string, ReadinessCheck> = {}) {
  return createApp({
    env: { CORS_ORIGINS: ['http://localhost:4200'], BODY_LIMIT: '1kb', TRUST_PROXY_HOPS: 0 },
    logger: silentLogger,
    readinessChecks,
  });
}
