import { Router } from 'express';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { DEFAULT_RULE_PRIORITY, blockSchema, pricingRuleSchema } from '@mandapambook/shared';
import { z } from 'zod';
import { type Db, PG_ERROR, pgErrorCode } from '../../db/client.js';
import { availabilityBlocks, hallOccupancy, pricingRules } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { todayInIst } from '../../lib/time.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import { type ScopedResources, requireOwner } from './scoped.js';

const rangeSchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
});

export function calendarRouter(deps: {
  db: Db;
  scoped: ScopedResources;
  audit: AuditService;
}): Router {
  const { db, scoped, audit } = deps;
  const r = Router();

  // ------------------------------------------------------------ pricing (owners only)

  r.get('/halls/:hallId/pricing-rules', requirePermission('pricing:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    const hall = await scoped.hall(scope, req.params['hallId']);
    const rules = await db
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.hallId, hall.id))
      .orderBy(asc(pricingRules.slot), asc(pricingRules.priority));
    res.json({ items: rules });
  });

  r.post('/halls/:hallId/pricing-rules', requirePermission('pricing:update'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const hall = await scoped.hall(scope, req.params['hallId']);
    const input = pricingRuleSchema.parse(req.body);

    // One standard price per slot: replacing it is an update, not a second rule.
    if (input.kind === 'BASE' || input.kind === 'WEEKEND' || input.kind === 'MUHURTHAM') {
      await db
        .delete(pricingRules)
        .where(
          and(
            eq(pricingRules.hallId, hall.id),
            eq(pricingRules.slot, input.slot),
            eq(pricingRules.kind, input.kind),
          ),
        );
    }
    const [rule] = await db
      .insert(pricingRules)
      .values({
        hallId: hall.id,
        slot: input.slot,
        kind: input.kind,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        pricePaise: input.pricePaise,
        priority: input.priority ?? DEFAULT_RULE_PRIORITY[input.kind],
        label: input.label ?? null,
      })
      .returning();
    await audit.record(
      {
        action: 'pricing.changed',
        entityType: 'hall',
        entityId: hall.id,
        actorId: me.userId,
        actorRole: me.role,
        after: {
          ruleId: rule?.id,
          slot: input.slot,
          kind: input.kind,
          pricePaise: input.pricePaise,
        },
      },
      auditContext(req),
    );
    res.status(201).json(rule);
  });

  r.delete('/pricing-rules/:ruleId', requirePermission('pricing:update'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const rule = await scoped.pricingRule(scope, req.params['ruleId']);
    await db.delete(pricingRules).where(eq(pricingRules.id, rule.id));
    await audit.record(
      {
        action: 'pricing.changed',
        entityType: 'hall',
        entityId: rule.hallId,
        actorId: me.userId,
        actorRole: me.role,
        before: { ruleId: rule.id, slot: rule.slot, kind: rule.kind, pricePaise: rule.pricePaise },
      },
      auditContext(req),
    );
    res.status(204).end();
  });

  // ------------------------------------------------------------ calendar (owners and staff)

  /** Occupied slots (bookings and blocks) for a hall in a date range, max 366 days. */
  r.get('/halls/:hallId/calendar', requirePermission('calendar:manage'), async (req, res) => {
    const scope = await scoped.scope(req);
    const hall = await scoped.hall(scope, req.params['hallId']);
    const { from, to } = rangeSchema.parse(req.query);
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days < 0 || days > 366)
      throw errors.badRequest('BAD_RANGE', 'Choose a range of up to one year');
    const rows = await db
      .select({
        eventDate: hallOccupancy.eventDate,
        slot: hallOccupancy.slot,
        bookingId: hallOccupancy.bookingId,
        blockId: hallOccupancy.blockId,
        reason: availabilityBlocks.reason,
      })
      .from(hallOccupancy)
      .leftJoin(availabilityBlocks, eq(availabilityBlocks.id, hallOccupancy.blockId))
      .where(
        and(
          eq(hallOccupancy.hallId, hall.id),
          eq(hallOccupancy.active, true),
          gte(hallOccupancy.eventDate, from),
          lte(hallOccupancy.eventDate, to),
        ),
      )
      .orderBy(asc(hallOccupancy.eventDate));
    res.json({
      items: rows.map((r) => ({
        eventDate: r.eventDate,
        slot: r.slot,
        kind: r.blockId ? 'BLOCK' : 'BOOKING',
        blockId: r.blockId,
        reason: r.reason,
      })),
    });
  });

  r.post('/halls/:hallId/blocks', requirePermission('calendar:manage'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    const hall = await scoped.hall(scope, req.params['hallId']);
    const input = blockSchema.parse(req.body);
    if (input.eventDate < todayInIst()) {
      throw errors.badRequest('DATE_IN_PAST', 'You can only block today or future dates');
    }
    try {
      const [block] = await db
        .insert(availabilityBlocks)
        .values({
          hallId: hall.id,
          eventDate: input.eventDate,
          slot: input.slot,
          reason: input.reason ?? null,
          createdBy: me.userId,
        })
        .returning();
      await audit.record(
        {
          action: 'calendar.blocked',
          entityType: 'hall',
          entityId: hall.id,
          actorId: me.userId,
          actorRole: me.role,
          after: { blockId: block?.id, ...input },
        },
        auditContext(req),
      );
      res.status(201).json(block);
    } catch (err) {
      if (pgErrorCode(err) === PG_ERROR.EXCLUSION_VIOLATION) {
        throw errors.conflict('SLOT_UNAVAILABLE', 'That slot is already booked or blocked');
      }
      throw err;
    }
  });

  r.delete('/blocks/:blockId', requirePermission('calendar:manage'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    const block = await scoped.block(scope, req.params['blockId']);
    await db.delete(availabilityBlocks).where(eq(availabilityBlocks.id, block.id));
    await audit.record(
      {
        action: 'calendar.unblocked',
        entityType: 'hall',
        entityId: block.hallId,
        actorId: me.userId,
        actorRole: me.role,
        before: { blockId: block.id, eventDate: block.eventDate, slot: block.slot },
      },
      auditContext(req),
    );
    res.status(204).end();
  });

  return r;
}
