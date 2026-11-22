import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '../src/auth.js';
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  hasPermission,
  permissionsFor,
} from '../src/rbac.js';

describe('role permissions', () => {
  it('maps every role to known permissions only', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLES)
      for (const p of ROLE_PERMISSIONS[role]) expect(known.has(p)).toBe(true);
  });

  it('keeps role changes and platform settings with super admins only', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, 'user:role_change')).toBe(role === 'SUPER_ADMIN');
      expect(hasPermission(role, 'settings:update')).toBe(role === 'SUPER_ADMIN');
    }
  });

  it('gives owner staff calendar and booking views but no pricing or payouts', () => {
    expect(permissionsFor('OWNER_STAFF')).toEqual(['booking:view_venue', 'calendar:manage']);
    expect(hasPermission('OWNER_STAFF', 'pricing:update')).toBe(false);
    expect(hasPermission('OWNER_STAFF', 'payout:view')).toBe(false);
    expect(hasPermission('OWNER_STAFF', 'booking:approve')).toBe(false);
  });

  it('does not let admins edit venues or customers manage anything', () => {
    expect(hasPermission('ADMIN', 'auditorium:update')).toBe(false);
    expect(hasPermission('ADMIN', 'listing:review')).toBe(true);
    expect(permissionsFor('CUSTOMER')).toEqual([
      'booking:cancel_own',
      'booking:create',
      'review:create',
    ]);
  });
});

describe('auth schemas', () => {
  it('normalises email and phone and defaults to a customer account', () => {
    const parsed = registerSchema.parse({
      email: '  Priya@Example.TEST ',
      password: 'correct horse battery',
      fullName: 'Priya Nair',
      phone: '98765 43210',
    });
    expect(parsed).toMatchObject({
      email: 'priya@example.test',
      phone: '+919876543210',
      accountType: 'CUSTOMER',
    });
  });

  it('rejects self-assigned privileged roles and unknown fields', () => {
    const base = { email: 'a@example.test', password: 'long enough pw', fullName: 'Asha' };
    expect(registerSchema.safeParse({ ...base, accountType: 'ADMIN' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, role: 'SUPER_ADMIN' }).success).toBe(false);
  });

  it('enforces password length', () => {
    const base = { email: 'a@example.test', fullName: 'Asha' };
    expect(registerSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: 'x'.repeat(129) }).success).toBe(false);
  });

  it('bounds login password length to stop hash-DoS', () => {
    expect(
      loginSchema.safeParse({ email: 'a@example.test', password: 'x'.repeat(10_000) }).success,
    ).toBe(false);
  });
});
