import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from '../src/booking.js';
import {
  boundingBox,
  distanceKm,
  googleMapsDirectionsUrl,
  googleMapsPlaceUrl,
  parseCoordinates,
} from '../src/geo.js';

const kochi = { latitude: 9.9312, longitude: 76.2673 };
const thrissur = { latitude: 10.5276, longitude: 76.2144 };

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(kochi, kochi)).toBe(0);
  });

  it('matches the known Kochi to Thrissur distance (about 66 km)', () => {
    expect(distanceKm(kochi, thrissur)).toBeCloseTo(66.5, 0);
    expect(distanceKm(thrissur, kochi)).toBeCloseTo(distanceKm(kochi, thrissur), 9);
  });
});

describe('boundingBox', () => {
  it('contains every point on the radius', () => {
    const box = boundingBox(kochi, 25);
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const rad = (bearing * Math.PI) / 180;
      // A point roughly 24.9 km away in this direction.
      const p = {
        latitude: kochi.latitude + (24.9 / 111.32) * Math.cos(rad),
        longitude:
          kochi.longitude +
          (24.9 / (111.32 * Math.cos((kochi.latitude * Math.PI) / 180))) * Math.sin(rad),
      };
      expect(distanceKm(kochi, p)).toBeLessThan(25);
      expect(p.latitude).toBeGreaterThanOrEqual(box.minLat);
      expect(p.latitude).toBeLessThanOrEqual(box.maxLat);
      expect(p.longitude).toBeGreaterThanOrEqual(box.minLon);
      expect(p.longitude).toBeLessThanOrEqual(box.maxLon);
    }
  });
});

describe('parseCoordinates', () => {
  it.each([
    ['10.0261, 76.3084', 10.0261, 76.3084],
    ['10.0261 76.3084', 10.0261, 76.3084],
    ['https://www.google.com/maps/@10.0261,76.3084,17z', 10.0261, 76.3084],
    [
      'https://www.google.com/maps/place/Hall/@10.02,76.30,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d10.0261!4d76.3084',
      10.0261,
      76.3084,
    ],
    ['https://maps.google.com/?q=10.0261,76.3084', 10.0261, 76.3084],
    ['https://www.google.com/maps/search/?api=1&query=10.0261%2C76.3084', 10.0261, 76.3084],
    ['https://maps.google.com/maps?ll=10.0261,76.3084&z=15', 10.0261, 76.3084],
  ])('reads %s', (text, latitude, longitude) => {
    expect(parseCoordinates(text)).toEqual({ latitude, longitude });
  });

  it.each(['', 'Edappally, Kochi', 'https://maps.app.goo.gl/AbCdEf123', '95, 76', '10, 200'])(
    'returns null for %s',
    (text) => {
      expect(parseCoordinates(text)).toBeNull();
    },
  );
});

describe('Google Maps links', () => {
  it('builds place and directions links from coordinates', () => {
    expect(googleMapsPlaceUrl(kochi)).toBe(
      'https://www.google.com/maps/search/?api=1&query=9.9312%2C76.2673',
    );
    expect(googleMapsDirectionsUrl(kochi)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=9.9312%2C76.2673',
    );
  });

  it('encodes an address', () => {
    expect(googleMapsPlaceUrl('Hall & Co, Kochi 682024')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Hall%20%26%20Co%2C%20Kochi%20682024',
    );
  });
});

describe('searchQuerySchema location', () => {
  it('accepts a location with a radius and distance sort', () => {
    const q = searchQuerySchema.parse({
      lat: '9.93',
      lng: '76.27',
      radiusKm: '10',
      sort: 'distance',
    });
    expect(q).toMatchObject({ lat: 9.93, lng: 76.27, radiusKm: 10, sort: 'distance' });
  });

  it.each([
    [{ lat: '9.93' }],
    [{ lng: '76.27' }],
    [{ sort: 'distance' }],
    [{ radiusKm: '10' }],
    [{ lat: '9.93', lng: '76.27', radiusKm: '0' }],
    [{ lat: '91', lng: '76.27' }],
  ])('rejects %o', (input) => {
    expect(searchQuerySchema.safeParse(input).success).toBe(false);
  });
});
