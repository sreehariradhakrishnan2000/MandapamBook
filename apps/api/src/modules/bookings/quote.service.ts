import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { QuoteView, quoteRequestSchema } from '@mandapambook/shared';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import {
  type PriceSnapshot,
  addons,
  auditoriums,
  bookings,
  cancellationPolicies,
  cities,
  hallOccupancy,
  halls,
  muhurthamDates,
  pricingRules,
} from '../../db/schema/index.js';
import { HttpError, errors } from '../../http/errors.js';
import { todayInIst } from '../../lib/time.js';
import type { SettingsService } from '../settings/settings.service.js';
import { daysBetween } from './cancellation.js';
import { type Slot, quote, resolvePriceRule } from './pricing.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type QuoteRequestInput = z.output<typeof quoteRequestSchema>;

/** Bookings can be made up to ~18 months ahead. */
export const MAX_DAYS_AHEAD = 540;

const OVERLAPS: Record<Slot, Slot[]> = {
  MORNING: ['MORNING', 'FULL_DAY'],
  EVENING: ['EVENING', 'FULL_DAY'],
  FULL_DAY: ['MORNING', 'EVENING', 'FULL_DAY'],
};

export interface QuoteResult {
  view: QuoteView;
  snapshot: PriceSnapshot;
  auditoriumId: string;
  instantBook: boolean;
}

/** Loads everything a price depends on and runs the pure pricing functions. */
export class QuoteService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async quote(req: QuoteRequestInput, tx?: Tx): Promise<QuoteResult> {
    const db = tx ?? this.db;
    const today = todayInIst();
    if (req.eventDate < today)
      throw errors.badRequest('DATE_IN_PAST', 'Choose today or a future date');
    if (daysBetween(today, req.eventDate) > MAX_DAYS_AHEAD) {
      throw errors.badRequest('DATE_TOO_FAR', 'Bookings open up to 18 months ahead');
    }

    const [ctx] = await db
      .select({ hall: halls, auditorium: auditoriums, state: cities.state })
      .from(halls)
      .innerJoin(auditoriums, eq(auditoriums.id, halls.auditoriumId))
      .innerJoin(cities, eq(cities.id, auditoriums.cityId))
      .where(
        and(eq(halls.id, req.hallId), eq(halls.isActive, true), eq(auditoriums.status, 'APPROVED')),
      );
    // Unapproved venues and inactive halls are invisible to customers.
    if (!ctx) throw errors.notFound('Hall not found');
    if (req.guestCount > ctx.hall.seatingCapacity) {
      throw errors.badRequest(
        'TOO_MANY_GUESTS',
        `This hall seats up to ${ctx.hall.seatingCapacity} guests`,
      );
    }

    const [rules, muhurtham, policy, settings, addonRows] = await Promise.all([
      db.select().from(pricingRules).where(eq(pricingRules.hallId, ctx.hall.id)),
      db
        .select({ date: muhurthamDates.date })
        .from(muhurthamDates)
        .where(
          and(
            eq(muhurthamDates.date, req.eventDate),
            or(isNull(muhurthamDates.state), eq(muhurthamDates.state, ctx.state)),
          ),
        ),
      db
        .select()
        .from(cancellationPolicies)
        .where(eq(cancellationPolicies.auditoriumId, ctx.auditorium.id)),
      this.settings.get(tx),
      req.addons.length
        ? db
            .select()
            .from(addons)
            .where(
              and(
                eq(addons.auditoriumId, ctx.auditorium.id),
                inArray(
                  addons.id,
                  req.addons.map((a) => a.addonId),
                ),
              ),
            )
        : Promise.resolve([]),
    ]);

    const rule = resolvePriceRule(
      rules,
      req.eventDate,
      req.slot,
      new Set(muhurtham.map((m) => m.date)),
    );
    if (!rule) throw new HttpError(422, 'NO_PRICE', 'This hall is not available for that slot');

    const byId = new Map(addonRows.map((a) => [a.id, a]));
    const lines = req.addons.map((sel) => {
      const a = byId.get(sel.addonId);
      if (!a || !a.isActive)
        throw errors.badRequest('INVALID_ADDON', 'One of the add-ons is not available');
      if (sel.quantity > a.maxQuantity)
        throw errors.badRequest('INVALID_ADDON', `${a.name}: at most ${a.maxQuantity}`);
      return {
        addonId: a.id,
        code: a.code,
        name: a.name,
        quantity: sel.quantity,
        unitPaise: a.pricePaise,
      };
    });

    const q = quote({
      basePaise: rule.pricePaise,
      addons: lines,
      gstBasisPoints: settings.gst_bps,
      platformFeePaise: settings.platform_fee_paise,
      advancePercent: ctx.auditorium.advancePercent,
    });

    const view: QuoteView = {
      hallId: ctx.hall.id,
      eventDate: req.eventDate,
      slot: req.slot,
      ruleKind: rule.kind,
      basePaise: q.basePaise,
      addons: q.addons.map(({ addonId, code, name, quantity, unitPaise, totalPaise }) => ({
        addonId,
        code,
        name,
        quantity,
        unitPaise,
        totalPaise,
      })),
      addonsPaise: q.addonsPaise,
      venueChargesPaise: q.venueChargesPaise,
      gstPaise: q.gstPaise,
      gstBasisPoints: settings.gst_bps,
      platformFeePaise: q.platformFeePaise,
      totalPaise: q.totalPaise,
      payNowPaise: q.payNowPaise,
      payLaterPaise: q.payLaterPaise,
      advancePercent: ctx.auditorium.advancePercent,
      available: await this.isSlotFree(ctx.hall.id, req.eventDate, req.slot, tx),
    };
    const snapshot: PriceSnapshot = {
      baseRuleId: rule.id,
      basePaise: q.basePaise,
      addons: q.addons.map(({ addonId, code, quantity, unitPaise, totalPaise }) => ({
        addonId,
        code,
        quantity,
        unitPaise,
        totalPaise,
      })),
      gstBasisPoints: settings.gst_bps,
      platformFeePaise: q.platformFeePaise,
      cancellationTiers: policy[0]?.tiers ?? [{ minDaysBefore: 0, refundPercent: 0 }],
      ruleKind: rule.kind,
      advancePercent: ctx.auditorium.advancePercent,
      venueAdvancePaise: q.venueAdvancePaise,
    };
    return {
      view,
      snapshot,
      auditoriumId: ctx.auditorium.id,
      instantBook: ctx.auditorium.instantBook,
    };
  }

  /**
   * Whether a slot is free right now. Holds whose time ran out count as free even before
   * the sweeper marks them expired; the database constraint still has the final say.
   */
  async isSlotFree(hallId: string, eventDate: string, slot: Slot, tx?: Tx): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .select({
        slot: hallOccupancy.slot,
        status: bookings.status,
        holdExpiresAt: bookings.holdExpiresAt,
      })
      .from(hallOccupancy)
      .leftJoin(bookings, eq(bookings.id, hallOccupancy.bookingId))
      .where(
        and(
          eq(hallOccupancy.hallId, hallId),
          eq(hallOccupancy.eventDate, eventDate),
          eq(hallOccupancy.active, true),
        ),
      );
    const now = Date.now();
    return !rows.some(
      (r) =>
        OVERLAPS[slot].includes(r.slot) &&
        !(
          (r.status === 'HELD' || r.status === 'PENDING_PAYMENT') &&
          r.holdExpiresAt &&
          r.holdExpiresAt.getTime() <= now
        ),
    );
  }
}
