# Payments: architecture and migration to a real gateway

## How it fits together

```
web PaymentAdapter ──POST /payments/orders──▶ PaymentService ──▶ PaymentProvider (interface)
        │                                          ▲                    ├─ MockPaymentProvider   (PAYMENT_PROVIDER=mock)
        └─ gateway checkout ─▶ /payments/return ───┤                    └─ RazorpayProvider      (PAYMENT_PROVIDER=razorpay, stub)
                                POST /payments/verify
gateway ──signed webhook──▶ POST /payments/webhooks/:provider (raw body) ─▶ PaymentService.handleWebhook
```

- Business code imports only `modules/payments/provider.ts`. `factory.ts` is the only file that imports a concrete provider, and ESLint fails the build otherwise.
- The browser talks only to our `/payments` API. The only gateway-aware web code is `features/payments/payment-adapter.ts`.
- `GET /payments/config` returns `{ provider, testMode }`; the app shows a red TEST MODE banner while `testMode` is true.

## Guarantees the service provides (any gateway)

| Guarantee                   | How                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One order per pay attempt   | `payments.idempotency_key` unique (customer + `Idempotency-Key` header); an open order for the booking is reused                                        |
| A capture applies once      | payment row locked `FOR UPDATE`; already-captured is a no-op; checkout verify and webhook can arrive in any order or together                           |
| Each webhook processed once | `webhook_events (provider, event_id)` unique, inserted in the same transaction as its effects; a failure rolls back so the gateway's retry is processed |
| Webhook authenticity        | provider verifies the signature over the **raw body** (`express.raw` on the webhook path); failures are 401 and audited                                 |
| Amount integrity            | a capture with a different amount than the order is not applied (`payment.amount_mismatch` audit)                                                       |
| Late payments               | captured after the hold expired or the booking was cancelled → full refund queued automatically                                                         |
| No double refunds           | `refunds.idempotency_key` unique per booking and purpose; provider calls run outside DB transactions and are retried by the worker                      |
| Money                       | integer paise end to end; `payments.refunded_paise ≤ amount_paise` is a DB check                                                                        |

Booking effects: capture moves `PENDING_PAYMENT → CONFIRMED` (instant-book venues) or `→ AWAITING_OWNER` with a response deadline (`owner_response_hours`). An owner decline or timeout cancels the booking and refunds everything paid online, including the platform fee. A customer cancellation refunds the policy share, never the platform fee. A `CANCELLED` booking becomes `REFUNDED` when its refund is paid.

## The mock gateway (today)

- Order ids `mock_order_*`, payment ids `mock_pay_*`.
- Checkout signature: `HMAC_SHA256(MOCK_PAYMENT_KEY_SECRET, "<order>|<payment>")` hex, the same scheme as Razorpay.
- Webhook signature: header `x-mock-signature = HMAC_SHA256(MOCK_PAYMENT_WEBHOOK_SECRET, "<x-mock-timestamp>.<raw body>")`, with a ±5-minute timestamp window.
- Hosted checkout page `GET /api/v1/payments/mock/checkout/:orderId` (only mounted in mock mode) with **Pay success**, **Pay fail**, **Leave pending** (no webhook) and **Pay success, webhook after 30 s**. It then redirects to `APP_BASE_URL/payments/return?orderId&paymentId&signature&status`.
- Production refuses `PAYMENT_PROVIDER=mock` at startup.

## Migrating to Razorpay

1. **Account**: complete Razorpay KYC and get test keys (`rzp_test_…`), then live keys (`rzp_live_…`) after activation.
2. **Implement `RazorpayProvider`** (`apps/api/src/modules/payments/razorpay/razorpay-provider.ts`). Each method's comment says exactly what to call:
   - `createOrder`: `POST /v1/orders` `{ amount, currency: 'INR', receipt: bookingRef, notes: { paymentId } }`; return `checkout: { kind: 'razorpay', keyId, orderId }`.
   - `verifyPayment`: `HMAC_SHA256(keySecret, order_id|payment_id)` vs `razorpay_signature`, constant-time.
   - `handleWebhook`: `X-Razorpay-Signature = HMAC_SHA256(webhookSecret, rawBody)`; event id from `X-Razorpay-Event-Id`; map `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`.
   - `refund`: `POST /v1/payments/{id}/refund` `{ amount, speed: 'normal', receipt: idempotencyKey }`.
   - `getStatus`: `GET /v1/orders/{id}/payments`.
     Use `fetch` with a timeout; no SDK is required. Copy `test/unit/payment-providers.test.ts` for the new provider using recorded fixtures.
3. **Web adapter**: in `payment-adapter.ts` add a `case 'razorpay'` that loads `https://checkout.razorpay.com/v1/checkout.js`, opens it with `key: checkout.keyId, order_id: checkout.orderId`, and in the `handler` calls `PaymentsService.verify({ providerOrderId: razorpay_order_id, providerPaymentId: razorpay_payment_id, signature: razorpay_signature })`, then navigates to `/payments/return`. Add `https://checkout.razorpay.com` to `script-src` and `frame-src`, and `https://api.razorpay.com` / `https://lumberjack.razorpay.com` to `connect-src`, in `docker/security-headers.inc.template`.
4. **Webhook**: in the Razorpay dashboard add `https://<api-host>/api/v1/payments/webhooks/razorpay` with events `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`, and a strong secret.
5. **Configuration** (secret manager, never committed):
   ```
   PAYMENT_PROVIDER=razorpay
   RAZORPAY_KEY_ID=rzp_test_…        # rzp_live_… in production (test keys are refused there)
   RAZORPAY_KEY_SECRET=…
   RAZORPAY_WEBHOOK_SECRET=…
   ```
6. **Test-to-live checklist**: run the integration suite against the provider with test keys; make a ₹1 live payment and refund; confirm webhooks arrive (dashboard → Webhooks → deliveries) and appear in `webhook_events`; reconcile `payments` against the settlement report for a day before opening to all users.
7. **Rollback**: set `PAYMENT_PROVIDER` back and redeploy. Orders already created at Razorpay keep working, because their webhooks still verify only while the Razorpay secrets are configured, so keep them set until those orders have settled.

## Cashfree or PhonePe instead

Same steps with a new provider class registered in `factory.ts`:

|                   | Cashfree PG                                                                                     | PhonePe PG                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Create order      | `POST /pg/orders` (`x-client-id`, `x-client-secret`, `x-api-version`) → `payment_session_id`    | `POST /pg/v1/pay` with base64 payload and `X-VERIFY`                                     |
| Browser           | Cashfree JS SDK `checkout({ paymentSessionId })`                                                | redirect to the returned `redirectInfo.url` (fits the existing `redirect` checkout kind) |
| Webhook signature | `x-webhook-signature = base64(HMAC_SHA256(secret, timestamp + rawBody))`, `x-webhook-timestamp` | `X-VERIFY = SHA256(base64Body + saltKey) + '###' + saltIndex`                            |
| Event id          | `data.payment.cf_payment_id` + type                                                             | `merchantTransactionId` + state                                                          |
| Refund            | `POST /pg/orders/{id}/refunds`                                                                  | `POST /pg/v1/refund`                                                                     |

Add the enum value to `PAYMENT_PROVIDER` and its credentials in `config/env.ts` (required when selected), then follow steps 3–7.
