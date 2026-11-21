import { and, eq, inArray, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { auditoriums, ownerStaff } from '../../db/schema/index.js';
import { errors } from '../../http/errors.js';
import type { AccessClaims } from '../auth/access-tokens.js';

/**
 * Which venues the caller may act on. Every owner-side query must be filtered through
 * this scope in the repository layer; resources outside it are reported as 404 so their
 * existence is not leaked (IDOR protection).
 */
export interface OwnerScope {
  ownerId: string;
  /** null = every venue of the owner; otherwise only these (staff restricted to venues). */
  auditoriumIds: string[] | null;
  isStaff: boolean;
}

export async function resolveOwnerScope(db: Db, auth: AccessClaims): Promise<OwnerScope> {
  if (auth.role === 'OWNER') {
    return { ownerId: auth.userId, auditoriumIds: null, isStaff: false };
  }
  if (auth.role === 'OWNER_STAFF') {
    const [row] = await db
      .select({ ownerId: ownerStaff.ownerId, auditoriumIds: ownerStaff.auditoriumIds })
      .from(ownerStaff)
      .where(eq(ownerStaff.userId, auth.userId));
    if (!row) throw errors.forbidden('Your staff access has been removed');
    return {
      ownerId: row.ownerId,
      auditoriumIds: row.auditoriumIds.length > 0 ? row.auditoriumIds : null,
      isStaff: true,
    };
  }
  throw errors.forbidden();
}

/** SQL condition restricting `auditoriums` rows to the scope. */
export function auditoriumScopeCondition(scope: OwnerScope): SQL {
  const byOwner = eq(auditoriums.ownerId, scope.ownerId);
  return scope.auditoriumIds
    ? (and(byOwner, inArray(auditoriums.id, scope.auditoriumIds)) as SQL)
    : byOwner;
}
