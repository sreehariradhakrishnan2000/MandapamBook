import { describe, expect, it } from 'vitest';
import { payoutFor } from '../../src/modules/payouts/payout.service.js';
import { csvCell, reportWindow } from '../../src/modules/reports/reports.routes.js';

describe('payoutFor', () => {
  const base = {
    capturedPaise: 3_000_000,
    refundedPaise: 0,
    platformFeePaise: 49_900,
    venueChargesPaise: 10_000_000,
    commissionBps: 800,
  };

  it('takes commission on venue charges for completed events, capped at what was collected', () => {
    expect(payoutFor({ ...base, status: 'COMPLETED' })).toEqual({
      grossPaise: 2_950_100,
      commissionPaise: 800_000,
      netPaise: 2_150_100,
    });
    expect(payoutFor({ ...base, status: 'COMPLETED', capturedPaise: 500_000 })).toEqual({
      grossPaise: 450_100,
      commissionPaise: 450_100,
      netPaise: 0,
    });
  });

  it('takes commission only on the retained share of a cancellation', () => {
    expect(payoutFor({ ...base, status: 'CANCELLED', refundedPaise: 2_000_000 })).toEqual({
      grossPaise: 950_100,
      commissionPaise: 76_008,
      netPaise: 874_092,
    });
    expect(payoutFor({ ...base, status: 'REFUNDED', refundedPaise: 3_000_000 })).toEqual({
      grossPaise: 0,
      commissionPaise: 0,
      netPaise: 0,
    });
  });
});

describe('csvCell', () => {
  it('neutralises formulas and quotes special characters', () => {
    expect(csvCell('Kovai Grand')).toBe('Kovai Grand');
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+91 98')).toBe(`"'+91 98"`);
    expect(csvCell('-5')).toBe(`"'-5"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(1234.5)).toBe('1234.5');
  });
});

describe('reportWindow', () => {
  it('defaults to the Indian financial year containing today', () => {
    expect(reportWindow({}, '2026-11-22')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(reportWindow({}, '2027-02-01')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(reportWindow({ from: '2026-05-01' }, '2026-11-22')).toEqual({
      from: '2026-05-01',
      to: '2027-03-31',
    });
  });
});
