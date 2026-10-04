import { describe, expect, it, vi } from 'vitest';
import { CollectionStore, type KeyValueStorage } from '../../../services/collections/CollectionStore';
import { CollectionService, classifyFailure, type CollectionApi } from '../../../services/collections/CollectionService';
import { toCollectionDisplayMode, toPostShareDisplayMode } from '../../../services/collections/collectionDisplayMode';
import type { CollectionShareState, UserCollectionDTO } from '../../../types/collections';

class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, unknown>();
  load(key: string): unknown {
    return this.data.get(key) ?? null;
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
    createdAt: 'c',
    updatedAt: 'u',
    role: 'owner',
    ...overrides,
  };
}

function shareState(overrides: Partial<CollectionShareState> = {}): CollectionShareState {
  return {
    collectionId: 'col-aaaaaaaa',
    visibility: 'private',
    shareToken: null,
    shareUrl: null,
    displayMode: 'timeline',
    includeAnnotations: true,
    hiddenItemCount: 0,
    updatedAt: 'u',
    ...overrides,
  };
}

function setup(apiOverrides: Partial<Record<keyof CollectionApi, unknown>> = {}) {
  const store = new CollectionStore(new MemoryStorage());
  store.switchUser('alice');
  const sync = { schedulePush: vi.fn(), pushNow: vi.fn(async () => ({ pushedCollections: 0, pushedItems: 0 })) };
  const api = {
    getCollectionShareState: vi.fn(async () => shareState()),
    updateCollectionShare: vi.fn(async (_id: string, body: { visibility: string }) =>
      shareState({ visibility: body.visibility as CollectionShareState['visibility'], shareToken: 'TOKEN0123456789A', shareUrl: 'https://social-archive.org/alice/c/TOKEN0123456789A' })),
    leaveCollection: vi.fn(async () => undefined),
    getCollectionMembers: vi.fn(async () => ({ collectionId: 'x', ownerUsername: 'bob', viewerRole: 'editor', members: [] })),
    ...apiOverrides,
  } as unknown as CollectionApi;
  let counter = 0;
  const service = new CollectionService({
    store,
    sync,
    api: () => api,
    isAuthenticated: () => true,
    username: () => 'alice',
    generateId: () => `col-gen${String(++counter).padStart(5, '0')}`,
  });
  return { store, sync, api, service };
}

describe('CollectionService', () => {
  it('creates a collection locally and schedules a push', () => {
    const { store, sync, service } = setup();
    const result = service.create('  Kaohsiung  ', '  ');
    expect(result).toMatchObject({ ok: true, existed: false });
    expect(store.getCollections()[0]).toMatchObject({ name: 'Kaohsiung', description: null, ownerUsername: 'alice' });
    expect(sync.schedulePush).toHaveBeenCalledTimes(1);
  });

  it('returns the existing owned collection instead of creating a duplicate name', () => {
    const { store, service } = setup();
    service.create('Trips');
    const again = service.create('trips');
    expect(again).toMatchObject({ ok: true, existed: true });
    expect(store.getCollections()).toHaveLength(1);
  });

  it('rejects empty, overlong and signed-out creates', () => {
    const { service } = setup();
    expect(service.create('   ')).toEqual({ ok: false, reason: 'invalid-name' });
    expect(service.create('x'.repeat(61))).toEqual({ ok: false, reason: 'invalid-name' });
    expect(service.create('ok', 'x'.repeat(501))).toEqual({ ok: false, reason: 'invalid-description' });
  });

  it('puts new collections after the existing ones', () => {
    const { store, service } = setup();
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa', sortOrder: 7 })], deletedIds: [], serverTime: 't' });
    service.create('Next');
    expect(store.getCollections().map((c) => c.sortOrder)).toEqual([7, 8]);
  });

  it('lets only editors and owners add posts, and only owners delete', () => {
    const { store, service } = setup();
    store.applyRemoteCollections({
      collections: [dto({ id: 'col-view0001', role: 'viewer' }), dto({ id: 'col-edit0001', role: 'editor' })],
      deletedIds: [],
      serverTime: 't',
    });
    service.applyMembership(['arch-1'], [
      { collectionId: 'col-view0001', include: true },
      { collectionId: 'col-edit0001', include: true },
    ]);
    expect(store.getCollectionIdsForArchive('arch-1')).toEqual(['col-edit0001']);
    expect(service.getWritableCollections().map((c) => c.id)).toEqual(['col-edit0001']);
    expect(service.delete('col-edit0001')).toBe(false);
  });

  it('first share makes a private collection link-only with the current view and notes on', async () => {
    const { store, api, service } = setup();
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't' });
    const result = await service.shareForLink('col-aaaaaaaa', 'mosaic');
    expect(api.updateCollectionShare).toHaveBeenCalledWith('col-aaaaaaaa', { visibility: 'unlisted', displayMode: 'mosaic', includeAnnotations: true });
    expect(result).toMatchObject({ ok: true, value: { visibility: 'unlisted' } });
    expect(store.getCollection('col-aaaaaaaa')).toMatchObject({ visibility: 'unlisted', shareToken: 'TOKEN0123456789A' });
  });

  it('re-sharing a collection shared before keeps its earlier choices', async () => {
    const { store, api, service } = setup({
      getCollectionShareState: vi.fn(async () => shareState({ shareToken: 'OLDTOKEN01234567' })),
    });
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't' });
    await service.shareForLink('col-aaaaaaaa', 'timeline');
    expect(api.updateCollectionShare).toHaveBeenCalledWith('col-aaaaaaaa', { visibility: 'unlisted' });
  });

  it('never changes an already shared collection on one-tap share', async () => {
    const { store, api, service } = setup({
      getCollectionShareState: vi.fn(async () => shareState({ visibility: 'public', shareToken: 'T', shareUrl: 'https://x' })),
    });
    store.applyRemoteCollections({ collections: [dto({ id: 'col-aaaaaaaa' })], deletedIds: [], serverTime: 't' });
    const result = await service.shareForLink('col-aaaaaaaa', 'timeline');
    expect(api.updateCollectionShare).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, value: { visibility: 'public' } });
  });

  it('pushes a collection made on this device before sharing it', async () => {
    const { store, sync, service } = setup();
    sync.pushNow.mockImplementation(async () => {
      store.markCollectionsSynced(store.getDirtyCollections().map(({ collection, revision }) => ({ id: collection.id, revision })));
      return { pushedCollections: 1, pushedItems: 0 };
    });
    const created = service.create('Fresh');
    if (!created.ok) throw new Error('create failed');
    const result = await service.getShareState(created.collection.id);
    expect(sync.pushNow).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('refuses sharing for non-owners', async () => {
    const { store, api, service } = setup();
    store.applyRemoteCollections({ collections: [dto({ id: 'col-edit0001', role: 'editor' })], deletedIds: [], serverTime: 't' });
    expect(await service.getShareState('col-edit0001')).toEqual({ ok: false, reason: 'forbidden' });
    expect(api.getCollectionShareState).not.toHaveBeenCalled();
  });

  it('forgets a shared collection when the server says I lost access', async () => {
    const lost = Object.assign(new Error('not found'), { status: 404, code: 'COLLECTION_NOT_FOUND' });
    const { store, service } = setup({ getCollectionMembers: vi.fn(async () => { throw lost; }) });
    store.applyRemoteCollections({ collections: [dto({ id: 'col-edit0001', role: 'editor' })], deletedIds: [], serverTime: 't' });
    expect(await service.getMembers('col-edit0001')).toEqual({ ok: false, reason: 'lost' });
    expect(store.getCollection('col-edit0001')).toBeUndefined();
  });

  it('leaving removes the collection locally without queueing a server delete', async () => {
    const { store, service } = setup();
    store.applyRemoteCollections({ collections: [dto({ id: 'col-edit0001', role: 'editor' })], deletedIds: [], serverTime: 't' });
    expect(await service.leave('col-edit0001')).toEqual({ ok: true, value: undefined });
    expect(store.getCollection('col-edit0001')).toBeUndefined();
    expect(store.getPendingCollectionDeletes()).toEqual([]);
  });

  it('classifies failures by status', () => {
    expect(classifyFailure(new Error('net'))).toBe('offline');
    expect(classifyFailure(Object.assign(new Error(''), { status: 404 }))).toBe('lost');
    expect(classifyFailure(Object.assign(new Error(''), { status: 403 }))).toBe('forbidden');
    expect(classifyFailure(Object.assign(new Error(''), { status: 409, code: 'COLLECTION_INVITE_LIMIT' }))).toBe('limit');
    expect(classifyFailure(Object.assign(new Error(''), { status: 500 }))).toBe('failed');
  });
});

describe('display mode mapping', () => {
  it('maps the timeline view to the share page view', () => {
    expect(toCollectionDisplayMode('timeline')).toBe('timeline');
    expect(toCollectionDisplayMode('gallery')).toBe('media-only');
    expect(toCollectionDisplayMode('mosaic')).toBe('mosaic');
    expect(toCollectionDisplayMode('mosaic', true)).toBe('reader');
    expect(toPostShareDisplayMode(true)).toBe('reader');
    expect(toPostShareDisplayMode(false)).toBe('card');
  });
});
