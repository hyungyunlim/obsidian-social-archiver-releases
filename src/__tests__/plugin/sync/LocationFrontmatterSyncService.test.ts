/**
 * LocationFrontmatterSyncService — Unit Tests (Places P3c)
 *
 * Covers:
 * - buildDesiredLocationFrontmatter: actionable-field extraction, coordinate
 *   pairing, server-null → null (never delete locally)
 * - locationFrontmatterNeedsWrite: strict no-op comparison including
 *   string-typed numeric frontmatter values
 * - reconcileFromLibrarySync (catch-up, AUTHORITATIVE): upgrades server-owned
 *   location/provider fields while preserving unrelated user frontmatter
 *   processFrontMatter entirely when nothing is missing (no mtime churn)
 * - reconcileArchiveIds (WS, AUTHORITATIVE): overwrites differing values,
 *   skips ids without a vault note, reports per-id failures, processes every
 *   ID in bounded chunks, aborts after dispose()
 * - fieldVisibility: location category disabled → full no-op
 *
 * All Obsidian API surfaces are replaced with vi.fn() stubs.
 */

import { describe, it, expect, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import {
  LocationFrontmatterSyncService,
  MAX_WS_RECONCILE_BATCH,
  buildDesiredLocationFrontmatter,
  locationFrontmatterNeedsWrite,
  applyLocationFrontmatter,
  type RemoteArchiveLocationSource,
} from '../../../plugin/sync/LocationFrontmatterSyncService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFile(path: string): TFile {
  return { path, extension: 'md' } as unknown as TFile;
}

function makeApp(
  currentFrontmatter: Record<string, unknown> | undefined = undefined,
  currentBody = '',
) {
  const writtenFrontmatters: Record<string, unknown>[] = [];
  const processedBodies: string[] = [];
  const processFrontMatter = vi.fn(
    async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
      const fm: Record<string, unknown> = { ...(currentFrontmatter ?? {}) };
      updater(fm);
      writtenFrontmatters.push(fm);
    },
  );
  const process = vi.fn(async (_file: TFile, updater: (content: string) => string) => {
    const result = updater(currentBody);
    processedBodies.push(result);
    return result;
  });
  const app = {
    metadataCache: {
      getFileCache: vi.fn(() =>
        currentFrontmatter === undefined ? null : { frontmatter: currentFrontmatter },
      ),
    },
    fileManager: { processFrontMatter },
    vault: { cachedRead: vi.fn(async () => currentBody), process },
  } as unknown as App;
  return { app, processFrontMatter, writtenFrontmatters, process, processedBodies };
}

function makeArchive(overrides: Partial<RemoteArchiveLocationSource> = {}): RemoteArchiveLocationSource {
  return {
    id: 'archive-1',
    location: 'Blue Bottle Seongsu',
    latitude: 37.5446,
    longitude: 127.0559,
    locationSource: 'kakaomap',
    locationExternalId: '12345',
    ...overrides,
  };
}

// ─── buildDesiredLocationFrontmatter ─────────────────────────────────────────

describe('buildDesiredLocationFrontmatter', () => {
  it('returns null when the server carries no location data (never deletes locally)', () => {
    expect(buildDesiredLocationFrontmatter({ id: 'a' })).toBeNull();
    expect(
      buildDesiredLocationFrontmatter({ id: 'a', location: null, latitude: null, longitude: null }),
    ).toBeNull();
  });

  it('ignores empty/whitespace location strings', () => {
    expect(buildDesiredLocationFrontmatter({ id: 'a', location: '   ' })).toBeNull();
  });

  it('returns location-only when coordinates are absent', () => {
    expect(buildDesiredLocationFrontmatter({ id: 'a', location: 'Cafe Onion' })).toEqual({
      location: 'Cafe Onion',
    });
  });

  it('requires BOTH coordinates for lat/lng/coordinates fields', () => {
    expect(buildDesiredLocationFrontmatter({ id: 'a', latitude: 37.5 })).toBeNull();
    expect(
      buildDesiredLocationFrontmatter({ id: 'a', location: 'X', latitude: 37.5, longitude: null }),
    ).toEqual({ location: 'X' });
  });

  it('builds the full field set including Bases-compatible coordinates string', () => {
    expect(buildDesiredLocationFrontmatter(makeArchive())).toEqual({
      location: 'Blue Bottle Seongsu',
      latitude: 37.5446,
      longitude: 127.0559,
      coordinates: '37.5446, 127.0559',
      locationSource: 'kakaomap',
      locationExternalId: '12345',
    });
  });

  it('projects only flat primary-place fields — the locations array is NOT a frontmatter field', () => {
    const location = {
      id: 'location-1', archiveId: 'archive-1', placeKey: 'kakaomap:12345',
      name: 'Blue Bottle Seongsu', address: '서울 성동구', latitude: 37.5446,
      longitude: 127.0559, source: 'kakaomap', externalId: '12345',
      url: 'https://place.map.kakao.com/12345', category: '카페', isPrimary: true,
      sortOrder: 0, placeArchiveId: null, promotionStatus: 'metadata_only' as const,
      createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
    };
    const desired = buildDesiredLocationFrontmatter(makeArchive({
      locationAddress: location.address,
      locationUrl: location.url,
      locationCategory: location.category,
      locations: [location],
      locationCount: 1,
    }));
    // Flat fields present; the object-array stays OUT of frontmatter (it rides in
    // the hidden %% sa:locations %% body block instead).
    expect(desired).toMatchObject({ location: 'Blue Bottle Seongsu', locationAddress: '서울 성동구' });
    expect(desired).not.toHaveProperty('locations');
    expect(desired).not.toHaveProperty('locationCount');
  });

  it('ignores non-finite coordinate values', () => {
    expect(
      buildDesiredLocationFrontmatter({ id: 'a', latitude: Number.NaN, longitude: 127 }),
    ).toBeNull();
  });
});

// ─── locationFrontmatterNeedsWrite ───────────────────────────────────────────

describe('locationFrontmatterNeedsWrite', () => {
  const desired = {
    location: 'Blue Bottle Seongsu',
    latitude: 37.5446,
    longitude: 127.0559,
    coordinates: '37.5446, 127.0559',
    locationSource: 'kakaomap',
    locationExternalId: '12345',
  };

  it('is false when every field already matches (strict no-op)', () => {
    expect(locationFrontmatterNeedsWrite({ ...desired }, desired)).toBe(false);
  });

  it('is false when numeric fields are string-typed in frontmatter but equal', () => {
    expect(
      locationFrontmatterNeedsWrite(
        {
          location: 'Blue Bottle Seongsu',
          latitude: '37.5446',
          longitude: '127.0559',
          coordinates: '37.5446, 127.0559',
          locationSource: 'kakaomap',
          locationExternalId: '12345',
        },
        desired,
      ),
    ).toBe(false);
  });

  it('is true when frontmatter is missing or empty', () => {
    expect(locationFrontmatterNeedsWrite(undefined, desired)).toBe(true);
    expect(locationFrontmatterNeedsWrite({}, desired)).toBe(true);
  });

  it('is true when any single field differs', () => {
    expect(locationFrontmatterNeedsWrite({ ...desired, location: 'Elsewhere' }, desired)).toBe(true);
    expect(locationFrontmatterNeedsWrite({ ...desired, latitude: 1 }, desired)).toBe(true);
    expect(locationFrontmatterNeedsWrite({ ...desired, coordinates: '0, 0' }, desired)).toBe(true);
  });

  it('only compares desired fields — extra frontmatter is irrelevant', () => {
    expect(
      locationFrontmatterNeedsWrite({ ...desired, unrelated: 'field' }, desired),
    ).toBe(false);
    expect(locationFrontmatterNeedsWrite({ location: 'Cafe Onion' }, { location: 'Cafe Onion' })).toBe(false);
  });
});

// ─── applyLocationFrontmatter ────────────────────────────────────────────────

describe('applyLocationFrontmatter', () => {
  it('replaces managed fields without deleting unrelated user fields', () => {
    const fm: Record<string, unknown> = {
      title: 'Note',
      location: 'Old',
      locationExternalId: 'old-id',
      tags: ['keep'],
    };
    applyLocationFrontmatter(fm, { location: 'New' });
    expect(fm).toEqual({ title: 'Note', location: 'New', tags: ['keep'] });
  });

  it('removes stale full arrays on an authoritative empty projection', () => {
    const fm: Record<string, unknown> = {
      title: 'Note', location: 'Old', locations: [{ id: 'stale' }], locationCount: 1,
    };
    applyLocationFrontmatter(fm, {});
    expect(fm).toEqual({ title: 'Note' });
  });
});

// ─── reconcileFromLibrarySync (authoritative catch-up) ───────────────────────

describe('LocationFrontmatterSyncService.reconcileFromLibrarySync', () => {
  function makeService(app: App, locationCategoryEnabled = true) {
    return new LocationFrontmatterSyncService({
      app,
      apiClient: () => undefined,
      findBySourceArchiveId: () => null,
      isLocationCategoryEnabled: () => locationCategoryEnabled,
    });
  }

  it('does NOT call processFrontMatter when values already match (no mtime churn)', async () => {
    const { app, processFrontMatter } = makeApp({
      location: 'Blue Bottle Seongsu',
      latitude: 37.5446,
      longitude: 127.0559,
      coordinates: '37.5446, 127.0559',
      locationSource: 'kakaomap',
      locationExternalId: '12345',
    });
    const service = makeService(app);

    await service.reconcileFromLibrarySync(makeFile('a.md'), makeArchive());

    expect(processFrontMatter).not.toHaveBeenCalled();
  });

  it('removes stale server-owned place fields when the server row clears them', async () => {
    const { app, processFrontMatter, writtenFrontmatters } = makeApp({
      location: 'Remove me',
      locationSource: 'kakaomap',
      locationExternalId: '12345',
      tags: ['keep-me'],
    });
    const service = makeService(app);

    await service.reconcileFromLibrarySync(
      makeFile('a.md'),
      { id: 'archive-1', location: null, latitude: null, longitude: null },
    );

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(writtenFrontmatters[0]).toEqual({ tags: ['keep-me'] });
  });

  it('overwrites provisional server-owned fields and preserves unrelated user fields', async () => {
    const { app, processFrontMatter, writtenFrontmatters } = makeApp({
      location: 'Provisional place',
      locationSource: 'kakaomap',
      locationExternalId: '12345',
      tags: ['cafe'],
      userMemo: 'window seat',
    });
    const service = makeService(app);

    await service.reconcileFromLibrarySync(makeFile('a.md'), makeArchive());

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(writtenFrontmatters[0]).toEqual({
      location: 'Blue Bottle Seongsu',
      latitude: 37.5446,
      longitude: 127.0559,
      coordinates: '37.5446, 127.0559',
      locationSource: 'kakaomap',
      locationExternalId: '12345',
      tags: ['cafe'],
      userMemo: 'window seat',
    });
  });

  it('updates every differing server-owned field during reconnect catch-up', async () => {
    const { app, processFrontMatter } = makeApp({
      location: 'Hand-edited place',
      latitude: 1,
      longitude: 2,
      coordinates: '1, 2',
      locationSource: 'user',
      locationExternalId: 'old',
    });
    const service = makeService(app);

    await service.reconcileFromLibrarySync(makeFile('a.md'), makeArchive());

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
  });

  it('writes the full field set when the file has no metadata cache entry yet', async () => {
    const { app, processFrontMatter } = makeApp(undefined);
    const service = makeService(app);

    await service.reconcileFromLibrarySync(makeFile('a.md'), makeArchive());

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
  });

  it('is a full no-op when the location frontmatter category is disabled', async () => {
    const { app, processFrontMatter } = makeApp({});
    const service = makeService(app, false);

    await service.reconcileFromLibrarySync(makeFile('a.md'), makeArchive());

    expect(processFrontMatter).not.toHaveBeenCalled();
  });

  it('writes the locations array into the hidden body block, never frontmatter', async () => {
    const location = {
      id: 'loc-1', archiveId: 'archive-1', placeKey: 'kakaomap:12345',
      name: 'Blue Bottle Seongsu', address: '서울 성동구', latitude: 37.5446,
      longitude: 127.0559, source: 'kakaomap', externalId: '12345',
      url: 'https://place.map.kakao.com/12345', category: '카페', isPrimary: true,
      sortOrder: 0, placeArchiveId: null, promotionStatus: 'metadata_only' as const,
      createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
    };
    const { app, writtenFrontmatters, process, processedBodies } = makeApp(
      { location: 'Blue Bottle Seongsu', latitude: 37.5446, longitude: 127.0559 },
      '---\nlocation: Blue Bottle Seongsu\n---\n\nBody text.\n',
    );
    const service = makeService(app);

    await service.reconcileFromLibrarySync(
      makeFile('a.md'),
      makeArchive({ locations: [location], locationCount: 1 }),
    );

    // Body block written; frontmatter carries flat fields but NOT the array.
    expect(process).toHaveBeenCalledTimes(1);
    expect(processedBodies[0]).toContain('%% sa:locations');
    expect(processedBodies[0]).toContain('Blue Bottle Seongsu');
    for (const fm of writtenFrontmatters) {
      expect(fm).not.toHaveProperty('locations');
      expect(fm).not.toHaveProperty('locationCount');
    }
  });

  it('migrates a legacy frontmatter locations array into the body block', async () => {
    const location = {
      id: 'loc-1', archiveId: 'archive-1', placeKey: 'kakaomap:12345',
      name: 'Blue Bottle Seongsu', address: '서울 성동구', latitude: 37.5446,
      longitude: 127.0559, source: 'kakaomap', externalId: '12345',
      url: 'https://place.map.kakao.com/12345', category: '카페', isPrimary: true,
      sortOrder: 0, placeArchiveId: null, promotionStatus: 'metadata_only' as const,
      createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
    };
    // Legacy note: array lives in frontmatter, no body block yet.
    const { app, writtenFrontmatters, process, processedBodies } = makeApp(
      { location: 'Blue Bottle Seongsu', latitude: 37.5446, longitude: 127.0559, locations: [location], locationCount: 1 },
      '---\nlocation: Blue Bottle Seongsu\nlocations:\n  - id: loc-1\n---\n\nBody text.\n',
    );
    const service = makeService(app);

    await service.reconcileFromLibrarySync(
      makeFile('a.md'),
      makeArchive({ locations: [location], locationCount: 1 }),
    );

    // Frontmatter array stripped, block written.
    expect(writtenFrontmatters[0]).not.toHaveProperty('locations');
    expect(writtenFrontmatters[0]).not.toHaveProperty('locationCount');
    expect(process).toHaveBeenCalledTimes(1);
    expect(processedBodies[0]).toContain('%% sa:locations');
  });
});

// ─── reconcileArchiveIds (WS path, authoritative) ────────────────────────────

describe('LocationFrontmatterSyncService.reconcileArchiveIds', () => {
  it('skips archives without a vault note, fetches matched ones, and survives per-id failures', async () => {
    const { app, processFrontMatter } = makeApp({});
    const fileB = makeFile('b.md');
    const fileC = makeFile('c.md');

    const getUserArchive = vi.fn(
      async (archiveId: string): Promise<{ archive: RemoteArchiveLocationSource }> => {
        if (archiveId === 'archive-b') {
          throw new Error('network down');
        }
        return { archive: makeArchive({ id: archiveId }) };
      },
    );

    const service = new LocationFrontmatterSyncService({
      app,
      apiClient: () => ({ getUserArchive }),
      findBySourceArchiveId: (id) =>
        id === 'archive-b' ? fileB : id === 'archive-c' ? fileC : null,
      isLocationCategoryEnabled: () => true,
    });

    // 'archive-a' has no vault note → never fetched.
    // 'archive-b' fetch throws → logged, batch continues.
    // 'archive-c' fetched + written. Duplicate id deduped.
    const result = await service.reconcileArchiveIds([
      'archive-a',
      'archive-b',
      'archive-c',
      'archive-c',
    ]);

    expect(getUserArchive).toHaveBeenCalledTimes(2);
    expect(getUserArchive).toHaveBeenCalledWith('archive-b');
    expect(getUserArchive).toHaveBeenCalledWith('archive-c');
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(processFrontMatter.mock.calls[0]?.[0]).toBe(fileC);
    expect(result.failedArchiveIds).toEqual(['archive-b']);
  });

  it('AUTHORITATIVE mode: overwrites differing existing values (unlike the sweep)', async () => {
    const { app, processFrontMatter, writtenFrontmatters } = makeApp({
      location: 'Hand-edited place',
      latitude: 1,
      longitude: 2,
      coordinates: '1, 2',
    });
    const service = new LocationFrontmatterSyncService({
      app,
      apiClient: () => ({
        getUserArchive: async () => ({ archive: makeArchive() }),
      }),
      findBySourceArchiveId: () => makeFile('a.md'),
      isLocationCategoryEnabled: () => true,
    });

    await service.reconcileArchiveIds(['archive-1']);

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(writtenFrontmatters[0]).toEqual({
      location: 'Blue Bottle Seongsu',
      latitude: 37.5446,
      longitude: 127.0559,
      coordinates: '37.5446, 127.0559',
      locationSource: 'kakaomap',
      locationExternalId: '12345',
    });
  });

  it('upgrades provisional location fields after enrichment without changing user frontmatter', async () => {
    const { app, processFrontMatter, writtenFrontmatters } = makeApp({
      location: '희작',
      latitude: 37.1,
      longitude: 126.9,
      coordinates: '37.1, 126.9',
      tags: ['카페', '다시-가기'],
      userMemo: '창가 자리 선호',
    });
    const service = new LocationFrontmatterSyncService({
      app,
      apiClient: () => ({
        getUserArchive: async () => ({
          archive: makeArchive({
            location: '희작 부암점',
            latitude: 37.5978,
            longitude: 126.9642,
          }),
        }),
      }),
      findBySourceArchiveId: () => makeFile('a.md'),
      isLocationCategoryEnabled: () => true,
    });

    await service.reconcileArchiveIds(['archive-1']);

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(writtenFrontmatters[0]).toEqual({
      location: '희작 부암점',
      latitude: 37.5978,
      longitude: 126.9642,
      coordinates: '37.5978, 126.9642',
      locationSource: 'kakaomap',
      locationExternalId: '12345',
      tags: ['카페', '다시-가기'],
      userMemo: '창가 자리 선호',
    });
  });

  it('AUTHORITATIVE mode: removes location frontmatter when the server clears it', async () => {
    const { app, processFrontMatter, writtenFrontmatters } = makeApp({
      location: 'Blue Bottle Seongsu',
      latitude: 37.5446,
      longitude: 127.0559,
      coordinates: '37.5446, 127.0559',
      tags: ['cafe'],
    });
    const service = new LocationFrontmatterSyncService({
      app,
      apiClient: () => ({
        getUserArchive: async () => ({
          archive: makeArchive({
            location: null,
            latitude: null,
            longitude: null,
            locationSource: null,
            locationExternalId: null,
          }),
        }),
      }),
      findBySourceArchiveId: () => makeFile('a.md'),
      isLocationCategoryEnabled: () => true,
    });

    await service.reconcileArchiveIds(['archive-1']);

    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(writtenFrontmatters[0]).toEqual({ tags: ['cafe'] });
  });

  it('processes every unique ID when the reconcile spans more than one bounded chunk', async () => {
    const { app } = makeApp({});
    const getUserArchive = vi.fn(
      async (archiveId: string): Promise<{ archive: RemoteArchiveLocationSource }> => ({
        archive: makeArchive({ id: archiveId }),
      }),
    );
    const service = new LocationFrontmatterSyncService({
      app,
      apiClient: () => ({ getUserArchive }),
      findBySourceArchiveId: (id) => makeFile(`${id}.md`),
      isLocationCategoryEnabled: () => true,
    });

    const ids = Array.from({ length: MAX_WS_RECONCILE_BATCH + 50 }, (_, i) => `archive-${i}`);
    const result = await service.reconcileArchiveIds([...ids, ids[0] ?? 'archive-0']);

    expect(getUserArchive).toHaveBeenCalledTimes(ids.length);
    expect(getUserArchive.mock.calls.map(([archiveId]) => archiveId)).toEqual(ids);
    expect(result.failedArchiveIds).toEqual([]);
  });

  it('aborts the loop once dispose() is called', async () => {
    const { app, processFrontMatter } = makeApp({});
    const getUserArchive = vi.fn(
      async (archiveId: string): Promise<{ archive: RemoteArchiveLocationSource }> => {
        // Simulate plugin unload mid-batch: dispose during the first fetch.
        service.dispose();
        return { archive: makeArchive({ id: archiveId }) };
      },
    );
    const service = new LocationFrontmatterSyncService({
      app,
      apiClient: () => ({ getUserArchive }),
      findBySourceArchiveId: (id) => makeFile(`${id}.md`),
      isLocationCategoryEnabled: () => true,
    });

    const result = await service.reconcileArchiveIds(['archive-1', 'archive-2', 'archive-3']);

    // Disposed during the first fetch → no write, no further iterations.
    expect(getUserArchive).toHaveBeenCalledTimes(1);
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(result.failedArchiveIds).toEqual(['archive-1', 'archive-2', 'archive-3']);
  });

  it('is a no-op when the API client is unavailable', async () => {
    const { app, processFrontMatter } = makeApp({});
    const service = new LocationFrontmatterSyncService({
      app,
      apiClient: () => undefined,
      findBySourceArchiveId: () => makeFile('a.md'),
      isLocationCategoryEnabled: () => true,
    });

    await service.reconcileArchiveIds(['archive-a']);

    expect(processFrontMatter).not.toHaveBeenCalled();
  });
});
