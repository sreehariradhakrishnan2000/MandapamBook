import { existsSync } from 'node:fs';
import { distanceKm } from '@mandapambook/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  KERALA_DISTRICTS,
  KERALA_TEST_AUDITORIUMS,
  KERALA_TEST_OWNERS,
  STOCK_PHOTOS,
  stockPhotosFor,
} from '../../src/db/seed/kerala-test-venues.js';
import { AMENITIES, CITIES } from '../../src/db/seed/master-data.js';
import { SAMPLE_AUDITORIUMS, SAMPLE_OWNERS } from '../../src/db/seed/sample-data.js';

const stockDir = new URL('../../src/db/seed/photos/stock/', import.meta.url);

describe('Kerala test venues', () => {
  it('has 10 venues in each of the 14 districts, each in a different town', () => {
    expect(KERALA_DISTRICTS).toHaveLength(14);
    expect(KERALA_TEST_AUDITORIUMS).toHaveLength(140);
    for (const d of KERALA_DISTRICTS) {
      const mine = KERALA_TEST_AUDITORIUMS.filter((v) => v.citySlug === d.citySlug);
      expect(mine, d.name).toHaveLength(10);
      expect(new Set(mine.map((v) => v.locality)).size, d.name).toBe(10);
      expect(new Set(mine.map((v) => v.name)).size, `${d.name} names`).toBe(10);
    }
  });

  it('uses only known cities and amenities, and unique slugs', () => {
    const citySlugs = new Set(CITIES.filter((c) => c.state === 'Kerala').map((c) => c.slug));
    const amenityCodes = new Set(AMENITIES.map((a) => a.code));
    const slugs = [...KERALA_TEST_AUDITORIUMS, ...SAMPLE_AUDITORIUMS].map((v) => v.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const v of KERALA_TEST_AUDITORIUMS) {
      expect(citySlugs.has(v.citySlug), v.slug).toBe(true);
      expect(v.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      for (const code of v.amenities) expect(amenityCodes.has(code), code).toBe(true);
      expect(new Set(v.addons.map((a) => a.code)).size).toBe(v.addons.length);
    }
  });

  it('places each venue in its town, with valid PIN codes and Kerala coordinates', () => {
    for (const d of KERALA_DISTRICTS) {
      for (const town of d.towns) {
        const v = KERALA_TEST_AUDITORIUMS.find(
          (x) => x.citySlug === d.citySlug && x.locality === town.locality,
        )!;
        expect(v.pincode).toMatch(/^6[789]\d{4}$/); // Kerala PIN codes start 67–69
        expect(v.latitude).toBeGreaterThan(8.1);
        expect(v.latitude).toBeLessThan(12.8);
        expect(v.longitude).toBeGreaterThan(74.8);
        expect(v.longitude).toBeLessThan(77.4);
        expect(distanceKm(town, v)).toBeLessThan(1.3);
      }
    }
  });

  it('has sensible halls, prices and policies', () => {
    for (const v of KERALA_TEST_AUDITORIUMS) {
      expect(v.halls.length).toBeGreaterThan(0);
      for (const h of v.halls) {
        expect(h.seatingCapacity).toBeGreaterThan(0);
        expect(h.diningCapacity).toBeLessThanOrEqual(h.seatingCapacity);
        for (const rupees of Object.values(h.baseRupees)) {
          expect(Number.isInteger(rupees)).toBe(true);
          expect(rupees).toBeGreaterThanOrEqual(5000);
        }
        expect(h.baseRupees.FULL_DAY).toBeGreaterThan(h.baseRupees.MORNING);
      }
      expect(v.advancePercent).toBeGreaterThanOrEqual(10);
      expect(v.cancellationTiers.at(-1)).toEqual({ minDaysBefore: 0, refundPercent: 0 });
      expect(v.description).toContain('Test listing');
    }
  });

  it('gives every district its own owner on the .test domain', () => {
    expect(KERALA_TEST_OWNERS).toHaveLength(14);
    const all = [...KERALA_TEST_OWNERS, ...SAMPLE_OWNERS];
    expect(new Set(all.map((o) => o.email)).size).toBe(all.length);
    expect(new Set(all.map((o) => o.phone)).size).toBe(all.length);
    for (const o of KERALA_TEST_OWNERS) {
      expect(o.email).toMatch(/@example\.test$/);
      expect(o.phone).toMatch(/^\+91[6-9]\d{9}$/);
    }
  });

  it('gives each venue two different stock photos that exist on disk', () => {
    for (const [file] of STOCK_PHOTOS) expect(existsSync(new URL(file, stockDir)), file).toBe(true);
    KERALA_TEST_AUDITORIUMS.forEach((_, i) => {
      const [a, b] = stockPhotosFor(i);
      expect(a![0]).not.toBe(b![0]);
    });
  });

  it('is the same on every run', async () => {
    vi.resetModules();
    const again = await import('../../src/db/seed/kerala-test-venues.js');
    expect(again.KERALA_TEST_AUDITORIUMS).not.toBe(KERALA_TEST_AUDITORIUMS); // freshly built
    expect(again.KERALA_TEST_AUDITORIUMS).toEqual(KERALA_TEST_AUDITORIUMS);
  });
});
