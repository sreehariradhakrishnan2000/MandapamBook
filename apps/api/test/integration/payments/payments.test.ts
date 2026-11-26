import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { TERMS_VERSION } from '@mandapambook/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  auditoriums,
  bookingStatusHistory,
  bookings,
  cancellationPolicies,
  cities,
  halls,
  payments,
  pricingRules,
  refunds,
} from '../../../src/db/schema/index.js';
import { todayInIst } from '../../../src/lib/time.js';
import { hasTestDb } from '../../db-helpers.js';
import { Client, type Harness, ORIGIN, createHarness, createUser } from '../../auth-harness.js';

function weekdayAtLeast(minDays: number): string {
  const [y, m, d] = todayInIst().split('-').map(Number) as [number, number, number];
  for (let i = minDays; ; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    if (date.getUTCDay() === 3) return date.toISOString().slice(0, 10);
  }
}

describe.skipIf(!hasTestDb)('payments', { timeout: 120_000 }, () => {
  let h: Harness;
  let instantHall: string;
  let requestHall: string;
  let ownerEmail: string;
  let offset = 70;
  const nextDate = () => weekdayAtLeast((offset += 7));

  async function venue(ownerId: string, cityId: string, instantBook: boolean) {
    const [a] = await h.db
      .insert(auditoriums)
      .values({
        ownerId,
        cityId,
        name: `Kovai Grand ${randomBytes(2).toString('hex')}`,
        slug: `kovai-grand-${randomBytes(4).toString('hex')}`,
        addressLine: '1450 Avinashi Road',
        pincode: '641004',
        cateringPolicy: 'OUTSIDE_ALLOWED',
        decorationPolicy: 'OUTSIDE_ALLOWED',
        advancePercent: 20,
        instantBook,
        status: 'APPROVED',
      })
      .returning();
    const [hall] = await h.db
      .insert(halls)
      .values({ auditoriumId: a!.id, name: 'Hall A', seatingCapacity: 1500 })
      .returning();
    await h.db.insert(pricingRules).values(
      (['MORNING', 'EVENING', 'FULL_DAY'] as const).map((slot) => ({
        hallId: hall!.id,
        slot,
        kind: 'BASE' as const,
        pricePaise: 10_000_000,
      })),
    );
    await h.db.insert(cancellationPolicies).values({
      auditoriumId: a!.id,
      tiers: [
        { minDaysBefore: 60, refundPercent: 90 },
        { minDaysBefore: 0, refundPercent: 0 },
      ],
    });
    return hall!.id;
  }

  async function customer() {
    const u = await createUser(h.db, 'CUSTOMER');
    const c = new Client(h.app);
    await c.login(u.email);
    return { ...u, c };
  }

  async function heldBooking(hallId = instantHall, date = nextDate()) {
    const cust = await customer();
    const hold = await cust.c.send('post', '/api/v1/bookings', {
      hallId,
      eventDate: date,
      slot: 'FULL_DAY',
      guestCount: 500,
    });
    expect(hold.status).toBe(201);
    return { cust, bookingId: hold.body.id as string, date };
  }

  async function order(c: Client, bookingId: string, key?: string) {
    let req = request(h.app)
      .post('/api/v1/payments/orders')
      .set('Origin', ORIGIN)
      .set('Authorization', `Bearer ${c.accessToken}`);
    if (key) req = req.set('Idempotency-Key', key);
    return req.send({ bookingId, acceptTerms: true });
  }

  /**
   * Delivers a webhook through the real HTTP endpoint, as the gateway would. The body is
   * sent as a string: superagent would re-serialise a Buffer as JSON and break the signature.
   */
  function webhook(body: Record<string, unknown>, timestamp?: number) {
    const signed = h.gateway.signWebhook(body, timestamp);
    return request(h.app)
      .post('/api/v1/payments/webhooks/mock')
      .set(signed.headers)
      .send(signed.rawBody.toString('utf8'));
  }

  const bookingStatus = async (id: string) =>
    (await h.db.select().from(bookings).where(eq(bookings.id, id)))[0]!.status;
  const paymentOf = async (bookingId: string) =>
    await h.db.select().from(payments).where(eq(payments.bookingId, bookingId));

  beforeAll(async () => {
    h = await createHarness({
      limitOverrides: { holdPerUser: { points: 1000, windowSeconds: 60 } },
    });
    const [city] = await h.db
      .insert(cities)
      .values({
        name: 'Coimbatore',
        slug: `coimbatore-${randomBytes(3).toString('hex')}`,
        district: 'Coimbatore',
        state: 'Tamil Nadu',
      })
      .returning();
    const owner = await createUser(h.db, 'OWNER');
    ownerEmail = owner.email;
    instantHall = await venue(owner.id, city!.id, true);
    requestHall = await venue(owner.id, city!.id, false);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('reports test mode so the web app can show a banner', async () => {
    const res = await new Client(h.app).send('get', '/api/v1/payments/config');
    expect(res.body).toEqual({ provider: 'mock', testMode: true });
  });

  describe('orders', () => {
    it('creates one order per booking for the advance and moves the booking to PENDING_PAYMENT', async () => {
      const { cust, bookingId } = await heldBooking();
      const key = `key-${randomUUID()}`;
      const first = await order(cust.c, bookingId, key);
      expect(first.status).toBe(201);
      const [b] = await h.db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(first.body).toMatchObject({
        amountPaise: b!.advancePaise,
        currency: 'INR',
        testMode: true,
        provider: 'mock',
      });
      expect(first.body.checkout.url).toBe(
        `/api/v1/payments/mock/checkout/${first.body.providerOrderId}`,
      );
      expect(b!.status).toBe('PENDING_PAYMENT');

      // Same key, and no key at all, both return the same open order.
      expect((await order(cust.c, bookingId, key)).body.providerOrderId).toBe(
        first.body.providerOrderId,
      );
      expect((await order(cust.c, bookingId)).body.providerOrderId).toBe(
        first.body.providerOrderId,
      );
      expect(await paymentOf(bookingId)).toHaveLength(1);
    });

    it('needs the terms tick and records the acceptance with the booking refund tiers', async () => {
      const { cust, bookingId } = await heldBooking();
      for (const body of [{ bookingId }, { bookingId, acceptTerms: false }]) {
        const refused = await request(h.app)
          .post('/api/v1/payments/orders')
          .set('Origin', ORIGIN)
          .set('Authorization', `Bearer ${cust.c.accessToken}`)
          .send(body);
        expect(refused.status).toBe(400);
      }
      expect(await paymentOf(bookingId)).toHaveLength(0);

      expect((await order(cust.c, bookingId)).status).toBe(201);
      const accepted = await h.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'terms.accepted'), eq(auditLogs.entityId, bookingId)));
      expect(accepted).toHaveLength(1);
      const [b] = await h.db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(accepted[0]!.actorId).toBe(cust.id);
      expect(accepted[0]!.after).toMatchObject({
        context: 'payment',
        termsVersion: TERMS_VERSION,
        cancellationTiers: b!.priceSnapshot.cancellationTiers,
      });
    });

    it('refuses other customers, reused keys, expired holds and bad keys', async () => {
      const { cust, bookingId } = await heldBooking();
      const stranger = await customer();
      expect((await order(stranger.c, bookingId)).status).toBe(404);
      const key = `key-${randomUUID()}`;
      await order(cust.c, bookingId, key);
      await h.db.update(bookings).set({ status: 'CANCELLED' }).where(eq(bookings.id, bookingId));
      const other = await cust.c.send('post', '/api/v1/bookings', {
        hallId: instantHall,
        eventDate: nextDate(),
        slot: 'MORNING',
        guestCount: 10,
      });
      expect((await order(cust.c, other.body.id, key)).body.error.code).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
      expect((await order(cust.c, other.body.id, 'bad key!')).status).toBe(400);

      await h.db
        .update(bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(bookings.id, other.body.id));
      expect((await order(cust.c, other.body.id)).body.error.code).toBe('HOLD_EXPIRED');
    });
  });

  describe('mock checkout and verification', () => {
    it('serves a TEST MODE checkout page and confirms an instant booking on success', async () => {
      const { cust, bookingId } = await heldBooking();
      const o = (await order(cust.c, bookingId)).body;
      const page = await request(h.app).get(o.checkout.url);
      expect(page.status).toBe(200);
      expect(page.text).toContain('TEST MODE');
      expect(page.headers['content-security-policy']).toContain("form-action 'self'");

      const done = await request(h.app)
        .post(`${o.checkout.url}/complete`)
        .type('form')
        .send({ outcome: 'success' });
      expect(done.status).toBe(303);
      const back = new URL(done.headers['location']!);
      expect(back.origin + back.pathname).toBe(`${ORIGIN}/payments/return`);
      expect(await bookingStatus(bookingId)).toBe('CONFIRMED');

      // The browser's verify call after the webhook already confirmed it is a no-op.
      const verify = await cust.c.send('post', '/api/v1/payments/verify', {
        providerOrderId: back.searchParams.get('orderId'),
        providerPaymentId: back.searchParams.get('paymentId'),
        signature: back.searchParams.get('signature'),
      });
      expect(verify.body).toMatchObject({ status: 'CAPTURED', bookingStatus: 'CONFIRMED' });
      const history = await h.db
        .select()
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, bookingId));
      expect(history.filter((x) => x.toStatus === 'CONFIRMED')).toHaveLength(1);
    });

    it('confirms through the browser path when the webhook is delayed', async () => {
      const { cust, bookingId } = await heldBooking();
      const o = (await order(cust.c, bookingId)).body;
      const done = await request(h.app)
        .post(`${o.checkout.url}/complete`)
        .type('form')
        .send({ outcome: 'delayed' });
      expect(await bookingStatus(bookingId)).toBe('PENDING_PAYMENT');
      const back = new URL(done.headers['location']!);
      const verify = await cust.c.send('post', '/api/v1/payments/verify', {
        providerOrderId: back.searchParams.get('orderId'),
        providerPaymentId: back.searchParams.get('paymentId'),
        signature: back.searchParams.get('signature'),
      });
      expect(verify.body.bookingStatus).toBe('CONFIRMED');
    });

    it('rejects a forged checkout signature and leaves the booking unpaid', async () => {
      const { cust, bookingId } = await heldBooking();
      const o = (await order(cust.c, bookingId)).body;
      const res = await cust.c.send('post', '/api/v1/payments/verify', {
        providerOrderId: o.providerOrderId,
        providerPaymentId: 'mock_pay_forged',
        signature: 'a'.repeat(64),
      });
      expect(res.status).toBe(400);
      expect(await bookingStatus(bookingId)).toBe('PENDING_PAYMENT');
    });

    it('records a failed payment and lets the customer try again', async () => {
      const { cust, bookingId } = await heldBooking();
      const o = (await order(cust.c, bookingId)).body;
      await request(h.app)
        .post(`${o.checkout.url}/complete`)
        .type('form')
        .send({ outcome: 'failure' });
      expect((await paymentOf(bookingId))[0]!.status).toBe('FAILED');
      expect(await bookingStatus(bookingId)).toBe('PENDING_PAYMENT');
      const retry = await order(cust.c, bookingId);
      expect(retry.body.providerOrderId).not.toBe(o.providerOrderId);
      expect(await paymentOf(bookingId)).toHaveLength(2);
    });
  });

  describe('webhooks', () => {
    it('applies a capture once even when the same event is replayed', async () => {
      const { cust, bookingId } = await heldBooking();
      const o = (await order(cust.c, bookingId)).body;
      const event = {
        id: `evt_${randomUUID()}`,
        event: 'payment.captured',
        orderId: o.providerOrderId,
        paymentId: 'mock_pay_abc123',
        amount: o.amountPaise,
      };
      const first = await webhook(event);
      expect(first.body).toEqual({ received: true, outcome: 'processed' });
      const replay = await webhook(event);
      expect(replay.body.outcome).toBe('duplicate');
      // A different event id for the same payment is processed but changes nothing.
      expect((await webhook({ ...event, id: `evt_${randomUUID()}` })).body.outcome).toBe(
        'processed',
      );
      const history = await h.db
        .select()
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, bookingId));
      expect(history.filter((x) => x.toStatus === 'CONFIRMED')).toHaveLength(1);
    });

    it('rejects bad signatures, modified bodies and stale timestamps, and audits them', async () => {
      const signed = h.gateway.signWebhook({ id: 'evt_x', event: 'payment.captured' });
      const forged = await request(h.app)
        .post('/api/v1/payments/webhooks/mock')
        .set({ ...signed.headers, 'x-mock-signature': '0'.repeat(64) })
        .send(signed.rawBody.toString('utf8'));
      expect(forged.status).toBe(401);
      const modified = await request(h.app)
        .post('/api/v1/payments/webhooks/mock')
        .set(signed.headers)
        .send(signed.rawBody.toString().replace('evt_x', 'evt_y'));
      expect(modified.status).toBe(401);
      const stale = await webhook(
        { id: 'evt_old', event: 'payment.captured' },
        Math.floor(Date.now() / 1000) - 3600,
      );
      expect(stale.status).toBe(401);
      const rejected = await h.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payment.webhook_rejected'));
      expect(rejected.length).toBeGreaterThanOrEqual(3);
      expect(
        (await request(h.app).post('/api/v1/payments/webhooks/stripe').send('{}')).status,
      ).toBe(404);
    });

    it('does not confirm a booking when the captured amount differs', async () => {
      const { cust, bookingId } = await heldBooking();
      const o = (await order(cust.c, bookingId)).body;
      await webhook({
        id: `evt_${randomUUID()}`,
        event: 'payment.captured',
        orderId: o.providerOrderId,
        paymentId: 'mock_pay_short',
        amount: o.amountPaise - 100,
      });
      expect(await bookingStatus(bookingId)).toBe('PENDING_PAYMENT');
      expect((await paymentOf(bookingId))[0]!.status).toBe('CREATED');
      const [mismatch] = await h.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'payment.amount_mismatch')));
      expect(mismatch).toBeDefined();
    });

    it('lets exactly one of a simultaneous webhook and browser verification apply the capture', async () => {
      const { cust, bookingId } = await heldBooking();
      const o = (await order(cust.c, bookingId)).body;
      const sim = h.gateway.simulate(o.providerOrderId, 'success', o.amountPaise);
      await Promise.all([
        request(h.app)
          .post('/api/v1/payments/webhooks/mock')
          .set(sim.webhook!.headers)
          .send(sim.webhook!.rawBody.toString('utf8')),
        cust.c.send('post', '/api/v1/payments/verify', {
          providerOrderId: o.providerOrderId,
          providerPaymentId: sim.redirect.providerPaymentId,
          signature: sim.redirect.signature,
        }),
      ]);
      const history = await h.db
        .select()
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingId, bookingId));
      expect(history.filter((x) => x.toStatus === 'CONFIRMED')).toHaveLength(1);
    });

    it('refunds a payment that arrives after the hold expired', async () => {
      const { cust, bookingId } = await heldBooking();
      const o = (await order(cust.c, bookingId)).body;
      await h.db
        .update(bookings)
        .set({ holdExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(bookings.id, bookingId));
      await h.db.transaction((tx) => h.container.bookings.expireStale(tx, { customerId: cust.id }));
      expect(await bookingStatus(bookingId)).toBe('EXPIRED');

      await webhook({
        id: `evt_${randomUUID()}`,
        event: 'payment.captured',
        orderId: o.providerOrderId,
        paymentId: 'mock_pay_late',
        amount: o.amountPaise,
      });
      expect(await bookingStatus(bookingId)).toBe('EXPIRED');
      const [p] = await paymentOf(bookingId);
      const queued = await h.db.select().from(refunds).where(eq(refunds.paymentId, p!.id));
      expect(queued).toEqual([
        expect.objectContaining({ status: 'PENDING', amountPaise: o.amountPaise }),
      ]);

      await h.container.payments.retryRefunds(50, 0);
      expect((await paymentOf(bookingId))[0]).toMatchObject({
        status: 'REFUNDED',
        refundedPaise: o.amountPaise,
      });
    });
  });

  async function paidBooking(hallId: string) {
    const { cust, bookingId, date } = await heldBooking(hallId);
    const o = (await order(cust.c, bookingId)).body;
    await request(h.app)
      .post(`${o.checkout.url}/complete`)
      .type('form')
      .send({ outcome: 'success' });
    return { cust, bookingId, date, amountPaise: o.amountPaise as number };
  }

  describe('refunds', () => {
    it('refunds the policy share when a customer cancels a confirmed booking', async () => {
      const { cust, bookingId, amountPaise } = await paidBooking(instantHall);
      const [b] = await h.db.select().from(bookings).where(eq(bookings.id, bookingId));
      const expected = Math.round(((amountPaise - b!.platformFeePaise) * 90) / 100);
      const res = await cust.c.send('post', `/api/v1/bookings/${bookingId}/cancel`, {
        reason: 'Wedding postponed',
      });
      expect(res.body).toMatchObject({ status: 'REFUNDED', refundStatus: 'PROCESSED' });
      expect(res.body.refund.refundPaise).toBe(expected);
      expect((await paymentOf(bookingId))[0]).toMatchObject({
        status: 'PARTIALLY_REFUNDED',
        refundedPaise: expected,
      });
    });

    describe('when the gateway finishes refunds later (Razorpay normal speed)', () => {
      beforeAll(() => {
        h.gateway.delayRefunds = true;
      });
      afterAll(() => {
        h.gateway.delayRefunds = false;
      });

      async function cancelWithPendingRefund() {
        const { cust, bookingId } = await paidBooking(instantHall);
        const res = await cust.c.send('post', `/api/v1/bookings/${bookingId}/cancel`, {});
        expect(res.body).toMatchObject({ status: 'CANCELLED', refundStatus: 'PENDING' });
        const [refund] = await h.db
          .select({ refund: refunds })
          .from(refunds)
          .innerJoin(payments, eq(payments.id, refunds.paymentId))
          .where(eq(payments.bookingId, bookingId));
        return {
          cust,
          bookingId,
          refund: refund!.refund,
          refundPaise: res.body.refund.refundPaise,
        };
      }

      it('shows the refund as processing, follows it up without starting a second refund', async () => {
        const { cust, bookingId, refund, refundPaise } = await cancelWithPendingRefund();
        const detail = await cust.c.send('get', `/api/v1/bookings/${bookingId}`);
        expect(detail.body.refund).toMatchObject({
          amountPaise: refundPaise,
          status: 'PROCESSING',
          completedAt: null,
          reference: refund.providerRefundId,
        });
        const updates = await cust.c.send('get', '/api/v1/bookings/refund-updates');
        expect(updates.body.items).toContainEqual(
          expect.objectContaining({
            bookingId,
            refund: expect.objectContaining({ status: 'PROCESSING' }),
          }),
        );

        const started = h.gateway.refundsStarted;
        await h.container.payments.retryRefunds(50, 0, 0);
        expect(h.gateway.refundsStarted).toBe(started); // checked, not requested again
        expect(await bookingStatus(bookingId)).toBe('CANCELLED');

        // The gateway finishes it; the next follow-up completes everything.
        h.gateway.settleRefund(refund.providerRefundId!);
        await h.container.payments.retryRefunds(50, 0, 0);
        expect(h.gateway.refundsStarted).toBe(started);
        expect(await bookingStatus(bookingId)).toBe('REFUNDED');
        expect((await paymentOf(bookingId))[0]).toMatchObject({
          status: 'PARTIALLY_REFUNDED',
          refundedPaise: refundPaise,
        });
        const after = await cust.c.send('get', `/api/v1/bookings/${bookingId}`);
        expect(after.body.refund).toMatchObject({ status: 'COMPLETED', amountPaise: refundPaise });
        expect(after.body.refund.completedAt).not.toBeNull();
      });

      it('completes the booking from the refund.processed webhook, once', async () => {
        const { bookingId, refund, refundPaise } = await cancelWithPendingRefund();
        const event = {
          id: `evt_${randomUUID()}`,
          event: 'refund.processed',
          refundId: refund.providerRefundId,
        };
        expect((await webhook(event)).body.outcome).toBe('processed');
        expect(await bookingStatus(bookingId)).toBe('REFUNDED');
        // Another event for the same refund changes nothing.
        await webhook({ ...event, id: `evt_${randomUUID()}` });
        expect((await paymentOf(bookingId))[0]!.refundedPaise).toBe(refundPaise);
        const audits = await h.db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'payment.refunded'),
              eq(auditLogs.entityId, (await paymentOf(bookingId))[0]!.id),
            ),
          );
        expect(audits).toHaveLength(1);
      });
    });

    it('waits for the owner in request mode, then refunds everything if declined', async () => {
      const { bookingId, amountPaise } = await paidBooking(requestHall);
      const [b] = await h.db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(b!.status).toBe('AWAITING_OWNER');
      expect(b!.ownerResponseDueAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);

      const owner = new Client(h.app);
      await owner.login(ownerEmail);
      const reject = await owner.send('post', `/api/v1/owner/bookings/${bookingId}/reject`);
      expect(reject.body).toMatchObject({
        status: 'REFUNDED',
        refundStatus: 'PROCESSED',
        refundPaise: amountPaise,
      });
      expect((await paymentOf(bookingId))[0]).toMatchObject({
        status: 'REFUNDED',
        refundedPaise: amountPaise,
      });
      expect((await owner.send('post', `/api/v1/owner/bookings/${bookingId}/reject`)).status).toBe(
        409,
      );
    });

    it('declines and refunds requests the owner does not answer in time', async () => {
      const { bookingId } = await paidBooking(requestHall);
      await h.db
        .update(bookings)
        .set({ ownerResponseDueAt: new Date(Date.now() - 1000) })
        .where(eq(bookings.id, bookingId));
      expect(await h.container.payments.declineOverdueRequests()).toBeGreaterThanOrEqual(1);
      expect(await bookingStatus(bookingId)).toBe('REFUNDED');
    });

    it('lets admins issue bounded, idempotent partial refunds', async () => {
      const { bookingId, amountPaise } = await paidBooking(instantHall);
      const admin = new Client(h.app);
      await admin.login((await createUser(h.db, 'ADMIN')).email);
      const body = {
        amountPaise: 50_000,
        reason: 'Generator failed during the event',
        idempotencyKey: `goodwill-${randomUUID()}`,
      };
      expect(
        (await admin.send('post', `/api/v1/admin/bookings/${bookingId}/refund`, body)).body.status,
      ).toBe('PROCESSED');
      expect(
        (await admin.send('post', `/api/v1/admin/bookings/${bookingId}/refund`, body)).body.status,
      ).toBe('PROCESSED');
      expect((await paymentOf(bookingId))[0]).toMatchObject({
        status: 'PARTIALLY_REFUNDED',
        refundedPaise: 50_000,
      });
      const tooMuch = await admin.send('post', `/api/v1/admin/bookings/${bookingId}/refund`, {
        ...body,
        amountPaise,
        idempotencyKey: `more-${randomUUID()}`,
      });
      expect(tooMuch.body.error.code).toBe('REFUND_TOO_LARGE');
      expect(await bookingStatus(bookingId)).toBe('CONFIRMED');
      const cust = await customer();
      expect(
        (await cust.c.send('post', `/api/v1/admin/bookings/${bookingId}/refund`, body)).status,
      ).toBe(403);
    });
  });
  describe('edge cases', () => {
    it('returns 404 or 400 for bad checkout requests', async () => {
      expect((await request(h.app).get('/api/v1/payments/mock/checkout/not-an-order')).status).toBe(
        404,
      );
      expect(
        (await request(h.app).get('/api/v1/payments/mock/checkout/mock_order_missing')).status,
      ).toBe(404);
      expect(
        (
          await request(h.app)
            .post('/api/v1/payments/mock/checkout/mock_order_missing/complete')
            .type('form')
            .send({ outcome: 'success' })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(h.app)
            .post('/api/v1/payments/mock/checkout/mock_order_x/complete')
            .type('form')
            .send({ outcome: 'steal' })
        ).status,
      ).toBe(400);
    });

    it('shows a payment only to the customer who made it', async () => {
      const { cust, bookingId } = await heldBooking();
      const o = (await order(cust.c, bookingId)).body;
      const mine = await cust.c.send('get', `/api/v1/payments/${o.paymentId}`);
      expect(mine.body).toMatchObject({
        id: o.paymentId,
        status: 'CREATED',
        bookingStatus: 'PENDING_PAYMENT',
      });
      expect(
        (await (await customer()).c.send('get', `/api/v1/payments/${o.paymentId}`)).status,
      ).toBe(404);
      expect(
        (
          await cust.c.send('post', '/api/v1/payments/verify', {
            providerOrderId: 'mock_order_unknown',
            providerPaymentId: 'mock_pay_x',
            signature: 'x',
          })
        ).status,
      ).toBe(404);
    });

    it('acknowledges webhook events it does not act on', async () => {
      expect((await webhook({ id: `evt_${randomUUID()}`, event: 'order.paid' })).body.outcome).toBe(
        'ignored',
      );
      expect(
        (await webhook({ id: `evt_${randomUUID()}`, event: 'payment.captured' })).body.outcome,
      ).toBe('ignored');
      expect(
        (await webhook({ id: `evt_${randomUUID()}`, event: 'payment.failed' })).body.outcome,
      ).toBe('ignored');
      expect(
        (
          await webhook({
            id: `evt_${randomUUID()}`,
            event: 'refund.processed',
            refundId: 'mock_rfnd_none',
          })
        ).body.outcome,
      ).toBe('processed');
      // A capture for an order we never created changes nothing.
      expect(
        (
          await webhook({
            id: `evt_${randomUUID()}`,
            event: 'payment.captured',
            orderId: 'mock_order_ghost',
            paymentId: 'mock_pay_ghost',
            amount: 100,
          })
        ).body.outcome,
      ).toBe('processed');
    });

    it('will not take payment for a confirmed or cancelled booking, and refunds nothing when nothing was paid', async () => {
      const { cust, bookingId } = await paidBooking(instantHall);
      expect((await order(cust.c, bookingId)).body.error.code).toBe('NOT_PAYABLE');
      const unpaid = await heldBooking();
      const none = await h.container.payments.refundBooking({
        bookingId: unpaid.bookingId,
        amountPaise: 100,
        purpose: 'test',
        reason: 'nothing paid',
      });
      expect(none).toEqual({ refundId: null, status: 'NONE', amountPaise: 0 });
      await expect(
        h.container.payments.refundBooking({
          bookingId: unpaid.bookingId,
          amountPaise: 1.5,
          purpose: 'x',
          reason: 'bad',
        }),
      ).rejects.toThrow();
    });
  });
});
