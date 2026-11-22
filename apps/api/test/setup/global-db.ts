import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.js';
import './load-env.js';

/**
 * Resets the test database to an empty schema and applies all migrations once per run.
 * Refuses to touch any database whose name does not end in "_test".
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.error('TEST_DATABASE_URL not set: database integration tests will be skipped.');
    return;
  }
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": test database names must end in _test`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
