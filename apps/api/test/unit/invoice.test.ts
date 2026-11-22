import { describe, expect, it } from 'vitest';
import {
  type InvoiceData,
  financialYear,
  formatInvoiceNumber,
  pdfAmount,
  renderInvoicePdf,
} from '../../src/modules/invoices/invoice.service.js';

const data: InvoiceData = {
  number: 'MB/2026-27/000042',
  issuedAt: new Date('2026-11-22T06:00:00Z'),
  refCode: 'MB-7K3Q9X',
  status: 'CONFIRMED',
  customer: { name: 'Priya Nair', email: 'priya@example.test', phone: '+919876543210' },
  venue: {
    name: 'Sundaram Thirumana Mahal',
    address: '22 Kutchery Road',
    city: 'Chennai',
    pincode: '600004',
    businessName: 'Sundaram Mahal Group',
    gstin: '33ABCPL1234K1Z9',
  },
  event: { date: '2027-01-21', slot: 'Muhurtham (morning)', hall: 'Mahal', guests: 500 },
  lines: [
    { label: 'Hall rental', quantity: 1, unitPaise: 12_000_000, totalPaise: 12_000_000 },
    { label: 'Guest room', quantity: 4, unitPaise: 280_000, totalPaise: 1_120_000 },
  ],
  gstPaise: 2_361_600,
  gstBasisPoints: 1800,
  platformFeePaise: 49_900,
  totalPaise: 15_531_500,
  paidOnlinePaise: 3_920_300,
  refundedPaise: 0,
};

describe('invoice helpers', () => {
  it('uses the Indian financial year (April to March)', () => {
    expect(financialYear('2026-11-22')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
    expect(financialYear('2099-12-01')).toBe('2099-00');
  });

  it('formats invoice numbers and amounts', () => {
    expect(formatInvoiceNumber('2026-27', 42)).toBe('MB/2026-27/000042');
    expect(pdfAmount(15_531_500)).toBe('INR 1,55,315.00');
  });

  it('renders a PDF', async () => {
    const pdf = await renderInvoicePdf(data);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
    const cancelled = await renderInvoicePdf({
      ...data,
      status: 'REFUNDED',
      refundedPaise: 1_000_000,
    });
    expect(cancelled.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
