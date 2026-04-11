import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveDeleteSyncService } from '../../../plugin/sync/ArchiveDeleteSyncService';
import type { SocialArchiverSettings } from '../../../types/settings';

function makeSettings(): SocialArchiverSettings {
  return {
    authToken: 'auth-token',
    username: 'test-user',
    deleteSync: {
      outboundEnabled: true,
      inboundEnabled: true,
      confirmBeforeServerDelete: true,
    },
    pendingArchiveDeletes: [],
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

  it('deletes all matching legacy server archives when originalUrl resolves to duplicates', async () => {
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
    expect(apiClient.deleteArchive).toHaveBeenCalledTimes(2);
    expect(apiClient.deleteArchive).toHaveBeenNthCalledWith(1, 'archive-a');
    expect(apiClient.deleteArchive).toHaveBeenNthCalledWith(2, 'archive-b');
    expect(settings.pendingArchiveDeletes).toHaveLength(0);
  });
});
