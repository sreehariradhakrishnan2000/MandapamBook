# Payments migration guide

Status: placeholder. Written in Phase 6 together with the `PaymentProvider` interface, the mock provider and the Razorpay stub.

It will cover, step by step, how to switch `PAYMENT_PROVIDER` from `mock` to Razorpay, Cashfree or PhonePe: credentials and env vars, webhook URL and secret registration, signature schemes, amount and currency mapping, refund behaviour, test-to-live checklist and rollback.
