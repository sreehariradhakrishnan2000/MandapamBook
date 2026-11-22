# Runbook

How MandapamBook is deployed, checked, rolled back and kept healthy. It is hosted on
[Render](https://render.com) from immutable GHCR images (see [Hosting on Render](#hosting-on-render));
the deploy workflow points each Render service at the new image through its deploy hook.

## Components

| Component      | Image / command                                                                   | Scale | Notes                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | `ghcr.io/<owner>/mandapambook-api:<sha>` (lowercase), `node dist/server.js`       | 2+    | Stateless; behind a TLS-terminating proxy (`TRUST_PROXY_HOPS=1`)                                                                                                                                                            |
| Worker         | same image, `node dist/worker.js`                                                 | 1+    | Sweep (holds, completion, refunds, payouts, uploads) and email delivery. An advisory lock keeps sweeps from overlapping, so extra workers are safe. Without a worker (free tier), set `RUN_JOBS_IN_PROCESS=true` on the API |
| Web            | `ghcr.io/<owner>/mandapambook-web:<sha>`                                          | 1+    | nginx, non-root, strict CSP                                                                                                                                                                                                 |
| Postgres       | managed (Neon)                                                                    |       | Pooled URL for the app, **direct** URL for migrations                                                                                                                                                                       |
| Redis          | Render Key Value (staging: internal `redis://`, `noeviction`), or TLS `rediss://` |       | Rate limits and token revocation. Rebuildable: losing it only resets counters                                                                                                                                               |
| Object storage | S3-compatible, private bucket                                                     |       | Presigned uploads/downloads only                                                                                                                                                                                            |

## Environments and the pipeline

`.github/workflows/deploy.yml`, on every push to `main`:

1. **Build once.** API and web images are pushed to GHCR tagged with the commit SHA (with
   provenance and SBOM). The API image carries `APP_VERSION=<sha>`, reported by `/health`.
2. **Staging.** Migrations run as a separate step (`node dist/db/migrate.js` with
   `MIGRATION_DATABASE_URL`), each Render service's deploy hook is called with the new image, then the job waits until `/health`
   reports the new version **and** `/ready` passes (up to 10 minutes).
3. **Production.** The same images and steps, after approval by a required reviewer of the
   `production` environment.

Configure once per environment (Settings → Environments):

| Kind            | Name                        | Value                                                                      |
| --------------- | --------------------------- | -------------------------------------------------------------------------- |
| secret          | `MIGRATION_DATABASE_URL`    | Direct (non-pooled) Postgres URL                                           |
| secret          | `RENDER_DEPLOY_HOOK_API`    | The API service's deploy hook URL (Render → service → Settings)            |
| secret          | `RENDER_DEPLOY_HOOK_WEB`    | The web service's deploy hook URL                                          |
| secret          | `RENDER_DEPLOY_HOOK_WORKER` | Optional; only with a separate worker service                              |
| variable        | `API_BASE_URL`              | The API's public URL, e.g. `https://mandapambook-api-staging.onrender.com` |
| production only | Required reviewers          | The approval gate                                                          |

Runtime secrets (`ACCESS_TOKEN_KEYS`, `REFRESH_TOKEN_KEYS`, `CSRF_SECRET`, `OTP_SECRET`,
`FIELD_ENCRYPTION_KEYS`, `RAZORPAY_*`, `SMTP_URL`, `S3_*`, `DATABASE_URL`, `REDIS_URL`) live
in the host's secret store, never in the repository. The API refuses to start in production
with unsafe settings: http origins, console or file email, memory storage, mock payments,
`rzp_test_` keys, non-TLS Redis.

Staging runs with `NODE_ENV=production` and `APP_ENV=staging`. It keeps all of those rules
with two exceptions. The mock gateway (with the TEST MODE banner) and `rzp_test_` keys are
allowed, and `rzp_live_` keys are refused. Plain `redis://` is also allowed, for a host's
private-network Redis such as Render Key Value's internal URL, which never leaves that
network. If `APP_ENV` is unset, the strict production rules apply, so a missing variable can
never loosen production.

## Hosting on Render

Each environment is two **image-backed web services** (Render's free plan), both pulling from
GHCR with a registry credential (a GitHub token with `read:packages`, until the packages are
made public). Put them in the same region as the environment's database (staging: Virginia,
next to Neon us-east-1).

| Service                  | Image                                    | Port | Health check | Key settings                                                                                                                      |
| ------------------------ | ---------------------------------------- | ---- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `mandapambook-api-<env>` | `ghcr.io/<owner>/mandapambook-api:<sha>` | 4000 | `/health`    | `NODE_ENV=production`, `APP_ENV=staging` (staging only), `RUN_JOBS_IN_PROCESS=true`, `PORT=4000`, plus every runtime secret above |
| `mandapambook-web-<env>` | `ghcr.io/<owner>/mandapambook-web:<sha>` | 8080 | `/`          | `API_UPSTREAM=https://mandapambook-api-<env>.onrender.com`, `STORAGE_ORIGIN`                                                      |

- **No worker service on the free plan.** Render has no free background workers, so the API
  runs the sweeps itself (`RUN_JOBS_IN_PROCESS=true`). On a paid plan, add a worker
  (same image, command `node dist/worker.js`) and set `RENDER_DEPLOY_HOOK_WORKER`; the
  sweep's advisory lock keeps them from overlapping.
- **The web service proxies `/api` over the API's public URL.** Free services can't receive
  private-network traffic. nginx sends the upstream's own `Host` (so Render routes to the
  API), SNI, and verifies the certificate. `CORS_ORIGINS` and `APP_BASE_URL` are the web
  service's `https://…onrender.com` URL.
- **Client IPs:** requests reach the API through Render's edge, nginx and Render's edge
  again, so `TRUST_PROXY_HOPS` must match that chain. Check after the first deploy that the
  API logs real client IPs (otherwise everyone shares one rate-limit bucket).
- **Free services sleep** after 15 minutes idle and take about a minute to wake; sweeps pause
  while asleep. Expired holds still free their slot on the next request, and queued email is
  sent after waking. Fine for staging; production needs paid instances.

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
| `/ready` failing on `redis`                  | Render Key Value / Redis provider status      | Logins, holds and refresh fail closed. Restore Redis; nothing to recover                                      |
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
