import { createHash, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenService } from '../../src/modules/auth/access-tokens.js';
import {
  HibpBreachChecker,
  checkPasswordPolicy,
  hashPassword,
  needsRehash,
  noBreachCheck,
  verifyPassword,
} from '../../src/modules/auth/password.js';

describe('HibpBreachChecker', () => {
  afterEach(() => vi.unstubAllGlobals());

  const suffixOf = (pw: string) =>
    createHash('sha1').update(pw).digest('hex').toUpperCase().slice(5);

  it('sends only the 5-character hash prefix and detects a listed suffix', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          `0000000000000000000000000000000000A:3\r\n${suffixOf('hunter2hunter2')}:42\r\n`,
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await new HibpBreachChecker().isBreached('hunter2hunter2')).toBe(true);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toMatch(/\/range\/[0-9A-F]{5}$/);
    expect(url).not.toContain(suffixOf('hunter2hunter2'));
  });

  it('treats padding entries with a zero count as not breached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`${suffixOf('unique pass phrase')}:0`)),
    );
    expect(await new HibpBreachChecker().isBreached('unique pass phrase')).toBe(false);
  });

  it('fails open on errors and non-200 responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('busy', { status: 503 })),
    );
    expect(await new HibpBreachChecker().isBreached('anything at all')).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('network down'))),
    );
    expect(await new HibpBreachChecker().isBreached('anything at all')).toBe(false);
  });
});

describe('password hashing', () => {
  it('verifies, refuses wrong passwords and malformed hashes', async () => {
    const hash = await hashPassword('a decent passphrase');
    expect(await verifyPassword(hash, 'a decent passphrase')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it('flags hashes made with weaker parameters for rehash', async () => {
    const argon2 = (await import('argon2')).default;
    const weak = await argon2.hash('pw', {
      type: argon2.argon2id,
      memoryCost: 8192,
      timeCost: 2,
      parallelism: 1,
    });
    expect(needsRehash(weak)).toBe(true);
  });

  it('rejects overly long passwords', async () => {
    expect((await checkPasswordPolicy('x'.repeat(129), 'a@b.test', noBreachCheck)).reason).toBe(
      'TOO_LONG',
    );
  });
});

describe('AccessTokenService rejects malformed tokens', () => {
  const secret = randomBytes(32);
  const svc = new AccessTokenService([{ kid: 'k1', secret }], 900);
  const base = () =>
    new SignJWT({ role: 'CUSTOMER', sid: 'fam' })
      .setSubject('u1')
      .setIssuer('mandapambook')
      .setAudience('mandapambook-api')
      .setJti('j1')
      .setIssuedAt()
      .setExpirationTime('5m');

  it('rejects the wrong typ header', async () => {
    const token = await base()
      .setProtectedHeader({ alg: 'HS256', kid: 'k1', typ: 'JWT' })
      .sign(secret);
    await expect(svc.verify(token)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('rejects an unknown role or missing session claim', async () => {
    const badRole = await new SignJWT({ role: 'ROOT', sid: 'fam' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1', typ: 'at+jwt' })
      .setSubject('u1')
      .setIssuer('mandapambook')
      .setAudience('mandapambook-api')
      .setJti('j1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);
    await expect(svc.verify(badRole)).rejects.toMatchObject({ reason: 'invalid' });

    const noSid = await new SignJWT({ role: 'CUSTOMER' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1', typ: 'at+jwt' })
      .setSubject('u1')
      .setIssuer('mandapambook')
      .setAudience('mandapambook-api')
      .setJti('j1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);
    await expect(svc.verify(noSid)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('rejects the wrong audience and a missing kid', async () => {
    const wrongAud = await base()
      .setAudience('someone-else')
      .setProtectedHeader({ alg: 'HS256', kid: 'k1', typ: 'at+jwt' })
      .sign(secret);
    await expect(svc.verify(wrongAud)).rejects.toMatchObject({ reason: 'invalid' });
    const noKid = await base().setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).sign(secret);
    await expect(svc.verify(noKid)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('refuses to construct with an empty key ring', () => {
    expect(() => new AccessTokenService([], 900)).toThrow();
  });
});
