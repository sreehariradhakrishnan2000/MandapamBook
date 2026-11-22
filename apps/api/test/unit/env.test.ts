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
        SMTP_URL: 'smtps://relay.example:465',
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

  it('allows the file email provider only outside production, with a directory', () => {
    expect(() => loadEnv({ ...valid, EMAIL_PROVIDER: 'file' })).toThrow(/EMAIL_FILE_DIR/);
    expect(
      loadEnv({ ...valid, EMAIL_PROVIDER: 'file', EMAIL_FILE_DIR: '/tmp/mail' }).EMAIL_PROVIDER,
    ).toBe('file');
    let caught: unknown;
    try {
      loadEnv({
        ...valid,
        NODE_ENV: 'production',
        EMAIL_PROVIDER: 'file',
        EMAIL_FILE_DIR: '/tmp/mail',
      });
    } catch (err) {
      caught = err;
    }
    expect(String((caught as Error).message)).toContain(
      'EMAIL_PROVIDER: file is not allowed in production',
    );
  });

  it('requires S3 credentials for the s3 provider and 32-byte encryption keys', () => {
    expect(() => loadEnv({ ...valid, STORAGE_PROVIDER: 's3' })).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() =>
      loadEnv({ ...valid, FIELD_ENCRYPTION_KEYS: `f1:${randomBytes(48).toString('base64url')}` }),
    ).toThrow(/exactly 32 bytes/);
  });

  describe('APP_ENV (staging vs production)', () => {
    // Everything production requires, except the payment gateway.
    const prodLike = {
      ...valid,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://staging.example.in',
      APP_BASE_URL: 'https://staging.example.in',
      REDIS_URL: 'rediss://default:pw@redis.example:6379',
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtps://user:pass@smtp.example:465',
      STORAGE_PROVIDER: 's3',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    };

    it('lets staging use the mock gateway, but not real production', () => {
      expect(loadEnv({ ...prodLike, APP_ENV: 'staging' }).PAYMENT_PROVIDER).toBe('mock');
      expect(() => loadEnv(prodLike)).toThrow(/mock gateway is not allowed in production/);
      expect(() => loadEnv({ ...prodLike, APP_ENV: 'production' })).toThrow(/mock gateway/);
    });

    it('keeps every other production safeguard in staging', () => {
      const staging = { ...prodLike, APP_ENV: 'staging' };
      expect(() => loadEnv({ ...staging, REDIS_URL: 'redis://r:6379' })).toThrow(/TLS/);
      expect(() => loadEnv({ ...staging, EMAIL_PROVIDER: 'console' })).toThrow(/console/);
      expect(() => loadEnv({ ...staging, STORAGE_PROVIDER: 'memory' })).toThrow(/memory/);
      expect(() => loadEnv({ ...staging, CORS_ORIGINS: 'http://x.example' })).toThrow(/https/);
    });

    it('allows Razorpay test keys only in staging, and live keys only in production', () => {
      const razorpay = (key: string) => ({
        ...prodLike,
        PAYMENT_PROVIDER: 'razorpay',
        RAZORPAY_KEY_ID: key,
        RAZORPAY_KEY_SECRET: 'k'.repeat(24),
        RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(24),
      });
      expect(loadEnv({ ...razorpay('rzp_test_abc'), APP_ENV: 'staging' }).APP_ENV).toBe('staging');
      expect(() => loadEnv(razorpay('rzp_test_abc'))).toThrow(/test keys/);
      expect(() => loadEnv({ ...razorpay('rzp_live_abc'), APP_ENV: 'staging' })).toThrow(
        /live keys are not allowed in staging/,
      );
      expect(loadEnv(razorpay('rzp_live_abc')).PAYMENT_PROVIDER).toBe('razorpay');
    });

    it('rejects APP_ENV outside NODE_ENV=production', () => {
      expect(() => loadEnv({ ...valid, APP_ENV: 'staging' })).toThrow(/NODE_ENV=production/);
    });
  });
});
