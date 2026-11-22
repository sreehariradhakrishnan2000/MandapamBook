/**
 * Permission-based access control. Routes check permissions, never role names.
 * Ownership ("own" / "assigned") is enforced separately in the data layer.
 */
export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER', 'OWNER_STAFF', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // platform
  'admin:manage',
  'settings:update',
  'user:manage',
  'user:role_change',
  'listing:review',
  'refund:issue',
  'report:view',
  'audit:view',
  'masterdata:update',
  'booking:view_all',
  /** View full KYC numbers (every reveal is audited) and verify or reject KYC. */
  'kyc:review',
  /** Hide or restore customer reviews (every change is audited). */
  'review:moderate',
  /** Mark owner payouts as paid (audited). */
  'payout:manage',
  // owner side (scoped to the owner's own venues)
  'auditorium:create',
  'auditorium:update',
  'pricing:update',
  'payout:view',
  'kyc:update',
  'staff:manage',
  'calendar:manage',
  'booking:view_venue',
  'booking:approve',
  /** Publicly reply to reviews of the owner's venues. */
  'review:reply',
  // customer side (scoped to the customer's own bookings)
  'booking:create',
  'booking:cancel_own',
  'review:create',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const PLATFORM_ADMIN: Permission[] = [
  'user:manage',
  'listing:review',
  'refund:issue',
  'report:view',
  'audit:view',
  'masterdata:update',
  'booking:view_all',
  'kyc:review',
  'review:moderate',
  'payout:manage',
];

const OWNER: Permission[] = [
  'auditorium:create',
  'auditorium:update',
  'pricing:update',
  'payout:view',
  'kyc:update',
  'staff:manage',
  'calendar:manage',
  'booking:view_venue',
  'booking:approve',
  'review:reply',
];

const OWNER_STAFF: Permission[] = ['calendar:manage', 'booking:view_venue'];

const CUSTOMER: Permission[] = ['booking:create', 'booking:cancel_own', 'review:create'];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  SUPER_ADMIN: new Set<Permission>([
    'admin:manage',
    'settings:update',
    'user:role_change',
    ...PLATFORM_ADMIN,
    ...OWNER,
  ]),
  ADMIN: new Set(PLATFORM_ADMIN),
  OWNER: new Set(OWNER),
  OWNER_STAFF: new Set(OWNER_STAFF),
  CUSTOMER: new Set(CUSTOMER),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]].sort();
}
