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

## Phase 0 controls in place

- Env validation fails fast and never prints values
- Helmet, CORS allowlist, body limits, structured errors without stack traces
- Log redaction of auth headers, cookies and PII fields
- Non-root containers, dropped capabilities, read-only API filesystem
- CI: gitleaks, `pnpm audit`, dependency review, CodeQL, Trivy
