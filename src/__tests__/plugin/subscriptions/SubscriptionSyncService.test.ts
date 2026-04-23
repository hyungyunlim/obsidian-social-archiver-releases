/**
 * SubscriptionSyncService -- unit tests
 *
 * Tests the subscription sync service responsible for pulling pending
 * subscription posts from the server and saving them to vault:
 *
 * 1. Getter returns manager: `syncSubscriptionPosts()` uses the manager
 * 2. Getter returns undefined: returns early without error
 * 3. Manager not initialized: returns early without error
 * 4. Concurrent sync serialization: overlapping calls don't produce duplicates
 * 5. Recovery polling starts and stops cleanly
 * 6. Recovery polling backoff: 5min -> 10min -> 15min on empty results
 * 7. Recovery polling reset: resets to 5min after posts found
 * 8. Double start is no-op: calling startRecoveryPolling() twice doesn't create two timers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  mediaHandlerDownloadMedia: vi.fn(),
  vaultStorageSavePost: vi.fn(),
  vaultManagerGenerateFilePath: vi.fn(),
  cdnIsEphemeral: vi.fn(),
}));

// Mock TimelineView to avoid deep import chain requiring Obsidian Component
vi.mock('../../../views/TimelineView', () => ({
  TimelineView: class MockTimelineView {
    suppressAutoRefresh() {}
    resumeAutoRefresh(_triggerRefresh?: boolean) {}
  },
  VIEW_TYPE_TIMELINE: 'timeline',
}));

vi.mock('../../../services/VaultManager', () => ({
  VaultManager: vi.fn().mockImplementation(() => ({
    generateFilePath: serviceMocks.vaultManagerGenerateFilePath,
  })),
}));

vi.mock('../../../services/VaultStorageService', () => ({
  VaultStorageService: vi.fn().mockImplementation(() => ({
    savePost: serviceMocks.vaultStorageSavePost,
  })),
}));

vi.mock('../../../services/MediaHandler', () => ({
  MediaHandler: vi.fn().mockImplementation(() => ({
    downloadMedia: serviceMocks.mediaHandlerDownloadMedia,
  })),
}));

vi.mock('../../../services/CdnExpiryDetector', () => ({
  CdnExpiryDetector: {
    isEphemeralCdn: serviceMocks.cdnIsEphemeral,
  },
}));

vi.mock('../../../shared/platforms', () => ({
  getPlatformName: vi.fn().mockReturnValue('X'),
}));

import {
  SubscriptionSyncService,
} from '../../../plugin/subscriptions/SubscriptionSyncService';
import type {
  SubscriptionSyncServiceDeps,
} from '../../../plugin/subscriptions/SubscriptionSyncService';

// ---- Mock SubscriptionManager -----------------------------------------------

function makeMockSubscriptionManager(overrides: {
  isInitialized?: boolean;
  syncResult?: { total: number; saved: number; failed?: number };
} = {}) {
  const { isInitialized = true, syncResult = { total: 0, saved: 0, failed: 0 } } = overrides;

  return {
    isInitialized,
    syncPendingPosts: vi.fn().mockResolvedValue(syncResult),
    fetchPendingPosts: vi.fn().mockResolvedValue([]),
    acknowledgePendingPosts: vi.fn().mockResolvedValue(undefined),
  };
}

// ---- Minimal deps builder ---------------------------------------------------

function makeDeps(overrides: Partial<SubscriptionSyncServiceDeps> = {}): SubscriptionSyncServiceDeps {
  return {
    app: {
      workspace: {
        getLeavesOfType: vi.fn().mockReturnValue([]),
      },
      vault: {
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
        adapter: { writeBinary: vi.fn() },
        createFolder: vi.fn(),
        create: vi.fn(),
        process: vi.fn(),
      },
      fileManager: {
        processFrontMatter: vi.fn(),
      },
    } as any,
    settings: () => ({
      archivePath: 'Social Archives',
      mediaPath: 'attachments/social-archives',
      archiveOrganization: 'platform',
      fileNameFormat: 'default',
      downloadMedia: 'images-and-videos',
      downloadAuthorAvatars: false,
      overwriteAuthorAvatar: false,
      includeComments: false,
    } as any),
    subscriptionManager: () => undefined,
    apiClient: () => undefined,
    authorAvatarService: () => undefined,
    archiveCompletionService: undefined,
    refreshTimelineView: vi.fn(),
    ensureFolderExists: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    ...overrides,
  };
}

/**
 * Advance fake timers by `ms` and then flush pending microtasks (resolved
 * promises inside timer callbacks) WITHOUT recursively running additional
 * scheduled timers. This avoids the infinite-loop problem with
 * `vi.runAllTimersAsync()` when the timer callback schedules the next timer.
 */
async function advanceAndFlush(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  // Flush microtasks so that async timer callbacks (the `void this.runRecoveryPollOnce()`)
  // settle. Multiple rounds are needed because the async chain uses chained `.then()`.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function makePendingPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pending-1',
    subscriptionId: 'subscription-1',
    subscriptionName: 'Mobile Sync',
    destinationFolder: 'Social Archives',
    archivedAt: '2026-04-23T00:00:00.000Z',
    post: {
      platform: 'x',
      id: 'post-1',
      url: 'https://x.com/alice/status/1',
      title: 'Post',
      author: {
        name: 'Alice',
        handle: '@alice',
        url: 'https://x.com/alice',
      },
      content: { text: 'hello' },
      media: [
        { type: 'image', url: 'https://cdn.example.com/main.jpg' },
        { type: 'video', url: 'https://video.twimg.com/ext/main.mp4' },
      ],
      metadata: {
        timestamp: '2026-04-23T00:00:00.000Z',
        externalLinkImage: 'https://cdn.example.com/main-link.jpg',
      },
      quotedPost: {
        platform: 'x',
        id: 'quoted-1',
        url: 'https://x.com/bob/status/2',
        author: { name: 'Bob', url: 'https://x.com/bob' },
        content: { text: 'quoted' },
        media: [
          { type: 'video', url: 'https://video.twimg.com/ext/quoted.mp4' },
          { type: 'image', url: 'https://cdn.example.com/quoted.jpg' },
        ],
        metadata: {
          timestamp: '2026-04-22T00:00:00.000Z',
          externalLinkImage: 'https://cdn.example.com/quoted-link.jpg',
        },
      },
      ...overrides,
    },
  } as any;
}

// ---- Tests ------------------------------------------------------------------

describe('SubscriptionSyncService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    serviceMocks.mediaHandlerDownloadMedia.mockReset();
    serviceMocks.mediaHandlerDownloadMedia.mockResolvedValue([]);
    serviceMocks.vaultStorageSavePost.mockReset();
    serviceMocks.vaultStorageSavePost.mockResolvedValue({
      path: 'Social Archives/X/Post.md',
      file: { path: 'Social Archives/X/Post.md' },
    });
    serviceMocks.vaultManagerGenerateFilePath.mockReset();
    serviceMocks.vaultManagerGenerateFilePath.mockReturnValue('Social Archives/X/Post.md');
    serviceMocks.cdnIsEphemeral.mockReset();
    serviceMocks.cdnIsEphemeral.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // 1. Getter returns manager: uses the returned manager for sync
  // --------------------------------------------------------------------------

  describe('syncSubscriptionPosts', () => {
    it('calls syncPendingPosts on the manager returned by getter', async () => {
      const manager = makeMockSubscriptionManager({ syncResult: { total: 2, saved: 2 } });
      const deps = makeDeps({
        subscriptionManager: () => manager as any,
      });

      const service = new SubscriptionSyncService(deps);
      await service.syncSubscriptionPosts('test');

      expect(manager.syncPendingPosts).toHaveBeenCalledOnce();
      // The callback passed to syncPendingPosts should be a function
      expect(typeof manager.syncPendingPosts.mock.calls[0][0]).toBe('function');
    });

    // --------------------------------------------------------------------------
    // 2. Getter returns undefined: returns early without error
    // --------------------------------------------------------------------------

    it('returns early without error when getter returns undefined', async () => {
      const deps = makeDeps({
        subscriptionManager: () => undefined,
      });

      const service = new SubscriptionSyncService(deps);

      // Should not throw and should return empty result
      const result = await service.syncSubscriptionPosts('test');
      expect(result).toEqual({ total: 0, saved: 0, failed: 0 });
    });

    // --------------------------------------------------------------------------
    // 3. Manager not initialized: returns early without error
    // --------------------------------------------------------------------------

    it('returns early without error when manager is not initialized', async () => {
      const manager = makeMockSubscriptionManager({ isInitialized: false });
      const deps = makeDeps({
        subscriptionManager: () => manager as any,
      });

      const service = new SubscriptionSyncService(deps);
      const result = await service.syncSubscriptionPosts('test');

      // syncPendingPosts should NOT have been called
      expect(manager.syncPendingPosts).not.toHaveBeenCalled();
      expect(result).toEqual({ total: 0, saved: 0, failed: 0 });
    });

    // --------------------------------------------------------------------------
    // 4. Concurrent sync serialization
    // --------------------------------------------------------------------------

    it('serializes concurrent sync calls via debounce', async () => {
      const manager = makeMockSubscriptionManager({
        syncResult: { total: 1, saved: 1 },
      });

      // Make syncPendingPosts take some time to simulate concurrent calls
      let syncResolve: (() => void) | undefined;
      const syncPromise = new Promise<void>((resolve) => {
        syncResolve = resolve;
      });

      manager.syncPendingPosts.mockImplementation(() => {
        return syncPromise.then(() => ({ total: 1, saved: 1, failed: 0 }));
      });

      const deps = makeDeps({
        subscriptionManager: () => manager as any,
      });

      const service = new SubscriptionSyncService(deps);

      // Start first sync (will block on the promise)
      const firstSync = service.syncSubscriptionPosts('first');

      // Start second sync while first is in progress -- should schedule debounce
      const secondSync = service.syncSubscriptionPosts('second');

      // Only one call to syncPendingPosts so far (the first one)
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(1);

      // The second call should have returned the empty result immediately
      const secondResult = await secondSync;
      expect(secondResult).toEqual({ total: 0, saved: 0, failed: 0 });

      // Resolve the first sync
      syncResolve!();
      await firstSync;

      // Now the debounced retry should be scheduled (500ms)
      // Reset the mock for the retry with a simpler implementation
      manager.syncPendingPosts.mockResolvedValue({ total: 0, saved: 0, failed: 0 });

      await advanceAndFlush(500);

      // Second call should eventually have been invoked via debounce
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(2);
    });
  });

  describe('saveSubscriptionPostDetailed media download mode', () => {
    it('downloads images but skips videos when settings are images-only', async () => {
      const deps = makeDeps({
        settings: () => ({
          archivePath: 'Social Archives',
          mediaPath: 'attachments/social-archives',
          archiveOrganization: 'platform',
          fileNameFormat: 'default',
          downloadMedia: 'images-only',
          downloadAuthorAvatars: false,
          overwriteAuthorAvatar: false,
          includeComments: false,
        } as any),
        apiClient: () => ({ proxyMedia: vi.fn() } as any),
      });

      const service = new SubscriptionSyncService(deps);
      const result = await service.saveSubscriptionPostDetailed(makePendingPost());

      expect(result.status).toBe('created');
      expect(serviceMocks.mediaHandlerDownloadMedia).toHaveBeenCalledOnce();
      const downloadedMedia = serviceMocks.mediaHandlerDownloadMedia.mock.calls[0][0];
      expect(downloadedMedia).toEqual([
        { type: 'image', url: 'https://cdn.example.com/main.jpg' },
        { type: 'image', url: 'https://cdn.example.com/quoted.jpg' },
        { type: 'image', url: 'https://cdn.example.com/quoted-link.jpg' },
        { type: 'image', url: 'https://cdn.example.com/main-link.jpg' },
      ]);
      expect(downloadedMedia.some((item: { type: string }) => item.type === 'video')).toBe(false);
    });

    it('does not download any post media when settings are text-only', async () => {
      const deps = makeDeps({
        settings: () => ({
          archivePath: 'Social Archives',
          mediaPath: 'attachments/social-archives',
          archiveOrganization: 'platform',
          fileNameFormat: 'default',
          downloadMedia: 'text-only',
          downloadAuthorAvatars: false,
          overwriteAuthorAvatar: false,
          includeComments: false,
        } as any),
        apiClient: () => ({ proxyMedia: vi.fn() } as any),
      });

      const service = new SubscriptionSyncService(deps);
      const result = await service.saveSubscriptionPostDetailed(makePendingPost());

      expect(result.status).toBe('created');
      expect(serviceMocks.mediaHandlerDownloadMedia).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Recovery Polling
  // --------------------------------------------------------------------------

  describe('recovery polling', () => {
    // --------------------------------------------------------------------------
    // 5. Recovery polling starts and stops
    // --------------------------------------------------------------------------

    it('startRecoveryPolling schedules initial poll after RECOVERY_POLL_INITIAL_DELAY', async () => {
      const manager = makeMockSubscriptionManager();
      const deps = makeDeps({
        subscriptionManager: () => manager as any,
      });

      const service = new SubscriptionSyncService(deps);
      service.startRecoveryPolling();

      // No sync call yet (initial delay is 10s)
      expect(manager.syncPendingPosts).not.toHaveBeenCalled();

      // Advance to the initial delay (10_000ms) and flush microtasks
      await advanceAndFlush(10_000);

      // syncPendingPosts should now have been called once
      expect(manager.syncPendingPosts).toHaveBeenCalledOnce();

      // Stop to prevent further polling
      service.stopRecoveryPolling();
    });

    it('stopRecoveryPolling cancels the pending poll timer', async () => {
      const manager = makeMockSubscriptionManager();
      const deps = makeDeps({
        subscriptionManager: () => manager as any,
      });

      const service = new SubscriptionSyncService(deps);
      service.startRecoveryPolling();

      // Stop before the initial delay fires
      service.stopRecoveryPolling();

      // Advance well past the initial delay
      await advanceAndFlush(60_000);

      // syncPendingPosts should never have been called
      expect(manager.syncPendingPosts).not.toHaveBeenCalled();
    });

    // --------------------------------------------------------------------------
    // 6. Recovery polling backoff: 5min -> 10min -> 15min on empty results
    // --------------------------------------------------------------------------

    it('backs off 5min -> 10min -> 15min when no pending posts', async () => {
      const manager = makeMockSubscriptionManager({
        syncResult: { total: 0, saved: 0, failed: 0 },
      });
      const deps = makeDeps({
        subscriptionManager: () => manager as any,
      });

      const service = new SubscriptionSyncService(deps);
      service.startRecoveryPolling();

      // Poll 1: fires after initial delay (10s)
      // After poll 1: interval backs off from 5min to 10min (5 + 5)
      await advanceAndFlush(10_000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(1);

      // Poll 2: fires after 10min (next scheduled interval)
      // After poll 2: interval backs off from 10min to 15min (10 + 5)
      await advanceAndFlush(10 * 60 * 1000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(2);

      // Poll 3: fires after 15min
      // After poll 3: interval stays at 15min (capped at max)
      await advanceAndFlush(15 * 60 * 1000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(3);

      // Poll 4: fires after 15min again (no further backoff)
      await advanceAndFlush(15 * 60 * 1000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(4);

      service.stopRecoveryPolling();
    });

    // --------------------------------------------------------------------------
    // 7. Recovery polling reset: resets to 5min after posts found
    // --------------------------------------------------------------------------

    it('resets interval to 5min when pending posts are found', async () => {
      // Start with empty results to build up backoff
      const manager = makeMockSubscriptionManager({
        syncResult: { total: 0, saved: 0, failed: 0 },
      });
      const deps = makeDeps({
        subscriptionManager: () => manager as any,
      });

      const service = new SubscriptionSyncService(deps);
      service.startRecoveryPolling();

      // Poll 1: initial delay (10s) -> 0 posts -> interval becomes 10min
      await advanceAndFlush(10_000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(1);

      // Poll 2: after 10min -> 0 posts -> interval becomes 15min
      await advanceAndFlush(10 * 60 * 1000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(2);

      // Make next poll return posts found
      manager.syncPendingPosts.mockResolvedValueOnce({ total: 3, saved: 3, failed: 0 });

      // Poll 3: after 15min -> 3 posts found -> interval resets to 5min
      await advanceAndFlush(15 * 60 * 1000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(3);

      // Poll 4: should fire after 5min (the reset interval)
      await advanceAndFlush(5 * 60 * 1000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(4);

      service.stopRecoveryPolling();
    });

    it('resets interval to 5min on sync error', async () => {
      const manager = makeMockSubscriptionManager({
        syncResult: { total: 0, saved: 0, failed: 0 },
      });
      const deps = makeDeps({
        subscriptionManager: () => manager as any,
      });

      const service = new SubscriptionSyncService(deps);
      service.startRecoveryPolling();

      // Poll 1: initial delay, 0 posts -> interval becomes 10min
      await advanceAndFlush(10_000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(1);

      // Poll 2: after 10min, also empty -> interval becomes 15min
      await advanceAndFlush(10 * 60 * 1000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(2);

      // Make next poll throw an error
      manager.syncPendingPosts.mockRejectedValueOnce(new Error('Network error'));

      // Poll 3: after 15min, throws error -> interval resets to 5min
      await advanceAndFlush(15 * 60 * 1000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(3);

      // Poll 4: should fire after 5min (reset due to error)
      manager.syncPendingPosts.mockResolvedValue({ total: 0, saved: 0, failed: 0 });
      await advanceAndFlush(5 * 60 * 1000);
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(4);

      service.stopRecoveryPolling();
    });

    // --------------------------------------------------------------------------
    // 8. Double start is no-op
    // --------------------------------------------------------------------------

    it('calling startRecoveryPolling twice does not create two timers', async () => {
      const manager = makeMockSubscriptionManager({
        syncResult: { total: 0, saved: 0, failed: 0 },
      });
      const deps = makeDeps({
        subscriptionManager: () => manager as any,
      });

      const service = new SubscriptionSyncService(deps);

      // Start twice
      service.startRecoveryPolling();
      service.startRecoveryPolling();

      // Advance past the initial delay
      await advanceAndFlush(10_000);

      // Only ONE poll should have fired (no duplicate timer)
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(1);

      service.stopRecoveryPolling();
    });

    // --------------------------------------------------------------------------
    // Additional: manager not ready during recovery poll
    // --------------------------------------------------------------------------

    it('returns empty result when manager is not ready during recovery poll', async () => {
      let managerReady = false;
      const manager = makeMockSubscriptionManager({
        syncResult: { total: 0, saved: 0, failed: 0 },
      });

      const deps = makeDeps({
        subscriptionManager: () => {
          if (!managerReady) return undefined;
          return manager as any;
        },
      });

      const service = new SubscriptionSyncService(deps);
      service.startRecoveryPolling();

      // Poll 1: initial delay (10s) - manager not ready, syncSubscriptionPosts returns early
      await advanceAndFlush(10_000);
      // syncPendingPosts on the manager should NOT have been called (manager was undefined)
      expect(manager.syncPendingPosts).not.toHaveBeenCalled();

      // Make manager ready
      managerReady = true;

      // The poll returned empty (manager not ready) so next poll is scheduled
      // with backed-off interval (10min).
      // Advance past that interval.
      await advanceAndFlush(10 * 60 * 1000);

      // Now it should have called syncPendingPosts since manager is ready
      expect(manager.syncPendingPosts).toHaveBeenCalledTimes(1);

      service.stopRecoveryPolling();
    });
  });
});
