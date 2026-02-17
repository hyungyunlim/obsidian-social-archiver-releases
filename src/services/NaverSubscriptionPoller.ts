/**
 * NaverSubscriptionPoller
 *
 * Polls Naver Blog and Cafe subscriptions locally from the Plugin.
 * This is a hybrid approach where:
 * - Plugin performs local fetch (using cookies from settings)
 * - Worker manages state and dedup data
 *
 * Supports:
 * - Naver Blog subscriptions (via RSS)
 * - Naver Cafe member subscriptions (via cafe-mobile API)
 *
 * Single Responsibility: Poll Naver subscriptions and archive new posts locally
 */

import { Notice, requestUrl } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import {
  NaverCafeLocalService,
  NaverCafeAuthError,
  type NaverCafePostData,
} from './NaverCafeLocalService';
import {
  NaverBlogLocalService,
  type NaverBlogPostData,
} from './NaverBlogLocalService';
import type { Subscription } from './SubscriptionManager';
import { VaultManager } from './VaultManager';
import { MarkdownConverter } from './MarkdownConverter';
import type { PostData } from '../types/post';
import { getVaultOrganizationStrategy } from '../types/settings';

// ============================================================================
// Types
// ============================================================================

export interface PollResult {
  subscriptionId: string;
  success: boolean;
  postsArchived: number;
  error?: string;
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

// ============================================================================
// RSS Cache Types
// ============================================================================

/**
 * RSS cache entry for ETag/Last-Modified caching
 */
export interface RSSCacheEntry {
  /** Blog ID */
  blogId: string;
  /** ETag header from server */
  etag?: string;
  /** Last-Modified header from server */
  lastModified?: string;
  /** Timestamp when cached */
  cachedAt: number;
}

/** RSS cache storage format for persistence */
interface RSSCacheStorage {
  version: number;
  entries: Record<string, RSSCacheEntry>;
}

// ============================================================================
// Constants
// ============================================================================

/** Default polling interval: 1 hour */
const DEFAULT_POLLING_INTERVAL = 60 * 60 * 1000;

/** RSS cache TTL: 7 days */
const RSS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum RSS cache entries */
const RSS_CACHE_MAX_ENTRIES = 100;

/** Storage key for RSS cache */
const RSS_CACHE_STORAGE_KEY = 'naverRssCache';

/** Minimum time between runs for same subscription: 1 hour */
const MIN_INTERVAL_HOURS = 1;

// ============================================================================
// Service Class
// ============================================================================

export class NaverSubscriptionPoller {
  private plugin: SocialArchiverPlugin;
  private intervalId: number | null = null;
  private initialDelayId: number | null = null;
  private pollingInterval: number;
  private isPolling = false;
  private isProcessingNotifications = false;

  /** RSS cache for ETag/Last-Modified headers */
  private rssCache: Map<string, RSSCacheEntry> = new Map();

  constructor(plugin: SocialArchiverPlugin, pollingInterval = DEFAULT_POLLING_INTERVAL) {
    this.plugin = plugin;
    this.pollingInterval = pollingInterval;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Start the poller (called on plugin load)
   */
  async start(): Promise<void> {
    // Guard against duplicate starts
    if (this.intervalId !== null) {
      return;
    }

    // Load RSS cache from storage
    await this.loadRSSCache();

    // Process pending notifications first (hybrid architecture)
    // These are posts detected by Worker while Obsidian was inactive
    this.initialDelayId = window.setTimeout(async () => {
      this.initialDelayId = null;
      await this.processPendingNotifications();
      await this.pollAll();
    }, 5000);

    // Set up interval for periodic polling
    this.intervalId = window.setInterval(
      async () => {
        await this.processPendingNotifications();
        await this.pollAll();
      },
      this.pollingInterval
    );
  }

  /**
   * Stop the poller (called on plugin unload)
   */
  async stop(): Promise<void> {
    if (this.initialDelayId !== null) {
      window.clearTimeout(this.initialDelayId);
      this.initialDelayId = null;
    }

    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Save RSS cache to storage
    await this.saveRSSCache();
  }

  /**
   * Poll all Naver subscriptions (blog + cafe)
   */
  async pollAll(): Promise<PollResult[]> {
    if (this.isPolling) {
      return [];
    }

    this.isPolling = true;
    const results: PollResult[] = [];

    try {
      const subscriptionManager = this.plugin.subscriptionManager;
      if (!subscriptionManager) {
        return results;
      }

      // Get all subscriptions and filter for Naver (blog OR cafe) with localFetchRequired
      const subscriptions = subscriptionManager.getSubscriptions();
      const naverSubs = subscriptions.filter(
        s =>
          s.platform === 'naver' &&
          (s.naverOptions?.subscriptionType === 'cafe-member' ||
           s.naverOptions?.subscriptionType === 'blog') &&
          s.naverOptions?.localFetchRequired === true &&
          s.enabled
      );


      // First, check for missed posts (catch-up after offline period)
      let totalRecovered = 0;
      for (const sub of naverSubs) {
        const recovered = await this.catchUpMissedPosts(sub);
        totalRecovered += recovered;
      }

      // Show catch-up notification if posts were recovered
      if (totalRecovered > 0) {
        new Notice(`Naver: Recovered ${totalRecovered} missed post(s)`);
      }

      // Then proceed with normal polling
      for (const sub of naverSubs) {
        if (this.isDue(sub)) {
          const result = await this.pollSubscription(sub);
          results.push(result);
        } else {
        }
      }

      // Show notification if new posts were archived (from normal polling)
      const totalArchived = results.reduce((sum, r) => sum + r.postsArchived, 0);
      if (totalArchived > 0) {
        new Notice(`Naver: Archived ${totalArchived} new post(s)`);
      }
    } catch (error) {
      console.error('[NaverPoller] Error in pollAll:', error);
    } finally {
      this.isPolling = false;
    }

    return results;
  }

  /**
   * Run a single subscription by ID (for manual "Run Now" from UI)
   * Bypasses the isDue() check since this is user-triggered
   */
  async runSingleSubscription(subscriptionId: string): Promise<PollResult> {

    const subscriptionManager = this.plugin.subscriptionManager;
    if (!subscriptionManager) {
      console.error('[NaverPoller] SubscriptionManager not available');
      throw new Error('SubscriptionManager not available');
    }

    const subscriptions = subscriptionManager.getSubscriptions();

    const sub = subscriptions.find(s => s.id === subscriptionId);

    if (!sub) {
      console.error(`[NaverPoller] Subscription not found: ${subscriptionId}`);
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const subscriptionType = sub.naverOptions?.subscriptionType;
    if (sub.platform !== 'naver' || (subscriptionType !== 'cafe-member' && subscriptionType !== 'blog')) {
      console.error(`[NaverPoller] Not a Naver subscription:`, {
        platform: sub.platform,
        subscriptionType,
      });
      throw new Error('This subscription is not a Naver Blog or Cafe subscription');
    }

    // Run the poll (bypasses isDue check)
    const result = await this.pollSubscription(sub);

    // Show result notification with subscription type
    const typeLabel = subscriptionType === 'blog' ? 'Naver Blog' : 'Naver Cafe';
    if (result.success) {
      if (result.postsArchived > 0) {
        new Notice(`${typeLabel}: Archived ${result.postsArchived} new post(s)`);
      } else {
        new Notice(`${typeLabel}: No new posts found`);
      }
    } else {
      new Notice(`${typeLabel} sync failed: ${result.error || 'Unknown error'}`);
    }

    return result;
  }

  /**
   * Poll a single subscription (routes to blog or cafe handler)
   */
  async pollSubscription(sub: Subscription): Promise<PollResult> {

    // Route to appropriate handler based on subscription type
    if (sub.naverOptions?.subscriptionType === 'blog') {
      return this.pollBlogSubscription(sub);
    } else {
      return this.pollCafeSubscription(sub);
    }
  }

  /**
   * Poll a Naver Blog subscription
   */
  private async pollBlogSubscription(sub: Subscription): Promise<PollResult> {

    const result: PollResult = {
      subscriptionId: sub.id,
      success: false,
      postsArchived: 0,
    };

    try {
      const blogId = sub.naverOptions?.blogId;
      if (!blogId) {
        throw new Error('Missing blogId in subscription options');
      }

      // Blog doesn't require cookie for RSS
      const blogService = new NaverBlogLocalService();

      // Check RSS cache for ETag/Last-Modified
      const cacheKey = `rss:${blogId}`;
      const cached = this.rssCache.get(cacheKey);

      // Quick RSS check with cached headers to avoid unnecessary fetches
      if (cached) {
        try {
          const rssCheck = await blogService.fetchRSS(blogId, {
            etag: cached.etag,
            lastModified: cached.lastModified,
          });

          if (rssCheck.notModified) {
            result.success = true;
            await this.updateWorkerState(sub.id, {
              lastRunAt: new Date().toISOString(),
            });
            return result;
          }

          // RSS changed - update cache with new headers
          if (rssCheck.etag || rssCheck.lastModified) {
            this.setRSSCacheEntry(cacheKey, {
              blogId,
              etag: rssCheck.etag,
              lastModified: rssCheck.lastModified,
              cachedAt: Date.now(),
            });
          }
        } catch (error) {
          console.warn(`[NaverPoller] RSS cache check failed for ${blogId}, proceeding with full fetch:`, error);
        }
      }

      // 1. Fetch posts via RSS (this will fetch RSS again, but OK since it's now known to be modified)
      const { posts: rawPosts, nextCursor } = await blogService.fetchMemberPosts(
        blogId,
        {
          cursor: sub.state.cursor || undefined,
          limit: sub.options.maxPostsPerRun,
          backfillDays: sub.state.cursor ? undefined : sub.options.backfillDays,
        }
      );

      // Update RSS cache after successful fetch (for first-time or after modification)
      // We need to fetch RSS headers again since fetchMemberPosts doesn't return them
      if (!cached) {
        try {
          const rssForCache = await blogService.fetchRSS(blogId);
          if (rssForCache.etag || rssForCache.lastModified) {
            this.rssCache.set(cacheKey, {
              blogId,
              etag: rssForCache.etag,
              lastModified: rssForCache.lastModified,
              cachedAt: Date.now(),
            });
          }
        } catch {
          // Ignore cache update failures
        }
      }


      // Apply keyword filter if specified
      const keyword = sub.naverOptions?.keyword?.toLowerCase().trim();
      const posts = keyword
        ? rawPosts.filter(p => p.title?.toLowerCase().includes(keyword))
        : rawPosts;

      if (keyword && posts.length !== rawPosts.length) {
      }

      if (posts.length === 0) {
        result.success = true;
        await this.updateWorkerState(sub.id, {
          lastRunAt: new Date().toISOString(),
        });
        return result;
      }

      // 2. Compute text hashes for dedup
      const postHashes = await Promise.all(
        posts.map(async p => ({
          id: p.id,
          textHash: await this.computeTextHash(p.text),
        }))
      );

      // 3. Check dedup with Worker API
      const dedupResult = await this.checkDedup(sub.id, { posts: postHashes });
      if (!dedupResult.success || !dedupResult.data) {
        throw new Error(dedupResult.error?.message || 'Dedup check failed');
      }

      const newPostIds = new Set(dedupResult.data.new);
      const newPosts = posts.filter(p => newPostIds.has(p.id));


      // 4. Archive new posts to vault
      for (const post of newPosts) {
        try {
          await this.archiveBlogPost(post, sub);
          result.postsArchived++;
        } catch (error) {
          console.error(`[NaverPoller] Failed to archive blog post ${post.id}:`, error);
        }
      }

      // 5. Update Worker state
      const archivedPostHashes = postHashes
        .filter(h => newPostIds.has(h.id))
        .map(h => h.textHash);

      await this.updateWorkerState(sub.id, {
        cursor: nextCursor || undefined,
        lastRunAt: new Date().toISOString(),
        archivedPostIds: newPosts.map(p => p.id),
        archivedPostHashes: archivedPostHashes,
        postsArchived: result.postsArchived,
        creditsUsed: 0, // Naver local fetch is free
      });

      result.success = true;

    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[NaverPoller] Error polling blog ${sub.id}:`, error);
    }

    return result;
  }

  /**
   * Poll a Naver Cafe member subscription
   */
  private async pollCafeSubscription(sub: Subscription): Promise<PollResult> {

    const result: PollResult = {
      subscriptionId: sub.id,
      success: false,
      postsArchived: 0,
    };

    try {
      // Get Naver cookie from settings
      const cookie = this.plugin.settings.naverCookie;

      if (!cookie) {
        throw new NaverCafeAuthError('Naver cookie not configured in settings', true);
      }

      const cafeService = new NaverCafeLocalService(cookie);
      const { cafeId, memberKey } = sub.naverOptions || {};

      if (!cafeId || !memberKey) {
        throw new Error('Missing cafeId or memberKey in subscription options');
      }

      // 1. Fetch member posts locally
      const { posts: rawPosts, nextCursor } = await cafeService.fetchMemberPosts(
        cafeId,
        memberKey,
        {
          cursor: sub.state.cursor || undefined,
          limit: sub.options.maxPostsPerRun,
          backfillDays: sub.state.cursor ? undefined : sub.options.backfillDays,
        }
      );


      // Apply keyword filter if specified
      const keyword = sub.naverOptions?.keyword?.toLowerCase().trim();
      const posts = keyword
        ? rawPosts.filter(p => p.title?.toLowerCase().includes(keyword))
        : rawPosts;

      if (keyword && posts.length !== rawPosts.length) {
      }

      if (posts.length === 0) {
        // No new posts, just update lastRunAt
        result.success = true;
        await this.updateWorkerState(sub.id, {
          lastRunAt: new Date().toISOString(),
        });
        return result;
      }

      // 2. Compute text hashes for dedup
      const postHashes = await Promise.all(
        posts.map(async p => ({
          id: p.id,
          textHash: await this.computeTextHash(p.text),
        }))
      );

      // 3. Check dedup with Worker API
      const dedupResult = await this.checkDedup(sub.id, { posts: postHashes });
      if (!dedupResult.success || !dedupResult.data) {
        throw new Error(dedupResult.error?.message || 'Dedup check failed');
      }

      const newPostIds = new Set(dedupResult.data.new);
      const newPosts = posts.filter(p => newPostIds.has(p.id));


      // 4. Archive new posts to vault
      for (const post of newPosts) {
        try {
          await this.archiveCafePost(post, sub);
          result.postsArchived++;
        } catch (error) {
          console.error(`[NaverPoller] Failed to archive cafe post ${post.id}:`, error);
        }
      }

      // 5. Update Worker state
      const archivedPostHashes = postHashes
        .filter(h => newPostIds.has(h.id))
        .map(h => h.textHash);

      await this.updateWorkerState(sub.id, {
        cursor: nextCursor || undefined,
        lastRunAt: new Date().toISOString(),
        archivedPostIds: newPosts.map(p => p.id),
        archivedPostHashes: archivedPostHashes,
        postsArchived: result.postsArchived,
        creditsUsed: 0, // Naver local fetch is free
      });

      result.success = true;

    } catch (error) {
      if (error instanceof NaverCafeAuthError) {
        result.error = 'Cookie expired';
        new Notice(
          `Naver cookie expired for "${sub.name}". Please update in settings.`,
          10000
        );
      } else {
        result.error = error instanceof Error ? error.message : 'Unknown error';
      }
      console.error(`[NaverPoller] Error polling cafe ${sub.id}:`, error);
    }

    return result;
  }

  // ==========================================================================
  // Pending Notifications (Hybrid Architecture for Naver Blog)
  // ==========================================================================

  /**
   * Fetch pending notifications from Worker
   * Worker detects new posts via RSS and stores lightweight notifications
   * Only fetches Naver Blog notifications (Cafe uses local-only mode)
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
        throw: false,
      });

      if (response.status >= 400) {
        console.warn(`[NaverPoller] Failed to fetch pending notifications: HTTP ${response.status}`);
        return [];
      }

      const data = response.json as PendingNotificationsResponse;
      if (data.success && data.data?.notifications) {
        // Only return Naver Blog notifications (not Cafe)
        return data.data.notifications.filter(n => n.platform === 'naver');
      }

      return [];
    } catch (error) {
      console.warn('[NaverPoller] Failed to fetch pending notifications:', error);
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
        throw: false,
      });
    } catch (error) {
      console.warn('[NaverPoller] Failed to ack notifications:', error);
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

      console.debug(`[NaverPoller] Processing ${notifications.length} pending notifications`);

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
            console.warn(`[NaverPoller] Subscription not found: ${notification.subscriptionId}`);
            processedIds.push(notification.id);
            continue;
          }

          // Validate URL format
          // URL formats:
          // - https://blog.naver.com/blogId/123456789
          // - https://m.blog.naver.com/blogId/123456789
          const urlMatch = notification.postUrl.match(/blog\.naver\.com\/([^/]+)\/(\d+)/);
          if (!urlMatch) {
            console.warn(`[NaverPoller] Invalid post URL: ${notification.postUrl}`);
            processedIds.push(notification.id);
            continue;
          }

          // Fetch full post content using NaverBlogLocalService
          const blogService = new NaverBlogLocalService();
          const post = await blogService.fetchPost(notification.postUrl);

          // Archive the post
          await this.archiveBlogPost(post, subscription);
          processedCount++;
          processedIds.push(notification.id);

          // Update subscription state with the archived post
          const textHash = await this.computeTextHash(post.text);
          await this.updateWorkerState(subscription.id, {
            archivedPostIds: [post.id],
            archivedPostHashes: [textHash],
            postsArchived: 1,
            creditsUsed: 0, // Naver local fetch is free
          });

          // Rate limit between posts
          await new Promise((r) => setTimeout(r, 1000));
        } catch (error) {
          console.error('[NaverPoller] Failed to process notification:', {
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
        new Notice(`Naver Blog: Archived ${processedCount} post(s) from pending notifications`);
      }

      return processedCount;
    } finally {
      this.isProcessingNotifications = false;
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Check if subscription is due for polling
   */
  private isDue(sub: Subscription): boolean {
    if (!sub.state.lastRunAt) {
      return true; // First run
    }

    const lastRun = new Date(sub.state.lastRunAt);
    const hoursSince = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60);

    return hoursSince >= MIN_INTERVAL_HOURS;
  }

  /**
   * Compute SHA-256 hash of text content
   */
  private async computeTextHash(text: string): Promise<string> {
    const normalized = (text || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');

    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(digest));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Check dedup with Worker API
   */
  private async checkDedup(
    subscriptionId: string,
    request: DedupCheckRequest
  ): Promise<DedupCheckResponse> {
    const baseUrl = this.plugin.settings.workerUrl || 'https://api.socialarchiver.com';
    const url = `${baseUrl}/api/subscriptions/${subscriptionId}/check-dedup`;

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(request),
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

    return response.json as DedupCheckResponse;
  }

  /**
   * Update subscription state in Worker
   */
  private async updateWorkerState(
    subscriptionId: string,
    updates: UpdateStateRequest
  ): Promise<UpdateStateResponse> {
    const baseUrl = this.plugin.settings.workerUrl || 'https://api.socialarchiver.com';
    const url = `${baseUrl}/api/subscriptions/${subscriptionId}/update-state`;

    const response = await requestUrl({
      url,
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(updates),
      throw: false,
    });

    if (response.status >= 400) {
      console.error(`[NaverPoller] Failed to update state: HTTP ${response.status}`);
      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: `HTTP ${response.status}`,
        },
      };
    }

    return response.json as UpdateStateResponse;
  }

  /**
   * Archive a Naver Blog post to vault
   */
  private async archiveBlogPost(post: NaverBlogPostData, sub: Subscription): Promise<void> {
    // Convert NaverBlogPostData to standard PostData format
    // Map media types: 'photo' -> 'image'
    const convertedMedia = post.media.map(m => ({
      ...m,
      type: m.type === 'photo' ? 'image' as const : m.type as 'video',
    }));

    const postData: PostData = {
      platform: 'naver',
      id: post.id,
      url: post.url,
      author: {
        name: post.author.name,
        handle: post.author.id,
        url: post.author.url,
        avatar: post.author.avatar,
        bio: post.author.bio,
      },
      content: {
        text: post.text,
        html: post.contentHtml,
        hashtags: post.tags,
      },
      media: convertedMedia,
      metadata: {
        likes: post.likes,
        comments: post.commentCount,
        views: post.viewCount,
        timestamp: post.timestamp,
      },
      title: post.title,
    };

    // Create VaultManager and MarkdownConverter instances
    const vaultManager = new VaultManager({
      vault: this.plugin.app.vault,
      basePath: this.plugin.settings.archivePath || 'Social Archives',
      organizationStrategy: getVaultOrganizationStrategy(this.plugin.settings.archiveOrganization),
    });
    await vaultManager.initialize();

    const markdownConverter = new MarkdownConverter({
      frontmatterSettings: this.plugin.settings.frontmatter,
    });
    await markdownConverter.initialize();

    // Convert to markdown
    const markdown = await markdownConverter.convert(
      postData,
      undefined, // No custom template
      undefined, // No downloaded media yet (TODO: add media download support)
      undefined
    );

    // Save to vault
    await vaultManager.savePost(postData, markdown);
  }

  /**
   * Archive a Naver Cafe post to vault
   */
  private async archiveCafePost(post: NaverCafePostData, sub: Subscription): Promise<void> {
    // Convert NaverCafePostData to standard PostData format
    // Map media types: 'photo' -> 'image'
    const convertedMedia = post.media.map(m => ({
      ...m,
      type: m.type === 'photo' ? 'image' as const : m.type as 'video',
    }));

    const postData: PostData = {
      platform: 'naver',
      id: post.id,
      url: post.url,
      author: {
        name: post.author.name,
        handle: post.author.id,
        url: post.author.url,
        avatar: post.author.avatar,
        bio: post.author.grade, // Use grade as bio
      },
      content: {
        text: post.text,
        html: undefined,
      },
      media: convertedMedia,
      metadata: {
        likes: post.likes,
        comments: post.commentCount,
        views: post.viewCount,
        timestamp: post.timestamp, // Required field in PostMetadata
      },
      title: post.title,
    };

    // Create VaultManager and MarkdownConverter instances
    const vaultManager = new VaultManager({
      vault: this.plugin.app.vault,
      basePath: this.plugin.settings.archivePath || 'Social Archives',
      organizationStrategy: getVaultOrganizationStrategy(this.plugin.settings.archiveOrganization),
    });
    await vaultManager.initialize();

    const markdownConverter = new MarkdownConverter({
      frontmatterSettings: this.plugin.settings.frontmatter,
    });
    await markdownConverter.initialize();

    // Convert to markdown
    const markdown = await markdownConverter.convert(
      postData,
      undefined, // No custom template
      undefined, // No downloaded media yet (TODO: add media download support)
      undefined
    );

    // Save to vault
    await vaultManager.savePost(postData, markdown);
  }

  // ==========================================================================
  // Offline Catch-up Logic
  // ==========================================================================

  /**
   * Check if catch-up is needed and recover missed posts
   * Called on first poll after restart to recover posts missed during offline period
   */
  private async catchUpMissedPosts(sub: Subscription): Promise<number> {
    const lastRunAt = sub.state.lastRunAt;
    if (!lastRunAt) {
      // First run ever, no catch-up needed
      return 0;
    }

    const lastRun = new Date(lastRunAt);
    const hoursSinceRun = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60);

    // Only catch-up if significant time has passed (> 2 hours)
    // This prevents duplicate catch-up on normal polling cycles
    if (hoursSinceRun <= 2) {
      return 0;
    }

    // Maximum catch-up period: 7 days
    const maxCatchupHours = 7 * 24;
    const effectiveHours = Math.min(hoursSinceRun, maxCatchupHours);
    const catchupDays = Math.ceil(effectiveHours / 24);

    try {
      if (sub.naverOptions?.subscriptionType === 'blog') {
        return await this.catchUpBlogPosts(sub, lastRun, catchupDays);
      } else if (sub.naverOptions?.subscriptionType === 'cafe-member') {
        return await this.catchUpCafePosts(sub, lastRun, catchupDays);
      }
    } catch (error) {
      console.error(`[NaverPoller] Catch-up failed for ${sub.id}:`, error);
    }

    return 0;
  }

  /**
   * Catch up missed blog posts using RSS
   */
  private async catchUpBlogPosts(
    sub: Subscription,
    lastRun: Date,
    catchupDays: number
  ): Promise<number> {
    const blogId = sub.naverOptions?.blogId;
    if (!blogId) {
      console.warn(`[NaverPoller] No blogId for catch-up: ${sub.id}`);
      return 0;
    }

    const blogService = new NaverBlogLocalService();

    // Fetch posts with extended backfill period (without cursor to get all recent posts)
    const { posts: rawPosts } = await blogService.fetchMemberPosts(blogId, {
      cursor: undefined, // No cursor = fetch from beginning
      limit: 50, // Increased limit for catch-up
      backfillDays: catchupDays,
    });

    // Filter posts published after lastRun
    const missedPosts = rawPosts.filter(
      post => new Date(post.timestamp) > lastRun
    );

    if (missedPosts.length === 0) {
      return 0;
    }


    // Compute text hashes for dedup
    const postHashes = await Promise.all(
      missedPosts.map(async p => ({
        id: p.id,
        textHash: await this.computeTextHash(p.text),
      }))
    );

    // Dedup check
    const dedupResult = await this.checkDedup(sub.id, { posts: postHashes });
    const newPostIds = new Set(dedupResult.data?.new || []);
    const postsToArchive = missedPosts.filter(p => newPostIds.has(p.id));

    if (postsToArchive.length === 0) {
      return 0;
    }

    // Archive new posts
    let archivedCount = 0;
    for (const post of postsToArchive) {
      try {
        await this.archiveBlogPost(post, sub);
        archivedCount++;
      } catch (error) {
        console.error(`[NaverPoller] Failed to archive catch-up blog post ${post.id}:`, error);
      }
    }

    // Update state with archived post IDs
    if (archivedCount > 0) {
      const archivedPostHashes = postHashes
        .filter(h => newPostIds.has(h.id))
        .map(h => h.textHash);

      await this.updateWorkerState(sub.id, {
        archivedPostIds: postsToArchive.map(p => p.id),
        archivedPostHashes,
        postsArchived: archivedCount,
        creditsUsed: 0, // Local fetch is free
      });
    }

    return archivedCount;
  }

  /**
   * Catch up missed cafe posts
   */
  private async catchUpCafePosts(
    sub: Subscription,
    lastRun: Date,
    catchupDays: number
  ): Promise<number> {
    const cookie = this.plugin.settings.naverCookie;
    if (!cookie) {
      console.warn(`[NaverPoller] No cookie for cafe catch-up: ${sub.id}`);
      return 0;
    }

    const cafeId = sub.naverOptions?.cafeId;
    const memberKey = sub.naverOptions?.memberKey;
    if (!cafeId || !memberKey) {
      console.warn(`[NaverPoller] Missing cafeId or memberKey for catch-up: ${sub.id}`);
      return 0;
    }

    const cafeService = new NaverCafeLocalService(cookie);

    // Fetch posts with extended backfill period (without cursor to get all recent posts)
    const { posts: rawPosts } = await cafeService.fetchMemberPosts(cafeId, memberKey, {
      cursor: undefined, // No cursor = fetch from beginning
      limit: 50, // Increased limit for catch-up
      backfillDays: catchupDays,
    });

    // Filter posts published after lastRun
    const missedPosts = rawPosts.filter(
      post => new Date(post.timestamp) > lastRun
    );

    if (missedPosts.length === 0) {
      return 0;
    }


    // Compute text hashes for dedup
    const postHashes = await Promise.all(
      missedPosts.map(async p => ({
        id: p.id,
        textHash: await this.computeTextHash(p.text),
      }))
    );

    // Dedup check
    const dedupResult = await this.checkDedup(sub.id, { posts: postHashes });
    const newPostIds = new Set(dedupResult.data?.new || []);
    const postsToArchive = missedPosts.filter(p => newPostIds.has(p.id));

    if (postsToArchive.length === 0) {
      return 0;
    }

    // Archive new posts
    let archivedCount = 0;
    for (const post of postsToArchive) {
      try {
        await this.archiveCafePost(post, sub);
        archivedCount++;
      } catch (error) {
        console.error(`[NaverPoller] Failed to archive catch-up cafe post ${post.id}:`, error);
      }
    }

    // Update state with archived post IDs
    if (archivedCount > 0) {
      const archivedPostHashes = postHashes
        .filter(h => newPostIds.has(h.id))
        .map(h => h.textHash);

      await this.updateWorkerState(sub.id, {
        archivedPostIds: postsToArchive.map(p => p.id),
        archivedPostHashes,
        postsArchived: archivedCount,
        creditsUsed: 0, // Local fetch is free
      });
    }

    return archivedCount;
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

    if (this.plugin.settings.licenseKey) {
      headers['X-License-Key'] = this.plugin.settings.licenseKey;
    }

    return headers;
  }

  // ==========================================================================
  // RSS Cache Persistence
  // ==========================================================================

  /**
   * Load RSS cache from plugin data
   */
  private async loadRSSCache(): Promise<void> {
    try {
      const data = await this.plugin.loadData();
      const cacheData = data?.[RSS_CACHE_STORAGE_KEY] as RSSCacheStorage | undefined;

      if (!cacheData || cacheData.version !== 1) {
        return;
      }

      const now = Date.now();
      let _loadedCount = 0;
      let _expiredCount = 0;

      // Load entries, filtering out expired ones
      for (const [key, entry] of Object.entries(cacheData.entries)) {
        if (now - entry.cachedAt < RSS_CACHE_TTL_MS) {
          this.rssCache.set(key, entry);
          _loadedCount++;
        } else {
          _expiredCount++;
        }
      }

    } catch (error) {
      console.warn('[NaverPoller] Failed to load RSS cache:', error);
    }
  }

  /** Set RSS cache entry with in-memory size limit */
  private setRSSCacheEntry(key: string, entry: RSSCacheEntry): void {
    this.rssCache.set(key, entry);
    // Evict oldest entries if exceeding limit
    while (this.rssCache.size > RSS_CACHE_MAX_ENTRIES) {
      const firstKey = this.rssCache.keys().next().value;
      if (firstKey !== undefined) {
        this.rssCache.delete(firstKey);
      } else {
        break;
      }
    }
  }

  /**
   * Save RSS cache to plugin data
   */
  private async saveRSSCache(): Promise<void> {
    try {
      const now = Date.now();
      const entries: Record<string, RSSCacheEntry> = {};

      // Collect non-expired entries, applying LRU eviction if needed
      const sortedEntries = Array.from(this.rssCache.entries())
        .filter(([, entry]) => now - entry.cachedAt < RSS_CACHE_TTL_MS)
        .sort((a, b) => b[1].cachedAt - a[1].cachedAt) // Most recent first
        .slice(0, RSS_CACHE_MAX_ENTRIES); // Limit to max entries

      for (const [key, entry] of sortedEntries) {
        entries[key] = entry;
      }

      const cacheData: RSSCacheStorage = {
        version: 1,
        entries,
      };

      // Load existing data and merge with cache
      const existingData = await this.plugin.loadData() || {};
      existingData[RSS_CACHE_STORAGE_KEY] = cacheData;
      await this.plugin.saveData(existingData);

    } catch (error) {
      console.warn('[NaverPoller] Failed to save RSS cache:', error);
    }
  }
}
