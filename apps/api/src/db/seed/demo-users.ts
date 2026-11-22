import { inArray, sql } from 'drizzle-orm';
import type { Role } from '@mandapambook/shared';
import { hashPassword } from '../../modules/auth/password.js';
import type { Db } from '../client.js';
import { ownerStaff, users } from '../schema/index.js';
import { SAMPLE_OWNERS } from './sample-data.js';

/** Demo accounts, one per role, all on the reserved .test domain. Never seeded in production. */
export const DEMO_USERS: { email: string; fullName: string; role: Role }[] = [
  { email: 'superadmin@example.test', fullName: 'Demo Super Admin', role: 'SUPER_ADMIN' },
  { email: 'admin@example.test', fullName: 'Demo Admin', role: 'ADMIN' },
  { email: 'staff.kerala@example.test', fullName: 'Demo Owner Staff', role: 'OWNER_STAFF' },
  { email: 'customer@example.test', fullName: 'Demo Customer', role: 'CUSTOMER' },
];

/**
 * Gives the demo accounts and the sample owners a known password so each role can be
 * tried locally. The password comes from SEED_DEMO_PASSWORD and is never hard-coded.
 */
export async function seedDemoUsers(db: Db, password: string): Promise<number> {
  const passwordHash = await hashPassword(password);
  const now = new Date();
  await db
    .insert(users)
    .values(
      DEMO_USERS.map((u) => ({
        ...u,
        passwordHash,
        status: 'ACTIVE' as const,
        emailVerifiedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash: sql`excluded.password_hash` },
    });
  await db
    .update(users)
    .set({ passwordHash })
    .where(
      inArray(
        users.email,
        SAMPLE_OWNERS.map((o) => o.email),
      ),
    );

  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, ['staff.kerala@example.test', 'owner.kerala@example.test']));
  const staff = rows.find((r) => r.email === 'staff.kerala@example.test');
  const owner = rows.find((r) => r.email === 'owner.kerala@example.test');
  if (staff && owner) {
    await db
      .insert(ownerStaff)
      .values({ ownerId: owner.id, userId: staff.id })
      .onConflictDoNothing();
  }
  return DEMO_USERS.length + SAMPLE_OWNERS.length;
}
