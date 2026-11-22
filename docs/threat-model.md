# Threat model

Method: STRIDE per trust boundary. This document grows each phase; the Phase 8 review completes it.

## Assets

- Customer PII (name, email, phone), booking history
- Owner KYC: PAN, GSTIN, bank account and IFSC
- Money flows: payments, refunds, payouts, commission settings
- Availability calendar (integrity: no double bookings)
- Credentials and session tokens; signing and encryption keys

## Trust boundaries

1. Browser ↔ web/nginx ↔ API (public internet)
2. Payment gateway → webhook endpoint (signed, untrusted network)
3. API ↔ PostgreSQL / Redis / object storage (private network)
4. CI/CD ↔ registry ↔ runtime environments

## Threats and planned controls

| STRIDE | Threat                                             | Control                                                                  | Phase |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------ | ----- |
| S      | Credential stuffing and brute force                | argon2id, per-IP and per-account rate limits, lockout, generic errors    | 2     |
| S      | Stolen refresh token reuse                         | Rotation with family revocation on reuse, hashed storage                 | 2     |
| S      | Forged payment webhook                             | HMAC over raw body, timestamp window, event-id replay protection         | 6     |
| T      | Client tampers with price                          | Server-side quote, frozen `price_snapshot`, client totals ignored        | 5     |
| T      | Concurrent double booking                          | DB exclusion constraint, transactional state transitions                 | 1, 5  |
| R      | Admin denies approving a listing or refund         | Append-only audit log with actor, IP, before/after                       | 2     |
| I      | IDOR across owners                                 | Ownership enforced in repositories, 404 on mismatch, IDOR test matrix    | 2, 3  |
| I      | KYC data leak via DB dump or logs                  | AES-256-GCM field encryption, masked responses, log redaction            | 0, 3  |
| I      | Malicious upload (polyglot, oversized, SVG script) | Signed URLs, size limits, magic-byte checks, no SVG, re-encoding         | 3     |
| D      | Hold flooding to block a venue's calendar          | One active hold per customer, 10-minute TTL, rate limits, verified phone | 5     |
| D      | Large or slow requests                             | Body limits, server timeouts, rate limits                                | 0, 2  |
| E      | Owner staff escalating to pricing or payouts       | Permission-based RBAC, explicit staff permission set, tests              | 2, 3  |
| E      | Compromised dependency or action                   | Lockfile, 7-day package age, SHA-pinned actions, audit, CodeQL, Trivy    | 0     |

## Phase 4 controls in place

- Insider misuse of KYC: full numbers only via an explicit reveal with a stated purpose, audited per call; lists show masked values
- Approving unsafe listings: approval requires verified KYC and a complete listing; owners can never set status
- Conflicting admin actions: status transitions are conditional updates, so concurrent decisions cannot both apply
- Silent config tampering: platform settings bounded, super-admin only, audited with full before/after
- Search injection: LIKE wildcards escaped; parameterised queries throughout
- Self-dealing: admins cannot review their own KYC or change their own role

## Phase 3 controls in place

- KYC theft from DB dumps or logs: AES-256-GCM field encryption with row/column-bound associated data; masked API responses and audit entries
- Malicious uploads: type and size bound into the presigned URL; magic-byte check on confirm deletes mismatches; no SVG; private bucket with short-lived signed reads
- IDOR on owner resources: every owner route loads through scope-filtered queries (22-route test matrix)
- Staff privilege creep: staff limited to calendar and venue views, optionally per venue; owners cannot convert existing accounts into staff
- Calendar abuse: owner blocks share the booking exclusion constraint; past dates refused
- Open items: EXIF stripping/re-encoding (Phase 8), stale-upload cleanup job (Phase 5)

## Phase 2 controls in place

- Credential stuffing: per-IP and per-email limits, lockout with alert email, generic errors, dummy hash for unknown emails
- Token theft: 15-minute access tokens in memory only; refresh rotation with family revocation on reuse; hashed storage; key rings with `kid`
- CSRF on cookie endpoints: signed double-submit plus Origin check; SameSite=Strict `__Host-` cookies
- Privilege escalation: permission checks, super-admin-only role changes, no self role change, admins cannot act on admins; tokens cut off on role change
- IDOR: owner scope enforced in queries, 404 for foreign resources, tested per route
- Account enumeration: identical responses for register, login and reset
- Open redirect after login: return URLs restricted to in-app paths

## Phase 0 controls in place

- Env validation fails fast and never prints values
- Helmet, CORS allowlist, body limits, structured errors without stack traces
- Log redaction of auth headers, cookies and PII fields
- Non-root containers, dropped capabilities, read-only API filesystem
- CI: gitleaks, `pnpm audit`, dependency review, CodeQL, Trivy
