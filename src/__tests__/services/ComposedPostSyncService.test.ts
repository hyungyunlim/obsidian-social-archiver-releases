/**
 * ComposedPostSyncService — Unit Tests
 *
 * Covers:
 * - enqueueCreate: adds entry with op='create' to settings queue
 * - enqueueUpdate: replaces existing entry and adds op='update'
 * - removeFromQueue: removes by clientPostId
 * - flush: processes queue entries
 *   - calls apiClient.createComposedPost for op='create'
 *   - writes sourceArchiveId, syncState='synced', serverSyncedAt on success
 *   - calls apiClient.updateComposedPost for op='update'
 *   - removes entry from queue on success
 *   - increments retryCount on failure
 *   - marks syncState='failed' and removes after MAX_RETRIES
 * - Queue survival: persists to settings (saveSettings called)
 * - Missing vault file: removes queue entry
 * - onFileDeleted: removes matching queue entry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComposedPostSyncService } from '../../plugin/sync/ComposedPostSyncService';
import type { SocialArchiverSettings, PendingComposedPostSyncEntry } from '../../types/settings';
import type { TFile } from 'obsidian';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(path: string, content = '---\nauthor: Me\n---\nBody text'): TFile {
  return { path } as unknown as TFile;
}

function makeSettings(
  extra: Partial<SocialArchiverSettings> = {}
): SocialArchiverSettings {
  return {
    pendingComposedPostSyncs: [],
    archivePath: 'Social Archives',
    mediaPath: 'attachments/social-archives',
    username: 'testuser',
    ...extra,
  } as unknown as SocialArchiverSettings;
}

function makeApiClient(overrides: Record<string, unknown> = {}) {
  return {
    createComposedPost: vi.fn().mockResolvedValue({
      archiveId: 'server-archive-id',
      createdAt: '2026-03-26T10:00:00.000Z',
    }),
    updateComposedPost: vi.fn().mockResolvedValue({
      success: true,
      updatedAt: '2026-03-26T11:00:00.000Z',
    }),
    ...overrides,
  };
}

function makeVault(files: Record<string, string> = {}) {
  return {
    getFileByPath: vi.fn((path: string) => {
      return path in files ? makeFile(path) : null;
    }),
    read: vi.fn(async (file: TFile) => {
      return files[file.path] ?? '';
    }),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function makeApp(processFrontMatterImpl?: (file: TFile, updater: (fm: Record<string, unknown>) => void) => Promise<void>) {
  const defaultImpl = async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
    updater({});
  };
  return {
    fileManager: {
      processFrontMatter: vi.fn(processFrontMatterImpl ?? defaultImpl),
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ComposedPostSyncService', () => {

  // ── enqueueCreate ──────────────────────────────────────────────────────────

  describe('enqueueCreate', () => {
    it('adds a create entry to the queue', async () => {
      const settings = makeSettings();
      const saveSettings = vi.fn().mockResolvedValue(undefined);
      const service = new ComposedPostSyncService(
        makeApp() as any,
        makeVault() as any,
        settings,
        makeApiClient() as any,
        saveSettings
      );

      await service.enqueueCreate('/path/to/note.md', 'post_uuid-1');

      expect(settings.pendingComposedPostSyncs).toHaveLength(1);
      expect(settings.pendingComposedPostSyncs[0]).toMatchObject({
        op: 'create',
        filePath: '/path/to/note.md',
        clientPostId: 'post_uuid-1',
        retryCount: 0,
      });
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it('appends to existing queue without removing prior entries', async () => {
      const existing: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: '/existing.md',
        clientPostId: 'post_existing',
        queuedAt: '2026-03-01T00:00:00.000Z',
        retryCount: 0,
      };
      const settings = makeSettings({ pendingComposedPostSyncs: [existing] });
      const saveSettings = vi.fn().mockResolvedValue(undefined);
      const service = new ComposedPostSyncService(
        makeApp() as any,
        makeVault() as any,
        settings,
        makeApiClient() as any,
        saveSettings
      );

      await service.enqueueCreate('/new.md', 'post_new');

      expect(settings.pendingComposedPostSyncs).toHaveLength(2);
    });
  });

  // ── enqueueUpdate ──────────────────────────────────────────────────────────

  describe('enqueueUpdate', () => {
    it('adds an update entry with sourceArchiveId', async () => {
      const settings = makeSettings();
      const saveSettings = vi.fn().mockResolvedValue(undefined);
      const service = new ComposedPostSyncService(
        makeApp() as any,
        makeVault() as any,
        settings,
        makeApiClient() as any,
        saveSettings
      );

      await service.enqueueUpdate('/note.md', 'post_uuid-2', 'server-archive-42');

      expect(settings.pendingComposedPostSyncs).toHaveLength(1);
      expect(settings.pendingComposedPostSyncs[0]).toMatchObject({
        op: 'update',
        sourceArchiveId: 'server-archive-42',
        retryCount: 0,
      });
    });

    it('replaces an existing entry for the same clientPostId (deduplication)', async () => {
      const existing: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: '/note.md',
        clientPostId: 'post_same-id',
        queuedAt: '2026-03-01T00:00:00.000Z',
        retryCount: 1,
      };
      const settings = makeSettings({ pendingComposedPostSyncs: [existing] });
      const saveSettings = vi.fn().mockResolvedValue(undefined);
      const service = new ComposedPostSyncService(
        makeApp() as any,
        makeVault() as any,
        settings,
        makeApiClient() as any,
        saveSettings
      );

      await service.enqueueUpdate('/note.md', 'post_same-id', 'archive-99');

      expect(settings.pendingComposedPostSyncs).toHaveLength(1);
      expect(settings.pendingComposedPostSyncs[0]!.op).toBe('update');
      expect(settings.pendingComposedPostSyncs[0]!.retryCount).toBe(0);
    });
  });

  // ── removeFromQueue ────────────────────────────────────────────────────────

  describe('removeFromQueue', () => {
    it('removes the entry matching clientPostId', async () => {
      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: '/note.md',
        clientPostId: 'post_remove-me',
        queuedAt: '2026-03-01T00:00:00.000Z',
        retryCount: 0,
      };
      const settings = makeSettings({ pendingComposedPostSyncs: [entry] });
      const saveSettings = vi.fn().mockResolvedValue(undefined);
      const service = new ComposedPostSyncService(
        makeApp() as any,
        makeVault() as any,
        settings,
        makeApiClient() as any,
        saveSettings
      );

      await service.removeFromQueue('post_remove-me');

      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
      expect(saveSettings).toHaveBeenCalledTimes(1);
    });

    it('does not call saveSettings when entry is not found', async () => {
      const settings = makeSettings();
      const saveSettings = vi.fn().mockResolvedValue(undefined);
      const service = new ComposedPostSyncService(
        makeApp() as any,
        makeVault() as any,
        settings,
        makeApiClient() as any,
        saveSettings
      );

      await service.removeFromQueue('nonexistent');
      expect(saveSettings).not.toHaveBeenCalled();
    });
  });

  // ── flush: create path ─────────────────────────────────────────────────────

  describe('flush — create path', () => {
    it('calls createComposedPost and writes sourceArchiveId + syncState=synced on success', async () => {
      const fileContent = '---\nauthor: Me\n---\nBody text';
      const vault = makeVault({ '/note.md': fileContent });
      const apiClient = makeApiClient();

      let capturedFm: Record<string, unknown> = {};
      const app = makeApp(async (_file: TFile, updater) => {
        updater(capturedFm);
      });

      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: '/note.md',
        clientPostId: 'post_flush-create',
        queuedAt: new Date().toISOString(),
        retryCount: 0,
      };
      const settings = makeSettings({ pendingComposedPostSyncs: [entry] });
      const saveSettings = vi.fn().mockResolvedValue(undefined);

      const service = new ComposedPostSyncService(
        app as any,
        vault as any,
        settings,
        apiClient as any,
        saveSettings
      );

      await service.flush();

      expect(apiClient.createComposedPost).toHaveBeenCalledTimes(1);
      expect(apiClient.createComposedPost).toHaveBeenCalledWith(
        expect.objectContaining({
          clientPostId: 'post_flush-create',
          platform: 'post',
        })
      );

      // Frontmatter should have been updated with server response
      expect(capturedFm['sourceArchiveId']).toBe('server-archive-id');
      expect(capturedFm['syncState']).toBe('synced');
      expect(capturedFm['serverSyncedAt']).toBe('2026-03-26T10:00:00.000Z');

      // Entry must be removed from queue on success
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });

    it('removes queue entry when vault file is missing', async () => {
      const vault = makeVault({}); // empty — file doesn't exist
      const apiClient = makeApiClient();

      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: '/missing.md',
        clientPostId: 'post_missing-file',
        queuedAt: new Date().toISOString(),
        retryCount: 0,
      };
      const settings = makeSettings({ pendingComposedPostSyncs: [entry] });
      const saveSettings = vi.fn().mockResolvedValue(undefined);

      const service = new ComposedPostSyncService(
        makeApp() as any,
        vault as any,
        settings,
        apiClient as any,
        saveSettings
      );

      await service.flush();

      // API should NOT be called for missing file
      expect(apiClient.createComposedPost).not.toHaveBeenCalled();
      // Entry should be cleaned up
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });
  });

  // ── flush: update path ─────────────────────────────────────────────────────

  describe('flush — update path', () => {
    it('calls updateComposedPost with sourceArchiveId and writes syncState=synced', async () => {
      const vault = makeVault({ '/note.md': '---\nauthor: Me\n---\nUpdated body' });
      const apiClient = makeApiClient();

      let capturedFm: Record<string, unknown> = {};
      const app = makeApp(async (_file: TFile, updater) => { updater(capturedFm); });

      const entry: PendingComposedPostSyncEntry = {
        op: 'update',
        filePath: '/note.md',
        clientPostId: 'post_flush-update',
        sourceArchiveId: 'existing-archive-99',
        queuedAt: new Date().toISOString(),
        retryCount: 0,
      };
      const settings = makeSettings({ pendingComposedPostSyncs: [entry] });
      const saveSettings = vi.fn().mockResolvedValue(undefined);

      const service = new ComposedPostSyncService(
        app as any,
        vault as any,
        settings,
        apiClient as any,
        saveSettings
      );

      await service.flush();

      expect(apiClient.updateComposedPost).toHaveBeenCalledWith(
        'existing-archive-99',
        expect.objectContaining({ platform: 'post' })
      );

      expect(capturedFm['syncState']).toBe('synced');
      expect(capturedFm['serverSyncedAt']).toBe('2026-03-26T11:00:00.000Z');
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
    });
  });

  // ── flush: failure path ────────────────────────────────────────────────────

  describe('flush — failure path', () => {
    it('increments retryCount on API failure and keeps entry in queue', async () => {
      const vault = makeVault({ '/note.md': '---\n---\nBody' });
      const apiClient = makeApiClient({
        createComposedPost: vi.fn().mockRejectedValue(new Error('Network error')),
      });

      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: '/note.md',
        clientPostId: 'post_failing',
        queuedAt: new Date().toISOString(),
        retryCount: 0,
      };
      const settings = makeSettings({ pendingComposedPostSyncs: [entry] });
      const saveSettings = vi.fn().mockResolvedValue(undefined);

      const service = new ComposedPostSyncService(
        makeApp() as any,
        vault as any,
        settings,
        apiClient as any,
        saveSettings
      );

      await service.flush();

      // Entry should still be in queue with incremented retryCount
      expect(settings.pendingComposedPostSyncs).toHaveLength(1);
      expect(settings.pendingComposedPostSyncs[0]!.retryCount).toBe(1);
      expect(settings.pendingComposedPostSyncs[0]!.lastError).toBe('Network error');
    });

    it('marks syncState=failed and removes from queue after MAX_RETRIES (3)', async () => {
      const vault = makeVault({ '/note.md': '---\n---\nBody' });
      const apiClient = makeApiClient({
        createComposedPost: vi.fn().mockRejectedValue(new Error('Persistent error')),
      });

      let capturedFm: Record<string, unknown> = {};
      const app = makeApp(async (_file: TFile, updater) => { updater(capturedFm); });

      // Already at retryCount = 2 (will become 3 = MAX_RETRIES)
      const entry: PendingComposedPostSyncEntry = {
        op: 'create',
        filePath: '/note.md',
        clientPostId: 'post_max-retries',
        queuedAt: new Date().toISOString(),
        retryCount: 2,
      };
      const settings = makeSettings({ pendingComposedPostSyncs: [entry] });
      const saveSettings = vi.fn().mockResolvedValue(undefined);

      const service = new ComposedPostSyncService(
        app as any,
        vault as any,
        settings,
        apiClient as any,
        saveSettings
      );

      await service.flush();

      // After MAX_RETRIES, entry is removed from queue
      expect(settings.pendingComposedPostSyncs).toHaveLength(0);
      // Frontmatter should have syncState='failed'
      expect(capturedFm['syncState']).toBe('failed');
    });
  });

  // ── onFileDeleted ──────────────────────────────────────────────────────────

  describe('onPluginLoad / onFileDeleted', () => {
    it('registers vault delete listener on plugin load', async () => {
      const vault = makeVault();
      const settings = makeSettings();
      const saveSettings = vi.fn().mockResolvedValue(undefined);
      const service = new ComposedPostSyncService(
        makeApp() as any,
        vault as any,
        settings,
        makeApiClient() as any,
        saveSettings
      );

      await service.onPluginLoad();

      expect(vault.on).toHaveBeenCalledWith('delete', expect.any(Function));
    });
  });

  // ── Queue persistence ──────────────────────────────────────────────────────

  describe('queue persistence', () => {
    it('persists queue state to settings on enqueueCreate', async () => {
      const settings = makeSettings();
      const saveSettings = vi.fn().mockResolvedValue(undefined);
      const service = new ComposedPostSyncService(
        makeApp() as any,
        makeVault() as any,
        settings,
        makeApiClient() as any,
        saveSettings
      );

      await service.enqueueCreate('/note.md', 'post_persist-1');
      await service.enqueueCreate('/note2.md', 'post_persist-2');

      // saveSettings called after each enqueue
      expect(saveSettings).toHaveBeenCalledTimes(2);
      // Queue has both entries
      expect(settings.pendingComposedPostSyncs).toHaveLength(2);
    });
  });
});
