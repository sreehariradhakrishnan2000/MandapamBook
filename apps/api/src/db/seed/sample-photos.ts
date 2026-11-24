import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { count, eq } from 'drizzle-orm';
import type { ObjectStorage } from '../../infra/storage.js';
import type { Db } from '../client.js';
import { auditoriums, media } from '../schema/index.js';
import { KERALA_TEST_AUDITORIUMS, stockPhotosFor } from './kerala-test-venues.js';
import { SAMPLE_AUDITORIUMS } from './sample-data.js';

/**
 * Photos for the fictional sample venues: AI-generated images (no real venues or people),
 * named `<venue slug>-<n>.webp`, 1200x800.
 */
const PHOTO_DIR = new URL('./photos/', import.meta.url);
const STOCK_DIR = new URL('./photos/stock/', import.meta.url);

const ALT_TEXT: Record<string, [string, string]> = {
  'sree-padmanabha-kalyana-mandapam-kochi': [
    'Carved wooden stage with brass lamps and marigold garlands',
    'Dining hall with banana leaves laid for sadya',
  ],
  'vadakkunnathan-convention-centre-thrissur': [
    'Grand hall with chandeliers and a floral stage',
    'Convention centre entrance and car park at dusk',
  ],
  'kovalam-road-auditorium-thiruvananthapuram': [
    'Auditorium with a flower arch on stage and rows of chairs',
    'Auditorium building with a large parking ground',
  ],
  'sundaram-thirumana-mahal-chennai': [
    'Wedding stage with an oonjal swing, banana trees and a kolam',
    'Mahal entrance decorated with mango leaves and a kolam',
  ],
  'kovai-grand-convention-hall-coimbatore': [
    'Hall A set for a reception with round tables',
    'Hall B set for a morning ceremony',
  ],
  'basavanagudi-kalyana-mantapa-bengaluru': [
    'Heritage mantapa with carved stone pillars',
    'Lawn set for an evening reception under fairy lights',
  ],
};

/**
 * Uploads photos for sample venues that have none yet, through the same presigned PUT the
 * browser uses, and records them as READY media. Venues that already have photos are skipped,
 * so the seed can be re-run safely.
 */
export async function seedSamplePhotos(
  db: Db,
  storage: ObjectStorage,
): Promise<{ venues: number; photos: number }> {
  const files = (await readdir(PHOTO_DIR)).filter((f) => f.endsWith('.webp')).sort();
  return uploadVenuePhotos(
    db,
    storage,
    SAMPLE_AUDITORIUMS.map((venue) => ({
      slug: venue.slug,
      photos: files
        .filter((f) => f.startsWith(`${venue.slug}-`))
        .map((file, i) => ({
          file: new URL(file, PHOTO_DIR),
          alt: ALT_TEXT[venue.slug]?.[i] ?? `Photo of ${venue.name}`,
        })),
    })),
  );
}

/** Photos for the Kerala test venues: two shared stock photos each. */
export async function seedKeralaTestPhotos(
  db: Db,
  storage: ObjectStorage,
): Promise<{ venues: number; photos: number }> {
  return uploadVenuePhotos(
    db,
    storage,
    KERALA_TEST_AUDITORIUMS.map((venue, i) => ({
      slug: venue.slug,
      photos: stockPhotosFor(i).map(([file, alt]) => ({ file: new URL(file, STOCK_DIR), alt })),
    })),
  );
}

/**
 * Uploads each venue's photos through the same presigned PUT the browser uses and records
 * them as READY media. Venues that are missing or already have photos are skipped.
 */
export async function uploadVenuePhotos(
  db: Db,
  storage: ObjectStorage,
  plan: { slug: string; photos: { file: URL; alt: string }[] }[],
): Promise<{ venues: number; photos: number }> {
  let venues = 0;
  let photos = 0;

  for (const venue of plan) {
    const [aud] = await db
      .select({ id: auditoriums.id })
      .from(auditoriums)
      .where(eq(auditoriums.slug, venue.slug));
    if (!aud) continue;
    const [existing] = await db
      .select({ n: count() })
      .from(media)
      .where(eq(media.auditoriumId, aud.id));
    if ((existing?.n ?? 0) > 0) continue;

    for (const [i, { file, alt }] of venue.photos.entries()) {
      const body = await readFile(file);
      const storageKey = `venues/${aud.id}/${randomUUID()}.webp`;
      const target = await storage.createUploadUrl(storageKey, 'image/webp', body.length, 300);
      // fetch sets Content-Length itself from the body, which matches the signed size.
      const headers = Object.fromEntries(
        Object.entries(target.headers).filter(([k]) => k.toLowerCase() !== 'content-length'),
      );
      const res = await fetch(target.url, { method: target.method, headers, body });
      if (!res.ok) throw new Error(`upload of ${file} failed: HTTP ${res.status}`);

      await db.insert(media).values({
        auditoriumId: aud.id,
        storageKey,
        mimeType: 'image/webp',
        sizeBytes: body.length,
        width: 1200,
        height: 800,
        altText: alt,
        sortOrder: i,
        status: 'READY',
      });
      photos++;
    }
    if (venue.photos.length) venues++;
  }
  return { venues, photos };
}
