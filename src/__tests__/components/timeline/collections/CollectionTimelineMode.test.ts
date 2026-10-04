import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from 'obsidian';
import { CollectionStore, type KeyValueStorage } from '../../../../services/collections/CollectionStore';
import { CollectionTimelineMode } from '../../../../components/timeline/collections/CollectionTimelineMode';
import type { CollectionService } from '../../../../services/collections/CollectionService';
import type { CollectionUiActions } from '../../../../plugin/collections/CollectionUiActions';
import type { UserCollectionDTO } from '../../../../types/collections';

class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, unknown>();
  load(key: string): unknown {
    return this.data.get(key) ?? null;
  }
  save(key: string, value: unknown): void {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

const dto = (id: string, overrides: Partial<UserCollectionDTO> = {}): UserCollectionDTO => ({
  id, name: id, description: null, visibility: 'private', shareToken: null, displayMode: 'timeline',
  includeAnnotations: true, sortOrder: 0, createdAt: 'c', updatedAt: 'u', role: 'owner', ...overrides,
});

function setup() {
  const store = new CollectionStore(new MemoryStorage());
  store.switchUser('alice');
  store.applyRemoteCollections({
    collections: [dto('col-trips01'), dto('col-shared1', { collaborative: true, role: 'editor', ownerUsername: 'bob' })],
    deletedIds: [],
    serverTime: 't',
  });
  store.addItems('col-trips01', ['arch-1', 'arch-2']);
  const host = { applyCollectionFilter: vi.fn(), rerender: vi.fn() };
  const notes: Record<string, string> = { 'arch-1': 'Social Archives/a.md' };
  const mode = new CollectionTimelineMode({
    store,
    service: {} as CollectionService,
    ui: {} as CollectionUiActions,
    events: new Events(),
    resolveFilePath: (archiveId) => notes[archiveId] ?? null,
    openFile: vi.fn(),
    openUrl: vi.fn(),
    host,
  });
  return { store, host, mode };
}

describe('CollectionTimelineMode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('narrows the timeline to the notes of my items and counts the ones not in this vault', () => {
    const { host, mode } = setup();
    mode.open('col-trips01');
    expect(host.applyCollectionFilter).toHaveBeenCalledWith(new Set(['Social Archives/a.md']));
    expect(host.rerender).toHaveBeenCalledTimes(1);
    expect(mode.isCollaborativeActive()).toBe(false);
  });

  it('treats a collaborative collection as server-rendered', () => {
    const { mode } = setup();
    mode.open('col-shared1');
    expect(mode.isCollaborativeActive()).toBe(true);
  });

  it('ignores an unknown collection id', () => {
    const { host, mode } = setup();
    mode.open('col-missing');
    expect(host.applyCollectionFilter).not.toHaveBeenCalled();
    expect(mode.getActiveId()).toBeNull();
  });

  it('goes back to all posts when the open collection disappears', () => {
    const { store, host, mode } = setup();
    mode.open('col-trips01');
    store.deleteCollection('col-trips01');
    vi.runAllTimers();
    expect(mode.getActiveId()).toBeNull();
    expect(host.applyCollectionFilter).toHaveBeenLastCalledWith(null);
  });

  it('refreshes the filter when items change, and only then', () => {
    const { store, host, mode } = setup();
    mode.open('col-trips01');
    host.applyCollectionFilter.mockClear();

    store.updateCollectionDetails('col-trips01', { name: 'Renamed' });
    vi.runAllTimers();
    expect(host.applyCollectionFilter).not.toHaveBeenCalled();

    store.removeItems('col-trips01', ['arch-1']);
    vi.runAllTimers();
    expect(host.applyCollectionFilter).toHaveBeenCalledWith(new Set());
  });

  it('follows a server remap of the open collection', () => {
    const { store, mode } = setup();
    mode.open('col-trips01');
    store.remapCollection('col-trips01', dto('col-server1', { name: 'col-trips01' }));
    vi.runAllTimers();
    expect(mode.getActiveId()).toBe('col-server1');
  });
});
