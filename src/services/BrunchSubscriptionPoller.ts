/**
 * BrunchSubscriptionPoller
 *
 * Polls Brunch subscriptions locally from the Plugin.
 * Uses RSS feeds to discover new posts and archives them.
 *
 * Hybrid approach:
 * - Plugin performs local fetch (using BrunchLocalService)
 * - Worker manages state and dedup data
 *
 * Single Responsibility: Poll Brunch subscriptions and archive new posts locally
 */

import { Notice, requestUrl } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import {
  BrunchLocalService,
  BrunchError,
} from './BrunchLocalService';
import type { Subscription } from './SubscriptionManager';
import { VaultManager } from './VaultManager';
import { MarkdownConverter } from './MarkdownConverter';
import type { PostData } from '../types/post';
import type { BrunchPostData } from '@/types/brunch';
import { getVaultOrganizationStrategy } from '../types/settings';

// ============================================================================
// Types
// ============================================================================

export interface BrunchPollResult {
  subscriptionId: string;
  success: boolean;
  postsArchived: number;
  error?: string;
}

interface DedupCheckRequest {
  posts: Array<{
    id: string;
    textHash: string;
  }>;
}

interface DedupCheckResponse {
  success: boolean;
  data?: {
    duplicates: string[];
    new: string[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface UpdateStateRequest {
  cursor?: string;
  lastRunAt?: string;
  archivedPostIds?: string[];
  archivedPostHashes?: string[];
  postsArchived?: number;
  creditsUsed?: number;
}

interface UpdateStateResponse {
  success: boolean;
  subscription?: Subscription;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Pending notification from Worker (hybrid architecture)
 * Worker detects new posts via RSS, Plugin fetches full content
 */
export interface PendingNotification {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  userId: string;
  platform: 'brunch' | 'naver' | 'naver-cafe';
  postUrl: string;
  postId: string;
  title: string;
  publishedAt: string;
  detectedAt: string;
  authorName?: string;
  thumbnail?: string;
  status: 'pending' | 'fetched' | 'failed';
}

interface PendingNotificationsResponse {
  success: boolean;
  data?: {
    notifications: PendingNotification[];
    total: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface AckNotificationsResponse {
  success: boolean;
  data?: {
    acknowledged: string[];
    failed: string[];
    total: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// RSS Cache Types
// ============================================================================

export interface BrunchRSSCacheEntry {
  userId: string;
  etag?: string;
  lastModified?: string;
  cachedAt: number;
}

interface RSSCacheStorage {
  version: number;
  entries: Record<string, BrunchRSSCacheEntry>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_POLLING_INTERVAL = 60 * 60 * 1000; // 1 hour
const RSS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RSS_CACHE_MAX_ENTRIES = 100;
const RSS_CACHE_STORAGE_KEY = 'brunchRssCache';
const MIN_INTERVAL_HOURS = 1;

// ============================================================================
// Service Class
// ============================================================================

export class BrunchSubscriptionPoller {
  private plugin: SocialArchiverPlugin;
  private intervalId: number | null = null;
  private initialDelayId: number | null = null;
  private pollingInterval: number;
  private isPolling = false;
  private rssCache: Map<string, BrunchRSSCacheEntry> = new Map();
  private brunchService: BrunchLocalService;
  private isProcessingNotifications = false;

  constructor(plugin: SocialArchiverPlugin, pollingInterval = DEFAULT_POLLING_INTERVAL) {
    this.plugin = plugin;
    this.pollingInterval = pollingInterval;
    this.brunchService = new BrunchLocalService();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  async start(): Promise<void> {
    if (this.intervalId !== null) {
      return;
    }

    await this.loadRSSCache();

    // Process pending notifications first (hybrid architecture)
    // These are posts detected by Worker while Obsidian was inactive
    this.initialDelayId = window.setTimeout(async () => {
      this.initialDelayId = null;
      await this.processPendingNotifications();
      await this.pollAll();
    }, 5000);

    this.intervalId = window.setInterval(
      async () => {
        await this.processPendingNotifications();
        await this.pollAll();
      },
      this.pollingInterval
    );
  }

  async stop(): Promise<void> {
    if (this.initialDelayId !== null) {
      window.clearTimeout(this.initialDelayId);
      this.initialDelayId = null;
    }

    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    await this.saveRSSCache();
  }

  async pollAll(): Promise<BrunchPollResult[]> {
    if (this.isPolling) {
      return [];
    }

    this.isPolling = true;
    const results: BrunchPollResult[] = [];

    try {
      const subscriptionManager = this.plugin.subscriptionManager;
      if (!subscriptionManager) {
        return results;
      }

      // Get Brunch subscriptions with localFetchRequired (via brunchOptions)
      const allSubscriptions = subscriptionManager.getSubscriptions();
      const brunchSubscriptions = allSubscriptions.filter(
        (sub: Subscription) => sub.platform === 'brunch' && sub.enabled
      );

      if (brunchSubscriptions.length === 0) {
        return results;
      }

      for (const subscription of brunchSubscriptions) {
        // Check if enough time has passed since last run
        if (subscription.state.lastRunAt) {
          const hoursSinceLastRun =
            (Date.now() - new Date(subscription.state.lastRunAt).getTime()) / (1000 * 60 * 60);
          if (hoursSinceLastRun < MIN_INTERVAL_HOURS) {
            continue;
          }
        }

        try {
          const result = await this.pollSubscription(subscription);
          results.push(result);
        } catch (error) {
          console.error('[BrunchSubscriptionPoller] Poll failed:', {
            subscriptionId: subscription.id,
            error,
          });
          results.push({
            subscriptionId: subscription.id,
            success: false,
            postsArchived: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        // Rate limit: 2 seconds between subscriptions
        await new Promise((r) => setTimeout(r, 2000));
      }

      return results;
    } finally {
      this.isPolling = false;
    }
  }

  async pollSubscription(subscription: Subscription): Promise<BrunchPollResult> {
    const { id: subscriptionId, target, state } = subscription;
    const handle = target.handle;
    const cursor = state.cursor;

    // Parse handle to get username and userId
    const parts = handle.split(':');
    const username = parts[0] || handle;
    let userId = parts[1];

    // Discover userId if not available
    if (!userId) {
      userId = (await this.brunchService.discoverUserId(username)) || undefined;
      if (!userId) {
        return {
          subscriptionId,
          success: false,
          postsArchived: 0,
          error: 'Could not discover Brunch userId for RSS',
        };
      }

      // Update subscription with discovered userId
      await this.updateSubscriptionState(subscriptionId, {
        // Store userId in identifier for future use
      });
    }

    try {
      // Fetch posts using BrunchLocalService
      const result = await this.brunchService.fetchMemberPosts(userId, username, {
        cursor: cursor || undefined,
        limit: 10,
        backfillDays: 7,
      });

      if (result.posts.length === 0) {
        // Update lastRunAt even if no new posts
        await this.updateSubscriptionState(subscriptionId, {
          lastRunAt: new Date().toISOString(),
        });

        return {
          subscriptionId,
          success: true,
          postsArchived: 0,
        };
      }

      // Check for duplicates via Worker
      const duplicateIds = await this.checkDuplicates(subscriptionId, result.posts);
      const newPosts = result.posts.filter((post) => !duplicateIds.has(post.id));

      if (newPosts.length === 0) {
        await this.updateSubscriptionState(subscriptionId, {
          cursor: result.nextCursor || undefined,
          lastRunAt: new Date().toISOString(),
        });

        return {
          subscriptionId,
          success: true,
          postsArchived: 0,
        };
      }

      // Archive new posts
      let archivedCount = 0;
      const archivedIds: string[] = [];
      const archivedHashes: string[] = [];

      for (const post of newPosts) {
        try {
          await this.archivePost(post, subscription);
          archivedCount++;
          archivedIds.push(post.id);
          archivedHashes.push(this.hashContent(post.text));
        } catch (error) {
          console.error('[BrunchSubscriptionPoller] Archive failed:', {
            postId: post.id,
            error,
          });
        }
      }

      // Update subscription state
      await this.updateSubscriptionState(subscriptionId, {
        cursor: result.nextCursor || undefined,
        lastRunAt: new Date().toISOString(),
        archivedPostIds: archivedIds,
        archivedPostHashes: archivedHashes,
        postsArchived: archivedCount,
        creditsUsed: 0, // Local fetch = no credits
      });

      // Show notification
      if (archivedCount > 0) {
        new Notice(`Brunch: Archived ${archivedCount} new post(s) from @${username}`);
      }

      return {
        subscriptionId,
        success: true,
        postsArchived: archivedCount,
      };
    } catch (error) {
      if (error instanceof BrunchError) {
        return {
          subscriptionId,
          success: false,
          postsArchived: 0,
          error: error.message,
        };
      }
      throw error;
    }
  }

  // ==========================================================================
  // Pending Notifications (Hybrid Architecture)
  // ==========================================================================

  /**
   * Fetch pending notifications from Worker
   * Worker detects new posts via RSS and stores lightweight notifications
   */
  async fetchPendingNotifications(): Promise<PendingNotification[]> {
    try {
      const workerUrl = this.plugin.settings.workerUrl;
      const authToken = this.plugin.settings.authToken;

      if (!workerUrl || !authToken) {
        return [];
      }

      const response = await requestUrl({
        url: `${workerUrl}/api/subscriptions/pending-notifications`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      const data = response.json as PendingNotificationsResponse;
      if (data.success && data.data?.notifications) {
        return data.data.notifications.filter(n => n.platform === 'brunch');
      }

      return [];
    } catch (error) {
      console.warn('[BrunchSubscriptionPoller] Failed to fetch pending notifications:', error);
      return [];
    }
  }

  /**
   * Acknowledge processed notifications
   */
  async ackPendingNotifications(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) return;

    try {
      const workerUrl = this.plugin.settings.workerUrl;
      const authToken = this.plugin.settings.authToken;

      if (!workerUrl || !authToken) {
        return;
      }

      await requestUrl({
        url: `${workerUrl}/api/subscriptions/pending-notifications/ack`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ notificationIds }),
      });
    } catch (error) {
      console.warn('[BrunchSubscriptionPoller] Failed to ack notifications:', error);
    }
  }

  /**
   * Process pending notifications from Worker
   * Fetches full content for each notification and archives
   */
  async processPendingNotifications(): Promise<number> {
    if (this.isProcessingNotifications) {
      return 0;
    }

    this.isProcessingNotifications = true;
    let processedCount = 0;

    try {
      const notifications = await this.fetchPendingNotifications();
      if (notifications.length === 0) {
        return 0;
      }

      console.debug(`[BrunchSubscriptionPoller] Processing ${notifications.length} pending notifications`);

      const processedIds: string[] = [];

      for (const notification of notifications) {
        try {
          // Get subscription for this notification
          const subscriptionManager = this.plugin.subscriptionManager;
          if (!subscriptionManager) continue;

          const subscription = subscriptionManager.getSubscriptions().find(
            (s: Subscription) => s.id === notification.subscriptionId
          );

          if (!subscription) {
            console.warn(`[BrunchSubscriptionPoller] Subscription not found: ${notification.subscriptionId}`);
            processedIds.push(notification.id);
            continue;
          }

          // Extract username and postId from URL
          const urlMatch = notification.postUrl.match(/brunch\.co\.kr\/@([^/]+)\/(\d+)/);
          if (!urlMatch) {
            console.warn(`[BrunchSubscriptionPoller] Invalid post URL: ${notification.postUrl}`);
            processedIds.push(notification.id);
            continue;
          }

          // Fetch full post content using the notification URL
          const post = await this.brunchService.fetchPost(notification.postUrl);

          // Archive the post
          await this.archivePost(post, subscription);
          processedCount++;
          processedIds.push(notification.id);

          // Update subscription state
          await this.updateSubscriptionState(subscription.id, {
            archivedPostIds: [post.id],
            archivedPostHashes: [this.hashContent(post.text)],
            postsArchived: 1,
            creditsUsed: 0,
          });

          // Rate limit between posts
          await new Promise((r) => setTimeout(r, 1000));
        } catch (error) {
          console.error('[BrunchSubscriptionPoller] Failed to process notification:', {
            notificationId: notification.id,
            error,
          });
          // Mark as processed to avoid infinite retries
          processedIds.push(notification.id);
        }
      }

      // Acknowledge all processed notifications
      await this.ackPendingNotifications(processedIds);

      if (processedCount > 0) {
        new Notice(`Brunch: Archived ${processedCount} post(s) from pending notifications`);
      }

      return processedCount;
    } finally {
      this.isProcessingNotifications = false;
    }
  }

  // ==========================================================================
  // Archive Helper
  // ==========================================================================

  private async archivePost(
    brunchPost: BrunchPostData,
    subscription: Subscription
  ): Promise<void> {
    // Convert BrunchPostData to PostData format
    const postData: PostData = {
      platform: 'brunch',
      id: brunchPost.id,
      url: brunchPost.url,
      author: {
        name: brunchPost.author.name,
        url: brunchPost.author.url,
        avatar: brunchPost.author.avatar,
      },
      content: {
        text: brunchPost.text,
        html: brunchPost.contentHtml,
      },
      title: brunchPost.title,
      metadata: {
        timestamp: brunchPost.timestamp.toISOString(),
        likes: brunchPost.likes,
        comments: brunchPost.commentCount,
      },
      media: brunchPost.media.map((m) => ({
        type: m.type === 'photo' ? 'image' : 'video',
        url: m.url,
      })),
    };

    // Generate markdown
    const markdownConverter = new MarkdownConverter({
      frontmatterSettings: this.plugin.settings.frontmatter,
    });
    const markdown = await markdownConverter.convert(postData);

    // Save to vault
    const vaultManager = new VaultManager({
      vault: this.plugin.app.vault,
      basePath: this.plugin.settings.archivePath,
      organizationStrategy: getVaultOrganizationStrategy(this.plugin.settings.archiveOrganization),
    });
    await vaultManager.savePost(postData, markdown);
  }

  // ==========================================================================
  // Dedup & State Management
  // ==========================================================================

  private async checkDuplicates(
    subscriptionId: string,
    posts: BrunchPostData[]
  ): Promise<Set<string>> {
    const duplicates = new Set<string>();

    try {
      const workerUrl = this.plugin.settings.workerUrl;
      const authToken = this.plugin.settings.authToken;

      if (!workerUrl || !authToken) {
        return duplicates;
      }

      const request: DedupCheckRequest = {
        posts: posts.map((post) => ({
          id: post.id,
          textHash: this.hashContent(post.text),
        })),
      };

      const response = await requestUrl({
        url: `${workerUrl}/api/subscriptions/${subscriptionId}/check-dedup`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(request),
      });

      const data = response.json as DedupCheckResponse;
      if (data.success && data.data?.duplicates) {
        for (const id of data.data.duplicates) {
          duplicates.add(id);
        }
      }
    } catch (error) {
      console.warn('[BrunchSubscriptionPoller] Dedup check failed:', error);
    }

    return duplicates;
  }

  private async updateSubscriptionState(
    subscriptionId: string,
    update: UpdateStateRequest
  ): Promise<void> {
    try {
      const workerUrl = this.plugin.settings.workerUrl;
      const authToken = this.plugin.settings.authToken;

      if (!workerUrl || !authToken) {
        return;
      }

      await requestUrl({
        url: `${workerUrl}/api/subscriptions/${subscriptionId}/update-state`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(update),
      });
    } catch (error) {
      console.warn('[BrunchSubscriptionPoller] State update failed:', error);
    }
  }

  private hashContent(text: string): string {
    // Simple hash for dedup
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(16);
  }

  // ==========================================================================
  // RSS Cache
  // ==========================================================================

  private async loadRSSCache(): Promise<void> {
    try {
      const stored = await this.plugin.loadData();
      if (stored?.[RSS_CACHE_STORAGE_KEY]) {
        const cacheData = stored[RSS_CACHE_STORAGE_KEY] as RSSCacheStorage;
        if (cacheData.version === 1 && cacheData.entries) {
          const now = Date.now();
          for (const [key, entry] of Object.entries(cacheData.entries)) {
            if (now - entry.cachedAt < RSS_CACHE_TTL_MS) {
              this.rssCache.set(key, entry);
            }
          }
        }
      }
    } catch (error) {
      console.warn('[BrunchSubscriptionPoller] Failed to load RSS cache:', error);
    }
  }

  private async saveRSSCache(): Promise<void> {
    try {
      // Limit cache size
      if (this.rssCache.size > RSS_CACHE_MAX_ENTRIES) {
        const entries = Array.from(this.rssCache.entries());
        entries.sort((a, b) => b[1].cachedAt - a[1].cachedAt);
        this.rssCache = new Map(entries.slice(0, RSS_CACHE_MAX_ENTRIES));
      }

      const cacheData: RSSCacheStorage = {
        version: 1,
        entries: Object.fromEntries(this.rssCache),
      };

      const existingData = (await this.plugin.loadData()) || {};
      existingData[RSS_CACHE_STORAGE_KEY] = cacheData;
      await this.plugin.saveData(existingData);
    } catch (error) {
      console.warn('[BrunchSubscriptionPoller] Failed to save RSS cache:', error);
    }
  }
}
