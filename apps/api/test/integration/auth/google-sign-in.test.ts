import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerProfiles, userIdentities, users } from '../../../src/db/schema/index.js';
import { hashPassword } from '../../../src/modules/auth/password.js';
import {
  type GoogleProfile,
  type GoogleProvider,
  GoogleAuthError,
  pkceChallenge,
} from '../../../src/modules/auth/google.js';
import { hasTestDb } from '../../db-helpers.js';
import {
  Client,
  type Harness,
  ORIGIN,
  PASSWORD,
  createHarness,
  createUser,
  uniqueEmail,
} from '../../auth-harness.js';

/**
 * Stands in for Google. Like Google, it only hands out a profile for a code if the PKCE
 * verifier matches the challenge it was given, and it echoes the nonce check through
 * the real code path (the nonce must match what /google/start generated).
 */
class FakeGoogle implements GoogleProvider {
  next: GoogleProfile | Error | undefined;
  private readonly pending = new Map<string, { challenge: string; nonce: string }>();

  authorizationUrl(p: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }) {
    const code = randomUUID();
    this.pending.set(code, { challenge: p.codeChallenge, nonce: p.nonce });
    const url = new URL('https://google.test/auth');
    url.search = new URLSearchParams({
      state: p.state,
      code,
      redirect_uri: p.redirectUri,
    }).toString();
    return url.toString();
  }

  async exchange(p: { code: string; codeVerifier: string; nonce: string }) {
    const issued = this.pending.get(p.code);
    this.pending.delete(p.code); // codes are single use
    if (!issued || pkceChallenge(p.codeVerifier) !== issued.challenge || issued.nonce !== p.nonce) {
      throw new GoogleAuthError('bad code');
    }
    const next = this.next;
    if (next instanceof Error) throw next;
    if (!next) throw new Error('test did not set a profile');
    return next;
  }
}

const profile = (over: Partial<GoogleProfile> = {}): GoogleProfile => ({
  subject: randomUUID(),
  email: uniqueEmail('google'),
  emailVerified: true,
  name: 'Asha Menon',
  ...over,
});

describe.skipIf(!hasTestDb)('Google sign-in', () => {
  let h: Harness;
  const google = new FakeGoogle();

  beforeAll(async () => {
    h = await createHarness({ googleProvider: google });
  });
  afterAll(async () => {
    await h?.close();
  });

  /** start → (Google) → callback, as a browser would follow it. */
  async function signIn(c: Client, who: GoogleProfile | Error, query = '') {
    const start = await c.send('get', `/api/v1/auth/google/start${query}`);
    expect(start.status).toBe(302);
    const at = new URL(start.headers['location'] as string);
    google.next = who;
    const cb = await c.send(
      'get',
      `/api/v1/auth/google/callback?state=${at.searchParams.get('state')}&code=${at.searchParams.get('code')}`,
    );
    return { start, cb, location: cb.headers['location'] as string };
  }

  it('offers Google, and starts with a short-lived Lax state cookie', async () => {
    expect((await new Client(h.app).send('get', '/api/v1/auth/providers')).body).toEqual({
      google: true,
    });
    const start = await new Client(h.app).send('get', '/api/v1/auth/google/start');
    expect(start.status).toBe(302);
    const location = new URL(start.headers['location'] as string);
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/auth/google/callback`);
    const cookie = (start.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('__Host-mb_oauth='),
    );
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=600/);
  });

  it('creates a verified customer, signs them in, and returns them where they were', async () => {
    const c = new Client(h.app);
    const who = profile();
    const { cb, location } = await signIn(c, who, '?returnUrl=%2Fvenues%2Fx%3Fdate%3D2027-01-21');
    expect(cb.status).toBe(303);
    expect(location).toBe(`${ORIGIN}/venues/x?date=2027-01-21`);
    expect(c.cookies.has('__Host-mb_oauth')).toBe(false); // used once, then cleared

    const session = await c.refresh();
    expect(session.status).toBe(200);
    expect(session.body.user).toMatchObject({
      email: who.email,
      fullName: 'Asha Menon',
      role: 'CUSTOMER',
      emailVerified: true,
    });
    const [row] = await h.db.select().from(users).where(eq(users.email, who.email));
    expect(row).toMatchObject({ status: 'ACTIVE', passwordHash: null });
  });

  it('creates an owner, with an owner profile, when they chose to list a venue', async () => {
    const c = new Client(h.app);
    const who = profile();
    await signIn(c, who, '?intent=owner');
    const [row] = await h.db.select().from(users).where(eq(users.email, who.email));
    expect(row!.role).toBe('OWNER');
    expect(
      await h.db.select().from(ownerProfiles).where(eq(ownerProfiles.userId, row!.id)),
    ).toHaveLength(1);
  });

  it('recognises the same Google account later, even after its email changed', async () => {
    const who = profile();
    await signIn(new Client(h.app), who);
    const [first] = await h.db.select().from(users).where(eq(users.email, who.email));

    const c = new Client(h.app);
    await signIn(c, { ...who, email: uniqueEmail('renamed') });
    expect((await c.refresh()).body.user.id).toBe(first!.id);
  });

  it('links a verified password account and keeps its password', async () => {
    const existing = await createUser(h.db);
    const c = new Client(h.app);
    await signIn(c, profile({ email: existing.email }));
    expect((await c.refresh()).body.user.id).toBe(existing.id);
    expect((await new Client(h.app).login(existing.email)).status).toBe(200);
  });

  it('takes over an unverified account: clears the password and its sessions', async () => {
    // Someone registered this address with their own password but never verified it.
    const email = uniqueEmail('squatted');
    await h.db.insert(users).values({
      email,
      fullName: 'Squatter',
      passwordHash: await hashPassword(PASSWORD),
      status: 'PENDING_VERIFICATION',
    });
    const squatter = new Client(h.app);
    expect((await squatter.login(email)).status).toBe(200);

    await signIn(new Client(h.app), profile({ email }));
    const [row] = await h.db.select().from(users).where(eq(users.email, email));
    expect(row).toMatchObject({ passwordHash: null, status: 'ACTIVE' });
    expect(row!.emailVerifiedAt).not.toBeNull();
    expect((await new Client(h.app).login(email)).status).toBe(401);
    expect((await squatter.refresh()).status).toBe(401);
  });

  it('refuses an account already linked to a different Google account', async () => {
    const email = uniqueEmail('linked');
    await signIn(new Client(h.app), profile({ email }));
    const { location } = await signIn(new Client(h.app), profile({ email }));
    expect(location).toBe(`${ORIGIN}/login?error=google_other_google_account`);
  });

  it('refuses unverified Google emails and suspended accounts', async () => {
    const who = profile({ emailVerified: false });
    const unverified = await signIn(new Client(h.app), who);
    expect(unverified.location).toBe(`${ORIGIN}/login?error=google_email_unverified`);
    expect(await h.db.select().from(users).where(eq(users.email, who.email))).toHaveLength(0);

    const suspended = await createUser(h.db, 'CUSTOMER', { status: 'SUSPENDED' });
    const c = new Client(h.app);
    const blocked = await signIn(c, profile({ email: suspended.email }));
    expect(blocked.location).toBe(`${ORIGIN}/login?error=google_suspended`);
    expect(c.cookies.has('__Host-mb_rt')).toBe(false);
  });

  it('rejects a callback without its cookie, with a wrong state, or replayed', async () => {
    const c = new Client(h.app);
    const start = await c.send('get', '/api/v1/auth/google/start');
    const at = new URL(start.headers['location'] as string);
    const code = at.searchParams.get('code');
    google.next = profile();

    const stranger = await new Client(h.app).send(
      'get',
      `/api/v1/auth/google/callback?state=${at.searchParams.get('state')}&code=${code}`,
    );
    expect(stranger.headers['location']).toBe(`${ORIGIN}/login?error=google_expired`);

    const wrongState = await c.send(
      'get',
      `/api/v1/auth/google/callback?state=forged&code=${code}`,
    );
    expect(wrongState.headers['location']).toBe(`${ORIGIN}/login?error=google_expired`);
    // The state cookie is gone after the first callback, so a replay fails too.
    const replay = await c.send(
      'get',
      `/api/v1/auth/google/callback?state=${at.searchParams.get('state')}&code=${code}`,
    );
    expect(replay.headers['location']).toBe(`${ORIGIN}/login?error=google_expired`);
  });

  it('reports a cancelled consent screen and a failed exchange', async () => {
    const c = new Client(h.app);
    await c.send('get', '/api/v1/auth/google/start');
    const cancelled = await c.send('get', '/api/v1/auth/google/callback?error=access_denied');
    expect(cancelled.headers['location']).toBe(`${ORIGIN}/login?error=google_cancelled`);

    const failed = await signIn(new Client(h.app), new GoogleAuthError('invalid id_token'));
    expect(failed.location).toBe(`${ORIGIN}/login?error=google_failed`);
  });

  it('never redirects to another site after sign-in', async () => {
    const { location } = await signIn(
      new Client(h.app),
      profile(),
      '?returnUrl=%2F%2Fevil.example',
    );
    expect(location).toBe(`${ORIGIN}/`);
  });

  it('stores one identity per Google account', async () => {
    const who = profile();
    await signIn(new Client(h.app), who);
    await signIn(new Client(h.app), who);
    const rows = await h.db
      .select()
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, 'google'), eq(userIdentities.subject, who.subject)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastUsedAt).not.toBeNull();
  });
});

describe.skipIf(!hasTestDb)('Google sign-in when not configured', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it('hides the option and sends anyone who tries back to sign in', async () => {
    const c = new Client(h.app);
    expect((await c.send('get', '/api/v1/auth/providers')).body).toEqual({ google: false });
    const start = await c.send('get', '/api/v1/auth/google/start');
    expect(start.headers['location']).toBe(`${ORIGIN}/login?error=google_unavailable`);
  });
});
