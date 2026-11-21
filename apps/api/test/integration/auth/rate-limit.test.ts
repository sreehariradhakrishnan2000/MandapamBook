import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, createHarness, createUser } from '../../auth-harness.js';

describe.skipIf(!hasTestDb)('rate limiting', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness({
      limitOverrides: {
        loginPerIp: { points: 3, windowSeconds: 60 },
        otpSendPerUser: { points: 2, windowSeconds: 60 },
        passwordResetPerEmail: { points: 1, windowSeconds: 60 },
      },
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('limits login attempts per IP with a Retry-After header', async () => {
    const c = new Client(h.app);
    const user = await createUser(h.db);
    for (let i = 0; i < 3; i++) await c.login(user.email, 'wrong password!!');
    const blocked = await c.login(user.email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits OTP sends per user', async () => {
    const fresh = await createHarness({
      limitOverrides: { otpSendPerUser: { points: 2, windowSeconds: 60 } },
    });
    try {
      const user = await createUser(fresh.db);
      const c = new Client(fresh.app);
      await c.login(user.email);
      const phone = `+9196${String(Date.now()).slice(-8)}`;
      expect((await c.send('post', '/api/v1/auth/otp/send', { phone })).status).toBe(202);
      expect((await c.send('post', '/api/v1/auth/otp/send', { phone })).status).toBe(202);
      expect((await c.send('post', '/api/v1/auth/otp/send', { phone })).status).toBe(429);
    } finally {
      await fresh.close();
    }
  });

  it('limits password reset emails per address', async () => {
    const fresh = await createHarness({
      limitOverrides: { passwordResetPerEmail: { points: 1, windowSeconds: 60 } },
    });
    try {
      const user = await createUser(fresh.db);
      const c = new Client(fresh.app);
      expect(
        (await c.send('post', '/api/v1/auth/password/forgot', { email: user.email })).status,
      ).toBe(202);
      expect(
        (await c.send('post', '/api/v1/auth/password/forgot', { email: user.email })).status,
      ).toBe(429);
      expect(fresh.email.sent.filter((m) => m.to === user.email)).toHaveLength(1);
    } finally {
      await fresh.close();
    }
  });
});
