import { randomBytes } from 'node:crypto';
import type { Maintenance } from '@mandapambook/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/http/middleware/errorHandler.js';
import { MemoryRevocationStore } from '../../src/infra/revocation-store.js';
import { AccessTokenService } from '../../src/modules/auth/access-tokens.js';
import {
  type BookingsPauseService,
  MAINTENANCE_OFF,
  type MaintenanceService,
  bookingsPauseGate,
  maintenanceGate,
} from '../../src/modules/settings/maintenance.js';

const tokens = new AccessTokenService([{ kid: 'k1', secret: randomBytes(32) }], 900);
const revocations = new MemoryRevocationStore();

/** A tiny app: the gate in front of a few routes, like the real /api/v1 router. */
function appWith(state: Partial<Maintenance>) {
  const fake = {
    get: async () => ({ ...MAINTENANCE_OFF, ...state }),
  } as unknown as MaintenanceService;
  const api = express.Router();
  api.use(maintenanceGate(fake, tokens, revocations));
  for (const path of [
    '/auditoriums',
    '/status',
    '/auth/login',
    '/payments/webhooks/razorpay',
    '/admin/users',
  ])
    api.all(path, (_req, res) => res.json({ ok: true }));
  const app = express();
  app.use('/api/v1', api);
  app.use(errorHandler);
  return app;
}

const bearer = async (role: 'CUSTOMER' | 'OWNER' | 'ADMIN' | 'SUPER_ADMIN') =>
  `Bearer ${(await tokens.sign({ userId: 'u1', role, familyId: 'f1' })).token}`;

describe('maintenance gate', () => {
  it('lets everything through while maintenance is off', async () => {
    const app = appWith({ enabled: false, message: '', until: null });
    expect((await request(app).get('/api/v1/auditoriums')).status).toBe(200);
  });

  it('closes the site to visitors, customers and owners with a 503 and the message', async () => {
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    const app = appWith({ enabled: true, message: 'Upgrading payments', until });
    for (const auth of [undefined, await bearer('CUSTOMER'), await bearer('OWNER')]) {
      const req = request(app).get('/api/v1/auditoriums');
      const res = await (auth ? req.set('Authorization', auth) : req);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        code: 'MAINTENANCE',
        message: 'Upgrading payments',
        details: { until },
      });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(1700);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    // A forged or garbage token is treated as a visitor.
    const forged = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', 'Bearer not.a.token');
    expect(forged.status).toBe(503);
  });

  it('keeps admins, sign-in, the status check and payment webhooks working', async () => {
    const app = appWith({ enabled: true, message: '', until: null });
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      const res = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', await bearer(role));
      expect(res.status).toBe(200);
    }
    expect((await request(app).get('/api/v1/status')).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login')).status).toBe(200);
    expect((await request(app).post('/api/v1/payments/webhooks/razorpay')).status).toBe(200);
    // The default message and a 5-minute retry hint when no end time is set.
    const closed = await request(app).get('/api/v1/auditoriums');
    expect(closed.body.error.message).toContain('planned maintenance');
    expect(closed.headers['retry-after']).toBe('300');
  });

  it('treats a signed-out or cut-off admin token as a visitor', async () => {
    const app = appWith({ enabled: true, message: '', until: null });
    const loggedOut = await tokens.sign({ userId: 'a1', role: 'ADMIN', familyId: 'f-a' });
    await revocations.revokeToken(loggedOut.claims.jti, 900);
    const suspended = await tokens.sign({ userId: 'a2', role: 'SUPER_ADMIN', familyId: 'f-b' });
    await revocations.setUserCutoff('a2', Date.now() + 1, 900);
    for (const t of [loggedOut, suspended]) {
      const res = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${t.token}`);
      expect(res.status).toBe(503);
    }
  });
});

describe('bookings pause gate', () => {
  function pausedApp(paused: boolean, message = '') {
    const fake = { get: async () => ({ paused, message }) } as unknown as BookingsPauseService;
    const api = express.Router();
    api.use(bookingsPauseGate(fake));
    api.all(/.*/, (_req, res) => res.json({ ok: true }));
    const app = express();
    app.use('/api/v1', api);
    app.use(errorHandler);
    return app;
  }

  it('refuses only new holds and new payment orders while paused', async () => {
    const app = pausedApp(true, 'Payments are being fixed');
    for (const path of ['/api/v1/bookings', '/api/v1/payments/orders']) {
      const res = await request(app).post(path);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        code: 'BOOKINGS_PAUSED',
        message: 'Payments are being fixed',
      });
    }
    // Browsing, quotes, cancelling, verifying a payment already made and webhooks still work.
    expect((await request(app).get('/api/v1/auditoriums')).status).toBe(200);
    expect((await request(app).post('/api/v1/bookings/quote')).status).toBe(200);
    expect((await request(app).post('/api/v1/bookings/b1/cancel')).status).toBe(200);
    expect((await request(app).post('/api/v1/payments/verify')).status).toBe(200);
    expect((await request(app).post('/api/v1/payments/webhooks/razorpay')).status).toBe(200);
    expect((await request(app).get('/api/v1/bookings')).status).toBe(200);
  });

  it('uses a default message, and lets everything through when not paused', async () => {
    const paused = await request(pausedApp(true)).post('/api/v1/bookings');
    expect(paused.body.error.message).toContain('New bookings are paused');
    expect((await request(pausedApp(false)).post('/api/v1/bookings')).status).toBe(200);
  });
});
