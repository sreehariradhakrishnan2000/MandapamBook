/**
 * Seed entrypoint.
 *   pnpm db:seed              master data + fictional sample venues (dev/test only)
 *   pnpm db:seed --master     master data only (allowed in production)
 *   SEED_DEMO_PASSWORD=...    also give demo accounts for every role that password (dev only)
 */
import pg from 'pg';
import { z } from 'zod';
import { createDb } from '../client.js';
import { seedDemoUsers } from './demo-users.js';
import { seedMasterData, seedSampleData } from './seed.js';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    SEED_DEMO_PASSWORD: z.union([z.literal(''), z.string().min(10)]).optional(),
  })
  .safeParse(process.env);

if (!env.success) {
  console.error('Set DATABASE_URL to run the seed.');
  process.exit(1);
}

const masterOnly = process.argv.includes('--master');
if (env.data.NODE_ENV === 'production' && !masterOnly) {
  console.error(
    'Refusing to load sample data in production. Use --master for reference data only.',
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: env.data.DATABASE_URL, max: 2 });
const db = createDb(pool);

try {
  const master = await seedMasterData(db);
  console.error(`Master data: ${master.cities} cities, ${master.amenities} amenities.`);
  if (!masterOnly) {
    const sample = await seedSampleData(db);
    console.error(
      `Sample data: ${sample.auditoriumsCreated} venues created, ${sample.auditoriumsSkipped} already present.`,
    );
    if (env.data.SEED_DEMO_PASSWORD) {
      const n = await seedDemoUsers(db, env.data.SEED_DEMO_PASSWORD);
      console.error(`Demo accounts: ${n} users can sign in with SEED_DEMO_PASSWORD.`);
    }
  }
} catch (err) {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
