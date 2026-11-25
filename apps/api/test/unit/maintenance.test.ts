import { randomBytes } from 'node:crypto';
import type { Maintenance } from '@mandapambook/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/http/middleware/errorHandler.js';
import { AccessTokenService } from '../../src/modules/auth/access-tokens.js';
import {
  type MaintenanceService,
  maintenanceGate,
} from '../../src/modules/settings/maintenance.js';

const tokens = new AccessTokenService([{ kid: 'k1', secret: randomBytes(32) }], 900);

/** A tiny app: the gate in front of a few routes, like the real /api/v1 router. */
function appWith(state: Maintenance) {
  const fake = { get: async () => state } as unknown as MaintenanceService;
  const api = express.Router();
  api.use(maintenanceGate(fake, tokens));
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
});
