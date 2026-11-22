import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  CORS_ORIGINS: 'http://localhost:4200, http://localhost:8080',
  DATABASE_URL: 'postgres://app:pw@localhost:5432/mandapambook',
  REDIS_URL: 'redis://localhost:6379',
  ACCESS_TOKEN_KEYS: `a1:${randomBytes(32).toString('base64url')}`,
  REFRESH_TOKEN_KEYS: `r1:${randomBytes(32).toString('base64url')}`,
  CSRF_SECRET: randomBytes(32).toString('base64url'),
  OTP_SECRET: randomBytes(32).toString('base64url'),
  FIELD_ENCRYPTION_KEYS: `f1:${randomBytes(32).toString('base64url')}`,
  STORAGE_PROVIDER: 'memory',
  MOCK_PAYMENT_KEY_SECRET: randomBytes(32).toString('base64url'),
  MOCK_PAYMENT_WEBHOOK_SECRET: randomBytes(32).toString('base64url'),
};

describe('loadEnv', () => {
  it('parses a valid environment with defaults', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:4200', 'http://localhost:8080']);
    expect(env.BODY_LIMIT).toBe('100kb');
    expect(env.ENABLE_API_DOCS).toBe(false);
  });

  it('fails fast listing every problem without echoing values', () => {
    let caught: unknown;
    try {
      loadEnv({ ...valid, DATABASE_URL: 'mysql://user:secret-pw@x', PORT: 'abc' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const msg = (caught as Error).message;
    expect(msg).toContain('DATABASE_URL');
    expect(msg).toContain('PORT');
    expect(msg).not.toContain('secret-pw');
  });

  it('requires explicit CORS origins', () => {
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: '' })).toThrow(EnvValidationError);
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(EnvValidationError);
  });

  it('rejects http origins in production', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/https/);
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://mandapambook.in',
        APP_BASE_URL: 'https://mandapambook.in',
        REDIS_URL: 'rediss://default:x@cache.example:6379',
        EMAIL_PROVIDER: 'smtp',
        STORAGE_PROVIDER: 's3',
        S3_ACCESS_KEY_ID: 'test-only-key-id',
        S3_SECRET_ACCESS_KEY: 'test-only-secret',
        PAYMENT_PROVIDER: 'razorpay',
        RAZORPAY_KEY_ID: 'rzp_live_testonly123',
        RAZORPAY_KEY_SECRET: 'test-only-razorpay-secret',
        RAZORPAY_WEBHOOK_SECRET: 'test-only-webhook-secret',
      }),
    ).not.toThrow();
  });

  it('requires S3 credentials for the s3 provider and 32-byte encryption keys', () => {
    expect(() => loadEnv({ ...valid, STORAGE_PROVIDER: 's3' })).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() =>
      loadEnv({ ...valid, FIELD_ENCRYPTION_KEYS: `f1:${randomBytes(48).toString('base64url')}` }),
    ).toThrow(/exactly 32 bytes/);
  });
});
