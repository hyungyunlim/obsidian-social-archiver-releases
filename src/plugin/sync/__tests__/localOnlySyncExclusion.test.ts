/**
 * Local-only sync exclusion — contract tests (PRD S5.1)
 *
 * Proves, for every sync service with a guard, the three-way contract:
 * 1. A local-only note (`social_archiver_import_mode: 'local-only'`) is
 *    SKIPPED — never matched by URL, written to, backfilled, trashed, or
 *    used to resolve a server archive.
 * 2. An 'imported'-marked note participates in sync normally (exact-match
 *    rule — key presence alone never excludes).
 * 3. A note without the key participates in sync normally.
 *
 * Mocks follow the seams used by the existing sync tests in
 * src/__tests__/plugin/sync/ (vi.fn() stubs for App, WorkersAPIClient,
 * ArchiveLookupService).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { App, TFile } from 'obsidian';
import {
  IMPORT_MODE_FRONTMATTER_KEY,
  IMPORT_MODE_LOCAL_ONLY,
  IMPORT_MODE_IMPORTED,
} from '../../../services/import/local/LocalArchiveScanner';
import type { SocialArchiverSettings } from '../../../types/settings';
import type { WorkersAPIClient, UserArchive } from '../../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../../services/ArchiveLookupService';
import type { PostData } from '../../../types/post';
import { ArchiveLibrarySyncService } from '../ArchiveLibrarySyncService';
import { RemoteArchiveIngestService } from '../RemoteArchiveIngestService';
import { ArchiveStateOutboundService } from '../ArchiveStateOutboundService';
import { LikeStateOutboundService } from '../LikeStateOutboundService';
import { AnnotationOutboundService } from '../AnnotationOutboundService';
import { ArchiveStateSyncService } from '../ArchiveStateSyncService';
import { LikeStateSyncService } from '../LikeStateSyncService';
import { ShareStateSyncService } from '../ShareStateSyncService';
import { CommentStateSyncService } from '../CommentStateSyncService';
import { ArchiveDeleteSyncService, type ArchiveFileIdentity } from '../ArchiveDeleteSyncService';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ORIGINAL_URL = 'https://example.com/post/1';

/** Import mode for the three contract cases. */
type ImportModeCase = typeof IMPORT_MODE_LOCAL_ONLY | typeof IMPORT_MODE_IMPORTED | undefined;

const CASES: Array<{ label: string; mode: ImportModeCase; excluded: boolean }> = [
  { label: 'local-only note is skipped', mode: IMPORT_MODE_LOCAL_ONLY, excluded: true },
  { label: "'imported' note is NOT skipped", mode: IMPORT_MODE_IMPORTED, excluded: false },
  { label: 'note without the key is NOT skipped', mode: undefined, excluded: false },
];

function makeFrontmatter(mode: ImportModeCase, extra: Record<string, unknown> = {}) {
  return {
    originalUrl: ORIGINAL_URL,
    ...(mode !== undefined ? { [IMPORT_MODE_FRONTMATTER_KEY]: mode } : {}),
    ...extra,
  };
}

/** Note content matching the on-disk shape FrontmatterGenerator produces. */
function makeContent(mode: ImportModeCase): string {
  const lines = ['---', `originalUrl: ${ORIGINAL_URL}`];
  if (mode !== undefined) lines.push(`${IMPORT_MODE_FRONTMATTER_KEY}: ${mode}`);
  lines.push('---', '', 'Body');
  return lines.join('\n');
}

/** TFile stub whose vault.cachedRead serves the given content (content-based guards). */
function makeFileWithContent(mode: ImportModeCase, path = 'Social Archives/clip.md'): TFile {
  return {
    path,
    extension: 'md',
    vault: { cachedRead: vi.fn().mockResolvedValue(makeContent(mode)) },
  } as unknown as TFile;
}

function makeFile(path = 'Social Archives/clip.md'): TFile {
  return { path, extension: 'md' } as unknown as TFile;
}

function makeArchive(overrides: Partial<UserArchive> = {}): UserArchive {
  return {
    id: 'archive-1',
    userId: 'user-1',
    platform: 'x',
    postId: 'post-1',
    originalUrl: ORIGINAL_URL,
    title: 'Example post',
    authorName: 'Author',
    authorUrl: null,
    authorAvatarUrl: null,
    previewText: 'Preview',
    fullContent: 'Content',
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: null,
    postedAt: null,
    archivedAt: '2026-06-01T00:00:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    metadata: null,
    isLiked: false,
    isBookmarked: true,
    isArchived: true,
    isShared: false,
    ...overrides,
  } as UserArchive;
}

function makePostData(): PostData {
  return {
    platform: 'x',
    url: ORIGINAL_URL,
    author: { name: 'Author' },
    content: { text: 'Content' },
  } as unknown as PostData;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════════
// ArchiveLibrarySyncService — tier-2 URL dedup must not adopt local-only notes
// ═══════════════════════════════════════════════════════════════════════════════

describe('ArchiveLibrarySyncService — tier-2 URL dedup (PRD S5.1)', () => {
  function makeSettings(): SocialArchiverSettings {
    return {
      authToken: 'token',
      syncClientId: 'client-1',
      archivePath: 'Social Archives',
      archiveLibrarySync: {
        completedAt: '2026-06-01T00:00:00.000Z',
        resumeOffset: 0,
        runAnchorTime: '',
        lastServerTime: '2026-06-01T00:00:00.000Z',
        lastStatus: 'completed',
        lastError: '',
      },
    } as unknown as SocialArchiverSettings;
  }

  async function runDelta(mode: ImportModeCase) {
    const file = makeFileWithContent(mode);
    const backfillFileIdentity = vi.fn().mockResolvedValue(undefined);
    const saveSubscriptionPostDetailed = vi
      .fn()
      .mockResolvedValue({ status: 'created', file: makeFile('new.md') });
    const settings = makeSettings();

    const service = new ArchiveLibrarySyncService({
      apiClient: () =>
        ({
          getUserArchives: vi.fn().mockResolvedValue({
            archives: [makeArchive()],
            total: 1,
            hasMore: false,
            serverTime: '2026-06-10T00:00:00.000Z',
          }),
        }) as unknown as WorkersAPIClient,
      settings: () => settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([file]),
      findByClientPostId: vi.fn().mockReturnValue(null),
      indexSavedFile: vi.fn(),
      backfillFileIdentity,
      saveSubscriptionPostDetailed,
      convertUserArchiveToPostData: vi.fn().mockReturnValue(makePostData()),
      notify: vi.fn(),
    });

    await service.startDeltaSync();

    return { service, backfillFileIdentity, saveSubscriptionPostDetailed };
  }

  it('local-only note is skipped (no backfill, no save, counted as skipped)', async () => {
    const { service, backfillFileIdentity, saveSubscriptionPostDetailed } =
      await runDelta(IMPORT_MODE_LOCAL_ONLY);
    expect(backfillFileIdentity).not.toHaveBeenCalled();
    expect(saveSubscriptionPostDetailed).not.toHaveBeenCalled();
    expect(service.getState().skippedCount).toBe(1);
  });

  it("'imported' note is NOT skipped — identity is backfilled", async () => {
    const { backfillFileIdentity } = await runDelta(IMPORT_MODE_IMPORTED);
    expect(backfillFileIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'Social Archives/clip.md' }),
      'archive-1',
    );
  });

  it('note without the key is NOT skipped — identity is backfilled', async () => {
    const { backfillFileIdentity } = await runDelta(undefined);
    expect(backfillFileIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'Social Archives/clip.md' }),
      'archive-1',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RemoteArchiveIngestService — URL bind must not adopt or duplicate local-only notes
// ═══════════════════════════════════════════════════════════════════════════════

describe('RemoteArchiveIngestService — URL bind (PRD S5.1)', () => {
  async function runIngest(mode: ImportModeCase) {
    const file = makeFileWithContent(mode);
    const lookup = {
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([file]),
      backfillFileIdentity: vi.fn().mockResolvedValue(undefined),
      indexSavedFile: vi.fn(),
    };
    const saveSubscriptionPostDetailed = vi
      .fn()
      .mockResolvedValue({ status: 'created', file: makeFile('new.md') });

    const service = new RemoteArchiveIngestService({
      apiClient: () =>
        ({
          getUserArchive: vi.fn().mockResolvedValue({ archive: makeArchive() }),
        }) as unknown as WorkersAPIClient,
      settings: () => ({ archivePath: 'Social Archives' }),
      hasRecentlyArchivedUrl: vi.fn().mockReturnValue(false),
      archiveLookupService: lookup as unknown as ArchiveLookupService,
      convertUserArchiveToPostData: vi.fn().mockReturnValue(makePostData()),
      saveSubscriptionPost: vi.fn().mockResolvedValue(true),
      saveSubscriptionPostDetailed,
      refreshTimelineView: vi.fn(),
    });

    const result = await service.ingestArchiveById('archive-1', 'archive_complete');
    return { result, lookup, saveSubscriptionPostDetailed };
  }

  it('local-only note is skipped (no bind, no duplicate note)', async () => {
    const { result, lookup, saveSubscriptionPostDetailed } = await runIngest(IMPORT_MODE_LOCAL_ONLY);
    expect(result).toBe('skipped');
    expect(lookup.backfillFileIdentity).not.toHaveBeenCalled();
    expect(saveSubscriptionPostDetailed).not.toHaveBeenCalled();
  });

  it("'imported' note is NOT skipped — ingest proceeds", async () => {
    const { result, saveSubscriptionPostDetailed } = await runIngest(IMPORT_MODE_IMPORTED);
    expect(result).toBe('created');
    expect(saveSubscriptionPostDetailed).toHaveBeenCalledOnce();
  });

  it('note without the key is NOT skipped — ingest proceeds', async () => {
    const { result, saveSubscriptionPostDetailed } = await runIngest(undefined);
    expect(result).toBe('created');
    expect(saveSubscriptionPostDetailed).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Outbound watchers (MetadataCache.changed) — shared harness
// ═══════════════════════════════════════════════════════════════════════════════

/** App mock that captures the metadataCache.changed callback and serves frontmatter. */
function makeWatcherApp(frontmatter: Record<string, unknown>) {
  let changedCallback: ((file: TFile, data: string) => void) | undefined;
  return {
    metadataCache: {
      on: vi.fn().mockImplementation((_evt: string, cb: (file: TFile, data: string) => void) => {
        changedCallback = cb;
        return {};
      }),
      offref: vi.fn(),
      getFileCache: vi.fn().mockReturnValue({ frontmatter }),
    },
    fileManager: {
      processFrontMatter: vi
        .fn()
        .mockImplementation(async (_f: TFile, up: (fm: Record<string, unknown>) => void) => up({})),
    },
    trigger: (file: TFile) => changedCallback?.(file, ''),
  };
}

function makeOutboundApiClient() {
  return {
    getUserArchives: vi.fn().mockResolvedValue({ archives: [{ id: 'srv-1' }] }),
    getUserArchive: vi
      .fn()
      .mockResolvedValue({ archive: makeArchive({ id: 'srv-1', userNotes: [] }) }),
    updateArchiveActions: vi.fn().mockResolvedValue({}),
  };
}

function makeLookupWithoutIdentity(): ArchiveLookupService {
  return { getIdentityByPath: vi.fn().mockReturnValue(null) } as unknown as ArchiveLookupService;
}

/** Start the watcher past its 5s startup window, fire one change, flush the 2s debounce. */
async function fireWatcher(
  service: { start: () => void },
  app: ReturnType<typeof makeWatcherApp>,
  file: TFile,
): Promise<void> {
  vi.useFakeTimers();
  service.start();
  vi.advanceTimersByTime(6000); // move clock past STARTUP_WINDOW_MS (5s)
  app.trigger(file);
  await vi.advanceTimersByTimeAsync(2500); // flush DEBOUNCE_MS (2s)
  await flushMicrotasks();
}

describe('ArchiveStateOutboundService (PRD S5.1)', () => {
  for (const { label, mode, excluded } of CASES) {
    it(label, async () => {
      const file = makeFile();
      const app = makeWatcherApp(makeFrontmatter(mode, { archive: true }));
      const apiClient = makeOutboundApiClient();
      const service = new ArchiveStateOutboundService(
        app as unknown as App,
        apiClient as unknown as WorkersAPIClient,
        makeLookupWithoutIdentity(),
        () => ({ syncClientId: 'client-1' }) as unknown as SocialArchiverSettings,
      );

      await fireWatcher(service, app, file);

      if (excluded) {
        expect(apiClient.getUserArchives).not.toHaveBeenCalled();
        expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
      } else {
        expect(apiClient.getUserArchives).toHaveBeenCalledWith({ originalUrl: ORIGINAL_URL, limit: 1 });
        expect(apiClient.updateArchiveActions).toHaveBeenCalledWith('srv-1', { isBookmarked: true });
      }
    });
  }
});

describe('LikeStateOutboundService (PRD S5.1)', () => {
  for (const { label, mode, excluded } of CASES) {
    it(label, async () => {
      const file = makeFile();
      const app = makeWatcherApp(makeFrontmatter(mode, { like: true }));
      const apiClient = makeOutboundApiClient();
      const service = new LikeStateOutboundService(
        app as unknown as App,
        apiClient as unknown as WorkersAPIClient,
        makeLookupWithoutIdentity(),
        () => ({ syncClientId: 'client-1' }) as unknown as SocialArchiverSettings,
      );

      await fireWatcher(service, app, file);

      if (excluded) {
        expect(apiClient.getUserArchives).not.toHaveBeenCalled();
        expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
      } else {
        expect(apiClient.getUserArchives).toHaveBeenCalledWith({ originalUrl: ORIGINAL_URL, limit: 1 });
        expect(apiClient.updateArchiveActions).toHaveBeenCalledWith('srv-1', { isLiked: true });
      }
    });
  }
});

describe('AnnotationOutboundService (PRD S5.1)', () => {
  for (const { label, mode, excluded } of CASES) {
    it(label, async () => {
      const file = makeFile();
      const app = makeWatcherApp(makeFrontmatter(mode, { comment: 'hello' }));
      const apiClient = makeOutboundApiClient();
      const service = new AnnotationOutboundService(
        app as unknown as App,
        apiClient as unknown as WorkersAPIClient,
        makeLookupWithoutIdentity(),
        () =>
          ({
            syncClientId: 'client-1',
            enableMobileAnnotationSync: true,
          }) as unknown as SocialArchiverSettings,
      );

      await fireWatcher(service, app, file);

      if (excluded) {
        expect(apiClient.getUserArchives).not.toHaveBeenCalled();
        expect(apiClient.updateArchiveActions).not.toHaveBeenCalled();
      } else {
        expect(apiClient.getUserArchives).toHaveBeenCalledWith({ originalUrl: ORIGINAL_URL, limit: 1 });
        expect(apiClient.updateArchiveActions).toHaveBeenCalledWith('srv-1', {
          userNotes: [expect.objectContaining({ content: 'hello' })],
        });
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Inbound state services — URL fallback must not adopt local-only notes
// ═══════════════════════════════════════════════════════════════════════════════

/** App mock for inbound handlers: cache lookup + processFrontMatter / vault capture. */
function makeInboundApp(frontmatter: Record<string, unknown>) {
  return {
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue({ frontmatter }),
    },
    fileManager: {
      processFrontMatter: vi
        .fn()
        .mockImplementation(async (_f: TFile, up: (fm: Record<string, unknown>) => void) => up({})),
    },
    vault: {
      read: vi.fn().mockResolvedValue('Body'),
      modify: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeInboundApiClient(): WorkersAPIClient {
  return {
    getUserArchive: vi.fn().mockResolvedValue({ archive: makeArchive({ comments: [] }) }),
  } as unknown as WorkersAPIClient;
}

function makeInboundLookup(file: TFile): ArchiveLookupService {
  return {
    findBySourceArchiveId: vi.fn().mockReturnValue(null),
    findByOriginalUrl: vi.fn().mockReturnValue([file]),
  } as unknown as ArchiveLookupService;
}

describe('ArchiveStateSyncService — URL fallback (PRD S5.1)', () => {
  for (const { label, mode, excluded } of CASES) {
    it(label, async () => {
      const file = makeFile();
      const app = makeInboundApp(makeFrontmatter(mode, { archive: false }));
      const service = new ArchiveStateSyncService(
        app as unknown as App,
        makeInboundApiClient(),
        makeInboundLookup(file),
        () => ({ syncClientId: 'client-1' }) as unknown as SocialArchiverSettings,
      );

      await service.handleRemoteArchiveState({
        archiveId: 'archive-1',
        sourceClientId: 'other-client',
        changes: { isBookmarked: true },
        updatedAt: '2026-06-11T00:00:00.000Z',
        timestamp: Date.now(),
      });

      if (excluded) {
        expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
      } else {
        expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      }
    });
  }
});

describe('LikeStateSyncService — URL fallback (PRD S5.1)', () => {
  for (const { label, mode, excluded } of CASES) {
    it(label, async () => {
      const file = makeFile();
      const app = makeInboundApp(makeFrontmatter(mode, { like: false }));
      const service = new LikeStateSyncService(
        app as unknown as App,
        makeInboundApiClient(),
        makeInboundLookup(file),
        () => ({ syncClientId: 'client-1' }) as unknown as SocialArchiverSettings,
      );

      await service.handleRemoteLikeState({
        archiveId: 'archive-1',
        sourceClientId: 'other-client',
        changes: { isLiked: true },
        updatedAt: '2026-06-11T00:00:00.000Z',
        timestamp: Date.now(),
      });

      if (excluded) {
        expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
      } else {
        expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      }
    });
  }
});

describe('ShareStateSyncService — URL fallback (PRD S5.1)', () => {
  for (const { label, mode, excluded } of CASES) {
    it(label, async () => {
      const file = makeFile();
      const app = makeInboundApp(makeFrontmatter(mode));
      const service = new ShareStateSyncService(
        app as unknown as App,
        makeInboundApiClient(),
        makeInboundLookup(file),
        () => ({ syncClientId: 'client-1' }) as unknown as SocialArchiverSettings,
      );

      await service.handleRemoteShareState({
        archiveId: 'archive-1',
        sourceClientId: 'other-client',
        changes: { shareUrl: 'https://social-archive.org/share/abc' },
        updatedAt: '2026-06-11T00:00:00.000Z',
        timestamp: Date.now(),
      });

      if (excluded) {
        expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
      } else {
        expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      }
    });
  }
});

describe('CommentStateSyncService — URL fallback (PRD S5.1)', () => {
  for (const { label, mode, excluded } of CASES) {
    it(label, async () => {
      const file = makeFile();
      const app = makeInboundApp(makeFrontmatter(mode));
      const service = new CommentStateSyncService(
        app as unknown as App,
        makeInboundApiClient(),
        makeInboundLookup(file),
        () =>
          ({
            syncClientId: 'client-1',
            enableMobileAnnotationSync: true,
          }) as unknown as SocialArchiverSettings,
      );

      await service.handleRemoteCommentState({
        archiveId: 'archive-1',
        sourceClientId: 'other-client',
        changes: { hasCommentUpdate: true },
        updatedAt: '2026-06-11T00:00:00.000Z',
        timestamp: Date.now(),
      });

      // vault.read happens only after the file resolves — its absence proves
      // the local-only candidate was rejected by resolveFile.
      if (excluded) {
        expect(app.vault.read).not.toHaveBeenCalled();
      } else {
        expect(app.vault.read).toHaveBeenCalledWith(file);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ArchiveDeleteSyncService — inbound trash + outbound server-delete resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe('ArchiveDeleteSyncService — inbound URL fallback (PRD S5.1)', () => {
  for (const { label, mode, excluded } of CASES) {
    it(label, async () => {
      const file = makeFile();
      const trashFile = vi.fn().mockResolvedValue(undefined);
      const settings = {
        deleteSync: { inboundEnabled: true },
      } as unknown as SocialArchiverSettings;

      const service = new ArchiveDeleteSyncService({
        apiClient: () => undefined,
        settings: () => settings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        app: {
          fileManager: { trashFile },
          metadataCache: {
            getFileCache: vi.fn().mockReturnValue({ frontmatter: makeFrontmatter(mode) }),
          },
        } as unknown as App,
        findBySourceArchiveId: vi.fn().mockReturnValue(null),
        findByOriginalUrl: vi.fn().mockReturnValue([file]),
        isLibrarySyncRunning: () => false,
        notify: vi.fn(),
      });

      await service.handleInboundDelete('archive-1', ORIGINAL_URL, 'ws');

      if (excluded) {
        expect(trashFile).not.toHaveBeenCalled();
      } else {
        expect(trashFile).toHaveBeenCalledWith(file);
      }
    });
  }
});

describe('ArchiveDeleteSyncService — outbound identity guard (PRD S5.1)', () => {
  for (const { label, mode, excluded } of CASES) {
    it(label, async () => {
      const apiClient = {
        getUserArchives: vi.fn().mockResolvedValue({ archives: [{ id: 'srv-1' }], hasMore: false }),
        deleteArchive: vi.fn().mockResolvedValue(undefined),
      };
      const settings = {
        authToken: 'token',
        username: 'user',
        deleteSync: { outboundEnabled: true, confirmBeforeServerDelete: false },
        pendingArchiveDeletes: [],
      } as unknown as SocialArchiverSettings;

      const service = new ArchiveDeleteSyncService({
        apiClient: () => apiClient as unknown as WorkersAPIClient,
        settings: () => settings,
        saveSettings: vi.fn().mockResolvedValue(undefined),
        app: {} as unknown as App,
        findBySourceArchiveId: vi.fn().mockReturnValue(null),
        findByOriginalUrl: vi.fn().mockReturnValue([]),
        isLibrarySyncRunning: () => false,
        notify: vi.fn(),
      });

      let onFileDeleted: ((identity: ArchiveFileIdentity) => void) | undefined;
      service.initialize((handler) => {
        onFileDeleted = handler;
        return () => {};
      });
      if (!onFileDeleted) throw new Error('file-deleted handler was not registered');

      const identity: ArchiveFileIdentity = {
        path: 'Social Archives/clip.md',
        originalUrl: ORIGINAL_URL,
        ...(mode !== undefined ? { importMode: mode } : {}),
      };
      onFileDeleted(identity);

      if (excluded) {
        await flushMicrotasks();
        expect(apiClient.getUserArchives).not.toHaveBeenCalled();
        expect(apiClient.deleteArchive).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() => {
          expect(apiClient.deleteArchive).toHaveBeenCalledWith('srv-1');
        });
      }
    });
  }
});
