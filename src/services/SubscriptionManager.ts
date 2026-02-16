/**
 * SubscriptionManager - Plugin-side Subscription Management Service
 *
 * Manages profile subscriptions with local cache and Workers API sync:
 * - Fast reads from local cache, writes sync to Workers KV
 * - CRUD operations (get, add, update, delete)
 * - Network reconnection handling with refresh
 * - Export/Import JSON functionality
 * - Event handling for UI reactivity
 *
 * Single Responsibility: Manage subscription state and API synchronization
 */

import { Notice, Events, requestUrl } from 'obsidian';
import type { IService } from './base/IService';
import { Logger } from './Logger';
import { extractYouTubeChannelInfo } from './YouTubeChannelExtractor';
import { SUBSCRIPTION_SUPPORTED_PLATFORMS, type SubscriptionSupportedPlatform } from '@/constants/rssPlatforms';

// ============================================================================
// Types - Plugin-side subscription types mirroring Workers API
// ============================================================================

/** Platform type for subscriptions - derived from centralized constant */
export type SubscriptionPlatform = SubscriptionSupportedPlatform;

/** Subscription target profile */
export interface SubscriptionTarget {
  handle: string;
  profileUrl: string;
}

/** Schedule configuration */
export interface SubscriptionSchedule {
  cron: string;
  timezone: string;
}

/** Destination settings */
export interface SubscriptionDestination {
  folder: string;
  templateId?: string;
}

/** Runtime options */
export interface SubscriptionOptions {
  maxPostsPerRun: number;
  backfillDays: number;
}

/** Reddit-specific options (only when platform is 'reddit') */
export interface RedditSubscriptionOptions {
  sortBy: 'Best' | 'Hot' | 'New' | 'Top' | 'Rising';
  sortByTime: 'Now' | 'Today' | 'This Week' | 'This Month' | 'This Year' | 'All Time' | '';
  keyword?: string;
  /** Distinguishes between subreddit and user profile subscriptions */
  profileType?: 'subreddit' | 'user';
}

/** YouTube-specific metadata (only when platform is 'youtube') */
export interface YouTubeSubscriptionMetadata {
  channelId: string;
  channelName?: string;
  rssFeedUrl: string;
}

/** Mutable state */
export interface SubscriptionState {
  lastRunAt: string | null;
  cursor: string | null;
  pendingRunId: string | null;
}

/** Usage statistics */
export interface SubscriptionUsage {
  totalRuns: number;
  totalArchived: number;
  creditsUsed: number;
}

/** Naver-specific subscription options */
export interface NaverSubscriptionOptions {
  subscriptionType?: 'blog' | 'cafe-member';
  /** Blog ID for blog subscriptions */
  blogId?: string;
  cafeId?: string;
  memberKey?: string;
  memberNickname?: string;
  memberAvatar?: string;
  cafeName?: string;
  localFetchRequired?: boolean;
  keyword?: string;
}

/** Full subscription entity */
export interface Subscription {
  id: string;
  name: string;
  platform: SubscriptionPlatform;
  target: SubscriptionTarget;
  schedule: SubscriptionSchedule;
  enabled: boolean;
  destination: SubscriptionDestination;
  options: SubscriptionOptions;
  state: SubscriptionState;
  usage: SubscriptionUsage;
  userId: string;
  createdAt: string;
  updatedAt: string;
  // Platform-specific options
  redditOptions?: RedditSubscriptionOptions;
  youtubeMetadata?: YouTubeSubscriptionMetadata;
  naverOptions?: NaverSubscriptionOptions;
  brunchOptions?: BrunchSubscriptionOptions;
  naverWebtoonOptions?: NaverWebtoonSubscriptionOptions;
  webtoonsOptions?: WebtoonsSubscriptionOptions;
  xMetadata?: XSubscriptionMetadata;
}

/** Pending post from server (crawled but not yet synced to vault) */
export interface PendingPost {
  id: string; // Unique ID for this pending entry
  subscriptionId: string;
  subscriptionName: string;
  post: any; // PostData from server
  destinationFolder: string;
  archivedAt: string; // ISO 8601
}

/** Result of syncing pending posts */
export interface PendingPostsSyncResult {
  total: number;
  saved: number;
  failed: number;
  errors: Array<{ postId: string; error: string }>;
}

/** YouTube-specific metadata for subscriptions */
export interface YouTubeSubscriptionMetadata {
  channelId: string;
  channelName?: string;
  rssFeedUrl: string;
}

/** Naver-specific options for subscriptions (blog or cafe member) */
export interface NaverSubscriptionOptions {
  /** Cookie for authentication (not stored in Worker for security) */
  cookie?: string;
  /** Subscription type: 'blog' or 'cafe-member' */
  subscriptionType?: 'blog' | 'cafe-member';
  /** Blog ID for blog subscriptions */
  blogId?: string;
  /** Cafe ID for cafe member subscriptions */
  cafeId?: string;
  /** Member key for cafe member subscriptions */
  memberKey?: string;
  /** Member nickname for display */
  memberNickname?: string;
  /** Member avatar URL for display */
  memberAvatar?: string;
  /** Cafe name for display */
  cafeName?: string;
  /** When true, Plugin polls locally instead of Worker */
  localFetchRequired?: boolean;
  /** Optional keyword filter for post titles */
  keyword?: string;
}

/** Brunch-specific options for subscriptions */
export interface BrunchSubscriptionOptions {
  /** Subscription type identifier */
  subscriptionType: 'brunch';
  /** Public username (e.g., 'eveningdriver') */
  username: string;
  /** Internal userId for RSS API (e.g., 'eHom') - discovered automatically */
  userId?: string;
  /** Always true - Brunch requires local fetching */
  localFetchRequired: true;
  /** Optional keyword filter for post titles */
  keyword?: string;
  /** Author display name */
  displayName?: string;
  /** Author avatar URL */
  avatar?: string;
  /** Include comments when archiving */
  includeComments?: boolean;
}

/** Naver Webtoon-specific options for subscriptions */
export interface NaverWebtoonSubscriptionOptions {
  /** Webtoon title ID (from URL) */
  titleId: string;
  /** Webtoon title name for display */
  titleName: string;
  /** Publish day for optimal scheduling (e.g., "토요웹툰") */
  publishDay?: string;
  /** Thumbnail URL for display */
  thumbnailUrl?: string;
  /** Artist/author names */
  artistNames?: string;
}

/** WEBTOON (Global) subscription options */
export interface WebtoonsSubscriptionOptions {
  /** Series title number from URL (title_no parameter) */
  titleNo: string;
  /** Series title for display */
  seriesTitle: string;
  /** Language code (e.g., 'en', 'es', 'fr') */
  language: string;
  /** Genre from URL (e.g., 'romance', 'fantasy') */
  genre: string;
  /** URL slug for the series */
  seriesSlug: string;
  /** Update day (e.g., 'SATURDAY') */
  updateDay?: string;
  /** Whether this is a Canvas (user-created) series */
  isCanvas?: boolean;
  /** Thumbnail URL for display */
  thumbnailUrl?: string;
  /** Author/artist names */
  authorNames?: string;
}

/** X (Twitter)-specific subscription metadata */
export interface XSubscriptionMetadata {
  /** Author display name (e.g., "OpenAI" vs handle "openai") */
  displayName?: string;
  /** Profile avatar URL */
  avatar?: string;
  /** Profile bio/description */
  bio?: string;
}

/** Input for creating a subscription */
export interface CreateSubscriptionInput {
  name: string;
  platform: SubscriptionPlatform;
  target: {
    handle: string;
    profileUrl?: string;
  };
  schedule?: {
    cron?: string;
    timezone?: string;
  };
  destination?: {
    folder?: string;
    templateId?: string;
  };
  options?: {
    maxPostsPerRun?: number;
    backfillDays?: number;
  };
  /** YouTube-specific metadata (auto-populated for YouTube subscriptions) */
  youtubeMetadata?: YouTubeSubscriptionMetadata;
  /** Naver-specific options (for cafe member subscriptions) */
  naverOptions?: NaverSubscriptionOptions;
  /** Brunch-specific options */
  brunchOptions?: BrunchSubscriptionOptions;
  /** Naver Webtoon-specific options */
  naverWebtoonOptions?: NaverWebtoonSubscriptionOptions;
  /** WEBTOON (Global) options */
  webtoonsOptions?: WebtoonsSubscriptionOptions;
  /** X (Twitter)-specific metadata */
  xMetadata?: XSubscriptionMetadata;
}

/** Input for updating a subscription */
export interface UpdateSubscriptionInput {
  name?: string;
  enabled?: boolean;
  schedule?: {
    cron?: string;
    timezone?: string;
  };
  destination?: {
    folder?: string;
    templateId?: string;
  };
  options?: {
    maxPostsPerRun?: number;
    backfillDays?: number;
  };
}

/** Subscription run record */
export interface SubscriptionRun {
  id: string;
  subscriptionId: string;
  userId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  trigger: 'scheduled' | 'manual';
  startedAt: string;
  completedAt: string | null;
  postsArchived: number;
  creditsUsed: number;
  newCursor: string | null;
  error?: string;
}

/** Export data format */
export interface SubscriptionExport {
  version: string;
  exportedAt: string;
  count: number;
  subscriptions: Subscription[];
}

/** Event types for subscription changes */
export type SubscriptionEventType =
  | 'subscriptions:loaded'
  | 'subscription:added'
  | 'subscription:updated'
  | 'subscription:deleted'
  | 'subscription:run:started'
  | 'subscription:run:completed'
  | 'subscription:run:failed'
  | 'subscriptions:refreshed'
  | 'subscriptions:error';

/** Event data */
export interface SubscriptionEvent {
  type: SubscriptionEventType;
  subscription?: Subscription;
  subscriptionId?: string;
  run?: SubscriptionRun;
  error?: string;
}

// ============================================================================
// Custom Errors
// ============================================================================

export class SubscriptionNotFoundError extends Error {
  constructor(id: string) {
    super(`Subscription not found: ${id}`);
    this.name = 'SubscriptionNotFoundError';
  }
}

export class SubscriptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionValidationError';
  }
}

export class SubscriptionAPIError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SubscriptionAPIError';
    this.code = code;
  }
}

// ============================================================================
// Configuration
// ============================================================================

export interface SubscriptionManagerConfig {
  apiBaseUrl: string;
  authToken?: string;
  licenseKey?: string;
  pollingInterval?: number; // ms, default 30000
  enablePolling?: boolean;
}

const DEFAULT_POLLING_INTERVAL = 30000; // 30 seconds

// ============================================================================
// SubscriptionManager Class
// ============================================================================

export class SubscriptionManager implements IService {
  private config: SubscriptionManagerConfig;
  private logger?: Logger;
  private initialized = false;

  /**
   * Check if the manager is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  // Local cache for O(1) lookups
  private cache: Map<string, Subscription> = new Map();

  // Event emitter for UI reactivity
  private events: Events = new Events();

  // Polling state
  private pollingIntervalId?: ReturnType<typeof setInterval>;
  private isPolling = false;

  // Network state
  private isOnline = true;
  private pendingOperations: Array<() => Promise<void>> = [];

  // Loading state
  private isLoading = false;
  private isRefreshing = false;

  constructor(config: SubscriptionManagerConfig, logger?: Logger) {
    this.config = {
      pollingInterval: DEFAULT_POLLING_INTERVAL,
      enablePolling: true,
      ...config,
    };
    this.logger = logger;
  }

  // --------------------------------------------------------------------------
  // IService Implementation
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger?.warn('SubscriptionManager already initialized');
      return;
    }

    this.logger?.info('Initializing SubscriptionManager');

    // Set up network status listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      this.isOnline = navigator.onLine;
    }

    // Load subscriptions from API
    try {
      await this.loadSubscriptions();
    } catch (error) {
      this.logger?.error('Failed to load subscriptions during initialization', error as Error);
      // Don't throw - allow offline usage
    }

    // Start polling if enabled and has active subscriptions
    if (this.config.enablePolling && this.hasActiveSubscriptions()) {
      this.startPolling();
    }

    this.initialized = true;
    this.logger?.info('SubscriptionManager initialized', {
      subscriptionCount: this.cache.size,
      pollingEnabled: this.config.enablePolling,
    });
  }

  async dispose(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger?.info('Disposing SubscriptionManager');

    // Stop polling
    this.stopPolling();

    // Remove network listeners
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }

    // Clear cache and events
    this.cache.clear();
    this.events = new Events();
    this.pendingOperations = [];

    this.initialized = false;
  }

  isHealthy(): boolean {
    return this.initialized && this.isOnline;
  }

  // --------------------------------------------------------------------------
  // Public Methods - Cache Operations
  // --------------------------------------------------------------------------

  /**
   * Get all subscriptions from cache (synchronous for UI)
   */
  getSubscriptions(): Subscription[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get a single subscription by ID
   */
  getSubscription(id: string): Subscription | undefined {
    return this.cache.get(id);
  }

  /**
   * Check if subscriptions are currently loading
   */
  getIsLoading(): boolean {
    return this.isLoading;
  }

  /**
   * Check if subscriptions are currently refreshing
   */
  getIsRefreshing(): boolean {
    return this.isRefreshing;
  }

  /**
   * Add a new subscription
   */
  async addSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    this.ensureInitialized();
    this.validateCreateInput(input);

    if (!this.isOnline) {
      throw new SubscriptionAPIError(
        'OFFLINE',
        'Cannot create subscriptions while offline. Please reconnect and try again.'
      );
    }

    this.logger?.info('Adding subscription', { name: input.name, handle: input.target.handle });

    // For YouTube subscriptions, extract channel ID before API call
    if (input.platform === 'youtube' && !input.youtubeMetadata) {
      const profileUrl = input.target.profileUrl || `https://www.youtube.com/@${input.target.handle}`;
      this.logger?.debug('Extracting YouTube channel info', { profileUrl });

      try {
        const channelInfo = await extractYouTubeChannelInfo(profileUrl);

        if (!channelInfo) {
          throw new SubscriptionValidationError(
            'Could not extract YouTube channel ID. Please verify the channel URL is correct.'
          );
        }

        // Populate YouTube metadata
        input.youtubeMetadata = {
          channelId: channelInfo.channelId,
          channelName: channelInfo.channelName,
          rssFeedUrl: channelInfo.rssFeedUrl,
        };

        this.logger?.info('YouTube channel info extracted', {
          channelId: channelInfo.channelId,
          channelName: channelInfo.channelName,
        });
      } catch (error) {
        if (error instanceof SubscriptionValidationError) {
          throw error;
        }
        this.logger?.error('Failed to extract YouTube channel info', error as Error);
        throw new SubscriptionValidationError(
          'Failed to extract YouTube channel information. Please check the URL and try again.'
        );
      }
    }

    try {
      const response = await this.apiRequest<{ success: boolean; data: Subscription }>(
        '/api/subscriptions',
        {
          method: 'POST',
          body: JSON.stringify(input),
        }
      );

      if (!response.success || !response.data) {
        throw new SubscriptionAPIError('CREATE_FAILED', 'Failed to create subscription');
      }

      const subscription = response.data;

      // Update cache
      this.cache.set(subscription.id, subscription);

      // Emit event
      this.emitEvent({ type: 'subscription:added', subscription });

      // Start polling if this is the first active subscription
      if (subscription.enabled && !this.isPolling && this.config.enablePolling) {
        this.startPolling();
      }

      this.logger?.info('Subscription added', { id: subscription.id });
      new Notice(`Subscription "${subscription.name}" created`);

      return subscription;
    } catch (error) {
      this.logger?.error('Failed to add subscription', error as Error);
      throw error;
    }
  }

  /**
   * Update an existing subscription
   */
  async updateSubscription(id: string, updates: UpdateSubscriptionInput): Promise<Subscription> {
    this.ensureInitialized();

    const existing = this.cache.get(id);
    if (!existing) {
      throw new SubscriptionNotFoundError(id);
    }

    this.logger?.info('Updating subscription', { id, updates });

    if (!this.isOnline) {
      const optimistic = this.applyUpdates(existing, updates);
      this.cache.set(id, optimistic);
      this.emitEvent({ type: 'subscription:updated', subscription: optimistic });
      this.enqueueOperation(async () => {
        const response = await this.apiRequest<{ success: boolean; data: Subscription }>(
          `/api/subscriptions/${id}`,
          {
            method: 'PATCH',
            body: JSON.stringify(updates),
          }
        );

        if (!response.success || !response.data) {
          throw new SubscriptionAPIError('UPDATE_FAILED', 'Failed to update subscription');
        }

        this.cache.set(id, response.data);
        this.emitEvent({ type: 'subscription:updated', subscription: response.data });
      });

      this.logger?.info('Queued subscription update while offline', { id });
      return optimistic;
    }

    try {
      const response = await this.apiRequest<{ success: boolean; data: Subscription }>(
        `/api/subscriptions/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(updates),
        }
      );

      if (!response.success || !response.data) {
        throw new SubscriptionAPIError('UPDATE_FAILED', 'Failed to update subscription');
      }

      const subscription = response.data;

      // Update cache
      this.cache.set(id, subscription);

      // Emit event
      this.emitEvent({ type: 'subscription:updated', subscription });

      // Manage polling based on active subscriptions
      this.updatePollingState();

      this.logger?.info('Subscription updated', { id });

      return subscription;
    } catch (error) {
      this.logger?.error('Failed to update subscription', error as Error);
      throw error;
    }
  }

  /**
   * Delete a subscription
   */
  async deleteSubscription(id: string): Promise<void> {
    this.ensureInitialized();

    const existing = this.cache.get(id);
    if (!existing) {
      throw new SubscriptionNotFoundError(id);
    }

    this.logger?.info('Deleting subscription', { id });

    if (!this.isOnline) {
      this.cache.delete(id);
      this.emitEvent({ type: 'subscription:deleted', subscriptionId: id });
      this.updatePollingState();

      this.enqueueOperation(async () => {
        const response = await this.apiRequest<{ success: boolean }>(
          `/api/subscriptions/${id}`,
          { method: 'DELETE' }
        );

        if (!response.success) {
          this.cache.set(id, existing);
          this.emitEvent({ type: 'subscription:updated', subscription: existing });
          throw new SubscriptionAPIError('DELETE_FAILED', 'Failed to delete subscription');
        }
      });

      this.logger?.info('Queued subscription deletion while offline', { id });
      new Notice(`Subscription "${existing.name}" will delete when back online`);
      return;
    }

    try {
      const response = await this.apiRequest<{ success: boolean }>(
        `/api/subscriptions/${id}`,
        { method: 'DELETE' }
      );

      if (!response.success) {
        throw new SubscriptionAPIError('DELETE_FAILED', 'Failed to delete subscription');
      }

      // Remove from cache
      this.cache.delete(id);

      // Emit event
      this.emitEvent({ type: 'subscription:deleted', subscriptionId: id });

      // Manage polling based on active subscriptions
      this.updatePollingState();

      this.logger?.info('Subscription deleted', { id });
      new Notice(`Subscription "${existing.name}" deleted`);
    } catch (error) {
      // Debug: log the actual error details
      this.logger?.warn('Delete subscription error details', {
        isSubscriptionAPIError: error instanceof SubscriptionAPIError,
        errorCode: (error as SubscriptionAPIError)?.code,
        errorMessage: (error as Error)?.message,
        errorName: (error as Error)?.name,
      });

      // Handle 404 as "already deleted" - remove from local cache anyway
      const isNotFound = error instanceof SubscriptionAPIError && error.code === 'NOT_FOUND';
      if (isNotFound) {
        this.logger?.info('Subscription not found on server, removing from local cache', { id });

        // Remove from cache
        this.cache.delete(id);

        // Emit event
        this.emitEvent({ type: 'subscription:deleted', subscriptionId: id });

        // Manage polling based on active subscriptions
        this.updatePollingState();

        new Notice(`Subscription "${existing.name}" removed (was already deleted from server)`);
        return;
      }

      this.logger?.error('Failed to delete subscription', error as Error);
      throw error;
    }
  }

  /**
   * Trigger a manual run for a subscription
   */
  async triggerManualRun(id: string, force = false): Promise<SubscriptionRun> {
    this.ensureInitialized();

    const existing = this.cache.get(id);
    if (!existing) {
      throw new SubscriptionNotFoundError(id);
    }

    if (!this.isOnline) {
      throw new SubscriptionAPIError(
        'OFFLINE',
        'Cannot start archive runs while offline. Please reconnect and try again.'
      );
    }

    this.logger?.info('Triggering manual run', { id, force });

    try {
      const response = await this.apiRequest<{
        success: boolean;
        data: { runId: string; status: string; message: string }
      }>(
        `/api/subscriptions/${id}/run`,
        {
          method: 'POST',
          body: JSON.stringify({ force }),
        }
      );

      if (!response.success || !response.data) {
        throw new SubscriptionAPIError('RUN_FAILED', 'Failed to trigger run');
      }

      // Create run record
      const run: SubscriptionRun = {
        id: response.data.runId,
        subscriptionId: id,
        userId: existing.userId,
        status: 'pending',
        trigger: 'manual',
        startedAt: new Date().toISOString(),
        completedAt: null,
        postsArchived: 0,
        creditsUsed: 0,
        newCursor: null,
      };

      // Update subscription state
      existing.state.pendingRunId = run.id;
      this.cache.set(id, existing);

      // Emit event
      this.emitEvent({ type: 'subscription:run:started', subscription: existing, run });

      this.logger?.info('Manual run triggered', { id, runId: run.id });
      new Notice(`Archive run started for "${existing.name}"`);

      return run;
    } catch (error) {
      this.logger?.error('Failed to trigger manual run', error as Error);
      throw error;
    }
  }

  /**
   * Get run history for a subscription
   */
  async getRunHistory(id: string, limit = 10): Promise<SubscriptionRun[]> {
    this.ensureInitialized();

    const existing = this.cache.get(id);
    if (!existing) {
      throw new SubscriptionNotFoundError(id);
    }

    if (!this.isOnline) {
      this.logger?.debug('Offline - returning empty run history');
      return [];
    }

    this.logger?.debug('Fetching run history', { id, limit });

    try {
      const response = await this.apiRequest<{
        success: boolean;
        data: {
          runs: SubscriptionRun[];
          total: number;
          hasMore: boolean;
        }
      }>(`/api/subscriptions/${id}/runs?limit=${limit}`);

      if (!response.success || !response.data) {
        return [];
      }

      return response.data.runs;
    } catch (error) {
      this.logger?.error('Failed to fetch run history', error as Error);
      return [];
    }
  }

  // --------------------------------------------------------------------------
  // Public Methods - Sync Operations
  // --------------------------------------------------------------------------

  /**
   * Refresh all subscriptions from API
   */
  async refresh(): Promise<void> {
    if (this.isRefreshing) {
      this.logger?.debug('Refresh already in progress, skipping');
      return;
    }

    this.ensureInitialized();
    this.isRefreshing = true;

    this.logger?.info('Refreshing subscriptions');

    try {
      // Process any pending offline operations first
      await this.processPendingOperations();

      // Fetch from API
      await this.loadSubscriptions();

      // Emit event
      this.emitEvent({ type: 'subscriptions:refreshed' });

      this.logger?.info('Subscriptions refreshed', { count: this.cache.size });
    } catch (error) {
      this.logger?.error('Failed to refresh subscriptions', error as Error);
      this.emitEvent({
        type: 'subscriptions:error',
        error: (error as Error).message
      });
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  // --------------------------------------------------------------------------
  // Public Methods - Export/Import
  // --------------------------------------------------------------------------

  /**
   * Export subscriptions to JSON
   */
  exportToJSON(): SubscriptionExport {
    this.ensureInitialized();

    const subscriptions = this.getSubscriptions();

    const exportData: SubscriptionExport = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      count: subscriptions.length,
      subscriptions,
    };

    this.logger?.info('Subscriptions exported', { count: subscriptions.length });

    return exportData;
  }

  /**
   * Export subscriptions as downloadable Blob
   */
  exportToBlob(): Blob {
    const exportData = this.exportToJSON();
    const json = JSON.stringify(exportData, null, 2);
    return new Blob([json], { type: 'application/json' });
  }

  /**
   * Import subscriptions from JSON
   * @param json JSON string or parsed object
   * @param mode 'merge' (add new, skip existing) or 'replace' (clear and import)
   */
  async importFromJSON(
    json: string | SubscriptionExport,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    this.ensureInitialized();

    const stats = { imported: 0, skipped: 0, errors: 0 };

    // Parse JSON if string
    let data: SubscriptionExport;
    try {
      data = typeof json === 'string' ? JSON.parse(json) : json;
    } catch {
      throw new SubscriptionValidationError('Invalid JSON format');
    }

    // Validate structure
    if (!this.validateExportData(data)) {
      throw new SubscriptionValidationError('Invalid export data format');
    }

    this.logger?.info('Importing subscriptions', {
      mode,
      count: data.subscriptions.length
    });

    // Clear cache if replace mode
    if (mode === 'replace') {
      // Delete all existing subscriptions
      for (const sub of this.cache.values()) {
        try {
          await this.deleteSubscription(sub.id);
        } catch (error) {
          this.logger?.warn('Failed to delete subscription during replace', { id: sub.id });
        }
      }
      this.cache.clear();
    }

    // Import each subscription
    for (const sub of data.subscriptions) {
      try {
        // Skip if already exists in merge mode
        if (mode === 'merge' && this.cache.has(sub.id)) {
          stats.skipped++;
          continue;
        }

        // Create via API
        await this.addSubscription({
          name: sub.name,
          platform: sub.platform,
          target: sub.target,
          schedule: sub.schedule,
          destination: sub.destination,
          options: sub.options,
        });

        stats.imported++;
      } catch (error) {
        this.logger?.error('Failed to import subscription', error as Error, {
          name: sub.name
        });
        stats.errors++;
      }
    }

    this.logger?.info('Import completed', stats);
    new Notice(`Import completed: ${stats.imported} imported, ${stats.skipped} skipped, ${stats.errors} errors`);

    return stats;
  }

  // --------------------------------------------------------------------------
  // Public Methods - Pending Posts Sync
  // --------------------------------------------------------------------------

  /**
   * Fetch pending posts from server
   * These are posts crawled by subscriptions but not yet synced to vault
   */
  async fetchPendingPosts(): Promise<PendingPost[]> {
    this.ensureInitialized();

    if (!this.isOnline) {
      return [];
    }

    try {
      const response = await this.apiRequest<{
        success: boolean;
        data: { posts: PendingPost[]; total: number };
      }>('/api/subscriptions/pending-posts');

      if (!response.success || !response.data?.posts) {
        return [];
      }

      return response.data.posts;

    } catch (error) {
      this.logger?.error('Failed to fetch pending posts', error as Error);
      return [];
    }
  }

  /**
   * Sync pending posts to vault
   * @param saveHandler Function that saves a single post to vault, returns true if successful
   */
  async syncPendingPosts(
    saveHandler: (pendingPost: PendingPost) => Promise<boolean>
  ): Promise<PendingPostsSyncResult> {
    this.ensureInitialized();

    const result: PendingPostsSyncResult = {
      total: 0,
      saved: 0,
      failed: 0,
      errors: []
    };

    // Fetch pending posts
    const pendingPosts = await this.fetchPendingPosts();
    result.total = pendingPosts.length;

    if (pendingPosts.length === 0) {
      this.logger?.debug('No pending posts to sync');
      return result;
    }

    this.logger?.info('Syncing pending posts', { count: pendingPosts.length });

    // Process each post
    const successfulIds: string[] = [];

    for (const pendingPost of pendingPosts) {
      try {
        const success = await saveHandler(pendingPost);

        if (success) {
          result.saved++;
          successfulIds.push(pendingPost.id);
        } else {
          result.failed++;
          result.errors.push({
            postId: pendingPost.id,
            error: 'Save handler returned false'
          });
        }
      } catch (error) {
        result.failed++;
        result.errors.push({
          postId: pendingPost.id,
          error: error instanceof Error ? error.message : String(error)
        });
        this.logger?.error('Failed to save pending post', error as Error, {
          postId: pendingPost.id,
          subscriptionName: pendingPost.subscriptionName
        });
      }
    }

    // Acknowledge successfully processed posts
    if (successfulIds.length > 0) {
      await this.acknowledgePendingPosts(successfulIds);
    }

    this.logger?.info('Pending posts sync completed', { ...result });

    if (result.saved > 0) {
      new Notice(`Synced ${result.saved} subscription post(s) to vault`);
    }

    return result;
  }

  /**
   * Acknowledge processed posts (remove from server queue)
   */
  async acknowledgePendingPosts(postIds: string[]): Promise<void> {
    if (postIds.length === 0) return;

    try {
      await this.apiRequest('/api/subscriptions/pending-posts/ack', {
        method: 'POST',
        body: JSON.stringify({ postIds })
      });

      this.logger?.info('Acknowledged pending posts', { count: postIds.length });

    } catch (error) {
      this.logger?.error('Failed to acknowledge pending posts', error as Error);
      // Don't throw - posts are already saved locally
    }
  }

  // --------------------------------------------------------------------------
  // Public Methods - Events
  // --------------------------------------------------------------------------

  /**
   * Subscribe to subscription events
   */
  on(event: SubscriptionEventType, callback: (data: SubscriptionEvent) => void): void {
    this.events.on(event, callback as (...data: unknown[]) => unknown);
  }

  /**
   * Unsubscribe from subscription events
   */
  off(event: SubscriptionEventType, callback: (data: SubscriptionEvent) => void): void {
    this.events.off(event, callback as (...data: unknown[]) => unknown);
  }

  // --------------------------------------------------------------------------
  // Public Methods - Configuration
  // --------------------------------------------------------------------------

  /**
   * Update auth token
   */
  setAuthToken(token: string): void {
    this.config.authToken = token;
  }

  /**
   * Update license key
   */
  setLicenseKey(key: string): void {
    this.config.licenseKey = key;
  }

  // --------------------------------------------------------------------------
  // Private Methods - API Communication
  // --------------------------------------------------------------------------

  private async apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.apiBaseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
    }

    if (this.config.licenseKey) {
      headers['X-License-Key'] = this.config.licenseKey;
    }

    try {
      const response = await requestUrl({
        url,
        method: options.method || 'GET',
        headers,
        body: options.body as string | undefined,
        throw: false,
      });

      if (response.status >= 400) {
        const errorData = response.json;
        throw new SubscriptionAPIError(
          errorData?.error?.code || 'API_ERROR',
          errorData?.error?.message || `HTTP ${response.status}`
        );
      }

      return response.json as T;
    } catch (error) {
      if (error instanceof SubscriptionAPIError) {
        throw error;
      }
      throw new SubscriptionAPIError('NETWORK_ERROR', (error as Error).message);
    }
  }

  private async loadSubscriptions(): Promise<void> {
    this.isLoading = true;

    try {
      const response = await this.apiRequest<{
        success: boolean;
        data: { subscriptions: Subscription[]; total: number };
      }>('/api/subscriptions');

      if (!response.success || !response.data) {
        throw new SubscriptionAPIError('LOAD_FAILED', 'Failed to load subscriptions');
      }

      // Clear and populate cache
      this.cache.clear();
      for (const sub of response.data.subscriptions) {
        this.cache.set(sub.id, sub);
      }

      // Emit event
      this.emitEvent({ type: 'subscriptions:loaded' });
    } finally {
      this.isLoading = false;
    }
  }

  // --------------------------------------------------------------------------
  // Private Methods - Polling
  // --------------------------------------------------------------------------

  private startPolling(): void {
    if (this.isPolling) {
      return;
    }

    this.logger?.debug('Starting subscription polling');
    this.isPolling = true;

    this.pollingIntervalId = setInterval(async () => {
      await this.pollForUpdates();
    }, this.config.pollingInterval);
  }

  private stopPolling(): void {
    if (!this.isPolling) {
      return;
    }

    this.logger?.debug('Stopping subscription polling');
    this.isPolling = false;

    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = undefined;
    }
  }

  private updatePollingState(): void {
    const shouldPoll = this.config.enablePolling && this.hasActiveSubscriptions();

    if (shouldPoll && !this.isPolling) {
      this.startPolling();
    } else if (!shouldPoll && this.isPolling) {
      this.stopPolling();
    }
  }

  private hasActiveSubscriptions(): boolean {
    for (const sub of this.cache.values()) {
      if (sub.enabled) {
        return true;
      }
    }
    return false;
  }

  private async pollForUpdates(): Promise<void> {
    if (!this.isOnline || this.isRefreshing) {
      return;
    }

    try {
      // Check for pending runs
      for (const sub of this.cache.values()) {
        if (sub.state.pendingRunId) {
          await this.checkRunStatus(sub.id, sub.state.pendingRunId);
        }
      }
    } catch (error) {
      this.logger?.debug('Polling error (will retry)', { error: (error as Error).message });
    }
  }

  private async checkRunStatus(subscriptionId: string, runId: string): Promise<void> {
    try {
      const response = await this.apiRequest<{
        success: boolean;
        data: SubscriptionRun;
      }>(`/api/subscriptions/${subscriptionId}/runs/${runId}`);

      if (!response.success || !response.data) {
        return;
      }

      const run = response.data;
      const subscription = this.cache.get(subscriptionId);

      if (!subscription) {
        return;
      }

      // Handle completion
      if (run.status === 'completed') {
        subscription.state.pendingRunId = null;
        subscription.state.lastRunAt = run.completedAt;
        subscription.state.cursor = run.newCursor;
        subscription.usage.totalRuns++;
        subscription.usage.totalArchived += run.postsArchived;
        subscription.usage.creditsUsed += run.creditsUsed;

        this.cache.set(subscriptionId, subscription);
        this.emitEvent({ type: 'subscription:run:completed', subscription, run });

        new Notice(`"${subscription.name}": ${run.postsArchived} posts archived`);
      }
      // Handle failure
      else if (run.status === 'failed') {
        subscription.state.pendingRunId = null;
        this.cache.set(subscriptionId, subscription);
        this.emitEvent({ type: 'subscription:run:failed', subscription, run });

        new Notice(`"${subscription.name}": Archive run failed - ${run.error || 'Unknown error'}`, 10000);
      }
    } catch (error) {
      this.logger?.debug('Failed to check run status', { subscriptionId, runId });
    }
  }

  // --------------------------------------------------------------------------
  // Private Methods - Network Handling
  // --------------------------------------------------------------------------

  private handleOnline = async (): Promise<void> => {
    this.logger?.info('Network online, refreshing subscriptions');
    this.isOnline = true;

    try {
      await this.refresh();
    } catch (error) {
      this.logger?.error('Failed to refresh on reconnection', error as Error);
    }
  };

  private handleOffline = (): void => {
    this.logger?.info('Network offline');
    this.isOnline = false;
  };

  private async processPendingOperations(): Promise<void> {
    if (this.pendingOperations.length === 0) {
      return;
    }

    this.logger?.info('Processing pending operations', {
      count: this.pendingOperations.length
    });

    const operations = [...this.pendingOperations];
    this.pendingOperations = [];

    for (const operation of operations) {
      try {
        await operation();
      } catch (error) {
        this.logger?.error('Pending operation failed', error as Error);
        // Re-queue to retry on next reconnect
        this.pendingOperations.push(operation);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Private Methods - Helpers
  // --------------------------------------------------------------------------

  private enqueueOperation(operation: () => Promise<void>): void {
    this.pendingOperations.push(operation);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SubscriptionManager not initialized. Call initialize() first.');
    }
  }

  private validateCreateInput(input: CreateSubscriptionInput): void {
    if (!input.name || input.name.trim().length === 0) {
      throw new SubscriptionValidationError('Name is required');
    }
    if (input.name.length > 100) {
      throw new SubscriptionValidationError('Name must be 100 characters or less');
    }
    if (!input.target?.handle) {
      throw new SubscriptionValidationError('Target handle is required');
    }
    // Mastodon handles can include @ and domain parts (e.g., user@mastodon.social)
    // Bluesky handles can include . (e.g., user.bsky.social)
    // Naver cafe member handles include : (e.g., cafe:12345:memberKey)
    if (!/^[a-zA-Z0-9._@:\-]+$/.test(input.target.handle)) {
      throw new SubscriptionValidationError('Invalid handle format');
    }
    if (!SUBSCRIPTION_SUPPORTED_PLATFORMS.includes(input.platform)) {
      throw new SubscriptionValidationError('Unsupported platform for subscriptions');
    }
  }

  private validateExportData(data: unknown): data is SubscriptionExport {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    return (
      typeof d.version === 'string' &&
      typeof d.exportedAt === 'string' &&
      typeof d.count === 'number' &&
      Array.isArray(d.subscriptions)
    );
  }

  private applyUpdates(subscription: Subscription, updates: UpdateSubscriptionInput): Subscription {
    return {
      ...subscription,
      ...updates,
      schedule: {
        ...subscription.schedule,
        ...(updates.schedule || {}),
      },
      destination: {
        ...subscription.destination,
        ...(updates.destination || {}),
      },
      options: {
        ...subscription.options,
        ...(updates.options || {}),
      },
    };
  }

  private emitEvent(event: SubscriptionEvent): void {
    this.events.trigger(event.type, event);
  }
}
