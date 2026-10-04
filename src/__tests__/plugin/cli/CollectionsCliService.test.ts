import { describe, expect, it, vi } from 'vitest';

import { CliValidationError } from '@/plugin/cli/CliParams';
import {
  CollectionsCliError,
  CollectionsCliService,
  type CollectionsCliNote,
} from '@/plugin/cli/CollectionsCliService';
import { CollectionStore, type KeyValueStorage } from '@/services/collections/CollectionStore';
import { CollectionService, type CollectionApi } from '@/services/collections/CollectionService';
import type { UserCollectionDTO } from '@/types/collections';

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

const NOTES: Record<string, CollectionsCliNote> = {
  'Social Archives/kaohsiung.md': { path: 'Social Archives/kaohsiung.md', archiveId: 'arch-1', isLocalOnly: false },
  'Social Archives/local.md': { path: 'Social Archives/local.md', isLocalOnly: true },
  'Notes/plain.md': { path: 'Notes/plain.md', isLocalOnly: false },
};

function setup(options: { username?: string | null; remote?: UserCollectionDTO[]; active?: string } = {}) {
  const username = options.username === undefined ? 'alice' : options.username;
  const store = new CollectionStore(new MemoryStorage());
  store.switchUser(username);
  if (options.remote) {
    store.applyRemoteCollections({ collections: options.remote, deletedIds: [], serverTime: 's1' });
  }
  const sync = { schedulePush: vi.fn(), pushNow: vi.fn(async () => ({ pushedCollections: 0, pushedItems: 0 })) };
  let counter = 0;
  const service = new CollectionService({
    store,
    sync,
    api: () => ({}) as CollectionApi,
    isAuthenticated: () => username !== null,
    username: () => username,
    generateId: () => `col-gen${String(++counter).padStart(5, '0')}`,
  });
  const shareForLink = vi.spyOn(service, 'shareForLink').mockResolvedValue({ ok: false, reason: 'offline' });
  const openCollection = vi.fn();
  const cli = new CollectionsCliService({
    username: () => store.getUsername(),
    store,
    service,
    noteFor: (pathOrActive) => {
      const note = NOTES[pathOrActive === 'active' ? options.active ?? '' : pathOrActive];
      if (!note) throw new CliValidationError('path', `Vault path '${pathOrActive}' is not a note.`);
      return note;
    },
    pathForArchive: (archiveId) => (archiveId === 'arch-1' ? 'Social Archives/kaohsiung.md' : null),
    openCollection,
    shareWebUrl: 'https://social-archive.org',
  });
  return { store, sync, service, cli, shareForLink, openCollection };
}

describe('list (default action)', () => {
  it('lists every collection with your post count, role and link', () => {
    const { cli, store } = setup({
      remote: [
        dto({ id: 'col-trip', name: 'Taiwan trip', visibility: 'unlisted', shareToken: 'TOKEN0123' }),
        dto({ id: 'col-team', name: 'Team picks', role: 'editor', ownerUsername: 'bob', collaborative: true, sortOrder: 1 }),
      ],
    });
    store.addItems('col-trip', ['arch-1', 'arch-2']);

    const result = cli.run({}) as { collections: Array<Record<string, unknown>>; total: number };

    expect(result.total).toBe(2);
    expect(result.collections[0]).toEqual({
      collectionId: 'col-trip',
      name: 'Taiwan trip',
      description: null,
      visibility: 'unlisted',
      role: 'owner',
      collaborative: false,
      owner: 'alice',
      myPostCount: 2,
      shareUrl: 'https://social-archive.org/alice/c/TOKEN0123',
      pendingSync: false,
    });
    expect(result.collections[1]).toMatchObject({ role: 'editor', owner: 'bob', collaborative: true, shareUrl: null });
  });

  it('refuses when signed out: collections belong to the account', () => {
    const { cli } = setup({ username: null });

    expect(() => cli.run({})).toThrow(CollectionsCliError);
    expect(() => cli.run({})).toThrow(/Sign in/);
  });
});

describe('collection lookup', () => {
  it('finds a collection by exact name, ignoring ASCII case', () => {
    const { cli } = setup({ remote: [dto({ id: 'col-trip', name: 'Taiwan Trip' })] });

    expect(cli.run({ action: 'link', collection: 'taiwan trip' })).toMatchObject({ collectionId: 'col-trip' });
  });

  it('prefers your own collection when a shared one has the same name', () => {
    const { cli } = setup({
      remote: [
        dto({ id: 'col-mine', name: 'Picks' }),
        dto({ id: 'col-bobs', name: 'Picks', role: 'viewer', ownerUsername: 'bob' }),
      ],
    });

    expect(cli.run({ action: 'link', collection: 'Picks' })).toMatchObject({ collectionId: 'col-mine' });
  });

  it('asks for an id when two shared collections share a name', () => {
    const { cli } = setup({
      remote: [
        dto({ id: 'col-bobs', name: 'Picks', role: 'viewer', ownerUsername: 'bob' }),
        dto({ id: 'col-carols', name: 'Picks', role: 'editor', ownerUsername: 'carol' }),
      ],
    });

    expect(() => cli.run({ action: 'link', collection: 'Picks' })).toThrow(/col-bobs, col-carols/);
  });

  it('rejects a missing or unknown collection before doing anything', () => {
    const { cli, sync } = setup();

    expect(() => cli.run({ action: 'add', path: 'Social Archives/kaohsiung.md' })).toThrow(/requires 'collection'/);
    expect(() => cli.run({ action: 'add', collection: 'Nope', path: 'Social Archives/kaohsiung.md' })).toThrow(/No collection/);
    expect(sync.schedulePush).not.toHaveBeenCalled();
  });
});

describe('create', () => {
  it('creates a private collection locally and reports it as not yet synced', () => {
    const { cli, sync } = setup();

    const result = cli.run({ action: 'create', name: '  Taiwan trip ', description: 'Night markets' });

    expect(result).toMatchObject({
      collectionId: 'col-gen00001',
      name: 'Taiwan trip',
      description: 'Night markets',
      visibility: 'private',
      created: true,
      pendingSync: true,
    });
    expect(sync.schedulePush).toHaveBeenCalled();
  });

  it('returns your existing collection with that name instead of a duplicate', () => {
    const { cli } = setup({ remote: [dto({ id: 'col-trip', name: 'Taiwan trip' })] });

    expect(cli.run({ action: 'create', name: 'TAIWAN TRIP' })).toMatchObject({ collectionId: 'col-trip', created: false });
  });

  it('rejects a name over 60 characters', () => {
    const { cli } = setup();

    expect(() => cli.run({ action: 'create', name: 'x'.repeat(61) })).toThrow(/60 characters/);
  });
});

describe('add and remove', () => {
  it('adds a note by path, and counts a second add (of the active note) as already in', () => {
    const { cli, store, sync } = setup({
      remote: [dto({ id: 'col-trip', name: 'Taiwan trip' })],
      active: 'Social Archives/kaohsiung.md',
    });

    expect(cli.run({ action: 'add', collection: 'col-trip', path: 'Social Archives/kaohsiung.md' })).toEqual({
      collectionId: 'col-trip',
      name: 'Taiwan trip',
      archiveIds: ['arch-1'],
      added: 1,
      alreadyIn: 0,
      notInVault: [],
      syncScheduled: true,
    });
    expect(store.getArchiveIds('col-trip')).toEqual(['arch-1']);
    expect(sync.schedulePush).toHaveBeenCalledTimes(1);

    expect(cli.run({ action: 'add', collection: 'col-trip', active: 'true' })).toMatchObject({ added: 0, alreadyIn: 1, syncScheduled: false });
  });

  it('adds archive ids in bulk and flags the ones with no note in this vault', () => {
    const { cli } = setup({ remote: [dto({ id: 'col-trip', name: 'Taiwan trip' })] });

    expect(cli.run({ action: 'add', collection: 'Taiwan trip', archive: 'arch-1,arch-typo,arch-1' })).toMatchObject({
      archiveIds: ['arch-1', 'arch-typo'],
      added: 2,
      notInVault: ['arch-typo'],
    });
  });

  it('removes a note, and counts one that was never in it as not in', () => {
    const { cli, store } = setup({ remote: [dto({ id: 'col-trip', name: 'Taiwan trip' })] });
    store.addItems('col-trip', ['arch-1']);

    expect(cli.run({ action: 'remove', collection: 'col-trip', archive: 'arch-1,arch-2' })).toMatchObject({ removed: 1, notIn: 1 });
    expect(store.getArchiveIds('col-trip')).toEqual([]);
  });

  it('explains why a note without an archive id cannot join', () => {
    const { cli } = setup({ remote: [dto({ id: 'col-trip' })] });

    expect(() => cli.run({ action: 'add', collection: 'col-trip', path: 'Social Archives/local.md' })).toThrow(/Upload it to your account/);
    expect(() => cli.run({ action: 'add', collection: 'col-trip', path: 'Notes/plain.md' })).toThrow(/isn't an archived post/);
  });

  it('needs exactly one of path, active or archive', () => {
    const { cli } = setup({ remote: [dto({ id: 'col-trip' })] });

    expect(() => cli.run({ action: 'add', collection: 'col-trip' })).toThrow(/exactly one/);
    expect(() => cli.run({ action: 'add', collection: 'col-trip', path: 'Notes/plain.md', archive: 'arch-1' })).toThrow(/exactly one/);
  });

  it('refuses a viewer without touching the store', () => {
    const { cli, store } = setup({ remote: [dto({ id: 'col-bobs', role: 'viewer', ownerUsername: 'bob' })] });

    expect(() => cli.run({ action: 'add', collection: 'col-bobs', archive: 'arch-1' })).toThrow(/viewer/);
    expect(store.getArchiveIds('col-bobs')).toEqual([]);
  });
});

describe('show', () => {
  it('lists your posts newest first with their vault paths, up to limit', () => {
    const { cli, store } = setup({ remote: [dto({ id: 'col-trip', name: 'Taiwan trip' })] });
    store.addItems('col-trip', ['arch-1']);
    store.addItems('col-trip', ['arch-2']);

    const result = cli.run({ action: 'show', collection: 'col-trip', limit: '1' }) as Record<string, unknown>;

    expect(result).toMatchObject({ myPostCount: 2, notInVault: 1 });
    expect((result.posts as unknown[]).length).toBe(1);
    expect(result).not.toHaveProperty('hint');
  });

  it("says other members' posts are not listed in a collaborative collection", () => {
    const { cli } = setup({ remote: [dto({ id: 'col-team', role: 'editor', ownerUsername: 'bob', collaborative: true })] });

    expect(cli.run({ action: 'show', collection: 'col-team' })).toMatchObject({ hint: expect.stringMatching(/other members/) });
  });
});

describe('link and share', () => {
  it('prints the link of a shared collection without any network call', () => {
    const { cli, shareForLink } = setup({ remote: [dto({ id: 'col-trip', visibility: 'public', shareToken: 'TOKEN0123' })] });

    expect(cli.run({ action: 'link', collection: 'col-trip' })).toMatchObject({
      shareUrl: 'https://social-archive.org/alice/c/TOKEN0123',
    });
    expect(shareForLink).not.toHaveBeenCalled();
  });

  it('keeps a private collection private on link, and points at share', () => {
    const { cli, shareForLink } = setup({ remote: [dto({ id: 'col-trip', shareToken: 'OLDTOKEN' })] });

    expect(cli.run({ action: 'link', collection: 'col-trip' })).toMatchObject({
      visibility: 'private',
      shareUrl: null,
      hint: expect.stringMatching(/action=share confirm=true/),
    });
    expect(shareForLink).not.toHaveBeenCalled();
  });

  it('requires confirm=true before sharing, then schedules it link-only', () => {
    const { cli, shareForLink } = setup({ remote: [dto({ id: 'col-trip' })] });

    expect(() => cli.run({ action: 'share', collection: 'col-trip' })).toThrow(/confirm=true/);
    expect(shareForLink).not.toHaveBeenCalled();

    expect(cli.run({ action: 'share', collection: 'col-trip', confirm: 'true' })).toMatchObject({
      visibility: 'unlisted',
      shareUrl: null,
      scheduled: true,
    });
    expect(shareForLink).toHaveBeenCalledWith('col-trip', 'timeline');
  });

  it('lets only the owner share, and tells a member to ask the owner for the link', () => {
    const { cli } = setup({ remote: [dto({ id: 'col-bobs', role: 'editor', ownerUsername: 'bob', visibility: 'unlisted' })] });

    expect(() => cli.run({ action: 'share', collection: 'col-bobs', confirm: 'true' })).toThrow(/Only the owner/);
    expect(cli.run({ action: 'link', collection: 'col-bobs' })).toMatchObject({ shareUrl: null, hint: expect.stringMatching(/owner/) });
  });
});

describe('open', () => {
  it('hands the collection to the timeline and returns at once', () => {
    const { cli, openCollection } = setup({ remote: [dto({ id: 'col-trip', name: 'Taiwan trip' })] });

    expect(cli.run({ action: 'open', collection: 'Taiwan trip' })).toEqual({
      collectionId: 'col-trip',
      name: 'Taiwan trip',
      scheduled: true,
    });
    expect(openCollection).toHaveBeenCalledWith('col-trip');
  });
});
