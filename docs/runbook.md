# Runbook

How MandapamBook is deployed, checked, rolled back and kept healthy. The hosting provider is
not fixed: the deploy workflow calls the provider's deploy hook with immutable image tags, so
anything that can run two containers (API, worker) plus the static web image works.

## Components

| Component      | Image / command                                                             | Scale | Notes                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | `ghcr.io/<owner>/mandapambook-api:<sha>` (lowercase), `node dist/server.js` | 2+    | Stateless; behind a TLS-terminating proxy (`TRUST_PROXY_HOPS=1`)                                                                                   |
| Worker         | same image, `node dist/worker.js`                                           | 1+    | Sweep (holds, completion, refunds, payouts, uploads) and email delivery. An advisory lock keeps sweeps from overlapping, so extra workers are safe |
| Web            | `ghcr.io/<owner>/mandapambook-web:<sha>`                                    | 1+    | nginx, non-root, strict CSP                                                                                                                        |
| Postgres       | managed (Neon)                                                              |       | Pooled URL for the app, **direct** URL for migrations                                                                                              |
| Redis          | managed (Upstash, `rediss://`)                                              |       | Rate limits and token revocation. Rebuildable: losing it only resets counters                                                                      |
| Object storage | S3-compatible, private bucket                                               |       | Presigned uploads/downloads only                                                                                                                   |

## Environments and the pipeline

`.github/workflows/deploy.yml`, on every push to `main`:

1. **Build once.** API and web images are pushed to GHCR tagged with the commit SHA (with
   provenance and SBOM). The API image carries `APP_VERSION=<sha>`, reported by `/health`.
2. **Staging.** Migrations run as a separate step (`node dist/db/migrate.js` with
   `MIGRATION_DATABASE_URL`), the deploy hook is called, then the job waits until `/health`
   reports the new version **and** `/ready` passes (up to 10 minutes).
3. **Production.** The same images and steps, after approval by a required reviewer of the
   `production` environment.

Configure once per environment (Settings → Environments):

| Kind            | Name                     | Value                                                                     |
| --------------- | ------------------------ | ------------------------------------------------------------------------- |
| secret          | `MIGRATION_DATABASE_URL` | Direct (non-pooled) Postgres URL                                          |
| secret          | `DEPLOY_HOOK_URL`        | Host deploy hook; receives `{environment, api_image, web_image, version}` |
| secret          | `DEPLOY_HOOK_TOKEN`      | Optional bearer token for the hook                                        |
| variable        | `API_BASE_URL`           | e.g. `https://api.mandapambook.in`                                        |
| production only | Required reviewers       | The approval gate                                                         |

Runtime secrets (`ACCESS_TOKEN_KEYS`, `REFRESH_TOKEN_KEYS`, `CSRF_SECRET`, `OTP_SECRET`,
`FIELD_ENCRYPTION_KEYS`, `RAZORPAY_*`, `SMTP_URL`, `S3_*`, `DATABASE_URL`, `REDIS_URL`) live
in the host's secret store, never in the repository. The API refuses to start in production
with unsafe settings: http origins, console or file email, memory storage, mock payments,
`rzp_test_` keys, non-TLS Redis.

## Health checks

| Endpoint      | Meaning                                                                | Use for                       |
| ------------- | ---------------------------------------------------------------------- | ----------------------------- |
| `GET /health` | Process is running; returns `version` (short commit)                   | Liveness probe, rollout check |
| `GET /ready`  | Postgres and Redis respond within 2 s (503 with check names otherwise) | Readiness probe               |

Neon suspends idle computes. The first `/ready` after a long idle period can fail while the
compute wakes (about 1–3 s). Probes should allow 2–3 failures before acting.

## Rolling back

Images are immutable and every deploy is a commit SHA.

1. Find the last good SHA (the previous successful Deploy run, or `git log main`).
2. Actions → **Deploy** → _Run workflow_. Set `image_tag` to that SHA and leave **run_migrations off**.
3. Staging redeploys, then production after approval. The smoke test confirms `/health`
   reports the old SHA.

This works because migrations are **expand-only** within a release. Columns and tables are
added, never dropped or renamed, in the same release that starts using them. The previous
image therefore runs against the newer schema. Removing anything (_contract_) happens in a
later release, once no deployed image uses it.

A faulty migration is never edited or reverted in place. Write a new corrective migration and
ship it through the pipeline. Neon branches or point-in-time restore are the last resort for
data damage. Restore into a new branch, verify it, then switch `DATABASE_URL`.

## Migrations

- Generate: `pnpm --filter @mandapambook/api db:generate --name=<what>`. Review the SQL, add
  data back-fills by hand, and keep each migration expand-only.
- CI checks the migrations against the schema (no drift) and applies them plus the seed to
  an empty database twice.
- Apply: done by the pipeline. Manually, run `node dist/db/migrate.js` with
  `MIGRATION_DATABASE_URL` set, from the image.
- Migrations take locks. For large tables use `CREATE INDEX CONCURRENTLY` in its own migration
  and back-fill in batches.

## Rotating secrets

| Secret                          | How                                                                                                                                                                          | Effect                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Access / refresh token keys     | `node scripts/generate-secrets.mjs --rotate`. **Prepend** the new `kid:key` to the ring, deploy, and remove the old key after the token TTL (15 min access, 30 days refresh) | No sign-outs                                       |
| `FIELD_ENCRYPTION_KEYS`         | Prepend a new key. New writes use it and old rows still decrypt. Remove the old key only after re-encrypting                                                                 | No downtime                                        |
| `CSRF_SECRET`, `OTP_SECRET`     | Replace and deploy                                                                                                                                                           | In-flight forms and OTPs fail once and are retried |
| Payment keys and webhook secret | Create new ones in the gateway, update secrets, deploy, revoke the old                                                                                                       | Brief window; webhooks are retried by the gateway  |
| Database / Redis passwords      | Rotate in the provider, update `DATABASE_URL` / `MIGRATION_DATABASE_URL` / `REDIS_URL`, deploy                                                                               | Rolling restart                                    |

A suspected leak means rotate first, investigate second. The audit log (`/admin/audit`)
shows who did what.

## Incidents

| Symptom                                      | Check                                         | Action                                                                                                        |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/ready` failing on `database`               | Neon status, connection limits                | Wait out a cold start; otherwise scale or fail over                                                           |
| `/ready` failing on `redis`                  | Upstash status                                | Logins, holds and refresh fail closed. Restore Redis; nothing to recover                                      |
| Payments captured but bookings not confirmed | `webhook_events` rows with `processing_error` | Fix the cause; the gateway retries. The browser verify path also confirms                                     |
| Refunds stuck in `PENDING`                   | Worker logs, `refunds` table                  | The worker retries every sweep; check gateway credentials                                                     |
| Emails not arriving                          | `notifications` rows `FAILED` / `last_error`  | Fix SMTP; re-queue with `UPDATE notifications SET status='QUEUED', attempts=0, next_attempt_at=now() WHERE …` |
| Holds not expiring                           | Worker running? Advisory lock held?           | Restart the worker. Search already ignores expired holds                                                      |
| Spike of 429s                                | Rate-limit logs by key                        | Expected under abuse; tune `LIMITS` only with evidence                                                        |

## Logs

JSON lines via pino, with PII redaction. Every request carries `X-Request-Id`, and error
responses include it as `correlationId`. Search logs by that id to trace a user-reported error.
The worker logs a summary line for each sweep that did work.

## Local end-to-end tests

`pnpm e2e` runs the Playwright journeys against a separate database (`E2E_DATABASE_URL`, name
ending `_e2e`, reset each run). It starts the real API, worker and dev server, uses mock
payments, and writes emails to files. Install the browser once with
`pnpm --filter @mandapambook/e2e install-browsers`. Never run it at the same time as
the API integration tests on a shared machine.
