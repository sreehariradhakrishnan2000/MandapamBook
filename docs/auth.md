# Authentication and authorisation

## Tokens

|                           | Access token                                                     | Refresh token                                                               |
| ------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Format                    | HS256 JWT, `typ: at+jwt`, `kid` header                           | Opaque `<kid>.<32 random bytes>`                                            |
| Lifetime                  | 15 minutes (`ACCESS_TOKEN_TTL_SECONDS`)                          | 7 days, or 30 with "keep me signed in". Absolute: rotation never extends it |
| Where the client keeps it | Memory only (an Angular signal)                                  | `__Host-mb_rt` cookie: httpOnly, Secure, SameSite=Strict, Path=/            |
| Where the server keeps it | Nowhere (stateless) plus short-lived revocation entries in Redis | Only an HMAC-SHA256 hash, with family id, device, IP and expiry             |
| Keys                      | `ACCESS_TOKEN_KEYS` ring                                         | `REFRESH_TOKEN_KEYS` ring (must differ from the access keys)                |

Claims: `sub` (user id), `role`, `sid` (refresh family = device session), `jti`, `iat`, `exp`, `iss=mandapambook`, `aud=mandapambook-api`.

### Rotation and reuse detection

Every `POST /auth/refresh` revokes the presented token (`revoked_reason = rotated`) and issues a new one in the same family. If a token that is already revoked is presented again, someone holds a copy. The server then:

1. revokes every token in that family (`reuse_detected`);
2. denies the family's live access tokens in Redis for up to 15 minutes;
3. writes `auth.refresh_reuse` to the audit log and emails the user.

Other devices (families) are not affected. The web app serialises refresh calls so two tabs never rotate at once.

### Revocation of access tokens

`authenticate` rejects an access token when any of these Redis keys exists:

| Key                                                              | Set by                                              |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| `auth:revoked:jti:<jti>`                                         | logout                                              |
| `auth:revoked:family:<id>`                                       | refresh reuse, session revoke, logout               |
| `auth:cutoff:user:<id>` (tokens issued at or before this second) | logout-all, password reset, role change, suspension |

### Key rotation

```sh
node scripts/generate-secrets.mjs --rotate
```

1. Prepend the new access key to `ACCESS_TOKEN_KEYS` and the new refresh key to `REFRESH_TOKEN_KEYS`, then deploy. New tokens use the new keys; old tokens still verify.
2. After 1 hour, remove the old access key.
3. After `REFRESH_TOKEN_REMEMBER_DAYS`, remove the old refresh key.

For a suspected key leak, replace the ring outright instead. That signs everyone out.

## Login protection

- Per-IP and per-email rate limits (`http/middleware/rate-limit.ts` lists every limit).
- After 5 wrong passwords (`LOGIN_MAX_FAILURES`), sign-in is locked for 15 minutes (`LOGIN_LOCKOUT_MINUTES`) and the user gets an email.
- Unknown email, wrong password and lockout look the same to the caller. Unknown emails still run an argon2 verification, so timing doesn't reveal which accounts exist.
- Registration and password-reset requests always return 202 with the same message.

## Passwords

argon2id, 64 MiB, t=3, p=1, rehashed transparently on login when the parameters change. 10–128 characters, must not contain the email name. With `HIBP_ENABLED=true`, new passwords are checked against Have I Been Pwned using k-anonymity (only 5 hex characters of the SHA-1 leave the server). If HIBP is unreachable the check is skipped (fails open).

## CSRF

Only `/auth/refresh` and `/auth/logout` read the refresh cookie. They require a signed double-submit token: `GET /auth/csrf` sets `__Host-mb_csrf` and returns the same value, which the client sends as `X-CSRF-Token`. The server checks the header matches the cookie, that its HMAC is valid, and that `Origin` (if present) is allowlisted. Other endpoints use the Bearer header, which browsers never attach automatically.

## Authorisation

Two independent checks on every protected route:

1. **Permission**: `requirePermission('auditorium:update')`. Roles map to permissions in `packages/shared/src/rbac.ts`; code never compares role names.
2. **Ownership**: owner-side queries are filtered by `resolveOwnerScope()` (owner → their venues; staff → their owner's venues, optionally only assigned ones). A resource outside the scope returns **404**, so ids can't be probed.

| Permission                                                                                                            | Super admin | Admin | Owner | Owner staff | Customer |
| --------------------------------------------------------------------------------------------------------------------- | :---------: | :---: | :---: | :---------: | :------: |
| `admin:manage`, `settings:update`, `user:role_change`                                                                 |      ✓      |       |       |             |          |
| `user:manage`, `listing:review`, `refund:issue`, `report:view`, `audit:view`, `masterdata:update`, `booking:view_all` |      ✓      |   ✓   |       |             |          |
| `auditorium:create/update`, `pricing:update`, `payout:view`, `kyc:update`, `staff:manage`, `booking:approve`          |      ✓      |       |  own  |             |          |
| `calendar:manage`, `booking:view_venue`                                                                               |      ✓      |       |  own  |  assigned   |          |
| `booking:create`, `booking:cancel_own`, `review:create`                                                               |             |       |       |             |   own    |

Role changes (super admin only, never your own) and suspensions (admins can't act on admins) are audited with before/after values and immediately end the target's sessions.

## Endpoints

| Method | Path                                                                                      | Auth                               |
| ------ | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| GET    | `/api/v1/auth/csrf`                                                                       | none                               |
| POST   | `/api/v1/auth/register`, `/login`, `/verify-email`, `/password/forgot`, `/password/reset` | none (rate limited)                |
| POST   | `/api/v1/auth/refresh`, `/logout`                                                         | refresh cookie + CSRF              |
| GET    | `/api/v1/auth/me`, `/sessions`                                                            | Bearer                             |
| POST   | `/api/v1/auth/logout-all`, `/otp/send`, `/otp/verify`                                     | Bearer                             |
| DELETE | `/api/v1/auth/sessions/:familyId`                                                         | Bearer (own sessions only)         |
| GET    | `/api/v1/owner/auditoriums`, `/owner/auditoriums/:id`                                     | `booking:view_venue` + owner scope |
| PATCH  | `/api/v1/admin/users/:id/role`                                                            | `user:role_change`                 |
| PATCH  | `/api/v1/admin/users/:id/status`                                                          | `user:manage`                      |
| GET    | `/api/v1/admin/audit-logs`                                                                | `audit:view`                       |

## Audit events

`auth.register`, `auth.login`, `auth.login_failed`, `auth.lockout`, `auth.logout`, `auth.logout_all`, `auth.refresh_reuse`, `auth.session_revoked`, `auth.email_verified`, `auth.password_reset_requested`, `auth.password_reset`, `auth.phone_verified`, `user.role_changed`, `user.status_changed`.

## Local development

1. `node scripts/generate-secrets.mjs >> .env`
2. Set `REDIS_URL` (Upstash: `rediss://default:<password>@<name>.upstash.io:6379`).
3. Optional: set `SEED_DEMO_PASSWORD` and run `pnpm --filter @mandapambook/api db:seed` for demo accounts of every role (`superadmin@`, `admin@`, `staff.kerala@`, `customer@`, `owner.kerala@example.test`).
4. Emails and OTP codes are printed to the API log (console providers) until Phase 7.
