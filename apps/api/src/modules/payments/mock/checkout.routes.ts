import { Router } from 'express';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { z } from 'zod';
import { formatInr } from '@mandapambook/shared';
import type { Db } from '../../../db/client.js';
import { bookings, payments } from '../../../db/schema/index.js';
import type { PaymentService } from '../payment.service.js';
import type { MockOutcome, MockPaymentProvider } from './mock-provider.js';

const orderIdSchema = z.string().regex(/^mock_order_[A-Za-z0-9_-]+$/);
const outcomeSchema = z.strictObject({
  outcome: z.enum(['success', 'failure', 'pending', 'delayed']),
});

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/**
 * The mock gateway's hosted checkout page. Mounted only when PAYMENT_PROVIDER=mock (which
 * production refuses). Pressing a button behaves like a gateway: it sends a signed webhook to
 * our webhook handler (now, after 30 s, or never) and redirects the browser back to the app
 * with a signed result for /payments/verify.
 */
export function mockCheckoutRouter(deps: {
  db: Db;
  provider: MockPaymentProvider;
  payments: PaymentService;
  appBaseUrl: string;
  logger: Logger;
}): Router {
  const { db, provider, payments: paymentService, appBaseUrl, logger } = deps;
  const r = Router();

  r.get('/payments/mock/checkout/:orderId', async (req, res) => {
    const orderId = orderIdSchema.safeParse(req.params['orderId']);
    if (!orderId.success) {
      res.status(404).end();
      return;
    }
    const [row] = await db
      .select({
        amountPaise: payments.amountPaise,
        status: payments.status,
        refCode: bookings.refCode,
      })
      .from(payments)
      .innerJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(eq(payments.providerOrderId, orderId.data));
    if (!row) {
      res.status(404).end();
      return;
    }
    const action = `/api/v1/payments/mock/checkout/${encodeURIComponent(orderId.data)}/complete`;
    const button = (outcome: MockOutcome, label: string, color: string) =>
      `<form method="post" action="${action}"><input type="hidden" name="outcome" value="${outcome}"><button style="background:${color}">${label}</button></form>`;
    // This page has its own tight CSP: inline styles only, forms may post back here only.
    res
      .set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      )
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test checkout · MandapamBook</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#f8fafc;color:#18202b}
.banner{background:#b91c1c;color:#fff;text-align:center;font-weight:700;padding:.6rem;letter-spacing:.05em}
main{max-width:28rem;margin:2rem auto;padding:1.5rem;background:#fff;border-radius:.75rem;box-shadow:0 1px 3px #0002}
h1{font-size:1.25rem}button{width:100%;margin:.35rem 0;padding:.8rem;border:0;border-radius:.5rem;color:#fff;font-size:1rem;font-weight:600;cursor:pointer}
p{color:#475569}</style></head><body>
<div class="banner" role="alert">TEST MODE: no real money moves</div>
<main><h1>Pay ${escape(formatInr(row.amountPaise))}</h1>
<p>Booking ${escape(row.refCode)} · order ${escape(orderId.data)} · status ${escape(row.status.toLowerCase())}</p>
${button('success', 'Pay success', '#15803d')}
${button('failure', 'Pay fail', '#b91c1c')}
${button('pending', 'Leave pending (no webhook)', '#475569')}
${button('delayed', 'Pay success, webhook after 30 s', '#b86e00')}
</main></body></html>`);
  });

  r.post('/payments/mock/checkout/:orderId/complete', async (req, res) => {
    const orderId = orderIdSchema.safeParse(req.params['orderId']);
    const body = outcomeSchema.safeParse(req.body);
    if (!orderId.success || !body.success) {
      res.status(400).end();
      return;
    }
    const [payment] = await db
      .select({ amountPaise: payments.amountPaise })
      .from(payments)
      .where(eq(payments.providerOrderId, orderId.data));
    if (!payment) {
      res.status(404).end();
      return;
    }
    const sim = provider.simulate(orderId.data, body.data.outcome, payment.amountPaise);
    const deliver = async () => {
      if (!sim.webhook) return;
      try {
        await paymentService.handleWebhook('mock', sim.webhook.rawBody, sim.webhook.headers);
      } catch (err) {
        logger.error({ err, orderId: orderId.data }, 'mock webhook delivery failed');
      }
    };
    if (sim.webhookDelayMs > 0) setTimeout(() => void deliver(), sim.webhookDelayMs).unref();
    else await deliver();

    const params = new URLSearchParams({
      orderId: orderId.data,
      paymentId: sim.redirect.providerPaymentId,
      signature: sim.redirect.signature,
      status: sim.redirect.status,
    });
    res.redirect(303, `${appBaseUrl}/payments/return?${params.toString()}`);
  });

  return r;
}
