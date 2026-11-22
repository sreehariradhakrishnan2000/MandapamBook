import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  auditoriums,
  bookings,
  cities,
  halls,
  ownerStaff,
  payments,
  payouts,
} from '../../../src/db/schema/index.js';
import { PayoutService } from '../../../src/modules/payouts/payout.service.js';
import { SettingsService } from '../../../src/modules/settings/settings.service.js';
import { bookingValues, hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, createHarness, createUser } from '../../auth-harness.js';

describe.skipIf(!hasTestDb)('payouts and reports', { timeout: 120_000 }, () => {
  let h: Harness;
  let owner: { id: string; email: string; c: Client };
  let venueId: string;
  let hallId: string;
  let accrual: PayoutService;
  let day = 0;
  // A fixed far-past financial year that no other test file writes to.
  const FY = { from: '2019-04-01', to: '2020-03-31' };
  const date = () => new Date(Date.UTC(2019, 5, 1) + day++ * 86_400_000).toISOString().slice(0, 10);

  async function login(role: 'CUSTOMER' | 'OWNER' | 'ADMIN' | 'OWNER_STAFF' | 'SUPER_ADMIN') {
    const u = await createUser(h.db, role);
    const c = new Client(h.app);
    await c.login(u.email);
    return { ...u, c };
  }

  /** A booking with a captured online payment (and optional refund). */
  async function paid(
    status: 'COMPLETED' | 'CANCELLED' | 'CONFIRMED',
    capturedPaise: number,
    refundedPaise = 0,
  ) {
    const cust = await createUser(h.db, 'CUSTOMER');
    const [b] = await h.db
      .insert(bookings)
      .values(
        bookingValues({ customerId: cust.id, auditoriumId: venueId, hallId } as never, {
          date: date(),
          slot: 'FULL_DAY',
          status,
        }),
      )
      .returning();
    await h.db.insert(payments).values({
      bookingId: b!.id,
      provider: 'mock',
      providerOrderId: `mock_order_${randomUUID()}`,
      providerPaymentId: `mock_pay_${randomUUID()}`,
      status:
        refundedPaise === 0
          ? 'CAPTURED'
          : refundedPaise === capturedPaise
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED',
      amountPaise: capturedPaise,
      refundedPaise,
      idempotencyKey: `test-${randomUUID()}`,
      capturedAt: new Date(),
    });
    return b!;
  }

  beforeAll(async () => {
    h = await createHarness();
    accrual = new PayoutService(h.db, new SettingsService(h.db));
    const [city] = await h.db
      .insert(cities)
      .values({
        name: 'Kozhikode',
        slug: `kozhikode-${randomBytes(3).toString('hex')}`,
        district: 'Kozhikode',
        state: 'Kerala',
      })
      .returning();
    owner = await login('OWNER');
    const [a] = await h.db
      .insert(auditoriums)
      .values({
        ownerId: owner.id,
        cityId: city!.id,
        name: 'Malabar Palace Auditorium',
        slug: `malabar-${randomBytes(4).toString('hex')}`,
        addressLine: 'Mavoor Road',
        pincode: '673004',
        cateringPolicy: 'OUTSIDE_ALLOWED',
        decorationPolicy: 'OUTSIDE_ALLOWED',
        advancePercent: 25,
        status: 'APPROVED',
      })
      .returning();
    venueId = a!.id;
    const [hall] = await h.db
      .insert(halls)
      .values({ auditoriumId: venueId, name: 'Main', seatingCapacity: 900 })
      .returning();
    hallId = hall!.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  it('accrues one payout per settled booking and none for upcoming ones', async () => {
    const done = await paid('COMPLETED', 3_000_000);
    const cancelled = await paid('CANCELLED', 3_000_000, 2_000_000);
    const upcoming = await paid('CONFIRMED', 3_000_000);
    await accrual.accrue(10_000);
    await accrual.accrue(10_000);
    const rows = await h.db.select().from(payouts).where(eq(payouts.ownerId, owner.id));
    const by = (id: string) => rows.filter((r) => r.bookingId === id);
    expect(by(done.id)).toHaveLength(1);
    expect(by(done.id)[0]).toMatchObject({
      grossPaise: 3_000_000 - 49_900,
      commissionPaise: 800_000,
      status: 'PENDING',
    });
    expect(by(cancelled.id)[0]).toMatchObject({ grossPaise: 950_100, commissionPaise: 76_008 });
    expect(by(upcoming.id)).toHaveLength(0);
  });

  it('shows the owner their earnings, and refuses staff and other owners', async () => {
    const res = await owner.c.send('get', `/api/v1/owner/earnings?from=${FY.from}&to=${FY.to}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      from: FY.from,
      to: FY.to,
      commissionPaise: 876_008,
      paidOutPaise: 0,
    });
    expect(res.body.summary.netPaise).toBe(res.body.summary.pendingPaise);
    expect(res.body.payouts.length).toBeGreaterThanOrEqual(2);

    const other = await login('OWNER');
    const theirs = await other.c.send('get', `/api/v1/owner/earnings?from=${FY.from}&to=${FY.to}`);
    expect(theirs.body.summary.netPaise).toBe(0);
    expect(theirs.body.payouts).toEqual([]);

    const staff = await login('OWNER_STAFF');
    await h.db.insert(ownerStaff).values({ ownerId: owner.id, userId: staff.id });
    expect((await staff.c.send('get', '/api/v1/owner/earnings')).status).toBe(403);
    expect(
      (await owner.c.send('get', '/api/v1/owner/earnings?from=2020-01-01&to=2019-01-01')).status,
    ).toBe(400);
  });

  it('gives admins a summary and a formula-safe CSV export, and audits the export', async () => {
    const admin = await login('ADMIN');
    const cust = await login('CUSTOMER');
    expect((await cust.c.send('get', '/api/v1/admin/reports/summary')).status).toBe(403);
    expect((await owner.c.send('get', '/api/v1/admin/reports/summary')).status).toBe(403);

    const sum = await admin.c.send(
      'get',
      `/api/v1/admin/reports/summary?from=${FY.from}&to=${FY.to}`,
    );
    expect(sum.status).toBe(200);
    expect(sum.body.bookingsByStatus).toMatchObject({ COMPLETED: 1, CANCELLED: 1, CONFIRMED: 1 });
    expect(sum.body.collectedOnlinePaise).toBe(9_000_000);
    expect(sum.body.refundedPaise).toBe(2_000_000);
    expect(sum.body.commissionPaise).toBe(876_008);
    expect(sum.body.topCities[0]).toMatchObject({ city: 'Kozhikode', bookings: 2 });

    await h.db.update(auditoriums).set({ name: '=cmd|calc!A1' }).where(eq(auditoriums.id, venueId));
    const csv = await admin.c.send(
      'get',
      `/api/v1/admin/reports/bookings.csv?from=${FY.from}&to=${FY.to}`,
    );
    await h.db
      .update(auditoriums)
      .set({ name: 'Malabar Palace Auditorium' })
      .where(eq(auditoriums.id, venueId));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const text = csv.text;
    expect(text.split('\r\n')[0]).toContain('reference,event_date');
    expect(text).toContain(`"'=cmd|calc!A1"`);
    expect(text).not.toMatch(/,=cmd/);
    expect(text).not.toContain('@example.test');
    const logs = await h.db.select().from(auditLogs).where(eq(auditLogs.actorId, admin.id));
    expect(logs.map((l) => l.action)).toContain('report.exported');
  });

  it('lets admins mark a payout paid once, with an audited reference', async () => {
    const admin = await login('ADMIN');
    const [p] = await h.db.select().from(payouts).where(eq(payouts.ownerId, owner.id));
    expect(
      (
        await owner.c.send('post', `/api/v1/admin/payouts/${p!.id}/mark-paid`, {
          reference: 'UTR123456',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin.c.send('post', `/api/v1/admin/payouts/${p!.id}/mark-paid`, {
          reference: 'bad ref!',
        })
      ).status,
    ).toBe(400);
    const ok = await admin.c.send('post', `/api/v1/admin/payouts/${p!.id}/mark-paid`, {
      reference: 'UTR123456',
    });
    expect(ok.body).toEqual({ id: p!.id, status: 'PAID', reference: 'UTR123456' });
    expect(
      (
        await admin.c.send('post', `/api/v1/admin/payouts/${p!.id}/mark-paid`, {
          reference: 'UTR999999',
        })
      ).body.error.code,
    ).toBe('ALREADY_PAID');

    const list = await admin.c.send('get', '/api/v1/admin/payouts?status=PAID');
    expect(list.body.items.some((i: { id: string }) => i.id === p!.id)).toBe(true);
    const earnings = await owner.c.send(
      'get',
      `/api/v1/owner/earnings?from=${FY.from}&to=${FY.to}`,
    );
    expect(earnings.body.summary.paidOutPaise).toBe(p!.netPaise);
    const [log] = await h.db.select().from(auditLogs).where(eq(auditLogs.entityId, p!.id));
    expect(log).toMatchObject({ action: 'payout.marked_paid' });
  });
});
