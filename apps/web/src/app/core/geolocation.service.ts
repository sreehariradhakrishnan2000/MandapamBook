import { Injectable } from '@angular/core';
import type { Coordinates } from '@mandapambook/shared';

export class LocationError extends Error {}

/** Rounds to 3 decimals (about 100 m): enough to find nearby halls, without a home address. */
const round = (n: number): number => Math.round(n * 1000) / 1000;

/** The browser's current position, asked for only when the user presses a button. */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  current(options: { precise?: boolean } = {}): Promise<Coordinates> {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geo) {
      return Promise.reject(new LocationError('This browser cannot share your location.'));
    }
    return new Promise((resolve, reject) => {
      geo.getCurrentPosition(
        ({ coords }) =>
          resolve(
            options.precise
              ? { latitude: coords.latitude, longitude: coords.longitude }
              : { latitude: round(coords.latitude), longitude: round(coords.longitude) },
          ),
        (err) =>
          reject(
            new LocationError(
              err.code === err.PERMISSION_DENIED
                ? 'Location access is blocked. Allow it for this site in your browser settings, or choose a city.'
                : err.code === err.TIMEOUT
                  ? 'Finding your location took too long. Try again.'
                  : 'Your location is not available right now. Try again or choose a city.',
            ),
          ),
        { enableHighAccuracy: !!options.precise, timeout: 15_000, maximumAge: 300_000 },
      );
    });
  }
}
