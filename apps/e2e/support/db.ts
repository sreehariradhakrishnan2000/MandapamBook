import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../env.js';

/**
 * Direct database access for the few steps the browser cannot do locally. Photos: the
 * local API uses in-memory storage, whose upload URLs a real browser cannot reach, so the
 * three photos a listing needs are recorded as uploaded. (CI with S3 storage can upload.)
 */
export async function addReadyPhotos(auditoriumId: string, count = 3): Promise<void> {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    for (let i = 0; i < count; i++) {
      await client.query(
        `INSERT INTO media (auditorium_id, storage_key, mime_type, size_bytes, width, height, alt_text, sort_order, status)
         VALUES ($1, $2, 'image/jpeg', 120000, 1600, 1067, $3, $4, 'READY')`,
        [auditoriumId, `auditoriums/${auditoriumId}/${randomUUID()}.jpg`, `Hall view ${i + 1}`, i],
      );
    }
  } finally {
    await client.end();
  }
}

/** Moves a booking's event into the past and completes it, as the nightly sweep would. */
export async function completeBooking(refCode: string): Promise<void> {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`UPDATE bookings SET status = 'COMPLETED' WHERE ref_code = $1`, [refCode]);
  } finally {
    await client.end();
  }
}
