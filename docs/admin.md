# Admin console

## Listing review

| From             | Decision  | To          | Needs                                          |
| ---------------- | --------- | ----------- | ---------------------------------------------- |
| `PENDING_REVIEW` | approve   | `APPROVED`  | Owner KYC `VERIFIED` and no completeness gaps  |
| `PENDING_REVIEW` | reject    | `REJECTED`  | Reason (≥ 10 characters), emailed to the owner |
| `APPROVED`       | suspend   | `SUSPENDED` | Reason; owner can no longer edit               |
| `SUSPENDED`      | reinstate | `APPROVED`  | Same checks as approve                         |

Any other transition returns `409 INVALID_TRANSITION`. Decisions are conditional updates on the expected status, so if two admins act at once exactly one wins and the other gets 409. Every decision is audited (`listing.approved|rejected|suspended|reinstated`) with before/after status and reason, and the owner is emailed.

The queue (`GET /admin/listings?status=PENDING_REVIEW`) lists oldest submissions first. The review view includes halls with prices, photos (5-minute signed URLs), amenities, policy, owner details and `gaps`, the same completeness check owners see.

## KYC review

- `GET /admin/owners?kycStatus=SUBMITTED` returns masked PAN and account numbers only.
- `POST /admin/owners/:id/kyc/reveal {purpose}` returns the full PAN, account number and IFSC. It requires `kyc:review` and a purpose, sends `Cache-Control: no-store`, and every call writes `owner.kyc_revealed` with the admin, IP and purpose.
- `POST /admin/owners/:id/kyc/decision` verifies or rejects (with a reason the owner sees) **submitted** KYC only. Admins cannot review their own KYC. The owner is emailed.
- When the owner saves details again, status returns to `SUBMITTED` and the rejection reason is cleared.

## Users

`GET /admin/users?q=&role=&status=` searches name, email and phone. Search input is matched literally (`%` and `_` are escaped). Responses never include password hashes or token data. Role changes stay super-admin only, and suspensions cannot target admins unless the actor is a super admin (see [auth.md](auth.md)).

## Reference data

| Resource        | Endpoints                                                                | Notes                                                                                         |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Cities          | `GET/POST /admin/cities`, `PATCH /admin/cities/:id`                      | Deactivate instead of delete; inactive cities disappear from the public list and new listings |
| Amenities       | `GET/POST /admin/amenities`, `PATCH /admin/amenities/:id`                | Same                                                                                          |
| Muhurtham dates | `GET/POST /admin/muhurtham-dates`, `DELETE /admin/muhurtham-dates/:date` | Drive MUHURTHAM pricing rules                                                                 |

All changes are audited as `masterdata.changed` with before/after values. Duplicates return 409.

## Platform settings

| Key                    | Meaning                                          | Bounds       | Default    |
| ---------------------- | ------------------------------------------------ | ------------ | ---------- |
| `commission_bps`       | Platform commission, basis points of the booking | 0–3000 (30%) | 800 (8%)   |
| `platform_fee_paise`   | Fee per booking charged to the customer          | 0–₹10,000    | ₹499       |
| `gst_bps`              | GST rate                                         | 0–2800 (28%) | 1800 (18%) |
| `hold_minutes`         | How long a slot is held while paying             | 5–30         | 10         |
| `owner_response_hours` | Time for request-mode owners to accept           | 1–72         | 24         |

Admins can read settings; only super admins (`settings:update`) can change them. Changes are audited (`settings.changed`, full before/after) and apply to new quotes only, since bookings keep their price snapshot.

## Permissions

| Area                        | Permission          | Super admin | Admin |
| --------------------------- | ------------------- | :---------: | :---: |
| Listing queue and decisions | `listing:review`    |      ✓      |   ✓   |
| KYC list, reveal, decisions | `kyc:review`        |      ✓      |   ✓   |
| Users                       | `user:manage`       |      ✓      |   ✓   |
| Role changes                | `user:role_change`  |      ✓      |       |
| Reference data              | `masterdata:update` |      ✓      |   ✓   |
| Read settings               | `report:view`       |      ✓      |   ✓   |
| Change settings             | `settings:update`   |      ✓      |       |
| Audit log                   | `audit:view`        |      ✓      |   ✓   |

Bookings, refunds and reports arrive with Phases 5–7.
