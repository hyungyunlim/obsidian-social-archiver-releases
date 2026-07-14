import {
  MAP_PLACE_NAME_MAX_LENGTH,
  VERIFIED_MAP_PLACE_SOURCES,
  buildExactMapPlaceUrl,
  getMapPlaceProvider,
  getMapProviderWebLink,
  isMapPlaceCardEligible,
} from '../../../shared/platforms/map-places';
import {
  getMapPlaceProviderPriority,
  isConservativelySouthKoreanPlace,
} from '../../../shared/platforms/map-place-policy';
import { getMapProviderWebLinks } from '../../../shared/platforms/map-place-links';

describe('map-place provider contract', () => {
  it.each([
    ['Seoul', 37.5665, 126.978],
    ['Jeju', 33.4996, 126.5312],
    ['Dokdo', 37.24, 131.87],
  ] as const)('classifies %s coordinates as conservatively South Korean', (_name, latitude, longitude) => {
    // Given: coordinates in a supported South Korean region
    // When: the shared country policy evaluates the place
    const isSouthKorean = isConservativelySouthKoreanPlace({
      name: 'Place',
      latitude,
      longitude,
      locationSource: 'instagram',
    });

    // Then: Korea-only providers are allowed
    expect(isSouthKorean).toBe(true);
  });

  it.each([
    ['Kaesong', 37.9708, 126.5544],
    ['Tsushima', 34.2025, 129.2875],
    ['unknown', null, null],
  ] as const)('does not classify %s as South Korean without authoritative evidence', (_name, latitude, longitude) => {
    // Given: foreign or missing coordinates without a verified Korean provider
    // When: the shared country policy evaluates the place
    const priority = getMapPlaceProviderPriority({
      name: 'Place',
      latitude,
      longitude,
      locationSource: 'instagram',
    });

    // Then: only the global provider is offered
    expect(priority).toEqual(['googlemaps']);
  });

  it.each(['navermap', 'kakaomap'] as const)(
    'treats a verified %s identity as authoritative Korea evidence',
    (locationSource) => {
      // Given: a verified Korean provider identity without coordinates
      // When: the shared provider policy resolves choices
      const priority = getMapPlaceProviderPriority({
        name: 'Verified place',
        latitude: null,
        longitude: null,
        locationSource,
      });

      // Then: Korean providers retain priority before Google
      expect(priority).toEqual(['navermap', 'kakaomap', 'googlemaps']);
    },
  );

  it('filters and orders provider search links through the shared country policy', () => {
    // Given: one Korean place and one unverified place with no coordinates
    // When: all eligible outbound provider links are built
    const koreanLinks = getMapProviderWebLinks({
      name: '서울숲',
      latitude: 37.5443,
      longitude: 127.0374,
      locationSource: 'instagram',
    });
    const unknownLinks = getMapProviderWebLinks({
      name: 'Unknown place',
      locationSource: 'instagram',
    });

    // Then: Korea uses Naver, Kakao, Google priority while unknown uses Google only
    expect(koreanLinks.map((link) => link.provider)).toEqual([
      'navermap',
      'kakaomap',
      'googlemaps',
    ]);
    expect(unknownLinks.map((link) => link.provider)).toEqual(['googlemaps']);
  });

  it.each([
    ['googlemaps', 'Google Maps', 'Google'],
    ['navermap', 'Naver Map', 'Naver'],
    ['kakaomap', 'Kakao Map', 'Kakao'],
  ] as const)(
    'exposes verified metadata for %s',
    (source, displayLabel, linkLabel) => {
      // Given: a provider-owned map archive source
      // When: the shared provider metadata is resolved
      const provider = getMapPlaceProvider(source);

      // Then: cards and source badges use the verified provider contract
      expect(provider).toEqual({ source, displayLabel, sourceBadge: displayLabel, linkLabel });
      expect(isMapPlaceCardEligible(source)).toBe(true);
    },
  );

  it.each([
    ['googlemaps', 'ChIJbaseline', 'https://www.google.com/maps/search/?api=1&query=%EC%84%B1%EC%88%98%20%EC%B9%B4%ED%8E%98&query_place_id=ChIJbaseline'],
    ['navermap', '1234567890', 'https://map.naver.com/p/entry/place/1234567890'],
    ['kakaomap', '9876543210', 'https://place.map.kakao.com/9876543210'],
  ] as const)('characterizes the canonical %s provider-link output', (source, id, expected) => {
    // Given: a provider-owned place with a valid external identity
    // When: the canonical provider action link is resolved
    const link = getMapProviderWebLink(source, {
      name: '성수 카페',
      locationSource: source,
      locationExternalId: id,
    });

    // Then: the helper exposes the existing exact URL contract
    expect(link).toMatchObject({ provider: source, kind: 'exact', url: expected });
  });

  it('keeps the verified source set explicit and rejects unsupported sources', () => {
    // Given: the complete provider set and an unrelated archive source
    // When: eligibility and metadata are queried
    const unsupportedProvider = getMapPlaceProvider('instagram');

    // Then: only the three map providers are card eligible
    expect(VERIFIED_MAP_PLACE_SOURCES).toEqual(['googlemaps', 'navermap', 'kakaomap']);
    expect(unsupportedProvider).toBeNull();
    expect(isMapPlaceCardEligible('instagram')).toBe(false);
    expect(isMapPlaceCardEligible(null)).toBe(false);
  });

  it.each([
    [' GOOGLEMAPS ', 'googlemaps'],
    ['NaverMap', 'navermap'],
    [' kakaomap ', 'kakaomap'],
  ] as const)('normalizes canonical source casing at the provider boundary', (input, expected) => {
    // Given: a canonical provider source with transport-level casing or whitespace drift
    // When: provider metadata is resolved at the shared boundary
    const provider = getMapPlaceProvider(input);

    // Then: card internals receive only the canonical source union
    expect(provider?.source).toBe(expected);
  });

  it.each(['google', 'google-maps', 'naver', 'kakao', 'instagram'])(
    'rejects the unsupported provider alias %s at the shared boundary',
    (alias) => {
      // Given: an alias that is not part of the persisted canonical source contract
      // When: provider metadata is resolved
      const provider = getMapPlaceProvider(alias);

      // Then: the alias cannot select a provider action
      expect(provider).toBeNull();
    },
  );

  it.each([
    {
      source: 'googlemaps',
      id: 'ChIJabc_123',
      name: '카페 서울',
      expected:
        'https://www.google.com/maps/search/?api=1&query=%EC%B9%B4%ED%8E%98%20%EC%84%9C%EC%9A%B8&query_place_id=ChIJabc_123',
    },
    {
      source: 'navermap',
      id: '1234567890',
      name: '카페 서울',
      expected: 'https://map.naver.com/p/entry/place/1234567890',
    },
    {
      source: 'kakaomap',
      id: '987654321',
      name: '카페 서울',
      expected: 'https://place.map.kakao.com/987654321',
    },
  ] as const)('builds an exact canonical URL for $source', ({ source, id, name, expected }) => {
    // Given: a verified source with a provider-valid external ID
    // When: its exact outbound link is built
    const url = buildExactMapPlaceUrl({ name, locationSource: source, locationExternalId: id });

    // Then: the URL points to that exact provider identity
    expect(url).toBe(expected);
  });

  it('keeps the existing coordinate-based Google URL unchanged', () => {
    // Given: an exact Google place with representative coordinates
    // When: its exact outbound link is built
    const url = buildExactMapPlaceUrl({
      name: 'Cafe',
      latitude: 37.5,
      longitude: 127.25,
      locationSource: 'googlemaps',
      locationExternalId: 'ChIJabc',
    });

    // Then: the established query_place_id URL shape remains unchanged
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=37.5,127.25&query_place_id=ChIJabc',
    );
  });

  it('ignores non-finite coordinates instead of emitting a malformed Google query', () => {
    // Given: an exact Google identity with unusable numeric coordinates
    // When: its exact outbound link is built
    const url = buildExactMapPlaceUrl({
      name: '카페 서울',
      latitude: Number.NaN,
      longitude: Number.POSITIVE_INFINITY,
      locationSource: 'googlemaps',
      locationExternalId: 'ChIJabc',
    });

    // Then: the encoded place name becomes the safe query
    expect(url).toBe(
      'https://www.google.com/maps/search/?api=1&query=%EC%B9%B4%ED%8E%98%20%EC%84%9C%EC%9A%B8&query_place_id=ChIJabc',
    );
  });

  it.each([
    ['navermap', 'abc123'],
    ['navermap', '123/456'],
    ['kakaomap', '123?redirect=https://example.com'],
    ['kakaomap', '１２３'],
	['kakaomap', '1234567890123456789012345678901'],
    ['googlemaps', 'ChIJabc&query_place_id=forged'],
    ['googlemaps', ' ChIJabc'],
    ['navermap', '123 '],
    ['kakaomap', '\t123'],
  ] as const)('does not forge an exact %s path for invalid ID %s', (source, id) => {
    // Given: a verified source with a malformed external ID
    // When: its exact outbound link is built
    const url = buildExactMapPlaceUrl({
      name: '안전한 장소',
      locationSource: source,
      locationExternalId: id,
    });

    // Then: no provider path is emitted
    expect(url).toBeNull();
  });

  it.each([
    { source: 'navermap', id: null },
    { source: 'kakaomap', id: '' },
    { source: 'instagram', id: '123' },
    { source: null, id: null },
  ] as const)('returns no exact link for source=$source id=$id', ({ source, id }) => {
    // Given: a place without a verified provider identity
    // When: an exact outbound link is requested
    const url = buildExactMapPlaceUrl({
      name: '카페 & 베이커리/서울',
      locationSource: source,
      locationExternalId: id,
    });

    // Then: the contract refuses to claim a canonical identity
    expect(url).toBeNull();
  });

  it('falls back to an encoded name search without claiming an exact identity', () => {
    // Given: an unsupported source and a Unicode place name with URL delimiters
    // When: a Naver outbound link is resolved
    const link = getMapProviderWebLink('navermap', {
      name: '카페 & 베이커리/서울',
      locationSource: 'instagram',
      locationExternalId: '123',
    });

    // Then: a typed search link is returned, never a forged place path
    expect(link).toEqual({
      provider: 'navermap',
      label: 'Naver',
      kind: 'search',
      url: 'https://map.naver.com/v5/search/%EC%B9%B4%ED%8E%98%20%26%20%EB%B2%A0%EC%9D%B4%EC%BB%A4%EB%A6%AC%2F%EC%84%9C%EC%9A%B8',
    });
  });

  it.each([
    [
      'googlemaps',
      'https://www.google.com/maps/search/?api=1&query=%EF%BF%BD%20%EC%B9%B4%ED%8E%98',
    ],
    [
      'navermap',
      'https://map.naver.com/v5/search/%EF%BF%BD%20%EC%B9%B4%ED%8E%98',
    ],
    [
      'kakaomap',
      'https://map.kakao.com/?q=%EF%BF%BD%20%EC%B9%B4%ED%8E%98',
    ],
  ] as const)('replaces a lone surrogate before encoding a %s search', (provider, expected) => {
    // Given: an untrusted place name containing an unpaired UTF-16 surrogate
    // When: a provider search link is resolved
    const link = getMapProviderWebLink(provider, {
      name: '\uD800 카페',
      locationSource: 'instagram',
    });

    // Then: encoding succeeds with the Unicode replacement character
    expect(link?.url).toBe(expected);
  });

  it('returns no fallback when a place has neither an exact ID nor a usable name', () => {
    // Given: an invalid provider ID and an empty place name
    // When: a provider link is resolved
    const link = getMapProviderWebLink('kakaomap', {
      name: '   ',
      locationSource: 'kakaomap',
      locationExternalId: 'not-numeric',
    });

    // Then: no unsafe or meaningless deep-link is produced
    expect(link).toBeNull();
  });

  it('rejects one-million-unit names before building provider searches', () => {
    // Given: a place name far beyond the shared resource boundary
    const name = 'a'.repeat(1_000_000);

    // When: each provider search fallback is resolved
    const rejected = VERIFIED_MAP_PLACE_SOURCES.map((provider) =>
      getMapProviderWebLink(provider, { name, locationSource: 'instagram' }) === null);

    // Then: no provider normalizes or encodes the oversized input
    expect(MAP_PLACE_NAME_MAX_LENGTH).toBe(256);
    expect(rejected).toEqual([true, true, true]);
  });

  it('keeps exact IDs while bounding an oversized Google name query', () => {
    // Given: exact provider IDs paired with a one-million-unit name
    const name = 'a'.repeat(1_000_000);

    // When: exact links are built
    const google = buildExactMapPlaceUrl({
      name,
      locationSource: 'googlemaps',
      locationExternalId: 'ChIJabc',
    });
    const naver = buildExactMapPlaceUrl({
      name,
      locationSource: 'navermap',
      locationExternalId: '123',
    });
    const kakao = buildExactMapPlaceUrl({
      name,
      locationSource: 'kakaomap',
      locationExternalId: '456',
    });

    // Then: Korean providers ignore the name and Google encodes only its bounded prefix
    const expectedGoogleLength =
      'https://www.google.com/maps/search/?api=1&query=&query_place_id=ChIJabc'.length
      + MAP_PLACE_NAME_MAX_LENGTH;
    expect(google?.length).toBe(expectedGoogleLength);
    expect(naver).toBe('https://map.naver.com/p/entry/place/123');
    expect(kakao).toBe('https://place.map.kakao.com/456');
  });
});
