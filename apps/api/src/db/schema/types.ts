import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Case-insensitive text (requires the citext extension). */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** Raw bytes, used for AES-256-GCM ciphertext and token hashes. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const inet = customType<{ data: string }>({
  dataType: () => 'inet',
});

/** int4range as its Postgres text form, e.g. "[0,2)". Only used for generated columns. */
export const int4range = customType<{ data: string }>({
  dataType: () => 'int4range',
});

export const id = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });
