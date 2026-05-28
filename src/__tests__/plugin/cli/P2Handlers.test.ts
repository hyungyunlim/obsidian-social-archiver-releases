import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { CliRegistry } from '@/plugin/cli/CliRegistry';
import { COMMANDS } from '@/plugin/cli/CliFlags';
import type { CliData, CliHandler } from '@/types/obsidian-cli';

// Heavy lazy imports are mocked at the module boundary so handler-level
// validation paths can be exercised without touching the vault.
vi.mock('@/services/PostService', () => ({
  PostService: class {
    async postNote() {
      return {
        success: true,
        copiedFilePath: 'Social Archives/Post/2026/04/Note.md',
        copiedMediaPaths: [],
      };
    }
  },
}));
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
vi.mock('@/services/AuthorVaultScanner', () => ({
  AuthorVaultScanner: class {
    async scanVault() {
      return {
        authors: [
          { platform: 'x', authorName: 'A', authorUrl: 'https://x.com/a', archiveCount: 1 },
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
vi.mock('@/services/ShareAPIClient', () => ({
  ShareAPIClient: class {
    async createShare() {
      return { shareId: 's', shareUrl: 'https://share/x' };
    }
    async updateShareWithMedia() {
      return { shareId: 's', shareUrl: 'https://share/x' };
    }
    async importShareArchive() {
      return { archiveId: 'a', created: true };
    }
  },
}));
vi.mock('@/utils/shareUrl', () => ({
  toReaderModeShareUrl: (u: string) => `${u}#reader`,
  getShareUrlForClipboard: (u: string) => u,
}));

interface RegisterCall {
  command: string;
  handler: CliHandler;
}

function makePlugin(opts: {
  files?: Record<string, TFile>;
  hasBatchManager?: boolean;
  tagDefs?: unknown[];
  authorNotesEnabled?: boolean;
} = {}): { plugin: any; calls: RegisterCall[] } {
  const calls: RegisterCall[] = [];
  const files = opts.files ?? {};
  const tagDefs = opts.tagDefs ?? [];

  const plugin: any = {
    manifest: { id: 'social-archiver', version: '3.6.2' },
    settings: {
      username: 'me',
      authToken: '',
      workerUrl: '',
      tier: 'free',
      mediaPath: 'attachments/social-archives',
      archivePath: 'Social Archives',
      enableAuthorNotes: opts.authorNotesEnabled ?? false,
    },
    app: {
      workspace: { getActiveFile: () => null },
      vault: {
        getName: () => 'V',
        getAbstractFileByPath: (p: string) => files[p] ?? null,
        getFileByPath: (p: string) => files[p] ?? null,
        read: vi.fn(async () => ''),
        modify: vi.fn(async () => undefined),
      },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
      fileManager: {
        processFrontMatter: vi.fn(async () => undefined),
      },
    },
    tagStore: {
      getTagDefinitions: () => tagDefs,
      getAllDiscoveredTags: () => tagDefs,
      getTagsWithCounts: () => tagDefs,
      getTagsForPost: () => [] as string[],
      getDisplayTagsForPost: () => [] as string[],
      addTagToPost: vi.fn(async () => undefined),
      addArchiveTagToPost: vi.fn(async () => undefined),
      removeTagFromPost: vi.fn(async () => undefined),
      removeDisplayTagFromPost: vi.fn(async () => undefined),
      toggleTagOnPost: vi.fn(async () => true),
      toggleDisplayTagOnPost: vi.fn(async () => true),
      createTag: vi.fn(async (name: string) => ({
        id: name,
        name,
        color: '#000',
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      })),
    },
    getAuthorNoteService: () => undefined,
    detachedMediaService: undefined,
    batchTranscriptionManager: opts.hasBatchManager
      ? {
          getStatus: () => 'idle',
          getProgress: () => ({
            status: 'idle',
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
    archiveCliService: {
      enqueueArchive: vi.fn(),
      runSyncArchive: vi.fn(),
      fetchOnly: vi.fn(),
      getJobStatus: vi.fn(),
      listJobs: vi.fn(),
      runJobsCheck: vi.fn(),
      runSync: vi.fn(),
    },
    registerCliHandler: (cmd: string, _d: string, _f: unknown, h: CliHandler) => {
      calls.push({ command: cmd, handler: h });
    },
  };
  Object.defineProperty(plugin, 'workersApiClient', {
    get() {
      throw new Error('not initialized');
    },
  });
  return { plugin, calls };
}

function findCall(calls: RegisterCall[], command: string): RegisterCall {
  const call = calls.find((c) => c.command === command);
  if (!call) throw new Error(`Command not registered: ${command}`);
  return call;
}

describe('CliRegistry P2 handlers', () => {
  describe('post', () => {
    it('missing path AND active → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.POST).handler;
      const out = JSON.parse(await handler({} as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('both path AND active → INVALID_ARGUMENT', async () => {
      const file = new TFile('Note.md');
      const { plugin, calls } = makePlugin({ files: { 'Note.md': file } });
      plugin.app.workspace.getActiveFile = () => file;
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.POST).handler;
      const out = JSON.parse(
        await handler({ path: 'Note.md', active: 'true' } as CliData),
      );
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('share', () => {
    it('missing target → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.SHARE).handler;
      const out = JSON.parse(await handler({} as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('tags', () => {
    it('returns tag definitions in success envelope', async () => {
      const { plugin, calls } = makePlugin({
        tagDefs: [
          { id: '1', name: 'a', color: '#000', sortOrder: 0, createdAt: '', updatedAt: '' },
        ],
      });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.TAGS).handler;
      const out = JSON.parse(await handler({} as CliData));
      expect(out.ok).toBe(true);
      expect(out.data.definitions).toHaveLength(1);
    });
  });

  describe('tag-create', () => {
    it('missing name → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.TAG_CREATE).handler;
      const out = JSON.parse(await handler({} as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('tag-apply', () => {
    it('missing path → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.TAG_APPLY).handler;
      const out = JSON.parse(await handler({ tag: 'foo' } as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('missing tag → INVALID_ARGUMENT', async () => {
      const file = new TFile('Note.md');
      const { plugin, calls } = makePlugin({ files: { 'Note.md': file } });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.TAG_APPLY).handler;
      const out = JSON.parse(await handler({ path: 'Note.md' } as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('invalid action → INVALID_ARGUMENT', async () => {
      const file = new TFile('Note.md');
      const { plugin, calls } = makePlugin({ files: { 'Note.md': file } });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.TAG_APPLY).handler;
      const out = JSON.parse(
        await handler({ path: 'Note.md', tag: 'foo', action: 'nope' } as CliData),
      );
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('media', () => {
    it('missing action → INVALID_ARGUMENT', async () => {
      const file = new TFile('Note.md');
      const { plugin, calls } = makePlugin({ files: { 'Note.md': file } });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.MEDIA).handler;
      const out = JSON.parse(await handler({ path: 'Note.md' } as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('invalid action → INVALID_ARGUMENT', async () => {
      const file = new TFile('Note.md');
      const { plugin, calls } = makePlugin({ files: { 'Note.md': file } });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.MEDIA).handler;
      const out = JSON.parse(
        await handler({ path: 'Note.md', action: 'bogus' } as CliData),
      );
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('missing target → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.MEDIA).handler;
      const out = JSON.parse(await handler({ action: 'detach' } as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('author-notes', () => {
    it('dry-run returns paths when enabled', async () => {
      const { plugin, calls } = makePlugin({ authorNotesEnabled: true });
      // override mocks to return some authors
      plugin.getAuthorNoteService = () => ({
        upsertFromCatalogEntry: async () => null,
      });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.AUTHOR_NOTES).handler;
      const out = JSON.parse(await handler({ dryRun: 'true' } as CliData));
      expect(out.ok).toBe(true);
      expect(Array.isArray(out.data.paths)).toBe(true);
    });

    it('feature disabled → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin({ authorNotesEnabled: false });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.AUTHOR_NOTES).handler;
      const out = JSON.parse(await handler({} as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('transcribe', () => {
    it('missing action → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin({ hasBatchManager: true });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.TRANSCRIBE).handler;
      const out = JSON.parse(await handler({} as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('invalid action → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin({ hasBatchManager: true });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.TRANSCRIBE).handler;
      const out = JSON.parse(await handler({ action: 'wat' } as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('start without mode → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin({ hasBatchManager: true });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.TRANSCRIBE).handler;
      const out = JSON.parse(await handler({ action: 'start' } as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('status with no manager → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin({ hasBatchManager: false });
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.TRANSCRIBE).handler;
      const out = JSON.parse(await handler({ action: 'status' } as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('ai-comment', () => {
    it('missing path → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.AI_COMMENT).handler;
      const out = JSON.parse(await handler({ type: 'summary' } as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('missing type → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.AI_COMMENT).handler;
      const out = JSON.parse(await handler({ path: 'Archives/X/post.md' } as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });

    it('type=custom without prompt → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.AI_COMMENT).handler;
      const out = JSON.parse(
        await handler({ path: 'p.md', type: 'custom' } as CliData),
      );
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('ai-comments', () => {
    it('missing path → INVALID_ARGUMENT', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.AI_COMMENTS).handler;
      const out = JSON.parse(await handler({} as CliData));
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('ai-providers', () => {
    it('returns desktop=true with three providers', async () => {
      const { plugin, calls } = makePlugin();
      new CliRegistry(plugin).boot();
      const handler = findCall(calls, COMMANDS.AI_PROVIDERS).handler;
      const out = JSON.parse(await handler({} as CliData));
      expect(out.ok).toBe(true);
      expect(out.data.providers.length).toBe(3);
    });
  });
});
