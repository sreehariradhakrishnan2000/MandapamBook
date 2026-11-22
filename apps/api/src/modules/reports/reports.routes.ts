import { Router, type RequestHandler } from 'express';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import {
  type OwnerEarnings,
  type ReportQuery,
  type ReportSummary,
  markPayoutPaidSchema,
  payoutQuerySchema,
  reportQuerySchema,
} from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import { auditoriums, bookings, cities, payouts } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import { todayInIst } from '../../lib/time.js';
import type { RateLimiters } from '../../http/middleware/rate-limit.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import { type ScopedResources, parseId, requireOwner } from '../owners/scoped.js';

/** Bookings that represent real business (paid at some point). */
const PAID_STATUSES = sql`('AWAITING_OWNER','CONFIRMED','COMPLETED','CANCELLED','REFUNDED')`;
const LIVE_STATUSES = sql`('AWAITING_OWNER','CONFIRMED','COMPLETED')`;

/** Defaults the window to the current Indian financial year (1 April to 31 March). */
export function reportWindow(q: ReportQuery, today = todayInIst()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return { from: q.from ?? `${start}-04-01`, to: q.to ?? `${start + 1}-03-31` };
}

/**
 * Neutralises spreadsheet formula injection: a cell starting with = + - @ (or a tab/CR)
 * is prefixed with a quote, then the value is CSV-quoted.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replaceAll('"', '""')}"` : s;
}

const paise = (v: unknown) => Number(v ?? 0);
/** Byte-order mark so Excel opens the UTF-8 CSV with Malayalam, Tamil and Hindi names intact. */
const UTF8_BOM = String.fromCharCode(0xfeff);

export function reportsRouter(deps: {
  db: Db;
  authenticate: RequestHandler;
  scoped: ScopedResources;
  audit: AuditService;
  limiters: RateLimiters;
}): Router {
  const { db, authenticate, scoped, audit, limiters } = deps;
  const r = Router();

  /** Owner earnings for their venues in a window, from payouts and bookings. */
  r.get('/owner/earnings', authenticate, requirePermission('payout:view'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const { from, to } = reportWindow(reportQuerySchema.parse(req.query));
    const inWindow = sql`b.event_date BETWEEN ${from}::date AND ${to}::date`;
    const [totals] = (
      await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE b.status IN ${LIVE_STATUSES})::int AS bookings,
          COALESCE(SUM(b.subtotal_paise + b.addons_paise) FILTER (WHERE b.status IN ${LIVE_STATUSES}), 0) AS value,
          COALESCE(SUM(po.gross_paise), 0) AS collected,
          COALESCE(SUM(po.commission_paise), 0) AS commission,
          COALESCE(SUM(po.net_paise), 0) AS net,
          COALESCE(SUM(po.net_paise) FILTER (WHERE po.status = 'PAID'), 0) AS paid
        FROM bookings b
        JOIN auditoriums a ON a.id = b.auditorium_id
        LEFT JOIN payouts po ON po.booking_id = b.id
        WHERE a.owner_id = ${scope.ownerId} AND b.status IN ${PAID_STATUSES} AND ${inWindow}`)
    ).rows as Record<string, unknown>[];
    const list = await db
      .select({
        id: payouts.id,
        bookingId: payouts.bookingId,
        refCode: bookings.refCode,
        eventDate: bookings.eventDate,
        venueName: auditoriums.name,
        grossPaise: payouts.grossPaise,
        commissionPaise: payouts.commissionPaise,
        netPaise: payouts.netPaise,
        status: payouts.status,
        reference: payouts.reference,
        paidAt: payouts.paidAt,
      })
      .from(payouts)
      .innerJoin(bookings, eq(bookings.id, payouts.bookingId))
      .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
      .where(
        and(
          eq(payouts.ownerId, scope.ownerId),
          gte(bookings.eventDate, from),
          lte(bookings.eventDate, to),
        ),
      )
      .orderBy(desc(bookings.eventDate))
      .limit(200);
    const net = paise(totals?.['net']);
    const paid = paise(totals?.['paid']);
    const summary: OwnerEarnings = {
      from,
      to,
      bookings: paise(totals?.['bookings']),
      bookingValuePaise: paise(totals?.['value']),
      collectedOnlinePaise: paise(totals?.['collected']),
      commissionPaise: paise(totals?.['commission']),
      netPaise: net,
      paidOutPaise: paid,
      pendingPaise: net - paid,
    };
    res.set('Cache-Control', 'no-store').json({ summary, payouts: list });
  });

  r.get(
    '/admin/reports/summary',
    authenticate,
    requirePermission('report:view'),
    async (req, res) => {
      const { from, to } = reportWindow(reportQuerySchema.parse(req.query));
      const inWindow = sql`b.event_date BETWEEN ${from}::date AND ${to}::date`;
      const [byStatus, [money], top] = await Promise.all([
        db.execute(
          sql`SELECT b.status, COUNT(*)::int AS n FROM bookings b WHERE ${inWindow} GROUP BY b.status`,
        ),
        db
          .execute(
            sql`
          SELECT
            COALESCE(SUM(b.subtotal_paise + b.addons_paise + b.gst_paise) FILTER (WHERE b.status IN ${LIVE_STATUSES}), 0) AS value,
            COALESCE(SUM(p.captured), 0) AS collected,
            COALESCE(SUM(p.refunded), 0) AS refunded,
            COALESCE(SUM(b.platform_fee_paise) FILTER (WHERE p.captured > 0), 0) AS fees,
            COALESCE(SUM(po.commission_paise), 0) AS commission,
            COALESCE(SUM(po.net_paise) FILTER (WHERE po.status <> 'PAID'), 0) AS pending,
            COALESCE(SUM(po.net_paise) FILTER (WHERE po.status = 'PAID'), 0) AS paid
          FROM bookings b
          LEFT JOIN LATERAL (
            SELECT
              SUM(amount_paise) FILTER (WHERE status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED')) AS captured,
              SUM(refunded_paise) AS refunded
            FROM payments WHERE booking_id = b.id
          ) p ON true
          LEFT JOIN payouts po ON po.booking_id = b.id
          WHERE ${inWindow}`,
          )
          .then((x) => x.rows as Record<string, unknown>[]),
        db
          .select({
            city: cities.name,
            bookings: sql<number>`COUNT(*)::int`,
            valuePaise: sql<string>`SUM(${bookings.totalPaise})`,
          })
          .from(bookings)
          .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
          .innerJoin(cities, eq(cities.id, auditoriums.cityId))
          .where(
            sql`${bookings.status} IN ${LIVE_STATUSES} AND ${bookings.eventDate} BETWEEN ${from}::date AND ${to}::date`,
          )
          .groupBy(cities.name)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(5),
      ]);
      const summary: ReportSummary = {
        from,
        to,
        bookingsByStatus: Object.fromEntries(
          (byStatus.rows as { status: string; n: number }[]).map((row) => [row.status, row.n]),
        ),
        bookingValuePaise: paise(money?.['value']),
        collectedOnlinePaise: paise(money?.['collected']),
        refundedPaise: paise(money?.['refunded']),
        platformFeesPaise: paise(money?.['fees']),
        commissionPaise: paise(money?.['commission']),
        payoutsPendingPaise: paise(money?.['pending']),
        payoutsPaidPaise: paise(money?.['paid']),
        topCities: top.map((t) => ({
          city: t.city,
          bookings: t.bookings,
          valuePaise: paise(t.valuePaise),
        })),
      };
      res.set('Cache-Control', 'no-store').json(summary);
    },
  );

  /** Paid bookings in the window as CSV. No customer contact details are exported. */
  r.get(
    '/admin/reports/bookings.csv',
    authenticate,
    requirePermission('report:view'),
    async (req, res) => {
      const me = currentUser(req);
      await limiters.consume('reportExportPerUser', me.userId);
      const { from, to } = reportWindow(reportQuerySchema.parse(req.query));
      const rows = await db
        .select({
          refCode: bookings.refCode,
          eventDate: bookings.eventDate,
          slot: bookings.slot,
          status: bookings.status,
          venue: auditoriums.name,
          city: cities.name,
          total: bookings.totalPaise,
          fee: bookings.platformFeePaise,
          commission: payouts.commissionPaise,
          net: payouts.netPaise,
          payoutStatus: payouts.status,
        })
        .from(bookings)
        .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
        .innerJoin(cities, eq(cities.id, auditoriums.cityId))
        .leftJoin(payouts, eq(payouts.bookingId, bookings.id))
        .where(
          sql`${bookings.status} IN ${PAID_STATUSES} AND ${bookings.eventDate} BETWEEN ${from}::date AND ${to}::date`,
        )
        .orderBy(bookings.eventDate)
        .limit(50_000);
      const rupees = (p: number | null) => (p === null ? '' : (p / 100).toFixed(2));
      const header =
        'reference,event_date,slot,status,venue,city,total_inr,platform_fee_inr,commission_inr,owner_net_inr,payout_status';
      const lines = rows.map((x) =>
        [
          x.refCode,
          x.eventDate,
          x.slot,
          x.status,
          x.venue,
          x.city,
          rupees(x.total),
          rupees(x.fee),
          rupees(x.commission),
          rupees(x.net),
          x.payoutStatus ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
      await audit.record(
        {
          action: 'report.exported',
          entityType: 'report',
          actorId: me.userId,
          actorRole: me.role,
          after: { from, to, rows: rows.length },
        },
        auditContext(req),
      );
      res
        .set({
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="bookings-${from}-to-${to}.csv"`,
          'Cache-Control': 'no-store',
        })
        .send(`${UTF8_BOM}${[header, ...lines].join('\r\n')}\r\n`);
    },
  );

  r.get('/admin/payouts', authenticate, requirePermission('payout:manage'), async (req, res) => {
    const q = payoutQuerySchema.parse(req.query);
    const rows = await db
      .select({
        id: payouts.id,
        refCode: bookings.refCode,
        eventDate: bookings.eventDate,
        venueName: auditoriums.name,
        ownerId: payouts.ownerId,
        grossPaise: payouts.grossPaise,
        commissionPaise: payouts.commissionPaise,
        netPaise: payouts.netPaise,
        status: payouts.status,
        reference: payouts.reference,
        paidAt: payouts.paidAt,
      })
      .from(payouts)
      .innerJoin(bookings, eq(bookings.id, payouts.bookingId))
      .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
      .where(q.status ? eq(payouts.status, q.status) : undefined)
      .orderBy(desc(payouts.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    res.set('Cache-Control', 'no-store').json({ items: rows });
  });

  r.post(
    '/admin/payouts/:id/mark-paid',
    authenticate,
    requirePermission('payout:manage'),
    async (req, res) => {
      const me = currentUser(req);
      const id = parseId(req.params['id']);
      const { reference } = markPayoutPaidSchema.parse(req.body);
      const updated = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(payouts).where(eq(payouts.id, id)).for('update');
        if (!before) throw errors.notFound('Payout not found');
        if (before.status === 'PAID')
          throw errors.conflict('ALREADY_PAID', 'This payout is already marked paid');
        const [row] = await tx
          .update(payouts)
          .set({ status: 'PAID', reference, paidAt: new Date() })
          .where(eq(payouts.id, id))
          .returning();
        await audit.record(
          {
            action: 'payout.marked_paid',
            entityType: 'payout',
            entityId: id,
            actorId: me.userId,
            actorRole: me.role,
            before: { status: before.status },
            after: { status: 'PAID', reference, netPaise: before.netPaise },
          },
          auditContext(req),
          tx,
        );
        if (!row) throw errors.notFound('Payout not found');
        return row;
      });
      res.json({ id: updated.id, status: updated.status, reference: updated.reference });
    },
  );

  return r;
}
