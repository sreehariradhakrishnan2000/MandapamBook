import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

/** What we take from Google after it has authenticated the person. */
export interface GoogleProfile {
  /** Google's stable account id. Emails can change; this does not. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** Talks to Google. Tests replace it with a fake that needs no network. */
export interface GoogleProvider {
  authorizationUrl(p: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchange(p: {
    code: string;
    codeVerifier: string;
    nonce: string;
    redirectUri: string;
  }): Promise<GoogleProfile>;
}

export class GoogleAuthError extends Error {}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * OAuth 2.0 authorization-code flow with PKCE against Google (OpenID Connect). The code is
 * exchanged server-side with the client secret, and the returned ID token's signature,
 * issuer, audience, expiry and nonce are all checked before anything is trusted.
 */
export class GoogleOAuth implements GoogleProvider {
  private jwks: JWTVerifyGetKey | undefined;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Tests pass a local key set; normally Google's published keys are fetched and cached. */
    keys?: JWTVerifyGetKey,
  ) {
    this.jwks = keys;
  }

  authorizationUrl(p: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    const url = new URL(AUTH_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: p.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchange(p: {
    code: string;
    codeVerifier: string;
    nonce: string;
    redirectUri: string;
  }): Promise<GoogleProfile> {
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: p.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: p.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: p.codeVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new GoogleAuthError(`token exchange failed: HTTP ${res.status}`);
    const body = (await res.json()) as { id_token?: unknown };
    if (typeof body.id_token !== 'string') throw new GoogleAuthError('no id_token in response');

    this.jwks ??= createRemoteJWKSet(JWKS_URL, { timeoutDuration: 10_000 });
    let payload;
    try {
      ({ payload } = await jwtVerify(body.id_token, this.jwks, {
        issuer: ISSUERS,
        audience: this.clientId,
        clockTolerance: 60,
      }));
    } catch (err) {
      throw new GoogleAuthError(`invalid id_token: ${(err as Error).message}`);
    }
    return profileFromClaims(payload, p.nonce);
  }
}

/** Validates ID-token claims and turns them into a profile. Exported for tests. */
export function profileFromClaims(claims: Record<string, unknown>, nonce: string): GoogleProfile {
  if (typeof claims['nonce'] !== 'string' || !safeEqual(claims['nonce'], nonce)) {
    throw new GoogleAuthError('nonce mismatch');
  }
  const { sub, email } = claims;
  if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !email.includes('@')) {
    throw new GoogleAuthError('id_token is missing sub or email');
  }
  return {
    subject: sub,
    email: email.toLowerCase(),
    emailVerified: claims['email_verified'] === true,
    name:
      typeof claims['name'] === 'string' && claims['name'].trim() ? claims['name'].trim() : null,
  };
}

// ---------- One-time values and the signed state cookie ----------

const b64url = (buf: Buffer): string => buf.toString('base64url');

export function randomValue(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

/** PKCE S256: the challenge sent to Google for the verifier kept on our side. */
export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** What the browser carries between /google/start and /google/callback. */
export interface OAuthState {
  state: string;
  codeVerifier: string;
  nonce: string;
  intent: 'CUSTOMER' | 'OWNER';
  returnUrl: string;
  expiresAt: number;
}

/** Signs the state so it can live in a cookie without the browser being able to alter it. */
export function sealState(key: Buffer, value: OAuthState): string {
  const body = b64url(Buffer.from(JSON.stringify(value)));
  const mac = b64url(createHmac('sha256', key).update(body).digest());
  return `${body}.${mac}`;
}

export function openState(
  key: Buffer,
  sealed: string | undefined,
  now = Date.now(),
): OAuthState | null {
  if (!sealed || sealed.length > 2000) return null;
  const [body, mac] = sealed.split('.');
  if (!body || !mac) return null;
  const expected = b64url(createHmac('sha256', key).update(body).digest());
  if (!safeEqual(mac, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
    return typeof value.expiresAt === 'number' && value.expiresAt > now ? value : null;
  } catch {
    return null;
  }
}

/** Same rule as the web app: only same-site paths, never another origin. */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
