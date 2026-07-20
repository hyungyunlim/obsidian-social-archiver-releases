export const MAP_SEARCH_PROVIDER_PREFERENCES = [
  'auto',
  'kakaomap',
  'googlemaps',
] as const;

export type MapSearchProviderPreference = (typeof MAP_SEARCH_PROVIDER_PREFERENCES)[number];
export type MapSearchProvider = Exclude<MapSearchProviderPreference, 'auto'>;
export type MapSearchProviderAvailability = 'available' | 'unavailable';

export type MapSearchProviderResolution = {
  readonly provider: MapSearchProvider;
  readonly availability: MapSearchProviderAvailability;
};

export const MAP_SEARCH_PROVIDERS = [
  'kakaomap',
  'googlemaps',
] as const satisfies readonly MapSearchProvider[];

const MAP_SEARCH_PROVIDER_ID_PATTERNS = {
  kakaomap: /^\d{1,30}$/,
  googlemaps: /^[A-Za-z0-9_-]{1,255}$/,
} as const satisfies Record<MapSearchProvider, RegExp>;

export function isMapSearchProviderExternalId(
  provider: MapSearchProvider,
  externalId: string,
): boolean {
  return MAP_SEARCH_PROVIDER_ID_PATTERNS[provider].test(externalId);
}

export function buildCanonicalMapSearchProviderUrl(
  provider: MapSearchProvider,
  externalId: string,
): string | null {
  if (!isMapSearchProviderExternalId(provider, externalId)) return null;
  switch (provider) {
    case 'kakaomap':
      return `https://place.map.kakao.com/${externalId}`;
    case 'googlemaps':
      return `https://www.google.com/maps/search/?api=1&query=place&query_place_id=${externalId}`;
    default:
      return assertNeverMapSearchProvider(provider);
  }
}

export function isCanonicalMapSearchProviderUrl(
  provider: MapSearchProvider,
  externalId: string,
  url: string,
): boolean {
  return buildCanonicalMapSearchProviderUrl(provider, externalId) === url;
}

function assertNeverMapSearchProvider(provider: never): never {
  throw new TypeError(`Unhandled map search provider: ${String(provider)}`);
}

export function isMapSearchProviderPreference(
  value: unknown,
): value is MapSearchProviderPreference {
  return typeof value === 'string'
    && MAP_SEARCH_PROVIDER_PREFERENCES.some((provider) => provider === value);
}

export function resolveMapSearchProvider(
  preference: MapSearchProviderPreference | null | undefined,
  locale: string | null | undefined,
  availability: Readonly<Partial<Record<MapSearchProvider, boolean>>> = {},
): MapSearchProviderResolution {
  const normalizedLocale = locale?.trim().replaceAll('_', '-').toLowerCase();
  const provider = preference === 'kakaomap' || preference === 'googlemaps'
    ? preference
    : normalizedLocale === 'ko' || normalizedLocale?.startsWith('ko-') === true
      ? 'kakaomap'
      : 'googlemaps';

  return {
    provider,
    availability: availability[provider] === false ? 'unavailable' : 'available',
  };
}
