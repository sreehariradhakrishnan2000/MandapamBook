import { type RequestHandler, Router } from 'express';
import { acceptTermsSchema } from '@mandapambook/shared';
import { z } from 'zod';
import { type RateLimiters, byIp } from '../../http/middleware/rate-limit.js';
import { auditContext } from '../audit/audit.service.js';
import { parseId } from '../owners/scoped.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import type { PaymentService } from './payment.service.js';

/** Paying needs the "I agree to the Terms and the cancellation terms" tick. */
const orderSchema = z.strictObject({ bookingId: z.uuid(), acceptTerms: acceptTermsSchema });
const verifySchema = z.strictObject({
  providerOrderId: z.string().min(1).max(100),
  providerPaymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(256),
});

/**
 * Our own payments API. The web app talks only to these endpoints; gateway specifics
 * stay behind PaymentProvider and one browser adapter component.
 */
export function paymentsRouter(deps: {
  payments: PaymentService;
  authenticate: RequestHandler;
  limiters: RateLimiters;
}): Router {
  const { payments, authenticate, limiters } = deps;
  const r = Router();

  /** Which gateway is active; the web app shows a TEST MODE banner when testMode is true. */
  r.get('/payments/config', (_req, res) => {
    res
      .set('Cache-Control', 'public, max-age=60')
      .json({ provider: payments.provider.name, testMode: payments.provider.testMode });
  });

  /**
   * Gateway webhooks. The raw body is preserved by the app (signatures are over exact
   * bytes). Not authenticated and not CSRF-protected: authenticity comes from the signature.
   */
  r.post(
    '/payments/webhooks/:provider',
    limiters.middleware('apiPerIp', byIp),
    async (req, res) => {
      const provider = z.enum(['mock', 'razorpay']).safeParse(req.params['provider']);
      if (!provider.success || !Buffer.isBuffer(req.body)) {
        res.status(404).end();
        return;
      }
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
      );
      const outcome = await payments.handleWebhook(provider.data, req.body, headers);
      res.json({ received: true, outcome });
    },
  );

  r.use('/payments', authenticate);

  r.post('/payments/orders', requirePermission('booking:create'), async (req, res) => {
    const me = currentUser(req);
    const { bookingId } = orderSchema.parse(req.body);
    const order = await payments.createOrder(
      me.userId,
      bookingId,
      req.get('idempotency-key') ?? undefined,
      auditContext(req),
    );
    res.status(201).set('Cache-Control', 'no-store').json(order);
  });

  r.post('/payments/verify', requirePermission('booking:create'), async (req, res) => {
    const me = currentUser(req);
    const result = await payments.verify(
      me.userId,
      verifySchema.parse(req.body),
      auditContext(req),
    );
    res.set('Cache-Control', 'no-store').json(result);
  });

  r.get('/payments/:id', requirePermission('booking:create'), async (req, res) => {
    const me = currentUser(req);
    res
      .set('Cache-Control', 'no-store')
      .json(await payments.status(me.userId, parseId(req.params['id'])));
  });

  return r;
}
