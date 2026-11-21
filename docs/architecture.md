# Architecture

The full approved plan, with diagrams, lives at https://claude.ai/artifact/Gi1ew9f5vHK1HdaGnwM9Uz (private to the owner). This file records the decisions so they stay with the code.

## Decisions (approved 2026-11-22)

| Topic           | Decision                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Shape           | Modular monolith API plus a worker process from the same image. Modules own their tables and talk through services.           |
| ORM             | Drizzle with plain SQL migrations (needed for the `btree_gist` exclusion constraint and range types).                         |
| Package manager | pnpm workspaces, Node 24 LTS.                                                                                                 |
| Web             | Angular 22, standalone components, zoneless, Tailwind 4 + Angular CDK, lazy route tree per role.                              |
| Booking mode    | Per-listing `instantBook`. When off, a paid booking enters `AWAITING_OWNER`; rejection or 24h timeout refunds automatically.  |
| Online payment  | Advance (owner's advance %) + GST on it + platform fee online; balance settled at the venue and marked received by the owner. |
| Double booking  | `hall_occupancy` table with `EXCLUDE USING gist (hall_id =, event_date =, slot_span &&) WHERE (active)`.                      |
| Jobs            | BullMQ on Redis: hold expiry, owner-response timeout, notifications, completion.                                              |
| Local services  | Postgres 16, Redis 8, Mailpit (email), SeaweedFS (S3-compatible; MinIO no longer ships images).                               |
| Hosting         | Not chosen yet. Deploy workflows build and push images to GHCR, then stop at a marked placeholder step.                       |

## Module map (API)

```
config/        env validation, logger
http/          app factory, middleware, error mapping
infra/         Postgres pool, Redis client
modules/       auth, rbac, users, owners, auditoriums, media, availability, pricing,
               bookings, payments, notifications, reviews, reports, admin, audit
jobs/          worker entrypoint and job handlers
```

## Request pipeline

`requestId → pino-http → helmet → CORS allowlist → body limits → (rate limit, auth, CSRF: Phase 2) → route → Zod → service → repository → errorHandler`

Errors always use `{ error: { code, message, details?, correlationId } }`.
