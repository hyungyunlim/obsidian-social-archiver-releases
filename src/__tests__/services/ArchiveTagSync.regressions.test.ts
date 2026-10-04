/**
 * Archive-tag sync — cross-service regression tests
 *
 * Wires the real TagStore, ArchiveTagOutboundService and
 * ArchiveTagBackfillService to one fake vault and a fake Workers tag API that
 * keeps mapping state the way D1 does: a delete leaves a tombstone, an upsert
 * revives it, and `POST /tags` re-broadcasts `archive_tags_updated` to every
 * archive carrying an upserted tag.
 *
 * Covers:
 * - a local rename must keep every archive→tag mapping on the server
 * - an edit whose push failed (offline) must survive a restart instead of
 *   being undone by the next startup backfill
 * - a server tag whose name contains a space can be toggled on from the plugin
 * - notes that already existed when the session started are not re-pushed
 *   (startup re-index / plugin writers), while a note written this session is
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { TagStore } from '../../services/TagStore';
import { ArchiveTagOutboundService } from '../../plugin/sync/ArchiveTagOutboundService';
import { ArchiveTagBackfillService } from '../../plugin/sync/ArchiveTagBackfillService';
import type { TagDefinition } from '../../types/tag';

// vitest aliases `obsidian` to test/mocks/obsidian, whose classes take constructor args.
const MockTFile = TFile as unknown as new (path: string) => TFile;
const MockTFolder = TFolder as unknown as new (path: string, children: TFile[]) => TFolder;

const ROOT = 'Social Archives';
const SERVER_TIME = '2026-10-04T00:00:00.000Z';

type Frontmatter = Record<string, unknown>;
type Pair = { archiveId: string; tagId: string };

function makeDef(id: string, name: string): TagDefinition {
  return { id, name, color: '#3b82f6', sortOrder: 0, createdAt: SERVER_TIME, updatedAt: SERVER_TIME };
}

const key = (pair: Pair): string => `${pair.archiveId}|${pair.tagId}`;
const unkey = (k: string): Pair => {
  const [archiveId = '', tagId = ''] = k.split('|');
  return { archiveId, tagId };
};

/** Fake Workers tag API with D1 semantics (soft-delete tombstones, upserts revive). */
function makeServer(tags: Array<[id: string, name: string]>, mappings: Array<[archiveId: string, tagId: string]>) {
  const names = new Map(tags);
  const active = new Set(mappings.map(([archiveId, tagId]) => key({ archiveId, tagId })));
  const tombstoned = new Set<string>();
  const stats = { broadcasts: 0 };

  return {
    names,
    active,
    tombstoned,
    stats,
    upsertTags: vi.fn(async (input: Array<{ id: string; name: string }>) => {
      const resolvedTags: Array<{ requestedId: string; canonicalTag: { id: string; name: string } }> = [];
      const canonicalIds = new Set<string>();
      for (const tag of input) {
        // Same-name tag under another id → update the canonical row (user-tags-db upsertTags).
        const sameName = [...names].find(([id, name]) => id !== tag.id && name.toLowerCase() === tag.name.toLowerCase());
        const id = sameName ? sameName[0] : tag.id;
        names.set(id, tag.name);
        canonicalIds.add(id);
        if (sameName) resolvedTags.push({ requestedId: tag.id, canonicalTag: { id, name: tag.name } });
      }
      // user-tags.ts POST /tags: one archive_tags_updated per archive carrying an upserted tag.
      const archives = new Set([...active].map(unkey).filter(p => canonicalIds.has(p.tagId)).map(p => p.archiveId));
      stats.broadcasts += archives.size;
      return { upserted: input.length, serverTime: SERVER_TIME, resolvedTags };
    }),
    upsertArchiveTags: vi.fn(async (pairs: Pair[]) => {
      for (const pair of pairs) {
        active.add(key(pair));
        tombstoned.delete(key(pair));
      }
      return { upserted: pairs.length, serverTime: SERVER_TIME };
    }),
    deleteArchiveTags: vi.fn(async (pairs: Pair[]) => {
      for (const pair of pairs) {
        if (active.delete(key(pair))) tombstoned.add(key(pair));
      }
      return { deleted: pairs.length };
    }),
    getArchiveTags: vi.fn(async () => ({
      archiveTags: [...active].map(k => ({ ...unkey(k), createdAt: SERVER_TIME })),
      deletedPairs: [...tombstoned].map(unkey),
      serverTime: SERVER_TIME,
    })),
  };
}

type Server = ReturnType<typeof makeServer>;

/**
 * Fake vault. `processFrontMatter` writes, bumps mtime and fires
 * `metadataCache.changed` like Obsidian's re-index of the written file.
 */
function makeVault(notes: Record<string, Frontmatter>, options: { writeDelayMs?: number } = {}) {
  const fmByPath = new Map<string, Frontmatter>();
  const files = new Map<string, TFile>();
  const listeners = new Map<string, Set<(file?: TFile) => void>>();

  const metadataCache = {
    resolved: true,
    on: vi.fn((name: string, cb: (file?: TFile) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(cb);
      listeners.set(name, set);
      return { name, cb };
    }),
    offref: vi.fn((ref: { name: string; cb: (file?: TFile) => void }) => {
      listeners.get(ref.name)?.delete(ref.cb);
    }),
    getFileCache: vi.fn((file: TFile) => {
      const fm = fmByPath.get(file.path);
      return fm ? { frontmatter: fm } : null;
    }),
    trigger(name: string, file?: TFile) {
      for (const cb of [...(listeners.get(name) ?? [])]) cb(file);
    },
  };

  const app = {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) =>
        path === ROOT ? new MockTFolder(ROOT, [...files.values()]) : files.get(path) ?? null
      ),
      getMarkdownFiles: vi.fn(() => [...files.values()]),
    },
    metadataCache,
    fileManager: {
      processFrontMatter: vi.fn(async (file: TFile, fn: (fm: Frontmatter) => void) => {
        const fm = fmByPath.get(file.path) ?? {};
        fn(fm);
        fmByPath.set(file.path, fm);
        file.stat.mtime = Date.now();
        metadataCache.trigger('changed', file);
        if (options.writeDelayMs) {
          await new Promise(resolve => setTimeout(resolve, options.writeDelayMs));
        }
      }),
    },
  };

  /** A note already on disk (mtime = now). */
  const addNote = (path: string, fm: Frontmatter): TFile => {
    const file = new MockTFile(path);
    files.set(path, file);
    fmByPath.set(path, fm);
    return file;
  };
  for (const [path, fm] of Object.entries(notes)) addNote(path, fm);

  return {
    app,
    fmByPath,
    files,
    metadataCache,
    addNote,
    archiveLookup: {
      findBySourceArchiveId: (id: string) =>
        [...files.values()].find(f => fmByPath.get(f.path)?.sourceArchiveId === id) ?? null,
    },
    /** Obsidian (re-)indexing a note it already had on disk — `changed` without a write. */
    reindex: (path: string) => metadataCache.trigger('changed', files.get(path)),
  };
}

type Vault = ReturnType<typeof makeVault>;

/** Plugin settings + TagStore, shared across sessions the way data.json is. */
function makeClient(vault: Vault, server: Server, definitions: TagDefinition[], overrides: Frontmatter = {}) {
  const settings: Record<string, unknown> = {
    archivePath: ROOT,
    authToken: 'token',
    syncClientId: 'plugin-client',
    enableMobileAnnotationSync: true,
    mirrorArchiveTagsToObsidianTags: false,
    tagDefinitions: definitions,
    pendingTagDeleteIds: [],
    ...overrides,
  };
  const plugin = {
    settings,
    saveSettingsPartial: vi.fn(async (partial: Record<string, unknown>) => {
      Object.assign(settings, partial);
    }),
    getApiClient: () => server,
  };
  const tagStore = new TagStore(vault.app as never, plugin as never);
  return { settings, plugin, tagStore };
}

type Client = ReturnType<typeof makeClient>;

/** One plugin session, wired the way main.ts initializeServices does it. */
function startSession(vault: Vault, server: Server, client: Client) {
  const outbound = new ArchiveTagOutboundService(
    vault.app as never,
    server as never,
    vault.archiveLookup as never,
    () => client.settings as never,
    client.tagStore,
    partial => client.plugin.saveSettingsPartial(partial as Record<string, unknown>),
  );
  outbound.start();
  outbound.rebuildTagCache(client.tagStore.getTagDefinitions().map(d => ({ id: d.id, name: d.name })));

  const backfill = new ArchiveTagBackfillService({
    app: vault.app as never,
    apiClient: () => server as never,
    archiveLookup: vault.archiveLookup as never,
    tagStore: client.tagStore,
    getSettings: () => client.settings as never,
    archiveTagOutbound: () => outbound,
  });

  return { outbound, backfill };
}

// ─── Tests ───────────────────────────────────────────────

describe('archive-tag sync regressions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('local tag rename', () => {
    it('keeps the archive mapping on the server', async () => {
      const path = `${ROOT}/post.md`;
      const vault = makeVault({ [path]: { sourceArchiveId: 'archive-1', archiveTags: ['old'] } });
      const server = makeServer([['tag-1', 'old']], [['archive-1', 'tag-1']]);
      const client = makeClient(vault, server, [makeDef('tag-1', 'old')]);
      const { outbound } = startSession(vault, server, client);
      // In sync with the server (as the startup backfill leaves a note it reconciled).
      outbound.primeSnapshot(path, ['old']);

      await client.tagStore.updateTag('tag-1', { name: 'new' });
      await vi.runAllTimersAsync();

      expect(vault.fmByPath.get(path)?.archiveTags).toEqual(['new']);
      expect(server.names.get('tag-1')).toBe('new');
      expect(server.active.has('archive-1|tag-1')).toBe(true);
      expect(server.tombstoned.has('archive-1|tag-1')).toBe(false);
    });

    it('keeps the mapping when a note push fires before the renamed definition is saved', async () => {
      // 2.5 s per note write: the first note's 2 s debounce fires mid-rename.
      const vault = makeVault(
        {
          [`${ROOT}/a.md`]: { sourceArchiveId: 'archive-1', archiveTags: ['old'] },
          [`${ROOT}/b.md`]: { sourceArchiveId: 'archive-2', archiveTags: ['old'] },
        },
        { writeDelayMs: 2500 },
      );
      const server = makeServer([['tag-1', 'old']], [['archive-1', 'tag-1'], ['archive-2', 'tag-1']]);
      const client = makeClient(vault, server, [makeDef('tag-1', 'old')]);
      const { outbound } = startSession(vault, server, client);
      outbound.primeSnapshot(`${ROOT}/a.md`, ['old']);
      outbound.primeSnapshot(`${ROOT}/b.md`, ['old']);

      const renaming = client.tagStore.updateTag('tag-1', { name: 'new' });
      await vi.advanceTimersByTimeAsync(20_000);
      await renaming;
      await vi.runAllTimersAsync();

      // Renamed in place — no second tag minted under a fresh id.
      expect([...server.names]).toEqual([['tag-1', 'new']]);
      expect(server.active).toEqual(new Set(['archive-1|tag-1', 'archive-2|tag-1']));
    });
  });

  describe('edits whose push failed (offline)', () => {
    it('does not resurrect a tag removed while offline at the next startup', async () => {
      const path = `${ROOT}/post.md`;
      const vault = makeVault({ [path]: { sourceArchiveId: 'archive-1', archiveTags: ['travel'] } });
      const server = makeServer([['tag-1', 'travel']], [['archive-1', 'tag-1']]);
      const client = makeClient(vault, server, [makeDef('tag-1', 'travel')]);

      // Session 1: removal while offline.
      const first = startSession(vault, server, client);
      first.outbound.primeSnapshot(path, ['travel']);
      server.deleteArchiveTags.mockRejectedValueOnce(new Error('Network request failed'));
      await client.tagStore.removeArchiveTagFromPost(path, 'travel');
      await vi.runAllTimersAsync();
      expect(server.active.has('archive-1|tag-1')).toBe(true); // push failed
      first.outbound.stop();

      // Session 2: restart, online again — the startup backfill runs.
      const second = startSession(vault, server, client);
      await second.backfill.reconcileFromServer();
      await vi.runAllTimersAsync();

      expect(vault.fmByPath.get(path)?.archiveTags).toEqual([]);
      expect(server.active.has('archive-1|tag-1')).toBe(false);
    });

    it('keeps the removal while the server still rejects the push', async () => {
      const path = `${ROOT}/post.md`;
      const vault = makeVault({ [path]: { sourceArchiveId: 'archive-1', archiveTags: ['travel'] } });
      const server = makeServer([['tag-1', 'travel']], [['archive-1', 'tag-1']]);
      const client = makeClient(vault, server, [makeDef('tag-1', 'travel')]);

      const first = startSession(vault, server, client);
      first.outbound.primeSnapshot(path, ['travel']);
      server.deleteArchiveTags.mockRejectedValue(new Error('Server error 503'));
      await client.tagStore.removeArchiveTagFromPost(path, 'travel');
      await vi.runAllTimersAsync();
      first.outbound.stop();

      // Reads work, deletes still fail.
      const second = startSession(vault, server, client);
      await second.backfill.reconcileFromServer();
      await vi.runAllTimersAsync();

      expect(vault.fmByPath.get(path)?.archiveTags).toEqual([]);
      expect(server.active.has('archive-1|tag-1')).toBe(true);
    });

    it('replays an edit still waiting out the debounce when the plugin reloads', async () => {
      const path = `${ROOT}/post.md`;
      const vault = makeVault({ [path]: { sourceArchiveId: 'archive-1', archiveTags: ['travel'] } });
      const server = makeServer([['tag-1', 'travel']], [['archive-1', 'tag-1']]);
      const client = makeClient(vault, server, [makeDef('tag-1', 'travel')]);

      const first = startSession(vault, server, client);
      await client.tagStore.removeArchiveTagFromPost(path, 'travel');
      first.outbound.stop(); // settings reload / quit inside the 2 s debounce

      const second = startSession(vault, server, client);
      await second.backfill.reconcileFromServer();
      await vi.runAllTimersAsync();

      expect(vault.fmByPath.get(path)?.archiveTags).toEqual([]);
      expect(server.active.has('archive-1|tag-1')).toBe(false);
    });

    it('pushes a tag added while offline at the next startup', async () => {
      const path = `${ROOT}/post.md`;
      const vault = makeVault({ [path]: { sourceArchiveId: 'archive-1', archiveTags: [] } });
      const server = makeServer([['tag-1', 'travel']], []);
      const client = makeClient(vault, server, [makeDef('tag-1', 'travel')]);

      const first = startSession(vault, server, client);
      server.upsertTags.mockRejectedValueOnce(new Error('Network request failed'));
      await client.tagStore.addArchiveTagToPost(path, 'travel');
      await vi.runAllTimersAsync();
      expect(server.active.has('archive-1|tag-1')).toBe(false); // push failed
      first.outbound.stop();

      const second = startSession(vault, server, client);
      await second.backfill.reconcileFromServer();
      await vi.runAllTimersAsync();

      expect(server.active.has('archive-1|tag-1')).toBe(true);
      expect(vault.fmByPath.get(path)?.archiveTags).toEqual(['travel']);
    });
  });

  describe('tag names with spaces', () => {
    it('toggles a server tag whose name contains a space onto a note', async () => {
      const path = `${ROOT}/post.md`;
      const vault = makeVault({ [path]: { sourceArchiveId: 'archive-1', tags: ['note'] } });
      const server = makeServer([['tag-2', 'road trip']], []);
      const client = makeClient(vault, server, [makeDef('tag-2', 'road trip')], {
        mirrorArchiveTagsToObsidianTags: true,
      });
      startSession(vault, server, client);

      await expect(client.tagStore.toggleDisplayTagOnPost(path, 'road trip')).resolves.toBe(true);
      await vi.runAllTimersAsync();

      expect(vault.fmByPath.get(path)?.archiveTags).toEqual(['road trip']);
      // Obsidian rejects a tag with a space, so the native mirror skips it.
      expect(vault.fmByPath.get(path)?.tags).toEqual(['note']);
      expect(server.active.has('archive-1|tag-2')).toBe(true);
    });
  });

  describe('first observation of a note in a session', () => {
    // Measured before the fix, for these 50 notes with no tag change: 50 POST
    // /tags + 50 POST /archive-tags fired in one tick, and 2,500 server
    // archive_tags_updated broadcasts (each POST /tags fans out to every
    // archive carrying the tag — N²).
    const N = 50;

    /** N archive notes tagged travel + food, every mapping already on the server. */
    function taggedLibrary() {
      const notes: Record<string, Frontmatter> = {};
      const mappings: Array<[string, string]> = [];
      for (let i = 0; i < N; i++) {
        notes[`${ROOT}/post-${i}.md`] = { sourceArchiveId: `archive-${i}`, archiveTags: ['travel', 'food'] };
        mappings.push([`archive-${i}`, 'tag-travel'], [`archive-${i}`, 'tag-food']);
      }
      const vault = makeVault(notes);
      const server = makeServer([['tag-travel', 'travel'], ['tag-food', 'food']], mappings);
      const client = makeClient(vault, server, [makeDef('tag-travel', 'travel'), makeDef('tag-food', 'food')]);
      return { vault, server, client };
    }

    function requestCounts(server: Server) {
      return {
        upsertTags: server.upsertTags.mock.calls.length,
        upsertArchiveTags: server.upsertArchiveTags.mock.calls.length,
        deleteArchiveTags: server.deleteArchiveTags.mock.calls.length,
        broadcasts: server.stats.broadcasts,
      };
    }

    const NONE = { upsertTags: 0, upsertArchiveTags: 0, deleteArchiveTags: 0, broadcasts: 0 };

    it('sends nothing when Obsidian re-indexes pre-existing notes during startup', async () => {
      const { vault, server, client } = taggedLibrary();
      vi.advanceTimersByTime(60_000); // notes predate the session
      vault.metadataCache.resolved = false; // plugin loads before the cache is ready
      startSession(vault, server, client);

      for (const path of vault.files.keys()) vault.reindex(path);
      vault.metadataCache.resolved = true;
      vault.metadataCache.trigger('resolved');
      await vi.runAllTimersAsync();

      expect(requestCounts(server)).toEqual(NONE);
    });

    it('sends nothing when plugin writers touch pre-existing tagged notes', async () => {
      const { vault, server, client } = taggedLibrary();
      vi.advanceTimersByTime(60_000);
      startSession(vault, server, client);

      // e.g. library delta sync / state backfill rewriting unrelated fields
      for (const file of vault.files.values()) {
        await vault.app.fileManager.processFrontMatter(file, fm => {
          fm.likes = 1;
        });
      }
      await vi.runAllTimersAsync();

      expect(requestCounts(server)).toEqual(NONE);
    });

    it('does not revive a tag another device removed while Obsidian was closed', async () => {
      const path = `${ROOT}/post.md`;
      const vault = makeVault({ [path]: { sourceArchiveId: 'archive-1', archiveTags: ['travel'] } });
      const server = makeServer([['tag-travel', 'travel']], [['archive-1', 'tag-travel']]);
      await server.deleteArchiveTags([{ archiveId: 'archive-1', tagId: 'tag-travel' }]); // removed on mobile
      server.deleteArchiveTags.mockClear();
      const client = makeClient(vault, server, [makeDef('tag-travel', 'travel')]);
      vi.advanceTimersByTime(60_000);
      vault.metadataCache.resolved = false;
      const { backfill } = startSession(vault, server, client);

      // Startup index sees the stale local copy before the backfill runs.
      vault.reindex(path);
      await vi.runAllTimersAsync();
      vault.metadataCache.resolved = true;
      vault.metadataCache.trigger('resolved');
      await backfill.reconcileFromServer();
      await vi.runAllTimersAsync();

      expect(server.tombstoned.has('archive-1|tag-travel')).toBe(true);
      expect(vault.fmByPath.get(path)?.archiveTags).toEqual([]);
    });

    it('still pushes every tag of a note created during the session', async () => {
      const { vault, server, client } = taggedLibrary();
      startSession(vault, server, client);

      // A new archive written after load (e.g. a pending job completing).
      vi.advanceTimersByTime(1_000);
      const file = vault.addNote(`${ROOT}/new.md`, {});
      await vault.app.fileManager.processFrontMatter(file, fm => {
        fm.sourceArchiveId = 'archive-new';
        fm.archiveTags = ['travel'];
      });
      await vi.runAllTimersAsync();

      expect(server.active.has('archive-new|tag-travel')).toBe(true);
    });
  });
});
