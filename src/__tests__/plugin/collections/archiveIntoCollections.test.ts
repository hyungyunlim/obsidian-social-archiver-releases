/**
 * Archive into collections on the plugin side (prd-archive-into-collections):
 * the picker helpers, server ids before sending, the job and request payload,
 * and the Obsidian CLI's `archive collection=`.
 */
import { __setRequestUrlHandler } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CliRegistry } from '@/plugin/cli/CliRegistry';
import { COMMANDS } from '@/plugin/cli/CliFlags';
import { ArchiveCliService, type ArchiveCliOptions } from '@/plugin/cli/ArchiveCliService';
import { applySelectionChanges, orderForArchivePicker } from '@/plugin/collections/archiveCollectionSelection';
import { isArchivedLocally } from '@/plugin/jobs/localArchiveRoutes';
import { CollectionStore, type KeyValueStorage } from '@/services/collections/CollectionStore';
import { CollectionService, type CollectionApi } from '@/services/collections/CollectionService';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { UserCollectionDTO } from '@/types/collections';
import type { CliData, CliHandler } from '@/types/obsidian-cli';

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
    updatedAt: '2026-10-01T00:00:00.000Z',
    role: 'owner',
    ...overrides,
  };
}

function collections(remote: UserCollectionDTO[], username: string | null = 'alice') {
  const store = new CollectionStore(new MemoryStorage());
  store.switchUser(username);
  if (remote.length > 0) store.applyRemoteCollections({ collections: remote, deletedIds: [], serverTime: 's1' });
  const pushNow = vi.fn(async () => ({ pushedCollections: 0, pushedItems: 0 }));
  const service = new CollectionService({
    store,
    sync: { schedulePush: vi.fn(), pushNow },
    api: () => ({}) as CollectionApi,
    isAuthenticated: () => username !== null,
    username: () => username,
    generateId: () => 'col-local',
  });
  return { store, service, pushNow };
}

afterEach(() => __setRequestUrlHandler(null));

describe('archive-time picker helpers', () => {
  it('lists the most recently used collections first', () => {
    const ordered = orderForArchivePicker([
      { name: 'Old', updatedAt: '2026-09-01T00:00:00.000Z' },
      { name: 'New', updatedAt: '2026-10-04T00:00:00.000Z' },
    ]);
    expect(ordered.map((collection) => collection.name)).toEqual(['New', 'Old']);
  });

  it('folds picker changes into the selection', () => {
    expect(applySelectionChanges(['a', 'b'], [
      { collectionId: 'b', include: false },
      { collectionId: 'c', include: true },
    ])).toEqual(['a', 'c']);
  });
});

describe('isArchivedLocally', () => {
  it('matches the platforms the orchestrator fetches on this device', () => {
    expect(isArchivedLocally('https://blog.naver.com/someone/223456789012', undefined)).toBe(true);
    expect(isArchivedLocally('https://brunch.co.kr/@writer/12', undefined)).toBe(true);
    expect(isArchivedLocally('https://x.com/alice/status/1', undefined)).toBe(false);
  });

  it('treats a Naver cafe link as local only when a Naver cookie is set', () => {
    const cafe = 'https://cafe.naver.com/somecafe/12345';
    expect(isArchivedLocally(cafe, undefined)).toBe(false);
    expect(isArchivedLocally(cafe, 'NID_AUT=1')).toBe(true);
  });
});

describe('CollectionService.serverIdsFor', () => {
  it('returns synced ids without pushing', async () => {
    const { service, pushNow } = collections([dto({ id: 'col-a' })]);

    expect(await service.serverIdsFor(['col-a', 'col-a'])).toEqual(['col-a']);
    expect(pushNow).not.toHaveBeenCalled();
  });

  it('pushes a collection created on this device and leaves it out if it still has not synced', async () => {
    const { service, pushNow } = collections([]);
    const created = service.create('Taiwan trip');
    if (!created.ok) throw new Error('create failed');

    expect(await service.serverIdsFor([created.collection.id])).toEqual([]);
    expect(pushNow).toHaveBeenCalledTimes(1);
  });

  it('leaves out collections the user can only view', async () => {
    const { service } = collections([dto({ id: 'col-bobs', role: 'viewer', ownerUsername: 'bob' })]);

    expect(await service.serverIdsFor(['col-bobs'])).toEqual([]);
  });
});

describe('payload', () => {
  it('stores the ids on the pending job, without duplicates', () => {
    const svc = new ArchiveCliService({} as never);
    const job = svc.buildPendingJob('https://x.com/a/status/1', 'x', 'https://x.com/a/status/1', {
      collectionIds: ['col-a', 'col-a', 'col-b'],
    });
    expect(job.metadata?.collectionIds).toEqual(['col-a', 'col-b']);
    expect(svc.buildPendingJob('https://x.com/a/status/2', 'x', 'https://x.com/a/status/2', {}).metadata?.collectionIds)
      .toBeUndefined();
  });

  it('sends collectionIds in the archive request body only when there are some', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    __setRequestUrlHandler(async (params: { body?: string }) => {
      bodies.push(JSON.parse(params.body ?? '{}') as Record<string, unknown>);
      return { status: 200, headers: {}, text: '', json: { success: true, data: { jobId: 'j1', status: 'pending' } }, arrayBuffer: new ArrayBuffer(0) };
    });
    const client = new WorkersAPIClient({ endpoint: 'https://worker.example', authToken: 'tok' });
    client.initialize();

    await client.submitArchive({ url: 'https://x.com/a/status/1', options: {}, collectionIds: ['col-a'] });
    await client.submitArchive({ url: 'https://x.com/a/status/2', options: {} });

    expect(bodies[0]?.collectionIds).toEqual(['col-a']);
    expect(bodies[1]).not.toHaveProperty('collectionIds');
  });
});

describe('Obsidian CLI archive collection=', () => {
  function boot(remote: UserCollectionDTO[], username: string | null = 'alice') {
    const calls: Array<{ command: string; handler: CliHandler }> = [];
    const enqueueArchive = vi.fn(async (url: string, _options: ArchiveCliOptions) => ({ jobId: 'job-1', status: 'pending' as const, platform: 'x', url }));
    const { store, service } = collections(remote, username);
    const plugin = {
      manifest: { id: 'social-archiver', version: '4.8.1' },
      settings: { authToken: 'tok', username: 'alice', naverCookie: '' },
      app: { vault: { getName: () => 'V' } },
      collectionStore: store,
      collectionService: service,
      archiveCliService: { enqueueArchive },
      registerCliHandler: (command: string, _description: string, _flags: unknown, handler: CliHandler) => {
        calls.push({ command, handler });
      },
    };
    new CliRegistry(plugin as never).boot();
    const handler = calls.find((call) => call.command === COMMANDS.ARCHIVE)?.handler;
    if (!handler) throw new Error('archive handler not registered');
    return { run: async (data: Record<string, string>) => JSON.parse(await handler(data as CliData)) as { ok: boolean; error?: { code: string; message: string; details?: { field?: string } } }, enqueueArchive, store };
  }

  it('resolves names to server ids and queues them with the archive', async () => {
    const { run, enqueueArchive } = boot([dto({ id: 'col-trip', name: 'Taiwan Trip' }), dto({ id: 'col-food', name: 'Food' })]);

    const out = await run({ url: 'https://x.com/alice/status/1', collection: 'taiwan trip,col-food' });

    expect(out.ok).toBe(true);
    expect(enqueueArchive.mock.calls[0]?.[1].collectionIds).toEqual(['col-trip', 'col-food']);
  });

  it('refuses collections that have not reached the server, or that the user can only view', async () => {
    const { run, store } = boot([dto({ id: 'col-bobs', name: 'Bob picks', role: 'viewer', ownerUsername: 'bob' })]);
    store.createCollection({ id: 'col-new', name: 'Fresh', description: null, sortOrder: 1 });

    expect((await run({ url: 'https://x.com/a/status/1', collection: 'Fresh' })).error?.message).toMatch(/hasn't reached the server/);
    expect((await run({ url: 'https://x.com/a/status/1', collection: 'Bob picks' })).error?.message).toMatch(/viewer/);
  });

  it('rejects collection= outside queue mode and for links archived on this device', async () => {
    const { run, enqueueArchive } = boot([dto({ id: 'col-trip', name: 'Trip' })]);

    expect((await run({ url: 'https://x.com/a/status/1', collection: 'Trip', mode: 'sync' })).error?.details?.field).toBe('collection');
    expect((await run({ url: 'https://blog.naver.com/someone/223456789012', collection: 'Trip' })).error?.details?.field).toBe('collection');
    const tooMany = Array.from({ length: 51 }, (_, i) => `c${i}`).join(',');
    expect((await run({ url: 'https://x.com/a/status/1', collection: tooMany })).error?.message).toMatch(/up to 50/);
    expect(enqueueArchive).not.toHaveBeenCalled();
  });

  it('asks the user to sign in when there is no account', async () => {
    const { run } = boot([], null);

    expect((await run({ url: 'https://x.com/a/status/1', collection: 'Trip' })).error?.code).toBe('AUTH_REQUIRED');
  });
});
