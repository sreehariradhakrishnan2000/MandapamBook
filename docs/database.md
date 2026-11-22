# Database

PostgreSQL 16, accessed through Drizzle ORM. Schema source: `apps/api/src/db/schema/`. Migrations: `apps/api/src/db/migrations/` (plain SQL, reviewed in PRs).

## Environments

| Environment               | Where                                                              | Notes                                                |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- |
| Development               | Neon project `mandapambook`, branch `dev`, database `mandapambook` | Pooled URL for the app, direct URL for migrations    |
| Integration tests (local) | Neon branch `dev`, database `mandapambook_test`                    | Reset on every test run                              |
| CI                        | `postgres:16-alpine` service container                             | Fresh per run                                        |
| Docker compose            | `postgres:16-alpine` on `localhost:5433`                           | Optional offline alternative                         |
| Staging / production      | Not provisioned yet (Phase 8)                                      | Migrations run as a separate, approved pipeline step |

The Neon project's default branch (`main`, database `neondb`) holds tables from an earlier Prisma prototype. MandapamBook does not use them. They were left untouched and should be dropped or archived by the owner once confirmed unneeded.

Use `sslmode=verify-full` in every Neon URL.

## Commands

```sh
pnpm --filter @mandapambook/api db:generate   # schema change -> new SQL migration (commit it)
pnpm --filter @mandapambook/api db:migrate    # apply pending migrations (uses MIGRATION_DATABASE_URL)
pnpm --filter @mandapambook/api db:seed       # master data + fictional sample venues (not in production)
pnpm --filter @mandapambook/api db:seed -- --master   # master data only
pnpm --filter @mandapambook/api db:check      # migration snapshot consistency
```

CI fails if the schema and the committed migrations drift apart.

## Migration rules

- Migrations are forward-only. Never edit a migration that has been merged.
- Use expand → migrate → contract for breaking changes, so the previous release keeps working during a rollout.
- Anything Drizzle cannot express (constraints, triggers, functions) goes in a custom migration: `pnpm exec drizzle-kit generate --custom --name=<what>`.
- The API never migrates at startup.

## Integrity guarantees enforced by Postgres

| Rule                                                         | Mechanism                                                                                                                                                                | Migration |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| No double booking of a hall slot                             | `hall_occupancy_no_overlap`: `EXCLUDE USING gist (hall_id =, event_date =, slot_span &&) WHERE (active)`. Slot spans: Morning `[0,1)`, Evening `[1,2)`, Full day `[0,2)` | 0002      |
| Occupancy always matches bookings and owner blocks           | Triggers `bookings_occupancy_sync` and `availability_blocks_occupancy_sync` create rows and toggle `active` on status change                                             | 0002      |
| A booking can't be moved to another hall, date or slot       | Trigger raises `check_violation`; rescheduling creates a new booking                                                                                                     | 0002      |
| A booking's hall belongs to its auditorium                   | Composite FK `(hall_id, auditorium_id)`                                                                                                                                  | 0002      |
| Money is integer paise and adds up                           | `bigint` columns; checks for non-negative amounts, `total = subtotal + addons + gst + fee`, `advance <= total`                                                           | 0001      |
| Held bookings always have an expiry                          | Check `bookings_hold_has_expiry`                                                                                                                                         | 0001      |
| Audit log is append-only                                     | Triggers reject `UPDATE`, `DELETE` and `TRUNCATE` with `insufficient_privilege`                                                                                          | 0002      |
| Emails unique ignoring case; phones are E.164 Indian mobiles | `citext` unique index; regex check                                                                                                                                       | 0001      |
| Webhooks processed once                                      | Unique `(provider, event_id)`                                                                                                                                            | 0001      |
| Payments idempotent                                          | Unique `idempotency_key`, unique `(provider, provider_order_id)`                                                                                                         | 0001      |

Active booking statuses (occupy the slot): `HELD`, `PENDING_PAYMENT`, `AWAITING_OWNER`, `CONFIRMED`, `COMPLETED`. Freed: `CANCELLED`, `EXPIRED`, `REFUNDED`. The list lives in `booking_occupancy_sync()` and in `ACTIVE_BOOKING_STATUSES` (`schema/enums.ts`); change both together.

Application code maps SQLSTATE `23P01` to `409 SLOT_UNAVAILABLE` (Phase 5).

## Sensitive columns

`owner_profiles.pan_enc`, `bank_account_enc` and `ifsc_enc` hold AES-256-GCM ciphertext written by the API (Phase 3). Only the last four characters are stored in plain text for display. Refresh tokens, email tokens and OTP codes are stored only as hashes.
