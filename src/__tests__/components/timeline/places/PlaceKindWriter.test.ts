import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { PlaceKindWriter } from '@/components/timeline/places/PlaceKindWriter';
import { LocationBodyBlock } from '@/services/markdown/LocationBodyBlock';
import type { ArchiveLocation } from '@/types/archive-location';

/**
 * A place is an aggregate over every note that mentions it, not a record — so
 * reclassifying one is a write to each of those notes.
 */

/**
 * A location the schema actually accepts — `ArchiveLocationSchema` is strict, and
 * `LocationBodyBlock.parse` drops anything that fails it, so a sloppy fixture
 * reads as "the writer wrote nothing".
 */
function location(overrides: Partial<ArchiveLocation> = {}): ArchiveLocation {
  return {
    id: 'loc-1',
    archiveId: 'arc-1',
    placeKey: 'kakaomap:1',
    name: '개나리',
    address: null,
    latitude: 37.5,
    longitude: 127.0,
    source: 'kakaomap',
    externalId: '1',
    url: null,
    category: null,
    placeKind: null,
    isPrimary: true,
    sortOrder: 0,
    placeArchiveId: null,
    promotionStatus: 'metadata_only',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  } as ArchiveLocation;
}

function note(locations: ArchiveLocation[]): string {
  return `# Note\n\nbody\n\n${LocationBodyBlock.serialize(locations)}\n`;
}

/** A vault of path -> content, with just the surface the writer touches. */
function fakeApp(files: Record<string, string>): { app: App; files: Record<string, string> } {
  const app = {
    vault: {
      getFileByPath: (path: string) =>
        (path in files ? ({ path } as TFile) : null),
      process: async (file: TFile, fn: (content: string) => string) => {
        files[file.path] = fn(files[file.path] ?? '');
      },
    },
  } as unknown as App;
  return { app, files };
}

describe('PlaceKindWriter', () => {
  it('writes the kind into every note referencing the place', async () => {
    const { app, files } = fakeApp({
      'a.md': note([location()]),
      'b.md': note([location({ id: 'loc-2' })]),
    });
    const sync = vi.fn(async () => {});

    const result = await new PlaceKindWriter(app, sync).apply('kakaomap:1', 'cafe', ['a.md', 'b.md']);

    expect(result.updated).toBe(2);
    for (const content of Object.values(files)) {
      expect(LocationBodyBlock.parse(content)?.[0]?.placeKind).toBe('cafe');
    }
    expect(sync).toHaveBeenCalledWith('kakaomap:1', 'cafe');
  });

  it('leaves other places in the same note alone', async () => {
    const { app, files } = fakeApp({
      'a.md': note([location(), location({ id: 'loc-2', placeKey: 'kakaomap:2', name: '다른곳' })]),
    });

    await new PlaceKindWriter(app, vi.fn(async () => {})).apply('kakaomap:1', 'bakery', ['a.md']);

    const parsed = LocationBodyBlock.parse(files['a.md'] ?? '') ?? [];
    expect(parsed.find((l) => l.placeKey === 'kakaomap:1')?.placeKind).toBe('bakery');
    expect(parsed.find((l) => l.placeKey === 'kakaomap:2')?.placeKind).toBeNull();
  });

  it('clears the kind when given null', async () => {
    const { app, files } = fakeApp({ 'a.md': note([location({ placeKind: 'cafe' })]) });

    await new PlaceKindWriter(app, vi.fn(async () => {})).apply('kakaomap:1', null, ['a.md']);

    expect(LocationBodyBlock.parse(files['a.md'] ?? '')?.[0]?.placeKind).toBeNull();
  });

  it('does not rewrite a note that already has the kind', async () => {
    // `vault.process` writes whatever it returns, so a no-op that re-serialises
    // would bump the modified time of every note holding the place.
    const original = note([location({ placeKind: 'cafe' })]);
    const { app, files } = fakeApp({ 'a.md': original });

    const result = await new PlaceKindWriter(app, vi.fn(async () => {})).apply(
      'kakaomap:1',
      'cafe',
      ['a.md'],
    );

    expect(result.updated).toBe(0);
    expect(files['a.md']).toBe(original);
  });

  it('skips a path that is no longer in the vault', async () => {
    const { app } = fakeApp({ 'a.md': note([location()]) });

    const result = await new PlaceKindWriter(app, vi.fn(async () => {})).apply(
      'kakaomap:1',
      'cafe',
      ['a.md', 'deleted.md'],
    );

    expect(result.updated).toBe(1);
  });

  it('reports a failed sync instead of throwing, since the vault already changed', async () => {
    // The plugin renders the vault, so the change IS applied. Throwing here
    // would tell the user nothing happened when something did.
    const { app, files } = fakeApp({ 'a.md': note([location()]) });
    const sync = vi.fn(async () => {
      throw new Error('offline');
    });

    const result = await new PlaceKindWriter(app, sync).apply('kakaomap:1', 'cafe', ['a.md']);

    expect(result.updated).toBe(1);
    expect(result.syncError?.message).toBe('offline');
    expect(LocationBodyBlock.parse(files['a.md'] ?? '')?.[0]?.placeKind).toBe('cafe');
  });

  it('does not call the server when nothing was written', async () => {
    const { app } = fakeApp({ 'a.md': note([location({ placeKind: 'cafe' })]) });
    const sync = vi.fn(async () => {});

    await new PlaceKindWriter(app, sync).apply('kakaomap:1', 'cafe', ['a.md']);

    expect(sync).not.toHaveBeenCalled();
  });
});
