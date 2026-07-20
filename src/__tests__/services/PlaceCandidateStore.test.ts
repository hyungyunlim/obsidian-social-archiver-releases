import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaceCandidateStore, type PlaceCandidateApi } from '@/services/PlaceCandidateStore';
import type {
  PlaceCandidate,
  PlaceCandidateAttachmentResult,
  PlaceCandidatesResponse,
} from '@/services/WorkersAPIClient';

function candidate(id: string, ordinal: number): PlaceCandidate {
  return {
    id,
    archiveId: 'archive-1',
    name: `Place ${id}`,
    addressText: `Address ${id}`,
    cityHint: null,
    evidenceType: 'jsonld',
    evidenceText: `Evidence ${id}`,
    confidenceBucket: 'high',
    score: 0.9,
    latitude: null,
    longitude: null,
    externalSource: null,
    externalPlaceId: null,
    state: 'pending',
    ordinal,
    resolvedLocationId: null,
    createdAt: '2026-07-19T00:00:00.000Z',
  };
}

function attachmentResult(remaining: readonly PlaceCandidate[]): PlaceCandidateAttachmentResult {
  return {
    replayed: false,
    archiveId: 'archive-1',
    request: {
      idempotencyKey: 'batch-key',
      requestDigest: `sha256:${'a'.repeat(64)}`,
      operation: 'attach_batch',
    },
    outcomes: [{
      candidateId: 'candidate-1',
      ordinal: 0,
      outcome: 'attached',
      locationId: 'location-1',
      canonicalLocation: null,
      candidateStatus: 'confirmed',
    }],
    activeLocations: [],
    primaryLocationId: null,
    remainingPendingCandidates: remaining,
    remainingPendingCount: remaining.length,
    globalPendingCount: 7,
  };
}

async function load(
  store: PlaceCandidateStore,
  archiveId = 'archive-1',
): Promise<readonly PlaceCandidate[]> {
  const pending = store.getPending(archiveId);
  await vi.advanceTimersByTimeAsync(200);
  return pending;
}

describe('PlaceCandidateStore multi-candidate reconciliation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns pending candidates in immutable ordinal order', async () => {
    // Given: an API response whose transport order differs from candidate order.
    const api: PlaceCandidateApi = {
      getPlaceCandidates: vi.fn(async (): Promise<PlaceCandidatesResponse> => ({
        items: [candidate('candidate-3', 2), candidate('candidate-1', 0), candidate('candidate-2', 1)],
        pendingCount: 3,
      })),
    };
    const store = new PlaceCandidateStore(() => api);

    // When: the archive bucket is loaded.
    const pending = await load(store);

    // Then: review order follows ordinal, never response arrival order.
    expect(pending.map((item) => item.id)).toEqual(['candidate-1', 'candidate-2', 'candidate-3']);
  });

  it('reconciles the full canonical remaining set without clearing siblings', async () => {
    // Given: a cached three-row review and a server result resolving only candidate 1.
    const api: PlaceCandidateApi = {
      getPlaceCandidates: vi.fn(async () => ({
        items: [candidate('candidate-1', 0), candidate('candidate-2', 1), candidate('candidate-3', 2)],
        pendingCount: 3,
      })),
    };
    const store = new PlaceCandidateStore(() => api);
    await load(store);

    // When: the v2 result supplies canonical pending siblings in reverse transport order.
    store.reconcileAttachment(attachmentResult([
      candidate('candidate-3', 2), candidate('candidate-2', 1),
    ]));
    const pending = await store.getPending('archive-1');

    // Then: only the resolved row is gone and no second fetch is needed.
    expect(pending.map((item) => item.id)).toEqual(['candidate-2', 'candidate-3']);
    expect(api.getPlaceCandidates).toHaveBeenCalledTimes(1);
    expect(store.getGlobalPendingCount()).toBe(7);
  });

  it('removes one rejected row and refreshes stale state from the server', async () => {
    // Given: candidate 1 is cached, then another device leaves only candidate 4 pending.
    const getPlaceCandidates = vi.fn()
      .mockResolvedValueOnce({ items: [candidate('candidate-1', 0), candidate('candidate-2', 1)], pendingCount: 2 })
      .mockResolvedValueOnce({ items: [candidate('candidate-4', 3)], pendingCount: 1 });
    const store = new PlaceCandidateStore(() => ({ getPlaceCandidates }));
    await load(store);

    // When: one local dismissal is applied and a stale conflict requests canonical truth.
    expect(store.removePending('archive-1', 'candidate-1').map((item) => item.id)).toEqual(['candidate-2']);
    const refresh = store.refresh('archive-1');
    await vi.advanceTimersByTimeAsync(200);
    const pending = await refresh;

    // Then: the stale bucket exactly matches the second server response.
    expect(pending.map((item) => item.id)).toEqual(['candidate-4']);
    expect(getPlaceCandidates).toHaveBeenCalledTimes(2);
  });
});
