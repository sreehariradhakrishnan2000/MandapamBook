import PDFDocument from 'pdfkit';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import {
  auditoriums,
  bookingAddons,
  bookings,
  cities,
  halls,
  invoiceCounters,
  invoices,
  ownerProfiles,
  payments,
  addons,
  users,
} from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Bookings that have been paid for and therefore get an invoice. */
export const INVOICEABLE = [
  'AWAITING_OWNER',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
] as const;

/** Indian financial year (1 April to 31 March) for an IST calendar date: 2026-11-22 → "2026-27". */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function formatInvoiceNumber(fy: string, n: number): string {
  return `MB/${fy}/${String(n).padStart(6, '0')}`;
}

/** Rupees for the PDF. The standard PDF fonts have no ₹ glyph, so the text says INR. */
export function pdfAmount(paise: number): string {
  return `INR ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`;
}

export interface InvoiceData {
  number: string;
  issuedAt: Date;
  refCode: string;
  status: string;
  customer: { name: string; email: string; phone: string | null };
  venue: {
    name: string;
    address: string;
    city: string;
    pincode: string;
    businessName: string;
    gstin: string | null;
  };
  event: { date: string; slot: string; hall: string; guests: number };
  lines: { label: string; quantity: number; unitPaise: number; totalPaise: number }[];
  gstPaise: number;
  gstBasisPoints: number;
  platformFeePaise: number;
  totalPaise: number;
  paidOnlinePaise: number;
  refundedPaise: number;
}

const SLOT_LABELS: Record<string, string> = {
  MORNING: 'Muhurtham (morning)',
  EVENING: 'Reception (evening)',
  FULL_DAY: 'Full day',
};

export class InvoiceService {
  constructor(private readonly db: Db) {}

  /**
   * Gives a paid booking its invoice number on first request. Numbers are sequential and
   * gap-free per financial year: the counter row is locked by the UPDATE, so concurrent
   * requests never share a number.
   *
   * The booking row is locked first, so concurrent first requests for the same booking
   * queue up and the later ones find the invoice the first one created. Without the lock,
   * both saw "no invoice", and the second insert hit invoices_booking_key (a 500).
   */
  async ensureNumber(bookingId: string, tx?: Tx): Promise<{ number: string; issuedAt: Date }> {
    const run = async (t: Tx) => {
      await t
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for('update');
      const [existing] = await t.select().from(invoices).where(eq(invoices.bookingId, bookingId));
      if (existing) return { number: existing.number, issuedAt: existing.issuedAt };
      const issuedAt = new Date();
      const fy = financialYear(
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(issuedAt),
      );
      const [counter] = await t
        .insert(invoiceCounters)
        .values({ financialYear: fy, lastNumber: 1 })
        .onConflictDoUpdate({
          target: invoiceCounters.financialYear,
          set: { lastNumber: sql`${invoiceCounters.lastNumber} + 1` },
        })
        .returning();
      if (!counter) throw new Error('invoice counter upsert returned no row');
      const number = formatInvoiceNumber(fy, counter.lastNumber);
      await t.insert(invoices).values({ bookingId, number, issuedAt });
      return { number, issuedAt };
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  /** Everything printed on the invoice, from the booking's frozen price snapshot. */
  async load(bookingId: string): Promise<InvoiceData> {
    const [row] = await this.db
      .select({
        b: bookings,
        customerName: users.fullName,
        customerEmail: users.email,
        customerPhone: users.phone,
        venueName: auditoriums.name,
        address: auditoriums.addressLine,
        pincode: auditoriums.pincode,
        city: cities.name,
        hall: halls.name,
        businessName: ownerProfiles.businessName,
        gstin: ownerProfiles.gstin,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.customerId))
      .innerJoin(auditoriums, eq(auditoriums.id, bookings.auditoriumId))
      .innerJoin(cities, eq(cities.id, auditoriums.cityId))
      .innerJoin(halls, eq(halls.id, bookings.hallId))
      .innerJoin(ownerProfiles, eq(ownerProfiles.userId, auditoriums.ownerId))
      .where(eq(bookings.id, bookingId));
    if (!row) throw errors.notFound('Booking not found');
    if (!(INVOICEABLE as readonly string[]).includes(row.b.status)) {
      throw errors.conflict('NOT_INVOICEABLE', 'An invoice is available once the booking is paid');
    }
    const [{ number, issuedAt }, addonRows, paid] = await Promise.all([
      this.ensureNumber(bookingId),
      this.db
        .select({
          name: addons.name,
          quantity: bookingAddons.quantity,
          unit: bookingAddons.unitPricePaise,
          total: bookingAddons.totalPaise,
        })
        .from(bookingAddons)
        .innerJoin(addons, eq(addons.id, bookingAddons.addonId))
        .where(eq(bookingAddons.bookingId, bookingId)),
      this.db
        .select({
          captured: sql<string>`COALESCE(SUM(${payments.amountPaise}), 0)`,
          refunded: sql<string>`COALESCE(SUM(${payments.refundedPaise}), 0)`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.bookingId, bookingId),
            inArray(payments.status, ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED']),
          ),
        ),
    ]);
    const b = row.b;
    return {
      number,
      issuedAt,
      refCode: b.refCode,
      status: b.status,
      customer: { name: row.customerName, email: row.customerEmail, phone: row.customerPhone },
      venue: {
        name: row.venueName,
        address: row.address,
        city: row.city,
        pincode: row.pincode,
        businessName: row.businessName,
        gstin: row.gstin,
      },
      event: {
        date: b.eventDate,
        slot: SLOT_LABELS[b.slot] ?? b.slot,
        hall: row.hall,
        guests: b.guestCount,
      },
      lines: [
        {
          label: `Hall rental: ${row.hall}, ${SLOT_LABELS[b.slot] ?? b.slot}`,
          quantity: 1,
          unitPaise: b.subtotalPaise,
          totalPaise: b.subtotalPaise,
        },
        ...addonRows.map((a) => ({
          label: a.name,
          quantity: a.quantity,
          unitPaise: a.unit,
          totalPaise: a.total,
        })),
      ],
      gstPaise: b.gstPaise,
      gstBasisPoints: b.priceSnapshot.gstBasisPoints,
      platformFeePaise: b.platformFeePaise,
      totalPaise: b.totalPaise,
      paidOnlinePaise: Number(paid[0]?.captured ?? 0),
      refundedPaise: Number(paid[0]?.refunded ?? 0),
    };
  }

  async pdf(bookingId: string): Promise<{ data: InvoiceData; buffer: Buffer }> {
    const data = await this.load(bookingId);
    return { data, buffer: await renderInvoicePdf(data) };
  }
}

/** Renders an A4 invoice. Pure: the same data always produces the same layout. */
export function renderInvoicePdf(d: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: `Invoice ${d.number}`, Author: 'MandapamBook' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').text('MandapamBook', { continued: false });
    doc.fontSize(10).font('Helvetica').fillColor('#555').text('Booking invoice');
    doc.moveDown();
    doc.fillColor('#000').fontSize(10);
    doc.text(`Invoice no: ${d.number}`);
    doc.text(
      `Issued: ${d.issuedAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })}`,
    );
    doc.text(`Booking reference: ${d.refCode}`);
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Venue');
    doc.font('Helvetica').text(`${d.venue.name} (${d.venue.businessName})`);
    doc.text(`${d.venue.address}, ${d.venue.city} ${d.venue.pincode}`);
    if (d.venue.gstin) doc.text(`GSTIN: ${d.venue.gstin}`);
    doc.moveDown();
    doc.font('Helvetica-Bold').text('Billed to');
    doc.font('Helvetica').text(d.customer.name);
    doc.text(d.customer.email);
    if (d.customer.phone) doc.text(d.customer.phone);
    doc.moveDown();
    doc.font('Helvetica-Bold').text('Event');
    doc
      .font('Helvetica')
      .text(`${d.event.date} · ${d.event.slot} · ${d.event.hall} · ${d.event.guests} guests`);
    doc.moveDown();

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(label, left, y, { width: right - left - 140 });
      doc.text(value, right - 140, y, { width: 140, align: 'right' });
      doc.moveDown(0.3);
    };
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.5);
    for (const l of d.lines)
      row(l.quantity > 1 ? `${l.label} × ${l.quantity}` : l.label, pdfAmount(l.totalPaise));
    row(`GST (${d.gstBasisPoints / 100}%)`, pdfAmount(d.gstPaise));
    row('Platform fee (incl. taxes)', pdfAmount(d.platformFeePaise));
    doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
    doc.moveDown(0.5);
    row('Total', pdfAmount(d.totalPaise), true);
    row('Paid online', pdfAmount(d.paidOnlinePaise));
    if (d.refundedPaise > 0) row('Refunded', `- ${pdfAmount(d.refundedPaise)}`);
    const balance = ['CANCELLED', 'REFUNDED'].includes(d.status)
      ? 0
      : d.totalPaise - d.paidOnlinePaise;
    row('Balance due at the venue', pdfAmount(Math.max(0, balance)), true);
    doc.moveDown(2);
    doc
      .fontSize(8)
      .fillColor('#666')
      .text(
        'Amounts in Indian rupees. The platform fee is collected by MandapamBook; venue charges and GST are collected on behalf of the venue. ' +
          'This document is generated from the booking record and is valid without a signature.',
        left,
        doc.y,
        { width: right - left },
      );
    doc.end();
  });
}
