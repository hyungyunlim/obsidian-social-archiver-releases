/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/map-places.ts
 * Generated: 2026-07-13T15:16:05.366Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

/**
 * Strict Korean map-place URL parsing.
 *
 * Short links are recognized separately because their provider place ID is
 * unknowable until the archive boundary expands the redirect.
 */

export type KoreanMapPlatform = 'navermap' | 'kakaomap';

export const VERIFIED_MAP_PLACE_SOURCES = [
  'googlemaps',
  'navermap',
  'kakaomap',
] as const;

export const MAP_PLACE_NAME_MAX_LENGTH = 256;

export type VerifiedMapPlaceSource = (typeof VERIFIED_MAP_PLACE_SOURCES)[number];

export type MapPlaceProvider = {
  readonly source: VerifiedMapPlaceSource;
  readonly displayLabel: string;
  readonly sourceBadge: string;
  readonly linkLabel: string;
};

export type MapPlaceTarget = {
  readonly name: string;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly locationSource?: string | null;
  readonly locationExternalId?: string | null;
};

export type MapProviderWebLink = {
  readonly provider: VerifiedMapPlaceSource;
  readonly label: string;
  readonly kind: 'exact' | 'search';
  readonly url: string;
};

const MAP_PLACE_PROVIDERS = {
  googlemaps: {
    source: 'googlemaps',
    displayLabel: 'Google Maps',
    sourceBadge: 'Google Maps',
    linkLabel: 'Google',
  },
  navermap: {
    source: 'navermap',
    displayLabel: 'Naver Map',
    sourceBadge: 'Naver Map',
    linkLabel: 'Naver',
  },
  kakaomap: {
    source: 'kakaomap',
    displayLabel: 'Kakao Map',
    sourceBadge: 'Kakao Map',
    linkLabel: 'Kakao',
  },
} as const satisfies Record<VerifiedMapPlaceSource, MapPlaceProvider>;

const PLACE_ID_PATTERN = /^\d{1,30}$/;
const GOOGLE_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const SHORT_CODE_PATTERN = /^\/[A-Za-z0-9_-]{4,128}\/?$/;

const MAP_PLACE_ID_PATTERNS = {
  googlemaps: GOOGLE_PLACE_ID_PATTERN,
  navermap: PLACE_ID_PATTERN,
  kakaomap: PLACE_ID_PATTERN,
} as const satisfies Record<VerifiedMapPlaceSource, RegExp>;

function toWellFormedMapPlaceText(value: string): string {
  return Array.from(value, (character) => {
    const codeUnit = character.charCodeAt(0);
    const isLoneSurrogate = character.length === 1 && codeUnit >= 0xD800 && codeUnit <= 0xDFFF;
    return isLoneSurrogate ? '\uFFFD' : character;
  }).join('');
}

export function encodeMapPlaceQuery(value: string): string | null {
  if (value.length > MAP_PLACE_NAME_MAX_LENGTH) return null;
  const name = value.trim();
  return name ? encodeURIComponent(toWellFormedMapPlaceText(name)) : null;
}

export const NAVER_MAP_URL_PATTERN = /^https?:\/\/(?:map\.naver\.com\/(?:p\/(?:entry\/place\/\d{1,30}|search\/[^/?#]+\/place\/\d{1,30})|v5\/entry\/place\/\d{1,30})|(?:m|pcmap)\.place\.naver\.com\/place\/\d{1,30}(?:\/home)?)\/?(?:[?#].*)?$/i;
export const KAKAO_MAP_URL_PATTERN = /^https?:\/\/(?:place\.map\.kakao\.com\/\d{1,30}|map\.kakao\.com\/link\/map\/\d{1,30})\/?(?:[?#].*)?$/i;

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractNaverPlaceId(parsed: URL): string | null {
  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'map.naver.com') {
    const directMatch = parsed.pathname.match(/^\/(?:p|v5)\/entry\/place\/(\d{1,30})\/?$/);
    if (directMatch?.[1]) return directMatch[1];

    const searchMatch = parsed.pathname.match(/^\/p\/search\/[^/]+\/place\/(\d{1,30})\/?$/);
    return searchMatch?.[1] ?? null;
  }

  if (hostname === 'm.place.naver.com' || hostname === 'pcmap.place.naver.com') {
    const mobileMatch = parsed.pathname.match(/^\/place\/(\d{1,30})(?:\/home)?\/?$/);
    return mobileMatch?.[1] ?? null;
  }

  return null;
}

function extractKakaoPlaceId(parsed: URL): string | null {
  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'place.map.kakao.com') {
    const detailMatch = parsed.pathname.match(/^\/(\d{1,30})\/?$/);
    return detailMatch?.[1] ?? null;
  }

  if (hostname === 'map.kakao.com') {
    const mapLinkMatch = parsed.pathname.match(/^\/link\/map\/(\d{1,30})\/?$/);
    return mapLinkMatch?.[1] ?? null;
  }

  return null;
}

export function isNaverMapShortUrl(value: string): boolean {
  const parsed = parseHttpUrl(value);
  if (!parsed || parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return hostname === 'naver.me' && SHORT_CODE_PATTERN.test(parsed.pathname);
}

export function isKakaoMapShortUrl(value: string): boolean {
  const parsed = parseHttpUrl(value);
  if (!parsed || parsed.protocol !== 'https:') return false;
  return parsed.hostname.toLowerCase() === 'kko.kakao.com'
    && SHORT_CODE_PATTERN.test(parsed.pathname);
}

export function extractKoreanMapPlaceId(
  platform: KoreanMapPlatform,
  value: string,
): string | null {
  const parsed = parseHttpUrl(value);
  if (!parsed) return null;

  const placeId = platform === 'navermap'
    ? extractNaverPlaceId(parsed)
    : extractKakaoPlaceId(parsed);
  return placeId && PLACE_ID_PATTERN.test(placeId) ? placeId : null;
}

export function isKoreanMapPlaceUrl(platform: KoreanMapPlatform, value: string): boolean {
  return extractKoreanMapPlaceId(platform, value) !== null;
}

export function isKoreanMapUrlCandidate(platform: KoreanMapPlatform, value: string): boolean {
  if (isKoreanMapPlaceUrl(platform, value)) return true;
  return platform === 'navermap'
    ? isNaverMapShortUrl(value)
    : isKakaoMapShortUrl(value);
}

export function canonicalizeKoreanMapPlaceUrl(
  platform: KoreanMapPlatform,
  value: string,
): string | null {
  const placeId = extractKoreanMapPlaceId(platform, value);
  if (!placeId) return null;
  return platform === 'navermap'
    ? `https://map.naver.com/p/entry/place/${placeId}`
    : `https://place.map.kakao.com/${placeId}`;
}

export function getMapPlaceProvider(
  source: string | null | undefined,
): MapPlaceProvider | null {
  const normalizedSource = source?.trim().toLowerCase();
  const verifiedSource = VERIFIED_MAP_PLACE_SOURCES.find(
    (candidate) => candidate === normalizedSource,
  );
  return verifiedSource ? MAP_PLACE_PROVIDERS[verifiedSource] : null;
}

export function isMapPlaceCardEligible(source: string | null | undefined): boolean {
  return getMapPlaceProvider(source) !== null;
}

function hasFiniteCoordinates(target: MapPlaceTarget): boolean {
  return typeof target.latitude === 'number'
    && Number.isFinite(target.latitude)
    && typeof target.longitude === 'number'
    && Number.isFinite(target.longitude);
}

function googleMapsSearchQuery(target: MapPlaceTarget): string | null {
  const nameQuery = encodeMapPlaceQuery(target.name);
  if (nameQuery) return nameQuery;
  return hasFiniteCoordinates(target) ? `${target.latitude},${target.longitude}` : null;
}

function googleMapsExactQuery(target: MapPlaceTarget): string {
  if (hasFiniteCoordinates(target)) return `${target.latitude},${target.longitude}`;
  const boundedName = target.name.slice(0, MAP_PLACE_NAME_MAX_LENGTH).trim() || 'place';
  return encodeURIComponent(toWellFormedMapPlaceText(boundedName));
}

function googleMapsSearchUrl(target: MapPlaceTarget): string | null {
  const query = googleMapsSearchQuery(target);
  return query ? `https://www.google.com/maps/search/?api=1&query=${query}` : null;
}

function googleMapsExactUrl(target: MapPlaceTarget, placeId: string): string {
  const query = googleMapsExactQuery(target);
  return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${placeId}`;
}

const EXACT_MAP_PLACE_URL_BUILDERS = {
  googlemaps: googleMapsExactUrl,
  navermap: (_target: MapPlaceTarget, placeId: string): string =>
    `https://map.naver.com/p/entry/place/${placeId}`,
  kakaomap: (_target: MapPlaceTarget, placeId: string): string =>
    `https://place.map.kakao.com/${placeId}`,
} as const satisfies Record<
  VerifiedMapPlaceSource,
  (target: MapPlaceTarget, placeId: string) => string | null
>;

export function buildExactMapPlaceUrl(target: MapPlaceTarget): string | null {
  const provider = getMapPlaceProvider(target.locationSource);
  const placeId = target.locationExternalId;
  if (!provider || !placeId || !MAP_PLACE_ID_PATTERNS[provider.source].test(placeId)) return null;
  return EXACT_MAP_PLACE_URL_BUILDERS[provider.source](target, placeId);
}

function buildMapProviderSearchUrl(
  provider: VerifiedMapPlaceSource,
  target: MapPlaceTarget,
): string | null {
  if (provider === 'googlemaps') return googleMapsSearchUrl(target);
  const query = encodeMapPlaceQuery(target.name);
  if (!query) return null;
  return provider === 'navermap'
    ? `https://map.naver.com/v5/search/${query}`
    : `https://map.kakao.com/?q=${query}`;
}

export function getMapProviderWebLink(
  provider: VerifiedMapPlaceSource,
  target: MapPlaceTarget,
): MapProviderWebLink | null {
  const metadata = MAP_PLACE_PROVIDERS[provider];
  if (getMapPlaceProvider(target.locationSource)?.source === provider) {
    const exactUrl = buildExactMapPlaceUrl(target);
    if (exactUrl) {
      return { provider, label: metadata.linkLabel, kind: 'exact', url: exactUrl };
    }
  }

  const searchUrl = buildMapProviderSearchUrl(provider, target);
  return searchUrl
    ? { provider, label: metadata.linkLabel, kind: 'search', url: searchUrl }
    : null;
}
