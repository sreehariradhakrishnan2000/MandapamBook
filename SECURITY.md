# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** (Security → Advisories) on this repository. Do not open a public issue. Include steps to reproduce, affected endpoints or components, and impact. You'll get an acknowledgement within 3 working days.

## Supported versions

Only the latest release on `main` receives security fixes.

## Security baseline

MandapamBook targets **OWASP ASVS 4.0 Level 2** and the OWASP Top 10. The threat model is in [docs/threat-model.md](docs/threat-model.md).

| Area           | Control                                                                                                                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration  | All secrets come from environment variables, validated with Zod at startup; the process exits on invalid config. `.env` is never committed.                                                                                                                                         |
| Transport      | HTTPS only in production, HSTS with preload, strict CORS allowlist (exact origins, https enforced in production).                                                                                                                                                                   |
| Headers        | Helmet on the API (`default-src 'none'`), strict CSP and frame denial on the web app.                                                                                                                                                                                               |
| Input          | Zod validation on every body, query and param; request size limits; parameterised queries only.                                                                                                                                                                                     |
| Authentication | argon2id; 15-minute access JWTs held in memory; rotating refresh tokens in `__Host-` httpOnly, Secure, SameSite=Strict cookies with reuse detection that revokes the whole session; lockout after 5 failures; per-IP and per-account rate limits. See [docs/auth.md](docs/auth.md). |
| Authorisation  | Permission-based RBAC plus resource-ownership checks in the data layer, with IDOR tests (Phase 2–3).                                                                                                                                                                                |
| Data at rest   | PAN, bank account and IFSC encrypted with AES-256-GCM (versioned keys, ciphertext bound to owner and column); only masked values are returned or audited. See [docs/owners.md](docs/owners.md).                                                                                     |
| CSRF           | Signed double-submit token plus Origin allowlist on the two cookie-authenticated endpoints.                                                                                                                                                                                         |
| Uploads        | Presigned PUTs bound to type and exact size under server-chosen keys; magic-byte verification on confirm; private bucket with 5-minute signed reads; JPEG/PNG/WebP only, 10 MB.                                                                                                     |
| Logging        | Structured pino logs with correlation IDs; credentials and PII are redacted.                                                                                                                                                                                                        |
| Audit          | Append-only audit log (DB triggers block UPDATE/DELETE/TRUNCATE) for logins, failures, lockouts, token reuse, resets, role and status changes.                                                                                                                                      |
| Supply chain   | Lockfile installs, 7-day minimum package age, install scripts allowlisted, Dependabot, `pnpm audit`, dependency review, CodeQL, Trivy, gitleaks, actions pinned by SHA.                                                                                                             |
| Containers     | Multi-stage builds, non-root users, dropped capabilities, read-only filesystem for the API.                                                                                                                                                                                         |

## Handling secrets

- Never commit `.env` files, keys, certificates, database dumps or real customer data.
- The pre-commit hook and CI both run gitleaks. If a secret is committed, rotate it first, then remove it; history rewriting alone is not enough.
