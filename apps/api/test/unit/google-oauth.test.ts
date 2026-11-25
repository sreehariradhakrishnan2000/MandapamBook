import { randomBytes } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  GoogleAuthError,
  GoogleOAuth,
  type OAuthState,
  openState,
  pkceChallenge,
  profileFromClaims,
  safeReturnPath,
  sealState,
} from '../../src/modules/auth/google.js';

const CLIENT_ID = '1234-abc.apps.googleusercontent.com';
const key = randomBytes(32);
const state: OAuthState = {
  state: 's1',
  codeVerifier: 'v1',
  nonce: 'n1',
  intent: 'CUSTOMER',
  returnUrl: '/account',
  expiresAt: Date.now() + 60_000,
};

describe('OAuth state cookie', () => {
  it('round-trips a sealed state', () => {
    expect(openState(key, sealState(key, state))).toEqual(state);
  });

  it('rejects tampering, another key, expiry and junk', () => {
    const sealed = sealState(key, state);
    const [body, mac] = sealed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...state, returnUrl: '//evil.example' })).toString(
      'base64url',
    );
    expect(openState(key, `${forged}.${mac}`)).toBeNull();
    expect(openState(key, `${body}.${mac}x`)).toBeNull();
    expect(openState(randomBytes(32), sealed)).toBeNull();
    expect(openState(key, sealState(key, { ...state, expiresAt: Date.now() - 1 }))).toBeNull();
    expect(openState(key, undefined)).toBeNull();
    expect(openState(key, 'not-a-cookie')).toBeNull();
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('safeReturnPath', () => {
  it.each([
    ['/account', '/account'],
    ['/venues/x?date=2027-01-01', '/venues/x?date=2027-01-01'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    [undefined, '/'],
    [['/a', '/b'], '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });
});

describe('profileFromClaims', () => {
  const claims = {
    sub: '111',
    email: 'Asha@Example.test',
    email_verified: true,
    name: 'Asha',
    nonce: 'n1',
  };

  it('normalises the profile', () => {
    expect(profileFromClaims(claims, 'n1')).toEqual({
      subject: '111',
      email: 'asha@example.test',
      emailVerified: true,
      name: 'Asha',
    });
  });

  it('refuses a wrong or missing nonce, and missing sub or email', () => {
    expect(() => profileFromClaims(claims, 'other')).toThrow(GoogleAuthError);
    expect(() => profileFromClaims({ ...claims, nonce: undefined }, 'n1')).toThrow(GoogleAuthError);
    expect(() => profileFromClaims({ ...claims, sub: undefined }, 'n1')).toThrow(GoogleAuthError);
    expect(() => profileFromClaims({ ...claims, email: 'nope' }, 'n1')).toThrow(GoogleAuthError);
  });

  it('reports an unverified email as such', () => {
    expect(profileFromClaims({ ...claims, email_verified: false }, 'n1').emailVerified).toBe(false);
  });
});

describe('GoogleOAuth', () => {
  it('asks for openid email profile with PKCE S256, state and nonce', () => {
    const google = new GoogleOAuth(CLIENT_ID, 'secret');
    const url = new URL(
      google.authorizationUrl({
        state: 'st',
        nonce: 'no',
        codeChallenge: 'ch',
        redirectUri: 'https://web.example/api/v1/auth/google/callback',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      response_type: 'code',
      scope: 'openid email profile',
      state: 'st',
      nonce: 'no',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      redirect_uri: 'https://web.example/api/v1/auth/google/callback',
    });
  });

  async function setup() {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const sign = (
      claims: Record<string, unknown>,
      opts: { iss?: string; aud?: string; exp?: string } = {},
    ) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(opts.iss ?? 'https://accounts.google.com')
        .setAudience(opts.aud ?? CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? '5m')
        .sign(privateKey);
    const sent: URLSearchParams[] = [];
    const withToken = (idToken: string | null, status = 200) =>
      new GoogleOAuth(
        CLIENT_ID,
        'the-secret',
        (async (_url: string, init: RequestInit) => {
          sent.push(new URLSearchParams(init.body as URLSearchParams));
          return new Response(JSON.stringify(idToken ? { id_token: idToken } : {}), { status });
        }) as unknown as typeof fetch,
        createLocalJWKSet({ keys: [jwk] }),
      );
    return { sign, withToken, sent };
  }

  const exchange = { code: 'c', codeVerifier: 'cv', nonce: 'n1', redirectUri: 'https://w/cb' };
  const goodClaims = { sub: '42', email: 'meera@example.test', email_verified: true, nonce: 'n1' };

  it('exchanges the code with the secret and verifier, and trusts a valid id_token', async () => {
    const { sign, withToken, sent } = await setup();
    const profile = await withToken(await sign(goodClaims)).exchange(exchange);
    expect(profile).toMatchObject({
      subject: '42',
      email: 'meera@example.test',
      emailVerified: true,
    });
    expect(Object.fromEntries(sent[0]!)).toMatchObject({
      code: 'c',
      code_verifier: 'cv',
      client_id: CLIENT_ID,
      client_secret: 'the-secret',
      grant_type: 'authorization_code',
      redirect_uri: 'https://w/cb',
    });
  });

  it('refuses tokens for another app, from another issuer, expired, or badly signed', async () => {
    const { sign, withToken } = await setup();
    const other = await setup();
    for (const token of [
      await sign(goodClaims, { aud: 'someone-else.apps.googleusercontent.com' }),
      await sign(goodClaims, { iss: 'https://evil.example' }),
      await sign(goodClaims, { exp: '-10m' }),
      await other.sign(goodClaims), // signed with a key Google never published
    ]) {
      await expect(withToken(token).exchange(exchange)).rejects.toThrow(GoogleAuthError);
    }
  });

  it('fails cleanly when Google refuses the code or sends no id_token', async () => {
    const { withToken } = await setup();
    await expect(withToken(null, 400).exchange(exchange)).rejects.toThrow(GoogleAuthError);
    await expect(withToken(null, 200).exchange(exchange)).rejects.toThrow(GoogleAuthError);
  });
});
