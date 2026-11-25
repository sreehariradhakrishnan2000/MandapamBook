import { Router } from 'express';
import { and, asc, count, eq, ilike, or } from 'drizzle-orm';
import { adminOwnerQuerySchema, kycDecisionSchema, kycRevealSchema } from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import { ownerProfiles, users } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import type { FieldCrypto } from '../../lib/field-crypto.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import { renderEmail } from '../notifications/email-layout.js';
import type { EmailSender } from '../notifications/senders.js';
import { profileView } from '../owners/profile.routes.js';
import { parseId } from '../owners/scoped.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import { escapeLike } from './listings-review.routes.js';

export function kycReviewRouter(deps: {
  db: Db;
  audit: AuditService;
  crypto: FieldCrypto;
  email: EmailSender;
  appBaseUrl: string;
}): Router {
  const { db, audit, crypto, email, appBaseUrl } = deps;
  const r = Router();

  const load = async (ownerId: string) => {
    const [row] = await db
      .select({ profile: ownerProfiles, email: users.email, fullName: users.fullName })
      .from(ownerProfiles)
      .innerJoin(users, eq(users.id, ownerProfiles.userId))
      .where(eq(ownerProfiles.userId, ownerId));
    if (!row) throw errors.notFound();
    return row;
  };

  /** Owners waiting for (or past) KYC review. Only masked values are listed. */
  r.get('/owners', requirePermission('kyc:review'), async (req, res) => {
    const q = adminOwnerQuerySchema.parse(req.query);
    const where = and(
      q.kycStatus ? eq(ownerProfiles.kycStatus, q.kycStatus) : undefined,
      q.q
        ? or(
            ilike(users.email, `%${escapeLike(q.q)}%`),
            ilike(ownerProfiles.businessName, `%${escapeLike(q.q)}%`),
          )
        : undefined,
    );
    const rows = await db
      .select({ profile: ownerProfiles, email: users.email, fullName: users.fullName })
      .from(ownerProfiles)
      .innerJoin(users, eq(users.id, ownerProfiles.userId))
      .where(where)
      .orderBy(asc(ownerProfiles.updatedAt))
      .limit(q.limit)
      .offset(q.offset);
    const [{ total } = { total: 0 }] = await db
      .select({ total: count() })
      .from(ownerProfiles)
      .innerJoin(users, eq(users.id, ownerProfiles.userId))
      .where(where);
    res.set('Cache-Control', 'no-store').json({
      items: rows.map((r) => ({
        ownerId: r.profile.userId,
        email: r.email,
        fullName: r.fullName,
        updatedAt: r.profile.updatedAt,
        ...profileView(r.profile, crypto),
      })),
      total,
    });
  });

  /**
   * Full PAN and account number for verification against documents. Requires a stated
   * purpose, and every reveal is audited with who, when, from where and why.
   */
  r.post('/owners/:id/kyc/reveal', requirePermission('kyc:review'), async (req, res) => {
    const me = currentUser(req);
    const ownerId = parseId(req.params['id']);
    const { purpose } = kycRevealSchema.parse(req.body);
    const { profile } = await load(ownerId);
    if (!profile.panEnc || !profile.bankAccountEnc) {
      throw errors.conflict('KYC_NOT_SUBMITTED', 'This owner has not submitted KYC details');
    }
    await audit.record(
      {
        action: 'owner.kyc_revealed',
        entityType: 'owner_profile',
        entityId: ownerId,
        actorId: me.userId,
        actorRole: me.role,
        after: { purpose },
      },
      auditContext(req),
    );
    res.set('Cache-Control', 'no-store').json({
      pan: crypto.decrypt(profile.panEnc, `owner:${ownerId}:pan`),
      bankAccountNumber: crypto.decrypt(profile.bankAccountEnc, `owner:${ownerId}:bank_account`),
      ifsc: profile.ifscEnc ? crypto.decrypt(profile.ifscEnc, `owner:${ownerId}:ifsc`) : null,
      gstin: profile.gstin,
      bankAccountName: profile.bankAccountName,
    });
  });

  r.post('/owners/:id/kyc/decision', requirePermission('kyc:review'), async (req, res) => {
    const me = currentUser(req);
    const ownerId = parseId(req.params['id']);
    if (ownerId === me.userId) throw errors.forbidden('You cannot review your own KYC');
    const decision = kycDecisionSchema.parse(req.body);
    const owner = await load(ownerId);
    const reason = decision.decision === 'reject' ? decision.reason : null;
    const to = decision.decision === 'verify' ? 'VERIFIED' : 'REJECTED';

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(ownerProfiles)
        .set({
          kycStatus: to,
          kycReviewedBy: me.userId,
          kycReviewedAt: new Date(),
          kycRejectionReason: reason,
        })
        .where(and(eq(ownerProfiles.userId, ownerId), eq(ownerProfiles.kycStatus, 'SUBMITTED')))
        .returning();
      if (!row) {
        throw errors.conflict(
          'INVALID_TRANSITION',
          `Only submitted KYC can be reviewed (currently ${owner.profile.kycStatus.toLowerCase()})`,
        );
      }
      await audit.record(
        {
          action: to === 'VERIFIED' ? 'owner.kyc_verified' : 'owner.kyc_rejected',
          entityType: 'owner_profile',
          entityId: ownerId,
          actorId: me.userId,
          actorRole: me.role,
          before: { kycStatus: 'SUBMITTED' },
          after: { kycStatus: to, reason },
        },
        auditContext(req),
        tx,
      );
      return row;
    });

    await email.send({
      to: owner.email,
      template: 'kyc_decision',
      ...renderEmail(
        to === 'VERIFIED'
          ? {
              subject: 'Your payout details are verified',
              heading: 'Your payout details are verified',
              greetingName: owner.fullName,
              paragraphs: [
                'Your business and payout details are verified. Once your venue is approved, booking advances are paid out to this account.',
              ],
              action: { label: 'Open your dashboard', url: `${appBaseUrl}/owner` },
            }
          : {
              subject: 'Please update your payout details',
              heading: 'Please update your payout details',
              greetingName: owner.fullName,
              paragraphs: ['We could not verify your business and payout details.'],
              details: [{ label: 'Reason', value: reason ?? '' }],
              action: { label: 'Update your details', url: `${appBaseUrl}/owner/profile` },
            },
        appBaseUrl,
      ),
    });
    res.json(profileView(updated, crypto));
  });

  return r;
}
