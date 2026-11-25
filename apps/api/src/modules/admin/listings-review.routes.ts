import { Router } from 'express';
import { and, asc, count, desc, eq, ilike, ne, or } from 'drizzle-orm';
import {
  type ListingDecision,
  adminListingQuerySchema,
  listingDecisionSchema,
} from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import {
  addons,
  amenities,
  auditoriumAmenities,
  auditoriums,
  cancellationPolicies,
  cities,
  halls,
  media,
  ownerProfiles,
  pricingRules,
  users,
} from '../../db/schema/index.js';
import { HttpError, errors } from '../../http/errors.js';
import type { ObjectStorage } from '../../infra/storage.js';
import { type AuditAction, type AuditService, auditContext } from '../audit/audit.service.js';
import { type EmailContent, renderEmail } from '../notifications/email-layout.js';
import type { EmailSender } from '../notifications/senders.js';
import { listingGaps } from '../owners/listings.routes.js';
import { parseId } from '../owners/scoped.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';

type Status = (typeof auditoriums.$inferSelect)['status'];

/** Allowed transitions: anything else is a 409, so two admins can't act on stale state. */
const TRANSITIONS: Record<
  ListingDecision['decision'],
  { from: Status; to: Status; action: AuditAction }
> = {
  approve: { from: 'PENDING_REVIEW', to: 'APPROVED', action: 'listing.approved' },
  reject: { from: 'PENDING_REVIEW', to: 'REJECTED', action: 'listing.rejected' },
  suspend: { from: 'APPROVED', to: 'SUSPENDED', action: 'listing.suspended' },
  reinstate: { from: 'SUSPENDED', to: 'APPROVED', action: 'listing.reinstated' },
};

export function listingsReviewRouter(deps: {
  db: Db;
  audit: AuditService;
  storage: ObjectStorage;
  email: EmailSender;
  appBaseUrl: string;
}): Router {
  const { db, audit, storage, email, appBaseUrl } = deps;
  const r = Router();

  r.get('/listings', requirePermission('listing:review'), async (req, res) => {
    const q = adminListingQuerySchema.parse(req.query);
    const where = and(
      eq(auditoriums.status, q.status),
      q.q
        ? or(
            ilike(auditoriums.name, `%${escapeLike(q.q)}%`),
            ilike(users.email, `%${escapeLike(q.q)}%`),
          )
        : undefined,
    );
    const [items, [{ total } = { total: 0 }]] = await Promise.all([
      db
        .select({
          id: auditoriums.id,
          name: auditoriums.name,
          status: auditoriums.status,
          city: cities.name,
          ownerName: users.fullName,
          ownerEmail: users.email,
          kycStatus: ownerProfiles.kycStatus,
          updatedAt: auditoriums.updatedAt,
        })
        .from(auditoriums)
        .innerJoin(cities, eq(cities.id, auditoriums.cityId))
        .innerJoin(users, eq(users.id, auditoriums.ownerId))
        .innerJoin(ownerProfiles, eq(ownerProfiles.userId, auditoriums.ownerId))
        .where(where)
        // Oldest first, so the queue is worked in submission order.
        .orderBy(
          q.status === 'PENDING_REVIEW' ? asc(auditoriums.updatedAt) : desc(auditoriums.updatedAt),
        )
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ total: count() })
        .from(auditoriums)
        .innerJoin(users, eq(users.id, auditoriums.ownerId))
        .where(where),
    ]);
    res.json({ items, total, limit: q.limit, offset: q.offset });
  });

  r.get('/listings/:id', requirePermission('listing:review'), async (req, res) => {
    const id = parseId(req.params['id']);
    const [venue] = await db
      .select({
        auditorium: auditoriums,
        city: cities.name,
        owner: { id: users.id, fullName: users.fullName, email: users.email, phone: users.phone },
        kycStatus: ownerProfiles.kycStatus,
        businessName: ownerProfiles.businessName,
      })
      .from(auditoriums)
      .innerJoin(cities, eq(cities.id, auditoriums.cityId))
      .innerJoin(users, eq(users.id, auditoriums.ownerId))
      .innerJoin(ownerProfiles, eq(ownerProfiles.userId, auditoriums.ownerId))
      .where(eq(auditoriums.id, id));
    if (!venue) throw errors.notFound();

    const [hallRows, rules, amenityRows, addonRows, policy, photos] = await Promise.all([
      db.select().from(halls).where(eq(halls.auditoriumId, id)).orderBy(asc(halls.name)),
      db
        .select({
          hallId: pricingRules.hallId,
          slot: pricingRules.slot,
          kind: pricingRules.kind,
          pricePaise: pricingRules.pricePaise,
          validFrom: pricingRules.validFrom,
          validTo: pricingRules.validTo,
        })
        .from(pricingRules)
        .innerJoin(halls, eq(halls.id, pricingRules.hallId))
        .where(eq(halls.auditoriumId, id)),
      db
        .select({ code: amenities.code, name: amenities.name })
        .from(auditoriumAmenities)
        .innerJoin(amenities, eq(amenities.id, auditoriumAmenities.amenityId))
        .where(eq(auditoriumAmenities.auditoriumId, id)),
      db.select().from(addons).where(eq(addons.auditoriumId, id)),
      db.select().from(cancellationPolicies).where(eq(cancellationPolicies.auditoriumId, id)),
      db
        .select()
        .from(media)
        .where(and(eq(media.auditoriumId, id), ne(media.status, 'REJECTED')))
        .orderBy(asc(media.sortOrder)),
    ]);
    res.set('Cache-Control', 'private, no-store').json({
      ...venue.auditorium,
      city: venue.city,
      owner: { ...venue.owner, businessName: venue.businessName, kycStatus: venue.kycStatus },
      halls: hallRows.map((h) => ({ ...h, pricingRules: rules.filter((r) => r.hallId === h.id) })),
      amenities: amenityRows,
      addons: addonRows,
      cancellationPolicy: policy[0] ?? null,
      photos: await Promise.all(
        photos.map(async (p) => ({
          id: p.id,
          status: p.status,
          altText: p.altText,
          url: p.status === 'READY' ? await storage.createDownloadUrl(p.storageKey, 300) : null,
        })),
      ),
      gaps: await listingGaps(db, id, venue.auditorium.ownerId),
    });
  });

  r.post('/listings/:id/decision', requirePermission('listing:review'), async (req, res) => {
    const me = currentUser(req);
    const id = parseId(req.params['id']);
    const decision = listingDecisionSchema.parse(req.body);
    const t = TRANSITIONS[decision.decision];
    const reason = 'reason' in decision ? decision.reason : null;

    const [current] = await db
      .select({
        status: auditoriums.status,
        ownerId: auditoriums.ownerId,
        name: auditoriums.name,
        kycStatus: ownerProfiles.kycStatus,
        ownerEmail: users.email,
      })
      .from(auditoriums)
      .innerJoin(ownerProfiles, eq(ownerProfiles.userId, auditoriums.ownerId))
      .innerJoin(users, eq(users.id, auditoriums.ownerId))
      .where(eq(auditoriums.id, id));
    if (!current) throw errors.notFound();
    if (current.status !== t.from) {
      throw errors.conflict(
        'INVALID_TRANSITION',
        `Cannot ${decision.decision} a listing that is ${current.status.toLowerCase().replace('_', ' ')}`,
      );
    }
    if (decision.decision === 'approve' || decision.decision === 'reinstate') {
      const blockers = await listingGaps(db, id, current.ownerId);
      if (current.kycStatus !== 'VERIFIED') blockers.unshift("Verify the owner's KYC first");
      if (blockers.length)
        throw new HttpError(422, 'NOT_APPROVABLE', 'This listing cannot go live yet', blockers);
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(auditoriums)
        .set({
          status: t.to,
          rejectionReason: reason,
          reviewedBy: me.userId,
          reviewedAt: new Date(),
        })
        // Conditional on the status we checked: a concurrent decision makes this a no-op.
        .where(and(eq(auditoriums.id, id), eq(auditoriums.status, t.from)))
        .returning({
          id: auditoriums.id,
          status: auditoriums.status,
          rejectionReason: auditoriums.rejectionReason,
        });
      if (!row)
        throw errors.conflict(
          'INVALID_TRANSITION',
          'Someone else just reviewed this listing. Reload and try again.',
        );
      await audit.record(
        {
          action: t.action,
          entityType: 'auditorium',
          entityId: id,
          actorId: me.userId,
          actorRole: me.role,
          before: { status: t.from },
          after: { status: t.to, reason },
        },
        auditContext(req),
        tx,
      );
      return row;
    });

    const venueLink = { label: 'Open your venue', url: `${appBaseUrl}/owner/venues/${id}` };
    const why = reason ? [{ label: 'Reason', value: reason }] : undefined;
    const content: Record<ListingDecision['decision'], Omit<EmailContent, 'subject'>> = {
      approve: {
        heading: 'Your venue is live',
        paragraphs: [
          `Good news: "${current.name}" is now live on MandapamBook, and families can find and book it.`,
        ],
        action: venueLink,
      },
      reject: {
        heading: 'Your venue needs a few changes',
        paragraphs: [
          `"${current.name}" needs changes before it can go live. Update it and submit it again.`,
        ],
        ...(why ? { details: why } : {}),
        action: { label: 'Update your venue', url: venueLink.url },
      },
      suspend: {
        heading: 'Your venue has been taken off MandapamBook',
        paragraphs: [
          `"${current.name}" is no longer shown to customers. Contact support to resolve this.`,
        ],
        ...(why ? { details: why } : {}),
        action: venueLink,
      },
      reinstate: {
        heading: 'Your venue is live again',
        paragraphs: [`"${current.name}" is live on MandapamBook again.`],
        action: venueLink,
      },
    };
    await email.send({
      to: current.ownerEmail,
      template: 'listing_decision',
      ...renderEmail(
        {
          subject: `Your listing "${current.name}": ${t.to === 'APPROVED' ? 'approved' : t.to.toLowerCase()}`,
          ...content[decision.decision],
        },
        appBaseUrl,
      ),
    });
    res.json(updated);
  });

  return r;
}

/** Escapes LIKE wildcards so search input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
