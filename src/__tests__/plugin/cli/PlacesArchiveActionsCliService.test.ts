import { describe, expect, it, vi } from 'vitest';

import { CliValidationError } from '@/plugin/cli/CliParams';
import {
  ArchiveActionsCliService,
  type ArchiveActionsCliClient,
} from '@/plugin/cli/ArchiveActionsCliService';
import { PlacesCliService, type PlacesCliClient } from '@/plugin/cli/PlacesCliService';

// ---------------------------------------------------------------------------
// bookmark
// ---------------------------------------------------------------------------

function actionsClient(
  overrides: Partial<ArchiveActionsCliClient> = {},
): ArchiveActionsCliClient {
  return {
    bulkUpdateArchiveActions: vi.fn(async (actions) => ({
      updatedIds: actions.map((a) => a.archiveId),
      failed: [],
    })),
    ...overrides,
  } as ArchiveActionsCliClient;
}

describe('bookmark', () => {
  it('bookmarks by default and un-bookmarks with off', async () => {
    const client = actionsClient();
    const service = new ArchiveActionsCliService(client);

    await service.bookmark({ ids: 'a1,a2' });
    expect(client.bulkUpdateArchiveActions).toHaveBeenCalledWith([
      { archiveId: 'a1', isBookmarked: true },
      { archiveId: 'a2', isBookmarked: true },
    ]);

    await service.bookmark({ ids: 'a1', off: 'true' });
    expect(client.bulkUpdateArchiveActions).toHaveBeenLastCalledWith([
      { archiveId: 'a1', isBookmarked: false },
    ]);
  });

  it('chunks past the 200-id server ceiling instead of failing the call', async () => {
    const client = actionsClient();
    const ids = Array.from({ length: 450 }, (_, i) => `a${i}`);

    const result = await new ArchiveActionsCliService(client).bookmark({ ids: ids.join(',') });

    expect(client.bulkUpdateArchiveActions).toHaveBeenCalledTimes(3);
    expect(result.requested).toBe(450);
    expect(result.updatedIds).toHaveLength(450);
  });

  it('reports per-archive failures as data rather than throwing', async () => {
    const client = actionsClient({
      bulkUpdateArchiveActions: vi.fn(async () => ({
        updatedIds: ['a1'],
        failed: [{ archiveId: 'a2', code: 'NOT_FOUND', message: 'gone' }],
      })),
    });

    const result = await new ArchiveActionsCliService(client).bookmark({ ids: 'a1,a2' });

    // One bad id in a bulk triage should not discard the ones that worked.
    expect(result.updatedIds).toEqual(['a1']);
    expect(result.failed[0]).toMatchObject({ archiveId: 'a2', code: 'NOT_FOUND' });
  });

  it('rejects an empty id list before calling the server', async () => {
    const client = actionsClient();

    await expect(new ArchiveActionsCliService(client).bookmark({})).rejects.toBeInstanceOf(
      CliValidationError,
    );
    expect(client.bulkUpdateArchiveActions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// places
// ---------------------------------------------------------------------------

function placesClient(overrides: Partial<PlacesCliClient> = {}): PlacesCliClient {
  return {
    getPlaceCandidates: vi.fn(async () => ({
      items: [
        {
          id: 'c1',
          archiveId: 'a1',
          name: '모녀가리비',
          addressText: '강원특별자치도 속초시 대포항희망길 53',
          evidenceType: 'body',
          evidenceText: '속초 가면 꼭 가는 조개구이집',
          confidenceBucket: 'high',
          score: 0.92,
        },
      ],
      pendingCount: 1,
    })),
    attachPlaceCandidatesBatch: vi.fn(async () => ({
      replayed: false,
      outcomes: [
        { candidateId: 'c1', outcome: 'attached', canonicalLocation: { name: '모녀가리비' } },
      ],
      remainingPendingCount: 0,
    })),
    detachPlace: vi.fn(async () => ({ archiveIds: ['a1', 'a2'], removedCount: 2 })),
    ...overrides,
  } as PlacesCliClient;
}

describe('places list', () => {
  it('returns the evidence a candidate was extracted from, not just its name', async () => {
    const result = (await new PlacesCliService(placesClient()).run({})) as {
      candidates: Array<Record<string, unknown>>;
    };

    // Without the evidence there is nothing to judge a candidate against.
    expect(result.candidates[0]).toMatchObject({
      candidateId: 'c1',
      evidence: '속초 가면 꼭 가는 조개구이집',
      confidence: 'high',
    });
  });

  it('queries by archive when archive ids are given, else the pending queue', async () => {
    const client = placesClient();
    const service = new PlacesCliService(client);

    await service.run({ action: 'list', archive: 'a1,a2' });
    expect(client.getPlaceCandidates).toHaveBeenCalledWith({ archiveIds: ['a1', 'a2'] });

    await service.run({ action: 'list', limit: '5' });
    expect(client.getPlaceCandidates).toHaveBeenLastCalledWith({ state: 'pending', limit: 5 });
  });

  it('refuses more than the server-capped 50 archive ids', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `a${i}`).join(',');

    await expect(
      new PlacesCliService(placesClient()).run({ action: 'list', archive: ids }),
    ).rejects.toBeInstanceOf(CliValidationError);
  });
});

describe('places attach', () => {
  it('sends an idempotency key so a retry cannot double-attach', async () => {
    const client = placesClient();
    const service = new PlacesCliService(client, () => 'fixed-key');

    await service.run({ action: 'attach', archive: 'a1', candidate: 'c1,c2' });

    expect(client.attachPlaceCandidatesBatch).toHaveBeenCalledWith('a1', {
      idempotencyKey: 'fixed-key',
      candidates: [{ candidateId: 'c1' }, { candidateId: 'c2' }],
    });
  });

  it('requires both archive and candidate before calling the server', async () => {
    const client = placesClient();
    const service = new PlacesCliService(client);

    await expect(service.run({ action: 'attach', candidate: 'c1' })).rejects.toBeInstanceOf(
      CliValidationError,
    );
    await expect(service.run({ action: 'attach', archive: 'a1' })).rejects.toBeInstanceOf(
      CliValidationError,
    );
    expect(client.attachPlaceCandidatesBatch).not.toHaveBeenCalled();
  });
});

describe('places detach', () => {
  it('reports what was removed, and requires a placeKey', async () => {
    const client = placesClient();
    const service = new PlacesCliService(client);

    await expect(
      service.run({ action: 'detach', placeKey: 'kakaomap:18857457' }),
    ).resolves.toEqual({
      placeKey: 'kakaomap:18857457',
      removedCount: 2,
      archiveIds: ['a1', 'a2'],
    });

    await expect(service.run({ action: 'detach' })).rejects.toBeInstanceOf(CliValidationError);
  });
});
