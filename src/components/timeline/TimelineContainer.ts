import { setIcon, Notice, Platform as ObsidianPlatform, requestUrl, TFile, type Vault, type App } from 'obsidian';
import type { PostData, Platform } from '../../types/post';
import type SocialArchiverPlugin from '../../main';
import type { TimelineFilterPreferences } from '../../types/settings';
import { siObsidian, type PlatformIcon as SimpleIcon } from '../../constants/platform-icons';
import {
  getPlatformSimpleIcon as getIconServiceSimpleIcon,
  getPlatformLucideIcon as getIconServiceLucideIcon
} from '../../services/IconService';
import { TIMELINE_PLATFORM_IDS, TIMELINE_PLATFORM_LABELS } from '../../constants/timelinePlatforms';
import { RSS_PLATFORMS_WITH_FEED_DERIVATION, needsFeedUrlDerivation, isSubscriptionSupported } from '../../constants/rssPlatforms';
import { PostDataParser } from './parsers/PostDataParser';
import { FilterSortManager, type FilterState } from './filters/FilterSortManager';
import { FilterPanel } from './filters/FilterPanel';
import { SortDropdown } from './filters/SortDropdown';
import { MediaGalleryRenderer } from './renderers/MediaGalleryRenderer';
import { GalleryViewRenderer } from './renderers/GalleryViewRenderer';
import { CommentRenderer } from './renderers/CommentRenderer';
import { YouTubeEmbedRenderer } from './renderers/YouTubeEmbedRenderer';
import { LinkPreviewRenderer } from './renderers/LinkPreviewRenderer';
import { PostCardRenderer } from './renderers/PostCardRenderer';
import { SeriesCardRenderer } from './renderers/SeriesCardRenderer';
import { YouTubePlayerController } from './controllers/YouTubePlayerController';
import { IntersectionObserverManager } from './managers/IntersectionObserverManager';
import { SkeletonCardRenderer } from './managers/SkeletonCardRenderer';
import { CrawlStatusBanner } from './CrawlStatusBanner';
import { ArchiveProgressBanner } from './ArchiveProgressBanner';
import { TagChipBar } from './filters/TagChipBar';
import { ReaderModeOverlay, type ReaderModeContext } from './reader/ReaderModeOverlay';
import { SeriesGroupingService, type TimelineItem, isSeriesGroup } from '../../services/SeriesGroupingService';
import type { SeriesGroup } from '../../types/series';
import { mount, unmount } from 'svelte';
import PostComposer from './PostComposer.svelte';
import type { SubscriptionDisplay } from '@/types/subscription-ui';
import { extractYouTubeChannelInfo } from '@/services/YouTubeChannelExtractor';
import { isAuthenticated } from '../../utils/auth';
import { WEBTOON_DAILY_CRON_LOCAL } from '@/shared/platforms/definitions';
import { DEFAULT_ARCHIVE_PATH } from '@/shared/constants';
import { PostIndexService, type PostIndexEntry } from '../../services/PostIndexService';
import { SearchIndexService } from '../../services/SearchIndexService';
import { createSVGElement } from '../../utils/dom-helpers';

export interface TimelineContainerProps {
  vault: Vault;
  app: App;
  archivePath: string;
  plugin: SocialArchiverPlugin;
  onUIDelete?: (filePath: string) => void; // Callback when post is deleted via UI
  onUIModify?: (filePath: string) => void; // Callback when post is modified via UI (toggle actions)
}

/**
 * Timeline Container - Pure TypeScript implementation
 * Renders archived social media posts in a chronological timeline
 */
export class TimelineContainer {
  private vault: Vault;
  private app: App;
  private archivePath: string;
  private plugin: SocialArchiverPlugin;
  private containerEl: HTMLElement;

  private posts: PostData[] = [];
  private filteredPosts: PostData[] = [];
  private forceReload: boolean = false; // Flag to force reload (skip cache)

  // Soft refresh mutex to prevent race conditions
  private softRefreshInProgress: boolean = false;
  private softRefreshPending: boolean = false;

  // View mode: 'timeline' or 'gallery'
  private viewMode: 'timeline' | 'gallery' = 'timeline';
  private contentContainer: HTMLElement | null = null;

  // Parser for loading posts from vault
  private postDataParser: PostDataParser;

  // Search UI state
  private searchExpanded: boolean = false;
  private searchInput: HTMLInputElement | null = null;
  private searchContainer: HTMLElement | null = null;
  private searchTimeout: number | null = null;

  // Filter and sort management
  private filterSortManager: FilterSortManager;
  private filterPanel: FilterPanel;
  private sortDropdown: SortDropdown;

  // Renderers
  private mediaGalleryRenderer: MediaGalleryRenderer;
  private commentRenderer: CommentRenderer;
  private youtubeEmbedRenderer: YouTubeEmbedRenderer;
  private linkPreviewRenderer: LinkPreviewRenderer;
  private postCardRenderer: PostCardRenderer;
  private seriesCardRenderer: SeriesCardRenderer;

  // Series grouping service
  private seriesGroupingService: SeriesGroupingService;

  // Store YouTube player controllers for each post
  private youtubeControllers: Map<string, YouTubePlayerController> = new Map();

  // Store scroll position for restoration after reload
  private savedScrollPosition: number = 0;

  // Store cleanup functions for event listeners
  private cleanupFunctions: Array<() => void> = [];

  // PostComposer (Svelte component)
  private composerComponent: any = null;
  private composerContainer: HTMLElement | null = null;

  // Subscription Management UI (Svelte component)
  private isSubscriptionViewActive: boolean = false;
  /** Guard: prevent filterPanel.onRerender from triggering phantom mountAuthorCatalog during renderSubscriptionManagement */
  private isRenderingSubscription: boolean = false;
  private authorCatalogComponent: any = null;
  private authorCatalogContainer: HTMLElement | null = null;
  private cachedAuthHeaders: Record<string, string> | null = null;

  // Author catalog filter state
  private authorSearchQuery: string = '';
  private authorPlatformFilter: Platform[] = [...TIMELINE_PLATFORM_IDS] as Platform[];
  private authorSortBy: 'lastRun' | 'lastRunAsc' | 'lastSeen' | 'lastSeenAsc' | 'nameAsc' | 'nameDesc' | 'archiveCount' | 'archiveCountAsc' = 'lastRun';
  private authorPlatformCounts: Record<string, number> = {};

  // Lazy loading managers
  private observerManager: IntersectionObserverManager;
  private skeletonRenderer: SkeletonCardRenderer;

  // Performance: Post index and search index services
  private postIndexService: PostIndexService;
  private searchIndexService: SearchIndexService;
  private indexEntries: PostIndexEntry[] = [];
  private filteredIndexEntries: PostIndexEntry[] = [];

  // Callback for UI-initiated deletions
  private onUIDelete?: (filePath: string) => void;

  // Callback for UI-initiated modifications
  private onUIModify?: (filePath: string) => void;

  // Loading bar element for inline loading indicator
  private loadingBarEl?: HTMLElement;

  // Track if posts have been rendered at least once
  private hasRenderedPosts = false;

  // Feed render generation token.
  // Prevents stale concurrent renders from appending duplicate timeline feeds.
  private feedRenderGeneration = 0;

  // Crawl status banner component
  private crawlStatusBanner: CrawlStatusBanner | null = null;
  private crawlStatusBannerUnsubscribe: (() => void) | null = null;

  // Archive progress banner component
  private archiveProgressBanner: ArchiveProgressBanner | null = null;
  private archiveProgressBannerUnsubscribe: (() => void) | null = null;

  // Tag chip bar for filtering by user-defined tags
  private tagChipBar: TagChipBar;

  // Reader mode overlay
  private readerModeOverlay: ReaderModeOverlay | null = null;

  constructor(target: HTMLElement, props: TimelineContainerProps) {
    this.containerEl = target;
    this.vault = props.vault;
    this.app = props.app;
    this.archivePath = props.archivePath;
    this.plugin = props.plugin;
    this.onUIDelete = props.onUIDelete;
    this.onUIModify = props.onUIModify;

    this.viewMode = props.plugin.settings.timelineViewMode || 'timeline';

    // Initialize PostDataParser
    this.postDataParser = new PostDataParser(this.vault, this.app);

    // Initialize performance services
    const pluginDir = (this.plugin.manifest as any).dir
      || `.obsidian/plugins/${this.plugin.manifest.id}`;
    this.postIndexService = new PostIndexService(this.vault, this.app, pluginDir);
    this.searchIndexService = new SearchIndexService();

    // Initialize FilterSortManager with plugin settings
    this.filterSortManager = new FilterSortManager(
      this.getInitialFilterState(),
      {
        by: props.plugin.settings.timelineSortBy,
        order: props.plugin.settings.timelineSortOrder
      }
    );

    // Initialize FilterPanel
    this.filterPanel = new FilterPanel(
      (platform) => this.getPlatformSimpleIcon(platform),
      (platform) => this.getLucideIcon(platform),
      () => this.getTimelinePlatformCounts()
    );

    // Initialize SortDropdown
    this.sortDropdown = new SortDropdown(props.plugin);

    // Initialize MediaGalleryRenderer
    this.mediaGalleryRenderer = new MediaGalleryRenderer(
      (path) => {
        // Check if it's an external URL (starts with http:// or https://)
        if (path.startsWith('http://') || path.startsWith('https://')) {
          return path; // Return external URL as-is
        }

        // If path doesn't contain a directory separator, it might be just a filename
        // Try to resolve it to full vault path
        let resolvedPath = path;
        if (!path.includes('/')) {
          // Search for file in vault
          const file = this.app.vault.getFiles().find(f => f.name === path);
          if (file) {
            resolvedPath = file.path;
          }
        }

        // For local paths, use vault resource path
        return this.app.vault.adapter.getResourcePath(resolvedPath);
      }
    );

    // Initialize CommentRenderer
    this.commentRenderer = new CommentRenderer();

    // Initialize YouTubeEmbedRenderer
    this.youtubeEmbedRenderer = new YouTubeEmbedRenderer();

    // Initialize LinkPreviewRenderer
    const workerUrl = this.getWorkerUrl(props.plugin);
    this.linkPreviewRenderer = new LinkPreviewRenderer(workerUrl);

    // Initialize PostCardRenderer
    this.postCardRenderer = new PostCardRenderer(
      this.vault,
      this.app,
      this.plugin,
      this.mediaGalleryRenderer,
      this.commentRenderer,
      this.youtubeEmbedRenderer,
      this.linkPreviewRenderer,
      this.youtubeControllers
    );

    // Initialize TagChipBar for tag-based filtering
    this.tagChipBar = new TagChipBar(async (tagName: string | null) => {
      const filterState = this.filterSortManager.getFilterState();
      filterState.selectedTags.clear();
      if (tagName) {
        filterState.selectedTags.add(tagName);
      }
      this.filterSortManager.updateFilter({ selectedTags: filterState.selectedTags });

      // Phase 3: Use incremental DOM update
      await this.updatePostsFeedIncremental();
    });

    // Wire tag changes from PostCardRenderer to refresh tag chip bar
    this.postCardRenderer.onTagsChanged(() => {
      this.refreshTagChipBar();
    });

    // Set UI delete callback to prevent double refresh AND update cache
    this.postCardRenderer.onUIDelete((filePath: string) => {
      // Check if deleted post is part of a series before removing from cache
      const deletedPost = this.posts.find(p => p.filePath === filePath);
      const isSeriesPost = deletedPost?.series?.id;

      // Remove from in-memory cache to prevent ghost posts after view toggle
      this.posts = this.posts.filter(p => p.filePath !== filePath);
      this.filteredPosts = this.filteredPosts.filter(p => p.filePath !== filePath);

      // Call original callback if provided (prevents double refresh from vault event)
      if (this.onUIDelete) {
        this.onUIDelete(filePath);
      }

      // If deleted post was part of a series, re-render to update series card
      if (isSeriesPost) {
        // Clear series card caches to force rebuild
        this.seriesCardRenderer.clearCaches();

        // Re-render the posts feed to rebuild series groups
        if (this.viewMode === 'gallery') {
          void this.renderGalleryContent();
        } else {
          void this.renderPostsFeed();
        }
      }
    });

    // Set UI modify callback to prevent double refresh on toggle actions
    if (this.onUIModify) {
      this.postCardRenderer.onUIModify(this.onUIModify);
    }

    // Initialize SeriesGroupingService
    this.seriesGroupingService = new SeriesGroupingService(
      this.app,
      props.plugin.settings.seriesCurrentEpisode || {},
      async (state) => {
        // Persist series episode state to plugin settings
        // Use saveSettingsPartial to avoid triggering timeline re-render
        await props.plugin.saveSettingsPartial(
          { seriesCurrentEpisode: state },
          { reinitialize: false, notify: false }
        );
      }
    );

    // Initialize SeriesCardRenderer
    this.seriesCardRenderer = new SeriesCardRenderer(
      this.app,
      this.plugin,
      {
        onEpisodeChange: (seriesId, episode) => {
          this.seriesGroupingService.setCurrentEpisode(seriesId, episode);
        },
        onOpenFile: (filePath) => {
          const file = this.app.vault.getFileByPath(filePath);
          if (file) {
            this.app.workspace.getLeaf().openFile(file);
          }
        },
        renderEpisodeContent: async (container, postData) => {
          // Use a simplified version of PostCardRenderer for episode content
          await this.postCardRenderer.render(container, postData, true);
        },
        getPostData: async (filePath) => {
          const file = this.app.vault.getFileByPath(filePath);
          if (!file) return null;
          return await this.postDataParser.parseFile(file);
        },
        onRefreshNeeded: () => {
          // Refresh timeline when card restoration fails (e.g., after fullscreen exit)
          void this.loadPosts();
        },
        onSeriesDeleted: (filePaths) => {
          // Remove deleted posts from arrays immediately to prevent re-render with stale data
          this.posts = this.posts.filter(p => !p.filePath || !filePaths.includes(p.filePath));
          this.filteredPosts = this.filteredPosts.filter(p => !p.filePath || !filePaths.includes(p.filePath));
        },
        onSubscribeWebtoon: async (seriesId, seriesTitle, seriesUrl, publishDay, thumbnailUrl, authorNames) => {
          await this.subscribeWebtoon(seriesId, seriesTitle, seriesUrl, publishDay, thumbnailUrl, authorNames);
        },
        onUnsubscribeWebtoon: async (subscriptionId) => {
          await this.deleteSubscription(subscriptionId);
        },
        onUIModify: this.onUIModify ? (filePath) => this.onUIModify?.(filePath) : undefined
      }
    );

    // Initialize lazy loading managers
    this.observerManager = new IntersectionObserverManager();
    this.skeletonRenderer = new SkeletonCardRenderer();

    // Setup callbacks
    this.setupCallbacks();

    this.render();
    this.loadPosts();
  }

  /**
   * Build auth headers for API calls
   */
  private getAuthHeaders(): Record<string, string> {
    if (this.cachedAuthHeaders) return this.cachedAuthHeaders;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.plugin.settings.authToken) {
      headers['Authorization'] = `Bearer ${this.plugin.settings.authToken}`;
    }

    this.cachedAuthHeaders = headers;
    return headers;
  }

  /**
   * Fetch subscriptions from worker API
   */
  private async fetchSubscriptions(): Promise<SubscriptionDisplay[]> {
    try {
      const res = await requestUrl({
        url: `${this.plugin.settings.workerUrl}/api/subscriptions`,
        method: 'GET',
        headers: this.getAuthHeaders(),
        throw: false
      });

      if (res.status !== 200) {
        console.warn('[TimelineContainer] Failed to load subscriptions', res.status, res.text);
        return [];
      }

      const data = res.json as { data?: { subscriptions?: any[] } };
      const subs = data?.data?.subscriptions || [];

       if (!subs.length) {
        console.warn('[TimelineContainer] No subscriptions returned from API');
      }

      return subs.map((s) => this.mapSubscriptionToDisplay(s));
    } catch (error) {
      console.error('[TimelineContainer] fetchSubscriptions error', error);
      return [];
    }
  }

  /**
   * Fetch raw subscriptions for PostCardRenderer cache (lightweight)
   */
  private async fetchSubscriptionsForCache(): Promise<Array<{ id: string; platform: string; target: { handle: string; profileUrl?: string } }>> {
    try {
      const res = await requestUrl({
        url: `${this.plugin.settings.workerUrl}/api/subscriptions`,
        method: 'GET',
        headers: this.getAuthHeaders(),
        throw: false
      });

      if (res.status !== 200) {
        return [];
      }

      const data = res.json as { data?: { subscriptions?: any[] } };
      const subs = data?.data?.subscriptions || [];

      // Return minimal data needed for cache
      return subs
        .filter((s: any) => s.enabled) // Only active subscriptions
        .map((s: any) => ({
          id: s.id,
          platform: s.platform,
          target: {
            handle: s.target?.handle || '',
            profileUrl: s.target?.profileUrl
          }
        }));
    } catch (error) {
      console.error('[TimelineContainer] fetchSubscriptionsForCache error', error);
      return [];
    }
  }

  /**
   * Fetch raw subscriptions for AuthorCatalog (returns full API response structure)
   * AuthorCatalog's buildSubscriptionMapFromApi expects raw API data with:
   * - id, name, platform, enabled
   * - handle (or target.handle)
   * - profileUrl (or target.profileUrl)
   * - schedule.cron, schedule.timezone
   * - stats.lastRunAt
   */
  private async fetchSubscriptionsRaw(): Promise<any[]> {
    try {
      const res = await requestUrl({
        url: `${this.plugin.settings.workerUrl}/api/subscriptions`,
        method: 'GET',
        headers: this.getAuthHeaders(),
        throw: false
      });

      if (res.status !== 200) {
        console.warn('[TimelineContainer] Failed to load subscriptions for AuthorCatalog', res.status, res.text);
        return [];
      }

      const data = res.json as { data?: { subscriptions?: any[] } };
      const subs = data?.data?.subscriptions || [];

      if (!subs.length) {
        console.warn('[TimelineContainer] No subscriptions returned from API for AuthorCatalog');
      }

      // Return raw subscriptions without transformation
      return subs;
    } catch (error) {
      console.error('[TimelineContainer] fetchSubscriptionsRaw error', error);
      return [];
    }
  }

  /**
   * Update subscription (pause/resume)
   */
  private async updateSubscription(subscriptionId: string, updates: Partial<SubscriptionDisplay>): Promise<void> {
    await requestUrl({
      url: `${this.plugin.settings.workerUrl}/api/subscriptions/${subscriptionId}`,
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        enabled: updates.enabled
      }),
      throw: false
    });
  }

  /**
   * Trigger manual run
   * For Naver Cafe with localFetchRequired, uses local poller instead of Worker API
   * Sync will happen automatically via WebSocket when webhook arrives
   */
  private async triggerManualRun(subscriptionId: string, author?: any): Promise<void> {
    // Check if this subscription requires local fetch (Naver Blog/Cafe with localFetchRequired: true)
    // Use fetchMode which is set based on naverOptions.subscriptionType in buildSubscriptionMapFromApi
    const isLocalFetch = author?.fetchMode === 'local';

    if (isLocalFetch) {
      // Use NaverSubscriptionPoller for local fetch (both Blog and Cafe)
      const poller = this.plugin.naverPoller;
      if (poller) {
        await poller.runSingleSubscription(subscriptionId);
        return;
      }
      // If poller not available, fall through to Worker API (may fail)
    }

    const response = await requestUrl({
      url: `${this.plugin.settings.workerUrl}/api/subscriptions/${subscriptionId}/run`,
      method: 'POST',
      headers: this.getAuthHeaders(),
      throw: false
    });

    if (response.status !== 200) {
      return;
    }
  }

  /**
   * Delete subscription
   */
  private async deleteSubscription(subscriptionId: string): Promise<void> {
    const response = await requestUrl({
      url: `${this.plugin.settings.workerUrl}/api/subscriptions/${subscriptionId}`,
      method: 'DELETE',
      headers: this.getAuthHeaders(),
      throw: false
    });

    // Handle 404 as "already deleted" - don't throw error
    if (response.status === 404) {
      return;
    }

    if (response.status !== 200) {
      const errorData = response.json || {};
      throw new Error(errorData?.error?.message || `Failed to delete subscription: ${response.status}`);
    }
  }

  /**
   * Subscribe to a webtoon series
   */
  private async subscribeWebtoon(
    seriesId: string,
    seriesTitle: string,
    seriesUrl: string,
    publishDay?: string,
    thumbnailUrl?: string,
    authorNames?: string
  ): Promise<void> {
    if (!this.plugin.subscriptionManager) {
      throw new Error('Subscription manager not initialized');
    }

    // Ensure seriesId is a string (may be number from YAML frontmatter)
    const titleId = String(seriesId);

    // Detect platform from URL
    const isWebtoonsGlobal = seriesUrl.includes('webtoons.com');
    const platform = isWebtoonsGlobal ? 'webtoons' : 'naver-webtoon';

    // Use daily check at 23:45 KST for Naver Webtoon
    // For WEBTOON Global, use the publish day if available
    const cronSchedule = WEBTOON_DAILY_CRON_LOCAL;

    if (isWebtoonsGlobal) {
      // WEBTOON Global subscription
      // Parse URL to extract additional info
      const urlMatch = seriesUrl.match(/webtoons\.com\/([a-z]{2})\/([^/]+)\/([^/]+)/);
      const language = urlMatch?.[1] || 'en';
      const genre = urlMatch?.[2] || 'romance';
      const seriesSlug = urlMatch?.[3] || seriesTitle.toLowerCase().replace(/\s+/g, '-');

      const subscription = await this.plugin.subscriptionManager.addSubscription({
        name: seriesTitle,
        platform: platform as any,
        target: {
          handle: titleId,
          profileUrl: seriesUrl,
        },
        schedule: {
          cron: cronSchedule,
          timezone: 'UTC', // WEBTOON Global uses UTC
        },
        options: {
          maxPostsPerRun: 5,
          backfillDays: 0,
        },
        webtoonsOptions: {
          titleNo: titleId,
          seriesTitle: seriesTitle,
          language: language,
          genre: genre,
          seriesSlug: seriesSlug,
          updateDay: publishDay?.toUpperCase(),
          thumbnailUrl: thumbnailUrl,
          authorNames: authorNames,
        },
      });

      if (!subscription) {
        throw new Error('Failed to create subscription');
      }
    } else {
      // Naver Webtoon subscription
      const subscription = await this.plugin.subscriptionManager.addSubscription({
        name: seriesTitle,
        platform: platform as any,
        target: {
          handle: titleId,
          profileUrl: seriesUrl,
        },
        schedule: {
          cron: cronSchedule,
          timezone: 'Asia/Seoul',
        },
        options: {
          maxPostsPerRun: 5,
          backfillDays: 0,
        },
        naverWebtoonOptions: {
          titleId: titleId,
          titleName: seriesTitle,
          publishDay: publishDay || '토요웹툰',
        },
      });

      if (!subscription) {
        throw new Error('Failed to create subscription');
      }
    }

    new Notice(`Subscribed to ${seriesTitle}`);
  }

  /**
   * Fetch run history for a subscription
   */
  private async fetchRunHistory(subscriptionId: string): Promise<any[]> {
    try {
      const response = await requestUrl({
        url: `${this.plugin.settings.workerUrl}/api/subscriptions/${subscriptionId}/runs?limit=20`,
        method: 'GET',
        headers: this.getAuthHeaders(),
        throw: false
      });

      if (response.status !== 200) {
        console.warn('[TimelineContainer] Failed to fetch run history:', response.status);
        return [];
      }

      const data = response.json;
      return data?.data?.runs || [];
    } catch (error) {
      console.error('[TimelineContainer] fetchRunHistory error', error);
      return [];
    }
  }

  /**
   * Map worker subscription to display model
   */
  private mapSubscriptionToDisplay(sub: any): SubscriptionDisplay {
    const handle = sub?.target?.handle || sub?.target?.profileUrl || '';
    const lastRunAt = sub?.state?.lastRunAt || null;
    const enabled = Boolean(sub?.enabled);

    return {
      id: sub?.id,
      name: sub?.name || handle || 'Subscription',
      platform: sub?.platform || 'instagram',
      handle,
      profileUrl: sub?.target?.profileUrl || '',
      avatar: sub?.avatar || undefined,
      enabled,
      status: enabled ? 'active' : 'paused',
      schedule: {
        cron: sub?.schedule?.cron || '0 0 * * *',
        timezone: sub?.schedule?.timezone || 'UTC',
        displayText: `Cron ${sub?.schedule?.cron || '0 0 * * *'}`
      },
      stats: {
        totalArchived: sub?.usage?.totalArchived || 0,
        lastRunAt,
        lastRunStatus: sub?.state?.lastRunStatus
      },
      errorMessage: sub?.state?.error,
      errorCount: sub?.state?.failureCount
    };
  }

  /**
   * Get worker URL with mobile fallback
   * On mobile, always use production API since localhost doesn't work
   */
  private getWorkerUrl(plugin: SocialArchiverPlugin): string {
    const configuredUrl = plugin.settings.workerUrl || 'https://social-archiver-api.social-archive.org';

    // On mobile, force production API if localhost is configured
    if (ObsidianPlatform.isMobile && configuredUrl.includes('localhost')) {
      return 'https://social-archiver-api.social-archive.org';
    }

    return configuredUrl;
  }

  /**
   * Setup callbacks for filter and sort changes
   */
  private setupCallbacks(): void {
    // FilterPanel callbacks
    this.filterPanel.onFilterChange((filter) => {
      this.filterSortManager.updateFilter(filter);
      this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));
      this.persistFilterPreferences();
    });

    this.filterPanel.onRerender(async () => {
      // In subscription view, remount AuthorCatalog with updated filter state
      // Guard: skip if renderSubscriptionManagement() is in progress (it will mount at the end)
      if (this.isSubscriptionViewActive) {
        if (this.isRenderingSubscription) return;
        await this.mountAuthorCatalog();
        return;
      }

      // Phase 3: Use incremental DOM update for timeline mode
      await this.updatePostsFeedIncremental();
    });

    this.filterPanel.onGetFilterState(() => {
      return this.filterSortManager.getFilterState();
    });

    // SortDropdown callbacks
    this.sortDropdown.onSortChange((sort) => {
      this.filterSortManager.updateSort(sort);
      this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));
    });

    this.sortDropdown.onRerender(async () => {
      // Don't re-render posts when in subscription view
      if (this.isSubscriptionViewActive) {
        return;
      }

      // Phase 3: Use incremental DOM update (sort changes always trigger reorder → full re-render)
      await this.updatePostsFeedIncremental();
    });

    // PostCardRenderer callbacks
    this.postCardRenderer.onArchiveToggle((post, newArchiveStatus, cardElement) => {
      this.handleArchiveToggle(post, newArchiveStatus, cardElement);
    });

    this.postCardRenderer.onEditPost((post, filePath) => {
      this.openEditMode(post, filePath);
    });

    this.postCardRenderer.onHashtagClick((hashtag) => {
      this.handleHashtagClick(hashtag);
    });

    this.postCardRenderer.onViewAuthor((authorUrl, platform) => {
      this.handleViewAuthor(authorUrl, platform);
    });

    this.postCardRenderer.onSubscribeAuthor(async (author) => {
      await this.subscribeToAuthor(author);
    });

    this.postCardRenderer.onUnsubscribeAuthor(async (subscriptionId, authorName, authorUrl, platform) => {
      await this.unsubscribeFromAuthor(subscriptionId, authorName, authorUrl, platform);
    });

    this.postCardRenderer.onReaderMode((post) => {
      this.openReaderMode(post);
    });
  }

  /**
   * Handle hashtag click event from PostCardRenderer
   * Sets the timeline search to the clicked hashtag
   */
  private handleHashtagClick(hashtag: string): void {
    // Expand search bar if not already expanded
    if (!this.searchExpanded && this.searchContainer) {
      this.searchExpanded = true;
      this.searchContainer.addClass('tc-search-expanded');
      this.searchContainer.removeClass('tc-search-collapsed');
    }

    // Set search input value with # prefix
    if (this.searchInput) {
      this.searchInput.value = `#${hashtag}`;

      // Trigger search
      const inputEvent = new Event('input', { bubbles: true });
      this.searchInput.dispatchEvent(inputEvent);

      // Focus the search input after a brief delay (to ensure expansion animation completes)
      setTimeout(() => {
        this.searchInput?.focus();
      }, 100);

      // Scroll to top to show results
      this.containerEl.scrollTop = 0;
    }
  }

  /**
   * Handle view author event from PostCardRenderer
   * Switches to Author Catalog view and filters to show the specific author
   */
  private async handleViewAuthor(authorUrl: string, platform: Platform): Promise<void> {
    // Set the author search query to filter to this specific author
    this.authorSearchQuery = authorUrl;

    // Switch to subscription management view if not active
    if (!this.isSubscriptionViewActive) {
      this.isSubscriptionViewActive = true;
      this.syncFiltersTimelineToAuthor();
      await this.renderSubscriptionManagement();
    } else {
      // Re-mount AuthorCatalog with the search query
      await this.mountAuthorCatalog();
    }

    // Show notice
    new Notice('Switched to Author Catalog');
  }

  /**
   * Handle archive toggle event from PostCardRenderer
   * If the post is archived and includeArchived filter is false, remove the card with animation
   */
  private handleArchiveToggle(post: PostData, newArchiveStatus: boolean, cardElement: HTMLElement): void {
    const filterState = this.filterSortManager.getFilterState();

    // If post is archived and includeArchived filter is false, remove the card
    if (newArchiveStatus && !filterState.includeArchived) {
      // Animate card removal (fade out and slide up)
      cardElement.addClass('tc-card-removing');

      // Remove from DOM after animation
      setTimeout(() => {
        cardElement.remove();

        // Update filteredPosts array
        const index = this.filteredPosts.findIndex(p => p.id === post.id);
        if (index !== -1) {
          this.filteredPosts.splice(index, 1);
        }

        // If no posts left, show empty state
        if (this.filteredPosts.length === 0) {
          this.renderEmpty();
        }
      }, 300);
    }
  }

  private async render(): Promise<void> {
    // Add Tailwind classes individually
    this.containerEl.className = 'w-full h-full overflow-y-auto p-4 tc-bg-primary';

    if (this.viewMode === 'gallery') {
      await this.renderGalleryView();
    } else {
      this.renderLoading();
    }
  }

  private renderLoading(): void {
    // If posts have been rendered before, show inline loading bar instead of full screen
    if (this.hasRenderedPosts) {
      this.showInlineLoadingBar();
      return;
    }

    // First time loading - show full screen loading
    this.containerEl.empty();

    const loading = this.containerEl.createDiv({
      cls: 'flex flex-col items-center justify-center min-h-[300px] text-[var(--text-muted)]'
    });

    loading.createDiv({ cls: 'timeline-loading-spinner' });
    loading.createEl('p', {
      text: 'Loading archived posts...',
      cls: 'mt-4'
    });
  }

  /**
   * Show inline loading bar at the top of timeline (for reloads)
   */
  private showInlineLoadingBar(): void {
    // Remove existing loading bar if any
    this.removeLoadingBar();

    // Create loading bar container
    this.loadingBarEl = document.createElement('div');
    this.loadingBarEl.className = 'timeline-inline-loading';
    this.loadingBarEl.addClass('sa-sticky');
    this.loadingBarEl.addClass('sa-top-0');
    this.loadingBarEl.addClass('sa-z-100');
    this.loadingBarEl.addClass('sa-bg-primary');
    this.loadingBarEl.addClass('sa-px-16');
    this.loadingBarEl.addClass('sa-py-8');
    this.loadingBarEl.addClass('sa-flex-row');
    this.loadingBarEl.addClass('sa-gap-8');
    this.loadingBarEl.addClass('sa-border-b');
    this.loadingBarEl.addClass('sa-text-base');
    this.loadingBarEl.addClass('sa-text-muted');

    // Spinner
    const spinner = document.createElement('div');
    spinner.className = 'timeline-loading-spinner-small';
    spinner.addClass('sa-icon-16');
    spinner.addClass('sa-rounded-full');
    spinner.addClass('tc-spinner-small');
    this.loadingBarEl.appendChild(spinner);

    // Text
    const text = document.createElement('span');
    text.textContent = 'Syncing new posts...';
    this.loadingBarEl.appendChild(text);

    // Insert before the timeline-feed (after header)
    const timelineFeed = this.containerEl.querySelector('.timeline-feed');
    if (timelineFeed) {
      this.containerEl.insertBefore(this.loadingBarEl, timelineFeed);
    } else {
      // Fallback: append to container if feed not found
      this.containerEl.appendChild(this.loadingBarEl);
    }
  }

  /**
   * Remove inline loading bar
   */
  private removeLoadingBar(): void {
    if (this.loadingBarEl) {
      this.loadingBarEl.remove();
      this.loadingBarEl = undefined;
    }
  }

  private renderError(message: string): void {
    this.containerEl.empty();

    const errorDiv = this.containerEl.createDiv({
      cls: 'flex flex-col items-center justify-center min-h-[300px] text-center'
    });

    errorDiv.createEl('p', {
      text: '⚠️',
      cls: 'text-5xl mb-4'
    });

    errorDiv.createEl('p', {
      text: message,
      cls: 'text-[var(--text-muted)] mb-4'
    });

    const retryBtn = errorDiv.createEl('button', {
      text: 'Retry',
      cls: 'px-4 py-2 bg-[var(--interactive-accent)] text-[var(--text-on-accent)] rounded hover:bg-[var(--interactive-accent-hover)] cursor-pointer'
    });
    retryBtn.addEventListener('click', () => this.loadPosts());
  }

  private renderEmpty(): void {
    this.containerEl.empty();

    const emptyDiv = this.containerEl.createDiv({
      cls: 'flex flex-col items-center justify-center text-center text-[var(--text-muted)]'
    });
    emptyDiv.addClass('tc-empty-min-height');

    const iconContainer = emptyDiv.createDiv({
      cls: 'mb-4 text-[var(--text-muted)]'
    });
    setIcon(iconContainer, 'inbox');
    iconContainer.addClass('tc-empty-icon');

    emptyDiv.createEl('h3', {
      text: 'No archived posts yet',
      cls: 'text-xl font-semibold mb-2 text-[var(--text-normal)]'
    });

    emptyDiv.createEl('p', {
      text: 'Archive your first social media post to see it here!',
      cls: 'mb-6'
    });

    // Button container - vertical layout
    const buttonContainer = emptyDiv.createDiv({
      cls: 'flex flex-col items-center gap-3'
    });

    // Show different primary button based on authentication status
    const authenticated = isAuthenticated(this.plugin);

    if (authenticated) {
      // User is authenticated - show Archive button (primary)
      const archiveBtn = buttonContainer.createEl('button', {
        cls: 'px-4 py-2 rounded border border-[var(--background-modifier-border)] text-[var(--text-normal)] hover:border-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] transition-colors cursor-pointer'
      });
      archiveBtn.createEl('span', { text: 'Archive a post' });
      archiveBtn.addEventListener('click', () => {
        this.plugin.openArchiveModal();
      });
    } else {
      // User is not authenticated - show Setup button (primary)
      const setupBtn = buttonContainer.createEl('button', {
        cls: 'px-4 py-2 rounded border border-[var(--background-modifier-border)] text-[var(--text-normal)] hover:border-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] transition-colors cursor-pointer'
      });
      setupBtn.createEl('span', { text: 'Complete setup' });
      setupBtn.addEventListener('click', () => {
        // @ts-ignore - app.setting is available but not typed
        this.app.setting.open();
        // @ts-ignore
        this.app.setting.openTabById(this.plugin.manifest.id);
      });
    }

    // Guide button - always visible (secondary)
    const guideBtn = buttonContainer.createEl('a', {
      cls: 'px-4 py-2 rounded border border-[var(--background-modifier-border)] text-[var(--text-muted)] hover:border-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] transition-colors cursor-pointer no-underline'
    });
    guideBtn.createEl('span', { text: 'View guide' });
    guideBtn.setAttr('href', 'https://docs.social-archive.org');
    guideBtn.setAttr('target', '_blank');
    guideBtn.setAttr('rel', 'noopener noreferrer');
  }

  private renderFilteredEmptyState(): void {
    // Only remove the feed area, keep header/composer intact
    const existingFeed = this.containerEl.querySelector('.timeline-feed');
    if (existingFeed) {
      existingFeed.remove();
    }
    // Also remove gallery view if present
    const existingGallery = this.containerEl.querySelector('.gallery-grid-container');
    if (existingGallery) {
      existingGallery.remove();
    }

    // Check if empty because all tagged posts are archived
    const filterState = this.filterSortManager.getFilterState();
    if (filterState.selectedTags.size > 0 && !filterState.includeArchived) {
      const archivedWithTag = this.posts.filter(post => {
        if (post.archive !== true) return false;
        if (!post.tags || post.tags.length === 0) return false;
        const postTagsLower = post.tags.map(t => t.toLowerCase());
        return Array.from(filterState.selectedTags).some(tag =>
          postTagsLower.includes(tag.toLowerCase())
        );
      });

      if (archivedWithTag.length > 0) {
        this.renderTagArchivedEmptyState(archivedWithTag.length);
        return;
      }
    }

    // Check if empty because matching archived posts are hidden
    if (filterState.searchQuery && filterState.searchQuery.trim().length > 0 && !filterState.includeArchived) {
      const query = filterState.searchQuery.trim();
      const archivedEntries = this.indexEntries.filter(e => e.archive);

      let archivedMatchCount = 0;
      if (this.searchIndexService && archivedEntries.length > 0) {
        // Use inverted index for O(1) search
        const matchingPaths = this.searchIndexService.search(query);
        const archivedPaths = new Set(archivedEntries.map(e => e.filePath));
        archivedMatchCount = [...matchingPaths].filter(p => archivedPaths.has(p)).length;
      } else if (archivedEntries.length > 0) {
        // Fallback: linear scan
        const queryLower = query.toLowerCase();
        archivedMatchCount = archivedEntries.filter(e => e.searchText.includes(queryLower)).length;
      }

      if (archivedMatchCount > 0) {
        this.renderSearchArchivedEmptyState(archivedMatchCount);
        return;
      }
    }

    const wrapper = this.containerEl.createDiv({
      cls: 'flex flex-col items-center justify-center min-h-[300px] text-center text-[var(--text-muted)] gap-3 max-w-2xl mx-auto timeline-feed'
    });

    wrapper.createEl('p', {
      text: '🔍',
      cls: 'text-4xl mb-2'
    });

    wrapper.createEl('h3', {
      text: 'No posts match the current filters',
      cls: 'text-lg font-semibold text-[var(--text-normal)]'
    });

    wrapper.createEl('p', {
      text: 'Adjust or reset your filters to see all archived posts again.'
    });

    const resetBtn = wrapper.createEl('button', {
      text: 'Reset filters',
      cls: 'px-4 py-2 rounded border border-[var(--interactive-accent)] text-[var(--interactive-accent)] hover:bg-[var(--interactive-accent)] hover:text-[var(--text-on-accent)] transition-colors cursor-pointer'
    });

    resetBtn.addEventListener('click', async () => {
      this.filterSortManager.resetFilters(this.getDefaultFilterState());
      this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));
      this.persistFilterPreferences();
      this.updateFilterButtonState?.();
      this.updateSearchButtonState?.();

      if (this.filteredPosts.length === 0) {
        if (this.posts.length === 0) {
          this.renderEmpty();
        } else if (this.viewMode === 'gallery') {
          await this.renderGalleryView();
        } else {
          await this.renderPosts();
        }
      } else {
        if (this.viewMode === 'gallery') {
          await this.renderGalleryView();
        } else {
          await this.renderPosts();
        }
      }
    });
  }

  /**
   * Render empty state when all posts matching selected tag(s) are archived.
   * Offers a button to include archived posts in the filter.
   */
  private renderTagArchivedEmptyState(archivedCount: number): void {
    const wrapper = this.containerEl.createDiv({
      cls: 'flex flex-col items-center justify-center min-h-[300px] text-center text-[var(--text-muted)] gap-3 max-w-2xl mx-auto timeline-feed'
    });

    wrapper.createEl('p', {
      text: '📦',
      cls: 'text-4xl mb-2'
    });

    wrapper.createEl('h3', {
      text: 'All matching posts are archived',
      cls: 'text-lg font-semibold text-[var(--text-normal)]'
    });

    const tagNames = Array.from(this.filterSortManager.getFilterState().selectedTags);
    const tagLabel = tagNames.length === 1
      ? `"${tagNames[0]}"`
      : `${tagNames.length} selected tags`;

    wrapper.createEl('p', {
      text: `${archivedCount} post${archivedCount !== 1 ? 's' : ''} with ${tagLabel} ${archivedCount !== 1 ? 'are' : 'is'} archived and currently hidden.`
    });

    const buttonRow = wrapper.createDiv({
      cls: 'flex items-center gap-3 mt-2'
    });

    const includeBtn = buttonRow.createEl('button', {
      text: 'Include archived',
      cls: 'px-4 py-2 rounded bg-[var(--interactive-accent)] text-[var(--text-on-accent)] hover:opacity-90 transition-colors cursor-pointer'
    });

    includeBtn.addEventListener('click', async () => {
      this.filterSortManager.updateFilter({ includeArchived: true });
      this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));
      this.persistFilterPreferences();
      this.updateFilterButtonState?.();

      if (this.viewMode === 'gallery') {
        await this.renderGalleryContent();
      } else {
        await this.renderPostsFeed();
      }
    });

    const resetBtn = buttonRow.createEl('button', {
      text: 'Reset filters',
      cls: 'px-4 py-2 rounded border border-[var(--interactive-accent)] text-[var(--interactive-accent)] hover:bg-[var(--interactive-accent)] hover:text-[var(--text-on-accent)] transition-colors cursor-pointer'
    });

    resetBtn.addEventListener('click', async () => {
      this.filterSortManager.resetFilters(this.getDefaultFilterState());
      this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));
      this.persistFilterPreferences();
      this.updateFilterButtonState?.();
      this.updateSearchButtonState?.();

      if (this.filteredPosts.length === 0) {
        if (this.posts.length === 0) {
          this.renderEmpty();
        } else if (this.viewMode === 'gallery') {
          await this.renderGalleryView();
        } else {
          await this.renderPosts();
        }
      } else {
        if (this.viewMode === 'gallery') {
          await this.renderGalleryView();
        } else {
          await this.renderPosts();
        }
      }
    });
  }

  /**
   * Render empty state when search results are empty but archived posts match the query.
   * Offers buttons to include archived posts or clear the search.
   */
  private renderSearchArchivedEmptyState(archivedCount: number): void {
    const wrapper = this.containerEl.createDiv({
      cls: 'flex flex-col items-center justify-center min-h-[300px] text-center text-[var(--text-muted)] gap-3 max-w-2xl mx-auto timeline-feed'
    });

    wrapper.createEl('p', { text: '🔍', cls: 'text-4xl mb-2' });
    wrapper.createEl('h3', {
      text: 'Matching posts are in archives',
      cls: 'text-lg font-semibold text-[var(--text-normal)]'
    });

    const query = this.filterSortManager.getFilterState().searchQuery;
    wrapper.createEl('p', {
      text: `${archivedCount} post${archivedCount !== 1 ? 's' : ''} matching "${query}" ${archivedCount !== 1 ? 'are' : 'is'} archived and currently hidden.`
    });

    const buttonRow = wrapper.createDiv({ cls: 'flex items-center gap-3 mt-2' });

    // "Include archived" button
    const includeBtn = buttonRow.createEl('button', {
      text: 'Include archived',
      cls: 'px-4 py-2 rounded bg-[var(--interactive-accent)] text-[var(--text-on-accent)] hover:opacity-90 transition-colors cursor-pointer'
    });
    includeBtn.addEventListener('click', async () => {
      this.filterSortManager.updateFilter({ includeArchived: true });
      this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));
      this.persistFilterPreferences();
      this.updateFilterButtonState?.();
      if (this.viewMode === 'gallery') {
        await this.renderGalleryContent();
      } else {
        await this.renderPostsFeed();
      }
    });

    // "Clear search" button
    const clearBtn = buttonRow.createEl('button', {
      text: 'Clear search',
      cls: 'px-4 py-2 rounded border border-[var(--interactive-accent)] text-[var(--interactive-accent)] hover:bg-[var(--interactive-accent)] hover:text-[var(--text-on-accent)] transition-colors cursor-pointer'
    });
    clearBtn.addEventListener('click', async () => {
      this.filterSortManager.updateFilter({ searchQuery: '' });
      if (this.searchInput) this.searchInput.value = '';
      this.persistFilterPreferences();
      this.updateSearchButtonState?.();
      await this.updatePostsFeedIncremental();
    });
  }

  /**
   * Render PostComposer (Svelte component) at the top
   */
  private renderPostComposer(): void {
    // Unmount previous instance if exists
    if (this.composerComponent) {
      unmount(this.composerComponent);
      this.composerComponent = null;
    }

    // Create container for PostComposer
    this.composerContainer = this.containerEl.createDiv({
      cls: 'max-w-2xl mx-auto mb-6'
    });

    // Mount Svelte PostComposer
    // Use optional getter to avoid throwing when not configured
    const orchestrator = this.plugin.archiveOrchestratorOptional;

    this.composerComponent = mount(PostComposer, {
      target: this.composerContainer,
      props: {
        app: this.app,
        settings: this.plugin.settings,
        archiveOrchestrator: orchestrator,
        onPostCreated: async (post: PostData): Promise<string> => {
          try {
            // Import VaultStorageService
            const { VaultStorageService } = await import('../../services/VaultStorageService');

            // Initialize storage service
            const storageService = new VaultStorageService({
              app: this.app,
              vault: this.vault,
              settings: this.plugin.settings
            });

            // Extract media files from post
            const mediaFiles: File[] = [];
            if (post.media) {
              for (const media of post.media) {
                // @ts-ignore - File object is attached in PostComposer
                if (media.file) {
                  // @ts-ignore - File object is attached in PostComposer
                  mediaFiles.push(media.file);
                }
              }
            }

            // Save post to vault
            const saveResult = await storageService.savePost(post, mediaFiles);

            // Check if user wants to share on post
            // @ts-ignore - shareOnPost is temporary property
            if (post.shareOnPost) {
              try {
                // Get the file we just saved
                const file = this.vault.getFileByPath(saveResult.path);
                if (file) {
                  // Re-parse the saved file to get final PostData with correct media paths
                  const { PostDataParser } = await import('../timeline/parsers/PostDataParser');
                  const parser = new PostDataParser(this.vault, this.app);
                  const finalPostData = await parser.parseFile(file);

                  if (!finalPostData) {
                    throw new Error('Failed to parse saved post');
                  }

                  // Import ShareAPIClient
                  const { ShareAPIClient } = await import('../../services/ShareAPIClient');

                  // Create share API client with Vault access
                  const shareClient = new ShareAPIClient({
                    baseURL: this.plugin.settings.workerUrl,
                    apiKey: this.plugin.settings.licenseKey,
                    vault: this.vault,
                    pluginVersion: this.plugin.manifest.version
                  });

                  // STEP 1: Create initial share without media (to get shareId)
                  const initialShareResult = await shareClient.createShare({
                    postData: {
                      ...finalPostData,
                      media: [] // Empty media initially
                    },
                    options: {
                      username: this.plugin.settings.username
                    }
                  });

                  // Validate share result
                  if (!initialShareResult?.shareId || !initialShareResult?.shareUrl) {
                    throw new Error('Share API returned invalid data');
                  }

                  // STEP 2: Update share with media (uploads to R2)
                  if (finalPostData.media && finalPostData.media.length > 0) {
                    await shareClient.updateShareWithMedia(
                      initialShareResult.shareId,
                      finalPostData,
                      {
                        username: this.plugin.settings.username,
                        tier: this.plugin.settings.tier
                      }
                    );
                  }

                  // STEP 3: Update YAML frontmatter with share data
                  const fileContent = await this.vault.read(file);
                  const updatedContent = this.updateFrontmatterWithShare(
                    fileContent,
                    initialShareResult.shareId,
                    initialShareResult.shareUrl
                  );
                  await this.vault.modify(file, updatedContent);

                  new Notice('Post shared to web!');
                } else {
                }
              } catch (shareErr) {
                new Notice('Post saved but sharing failed. You can share it later from the post card.');
              }
            }

            // Don't manually render here - let the Vault 'create' event listener handle it
            // This prevents duplicate rendering and link preview issues
            // The TimelineView's vault.on('create') will trigger debouncedRefresh()

            // Show success notice
            new Notice('Post created successfully!');

            // Return file path for archiving updates
            return saveResult.path;
          } catch (err) {

            // Show error notice
            const errorMsg = err instanceof Error ? err.message : 'Failed to save post';
            new Notice(`Failed to save post: ${errorMsg}`);

            // Re-throw so PostComposer knows it failed
            throw err;
          }
        }
      }
    });
  }

  /**
   * Render CrawlStatusBanner component below PostComposer
   * Shows real-time progress for active profile crawl jobs
   */
  private renderCrawlStatusBanner(): void {
    // Clean up previous instance
    this.destroyCrawlStatusBanner();

    // Create container for banner (max-w-2xl to match PostComposer)
    const bannerContainer = this.containerEl.createDiv({
      cls: 'max-w-2xl mx-auto'
    });

    // Initialize CrawlStatusBanner
    this.crawlStatusBanner = new CrawlStatusBanner(bannerContainer);

    // Handle dismiss callback
    this.crawlStatusBanner.onDismiss((jobId) => {
      this.plugin.crawlJobTracker.dismissJob(jobId);
    });

    // Subscribe to job updates
    this.crawlStatusBannerUnsubscribe = this.plugin.crawlJobTracker.onUpdate((jobs) => {
      this.crawlStatusBanner?.update(jobs);
    });

    // Initial render with current jobs
    this.crawlStatusBanner.update(this.plugin.crawlJobTracker.getActiveJobs());
  }

  /**
   * Clean up CrawlStatusBanner resources
   */
  private destroyCrawlStatusBanner(): void {
    if (this.crawlStatusBannerUnsubscribe) {
      this.crawlStatusBannerUnsubscribe();
      this.crawlStatusBannerUnsubscribe = null;
    }
    if (this.crawlStatusBanner) {
      this.crawlStatusBanner.destroy();
      this.crawlStatusBanner = null;
    }
  }

  /**
   * Render the archive progress banner below crawl status banner
   */
  private renderArchiveProgressBanner(): void {
    this.destroyArchiveProgressBanner();

    const bannerContainer = this.containerEl.createDiv({
      cls: 'max-w-2xl mx-auto'
    });

    this.archiveProgressBanner = new ArchiveProgressBanner(bannerContainer);

    this.archiveProgressBanner.onDismiss((jobId) => {
      this.plugin.archiveJobTracker.dismissJob(jobId);
      // Also remove from PendingJobsManager so dismissed jobs don't reappear on reload
      this.plugin.pendingJobsManager.removeJob(jobId).catch(() => {});
    });

    this.archiveProgressBanner.onRetry((jobId) => {
      // Reset the pending job for retry and trigger check
      this.plugin.pendingJobsManager.getJob(jobId).then((job) => {
        if (job) {
          this.plugin.pendingJobsManager.updateJob(job.id, {
            status: 'pending',
            retryCount: 0,
            metadata: { ...job.metadata, lastError: undefined },
          });
          this.plugin.archiveJobTracker.markRetrying(jobId, 0);
          this.plugin.checkPendingJobs?.();
        }
      });
    });

    this.archiveProgressBannerUnsubscribe = this.plugin.archiveJobTracker.onUpdate((jobs) => {
      this.archiveProgressBanner?.update(jobs);
    });

    this.archiveProgressBanner.update(this.plugin.archiveJobTracker.getActiveJobs());
  }

  /**
   * Clean up ArchiveProgressBanner resources
   */
  private destroyArchiveProgressBanner(): void {
    if (this.archiveProgressBannerUnsubscribe) {
      this.archiveProgressBannerUnsubscribe();
      this.archiveProgressBannerUnsubscribe = null;
    }
    if (this.archiveProgressBanner) {
      this.archiveProgressBanner.destroy();
      this.archiveProgressBanner = null;
    }
  }

  /**
   * Render header with filter, sort, search, and refresh controls
   */
  private renderHeader(): HTMLElement {
    const headerWrapper = this.containerEl.createDiv();
    headerWrapper.addClass('sa-mb-4');

    const header = headerWrapper.createDiv();
    header.addClass('sa-flex-between');
    header.addClass('sa-gap-12');
    header.addClass('sa-relative');

    // Left side: Search, Filter, and Sort buttons
    const leftButtons = header.createDiv();
    leftButtons.addClass('sa-flex-row');
    leftButtons.addClass('sa-gap-8');

    // Search button (toggles search bar below)
    this.renderSearchButton(leftButtons);

    // Filter button
    this.renderFilterButton(leftButtons, header);

    // Sort controls - different for Author mode
    if (this.isSubscriptionViewActive) {
      // Render Author sort controls (button + toggle)
      this.renderAuthorSortControls(leftButtons);
    } else {
      // Timeline mode: use regular sort controls
      const sortState = this.filterSortManager.getSortState();
      this.sortDropdown.renderSortControls(leftButtons, sortState);
    }

    // Right side: Archive, View Switcher, Refresh and Settings buttons
    const rightButtons = header.createDiv();
    rightButtons.addClass('sa-flex-row');
    rightButtons.addClass('sa-gap-4');

    // Tag manage, Archive and View Switcher buttons (now also visible in Author mode)
    this.renderArchiveButton(rightButtons);
    this.renderTagManageButton(rightButtons);
    this.renderViewSwitcherButton(rightButtons);

    this.renderSubscriptionButton(rightButtons);
    this.renderSettingsButton(rightButtons);

    // Search bar container (initially hidden, appears below header)
    this.renderSearchBar(headerWrapper);

    return headerWrapper;
  }

  /**
   * Render search button
   */
  private renderSearchButton(parent: HTMLElement): void {
    const searchBtn = parent.createDiv();
    // Mobile: icon-only (square button), Desktop: icon + text
    const isMobile = ObsidianPlatform.isMobile;
    searchBtn.addClass('sa-flex-row');
    searchBtn.addClass('sa-gap-6');
    searchBtn.addClass('sa-rounded-8');
    searchBtn.addClass('sa-bg-transparent');
    searchBtn.addClass('sa-clickable');
    searchBtn.addClass('sa-transition');
    searchBtn.addClass('sa-flex-shrink-0');
    searchBtn.addClass('sa-text-base');
    searchBtn.addClass('sa-text-muted');
    searchBtn.addClass('sa-flex-center');
    searchBtn.setCssProps({ '--sa-height': '40px' });
    searchBtn.addClass('sa-dynamic-height');
    if (isMobile) {
      searchBtn.setCssProps({ '--sa-width': '40px' });
      searchBtn.addClass('sa-dynamic-width');
      searchBtn.addClass('sa-p-0');
    } else {
      searchBtn.addClass('sa-px-12', 'tc-btn-auto-width');
    }
    searchBtn.setAttribute('title', 'Search posts');
    searchBtn.setAttribute('aria-label', 'Search posts');

    const searchIcon = searchBtn.createDiv();
    searchIcon.addClass('sa-icon-16');
    searchIcon.addClass('sa-transition-color');
    setIcon(searchIcon, 'search');

    const searchText = searchBtn.createSpan({ text: 'Search' });
    searchText.addClass('sa-font-medium', 'tc-btn-text');
    if (isMobile) {
      searchText.addClass('sa-hidden');
    }

    // Update button state based on search
    const updateButtonState = () => {
      const hasQuery = this.searchInput && this.searchInput.value.trim().length > 0;
      if (hasQuery || this.searchExpanded) {
        searchBtn.setCssProps({ '--sa-bg': 'var(--interactive-accent)', '--sa-color': 'var(--text-on-accent)' });
        searchBtn.addClass('sa-dynamic-bg', 'sa-dynamic-color');
        searchIcon.setCssProps({ '--sa-color': 'var(--text-on-accent)' });
        searchIcon.addClass('sa-dynamic-color');
      } else {
        searchBtn.removeClass('sa-dynamic-bg');
        searchBtn.addClass('sa-bg-transparent');
        searchBtn.setCssProps({ '--sa-color': 'var(--text-muted)' });
        searchBtn.addClass('sa-dynamic-color');
        searchIcon.setCssProps({ '--sa-color': 'var(--text-muted)' });
        searchIcon.addClass('sa-dynamic-color');
      }
    };

    // Hover effects
    searchBtn.addEventListener('mouseenter', () => {
      if (!this.searchExpanded) {
        searchBtn.removeClass('sa-bg-transparent');
        searchBtn.addClass('sa-bg-hover');
      }
    });

    searchBtn.addEventListener('mouseleave', () => {
      updateButtonState();
    });

    // Toggle search bar on click
    searchBtn.addEventListener('click', () => {
      this.toggleSearchBar();
      updateButtonState();
    });

    // Store update function for later use
    this.updateSearchButtonState = updateButtonState;
  }

  /**
   * Render search bar (full width, below header)
   */
  private renderSearchBar(parent: HTMLElement): void {
    // Search bar container
    this.searchContainer = parent.createDiv();
    this.searchContainer.addClass('sa-mt-12');
    this.searchContainer.addClass('sa-overflow-hidden');
    this.searchContainer.addClass('tc-search-container', 'tc-search-collapsed');

    // Wrapper to add padding for border visibility
    const searchWrapper = this.searchContainer.createDiv();
    searchWrapper.addClass('sa-h-full', 'tc-search-wrapper');

    // Inner container for search input
    const searchInner = searchWrapper.createDiv();
    searchInner.addClass('sa-flex-row');
    searchInner.addClass('sa-p-10');
    searchInner.addClass('sa-px-16');
    searchInner.addClass('sa-rounded-8');
    searchInner.addClass('sa-border');
    searchInner.addClass('sa-h-full', 'tc-search-inner');

    // Search input (no icon, just placeholder)
    const searchPlaceholder = this.isSubscriptionViewActive
      ? 'Search authors by name or handle...'
      : 'Search posts by author, content, hashtags...';

    this.searchInput = searchInner.createEl('input', {
      type: 'text',
      placeholder: searchPlaceholder,
      attr: {
        'aria-label': this.isSubscriptionViewActive ? 'Search authors' : 'Search posts'
      }
    });
    this.searchInput.addClass('sa-flex-1');
    this.searchInput.addClass('sa-w-full');
    this.searchInput.addClass('sa-bg-transparent');
    this.searchInput.addClass('sa-text-normal');
    this.searchInput.addClass('sa-text-md');
    // Override obsidian.css input defaults via CSS class
    this.searchInput.addClass('tc-search-input');

    // Get current search query
    const searchQuery = this.isSubscriptionViewActive
      ? this.authorSearchQuery
      : this.filterSortManager.getFilterState().searchQuery || '';

    this.searchInput.value = searchQuery;

    // If there's a search query, open the search bar automatically
    if (searchQuery && searchQuery.trim().length > 0) {
      this.searchExpanded = true;
      this.searchContainer!.addClass('tc-search-expanded');
      this.searchContainer!.removeClass('tc-search-collapsed');
    }

    // Clear button
    const clearButton = searchInner.createDiv();
    clearButton.addClass('sa-icon-20');
    clearButton.addClass('sa-ml-auto');
    clearButton.addClass('sa-clickable');
    clearButton.addClass('sa-text-muted');
    clearButton.addClass('sa-opacity-0');
    clearButton.addClass('sa-transition-opacity');
    clearButton.addClass('sa-flex-shrink-0');
    setIcon(clearButton, 'x');

    // Update clear button visibility
    const updateClearButton = () => {
      if (this.searchInput && this.searchInput.value.trim().length > 0) {
        clearButton.removeClass('sa-opacity-0');
        clearButton.addClass('sa-opacity-100');
      } else {
        clearButton.removeClass('sa-opacity-100');
        clearButton.addClass('sa-opacity-0');
      }
    };

    // Debounced search handler
    const handleSearch = () => {
      if (this.searchTimeout !== null) {
        window.clearTimeout(this.searchTimeout);
      }

      this.searchTimeout = window.setTimeout(async () => {
        const query = this.searchInput!.value.trim();

        if (this.isSubscriptionViewActive) {
          // Update author search query
          this.authorSearchQuery = query;
          // Keep timeline filter state/prefs in sync with author search immediately
          this.filterSortManager.updateFilter({ searchQuery: query });
          this.persistFilterPreferences();

          // Re-mount AuthorCatalog with new search query
          if (this.authorCatalogComponent) {
            await this.mountAuthorCatalog();
          }
        } else {
          // Update filter state with search query
          this.filterSortManager.updateFilter({ searchQuery: query });
          this.persistFilterPreferences();

          // Phase 3: Use incremental DOM update
          await this.updatePostsFeedIncremental();
        }

        // Update search button state
        this.updateSearchButtonState?.();

        // Update filter button state (search is a filter)
        this.updateFilterButtonState?.();

        this.searchTimeout = null;
      }, 300); // 300ms debounce
    };

    // Input events
    this.searchInput.addEventListener('input', () => {
      updateClearButton();
      handleSearch();
      this.updateSearchButtonState?.();
    });

    // Clear button click
    clearButton.addEventListener('click', () => {
      this.searchInput!.value = '';
      updateClearButton();
      handleSearch();
      this.searchInput?.focus();
    });

    // Keyboard shortcuts
    this.searchInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        // Immediate search on Enter
        if (this.searchTimeout !== null) {
          window.clearTimeout(this.searchTimeout);
          this.searchTimeout = null;
        }
        const query = this.searchInput!.value.trim();
        this.filterSortManager.updateFilter({ searchQuery: query });
        this.persistFilterPreferences();

        // Phase 3: Use incremental DOM update
        await this.updatePostsFeedIncremental();
      } else if (e.key === 'Escape') {
        // Close search bar on Escape
        this.toggleSearchBar();
        this.updateSearchButtonState?.();
      }
    });

    // Initial state
    updateClearButton();

    // Update search button state after render
    this.updateSearchButtonState?.();
  }

  /**
   * Toggle search bar visibility
   */
  private toggleSearchBar(): void {
    this.searchExpanded = !this.searchExpanded;

    if (this.searchExpanded) {
      // Expand search bar - increased height to prevent border clipping
      this.searchContainer!.addClass('tc-search-expanded');
      this.searchContainer!.removeClass('tc-search-collapsed');

      // Focus input after animation (reduced delay for faster feel)
      setTimeout(() => {
        this.searchInput?.focus();
      }, 50);
    } else {
      // Collapse search bar
      this.searchContainer!.addClass('tc-search-collapsed');
      this.searchContainer!.removeClass('tc-search-expanded');

      // Clear search if empty
      if (this.searchInput && this.searchInput.value.trim().length === 0) {
        this.filterSortManager.updateFilter({ searchQuery: '' });
        this.persistFilterPreferences();

        // Phase 3: Use incremental DOM update
        void this.updatePostsFeedIncremental();
      }
    }
  }

  // Helper to store button update functions
  private updateSearchButtonState: (() => void) | undefined;
  private updateFilterButtonState: (() => void) | undefined;


  /**
   * Render filter button
   */
  private renderFilterButton(parent: HTMLElement, header: HTMLElement): void {
    const filterBtn = parent.createDiv();
    // Mobile: icon-only (square button), Desktop: icon + text
    const isMobile = ObsidianPlatform.isMobile;
    filterBtn.addClass('sa-flex-row');
    filterBtn.addClass('sa-gap-6');
    filterBtn.addClass('sa-rounded-8');
    filterBtn.addClass('sa-bg-transparent');
    filterBtn.addClass('sa-clickable');
    filterBtn.addClass('sa-transition');
    filterBtn.addClass('sa-flex-shrink-0');
    filterBtn.addClass('sa-text-base');
    filterBtn.addClass('sa-text-muted');
    filterBtn.addClass('sa-flex-center');
    filterBtn.setCssProps({ '--sa-height': '40px' });
    filterBtn.addClass('sa-dynamic-height');
    if (isMobile) {
      filterBtn.setCssProps({ '--sa-width': '40px' });
      filterBtn.addClass('sa-dynamic-width');
      filterBtn.addClass('sa-p-0');
    } else {
      filterBtn.addClass('sa-px-12', 'tc-btn-auto-width');
    }
    filterBtn.setAttribute('title', 'Filter posts');

    const filterIcon = filterBtn.createDiv();
    filterIcon.addClass('sa-icon-16');
    filterIcon.addClass('sa-transition-color');
    setIcon(filterIcon, 'filter');

    const filterText = filterBtn.createSpan({ text: 'Filter' });
    filterText.addClass('sa-font-medium', 'tc-btn-text');
    if (isMobile) {
      filterText.addClass('sa-hidden');
    }

    // Update filter button based on active filters
    const updateFilterButton = () => {
      // Update platform counts for accurate filter detection
      this.filterSortManager.setPlatformCounts(this.getTimelinePlatformCounts());
      const hasActiveFilters = this.filterSortManager.hasActiveFilters();

      if (hasActiveFilters) {
        filterBtn.setCssProps({ '--sa-bg': 'var(--interactive-accent)', '--sa-color': 'var(--text-on-accent)' });
        filterBtn.addClass('sa-dynamic-bg', 'sa-dynamic-color');
        filterIcon.setCssProps({ '--sa-color': 'var(--text-on-accent)' });
        filterIcon.addClass('sa-dynamic-color');
      } else {
        filterBtn.removeClass('sa-dynamic-bg');
        filterBtn.addClass('sa-bg-transparent');
        filterBtn.setCssProps({ '--sa-color': 'var(--text-muted)' });
        filterBtn.addClass('sa-dynamic-color');
        filterIcon.setCssProps({ '--sa-color': 'var(--text-muted)' });
        filterIcon.addClass('sa-dynamic-color');
      }
    };

    updateFilterButton();

    // Store update function for later use
    this.updateFilterButtonState = updateFilterButton;

    filterBtn.addEventListener('mouseenter', () => {
      if (!this.filterPanel.isOpened) {
        filterBtn.removeClass('sa-bg-transparent');
        filterBtn.addClass('sa-bg-hover');
      }
    });

    filterBtn.addEventListener('mouseleave', () => {
      if (!this.filterPanel.isOpened) {
        updateFilterButton();
      }
    });

    filterBtn.addEventListener('click', () => {
      if (this.isSubscriptionViewActive) {
        // In Author mode, show a simple platform dropdown
        this.showAuthorPlatformFilter(header);
      } else {
        // In Timeline mode, show the full filter panel
        const filterState = this.filterSortManager.getFilterState();
        this.filterPanel.toggle(header, filterState, updateFilterButton);
      }
    });
  }

  /**
   * Render Author sort controls (button + order toggle)
   */
  private renderAuthorSortControls(parent: HTMLElement): void {
    // Sort controls container (group button and toggle tightly)
    const sortControls = parent.createDiv();
    sortControls.addClass('sa-flex-row', 'tc-sort-zero-gap');

    // Sort by button
    this.renderAuthorSortByButton(sortControls);

    // Order toggle button
    this.renderAuthorOrderToggle(sortControls);
  }

  /**
   * Render Author sort by button
   */
  private renderAuthorSortByButton(container: HTMLElement): void {
    const sortByBtn = container.createDiv();
    const isMobile = ObsidianPlatform.isMobile;
    sortByBtn.addClass('sa-flex-row');
    sortByBtn.addClass('sa-gap-6');
    sortByBtn.addClass('sa-bg-transparent');
    sortByBtn.addClass('sa-clickable');
    sortByBtn.addClass('sa-transition');
    sortByBtn.addClass('sa-flex-shrink-0');
    sortByBtn.addClass('sa-text-base');
    sortByBtn.addClass('sa-text-muted');
    sortByBtn.addClass('sa-flex-center');
    sortByBtn.setCssProps({ '--sa-height': '40px' });
    sortByBtn.addClass('sa-dynamic-height', 'tc-sort-by-btn');
    if (isMobile) {
      sortByBtn.addClass('sa-p-0');
    } else {
      sortByBtn.addClass('sa-px-12');
    }

    const sortByIcon = sortByBtn.createDiv();
    sortByIcon.addClass('sa-icon-16');
    sortByIcon.addClass('sa-transition-color');
    setIcon(sortByIcon, 'calendar');

    const sortByText = sortByBtn.createSpan();
    sortByText.addClass('sa-font-medium', 'tc-btn-text');
    if (isMobile) {
      sortByText.addClass('sa-hidden');
    }

    const updateButtonText = () => {
      const labels: Record<string, string> = {
        'lastRun': 'Last Run',
        'lastRunAsc': 'Last Run',
        'nameAsc': 'Name',
        'nameDesc': 'Name',
        'archiveCount': 'Archives',
        'archiveCountAsc': 'Archives'
      };
      sortByText.setText(labels[this.authorSortBy] || 'Latest');
      sortByBtn.setAttribute('title', `Sort by ${labels[this.authorSortBy]?.toLowerCase()}`);
    };

    updateButtonText();

    sortByBtn.addEventListener('mouseenter', () => {
      sortByBtn.removeClass('sa-bg-transparent');
      sortByBtn.addClass('sa-bg-hover');
    });

    sortByBtn.addEventListener('mouseleave', () => {
      sortByBtn.removeClass('sa-bg-hover');
      sortByBtn.addClass('sa-bg-transparent');
    });

    sortByBtn.addEventListener('click', () => {
      this.showAuthorSortDropdown(sortByBtn, updateButtonText);
    });
  }

  /**
   * Render Author order toggle button
   */
  private renderAuthorOrderToggle(container: HTMLElement): void {
    const orderBtn = container.createDiv();
    orderBtn.addClass('sa-flex-center');
    orderBtn.addClass('sa-bg-transparent');
    orderBtn.addClass('sa-clickable');
    orderBtn.addClass('sa-transition');
    orderBtn.addClass('sa-flex-shrink-0');
    orderBtn.setCssProps({ '--sa-width': '40px', '--sa-height': '40px' });
    orderBtn.addClass('sa-dynamic-width', 'sa-dynamic-height', 'tc-order-btn');

    const orderIcon = orderBtn.createDiv();
    orderIcon.addClass('sa-icon-16');
    orderIcon.addClass('sa-text-muted');
    orderIcon.addClass('sa-transition');

    // Track order state separately for each sort type
    let isDescending = this.authorSortBy === 'lastRun' || this.authorSortBy === 'nameDesc' || this.authorSortBy === 'archiveCount';

    const updateOrderButton = () => {
      const iconName = isDescending ? 'arrow-down' : 'arrow-up';
      const title = isDescending ? 'Descending' : 'Ascending';
      orderBtn.setAttribute('title', title);
      orderIcon.empty();
      setIcon(orderIcon, iconName);
    };

    updateOrderButton();

    orderBtn.addEventListener('mouseenter', () => {
      orderBtn.removeClass('sa-bg-transparent');
      orderBtn.addClass('sa-bg-hover');
      orderIcon.removeClass('sa-text-muted');
      orderIcon.addClass('sa-text-accent');
    });

    orderBtn.addEventListener('mouseleave', () => {
      orderBtn.removeClass('sa-bg-hover');
      orderBtn.addClass('sa-bg-transparent');
      orderIcon.removeClass('sa-text-accent');
      orderIcon.addClass('sa-text-muted');
    });

    orderBtn.addEventListener('click', () => {
      // Toggle order for all sort types
      if (this.authorSortBy === 'nameAsc') {
        this.authorSortBy = 'nameDesc';
      } else if (this.authorSortBy === 'nameDesc') {
        this.authorSortBy = 'nameAsc';
      } else if (this.authorSortBy === 'lastRun') {
        this.authorSortBy = 'lastRunAsc';
      } else if (this.authorSortBy === 'lastRunAsc') {
        this.authorSortBy = 'lastRun';
      } else if (this.authorSortBy === 'archiveCount') {
        this.authorSortBy = 'archiveCountAsc';
      } else if (this.authorSortBy === 'archiveCountAsc') {
        this.authorSortBy = 'archiveCount';
      }

      // Update isDescending based on new state
      isDescending = this.authorSortBy === 'lastRun' || this.authorSortBy === 'nameDesc' || this.authorSortBy === 'archiveCount';

      updateOrderButton();

      // Re-mount AuthorCatalog with new sort order
      if (this.authorCatalogComponent) {
        void this.mountAuthorCatalog();
      }
    });
  }

  /**
   * Show Author sort dropdown
   */
  private showAuthorSortDropdown(anchor: HTMLElement, updateButtonText: () => void): void {
    // Check if dropdown already exists
    const existingDropdown = document.querySelector('.author-sort-dropdown');
    if (existingDropdown) {
      existingDropdown.remove();
      return;
    }

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'author-sort-dropdown';
    dropdown.addClass('sa-absolute');
    dropdown.addClass('sa-bg-secondary');
    dropdown.addClass('sa-border');
    dropdown.addClass('sa-rounded-8');
    dropdown.addClass('sa-p-8');
    dropdown.addClass('sa-z-1000');
    dropdown.setCssStyles({ top: `${anchor.getBoundingClientRect().bottom + 8}px`, left: `${anchor.getBoundingClientRect().left}px` });

    const options = [
      { value: 'lastRun', label: 'Last Run' },
      { value: 'nameAsc', label: 'Name' },
      { value: 'archiveCount', label: 'Most Archives' }
    ];

    options.forEach(opt => {
      const option = dropdown.createDiv();
      option.addClass('sa-rounded-4');
      option.addClass('sa-clickable');
      option.addClass('sa-text-base');
      option.addClass('sa-text-normal', 'tc-sort-option');

      option.textContent = opt.label;

      // Highlight current selection
      const isCurrentOption =
        (opt.value === 'nameAsc' && (this.authorSortBy === 'nameAsc' || this.authorSortBy === 'nameDesc')) ||
        (opt.value === this.authorSortBy);

      if (isCurrentOption) {
        option.addClass('sa-bg-hover');
      } else {
        option.addClass('sa-bg-transparent');
      }

      option.addEventListener('mouseenter', () => {
        option.removeClass('sa-bg-transparent');
        option.addClass('sa-bg-hover');
      });

      option.addEventListener('mouseleave', () => {
        if (!isCurrentOption) {
          option.removeClass('sa-bg-hover');
          option.addClass('sa-bg-transparent');
        }
      });

      option.addEventListener('click', () => {
        // Keep the order when switching sort type
        if (opt.value === 'nameAsc') {
          const isCurrentlyDesc = this.authorSortBy === 'nameDesc';
          this.authorSortBy = isCurrentlyDesc ? 'nameDesc' : 'nameAsc';
        } else {
          this.authorSortBy = opt.value as 'lastRun' | 'lastRunAsc' | 'lastSeen' | 'lastSeenAsc' | 'archiveCount' | 'archiveCountAsc';
        }

        updateButtonText();

        // Re-mount AuthorCatalog with new sort criteria
        if (this.authorCatalogComponent) {
          void this.mountAuthorCatalog();
        }

        // Close dropdown
        dropdown.remove();
      });
    });

    // Add to body
    document.body.appendChild(dropdown);

    // Close on outside click
    const closeDropdown = (e: MouseEvent) => {
      if (!dropdown.contains(e.target as Node) && e.target !== anchor) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    };

    // Delay to avoid immediate close
    setTimeout(() => {
      document.addEventListener('click', closeDropdown);
    }, 100);
  }

  /**
   * Show platform filter panel for Author mode
   */
  private showAuthorPlatformFilter(header: HTMLElement): void {
    // Check if panel already exists
    const existingPanel = header.querySelector('.filter-panel');
    if (existingPanel) {
      existingPanel.remove();
      return;
    }

    // Create filter panel (same as Timeline FilterPanel)
    const panel = header.createDiv({ cls: 'filter-panel' });
    panel.addClass('sa-absolute');
    panel.addClass('sa-left-0');
    panel.addClass('sa-z-1000');
    panel.addClass('sa-bg-primary');
    panel.addClass('sa-border');
    panel.addClass('sa-rounded-8');
    panel.addClass('sa-p-16', 'tc-filter-panel');

    // Platform section
    const platformSection = panel.createDiv();
    platformSection.addClass('sa-m-0');

    // Header row with label and toggle all
    const headerRow = platformSection.createDiv();
    headerRow.addClass('sa-flex-between');
    headerRow.addClass('sa-mb-8');
    headerRow.addClass('sa-gap-8');

    const platformLabel = headerRow.createEl('div', { text: 'Platforms' });
    platformLabel.addClass('sa-text-xs');
    platformLabel.addClass('sa-font-semibold');
    platformLabel.addClass('sa-text-muted');
    platformLabel.addClass('tc-platform-label');

    // Toggle all button
    const toggleButton = headerRow.createDiv();
    toggleButton.addClass('sa-icon-32');
    toggleButton.addClass('sa-rounded-6');
    toggleButton.addClass('sa-clickable');
    toggleButton.addClass('sa-bg-transparent');
    toggleButton.addClass('sa-transition');
    toggleButton.addClass('sa-relative');

    const toggleIcon = toggleButton.createDiv();
    toggleIcon.addClass('sa-icon-16');
    toggleIcon.addClass('sa-pointer-none');

    const isAllSelected = this.authorPlatformFilter.length === TIMELINE_PLATFORM_IDS.length;
    setIcon(toggleIcon, isAllSelected ? 'minus-square' : 'check-square');
    toggleIcon.setCssProps({ '--sa-color': isAllSelected ? 'var(--interactive-accent)' : 'var(--text-muted)' });
    toggleIcon.addClass('sa-dynamic-color');
    toggleButton.setAttribute('title', isAllSelected ? 'Clear all platforms' : 'Select all platforms');

    toggleButton.addEventListener('mouseenter', () => {
      toggleButton.addClass('fp-toggle-hover');
      toggleIcon.setCssProps({ '--sa-color': isAllSelected ? 'var(--interactive-accent)' : 'var(--text-normal)' });
    });

    toggleButton.addEventListener('mouseleave', () => {
      toggleButton.removeClass('fp-toggle-hover', 'sa-bg-hover');
      toggleButton.addClass('sa-bg-transparent');
      toggleIcon.setCssProps({ '--sa-color': isAllSelected ? 'var(--interactive-accent)' : 'var(--text-muted)' });
    });

    toggleButton.addEventListener('click', () => {
      // Toggle between all and none
      this.authorPlatformFilter = isAllSelected ? [] : [...TIMELINE_PLATFORM_IDS] as Platform[];
      this.filterSortManager.updateFilter({ platforms: new Set(this.authorPlatformFilter) });
      this.persistFilterPreferences();
      this.updateFilterButtonState?.();

      // Re-mount AuthorCatalog with new filter
      if (this.authorCatalogComponent) {
        void this.mountAuthorCatalog();
      }

      // Re-render panel
      panel.remove();
      this.showAuthorPlatformFilter(header);
    });

    // Platform options grid (same as FilterPanel)
    const platformsGrid = platformSection.createDiv({ cls: 'platforms-grid' });
    platformsGrid.addClass('sa-gap-8', 'tc-platforms-grid');

    // Sort platforms: active (has data) first, then inactive
    const sortedPlatforms = [...TIMELINE_PLATFORM_IDS].sort((a, b) => {
      const aCount = this.authorPlatformCounts[a] || 0;
      const bCount = this.authorPlatformCounts[b] || 0;

      // First sort by has data vs no data
      if (aCount > 0 && bCount === 0) return -1;
      if (aCount === 0 && bCount > 0) return 1;

      // Then sort by count (descending) for active platforms
      if (aCount > 0 && bCount > 0) {
        return bCount - aCount;
      }

      // Keep original order for inactive platforms
      return 0;
    });

    const platforms = sortedPlatforms.map(id => ({
      id,
      label: TIMELINE_PLATFORM_LABELS[id]
    }));

    platforms.forEach(platform => {
      const isSelected = this.authorPlatformFilter.includes(platform.id as Platform);

      // Check if this platform has any authors
      const authorCount = this.authorPlatformCounts[platform.id] || 0;
      const hasAuthors = authorCount > 0;
      const isDisabled = !hasAuthors;

      const checkbox = platformsGrid.createDiv();
      checkbox.addClass('sa-flex-row');
      checkbox.addClass('sa-gap-8');
      checkbox.addClass('sa-p-8');
      checkbox.addClass('sa-rounded-6');
      checkbox.addClass('sa-transition');
      if (isDisabled) {
        checkbox.addClass('tc-cursor-disabled');
      } else {
        checkbox.addClass('sa-clickable');
      }
      if (isSelected) {
        checkbox.addClass('sa-bg-hover');
      } else {
        checkbox.addClass('sa-bg-transparent');
      }
      checkbox.setCssProps({ '--sa-opacity': isDisabled ? '0.4' : '1' });
      checkbox.addClass('sa-dynamic-opacity');

      // Platform icon
      const iconWrapper = checkbox.createDiv();
      iconWrapper.addClass('sa-icon-16');
      iconWrapper.setCssProps({ '--sa-color': isDisabled ? 'var(--text-faint)' : 'var(--text-accent)' });
      iconWrapper.addClass('sa-dynamic-color');

      const icon = this.getPlatformSimpleIcon(platform.id);
      if (icon) {
        const svg = createSVGElement(icon, {
          fill: 'var(--text-accent)',
          width: '100%',
          height: '100%'
        });
        iconWrapper.appendChild(svg);
      } else{
        const lucideIconName = this.getLucideIcon(platform.id);
        setIcon(iconWrapper, lucideIconName);
      }

      const label = checkbox.createSpan({ text: platform.label });
      label.addClass('sa-text-base');
      label.addClass('sa-flex-1');
      if (isDisabled) {
        label.addClass('sa-text-faint');
      }

      const checkIcon = checkbox.createDiv();
      checkIcon.addClass('sa-icon-16');
      if (isSelected) {
        checkIcon.removeClass('sa-hidden');
      } else {
        checkIcon.addClass('sa-hidden');
      }
      setIcon(checkIcon, 'check');

      // Click handler
      checkbox.addEventListener('click', () => {
        // Ignore clicks on disabled platforms
        if (isDisabled) return;

        if (isSelected) {
          // Remove from filter
          this.authorPlatformFilter = this.authorPlatformFilter.filter(p => p !== platform.id);
        } else {
          // Add to filter
          this.authorPlatformFilter = [...this.authorPlatformFilter, platform.id as Platform];
        }
        this.filterSortManager.updateFilter({ platforms: new Set(this.authorPlatformFilter) });
        this.persistFilterPreferences();
        this.updateFilterButtonState?.();

        // Re-mount AuthorCatalog with new filter
        if (this.authorCatalogComponent) {
          void this.mountAuthorCatalog();
        }

        // Re-render panel
        panel.remove();
        this.showAuthorPlatformFilter(header);
      });

      // Hover handlers
      checkbox.addEventListener('mouseenter', () => {
        if (!isSelected && !isDisabled) {
          checkbox.removeClass('sa-bg-transparent');
          checkbox.addClass('sa-bg-secondary');
        }
      });

      checkbox.addEventListener('mouseleave', () => {
        if (!isSelected && !isDisabled) {
          checkbox.removeClass('sa-bg-secondary');
          checkbox.addClass('sa-bg-transparent');
        }
      });
    });

    // Divider
    const divider = panel.createDiv();
    divider.addClass('tc-divider', 'sa-bg-border');

    // Include archived option (same semantics as Timeline filter)
    const includeArchived = this.filterSortManager.getFilterState().includeArchived;
    const archiveOption = panel.createDiv();
    archiveOption.addClass('sa-flex-row');
    archiveOption.addClass('sa-gap-8');
    archiveOption.addClass('sa-p-8');
    archiveOption.addClass('sa-rounded-6');
    archiveOption.addClass('sa-clickable');
    archiveOption.addClass('sa-transition');
    if (includeArchived) {
      archiveOption.addClass('sa-bg-hover');
    } else {
      archiveOption.addClass('sa-bg-transparent');
    }

    const archiveIcon = archiveOption.createDiv();
    archiveIcon.addClass('sa-icon-16');
    setIcon(archiveIcon, 'archive');

    const archiveLabel = archiveOption.createSpan({ text: 'Include archived' });
    archiveLabel.addClass('tc-archive-label');

    const archiveCheckIcon = archiveOption.createDiv();
    archiveCheckIcon.addClass('tc-archive-check');
    if (!includeArchived) {
      archiveCheckIcon.addClass('sa-hidden');
    }
    setIcon(archiveCheckIcon, 'check');

    archiveOption.addEventListener('click', () => {
      const currentState = this.filterSortManager.getFilterState();
      const newIncludeArchived = !currentState.includeArchived;

      this.filterSortManager.updateFilter({ includeArchived: newIncludeArchived });
      this.persistFilterPreferences();
      this.updateFilterButtonState?.();

      if (this.authorCatalogComponent) {
        void this.mountAuthorCatalog();
      }

      // Re-render panel to reflect the updated check state.
      panel.remove();
      this.showAuthorPlatformFilter(header);
    });

    // Close on outside click
    const closePanel = (e: MouseEvent) => {
      if (!panel.contains(e.target as Node)) {
        panel.remove();
        document.removeEventListener('click', closePanel);
      }
    };

    // Delay to avoid immediate close
    setTimeout(() => {
      document.addEventListener('click', closePanel);
    }, 100);
  }

  /**
   * Render tag management button (opens global TagModal)
   */
  private renderTagManageButton(parent: HTMLElement): void {
    const tagBtn = parent.createDiv();
    tagBtn.addClass('sa-action-btn');
    tagBtn.setAttribute('title', 'Manage tags');

    const tagIcon = tagBtn.createDiv();
    tagIcon.addClass('sa-icon-16');
    tagIcon.addClass('sa-text-muted');
    tagIcon.addClass('sa-transition-color');
    setIcon(tagIcon, 'tags');

    tagBtn.addEventListener('mouseenter', () => {
      tagBtn.removeClass('sa-bg-transparent');
      tagBtn.addClass('sa-bg-hover');
      tagIcon.removeClass('sa-text-muted');
      tagIcon.addClass('sa-text-accent');
    });

    tagBtn.addEventListener('mouseleave', () => {
      tagBtn.removeClass('sa-bg-hover');
      tagBtn.addClass('sa-bg-transparent');
      tagIcon.removeClass('sa-text-accent');
      tagIcon.addClass('sa-text-muted');
    });

    tagBtn.addEventListener('click', () => {
      import('./modals/TagModal').then(({ TagModal }) => {
        const tagStore = this.plugin.tagStore;
        if (!tagStore) return;
        const modal = new TagModal(this.plugin.app, tagStore, null, () => {
          this.refreshTagChipBar();
        });
        modal.open();
      });
    });
  }

  /**
   * Render archive button
   */
  private renderArchiveButton(parent: HTMLElement): void {
    const archiveBtn = parent.createDiv();
    archiveBtn.addClass('sa-action-btn');
    archiveBtn.setAttribute('title', 'Archive social media post');

    const archiveIcon = archiveBtn.createDiv();
    archiveIcon.addClass('sa-icon-16');
    archiveIcon.addClass('sa-text-muted');
    archiveIcon.addClass('sa-transition-color');
    setIcon(archiveIcon, 'bookmark-plus');

    archiveBtn.addEventListener('mouseenter', () => {
      archiveBtn.removeClass('sa-bg-transparent');
      archiveBtn.addClass('sa-bg-hover');
      archiveIcon.removeClass('sa-text-muted');
      archiveIcon.addClass('sa-text-accent');
    });

    archiveBtn.addEventListener('mouseleave', () => {
      archiveBtn.removeClass('sa-bg-hover');
      archiveBtn.addClass('sa-bg-transparent');
      archiveIcon.removeClass('sa-text-accent');
      archiveIcon.addClass('sa-text-muted');
    });

    archiveBtn.addEventListener('click', () => {
      // Open archive modal via plugin
      this.plugin.openArchiveModal();
    });
  }

  /**
   * Render view switcher button
   */
  private renderViewSwitcherButton(parent: HTMLElement): void {
    const viewSwitcherBtn = parent.createDiv();
    viewSwitcherBtn.addClass('sa-action-btn');

    const viewIcon = viewSwitcherBtn.createDiv();
    viewIcon.addClass('sa-icon-16');
    viewIcon.addClass('sa-text-muted');
    viewIcon.addClass('sa-transition-color');

    const updateViewButton = () => {
      const isGallery = this.viewMode === 'gallery';
      setIcon(viewIcon, isGallery ? 'list' : 'layout-grid');
      viewSwitcherBtn.setAttribute('title', isGallery ? 'Switch to Timeline' : 'Switch to Media Gallery');
    };
    updateViewButton();

    viewSwitcherBtn.addEventListener('mouseenter', () => {
      viewSwitcherBtn.removeClass('sa-bg-transparent');
      viewSwitcherBtn.addClass('sa-bg-hover');
      viewIcon.removeClass('sa-text-muted');
      viewIcon.addClass('sa-text-accent');
    });

    viewSwitcherBtn.addEventListener('mouseleave', () => {
      viewSwitcherBtn.removeClass('sa-bg-hover');
      viewSwitcherBtn.addClass('sa-bg-transparent');
      viewIcon.removeClass('sa-text-accent');
      viewIcon.addClass('sa-text-muted');
    });

    viewSwitcherBtn.addEventListener('click', async () => {
      // If in Author mode, disable it first when switching to gallery
      if (this.isSubscriptionViewActive) {
        this.isSubscriptionViewActive = false;
        // Sync filters from Author to Timeline
        this.syncFiltersAuthorToTimeline();
      }

      // Toggle view mode
      if (this.viewMode === 'timeline') {
        this.viewMode = 'gallery';
        updateViewButton();
        await this.renderGalleryView();
      } else {
        this.viewMode = 'timeline';
        updateViewButton();
        await this.loadPosts();
      }
      this.persistViewMode();
    });
  }

  /**
   * Render subscription button (toggles subscription management view)
   */
  private renderSubscriptionButton(parent: HTMLElement): void {
    const subscriptionBtn = parent.createDiv();
    subscriptionBtn.addClass('sa-action-btn');

    const subscriptionIcon = subscriptionBtn.createDiv();
    subscriptionIcon.addClass('sa-icon-16');
    subscriptionIcon.addClass('sa-text-muted');
    subscriptionIcon.addClass('sa-transition-color');
    setIcon(subscriptionIcon, 'users');

    // Update button state based on active view
    const updateButtonState = () => {
      if (this.isSubscriptionViewActive) {
        subscriptionBtn.removeClass('sa-bg-transparent');
        subscriptionBtn.addClass('sa-bg-accent');
        subscriptionIcon.removeClass('sa-text-muted');
        subscriptionIcon.addClass('tc-sub-icon-active');
        subscriptionBtn.setAttribute('title', 'Back to timeline');
      } else {
        subscriptionBtn.removeClass('sa-bg-accent');
        subscriptionBtn.addClass('sa-bg-transparent');
        subscriptionIcon.removeClass('tc-sub-icon-active');
        subscriptionIcon.addClass('sa-text-muted');
        subscriptionBtn.setAttribute('title', 'Manage subscriptions');
      }
    };

    updateButtonState();

    subscriptionBtn.addEventListener('mouseenter', () => {
      if (!this.isSubscriptionViewActive) {
        subscriptionBtn.removeClass('sa-bg-transparent');
        subscriptionBtn.addClass('sa-bg-hover');
        subscriptionIcon.removeClass('sa-text-muted');
        subscriptionIcon.addClass('sa-text-accent');
      }
    });

    subscriptionBtn.addEventListener('mouseleave', () => {
      updateButtonState();
    });

    subscriptionBtn.addEventListener('click', async () => {
      this.isSubscriptionViewActive = !this.isSubscriptionViewActive;
      updateButtonState();

      if (this.isSubscriptionViewActive) {
        // Sync filter state from Timeline to Author
        this.syncFiltersTimelineToAuthor();
        await this.renderSubscriptionManagement();
      } else {
        // Sync filter state from Author to Timeline
        this.syncFiltersAuthorToTimeline();
        // Return to posts/gallery view
        if (this.viewMode === 'gallery') {
          await this.renderGalleryView();
        } else {
          await this.loadPosts();
        }
      }
    });
  }

  /**
   * Render settings button
   */
  private renderSettingsButton(parent: HTMLElement): void {
    const settingsBtn = parent.createDiv();
    settingsBtn.addClass('sa-action-btn');
    settingsBtn.setAttribute('title', 'Open plugin settings');

    const settingsIcon = settingsBtn.createDiv();
    settingsIcon.addClass('sa-icon-16');
    settingsIcon.addClass('sa-text-muted');
    settingsIcon.addClass('sa-transition-color');
    setIcon(settingsIcon, 'settings');

    settingsBtn.addEventListener('mouseenter', () => {
      settingsBtn.removeClass('sa-bg-transparent');
      settingsBtn.addClass('sa-bg-hover');
      settingsIcon.removeClass('sa-text-muted');
      settingsIcon.addClass('sa-text-accent');
    });

    settingsBtn.addEventListener('mouseleave', () => {
      settingsBtn.removeClass('sa-bg-hover');
      settingsBtn.addClass('sa-bg-transparent');
      settingsIcon.removeClass('sa-text-accent');
      settingsIcon.addClass('sa-text-muted');
    });

    settingsBtn.addEventListener('click', () => {
      // Open plugin settings tab
      // @ts-ignore - app.setting is available but not typed
      this.app.setting.open();
      // @ts-ignore
      this.app.setting.openTabById(this.plugin.manifest.id);
    });
  }

  /**
   * Derive handle from author data
   * For Reddit subreddits, extracts pure subreddit name without 'r/' prefix
   * For embedded archives with non-ASCII handles, extracts from URL
   */
  private deriveHandle(author: any): string {
    // For Reddit, extract subreddit name from URL path
    if (author.platform === 'reddit' && author.authorUrl) {
      try {
        const url = new URL(author.authorUrl);
        // Reddit subreddit URL format: /r/subredditname
        const match = url.pathname.match(/^\/r\/([a-zA-Z0-9_]+)/);
        if (match && match[1]) {
          return match[1];
        }
      } catch {
        // fall through to other methods
      }
      // If authorName starts with 'r/', strip it
      if (author.authorName && author.authorName.startsWith('r/')) {
        return author.authorName.slice(2);
      }
    }

    // Check if handle is valid (ASCII only, matches server regex)
    const isValidHandle = (h: string): boolean => {
      return /^[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/.test(h);
    };

    // Feedburner: https://feeds.feedburner.com/{feedname}/{id} -> feedname
    if (author.authorUrl) {
      try {
        const url = new URL(author.authorUrl);
        if (url.hostname.includes('feedburner.com')) {
          const segments = url.pathname.split('/').filter(Boolean);
          if (segments[0] && isValidHandle(segments[0])) {
            return segments[0];
          }
        }

        // Custom domain blog with date-based URL pattern
        // Formats: /2025/12/post-title.html, /2025/12/15/post-title, /2025-07-15/post-title
        // Extract domain name as handle instead of post slug
        const dateBasedPattern = /^\/\d{4}\/\d{2}\/(?:\d{2}\/)?[a-z0-9-]+/i;
        const dateSlugPattern = /^\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+/i;  // GitHub Pages format
        if (author.platform === 'blog' && (dateBasedPattern.test(url.pathname) || dateSlugPattern.test(url.pathname))) {
          // For GitHub Pages, use username from hostname (e.g., hyungyunlim from hyungyunlim.github.io)
          if (url.hostname.endsWith('.github.io')) {
            const githubUsername = url.hostname.split('.')[0];
            if (githubUsername && isValidHandle(githubUsername)) {
              return githubUsername;
            }
          }
          // For other custom domains, use first part of hostname (without www/blog prefixes)
          const parts = url.hostname.split('.');
          const cleanParts = parts.filter(p => !['www', 'blog', 'feeds'].includes(p));
          if (cleanParts.length >= 2 && cleanParts[0] && isValidHandle(cleanParts[0])) {
            return cleanParts[0];
          }
        }
      } catch {
        // fall through
      }
    }

    if (author.handle) {
      const cleanHandle = author.handle.replace(/^@/, '');
      // If handle contains non-ASCII characters (e.g., Korean from embedded archives),
      // fall through to extract from URL instead
      if (isValidHandle(cleanHandle)) {
        return cleanHandle;
      }
    }

    // Extract handle from URL
    if (author.authorUrl) {
      try {
        const url = new URL(author.authorUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        const last = parts[parts.length - 1] || '';
        const urlHandle = last.replace(/^@/, '');
        if (urlHandle && isValidHandle(urlHandle)) {
          return urlHandle;
        }
      } catch {
        // fall through
      }
    }

    // Last resort: sanitize authorName
    const sanitized = (author.authorName || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
    return sanitized || 'unknown';
  }

  /**
   * Derive RSS feed URL from author URL for RSS-based platforms
   * - Substack: https://{username}.substack.com/... -> https://{username}.substack.com/feed
   * - Tumblr: https://{username}.tumblr.com/... -> https://{username}.tumblr.com/rss
   * - Blog: Try common RSS patterns or return null
   */
  private deriveRSSFeedUrl(authorUrl: string, platform: string): string | null {
    if (!authorUrl) return null;

    try {
      const url = new URL(authorUrl);

      if (platform === 'substack' || url.hostname.endsWith('.substack.com')) {
        // Substack: https://{username}.substack.com/feed
        return `${url.protocol}//${url.hostname}/feed`;
      }

      if (platform === 'tumblr' || url.hostname.endsWith('.tumblr.com')) {
        // Tumblr: https://{username}.tumblr.com/rss
        return `${url.protocol}//${url.hostname}/rss`;
      }

      // Naver Blog: https://blog.naver.com/{blogId} -> https://rss.blog.naver.com/{blogId}
      if (platform === 'naver' || url.hostname === 'blog.naver.com' || url.hostname === 'm.blog.naver.com') {
        // Extract blogId from pathname (e.g., /yhchang90/12345 -> yhchang90)
        const pathParts = url.pathname.split('/').filter(p => p);
        const blogId = pathParts[0];
        if (blogId && !blogId.includes('.')) {
          return `https://rss.blog.naver.com/${blogId}`;
        }
        return null;
      }
      // Already RSS URL from rss.blog.naver.com
      if (url.hostname === 'rss.blog.naver.com') {
        return authorUrl;
      }

      // Medium: https://medium.com/@username or https://username.medium.com
      if (url.hostname === 'medium.com' || url.hostname === 'www.medium.com') {
        // Extract @username from pathname (e.g., /@xenologue/post-slug -> @xenologue)
        const pathParts = url.pathname.split('/').filter(p => p);
        const userPart = pathParts.find(p => p.startsWith('@'));
        if (userPart) {
          // Medium user feed: https://medium.com/feed/@username
          return `https://medium.com/feed/${userPart}`;
        }
        // Publication feed: https://medium.com/feed/publication-name
        if (pathParts[0] && !pathParts[0].startsWith('@')) {
          return `https://medium.com/feed/${pathParts[0]}`;
        }
        return null;
      }
      if (url.hostname.endsWith('.medium.com') && url.hostname !== 'www.medium.com') {
        // Custom subdomain: https://username.medium.com/feed
        return `${url.protocol}//${url.hostname}/feed`;
      }

      // Velog: https://velog.io/@username or https://v2.velog.io/rss/@username
      if (url.hostname === 'velog.io' || url.hostname === 'www.velog.io') {
        // Extract @username from pathname (e.g., /@kmin-283/post-slug -> @kmin-283)
        const pathParts = url.pathname.split('/').filter(p => p);
        const userPart = pathParts.find(p => p.startsWith('@'));
        if (userPart) {
          // Velog RSS feed: https://v2.velog.io/rss/@username
          return `https://v2.velog.io/rss/${userPart}`;
        }
        return null;
      }
      // Already RSS URL from v2.velog.io
      if (url.hostname === 'v2.velog.io' && url.pathname.startsWith('/rss/')) {
        return authorUrl;
      }

      // GitHub Pages / Jekyll blogs: https://{username}.github.io/feed.xml
      if (url.hostname.endsWith('.github.io')) {
        // Check if it's already an RSS URL
        if (url.pathname.endsWith('/feed.xml') || url.pathname.endsWith('.xml') || url.pathname.includes('/feed')) {
          return authorUrl;
        }
        // For Jekyll on GitHub Pages, check if there's a repo path (project site)
        const pathParts = url.pathname.split('/').filter(p => p);
        const firstPathPart = pathParts[0] || '';
        // Match various Jekyll date formats: /2025/..., /2025-07-15/...
        const isDatePath = /^\d{4}$/.test(firstPathPart) || /^\d{4}-\d{2}-\d{2}/.test(firstPathPart);
        const isCommonPath = ['feed.xml', 'feed', 'rss', 'assets', 'posts', 'tags', 'categories', 'about', 'contact', 'archive', 'archives', 'page', 'blog'].includes(firstPathPart.toLowerCase());

        if (pathParts.length > 0 && !isDatePath && !isCommonPath && firstPathPart.length > 0) {
          // Project site: username.github.io/repo-name → /repo-name/feed.xml
          return `${url.protocol}//${url.hostname}/${firstPathPart}/feed.xml`;
        }
        // User site: username.github.io → /feed.xml
        return `${url.protocol}//${url.hostname}/feed.xml`;
      }

      if (platform === 'blog') {
        // For generic blogs, try common RSS patterns
        // Check if it's already an RSS URL
        if (url.pathname.includes('/feed') || url.pathname.includes('/rss') || url.pathname.endsWith('.xml')) {
          return authorUrl;
        }
        // For date-based blog URLs (Jekyll-style), try /feed.xml first
        const dateBasedPattern = /^\/\d{4}\/\d{2}\/(?:\d{2}\/)?[a-z0-9-]+/i;
        if (dateBasedPattern.test(url.pathname)) {
          return `${url.protocol}//${url.hostname}/feed.xml`;
        }
        // Try /feed as default for other blogs
        return `${url.protocol}//${url.hostname}/feed`;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract author/site name from RSS platform URL
   * - Substack: https://sxcrifice.substack.com/p/... -> sxcrifice
   * - Tumblr: https://example.tumblr.com/... -> example
   * - Medium: https://medium.com/@username/... -> username
   */
  private extractAuthorFromRSSUrl(authorUrl: string, platform: string): string | null {
    if (!authorUrl) return null;

    try {
      const url = new URL(authorUrl);

      if (platform === 'substack' || url.hostname.endsWith('.substack.com')) {
        // Extract subdomain: sxcrifice.substack.com -> sxcrifice
        const parts = url.hostname.split('.');
        if (parts.length >= 3 && parts[parts.length - 2] === 'substack') {
          return parts[0] ?? null;
        }
      }

      if (platform === 'tumblr' || url.hostname.endsWith('.tumblr.com')) {
        // Extract subdomain: example.tumblr.com -> example
        const parts = url.hostname.split('.');
        if (parts.length >= 3 && parts[parts.length - 2] === 'tumblr') {
          return parts[0] ?? null;
        }
      }

      // Medium: https://medium.com/@username/... -> username (without @)
      if (url.hostname === 'medium.com' || url.hostname === 'www.medium.com') {
        const pathParts = url.pathname.split('/').filter(p => p);
        const userPart = pathParts.find(p => p.startsWith('@'));
        if (userPart) {
          return userPart.substring(1); // Remove @ prefix
        }
        // Publication name
        if (pathParts[0] && !pathParts[0].startsWith('@')) {
          return pathParts[0] ?? null;
        }
      }
      // Custom subdomain: username.medium.com -> username
      if (url.hostname.endsWith('.medium.com') && url.hostname !== 'www.medium.com') {
        const parts = url.hostname.split('.');
        if (parts.length >= 3 && parts[parts.length - 2] === 'medium') {
          return parts[0] ?? null;
        }
      }

      // Velog: https://velog.io/@username/... -> username (without @)
      // RSS URL: https://v2.velog.io/rss/@username -> username
      if (url.hostname === 'velog.io' || url.hostname === 'www.velog.io') {
        const pathParts = url.pathname.split('/').filter(p => p);
        const userPart = pathParts.find(p => p.startsWith('@'));
        if (userPart) {
          return userPart.substring(1); // Remove @ prefix
        }
      }
      if (url.hostname === 'v2.velog.io' && url.pathname.startsWith('/rss/')) {
        // RSS URL: /rss/@username or /rss/username
        const rssPath = url.pathname.replace('/rss/', '');
        const username = rssPath.startsWith('@') ? rssPath.substring(1) : rssPath;
        // Remove any trailing path segments
        return username.split('/')[0] ?? null;
      }

      // GitHub Pages / Jekyll: username.github.io -> username
      if (url.hostname.endsWith('.github.io')) {
        const parts = url.hostname.split('.');
        if (parts.length >= 3 && parts[parts.length - 2] === 'github') {
          return parts[0] ?? null;
        }
      }

      // Feedburner: https://feeds.feedburner.com/{feedname}/{id} -> feedname
      if (url.hostname.includes('feedburner.com')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments[0]) {
          return segments[0];
        }
      }

      // Custom domain blog with date-based URL pattern
      // Formats: /2025/12/post-title.html, /2025/12/15/post-title, /2025-07-15/post-title
      // Extract domain name as handle instead of post slug
      const dateBasedPattern = /^\/\d{4}\/\d{2}\/(?:\d{2}\/)?[a-z0-9-]+/i;
      const dateSlugPattern = /^\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+/i;  // GitHub Pages format
      if (platform === 'blog' && (dateBasedPattern.test(url.pathname) || dateSlugPattern.test(url.pathname))) {
        // For GitHub Pages, use username from hostname (e.g., hyungyunlim from hyungyunlim.github.io)
        if (url.hostname.endsWith('.github.io')) {
          const githubUsername = url.hostname.split('.')[0];
          if (githubUsername) {
            return githubUsername;
          }
        }
        // For other custom domains, use first part of hostname (without www/blog prefixes)
        const parts = url.hostname.split('.');
        const cleanParts = parts.filter(p => !['www', 'blog', 'feeds'].includes(p));
        if (cleanParts.length >= 2 && cleanParts[0]) {
          return cleanParts[0];
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract blog ID from Naver blog URL
   * - https://blog.naver.com/{blogId} -> blogId
   * - https://blog.naver.com/{blogId}/{logNo} -> blogId
   * - https://m.blog.naver.com/{blogId}/{logNo} -> blogId
   * - https://rss.blog.naver.com/{blogId}.xml -> blogId
   */
  private extractNaverBlogId(authorUrl: string): string | null {
    if (!authorUrl) return null;

    try {
      const url = new URL(authorUrl);
      const hostname = url.hostname.toLowerCase();
      const pathname = url.pathname;

      // RSS URL: rss.blog.naver.com/{blogId} or rss.blog.naver.com/{blogId}.xml
      if (hostname === 'rss.blog.naver.com') {
        const match = pathname.match(/^\/([A-Za-z0-9_-]+)(?:\.xml)?$/);
        return match?.[1] || null;
      }

      // Blog URL: blog.naver.com/{blogId} or blog.naver.com/{blogId}/{logNo}
      if (hostname === 'blog.naver.com' || hostname === 'm.blog.naver.com') {
        const match = pathname.match(/^\/([A-Za-z0-9_-]+)/);
        return match?.[1] || null;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get base URL (profile URL) from a post URL for RSS platforms
   * - Substack: https://sxcrifice.substack.com/p/... -> https://sxcrifice.substack.com
   * - Tumblr: https://example.tumblr.com/post/... -> https://example.tumblr.com
   * - Medium: https://medium.com/@username/post -> https://medium.com/@username
   * - Velog: https://velog.io/@username/post -> https://velog.io/@username
   * - GitHub Pages: https://username.github.io/2024/... -> https://username.github.io
   * - GitHub Pages (project): https://username.github.io/repo/2024/... -> https://username.github.io/repo
   */
  private deriveRSSBaseUrl(authorUrl: string, platform: string): string {
    if (!authorUrl) return authorUrl;

    try {
      const url = new URL(authorUrl);

      // Naver Blog: Convert RSS URL to blog URL
      // rss.blog.naver.com/blogId -> blog.naver.com/blogId
      // blog.naver.com/blogId -> blog.naver.com/blogId (keep as-is)
      if (url.hostname === 'rss.blog.naver.com' || url.hostname === 'blog.naver.com' || url.hostname === 'm.blog.naver.com') {
        const pathParts = url.pathname.split('/').filter(p => p);
        const blogId = pathParts[0];
        if (blogId && !blogId.includes('.')) {
          return `https://blog.naver.com/${blogId}`;
        }
        return url.origin;
      }

      // Medium needs special handling to include @username in path
      if (url.hostname === 'medium.com' || url.hostname === 'www.medium.com') {
        const pathParts = url.pathname.split('/').filter(p => p);
        const userPart = pathParts.find(p => p.startsWith('@'));
        if (userPart) {
          return `https://medium.com/${userPart}`;
        }
        // Publication
        if (pathParts[0] && !pathParts[0].startsWith('@')) {
          return `https://medium.com/${pathParts[0]}`;
        }
      }

      // Velog needs special handling to include @username in path
      // velog.io/@username/post -> velog.io/@username
      // v2.velog.io/rss/@username -> velog.io/@username
      if (url.hostname === 'velog.io' || url.hostname === 'www.velog.io') {
        const pathParts = url.pathname.split('/').filter(p => p);
        const userPart = pathParts.find(p => p.startsWith('@'));
        if (userPart) {
          return `https://velog.io/${userPart}`;
        }
      }
      if (url.hostname === 'v2.velog.io' && url.pathname.startsWith('/rss/')) {
        // RSS URL: /rss/@username -> velog.io/@username
        const rssPath = url.pathname.replace('/rss/', '');
        const username = rssPath.startsWith('@') ? rssPath : `@${rssPath}`;
        // Remove any trailing path segments
        const cleanUsername = username.split('/')[0];
        if (cleanUsername) {
          return `https://velog.io/${cleanUsername}`;
        }
      }

      // GitHub Pages / Jekyll needs special handling for project sites
      if (url.hostname.endsWith('.github.io')) {
        const pathParts = url.pathname.split('/').filter(p => p);
        const firstPathPart = pathParts[0] || '';
        // Match various Jekyll date formats: /2025/..., /2025-07-15/...
        const isDatePath = /^\d{4}$/.test(firstPathPart) || /^\d{4}-\d{2}-\d{2}/.test(firstPathPart);
        const isCommonPath = ['feed.xml', 'feed', 'rss', 'assets', 'posts', 'tags', 'categories', 'about', 'contact', 'archive', 'archives', 'page', 'blog'].includes(firstPathPart.toLowerCase());

        if (pathParts.length > 0 && !isDatePath && !isCommonPath && firstPathPart.length > 0) {
          // Project site: username.github.io/repo-name
          return `${url.origin}/${firstPathPart}`;
        }
        // User site: just origin
        return url.origin;
      }

      // Return just the origin (protocol + hostname) for subdomain-based platforms
      return url.origin;
    } catch {
      return authorUrl;
    }
  }

  /**
   * Subscribe to an author - reusable method for both AuthorCatalog and Timeline
   */
  private async subscribeToAuthor(author: any): Promise<void> {
    if (!isSubscriptionSupported(author.platform)) {
      new Notice('Subscriptions are only available for Instagram, Facebook, X (Twitter), LinkedIn, Reddit, TikTok, Pinterest, Bluesky, Mastodon, YouTube, Velog, Medium, and RSS-based platforms.');
      throw new Error('Platform not supported');
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentHour = new Date().getHours();

    // Build request body
    const requestBody: any = {
      name: author.authorName,
      platform: author.platform,
      target: {
        handle: this.deriveHandle(author),
        profileUrl: author.authorUrl
      },
      schedule: {
        cron: `0 ${currentHour} * * *`,
        timezone: timezone
      },
      destination: {
        folder: DEFAULT_ARCHIVE_PATH,
        templateId: undefined
      },
      options: {
        maxPostsPerRun: 20,
        backfillDays: 3
      }
    };

    // For YouTube subscriptions, extract channel ID first
    if (author.platform === 'youtube') {
      const profileUrl = author.authorUrl || `https://www.youtube.com/@${this.deriveHandle(author)}`;
      const channelInfo = await extractYouTubeChannelInfo(profileUrl);

      if (!channelInfo) {
        throw new Error('Could not extract YouTube channel ID. Please verify the channel URL is correct.');
      }

      requestBody.youtubeMetadata = {
        channelId: channelInfo.channelId,
        channelName: channelInfo.channelName,
        rssFeedUrl: channelInfo.rssFeedUrl
      };
    }

    // For Naver Cafe subscriptions, use local fetch (not RSS)
    // Cafe member URLs: cafe.naver.com/f-e/cafes/{cafeId}/members/{memberKey}
    let isNaverCafe = false;
    if (author.platform === 'naver' && author.authorUrl) {
      try {
        const url = new URL(author.authorUrl);
        if (url.hostname === 'cafe.naver.com' || url.hostname === 'm.cafe.naver.com') {
          isNaverCafe = true;
          // Extract cafeId and memberKey from URL
          // Pattern: /f-e/cafes/{cafeId}/members/{memberKey} or /ca-fe/cafes/{cafeId}/members/{memberKey}
          const match = url.pathname.match(/\/(?:f-e|ca-fe)\/cafes\/(\d+)\/members\/([^/]+)/);
          if (match) {
            const cafeId = match[1];
            const memberKey = match[2];
            requestBody.target.handle = `cafe:${cafeId}:${memberKey}`;
            requestBody.naverOptions = {
              subscriptionType: 'cafe-member',
              cafeId,
              memberKey,
              localFetchRequired: true,
            };
          } else {
            throw new Error('Could not extract cafe member info from URL. Please use a member profile URL.');
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('Could not extract')) {
          throw e;
        }
        // URL parsing error - continue to RSS handling
      }
    }

    // For RSS-based platforms (excluding Naver Cafe), derive RSS feed URL from author URL
    if (needsFeedUrlDerivation(author.platform) && !isNaverCafe) {
      const feedUrl = this.deriveRSSFeedUrl(author.authorUrl, author.platform);
      if (feedUrl) {
        // Keep original platform - server will handle RSS via rssMetadata
        // Extract proper author name from URL for substack/tumblr
        const authorHandle = this.extractAuthorFromRSSUrl(author.authorUrl, author.platform);
        requestBody.name = authorHandle || author.authorName;
        requestBody.target = {
          handle: authorHandle || this.deriveHandle(author),
          profileUrl: this.deriveRSSBaseUrl(author.authorUrl, author.platform), // Use base URL, not post URL
        };
        requestBody.rssMetadata = {
          feedUrl: feedUrl,
          feedType: 'rss2',
          siteTitle: authorHandle || author.authorName,
        };
      } else {
        throw new Error(`Could not derive RSS feed URL for ${author.platform}. Please subscribe directly from the RSS feed URL.`);
      }
    }

    // For podcast platform, authorUrl is already the RSS feed URL
    if (author.platform === 'podcast' && author.authorUrl) {
      requestBody.rssMetadata = {
        feedUrl: author.authorUrl,
        feedType: 'rss2',
        siteTitle: author.authorName,
      };
    }

    // For Naver Blog subscriptions (non-cafe), add naverOptions for local polling
    if (author.platform === 'naver' && !isNaverCafe) {
      const blogId = this.extractNaverBlogId(author.authorUrl);
      if (blogId) {
        requestBody.naverOptions = {
          subscriptionType: 'blog',
          blogId,
          localFetchRequired: true, // Polled locally by NaverSubscriptionPoller
        };

        // IMPORTANT: Set target.handle to blogId for consistent matching
        // RSS processing may have overwritten target, so restore it
        requestBody.target.handle = blogId;
        requestBody.target.profileUrl = `https://blog.naver.com/${blogId}`;
      }
    }

    try {
      const res = await requestUrl({
        url: `${this.plugin.settings.workerUrl}/api/subscriptions`,
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(requestBody),
        throw: false
      });

      if (res.status !== 200) {
        throw new Error(`Subscription create failed: ${res.status} ${res.text || ''}`.trim());
      }

      // Parse response to get new subscription ID
      const response = res.json;
      const subscription = response.data || response;

      // Update author object with new subscription ID
      if (subscription && subscription.id) {
        author.subscriptionId = subscription.id;

        // Add to PostCardRenderer's cache for immediate unsubscribe support
        this.postCardRenderer.addSubscriptionToCache({
          id: subscription.id,
          platform: author.platform,
          target: {
            handle: this.deriveHandle(author),
            profileUrl: author.authorUrl
          }
        });
      }

      // Update AuthorCatalogStore
      const store = await import('../../services/AuthorCatalogStore').then(m => m.getAuthorCatalogStore());
      store.updateAuthorStatus(author.authorUrl, author.platform, 'subscribed', subscription?.id, author.authorName);

      // For Naver subscriptions, trigger initial poll immediately
      // This sets lastRunAt to prevent duplicate polling on plugin reload
      if (author.platform === 'naver' && subscription?.id && this.plugin.naverPoller) {
        // Run in background to not block the UI
        setTimeout(async () => {
          try {
            console.debug('[TimelineContainer] Running initial poll for new Naver subscription:', subscription.id);
            await this.plugin.naverPoller?.runSingleSubscription(subscription.id);
          } catch (error) {
            console.warn('[TimelineContainer] Initial poll failed (will retry on next cycle):', error);
          }
        }, 1000);
      }

      new Notice(`Subscribed to ${author.authorName}! (Daily at ${currentHour}:00 ${timezone})`);
    } catch (error) {
      console.error('[TimelineContainer] Subscribe failed', error);
      const rawMessage = error instanceof Error ? error.message : 'Subscription failed';
      const jsonMatch = rawMessage.match(/\{.*"message"\s*:\s*"([^"]+)"/);
      const message = jsonMatch ? jsonMatch[1] : rawMessage;
      new Notice(`Subscription failed: ${message}`);
      throw error;
    }
  }

  /**
   * Unsubscribe from an author - reusable method for both AuthorCatalog and Timeline
   */
  private async unsubscribeFromAuthor(subscriptionId: string, authorName: string, authorUrl?: string, platform?: Platform): Promise<void> {
    try {
      const res = await requestUrl({
        url: `${this.plugin.settings.workerUrl}/api/subscriptions/${subscriptionId}`,
        method: 'DELETE',
        headers: this.getAuthHeaders(),
        throw: false
      });

      if (res.status !== 200) {
        throw new Error(`Unsubscribe failed: ${res.status} ${res.text || ''}`.trim());
      }

      // Update AuthorCatalogStore if authorUrl and platform are provided
      if (authorUrl && platform) {
        const store = await import('../../services/AuthorCatalogStore').then(m => m.getAuthorCatalogStore());
        store.updateAuthorStatus(authorUrl, platform, 'not_subscribed', undefined);
      }

      // Remove from PostCardRenderer's cache
      this.postCardRenderer.removeSubscriptionFromCache(subscriptionId);

      new Notice(`Unsubscribed from ${authorName}`);
    } catch (error) {
      console.error('[TimelineContainer] Unsubscribe failed', error);
      const message = error instanceof Error ? error.message : 'Unsubscribe failed';
      new Notice(`Unsubscribe failed: ${message}`);
      throw error;
    }
  }

  /**
   * Mount or remount AuthorCatalog with current filter state
   */
  private async mountAuthorCatalog(): Promise<void> {
    // Unmount existing component if exists
    if (this.authorCatalogComponent) {
      unmount(this.authorCatalogComponent);
      this.authorCatalogComponent = null;
    }

    // Clear container
    if (this.authorCatalogContainer) {
      this.authorCatalogContainer.empty();
    }

    // Dynamically import and mount AuthorCatalog with current filter state
    try {
      const { default: AuthorCatalog } = await import('../subscriptions/AuthorCatalog.svelte');

      if (!this.authorCatalogContainer) {
        console.warn('[TimelineContainer] Author catalog container not found');
        return;
      }

      this.authorCatalogComponent = mount(AuthorCatalog, {
        target: this.authorCatalogContainer,
        props: {
          app: this.app,
          archivePath: this.archivePath,
          hideHeader: true,  // Hide duplicate header
          hideFilters: true, // Hide duplicate filters
          externalSearchQuery: this.authorSearchQuery,
          externalPlatformFilter: this.authorPlatformFilter,
          externalSortBy: this.authorSortBy,
          externalIncludeArchived: this.filterSortManager.getFilterState().includeArchived,
          onPlatformCountsChange: (counts: any) => {
            this.authorPlatformCounts = counts;
          },
          onSubscribe: async (author: any, options: any) => {
            if (!isSubscriptionSupported(author.platform)) {
              new Notice('Subscriptions are only available for Instagram, Facebook, X (Twitter), LinkedIn, Reddit, TikTok, Pinterest, Bluesky, Mastodon, YouTube, Velog, Medium, and RSS-based platforms.');
              return;
            }

            try {
              // Build request body
              // Webtoons update with 1 episode per week, so use smaller defaults
              const isWebtoon = author.platform === 'naver-webtoon' || author.platform === 'webtoons';
              const requestBody: Record<string, unknown> = {
                name: author.authorName,
                platform: author.platform,
                target: {
                  handle: this.deriveHandle(author),
                  profileUrl: author.authorUrl
                },
                schedule: {
                  cron: `0 ${options.startHour || 0} * * *`,
                  timezone: options.timezone
                },
                destination: {
                  folder: options.destinationPath,
                  templateId: options.templateId || undefined
                },
                options: {
                  maxPostsPerRun: isWebtoon ? 1 : (options.maxPostsPerRun || 20),
                  backfillDays: isWebtoon ? 0 : (options.backfillDays || 3)
                }
              };

              // Add Reddit-specific options if present
              if (options.redditOptions && author.platform === 'reddit') {
                requestBody.redditOptions = {
                  sortBy: options.redditOptions.sortBy,
                  sortByTime: options.redditOptions.sortByTime,
                  keyword: options.redditOptions.keyword || undefined
                };
              }

              // Add Brunch-specific options if present
              // brunchOptions includes userId needed for Worker's hybrid mode RSS
              if (options.brunchOptions && author.platform === 'brunch') {
                requestBody.brunchOptions = {
                  subscriptionType: options.brunchOptions.subscriptionType || 'author',
                  username: options.brunchOptions.username,
                  userId: options.brunchOptions.userId, // Required for Worker's RSS fetching
                  localFetchRequired: true, // Brunch uses hybrid mode
                  maxPostsPerRun: options.brunchOptions.maxPostsPerRun,
                  backfillDays: options.brunchOptions.backfillDays,
                  keyword: options.brunchOptions.keyword || undefined,
                  includeComments: options.brunchOptions.includeComments,
                };
                // Also update target handle to include userId for matching
                if (options.brunchOptions.userId) {
                  (requestBody.target as any).handle = `${options.brunchOptions.username}:${options.brunchOptions.userId}`;
                }
              }

              // Add YouTube-specific metadata (channelId + rssFeedUrl required)
              if (author.platform === 'youtube') {
                // handle may contain @ prefix (e.g., @UCdUcjkyZtf-1WJyPPiETF1g)
                const rawHandle = author.handle?.replace(/^@/, '') || '';
                const channelId = rawHandle.startsWith('UC') ? rawHandle : null;
                if (channelId) {
                  requestBody.youtubeMetadata = {
                    channelId: channelId,
                    channelName: author.authorName,
                    rssFeedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
                  };
                }
              }

              // Add X (Twitter)-specific metadata (displayName, avatar, bio from author catalog)
              if (author.platform === 'x') {
                requestBody.xMetadata = {
                  displayName: author.authorName || undefined,
                  avatar: author.avatar || undefined,
                  bio: author.bio || undefined,
                };
              }

              // Add Naver Webtoon-specific options (works for both naver-webtoon and webtoons platforms)
              if ((author.platform === 'naver-webtoon' || author.platform === 'webtoons') && author.authorUrl) {
                try {
                  const url = new URL(author.authorUrl);
                  // Naver Webtoon uses 'titleId', WEBTOON Global uses 'title_no'
                  const titleId = url.searchParams.get('titleId') || url.searchParams.get('title_no');
                  if (titleId) {
                    requestBody.naverWebtoonOptions = {
                      titleId: titleId,
                      titleName: author.authorName,
                    };
                    // Also set handle to titleId for matching
                    (requestBody.target as any).handle = titleId;
                  }
                } catch (e) {
                  console.warn('[TimelineContainer] Failed to extract webtoon titleId from URL:', e);
                }
              }

              // For Naver Cafe subscriptions, use local fetch (not RSS)
              let isNaverCafeSubscription = false;
              if (author.platform === 'naver' && author.authorUrl) {
                try {
                  const url = new URL(author.authorUrl);
                  if (url.hostname === 'cafe.naver.com' || url.hostname === 'm.cafe.naver.com') {
                    isNaverCafeSubscription = true;
                    const match = url.pathname.match(/\/(?:f-e|ca-fe)\/cafes\/(\d+)\/members\/([^/]+)/);
                    if (match) {
                      const cafeId = match[1];
                      const memberKey = match[2];
                      (requestBody.target as any).handle = `cafe:${cafeId}:${memberKey}`;

                      // Get Naver Cafe options from modal (if provided)
                      const naverCafeOpts = options.naverCafeOptions;
                      requestBody.naverOptions = {
                        subscriptionType: 'cafe-member',
                        cafeId,
                        memberKey,
                        localFetchRequired: true,
                        keyword: naverCafeOpts?.keyword || undefined,
                      };

                      // Override maxPostsPerRun and backfillDays with Naver Cafe options
                      if (naverCafeOpts) {
                        (requestBody.options as any).maxPostsPerRun = naverCafeOpts.maxPostsPerRun || 5;
                        (requestBody.options as any).backfillDays = naverCafeOpts.backfillDays || 3;
                      }
                    } else {
                      throw new Error('Could not extract cafe member info from URL. Please use a member profile URL.');
                    }
                  }
                } catch (e) {
                  if (e instanceof Error && e.message.includes('Could not extract')) {
                    throw e;
                  }
                }
              }

              // Add RSS metadata for RSS-based platforms (excluding Naver Cafe)
              if (needsFeedUrlDerivation(author.platform) && !isNaverCafeSubscription) {
                const feedUrl = this.deriveRSSFeedUrl(author.authorUrl, author.platform);
                if (feedUrl) {
                  // Keep original platform (substack, tumblr) - server will handle RSS via rssMetadata
                  // Extract proper author name from URL for substack/tumblr
                  const authorHandle = this.extractAuthorFromRSSUrl(author.authorUrl, author.platform);
                  requestBody.name = authorHandle || author.authorName;
                  requestBody.target = {
                    handle: authorHandle || this.deriveHandle(author),
                    profileUrl: this.deriveRSSBaseUrl(author.authorUrl, author.platform), // Use base URL, not post URL
                  };
                  requestBody.rssMetadata = {
                    feedUrl: feedUrl,
                    feedType: 'rss2',
                    siteTitle: authorHandle || author.authorName,
                  };
                } else {
                  throw new Error(`Could not derive RSS feed URL for ${author.platform}. Please subscribe directly from the RSS feed URL.`);
                }
              }

              // For Naver Blog subscriptions (non-cafe), add naverOptions for local polling
              if (author.platform === 'naver' && !isNaverCafeSubscription) {
                const blogId = this.extractNaverBlogId(author.authorUrl);
                if (blogId) {
                  // Get Naver Blog options from modal (if provided via naverCafeOptions)
                  const naverBlogOpts = options.naverCafeOptions;
                  requestBody.naverOptions = {
                    subscriptionType: 'blog',
                    blogId,
                    localFetchRequired: true, // Polled locally by NaverSubscriptionPoller
                    keyword: naverBlogOpts?.keyword || undefined,
                  };

                  // IMPORTANT: Set target.handle to blogId for consistent matching
                  // RSS processing may have overwritten target, so restore it
                  (requestBody.target as any).handle = blogId;
                  (requestBody.target as any).profileUrl = `https://blog.naver.com/${blogId}`;

                  // Override maxPostsPerRun and backfillDays with modal options
                  if (naverBlogOpts) {
                    (requestBody.options as any).maxPostsPerRun = naverBlogOpts.maxPostsPerRun || 5;
                    (requestBody.options as any).backfillDays = naverBlogOpts.backfillDays || 3;
                  }
                  console.debug('[TimelineContainer] Naver Blog subscription options:', {
                    naverBlogOpts,
                    finalOptions: requestBody.options
                  });
                }
              }

              // Debug logging before API call
              console.debug('[TimelineContainer] Final requestBody before API call:', {
                platform: author.platform,
                authorUrl: author.authorUrl,
                options: requestBody.options,
                naverOptions: requestBody.naverOptions,
                passedOptions: {
                  maxPostsPerRun: options.maxPostsPerRun,
                  backfillDays: options.backfillDays,
                  naverCafeOptions: options.naverCafeOptions,
                }
              });

              const res = await requestUrl({
                url: `${this.plugin.settings.workerUrl}/api/subscriptions`,
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(requestBody),
                throw: false
              });

              if (res.status !== 200) {
                throw new Error(`Subscription create failed: ${res.status} ${res.text || ''}`.trim());
              }

              // Parse response to get new subscription ID
              const response = res.json;

              // Extract the actual subscription from the response
              // API returns {success: true, data: {...}} structure
              const subscription = response.data || response;

              // Update author object with new subscription ID
              if (subscription && subscription.id) {
                author.subscriptionId = subscription.id;
              }

              // Refresh SubscriptionManager cache so NaverCafePoller can find the new subscription
              if (this.plugin.subscriptionManager) {
                await this.plugin.subscriptionManager.refresh();
              }

              // For Naver subscriptions, trigger initial poll immediately
              // This sets lastRunAt to prevent duplicate polling on plugin reload
              if (author.platform === 'naver' && subscription?.id && this.plugin.naverPoller) {
                // Run in background to not block the UI
                setTimeout(async () => {
                  try {
                    console.debug('[TimelineContainer] Running initial poll for new Naver subscription:', subscription.id);
                    await this.plugin.naverPoller?.runSingleSubscription(subscription.id);
                  } catch (error) {
                    console.warn('[TimelineContainer] Initial poll failed (will retry on next cycle):', error);
                  }
                }, 1000);
              }

              // Clear subscription cache so timeline shows updated subscription status
              this.seriesCardRenderer.clearCaches();

              // Return the subscription for AuthorCatalog to handle
              return subscription;
            } catch (error) {
              console.error('[TimelineContainer] Subscribe failed', error);
              throw error; // Re-throw for AuthorRow to show notice
            }
          },
          onUpdateSubscription: async (author: any, options: any) => {
            if (!author.subscriptionId) {
              throw new Error('Cannot update: missing subscription ID');
            }

            // Build update request body (only options that can be updated)
            const updateBody: Record<string, unknown> = {
              options: {
                maxPostsPerRun: options.maxPostsPerRun || 20,
              }
            };

            // Add Reddit-specific options if present
            if (options.redditOptions && author.platform === 'reddit') {
              updateBody.redditOptions = {
                sortBy: options.redditOptions.sortBy,
                sortByTime: options.redditOptions.sortByTime,
                keyword: options.redditOptions.keyword || undefined
              };
            }

            // Add Naver-specific options if present (both blog and cafe-member)
            if (options.naverCafeOptions && author.platform === 'naver') {
              // Include backfillDays in options update
              (updateBody.options as any).backfillDays = options.naverCafeOptions.backfillDays || 3;
              (updateBody.options as any).maxPostsPerRun = options.naverCafeOptions.maxPostsPerRun || 5;

              updateBody.naverOptions = {
                keyword: options.naverCafeOptions.keyword || undefined
              };
            }

            console.debug('[TimelineContainer] onUpdateSubscription:', {
              authorPlatform: author.platform,
              passedOptions: options,
              updateBody,
            });

            const res = await requestUrl({
              url: `${this.plugin.settings.workerUrl}/api/subscriptions/${author.subscriptionId}`,
              method: 'PATCH',
              headers: this.getAuthHeaders(),
              body: JSON.stringify(updateBody),
              throw: false
            });

            if (res.status !== 200) {
              throw new Error(`Subscription update failed: ${res.status} ${res.text || ''}`.trim());
            }

            // Update local author data
            if (options.maxPostsPerRun) {
              author.maxPostsPerRun = options.maxPostsPerRun;
            }
            if (options.redditOptions) {
              author.redditOptions = options.redditOptions;
            }
            if (options.naverCafeOptions) {
              author.naverCafeOptions = options.naverCafeOptions;
            }

            // Refresh SubscriptionManager cache to reflect updated options
            if (this.plugin.subscriptionManager) {
              await this.plugin.subscriptionManager.refresh();
            }

            return await res.json();
          },
          onUnsubscribe: async (author: any) => {
            if (!author.subscriptionId) {
              throw new Error('Cannot unsubscribe: missing subscription ID');
            }

            await this.deleteSubscription(author.subscriptionId);
            // Update PostCardRenderer cache
            this.postCardRenderer.removeSubscriptionFromCache(author.subscriptionId);
            // Clear subscription cache so timeline shows updated subscription status
            this.seriesCardRenderer.clearCaches();
          },
          onManualRun: async (author: any) => {
            if (!author.subscriptionId) {
              throw new Error('Cannot run: missing subscription ID');
            }

            await this.triggerManualRun(author.subscriptionId, author);
          },
          onViewHistory: async (author: any) => {
            // Handle view history
            if (!author.subscriptionId) {
              new Notice('No subscription found for this author');
              return;
            }

            // Dynamically import and show CrawlHistoryPanel
            try {
              const { default: CrawlHistoryPanel } = await import('../subscriptions/CrawlHistoryPanel.svelte');

              // Create container for the panel with higher z-index
              const modalContainer = document.body.createDiv({
                cls: 'crawl-history-modal-container'
              });

              // Styles handled by .crawl-history-modal-container CSS class

              // Store panel reference for cleanup
              let historyPanel: any = null;
              let refreshTrigger = 0;

              // Subscribe to subscription events for auto-refresh
              const subscriptionManager = this.plugin.subscriptionManager;
              const handleRunCompleted = (event: any) => {
                // Check if the completed run is for this subscription
                if (event.subscription?.id === author.subscriptionId || event.run?.subscriptionId === author.subscriptionId) {
                  refreshTrigger++;
                  // Re-mount with updated refreshTrigger
                  if (historyPanel) {
                    unmount(historyPanel);
                    historyPanel = mount(CrawlHistoryPanel, {
                      target: modalContainer,
                      props: panelProps(refreshTrigger)
                    });
                  }
                }
              };

              if (subscriptionManager) {
                subscriptionManager.on('subscription:run:completed', handleRunCompleted);
                subscriptionManager.on('subscription:run:failed', handleRunCompleted);
              }

              // Define close handler
              const closeHandler = () => {
                // Unsubscribe from events
                if (subscriptionManager) {
                  subscriptionManager.off('subscription:run:completed', handleRunCompleted);
                  subscriptionManager.off('subscription:run:failed', handleRunCompleted);
                }
                if (historyPanel) {
                  unmount(historyPanel);
                  historyPanel = null;
                }
                modalContainer.remove();
              };

              // Props factory for re-mounting
              const panelProps = (trigger: number) => ({
                author: { ...author },
                isOpen: true,
                onClose: closeHandler,
                refreshTrigger: trigger,
                onRunNow: author.subscriptionId ? async () => {
                  try {
                    await this.triggerManualRun(author.subscriptionId, author);
                    new Notice(`Running sync for ${author.authorName}...`);
                  } catch (error) {
                    console.error('[TimelineContainer] Manual run failed:', error);
                    new Notice('Failed to start manual sync');
                  }
                } : undefined,
                fetchRunHistory: async (subscriptionId: string) => {
                  const params = new URLSearchParams({
                    page: '1',
                    limit: '10'
                  });

                  const res = await requestUrl({
                    url: `${this.plugin.settings.workerUrl}/api/subscriptions/${subscriptionId}/runs?${params}`,
                    method: 'GET',
                    headers: this.getAuthHeaders(),
                    throw: false
                  });

                  if (res.status !== 200) {
                    throw new Error(`Failed to fetch history: ${res.status}`);
                  }

                  const response = res.json;
                  return response.data?.runs || [];
                }
              });

              // Mount the CrawlHistoryPanel with proper props
              historyPanel = mount(CrawlHistoryPanel, {
                target: modalContainer,
                props: panelProps(refreshTrigger)
              });
            } catch (error) {
              console.error('[TimelineContainer] Failed to show history panel:', error);
              new Notice('Failed to show history panel');
            }
          },
          onViewArchives: (author: any) => {
            // Switch back to timeline view
            this.isSubscriptionViewActive = false;

            // Clean up subscription view (unmount AuthorCatalog)
            if (this.authorCatalogComponent) {
              unmount(this.authorCatalogComponent);
              this.authorCatalogComponent = null;
            }

            // Update filters BEFORE rendering header so search state is correct
            this.filterSortManager.updateFilter({ searchQuery: author.authorName, includeArchived: true });
            // Reset authorSearchQuery so it doesn't persist when returning to Author Catalog
            this.authorSearchQuery = '';

            // Rebuild full timeline layout (header, composer, banner)
            // renderFilteredEmptyState() assumes these are present in the DOM
            this.containerEl.empty();
            this.renderPostComposer();
            this.renderHeader();
            this.renderTagChipBar();
            this.renderCrawlStatusBanner();
            this.renderArchiveProgressBanner();

            void this.loadPosts();
          },
          // Use fetchSubscriptionsRaw to return raw API data
          // AuthorCatalog's buildSubscriptionMapFromApi expects raw structure with target.handle, target.profileUrl etc.
          fetchSubscriptions: () => this.fetchSubscriptionsRaw()
        }
      });
    } catch (error) {
      console.error('[TimelineContainer] Failed to load AuthorCatalog:', error);
      new Notice('Failed to load author catalog');

      // Fallback: show error message
      if (this.authorCatalogContainer) {
        this.authorCatalogContainer.createDiv({
          cls: 'flex flex-col items-center justify-center min-h-[300px] text-center',
          text: 'Failed to load author catalog. Please try again.'
        });
      }
    }
  }

  /**
   * Render Subscription Management UI
   * Replaces the posts feed with author catalog interface
   */
  private async renderSubscriptionManagement(): Promise<void> {
    // Guard: prevent filterPanel.onRerender from triggering phantom mountAuthorCatalog
    this.isRenderingSubscription = true;

    // Clear any pending search timeout
    if (this.searchTimeout !== null) {
      window.clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    // Clear container
    this.containerEl.empty();

    // Unmount PostComposer if exists
    if (this.composerComponent) {
      unmount(this.composerComponent);
      this.composerComponent = null;
    }

    // Unmount previous author catalog component if exists
    if (this.authorCatalogComponent) {
      unmount(this.authorCatalogComponent);
      this.authorCatalogComponent = null;
    }

    // Render PostComposer at the top (keep it consistent)
    this.renderPostComposer();

    // Render header with filter/sort controls
    this.renderHeader();

    // Render CrawlStatusBanner below header (search/filter/archive buttons)
    this.renderCrawlStatusBanner();
    this.renderArchiveProgressBanner();

    // Add Subscriptions header
    const subscriptionsHeader = this.containerEl.createDiv({
      cls: 'catalog-header',
      attr: {
        style: 'padding: 12px 16px; border-bottom: 1px solid var(--background-modifier-border);'
      }
    });

    const headerTitle = subscriptionsHeader.createDiv({
      cls: 'header-title',
      attr: {
        style: 'display: flex; align-items: center; gap: 12px;'
      }
    });

    headerTitle.createEl('h3', {
      text: 'Subscriptions',
      attr: {
        style: 'margin: 0; font-size: 16px; font-weight: 600;'
      }
    });

    // Create container for author catalog UI
    // overflow: hidden prevents child elements from overlapping header
    this.authorCatalogContainer = this.containerEl.createDiv({
      cls: 'author-catalog-container flex-1',
      attr: {
        style: 'overflow: hidden; position: relative;'
      }
    });

    // Mount AuthorCatalog with current filter state
    try {
      await this.mountAuthorCatalog();
    } finally {
      this.isRenderingSubscription = false;
    }
  }

  private async renderPosts(): Promise<void> {
    // Don't render posts if in subscription view
    if (this.isSubscriptionViewActive) {
      return;
    }

    // Remove inline loading bar if present
    this.removeLoadingBar();

    this.containerEl.empty();
    // Clear previous YouTube controllers when re-rendering
    this.youtubeControllers.clear();

    // Render PostComposer at the top
    this.renderPostComposer();

    // Render header with filter/sort controls
    this.renderHeader();

    // Render tag chip bar below header (if tags exist)
    this.renderTagChipBar();

    // Render CrawlStatusBanner below header (search/filter/archive buttons)
    this.renderCrawlStatusBanner();
    this.renderArchiveProgressBanner();

    // Mark that posts have been rendered (for subsequent reloads)
    this.hasRenderedPosts = true;

    // Render posts feed
    await this.renderPostsFeed();
  }


  /**
   * Re-render only the posts feed (keep header/panels intact)
   * Uses lazy loading with IntersectionObserver for performance (if enabled)
   */
  private async renderPostsFeed(): Promise<void> {
    // Don't render posts if in subscription view
    if (this.isSubscriptionViewActive) {
      return;
    }

    const renderGeneration = this.beginFeedRenderGeneration();

    // Check if lazy loading is enabled in settings
    if (!this.plugin.settings.enableLazyLoad) {
      return this.renderPostsFeedImmediate(renderGeneration);
    }

    // Group posts by date (with series grouping)
    const grouped = await this.groupPostsWithSeries(this.dedupePostsByFilePath(this.filteredPosts));

    if (this.isStaleFeedRender(renderGeneration)) {
      return;
    }

    // Remove any previously rendered feeds.
    // Race conditions between full refresh and incremental update can leave multiple feed roots.
    this.removeAllTimelineFeeds();

    // Clear observers from previous render
    this.observerManager.unobserveAll();

    // Phase 2: Enable DOM recycling for bounded DOM size
    this.observerManager.enableRecycling(
      (placeholder, postRef) => this.renderRecycledCard(placeholder, postRef)
    );

    // Clear YouTube controllers and disconnect stale iframe observers
    this.youtubeControllers.clear();
    this.youtubeEmbedRenderer.disconnectAllObservers();

    // Render posts in single-column feed (max-width for readability)
    const feed = this.containerEl.createDiv({
      cls: 'flex flex-col gap-4 max-w-2xl mx-auto timeline-feed'
    });

    // Render items with lazy loading for posts, immediate for series
    for (const [_, items] of grouped) {
      for (const item of items) {
        if (this.isStaleFeedRender(renderGeneration)) {
          if (feed.isConnected) feed.remove();
          return;
        }

        if (isSeriesGroup(item)) {
          // Series cards are complex - render immediately (no skeleton)
          await this.seriesCardRenderer.render(feed, item);
        } else {
          // Regular posts use skeleton + lazy loading
          const post = item as PostData;
          // 1. Render lightweight skeleton placeholder
          const skeletonCard = this.skeletonRenderer.render(feed, post, {
            showPlatformIcon: false,
            estimatedHeight: undefined // Use platform-specific default
          });

          // 2. Setup intersection observer for lazy loading
          this.observerManager.observe(
            skeletonCard,
            post,
            async (element, postData) => {
              // 3. Replace skeleton with real card when visible
              await this.renderRealCard(element, postData);
            }
          );
        }
      }
    }
  }

  /**
   * Fallback: Immediate rendering without lazy loading
   * Used when enableLazyLoad is false
   */
  private async renderPostsFeedImmediate(renderGeneration?: number): Promise<void> {
    const activeGeneration = renderGeneration ?? this.beginFeedRenderGeneration();

    // Group posts by date (with series grouping)
    const grouped = await this.groupPostsWithSeries(this.dedupePostsByFilePath(this.filteredPosts));

    if (this.isStaleFeedRender(activeGeneration)) {
      return;
    }

    // Remove any previously rendered feeds.
    this.removeAllTimelineFeeds();

    // Clear YouTube controllers and disconnect stale iframe observers
    this.youtubeControllers.clear();
    this.youtubeEmbedRenderer.disconnectAllObservers();

    // Render posts in single-column feed
    const feed = this.containerEl.createDiv({
      cls: 'flex flex-col gap-4 max-w-2xl mx-auto timeline-feed'
    });

    // Render all items immediately (posts and series)
    for (const [_, items] of grouped) {
      for (const item of items) {
        if (this.isStaleFeedRender(activeGeneration)) {
          if (feed.isConnected) feed.remove();
          return;
        }

        if (isSeriesGroup(item)) {
          // Render series card
          await this.seriesCardRenderer.render(feed, item);
        } else {
          // Render regular post card
          await this.postCardRenderer.render(feed, item);
        }
      }
    }
  }

  /**
   * Phase 3: Incremental DOM update on filter/sort change.
   *
   * Instead of destroying and rebuilding the entire feed, computes a diff
   * between the previous and new filtered lists:
   * - Pure removals → remove DOM elements in place (fast)
   * - Large change (>50%) or reorder or additions → fall back to full re-render
   */
  private async updatePostsFeedIncremental(): Promise<void> {
    // Don't render posts if in subscription view
    if (this.isSubscriptionViewActive) return;

    // Gallery mode always does full re-render (different DOM structure)
    if (this.viewMode === 'gallery') {
      await this.renderGalleryContent();
      return;
    }

    // Compute new filtered list from current filter state
    const newFiltered = this.filterSortManager.applyFiltersAndSortIndex(this.indexEntries);
    // Compute diff against previous tracked state
    const diff = this.filterSortManager.diffWithPrevious(newFiltered);
    // Update tracking
    this.filterSortManager.updatePreviousFiltered(newFiltered.map(e => e.filePath));
    this.filteredIndexEntries = newFiltered;

    // Also update legacy PostData filtered list
    this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));

    // Handle empty state
    if (this.filteredPosts.length === 0) {
      if (this.posts.length === 0) {
        this.renderEmpty();
      } else {
        this.renderFilteredEmptyState();
      }
      return;
    }

    // If lazy loading is disabled, always full re-render
    if (!this.plugin.settings.enableLazyLoad) {
      await this.renderPostsFeedImmediate();
      return;
    }

    // Fall back to full re-render for complex cases:
    // - Large change (>50% posts changed)
    // - Sort order changed (need to reorder all elements)
    // - New posts to add (positioning within date groups is complex)
    if (diff.largeChange || diff.reorder || diff.added.length > 0) {
      await this.renderPostsFeed();
      return;
    }

    // No changes at all
    if (diff.removed.length === 0) return;

    // ── Pure removal path ──
    // Find and remove DOM elements for filtered-out posts
    const feedRoots = this.containerEl.querySelectorAll('.timeline-feed');
    if (feedRoots.length > 1) {
      // Recovery path: duplicated feed roots detected → reset feed in one pass.
      await this.renderPostsFeed();
      return;
    }

    const feed = feedRoots[0];
    if (!feed) {
      await this.renderPostsFeed();
      return;
    }

    // Build sets for matching DOM elements to remove
    const removedFilePaths = new Set(diff.removed);
    const removedIds = new Set<string>();
    for (const filePath of diff.removed) {
      const basename = filePath.split('/').pop()?.replace(/\.md$/, '');
      if (basename) removedIds.add(basename);
    }

    // Remove matching DOM elements (real cards, skeletons, and recycled placeholders)
    // Match by data-file-path (most reliable) or fall back to data-post-id
    const cards = feed.querySelectorAll('[data-post-id]');
    for (const card of cards) {
      const cardFilePath = card.getAttribute('data-file-path');
      const postId = card.getAttribute('data-post-id');
      const shouldRemove = (cardFilePath && removedFilePaths.has(cardFilePath))
        || (postId && removedIds.has(postId));
      if (shouldRemove) {
        this.observerManager.unobserve(card as HTMLElement);
        card.remove();
      }
    }
  }

  /**
   * Replace skeleton with real post card
   * Called by IntersectionObserver when skeleton enters viewport
   */
  private async renderRealCard(
    skeletonElement: HTMLElement,
    post: PostData
  ): Promise<void> {
    try {
      // Create temporary container for rendering
      const tempContainer = document.createElement('div');

      // Render real post card
      await this.postCardRenderer.render(tempContainer, post);

      // Get the rendered card element
      const realCard = tempContainer.firstElementChild as HTMLElement;

      // Replace skeleton with real card (if still in DOM)
      if (realCard && skeletonElement.parentElement && skeletonElement.isConnected) {
        // Carry over identifying attributes for incremental DOM updates & recycling
        realCard.setAttribute('data-post-id', post.id);
        realCard.setAttribute('data-platform', post.platform);
        if (post.filePath) {
          realCard.setAttribute('data-file-path', post.filePath);
        }

        skeletonElement.parentElement.replaceChild(realCard, skeletonElement);

        // Phase 2: Track rendered card for DOM recycling
        this.observerManager.trackRenderedCard(realCard, post);
      }
    } catch (error) {
      console.error('[TimelineContainer] Failed to render real card:', error);
      // Keep skeleton on error (better than blank space)
      // Add error indicator to skeleton
      skeletonElement.addClass('skeleton-error');
      skeletonElement.setAttribute('title', 'Failed to load post');
    }
  }

  /**
   * Re-render a recycled placeholder back into a real card.
   * Called by IntersectionObserverManager when a recycled placeholder
   * scrolls back into the viewport.
   */
  private async renderRecycledCard(
    placeholder: HTMLElement,
    postRef: PostData | PostIndexEntry
  ): Promise<void> {
    try {
      let post: PostData;

      // If we have a PostIndexEntry, load the full PostData
      if ('filePath' in postRef && !('content' in postRef)) {
        const loaded = await this.postDataParser.loadFullPost((postRef as PostIndexEntry).filePath);
        if (!loaded) return;
        post = loaded;
      } else {
        post = postRef as PostData;
      }

      // Create temporary container for rendering
      const tempContainer = document.createElement('div');
      await this.postCardRenderer.render(tempContainer, post);
      const realCard = tempContainer.firstElementChild as HTMLElement;

      if (realCard && placeholder.parentElement && placeholder.isConnected) {
        // Carry over identifying attributes for incremental DOM updates & recycling
        realCard.setAttribute('data-post-id', post.id);
        realCard.setAttribute('data-platform', post.platform);
        if (post.filePath) {
          realCard.setAttribute('data-file-path', post.filePath);
        }

        placeholder.parentElement.replaceChild(realCard, placeholder);
        // Re-track for future recycling
        this.observerManager.trackRenderedCard(realCard, post);
      }
    } catch (error) {
      console.error('[TimelineContainer] Failed to re-render recycled card:', error);
    }
  }

  private async loadPosts(): Promise<void> {
    try {
      // Performance optimization: Skip full reload if cached data exists and not forced
      // This dramatically improves UI transitions (Author Catalog <-> Timeline)
      const shouldReloadFromVault = this.posts.length === 0 || this.forceReload;

      if (shouldReloadFromVault) {
        // Only show loading if not in gallery mode (gallery has its own loading)
        // and not in subscription management view (keep the author catalog visible)
        if (this.viewMode !== 'gallery' && !this.isSubscriptionViewActive) {
          this.renderLoading();
          // Give browser a chance to paint loading UI before heavy work
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Fetch subscriptions in parallel with loading posts for badge status
        const subscriptionsPromise = this.fetchSubscriptionsForCache();

        // ── Phase 1: Index-based loading with chunked parsing ──
        // Load cached index first (fast: ~50ms for 1000 posts)
        const indexLoaded = await this.postIndexService.load();

        // Collect vault files and diff against cached index
        const allFiles = this.postDataParser.collectMarkdownFiles(this.archivePath);
        const { toParse, toRemove } = this.postIndexService.diffWithVault(allFiles, this.archivePath);

        // Remove stale entries
        for (const path of toRemove) {
          this.postIndexService.removeEntry(path);
          this.searchIndexService.removeEntry(path);
        }

        // Chunked async parsing for new/modified files (yields to main thread)
        if (toParse.length > 0) {
          for await (const batch of this.postDataParser.parseFilesChunked(toParse)) {
            for (const entry of batch) {
              this.postIndexService.setEntry(entry);
              this.searchIndexService.addEntry(entry);
            }
          }
        }

        // Build search index from all entries if this is the first load
        this.indexEntries = this.postIndexService.getEntriesArray();
        if (!indexLoaded || toRemove.length > 0 || toParse.length > allFiles.length * 0.5) {
          // Rebuild search index if index was fresh load, had removals, or large parse
          this.searchIndexService.buildIndex(this.indexEntries);
        }

        // Wire search index into FilterSortManager
        this.filterSortManager.setSearchIndex(this.searchIndexService);

        // Also load full PostData for legacy compatibility (gallery view, reader mode, etc.)
        // Guard against vault-event race conditions that can temporarily duplicate same filePath.
        this.posts = this.dedupePostsByFilePath(
          await this.postDataParser.loadFromVault(this.archivePath)
        );

        // Wait for subscriptions and update PostCardRenderer cache
        try {
          const subscriptions = await subscriptionsPromise;
          this.postCardRenderer.setSubscriptionsCache(subscriptions);
        } catch (e) {
          console.warn('[TimelineContainer] Failed to fetch subscriptions for cache:', e);
        }

        // Reset forceReload flag after loading
        this.forceReload = false;
      }

      // Use FilterSortManager to apply filters and sorting (always apply, even with cached data)
      this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));
      // Also maintain index-based filtered list for incremental updates
      this.filteredIndexEntries = this.filterSortManager.applyFiltersAndSortIndex(this.indexEntries);
      // Initialize previous tracking for incremental diffing (full load = new baseline)
      this.filterSortManager.updatePreviousFiltered(this.filteredIndexEntries.map(e => e.filePath));

      // When subscription management view is open, avoid replacing the UI with the
      // timeline loading/empty states. Data stays up to date for when the user
      // switches back to the timeline or gallery view.
      if (this.isSubscriptionViewActive) {
        return;
      }

      if (this.filteredPosts.length === 0) {
        if (this.posts.length === 0) {
          this.renderEmpty();
        } else {
          this.renderFilteredEmptyState();
        }
        return;
      }

      // Check viewMode and render accordingly
      if (this.viewMode === 'gallery') {
        await this.renderGalleryView();  // Full render for gallery
      } else {
        await this.renderPosts();
      }

    } catch (err) {
      this.renderError(err instanceof Error ? err.message : 'Failed to load posts');
    }
  }

  /**
   * Apply filters and sorting to posts
   */


  private groupPostsByDate(posts: PostData[]): Map<string, PostData[]> {
    const grouped = new Map<string, PostData[]>();
    const sortBy = this.filterSortManager.getSortState().by;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);

    for (const post of posts) {
      const referenceDate = sortBy === 'archived'
        ? (post.archivedDate ?? post.publishedDate ?? new Date(post.metadata.timestamp))
        : (post.publishedDate ?? new Date(post.metadata.timestamp));

      const postDate = new Date(referenceDate);
      const postDay = new Date(
        postDate.getFullYear(),
        postDate.getMonth(),
        postDate.getDate()
      );

      let groupLabel: string;

      if (postDay.getTime() === today.getTime()) {
        groupLabel = 'Today';
      } else if (postDay.getTime() === yesterday.getTime()) {
        groupLabel = 'Yesterday';
      } else if (postDate >= thisWeek) {
        groupLabel = 'This Week';
      } else {
        groupLabel = postDate.toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        });
      }

      if (!grouped.has(groupLabel)) {
        grouped.set(groupLabel, []);
      }
      grouped.get(groupLabel)!.push(post);
    }

    return grouped;
  }

  /**
   * Group posts by date, with series posts grouped as single items
   * Returns TimelineItem which can be either PostData or SeriesGroup
   */
  private async groupPostsWithSeries(posts: PostData[]): Promise<Map<string, TimelineItem[]>> {
    const sortBy = this.filterSortManager.getSortState().by;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);

    // Helper to get date group label
    const getGroupLabel = (date: Date): string => {
      const postDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

      if (postDay.getTime() === today.getTime()) {
        return 'Today';
      } else if (postDay.getTime() === yesterday.getTime()) {
        return 'Yesterday';
      } else if (date >= thisWeek) {
        return 'This Week';
      } else {
        return date.toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        });
      }
    };

    // Separate series and standalone posts
    const { series, standalone } = await this.seriesGroupingService.separateSeriesAndPosts(posts);

    const grouped = new Map<string, TimelineItem[]>();

    // Add standalone posts
    for (const post of standalone) {
      const referenceDate = sortBy === 'archived'
        ? (post.archivedDate ?? post.publishedDate ?? new Date(post.metadata.timestamp))
        : (post.publishedDate ?? new Date(post.metadata.timestamp));

      const groupLabel = getGroupLabel(new Date(referenceDate));

      if (!grouped.has(groupLabel)) {
        grouped.set(groupLabel, []);
      }
      grouped.get(groupLabel)!.push(post);
    }

    // Add series groups (using latest episode date for positioning)
    for (const seriesGroup of series) {
      // Use latestArchived when sorting by archived, otherwise use latestPublished
      const referenceDate = sortBy === 'archived'
        ? new Date(seriesGroup.latestArchived || seriesGroup.latestPublished || Date.now())
        : new Date(seriesGroup.latestPublished || Date.now());
      const groupLabel = getGroupLabel(referenceDate);

      if (!grouped.has(groupLabel)) {
        grouped.set(groupLabel, []);
      }
      grouped.get(groupLabel)!.push(seriesGroup);
    }

    // Sort items within each group by date (newest first or oldest first based on sort order)
    const sortOrder = this.filterSortManager.getSortState().order;
    for (const [_, items] of grouped) {
      items.sort((a, b) => {
        const getDate = (item: TimelineItem): Date => {
          if (isSeriesGroup(item)) {
            // Use latestArchived when sorting by archived, otherwise use latestPublished
            return sortBy === 'archived'
              ? new Date(item.latestArchived || item.latestPublished || Date.now())
              : new Date(item.latestPublished || Date.now());
          }
          const post = item as PostData;
          return sortBy === 'archived'
            ? new Date(post.archivedDate ?? post.publishedDate ?? post.metadata.timestamp)
            : new Date(post.publishedDate ?? post.metadata.timestamp);
        };

        const dateA = getDate(a);
        const dateB = getDate(b);

        return sortOrder === 'newest'
          ? dateB.getTime() - dateA.getTime()
          : dateA.getTime() - dateB.getTime();
      });
    }

    // Sort groups by date (Today first, then Yesterday, This Week, then by month/year)
    const getGroupOrder = (label: string): number => {
      if (label === 'Today') return 0;
      if (label === 'Yesterday') return 1;
      if (label === 'This Week') return 2;
      // Parse "Month Year" format (e.g., "December 2025")
      const parsed = new Date(label + ' 1'); // Add day to make valid date
      if (!isNaN(parsed.getTime())) {
        // Return negative timestamp so newer months come first
        return 3 + (Date.now() - parsed.getTime());
      }
      return 999; // Unknown format at end
    };

    // Create sorted map
    const sortedGrouped = new Map<string, TimelineItem[]>();
    const sortedKeys = [...grouped.keys()].sort((a, b) => {
      const orderA = getGroupOrder(a);
      const orderB = getGroupOrder(b);
      return sortOrder === 'newest' ? orderA - orderB : orderB - orderA;
    });

    for (const key of sortedKeys) {
      sortedGrouped.set(key, grouped.get(key)!);
    }

    return sortedGrouped;
  }

  /**
   * Render the tag chip bar into the container (below header)
   * Only shows if user has defined tags with archives
   */
  private renderTagChipBar(): void {
    const tagStore = this.plugin.tagStore;
    if (!tagStore) return;

    const tagsWithCounts = tagStore.getTagsWithCounts().filter(t => t.archiveCount > 0);
    if (tagsWithCounts.length === 0) return;

    this.tagChipBar.render(this.containerEl, tagsWithCounts);
  }

  /**
   * Refresh the tag chip bar after tag changes (create/remove/rename)
   * Re-renders in place without full timeline re-render
   */
  private refreshTagChipBar(): void {
    const tagStore = this.plugin.tagStore;
    if (!tagStore) return;

    const tagsWithCounts = tagStore.getTagsWithCounts().filter(t => t.archiveCount > 0);

    // Find the existing tag chip bar container
    const existingBar = this.containerEl.querySelector('.tag-chip-bar');
    if (existingBar) {
      if (tagsWithCounts.length > 0) {
        // Update chips in place without destroying the container (preserves position)
        this.tagChipBar.update(tagsWithCounts);
      } else {
        // No tags left, remove the bar
        this.tagChipBar.destroy();
      }
      return;
    }

    // If no existing bar and we have tags, do nothing - it'll show on next full render
  }

  private getDefaultFilterState(): FilterState {
    return {
      platforms: new Set<string>(TIMELINE_PLATFORM_IDS),
      selectedTags: new Set<string>(),
      likedOnly: false,
      commentedOnly: false,
      sharedOnly: false,
      subscribedOnly: false,
      includeArchived: false,
      dateRange: { start: null, end: null },
      searchQuery: ''
    };
  }

  private getInitialFilterState(): FilterState {
    const prefs = this.plugin.settings.timelineFilters;
    const defaults = this.getDefaultFilterState();

    if (!prefs) {
      return defaults;
    }

    return {
      ...defaults,
      platforms: new Set<string>(
        Array.isArray(prefs.platforms) ? prefs.platforms : TIMELINE_PLATFORM_IDS
      ),
      likedOnly: prefs.likedOnly ?? defaults.likedOnly,
      commentedOnly: prefs.commentedOnly ?? defaults.commentedOnly,
      sharedOnly: prefs.sharedOnly ?? defaults.sharedOnly,
      includeArchived: prefs.includeArchived ?? defaults.includeArchived,
      dateRange: {
        start: prefs.dateRange?.start ? new Date(prefs.dateRange.start) : null,
        end: prefs.dateRange?.end ? new Date(prefs.dateRange.end) : null
      },
      searchQuery: prefs.searchQuery ?? defaults.searchQuery
    };
  }

  private persistFilterPreferences(): void {
    const state = this.filterSortManager.getFilterState();
    const payload: TimelineFilterPreferences = {
      platforms: Array.from(state.platforms),
      likedOnly: state.likedOnly,
      commentedOnly: state.commentedOnly,
      sharedOnly: state.sharedOnly,
      includeArchived: state.includeArchived,
      searchQuery: state.searchQuery,
      dateRange: {
        start: state.dateRange.start ? state.dateRange.start.toISOString() : null,
        end: state.dateRange.end ? state.dateRange.end.toISOString() : null
      }
    };

    void this.plugin.saveSettingsPartial(
      { timelineFilters: payload },
      { reinitialize: false, notify: false }
    );
  }

  private persistViewMode(): void {
    void this.plugin.saveSettingsPartial(
      { timelineViewMode: this.viewMode },
      { reinitialize: false, notify: false }
    );
  }


  /**
   * Sync filter state from Timeline to Author view
   */
  private syncFiltersTimelineToAuthor(): void {
    const filterState = this.filterSortManager.getFilterState();

    // Sync search query
    this.authorSearchQuery = filterState.searchQuery;

    // Convert Set to Array for platform filter
    this.authorPlatformFilter = Array.from(filterState.platforms) as Platform[];

    // Note: Sort order is different between views, so we keep them separate
    // Timeline has: recent/archived/published
    // Author has: lastSeen/nameAsc/nameDesc/archiveCount
  }

  /**
   * Sync filter state from Author to Timeline view
   */
  private syncFiltersAuthorToTimeline(): void {
    // Sync search query
    this.filterSortManager.updateFilter({ searchQuery: this.authorSearchQuery });

    // Convert Array to Set for platform filter
    this.filterSortManager.updateFilter({ platforms: new Set(this.authorPlatformFilter) });

    // Apply filters and re-render
    this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));
    this.persistFilterPreferences();
  }

  /**
   * Get timeline platform counts
   */
  private getTimelinePlatformCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const post of this.posts) {
      // Merge 'webtoons' platform into 'naver-webtoon' for unified filter
      const platform = post.platform === 'webtoons' ? 'naver-webtoon' : post.platform;
      counts[platform] = (counts[platform] || 0) + 1;
    }
    return counts;
  }

  /**
   * Get platform-specific Simple Icon
   * Delegates to centralized IconService to avoid duplication
   * Special case: 'post' type uses Obsidian icon
   */
  private getPlatformSimpleIcon(platform: string): SimpleIcon | null {
    // Special case for user posts - use Obsidian icon
    if (platform.toLowerCase() === 'post') {
      return siObsidian;
    }
    // Delegate to IconService for all other platforms
    return getIconServiceSimpleIcon(platform);
  }

  /**
   * Get Lucide icon name for platforms not in simple-icons
   * Delegates to centralized IconService
   */
  private getLucideIcon(platform: string): string {
    return getIconServiceLucideIcon(platform);
  }

  /**
   * Open PostComposer in edit mode with existing post data
   *
   * @param post - Post data to edit
   * @param filePath - File path of the post markdown file
   */
  public async openEditMode(post: PostData, filePath: string): Promise<void> {
    // Unmount existing composer if any
    if (this.composerComponent) {
      unmount(this.composerComponent);
      this.composerComponent = null;
    }

    // Clear composer container
    if (this.composerContainer) {
      this.composerContainer.empty();
    } else {
      // Create container if it doesn't exist
      this.composerContainer = this.containerEl.createDiv({
        cls: 'max-w-2xl mx-auto mb-6'
      });
    }

    // Mount PostComposer in edit mode
    this.composerComponent = mount(PostComposer, {
      target: this.composerContainer,
      props: {
        app: this.app,
        settings: this.plugin.settings,
        archiveOrchestrator: this.plugin.archiveOrchestratorOptional, // Use optional getter to avoid error when not initialized
        editMode: true,
        initialData: post,
        filePath: filePath,
        onPostCreated: async (updatedPost: PostData) => {
          try {
            // Import VaultStorageService
            const { VaultStorageService } = await import('../../services/VaultStorageService');

            // Initialize storage service
            const storageService = new VaultStorageService({
              app: this.app,
              vault: this.vault,
              settings: this.plugin.settings
            });

            // Extract media files from updated post
            // Only NEW media will have 'file' property
            // Existing media will only have 'url' property (vault path)
            const mediaFiles: File[] = [];
            let deletedMediaPaths: string[] = [];

            if (updatedPost.media) {
              for (const media of updatedPost.media) {
                // @ts-ignore - media may have file property from PostComposer (new images only)
                if (media.file) {
                  // @ts-ignore - file property added by PostComposer for new images
                  mediaFiles.push(media.file);
                }
              }
            }

            // Extract deletedMediaPaths from updatedPost (added by PostComposer in edit mode)
            // @ts-ignore - temporary property passed from PostComposer
            if (updatedPost.deletedMediaPaths && Array.isArray(updatedPost.deletedMediaPaths)) {
              // @ts-ignore
              deletedMediaPaths = updatedPost.deletedMediaPaths;
            }

            // Update post using VaultStorageService
            await storageService.updatePost({
              filePath: filePath,
              postData: updatedPost,
              mediaFiles: mediaFiles,
              deletedMediaPaths: deletedMediaPaths,
              existingMedia: post.media || []
            });

            // Check if user wants to share (either new share or update existing)
            // @ts-ignore - shareOnPost is temporary property
            const shouldShare = updatedPost.shareOnPost || post.share;

            // Check if post was shared and update share if needed
            const file = this.vault.getFileByPath(filePath);
            if (file && shouldShare) {
              // Wait for MetadataCache to update after file modification
              await new Promise<void>((resolve) => {
                const handler = (modifiedFile: unknown) => {
                  if (modifiedFile instanceof TFile && modifiedFile.path === file.path) {
                    this.app.metadataCache.off('changed', handler);
                    resolve();
                  }
                };
                this.app.metadataCache.on('changed', handler);

                // Fallback timeout in case the event doesn't fire
                setTimeout(() => {
                  this.app.metadataCache.off('changed', handler);
                  resolve();
                }, 1000);
              });

              const fileCache = this.app.metadataCache.getFileCache(file);
              const frontmatter = fileCache?.frontmatter;

              // Extract shareId from shareUrl if shareId is not present
              let shareId = frontmatter?.shareId;
              if (!shareId && frontmatter?.shareUrl) {
                const match = frontmatter.shareUrl.match(/\/([^/]+)$/);
                shareId = match ? match[1] : null;
              }

              if (shareId) {
                // Existing share - update it

                try {
                  // Re-parse the updated file to get final PostData with correct media URLs
                  const { PostDataParser } = await import('../timeline/parsers/PostDataParser');
                  const parser = new PostDataParser(this.vault, this.app);
                  const finalPostData = await parser.parseFile(file);

                  if (!finalPostData) {
                    throw new Error('Failed to parse updated post');
                  }

                  // Import ShareAPIClient
                  const { ShareAPIClient } = await import('../../services/ShareAPIClient');

                  // Initialize ShareAPIClient with Vault access for media operations
                  const shareClient = new ShareAPIClient({
                    baseURL: this.plugin.settings.workerUrl,
                    apiKey: this.plugin.settings.licenseKey,
                    vault: this.vault // Provide vault for media file access
                  });

                  // Update share with media handling - handles incremental media updates
                  // - Uploads new local media files to R2
                  // - Deletes removed media files from R2
                  // - Converts markdown image paths from local to R2 URLs
                  await shareClient.updateShareWithMedia(shareId, finalPostData, {
                    username: frontmatter?.username,
                    tier: this.plugin.settings.tier
                  });

                  new Notice('Post and share updated successfully');
                } catch (shareError) {
                  new Notice('Post updated, but failed to update share link');
                }
              } else {
                // No existing shareId - create new share with media

                try {
                  // Re-parse the updated file to get final PostData with correct media URLs
                  const { PostDataParser } = await import('../timeline/parsers/PostDataParser');
                  const parser = new PostDataParser(this.vault, this.app);
                  const finalPostData = await parser.parseFile(file);

                  if (!finalPostData) {
                    throw new Error('Failed to parse updated post');
                  }

                  // Import ShareAPIClient
                  const { ShareAPIClient } = await import('../../services/ShareAPIClient');

                  // Initialize ShareAPIClient with Vault access
                  const shareClient = new ShareAPIClient({
                    baseURL: this.plugin.settings.workerUrl,
                    apiKey: this.plugin.settings.licenseKey,
                    vault: this.vault
                  });

                  // STEP 1: Create initial share without media (to get shareId)
                  const initialShareResult = await shareClient.createShare({
                    postData: {
                      ...finalPostData,
                      media: [] // Empty media initially
                    },
                    options: {
                      username: this.plugin.settings.username
                    }
                  });

                  // Validate share result
                  if (!initialShareResult?.shareId || !initialShareResult?.shareUrl) {
                    throw new Error('Share API returned invalid data');
                  }

                  // STEP 2: Update share with media (uploads to R2)
                  if (finalPostData.media && finalPostData.media.length > 0) {
                    await shareClient.updateShareWithMedia(
                      initialShareResult.shareId,
                      finalPostData,
                      {
                        username: this.plugin.settings.username,
                        tier: this.plugin.settings.tier
                      }
                    );
                  }

                  // STEP 3: Update YAML frontmatter with share data
                  const fileContent = await this.vault.read(file);
                  const updatedContent = this.updateFrontmatterWithShare(
                    fileContent,
                    initialShareResult.shareId,
                    initialShareResult.shareUrl
                  );
                  await this.vault.modify(file, updatedContent);

                  new Notice('Post updated and shared to web!');
                } catch (shareError) {
                  new Notice('Post updated, but failed to share to web');
                }
              }
            } else if (file) {
              new Notice('Post updated successfully');
            } else {
              new Notice('Post updated successfully');
            }

            // Reload timeline to show updated post
            await this.reload();

            // Unmount composer after successful update
            if (this.composerComponent) {
              unmount(this.composerComponent);
              this.composerComponent = null;
            }
          } catch (error) {
            new Notice(`Failed to update post: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        },
        onCancel: () => {

          // Unmount composer
          if (this.composerComponent) {
            unmount(this.composerComponent);
            this.composerComponent = null;
          }
        }
      }
    });
  }

  /**
   * Format relative time (e.g., "2h ago", "Yesterday", "Mar 15")
   */

  public destroy(): void {
    // Flush pending PostIndexService writes to disk
    void this.postIndexService.flush();

    // Clean up search index
    this.searchIndexService.clear();

    // Clear search debounce timeout
    if (this.searchTimeout !== null) {
      window.clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    // Clean up intersection observers
    this.observerManager.destroy();

    // Unmount PostComposer if exists
    if (this.composerComponent) {
      unmount(this.composerComponent);
      this.composerComponent = null;
    }

    // Clean up CrawlStatusBanner
    this.destroyCrawlStatusBanner();

    // Clean up ArchiveProgressBanner
    this.destroyArchiveProgressBanner();

    // Clean up TagChipBar
    this.tagChipBar.destroy();

    // Unmount AuthorCatalog if exists
    if (this.authorCatalogComponent) {
      unmount(this.authorCatalogComponent);
      this.authorCatalogComponent = null;
    }

    // Clean up renderer caches
    this.postCardRenderer.clearCaches();
    this.seriesCardRenderer.clearCaches();

    // Clean up all event listeners
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];

    this.containerEl.empty();
    this.youtubeControllers.clear();
  }

  /**
   * Reload the timeline (useful when view is re-activated)
   * Forces full reload from vault, ignoring cached data
   */
  public async reload(): Promise<void> {
    // Save current scroll position before reloading
    this.savedScrollPosition = this.containerEl.scrollTop;

    // Force reload from vault (don't use cached posts)
    this.forceReload = true;
    this.youtubeControllers.clear();
    this.youtubeEmbedRenderer.disconnectAllObservers();

    // Clear series card caches (including subscription cache) for fresh data
    this.seriesCardRenderer.clearCaches();

    await this.loadPosts();

    // Restore scroll position after rendering
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      this.containerEl.scrollTop = this.savedScrollPosition;
    });
  }

  /**
   * Incrementally update the post index for a single vault file change.
   * Much faster than a full reload() for common cases (1 file created/modified/deleted).
   *
   * @param type - The type of vault event
   * @param filePath - The path of the changed file
   * @param oldPath - For 'rename' events, the previous file path
   */
  public async handleVaultFileChange(
    type: 'create' | 'modify' | 'delete' | 'rename',
    filePath: string,
    oldPath?: string
  ): Promise<void> {
    switch (type) {
      case 'create':
      case 'modify': {
        const file = this.vault.getAbstractFileByPath(filePath);
        if (!file || !(file instanceof TFile)) return;
        const entry = await this.postDataParser.buildIndexEntry(file);
        if (entry) {
          this.postIndexService.setEntry(entry);
          this.searchIndexService.addEntry(entry);
          this.indexEntries = this.postIndexService.getEntriesArray();

          // Also update full PostData cache
          const postData = await this.postDataParser.loadFullPost(filePath);
          if (postData) {
            const idx = this.posts.findIndex(p => p.filePath === filePath);
            if (idx >= 0) {
              this.posts[idx] = postData;
            } else {
              this.posts.push(postData);
            }
            this.posts = this.dedupePostsByFilePath(this.posts);
          }
        }
        break;
      }
      case 'delete': {
        this.postIndexService.removeEntry(filePath);
        this.searchIndexService.removeEntry(filePath);
        this.indexEntries = this.postIndexService.getEntriesArray();
        this.posts = this.posts.filter(p => p.filePath !== filePath);
        this.filteredPosts = this.filteredPosts.filter(p => p.filePath !== filePath);
        this.posts = this.dedupePostsByFilePath(this.posts);
        break;
      }
      case 'rename': {
        if (oldPath) {
          this.postIndexService.renameEntry(oldPath, filePath);
          this.searchIndexService.removeEntry(oldPath);
          // Re-parse for search index with new path
          const file = this.vault.getAbstractFileByPath(filePath);
          if (file && file instanceof TFile) {
            const entry = await this.postDataParser.buildIndexEntry(file);
            if (entry) {
              this.searchIndexService.addEntry(entry);
            }
          }
          this.indexEntries = this.postIndexService.getEntriesArray();
          const existingPost = this.posts.find(p => p.filePath === oldPath);
          if (existingPost) {
            existingPost.filePath = filePath;
          }
          this.posts = this.dedupePostsByFilePath(this.posts);
        }
        break;
      }
    }

    // Re-filter and re-render incrementally
    await this.updatePostsFeedIncremental();

    // Refresh tag chip bar in case tags changed
    this.refreshTagChipBar();
  }

  private removeAllTimelineFeeds(): void {
    const existingFeeds = this.containerEl.querySelectorAll('.timeline-feed');
    existingFeeds.forEach((feed) => feed.remove());
  }

  private beginFeedRenderGeneration(): number {
    this.feedRenderGeneration += 1;
    return this.feedRenderGeneration;
  }

  private isStaleFeedRender(generation: number): boolean {
    return generation !== this.feedRenderGeneration;
  }

  /**
   * Deduplicate in-memory post list by filePath.
   * Vault events can arrive out-of-order (modify before rename), which can leave
   * two PostData objects pointing to the same file and cause duplicate cards.
   */
  private dedupePostsByFilePath(posts: PostData[]): PostData[] {
    const byPath = new Map<string, PostData>();
    const fallback: PostData[] = [];

    const getScore = (post: PostData): number => {
      // Prefer completed cards over preliminary placeholders, then newest metadata timestamp.
      const archiveStatusBonus = post.archiveStatus === 'completed' ? 1_000_000_000_000 : 0;
      const metadataTs = typeof post.metadata?.timestamp === 'string'
        ? new Date(post.metadata.timestamp).getTime()
        : post.metadata?.timestamp?.getTime?.() ?? 0;
      return archiveStatusBonus + (Number.isFinite(metadataTs) ? metadataTs : 0);
    };

    for (const post of posts) {
      const key = post.filePath?.trim();
      if (!key) {
        fallback.push(post);
        continue;
      }

      const existing = byPath.get(key);
      if (!existing || getScore(post) >= getScore(existing)) {
        byPath.set(key, post);
      }
    }

    return [...byPath.values(), ...fallback];
  }

  /**
   * Check if a webtoon series or reader mode is currently in fullscreen mode
   * Used by TimelineView to prevent refresh during fullscreen
   */
  public isFullscreenActive(): boolean {
    return this.seriesCardRenderer.isFullscreenActive() || this.isReaderModeActive();
  }

  /**
   * Check if reader mode overlay is currently active
   */
  public isReaderModeActive(): boolean {
    return this.readerModeOverlay?.isActive ?? false;
  }

  /**
   * Open reader mode for a specific post
   * Creates a fullscreen overlay with the current filtered posts list
   */
  private openReaderMode(post: PostData): void {
    // Close any existing reader
    if (this.readerModeOverlay?.isActive) {
      this.readerModeOverlay.close();
    }

    // Find the index of the post in the filtered list
    const currentIndex = this.filteredPosts.findIndex(p => p.id === post.id && p.filePath === post.filePath);
    if (currentIndex === -1) return;

    const context: ReaderModeContext = {
      posts: this.filteredPosts,
      currentIndex,
      app: this.app,
      plugin: this.plugin,
      mediaGalleryRenderer: this.mediaGalleryRenderer,
      linkPreviewRenderer: this.linkPreviewRenderer,
      onUIModify: this.onUIModify,
      onUIDelete: this.onUIDelete,
      onClose: (dirty) => {
        if (dirty) {
          this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));
          void this.renderPostsFeed();
        }
      },
      onShare: async (post) => {
        await this.postCardRenderer.toggleShareForReader(post);
      },
      onEdit: (post) => {
        if (post.filePath) {
          this.openEditMode(post, post.filePath);
        }
      },
      onDelete: async (post) => {
        await this.postCardRenderer.deletePostForReader(post);
      },
      onTagsChanged: () => {
        this.refreshTagChipBar();
      },
      isAuthorSubscribed: (authorUrl, platform) => {
        return this.postCardRenderer.isAuthorSubscribed(authorUrl, platform as Platform);
      },
      onSubscribeAuthor: async (post) => {
        const entry = this.postCardRenderer.findAuthorEntry(post.author.url, post.platform) || {
          authorName: post.author.name,
          authorUrl: post.author.url,
          platform: post.platform,
          avatar: post.author.avatar || null,
          lastSeenAt: new Date(),
          archiveCount: 1,
          subscriptionId: null,
          status: 'not_subscribed' as const,
          handle: post.author.handle,
        };
        await this.subscribeToAuthor(entry);
        // Update badges in timeline cards too
        this.postCardRenderer.updateBadgesForAuthor(post.author.url, post.platform, true);
      },
      onUnsubscribeAuthor: async (post) => {
        const subInfo = this.postCardRenderer.getSubscriptionFromCache(post.author.url, post.platform);
        if (subInfo) {
          await this.unsubscribeFromAuthor(subInfo.subscriptionId, post.author.name, post.author.url, post.platform);
          // Update badges in timeline cards too
          this.postCardRenderer.updateBadgesForAuthor(post.author.url, post.platform, false);
        }
      },
    };

    this.readerModeOverlay = new ReaderModeOverlay(context);
    this.readerModeOverlay.open();
  }

  /**
   * Soft refresh - update data without disrupting fullscreen view
   * Used when new episodes are downloaded in background during streaming
   * Uses mutex to prevent race conditions when multiple episodes complete quickly
   */
  public async softRefresh(): Promise<void> {
    // If a refresh is already in progress, mark as pending and return
    if (this.softRefreshInProgress) {
      this.softRefreshPending = true;
      return;
    }

    this.softRefreshInProgress = true;

    try {
      // Get the fullscreen series ID before refresh
      const fullscreenSeriesId = this.seriesCardRenderer.getFullscreenSeriesId();
      if (!fullscreenSeriesId) {
        // Not in fullscreen, do a regular refresh
        await this.loadPosts();
        return;
      }

      // Reload posts from vault
      this.posts = await this.postDataParser.loadFromVault(this.archivePath);
      this.filteredPosts = this.dedupePostsByFilePath(this.filterSortManager.applyFiltersAndSort(this.posts));

      // Re-build series groups to get updated episode list
      const { series: seriesGroups } = await this.seriesGroupingService.separateSeriesAndPosts(this.filteredPosts);

      // Find the fullscreen series in the new data
      const updatedSeries = seriesGroups.find(s => s.seriesId === fullscreenSeriesId);
      if (updatedSeries) {
        // Update the episode list without disrupting fullscreen
        this.seriesCardRenderer.refreshSeriesEpisodes(updatedSeries);
      }
    } finally {
      this.softRefreshInProgress = false;

      // If another refresh was requested while we were busy, run it now
      if (this.softRefreshPending) {
        this.softRefreshPending = false;
        // Use setTimeout with delay to ensure files are fully registered
        setTimeout(() => void this.softRefresh(), 300);
      }
    }
  }

  /**
   * Open streaming episode in fullscreen mode
   * Finds the real series card and opens it with streaming URLs
   * Used by WebtoonArchiveModal for stream-first mode
   */
  public async openStreamingFullscreen(
    seriesInfo: {
      seriesId: string;
      seriesTitle: string;
      author: string;
      platform: 'naver-webtoon' | 'webtoons';
      thumbnailUrl?: string;
    },
    episodeDetail: {
      titleId: number;
      no: number;
      subtitle: string;
      imageUrls: string[];
      thumbnailUrl?: string;
    },
    episodeTitle: string
  ): Promise<void> {
    const seriesId = seriesInfo.seriesId;

    // Find the series data by re-grouping posts
    const { series: seriesGroups } = await this.seriesGroupingService.separateSeriesAndPosts(this.filteredPosts);
    const series = seriesGroups.find(s => s.seriesId === seriesId);

    if (!series) {
      console.warn(`[TimelineContainer] Series not found: ${seriesId}`);
      return;
    }

    // Open fullscreen with streaming URLs
    return this.seriesCardRenderer.openSeriesInStreamingFullscreen(
      series,
      episodeDetail.no,
      episodeDetail.imageUrls
    );
  }

  /**
   * Update frontmatter with share data
   */
  private updateFrontmatterWithShare(
    content: string,
    shareId: string,
    shareUrl: string
  ): string {
    const lines = content.split('\n');
    let inFrontmatter = false;
    let frontmatterEnd = -1;
    const newLines: string[] = [];
    let shareLineFound = false;
    let shareIdLineFound = false;
    let shareUrlLineFound = false;

    // Find frontmatter boundaries and process lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      if (line.trim() === '---') {
        if (!inFrontmatter) {
          inFrontmatter = true;
          newLines.push(line);
        } else {
          frontmatterEnd = i;
          break;
        }
      } else if (inFrontmatter) {
        // Check if this is a share-related line and update it
        if (line.trim().startsWith('share:')) {
          newLines.push(`share: true`);
          shareLineFound = true;
        } else if (line.trim().startsWith('shareId:')) {
          newLines.push(`shareId: ${shareId}`);
          shareIdLineFound = true;
        } else if (line.trim().startsWith('shareUrl:')) {
          newLines.push(`shareUrl: ${shareUrl}`);
          shareUrlLineFound = true;
        } else {
          newLines.push(line);
        }
      }
    }

    // Add share data if not found in frontmatter
    if (frontmatterEnd > 0) {
      if (!shareLineFound) {
        newLines.push(`share: true`);
      }
      if (!shareIdLineFound) {
        newLines.push(`shareId: ${shareId}`);
      }
      if (!shareUrlLineFound) {
        newLines.push(`shareUrl: ${shareUrl}`);
      }

      const closingLine = lines[frontmatterEnd];
      if (closingLine) {
        newLines.push(closingLine); // closing ---
      }

      // Add rest of content
      for (let i = frontmatterEnd + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line !== undefined) {
          newLines.push(line);
        }
      }

      return newLines.join('\n');
    }

    // No frontmatter found, return original
    return content;
  }

  // Store gallery renderer instance for filter updates
  private galleryRenderer: GalleryViewRenderer | null = null;
  private galleryGroupBy: 'none' | 'author' | 'post' | 'author-post' = 'none';

  /**
   * Render Gallery View - delegates to GalleryViewRenderer
   * Full render including PostComposer and header
   */
  private async renderGalleryView(): Promise<void> {
    // Don't render gallery if in subscription view
    if (this.isSubscriptionViewActive) {
      return;
    }

    // Clear everything and start fresh
    this.containerEl.empty();

    // Reset gallery renderer for full re-render
    this.galleryRenderer = null;

    // Render PostComposer at the top
    this.renderPostComposer();

    // Render header with filter/sort controls (same as timeline view)
    this.renderHeader();

    // Render tag chip bar below header (if tags exist)
    this.renderTagChipBar();

    // Render CrawlStatusBanner below header (search/filter/archive buttons)
    this.renderCrawlStatusBanner();
    this.renderArchiveProgressBanner();

    // Render gallery group controls (below header)
    this.renderGalleryGroupControls();

    // Render gallery content
    await this.renderGalleryContent();
  }

  /**
   * Render gallery grouping controls (Notion-style dropdown)
   */
  private renderGalleryGroupControls(): void {
    const groupControlsContainer = this.containerEl.createDiv('gallery-group-controls');
    // Styles handled by .gallery-group-controls CSS class

    // Dropdown button (minimal, no border, subtle)
    const dropdownBtn = groupControlsContainer.createEl('button');
    // Styles handled by .gallery-group-controls > button CSS rule

    // Remove any default button styles
    dropdownBtn.classList.remove('clickable-icon', 'mod-clickable');

    const getGroupLabel = (type: 'none' | 'author' | 'post' | 'author-post') => {
      switch (type) {
        case 'author': return 'Author';
        case 'post': return 'Post';
        case 'author-post': return 'Author & Post';
        default: return 'None';
      }
    };

    const updateButtonText = () => {
      dropdownBtn.empty();
      const span1 = dropdownBtn.createSpan({ text: 'Group by:' });
      span1.addClass('tc-group-label-dim');
      const span2 = dropdownBtn.createSpan({ text: getGroupLabel(this.galleryGroupBy) });
      span2.addClass('tc-group-value');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '12');
      svg.setAttribute('height', '12');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.classList.add('tc-group-chevron');
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', '6 9 12 15 18 9');
      svg.appendChild(polyline);
      dropdownBtn.appendChild(svg);
    };

    updateButtonText();

    // Dropdown menu (minimal, no border, subtle shadow)
    const dropdownMenu = groupControlsContainer.createDiv('gallery-group-dropdown-menu');
    // Styles handled by .gallery-group-dropdown-menu CSS class

    const options: Array<{ label: string; type: 'none' | 'author' | 'post' | 'author-post' }> = [
      { label: 'None', type: 'none' },
      { label: 'Author', type: 'author' },
      { label: 'Post', type: 'post' },
      { label: 'Author & Post', type: 'author-post' }
    ];

    // Function to recreate menu options (for selection persistence)
    const recreateMenuOptions = () => {
      dropdownMenu.empty();

      options.forEach(option => {
        const optionEl = dropdownMenu.createEl('button');

        const isActive = this.galleryGroupBy === option.type;

        // Create option container with checkmark
        const optionContent = document.createElement('div');
        optionContent.className = 'tc-option-content';

        const labelSpan = document.createElement('span');
        labelSpan.textContent = option.label;
        labelSpan.className = isActive ? 'tc-option-label-active' : 'tc-option-label';
        optionContent.appendChild(labelSpan);

        if (isActive) {
          const checkmark = document.createElement('span');
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('width', '14');
          svg.setAttribute('height', '14');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke', 'var(--interactive-accent)');
          svg.setAttribute('stroke-width', '2');
          svg.setAttribute('stroke-linecap', 'round');
          svg.setAttribute('stroke-linejoin', 'round');
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          polyline.setAttribute('points', '20 6 9 17 4 12');
          svg.appendChild(polyline);
          checkmark.appendChild(svg);
          optionContent.appendChild(checkmark);
        }

        optionEl.appendChild(optionContent);

        // Styles handled by .gallery-group-dropdown-menu > button CSS rule
        if (isActive) {
          optionEl.addClass('tc-option-active');
        }

        // Remove any default button styles
        optionEl.classList.remove('clickable-icon', 'mod-clickable');

        // Hover handled by CSS :hover rule on .gallery-group-dropdown-menu > button

        optionEl.addEventListener('click', async () => {
          this.galleryGroupBy = option.type;
          updateButtonText();
          dropdownMenu.removeClass('tc-dropdown-open');
          isOpen = false;
          dropdownBtn.removeClass('tc-btn-open');
          await this.renderGalleryContent();
        });
      });
    };

    // Initially create menu options
    recreateMenuOptions();

    // Toggle dropdown
    let isOpen = false;
    dropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isOpen = !isOpen;

      if (isOpen) {
        // Recreate menu options to ensure proper selection state
        recreateMenuOptions();
        dropdownMenu.addClass('tc-dropdown-open');
        dropdownBtn.addClass('tc-btn-open');
      } else {
        dropdownMenu.removeClass('tc-dropdown-open');
        dropdownBtn.removeClass('tc-btn-open');
      }
    });

    // Close dropdown when clicking outside
    const closeDropdown = () => {
      if (isOpen) {
        isOpen = false;
        dropdownMenu.removeClass('tc-dropdown-open');
        dropdownBtn.removeClass('tc-btn-open');
      }
    };

    // Use capture phase to handle clicks outside
    document.addEventListener('click', closeDropdown, true);

    // Store cleanup function to remove listener when container is destroyed
    this.cleanupFunctions.push(() => {
      document.removeEventListener('click', closeDropdown, true);
    });

    // Hover handled by CSS :hover rule on .gallery-group-controls > button
  }

  /**
   * Render only gallery content (keep PostComposer and header intact)
   * Used when filters/search change to avoid closing UI elements
   */
  private async renderGalleryContent(): Promise<void> {
    // Don't render gallery if in subscription view
    if (this.isSubscriptionViewActive) {
      return;
    }

    // Always do full render (grouping needs re-render)
    await this.renderGalleryContentFull();
  }

  /**
   * Full gallery render (only on first load)
   */
  private async renderGalleryContentFull(): Promise<void> {
    // Don't render gallery if in subscription view
    if (this.isSubscriptionViewActive) {
      return;
    }
    // Find existing gallery
    const existingGallery = this.containerEl.querySelector('.media-gallery-container');

    // Create new gallery container
    const galleryContainer = this.containerEl.createDiv('media-gallery-container');
    galleryContainer.addClass('tc-gallery-fadein');

    // If existing gallery exists, insert new one and fade transition
    if (existingGallery) {
      existingGallery.parentElement?.insertBefore(galleryContainer, existingGallery.nextSibling);
    }

    // Minimal loading indicator (small spinner)
    const loadingEl = galleryContainer.createDiv({
      cls: 'media-gallery-loading'
    });
    // Loading styles handled by .media-gallery-loading CSS class

    const spinner = loadingEl.createDiv('media-gallery-spinner');
    const loadingText = loadingEl.createDiv({
      cls: 'media-gallery-loading-text',
      text: 'Loading media...'
    });

    try {
      // Create GalleryViewRenderer for all gallery logic
      this.galleryRenderer = new GalleryViewRenderer(this.app, this.vault, this.archivePath);

      // Get current search query from filter state
      const currentFilter = this.filterSortManager.getFilterState();

      // Get filtered post files (from already filtered posts)
      const filteredFiles = this.filteredPosts
        ?.map(post => {
          if (post.filePath) {
            const file = this.vault.getAbstractFileByPath(post.filePath);
            return file instanceof TFile ? file : null;
          }
          return null;
        })
        .filter((file): file is TFile => file !== null) || [];

      // Extract media items with platform and search filters applied
      const mediaItems = await this.galleryRenderer.extractMediaItems(
        currentFilter.platforms.size > 0 ? currentFilter.platforms : undefined,
        currentFilter.searchQuery,
        filteredFiles.length > 0 ? filteredFiles : undefined
      );

      loadingEl.remove();

      if (mediaItems.length === 0) {
        galleryContainer.createDiv({
          cls: 'flex items-center justify-center py-8 text-[var(--text-muted)]',
          text: 'No media found in archived posts'
        });

        // Fade in new gallery
        requestAnimationFrame(() => {
          galleryContainer.addClass('tc-gallery-visible');
          // Remove old gallery after fade
          if (existingGallery) {
            setTimeout(() => existingGallery.remove(), 200);
          }
        });
        return;
      }

      // Render gallery with filtered items (with grouping if set)
      this.galleryRenderer.renderGallery(galleryContainer, mediaItems, this.galleryGroupBy);

      // Fade in new gallery, fade out old
      requestAnimationFrame(() => {
        galleryContainer.addClass('tc-gallery-visible');

        // Remove old gallery after fade completes
        if (existingGallery) {
          (existingGallery as HTMLElement).addClass('tc-gallery-fadeout');
          setTimeout(() => existingGallery.remove(), 200);
        }
      });

    } catch (error) {
      loadingEl.remove();
      galleryContainer.createDiv({
        text: 'Error loading media: ' + (error instanceof Error ? error.message : 'Unknown error'),
        cls: 'flex items-center justify-center py-8 text-[var(--text-error)]'
      });

      // Fade in error state
      requestAnimationFrame(() => {
        galleryContainer.addClass('tc-gallery-visible');
        if (existingGallery) {
          setTimeout(() => existingGallery.remove(), 200);
        }
      });

      console.error('[Timeline] Gallery view error:', error);
    }
  }
}
// @ts-nocheck
          const deriveHandle = (author: any): string => {
            if (author.handle) {
              return author.handle.replace(/^@/, '');
            }
            if (author.authorUrl) {
              try {
                const url = new URL(author.authorUrl);
                const parts = url.pathname.split('/').filter(Boolean);
                const last = parts[parts.length - 1] || '';
                return last.replace(/^@/, '') || author.authorName || 'unknown';
              } catch {
                // fall through
              }
            }
            return (author.authorName || 'unknown').replace(/\s+/g, '').toLowerCase();
          };
