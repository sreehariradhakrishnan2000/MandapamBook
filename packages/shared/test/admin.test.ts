import { describe, expect, it } from 'vitest';
import { listingDecisionSchema, platformSettingsUpdateSchema } from '../src/admin.js';
import { hasPermission } from '../src/rbac.js';

describe('admin schemas', () => {
  it('requires a meaningful reason to reject or suspend', () => {
    expect(listingDecisionSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(listingDecisionSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(listingDecisionSchema.safeParse({ decision: 'reject', reason: 'bad' }).success).toBe(
      false,
    );
    expect(
      listingDecisionSchema.safeParse({
        decision: 'reject',
        reason: 'Photos are blurry; upload clearer ones',
      }).success,
    ).toBe(true);
  });

  it('bounds platform settings', () => {
    expect(platformSettingsUpdateSchema.safeParse({ commission_bps: 5000 }).success).toBe(false);
    expect(platformSettingsUpdateSchema.safeParse({ gst_bps: 1800 }).success).toBe(true);
    expect(platformSettingsUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('gives KYC review to admins only', () => {
    expect(hasPermission('ADMIN', 'kyc:review')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'kyc:review')).toBe(true);
    expect(hasPermission('OWNER', 'kyc:review')).toBe(false);
  });
});
