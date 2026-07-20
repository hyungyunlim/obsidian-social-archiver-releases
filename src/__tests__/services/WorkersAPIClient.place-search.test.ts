import { __setRequestUrlHandler } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';

const SEARCH_RESPONSE = {
  provider: 'kakaomap',
  query: '희작',
  page: 1,
  size: 15,
  isEnd: true,
  pageableCount: 1,
  totalCount: 1,
  attribution: {
    provider: 'Kakao',
    label: 'Search results provided by Kakao',
    url: 'https://developers.kakao.com/',
  },
  results: [{
    provider: 'kakaomap',
    externalId: '1234',
    name: '희작',
    categoryName: '음식점 > 카페',
    categoryGroupCode: 'CE7',
    categoryGroupName: '카페',
    address: '서울 종로구 부암동',
    roadAddress: '서울 종로구 백석동길 155',
    latitude: 37.1,
    longitude: 126.9,
    phone: '02-123-4567',
    placeUrl: 'https://place.map.kakao.com/1234',
    selectionToken: 'signed.selection.token',
  }],
} as const;

const GOOGLE_SEARCH_RESPONSE = {
  provider: 'googlemaps',
  query: 'Blue Bottle',
  size: 5,
  attribution: {
    provider: 'Google',
    label: 'Search results provided by Google',
    url: 'https://developers.google.com/maps',
  },
  pagination: { kind: 'cursor', nextCursor: 'next-page-token' },
  cloudCredit: { remaining: 17 },
  results: [{
    provider: 'googlemaps',
    externalId: 'ChIJ-google-place',
    displayName: 'Blue Bottle Coffee',
    formattedAddress: '1 Ferry Building, San Francisco, CA',
    latitude: 37.7955,
    longitude: -122.3937,
    primaryType: 'cafe',
    selectionToken: 'signed.google.selection.token',
  }],
} as const;

afterEach(() => __setRequestUrlHandler(null));

function createClient(): WorkersAPIClient {
  const client = new WorkersAPIClient({
    endpoint: 'https://worker.example',
    authToken: 'user-token',
    clientId: 'obsidian-client',
  });
  client.initialize();
  return client;
}

describe('WorkersAPIClient place search', () => {
  it('posts the bounded Kakao search contract and parses signed results', async () => {
    // Given: an authenticated client and a valid Worker response.
    let observedBody: string | undefined;
    __setRequestUrlHandler(async (request) => {
      observedBody = request.body;
      return {
        status: 200,
        headers: {},
        text: '',
        json: { success: true, data: SEARCH_RESPONSE },
        arrayBuffer: new ArrayBuffer(0),
      };
    });

    // When: the plugin searches for a place.
    const response = await createClient().searchProviderPlaces({
      provider: 'kakaomap',
      query: ' 희작 ',
      page: 1,
      size: 15,
    });

    // Then: the request uses Kakao and the candidate retains its signed token.
    expect(JSON.parse(observedBody ?? '')).toEqual({
      provider: 'kakaomap',
      query: '희작',
      page: 1,
      size: 15,
    });
    expect(response.results[0]?.selectionToken).toBe('signed.selection.token');
  });

  it('posts the bounded Google cursor contract and retains attribution and Cloud-credit remaining', async () => {
    // Given: an authenticated client and a valid Google response.
    let observedBody: string | undefined;
    __setRequestUrlHandler(async (request) => {
      observedBody = request.body;
      return {
        status: 200,
        headers: {},
        text: '',
        json: { success: true, data: GOOGLE_SEARCH_RESPONSE },
        arrayBuffer: new ArrayBuffer(0),
      };
    });

    // When: the plugin loads the next Google result page.
    const response = await createClient().searchProviderPlaces({
      provider: 'googlemaps',
      query: ' Blue Bottle ',
      languageCode: 'en-US',
      nextCursor: 'next-page-token',
      size: 5,
    });

    // Then: no Kakao page field is sent and the charged-page metadata remains visible.
    expect(JSON.parse(observedBody ?? '')).toEqual({
      provider: 'googlemaps',
      query: 'Blue Bottle',
      languageCode: 'en-US',
      nextCursor: 'next-page-token',
      size: 5,
    });
    expect(response).toMatchObject({
      provider: 'googlemaps',
      pagination: { kind: 'cursor', nextCursor: 'next-page-token' },
      cloudCredit: { remaining: 17 },
    });
  });

  it('submits only the signed token and idempotency key for provider selection', async () => {
    // Given: a signed candidate and a source archive.
    let observedBody: string | undefined;
    let observedUrl = '';
    __setRequestUrlHandler(async (request) => {
      observedUrl = request.url;
      observedBody = request.body;
      return {
        status: 200,
        headers: {},
        text: '',
        json: {
          success: true,
          data: {
            sourceArchiveId: 'source-1',
            targetArchiveId: 'place-1',
            enrichment: 'queued',
            place: {
              provider: 'kakaomap',
              externalId: '1234',
              name: '희작',
              category: '카페',
              address: '서울 종로구 백석동길 155',
              latitude: 37.1,
              longitude: 126.9,
              phone: '',
              canonicalUrl: 'http://place.map.kakao.com/1234',
            },
          },
        },
        arrayBuffer: new ArrayBuffer(0),
      };
    });

    // When: the candidate is selected.
    const response = await createClient().selectProviderPlace({
      archiveId: 'source-1',
      selectionToken: 'signed.selection.token',
      idempotencyKey: 'place-select:request-1',
      expectedPlace: { provider: 'kakaomap', externalId: '1234' },
    });

    // Then: no raw name, address, coordinates, or provider ID cross the authority boundary.
    expect(observedUrl).toBe('https://worker.example/api/user/archives/source-1/place-from-provider');
    expect(JSON.parse(observedBody ?? '')).toEqual({
      selectionToken: 'signed.selection.token',
      idempotencyKey: 'place-select:request-1',
    });
    expect(response.enrichment).toBe('queued');
    expect(response.place.provider === 'kakaomap' ? response.place.canonicalUrl : null)
      .toBe('http://place.map.kakao.com/1234');
  });

  it('attaches provider metadata without sending place fields or accepting a target archive', async () => {
    let observedBody = '';
    let observedUrl = '';
    __setRequestUrlHandler(async (request) => {
      observedUrl = request.url;
      observedBody = request.body ?? '';
      const location = {
        id: 'location-1', archiveId: 'source-1', placeKey: 'kakaomap:1234', name: '희작',
        address: '서울 종로구', latitude: 37.1, longitude: 126.9, source: 'kakaomap',
        externalId: '1234', url: 'https://place.map.kakao.com/1234', category: '카페',
        isPrimary: true, sortOrder: 0, placeArchiveId: null, promotionStatus: 'metadata_only',
        createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
      };
      return {
        status: 200, headers: {}, text: '', arrayBuffer: new ArrayBuffer(0),
        json: { success: true, data: {
          sourceArchiveId: 'source-1', locationId: 'location-1', intent: 'attach_location',
          location, enrichment: 'not_requested',
        } },
      };
    });

    const result = await createClient().attachProviderLocation(
      'source-1', 'signed.selection.token', 'location-attach:request-1',
    );

    expect(observedUrl).toBe('https://worker.example/api/user/archives/source-1/location-from-provider');
    expect(JSON.parse(observedBody)).toEqual({
      selectionToken: 'signed.selection.token', idempotencyKey: 'location-attach:request-1',
    });
    expect(result).not.toHaveProperty('targetArchiveId');
    expect(result).toMatchObject({ intent: 'attach_location', enrichment: 'not_requested' });
  });

  it('rejects malformed provider responses at the client boundary', async () => {
    // Given: a nominal success response missing its signed token.
    __setRequestUrlHandler(async () => ({
      status: 200,
      headers: {},
      text: '',
      json: {
        success: true,
        data: { ...SEARCH_RESPONSE, results: [{ ...SEARCH_RESPONSE.results[0], selectionToken: '' }] },
      },
      arrayBuffer: new ArrayBuffer(0),
    }));

    // When/Then: untrusted response data is not allowed into the picker.
    await expect(createClient().searchProviderPlaces({
      provider: 'kakaomap', query: '희작', page: 1, size: 15,
    })).rejects.toThrow('Invalid place search response');
  });

  it('rejects a mismatched provider response instead of silently switching providers', async () => {
    // Given: Google was requested but the response claims to be Kakao.
    __setRequestUrlHandler(async () => ({
      status: 200,
      headers: {},
      text: '',
      json: { success: true, data: SEARCH_RESPONSE },
      arrayBuffer: new ArrayBuffer(0),
    }));

    // When/Then: provider identity mismatch is terminal at the client boundary.
    await expect(createClient().searchProviderPlaces({
      provider: 'googlemaps', query: 'Blue Bottle', size: 5,
    })).rejects.toThrow('Invalid place search response');
  });

  it.each([
    ['query', { ...GOOGLE_SEARCH_RESPONSE, query: 'Other query' }],
    ['size', { ...GOOGLE_SEARCH_RESPONSE, size: 6 }],
  ] as const)('rejects a valid-shaped Google response swapped by %s', async (_field, response) => {
    // Given: a structurally valid response belonging to another paid search request.
    __setRequestUrlHandler(async () => ({
      status: 200,
      headers: {},
      text: '',
      json: { success: true, data: response },
      arrayBuffer: new ArrayBuffer(0),
    }));

    // When/Then: request identity is checked before results can reach picker state.
    await expect(createClient().searchProviderPlaces({
      provider: 'googlemaps', query: 'Blue Bottle', nextCursor: 'request-cursor', size: 5,
    })).rejects.toThrow('Invalid place search response');
  });

  it('rejects a valid-shaped Kakao response swapped from another page', async () => {
    // Given: page two was requested but page one is returned.
    __setRequestUrlHandler(async () => ({
      status: 200,
      headers: {},
      text: '',
      json: { success: true, data: SEARCH_RESPONSE },
      arrayBuffer: new ArrayBuffer(0),
    }));

    // When/Then: page authority is checked before results can reach picker state.
    await expect(createClient().searchProviderPlaces({
      provider: 'kakaomap', query: '희작', page: 2, size: 15,
    })).rejects.toThrow('Invalid place search response');
  });

  it.each([
    ['source archive', {
      sourceArchiveId: 'other-source', targetArchiveId: 'place-1', enrichment: 'queued',
      place: { provider: 'googlemaps', externalId: 'ChIJ-expected' },
    }],
    ['provider', {
      sourceArchiveId: 'source-1', targetArchiveId: 'place-1', enrichment: 'queued',
      place: {
        provider: 'kakaomap', externalId: '1234', name: '희작', category: '카페', address: '',
        latitude: 37.1, longitude: 126.9, phone: '', canonicalUrl: 'http://place.map.kakao.com/1234',
      },
    }],
    ['external ID', {
      sourceArchiveId: 'source-1', targetArchiveId: 'place-1', enrichment: 'queued',
      place: { provider: 'googlemaps', externalId: 'ChIJ-other' },
    }],
  ] as const)('rejects a valid-shaped selection response swapped by %s', async (_field, response) => {
    // Given: the Worker response is valid but belongs to a different selection authority.
    __setRequestUrlHandler(async () => ({
      status: 200,
      headers: {},
      text: '',
      json: { success: true, data: response },
      arrayBuffer: new ArrayBuffer(0),
    }));

    // When/Then: no swapped target may be published to UI persistence.
    await expect(createClient().selectProviderPlace({
      archiveId: 'source-1',
      selectionToken: 'signed.selection.token',
      idempotencyKey: 'place-select:request-2',
      expectedPlace: { provider: 'googlemaps', externalId: 'ChIJ-expected' },
    })).rejects.toThrow('Invalid place selection response');
  });
});
