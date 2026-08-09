import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveDeleteSyncService } from '../../../plugin/sync/ArchiveDeleteSyncService';
import type { SocialArchiverSettings } from '../../../types/settings';
import type { DeleteConfirmResult } from '../../../plugin/sync/DeleteConfirmModal';

// Mock showDeleteConfirmModal so tests never open a real Obsidian modal
vi.mock('../../../plugin/sync/DeleteConfirmModal', () => ({
  showDeleteConfirmModal: vi.fn(),
}));

import { showDeleteConfirmModal } from '../../../plugin/sync/DeleteConfirmModal';

const mockShowDeleteConfirmModal = vi.mocked(showDeleteConfirmModal);

/** Default: user confirms deletion */
function confirmDelete(dontAskAgain = false): void {
  mockShowDeleteConfirmModal.mockResolvedValue({
    action: 'delete-on-server',
    dontAskAgain,
  });
}

/** Simulate user choosing "Keep on Server" */
function confirmKeep(dontAskAgain = false): void {
  mockShowDeleteConfirmModal.mockResolvedValue({
    action: 'keep-on-server',
    dontAskAgain,
  });
}

function makeSettings(overrides?: Partial<SocialArchiverSettings>): SocialArchiverSettings {
  return {
    authToken: 'auth-token',
    username: 'test-user',
    deleteSync: {
      outboundEnabled: true,
      inboundEnabled: true,
      confirmBeforeServerDelete: true,
    },
    pendingArchiveDeletes: [],
    ...overrides,
  } as SocialArchiverSettings;
}

function makeArchivesResponse(ids: string[]) {
  return {
    archives: ids.map((id) => ({ id })),
    total: ids.length,
    limit: 50,
    offset: 0,
    hasMore: false,
    serverTime: '2026-04-10T00:00:00.000Z',
  };
}

describe('ArchiveDeleteSyncService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('enqueues deletes during library sync and flushes them once sync is idle', async () => {
    confirmDelete();
    const settings = makeSettings();
    let librarySyncRunning = true;

    const apiClient = {
      deleteArchive: vi.fn().mockResolvedValue({ success: true }),
      getUserArchives: vi.fn(),
    };

    const saveSettings = vi.fn().mockResolvedValue(undefined);

    const service = new ArchiveDeleteSyncService({
      apiClient: () => apiClient as any,
      settings: () => settings,
      saveSettings,
      app: { fileManager: { trashFile: vi.fn() } } as any,
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      isLibrarySyncRunning: () => librarySyncRunning,
      notify: vi.fn(),
    });

    await (service as any).handleOutboundDelete({
      path: 'Social Archives/post.md',
      archiveId: 'archive-123',
      originalUrl: 'https://example.com/post',
    });

    expect(settings.pendingArchiveDeletes).toHaveLength(1);
    expect(settings.pendingArchiveDeletes[0]?.archiveId).toBe('archive-123');
    expect(apiClient.deleteArchive).not.toHaveBeenCalled();

    librarySyncRunning = false;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(apiClient.deleteArchive).toHaveBeenCalledWith('archive-123');
    expect(settings.pendingArchiveDeletes).toHaveLength(0);
  });

  it('resolves archiveId by originalUrl for legacy notes before deleting on the server', async () => {
    confirmDelete();
    const settings = makeSettings();

    const apiClient = {
      deleteArchive: vi.fn().mockResolvedValue({ success: true }),
      getUserArchives: vi.fn().mockResolvedValue(makeArchivesResponse(['archive-from-url'])),
    };

    const service = new ArchiveDeleteSyncService({
      apiClient: () => apiClient as any,
      settings: () => settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      app: { fileManager: { trashFile: vi.fn() } } as any,
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      isLibrarySyncRunning: () => false,
      notify: vi.fn(),
    });

    await (service as any).handleOutboundDelete({
      path: 'Social Archives/legacy-note.md',
      originalUrl: 'https://example.com/legacy-post',
    });

    expect(apiClient.getUserArchives).toHaveBeenCalledWith({
      originalUrl: 'https://example.com/legacy-post',
      limit: 50,
      offset: 0,
    });
    expect(apiClient.deleteArchive).toHaveBeenCalledWith('archive-from-url');
    expect(settings.pendingArchiveDeletes).toHaveLength(0);
  });

  it('skips deletion when originalUrl resolves to multiple server archives to prevent data loss', async () => {
    confirmDelete();
    const settings = makeSettings();

    const apiClient = {
      deleteArchive: vi.fn().mockResolvedValue({ success: true }),
      getUserArchives: vi.fn().mockResolvedValue(
        makeArchivesResponse(['archive-a', 'archive-b']),
      ),
    };

    const service = new ArchiveDeleteSyncService({
      apiClient: () => apiClient as any,
      settings: () => settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      app: { fileManager: { trashFile: vi.fn() } } as any,
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      isLibrarySyncRunning: () => false,
      notify: vi.fn(),
    });

    await (service as any).handleOutboundDelete({
      path: 'Social Archives/legacy-duplicate-note.md',
      originalUrl: 'https://example.com/legacy-duplicate-post',
    });

    expect(apiClient.getUserArchives).toHaveBeenCalledWith({
      originalUrl: 'https://example.com/legacy-duplicate-post',
      limit: 50,
      offset: 0,
    });
    // Should NOT delete when multiple matches found — avoids unintended data loss
    expect(apiClient.deleteArchive).not.toHaveBeenCalled();
    expect(settings.pendingArchiveDeletes).toHaveLength(0);
  });

  it('trashes a directly resolved inbound-deleted file without ArchiveLookupService', async () => {
    const settings = makeSettings({
      deleteSync: { outboundEnabled: true, inboundEnabled: true, confirmBeforeServerDelete: false },
    });
    const file = {
      path: 'Social Archives/Naver/deleted.md',
      basename: 'deleted',
    };
    const trashFile = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();

    const service = new ArchiveDeleteSyncService({
      apiClient: () => ({ deleteArchive: vi.fn(), getUserArchives: vi.fn() }) as any,
      settings: () => settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      app: { fileManager: { trashFile } } as any,
      findBySourceArchiveId: vi.fn().mockReturnValue(null),
      findByOriginalUrl: vi.fn().mockReturnValue([]),
      isLibrarySyncRunning: () => false,
      notify,
    });

    await expect(
      service.handleInboundDeleteFile(file as any, 'archive-deleted', 'delta'),
    ).resolves.toBe(true);

    expect(trashFile).toHaveBeenCalledWith(file);
    expect(notify).toHaveBeenCalledWith(
      'Deleted from vault: "deleted" (deleted on server)',
      4000,
    );
  });

  // ---------------------------------------------------------------------------
  // DeleteConfirmModal integration
  // ---------------------------------------------------------------------------

  describe('confirmBeforeServerDelete', () => {
    function makeServiceWithQueue(settings: SocialArchiverSettings, overrides?: Record<string, unknown>) {
      const apiClient = {
        deleteArchive: vi.fn().mockResolvedValue({ success: true }),
        getUserArchives: vi.fn(),
      };
      const saveSettings = vi.fn().mockResolvedValue(undefined);

      const service = new ArchiveDeleteSyncService({
        apiClient: () => apiClient as any,
        settings: () => settings,
        saveSettings,
        app: { fileManager: { trashFile: vi.fn() } } as any,
        findBySourceArchiveId: vi.fn().mockReturnValue(null),
        findByOriginalUrl: vi.fn().mockReturnValue([]),
        isLibrarySyncRunning: () => false,
        notify: vi.fn(),
        ...overrides,
      });

      return { service, apiClient, saveSettings };
    }

    it('shows confirmation modal and proceeds when user chooses delete-on-server', async () => {
      confirmDelete();
      const settings = makeSettings();
      settings.pendingArchiveDeletes = [
        { archiveId: 'a1', username: 'test-user', queuedAt: '2026-04-10T00:00:00Z', retryCount: 0, originalPath: 'p.md' },
      ];

      const { service, apiClient } = makeServiceWithQueue(settings);
      await service.flushPendingDeletes();

      expect(mockShowDeleteConfirmModal).toHaveBeenCalledOnce();
      expect(mockShowDeleteConfirmModal).toHaveBeenCalledWith(expect.anything(), 1);
      expect(apiClient.deleteArchive).toHaveBeenCalledWith('a1');
      expect(settings.pendingArchiveDeletes).toHaveLength(0);
    });

    it('clears queue without server delete when user chooses keep-on-server', async () => {
      confirmKeep();
      const settings = makeSettings();
      settings.pendingArchiveDeletes = [
        { archiveId: 'a1', username: 'test-user', queuedAt: '2026-04-10T00:00:00Z', retryCount: 0, originalPath: 'p.md' },
        { archiveId: 'a2', username: 'test-user', queuedAt: '2026-04-10T00:01:00Z', retryCount: 0, originalPath: 'q.md' },
      ];

      const { service, apiClient, saveSettings } = makeServiceWithQueue(settings);
      await service.flushPendingDeletes();

      expect(mockShowDeleteConfirmModal).toHaveBeenCalledWith(expect.anything(), 2);
      expect(apiClient.deleteArchive).not.toHaveBeenCalled();
      expect(settings.pendingArchiveDeletes).toHaveLength(0);
      expect(saveSettings).toHaveBeenCalled();
    });

    it('persists confirmBeforeServerDelete=false when dontAskAgain is checked', async () => {
      confirmDelete(/* dontAskAgain */ true);
      const settings = makeSettings();
      settings.pendingArchiveDeletes = [
        { archiveId: 'a1', username: 'test-user', queuedAt: '2026-04-10T00:00:00Z', retryCount: 0, originalPath: 'p.md' },
      ];

      const { service, saveSettings } = makeServiceWithQueue(settings);
      await service.flushPendingDeletes();

      expect(settings.deleteSync.confirmBeforeServerDelete).toBe(false);
      expect(saveSettings).toHaveBeenCalled();
    });

    it('skips confirmation modal when confirmBeforeServerDelete is false', async () => {
      const settings = makeSettings({
        deleteSync: { outboundEnabled: true, inboundEnabled: true, confirmBeforeServerDelete: false },
      });
      settings.pendingArchiveDeletes = [
        { archiveId: 'a1', username: 'test-user', queuedAt: '2026-04-10T00:00:00Z', retryCount: 0, originalPath: 'p.md' },
      ];

      const { service, apiClient } = makeServiceWithQueue(settings);
      await service.flushPendingDeletes();

      expect(mockShowDeleteConfirmModal).not.toHaveBeenCalled();
      expect(apiClient.deleteArchive).toHaveBeenCalledWith('a1');
    });

    it('does not show modal when queue is empty', async () => {
      const settings = makeSettings();

      const { service } = makeServiceWithQueue(settings);
      await service.flushPendingDeletes();

      expect(mockShowDeleteConfirmModal).not.toHaveBeenCalled();
    });
  });

  describe('local-delete tombstones', () => {
    const OUTBOUND_OFF = {
      outboundEnabled: false,
      inboundEnabled: true,
      confirmBeforeServerDelete: true,
    };

    function makeTombstoneService(settings: SocialArchiverSettings) {
      const saveSettings = vi.fn().mockResolvedValue(undefined);
      const apiClient = {
        deleteArchive: vi.fn().mockResolvedValue({ success: true }),
        getUserArchives: vi.fn().mockResolvedValue(makeArchivesResponse([])),
      };
      const service = new ArchiveDeleteSyncService({
        apiClient: () => apiClient as any,
        settings: () => settings,
        saveSettings,
        app: { fileManager: { trashFile: vi.fn() } } as any,
        findBySourceArchiveId: vi.fn().mockReturnValue(null),
        findByOriginalUrl: vi.fn().mockReturnValue([]),
        isLibrarySyncRunning: () => false,
        notify: vi.fn(),
      });
      return { service, saveSettings, apiClient };
    }

    it('records a tombstone when outbound delete is disabled and blocks re-import', async () => {
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      const settings = makeSettings({ deleteSync: OUTBOUND_OFF });
      const { service, saveSettings, apiClient } = makeTombstoneService(settings);

      await (service as any).handleOutboundDelete({
        path: 'Social Archives/post.md',
        archiveId: 'archive-1',
        originalUrl: 'https://example.com/post/1',
      });

      expect(settings.pendingArchiveDeletes).toHaveLength(0);
      expect(apiClient.deleteArchive).not.toHaveBeenCalled();
      expect(saveSettings).toHaveBeenCalled();
      expect(settings.localArchiveDeleteTombstones).toEqual([
        {
          archiveId: 'archive-1',
          originalUrl: 'https://example.com/post/1',
          username: 'test-user',
          deletedAt: '2026-08-01T00:00:00.000Z',
        },
      ]);

      // Older server copy is blocked…
      expect(service.isServerArchiveTombstoned({
        id: 'archive-1',
        originalUrl: 'https://example.com/post/1',
        archivedAt: '2026-07-01T00:00:00.000Z',
      })).toBe(true);
      // …a different archive is not…
      expect(service.isServerArchiveTombstoned({
        id: 'archive-2',
        originalUrl: 'https://example.com/post/2',
        archivedAt: '2026-07-01T00:00:00.000Z',
      })).toBe(false);
      // …and another user's session never matches.
      settings.username = 'someone-else';
      expect(service.isServerArchiveTombstoned({
        id: 'archive-1',
        originalUrl: 'https://example.com/post/1',
        archivedAt: '2026-07-01T00:00:00.000Z',
      })).toBe(false);
    });

    it('lets a newer server re-archive through, and a re-delete re-blocks it', async () => {
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      const settings = makeSettings({ deleteSync: OUTBOUND_OFF });
      const { service } = makeTombstoneService(settings);
      const identity = {
        path: 'Social Archives/post.md',
        archiveId: 'archive-1',
        originalUrl: 'https://example.com/post/1',
      };

      await (service as any).handleOutboundDelete(identity);

      // Deliberate re-archive on another client after the local deletion wins.
      const reArchived = {
        id: 'archive-1',
        originalUrl: 'https://example.com/post/1',
        archivedAt: '2026-08-02T00:00:00.000Z',
      };
      expect(service.isServerArchiveTombstoned(reArchived)).toBe(false);

      // The user deletes the re-imported note again — refreshed deletedAt wins.
      vi.setSystemTime(new Date('2026-08-03T00:00:00.000Z'));
      await (service as any).handleOutboundDelete(identity);
      expect(settings.localArchiveDeleteTombstones).toHaveLength(1);
      expect(service.isServerArchiveTombstoned(reArchived)).toBe(true);
    });

    it('matches URL-only tombstones by URL; id-bound tombstones never swallow a different row', async () => {
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      const settings = makeSettings({ deleteSync: OUTBOUND_OFF });
      const { service } = makeTombstoneService(settings);

      // Legacy note without archiveId → URL-only tombstone.
      await (service as any).handleOutboundDelete({
        path: 'Social Archives/legacy.md',
        originalUrl: 'https://example.com/legacy',
      });
      expect(service.isServerArchiveTombstoned({
        id: 'any-server-id',
        originalUrl: 'https://example.com/legacy',
        archivedAt: '2026-07-01T00:00:00.000Z',
      })).toBe(true);

      // Id-bound tombstone must not match a different server row for the same URL.
      await (service as any).handleOutboundDelete({
        path: 'Social Archives/post.md',
        archiveId: 'archive-1',
        originalUrl: 'https://example.com/post/1',
      });
      expect(service.isServerArchiveTombstoned({
        id: 'archive-9',
        originalUrl: 'https://example.com/post/1',
        archivedAt: '2026-07-01T00:00:00.000Z',
      })).toBe(false);
    });

    it('tombstones cleared entries when the user chooses "Keep on Server"', async () => {
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      confirmKeep();
      const settings = makeSettings();
      const { service, apiClient } = makeTombstoneService(settings);

      await (service as any).handleOutboundDelete({
        path: 'Social Archives/post.md',
        archiveId: 'archive-1',
        originalUrl: 'https://example.com/post/1',
      });

      expect(apiClient.deleteArchive).not.toHaveBeenCalled();
      expect(settings.pendingArchiveDeletes).toHaveLength(0);
      expect(settings.localArchiveDeleteTombstones?.[0]).toMatchObject({
        archiveId: 'archive-1',
        username: 'test-user',
      });
      expect(service.isServerArchiveTombstoned({
        id: 'archive-1',
        originalUrl: 'https://example.com/post/1',
        archivedAt: '2026-07-01T00:00:00.000Z',
      })).toBe(true);
    });

    it('records nothing when the deleted note has neither archiveId nor originalUrl', async () => {
      const settings = makeSettings({ deleteSync: OUTBOUND_OFF });
      const { service, saveSettings } = makeTombstoneService(settings);

      await (service as any).handleOutboundDelete({ path: 'Social Archives/unknown.md' });

      expect(settings.localArchiveDeleteTombstones).toBeUndefined();
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it('caps the tombstone list at 500 entries (FIFO)', async () => {
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      const existing = Array.from({ length: 500 }, (_, i) => ({
        archiveId: `old-${i}`,
        username: 'test-user',
        deletedAt: '2026-01-01T00:00:00.000Z',
      }));
      const settings = makeSettings({
        deleteSync: OUTBOUND_OFF,
        localArchiveDeleteTombstones: existing,
      });
      const { service } = makeTombstoneService(settings);

      await (service as any).handleOutboundDelete({
        path: 'Social Archives/new.md',
        archiveId: 'archive-new',
        originalUrl: 'https://example.com/new',
      });

      const tombstones = settings.localArchiveDeleteTombstones;
      expect(tombstones).toHaveLength(500);
      expect(tombstones[0]?.archiveId).toBe('old-1'); // oldest evicted
      expect(tombstones[499]?.archiveId).toBe('archive-new');
    });
  });
});
