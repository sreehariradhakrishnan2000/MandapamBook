import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { count, eq } from 'drizzle-orm';
import type { ObjectStorage } from '../../infra/storage.js';
import type { Db } from '../client.js';
import { auditoriums, media } from '../schema/index.js';
import { SAMPLE_AUDITORIUMS } from './sample-data.js';

/**
 * Photos for the fictional sample venues: AI-generated images (no real venues or people),
 * named `<venue slug>-<n>.webp`, 1200x800.
 */
const PHOTO_DIR = new URL('./photos/', import.meta.url);

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
  let venues = 0;
  let photos = 0;

  for (const venue of SAMPLE_AUDITORIUMS) {
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

    const mine = files.filter((f) => f.startsWith(`${venue.slug}-`));
    for (const [i, file] of mine.entries()) {
      const body = await readFile(new URL(file, PHOTO_DIR));
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
        altText: ALT_TEXT[venue.slug]?.[i] ?? `Photo of ${venue.name}`,
        sortOrder: i,
        status: 'READY',
      });
      photos++;
    }
    if (mine.length) venues++;
  }
  return { venues, photos };
}
