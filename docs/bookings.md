# Search, pricing and bookings

## Search

`GET /api/v1/auditoriums` returns approved venues only. SQL narrows candidates by city, parking, guest rooms, catering, decoration, rating, text and _all_ requested amenities (at most 500 candidates per query). Each matching hall is then priced for the date and slot with the same rules the booking flow uses, and halls that are taken or over budget are dropped. Sorting is `recommended` (rating weighted by review count), `price_asc`, `price_desc`, `rating` or `capacity`.

`GET /api/v1/auditoriums/:slug` is the public venue page; draft, rejected and suspended venues return 404. `GET /api/v1/auditoriums/:id/availability?month=YYYY-MM` lists taken slots per hall, never who booked them or why a date is blocked. Holds past their expiry count as free everywhere, even before the sweeper runs.

## Price

`resolvePriceRule` picks the price for a hall slot on a date: the highest-priority applicable rule, then the more specific kind (date override > muhurtham > seasonal > weekend > base), then the higher price. Weekends use the calendar date, so the server's timezone doesn't matter. Muhurtham dates apply when they are nationwide or for the venue's state.

| Line             | Rule                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| Venue charges    | base price + add-ons (unit price × quantity, within each add-on's limit) |
| GST              | `gst_bps` of venue charges, rounded half-up                              |
| Platform fee     | `platform_fee_paise`, GST-inclusive                                      |
| Total            | venue charges + GST + platform fee                                       |
| Pay now          | owner's `advancePercent` of (venue charges + GST), plus the platform fee |
| Pay at the venue | total − pay now                                                          |

Everything is integer paise. The client never sends a price: quote and hold requests are strict schemas without price fields, and the server prices from its own data. The result is frozen in `bookings.price_snapshot`, so later rule or settings changes don't affect existing bookings.

## Holds

`POST /api/v1/bookings` (signed in, verified email, `booking:create`, rate limited to 6 per hour per user) runs one transaction:

1. Expire holds past their time on that hall and date, and the customer's own.
2. Price the request from server data.
3. Insert a `HELD` booking with `hold_expires_at = now + hold_minutes` (default 10).

The database then enforces both rules:

| Rule                                                      | Enforced by                                                  | API response           |
| --------------------------------------------------------- | ------------------------------------------------------------ | ---------------------- |
| One booking per hall slot (Full day overlaps both halves) | `hall_occupancy_no_overlap` exclusion constraint             | `409 SLOT_UNAVAILABLE` |
| One unpaid hold per customer                              | partial unique index `bookings_one_active_hold_per_customer` | `409 HOLD_EXISTS`      |

Redis is not the source of truth for holds. Expiry is a timestamp in Postgres, applied inline when someone wants the slot and by the sweeper. Redis is used only for the per-user hold rate limit.

## State machine

```
HELD ─▶ PENDING_PAYMENT ─▶ CONFIRMED ─▶ COMPLETED
  │           │        └─▶ AWAITING_OWNER ─▶ CONFIRMED
  │           │                       └────▶ REFUNDED
  ├─▶ EXPIRED ◀┤
  └─▶ CANCELLED ◀─ CONFIRMED / AWAITING_OWNER;  CANCELLED ─▶ REFUNDED
```

`modules/bookings/state-machine.ts` holds the only transition table; anything else throws `IllegalTransitionError` (all 64 status pairs are tested). `transition()` updates a row only if both status and `version` still match what the caller read, bumps the version and writes `booking_status_history`. The occupancy trigger frees or keeps the slot to match. `HELD → PENDING_PAYMENT`, the payment-driven transitions and `AWAITING_OWNER → REFUNDED` are wired in Phase 6.

## Cancellation

`GET /bookings/:id/cancel-preview` shows the refund; `POST /bookings/:id/cancel` applies it.

- Unpaid holds are released with nothing refunded.
- Paid bookings move to `CANCELLED`. `refund_due_paise` is fixed at that moment from the venue's tier for the number of IST calendar days before the event, applied to the amount paid online minus the platform fee. The platform fee is never refunded.
- Phase 6 issues the refund and moves the booking to `REFUNDED`.

## Owner inbox

`GET /owner/bookings` lists bookings for venues in the caller's scope. Customer name, phone and email appear only from `AWAITING_OWNER` onwards (paid); unpaid holds show no personal data. Owners (not staff) can accept `AWAITING_OWNER` bookings and record the balance paid at the venue.

## Worker

`node dist/worker.js` (compose service `worker`; `pnpm --filter @mandapambook/api worker` locally) runs every `SWEEP_INTERVAL_SECONDS` (default 30):

- unpaid holds past expiry → `EXPIRED`
- `CONFIRMED` bookings whose date has passed (IST) → `COMPLETED`
- photo uploads still `PENDING_UPLOAD` after 24 hours → deleted from storage and the database

A Postgres session advisory lock (`7420001`) lets any number of workers run without overlapping. Rows are locked with `FOR UPDATE SKIP LOCKED` and changed only through the state machine.
