/**
 * Applies pending SQL migrations. Run explicitly (`pnpm db:migrate`) as its own
 * pipeline step; the API server never migrates on startup.
 *
 * Uses MIGRATION_DATABASE_URL (a direct, non-pooled connection) when set, because
 * migrations take advisory locks that a transaction-mode pooler does not preserve.
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { z } from 'zod';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: 'drizzle',
    });
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const env = z
    .object({
      MIGRATION_DATABASE_URL: z.url().optional(),
      DATABASE_URL: z.url(),
    })
    .safeParse(process.env);
  if (!env.success) {
    console.error('Set DATABASE_URL (or MIGRATION_DATABASE_URL) to run migrations.');
    process.exit(1);
  }
  const url = env.data.MIGRATION_DATABASE_URL ?? env.data.DATABASE_URL;
  const host = new URL(url).host;
  runMigrations(url)
    .then(() => {
      console.error(`Migrations applied to ${host}.`);
    })
    .catch((err: unknown) => {
      console.error('Migration failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
