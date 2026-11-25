import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, refreshTokens, users } from '../../../src/db/schema/index.js';
import { hasTestDb } from '../../db-helpers.js';
import {
  Client,
  type Harness,
  PASSWORD,
  createHarness,
  createUser,
  tokenFromEmail,
  uniqueEmail,
} from '../../auth-harness.js';

describe.skipIf(!hasTestDb)('auth flows', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('registration and email verification', () => {
    it('registers, verifies email and signs in', async () => {
      const c = new Client(h.app);
      const email = uniqueEmail('signup');
      const reg = await c.send('post', '/api/v1/auth/register', {
        email,
        password: PASSWORD,
        fullName: 'Meera Pillai',
        phone: '9876500001',
      });
      expect(reg.status).toBe(202);

      const [created] = await h.db.select().from(users).where(eq(users.email, email));
      expect(created).toMatchObject({
        role: 'CUSTOMER',
        status: 'PENDING_VERIFICATION',
        phone: '+919876500001',
      });
      expect(created!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);

      const token = tokenFromEmail(h.email, email);
      expect((await c.send('post', '/api/v1/auth/verify-email', { token })).status).toBe(200);
      // Single use.
      expect((await c.send('post', '/api/v1/auth/verify-email', { token })).status).toBe(400);

      const login = await c.login(email);
      expect(login.status).toBe(200);
      expect(login.body.user).toMatchObject({ email, role: 'CUSTOMER', emailVerified: true });
      expect(login.body.expiresIn).toBe(900);

      const me = await c.send('get', '/api/v1/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.permissions).toContain('booking:create');
    });

    it('resends a fresh verification link that replaces the old one', async () => {
      const c = new Client(h.app);
      const email = uniqueEmail('resend');
      await c.send('post', '/api/v1/auth/register', {
        email,
        password: PASSWORD,
        fullName: 'Resend Tester',
        phone: '9876500077',
      });
      const first = tokenFromEmail(h.email, email);
      expect((await c.login(email)).status).toBe(200);

      const res = await c.send('post', '/api/v1/auth/verify-email/resend');
      expect(res.status).toBe(202);
      const second = tokenFromEmail(h.email, email);
      expect(second).not.toBe(first);

      // The earlier link no longer works; the new one does.
      expect((await c.send('post', '/api/v1/auth/verify-email', { token: first })).status).toBe(
        400,
      );
      expect((await c.send('post', '/api/v1/auth/verify-email', { token: second })).status).toBe(
        200,
      );
      const [user] = await h.db.select().from(users).where(eq(users.email, email));
      const logs = await h.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, user!.id),
            eq(auditLogs.action, 'auth.verification_email_resent'),
          ),
        );
      expect(logs).toHaveLength(1);

      // Once verified there is nothing to resend.
      const again = await c.send('post', '/api/v1/auth/verify-email/resend');
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('EMAIL_ALREADY_VERIFIED');
    });

    it('requires sign-in to resend, and limits resends per account', async () => {
      expect(
        (await new Client(h.app).send('post', '/api/v1/auth/verify-email/resend')).status,
      ).toBe(401);
      const u = await createUser(h.db, 'CUSTOMER', {
        status: 'PENDING_VERIFICATION',
        emailVerifiedAt: null,
      });
      const c = new Client(h.app);
      expect((await c.login(u.email)).status).toBe(200);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++)
        statuses.push((await c.send('post', '/api/v1/auth/verify-email/resend')).status);
      expect(statuses).toEqual([202, 202, 202, 429]);
    });

    it('creates an owner profile for owner sign-ups', async () => {
      const email = uniqueEmail('owner-signup');
      await new Client(h.app).send('post', '/api/v1/auth/register', {
        email,
        password: PASSWORD,
        fullName: 'Owner Signup',
        accountType: 'OWNER',
      });
      const [u] = await h.db.select().from(users).where(eq(users.email, email));
      expect(u?.role).toBe('OWNER');
    });

    it('answers identically for an existing email and notifies the owner of that email', async () => {
      const existing = await createUser(h.db);
      const res = await new Client(h.app).send('post', '/api/v1/auth/register', {
        email: existing.email.toUpperCase(),
        password: PASSWORD,
        fullName: 'Impostor',
      });
      expect(res.status).toBe(202);
      expect(h.email.lastTo(existing.email)?.template).toBe('account_exists');
    });

    it('rejects weak passwords and privileged self-registration', async () => {
      const c = new Client(h.app);
      const email = uniqueEmail('weak');
      const short = await c.send('post', '/api/v1/auth/register', {
        email,
        password: 'short',
        fullName: 'Weak',
      });
      expect(short.status).toBe(400);
      const containsEmail = await c.send('post', '/api/v1/auth/register', {
        email,
        password: `${email.split('@')[0]}123456`,
        fullName: 'Weak',
      });
      expect(containsEmail.body.error.code).toBe('WEAK_PASSWORD');
      const admin = await c.send('post', '/api/v1/auth/register', {
        email,
        password: PASSWORD,
        fullName: 'Sneaky',
        accountType: 'SUPER_ADMIN',
      });
      expect(admin.status).toBe(400);
    });
  });

  describe('login', () => {
    it('gives the same response for an unknown email and a wrong password', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      const unknown = await c.login(uniqueEmail('nobody'));
      const wrong = await c.login(user.email, 'not the password at all');
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body.error.code).toBe(wrong.body.error.code);
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
    });

    it('sets the refresh token only as a __Host-, httpOnly, Secure, SameSite=Strict cookie', async () => {
      const user = await createUser(h.db);
      const res = await new Client(h.app).login(user.email);
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('__Host-mb_rt='),
      );
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).not.toMatch(/Domain=/i);
      expect(JSON.stringify(res.body)).not.toContain(cookie!.split(';')[0]!.split('=')[1]);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('stores only a hash of the refresh token', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      await c.login(user.email);
      const rows = await h.db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash.toString('utf8')).not.toContain(c.refreshCookie!.split('.')[1]);
      expect(rows[0]!.tokenHash).toHaveLength(32);
    });

    it('locks the account after 5 wrong passwords, even for the right password', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      for (let i = 0; i < 5; i++)
        expect((await c.login(user.email, 'wrong password!!')).status).toBe(401);
      const locked = await c.login(user.email);
      expect(locked.status).toBe(429);
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(800);

      const [row] = await h.db.select().from(users).where(eq(users.id, user.id));
      expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
      const events = await h.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.entityId, user.id));
      expect(events.map((e) => e.action)).toContain('auth.lockout');
      expect(h.email.lastTo(user.email)?.template).toBe('security_alert');
    });

    it('refuses suspended accounts', async () => {
      const user = await createUser(h.db, 'CUSTOMER', { status: 'SUSPENDED' });
      expect((await new Client(h.app).login(user.email)).status).toBe(403);
    });
  });

  describe('refresh rotation and reuse detection', () => {
    it('requires a valid CSRF token', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      await c.login(user.email);
      const noToken = await c.send('post', '/api/v1/auth/refresh', undefined, { bearer: null });
      expect(noToken.status).toBe(403);
      expect(noToken.body.error.code).toBe('CSRF_FAILED');

      // Attacker-chosen value in both cookie and header: matches, but the signature is wrong.
      c.cookies.set('__Host-mb_csrf', 'attacker-nonce.attacker-signature');
      const forged = await c.send('post', '/api/v1/auth/refresh', undefined, {
        csrf: true,
        bearer: null,
      });
      expect(forged.status).toBe(403);
      c.cookies.delete('__Host-mb_csrf');
    });

    it('rejects a CSRF token from another origin', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      await c.login(user.email);
      const token = await c.csrfToken();
      const res = await (
        await import('supertest')
      )
        .default(h.app)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'https://evil.example')
        .set('Cookie', [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
        .set('X-CSRF-Token', token);
      expect(res.status).toBe(403);
    });

    it('rotates the refresh token on every use', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      await c.login(user.email);
      const first = c.refreshCookie;
      const res = await c.refresh();
      expect(res.status).toBe(200);
      expect(c.refreshCookie).toBeDefined();
      expect(c.refreshCookie).not.toBe(first);
      expect((await c.send('get', '/api/v1/auth/me')).status).toBe(200);
    });

    it('revokes the whole family when a rotated token is replayed', async () => {
      const user = await createUser(h.db);
      const victim = new Client(h.app);
      await victim.login(user.email);
      const stolen = victim.refreshCookie!;
      await victim.refresh(); // legitimate rotation
      const victimAccess = victim.accessToken;

      // Attacker replays the old token.
      const attacker = new Client(h.app);
      attacker.cookies.set('__Host-mb_rt', stolen);
      const replay = await attacker.refresh();
      expect(replay.status).toBe(401);

      // The victim's current refresh token and access token are now dead too.
      expect((await victim.refresh()).status).toBe(401);
      expect(
        (await victim.send('get', '/api/v1/auth/me', undefined, { bearer: victimAccess! })).status,
      ).toBe(401);

      const live = await h.db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
      expect(live.every((t) => t.revokedAt !== null)).toBe(true);
      expect(live.some((t) => t.revokedReason === 'reuse_detected')).toBe(true);
      const [event] = await h.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, user.id), eq(auditLogs.action, 'auth.refresh_reuse')));
      expect(event).toBeDefined();
    });

    it('keeps other device sessions alive after one family is revoked', async () => {
      const user = await createUser(h.db);
      const phone = new Client(h.app);
      const laptop = new Client(h.app);
      await phone.login(user.email);
      await laptop.login(user.email);
      const stolen = phone.refreshCookie!;
      await phone.refresh();
      const attacker = new Client(h.app);
      attacker.cookies.set('__Host-mb_rt', stolen);
      await attacker.refresh();
      expect((await laptop.refresh()).status).toBe(200);
    });

    it('returns 401 when there is no refresh cookie at all', async () => {
      const res = await new Client(h.app).refresh();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('signs out a suspended user on their next refresh', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      await c.login(user.email);
      await h.db.update(users).set({ status: 'SUSPENDED' }).where(eq(users.id, user.id));
      expect((await c.refresh()).status).toBe(401);
    });

    it('rejects garbage and unknown-key refresh tokens', async () => {
      const c = new Client(h.app);
      c.cookies.set('__Host-mb_rt', 'zz.notarealtoken');
      expect((await c.refresh()).status).toBe(401);
    });
  });

  describe('logout', () => {
    it('kills the access token and refresh token immediately', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      await c.login(user.email);
      const access = c.accessToken!;
      const refresh = c.refreshCookie!;
      expect((await c.send('post', '/api/v1/auth/logout', undefined, { csrf: true })).status).toBe(
        204,
      );
      expect((await c.send('get', '/api/v1/auth/me', undefined, { bearer: access })).status).toBe(
        401,
      );
      const again = new Client(h.app);
      again.cookies.set('__Host-mb_rt', refresh);
      expect((await again.refresh()).status).toBe(401);
    });

    it('logout-all ends every device session', async () => {
      const user = await createUser(h.db);
      const a = new Client(h.app);
      const b = new Client(h.app);
      await a.login(user.email);
      await b.login(user.email);
      expect((await a.send('post', '/api/v1/auth/logout-all')).status).toBe(204);
      expect((await b.send('get', '/api/v1/auth/me')).status).toBe(401);
      expect((await b.refresh()).status).toBe(401);
      // A fresh login afterwards works.
      await new Promise((r) => setTimeout(r, 1100));
      expect((await a.login(user.email)).status).toBe(200);
      expect((await a.send('get', '/api/v1/auth/me')).status).toBe(200);
    });

    it('lists sessions and only revokes the caller’s own', async () => {
      const user = await createUser(h.db);
      const other = await createUser(h.db);
      const mine = new Client(h.app);
      const theirs = new Client(h.app);
      await mine.login(user.email);
      await theirs.login(other.email);
      const list = await mine.send('get', '/api/v1/auth/sessions');
      expect(list.body.sessions).toHaveLength(1);
      expect(list.body.sessions[0].current).toBe(true);

      const theirFamily = (await theirs.send('get', '/api/v1/auth/sessions')).body.sessions[0]
        .familyId;
      const cross = await mine.send('delete', `/api/v1/auth/sessions/${theirFamily}`);
      expect(cross.status).toBe(404);
      expect((await theirs.send('get', '/api/v1/auth/me')).status).toBe(200);
    });
  });

  describe('password reset', () => {
    it('resets the password once and signs out all sessions', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      await c.login(user.email);
      const oldAccess = c.accessToken!;

      expect(
        (await c.send('post', '/api/v1/auth/password/forgot', { email: user.email })).status,
      ).toBe(202);
      const token = tokenFromEmail(h.email, user.email);
      const newPassword = 'a brand new passphrase';
      const reset = await c.send('post', '/api/v1/auth/password/reset', {
        token,
        password: newPassword,
      });
      expect(reset.status).toBe(200);
      expect(
        (await c.send('post', '/api/v1/auth/password/reset', { token, password: newPassword }))
          .status,
      ).toBe(400);

      expect(
        (await c.send('get', '/api/v1/auth/me', undefined, { bearer: oldAccess })).status,
      ).toBe(401);
      expect((await c.login(user.email)).status).toBe(401);
      await new Promise((r) => setTimeout(r, 1100));
      expect((await c.login(user.email, newPassword)).status).toBe(200);
    });

    it('does not reveal whether an email is registered', async () => {
      const res = await new Client(h.app).send('post', '/api/v1/auth/password/forgot', {
        email: uniqueEmail('ghost'),
      });
      expect(res.status).toBe(202);
    });
  });

  describe('phone OTP', () => {
    it('verifies a phone with the right code and counts wrong attempts', async () => {
      const user = await createUser(h.db);
      const c = new Client(h.app);
      await c.login(user.email);
      const phone = `+9197${String(Date.now()).slice(-8)}`;
      expect((await c.send('post', '/api/v1/auth/otp/send', { phone })).status).toBe(202);
      const code = /(\d{6})/.exec(h.sms.lastTo(phone)!.text)![1]!;
      const wrong = code === '000000' ? '111111' : '000000';
      expect((await c.send('post', '/api/v1/auth/otp/verify', { phone, code: wrong })).status).toBe(
        400,
      );
      expect((await c.send('post', '/api/v1/auth/otp/verify', { phone, code })).status).toBe(200);
      const me = await c.send('get', '/api/v1/auth/me');
      expect(me.body).toMatchObject({ phone, phoneVerified: true });
      // Codes are single use.
      expect((await c.send('post', '/api/v1/auth/otp/verify', { phone, code })).status).toBe(400);
    });

    it('requires sign-in', async () => {
      const res = await new Client(h.app).send('post', '/api/v1/auth/otp/send', {
        phone: '+919876543210',
      });
      expect(res.status).toBe(401);
    });
  });
});
