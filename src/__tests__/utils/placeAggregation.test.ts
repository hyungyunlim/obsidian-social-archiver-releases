import { describe, expect, it } from 'vitest';
import {
  aggregatePlaces,
  availablePlaceKinds,
  availablePlaceProviders,
  filterPlacesByKinds,
  filterPlacesByProvider,
  filterPlacesBySearch,
  hasPlace,
  locationsForPost,
  sortPlaces,
} from '@/utils/placeAggregation';
import type { ArchiveLocation } from '@/types/archive-location';
import type { PlaceKind } from '@/shared/platforms/place-kinds';
import type { PostData } from '@/types/post';

/**
 * The plugin's places read model. Three rules here are load-bearing because
 * getting them wrong is either invisible or permanent:
 *
 * - eligibility is the place DATA, not `platform` (86% of place-bearing notes
 *   measured on a real vault sit on non-map platforms)
 * - `placeKey` folds ASCII-only, or keys never match server/mobile/desktop
 * - map-provider archives are not related posts, or counts drift from the
 *   other clients
 */

function loc(overrides: Partial<ArchiveLocation> = {}): ArchiveLocation {
  return {
    id: 'loc-1',
    archiveId: 'arc-1',
    placeKey: 'kakaomap:111',
    name: '개나리',
    address: '서울 성동구',
    latitude: 37.54,
    longitude: 127.05,
    source: 'kakaomap',
    externalId: '111',
    url: 'https://place.map.kakao.com/111',
    category: '음식점',
    placeKind: 'restaurant',
    isPrimary: true,
    sortOrder: 0,
    placeArchiveId: null,
    promotionStatus: 'metadata_only',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as ArchiveLocation;
}

function post(
  filePath: string,
  locations: ArchiveLocation[],
  opts: { platform?: string; timestamp?: string; flat?: Partial<PostData['metadata']> } = {},
): PostData {
  return {
    platform: opts.platform ?? 'threads',
    id: filePath,
    filePath,
    url: `https://example.com/${filePath}`,
    author: { name: 'A', url: 'https://example.com' },
    content: { text: 'body' },
    media: [],
    metadata: {
      timestamp: new Date(opts.timestamp ?? '2026-07-01T00:00:00.000Z'),
      ...(locations.length > 0 ? { locations } : {}),
      ...(opts.flat ?? {}),
    },
  } as unknown as PostData;
}

describe('locationsForPost', () => {
  it('takes the structured array when present', () => {
    expect(locationsForPost(post('a.md', [loc(), loc({ id: 'l2', placeKey: 'kakaomap:222' })]))).toHaveLength(2);
  });

  it('drops entries with no name or no placeKey', () => {
    const result = locationsForPost(post('a.md', [
      loc(),
      loc({ id: 'l2', name: '  ' }),
      loc({ id: 'l3', placeKey: '' as never }),
    ]));
    expect(result).toHaveLength(1);
  });

  it('falls back to the flat fields for notes predating the array', () => {
    const legacy = post('a.md', [], {
      flat: { location: '오뎅촌', locationSource: 'navermap', locationExternalId: '999' },
    });
    const [only] = locationsForPost(legacy);

    expect(only?.name).toBe('오뎅촌');
    expect(only?.placeKey).toBe('navermap:999');
  });

  it('folds a provider-less legacy key ASCII-only', () => {
    // SQLite ships no ICU: its LOWER() leaves É alone while folding the ASCII
    // letters around it. `CAFÉ` therefore becomes `cafÉ`, not `café` — a full JS
    // fold would mint a key that never matches the server, mobile, or desktop.
    const [only] = locationsForPost(post('a.md', [], { flat: { location: 'CAFÉ Étoile' } }));

    expect(only?.placeKey).toBe('name:cafÉ Étoile');
  });

  it('yields nothing when there is no place at all', () => {
    expect(locationsForPost(post('a.md', []))).toHaveLength(0);
    expect(hasPlace(post('a.md', []))).toBe(false);
  });

  it('treats a blank flat location as no place', () => {
    expect(hasPlace(post('a.md', [], { flat: { location: '   ' } }))).toBe(false);
  });
});

describe('aggregatePlaces', () => {
  it('groups references to one place across posts', () => {
    const places = aggregatePlaces([
      post('a.md', [loc()]),
      post('b.md', [loc({ id: 'l2', archiveId: 'arc-2' })]),
    ]);

    expect(places).toHaveLength(1);
    expect(places[0]?.relatedPostCount).toBe(2);
    expect(places[0]?.filePaths).toEqual(['a.md', 'b.md']);
  });

  it('counts a place once per post even when attached twice', () => {
    const places = aggregatePlaces([post('a.md', [loc(), loc({ id: 'l2' })])]);

    expect(places[0]?.relatedPostCount).toBe(1);
  });

  it('does not count a map-provider archive, but does collect its path', () => {
    // Two different jobs. For a place the provider card IS the place, so counting
    // it would inflate every count against mobile and desktop. But selecting the
    // place should still surface the place's own archive alongside the posts,
    // which is what desktop's placeKey filter does — so the path is collected.
    const places = aggregatePlaces([
      post('map.md', [loc()], { platform: 'kakaomap' }),
      post('social.md', [loc({ id: 'l2' })]),
    ]);

    expect(places[0]?.relatedPostCount).toBe(1);
    expect(places[0]?.filePaths).toEqual(['map.md', 'social.md']);
  });

  it('adds the place archive as the +1 in archiveCount', () => {
    const places = aggregatePlaces([
      post('a.md', [loc({ placeArchiveId: 'place-arc', promotionStatus: 'archived' })]),
    ]);

    expect(places[0]?.relatedPostCount).toBe(1);
    expect(places[0]?.archiveCount).toBe(2);
    expect(places[0]?.placeArchiveId).toBe('place-arc');
  });

  it('keeps archiveCount equal to relatedPostCount without a place archive', () => {
    const places = aggregatePlaces([post('a.md', [loc()])]);
    expect(places[0]?.archiveCount).toBe(1);
  });

  it('lets the freshest reference win each metadata field', () => {
    const places = aggregatePlaces([
      post('old.md', [loc({ name: 'Old Name', updatedAt: '2026-07-01T00:00:00.000Z' })]),
      post('new.md', [loc({ id: 'l2', name: 'New Name', category: '카페', updatedAt: '2026-07-20T00:00:00.000Z' })]),
    ]);

    expect(places[0]?.name).toBe('New Name');
    expect(places[0]?.category).toBe('카페');
  });

  it('does not let a stale reference visited later overwrite fresh metadata', () => {
    const places = aggregatePlaces([
      post('new.md', [loc({ name: 'New Name', updatedAt: '2026-07-20T00:00:00.000Z' })]),
      post('old.md', [loc({ id: 'l2', name: 'Old Name', updatedAt: '2026-07-01T00:00:00.000Z' })]),
    ]);

    expect(places[0]?.name).toBe('New Name');
  });

  it('takes coordinates from the freshest reference that has them', () => {
    const places = aggregatePlaces([
      post('a.md', [loc({ latitude: null, longitude: null, updatedAt: '2026-07-20T00:00:00.000Z' })]),
      post('b.md', [loc({ id: 'l2', latitude: 37.1, longitude: 127.1, updatedAt: '2026-07-05T00:00:00.000Z' })]),
    ]);

    expect(places[0]?.hasCoords).toBe(true);
    expect(places[0]?.latitude).toBe(37.1);
  });

  it('reports no coordinates when nothing supplies a pair', () => {
    const places = aggregatePlaces([post('a.md', [loc({ latitude: null, longitude: null })])]);

    expect(places[0]?.hasCoords).toBe(false);
    expect(places[0]?.latitude).toBeUndefined();
  });

  it('lets an archived promotion win over metadata_only', () => {
    const places = aggregatePlaces([
      post('a.md', [loc()]),
      post('b.md', [loc({ id: 'l2', promotionStatus: 'archived', placeArchiveId: 'p1' })]),
    ]);

    expect(places[0]?.placeArchiveState).toBe('archived');
  });

  it('keeps archived once reached, even if another reference lags', () => {
    const places = aggregatePlaces([
      post('a.md', [loc({ promotionStatus: 'archived', placeArchiveId: 'p1' })]),
      post('b.md', [loc({ id: 'l2', promotionStatus: 'metadata_only' })]),
    ]);

    expect(places[0]?.placeArchiveState).toBe('archived');
  });

  it('sorts by post count then name, matching the other clients', () => {
    const places = aggregatePlaces([
      post('a.md', [loc({ placeKey: 'k:1', name: 'Bravo' })]),
      post('b.md', [loc({ placeKey: 'k:2', name: 'Alpha' })]),
      post('c.md', [loc({ placeKey: 'k:2', name: 'Alpha' })]),
    ]);

    expect(places.map((p) => p.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('ignores posts with no place', () => {
    expect(aggregatePlaces([post('a.md', []), post('b.md', [])])).toEqual([]);
  });
});

describe('place list filters', () => {
  const places = aggregatePlaces([
    post('a.md', [loc({ placeKey: 'k:1', name: '개나리', address: '서울 성동구', placeKind: 'restaurant', source: 'kakaomap' })]),
    post('b.md', [loc({ placeKey: 'k:2', name: 'Blue Bottle', address: 'Seoul Jung-gu', placeKind: 'cafe', source: 'googlemaps' })]),
    post('c.md', [loc({ placeKey: 'k:3', name: 'Unclassified', address: null, placeKind: null, source: 'navermap' })]),
  ]);

  it('searches name and address, case-insensitively', () => {
    expect(filterPlacesBySearch(places, 'blue').map((p) => p.name)).toEqual(['Blue Bottle']);
    expect(filterPlacesBySearch(places, '성동').map((p) => p.name)).toEqual(['개나리']);
  });

  it('returns everything for an empty query', () => {
    expect(filterPlacesBySearch(places, '  ')).toHaveLength(3);
  });

  it('filters by kind, and null matches the unclassified', () => {
    // Measured on a real vault a third of references carry no kind, so the
    // unclassified bucket has to be selectable rather than unreachable.
    expect(filterPlacesByKinds(places, new Set<PlaceKind | null>(['cafe'])).map((p) => p.name))
      .toEqual(['Blue Bottle']);
    expect(filterPlacesByKinds(places, new Set<PlaceKind | null>([null])).map((p) => p.name))
      .toEqual(['Unclassified']);
  });

  it('treats an empty kind set as no filter', () => {
    expect(filterPlacesByKinds(places, new Set())).toHaveLength(3);
  });

  it('filters by provider', () => {
    expect(filterPlacesByProvider(places, 'navermap').map((p) => p.name)).toEqual(['Unclassified']);
    expect(filterPlacesByProvider(places, null)).toHaveLength(3);
  });

  it('offers only the kinds and providers actually present', () => {
    expect(new Set(availablePlaceKinds(places))).toEqual(new Set([null, 'cafe', 'restaurant']));
    expect(availablePlaceProviders(places).sort()).toEqual(['googlemaps', 'kakaomap', 'navermap']);
  });

  it('sorts by name, count, and recency', () => {
    expect(sortPlaces(places, 'name').map((p) => p.name)).toEqual(['Blue Bottle', 'Unclassified', '개나리']);
    expect(sortPlaces(places, 'count')[0]?.archiveCount).toBe(1);
    expect(sortPlaces(places, 'recent')).toHaveLength(3);
  });
});
