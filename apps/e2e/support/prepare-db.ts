/**
 * Resets the e2e database and loads what every run needs: migrations, reference data
 * (cities, amenities, settings) and one admin account. Run by Playwright's global setup
 * through tsx from the API package, so it uses the API's own migration and seed code.
 *
 *   E2E_DATABASE_URL, E2E_MIGRATION_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 */
import pg from 'pg';
import { createDb } from '../../api/src/db/client.js';
import { runMigrations } from '../../api/src/db/migrate.js';
import { users } from '../../api/src/db/schema/index.js';
import { seedMasterData } from '../../api/src/db/seed/seed.js';
import { hashPassword } from '../../api/src/modules/auth/password.js';

const url = process.env['E2E_DATABASE_URL'];
const migrationUrl = process.env['E2E_MIGRATION_URL'] ?? url;
const adminEmail = process.env['E2E_ADMIN_EMAIL'];
const adminPassword = process.env['E2E_ADMIN_PASSWORD'];
if (!url || !migrationUrl || !adminEmail || !adminPassword)
  throw new Error('e2e database settings missing');
for (const u of [url, migrationUrl]) {
  if (!new URL(u).pathname.endsWith('_e2e'))
    throw new Error('Refusing to reset a database not named *_e2e');
}

const reset = new pg.Client({ connectionString: migrationUrl });
await reset.connect();
try {
  await reset.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await reset.query('DROP SCHEMA IF EXISTS public CASCADE');
  await reset.query('CREATE SCHEMA public');
} finally {
  await reset.end();
}
await runMigrations(migrationUrl);

const pool = new pg.Pool({ connectionString: url, max: 2 });
try {
  const db = createDb(pool);
  await seedMasterData(db);
  await db.insert(users).values({
    email: adminEmail,
    fullName: 'E2E Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    passwordHash: await hashPassword(adminPassword),
    emailVerifiedAt: new Date(),
  });
} finally {
  await pool.end();
}
console.error('e2e database ready');
