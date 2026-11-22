import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  CORS_ORIGINS: 'http://localhost:4200, http://localhost:8080',
  DATABASE_URL: 'postgres://app:pw@localhost:5432/mandapambook',
  REDIS_URL: 'redis://localhost:6379',
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
      loadEnv({ ...valid, NODE_ENV: 'production', CORS_ORIGINS: 'https://mandapambook.in' }),
    ).not.toThrow();
  });
});
