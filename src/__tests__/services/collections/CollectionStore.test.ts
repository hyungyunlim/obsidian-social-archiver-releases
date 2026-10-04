import { describe, expect, it } from 'vitest';
import { CollectionStore, normalizeCollectionName, type KeyValueStorage } from '../../../services/collections/CollectionStore';
import type { UserCollectionDTO } from '../../../types/collections';

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, unknown>();
  load(key: string): unknown {
    const value = this.data.get(key);
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  }
  save(key: string, value: unknown): void {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

function dto(overrides: Partial<UserCollectionDTO> & { id: string }): UserCollectionDTO {
  return {
    name: overrides.id,
    description: null,
    visibility: 'private',
    shareToken: null,
    displayMode: 'timeline',
    includeAnnotations: true,
    sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    role: 'owner',
    ...overrides,
  };
}

function storeFor(user = 'alice', storage = new MemoryStorage()): { store: CollectionStore; storage: MemoryStorage } {
  const store = new CollectionStore(storage);
  store.switchUser(user);
  return { store, storage };
}

describe('CollectionStore', () => {
  it('creates a private owned collection that is dirty and not yet known to the server', () => {
    const { store } = storeFor();
    store.createCollection({ id: 'col-aaaaaaaa', name: 'Kaohsiung', description: null, sortOrder: 0 });
    const [collection] = store.getCollections();
    expect(collection).toMatchObject({ id: 'col-aaaaaaaa', visibility: 'private', role: 'owner', isDirty: true, synced: false, itemCount: 0 });
  });

  it('orders collections by sortOrder, then name', () => {
    const { store } = storeFor();
    store.createCollection({ id: 'col-bbbbbbbb', name: 'Beta', description: null, sortOrder: 1 });
    store.createCollection({ id: 'col-cccccccc', name: 'Alpha', description: null, sortOrder: 1 });
    store.createCollection({ id: 'col-dddddddd', name: 'Zed', description: null, sortOrder: 0 });
    expect(store.getCollections().map((c) => c.name)).toEqual(['Zed', 'Alpha', 'Beta']);
  });

  it('keeps a reverse index from archive to collections', () => {
    const { store } = storeFor();
    store.createCollection({ id: 'col-aaaaaaaa', name: 'A', description: null, sortOrder: 0 });
    store.createCollection({ id: 'col-bbbbbbbb', name: 'B', description: null, sortOrder: 1 });
    store.addItems('col-aaaaaaaa', ['arch-1', 'arch-2']);
    store.addItems('col-bbbbbbbb', ['arch-1']);
    expect(store.getCollectionIdsForArchive('arch-1').sort()).toEqual(['col-aaaaaaaa', 'col-bbbbbbbb']);
    store.removeItems('col-aaaaaaaa', ['arch-1']);
    expect(store.getCollectionIdsForArchive('arch-1')).toEqual(['col-bbbbbbbb']);
    expect(store.getArchiveIds('col-aaaaaaaa')).toEqual(['arch-2']);
  });

  it('queues a server delete for a removed item only once the collection is on the server', () => {
    const { store } = storeFor();
    store.createCollection({ id: 'col-aaaaaaaa', name: 'A', description: null, sortOrder: 0 });
    store.addItems('col-aaaaaaaa', ['arch-1']);
    store.removeItems('col-aaaaaaaa', ['arch-1']);
    expect(store.getPendingItemDeletes()).toEqual([]);

    store.markCollectionsSynced([{ id: 'col-aaaaaaaa', revision: 1 }]);
    store.addItems('col-aaaaaaaa', ['arch-1']);
    store.removeItems('col-aaaaaaaa', ['arch-1']);
    expect(store.getPendingItemDeletes()).toEqual([{ collectionId: 'col-aaaaaaaa', archiveId: 'arch-1' }]);

    // Re-adding cancels the queued delete.
    store.addItems('col-aaaaaaaa', ['arch-1']);
    expect(store.getPendingItemDeletes()).toEqual([]);
  });

  it('only pushes items whose collection the server already knows', () => {
    const { store } = storeFor();
    store.createCollection({ id: 'col-aaaaaaaa', name: 'A', description: null, sortOrder: 0 });
    store.addItems('col-aaaaaaaa', ['arch-1']);
    expect(store.getPushableItems()).toEqual([]);
    store.markCollectionsSynced([{ id: 'col-aaaaaaaa', revision: 1 }]);
    expect(store.getPushableItems().map((item) => item.archiveId)).toEqual(['arch-1']);
  });

  it('keeps a collection dirty when it was edited again while its push was in flight', () => {
    const { store } = storeFor();
    store.createCollection({ id: 'col-aaaaaaaa', name: 'A', description: null, sortOrder: 0 });
    const [{ revision }] = store.getDirtyCollections();
    store.updateCollectionDetails('col-aaaaaaaa', { name: 'A2' });
    store.markCollectionsSynced([{ id: 'col-aaaaaaaa', revision }]);
    expect(store.getCollection('col-aaaaaaaa')).toMatchObject({ synced: true, isDirty: true, name: 'A2' });
  });

  it('moves a remapped collection and its items to the canonical id', () => {
    const { store } = storeFor();
    store.createCollection({ id: 'col-local01', name: 'Trips', description: null, sortOrder: 0 });
    store.addItems('col-local01', ['arch-1']);
    store.remapCollection('col-local01', dto({ id: 'col-server1', name: 'Trips' }));

    expect(store.getCollection('col-local01')?.id).toBe('col-server1');
    expect(store.resolveId('col-local01')).toBe('col-server1');
    expect(store.getArchiveIds('col-server1')).toEqual(['arch-1']);
    expect(store.getCollectionIdsForArchive('arch-1')).toEqual(['col-server1']);
    expect(store.getCollection('col-server1')).toMatchObject({ isDirty: false, synced: true });
  });

  it('overwrites a refused rename and forgets a row the server will never accept', () => {
    const { store } = storeFor();
    store.createCollection({ id: 'col-aaaaaaaa', name: 'Mine', description: null, sortOrder: 0 });
    store.applyRejected('col-aaaaaaaa', dto({ id: 'col-aaaaaaaa', name: 'Server name' }));
    expect(store.getCollection('col-aaaaaaaa')).toMatchObject({ name: 'Server name', isDirty: false });

    store.createCollection({ id: 'col-bbbbbbbb', name: 'Over limit', description: null, sortOrder: 1 });
    store.addItems('col-bbbbbbbb', ['arch-1']);
    store.applyRejected('col-bbbbbbbb', undefined);
    expect(store.getCollection('col-bbbbbbbb')).toBeUndefined();
    expect(store.getCollectionIdsForArchive('arch-1')).toEqual([]);
  });

  it('applies server-owned fields to a dirty row but keeps its unpushed name', () => {
    const { store } = storeFor();
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa', name: 'Old' })], deletedIds: [], serverTime: 't1' });
    store.updateCollectionDetails('col-aaaaaaaa', { name: 'New' });
    store.applyRemoteCollections({
      collections: [dto({ id: 'col-aaaaaaaa', name: 'Other device', visibility: 'unlisted', shareToken: 'TOKEN0123456789A' })],
      deletedIds: [],
      serverTime: 't2',
    });
    expect(store.getCollection('col-aaaaaaaa')).toMatchObject({ name: 'New', visibility: 'unlisted', shareToken: 'TOKEN0123456789A', isDirty: true });
    expect(store.getCursors().collections).toBe('t2');
  });

  it('drops deleted collections and non-owned ones missing from the membership list', () => {
    const { store } = storeFor();
    store.applyRemoteCollections({
      collections: [
        dto({ id: 'col-owned01' }),
        dto({ id: 'col-member1', role: 'editor', ownerUsername: 'bob' }),
        dto({ id: 'col-member2', role: 'viewer', ownerUsername: 'carol' }),
      ],
      deletedIds: [],
      memberCollectionIds: ['col-member1', 'col-member2'],
      serverTime: 't1',
    });
    store.applyRemoteCollections({
      collections: [],
      deletedIds: ['col-owned01'],
      memberCollectionIds: ['col-member1'],
      serverTime: 't2',
    });
    expect(store.getCollections().map((c) => c.id)).toEqual(['col-member1']);
  });

  it('does not resurrect a collection queued for deletion', () => {
    const { store } = storeFor();
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't1' });
    store.deleteCollection('col-aaaaaaaa');
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't2' });
    expect(store.getCollection('col-aaaaaaaa')).toBeUndefined();
    expect(store.getPendingCollectionDeletes()).toEqual(['col-aaaaaaaa']);
  });

  it('keeps the item cursor when an item names a collection this device lacks', () => {
    const { store } = storeFor();
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't1' });
    const complete = store.applyRemoteItems({
      items: [
        { collectionId: 'col-aaaaaaaa', archiveId: 'arch-1', addedAt: 'a', updatedAt: 'a' },
        { collectionId: 'col-unknown', archiveId: 'arch-2', addedAt: 'a', updatedAt: 'a' },
      ],
      deletedPairs: [],
      serverTime: 'items-t1',
    });
    expect(complete).toBe(false);
    expect(store.getCursors().items).toBeNull();
    expect(store.getArchiveIds('col-aaaaaaaa')).toEqual(['arch-1']);
  });

  it('lets an unpushed local re-add win over a remote removal', () => {
    const { store } = storeFor();
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't1' });
    store.addItems('col-aaaaaaaa', ['arch-1']);
    store.applyRemoteItems({ items: [], deletedPairs: [{ collectionId: 'col-aaaaaaaa', archiveId: 'arch-1' }], serverTime: 'i1' });
    expect(store.getArchiveIds('col-aaaaaaaa')).toEqual(['arch-1']);

    store.markItemsSynced([{ collectionId: 'col-aaaaaaaa', archiveId: 'arch-1' }]);
    store.applyRemoteItems({ items: [], deletedPairs: [{ collectionId: 'col-aaaaaaaa', archiveId: 'arch-1' }], serverTime: 'i2' });
    expect(store.getArchiveIds('col-aaaaaaaa')).toEqual([]);
  });

  it('persists per user and restores queues and cursors', () => {
    const storage = new MemoryStorage();
    const { store } = storeFor('alice', storage);
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't1' });
    store.addItems('col-aaaaaaaa', ['arch-1']);
    store.removeItems('col-aaaaaaaa', ['arch-9']);

    const reloaded = new CollectionStore(storage);
    reloaded.switchUser('alice');
    expect(reloaded.getArchiveIds('col-aaaaaaaa')).toEqual(['arch-1']);
    expect(reloaded.getPendingItemDeletes()).toEqual([{ collectionId: 'col-aaaaaaaa', archiveId: 'arch-9' }]);
    expect(reloaded.getCursors().collections).toBe('t1');

    reloaded.switchUser('bob');
    expect(reloaded.getCollections()).toEqual([]);
  });

  it('persists nothing while signed out', () => {
    const storage = new MemoryStorage();
    const store = new CollectionStore(storage);
    store.switchUser(null);
    store.createCollection({ id: 'col-aaaaaaaa', name: 'A', description: null, sortOrder: 0 });
    expect(storage.data.size).toBe(0);
  });

  it('treats names as equal after trim and ASCII case folding, among owned collections only', () => {
    const { store } = storeFor();
    store.applyRemoteCollections({
      collections: [dto({ id: 'col-aaaaaaaa', name: 'Trips' }), dto({ id: 'col-bbbbbbbb', name: 'Shared', role: 'editor' })],
      deletedIds: [],
      serverTime: 't1',
    });
    expect(store.hasNameConflict('  trips ')).toBe(true);
    expect(store.hasNameConflict('Shared')).toBe(false);
    expect(store.hasNameConflict('Trips', 'col-aaaaaaaa')).toBe(false);
    // ASCII-only folding, like SQLite NOCASE: É stays É.
    expect(normalizeCollectionName('ÉTÉ')).toBe('ÉtÉ');
  });

  it('notifies listeners on change', () => {
    const { store } = storeFor();
    let calls = 0;
    const off = store.onChange(() => calls++);
    store.createCollection({ id: 'col-aaaaaaaa', name: 'A', description: null, sortOrder: 0 });
    off();
    store.addItems('col-aaaaaaaa', ['arch-1']);
    expect(calls).toBe(1);
  });
});
