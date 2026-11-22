# Notifications, invoices, reviews and reports (Phase 7)

## Notifications: a transactional outbox

Every booking state change already writes a `booking_status_history` row **in the same
transaction** as the change (see `state-machine.ts`). That row is the outbox:

1. The worker's sweep calls `NotificationService.processOutbox()`. It locks unprocessed
   history rows (`notified_at IS NULL`, `FOR UPDATE SKIP LOCKED`), decides who to tell
   (`notificationsFor`), inserts `notifications` rows and sets `notified_at`, all in one
   transaction.
2. `deliverDue()` claims each due `QUEUED` row with a conditional update (attempt
   counter as the version), renders the email, sends it, and marks it `SENT`. A failure
   leaves it `QUEUED` with `next_attempt_at` pushed back 1, 2, 4, 8 … minutes (max 60); after
   5 attempts it becomes `FAILED` with the last error.

A crash can only delay a message. Duplicates are prevented by `notifications.dedupe_key`
(`<template>:<history id>:<user id>`, unique). Migration 0005 marks all pre-existing
history as notified so nothing old is emailed.

| Transition                                        | Customer                          | Owner                                    |
| ------------------------------------------------- | --------------------------------- | ---------------------------------------- |
| → CONFIRMED                                       | `booking_confirmed` + invoice PDF | `owner_new_booking`                      |
| → AWAITING_OWNER                                  | `booking_requested`               | `owner_request_pending`                  |
| AWAITING_OWNER → CANCELLED (declined / timed out) | `booking_declined`                | –                                        |
| → CANCELLED (other)                               | `booking_cancelled`               | `owner_booking_cancelled` if it was paid |
| → REFUNDED                                        | `refund_processed`                | –                                        |
| PENDING_PAYMENT → EXPIRED                         | `hold_expired`                    | –                                        |
| → COMPLETED                                       | `review_request`                  | –                                        |

Emails are plain text (no HTML, no tracking pixels). Template data holds booking facts
only; contact details are read at send time and are not stored in `notifications.data`.

**Transport.** `EMAIL_PROVIDER=console` logs messages (development).
`EMAIL_PROVIDER=smtp` sends through `SMTP_URL` (`smtp://mailpit:1025` in docker compose,
an `smtps://` relay in production). Production refuses `console`. SMS stays behind the
`SmsSender` interface until a gateway is chosen.

## Invoices

- An invoice number is assigned the first time a paid booking's invoice is requested (or
  attached to the confirmation email): `MB/<financial year>/<6 digits>`, e.g.
  `MB/2026-27/000123`. `invoice_counters` holds one row per Indian financial year (1 April
  to 31 March, IST); the upsert locks it, so numbers are sequential with no duplicates.
- The PDF (A4, pdfkit, standard fonts so amounts are shown as "INR") is built from the
  booking's frozen `price_snapshot`, add-ons and captured payments. It is generated on
  request and not stored.
- `GET /api/v1/bookings/:id/invoice.pdf`: the booking's customer only.
  `GET /api/v1/owner/bookings/:id/invoice.pdf`: owner or staff of that venue. Anyone else
  gets 404; unpaid bookings get `409 NOT_INVOICEABLE`.

## Reviews

- `POST /api/v1/bookings/:id/review` (`review:create`): the booking's customer, status
  `COMPLETED`, once (unique per booking → `409 ALREADY_REVIEWED`). Rating 1–5; body up to
  2000 characters, control characters stripped, shown as text (never HTML).
- `GET /api/v1/auditoriums/:id/reviews`: public, approved venues only, published reviews,
  author shown as first name + initial.
- The venue's `rating_avg` / `rating_count` are recomputed from published reviews in the
  same transaction as every create or moderation.
- Owners reply (`review:reply`; staff can read but not reply). Admins hide or restore
  (`review:moderate`) with a reason; both actions are audited.

## Payouts and reports

The platform collects the online advance; the balance is paid at the venue. A payout
records what the platform owes the venue from the money it holds:

```
gross      = captured − refunded − platform fee        (never below 0)
commission = commission_bps × venue charges (hall + add-ons, before GST)   for COMPLETED
           = commission_bps × gross                                        for cancellations
           (capped at gross)
net        = gross − commission
```

The sweep (`PayoutService.accrue`) creates one payout per settled booking: completed, or
cancelled/refunded with no refund still owed. It is idempotent (unique per booking).
Admins mark payouts `PAID` with a transfer reference (`payout:manage`, audited); money
moves outside the platform.

| Endpoint                                  | Permission                        | Notes                                                                           |
| ----------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| `GET /owner/earnings?from&to`             | `payout:view` (owners, not staff) | Totals and payouts for the owner's venues                                       |
| `GET /admin/reports/summary?from&to`      | `report:view`                     | Bookings by status, collections, refunds, fees, commission, payouts, top cities |
| `GET /admin/reports/bookings.csv?from&to` | `report:view`                     | Audited (`report.exported`); no customer contact details                        |
| `GET /admin/payouts?status`               | `payout:manage`                   |                                                                                 |
| `POST /admin/payouts/:id/mark-paid`       | `payout:manage`                   | `409 ALREADY_PAID` on repeat                                                    |

Windows are by event date and default to the current financial year; at most three years.
CSV cells starting with `= + - @`, tab or CR are prefixed with `'` (formula injection) and
the file starts with a UTF-8 byte-order mark so Excel keeps Indic venue names intact.
