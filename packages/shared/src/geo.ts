export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance in kilometres. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A latitude/longitude box that contains every point within `radiusKm` of `centre`. */
export function boundingBox(
  centre: Coordinates,
  radiusKm: number,
): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  const dLat = radiusKm / 111.32;
  const cos = Math.cos(toRad(centre.latitude));
  const dLon = cos > 1e-6 ? radiusKm / (111.32 * cos) : 180;
  return {
    minLat: centre.latitude - dLat,
    maxLat: centre.latitude + dLat,
    minLon: centre.longitude - dLon,
    maxLon: centre.longitude + dLon,
  };
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const PATTERNS: RegExp[] = [
  // The pin of a place link: …!3d10.0261!4d76.3084…
  new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
  // Query parameters: ?q=, ?query=, ?ll=, ?destination=, ?center=
  new RegExp(
    String.raw`[?&](?:q|query|ll|destination|center|daddr)=(?:loc:)?${NUM}(?:,|%2C)\s*${NUM}`,
    'i',
  ),
  // The map centre of a browser URL: /@10.0261,76.3084,17z
  new RegExp(String.raw`@${NUM},${NUM}`),
  // Plain text: "10.0261, 76.3084"
  new RegExp(String.raw`^\s*${NUM}\s*[,\s]\s*${NUM}\s*$`),
];

/**
 * Reads coordinates from "lat, lng" text or a full Google Maps link. Short links
 * (maps.app.goo.gl) carry no coordinates and return null.
 */
export function parseCoordinates(text: string): Coordinates | null {
  const input = text.trim();
  if (!input || input.length > 2000) return null;
  for (const re of PATTERNS) {
    const m = re.exec(input);
    if (!m) continue;
    const latitude = Number(m[1]);
    const longitude = Number(m[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
  }
  return null;
}

const coordText = (c: Coordinates): string => `${c.latitude},${c.longitude}`;

/** Opens the place in Google Maps (app on phones, website elsewhere). No API key needed. */
export function googleMapsPlaceUrl(target: Coordinates | string): string {
  const query = typeof target === 'string' ? target : coordText(target);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Turn-by-turn directions from the user's current position to the venue. */
export function googleMapsDirectionsUrl(target: Coordinates | string): string {
  const destination = typeof target === 'string' ? target : coordText(target);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
