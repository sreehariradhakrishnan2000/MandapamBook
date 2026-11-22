import { describe, expect, it } from 'vitest';
import {
  createReviewSchema,
  markPayoutPaidSchema,
  moderateReviewSchema,
  reportQuerySchema,
  reviewerDisplayName,
} from '../src/index.js';

describe('review schemas', () => {
  it('strips control characters, keeps newlines and bounds the body', () => {
    expect(createReviewSchema.parse({ rating: 5, body: ' Great\u0000 hall\n‮ok ' }).body).toBe(
      'Great hall\nok',
    );
    expect(createReviewSchema.parse({ rating: 3 }).body).toBe('');
    expect(createReviewSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(createReviewSchema.safeParse({ rating: 4.5 }).success).toBe(false);
    expect(createReviewSchema.safeParse({ rating: 5, body: 'x'.repeat(2001) }).success).toBe(false);
    expect(createReviewSchema.safeParse({ rating: 5, status: 'PUBLISHED' }).success).toBe(false);
  });

  it('requires a reason to moderate', () => {
    expect(moderateReviewSchema.safeParse({ status: 'HIDDEN', reason: '  ' }).success).toBe(false);
    expect(moderateReviewSchema.safeParse({ status: 'FLAGGED', reason: 'spam' }).success).toBe(
      false,
    );
    expect(moderateReviewSchema.parse({ status: 'HIDDEN', reason: 'Spam' })).toEqual({
      status: 'HIDDEN',
      reason: 'Spam',
    });
  });

  it('shows only first name and initial', () => {
    expect(reviewerDisplayName('Priya Nair')).toBe('Priya N.');
    expect(reviewerDisplayName('  Anil  Kumar  Menon ')).toBe('Anil M.');
    expect(reviewerDisplayName('Lakshmi')).toBe('Lakshmi');
    expect(reviewerDisplayName('')).toBe('');
  });
});

describe('report and payout schemas', () => {
  it('validates the report window', () => {
    expect(reportQuerySchema.safeParse({}).success).toBe(true);
    expect(reportQuerySchema.safeParse({ from: '2026-04-01', to: '2027-03-31' }).success).toBe(
      true,
    );
    expect(reportQuerySchema.safeParse({ from: '2027-01-01', to: '2026-01-01' }).success).toBe(
      false,
    );
    expect(reportQuerySchema.safeParse({ from: '2020-01-01', to: '2026-01-01' }).success).toBe(
      false,
    );
    expect(reportQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });

  it('accepts only plain transfer references', () => {
    expect(markPayoutPaidSchema.parse({ reference: ' UTR123456789 ' }).reference).toBe(
      'UTR123456789',
    );
    expect(markPayoutPaidSchema.safeParse({ reference: '=1+1' }).success).toBe(false);
    expect(markPayoutPaidSchema.safeParse({ reference: 'ab' }).success).toBe(false);
  });
});
