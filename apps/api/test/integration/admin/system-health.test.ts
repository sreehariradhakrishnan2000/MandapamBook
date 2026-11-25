import { randomBytes } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemHealth } from '../../../src/modules/admin/system-health.js';
import { MemoryEmailSender } from '../../../src/modules/notifications/senders.js';
import { hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, createHarness, createUser } from '../../auth-harness.js';

const logger = pino({ level: 'silent' });

describe.skipIf(!hasTestDb)('system health', { timeout: 120_000 }, () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  // Each run uses its own alert keys and far-future dates, so the shared test database's
  // other notifications and earlier runs cannot affect it.
  const health = (smtpKeyExpiresAt?: string) =>
    new SystemHealth(h.db, {
      emailProvider: 'smtp',
      smtpKeyExpiresAt,
      adminEmail: 'ops@example.test',
      appBaseUrl: 'http://localhost:4200',
      alertKeyPrefix: `test-${randomBytes(4).toString('hex')}`,
    });
  const at = (iso: string) => new Date(iso);

  it('counts days until the SMTP key expires, in India time', async () => {
    const s = await health('2099-01-20').email(at('2099-01-01T00:00:00+05:30'));
    expect(s).toMatchObject({
      provider: 'smtp',
      smtpKeyExpiresAt: '2099-01-20',
      daysUntilKeyExpiry: 19,
    });
    expect((await health().email()).daysUntilKeyExpiry).toBeNull();
  });

  it('reminds the admin weekly from 30 days before the key expires, never twice in a week', async () => {
    const s = health('2099-01-20');
    const email = new MemoryEmailSender();
    // 50 days out: too early.
    expect(await s.sendAlerts(email, logger, at('2098-12-01T09:00:00+05:30'))).toEqual([]);
    // 19 days out: remind once...
    expect(await s.sendAlerts(email, logger, at('2099-01-01T09:00:00+05:30'))).toEqual([
      'smtp_key_expiry',
    ]);
    // ...not again the next day...
    expect(await s.sendAlerts(email, logger, at('2099-01-02T09:00:00+05:30'))).toEqual([]);
    // ...but again a week later.
    expect(await s.sendAlerts(email, logger, at('2099-01-08T10:00:00+05:30'))).toEqual([
      'smtp_key_expiry',
    ]);
    expect(email.sent).toHaveLength(2);
    expect(email.sent[0]).toMatchObject({ to: 'ops@example.test' });
    expect(email.sent[0]!.subject).toContain('expires in 19 days');
    expect(email.sent[0]!.html).toContain('Generate a new SMTP key');
  });

  it('sends nothing without an admin address', async () => {
    const quiet = new SystemHealth(h.db, {
      emailProvider: 'smtp',
      smtpKeyExpiresAt: '2099-01-02',
      appBaseUrl: 'http://x',
    });
    expect(
      await quiet.sendAlerts(new MemoryEmailSender(), logger, at('2099-01-01T00:00:00Z')),
    ).toEqual([]);
  });

  it('shows admins the email health on the dashboard, and only admins', async () => {
    const customer = await createUser(h.db, 'CUSTOMER');
    const c = new Client(h.app);
    await c.login(customer.email);
    expect((await c.send('get', '/api/v1/admin/system-health')).status).toBe(403);

    const admin = await createUser(h.db, 'ADMIN');
    const a = new Client(h.app);
    await a.login(admin.email);
    const res = await a.send('get', '/api/v1/admin/system-health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: { failedLast24h: expect.any(Number), queued: expect.any(Number) },
      errorTracking: { api: false, web: false },
    });
  });
});
