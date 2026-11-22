import { pino, type Logger } from 'pino';
import type { Env } from './env.js';

/** Paths whose values are never written to logs (PII and credentials). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.otp',
  '*.pan',
  '*.accountNumber',
  '*.ifsc',
  '*.email',
  '*.phone',
];

export function createLogger(env: Pick<Env, 'LOG_LEVEL'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'mandapambook-api' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
}
