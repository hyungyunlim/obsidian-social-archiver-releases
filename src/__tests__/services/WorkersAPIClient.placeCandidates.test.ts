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
import type { PlaceCandidate } from '@/services/WorkersAPIClient';
import { __setRequestUrlHandler } from 'obsidian';

interface CapturedRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function setHandler(
  handler: (req: CapturedRequest) => Promise<unknown> | unknown,
  captured?: CapturedRequest[],
): void {
  // Mirrors the billing-events test: the mock's RequestHandler signature is
  // wider than the response shapes these tests build.
  __setRequestUrlHandler(async (params: any) => {
    const request = params as CapturedRequest;
    if (captured) captured.push(request);
    return handler(request) as any;
  });
}

function ok(data: unknown) {
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
    createdAt: '2026-07-10T00:00:00.000Z',
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
