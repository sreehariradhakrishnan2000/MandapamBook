import { defineConfig } from 'drizzle-kit';

// Used only for `drizzle-kit generate` (schema diff → SQL). Generation needs no database.
// Migrations are applied by src/db/migrate.ts, never by drizzle-kit push.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
