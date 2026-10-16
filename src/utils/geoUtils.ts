import { Observation } from '../types';

export interface CoordinateValidationResult {
  valid: boolean;
  latitude?: number;
  longitude?: number;
  error?: string;
}

/**
 * Validates latitude (-90 to 90) and longitude (-180 to 180) coordinates.
 * Handles string conversion, numeric boundaries, non-numeric values, and null/undefined values.
 * Coordinates are optional when saving; if both are omitted, valid: true with undefined lat/lng is returned.
 * If one coordinate is provided without the other, or values fall outside bounds, an error is returned.
 */
export function validateCoordinates(
  latInput: unknown,
  lngInput: unknown,
  options: { required?: boolean } = {}
): CoordinateValidationResult {
  const isLatEmpty =
    latInput === undefined || latInput === null || (typeof latInput === 'string' && latInput.trim() === '');
  const isLngEmpty =
    lngInput === undefined || lngInput === null || (typeof lngInput === 'string' && lngInput.trim() === '');

  // Both empty
  if (isLatEmpty && isLngEmpty) {
    if (options.required) {
      return {
        valid: false,
        error: 'Latitude and longitude coordinates are required.',
      };
    }
    return { valid: true, latitude: undefined, longitude: undefined };
  }

  // Only one provided
  if (isLatEmpty !== isLngEmpty) {
    return {
      valid: false,
      error: 'Both latitude and longitude must be provided together.',
    };
  }

  const latNum = typeof latInput === 'number' ? latInput : Number(latInput);
  const lngNum = typeof lngInput === 'number' ? lngInput : Number(lngInput);

  if (isNaN(latNum) || !isFinite(latNum)) {
    return {
      valid: false,
      error: 'Latitude must be a valid finite numeric value.',
    };
  }

  if (isNaN(lngNum) || !isFinite(lngNum)) {
    return {
      valid: false,
      error: 'Longitude must be a valid finite numeric value.',
    };
  }

  if (latNum < -90 || latNum > 90) {
    return {
      valid: false,
      error: `Latitude ${latNum} is outside valid range [-90.0, 90.0].`,
    };
  }

  if (lngNum < -180 || lngNum > 180) {
    return {
      valid: false,
      error: `Longitude ${lngNum} is outside valid range [-180.0, 180.0].`,
    };
  }

  return {
    valid: true,
    latitude: latNum,
    longitude: lngNum,
  };
}

/**
 * Checks if an observation has valid numeric coordinates within global geographic bounds.
 */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

/**
 * Filter an array of observations to only those with valid geographic coordinates.
 */
export function getValidObservations(observations: Observation[]): Observation[] {
  return observations.filter((obs) => isValidCoordinate(obs.latitude, obs.longitude));
}

export interface MapExtentResult {
  center: [number, number];
  zoom: number;
  bounds?: [[number, number], [number, number]];
  isSinglePoint: boolean;
  hasObservations: boolean;
}

/**
 * Calculates geographic extent, center, and optimal zoom level for a given list of observations.
 * - 0 observations: returns neutral global overview ([20, 0], zoom: 2) with hasObservations: false.
 * - 1 observation: centers exactly on that observation with zoom: 13.
 * - Multiple observations in the same vicinity (max delta < 0.005 deg): centers on average point with zoom: 13.
 * - Multiple observations across regions/cities: computes bounding box [[minLat, minLng], [maxLat, maxLng]]
 *   with appropriate padding and clamped zoom.
 */
export function calculateMapExtent(observations: Observation[]): MapExtentResult {
  const valid = getValidObservations(observations);

  if (valid.length === 0) {
    return {
      center: [20, 0],
      zoom: 2,
      isSinglePoint: false,
      hasObservations: false,
    };
  }

  if (valid.length === 1) {
    const lat = valid[0].latitude as number;
    const lng = valid[0].longitude as number;
    return {
      center: [lat, lng],
      zoom: 13,
      isSinglePoint: true,
      hasObservations: true,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let sumLat = 0;
  let sumLng = 0;

  for (const obs of valid) {
    const lat = obs.latitude as number;
    const lng = obs.longitude as number;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    sumLat += lat;
    sumLng += lng;
  }

  const avgLat = sumLat / valid.length;
  const avgLng = sumLng / valid.length;

  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;

  // If all points are essentially identical (e.g. cluster at the same station)
  if (latSpan < 0.002 && lngSpan < 0.002) {
    return {
      center: [avgLat, avgLng],
      zoom: 13,
      isSinglePoint: true,
      hasObservations: true,
    };
  }

  // Calculate approximate zoom level based on bounding box span
  const maxSpan = Math.max(latSpan, lngSpan);
  let zoom = 12;
  if (maxSpan > 60) zoom = 2;
  else if (maxSpan > 30) zoom = 3;
  else if (maxSpan > 15) zoom = 4;
  else if (maxSpan > 8) zoom = 5;
  else if (maxSpan > 4) zoom = 6;
  else if (maxSpan > 2) zoom = 7;
  else if (maxSpan > 1) zoom = 9;
  else if (maxSpan > 0.5) zoom = 10;
  else if (maxSpan > 0.1) zoom = 11;

  return {
    center: [avgLat, avgLng],
    zoom,
    bounds: [
      [minLat, minLng],
      [maxLat, maxLng],
    ],
    isSinglePoint: false,
    hasObservations: true,
  };
}

/**
 * Format a latitude and longitude pair cleanly for display in the UI.
 */
export function formatCoordinatePair(lat?: number, lng?: number): string {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return 'Coordinates unavailable';
  }
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}
