/**
 * Seed entrypoint.
 *   pnpm db:seed              master data + fictional sample venues (dev/test only)
 *   pnpm db:seed --master     master data only (allowed in production)
 *   pnpm db:seed --kerala     also 140 test venues, 10 in each Kerala district (dev/staging)
 *   SEED_DEMO_PASSWORD=...    also give demo accounts for every role that password (dev only)
 *   STORAGE_PROVIDER=s3       also upload photos for the sample venues (S3_* must be set)
 */
import pg from 'pg';
import { z } from 'zod';
import { createObjectStorage } from '../../infra/storage.js';
import { createDb } from '../client.js';
import { seedDemoUsers } from './demo-users.js';
import { KERALA_TEST_AUDITORIUMS, KERALA_TEST_OWNERS } from './kerala-test-venues.js';
import { seedKeralaTestPhotos, seedSamplePhotos } from './sample-photos.js';
import { seedMasterData, seedSampleData } from './seed.js';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    SEED_DEMO_PASSWORD: z.union([z.literal(''), z.string().min(10)]).optional(),
    STORAGE_PROVIDER: z.enum(['s3', 'memory']).default('memory'),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3).default('mandapambook-media'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .safeParse(
    // Empty .env entries mean "unset", not an empty value.
    Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')),
  );

if (!env.success) {
  console.error('Set DATABASE_URL to run the seed.');
  process.exit(1);
}

const masterOnly = process.argv.includes('--master');
const kerala = process.argv.includes('--kerala');
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
    // Photos need real object storage: an in-memory store would vanish with this process.
    if (env.data.STORAGE_PROVIDER === 's3') {
      const photos = await seedSamplePhotos(db, createObjectStorage(env.data));
      console.error(`Sample photos: ${photos.photos} uploaded for ${photos.venues} venues.`);
    } else {
      console.error('Sample photos: skipped (set STORAGE_PROVIDER=s3 to upload them).');
    }
    if (kerala) {
      const k = await seedSampleData(db, {
        owners: KERALA_TEST_OWNERS,
        auditoriums: KERALA_TEST_AUDITORIUMS,
      });
      console.error(
        `Kerala test venues: ${k.auditoriumsCreated} created, ${k.auditoriumsSkipped} already present.`,
      );
      if (env.data.STORAGE_PROVIDER === 's3') {
        const p = await seedKeralaTestPhotos(db, createObjectStorage(env.data));
        console.error(`Kerala test photos: ${p.photos} uploaded for ${p.venues} venues.`);
      }
    }
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
