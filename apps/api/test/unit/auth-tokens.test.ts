import { randomBytes } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { createCsrf } from '../../src/http/middleware/csrf.js';
import { MemoryRevocationStore } from '../../src/infra/revocation-store.js';
import { AccessTokenError, AccessTokenService } from '../../src/modules/auth/access-tokens.js';
import { checkPasswordPolicy, noBreachCheck } from '../../src/modules/auth/password.js';
import { RefreshTokenService } from '../../src/modules/auth/refresh-tokens.js';

const ring = (kid: string) => [{ kid, secret: randomBytes(32) }];

describe('AccessTokenService', () => {
  it('signs and verifies a token with the expected claims', async () => {
    const svc = new AccessTokenService(ring('k1'), 900);
    const { token, claims } = await svc.sign({ userId: 'u1', role: 'OWNER', familyId: 'f1' });
    const verified = await svc.verify(token);
    expect(verified).toEqual(claims);
    expect(verified.expiresAt - verified.issuedAt).toBe(900);
  });

  it('keeps verifying tokens from a retired signing key during rotation', async () => {
    const old = ring('k1');
    const before = new AccessTokenService(old, 900);
    const { token } = await before.sign({ userId: 'u1', role: 'CUSTOMER', familyId: 'f1' });
    const after = new AccessTokenService([...ring('k2'), ...old], 900);
    await expect(after.verify(token)).resolves.toMatchObject({ userId: 'u1' });
    const fresh = await after.sign({ userId: 'u1', role: 'CUSTOMER', familyId: 'f1' });
    expect(JSON.parse(Buffer.from(fresh.token.split('.')[0]!, 'base64url').toString()).kid).toBe(
      'k2',
    );
    // Once the old key is removed, its tokens stop working.
    await expect(new AccessTokenService(ring('k2'), 900).verify(token)).rejects.toThrow(
      AccessTokenError,
    );
  });

  it('reports expiry distinctly from tampering', async () => {
    vi.useFakeTimers();
    try {
      const svc = new AccessTokenService(ring('k1'), 60);
      const { token } = await svc.sign({ userId: 'u1', role: 'CUSTOMER', familyId: 'f1' });
      vi.setSystemTime(Date.now() + 120_000);
      await expect(svc.verify(token)).rejects.toMatchObject({ reason: 'expired' });
    } finally {
      vi.useRealTimers();
    }
    await expect(new AccessTokenService(ring('k1'), 60).verify('a.b.c')).rejects.toMatchObject({
      reason: 'invalid',
    });
  });
});

describe('RefreshTokenService.hash', () => {
  it('uses the key named by the token prefix and rejects unknown keys', () => {
    const svc = new RefreshTokenService([...ring('r2'), ...ring('r1')]);
    expect(svc.hash('r1.abc')).toHaveLength(32);
    expect(svc.hash('r2.abc')).not.toEqual(svc.hash('r1.abc'));
    expect(svc.hash('zz.abc')).toBeNull();
    expect(svc.hash('no-dot')).toBeNull();
  });
});

describe('password policy', () => {
  it('rejects short passwords and ones containing the email name', async () => {
    expect((await checkPasswordPolicy('short', 'a@b.test', noBreachCheck)).reason).toBe(
      'TOO_SHORT',
    );
    expect(
      (await checkPasswordPolicy('lakshmi-2026-xyz', 'lakshmi@b.test', noBreachCheck)).reason,
    ).toBe('CONTAINS_EMAIL');
    expect(
      (await checkPasswordPolicy('long and unrelated', 'lakshmi@b.test', noBreachCheck)).ok,
    ).toBe(true);
  });

  it('rejects breached passwords when a checker says so', async () => {
    const res = await checkPasswordPolicy('password123456', 'x@y.test', {
      isBreached: async () => true,
    });
    expect(res.reason).toBe('BREACHED');
  });
});

describe('MemoryRevocationStore', () => {
  it('expires entries after their TTL', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryRevocationStore();
      await store.revokeToken('j1', 10);
      expect(await store.isTokenRevoked('j1')).toBe(true);
      vi.advanceTimersByTime(11_000);
      expect(await store.isTokenRevoked('j1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CSRF', () => {
  const app = express();
  const csrf = createCsrf(randomBytes(32), ['http://localhost:4200']);
  app.use(cookieParser());
  app.get('/csrf', csrf.issue);
  app.post('/protected', csrf.verify, (_req, res) => {
    res.status(204).end();
  });
  app.use(
    (_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(403).end();
    },
  );

  it('accepts a matching, signed token and rejects everything else', async () => {
    const issued = await request(app).get('/csrf');
    const token = issued.body.csrfToken as string;
    const cookie = (issued.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect(issued.headers['set-cookie']![0]).toMatch(
      /__Host-mb_csrf=.*HttpOnly.*Secure.*SameSite=Strict/,
    );

    const ok = await request(app)
      .post('/protected')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token);
    expect(ok.status).toBe(204);
    expect((await request(app).post('/protected').set('Cookie', cookie)).status).toBe(403);
    expect(
      (await request(app).post('/protected').set('Cookie', cookie).set('X-CSRF-Token', `${token}x`))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/protected')
          .set('Cookie', cookie)
          .set('X-CSRF-Token', token)
          .set('Origin', 'https://evil.example')
      ).status,
    ).toBe(403);
  });
});

describe('auth env validation', () => {
  const k = () => randomBytes(32).toString('base64url');
  const base = {
    CORS_ORIGINS: 'http://localhost:4200',
    DATABASE_URL: 'postgres://u:p@localhost/db',
    REDIS_URL: 'redis://localhost:6379',
    CSRF_SECRET: k(),
    OTP_SECRET: k(),
    FIELD_ENCRYPTION_KEYS: `f1:${k()}`,
    STORAGE_PROVIDER: 'memory',
  };

  it('parses key rings with the first key as signer', () => {
    const env = loadEnv({
      ...base,
      ACCESS_TOKEN_KEYS: `new:${k()},old:${k()}`,
      REFRESH_TOKEN_KEYS: `r1:${k()}`,
    });
    expect(env.ACCESS_TOKEN_KEYS.map((x) => x.kid)).toEqual(['new', 'old']);
  });

  it('rejects short keys and access/refresh key reuse', () => {
    expect(() =>
      loadEnv({
        ...base,
        ACCESS_TOKEN_KEYS: `a:${randomBytes(8).toString('base64url')}`,
        REFRESH_TOKEN_KEYS: `r:${k()}`,
      }),
    ).toThrow(/at least 32 bytes/);
    const shared = k();
    expect(() =>
      loadEnv({ ...base, ACCESS_TOKEN_KEYS: `a:${shared}`, REFRESH_TOKEN_KEYS: `r:${shared}` }),
    ).toThrow(/must not reuse/);
  });

  it('requires TLS Redis and a real email provider in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://mandapambook.in',
        APP_BASE_URL: 'https://mandapambook.in',
        ACCESS_TOKEN_KEYS: `a:${k()}`,
        REFRESH_TOKEN_KEYS: `r:${k()}`,
      }),
    ).toThrow(/rediss[\s\S]*EMAIL_PROVIDER/);
  });
});
