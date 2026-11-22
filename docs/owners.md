# Owner onboarding and listings

## Flow

1. Owner registers (`accountType: OWNER`); an `owner_profiles` row is created.
2. **Business & payout details** (`PUT /owner/profile`): PAN, optional GSTIN, bank account, IFSC. KYC status becomes `SUBMITTED` (admins verify in Phase 4).
3. **Create a draft venue** (`POST /owner/auditoriums`), then add halls, prices, photos, amenities, add-ons and a cancellation policy.
4. **Submit** (`POST /owner/auditoriums/:id/submit`). The API refuses with `422 LISTING_INCOMPLETE` and lists what is missing until the listing has:
   - KYC details saved
   - at least one active hall
   - a standard (BASE) price for Morning, Evening and Full day on every active hall
   - a cancellation policy
   - at least 3 verified photos
5. Status moves `DRAFT → PENDING_REVIEW`; admins approve or reject (Phase 4). Rejected listings can be edited and resubmitted.

Owners can never set `status`. Only drafts without bookings can be deleted. Halls and add-ons already used by a booking are deactivated instead of deleted.

## KYC data protection

| Field               | Stored as                       | Shown as                                                       |
| ------------------- | ------------------------------- | -------------------------------------------------------------- |
| PAN                 | AES-256-GCM ciphertext + last 4 | `XXXXXX234K`                                                   |
| Bank account number | AES-256-GCM ciphertext + last 4 | `XXXXXXXX7890`                                                 |
| IFSC                | AES-256-GCM ciphertext          | In full (identifies a public bank branch)                      |
| GSTIN               | Plain text                      | In full (public in the GST registry; embeds the PAN by design) |

Ciphertext layout: `[version][kid length][kid][iv 12B][tag 16B][data]`. The associated data is `owner:<ownerId>:<column>`, so a value copied into another owner's row or another column fails to decrypt. Audit entries for `owner.kyc_updated` contain masked values only.

### Rotating `FIELD_ENCRYPTION_KEYS`

1. `node scripts/generate-secrets.mjs --rotate` and prepend the new `f…` key to the ring. New writes use it; old values still decrypt.
2. Re-encrypt existing rows (a script for this lands with Phase 8). `FieldCrypto.needsReencrypt()` identifies rows still on old keys.
3. Remove the old key only after every row is re-encrypted. Removing it early makes those rows unreadable.

## Photo uploads

```
browser ──POST /owner/auditoriums/:id/media/upload-url {mimeType, sizeBytes}──▶ API
        ◀── {mediaId, upload: {url, headers}}  (media row: PENDING_UPLOAD)
browser ──PUT url (Content-Type, exact size)──▶ object storage
browser ──POST /owner/media/:mediaId/confirm──▶ API: HEAD + read first 4 KB
        ◀── READY, or 422 INVALID_IMAGE (object deleted, row REJECTED)
```

- Allowed: JPEG, PNG, WebP; max 10 MB; max 30 per venue. SVG is never accepted.
- The presigned URL signs `Content-Type` and `Content-Length`, lives 10 minutes, and uses a server-chosen key `venues/<venueId>/<uuid>.<ext>`.
- On confirm the API checks the stored size matches and sniffs magic bytes (`file-type`), so a renamed HTML or script is rejected.
- Photos are served through 5-minute signed GET URLs; the bucket stays private.
- Not yet done: stripping EXIF metadata / re-encoding (needs `sharp`, planned for Phase 8), and a job that deletes uploads left in `PENDING_UPLOAD` (Phase 5 worker).

### Storage setup

| Setting                                     | Neon (dev)                                                            | Notes                                             |
| ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| `STORAGE_PROVIDER`                          | `s3`                                                                  | `memory` for tests/offline; refused in production |
| `S3_ENDPOINT`                               | `https://br-muddy-hill-bc4v7utn.storage.c-16.us-east-1.aws.neon.tech` | from `get_storage` on the branch                  |
| `S3_REGION`                                 | `us-east-1`                                                           |                                                   |
| `S3_BUCKET`                                 | `mandapambook-media` (private)                                        |                                                   |
| `S3_FORCE_PATH_STYLE`                       | `true`                                                                |                                                   |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | a credential scoped to `storage:read` + `storage:write`               | create in the Neon console                        |

Browsers upload directly to storage, so the bucket needs a CORS rule allowing `PUT` from the web origin with the `Content-Type` header, and the web image needs `STORAGE_ORIGIN` set so the CSP permits the request.

## Pricing rules

Prices are integer paise per hall and slot. Kinds and default priorities (higher wins when several match a date):

| Kind            | Applies                                 | Default priority |
| --------------- | --------------------------------------- | ---------------- |
| `BASE`          | always (fallback)                       | 0                |
| `WEEKEND`       | Saturdays and Sundays                   | 10               |
| `SEASONAL`      | `validFrom`–`validTo`                   | 20               |
| `MUHURTHAM`     | admin-managed muhurtham dates           | 30               |
| `DATE_OVERRIDE` | `validFrom`–`validTo` (usually one day) | 40               |

There is one BASE, WEEKEND and MUHURTHAM rule per slot; setting it again replaces it. Price calculation uses these in Phase 5.

## Staff

Owners invite staff by email. A new `OWNER_STAFF` account is created, never converted from an existing one, and the invitee sets a password through the emailed link, which also verifies the email. Staff can be limited to specific venues. They can view venues and manage the calendar but cannot change listings, prices, payouts, KYC or other staff. Removing staff suspends the account and ends its sessions immediately.

## Permissions per route

| Route                                                                                                         | Permission           | Staff           |
| ------------------------------------------------------------------------------------------------------------- | -------------------- | --------------- |
| `GET/PUT /owner/profile`                                                                                      | `kyc:update`         | no              |
| `GET /owner/auditoriums`, `/:id`                                                                              | `booking:view_venue` | assigned venues |
| `POST /owner/auditoriums`                                                                                     | `auditorium:create`  | no              |
| `PATCH/DELETE /owner/auditoriums/:id`, `/submit`, `/amenities`, `/cancellation-policy`, halls, add-ons, media | `auditorium:update`  | no              |
| pricing rules, `PATCH /owner/addons/:id`                                                                      | `pricing:update`     | no              |
| `GET /owner/halls/:id/calendar`, blocks                                                                       | `calendar:manage`    | assigned venues |
| `/owner/staff`                                                                                                | `staff:manage`       | no              |

Every route loads resources through `ScopedResources`, so another owner's resources return 404. `test/integration/owners/owner-listings.test.ts` checks 22 routes this way.
