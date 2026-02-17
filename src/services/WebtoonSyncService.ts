/**
 * WebtoonSyncService
 *
 * Polls the Workers API for pending webtoon posts and syncs them to the vault.
 * This service handles the "offline sync" pattern where:
 * - Workers cron job fetches webtoon episodes on schedule
 * - Posts are stored in KV as pending
 * - Plugin polls and syncs to local vault when online
 *
 * Single Responsibility: Poll pending webtoon posts and archive to local vault
 */

import { Notice, requestUrl } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import type { PostData } from '../types/post';
import { getVaultOrganizationStrategy } from '../types/settings';
import { VaultManager } from './VaultManager';
import { MarkdownConverter } from './MarkdownConverter';
import { MediaHandler, type MediaResult } from './MediaHandler';

// ============================================================================
// Types
// ============================================================================

/**
 * Pending post from Workers API (generic format used by SubscriptionRunner)
 */
export interface PendingPost {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  post: PostData;
  destinationFolder: string;
  archivedAt: string;
}

/**
 * API response for pending posts
 */
interface PendingPostsResponse {
  success: boolean;
  data?: {
    posts: PendingPost[];
    total: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * API response for acknowledge
 */
interface AckResponse {
  success: boolean;
  data?: {
    acknowledged: number;
    remaining: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Sync result for a single poll
 */
export interface SyncResult {
  success: boolean;
  postsArchived: number;
  postsFailed: number;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default polling interval: 15 minutes */
const DEFAULT_POLLING_INTERVAL = 15 * 60 * 1000;

/** Minimum polling interval: 5 minutes */
const MIN_POLLING_INTERVAL = 5 * 60 * 1000;

// ============================================================================
// Service Class
// ============================================================================

export class WebtoonSyncService {
  private plugin: SocialArchiverPlugin;
  private intervalId: number | null = null;
  private pollingInterval: number;
  private isSyncing = false;

  constructor(plugin: SocialArchiverPlugin, pollingInterval = DEFAULT_POLLING_INTERVAL) {
    this.plugin = plugin;
    this.pollingInterval = Math.max(pollingInterval, MIN_POLLING_INTERVAL);
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Start the sync service (called on plugin load)
   */
  start(): void {
    // Guard against duplicate starts
    if (this.intervalId !== null) {
      return;
    }

    // Initial sync after short delay (10 seconds)
    setTimeout(() => { void this.sync(); }, 10000);

    // Set up interval for periodic polling
    this.intervalId = window.setInterval(
      () => { void this.sync(); },
      this.pollingInterval
    );
  }

  /**
   * Stop the sync service (called on plugin unload)
   */
  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Manually trigger a sync (for "Sync Now" button)
   */
  async syncNow(): Promise<SyncResult> {
    const result = await this.sync();

    if (result.postsArchived > 0) {
      new Notice(`Webtoon: Synced ${result.postsArchived} episode(s)`);
    } else if (result.success) {
      new Notice('Webtoon: No new episodes to sync');
    } else {
      new Notice(`Webtoon sync failed: ${result.error || 'Unknown error'}`);
    }

    return result;
  }

  /**
   * Sync pending webtoon posts from Workers API
   */
  async sync(): Promise<SyncResult> {
    if (this.isSyncing) {
      return { success: true, postsArchived: 0, postsFailed: 0 };
    }

    this.isSyncing = true;
    const result: SyncResult = {
      success: false,
      postsArchived: 0,
      postsFailed: 0,
    };

    try {
      // Check if auth token is available
      if (!this.plugin.settings.authToken) {
        result.success = true; // Not an error, just skip
        return result;
      }

      // 1. Fetch pending posts from API
      const pendingResponse = await this.fetchPendingPosts();
      if (!pendingResponse.success || !pendingResponse.data) {
        result.error = pendingResponse.error?.message || 'Failed to fetch pending posts';
        return result;
      }

      // 2. Filter for webtoon posts only
      const webtoonPosts = pendingResponse.data.posts.filter(
        p => p.post.platform === 'naver-webtoon'
      );

      if (webtoonPosts.length === 0) {
        result.success = true;
        return result;
      }

      // 3. Archive each post to vault
      const archivedIds: string[] = [];
      const failedIds: string[] = [];

      for (const pendingPost of webtoonPosts) {
        try {
          await this.archiveWebtoonPost(pendingPost);
          archivedIds.push(pendingPost.id);
          result.postsArchived++;
        } catch (error) {
          console.error(`[WebtoonSync] Failed to archive post ${pendingPost.id}:`, error);
          failedIds.push(pendingPost.id);
          result.postsFailed++;
        }
      }

      // 4. Acknowledge archived posts
      if (archivedIds.length > 0) {
        const ackResponse = await this.acknowledgePosts(archivedIds);
        if (!ackResponse.success) {
          console.warn('[WebtoonSync] Failed to acknowledge some posts:', ackResponse.error);
        }
      }

      result.success = true;

    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      console.error('[WebtoonSync] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }

    return result;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Fetch pending posts from Workers API
   */
  private async fetchPendingPosts(): Promise<PendingPostsResponse> {
    const baseUrl = this.plugin.settings.workerUrl || 'https://api.socialarchiver.com';
    const url = `${baseUrl}/api/subscriptions/pending-posts`;

    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: this.buildHeaders(),
        throw: false,
      });

      if (response.status >= 400) {
        return {
          success: false,
          error: {
            code: 'API_ERROR',
            message: `HTTP ${response.status}`,
          },
        };
      }

      return response.json as PendingPostsResponse;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network request failed',
        },
      };
    }
  }

  /**
   * Acknowledge archived posts
   */
  private async acknowledgePosts(postIds: string[]): Promise<AckResponse> {
    const baseUrl = this.plugin.settings.workerUrl || 'https://api.socialarchiver.com';
    const url = `${baseUrl}/api/subscriptions/pending-posts/ack`;

    try {
      const response = await requestUrl({
        url,
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ postIds }),
        throw: false,
      });

      if (response.status >= 400) {
        return {
          success: false,
          error: {
            code: 'API_ERROR',
            message: `HTTP ${response.status}`,
          },
        };
      }

      return response.json as AckResponse;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network request failed',
        },
      };
    }
  }

  /**
   * Archive a webtoon post to vault
   */
  private async archiveWebtoonPost(pendingPost: PendingPost): Promise<void> {
    const post = pendingPost.post;

    // Create VaultManager and MarkdownConverter instances
    const vaultManager = new VaultManager({
      vault: this.plugin.app.vault,
      basePath: this.plugin.settings.archivePath || 'Social Archives',
      organizationStrategy: getVaultOrganizationStrategy(this.plugin.settings.archiveOrganization),
    });
    vaultManager.initialize();

    const markdownConverter = new MarkdownConverter({
      frontmatterSettings: this.plugin.settings.frontmatter,
    });
    markdownConverter.initialize();

    // Download media if enabled
    let mediaResults: MediaResult[] | undefined;
    if (this.plugin.settings.downloadMedia && post.media?.length) {
      const mediaHandler = new MediaHandler({
        vault: this.plugin.app.vault,
        basePath: this.plugin.settings.archivePath || 'Social Archives',
      });
      mediaHandler.initialize();
      mediaResults = await mediaHandler.downloadMedia(
        post.media,
        post.platform,
        post.id,
        post.author?.handle || 'webtoon'
      );
    }

    // Convert to markdown
    const markdown = markdownConverter.convert(
      post,
      undefined, // No custom template
      mediaResults
    );

    // Save to vault
    await vaultManager.savePost(post, markdown);
  }

  /**
   * Build headers for API requests
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.plugin.settings.authToken) {
      headers['Authorization'] = `Bearer ${this.plugin.settings.authToken}`;
    }

    if (this.plugin.settings.authToken) {
      headers['X-License-Key'] = this.plugin.settings.authToken;
    }

    return headers;
  }
}
