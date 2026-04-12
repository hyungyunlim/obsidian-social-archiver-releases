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
});
