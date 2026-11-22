import { randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditoriums,
  bookingStatusHistory,
  bookings,
  cancellationPolicies,
  cities,
  halls,
  invoices,
  notifications,
  pricingRules,
} from '../../../src/db/schema/index.js';
import { todayInIst } from '../../../src/lib/time.js';
import { InvoiceService } from '../../../src/modules/invoices/invoice.service.js';
import {
  MAX_ATTEMPTS,
  NotificationService,
} from '../../../src/modules/notifications/notification.service.js';
import type { EmailMessage, EmailSender } from '../../../src/modules/notifications/senders.js';
import { hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, createHarness, createUser } from '../../auth-harness.js';

function wednesdayAfter(minDays: number): string {
  const [y, m, d] = todayInIst().split('-').map(Number) as [number, number, number];
  for (let i = minDays; ; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    if (date.getUTCDay() === 3) return date.toISOString().slice(0, 10);
  }
}

describe.skipIf(!hasTestDb)('notifications and invoices', { timeout: 120_000 }, () => {
  let h: Harness;
  let hallId: string;
  let owner: { id: string; email: string };
  let service: NotificationService;
  let offset = 400;
  const logger = pino({ level: 'silent' });

  async function customer() {
    const u = await createUser(h.db, 'CUSTOMER');
    const c = new Client(h.app);
    await c.login(u.email);
    return { ...u, c };
  }

  async function paidBooking() {
    const cust = await customer();
    const hold = await cust.c.send('post', '/api/v1/bookings', {
      hallId,
      eventDate: wednesdayAfter((offset += 7)),
      slot: 'FULL_DAY',
      guestCount: 300,
    });
    expect(hold.status).toBe(201);
    const o = await request(h.app)
      .post('/api/v1/payments/orders')
      .set('Origin', 'http://localhost:4200')
      .set('Authorization', `Bearer ${cust.c.accessToken}`)
      .send({ bookingId: hold.body.id });
    await request(h.app)
      .post(`${o.body.checkout.url}/complete`)
      .type('form')
      .send({ outcome: 'success' });
    return { cust, bookingId: hold.body.id as string };
  }

  const mine = (to: string[]) => h.email.sent.filter((m) => to.includes(m.to));

  beforeAll(async () => {
    h = await createHarness({
      limitOverrides: { holdPerUser: { points: 1000, windowSeconds: 60 } },
    });
    service = new NotificationService(
      h.db,
      h.email,
      new InvoiceService(h.db),
      'http://localhost:4200',
      logger,
    );
    const [city] = await h.db
      .insert(cities)
      .values({
        name: 'Thrissur',
        slug: `thrissur-${randomBytes(3).toString('hex')}`,
        district: 'Thrissur',
        state: 'Kerala',
      })
      .returning();
    owner = await createUser(h.db, 'OWNER');
    const [a] = await h.db
      .insert(auditoriums)
      .values({
        ownerId: owner.id,
        cityId: city!.id,
        name: 'Vadakkumnathan Convention Centre',
        slug: `vcc-${randomBytes(4).toString('hex')}`,
        addressLine: 'Round North',
        pincode: '680001',
        cateringPolicy: 'OUTSIDE_ALLOWED',
        decorationPolicy: 'OUTSIDE_ALLOWED',
        advancePercent: 25,
        instantBook: true,
        status: 'APPROVED',
      })
      .returning();
    const [hall] = await h.db
      .insert(halls)
      .values({ auditoriumId: a!.id, name: 'Main Hall', seatingCapacity: 1200 })
      .returning();
    hallId = hall!.id;
    await h.db.insert(pricingRules).values(
      (['MORNING', 'EVENING', 'FULL_DAY'] as const).map((slot) => ({
        hallId,
        slot,
        kind: 'BASE' as const,
        pricePaise: 8_000_000,
      })),
    );
    await h.db.insert(cancellationPolicies).values({
      auditoriumId: a!.id,
      tiers: [{ minDaysBefore: 0, refundPercent: 50 }],
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('emails the customer (with the invoice) and the owner once per confirmed booking', async () => {
    const { cust, bookingId } = await paidBooking();
    await service.processOutbox();
    await service.processOutbox(); // a second pass queues nothing new
    await service.deliverDue();
    await service.deliverDue();

    const toCustomer = mine([cust.email]);
    expect(toCustomer.map((m) => m.template)).toEqual(['booking_confirmed']);
    const [confirmed] = toCustomer as [EmailMessage];
    expect(confirmed.subject).toContain('Booking confirmed');
    expect(confirmed.text).toContain(`/account/bookings/${bookingId}`);
    expect(confirmed.attachments?.[0]).toMatchObject({ contentType: 'application/pdf' });
    expect(confirmed.attachments![0]!.content.subarray(0, 5).toString()).toBe('%PDF-');

    const [b] = await h.db.select().from(bookings).where(eq(bookings.id, bookingId));
    const toOwner = mine([owner.email]).filter((m) => m.subject.includes(b!.refCode));
    expect(toOwner.map((m) => m.template)).toEqual(['owner_new_booking']);

    const rows = await h.db
      .select()
      .from(notifications)
      .where(inArray(notifications.userId, [cust.id]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'SENT', attempts: 1 });
    // Templates hold no contact details or payment secrets.
    expect(JSON.stringify(rows[0]!.data)).not.toContain(cust.email);
  });

  it('tells the customer about a cancellation and the refund', async () => {
    const { cust, bookingId } = await paidBooking();
    await service.processOutbox();
    const res = await cust.c.send('post', `/api/v1/bookings/${bookingId}/cancel`, {
      reason: 'Change of plans',
    });
    expect(res.status).toBe(200);
    await service.processOutbox();
    await service.deliverDue();
    const templates = mine([cust.email]).map((m) => m.template);
    expect(templates).toEqual(
      expect.arrayContaining(['booking_confirmed', 'booking_cancelled', 'refund_processed']),
    );
  });

  it('retries failed deliveries with backoff and gives up after the limit', async () => {
    const failing: EmailSender = {
      send: async () => {
        throw new Error('smtp down');
      },
    };
    const flaky = new NotificationService(
      h.db,
      failing,
      new InvoiceService(h.db),
      'http://x',
      logger,
    );
    const { cust } = await paidBooking();
    await flaky.processOutbox();
    const [row] = await h.db.select().from(notifications).where(eq(notifications.userId, cust.id));
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await h.db
        .update(notifications)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(notifications.id, row!.id));
      await flaky.deliverDue();
      const [now] = await h.db.select().from(notifications).where(eq(notifications.id, row!.id));
      expect(now!.attempts).toBe(i);
      expect(now!.status).toBe(i < MAX_ATTEMPTS ? 'QUEUED' : 'FAILED');
      expect(now!.lastError).toContain('smtp down');
      if (i < MAX_ATTEMPTS) expect(now!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('numbers invoices sequentially per financial year without duplicates', async () => {
    const a = await paidBooking();
    const b = await paidBooking();
    const inv = new InvoiceService(h.db);
    // Concurrent first requests, two for the same booking: all must succeed, and the
    // same booking must get one number.
    const [b1, ...forA] = await Promise.all([
      inv.ensureNumber(b.bookingId),
      ...Array.from({ length: 5 }, () => inv.ensureNumber(a.bookingId)),
    ]);
    const aNumbers = new Set(forA.map((r) => r.number));
    expect(aNumbers.size).toBe(1);
    const numbers = new Set([b1.number, ...aNumbers]);
    expect(numbers.size).toBe(2);
    for (const n of numbers) expect(n).toMatch(/^MB\/\d{4}-\d{2}\/\d{6}$/);
    // Asking again returns the same number.
    expect((await inv.ensureNumber(a.bookingId)).number).toBe(
      (await h.db.select().from(invoices).where(eq(invoices.bookingId, a.bookingId)))[0]!.number,
    );
  });

  it('serves the invoice only to the customer and the venue owner, and only once paid', async () => {
    const { cust, bookingId } = await paidBooking();
    const pdf = await cust.c.send('get', `/api/v1/bookings/${bookingId}/invoice.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(
      /^attachment; filename="MB-\d{4}-\d{2}-\d{6}\.pdf"$/,
    );

    const ownerClient = new Client(h.app);
    await ownerClient.login(owner.email);
    expect(
      (await ownerClient.send('get', `/api/v1/owner/bookings/${bookingId}/invoice.pdf`)).status,
    ).toBe(200);

    const stranger = await customer();
    expect((await stranger.c.send('get', `/api/v1/bookings/${bookingId}/invoice.pdf`)).status).toBe(
      404,
    );
    const otherOwner = await createUser(h.db, 'OWNER');
    const oc = new Client(h.app);
    await oc.login(otherOwner.email);
    expect((await oc.send('get', `/api/v1/owner/bookings/${bookingId}/invoice.pdf`)).status).toBe(
      404,
    );

    const unpaid = await cust.c.send('post', '/api/v1/bookings', {
      hallId,
      eventDate: wednesdayAfter((offset += 7)),
      slot: 'MORNING',
      guestCount: 50,
    });
    expect(unpaid.status).toBe(201);
    const res = await cust.c.send('get', `/api/v1/bookings/${unpaid.body.id}/invoice.pdf`);
    expect(res.body.error.code).toBe('NOT_INVOICEABLE');
  });

  it('does not announce transitions that happened before the outbox existed', async () => {
    const { bookingId } = await paidBooking();
    await h.db
      .update(bookingStatusHistory)
      .set({ notifiedAt: new Date() })
      .where(eq(bookingStatusHistory.bookingId, bookingId));
    const before = h.email.sent.length;
    await service.processOutbox();
    await service.deliverDue();
    const [b] = await h.db.select().from(bookings).where(eq(bookings.id, bookingId));
    const extra = h.email.sent.slice(before).filter((m) => m.subject.includes(b!.refCode));
    expect(extra).toHaveLength(0);
  });
});
