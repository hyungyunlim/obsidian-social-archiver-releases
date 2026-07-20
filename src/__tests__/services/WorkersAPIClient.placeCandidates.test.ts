/**
 * WorkersAPIClient — place-candidates methods (Places P3c).
 *
 * Covers:
 *   - GET /api/user/place-candidates?archiveIds=… query building + envelope
 *     unwrapping; empty archiveIds short-circuits without a request; >50 ids
 *     are capped; state/limit query variant
 *   - POST /api/user/place-candidates/:id/confirm body passthrough + data
 *     unwrapping; 409 CANDIDATE_NOT_PENDING surfaces as Error with code
 *   - POST /api/user/place-candidates/:id/reject
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type {
  ArchiveLocation,
  PlaceCandidate,
  PlaceCandidateAttachmentItemResult,
  PlaceCandidateAttachmentResult,
} from '@/services/WorkersAPIClient';
import {
  __setRequestUrlHandler,
  type RequestUrlParam,
  type RequestUrlResponse,
} from 'obsidian';

interface CapturedRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface TestRequestUrlResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly json: unknown;
  readonly text: string;
  readonly arrayBuffer: ArrayBuffer;
}

function setHandler(
  handler: (req: CapturedRequest) => Promise<TestRequestUrlResponse> | TestRequestUrlResponse,
  captured?: CapturedRequest[],
): void {
  __setRequestUrlHandler(async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
    const request: CapturedRequest = params;
    if (captured) captured.push(request);
    const response = await handler(request);
    return {
      status: response.status,
      headers: { ...response.headers },
      json: response.json,
      text: response.text,
      arrayBuffer: response.arrayBuffer,
    };
  });
}

function ok(data: unknown): {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly json: { readonly success: true; readonly data: unknown };
  readonly text: string;
  readonly arrayBuffer: ArrayBuffer;
} {
  return {
    status: 200,
    headers: {},
    json: { success: true, data },
    text: '',
    arrayBuffer: new ArrayBuffer(0),
  };
}

function makeCandidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    id: 'cand-1',
    archiveId: 'archive-1',
    name: 'Blue Bottle Seongsu',
    addressText: 'Seoul, Seongdong-gu',
    cityHint: 'Seoul',
    evidenceType: 'jsonld',
    evidenceText: 'Blue Bottle Coffee Seongsu Cafe',
    confidenceBucket: 'high',
    score: 0.92,
    latitude: 37.5446,
    longitude: 127.0559,
    externalSource: null,
    externalPlaceId: null,
    state: 'pending',
    ordinal: 0,
    resolvedLocationId: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeLocation(overrides: Partial<ArchiveLocation> = {}): ArchiveLocation {
  return {
    id: 'location-1',
    archiveId: 'archive-1',
    placeKey: 'metadata:blue-bottle-seongsu',
    name: 'Blue Bottle Seongsu',
    address: 'Seoul, Seongdong-gu',
    latitude: null,
    longitude: null,
    source: null,
    externalId: null,
    url: null,
    category: null,
    isPrimary: false,
    sortOrder: 1,
    placeArchiveId: null,
    promotionStatus: 'metadata_only',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeAttachmentResult(
  overrides: Partial<PlaceCandidateAttachmentResult> = {},
): PlaceCandidateAttachmentResult {
  const location = makeLocation();
  return {
    replayed: false,
    archiveId: 'archive-1',
    request: {
      idempotencyKey: 'batch-key',
      requestDigest: `sha256:${'a'.repeat(64)}`,
      operation: 'attach_batch',
    },
    outcomes: [{
      candidateId: 'cand-1',
      ordinal: 0,
      outcome: 'attached',
      locationId: location.id,
      canonicalLocation: location,
      candidateStatus: 'confirmed',
    }],
    activeLocations: [location],
    primaryLocationId: null,
    remainingPendingCandidates: [makeCandidate({ id: 'cand-2', ordinal: 1 })],
    remainingPendingCount: 1,
    globalPendingCount: 4,
    ...overrides,
  };
}

function makeClient(): WorkersAPIClient {
  const client = new WorkersAPIClient({
    endpoint: 'https://api.test.com',
    authToken: 'test-token',
    pluginVersion: '4.2.0',
  });
  client.initialize();
  return client;
}

describe('WorkersAPIClient — getPlaceCandidates', () => {
  beforeEach(() => __setRequestUrlHandler(null));
  afterEach(() => __setRequestUrlHandler(null));

  it('builds the archiveIds query and unwraps the {success,data} envelope', async () => {
    const captured: CapturedRequest[] = [];
    const candidate = makeCandidate();
    setHandler(() => ok({ items: [candidate], pendingCount: 1 }), captured);

    const client = makeClient();
    const result = await client.getPlaceCandidates({ archiveIds: ['archive-1', 'archive-2'] });

    expect(result).toEqual({ items: [candidate], pendingCount: 1 });
    expect(captured).toHaveLength(1);
    const request = captured[0]!;
    expect(request.method).toBe('GET');
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/user/place-candidates');
    expect(url.searchParams.get('archiveIds')).toBe('archive-1,archive-2');
    expect(request.headers?.['Authorization']).toBe('Bearer test-token');
  });

  it('short-circuits with an empty result when archiveIds is empty (no request)', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(() => ok({ items: [], pendingCount: 0 }), captured);

    const client = makeClient();
    const result = await client.getPlaceCandidates({ archiveIds: [] });

    expect(result).toEqual({ items: [], pendingCount: 0 });
    expect(captured).toHaveLength(0);
  });

  it('caps archiveIds at 50 per request', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(() => ok({ items: [], pendingCount: 0 }), captured);

    const client = makeClient();
    const ids = Array.from({ length: 60 }, (_, i) => `a-${i}`);
    await client.getPlaceCandidates({ archiveIds: ids });

    const url = new URL(captured[0]!.url);
    expect(url.searchParams.get('archiveIds')?.split(',')).toHaveLength(50);
  });

  it('supports the pending review-queue query with limit', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(() => ok({ items: [], pendingCount: 0 }), captured);

    const client = makeClient();
    await client.getPlaceCandidates({ state: 'pending', limit: 20 });

    const url = new URL(captured[0]!.url);
    expect(url.searchParams.get('state')).toBe('pending');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('archiveIds')).toBeNull();
  });
});

describe('WorkersAPIClient — confirmPlaceCandidate', () => {
  beforeEach(() => __setRequestUrlHandler(null));
  afterEach(() => __setRequestUrlHandler(null));

  it('POSTs the body and returns the unwrapped confirm result', async () => {
    const captured: CapturedRequest[] = [];
    const place = {
      locationSource: 'text_confirmed',
      locationExternalId: null,
      latitude: 37.5446,
      longitude: 127.0559,
      location: 'Blue Bottle Seongsu',
    };
    setHandler(() => ok({ archiveId: 'archive-1', place }), captured);

    const client = makeClient();
    const result = await client.confirmPlaceCandidate('cand/1', {
      location: 'Blue Bottle Seongsu',
      addressText: 'Seoul',
    });

    expect(result).toEqual({ archiveId: 'archive-1', place });
    const request = captured[0]!;
    expect(request.method).toBe('POST');
    // Candidate id must be URL-encoded in the path
    expect(request.url).toBe('https://api.test.com/api/user/place-candidates/cand%2F1/confirm');
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      location: 'Blue Bottle Seongsu',
      addressText: 'Seoul',
    });
  });

  it('sends an empty JSON body by default', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(() => ok({
      archiveId: 'archive-1',
      place: { locationSource: 'x', locationExternalId: null, latitude: null, longitude: null, location: null },
    }), captured);

    const client = makeClient();
    await client.confirmPlaceCandidate('cand-1');

    expect(JSON.parse(captured[0]!.body ?? 'null')).toEqual({});
  });

  it('throws with code CANDIDATE_NOT_PENDING on 409 races', async () => {
    setHandler(() => ({
      status: 409,
      headers: {},
      json: {
        success: false,
        error: { code: 'CANDIDATE_NOT_PENDING', message: 'Candidate already reviewed' },
      },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));

    const client = makeClient();
    await expect(client.confirmPlaceCandidate('cand-1')).rejects.toMatchObject({
      message: 'Candidate already reviewed',
      code: 'CANDIDATE_NOT_PENDING',
      status: 409,
    });
  });
});

describe('WorkersAPIClient — rejectPlaceCandidate', () => {
  beforeEach(() => __setRequestUrlHandler(null));
  afterEach(() => __setRequestUrlHandler(null));

  it('POSTs to the reject endpoint and unwraps {ok:true}', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(() => ok({ ok: true }), captured);

    const client = makeClient();
    const result = await client.rejectPlaceCandidate('cand-1');

    expect(result).toEqual({ ok: true });
    const request = captured[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.test.com/api/user/place-candidates/cand-1/reject');
  });
});

describe('WorkersAPIClient — v2 place candidate attachments', () => {
  beforeEach(() => __setRequestUrlHandler(null));
  afterEach(() => __setRequestUrlHandler(null));

  it('preserves candidate ordinal order in the direct batch payload and parses the ok envelope', async () => {
    // Given: two selected direct candidates in the review order chosen by the UI.
    const captured: CapturedRequest[] = [];
    const locationOne = makeLocation({ id: 'location-1', sortOrder: 1 });
    const locationTwo = makeLocation({ id: 'location-2', name: 'Archive Cafe', sortOrder: 2 });
    const result = makeAttachmentResult({
      archiveId: 'archive/1',
      outcomes: [
        {
          candidateId: 'cand-2', ordinal: 1, outcome: 'attached', locationId: locationTwo.id,
          canonicalLocation: locationTwo, candidateStatus: 'confirmed',
        },
        {
          candidateId: 'cand-7', ordinal: 6, outcome: 'attached', locationId: locationOne.id,
          canonicalLocation: locationOne, candidateStatus: 'confirmed',
        },
      ],
      activeLocations: [locationOne, locationTwo],
      remainingPendingCandidates: [],
      remainingPendingCount: 0,
    });
    setHandler(() => ({
      status: 201,
      headers: {},
      json: { ok: true, ...result },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }), captured);

    // When: the plugin submits one atomic direct batch.
    const response = await makeClient().attachPlaceCandidatesBatch('archive/1', {
      idempotencyKey: 'batch-key',
      candidates: [
        { candidateId: 'cand-2', name: 'Archive Cafe', addressText: 'Seoul' },
        { candidateId: 'cand-7', addressText: 'Busan' },
      ],
    });

    // Then: URL encoding, wire order, and strict response parsing all match v2.
    expect(captured[0]?.url).toBe(
      'https://api.test.com/api/user/archives/archive%2F1/place-candidates/attach-batch',
    );
    expect(JSON.parse(captured[0]?.body ?? '{}')).toEqual({
      idempotencyKey: 'batch-key',
      candidates: [
        { candidateId: 'cand-2', name: 'Archive Cafe', addressText: 'Seoul' },
        { candidateId: 'cand-7', addressText: 'Busan' },
      ],
    });
    expect(response.outcomes.map((outcome) => outcome.candidateId)).toEqual(['cand-2', 'cand-7']);
  });

  it.each([
    ['missing', (
      first: PlaceCandidateAttachmentItemResult,
      _second: PlaceCandidateAttachmentItemResult,
    ): readonly PlaceCandidateAttachmentItemResult[] => [first]],
    ['unrequested', (
      first: PlaceCandidateAttachmentItemResult,
      second: PlaceCandidateAttachmentItemResult,
    ): readonly PlaceCandidateAttachmentItemResult[] => [
      first,
      { ...second, candidateId: 'cand-unrequested' },
    ]],
    ['reordered', (
      first: PlaceCandidateAttachmentItemResult,
      second: PlaceCandidateAttachmentItemResult,
    ): readonly PlaceCandidateAttachmentItemResult[] => [second, first]],
  ])('rejects %s direct-batch outcomes instead of miscorrelating them', async (_case, arrange) => {
    // Given: two submitted candidate IDs and a schema-valid but non-correlated outcome list.
    const first = {
      candidateId: 'cand-2', ordinal: 1, outcome: 'attached', locationId: 'location-1',
      canonicalLocation: makeLocation({ id: 'location-1' }), candidateStatus: 'confirmed',
    } satisfies PlaceCandidateAttachmentItemResult;
    const second = {
      candidateId: 'cand-7', ordinal: 6, outcome: 'attached', locationId: 'location-2',
      canonicalLocation: makeLocation({ id: 'location-2' }), candidateStatus: 'confirmed',
    } satisfies PlaceCandidateAttachmentItemResult;
    const response = makeAttachmentResult({
      outcomes: arrange(first, second),
      activeLocations: [first.canonicalLocation, second.canonicalLocation],
      remainingPendingCandidates: [],
      remainingPendingCount: 0,
    });
    setHandler(() => ({
      status: 201,
      headers: {},
      json: { ok: true, ...response },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));

    // When/Then: boundary parsing rejects missing, foreign, or reordered outcomes.
    await expect(makeClient().attachPlaceCandidatesBatch('archive-1', {
      idempotencyKey: 'batch-key',
      candidates: [{ candidateId: 'cand-2' }, { candidateId: 'cand-7' }],
    })).rejects.toThrow('Invalid place candidate attachment response');
  });

  it('binds provider and existing attachment calls to the selected candidate', async () => {
    // Given: one provider result and one owned existing place for separate candidate rows.
    const captured: CapturedRequest[] = [];
    setHandler((request) => {
      const operation = request.url.endsWith('/attach-from-provider')
        ? 'attach_provider'
        : 'attach_existing';
      const candidateId = operation === 'attach_provider'
        ? 'candidate/provider'
        : 'candidate/existing';
      return {
        status: 201,
        headers: {},
        json: { ok: true, ...makeAttachmentResult({
          request: {
            idempotencyKey: operation === 'attach_provider' ? 'provider-key' : 'existing-key',
            requestDigest: `sha256:${'b'.repeat(64)}`,
            operation,
          },
          outcomes: [{
            candidateId,
            ordinal: 0,
            outcome: 'attached',
            locationId: 'location-1',
            canonicalLocation: makeLocation(),
            candidateStatus: 'confirmed',
          }],
        }) },
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      };
    }, captured);
    const client = makeClient();

    // When: each row completes through its own server attachment endpoint.
    await client.attachPlaceCandidateFromProvider('candidate/provider', {
      idempotencyKey: 'provider-key',
      selectionToken: 'signed-selection',
    });
    await client.attachPlaceCandidateFromExisting('candidate/existing', {
      idempotencyKey: 'existing-key',
      representativeArchiveId: 'place-archive-9',
      placeKey: 'kakaomap:9',
    });

    // Then: candidate identity lives in each path and only trusted v2 body fields cross the boundary.
    expect(captured.map((request) => request.url)).toEqual([
      'https://api.test.com/api/user/place-candidates/candidate%2Fprovider/attach-from-provider',
      'https://api.test.com/api/user/place-candidates/candidate%2Fexisting/attach-from-existing',
    ]);
    expect(JSON.parse(captured[0]?.body ?? '{}')).toEqual({
      idempotencyKey: 'provider-key', selectionToken: 'signed-selection',
    });
    expect(JSON.parse(captured[1]?.body ?? '{}')).toEqual({
      idempotencyKey: 'existing-key', representativeArchiveId: 'place-archive-9', placeKey: 'kakaomap:9',
    });
  });

  it.each([
    ['provider', 'attach_provider', 'provider-key'],
    ['existing', 'attach_existing', 'existing-key'],
  ] as const)('rejects a %s attachment outcome for another candidate', async (
    route,
    operation,
    idempotencyKey,
  ) => {
    // Given: a schema-valid success response correlated to a foreign candidate ID.
    setHandler(() => ({
      status: 201,
      headers: {},
      json: { ok: true, ...makeAttachmentResult({
        request: {
          idempotencyKey,
          requestDigest: `sha256:${'c'.repeat(64)}`,
          operation,
        },
        outcomes: [{
          candidateId: 'candidate-foreign',
          ordinal: 0,
          outcome: 'attached',
          locationId: 'location-1',
          canonicalLocation: makeLocation(),
          candidateStatus: 'confirmed',
        }],
      }) },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));
    const client = makeClient();

    // When/Then: endpoint-bound candidate correlation rejects the foreign outcome.
    const request = route === 'provider'
      ? client.attachPlaceCandidateFromProvider('candidate-expected', {
        idempotencyKey, selectionToken: 'signed-selection',
      })
      : client.attachPlaceCandidateFromExisting('candidate-expected', {
        idempotencyKey, representativeArchiveId: 'place-archive-9', placeKey: 'kakaomap:9',
      });
    await expect(request).rejects.toThrow('Invalid place candidate attachment response');
  });

  it('rejects malformed ok responses instead of trusting an asserted generic', async () => {
    // Given: a nominal success envelope with a location identity mismatch.
    const result = makeAttachmentResult({ archiveId: 'another-archive' });
    setHandler(() => ({
      status: 201,
      headers: {},
      json: { ok: true, ...result },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));

    // When/Then: the API boundary rejects it before domain code can consume it.
    await expect(makeClient().attachPlaceCandidatesBatch('archive-1', {
      idempotencyKey: 'batch-key',
      candidates: [{ candidateId: 'cand-1', addressText: 'Seoul' }],
    })).rejects.toThrow('Invalid place candidate attachment response');
  });

  it('sends provider search with an immutable archive and candidate context', async () => {
    // Given: a candidate-scoped provider search.
    const captured: CapturedRequest[] = [];
    setHandler(() => ok({
      provider: 'kakaomap', query: '희작', page: 1, size: 15, isEnd: true,
      pageableCount: 0, totalCount: 0,
      attribution: {
        provider: 'Kakao', label: 'Search results provided by Kakao',
        url: 'https://developers.kakao.com/',
      },
      results: [],
    }), captured);

    // When: the bound search is submitted.
    await makeClient().searchProviderPlaces({
      provider: 'kakaomap', query: '희작', page: 1, size: 15,
      candidateContext: { archiveId: 'archive-1', candidateId: 'cand-9' },
    });

    // Then: the signed selection minting request carries both immutable IDs.
    expect(JSON.parse(captured[0]?.body ?? '{}')).toMatchObject({
      candidateContext: { archiveId: 'archive-1', candidateId: 'cand-9' },
    });
  });
});

// ---------------------------------------------------------------------------
// Places P3b — capability header + tolerant parse + extract trigger
// ---------------------------------------------------------------------------

function okStatus(status: number, data: unknown): TestRequestUrlResponse {
  return {
    status,
    headers: {},
    json: { success: true, data },
    text: '',
    arrayBuffer: new ArrayBuffer(0),
  };
}

describe('WorkersAPIClient — Places P3b capability + tolerant parse', () => {
  beforeEach(() => __setRequestUrlHandler(null));
  afterEach(() => __setRequestUrlHandler(null));

  it('advertises place-extract-v1 on the place-candidates GET', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(() => ok({ items: [], pendingCount: 0 }), captured);

    await makeClient().getPlaceCandidates({ archiveIds: ['archive-1'] });

    expect(captured[0]!.headers?.['X-Client-Capabilities']).toBe('place-extract-v1');
  });

  it('advertises place-extract-v1 on attach-batch', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(() => okStatus(200, undefined), captured);
    // The attach response won't parse to a valid result here, but the request
    // (and its header) is captured before that rejection.
    await makeClient()
      .attachPlaceCandidatesBatch('archive-1', {
        idempotencyKey: 'k', candidates: [{ candidateId: 'cand-1' }],
      })
      .catch(() => undefined);

    expect(captured[0]!.headers?.['X-Client-Capabilities']).toBe('place-extract-v1');
  });

  it('tolerantly parses a caption_llm candidate with a role and ordinal 9', async () => {
    const captured: CapturedRequest[] = [];
    const candidate = makeCandidate({
      id: 'cand-llm',
      evidenceType: 'caption_llm',
      ordinal: 9,
      role: 'recommended',
    } as Partial<PlaceCandidate>);
    setHandler(() => ok({ items: [candidate], pendingCount: 1 }), captured);

    const result = await makeClient().getPlaceCandidates({ archiveIds: ['archive-1'] });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.ordinal).toBe(9);
    expect(result.items[0]!.role).toBe('recommended');
  });

  it('accepts an unknown future role value without failing the response', async () => {
    const candidate = makeCandidate({ role: 'future_role_value' } as Partial<PlaceCandidate>);
    setHandler(() => ok({ items: [candidate], pendingCount: 1 }));

    const result = await makeClient().getPlaceCandidates({ archiveIds: ['archive-1'] });
    expect(result.items[0]!.role).toBe('future_role_value');
  });
});

describe('WorkersAPIClient — extractPlaceCandidates', () => {
  beforeEach(() => __setRequestUrlHandler(null));
  afterEach(() => __setRequestUrlHandler(null));

  it('POSTs to the extract endpoint with the capability header and body', async () => {
    const captured: CapturedRequest[] = [];
    setHandler(() => okStatus(202, { runId: 'run_1', jobId: 'job_1', status: 'running' }), captured);

    const result = await makeClient().extractPlaceCandidates('archive/1', {
      idempotencyKey: 'extract:abc',
      includeOcr: true,
    });

    expect(result).toEqual({ runId: 'run_1', jobId: 'job_1', status: 'running' });
    const request = captured[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      'https://api.test.com/api/user/archives/archive%2F1/place-candidates/extract',
    );
    expect(request.headers?.['X-Client-Capabilities']).toBe('place-extract-v1');
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      idempotencyKey: 'extract:abc', includeOcr: true,
    });
  });

  it('parses the 200 replay result with candidates', async () => {
    const candidate = makeCandidate({ evidenceType: 'caption_llm', role: 'visited' } as Partial<PlaceCandidate>);
    setHandler(() => okStatus(200, {
      runId: 'run_1', status: 'completed', replayed: true, insertedCount: 1, candidates: [candidate],
    }));

    const result = await makeClient().extractPlaceCandidates('archive-1', { idempotencyKey: 'k' });

    expect(result).toMatchObject({ status: 'completed', replayed: true, insertedCount: 1 });
    if (result.status === 'completed') {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.role).toBe('visited');
    }
  });

  it('surfaces a billing/consent error code from the envelope', async () => {
    setHandler(() => ({
      status: 402,
      headers: {},
      json: { success: false, error: { code: 'PAYWALL_REQUIRED', message: 'Upgrade required' } },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    }));

    await expect(
      makeClient().extractPlaceCandidates('archive-1', { idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'PAYWALL_REQUIRED', status: 402 });
  });
});
