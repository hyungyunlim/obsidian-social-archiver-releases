import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { CollectionStore, type KeyValueStorage } from '../../../services/collections/CollectionStore';
import {
  CollectionPropertyMirror,
  COLLECTIONS_PROPERTY,
  desiredCollectionNames,
  matchesNames,
} from '../../../plugin/collections/CollectionPropertyMirror';
import type { UserCollectionDTO } from '../../../types/collections';

class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, unknown>();
  load(key: string): unknown {
    return this.data.get(key) ?? null;
  }
  save(key: string, value: unknown): void {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

const dto = (id: string, name: string): UserCollectionDTO => ({
  id, name, description: null, visibility: 'private', shareToken: null, displayMode: 'timeline',
  includeAnnotations: true, sortOrder: 0, createdAt: 'c', updatedAt: 'u', role: 'owner',
});

function setup(frontmatters: Record<string, Record<string, unknown>>, enabled = true) {
  const store = new CollectionStore(new MemoryStorage());
  store.switchUser('alice');
  store.applyRemoteCollections({ collections: [dto('col-trips01', 'Trips'), dto('col-food001', 'Food')], deletedIds: [], serverTime: 't' });
  const files = new Map(Object.keys(frontmatters).map((archiveId) => [archiveId, { path: `${archiveId}.md` } as TFile]));
  const processFrontMatter = vi.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
    const archiveId = file.path.replace('.md', '');
    fn(frontmatters[archiveId]!);
  });
  const app = {
    metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatters[file.path.replace('.md', '')] }) },
    fileManager: { processFrontMatter },
  } as unknown as App;
  const markUiModify = vi.fn();
  const mirror = new CollectionPropertyMirror({
    app,
    store,
    enabled: () => enabled,
    listArchiveIds: () => [...files.keys()],
    fileFor: (archiveId) => files.get(archiveId) ?? null,
    markUiModify,
    schedule: (callback) => { callback(); return 0; },
    cancel: () => undefined,
  });
  return { store, mirror, processFrontMatter, markUiModify, frontmatters };
}

describe('CollectionPropertyMirror', () => {
  it('lists a note’s collection names sorted and once', () => {
    const { store } = setup({});
    store.addItems('col-trips01', ['arch-1']);
    store.addItems('col-food001', ['arch-1']);
    expect(desiredCollectionNames(store, 'arch-1')).toEqual(['Food', 'Trips']);
    expect(desiredCollectionNames(store, 'arch-9')).toEqual([]);
  });

  it('compares order-insensitively and accepts a hand-written single value', () => {
    expect(matchesNames(['Trips', 'Food'], ['Food', 'Trips'])).toBe(true);
    expect(matchesNames('Trips', ['Trips'])).toBe(true);
    expect(matchesNames(undefined, [])).toBe(true);
    expect(matchesNames(['Trips'], ['Food', 'Trips'])).toBe(false);
  });

  it('writes only notes whose list differs, and marks each write as ours', async () => {
    const { store, mirror, processFrontMatter, markUiModify, frontmatters } = setup({
      'arch-1': {},
      'arch-2': { [COLLECTIONS_PROPERTY]: ['Trips'] },
      'arch-3': {},
    });
    store.addItems('col-trips01', ['arch-1', 'arch-2']);
    const written = await mirror.reconcile();
    expect(written).toBe(1);
    expect(frontmatters['arch-1']).toEqual({ [COLLECTIONS_PROPERTY]: ['Trips'] });
    expect(frontmatters['arch-3']).toEqual({});
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(markUiModify).toHaveBeenCalledWith('arch-1.md');
  });

  it('removes the property when a note leaves its last collection', async () => {
    const { mirror, frontmatters } = setup({ 'arch-1': { [COLLECTIONS_PROPERTY]: ['Trips'], title: 'x' } });
    await mirror.reconcile();
    expect(frontmatters['arch-1']).toEqual({ title: 'x' });
  });

  it('does nothing while turned off, and clearAll removes what it wrote', async () => {
    const { store, mirror, processFrontMatter, frontmatters } = setup({ 'arch-1': { [COLLECTIONS_PROPERTY]: ['Trips'] } }, false);
    store.addItems('col-food001', ['arch-1']);
    expect(await mirror.reconcile()).toBe(0);
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(await mirror.clearAll()).toBe(1);
    expect(frontmatters['arch-1']).toEqual({});
  });
});
