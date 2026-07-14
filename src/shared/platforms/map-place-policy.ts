/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/map-place-policy.ts
 * Generated: 2026-07-13T15:16:05.365Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

import type { MapPlaceTarget, VerifiedMapPlaceSource } from './map-places';

export type MapPlaceCountryEvidence = Pick<
  MapPlaceTarget,
  'latitude' | 'longitude' | 'locationSource'
>;

type Coordinate = readonly [longitude: number, latitude: number];

const KOREAN_PROVIDER_PRIORITY = [
  'navermap',
  'kakaomap',
  'googlemaps',
] as const satisfies readonly VerifiedMapPlaceSource[];

const GLOBAL_PROVIDER_PRIORITY = [
  'googlemaps',
] as const satisfies readonly VerifiedMapPlaceSource[];

// Deliberately inset operational polygons. False negatives are safer than
// offering Korea-only providers for a foreign or unknown place.
const SOUTH_KOREA_MAINLAND: readonly Coordinate[] = [
  [126.05, 34.45],
  [126.0, 35.5],
  [126.15, 36.6],
  [126.4, 37.5],
  [126.75, 37.85],
  [127.1, 38.05],
  [127.65, 38.25],
  [128.3, 38.45],
  [128.65, 38.6],
  [129.1, 38.35],
  [129.55, 37.5],
  [129.6, 36.0],
  [129.5, 35.05],
  [128.7, 34.45],
  [127.7, 34.2],
  [126.8, 34.2],
] as const;

const JEJU: readonly Coordinate[] = [
  [126.1, 33.1],
  [126.95, 33.1],
  [126.95, 33.65],
  [126.1, 33.65],
] as const;

const ULLEUNGDO: readonly Coordinate[] = [
  [130.75, 37.42],
  [131.0, 37.42],
  [131.0, 37.58],
  [130.75, 37.58],
] as const;

const DOKDO: readonly Coordinate[] = [
  [131.86, 37.235],
  [131.875, 37.235],
  [131.875, 37.245],
  [131.86, 37.245],
] as const;

const SOUTH_KOREA_REGIONS = [SOUTH_KOREA_MAINLAND, JEJU, ULLEUNGDO, DOKDO] as const;

function isInsidePolygon(
  longitude: number,
  latitude: number,
  polygon: readonly Coordinate[],
): boolean {
  let inside = false;
  let previous = polygon[polygon.length - 1];
  if (!previous) return false;

  for (const current of polygon) {
    const [currentLongitude, currentLatitude] = current;
    const [previousLongitude, previousLatitude] = previous;
    const crossesLatitude = (currentLatitude > latitude) !== (previousLatitude > latitude);
    if (!crossesLatitude) {
      previous = current;
      continue;
    }
    const boundaryLongitude = (
      ((previousLongitude - currentLongitude) * (latitude - currentLatitude))
      / (previousLatitude - currentLatitude)
    ) + currentLongitude;
    if (longitude < boundaryLongitude) inside = !inside;
    previous = current;
  }

  return inside;
}

export function isConservativelySouthKoreanPlace(
  place: MapPlaceCountryEvidence,
): boolean {
  if (place.locationSource === 'navermap' || place.locationSource === 'kakaomap') return true;
  const { latitude, longitude } = place;
  if (
    typeof latitude !== 'number'
    || !Number.isFinite(latitude)
    || typeof longitude !== 'number'
    || !Number.isFinite(longitude)
  ) {
    return false;
  }

  return SOUTH_KOREA_REGIONS.some((polygon) => (
    isInsidePolygon(longitude, latitude, polygon)
  ));
}

export function getMapPlaceProviderPriority(
  place: MapPlaceCountryEvidence,
): readonly VerifiedMapPlaceSource[] {
  return isConservativelySouthKoreanPlace(place)
    ? KOREAN_PROVIDER_PRIORITY
    : GLOBAL_PROVIDER_PRIORITY;
}
