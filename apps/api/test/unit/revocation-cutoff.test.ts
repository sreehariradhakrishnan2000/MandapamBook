import { randomBytes, randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRevocationStore } from '../../src/infra/revocation-store.js';
import { AUDIENCE, AccessTokenService, ISSUER } from '../../src/modules/auth/access-tokens.js';
import { createAuthenticate } from '../../src/modules/rbac/authenticate.js';

// A user cutoff (logout-all, password reset) must end every earlier session, but must not
// catch a sign-in that happens a moment later in the same second. CI found this: a staff
// member who set their password and signed in straight away was signed back out.

const SECOND = 1_900_000_000_000; // a whole second, in ms

function setup() {
  const key = { kid: 'k1', secret: randomBytes(32) };
  const tokens = new AccessTokenService([key], 900);
  const revocations = new MemoryRevocationStore();
  const app = express();
  app.get('/me', createAuthenticate(tokens, revocations), (_req, res) => {
    res.status(204).end();
  });
  app.use((err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).end();
  });
  const call = (token: string) => request(app).get('/me').set('Authorization', `Bearer ${token}`);
  return { key, tokens, revocations, call };
}

const signAt = async (tokens: AccessTokenService, ms: number) => {
  vi.spyOn(Date, 'now').mockReturnValue(ms);
  const { token } = await tokens.sign({ userId: 'u1', role: 'OWNER', familyId: 'f1' });
  vi.restoreAllMocks();
  return token;
};

describe('user revocation cutoff', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a token issued before the cutoff and accepts one issued after, in the same second', async () => {
    const { tokens, revocations, call } = setup();
    const before = await signAt(tokens, SECOND + 100);
    await revocations.setUserCutoff('u1', SECOND + 200, 900);
    const after = await signAt(tokens, SECOND + 300);

    expect((await call(before)).status).toBe(401);
    expect((await call(after)).status).toBe(204);
  });

  it('rejects a token issued in the same millisecond as the cutoff', async () => {
    const { tokens, revocations, call } = setup();
    const token = await signAt(tokens, SECOND + 200);
    await revocations.setUserCutoff('u1', SECOND + 200, 900);
    expect((await call(token)).status).toBe(401);
  });

  it('treats a token without iat_ms, or with one outside its iat second, as issued at the end of the second', async () => {
    const { key, revocations, call } = setup();
    const iat = SECOND / 1000;
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT({ role: 'OWNER', sid: 'f1', ...claims })
        .setProtectedHeader({ alg: 'HS256', kid: key.kid, typ: 'at+jwt' })
        .setSubject('u1')
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setJti(randomUUID())
        .setIssuedAt(iat)
        .setExpirationTime(iat + 900)
        .sign(key.secret);

    // Counted as SECOND + 999: a cutoff at that instant ends it, one just before does not.
    await revocations.setUserCutoff('u1', SECOND + 998, 900);
    expect((await call(await sign({}))).status).toBe(204);
    await revocations.setUserCutoff('u1', SECOND + 999, 900);
    expect((await call(await sign({}))).status).toBe(401);
    // An iat_ms in a different second than iat is ignored, not trusted to dodge the cutoff.
    expect((await call(await sign({ iat_ms: SECOND + 5000 }))).status).toBe(401);
  });
});
