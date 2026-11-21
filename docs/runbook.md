# Runbook

Status: skeleton. Deployment, migration and rollback procedures are completed in Phase 8 once the hosting target is chosen.

## Health endpoints

| Endpoint      | Meaning                                                               | Use for         |
| ------------- | --------------------------------------------------------------------- | --------------- |
| `GET /health` | Process is running                                                    | Liveness probe  |
| `GET /ready`  | Postgres and Redis respond within 2s (503 with check names otherwise) | Readiness probe |

## Logs

JSON lines via pino. Every request carries `X-Request-Id`; error responses include it as `correlationId`. Search logs by that id to trace a user-reported error.

## Rollback (outline, finalised in Phase 8)

1. Re-deploy the previous image tag (images are immutable and tagged by git SHA).
2. Migrations are forward-only and backwards-compatible (expand → migrate → contract), so the previous image runs against the newer schema.
3. If a migration itself is faulty, apply a new corrective migration through the reviewed migration pipeline. Never edit an applied migration.
