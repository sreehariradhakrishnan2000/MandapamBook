import type { Request } from 'express';
import type { Logger } from 'pino';
import type { Role } from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import { auditLogs } from '../../db/schema/index.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Stable action names, so the audit viewer can filter on them. */
export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.google_linked'
  | 'auth.lockout'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.refresh_reuse'
  | 'auth.session_revoked'
  | 'auth.email_verified'
  | 'auth.verification_email_resent'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.phone_verified'
  | 'user.role_changed'
  | 'user.status_changed'
  | 'user.email_marked_verified'
  | 'owner.kyc_updated'
  | 'listing.created'
  | 'listing.updated'
  | 'listing.submitted'
  | 'listing.deleted'
  | 'pricing.changed'
  | 'calendar.blocked'
  | 'calendar.unblocked'
  | 'offline_booking.created'
  | 'offline_booking.updated'
  | 'offline_booking.cancelled'
  | 'media.rejected'
  | 'staff.invited'
  | 'staff.updated'
  | 'staff.removed'
  | 'listing.approved'
  | 'listing.rejected'
  | 'listing.suspended'
  | 'listing.reinstated'
  | 'owner.kyc_verified'
  | 'owner.kyc_rejected'
  | 'owner.kyc_revealed'
  | 'masterdata.changed'
  | 'settings.changed'
  | 'booking.held'
  | 'booking.cancelled'
  | 'report.exported'
  | 'payout.marked_paid'
  | 'review.replied'
  | 'review.moderated'
  | 'booking.accepted'
  | 'booking.balance_received'
  | 'booking.declined'
  | 'payment.order_created'
  | 'payment.verify_failed'
  | 'payment.webhook_rejected'
  | 'payment.amount_mismatch'
  | 'payment.captured'
  | 'payment.refunded';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  actorId?: string | null;
  actorRole?: Role | null;
  before?: unknown;
  after?: unknown;
  success?: boolean;
}

export interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export function auditContext(req: Request): AuditContext {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
    correlationId: String(req.id),
  };
}

export class AuditService {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  /**
   * Writes an audit row. Pass `tx` to make the entry part of the business transaction;
   * otherwise a failure to audit is logged and never breaks the user's request.
   */
  async record(entry: AuditEntry, ctx: AuditContext, tx?: Tx): Promise<void> {
    const row = {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      success: entry.success ?? true,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      correlationId: ctx.correlationId ?? null,
    };
    if (tx) {
      await tx.insert(auditLogs).values(row);
      return;
    }
    try {
      await this.db.insert(auditLogs).values(row);
    } catch (err) {
      this.logger.error({ err, action: entry.action }, 'failed to write audit log');
    }
  }
}
