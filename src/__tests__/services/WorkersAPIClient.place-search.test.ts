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
    const response = await createClient().searchProviderPlaces(' 희작 ');

    // Then: the request uses Kakao and the candidate retains its signed token.
    expect(JSON.parse(observedBody ?? '')).toEqual({
      provider: 'kakaomap',
      query: '희작',
      page: 1,
      size: 15,
    });
    expect(response.results[0]?.selectionToken).toBe('signed.selection.token');
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
              canonicalUrl: 'https://place.map.kakao.com/1234',
            },
          },
        },
        arrayBuffer: new ArrayBuffer(0),
      };
    });

    // When: the candidate is selected.
    const response = await createClient().selectProviderPlace(
      'source-1',
      'signed.selection.token',
      'obsidian:source-1:request-1',
    );

    // Then: no raw name, address, coordinates, or provider ID cross the authority boundary.
    expect(observedUrl).toBe('https://worker.example/api/user/archives/source-1/place-from-provider');
    expect(JSON.parse(observedBody ?? '')).toEqual({
      selectionToken: 'signed.selection.token',
      idempotencyKey: 'obsidian:source-1:request-1',
    });
    expect(response.enrichment).toBe('queued');
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
    await expect(createClient().searchProviderPlaces('희작')).rejects.toThrow('Invalid place search response');
  });
});
