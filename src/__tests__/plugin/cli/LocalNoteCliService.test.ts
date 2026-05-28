import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import { LocalNoteCliService } from '@/plugin/cli/LocalNoteCliService';
import { CliValidationError } from '@/plugin/cli/CliParams';
import type { TagDefinition } from '@/types/tag';

// ─── Mocks for heavy lazy imports ─────────────────────────────────────

// PostService — return canned result so we don't touch the vault. The
// `copiedFilePath` is intentionally the same as the input file's path so
// the test plugin's `getFileByPath` map can resolve the posted file.
vi.mock('@/services/PostService', () => ({
  PostService: class {
    async postNote(file: TFile) {
      return {
        success: true,
        copiedFilePath: file.path,
        copiedMediaPaths: ['attachments/social-archives/post/x/2026-04-26-a-1.png'],
      };
    }
  },
}));

// MediaPlaceholderGenerator + MediaHandler — neutral stubs.
vi.mock('@/services/MediaPlaceholderGenerator', () => ({
  MediaPlaceholderGenerator: {
    findAllPlaceholders: () => [],
    replacePlaceholderWithEmbed: (s: string) => s,
  },
}));
vi.mock('@/services/MediaHandler', () => ({
  MediaHandler: class {
    async redownloadExpiredMedia() {
      return null;
    }
  },
}));

// Author scanner / deduplicator
vi.mock('@/services/AuthorVaultScanner', () => ({
  AuthorVaultScanner: class {
    async scanVault() {
      return {
        authors: [
          { platform: 'x', authorName: 'A', authorUrl: 'https://x.com/a', archiveCount: 1 },
          { platform: 'x', authorName: 'B', authorUrl: 'https://x.com/b', archiveCount: 2 },
        ],
      };
    }
  },
}));
vi.mock('@/services/AuthorDeduplicator', () => ({
  AuthorDeduplicator: class {
    deduplicate(authors: unknown[]) {
      return { authors };
    }
  },
}));

// shareUrl helper
vi.mock('@/utils/shareUrl', () => ({
  toReaderModeShareUrl: (url: string) => `${url}#reader`,
  getShareUrlForClipboard: (url: string, reader: boolean) =>
    reader ? `${url}#reader` : url,
}));

// ShareAPIClient — only methods exercised by the share() flow.
const fakeShare = {
  createShare: vi.fn(async () => ({
    shareId: 'share-123',
    shareUrl: 'https://share.example/x/abc',
  })),
  updateShareWithMedia: vi.fn(async () => ({
    shareId: 'share-123',
    shareUrl: 'https://share.example/x/abc',
    mediaStats: { totalCount: 1, uploadedCount: 1, reusedCount: 0, keptCount: 0, skippedCount: 0 },
  })),
  importShareArchive: vi.fn(async () => ({ archiveId: 'arch-1', created: true })),
};
vi.mock('@/services/ShareAPIClient', () => ({
  ShareAPIClient: class {
    createShare = fakeShare.createShare;
    updateShareWithMedia = fakeShare.updateShareWithMedia;
    importShareArchive = fakeShare.importShareArchive;
  },
}));

// ─── Plugin factory ───────────────────────────────────────────────────

interface FakeTagStore {
  getTagDefinitions: () => TagDefinition[];
  getAllDiscoveredTags: () => TagDefinition[];
  getTagsWithCounts: () => Array<TagDefinition & { archiveCount: number }>;
  getTagsForPost: (path: string) => string[];
  getDisplayTagsForPost: (path: string) => string[];
  addTagToPost: (path: string, tag: string) => Promise<void>;
  addArchiveTagToPost: (path: string, tag: string) => Promise<void>;
  removeTagFromPost: (path: string, tag: string) => Promise<void>;
  removeDisplayTagFromPost: (path: string, tag: string) => Promise<void>;
  toggleTagOnPost: (path: string, tag: string) => Promise<boolean>;
  toggleDisplayTagOnPost: (path: string, tag: string) => Promise<boolean>;
  createTag: (name: string, color?: string | null) => Promise<TagDefinition>;
}

function makePlugin(opts: {
  files?: Record<string, TFile>;
  activeFile?: TFile | null;
  authToken?: string;
  workerUrl?: string;
  tagState?: { tags: string[] };
  tagDefinitions?: TagDefinition[];
  authorNotesEnabled?: boolean;
  hasBatchManager?: boolean;
  batchStatus?: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';
  detachedSvc?: { detach: () => Promise<unknown>; redownload: () => Promise<unknown> };
} = {}): any {
  const files = opts.files ?? {};
  const tagState = opts.tagState ?? { tags: [] };
  const tagDefs = opts.tagDefinitions ?? [];

  const tagStore: FakeTagStore = {
    getTagDefinitions: () => tagDefs,
    getAllDiscoveredTags: () => tagDefs,
    getTagsWithCounts: () => tagDefs.map((d) => ({ ...d, archiveCount: 0 })),
    getTagsForPost: () => [...tagState.tags],
    getDisplayTagsForPost: () => [...tagState.tags],
    addTagToPost: vi.fn(async (_p, tag: string) => {
      if (!tagState.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        tagState.tags.push(tag);
      }
    }) as FakeTagStore['addTagToPost'],
    addArchiveTagToPost: vi.fn(async (_p, tag: string) => {
      if (!tagState.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        tagState.tags.push(tag);
      }
    }) as FakeTagStore['addArchiveTagToPost'],
    removeTagFromPost: vi.fn(async (_p, tag: string) => {
      tagState.tags = tagState.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
    }) as FakeTagStore['removeTagFromPost'],
    removeDisplayTagFromPost: vi.fn(async (_p, tag: string) => {
      tagState.tags = tagState.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
    }) as FakeTagStore['removeDisplayTagFromPost'],
    toggleTagOnPost: vi.fn(async (_p, tag: string) => {
      const lower = tag.toLowerCase();
      const exists = tagState.tags.some((t) => t.toLowerCase() === lower);
      if (exists) {
        tagState.tags = tagState.tags.filter((t) => t.toLowerCase() !== lower);
        return false;
      }
      tagState.tags.push(tag);
      return true;
    }) as FakeTagStore['toggleTagOnPost'],
    toggleDisplayTagOnPost: vi.fn(async (_p, tag: string) => {
      const lower = tag.toLowerCase();
      const exists = tagState.tags.some((t) => t.toLowerCase() === lower);
      if (exists) {
        tagState.tags = tagState.tags.filter((t) => t.toLowerCase() !== lower);
        return false;
      }
      tagState.tags.push(tag);
      return true;
    }) as FakeTagStore['toggleDisplayTagOnPost'],
    createTag: vi.fn(async (name: string, color?: string | null) => {
      const def: TagDefinition = {
        id: `id-${name}`,
        name,
        color: color ?? '#3b82f6',
        sortOrder: tagDefs.length,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      tagDefs.push(def);
      return def;
    }) as FakeTagStore['createTag'],
  };

  const plugin: any = {
    manifest: { id: 'social-archiver', version: '3.6.2' },
    settings: {
      authToken: opts.authToken,
      workerUrl: opts.workerUrl,
      username: 'me',
      tier: 'free',
      shareMode: 'preview',
      mediaPath: 'attachments/social-archives',
      archivePath: 'Social Archives',
      enableAuthorNotes: opts.authorNotesEnabled ?? false,
    },
    app: {
      workspace: {
        getActiveFile: () => opts.activeFile ?? null,
      },
      vault: {
        getName: () => 'V',
        getAbstractFileByPath: (p: string) => files[p] ?? null,
        getFileByPath: (p: string) => files[p] ?? null,
        read: vi.fn(async () => '---\nplatform: post\n---\nbody'),
        modify: vi.fn(async () => undefined),
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: {} }),
      },
      fileManager: {
        processFrontMatter: vi.fn(async (_f: TFile, mut: (fm: Record<string, unknown>) => void) => {
          const fm: Record<string, unknown> = {};
          mut(fm);
        }),
      },
    },
    tagStore,
    getAuthorNoteService: () =>
      opts.authorNotesEnabled
        ? {
            upsertFromCatalogEntry: vi.fn(async (entry: { authorName: string }) => {
              return new TFile(`Authors/${entry.authorName}.md`);
            }),
          }
        : undefined,
    detachedMediaService: opts.detachedSvc,
    batchTranscriptionManager: opts.hasBatchManager
      ? {
          getStatus: () => opts.batchStatus ?? 'idle',
          getProgress: () => ({
            status: opts.batchStatus ?? 'idle',
            mode: 'transcribe-only',
            totalItems: 0,
            completedItems: 0,
            failedItems: 0,
            skippedItems: 0,
            currentIndex: 0,
            elapsedMs: 0,
          }),
          start: vi.fn(async () => undefined),
          pause: vi.fn(() => undefined),
          resume: vi.fn(async () => undefined),
          cancel: vi.fn(() => undefined),
        }
      : null,
    refreshTimelineView: () => undefined,
  };
  Object.defineProperty(plugin, 'workersApiClient', {
    get() {
      throw new Error('not initialized');
    },
  });
  return plugin;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('LocalNoteCliService', () => {
  beforeEach(() => {
    fakeShare.createShare.mockClear();
    fakeShare.updateShareWithMedia.mockClear();
    fakeShare.importShareArchive.mockClear();
  });

  describe('resolveFile', () => {
    it('uses workspace.getActiveFile() when called with "active"', async () => {
      const file = new TFile('Active.md');
      const plugin = makePlugin({ activeFile: file, files: { 'Active.md': file } });
      const svc = new LocalNoteCliService(plugin);
      const result = await svc.post('active');
      expect(result.filePath).toContain('Active');
    });

    it('returns INVALID_ARGUMENT when active is requested but no file is active', async () => {
      const plugin = makePlugin({ activeFile: null });
      const svc = new LocalNoteCliService(plugin);
      await expect(svc.post('active')).rejects.toBeInstanceOf(CliValidationError);
    });

    it('returns INVALID_ARGUMENT when the path does not exist', async () => {
      const plugin = makePlugin({ files: {} });
      const svc = new LocalNoteCliService(plugin);
      await expect(svc.post('Missing/note.md')).rejects.toBeInstanceOf(CliValidationError);
    });
  });

  describe('share', () => {
    it('returns shareUrl and never includes a password field', async () => {
      const file = new TFile('Note.md');
      const plugin = makePlugin({
        files: { 'Note.md': file },
        authToken: 'tok',
        workerUrl: 'https://example.com',
      });
      const svc = new LocalNoteCliService(plugin);
      const result = await svc.share('Note.md', { reader: false });
      const json = JSON.stringify(result);
      expect(json).not.toMatch(/password/i);
      expect(result.shareUrl).toBe('https://share.example/x/abc');
    });

    it('appends #reader when reader=true', async () => {
      const file = new TFile('Note.md');
      const plugin = makePlugin({
        files: { 'Note.md': file },
        authToken: 'tok',
        workerUrl: 'https://example.com',
      });
      const svc = new LocalNoteCliService(plugin);
      const result = await svc.share('Note.md', { reader: true });
      expect(result.shareUrl.endsWith('#reader')).toBe(true);
    });

    it('rejects when auth settings are not configured', async () => {
      const file = new TFile('Note.md');
      const plugin = makePlugin({ files: { 'Note.md': file } });
      const svc = new LocalNoteCliService(plugin);
      await expect(svc.share('Note.md', { reader: false })).rejects.toBeInstanceOf(
        CliValidationError,
      );
    });
  });

  describe('tagApply', () => {
    it('action=add adds a missing tag', async () => {
      const file = new TFile('Note.md');
      const plugin = makePlugin({ files: { 'Note.md': file }, tagState: { tags: [] } });
      const svc = new LocalNoteCliService(plugin);
      const result = await svc.tagApply('Note.md', 'foo', 'add');
      expect(result.result).toBe('added');
      expect(result.appliedTags).toContain('foo');
    });

    it('action=add on existing tag is a noop', async () => {
      const file = new TFile('Note.md');
      const plugin = makePlugin({ files: { 'Note.md': file }, tagState: { tags: ['foo'] } });
      const svc = new LocalNoteCliService(plugin);
      const result = await svc.tagApply('Note.md', 'foo', 'add');
      expect(result.result).toBe('noop');
    });

    it('action=toggle flips state on/off', async () => {
      const file = new TFile('Note.md');
      const state = { tags: [] as string[] };
      const plugin = makePlugin({ files: { 'Note.md': file }, tagState: state });
      const svc = new LocalNoteCliService(plugin);

      const r1 = await svc.tagApply('Note.md', 'bar', 'toggle');
      expect(r1.result).toBe('added');
      expect(state.tags).toContain('bar');

      const r2 = await svc.tagApply('Note.md', 'bar', 'toggle');
      expect(r2.result).toBe('removed');
      expect(state.tags).not.toContain('bar');
    });
  });

  describe('tagsList', () => {
    it('returns definitions and discovered separately', () => {
      const defs: TagDefinition[] = [
        { id: '1', name: 'a', color: '#000', sortOrder: 0, createdAt: '', updatedAt: '' },
      ];
      const plugin = makePlugin({ tagDefinitions: defs });
      const svc = new LocalNoteCliService(plugin);
      const out = svc.tagsList({ counts: false });
      expect(out.definitions).toHaveLength(1);
      expect(out.counts).toBeUndefined();
    });

    it('includes counts when requested', () => {
      const defs: TagDefinition[] = [
        { id: '1', name: 'a', color: '#000', sortOrder: 0, createdAt: '', updatedAt: '' },
      ];
      const plugin = makePlugin({ tagDefinitions: defs });
      const svc = new LocalNoteCliService(plugin);
      const out = svc.tagsList({ counts: true });
      expect(out.counts).toBeDefined();
    });
  });

  describe('media', () => {
    it('detach delegates to DetachedMediaService and surfaces deletedCount', async () => {
      const file = new TFile('Note.md');
      const detach = vi.fn(async () => ({ deletedCount: 2, failedCount: 0, rewrittenCount: 2 }));
      const plugin = makePlugin({
        files: { 'Note.md': file },
        detachedSvc: { detach, redownload: vi.fn() as never },
      });
      const svc = new LocalNoteCliService(plugin);
      const result = await svc.media('Note.md', 'detach');
      expect(result.affectedMedia).toBe(2);
      expect(detach).toHaveBeenCalledOnce();
    });

    it('returns INVALID_ARGUMENT when detached media service is missing', async () => {
      const file = new TFile('Note.md');
      const plugin = makePlugin({ files: { 'Note.md': file } });
      const svc = new LocalNoteCliService(plugin);
      await expect(svc.media('Note.md', 'detach')).rejects.toBeInstanceOf(CliValidationError);
    });
  });

  describe('authorNotes', () => {
    it('dry run reports authors without creating', async () => {
      const plugin = makePlugin({ authorNotesEnabled: true });
      const svc = new LocalNoteCliService(plugin);
      const out = await svc.authorNotes({ dryRun: true });
      expect(out.created).toBe(0);
      expect(out.paths.length).toBeGreaterThan(0);
    });

    it('honors limit', async () => {
      const plugin = makePlugin({ authorNotesEnabled: true });
      const svc = new LocalNoteCliService(plugin);
      const out = await svc.authorNotes({ dryRun: true, limit: 1 });
      expect(out.paths).toHaveLength(1);
    });

    it('throws INVALID_ARGUMENT when the feature is disabled', async () => {
      const plugin = makePlugin({ authorNotesEnabled: false });
      const svc = new LocalNoteCliService(plugin);
      await expect(svc.authorNotes({ dryRun: true })).rejects.toBeInstanceOf(CliValidationError);
    });
  });

  describe('transcribe', () => {
    it('status returns a DTO snapshot', async () => {
      const plugin = makePlugin({ hasBatchManager: true, batchStatus: 'idle' });
      const svc = new LocalNoteCliService(plugin);
      const result = await svc.transcribe({ action: 'status' });
      expect(result.action).toBe('status');
      expect(result.status.state).toBe('idle');
    });

    it('start requires mode', async () => {
      const plugin = makePlugin({ hasBatchManager: true, batchStatus: 'idle' });
      const svc = new LocalNoteCliService(plugin);
      await expect(svc.transcribe({ action: 'start' })).rejects.toBeInstanceOf(
        CliValidationError,
      );
    });

    it('pause requires running state', async () => {
      const plugin = makePlugin({ hasBatchManager: true, batchStatus: 'idle' });
      const svc = new LocalNoteCliService(plugin);
      await expect(svc.transcribe({ action: 'pause' })).rejects.toBeInstanceOf(
        CliValidationError,
      );
    });

    it('cancel rejects when batch is idle', async () => {
      const plugin = makePlugin({ hasBatchManager: true, batchStatus: 'idle' });
      const svc = new LocalNoteCliService(plugin);
      await expect(svc.transcribe({ action: 'cancel' })).rejects.toBeInstanceOf(
        CliValidationError,
      );
    });

    it('rejects when batch manager is not available', async () => {
      const plugin = makePlugin({ hasBatchManager: false });
      const svc = new LocalNoteCliService(plugin);
      await expect(svc.transcribe({ action: 'status' })).rejects.toBeInstanceOf(
        CliValidationError,
      );
    });
  });
});
