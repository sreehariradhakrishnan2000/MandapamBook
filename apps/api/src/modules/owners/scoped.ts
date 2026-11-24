import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import {
  addons,
  auditoriums,
  availabilityBlocks,
  halls,
  media,
  offlineBookings,
  pricingRules,
} from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { currentUser } from '../rbac/authenticate.js';
import {
  type OwnerScope,
  auditoriumScopeCondition,
  resolveOwnerScope,
} from '../rbac/owner-scope.js';

/**
 * Loaders for owner-side resources. Each one joins up to `auditoriums` and applies the
 * caller's scope in the same query, so a resource that exists but belongs to someone
 * else is indistinguishable from one that doesn't exist (404). Routes must load through
 * these and never query by id alone.
 */
export class ScopedResources {
  constructor(private readonly db: Db) {}

  scope(req: Request): Promise<OwnerScope> {
    return resolveOwnerScope(this.db, currentUser(req));
  }

  async auditorium(scope: OwnerScope, rawId: unknown) {
    const id = parseId(rawId);
    const [row] = await this.db
      .select()
      .from(auditoriums)
      .where(and(eq(auditoriums.id, id), auditoriumScopeCondition(scope)));
    if (!row) throw errors.notFound();
    return row;
  }

  async hall(scope: OwnerScope, rawId: unknown) {
    const id = parseId(rawId);
    const [row] = await this.db
      .select({ hall: halls, auditoriumStatus: auditoriums.status })
      .from(halls)
      .innerJoin(auditoriums, eq(auditoriums.id, halls.auditoriumId))
      .where(and(eq(halls.id, id), auditoriumScopeCondition(scope)));
    if (!row) throw errors.notFound();
    return row.hall;
  }

  async addon(scope: OwnerScope, rawId: unknown) {
    const id = parseId(rawId);
    const [row] = await this.db
      .select({ addon: addons })
      .from(addons)
      .innerJoin(auditoriums, eq(auditoriums.id, addons.auditoriumId))
      .where(and(eq(addons.id, id), auditoriumScopeCondition(scope)));
    if (!row) throw errors.notFound();
    return row.addon;
  }

  async media(scope: OwnerScope, rawId: unknown) {
    const id = parseId(rawId);
    const [row] = await this.db
      .select({ media })
      .from(media)
      .innerJoin(auditoriums, eq(auditoriums.id, media.auditoriumId))
      .where(and(eq(media.id, id), auditoriumScopeCondition(scope)));
    if (!row) throw errors.notFound();
    return row.media;
  }

  async pricingRule(scope: OwnerScope, rawId: unknown) {
    const id = parseId(rawId);
    const [row] = await this.db
      .select({ rule: pricingRules })
      .from(pricingRules)
      .innerJoin(halls, eq(halls.id, pricingRules.hallId))
      .innerJoin(auditoriums, eq(auditoriums.id, halls.auditoriumId))
      .where(and(eq(pricingRules.id, id), auditoriumScopeCondition(scope)));
    if (!row) throw errors.notFound();
    return row.rule;
  }

  async block(scope: OwnerScope, rawId: unknown) {
    const id = parseId(rawId);
    const [row] = await this.db
      .select({ block: availabilityBlocks })
      .from(availabilityBlocks)
      .innerJoin(halls, eq(halls.id, availabilityBlocks.hallId))
      .innerJoin(auditoriums, eq(auditoriums.id, halls.auditoriumId))
      .where(and(eq(availabilityBlocks.id, id), auditoriumScopeCondition(scope)));
    if (!row) throw errors.notFound();
    return row.block;
  }

  async offlineBooking(scope: OwnerScope, rawId: unknown) {
    const id = parseId(rawId);
    const [row] = await this.db
      .select({ booking: offlineBookings })
      .from(offlineBookings)
      .innerJoin(auditoriums, eq(auditoriums.id, offlineBookings.auditoriumId))
      .where(and(eq(offlineBookings.id, id), auditoriumScopeCondition(scope)));
    if (!row) throw errors.notFound();
    return row.booking;
  }
}

/** Malformed ids are reported as not found, never as a validation error that confirms the route. */
export function parseId(raw: unknown): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw errors.notFound();
  return parsed.data;
}

/** Owners own everything in scope; staff may only touch what their permissions allow. */
export function requireOwner(scope: OwnerScope): void {
  if (scope.isStaff) throw errors.forbidden();
}
