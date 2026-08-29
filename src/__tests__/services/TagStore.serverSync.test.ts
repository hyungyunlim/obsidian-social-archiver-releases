/**
 * TagStore — server tag-deletion sync tests
 *
 * Covers the two directions tag deletions must travel:
 * - inbound: server tombstones (deletedIds) remove local definitions AND
 *   clean the tag out of note frontmatter
 * - outbound: a local deleteTag pushes DELETE to the server, with a
 *   pending queue that survives failures and is flushed before every pull
 *   (so the pull can't resurrect an unpushed delete)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { TagStore } from '../../services/TagStore';
import type { TagDefinition } from '../../types/tag';

const EPOCH = '1970-01-01T00:00:00.000Z';

// ─── Mock factories ───────────────────────────────────────

function makeDef(id: string, name: string): TagDefinition {
  return {
    id,
    name,
    color: '#ff0000',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeHarness(options: {
  definitions?: TagDefinition[];
  pendingTagDeleteIds?: string[];
  authToken?: string;
  /** frontmatter per note path inside the archive folder */
  fmByPath?: Map<string, Record<string, unknown>>;
  apiClient?: {
    getUserTags?: ReturnType<typeof vi.fn>;
    deleteUserTag?: ReturnType<typeof vi.fn>;
  } | null;
}) {
  const fmByPath = options.fmByPath ?? new Map<string, Record<string, unknown>>();

  const files = [...fmByPath.keys()].map((p) => new TFile(p));
  const folder = new TFolder('Social Archives', files);

  const app = {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) =>
        path === 'Social Archives' ? folder : null
      ),
    },
    metadataCache: {
      getFileCache: vi.fn((file: TFile) => {
        const fm = fmByPath.get(file.path);
        return fm ? { frontmatter: fm } : null;
      }),
    },
    fileManager: {
      processFrontMatter: vi.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm = fmByPath.get(file.path) ?? {};
        fn(fm);
        fmByPath.set(file.path, fm);
      }),
    },
  };

  const apiClient =
    options.apiClient === null
      ? undefined
      : {
          getUserTags: options.apiClient?.getUserTags ?? vi.fn().mockResolvedValue({
            tags: [],
            deletedIds: [],
            serverTime: '2026-08-29T00:00:00.000Z',
          }),
          deleteUserTag: options.apiClient?.deleteUserTag ?? vi.fn().mockResolvedValue({ tagId: 'x' }),
        };

  const settings = {
    archivePath: 'Social Archives',
    authToken: options.authToken ?? 'token',
    syncClientId: 'client-1',
    tagDefinitions: options.definitions ?? [],
    pendingTagDeleteIds: options.pendingTagDeleteIds ?? [],
    mirrorArchiveTagsToObsidianTags: false,
  };

  const plugin = {
    settings,
    saveSettingsPartial: vi.fn(async (partial: Record<string, unknown>) => {
      Object.assign(settings, partial);
    }),
    getApiClient: vi.fn(() => apiClient),
  };

  const store = new TagStore(app as never, plugin as never);
  return { store, plugin, settings, apiClient, fmByPath };
}

// ─── Inbound: server tombstones ───────────────────────────

describe('TagStore.pullTagDefinitionsFromServer — server deletions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests the full set with tombstones (epoch cursor + includeDeleted)', async () => {
    const { store, apiClient } = makeHarness({ definitions: [] });

    await store.pullTagDefinitionsFromServer(apiClient!);

    expect(apiClient!.getUserTags).toHaveBeenCalledWith({
      updatedAfter: EPOCH,
      includeDeleted: true,
    });
  });

  it('removes tombstoned definitions and cleans the tag from note frontmatter', async () => {
    const work = makeDef('tag-work', 'work');
    const travel = makeDef('tag-travel', 'travel');
    const fmByPath = new Map<string, Record<string, unknown>>([
      ['Social Archives/post.md', { tags: ['work'], archiveTags: ['work', 'travel'] }],
    ]);

    const { store, settings, apiClient, fmByPath: fm } = makeHarness({
      definitions: [work, travel],
      fmByPath,
      apiClient: {
        getUserTags: vi.fn().mockResolvedValue({
          tags: [{ ...travel, color: null }],
          deletedIds: ['tag-work'],
          serverTime: '2026-08-29T00:00:00.000Z',
        }),
      },
    });

    const changes = await store.pullTagDefinitionsFromServer(apiClient!);

    expect(changes).toBeGreaterThan(0);
    expect(settings.tagDefinitions.map((d: TagDefinition) => d.id)).toEqual(['tag-travel']);
    expect(fm.get('Social Archives/post.md')).toEqual({ tags: [], archiveTags: ['travel'] });
  });

  it('ignores tombstones for tags that do not exist locally', async () => {
    const { store, settings, apiClient } = makeHarness({
      definitions: [makeDef('tag-a', 'alpha')],
      apiClient: {
        getUserTags: vi.fn().mockResolvedValue({
          tags: [],
          deletedIds: ['tag-unknown'],
          serverTime: '2026-08-29T00:00:00.000Z',
        }),
      },
    });

    const changes = await store.pullTagDefinitionsFromServer(apiClient!);

    expect(changes).toBe(0);
    expect(settings.tagDefinitions.map((d: TagDefinition) => d.id)).toEqual(['tag-a']);
  });

  it('does not resurrect a tag whose local delete is still queued (push failed)', async () => {
    const { store, settings, apiClient } = makeHarness({
      definitions: [],
      pendingTagDeleteIds: ['tag-work'],
      apiClient: {
        deleteUserTag: vi.fn().mockRejectedValue(new Error('network down')),
        getUserTags: vi.fn().mockResolvedValue({
          tags: [{ ...makeDef('tag-work', 'work'), color: null }],
          deletedIds: [],
          serverTime: '2026-08-29T00:00:00.000Z',
        }),
      },
    });

    await store.pullTagDefinitionsFromServer(apiClient!);

    expect(settings.tagDefinitions).toEqual([]);
    expect(settings.pendingTagDeleteIds).toEqual(['tag-work']);
  });

  it('flushes queued deletes before pulling; TAG_NOT_FOUND counts as success', async () => {
    const notFound = Object.assign(new Error('Tag not found'), { code: 'TAG_NOT_FOUND' });
    const callOrder: string[] = [];
    const { store, settings, apiClient } = makeHarness({
      definitions: [],
      pendingTagDeleteIds: ['tag-gone', 'tag-live'],
      apiClient: {
        deleteUserTag: vi.fn((tagId: string) => {
          callOrder.push(`delete:${tagId}`);
          return tagId === 'tag-gone' ? Promise.reject(notFound) : Promise.resolve({ tagId });
        }),
        getUserTags: vi.fn(() => {
          callOrder.push('pull');
          return Promise.resolve({ tags: [], deletedIds: [], serverTime: '2026-08-29T00:00:00.000Z' });
        }),
      },
    });

    await store.pullTagDefinitionsFromServer(apiClient!);

    expect(callOrder).toEqual(['delete:tag-gone', 'delete:tag-live', 'pull']);
    expect(settings.pendingTagDeleteIds).toEqual([]);
  });
});

// ─── Outbound: local deleteTag → server ───────────────────

describe('TagStore.deleteTag — server propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes the deletion to the server and clears the queue on success', async () => {
    const { store, settings, apiClient } = makeHarness({
      definitions: [makeDef('tag-work', 'work')],
    });

    const deleted = await store.deleteTag('tag-work');

    expect(deleted).toBe(true);
    expect(settings.tagDefinitions).toEqual([]);
    expect(apiClient!.deleteUserTag).toHaveBeenCalledWith('tag-work', 'client-1');
    expect(settings.pendingTagDeleteIds).toEqual([]);
  });

  it('keeps the deletion queued when the server call fails (retried on next pull)', async () => {
    const { store, settings, apiClient } = makeHarness({
      definitions: [makeDef('tag-work', 'work')],
      apiClient: {
        deleteUserTag: vi.fn().mockRejectedValue(new Error('offline')),
      },
    });

    const deleted = await store.deleteTag('tag-work');

    expect(deleted).toBe(true);
    expect(settings.tagDefinitions).toEqual([]);
    expect(settings.pendingTagDeleteIds).toEqual(['tag-work']);
  });

  it('skips the server push when not signed in', async () => {
    const { store, settings, apiClient } = makeHarness({
      definitions: [makeDef('tag-work', 'work')],
      authToken: '',
    });

    await store.deleteTag('tag-work');

    expect(apiClient!.deleteUserTag).not.toHaveBeenCalled();
    expect(settings.pendingTagDeleteIds).toEqual([]);
  });
});
