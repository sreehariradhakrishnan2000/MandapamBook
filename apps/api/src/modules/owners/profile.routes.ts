import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { type OwnerProfileView, ownerProfileSchema } from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import { ownerProfiles } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { type FieldCrypto, maskTail } from '../../lib/field-crypto.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';

type ProfileRow = typeof ownerProfiles.$inferSelect;

/** Associated data for each encrypted column, binding ciphertext to owner + column. */
const ctx = (ownerId: string, column: 'pan' | 'bank_account' | 'ifsc') =>
  `owner:${ownerId}:${column}`;

export function profileView(row: ProfileRow, crypto: FieldCrypto): OwnerProfileView {
  return {
    businessName: row.businessName,
    panMasked: row.panLast4 ? `XXXXXX${row.panLast4}` : null,
    gstin: row.gstin,
    bankAccountName: row.bankAccountName,
    bankAccountMasked: row.bankAccountLast4 ? `XXXXXXXX${row.bankAccountLast4}` : null,
    // IFSC identifies a bank branch (public information), so it is shown in full.
    ifsc: row.ifscEnc ? crypto.decrypt(row.ifscEnc, ctx(row.userId, 'ifsc')) : null,
    kycStatus: row.kycStatus,
    kycRejectionReason: row.kycRejectionReason,
  };
}

export function profileRouter(deps: { db: Db; crypto: FieldCrypto; audit: AuditService }): Router {
  const { db, crypto, audit } = deps;
  const r = Router();

  const load = async (ownerId: string): Promise<ProfileRow> => {
    const [row] = await db.select().from(ownerProfiles).where(eq(ownerProfiles.userId, ownerId));
    if (!row) throw errors.notFound('Owner profile not found');
    return row;
  };

  r.get('/profile', requirePermission('kyc:update'), async (req, res) => {
    const row = await load(currentUser(req).userId);
    res.set('Cache-Control', 'no-store').json(profileView(row, crypto));
  });

  /**
   * Saves business and payout details. Full PAN and account numbers are encrypted and
   * never returned; the audit log records only masked values. Changing payout details
   * sends verification back to SUBMITTED for admin review.
   */
  r.put('/profile', requirePermission('kyc:update'), async (req, res) => {
    const me = currentUser(req);
    const input = ownerProfileSchema.parse(req.body);
    const before = await load(me.userId);

    const [after] = await db
      .update(ownerProfiles)
      .set({
        businessName: input.businessName,
        panEnc: crypto.encrypt(input.pan, ctx(me.userId, 'pan')),
        panLast4: input.pan.slice(-4),
        gstin: input.gstin ?? null,
        bankAccountName: input.bankAccountName,
        bankAccountEnc: crypto.encrypt(input.bankAccountNumber, ctx(me.userId, 'bank_account')),
        bankAccountLast4: input.bankAccountNumber.slice(-4),
        ifscEnc: crypto.encrypt(input.ifsc, ctx(me.userId, 'ifsc')),
        kycStatus: 'SUBMITTED',
        kycReviewedBy: null,
        kycReviewedAt: null,
        kycRejectionReason: null,
      })
      .where(eq(ownerProfiles.userId, me.userId))
      .returning();
    if (!after) throw errors.notFound('Owner profile not found');

    await audit.record(
      {
        action: 'owner.kyc_updated',
        entityType: 'owner_profile',
        entityId: me.userId,
        actorId: me.userId,
        actorRole: me.role,
        before: {
          businessName: before.businessName,
          pan: before.panLast4 ? `XXXXXX${before.panLast4}` : null,
          bankAccount: before.bankAccountLast4 ? `XXXXXXXX${before.bankAccountLast4}` : null,
          kycStatus: before.kycStatus,
        },
        after: {
          businessName: after.businessName,
          pan: maskTail(input.pan),
          bankAccount: maskTail(input.bankAccountNumber),
          gstin: after.gstin,
          kycStatus: after.kycStatus,
        },
      },
      auditContext(req),
    );
    res.json(profileView(after, crypto));
  });

  return r;
}
