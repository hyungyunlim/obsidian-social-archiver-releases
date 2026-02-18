/**
 * SeriesCardRenderer - Renders series cards in the timeline
 *
 * Displays grouped series (e.g., Brunch books, Naver Webtoon) as a single card with:
 * - Series header with title and navigation controls
 * - Current episode content (using PostCardRenderer or WebtoonReaderRenderer)
 * - Collapsible episode list with excerpts/thumbnails
 * - Read/unread status indicators
 * - Episode switching with in-place DOM updates
 *
 * Webtoon-specific features:
 * - Continuous vertical scroll reader
 * - Episode cover thumbnails in list
 * - Metadata badges (genre, age rating, publish day)
 */

import { Component, setIcon, TFile, TFolder, Notice, type App } from 'obsidian';
import type { SeriesGroup, SeriesEpisode, SeriesViewState } from '../../../types/series';
import type { PostData } from '../../../types/post';
import type { WebtoonComment } from '../../../types/webtoon';
import type SocialArchiverPlugin from '../../../main';
import { getPlatformSimpleIcon } from '../../../services/IconService';
import { WebtoonReaderRenderer } from './WebtoonReaderRenderer';
import type { Subscription } from '../../../services/SubscriptionManager';
import { WebtoonArchiveModal } from '../../../modals/WebtoonArchiveModal';
import { NaverWebtoonLocalService, type EpisodeDetail, type WebtoonAPIInfo } from '../../../services/NaverWebtoonLocalService';
import { WebtoonsLocalService, type WebtoonsUrlInfo, type WebtoonsSeriesInfo } from '../../../services/WebtoonsLocalService';
import { getBackgroundDownloadManager } from '../../../services/BackgroundDownloadManager';
import { WebtoonsDownloadQueue, type WebtoonsEpisodeJob } from '../../../services/WebtoonsDownloadQueue';
import { VIEW_TYPE_TIMELINE } from '../../../views/TimelineView';
import { showConfirmModal } from '../../../utils/confirm-modal';
import { createSVGElement, createCustomSVG } from '../../../utils/dom-helpers';

/**
 * Callbacks for series card interactions
 */
export interface SeriesCardCallbacks {
  /** Called when user navigates to a different episode */
  onEpisodeChange: (seriesId: string, episode: number) => void;
  /** Called when user clicks to open the full post file */
  onOpenFile: (filePath: string) => void;
  /** Render episode content using PostCardRenderer pattern */
  renderEpisodeContent: (container: HTMLElement, postData: PostData) => Promise<void>;
  /** Get PostData for a file path */
  getPostData: (filePath: string) => Promise<PostData | null>;
  /** Called when timeline needs to be refreshed (optional) */
  onRefreshNeeded?: () => void;
  /** Called when user clicks to subscribe to a webtoon series */
  onSubscribeWebtoon?: (seriesId: string, seriesTitle: string, seriesUrl: string, publishDay?: string, thumbnailUrl?: string, authorNames?: string) => Promise<void>;
  /** Called when user clicks to unsubscribe from a webtoon series */
  onUnsubscribeWebtoon?: (subscriptionId: string) => Promise<void>;
  /** Called to register a file as UI-modified (prevents timeline refresh) */
  onUIModify?: (filePath: string) => void;
  /** Called when series is deleted (removes posts from array before refresh) */
  onSeriesDeleted?: (filePaths: string[]) => void;
}

/**
 * SeriesCardRenderer - Renders series as a single grouped card
 */
export class SeriesCardRenderer extends Component {
  private app: App;
  private plugin: SocialArchiverPlugin;
  private callbacks: SeriesCardCallbacks;

  // View state per series
  private viewStates: Map<string, SeriesViewState> = new Map();

  // DOM references for in-place updates
  private contentContainers: Map<string, HTMLElement> = new Map();
  private episodeIndicators: Map<string, HTMLElement> = new Map();
  private episodeLists: Map<string, HTMLElement> = new Map();
  private navButtons: Map<string, { prev: HTMLElement; next: HTMLElement }> = new Map();
  private cardElements: Map<string, HTMLElement> = new Map();

  // PostData cache
  private postDataCache: Map<string, PostData> = new Map();

  // Webtoon reader instances
  private webtoonReaders: Map<string, WebtoonReaderRenderer> = new Map();

  // Fullscreen state
  private fullscreenSeriesId: string | null = null;
  private escKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private fullscreenOriginalParent: HTMLElement | null = null;
  private fullscreenNextSibling: Node | null = null;
  private pendingRefreshOnFullscreenExit: boolean = false; // Background updates occurred

  // Immersive mode state (hide UI, show only content)
  private immersiveModeActive: boolean = false;

  // Subscription cache (for badge display)
  private subscriptionCache: Map<string, boolean> = new Map();

  // Comments state (for webtoon best comments dropdown)
  private commentsExpanded: Map<string, boolean> = new Map();
  private commentsCache: Map<string, WebtoonComment[]> = new Map();
  private commentsLoading: Map<string, boolean> = new Map();
  private commentsContainers: Map<string, { container: HTMLElement; loadingIndicator: HTMLElement; label: HTMLElement }> = new Map();

  // Streaming mode: remote image URLs for streaming before local download completes
  private streamingUrls: Map<string, string[]> = new Map();

  // Episode comment counts (for badges in episode list)
  // Map structure: seriesId -> Map(episodeNo -> commentCount)
  private episodeCommentCounts: Map<string, Map<number, number>> = new Map();
  private episodeCommentCountsLoading: Map<string, boolean> = new Map();

  // Pending read status updates (to skip re-render on metadata change)
  // Map structure: filePath -> isRead
  private pendingReadUpdates: Map<string, boolean> = new Map();
  private readUpdateDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Preview episode info cache (for subscribed webtoons)
  // Map structure: titleId -> { count: number, nextFree: { no: number, schedule: string } | null }
  private previewInfoCache: Map<string, { count: number; nextFree: { no: number; schedule: string } | null }> = new Map();
  private previewInfoLoading: Map<string, boolean> = new Map();
  private webtoonService: NaverWebtoonLocalService | null = null;
  private webtoonsLocalService: WebtoonsLocalService | null = null;

  // Prefetch cache for next episode (streaming mode optimization)
  // Map structure: seriesId_episodeNo -> EpisodeDetail
  private prefetchCache: Map<string, EpisodeDetail> = new Map();

  // Cleanup functions for document-level event listeners
  private cleanupFunctions: Array<() => void> = [];

  // Maximum entries for data-heavy caches to prevent unbounded memory growth
  private static readonly MAX_CACHE_SIZE = 50;

  constructor(app: App, plugin: SocialArchiverPlugin, callbacks: SeriesCardCallbacks) {
    super();
    this.app = app;
    this.plugin = plugin;
    this.callbacks = callbacks;
  }

  /**
   * Evict oldest entries from a Map when it exceeds the max cache size.
   * Map iteration order is insertion order, so we delete the first (oldest) entries.
   */
  private evictIfNeeded<K, V>(map: Map<K, V>, maxSize: number = SeriesCardRenderer.MAX_CACHE_SIZE): void {
    if (map.size <= maxSize) return;
    const excess = map.size - maxSize;
    const iterator = map.keys();
    for (let i = 0; i < excess; i++) {
      const key = iterator.next().value;
      if (key !== undefined) map.delete(key);
    }
  }

  /**
   * Check if series is a webtoon (needs special rendering)
   * Supports both Naver Webtoon (Korea) and WEBTOON Global
   */
  private isWebtoon(series: SeriesGroup): boolean {
    return series.platform === 'naver-webtoon' || series.platform === 'webtoons';
  }

  /**
   * Check if a webtoon series has an active subscription
   * Returns subscription info including ID for unsubscribe
   */
  private getSubscriptionInfo(seriesId: string): { isSubscribed: boolean; subscriptionId: string | null } {
    // Only check for webtoons
    if (!seriesId || !this.plugin.subscriptionManager?.isInitialized) {
      return { isSubscribed: false, subscriptionId: null };
    }

    try {
      const subscriptions = this.plugin.subscriptionManager.getSubscriptions();
      const seriesIdStr = String(seriesId);

      const subscription = subscriptions.find(
        (s: Subscription) => {
          if ((s.platform !== 'naver-webtoon' && s.platform !== 'webtoons') || !s.enabled) return false;
          // Match by naverWebtoonOptions.titleId or fallback to target.handle
          const titleId = s.naverWebtoonOptions?.titleId || s.target?.handle;
          return String(titleId) === seriesIdStr;
        }
      );

      return {
        isSubscribed: !!subscription,
        subscriptionId: subscription?.id ?? null
      };
    } catch (error) {
      console.error('[SeriesCardRenderer] Failed to check subscription:', error);
      return { isSubscribed: false, subscriptionId: null };
    }
  }

  /**
   * Fetch preview episode info for a webtoon (called when expanding episode list)
   * @param seriesId The titleId of the webtoon
   * @param platform The platform (naver-webtoon or webtoons)
   */
  private async loadPreviewInfo(seriesId: string, platform: string = 'naver-webtoon'): Promise<void> {
    if (this.previewInfoLoading.get(seriesId) || this.previewInfoCache.has(seriesId)) {
      return;
    }

    // Skip preview info for WEBTOON Global - API not supported
    if (platform === 'webtoons') {
      this.previewInfoCache.set(seriesId, { count: 0, nextFree: null });
      return;
    }

    this.previewInfoLoading.set(seriesId, true);

    try {
      // Initialize webtoon service if needed
      if (!this.webtoonService) {
        const naverCookie = this.plugin.settings.naverCookie;
        this.webtoonService = new NaverWebtoonLocalService(naverCookie);
      }

      const episodeList = await this.webtoonService.fetchEpisodeList(seriesId, 1);

      // Preview episodes are returned separately in previewEpisodes field (from chargeFolderArticleList)
      const previewEpisodes = episodeList.previewEpisodes;

      // Get the next free episode (the one closest to becoming free - last in the list)
      const lastPreview = previewEpisodes[previewEpisodes.length - 1];
      const nextFree = lastPreview
        ? {
            no: lastPreview.no,
            schedule: lastPreview.serviceDateDescription
          }
        : null;

      this.previewInfoCache.set(seriesId, {
        count: previewEpisodes.length,
        nextFree
      });
    } catch (error) {
      console.error('[SeriesCardRenderer] Failed to load preview info:', error);
      // Cache empty result to prevent repeated attempts
      this.previewInfoCache.set(seriesId, { count: 0, nextFree: null });
    } finally {
      this.previewInfoLoading.set(seriesId, false);
    }
  }

  /**
   * Render preview info banner for subscribed webtoons
   * @param container The container to render into
   * @param seriesId The titleId of the webtoon
   * @returns The banner element (or null if no preview info)
   */
  private renderPreviewBanner(container: HTMLElement, seriesId: string): HTMLElement | null {
    const previewInfo = this.previewInfoCache.get(seriesId);

    if (!previewInfo || previewInfo.count === 0) {
      return null;
    }

    const banner = container.createDiv({ cls: 'webtoon-preview-info-banner' });
    banner.addClass('sa-flex-row', 'sa-gap-6', 'sa-px-12', 'sa-py-6', 'sa-border-b', 'sa-text-xs', 'sa-text-muted');
    banner.setCssProps({ '--sa-bg': 'linear-gradient(to right, var(--background-secondary), var(--background-primary))' });
    banner.addClass('sa-dynamic-bg');

    // Calendar icon
    const icon = banner.createSpan();
    icon.addClass('sa-flex-row');
    setIcon(icon, 'calendar-clock');

    // Preview count
    const countSpan = banner.createSpan();
    countSpan.addClass('sa-font-medium');
    countSpan.setText(`${previewInfo.count} previews`);

    // Next free episode (if available)
    if (previewInfo.nextFree) {
      const separator = banner.createSpan({ text: '·' });
      separator.addClass('sa-text-faint');

      const nextSpan = banner.createSpan();
      nextSpan.setText(`Ep. ${previewInfo.nextFree.no} ${previewInfo.nextFree.schedule}`);
    }

    return banner;
  }

  /**
   * Convert Korean publish day to short English abbreviation
   * e.g., "토요웹툰" → "Sat", "월요웹툰" → "Mon"
   */
  private getPublishDayAbbr(publishDay: string): string {
    const dayMap: Record<string, string> = {
      '월요웹툰': 'Mon',
      '화요웹툰': 'Tue',
      '수요웹툰': 'Wed',
      '목요웹툰': 'Thu',
      '금요웹툰': 'Fri',
      '토요웹툰': 'Sat',
      '일요웹툰': 'Sun',
      // Also handle raw day names
      '월요일': 'Mon',
      '화요일': 'Tue',
      '수요일': 'Wed',
      '목요일': 'Thu',
      '금요일': 'Fri',
      '토요일': 'Sat',
      '일요일': 'Sun',
    };
    return dayMap[publishDay] || publishDay;
  }

  /**
   * Render publish day badge in header (for webtoons)
   * Shows short day abbreviation like "Mon", "Sat"
   */
  private renderPublishDayBadge(container: HTMLElement, publishDay: string): void {
    const dayAbbr = this.getPublishDayAbbr(publishDay);

    const badge = container.createDiv();
    badge.addClass('sa-inline-flex', 'sa-px-6', 'sa-rounded-12', 'sa-font-medium', 'sa-flex-shrink-0', 'sa-text-accent');
    badge.setCssProps({ '--sa-bg': 'rgba(var(--interactive-accent-rgb), 0.15)' });
    badge.addClass('sa-dynamic-bg', 'scr-publish-day-badge');
    badge.textContent = dayAbbr;
    badge.setAttribute('title', `Publishes on ${publishDay}`);
  }

  /**
   * Render subscription badge in header (always visible for webtoons)
   * Matches PostCardRenderer pattern with interactive toggle
   */
  private renderSubscriptionBadge(container: HTMLElement, series: SeriesGroup): void {
    if (!this.isWebtoon(series)) return;

    const badge = container.createDiv();
    let isLoading = false;
    let isUnsubscribing = false;

    // Get initial subscription state
    let { isSubscribed: currentSubscribed, subscriptionId } = this.getSubscriptionInfo(series.seriesId);

    const updateBadgeStyle = (subscribed: boolean, loading: boolean) => {
      badge.empty();
      badge.className = '';
      badge.addClass('sa-inline-flex', 'sa-gap-4', 'sa-rounded-12', 'sa-font-medium', 'sa-flex-shrink-0', 'sa-transition', 'scr-sub-badge');
      badge.toggleClass('scr-sub-badge--loading', loading);
      badge.classList.toggle('sa-opacity-80', loading);

      if (subscribed) {
        // Subscribed state - green badge
        badge.addClass('sa-dynamic-bg', 'sa-text-success', 'scr-sub-badge--subscribed');
        badge.setAttribute('title', 'Click to unsubscribe');

        // Bell icon
        const iconContainer = badge.createDiv();
        iconContainer.addClass('sa-icon-10');
        setIcon(iconContainer, 'bell');
        iconContainer.addClass('scr-sub-icon-subscribed');

        badge.createSpan({ text: 'Subscribed' });
      } else {
        // Not subscribed state - subtle badge
        badge.addClass('sa-bg-hover', 'sa-text-muted', 'scr-sub-badge--not-subscribed');

        const loadingText = isUnsubscribing ? 'Unsubscribing...' : 'Subscribing...';
        badge.setAttribute('title', loading ? loadingText : 'Click to subscribe');

        // Bell-plus icon or loading spinner
        const iconContainer = badge.createDiv();
        iconContainer.addClass('sa-icon-10');

        if (loading) {
          setIcon(iconContainer, 'loader-2');
          iconContainer.addClass('scr-sub-icon-loading');
        } else {
          setIcon(iconContainer, 'bell-plus');
          iconContainer.addClass('scr-sub-icon-default');
        }

        badge.createSpan({ text: loading ? loadingText : 'Subscribe' });
      }
    };

    // Initial render
    updateBadgeStyle(currentSubscribed, false);

    // Hover effects
    // Hover effects handled by CSS .scr-sub-badge--subscribed:hover / .scr-sub-badge--not-subscribed:hover

    // Click handler - Toggle subscribe/unsubscribe
    badge.addEventListener('click', (e) => { void (async () => {
      e.stopPropagation();
      if (isLoading) return;

      if (currentSubscribed && subscriptionId) {
        // Unsubscribe
        if (this.callbacks.onUnsubscribeWebtoon) {
          isLoading = true;
          isUnsubscribing = true;
          currentSubscribed = false;
          updateBadgeStyle(false, true);

          try {
            await this.callbacks.onUnsubscribeWebtoon(subscriptionId);
            subscriptionId = null;
            // Clear subscription cache
            this.subscriptionCache.delete(series.seriesId);
          } catch (error) {
            console.error('[SeriesCardRenderer] Failed to unsubscribe:', error);
            // Revert on error
            currentSubscribed = true;
          } finally {
            isLoading = false;
            isUnsubscribing = false;
            updateBadgeStyle(currentSubscribed, false);
          }
        }
      } else {
        // Subscribe
        if (this.callbacks.onSubscribeWebtoon) {
          isLoading = true;
          isUnsubscribing = false;
          updateBadgeStyle(false, true);

          try {
            // Get thumbnailUrl from first episode's PostData if available
            let thumbnailUrl: string | undefined;
            const firstEpisode = series.episodes[0];
            if (firstEpisode) {
              const postData = this.postDataCache.get(firstEpisode.filePath);
              thumbnailUrl = postData?.thumbnail || (postData?.series as Record<string, unknown> | undefined)?.['thumbnailUrl'] as string | undefined;
            }

            await this.callbacks.onSubscribeWebtoon(
              series.seriesId,
              series.seriesTitle,
              series.seriesUrl || `https://comic.naver.com/webtoon/list?titleId=${series.seriesId}`,
              series.publishDay,
              thumbnailUrl,
              series.author
            );
            currentSubscribed = true;
            // Refresh subscription info to get new subscriptionId
            const info = this.getSubscriptionInfo(series.seriesId);
            subscriptionId = info.subscriptionId;
            // Clear subscription cache
            this.subscriptionCache.delete(series.seriesId);
          } catch (error) {
            console.error('[SeriesCardRenderer] Failed to subscribe:', error);
            currentSubscribed = false;
          } finally {
            isLoading = false;
            updateBadgeStyle(currentSubscribed, false);
          }
        }
      }
    })(); });
  }

  /**
   * Render unread badge showing count of unread episodes
   * Only shown when there are unread episodes in the series
   */
  private renderUnreadBadge(container: HTMLElement, series: SeriesGroup): void {
    const unreadCount = series.episodes.filter(ep => !ep.isRead).length;
    if (unreadCount === 0) return;

    const badge = container.createDiv({ cls: 'series-unread-badge' });
    badge.addClass('sa-inline-flex', 'sa-rounded-8', 'sa-font-bold', 'sa-flex-shrink-0', 'sa-bg-accent', 'scr-unread-badge');
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.setAttribute('title', `${unreadCount} unread episode${unreadCount > 1 ? 's' : ''}`);
  }

  /**
   * Delete episode with associated media files
   * For webtoons, also deletes the media folder: {mediaPath}/naver-webtoon/{seriesId}/{episodeNo}/
   * Note: Confirmation should be handled by the caller before invoking this method
   */
  private async deleteEpisodeWithMedia(
    series: SeriesGroup,
    episode: SeriesEpisode
  ): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(episode.filePath);
    if (!(file instanceof TFile)) {
      return false;
    }

    // Delete the note file (respects user's trash preference)
    await this.app.fileManager.trashFile(file);

    // Clear cached PostData for the deleted episode to prevent stale image loading
    this.postDataCache.delete(episode.filePath);

    // Clear series-level caches to force full re-render on refresh
    // This prevents stale DOM references from trying to load deleted images
    const seriesId = series.seriesId;
    this.contentContainers.delete(seriesId);
    this.episodeIndicators.delete(seriesId);
    this.episodeLists.delete(seriesId);
    this.navButtons.delete(seriesId);
    this.viewStates.delete(seriesId);

    // Cleanup webtoon reader if exists
    const reader = this.webtoonReaders.get(seriesId);
    if (reader) {
      reader.destroy();
      this.webtoonReaders.delete(seriesId);
    }

    // Remove card element reference
    const cardEl = this.cardElements.get(seriesId);
    if (cardEl) {
      cardEl.remove();
      this.cardElements.delete(seriesId);
    }

    // For webtoons, also delete the media folder
    if (this.isWebtoon(series)) {
      const mediaBasePath = this.plugin.settings?.mediaPath || 'attachments/social-archives';
      const platformFolder = series.platform === 'webtoons' ? 'webtoons' : 'naver-webtoon';
      const mediaFolderPath = `${mediaBasePath}/${platformFolder}/${series.seriesId}/${episode.episode}`;

      try {
        const mediaFolder = this.app.vault.getAbstractFileByPath(mediaFolderPath);
        if (mediaFolder instanceof TFolder) {
          // Delete all files in the folder first
          const filesToDelete = [...mediaFolder.children];
          for (const child of filesToDelete) {
            if (child instanceof TFile) {
              await this.app.fileManager.trashFile(child);
            }
          }
          // Then delete the empty folder
          await this.app.fileManager.trashFile(mediaFolder);
        }
      } catch {
        // Don't fail the whole operation if media cleanup fails
      }
    }

    // Trigger refresh
    if (this.callbacks.onRefreshNeeded) {
      this.callbacks.onRefreshNeeded();
    }

    return true;
  }

  /**
   * Get the index (0-based) of an episode in the sorted episodes array
   */
  private getEpisodeIndex(series: SeriesGroup, episodeNumber: number): number {
    return series.episodes.findIndex(ep => ep.episode === episodeNumber);
  }

  /**
   * Get episode at a specific index (0-based)
   */
  private getEpisodeAtIndex(series: SeriesGroup, index: number): SeriesEpisode | null {
    return series.episodes[index] ?? null;
  }

  /**
   * Get resource path for vault files
   */
  private getResourcePath(path: string): string {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      return this.app.vault.getResourcePath(file);
    }
    return path;
  }

  /**
   * Check if episode has been downloaded locally
   * Returns true if episode folder exists with image files
   */
  private checkLocalEpisodeExists(
    seriesId: string,
    episodeNo: number,
    platform: string = 'naver-webtoon'
  ): { exists: boolean; imagePaths: string[] } {
    const mediaPath = this.plugin.settings.mediaPath || 'attachments/social-archives';
    const platformFolder = platform === 'webtoons' ? 'webtoons' : 'naver-webtoon';
    const episodeFolder = `${mediaPath}/${platformFolder}/${seriesId}/${episodeNo}`;

    const folder = this.app.vault.getAbstractFileByPath(episodeFolder);
    if (folder && folder instanceof TFolder) {
      const imagePaths = folder.children
        .filter((f): f is TFile => f instanceof TFile && /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(f => f.path);

      if (imagePaths.length > 0) {
        return { exists: true, imagePaths };
      }
    }
    return { exists: false, imagePaths: [] };
  }

  /**
   * Check if device is online
   */
  private isOnline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine;
  }

  /**
   * Fetch episode detail for streaming mode (with metadata: starScore, date, commentCount)
   * Uses NaverWebtoonLocalService for Naver Webtoon or WebtoonsLocalService for WEBTOON Global
   */
  private async fetchEpisodeDetailForStreaming(
    seriesId: string,
    episodeNo: number,
    platform: string = 'naver-webtoon',
    seriesUrl?: string
  ): Promise<EpisodeDetail | null> {
    // Check if offline
    if (!this.isOnline()) {
      return null;
    }

    try {
      if (platform === 'webtoons') {
        // WEBTOON Global - use WebtoonsLocalService
        return await this.fetchWebtoonsEpisodeDetailForStreaming(seriesId, episodeNo, seriesUrl);
      } else {
        // Naver Webtoon - use NaverWebtoonLocalService
        if (!this.webtoonService) {
          const naverCookie = this.plugin.settings.naverCookie;
          this.webtoonService = new NaverWebtoonLocalService(naverCookie);
        }
        // Use fetchEpisodeDetailWithMeta to get metadata (starScore, date, commentCount) along with images
        return await this.webtoonService.fetchEpisodeDetailWithMeta(seriesId, episodeNo);
      }
    } catch (error) {
      console.error('[SeriesCardRenderer] Failed to fetch episode detail for streaming:', error);
      return null;
    }
  }

  /**
   * Fetch WEBTOON Global episode detail for streaming mode
   * Converts WebtoonsEpisodeDetail to EpisodeDetail format
   */
  private async fetchWebtoonsEpisodeDetailForStreaming(
    titleNo: string,
    episodeNo: number,
    seriesUrl?: string
  ): Promise<EpisodeDetail | null> {
    try {
      if (!this.webtoonsLocalService) {
        this.webtoonsLocalService = new WebtoonsLocalService();
      }

      // Parse URL info from seriesUrl if available (needed for Canvas vs Originals URL format)
      let urlInfo: WebtoonsUrlInfo;
      if (seriesUrl) {
        const parsedUrl = this.webtoonsLocalService.parseUrl(seriesUrl);
        if (parsedUrl) {
          urlInfo = { ...parsedUrl, urlType: 'episode' as const };
        } else {
          // Fallback to minimal info
          urlInfo = {
            platform: 'webtoons',
            language: 'en',
            genre: '',
            seriesSlug: '',
            titleNo: titleNo,
            urlType: 'episode',
            isCanvas: false
          };
        }
      } else {
        // No seriesUrl - use minimal info (may fail for Canvas)
        urlInfo = {
          platform: 'webtoons',
          language: 'en',
          genre: '',
          seriesSlug: '',
          titleNo: titleNo,
          urlType: 'episode',
          isCanvas: false
        };
      }

      const webtoonsDetail = await this.webtoonsLocalService.fetchEpisodeDetail(urlInfo, episodeNo);

      // Convert WebtoonsEpisodeDetail to EpisodeDetail format for streaming renderer
      const detail: EpisodeDetail = {
        titleId: parseInt(titleNo, 10) || 0,
        no: webtoonsDetail.episodeNo,
        subtitle: webtoonsDetail.title || `Episode ${episodeNo}`,
        imageUrls: webtoonsDetail.imageUrls,
        thumbnailUrl: webtoonsDetail.thumbnailUrl
      };

      return detail;
    } catch (error) {
      console.error('[SeriesCardRenderer] Failed to fetch WEBTOON Global episode detail:', error);
      return null;
    }
  }

  /**
   * Render streaming episode content directly in the container
   * Uses Workers proxy for CORS bypass
   */
  private renderStreamingEpisode(
    series: SeriesGroup,
    detail: EpisodeDetail,
    container: HTMLElement
  ): void {
    // Preserve fullscreen state - check before destroying reader
    // Fullscreen state tracked via this.fullscreenSeriesId

    // Update viewState and episode indicator for streaming episode
    series.currentEpisode = detail.no;
    this.viewStates.set(series.seriesId, {
      currentEpisode: detail.no,
      expandedTOC: this.viewStates.get(series.seriesId)?.expandedTOC ?? false,
    });
    // Persist to SeriesGroupingService so state survives refresh
    this.callbacks.onEpisodeChange(series.seriesId, detail.no);

    // Update episode indicator - show streaming episode number
    // Format: "30 (streaming)" or just episode number if within known range
    const indicator = this.episodeIndicators.get(series.seriesId);
    if (indicator) {
      const existingIndex = series.episodes.findIndex(ep => ep.episode === detail.no);
      if (existingIndex >= 0) {
        // Episode exists in local list
        indicator.textContent = `${existingIndex + 1}/${series.episodes.length}`;
      } else {
        // Streaming episode beyond local list - show episode number
        const maxLocalEpisode = Math.max(...series.episodes.map(ep => ep.episode), 0);
        const streamingCount = detail.no - maxLocalEpisode;
        indicator.textContent = `${series.episodes.length + streamingCount}/${series.episodes.length}+`;
      }
    }

    // Update episode list styling (highlight current episode if in list, or unhighlight all)
    this.updateEpisodeListStyling(series, detail.no);

    // Update comments label for streaming episode (show "—" since no local data)
    const commentsRefs = this.commentsContainers.get(series.seriesId);
    if (commentsRefs?.label) {
      const existsLocally = series.episodes.some(ep => ep.episode === detail.no);
      if (!existsLocally) {
        // Streaming episode not downloaded yet - no comment data available
        commentsRefs.label.textContent = `Best comments (—)`;
      } else {
        // Episode exists locally - sync comments normally
        void this.syncCommentsForEpisode(series, detail.no);
      }
    }

    // Cleanup previous reader if exists
    const existingReader = this.webtoonReaders.get(series.seriesId);
    if (existingReader) {
      existingReader.destroy();
    }

    // Clear existing content (but keep fullscreen wrapper intact)
    container.empty();

    // Create synthetic Media array for streaming
    const streamingMedia = detail.imageUrls.map((url, idx) => ({
      type: 'image' as const,
      url: `streaming-placeholder-${idx}`, // Placeholder path (not used in streaming mode)
      altText: `Page ${idx + 1}`
    }));

    // Check if there's a next episode (in streaming, we don't know yet)
    // For now, assume there might be
    const hasNextEpisode = true;

    // Create webtoon reader with streaming options
    const reader = new WebtoonReaderRenderer({
      maxHeight: 600,
      preloadAhead: 5,
      showHeader: false,
      getResourcePath: (path: string) => this.getResourcePath(path),
      hasNextEpisode,
      streamingMode: true,
      remoteImageUrls: detail.imageUrls,
      workersEndpoint: this.plugin.settings.workerUrl,
      onNextEpisode: () => { void (async () => {
        const nextEpisodeNo = detail.no + 1;

        // First check if next episode is downloaded locally
        const localCheck = this.checkLocalEpisodeExists(series.seriesId, nextEpisodeNo, series.platform);
        if (localCheck.exists) {
          // Use local files instead of streaming
          this.renderLocalEpisode(series, nextEpisodeNo, localCheck.imagePaths, container);
          return;
        }

        // Check prefetch cache for instant transition
        const prefetchedDetail = this.getPrefetchedEpisode(series.seriesId, nextEpisodeNo);
        if (prefetchedDetail) {
          // Create markdown first, then stream (updates episode list and comments)
          await this.createMarkdownThenStream(series, prefetchedDetail, container);
          return;
        }

        // Fallback: fetch next episode (no prefetch available)
        const nextDetail = await this.fetchEpisodeDetailForStreaming(
          series.seriesId,
          nextEpisodeNo,
          series.platform,
          series.seriesUrl
        );
        if (nextDetail) {
          // Create markdown first, then stream (updates episode list and comments)
          await this.createMarkdownThenStream(series, nextDetail, container);
        } else if (!this.isOnline()) {
          // Offline - show message
          this.showOfflineMessage(container, 'Next episode not downloaded');
        } else {
          // No more episodes, open modal to check for updates
          this.handleAddEpisodeClick(series, nextEpisodeNo);
        }
      })(); },
      onCheckNewEpisodes: () => {
        const nextEpisodeNo = detail.no + 1;

        // First check locally
        const localCheck = this.checkLocalEpisodeExists(series.seriesId, nextEpisodeNo, series.platform);
        if (localCheck.exists) {
          this.renderLocalEpisode(series, nextEpisodeNo, localCheck.imagePaths, container);
          return;
        }

        if (!this.isOnline()) {
          this.showOfflineMessage(container, 'Cannot check for updates offline');
          return;
        }

        this.handleAddEpisodeClick(series, nextEpisodeNo);
      },
      onScrollComplete: () => {
        // For streaming mode, we can't auto-mark as read since there's no file yet
        // This would be handled after background download completes
      },
      onPrefetchThreshold: () => {
        // Prefetch next episode at 90% scroll for instant transition
        const streamingSettings = this.plugin.settings.webtoonStreaming;
        if (streamingSettings?.prefetchNextEpisode !== false) {
          void this.prefetchNextEpisode(series.seriesId, detail.no, series.platform, series.seriesUrl);
        }
      }
    });

    // Store reader instance
    this.webtoonReaders.set(series.seriesId, reader);

    // Render content
    reader.renderContentOnly(container, streamingMedia, 600);
  }

  /**
   * Render locally downloaded episode
   */
  private renderLocalEpisode(
    series: SeriesGroup,
    episodeNo: number,
    imagePaths: string[],
    container: HTMLElement
  ): void {
    // Cleanup previous reader if exists
    const existingReader = this.webtoonReaders.get(series.seriesId);
    if (existingReader) {
      existingReader.destroy();
    }

    // Clear existing content
    container.empty();

    // Create Media array from local paths
    const localMedia = imagePaths.map((path, idx) => ({
      type: 'image' as const,
      url: path,
      altText: `Page ${idx + 1}`
    }));

    // Check if there's a next episode
    const nextLocalCheck = this.checkLocalEpisodeExists(series.seriesId, episodeNo + 1, series.platform);
    const streamingSettings = this.plugin.settings.webtoonStreaming;
    const hasNextEpisode = nextLocalCheck.exists ||
      (streamingSettings?.viewMode === 'stream-first' && this.isOnline());

    // Create webtoon reader for local files
    const reader = new WebtoonReaderRenderer({
      maxHeight: 600,
      preloadAhead: 5,
      showHeader: false,
      getResourcePath: (path: string) => this.getResourcePath(path),
      hasNextEpisode,
      streamingMode: false,
      onNextEpisode: () => { void (async () => {
        const nextEpisodeNo = episodeNo + 1;

        // Check if next episode exists locally
        const localCheck = this.checkLocalEpisodeExists(series.seriesId, nextEpisodeNo, series.platform);
        if (localCheck.exists) {
          this.renderLocalEpisode(series, nextEpisodeNo, localCheck.imagePaths, container);
          return;
        }

        // Try streaming if enabled
        if (streamingSettings?.viewMode === 'stream-first') {
          // Check prefetch cache for instant transition
          const prefetchedDetail = this.getPrefetchedEpisode(series.seriesId, nextEpisodeNo);
          if (prefetchedDetail) {
            // Create markdown first, then stream (updates episode list and comments)
            await this.createMarkdownThenStream(series, prefetchedDetail, container);
            return;
          }

          // Fallback: fetch next episode
          const detail = await this.fetchEpisodeDetailForStreaming(series.seriesId, nextEpisodeNo, series.platform, series.seriesUrl);
          if (detail) {
            // Create markdown first, then stream (updates episode list and comments)
            await this.createMarkdownThenStream(series, detail, container);
            return;
          }
        }

        if (!this.isOnline()) {
          this.showOfflineMessage(container, 'Next episode not downloaded');
        } else {
          this.handleAddEpisodeClick(series, nextEpisodeNo);
        }
      })(); },
      onCheckNewEpisodes: () => {
        if (!this.isOnline()) {
          this.showOfflineMessage(container, 'Cannot check for updates offline');
          return;
        }
        this.handleAddEpisodeClick(series, episodeNo + 1);
      },
      onScrollComplete: () => {
        // Mark as read logic would go here
      },
      onPrefetchThreshold: () => {
        // Prefetch next episode at 90% scroll for instant transition
        // Only prefetch if streaming mode is enabled (for mixed local/streaming scenarios)
        const streamingSettings = this.plugin.settings.webtoonStreaming;
        if (streamingSettings?.viewMode === 'stream-first' && streamingSettings?.prefetchNextEpisode !== false) {
          void this.prefetchNextEpisode(series.seriesId, episodeNo, series.platform, series.seriesUrl);
        }
      }
    });

    // Store reader instance
    this.webtoonReaders.set(series.seriesId, reader);

    // Render content
    reader.renderContentOnly(container, localMedia, 600);
  }

  /**
   * Show offline message in container
   */
  private showOfflineMessage(container: HTMLElement, message: string): void {
    container.empty();

    const messageDiv = container.createDiv({ cls: 'webtoon-offline-message' });
    messageDiv.addClass('sa-flex-col', 'sa-flex-center', 'sa-gap-12', 'sa-p-20', 'sa-bg-secondary', 'sa-rounded-8', 'sa-text-muted', 'sa-text-center', 'scr-offline-message');

    const icon = messageDiv.createDiv();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '32');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', '1');
    line1.setAttribute('y1', '1');
    line1.setAttribute('x2', '23');
    line1.setAttribute('y2', '23');
    svg.appendChild(line1);

    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M16.72 11.06A10.94 10.94 0 0 1 19 12.55');
    svg.appendChild(path1);

    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('d', 'M5 12.55a10.94 10.94 0 0 1 5.17-2.39');
    svg.appendChild(path2);

    const path3 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path3.setAttribute('d', 'M10.71 5.05A16 16 0 0 1 22.58 9');
    svg.appendChild(path3);

    const path4 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path4.setAttribute('d', 'M1.42 9a15.91 15.91 0 0 1 4.7-2.88');
    svg.appendChild(path4);

    const path5 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path5.setAttribute('d', 'M8.53 16.11a6 6 0 0 1 6.95 0');
    svg.appendChild(path5);

    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', '12');
    line2.setAttribute('y1', '20');
    line2.setAttribute('x2', '12.01');
    line2.setAttribute('y2', '20');
    svg.appendChild(line2);

    icon.appendChild(svg);

    const text = messageDiv.createDiv();
    text.textContent = message;

    const hint = messageDiv.createDiv();
    hint.addClass('sa-text-sm', 'sa-opacity-80');
    hint.textContent = 'Connect to the internet to continue';
  }

  /**
   * Create markdown first, update series.episodes, then start streaming
   * This ensures episode list, comments, and indicators are properly updated
   *
   * Flow:
   * 1. Create markdown file (without images) using streamFirst mode
   * 2. Add new episode to series.episodes
   * 3. Update UI (episode list, indicator, comments)
   * 4. Start streaming (images load via proxy)
   * 5. Background download continues for images
   */
  private async createMarkdownThenStream(
    series: SeriesGroup,
    detail: EpisodeDetail,
    container: HTMLElement
  ): Promise<void> {
    try {
      const mediaPath = this.plugin.settings.mediaPath || 'attachments/social-archives';
      let result: { filePath: string; imageUrls: string[] } | null = null;

      // Branch based on platform
      if (series.platform === 'webtoons') {
        // WEBTOON Global - use WebtoonsDownloadQueue
        result = await this.downloadWebtoonsEpisodeAndWait(series, detail, mediaPath);
      } else {
        // Naver Webtoon - use BackgroundDownloadManager
        const webtoonInfo = await this.getWebtoonInfoForSeries(series);
        if (!webtoonInfo) {
          // Fallback to direct streaming without markdown
          this.renderStreamingEpisode(series, detail, container);
          return;
        }

        const downloadManager = getBackgroundDownloadManager(this.app, {}, mediaPath);

        // Connect to TimelineView for refresh suppression
        const timelineLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)[0];
        if (timelineLeaf?.view) {
          downloadManager.setTimelineView(timelineLeaf.view as Parameters<typeof downloadManager.setTimelineView>[0]);
        }

        // Download and wait for markdown creation
        result = await downloadManager.downloadEpisodeAndWait(webtoonInfo, detail, {
          streamFirst: true,
          timeout: 30000,
        });
      }

      if (!result) {
        // Timeout or failure - check if file was created by background download
        // Try to find the episode file that might have been created
        const mediaPath = this.plugin.settings.mediaPath || 'attachments/social-archives';
        const platformFolder = series.platform === 'webtoons' ? 'webtoons' : 'naver-webtoon';
        const possibleFolder = `${mediaPath}/${platformFolder}/${series.seriesId}`;

        // Look for episode markdown file in the series folder
        const seriesFolder = this.app.vault.getAbstractFileByPath(possibleFolder);
        let existingFilePath: string | null = null;

        if (seriesFolder instanceof TFolder) {
          // Search in parent folder for markdown file matching episode number
          const parentPath = possibleFolder.split('/').slice(0, -1).join('/');
          const parentFolder = this.app.vault.getAbstractFileByPath(parentPath);
          if (parentFolder instanceof TFolder) {
            for (const child of parentFolder.children) {
              if (child instanceof TFile && child.extension === 'md') {
                // Check if this file is for our episode
                const cache = this.app.metadataCache.getFileCache(child);
                const fm = cache?.frontmatter;
                if (fm && String(fm.seriesId) === String(series.seriesId) && fm.episode === detail.no) {
                  existingFilePath = child.path;
                  break;
                }
              }
            }
          }
        }

        // If we found an existing file, update series.episodes
        if (existingFilePath) {
          const file = this.app.vault.getAbstractFileByPath(existingFilePath);
          if (file instanceof TFile) {
            const existingIndex = series.episodes.findIndex(ep => ep.episode === detail.no);
            if (existingIndex < 0) {
              const newEpisode: SeriesEpisode = {
                episode: detail.no,
                file: file,
                title: detail.subtitle || `Episode ${detail.no}`,
                excerpt: '',
                published: detail.serviceDateDescription || new Date().toISOString(),
                archived: new Date().toISOString(),
                isRead: false,
                filePath: existingFilePath,
                starScore: detail.starScore,
              };

              // Insert in correct position
              const insertIndex = series.episodes.findIndex(ep => ep.episode > detail.no);
              if (insertIndex < 0) {
                series.episodes.push(newEpisode);
              } else {
                series.episodes.splice(insertIndex, 0, newEpisode);
              }

              // Re-render episode list
              const card = this.cardElements.get(series.seriesId);
              if (card) {
                const existingList = this.episodeLists.get(series.seriesId);
                if (existingList) {
                  existingList.remove();
                  this.episodeLists.delete(series.seriesId);
                }
                const state = this.viewStates.get(series.seriesId) ?? this.getViewState(series);
                const newList = this.renderEpisodeList(card, series, state);
                this.episodeLists.set(series.seriesId, newList);
              }
            }
          }
        }

        // Update current episode state
        series.currentEpisode = detail.no;
        this.viewStates.set(series.seriesId, {
          currentEpisode: detail.no,
          expandedTOC: this.viewStates.get(series.seriesId)?.expandedTOC ?? false,
        });
        this.callbacks.onEpisodeChange(series.seriesId, detail.no);

        // Update episode indicator
        const indicator = this.episodeIndicators.get(series.seriesId);
        if (indicator) {
          const newIndex = this.getEpisodeIndex(series, detail.no);
          indicator.textContent = `${newIndex + 1}/${series.episodes.length}`;
        }

        // Fallback to direct streaming
        this.renderStreamingEpisode(series, detail, container);
        return;
      }

      const { filePath } = result;

      // Get the created file
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        // Parse the new episode data
        const postData = await this.callbacks.getPostData(filePath);
        if (postData) {
          this.postDataCache.set(filePath, postData);
        }

        // Create new episode entry
        const newEpisode: SeriesEpisode = {
          episode: detail.no,
          file: file,
          title: detail.subtitle || `Episode ${detail.no}`,
          excerpt: '',
          published: detail.serviceDateDescription || new Date().toISOString(),
          archived: new Date().toISOString(),
          isRead: false,
          filePath: filePath,
          starScore: detail.starScore,
        };

        // Add to series.episodes if not already exists
        const existingIndex = series.episodes.findIndex(ep => ep.episode === detail.no);
        if (existingIndex < 0) {
          // Insert in correct position (sorted by episode number)
          const insertIndex = series.episodes.findIndex(ep => ep.episode > detail.no);
          if (insertIndex < 0) {
            series.episodes.push(newEpisode);
          } else {
            series.episodes.splice(insertIndex, 0, newEpisode);
          }
        }

        // Update current episode
        series.currentEpisode = detail.no;
        this.viewStates.set(series.seriesId, {
          currentEpisode: detail.no,
          expandedTOC: this.viewStates.get(series.seriesId)?.expandedTOC ?? false,
        });
        // Persist to SeriesGroupingService so state survives refresh
        this.callbacks.onEpisodeChange(series.seriesId, detail.no);

        // Update episode comment count cache for new episode
        if (detail.commentCount !== undefined && detail.commentCount > 0) {
          let counts = this.episodeCommentCounts.get(series.seriesId);
          if (!counts) {
            counts = new Map();
            this.episodeCommentCounts.set(series.seriesId, counts);
          }
          counts.set(detail.no, detail.commentCount);
        }

        // Re-render episode list to include new episode
        const card = this.cardElements.get(series.seriesId);
        if (card) {
          const existingList = this.episodeLists.get(series.seriesId);
          if (existingList) {
            existingList.remove();
            this.episodeLists.delete(series.seriesId);
          }
          const state = this.viewStates.get(series.seriesId) ?? this.getViewState(series);
          const newList = this.renderEpisodeList(card, series, state);
          this.episodeLists.set(series.seriesId, newList);
        }

        // Update episode indicator
        const indicator = this.episodeIndicators.get(series.seriesId);
        if (indicator) {
          const newIndex = this.getEpisodeIndex(series, detail.no);
          indicator.textContent = `${newIndex + 1}/${series.episodes.length}`;
        }

        // Sync comments for new episode
        void this.syncCommentsForEpisode(series, detail.no);
      }

      // Now render streaming episode (markdown exists, images still downloading)
      this.renderStreamingEpisode(series, detail, container);

    } catch (error) {
      console.error('[SeriesCardRenderer] createMarkdownThenStream failed:', error);
      // Fallback to direct streaming
      this.renderStreamingEpisode(series, detail, container);
    }
  }

  /**
   * Trigger background download for a streaming episode
   * Downloads images to vault while user continues reading
   * @deprecated Use createMarkdownThenStream instead for proper UI updates
   */
  private async triggerBackgroundDownload(
    series: SeriesGroup,
    detail: EpisodeDetail
  ): Promise<void> {
    try {
      // Get or create background download manager
      const downloadManager = getBackgroundDownloadManager(
        this.app,
        {},
        this.plugin.settings.mediaPath || 'attachments/social-archives'
      );

      // Connect to TimelineView for refresh suppression
      const timelineLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)[0];
      if (timelineLeaf?.view) {
        downloadManager.setTimelineView(timelineLeaf.view as Parameters<typeof downloadManager.setTimelineView>[0]);
      }

      // Get webtoon info from cached PostData or fetch it
      const webtoonInfo = await this.getWebtoonInfoForSeries(series);
      if (!webtoonInfo) {
        return;
      }

      // Add to silent download queue
      downloadManager.addSilentDownload(webtoonInfo, detail);
    } catch {
      // Silent failure - background download is optional
    }
  }

  /**
   * Get WebtoonAPIInfo for a series from cached data or by fetching
   */
  private async getWebtoonInfoForSeries(series: SeriesGroup): Promise<WebtoonAPIInfo | null> {
    // Try to get info from cached PostData
    for (const episode of series.episodes) {
      const postData = this.postDataCache.get(episode.filePath);
      if (postData?.series) {
        // Construct WebtoonAPIInfo from PostData.series
        // Note: thumbnailUrl and synopsis may be present at runtime but not in type definition
        const seriesData = postData.series as unknown as Record<string, unknown>;
        return {
          titleId: parseInt(series.seriesId, 10) || 0,
          titleName: series.seriesTitle,
          thumbnailUrl: (seriesData.thumbnailUrl as string) || '',
          synopsis: (seriesData.synopsis as string) || '',
          finished: postData.series.finished || false,
          publishDescription: postData.series.publishDay || '',
          favoriteCount: 0,
          curationTagList: (postData.series.genre || []).map(g => ({ tagName: g })),
          communityArtists: [{ name: series.author }],
          age: { description: postData.series.ageRating || '' }
        };
      }
    }

    // Fallback: fetch from API
    try {
      if (!this.webtoonService) {
        const naverCookie = this.plugin.settings.naverCookie;
        this.webtoonService = new NaverWebtoonLocalService(naverCookie);
      }
      return await this.webtoonService.fetchWebtoonInfo(series.seriesId);
    } catch (error) {
      console.error('[SeriesCardRenderer] Failed to fetch webtoon info:', error);
      return null;
    }
  }

  /**
   * Download WEBTOON Global episode and wait for markdown creation
   * Uses WebtoonsDownloadQueue directly instead of BackgroundDownloadManager
   */
  private async downloadWebtoonsEpisodeAndWait(
    series: SeriesGroup,
    detail: EpisodeDetail,
    mediaBasePath: string
  ): Promise<{ filePath: string; imageUrls: string[] } | null> {
    const timeout = 30000;

    // Initialize webtoonsLocalService if needed
    if (!this.webtoonsLocalService) {
      this.webtoonsLocalService = new WebtoonsLocalService();
    }

    // Parse URL info from seriesUrl
    let urlInfo: WebtoonsUrlInfo;
    if (series.seriesUrl) {
      const parsedUrl = this.webtoonsLocalService.parseUrl(series.seriesUrl);
      if (parsedUrl) {
        urlInfo = { ...parsedUrl, urlType: 'episode' as const };
      } else {
        // Fallback to minimal info
        urlInfo = {
          platform: 'webtoons',
          language: 'en',
          genre: '',
          seriesSlug: '',
          titleNo: series.seriesId,
          urlType: 'episode',
          isCanvas: false
        };
      }
    } else {
      // No seriesUrl - use minimal info
      urlInfo = {
        platform: 'webtoons',
        language: 'en',
        genre: '',
        seriesSlug: '',
        titleNo: series.seriesId,
        urlType: 'episode',
        isCanvas: false
      };
    }

    // Build series info from available data
    const seriesInfo: WebtoonsSeriesInfo = {
      titleNo: series.seriesId,
      title: series.seriesTitle,
      description: '',
      thumbnailUrl: '',
      language: urlInfo.language,
      genre: urlInfo.genre,
      authorNames: series.author,
      isCompleted: false,
      updateDay: series.publishDay,
      isCanvas: urlInfo.isCanvas,
      rssUrl: `https://www.webtoons.com/${urlInfo.language}/${urlInfo.genre}/${series.seriesId}/rss?title_no=${series.seriesId}`
    };

    // Try to get more info from cached post data
    for (const episode of series.episodes) {
      const postData = this.postDataCache.get(episode.filePath);
      if (postData?.series) {
        const seriesData = postData.series as unknown as Record<string, unknown>;
        if (seriesData.thumbnailUrl) {
          seriesInfo.thumbnailUrl = seriesData.thumbnailUrl as string;
        }
        if (seriesData.synopsis) {
          seriesInfo.description = seriesData.synopsis as string;
        }
        break;
      }
    }

    // Create temporary queue for single episode download
    const tempQueue = new WebtoonsDownloadQueue(
      this.app,
      { episodeDelay: 0, imageDelay: 50 },
      mediaBasePath
    );

    // Add episode to queue
    const episodeJob: WebtoonsEpisodeJob = {
      episodeNo: detail.no,
      title: detail.subtitle || `Episode ${detail.no}`,
      thumbnailUrl: detail.thumbnailUrl,
      status: 'pending'
    };
    tempQueue.addEpisodes([episodeJob]);

    // Wait for markdown creation event
    const result = await new Promise<{ filePath: string; imageUrls: string[] } | null>((resolve) => {
      const timeoutId = setTimeout(() => {
        console.warn('[SeriesCardRenderer] WEBTOON Global download timed out');
        resolve(null);
      }, timeout);

      tempQueue.addEventListener('markdown-created', ((e: CustomEvent) => {
        clearTimeout(timeoutId);
        const detail = e.detail as Record<string, unknown>;
        resolve({
          filePath: typeof detail.filePath === 'string' ? detail.filePath : '',
          imageUrls: Array.isArray(detail.imageUrls) ? (detail.imageUrls as string[]) : [],
        });
      }) as EventListener);

      tempQueue.addEventListener('episode-failed', ((e: CustomEvent) => {
        clearTimeout(timeoutId);
        const detail = e.detail as Record<string, unknown>;
        console.error('[SeriesCardRenderer] WEBTOON Global episode download failed:', detail.error);
        resolve(null);
      }) as EventListener);

      // Start download (fire and forget - events will resolve the promise)
      void tempQueue.start(urlInfo, seriesInfo, { streamFirst: true });
    });

    return result;
  }

  /**
   * Prefetch next episode for instant transition (streaming mode optimization)
   * Called when user scrolls to 90% of current episode
   */
  private async prefetchNextEpisode(seriesId: string, currentEpisodeNo: number, platform: string = 'naver-webtoon', seriesUrl?: string): Promise<void> {
    const nextEpisodeNo = currentEpisodeNo + 1;
    const cacheKey = `${seriesId}_${nextEpisodeNo}`;

    // Skip if already cached
    if (this.prefetchCache.has(cacheKey)) {
      return;
    }

    // Skip if offline
    if (!this.isOnline()) {
      return;
    }

    // Check if next episode is already downloaded locally
    const localCheck = this.checkLocalEpisodeExists(seriesId, nextEpisodeNo, platform);
    if (localCheck.exists) {
      return;
    }

    try {
      // Fetch episode detail (metadata + image URLs)
      const detail = await this.fetchEpisodeDetailForStreaming(seriesId, nextEpisodeNo, platform, seriesUrl);
      if (detail) {
        this.prefetchCache.set(cacheKey, detail);
      }
    } catch {
      // Silent fail - prefetch is optional optimization
    }
  }

  /**
   * Get prefetched episode data if available
   */
  private getPrefetchedEpisode(seriesId: string, episodeNo: number): EpisodeDetail | null {
    const cacheKey = `${seriesId}_${episodeNo}`;
    return this.prefetchCache.get(cacheKey) || null;
  }

  /**
   * Clear prefetch cache for a series (e.g., when series card is destroyed)
   */
  private clearPrefetchCache(seriesId: string): void {
    for (const key of this.prefetchCache.keys()) {
      if (key.startsWith(`${seriesId}_`)) {
        this.prefetchCache.delete(key);
      }
    }
  }

  /**
   * Get or initialize view state for a series
   */
  private getViewState(series: SeriesGroup): SeriesViewState {
    let state = this.viewStates.get(series.seriesId);
    if (!state) {
      state = {
        currentEpisode: series.currentEpisode,
        expandedTOC: false
      };
      this.viewStates.set(series.seriesId, state);
    }
    return state;
  }

  /**
   * Render a series card
   */
  public async render(container: HTMLElement, series: SeriesGroup): Promise<HTMLElement> {
    // Evict oldest entries from data-heavy caches to bound memory usage
    this.evictIfNeeded(this.postDataCache);
    this.evictIfNeeded(this.commentsCache);
    this.evictIfNeeded(this.prefetchCache);
    this.evictIfNeeded(this.previewInfoCache);
    this.evictIfNeeded(this.episodeCommentCounts);

    const state = this.getViewState(series);

    // Sync viewState with series data
    const currentEpisodeData = series.episodes.find(ep => ep.episode === state.currentEpisode);

    if (!currentEpisodeData && series.episodes.length > 0) {
      // Check if this is a streaming episode (beyond local episodes)
      const maxLocalEpisode = Math.max(...series.episodes.map(ep => ep.episode), 0);

      if (state.currentEpisode <= maxLocalEpisode) {
        // Case 1: Current episode was deleted - switch to the latest episode
        const sortOrder = this.plugin.settings.webtoonEpisodeSortOrder ?? 'asc';
        const latestEpisode = sortOrder === 'desc'
          ? series.episodes[0]
          : series.episodes[series.episodes.length - 1];
        if (latestEpisode) {
          state.currentEpisode = latestEpisode.episode;
          this.callbacks.onEpisodeChange(series.seriesId, latestEpisode.episode);
        }
      }
      // else: streaming episode beyond local list - keep current state
    } else if (currentEpisodeData?.isRead) {
      // Case 2: Current episode is read - check for newer unread episodes
      // This handles the scenario: user read episode 3, then downloaded episode 4
      // Find the first unread episode with a higher episode number
      const unreadNewerEpisode = series.episodes
        .filter(ep => ep.episode > state.currentEpisode && !ep.isRead)
        .sort((a, b) => a.episode - b.episode)[0]; // Get the lowest unread episode number

      if (unreadNewerEpisode) {
        state.currentEpisode = unreadNewerEpisode.episode;
        this.callbacks.onEpisodeChange(series.seriesId, unreadNewerEpisode.episode);
      }
    }

    const currentEpisode = series.episodes.find(ep => ep.episode === state.currentEpisode);
    const isWebtoon = this.isWebtoon(series);

    // Card wrapper with platform-specific class
    const cardClasses = ['series-card', 'social-post-card'];
    if (isWebtoon) {
      cardClasses.push('webtoon-series-card');
    }
    const card = container.createDiv({ cls: cardClasses.join(' ') });
    this.cardElements.set(series.seriesId, card);

    // Header with series info and navigation
    this.renderHeader(card, series, state);

    // Episode content area
    const contentContainer = card.createDiv({
      cls: isWebtoon ? 'series-content webtoon-content' : 'series-content'
    });
    this.contentContainers.set(series.seriesId, contentContainer);

    // Render current episode content
    if (currentEpisode) {
      if (isWebtoon) {
        await this.renderWebtoonContent(contentContainer, series, currentEpisode);
      } else {
        await this.renderEpisodeContent(contentContainer, currentEpisode);
      }
    }

    // Best comments dropdown (for webtoons, positioned BEFORE episode list)
    if (isWebtoon) {
      this.renderCommentsDropdown(card, series, state);
    }

    // Episode list (TOC) - always show for delete/actions access
    if (series.episodes.length >= 1) {
      const episodeList = this.renderEpisodeList(card, series, state);
      this.episodeLists.set(series.seriesId, episodeList);
    }

    return card;
  }

  /**
   * Render series header with title and navigation
   */
  private renderHeader(container: HTMLElement, series: SeriesGroup, state: SeriesViewState): HTMLElement {
    const isWebtoon = this.isWebtoon(series);
    const currentIndex = this.getEpisodeIndex(series, state.currentEpisode);
    const hasMultipleEpisodes = series.episodes.length > 1;

    // Header container - use inline styles with setProperty for !important
    const header = container.createDiv({
      cls: isWebtoon ? 'series-header webtoon-header' : 'series-header'
    });
    header.addClass('scr-header');

    // Row 1: [icon] [title] [badge] ----spacer---- [controls]
    const row1 = document.createElement('div');
    row1.className = 'series-header-row1';
    row1.addClass('scr-header-row');
    header.appendChild(row1);

    // Platform icon (left)
    const platformIcon = document.createElement('div');
    platformIcon.className = 'series-platform-icon';
    platformIcon.addClass('scr-platform-icon');
    const icon = getPlatformSimpleIcon(series.platform);
    if (icon) {
      const svg = createSVGElement(icon, {
        width: '16px',
        height: '16px'
      });
      platformIcon.appendChild(svg);
    }
    row1.appendChild(platformIcon);

    // Title (clickable)
    const titleEl = document.createElement('span');
    titleEl.className = 'series-title';
    titleEl.textContent = series.seriesTitle;
    titleEl.addClass('scr-title');
    if (series.seriesUrl) {
      titleEl.addClass('sa-clickable');
      titleEl.addEventListener('click', () => {
        window.open(series.seriesUrl, '_blank');
      });
    }
    row1.appendChild(titleEl);

    // Publish day badge (for webtoons, right after title)
    if (isWebtoon && series.publishDay) {
      this.renderPublishDayBadge(row1, series.publishDay);
    }

    // Subscription badge (right after title)
    this.renderSubscriptionBadge(row1, series);

    // Note: Unread badge removed - read status shown via subtle episode styling instead

    // Spacer to push controls to the right
    const spacer = document.createElement('div');
    spacer.addClass('scr-spacer');
    row1.appendChild(spacer);

    // Controls section (right side, fixed at the end)
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
    const controlsSection = document.createElement('div');
    controlsSection.className = 'series-controls';
    controlsSection.addClass('scr-controls', isMobile ? 'scr-controls--mobile' : 'scr-controls--desktop');
    row1.appendChild(controlsSection);

    // Navigation controls (only if multiple episodes)
    if (hasMultipleEpisodes) {
      const navSection = controlsSection.createDiv({ cls: 'series-nav' });
      // Reduce gap between prev/next on mobile
      navSection.addClass('scr-nav-section', isMobile ? 'scr-nav-section--mobile' : 'scr-nav-section--desktop');

      // Previous button
      const prevBtn = navSection.createDiv({
        cls: `series-nav-btn ${currentIndex <= 0 ? 'disabled' : ''}`
      });
      setIcon(prevBtn, 'chevron-left');
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigateEpisode(series, -1);
      });

      // Episode indicator (position-based: "1/2" not "441/2") - hidden on mobile
      const indicator = navSection.createDiv({ cls: 'series-episode-indicator' });
      indicator.textContent = `${currentIndex + 1}/${series.episodes.length}`;
      indicator.classList.toggle('sa-hidden', isMobile);
      this.episodeIndicators.set(series.seriesId, indicator);

      // Next button
      const nextBtn = navSection.createDiv({
        cls: `series-nav-btn ${currentIndex >= series.episodes.length - 1 ? 'disabled' : ''}`
      });
      setIcon(nextBtn, 'chevron-right');
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.navigateEpisode(series, 1);
      });

      // Store nav button references for state updates
      this.navButtons.set(series.seriesId, { prev: prevBtn, next: nextBtn });
    }

    // Expand/fullscreen button (for webtoons)
    if (isWebtoon) {
      const expandBtn = controlsSection.createDiv({ cls: 'series-expand-btn' });
      setIcon(expandBtn, 'maximize-2');
      expandBtn.setAttribute('aria-label', 'Expand to fullscreen');

      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFullscreen(series);
      });
    }

    return header;
  }

  /**
   * Toggle fullscreen mode for a series card
   */
  private toggleFullscreen(series: SeriesGroup): void {
    const card = this.cardElements.get(series.seriesId);
    if (!card) return;

    const isCurrentlyFullscreen = this.fullscreenSeriesId === series.seriesId;

    if (isCurrentlyFullscreen) {
      this.exitFullscreen(series);
    } else {
      this.enterFullscreen(series, card);
    }
  }

  /**
   * Enter fullscreen mode
   * Moves the card to document.body to escape stacking context from contain:paint
   * Preserves scroll position as a percentage
   */
  private enterFullscreen(series: SeriesGroup, card: HTMLElement): void {
    // Exit any existing fullscreen first
    if (this.fullscreenSeriesId) {
      const prevCard = this.cardElements.get(this.fullscreenSeriesId);
      if (prevCard) {
        prevCard.classList.remove('series-fullscreen');
      }
    }

    // Remove previous keyboard handler if exists
    if (this.escKeyHandler) {
      document.removeEventListener('keydown', this.escKeyHandler);
      this.escKeyHandler = null;
    }

    this.fullscreenSeriesId = series.seriesId;
    this.pendingRefreshOnFullscreenExit = false; // Reset flag on new fullscreen

    // Save scroll position as percentage before DOM changes
    const scrollContainer = card.querySelector('.webtoon-scroll-container');
    let scrollPercent = 0;
    if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
      const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      scrollPercent = maxScroll > 0 ? scrollContainer.scrollTop / maxScroll : 0;
    }

    // Store original position for restoration
    this.fullscreenOriginalParent = card.parentElement;
    this.fullscreenNextSibling = card.nextSibling;

    // Create backdrop first (lower z-index)
    const backdrop = document.createElement('div');
    backdrop.className = 'series-fullscreen-backdrop';
    backdrop.addEventListener('click', () => this.exitFullscreen(series));
    document.body.appendChild(backdrop);

    // Move card to document.body to escape stacking context
    document.body.appendChild(card);
    card.classList.add('series-fullscreen');

    // Apply safe-area padding to header for notch/dynamic island
    const header = card.querySelector('.series-header') as HTMLElement;
    if (header) {
      header.addClass('scr-header--fullscreen');
    }

    // Restore scroll position after layout settles
    if (scrollContainer && scrollPercent > 0) {
      requestAnimationFrame(() => {
        const newMaxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
        if (newMaxScroll > 0) {
          scrollContainer.scrollTop = newMaxScroll * scrollPercent;
        }
      });
    }

    // Update expand icon to minimize
    const expandBtn = card.querySelector('.series-expand-btn');
    if (expandBtn) {
      (expandBtn as HTMLElement).empty();
      setIcon(expandBtn as HTMLElement, 'minimize-2');
    }

    // Disable CSS smooth scroll for keyboard navigation (use JS animation instead)
    if (scrollContainer) {
      scrollContainer.addClass('scr-scroll-no-smooth');
    }

    // Add fullscreen keyboard handler (ESC, PageUp/Down, Home/End)
    // Note: scrollContainer is looked up dynamically each time because content may be re-rendered
    // (e.g., after background download completes, content switches from streaming to local)
    this.escKeyHandler = (e: KeyboardEvent) => {
      // ESC - exit fullscreen/immersive mode
      if (e.key === 'Escape') {
        if (this.immersiveModeActive) {
          this.exitImmersiveMode(card);
        } else {
          this.exitFullscreen(series);
        }
        return;
      }

      // Find scroll container dynamically (may have changed after content re-render)
      const currentScrollContainer = card.querySelector('.webtoon-scroll-container');

      // Navigation keys - only for webtoons with scroll container
      if (!currentScrollContainer) return;

      const scrollAmount = currentScrollContainer.clientHeight * 0.9; // 90% of viewport

      // Check if images are still loading (streaming mode causes layout shifts)
      const images = currentScrollContainer.querySelectorAll('img');
      const hasLoadingImages = Array.from(images).some(img => img.src && !img.complete);

      // Scroll helper - use native smooth scroll (browser handles layout shifts better)
      const scrollTo = (target: number) => {
        if (hasLoadingImages) {
          // Instant scroll during image loading to avoid layout shift issues
          currentScrollContainer.scrollTop = target;
        } else {
          // Native smooth scroll - browser handles it better than JS animation
          currentScrollContainer.scrollTo({
            top: target,
            behavior: 'smooth'
          });
        }
      };

      switch (e.key) {
        case 'PageDown':
        case ' ': // Space bar
          e.preventDefault();
          scrollTo(currentScrollContainer.scrollTop + scrollAmount);
          break;
        case 'PageUp':
          e.preventDefault();
          scrollTo(currentScrollContainer.scrollTop - scrollAmount);
          break;
        case 'Home':
          e.preventDefault();
          scrollTo(0);
          break;
        case 'End':
          e.preventDefault();
          scrollTo(currentScrollContainer.scrollHeight - currentScrollContainer.clientHeight);
          break;
        case 'ArrowDown':
          e.preventDefault();
          scrollTo(currentScrollContainer.scrollTop + 100);
          break;
        case 'ArrowUp':
          e.preventDefault();
          scrollTo(currentScrollContainer.scrollTop - 100);
          break;
      }
    };
    document.addEventListener('keydown', this.escKeyHandler);

    // Add immersive mode toggle for webtoons (tap to hide/show UI)
    if (this.isWebtoon(series) && scrollContainer) {
      scrollContainer.addEventListener("click", (e: Event) => this.handleImmersiveTap(card, e as MouseEvent));
      // Add cursor hint
      scrollContainer.addClass('scr-scroll-clickable');

      // Show brief tap hint animation (first time only)
      scrollContainer.classList.add('show-tap-hint');
      setTimeout(() => {
        scrollContainer.classList.remove('show-tap-hint');
      }, 2500);
    }
  }

  /**
   * Handle tap on webtoon content to toggle immersive mode
   */
  private handleImmersiveTap = (card: HTMLElement, e: MouseEvent): void => {
    // Only work in fullscreen mode
    if (!this.fullscreenSeriesId) return;

    // Prevent event from bubbling to backdrop
    e.stopPropagation();

    if (this.immersiveModeActive) {
      this.exitImmersiveMode(card);
    } else {
      this.enterImmersiveMode(card);
    }
  };

  /**
   * Enter immersive mode - hide all UI, show only content
   */
  private enterImmersiveMode(card: HTMLElement): void {
    this.immersiveModeActive = true;
    card.classList.add('series-immersive');

    // Hide backdrop in immersive mode for true full-screen feel
    const backdrop = document.querySelector('.series-fullscreen-backdrop') as HTMLElement;
    if (backdrop) {
      backdrop.addClass('sa-opacity-0');
    }
  }

  /**
   * Exit immersive mode - show UI again
   */
  private exitImmersiveMode(card: HTMLElement): void {
    this.immersiveModeActive = false;
    card.classList.remove('series-immersive');

    // Restore backdrop
    const backdrop = document.querySelector('.series-fullscreen-backdrop') as HTMLElement;
    if (backdrop) {
      backdrop.removeClass('sa-opacity-0');
    }
  }

  /**
   * Exit fullscreen mode
   * Restores the card to its original position in the DOM
   * Preserves scroll position as a percentage
   */
  private exitFullscreen(series: SeriesGroup): void {
    // IMPORTANT: Always cleanup backdrop and ESC handler first, even if card is not found
    // This prevents backdrop from remaining visible on mobile

    // Remove ESC handler
    if (this.escKeyHandler) {
      document.removeEventListener('keydown', this.escKeyHandler);
      this.escKeyHandler = null;
    }

    // Remove backdrop
    const backdrop = document.querySelector('.series-fullscreen-backdrop');
    if (backdrop) {
      backdrop.remove();
    }

    // Reset immersive mode
    this.immersiveModeActive = false;

    // Clear fullscreen series ID
    this.fullscreenSeriesId = null;

    const card = this.cardElements.get(series.seriesId);
    if (!card) {
      // Cleanup position references even if card not found
      this.fullscreenOriginalParent = null;
      this.fullscreenNextSibling = null;
      return;
    }

    // Save scroll position as percentage before DOM changes
    const scrollContainer = card.querySelector('.webtoon-scroll-container');
    let scrollPercent = 0;
    if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
      const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      scrollPercent = maxScroll > 0 ? scrollContainer.scrollTop / maxScroll : 0;
    }

    card.classList.remove('series-fullscreen');
    card.classList.remove('series-immersive');

    // Restore CSS smooth scroll behavior
    if (scrollContainer) {
      scrollContainer.removeClass('scr-scroll-no-smooth');
      scrollContainer.addClass('scr-scroll-smooth');
    }

    // Reset header padding (remove safe-area adjustment)
    const header = card.querySelector('.series-header') as HTMLElement;
    if (header) {
      header.removeClass('scr-header--fullscreen');
      header.addClass('scr-header--normal');
    }

    // Reset cursor on scroll container (immersive mode cleanup)
    if (scrollContainer) {
      scrollContainer.removeClass('scr-scroll-clickable');
    }

    // Detect mobile (touch device or narrow viewport)
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;

    // On mobile: always refresh (DOM restoration doesn't work reliably)
    // On desktop: try to restore card to original position
    if (isMobile) {
      // Mobile: remove card and refresh timeline
      if (card.parentNode) {
        card.remove();
      }
      this.cardElements.delete(series.seriesId);
      this.contentContainers.delete(series.seriesId);
      this.episodeIndicators.delete(series.seriesId);
      this.episodeLists.delete(series.seriesId);
      this.navButtons.delete(series.seriesId);
      this.webtoonReaders.delete(series.seriesId);
      this.commentsContainers.delete(series.seriesId);

      // Clear stored position references
      this.fullscreenOriginalParent = null;
      this.fullscreenNextSibling = null;

      if (this.callbacks.onRefreshNeeded) {
        this.callbacks.onRefreshNeeded();
      }
    } else {
      // Desktop: restore to original position
      if (this.fullscreenOriginalParent && this.fullscreenOriginalParent.isConnected) {
        if (this.fullscreenNextSibling && this.fullscreenNextSibling.parentNode === this.fullscreenOriginalParent) {
          this.fullscreenOriginalParent.insertBefore(card, this.fullscreenNextSibling);
        } else {
          this.fullscreenOriginalParent.appendChild(card);
        }
      }

      // Clear stored position references
      this.fullscreenOriginalParent = null;
      this.fullscreenNextSibling = null;

      // Restore scroll position
      if (scrollContainer && scrollPercent > 0) {
        requestAnimationFrame(() => {
          const newMaxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
          if (newMaxScroll > 0) {
            scrollContainer.scrollTop = newMaxScroll * scrollPercent;
          }
        });
      }

      // Update icon back to maximize
      const expandBtn = card.querySelector('.series-expand-btn');
      if (expandBtn) {
        (expandBtn as HTMLElement).empty();
        setIcon(expandBtn as HTMLElement, 'maximize-2');
      }

      // Sync comments container display state with expanded state
      // DOM may have been affected during fullscreen transition
      const commentsRefs = this.commentsContainers.get(series.seriesId);
      if (commentsRefs) {
        const isExpanded = this.commentsExpanded.get(series.seriesId) ?? false;
        commentsRefs.container.classList.toggle('sa-hidden', !isExpanded);

        // Also sync chevron rotation
        const chevron = card.querySelector('.comments-list-chevron') as HTMLElement;
        if (chevron) {
          chevron.setCssProps({ '--sa-transform': isExpanded ? 'rotate(90deg)' : 'none' });
          chevron.addClass('sa-dynamic-transform');
        }
      }

      // If background updates occurred during fullscreen, trigger full refresh
      // to properly re-render series group with new episodes
      if (this.pendingRefreshOnFullscreenExit) {
        this.pendingRefreshOnFullscreenExit = false;
        if (this.callbacks.onRefreshNeeded) {
          this.callbacks.onRefreshNeeded();
        }
      }
    }
  }

  /**
   * Handle add episode button click - opens WebtoonArchiveModal for downloading more episodes
   * @param series - The series group
   * @param preSelectEpisodeNo - Optional episode number to pre-select (for deep linking to next episode)
   */
  private handleAddEpisodeClick(series: SeriesGroup, preSelectEpisodeNo?: number): void {
    // Exit fullscreen mode first if active (modal would appear behind fullscreen card due to z-index)
    if (this.fullscreenSeriesId === series.seriesId) {
      this.exitFullscreen(series);
    }

    // Construct URL - use episode deep link if preSelectEpisodeNo provided
    let webtoonUrl: string;
    if (preSelectEpisodeNo) {
      // Deep link to specific episode for auto-selection
      if (series.platform === 'webtoons' && series.seriesUrl) {
        // WEBTOON Global - parse seriesUrl to build episode URL
        const urlMatch = series.seriesUrl.match(/webtoons\.com\/([^/]+)\/([^/]+)\/([^/]+)\/list/);
        if (urlMatch) {
          const [, lang, genre, slug] = urlMatch;
          webtoonUrl = `https://www.webtoons.com/${lang}/${genre}/${slug}/episode-${preSelectEpisodeNo}/viewer?title_no=${series.seriesId}&episode_no=${preSelectEpisodeNo}`;
        } else {
          webtoonUrl = series.seriesUrl;
        }
      } else {
        // Naver Webtoon Korea
        webtoonUrl = `https://comic.naver.com/webtoon/detail?titleId=${series.seriesId}&no=${preSelectEpisodeNo}`;
      }
    } else {
      webtoonUrl = series.seriesUrl || `https://comic.naver.com/webtoon/list?titleId=${series.seriesId}`;
    }
    new WebtoonArchiveModal(this.app, this.plugin, webtoonUrl).open();
  }

  /**
   * Render compact metadata badges for webtoon in header
   */
  private renderWebtoonMetadataBadges(container: HTMLElement, series: SeriesGroup): void {
    // Get metadata from first episode's PostData if available
    const firstEpisode = series.episodes[0];
    if (!firstEpisode) return;

    const postData = this.postDataCache.get(firstEpisode.filePath);
    const metadata = postData?.series;

    // We'll populate this asynchronously if not cached
    if (!metadata) {
      // Try to get from frontmatter directly
      void this.callbacks.getPostData(firstEpisode.filePath).then((data) => {
        if (data?.series) {
          this.postDataCache.set(firstEpisode.filePath, data);
          // Re-render badges if container still exists
          this.addMetadataBadgesToContainer(container, data.series);
        }
      });
      return;
    }

    this.addMetadataBadgesToContainer(container, metadata);
  }

  /**
   * Add metadata badges to container
   */
  private addMetadataBadgesToContainer(
    container: HTMLElement,
    metadata: PostData['series']
  ): void {
    if (!metadata) return;

    // Age rating (compact)
    if (metadata.ageRating) {
      const ageBadge = container.createSpan({ cls: 'webtoon-badge age-badge' });
      ageBadge.addClass('sa-rounded-4', 'sa-text-muted', 'scr-wt-badge', 'scr-wt-badge--age');
      ageBadge.textContent = metadata.ageRating;
    }

    // Publish day
    if (metadata.publishDay) {
      const dayBadge = container.createSpan({ cls: 'webtoon-badge day-badge' });
      dayBadge.addClass('sa-rounded-4', 'sa-text-muted', 'sa-bg-hover', 'scr-wt-badge');
      dayBadge.textContent = metadata.publishDay;
      if (metadata.finished) {
        dayBadge.textContent += ' ✓';
      }
    }

    // First 2 genres only (compact)
    if (metadata.genre && metadata.genre.length > 0) {
      for (const genre of metadata.genre.slice(0, 2)) {
        const genreBadge = container.createSpan({ cls: 'webtoon-badge genre-badge' });
        genreBadge.addClass('sa-rounded-4', 'sa-text-faint', 'sa-bg-hover', 'scr-wt-badge');
        genreBadge.textContent = genre;
      }
    }
  }

  /**
   * Render current episode content (for non-webtoon series)
   */
  private async renderEpisodeContent(container: HTMLElement, episode: SeriesEpisode): Promise<void> {
    container.empty();

    // Get full PostData for the episode
    let postData: PostData | undefined = this.postDataCache.get(episode.filePath);
    if (!postData) {
      const fetchedData = await this.callbacks.getPostData(episode.filePath);
      if (fetchedData) {
        postData = fetchedData;
        this.postDataCache.set(episode.filePath, postData);
      }
    }

    if (postData) {
      // Create content wrapper for PostCardRenderer
      const contentWrapper = container.createDiv({ cls: 'episode-content-wrapper' });
      await this.callbacks.renderEpisodeContent(contentWrapper, postData);
    } else {
      // Fallback to excerpt (styles from skeleton-card.css)
      const excerptEl = container.createEl('p', { cls: 'episode-excerpt' });
      excerptEl.textContent = episode.excerpt;
    }
  }

  /**
   * Render webtoon episode content with vertical scroll reader
   */
  private async renderWebtoonContent(
    container: HTMLElement,
    series: SeriesGroup,
    episode: SeriesEpisode
  ): Promise<void> {
    container.empty();

    // Cleanup previous reader if exists
    const existingReader = this.webtoonReaders.get(series.seriesId);
    if (existingReader) {
      existingReader.destroy();
    }

    // Check streaming mode FIRST - we may have remote URLs even if local file doesn't exist
    const streamingImageUrls = this.streamingUrls.get(series.seriesId);
    const hasStreamingUrls = !!streamingImageUrls && streamingImageUrls.length > 0;

    // Get full PostData for the episode
    let postData: PostData | undefined = this.postDataCache.get(episode.filePath);
    if (!postData) {
      const fetchedData = await this.callbacks.getPostData(episode.filePath);
      if (fetchedData) {
        postData = fetchedData;
        this.postDataCache.set(episode.filePath, postData);
      }
    }

    // Only fallback to excerpt if BOTH postData is empty AND no streaming URLs
    if ((!postData || postData.media.length === 0) && !hasStreamingUrls) {
      // Fallback to excerpt
      const excerptEl = container.createEl('p', { cls: 'episode-excerpt' });
      excerptEl.textContent = episode.excerpt;
      return;
    }

    // Episode title header (minimal)
    const episodeHeader = container.createDiv({ cls: 'webtoon-episode-header' });
    episodeHeader.addClass('sa-px-16', 'sa-py-12', 'sa-border-b', 'sa-bg-secondary');

    // Episode number + title
    const titleRow = episodeHeader.createDiv({ cls: 'webtoon-episode-title-row' });
    titleRow.addClass('sa-flex-row', 'sa-gap-8');

    const episodeNum = titleRow.createSpan({ cls: 'webtoon-episode-num' });
    episodeNum.addClass('sa-px-8', 'sa-bg-accent', 'sa-rounded-4', 'sa-text-sm', 'sa-font-bold', 'scr-episode-num');
    episodeNum.textContent = `Ep. ${episode.episode}`;

    const episodeTitle = titleRow.createSpan({ cls: 'webtoon-episode-title' });
    episodeTitle.addClass('sa-text-md', 'sa-font-medium', 'sa-text-normal', 'sa-truncate', 'sa-flex-1', 'sa-min-w-0', 'sa-clickable');
    // Extract just the episode title (remove series name prefix and episode number prefix)
    let titleText = episode.title.includes(' - ')
      ? episode.title.split(' - ').slice(-1)[0]
      : episode.title;
    // Remove episode number prefix if present (e.g., "4화 추이와 황요" → "추이와 황요")
    titleText = titleText?.replace(new RegExp(`^${episode.episode}화\\s*`, 'i'), '') || '';
    episodeTitle.textContent = titleText || '';

    // Main content title click → open original URL
    episodeTitle.addEventListener('click', (e) => {
      e.stopPropagation();
      let episodeUrl: string;
      if (series.platform === 'webtoons') {
        // WEBTOON Global - parse seriesUrl to build episode URL
        // seriesUrl format: https://www.webtoons.com/en/canvas/nerd-and-jock/list?title_no=135963
        // Also try authorUrl as fallback for older files
        const urlToMatch = series.seriesUrl || series.authorUrl;
        const urlMatch = urlToMatch?.match(/webtoons\.com\/([^/]+)\/([^/]+)\/([^/]+)\/list/);
        if (urlMatch) {
          const [, lang, genre, slug] = urlMatch;
          episodeUrl = `https://www.webtoons.com/${lang}/${genre}/${slug}/episode-${episode.episode}/viewer?title_no=${series.seriesId}&episode_no=${episode.episode}`;
        } else if (urlToMatch) {
          // Fallback to seriesUrl or authorUrl directly
          episodeUrl = urlToMatch;
        } else {
          // Last resort: build a basic WEBTOON Global URL (English, canvas)
          episodeUrl = `https://www.webtoons.com/en/canvas/series/episode-${episode.episode}/viewer?title_no=${series.seriesId}&episode_no=${episode.episode}`;
        }
      } else {
        // Naver Webtoon Korea
        episodeUrl = `https://comic.naver.com/webtoon/detail?titleId=${series.seriesId}&no=${episode.episode}`;
      }
      window.open(episodeUrl, '_blank');
    });

    // Author name (right side of episode title)
    const authorEl = titleRow.createSpan({ cls: 'series-author' });
    authorEl.addClass('sa-text-muted', 'sa-text-sm', 'sa-flex-shrink-0', 'scr-nowrap');
    authorEl.textContent = `by ${series.author}`;

    // Check if there's a next episode
    const currentIndex = this.getEpisodeIndex(series, episode.episode);
    const hasNextEpisode = currentIndex < series.episodes.length - 1;

    // Get streaming settings
    const streamingSettings = this.plugin.settings.webtoonStreaming;
    const isStreamFirst = streamingSettings?.viewMode === 'stream-first';

    // Use hasStreamingUrls from earlier check (already fetched above)
    const isStreaming = hasStreamingUrls;

    // In streaming mode, create media array from remote URLs (local files may not exist yet)
    // This ensures all images are rendered even before background download completes
    const mediaToRender = isStreaming && streamingImageUrls
      ? streamingImageUrls.map((url, idx) => ({
          type: 'image' as const,
          url: `streaming-${idx}`, // Placeholder path - actual URL comes from remoteImageUrls
          altText: `Page ${idx + 1}`
        }))
      : (postData?.media ?? []);

    // Create webtoon reader with next episode support
    const reader = new WebtoonReaderRenderer({
      maxHeight: 600,
      preloadAhead: 5,
      showHeader: false, // We render our own header
      getResourcePath: (path: string) => this.getResourcePath(path),
      hasNextEpisode: hasNextEpisode || isStreamFirst, // In stream-first mode, assume there might be more
      // Streaming mode: load images via Workers proxy instead of local files
      streamingMode: isStreaming,
      remoteImageUrls: streamingImageUrls,
      workersEndpoint: this.plugin.settings.workerUrl || 'https://social-archiver-api.social-archive.org',
      onNextEpisode: () => { void (async () => {
        // First check if next episode exists locally
        const nextEpisode = series.episodes[currentIndex + 1];
        if (nextEpisode) {
          // Local episode exists - use normal switch
          await this.switchToEpisode(series, nextEpisode.episode);
          return;
        }

        // No local episode - check streaming settings
        if (isStreamFirst) {
          // Stream-first mode: try to stream the next episode
          const nextEpisodeNo = episode.episode + 1;
          const detail = await this.fetchEpisodeDetailForStreaming(
            series.seriesId,
            nextEpisodeNo,
            series.platform,
            series.seriesUrl
          );

          if (detail) {
            // Found episode - create markdown first, then stream
            await this.createMarkdownThenStream(series, detail, container);
            return;
          }
        }

        // Fallback: open download modal (download-first mode or streaming failed)
        const nextEpisodeNo = episode.episode + 1;
        this.handleAddEpisodeClick(series, nextEpisodeNo);
      })(); },
      onCheckNewEpisodes: () => { void (async () => {
        // In stream-first mode, try streaming first
        if (isStreamFirst) {
          const nextEpisodeNo = episode.episode + 1;
          const detail = await this.fetchEpisodeDetailForStreaming(
            series.seriesId,
            nextEpisodeNo,
            series.platform,
            series.seriesUrl
          );

          if (detail) {
            // New episode found - create markdown first, then stream
            await this.createMarkdownThenStream(series, detail, container);
            return;
          }
        }

        // No new episode or download-first mode - open modal
        const nextEpisodeNo = episode.episode + 1;
        this.handleAddEpisodeClick(series, nextEpisodeNo);
      })(); },
      onScrollComplete: () => {
        // Auto-mark as read when scroll reaches 95%+
        if (!episode.isRead) {
          this.markEpisodeAsRead(series, episode, true);
        }
      }
    });
    this.webtoonReaders.set(series.seriesId, reader);

    // Render content images only (skip cover for in-series view)
    // Use mediaToRender which may be from streaming URLs or local postData
    reader.renderContentOnly(container, mediaToRender, 600);

    // Mobile: tap on content to enter fullscreen + immersive directly
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
    if (isMobile) {
      const scrollContainer = container.querySelector('.webtoon-scroll-container');
      if (scrollContainer) {
        scrollContainer.addClass('scr-scroll-clickable');
        scrollContainer.addEventListener('click', (e) => {
          // Only handle when NOT in fullscreen (timeline view)
          // When in fullscreen, the enterFullscreen handler takes over
          if (this.fullscreenSeriesId) return;

          e.stopPropagation();
          const card = this.cardElements.get(series.seriesId);
          if (!card) return;

          // Enter fullscreen + immersive directly
          this.enterFullscreen(series, card);
          requestAnimationFrame(() => {
            this.enterImmersiveMode(card);
          });
        });
      }
    }
  }

  /**
   * Render collapsible Best Comments dropdown for webtoons
   * Positioned BEFORE the Episodes dropdown
   * Comments are loaded lazily on expand
   */
  private renderCommentsDropdown(container: HTMLElement, series: SeriesGroup, state: SeriesViewState): HTMLElement {
    const seriesId = series.seriesId;
    const currentEpisodeNo = state.currentEpisode;
    const isExpanded = this.commentsExpanded.get(seriesId) ?? false;

    const wrapper = container.createDiv({ cls: 'series-comments-wrapper webtoon-comments-list' });

    // Toggle header (similar to episode list pattern)
    const toggleHeader = wrapper.createDiv({ cls: 'comments-list-toggle' });
    toggleHeader.addClass('sa-flex-row', 'sa-gap-8', 'sa-px-12', 'sa-py-8', 'sa-clickable', 'sa-border', 'scr-comments-toggle');

    // Chevron icon
    const chevron = toggleHeader.createDiv({ cls: `comments-list-chevron ${isExpanded ? 'expanded' : ''}` });
    setIcon(chevron, 'chevron-right');
    chevron.addClass('sa-icon-16', 'sa-text-muted', 'sa-transition-transform');
    if (isExpanded) {
      chevron.setCssProps({ '--sa-transform': 'rotate(90deg)' });
      chevron.addClass('sa-dynamic-transform');
    }

    // Label (will be updated with count)
    const label = toggleHeader.createEl('span', { cls: 'comments-list-label' });
    label.addClass('sa-text-base', 'sa-font-medium', 'sa-text-muted', 'sa-flex-1');
    label.textContent = 'Best comments';

    // Load comment count asynchronously and update label
    void this.updateCommentsLabelCount(series, currentEpisodeNo, label);

    // Loading indicator (will be shown/hidden)
    const loadingIndicator = toggleHeader.createDiv({ cls: 'comments-loading' });
    loadingIndicator.addClass('sa-hidden', 'sa-icon-14', 'sa-text-muted');
    setIcon(loadingIndicator, 'loader-2');
    const loadingSvg = loadingIndicator.querySelector('svg');
    if (loadingSvg) {
      loadingSvg.classList.add('scr-comments-loading-svg');
    }

    // Comments container (collapsed by default, scrollable)
    const commentsContainer = wrapper.createDiv({ cls: 'comments-list-container' });
    commentsContainer.classList.toggle('sa-hidden', !isExpanded);
    commentsContainer.addClass('sa-px-12', 'sa-overflow-y-auto', 'scr-comments-container');

    // Store container reference for episode sync
    this.commentsContainers.set(seriesId, { container: commentsContainer, loadingIndicator, label });

    // If already expanded and cached, render comments
    if (isExpanded && this.commentsCache.has(seriesId)) {
      const cachedComments = this.commentsCache.get(seriesId) || [];
      this.renderCommentItems(commentsContainer, cachedComments);
    }

    // Toggle handler with lazy loading
    toggleHeader.addEventListener('click', () => { void (async () => {
      const newExpanded = !this.commentsExpanded.get(seriesId);
      this.commentsExpanded.set(seriesId, newExpanded);

      // Update chevron rotation
      if (newExpanded) {
        chevron.setCssProps({ '--sa-transform': 'rotate(90deg)' });
        chevron.addClass('sa-dynamic-transform');
      } else {
        chevron.removeClass('sa-dynamic-transform');
        chevron.setCssProps({ '--sa-transform': '' });
      }

      // Toggle container visibility
      commentsContainer.classList.toggle('sa-hidden', !newExpanded);

      // Load comments on first expand (from local PostData, not API)
      // Use current episode from viewState, not the captured closure value
      if (newExpanded && !this.commentsCache.has(seriesId)) {
        const currentEpisode = this.getViewState(series).currentEpisode;
        await this.loadCommentsFromPostData(series, currentEpisode, commentsContainer, loadingIndicator);
      }
    })(); });

    // Hover effect handled by CSS .scr-comments-toggle:hover

    return wrapper;
  }

  /**
   * Load best comments from markdown content (not API or frontmatter)
   * Parses the "## Best Comments" section from the archived markdown file
   */
  private async loadCommentsFromPostData(
    series: SeriesGroup,
    episodeNo: number,
    container: HTMLElement,
    loadingIndicator: HTMLElement
  ): Promise<void> {
    const seriesId = series.seriesId;

    // Prevent duplicate loading
    if (this.commentsLoading.get(seriesId)) {
      return;
    }

    this.commentsLoading.set(seriesId, true);
    loadingIndicator.removeClass('sa-hidden');

    try {
      // Find the current episode file
      let file: TFile | null = null;

      // First try from series.episodes array
      const episode = series.episodes.find(ep => ep.episode === episodeNo);
      if (episode) {
        const f = this.app.vault.getAbstractFileByPath(episode.filePath);
        if (f instanceof TFile) {
          file = f;
        }
      }

      // If not found, search by frontmatter (for streaming episodes not yet in array)
      if (!file) {
        file = this.findEpisodeFileByFrontmatter(seriesId, episodeNo, series.platform);
      }

      if (!file) {
        // File not found - show no comments
        this.showNoCommentsMessage(container);
        return;
      }

      const content = await this.app.vault.read(file);
      const comments = this.parseCommentsFromMarkdown(content);

      this.commentsCache.set(seriesId, comments);
      this.renderCommentItems(container, comments);
    } catch (error) {
      console.error('[SeriesCardRenderer] Failed to load comments from markdown:', error);
      this.showNoCommentsMessage(container);
    } finally {
      this.commentsLoading.set(seriesId, false);
      loadingIndicator.addClass('sa-hidden');
    }
  }

  /**
   * Find episode file by frontmatter when not in series.episodes array
   * Used for streaming episodes that are downloaded but not yet indexed
   */
  private findEpisodeFileByFrontmatter(
    seriesId: string,
    episodeNo: number,
    platform: string
  ): TFile | null {
    // Markdown files are in "Social Archives/{platform}/" not in media folder
    const platformDisplayName = platform === 'webtoons' ? 'WEBTOON' : 'naver-webtoon';
    const parentPath = `Social Archives/${platformDisplayName}`;

    const parentFolder = this.app.vault.getAbstractFileByPath(parentPath);
    if (!parentFolder || !(parentFolder instanceof TFolder)) {
      return null;
    }

    // Recursively search for matching markdown file
    const searchFolder = (folder: TFolder): TFile | null => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === 'md') {
          const cache = this.app.metadataCache.getFileCache(child);
          const fm = cache?.frontmatter;
          if (fm && String(fm.seriesId) === String(seriesId) && fm.episode === episodeNo) {
            return child;
          }
        } else if (child instanceof TFolder) {
          const found = searchFolder(child);
          if (found) return found;
        }
      }
      return null;
    };

    return searchFolder(parentFolder);
  }

  /**
   * Show "no comments" message in container
   */
  private showNoCommentsMessage(container: HTMLElement): void {
    // Clear existing content first to avoid duplicates
    container.empty();

    const errorEl = container.createDiv({ cls: 'comments-empty' });
    errorEl.addClass('sa-p-12', 'sa-text-center', 'sa-text-muted', 'sa-text-sm');
    errorEl.textContent = 'No saved comments';
  }

  /**
   * Parse Best Comments section from markdown content
   *
   * Supports two formats:
   *
   * Naver Webtoon format:
   * > 🏆 **작성자** · ♥ 1,234 · 💬 56
   * > 댓글 내용
   *
   * WEBTOON Global format:
   * > **Duburrito** · Jun 19, 2025
   * > Comment text here
   * > 👍 28,123 · 👎 138 · 💬 104
   */
  private parseCommentsFromMarkdown(content: string): WebtoonComment[] {
    const comments: WebtoonComment[] = [];

    // Find the Best Comments section (with optional count suffix like "(3,449 total)")
    const bestCommentsMatch = content.match(/## Best Comments.*?\n([\s\S]*?)(?=\n##|\n\*\d|$)/);
    if (!bestCommentsMatch) {
      return comments;
    }

    const commentsSection = bestCommentsMatch[1];
    if (!commentsSection) {
      return comments;
    }

    // Try Naver Webtoon format first
    // Format: > 🏆 **작성자** · ♥ 1,234 · 💬 56\n> 댓글 내용
    const naverRegex = /^> (✏️|🏆) \*\*(.+?)\*\* · ♥ ([\d,]+) · 💬 ([\d,]+)\n> (.+?)(?=\n\n|\n> (?:✏️|🏆)|$)/gmu;

    let match;
    let index = 0;
    while ((match = naverRegex.exec(commentsSection)) !== null) {
      const [, badge, author, likesStr, repliesStr, body] = match;
      if (!author || !likesStr || !body) continue;

      comments.push({
        id: `parsed-${index++}`,
        body: body.trim(),
        createdAt: 0,
        author: {
          name: author,
          isCreator: badge === '✏️',
        },
        likes: parseInt(likesStr.replace(/,/g, ''), 10) || 0,
        replyCount: parseInt((repliesStr || '0').replace(/,/g, ''), 10) || 0,
      });
    }

    // If no Naver format found, try WEBTOON Global format
    // Format:
    // > **Author** · Date
    // > Comment body
    // > 👍 28,123 · 👎 138 · 💬 104
    if (comments.length === 0) {
      const globalRegex = /^> \*\*(.+?)\*\* · (.+?)\n> (.+?)\n> 👍 ([\d,]+)(?:.*?💬 (\d+))?/gm;

      while ((match = globalRegex.exec(commentsSection)) !== null) {
        const [, author, , body, likesStr, repliesStr] = match;
        if (!author || !body || !likesStr) continue;

        comments.push({
          id: `parsed-${index++}`,
          body: body.trim(),
          createdAt: 0,
          author: {
            name: author,
            isCreator: false,
          },
          likes: parseInt(likesStr.replace(/,/g, ''), 10) || 0,
          replyCount: parseInt((repliesStr || '0').replace(/,/g, ''), 10) || 0,
        });
      }
    }

    return comments;
  }

  /**
   * Render comment items in the container
   */
  private renderCommentItems(container: HTMLElement, comments: WebtoonComment[]): void {
    container.empty();

    if (comments.length === 0) {
      const emptyEl = container.createDiv({ cls: 'comments-empty' });
      emptyEl.addClass('sa-p-12', 'sa-text-center', 'sa-text-muted', 'sa-text-sm');
      emptyEl.textContent = 'No best comments';
      return;
    }

    // Render each comment
    for (const comment of comments) {
      this.renderCommentItem(container, comment);
    }
  }

  /**
   * Render a single comment item (multi-line block layout)
   */
  private renderCommentItem(container: HTMLElement, comment: WebtoonComment): void {
    const item = container.createDiv({ cls: 'comment-item' });
    item.addClass('sa-py-8', 'sa-border-b');

    // Header row: Author name
    const headerEl = item.createDiv({ cls: 'comment-header' });
    headerEl.addClass('sa-flex-row', 'sa-gap-6', 'sa-mb-4');

    const authorEl = headerEl.createSpan({ cls: 'comment-author' });
    authorEl.addClass('sa-font-bold', 'sa-text-sm', 'sa-text-normal');
    authorEl.textContent = comment.author.name;

    // Comment body (full content with line breaks preserved)
    const bodyEl = item.createDiv({ cls: 'comment-body' });
    bodyEl.addClass('sa-text-sm', 'sa-text-muted', 'sa-word-break', 'sa-leading-normal', 'scr-comment-body');
    bodyEl.textContent = comment.body;

    // Footer row: Likes at the end
    const footerEl = item.createDiv({ cls: 'comment-footer' });
    footerEl.addClass('sa-flex-row', 'sa-gap-8', 'sa-mt-4', 'sa-text-xs', 'sa-text-faint');

    // Likes
    const likesEl = footerEl.createSpan({ cls: 'comment-likes' });
    likesEl.addClass('sa-flex-row', 'sa-gap-4');
    const heartIcon = likesEl.createSpan();
    heartIcon.addClass('sa-icon-12', 'scr-comment-heart');
    setIcon(heartIcon, 'heart');
    likesEl.createSpan().textContent = this.formatCount(comment.likes);

    // Reply count (if exists)
    if (comment.replyCount && comment.replyCount > 0) {
      const repliesEl = footerEl.createSpan({ cls: 'comment-replies' });
      repliesEl.addClass('sa-flex-row', 'sa-gap-4');
      const replyIcon = repliesEl.createSpan();
      replyIcon.addClass('sa-icon-12');
      setIcon(replyIcon, 'message-circle');
      repliesEl.createSpan().textContent = this.formatCount(comment.replyCount);
    }
  }

  /**
   * Format count for display (e.g., 5940 → "5.9K", 12300 → "12.3K")
   */
  private formatCount(count: number): string {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toLocaleString();
  }

  /**
   * Mark episode as read/unread with UI update and debounced YAML save
   * @param series - The series group
   * @param episode - The episode to mark
   * @param isRead - New read status
   */
  private markEpisodeAsRead(series: SeriesGroup, episode: SeriesEpisode, isRead: boolean): void {
    // Skip if already in desired state
    if (episode.isRead === isRead) return;

    // Update episode object immediately
    episode.isRead = isRead;

    // Update UI immediately (episode list item with subtle styling)
    this.updateEpisodeReadUI(series.seriesId, episode.episode, isRead);

    // Note: Header unread badge removed - read status shown via subtle episode styling instead

    // Add to pending updates and debounce YAML save
    this.pendingReadUpdates.set(episode.filePath, isRead);
    this.scheduleReadStatusSave();
  }

  /**
   * Update unread badge in series header
   */
  private updateUnreadBadge(series: SeriesGroup): void {
    const card = this.cardElements.get(series.seriesId);
    if (!card) return;

    const unreadCount = series.episodes.filter(ep => !ep.isRead).length;
    let badge = card.querySelector('.series-unread-badge');

    if (unreadCount === 0) {
      // Remove badge if all read
      badge?.remove();
    } else if (badge) {
      // Update existing badge
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.setAttribute('title', `${unreadCount} unread episode${unreadCount > 1 ? 's' : ''}`);
    } else {
      // Create new badge (find the header row and add after subscription badge)
      const row1 = card.querySelector('.series-header-row1');
      if (row1) {
        const subscriptionBadge = row1.querySelector('[title*="subscribe"], [title*="Subscribe"]');
        badge = document.createElement('div');
        badge.className = 'series-unread-badge';
        badge.addClass('sa-inline-flex', 'sa-rounded-8', 'sa-font-bold', 'sa-flex-shrink-0', 'sa-bg-accent', 'scr-unread-badge');
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.setAttribute('title', `${unreadCount} unread episode${unreadCount > 1 ? 's' : ''}`);

        if (subscriptionBadge && subscriptionBadge.nextSibling) {
          row1.insertBefore(badge, subscriptionBadge.nextSibling);
        } else if (subscriptionBadge) {
          subscriptionBadge.parentNode?.insertBefore(badge, subscriptionBadge.nextSibling);
        }
      }
    }
  }

  /**
   * Update episode read status in the episode list UI
   * Updates: item class, cover (opacity + grayscale), read indicator icon,
   * episode badge styling, title (color + weight), action button icon
   */
  private updateEpisodeReadUI(seriesId: string, episodeNo: number, isRead: boolean): void {
    const listWrapper = this.episodeLists.get(seriesId);
    if (!listWrapper) return;

    const item = listWrapper.querySelector(`[data-episode="${episodeNo}"]`) as HTMLElement;
    if (!item) return;

    const isCurrent = item.classList.contains('current');

    // Update item class
    if (isRead) {
      item.classList.add('read');
    } else {
      item.classList.remove('read');
    }

    // Update cover (opacity + grayscale filter)
    const coverContainer = item.querySelector('.webtoon-episode-cover') as HTMLElement;
    if (coverContainer) {
      coverContainer.classList.toggle('sa-opacity-50', isRead);
      coverContainer.toggleClass('scr-episode-cover--read', isRead);
      coverContainer.toggleClass('scr-episode-cover--unread', !isRead);
    }

    // Update read indicator icon (add/remove)
    const titleRow = item.querySelector('.webtoon-episode-title-row') as HTMLElement;
    if (titleRow) {
      let readIndicator = titleRow.querySelector('.read-indicator') as HTMLElement;

      if (isRead && !readIndicator) {
        // Add read indicator
        readIndicator = document.createElement('span');
        readIndicator.className = 'read-indicator';
        readIndicator.addClass('sa-flex-row', 'sa-text-faint', 'sa-flex-shrink-0');
        setIcon(readIndicator, 'eye');
        const svgEl = readIndicator.querySelector('svg');
        if (svgEl) {
          svgEl.setAttribute('width', '12');
          svgEl.setAttribute('height', '12');
        }
        // Insert at beginning of title row
        titleRow.insertBefore(readIndicator, titleRow.firstChild);
      } else if (!isRead && readIndicator) {
        // Remove read indicator
        readIndicator.remove();
      }
    }

    // Update episode number badge styling
    const numBadge = item.querySelector('.episode-num-badge') as HTMLElement;
    if (numBadge && !isCurrent) {
      numBadge.setCssProps({
        '--sa-bg': isRead ? 'var(--background-secondary)' : 'var(--background-modifier-hover)',
        '--sa-color': isRead ? 'var(--text-faint)' : 'var(--text-muted)'
      });
      numBadge.addClass('sa-dynamic-bg', 'sa-dynamic-color');
      numBadge.toggleClass('scr-num-badge--read', isRead);
      numBadge.toggleClass('scr-num-badge--unread', !isRead);
    }

    // Update title (color + font weight)
    const titleEl = item.querySelector('.webtoon-episode-item-title') as HTMLElement;
    if (titleEl) {
      titleEl.setCssProps({ '--sa-color': isRead ? 'var(--text-faint)' : 'var(--text-normal)' });
      titleEl.addClass('sa-dynamic-color');
      titleEl.toggleClass('scr-ep-title--read', isRead);
      titleEl.toggleClass('scr-ep-title--unread', !isRead);
    }

    // Update action button (eye/eye-off icon) if exists
    const actionBtn = item.querySelector('.webtoon-episode-actions') as HTMLElement;
    if (actionBtn) {
      // Find the read button by tooltip
      const buttons = actionBtn.querySelectorAll('div[title*="Mark as"]');
      buttons.forEach((btn) => {
        const iconContainer = btn.querySelector('div');
        if (iconContainer) {
          // Swap icon to eye/eye-off
          iconContainer.empty();
          setIcon(iconContainer as HTMLElement, isRead ? 'eye' : 'eye-off');
        }
        (btn as HTMLElement).setCssProps({ '--sa-color': isRead ? 'var(--interactive-accent)' : 'var(--text-muted)' });
        (btn as HTMLElement).addClass('sa-dynamic-color');
        btn.setAttribute('title', isRead ? 'Mark as unread' : 'Mark as read');
      });
    }
  }

  /**
   * Schedule debounced YAML save for read status
   */
  private scheduleReadStatusSave(): void {
    // Clear existing timer
    if (this.readUpdateDebounceTimer) {
      clearTimeout(this.readUpdateDebounceTimer);
    }

    // Debounce save for 500ms to batch multiple updates
    this.readUpdateDebounceTimer = setTimeout(() => { void (async () => {
      // Save all pending updates
      for (const [pendingPath, pendingIsRead] of this.pendingReadUpdates) {
        const file = this.app.vault.getAbstractFileByPath(pendingPath);
        if (file instanceof TFile) {
          // Register as UI modify BEFORE saving to prevent timeline refresh
          if (this.callbacks.onUIModify) {
            this.callbacks.onUIModify(pendingPath);
          }
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm.read = pendingIsRead;
          });
        }
      }
      this.pendingReadUpdates.clear();
      this.readUpdateDebounceTimer = null;
    })(); }, 500);
  }

  /**
   * Check if a file path has pending read update (to skip re-render)
   */
  public hasPendingReadUpdate(filePath: string): boolean {
    return this.pendingReadUpdates.has(filePath);
  }

  /**
   * Load comment counts for all episodes from local PostData (not API)
   * Reads commentCount from frontmatter stored during archive
   */
  private async loadEpisodeCommentCounts(series: SeriesGroup): Promise<void> {
    const seriesId = series.seriesId;

    // Skip if already loading or loaded
    if (this.episodeCommentCountsLoading.get(seriesId) || this.episodeCommentCounts.has(seriesId)) {
      return;
    }

    this.episodeCommentCountsLoading.set(seriesId, true);

    try {
      const counts = new Map<number, number>();

      // Load comment counts from each episode's frontmatter
      for (const episode of series.episodes) {
        let postData = this.postDataCache.get(episode.filePath);
        if (!postData) {
          const fetchedData = await this.callbacks.getPostData(episode.filePath);
          if (fetchedData) {
            postData = fetchedData;
            this.postDataCache.set(episode.filePath, postData);
          }
        }

        const commentCount = postData?.metadata?.commentCount;
        if (commentCount !== undefined && commentCount > 0) {
          counts.set(episode.episode, commentCount);
        }
      }

      this.episodeCommentCounts.set(seriesId, counts);

      // Re-render episode list to show badges (if list exists)
      this.updateEpisodeListCommentBadges(seriesId);
    } catch {
      // Silent failure - comment counts are optional
    } finally {
      this.episodeCommentCountsLoading.set(seriesId, false);
    }
  }

  /**
   * Update comment badges in episode list after counts are loaded
   */
  private updateEpisodeListCommentBadges(seriesId: string): void {
    const listWrapper = this.episodeLists.get(seriesId);
    if (!listWrapper) return;

    const counts = this.episodeCommentCounts.get(seriesId);
    if (!counts) return;

    // Find all episode items and update comment badges
    const episodeItems = listWrapper.querySelectorAll('.webtoon-episode-item');
    episodeItems.forEach((item) => {
      const episodeNo = parseInt((item as HTMLElement).dataset.episode || '0', 10);
      const commentCount = counts.get(episodeNo);

      if (commentCount !== undefined && commentCount > 0) {
        // Find existing comment badge or create new one
        let commentBadge = item.querySelector('.episode-comment-badge') as HTMLElement;
        if (!commentBadge) {
          // Find meta row
          const metaRow = item.querySelector('.webtoon-episode-meta-row') as HTMLElement;
          if (metaRow) {
            // Insert after star score (if exists) or at the beginning
            const starScore = metaRow.querySelector('.episode-star-score');

            commentBadge = document.createElement('span');
            commentBadge.className = 'episode-comment-badge';
            commentBadge.addClass('scr-comment-badge');

            if (starScore && starScore.nextSibling) {
              metaRow.insertBefore(commentBadge, starScore.nextSibling);
            } else if (starScore) {
              metaRow.appendChild(commentBadge);
            } else {
              metaRow.insertBefore(commentBadge, metaRow.firstChild);
            }
          }
        }

        if (commentBadge) {
          commentBadge.empty();
          const icon = commentBadge.createSpan();
          icon.addClass('scr-comment-badge-icon');
          setIcon(icon, 'message-circle');
          commentBadge.createSpan().textContent = this.formatCount(commentCount);
        }
      }
    });
  }

  /**
   * Sync missing episodes from vault to series.episodes array
   * Called before rendering episode list to pick up files created by background downloads
   * @returns number of new episodes found
   */
  private syncMissingEpisodesFromVault(series: SeriesGroup): number {
    // Markdown files are in "Social Archives/{platform}/" not in media folder
    const platformDisplayName = series.platform === 'webtoons' ? 'WEBTOON' : 'naver-webtoon';
    const parentPath = `Social Archives/${platformDisplayName}`;

    const parentFolder = this.app.vault.getAbstractFileByPath(parentPath);
    if (!parentFolder || !(parentFolder instanceof TFolder)) {
      return 0;
    }

    // Get existing episode numbers
    const existingEpisodes = new Set(series.episodes.map(ep => ep.episode));
    let foundCount = 0;

    // Search for matching markdown files
    const searchFolder = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === 'md') {
          const cache = this.app.metadataCache.getFileCache(child);
          const fm = cache?.frontmatter as Record<string, unknown> | undefined;
          if (fm && String(fm.seriesId) === String(series.seriesId) && fm.episode !== undefined) {
            const episodeNo = typeof fm.episode === 'number' ? fm.episode : Number(fm.episode);

            // Update series author if currently Unknown (from frontmatter)
            if ((!series.author || series.author === 'Unknown') && typeof fm.author === 'string') {
              series.author = fm.author;
            }
            // Update series authorUrl if missing
            if (!series.authorUrl && (typeof fm.author_url === 'string' || typeof fm.authorUrl === 'string')) {
              series.authorUrl = (typeof fm.author_url === 'string' ? fm.author_url : fm.authorUrl as string);
            }

            if (!existingEpisodes.has(episodeNo)) {
              // Found a new episode - add it to series.episodes
              const newEpisode: SeriesEpisode = {
                episode: episodeNo,
                file: child,
                title: typeof fm.title === 'string' ? fm.title : `Episode ${episodeNo}`,
                excerpt: '',
                published: typeof fm.published === 'string' ? fm.published : '',
                archived: typeof fm.archived === 'string' ? fm.archived : new Date().toISOString(),
                isRead: fm.read === true,
                filePath: child.path,
                starScore: typeof fm.starScore === 'number' ? fm.starScore : undefined,
                isLiked: fm.like === true
              };
              series.episodes.push(newEpisode);
              existingEpisodes.add(episodeNo);
              foundCount++;
            }
          }
        } else if (child instanceof TFolder) {
          searchFolder(child);
        }
      }
    };

    searchFolder(parentFolder);

    // Re-sort episodes by episode number
    if (foundCount > 0) {
      series.episodes.sort((a, b) => a.episode - b.episode);
    }

    return foundCount;
  }

  /**
   * Render collapsible episode list
   */
  private renderEpisodeList(container: HTMLElement, series: SeriesGroup, state: SeriesViewState): HTMLElement {
    // Sync missing episodes from vault before rendering
    this.syncMissingEpisodesFromVault(series);

    const isWebtoon = this.isWebtoon(series);
    const listWrapper = container.createDiv({
      cls: isWebtoon ? 'series-episode-list-wrapper webtoon-episode-list' : 'series-episode-list-wrapper'
    });

    // Toggle header (styles from skeleton-card.css)
    const toggleHeader = listWrapper.createDiv({ cls: 'episode-list-toggle' });
    toggleHeader.addClass('sa-flex-row', 'sa-gap-8', 'sa-px-12', 'sa-py-8');

    // Chevron icon
    const chevron = toggleHeader.createDiv({
      cls: `episode-list-chevron ${state.expandedTOC ? 'expanded' : ''}`
    });
    setIcon(chevron, 'chevron-right');

    // Label
    const label = toggleHeader.createEl('span', { cls: 'episode-list-label' });
    label.addClass('sa-text-base', 'sa-font-medium', 'sa-text-muted', 'sa-flex-1');
    label.textContent = `Episodes (${series.episodes.length})`;

    // Sort order toggle button (webtoons only)
    if (isWebtoon && series.episodes.length > 1) {
      const sortOrder = this.plugin.settings.webtoonEpisodeSortOrder ?? 'asc';
      const sortBtn = toggleHeader.createDiv({ cls: 'episode-sort-btn' });
      sortBtn.addClass('sa-icon-24', 'sa-rounded-4', 'sa-clickable', 'sa-text-muted', 'sa-transition', 'scr-header-btn');
      setIcon(sortBtn, sortOrder === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow');
      sortBtn.setAttribute('title', sortOrder === 'asc' ? 'Oldest first (click for newest first)' : 'Newest first (click for oldest first)');

      // Hover effect handled by CSS .scr-header-btn:hover

      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle sort order (handle undefined as 'asc')
        const currentOrder = this.plugin.settings.webtoonEpisodeSortOrder ?? 'asc';
        const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';

        // Update icon and title immediately
        sortBtn.empty();
        setIcon(sortBtn, newOrder === 'asc' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow');
        sortBtn.setAttribute('title', newOrder === 'asc' ? 'Oldest first (click for newest first)' : 'Newest first (click for oldest first)');

        // Re-render episode list with new sort order
        this.rerenderEpisodeList(series, state, listContainer);

        // Save settings without triggering timeline refresh
        void this.plugin.saveSettingsPartial(
          { webtoonEpisodeSortOrder: newOrder },
          { reinitialize: false, notify: false }
        );
      });
    }

    // Add episode button (webtoons only)
    if (isWebtoon) {
      const addBtn = toggleHeader.createDiv({ cls: 'episode-add-btn' });
      addBtn.addClass('sa-icon-24', 'sa-rounded-4', 'sa-clickable', 'sa-text-muted', 'sa-transition', 'scr-header-btn');
      setIcon(addBtn, 'plus');
      addBtn.setAttribute('title', 'Download more episodes');

      // Hover effect handled by CSS .scr-header-btn:hover

      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Exit fullscreen mode first if active (modal would appear behind fullscreen card due to z-index)
        if (this.fullscreenSeriesId === series.seriesId) {
          this.exitFullscreen(series);
        }

        const webtoonUrl = series.seriesUrl || `https://comic.naver.com/webtoon/list?titleId=${series.seriesId}`;
        new WebtoonArchiveModal(this.app, this.plugin, webtoonUrl).open();
      });

      // Delete all button
      const deleteBtn = toggleHeader.createDiv({ cls: 'episode-delete-btn' });
      deleteBtn.addClass('sa-icon-24', 'sa-rounded-4', 'sa-clickable', 'sa-text-muted', 'sa-transition', 'scr-header-btn', 'scr-delete-btn');
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.setAttribute('title', 'Delete all episodes');

      // Hover effect handled by CSS .scr-delete-btn:hover

      deleteBtn.addEventListener('click', (e) => { void (async () => {
        e.stopPropagation();

        // Exit fullscreen mode first if active
        if (this.fullscreenSeriesId === series.seriesId) {
          this.exitFullscreen(series);
        }

        // Show confirmation modal
        const confirmed = await showConfirmModal(this.app, {
          title: 'Delete All Episodes',
          message: `Are you sure you want to delete all ${series.episodes.length} episodes of "${series.seriesTitle}"? This will remove all markdown files and downloaded images. This action cannot be undone.`,
          confirmText: 'Delete All',
          cancelText: 'Cancel',
          confirmClass: 'danger'
        });

        if (confirmed) {
          await this.deleteSeriesFiles(series);
        }
      })(); });
    }

    // Episode list container (styles from skeleton-card.css)
    const listContainer = listWrapper.createDiv({ cls: 'episode-list-container' });
    listContainer.addClass(state.expandedTOC ? 'scr-episode-list--expanded' : 'scr-episode-list--collapsed');

    // Preview banner placeholder (for all webtoons - shows preview episode info)
    let previewBannerContainer: HTMLElement | null = null;
    // getSubscriptionInfo is called for side effects (cache warm-up) when isWebtoon
    if (isWebtoon) { this.getSubscriptionInfo(series.seriesId); }
    if (isWebtoon) {
      previewBannerContainer = listContainer.createDiv({ cls: 'preview-banner-container' });

      // Render cached preview info or show loading placeholder
      const cachedInfo = this.previewInfoCache.get(series.seriesId);
      if (cachedInfo && cachedInfo.count > 0) {
        this.renderPreviewBanner(previewBannerContainer, series.seriesId);
      } else if (state.expandedTOC && !this.previewInfoLoading.get(series.seriesId)) {
        // Load preview info and update banner when ready (Naver Webtoon only)
        void this.loadPreviewInfo(series.seriesId, series.platform).then(() => {
          if (previewBannerContainer) {
            previewBannerContainer.empty();
            this.renderPreviewBanner(previewBannerContainer, series.seriesId);
          }
        });
      }
    }

    // Get sorted episodes based on sort order setting
    const sortOrder = this.plugin.settings.webtoonEpisodeSortOrder ?? 'asc';
    const sortedEpisodes = this.getSortedEpisodes(series.episodes, sortOrder);

    // Render episode items (with webtoon flag for different layout)
    for (const episode of sortedEpisodes) {
      if (isWebtoon) {
        this.renderWebtoonEpisodeItem(listContainer, series, episode, state);
      } else {
        this.renderEpisodeItem(listContainer, series, episode, state);
      }
    }

    // Toggle handler
    toggleHeader.addEventListener('click', () => {
      state.expandedTOC = !state.expandedTOC;
      chevron.classList.toggle('expanded', state.expandedTOC);
      listContainer.classList.toggle('sa-hidden', !state.expandedTOC);

      // Load comment counts when expanding webtoon episode list
      if (state.expandedTOC && isWebtoon) {
        void this.loadEpisodeCommentCounts(series);

        // Load preview info for all webtoons when expanding (Naver Webtoon only)
        if (previewBannerContainer && !this.previewInfoCache.has(series.seriesId)) {
          void this.loadPreviewInfo(series.seriesId, series.platform).then(() => {
            if (previewBannerContainer) {
              previewBannerContainer.empty();
              this.renderPreviewBanner(previewBannerContainer, series.seriesId);
            }
          });
        }
      }
    });

    // If initially expanded, load comment counts for webtoons
    if (state.expandedTOC && isWebtoon) {
      void this.loadEpisodeCommentCounts(series);
    }

    return listWrapper;
  }

  /**
   * Render a single episode item in the list (standard)
   */
  private renderEpisodeItem(
    container: HTMLElement,
    series: SeriesGroup,
    episode: SeriesEpisode,
    state: SeriesViewState
  ): HTMLElement {
    const isCurrent = episode.episode === state.currentEpisode;

    // Build class list (styles from skeleton-card.css)
    const itemClasses = ['episode-item'];
    if (isCurrent) itemClasses.push('current');
    if (episode.isRead) itemClasses.push('read');

    const item = container.createDiv({ cls: itemClasses.join(' ') });
    item.dataset.episode = String(episode.episode);

    // Status indicator
    const statusClasses = ['episode-status'];
    if (isCurrent) statusClasses.push('current');
    else if (episode.isRead) statusClasses.push('read');
    else statusClasses.push('unread');

    const statusIcon = item.createDiv({ cls: statusClasses.join(' ') });

    if (isCurrent) {
      setIcon(statusIcon, 'circle-dot');
    } else if (episode.isRead) {
      setIcon(statusIcon, 'check-circle');
    } else {
      setIcon(statusIcon, 'circle');
    }

    // Episode content
    const content = item.createDiv({ cls: 'episode-item-content' });

    // Episode number and title
    const titleRow = content.createDiv({ cls: 'episode-item-title-row' });

    const numEl = titleRow.createEl('span', { cls: 'episode-num' });
    numEl.textContent = `${episode.episode}`;

    const titleEl = titleRow.createEl('span', { cls: 'episode-item-title' });
    titleEl.textContent = episode.title;

    // Excerpt
    const excerptEl = content.createEl('p', { cls: 'episode-item-excerpt' });
    excerptEl.textContent = episode.excerpt;

    // Click to switch episode
    item.addEventListener('click', () => {
      void this.switchToEpisode(series, episode.episode);
    });

    return item;
  }

  /**
   * Render webtoon episode item with cover thumbnail
   */
  private renderWebtoonEpisodeItem(
    container: HTMLElement,
    series: SeriesGroup,
    episode: SeriesEpisode,
    state: SeriesViewState
  ): HTMLElement {
    const isCurrent = episode.episode === state.currentEpisode;

    // Build class list
    const itemClasses = ['episode-item', 'webtoon-episode-item'];
    if (isCurrent) itemClasses.push('current');
    if (episode.isRead) itemClasses.push('read');

    const item = container.createDiv({ cls: itemClasses.join(' ') });
    item.dataset.episode = String(episode.episode);
    item.addClass('sa-flex-row', 'sa-gap-12', 'sa-px-16', 'sa-clickable', 'sa-border-b', 'sa-transition-bg', 'scr-episode-item');

    // Cover thumbnail placeholder (will be loaded async)
    // Read episodes have grayscale + reduced opacity for clear visual distinction
    const coverContainer = item.createDiv({ cls: 'webtoon-episode-cover' });
    coverContainer.addClass('sa-flex-shrink-0', 'sa-rounded-6', 'sa-bg-secondary', 'sa-overflow-hidden', 'sa-flex-center', 'scr-episode-cover');
    coverContainer.classList.toggle('sa-opacity-50', episode.isRead);
    coverContainer.toggleClass('scr-episode-cover--read', episode.isRead);
    coverContainer.toggleClass('scr-episode-cover--unread', !episode.isRead);

    // Load cover image from PostData (with streaming fallback using PostData.thumbnail)
    void this.loadEpisodeCover(coverContainer, episode);

    // Episode info section
    const infoSection = item.createDiv({ cls: 'webtoon-episode-info' });
    infoSection.addClass('sa-flex-1', 'sa-min-w-0', 'sa-flex-col', 'sa-gap-2');

    // Episode number badge + title row
    const titleRow = infoSection.createDiv({ cls: 'webtoon-episode-title-row' });
    titleRow.addClass('sa-flex-row', 'sa-gap-6');

    // Read indicator icon (shows before episode number for read items)
    if (episode.isRead) {
      const readIndicator = titleRow.createSpan({ cls: 'read-indicator' });
      readIndicator.addClass('sa-flex-row', 'sa-text-faint', 'sa-flex-shrink-0');
      setIcon(readIndicator, 'eye');
      const svgEl = readIndicator.querySelector('svg');
      if (svgEl) {
        svgEl.setAttribute('width', '12');
        svgEl.setAttribute('height', '12');
      }
    }

    // Episode number badge - more faded when read (unless current)
    const numBadge = titleRow.createSpan({ cls: 'episode-num-badge' });
    const numBadgeBg = isCurrent
      ? 'var(--interactive-accent)'
      : episode.isRead
        ? 'var(--background-secondary)'
        : 'var(--background-modifier-hover)';
    const numBadgeColor = isCurrent
      ? 'var(--text-on-accent)'
      : episode.isRead
        ? 'var(--text-faint)'
        : 'var(--text-muted)';
    numBadge.addClass('sa-rounded-4', 'sa-flex-shrink-0', 'sa-transition', 'scr-num-badge');
    numBadge.setCssProps({ '--sa-bg': numBadgeBg, '--sa-color': numBadgeColor });
    numBadge.addClass('sa-dynamic-bg', 'sa-dynamic-color');
    numBadge.toggleClass('scr-num-badge--read', episode.isRead && !isCurrent);
    numBadge.toggleClass('scr-num-badge--unread', !(episode.isRead && !isCurrent));
    numBadge.textContent = `Ep. ${episode.episode}`;

    // Title - more muted when read (--text-faint instead of --text-muted)
    const titleEl = titleRow.createSpan({ cls: 'webtoon-episode-item-title' });
    titleEl.addClass('sa-text-base', 'sa-truncate', 'sa-flex-1', 'sa-min-w-0', 'sa-transition');
    titleEl.toggleClass('scr-ep-title--read', episode.isRead);
    titleEl.toggleClass('scr-ep-title--unread', !episode.isRead);
    titleEl.setCssProps({ '--sa-color': episode.isRead ? 'var(--text-faint)' : 'var(--text-normal)' });
    titleEl.addClass('sa-dynamic-color');
    // Extract just the episode title (remove series name prefix and episode number prefix)
    let episodeTitleText = episode.title.includes(' - ')
      ? episode.title.split(' - ').slice(-1)[0]
      : episode.title;
    // Remove episode number prefix if present (e.g., "4화 추이와 황요" → "추이와 황요")
    episodeTitleText = episodeTitleText?.replace(new RegExp(`^${episode.episode}화\\s*`, 'i'), '') || '';
    titleEl.textContent = episodeTitleText || '';
    // Episode list title click is handled by item click (switchToEpisode)
    // Outlink is only on the main content area title

    // Status indicators (liked/read) - right side
    if (episode.isLiked) {
      const likedBadge = titleRow.createSpan({ cls: 'liked-badge' });
      likedBadge.addClass('sa-text-accent', 'sa-flex-shrink-0', 'sa-flex-row');
      setIcon(likedBadge, 'star');
      const svgEl = likedBadge.querySelector('svg');
      if (svgEl) {
        svgEl.setAttribute('width', '12');
        svgEl.setAttribute('height', '12');
        likedBadge.addClass('scr-svg-filled');
      }
    }

    // Note: Read status is indicated by the check-circle button color in action container
    // Removed redundant "읽음" text badge for cleaner UI

    // Metadata row (starScore + published date)
    const hasMetadata = episode.starScore !== undefined || episode.published;
    if (hasMetadata) {
      const metaRow = infoSection.createDiv({ cls: 'webtoon-episode-meta-row' });
      metaRow.addClass('scr-meta-row');

      // Star score (별점)
      if (episode.starScore !== undefined) {
        const starContainer = metaRow.createSpan({ cls: 'episode-star-score' });
        starContainer.addClass('scr-star-score');

        // Star icon (inline SVG)
        const starIcon = starContainer.createSpan();
        starIcon.addClass('scr-star-icon');
        const svg = createCustomSVG(
          '0 0 24 24',
          'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
          { width: '11px', height: '11px', fill: '#ffc107' }
        );
        starIcon.appendChild(svg);

        const scoreText = starContainer.createSpan();
        scoreText.textContent = episode.starScore.toFixed(2);
      }

      // Published date (간략 형식)
      if (episode.published) {
        const dateContainer = metaRow.createSpan({ cls: 'episode-publish-date' });
        dateContainer.addClass('scr-publish-date');
        // Parse date and format as YY.MM.DD
        const dateStr = this.formatShortDate(episode.published);
        dateContainer.textContent = dateStr;
      }
    }

    // Action button container (right side, visible on hover/mobile)
    const actionContainer = item.createDiv({ cls: 'webtoon-episode-actions' });
    actionContainer.addClass('scr-action-container');

    // Detect mobile
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
    if (isMobile) {
      // On mobile: always show actions
      actionContainer.addClass('scr-action-container--visible');
    }

    // Helper to create action icon button (following PostCardRenderer pattern)
    const createActionBtn = (icon: string, tooltip: string, onClick: (e: MouseEvent) => void, initialColor?: string) => {
      const btn = actionContainer.createDiv();
      btn.addClass('scr-action-btn');
      if (initialColor) {
        btn.setCssProps({ '--sa-color': initialColor });
        btn.addClass('sa-dynamic-color');
      }
      btn.setAttribute('title', tooltip);

      const iconContainer = btn.createDiv();
      iconContainer.addClass('scr-action-btn-icon');
      setIcon(iconContainer, icon);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(e);
      });

      // Hover effect handled by CSS .scr-action-btn:hover

      return { btn, iconContainer };
    };

    if (isMobile) {
      // Mobile: Show ... button with dropdown menu
      const moreBtn = actionContainer.createDiv();
      moreBtn.addClass('scr-more-btn');
      setIcon(moreBtn, 'more-horizontal');

      let menuOpen = false;
      let menuEl: HTMLElement | null = null;

      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        if (menuOpen && menuEl) {
          menuEl.remove();
          menuEl = null;
          menuOpen = false;
          return;
        }

        menuEl = this.createEpisodeActionMenu(series, episode, () => {
          if (menuEl) {
            menuEl.remove();
            menuEl = null;
            menuOpen = false;
          }
        });

        const btnRect = moreBtn.getBoundingClientRect();
        menuEl.setCssStyles({ position: 'fixed', zIndex: '999999', visibility: 'hidden' });
        document.body.appendChild(menuEl);
        const menuHeight = menuEl.offsetHeight;
        const menuWidth = menuEl.offsetWidth;

        // Check if menu would extend beyond viewport bottom
        const spaceBelow = window.innerHeight - btnRect.bottom - 4;
        const spaceAbove = btnRect.top - 4;

        if (spaceBelow >= menuHeight) {
          // Enough space below - show menu below button
          menuEl.setCssStyles({ top: `${btnRect.bottom + 4}px` });
        } else if (spaceAbove >= menuHeight) {
          // Not enough space below, but enough above - show menu above button
          menuEl.setCssStyles({ top: `${btnRect.top - menuHeight - 4}px` });
        } else {
          // Not enough space either way - position at best available spot
          // Prefer showing as much as possible from the top
          const topPos = Math.max(8, Math.min(btnRect.bottom + 4, window.innerHeight - menuHeight - 8));
          menuEl.setCssStyles({ top: `${topPos}px` });
        }

        // Check horizontal positioning - ensure menu doesn't extend beyond right edge
        const rightPos = window.innerWidth - btnRect.right;
        if (rightPos + menuWidth > window.innerWidth - 8) {
          // Menu would extend beyond left edge, adjust
          menuEl.setCssStyles({ right: `${Math.max(8, window.innerWidth - menuWidth - 8)}px` });
        } else {
          menuEl.setCssStyles({ right: `${rightPos}px` });
        }

        // Make visible after positioning
        menuEl.setCssStyles({ visibility: 'visible' });
        menuOpen = true;

        const closeHandler = (evt: MouseEvent) => {
          if (menuEl && !menuEl.contains(evt.target as Node) && !moreBtn.contains(evt.target as Node)) {
            menuEl.remove();
            menuEl = null;
            menuOpen = false;
            document.removeEventListener('click', closeHandler);
          }
        };
        // Store cleanup so we can remove on component destroy even if menu is never clicked outside
        const addListenerTimeout = setTimeout(() => document.addEventListener('click', closeHandler), 0);
        this.cleanupFunctions.push(() => {
          clearTimeout(addListenerTimeout);
          document.removeEventListener('click', closeHandler);
          if (menuEl) {
            menuEl.remove();
            menuEl = null;
          }
        });
      });

      // Hover effect handled by CSS .scr-more-btn:hover
    } else {
      // Desktop: Show inline action buttons

      // Add to favorites (star icon)
      const favoriteColor = episode.isLiked ? 'var(--interactive-accent)' : 'var(--text-muted)';
      const { btn: favoriteBtn } = createActionBtn(
        'star',
        episode.isLiked ? 'Remove from favorites' : 'Add to favorites',
        () => { void (async () => {
          const file = this.app.vault.getAbstractFileByPath(episode.filePath);
          if (file instanceof TFile) {
            const newLikeStatus = !episode.isLiked;
            await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
              fm.like = newLikeStatus;
            });
            favoriteBtn.setAttribute('title', newLikeStatus ? 'Remove from favorites' : 'Add to favorites');
            favoriteBtn.setCssProps({ '--sa-color': newLikeStatus ? 'var(--interactive-accent)' : 'var(--text-muted)' });
            favoriteBtn.addClass('sa-dynamic-color');
            favoriteBtn.toggleClass('scr-svg-filled', newLikeStatus);
          }
        })(); },
        favoriteColor
      );
      if (episode.isLiked) {
        favoriteBtn.addClass('scr-svg-filled');
      }

      // Read marking button - uses markEpisodeAsRead for unified handling
      // Uses eye/eye-off icons for clearer visual indication
      const readIcon = episode.isRead ? 'eye' : 'eye-off';
      const readColor = episode.isRead ? 'var(--interactive-accent)' : 'var(--text-muted)';
      const { btn: readBtn, iconContainer: readIconContainer } = createActionBtn(
        readIcon,
        episode.isRead ? 'Mark as unread' : 'Mark as read',
        () => {
          const newReadStatus = !episode.isRead;
          this.markEpisodeAsRead(series, episode, newReadStatus);
          // Update button UI immediately (icon swap)
          readBtn.setAttribute('title', newReadStatus ? 'Mark as unread' : 'Mark as read');
          readBtn.setCssProps({ '--sa-color': newReadStatus ? 'var(--interactive-accent)' : 'var(--text-muted)' });
          readBtn.addClass('sa-dynamic-color');
          readIconContainer.empty();
          setIcon(readIconContainer, newReadStatus ? 'eye' : 'eye-off');
        },
        readColor
      );

      // Open note button
      createActionBtn('external-link', 'Open note in Obsidian', () => {
        this.callbacks.onOpenFile(episode.filePath);
      });

      // Delete button
      createActionBtn('trash-2', 'Delete this post', () => { void (async () => {
        const confirmed = await showConfirmModal(this.app, {
          title: 'Delete Episode',
          message: `Are you sure you want to delete "${episode.title}"? This will remove the markdown file and downloaded images. This action cannot be undone.`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          confirmClass: 'danger'
        });
        if (confirmed) {
          await this.deleteEpisodeWithMedia(series, episode);
        }
      })(); });
    }

    // Click handler for episode (switch to this episode)
    item.addEventListener('click', () => {
      void this.switchToEpisode(series, episode.episode);
    });

    // Hover effect - show action buttons on desktop
    // Hover effect handled by CSS .scr-episode-item-hover:hover
    if (!isMobile) {
      item.addClass('scr-episode-item-hover');
    }

    return item;
  }

  /**
   * Format date to short format (YY.MM.DD)
   */
  private formatShortDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        // Already in short format or invalid
        return dateStr.replace(/^\d{2}(\d{2})-(\d{2})-(\d{2}).*/, '$1.$2.$3') || dateStr;
      }
      const year = String(date.getFullYear()).slice(-2);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}.${month}.${day}`;
    } catch {
      return dateStr;
    }
  }

  /**
   * Create episode action menu dropdown (for mobile)
   */
  private createEpisodeActionMenu(
    series: SeriesGroup,
    episode: SeriesEpisode,
    onClose: () => void
  ): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'episode-action-menu';
    menu.addClass('scr-action-menu');

    const createMenuItem = (icon: string, label: string, onClick: () => void, isActive?: boolean) => {
      const item = document.createElement('div');
      item.className = 'episode-action-item';
      item.addClass('scr-action-menu-item');
      if (isActive) {
        item.addClass('scr-action-menu-item--active');
      }

      const iconEl = document.createElement('span');
      iconEl.addClass('scr-action-menu-icon');
      setIcon(iconEl, icon);
      if (isActive) {
        iconEl.addClass('scr-svg-filled');
      }

      const labelEl = document.createElement('span');
      labelEl.textContent = label;

      item.appendChild(iconEl);
      item.appendChild(labelEl);

      // Hover effect handled by CSS .scr-action-menu-item:hover

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
        onClose();
      });

      return item;
    };

    // Add to favorites
    const likeLabel = episode.isLiked ? 'Remove from favorites' : 'Add to favorites';
    menu.appendChild(createMenuItem('star', likeLabel, () => { void (async () => {
      const file = this.app.vault.getAbstractFileByPath(episode.filePath);
      if (file instanceof TFile) {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          fm.like = !episode.isLiked;
        });
        if (this.callbacks.onRefreshNeeded) {
          this.callbacks.onRefreshNeeded();
        }
      }
    })(); }, episode.isLiked));

    // Read marking - uses markEpisodeAsRead for unified handling
    // Uses eye/eye-off icons for clearer visual indication
    // Note: isActive=false to avoid filled icon (matches desktop behavior)
    const readLabel = episode.isRead ? 'Mark as unread' : 'Mark as read';
    const readIcon = episode.isRead ? 'eye' : 'eye-off';
    const readItem = createMenuItem(readIcon, readLabel, () => {
      this.markEpisodeAsRead(series, episode, !episode.isRead);
      onClose(); // Close menu after action
    }, false); // Don't use isActive to avoid filled icon
    // Apply accent color for read state (without fill)
    if (episode.isRead) {
      readItem.addClass('scr-read-active-color');
    }
    menu.appendChild(readItem);

    // Open file
    menu.appendChild(createMenuItem('external-link', 'Open note', () => {
      this.callbacks.onOpenFile(episode.filePath);
    }));

    // Delete
    menu.appendChild(createMenuItem('trash-2', 'Delete', () => { void (async () => {
      const confirmed = await showConfirmModal(this.app, {
        title: 'Delete Episode',
        message: `Are you sure you want to delete "${episode.title}"? This will remove the markdown file and downloaded images. This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmClass: 'danger'
      });
      if (confirmed) {
        await this.deleteEpisodeWithMedia(series, episode);
      }
    })(); }));

    return menu;
  }

  /**
   * Load episode cover thumbnail asynchronously
   * Supports streaming fallback when local file is not yet downloaded
   * Uses PostData.thumbnail (remote URL from frontmatter) as fallback
   */
  private async loadEpisodeCover(container: HTMLElement, episode: SeriesEpisode): Promise<void> {
    // Get PostData to access media and thumbnail
    let postData = this.postDataCache.get(episode.filePath);
    if (!postData) {
      const fetchedData = await this.callbacks.getPostData(episode.filePath);
      if (fetchedData) {
        postData = fetchedData;
        this.postDataCache.set(episode.filePath, postData);
      }
    }

    if (!postData || postData.media.length === 0) {
      // Show placeholder icon
      const iconWrapper = container.createDiv();
      iconWrapper.addClass('scr-cover-icon-placeholder');
      setIcon(iconWrapper, 'image');
      return;
    }

    // First image is the cover
    const coverMedia = postData.media[0];
    if (!coverMedia) return;

    const coverImg = container.createEl('img');
    coverImg.addClass('scr-cover-img');
    coverImg.src = this.getResourcePath(coverMedia.url);
    coverImg.alt = episode.title;

    // Handle error - try streaming fallback using PostData.thumbnail, then show placeholder
    coverImg.addEventListener('error', () => {
      // Check if thumbnail URL is available in PostData (original remote URL from frontmatter)
      const thumbnailUrl = postData?.thumbnail;
      if (thumbnailUrl) {
        // Use thumbnail URL via Workers proxy for streaming
        const workersEndpoint = this.plugin.settings.workerUrl || 'https://social-archiver-api.social-archive.org';
        const streamingUrl = `${workersEndpoint}/api/proxy-media?url=${encodeURIComponent(thumbnailUrl)}`;

        // Try streaming URL
        coverImg.src = streamingUrl;

        // If streaming also fails, show placeholder
        coverImg.addEventListener('error', () => {
          coverImg.remove();
          const iconWrapper = container.createDiv();
          iconWrapper.addClass('scr-cover-icon-placeholder');
          setIcon(iconWrapper, 'image');
        }, { once: true });
      } else {
        // No streaming fallback available - show placeholder
        coverImg.remove();
        const iconWrapper = container.createDiv();
        iconWrapper.addClass('scr-cover-icon-placeholder');
        setIcon(iconWrapper, 'image');
      }
    }, { once: true });
  }

  /**
   * Navigate to previous/next episode (index-based navigation)
   */
  private navigateEpisode(series: SeriesGroup, direction: -1 | 1): void {
    const state = this.getViewState(series);
    const currentIndex = this.getEpisodeIndex(series, state.currentEpisode);
    const newIndex = currentIndex + direction;

    // Check bounds
    if (newIndex < 0 || newIndex >= series.episodes.length) {
      return;
    }

    const newEpisode = this.getEpisodeAtIndex(series, newIndex);
    if (newEpisode) {
      void this.switchToEpisode(series, newEpisode.episode);
    }
  }

  /**
   * Switch to a specific episode
   */
  private async switchToEpisode(series: SeriesGroup, episodeNumber: number): Promise<void> {
    const state = this.getViewState(series);
    const episode = series.episodes.find(ep => ep.episode === episodeNumber);

    if (!episode || episodeNumber === state.currentEpisode) {
      return;
    }

    // Update state
    state.currentEpisode = episodeNumber;

    // Persist state
    this.callbacks.onEpisodeChange(series.seriesId, episodeNumber);

    // Update episode indicator (position-based: "1/2" not "441/2")
    const newIndex = this.getEpisodeIndex(series, episodeNumber);
    const indicator = this.episodeIndicators.get(series.seriesId);
    if (indicator) {
      indicator.textContent = `${newIndex + 1}/${series.episodes.length}`;
    }

    // Update navigation button states
    this.updateNavigationButtons(series, newIndex);

    // Update content (webtoon vs regular)
    const contentContainer = this.contentContainers.get(series.seriesId);
    if (contentContainer) {
      if (this.isWebtoon(series)) {
        await this.renderWebtoonContent(contentContainer, series, episode);
      } else {
        await this.renderEpisodeContent(contentContainer, episode);
      }
    }

    // Update episode list styling
    this.updateEpisodeListStyling(series, episodeNumber);

    // Sync comments dropdown if expanded
    await this.syncCommentsForEpisode(series, episodeNumber);
  }

  /**
   * Sync comments dropdown when episode changes
   */
  private async syncCommentsForEpisode(series: SeriesGroup, episodeNumber: number): Promise<void> {
    const seriesId = series.seriesId;
    const isExpanded = this.commentsExpanded.get(seriesId);
    const refs = this.commentsContainers.get(seriesId);

    if (!refs) return;

    // Clear cache for this series to force reload
    this.commentsCache.delete(seriesId);

    // Update label count for new episode
    await this.updateCommentsLabelCount(series, episodeNumber, refs.label);

    // If expanded, reload comments for new episode
    if (isExpanded) {
      await this.loadCommentsFromPostData(series, episodeNumber, refs.container, refs.loadingIndicator);
    }
  }

  /**
   * Update Best Comments label with count from markdown
   */
  private async updateCommentsLabelCount(
    series: SeriesGroup,
    episodeNo: number,
    label: HTMLElement
  ): Promise<void> {
    try {
      const episode = series.episodes.find(ep => ep.episode === episodeNo);
      if (!episode) return;

      const file = this.app.vault.getAbstractFileByPath(episode.filePath);
      if (!file || !(file instanceof TFile)) return;

      const content = await this.app.vault.read(file);
      const count = this.countBestCommentsInMarkdown(content);

      if (count > 0) {
        label.textContent = `Best comments (${count})`;
      } else {
        label.textContent = 'Best comments';
      }
    } catch {
      // Silently fail, keep default label
      label.textContent = 'Best comments';
    }
  }

  /**
   * Count Best Comments in markdown without full parsing
   * Supports both Naver Webtoon (♥) and WEBTOON Global (👍) formats
   */
  private countBestCommentsInMarkdown(content: string): number {
    // Find the Best Comments section (with optional count suffix)
    const bestCommentsMatch = content.match(/## Best Comments.*?\n([\s\S]*?)(?=\n##|\n\*\d|$)/);
    if (!bestCommentsMatch) return 0;

    const commentsSection = bestCommentsMatch[1];
    if (!commentsSection) return 0;

    // Count header lines for both formats:
    // Naver: "> X **author** · ♥ N" (header contains ♥)
    // Global: "> **author** · Date" (first line with ** author **)
    const naverMatches = commentsSection.match(/^> .+\*\*.+\*\*.+♥/gm);
    if (naverMatches && naverMatches.length > 0) {
      return naverMatches.length;
    }

    // WEBTOON Global: count lines starting with "> **" (author lines)
    const globalMatches = commentsSection.match(/^> \*\*[^*]+\*\* ·/gm);
    return globalMatches ? globalMatches.length : 0;
  }

  /**
   * Update navigation button disabled states based on current index
   */
  private updateNavigationButtons(series: SeriesGroup, currentIndex: number): void {
    const buttons = this.navButtons.get(series.seriesId);
    if (!buttons) return;

    const { prev, next } = buttons;
    const isAtStart = currentIndex <= 0;
    const isAtEnd = currentIndex >= series.episodes.length - 1;

    // Update prev button
    if (isAtStart) {
      prev.classList.add('disabled');
    } else {
      prev.classList.remove('disabled');
    }

    // Update next button
    if (isAtEnd) {
      next.classList.add('disabled');
    } else {
      next.classList.remove('disabled');
    }
  }

  /**
   * Update episode list item styling after switch
   */
  private updateEpisodeListStyling(series: SeriesGroup, currentEpisode: number): void {
    const listWrapper = this.episodeLists.get(series.seriesId);
    if (!listWrapper) return;

    const items = listWrapper.querySelectorAll('.episode-item');
    items.forEach((item) => {
      const episodeNum = parseInt((item as HTMLElement).dataset.episode || '0', 10);
      const isCurrent = episodeNum === currentEpisode;
      const episode = series.episodes.find(ep => ep.episode === episodeNum);

      // Update item classes
      item.classList.toggle('current', isCurrent);

      // Update status icon
      const statusIcon = item.querySelector('.episode-status');
      if (statusIcon) {
        (statusIcon as HTMLElement).empty();
        statusIcon.classList.remove('current', 'read', 'unread');

        if (isCurrent) {
          setIcon(statusIcon as HTMLElement, 'circle-dot');
          statusIcon.classList.add('current');
        } else if (episode?.isRead) {
          setIcon(statusIcon as HTMLElement, 'check-circle');
          statusIcon.classList.add('read');
        } else {
          setIcon(statusIcon as HTMLElement, 'circle');
          statusIcon.classList.add('unread');
        }
      }
    });
  }

  /**
   * Get episodes sorted according to the specified order
   * @param episodes - Original episodes array
   * @param order - 'asc' for oldest first (ascending), 'desc' for newest first (descending)
   */
  private getSortedEpisodes(episodes: SeriesEpisode[], order: 'asc' | 'desc'): SeriesEpisode[] {
    // Create a copy to avoid mutating the original array
    const sorted = [...episodes];
    if (order === 'desc') {
      // Newest first (descending by episode number)
      sorted.sort((a, b) => b.episode - a.episode);
    } else {
      // Oldest first (ascending by episode number) - default
      sorted.sort((a, b) => a.episode - b.episode);
    }
    return sorted;
  }

  /**
   * Re-render episode list with new sort order
   * Called when user toggles sort order
   */
  private rerenderEpisodeList(
    series: SeriesGroup,
    state: SeriesViewState,
    listContainer: HTMLElement
  ): void {
    const isWebtoon = this.isWebtoon(series);

    // Clear existing items
    listContainer.empty();

    // Get sorted episodes based on new sort order
    const sortOrder = this.plugin.settings.webtoonEpisodeSortOrder ?? 'asc';
    const sortedEpisodes = this.getSortedEpisodes(series.episodes, sortOrder);

    // Render episode items with new order
    for (const episode of sortedEpisodes) {
      if (isWebtoon) {
        this.renderWebtoonEpisodeItem(listContainer, series, episode, state);
      } else {
        this.renderEpisodeItem(listContainer, series, episode, state);
      }
    }

    // Reload comment counts if list is expanded
    if (state.expandedTOC && isWebtoon) {
      // Clear cached counts to force reload
      this.episodeCommentCounts.delete(series.seriesId);
      this.episodeCommentCountsLoading.delete(series.seriesId);
      void this.loadEpisodeCommentCounts(series);
    }
  }

  /**
   * Check if fullscreen mode is currently active
   * Used by TimelineView to prevent refresh during fullscreen
   */
  isFullscreenActive(): boolean {
    return this.fullscreenSeriesId !== null;
  }

  /**
   * Get the ID of the currently fullscreen series
   */
  getFullscreenSeriesId(): string | null {
    return this.fullscreenSeriesId;
  }

  /**
   * Refresh episode list for a specific series without disrupting fullscreen
   * Called when new episodes are downloaded in background
   */
  refreshSeriesEpisodes(series: SeriesGroup): void {
    const card = this.cardElements.get(series.seriesId);
    if (!card) return;

    // Mark that background updates occurred - need full refresh when fullscreen exits
    this.pendingRefreshOnFullscreenExit = true;

    const state = this.viewStates.get(series.seriesId);
    if (!state) return;

    // Re-render episode list - insert at same position as old one
    const existingList = this.episodeLists.get(series.seriesId);
    if (existingList) {
      // Create new list before removing old one to preserve position
      const parent = existingList.parentElement;
      const nextSibling = existingList.nextSibling;

      existingList.remove();
      this.episodeLists.delete(series.seriesId);

      // Create temporary container to render new list
      const tempContainer = document.createElement('div');
      const newList = this.renderEpisodeList(tempContainer, series, state);

      // Insert at original position
      if (parent) {
        if (nextSibling) {
          parent.insertBefore(newList, nextSibling);
        } else {
          parent.appendChild(newList);
        }
      }
      this.episodeLists.set(series.seriesId, newList);
    } else {
      // No existing list - append to card
      const newList = this.renderEpisodeList(card, series, state);
      this.episodeLists.set(series.seriesId, newList);
    }

    // Update episode indicator
    const indicator = this.episodeIndicators.get(series.seriesId);
    if (indicator) {
      const currentIndex = this.getEpisodeIndex(series, state.currentEpisode);
      indicator.textContent = `${currentIndex + 1}/${series.episodes.length}`;
    }
  }

  /**
   * Clear all caches to force rebuild on next render
   * Call this when series data changes (e.g., episode deleted)
   */
  clearCaches(): void {
    // Exit fullscreen if active (restore card to original position)
    if (this.fullscreenSeriesId) {
      const card = this.cardElements.get(this.fullscreenSeriesId);
      if (card) {
        card.classList.remove('series-fullscreen');

        // Restore card to original position if moved to body
        if (this.fullscreenOriginalParent) {
          if (this.fullscreenNextSibling) {
            this.fullscreenOriginalParent.insertBefore(card, this.fullscreenNextSibling);
          } else {
            this.fullscreenOriginalParent.appendChild(card);
          }
        }
      }

      this.fullscreenOriginalParent = null;
      this.fullscreenNextSibling = null;
      this.fullscreenSeriesId = null;

      // Remove ESC handler
      if (this.escKeyHandler) {
        document.removeEventListener('keydown', this.escKeyHandler);
        this.escKeyHandler = null;
      }

      // Remove backdrop
      const backdrop = document.querySelector('.series-fullscreen-backdrop');
      if (backdrop) {
        backdrop.remove();
      }
    }

    // Cleanup webtoon readers
    for (const reader of this.webtoonReaders.values()) {
      reader.destroy();
    }
    this.webtoonReaders.clear();

    this.viewStates.clear();
    this.contentContainers.clear();
    this.episodeIndicators.clear();
    this.episodeLists.clear();
    this.navButtons.clear();
    this.cardElements.clear();
    this.postDataCache.clear();
    this.subscriptionCache.clear();

    // Clear comments caches
    this.commentsExpanded.clear();
    this.commentsCache.clear();
    this.commentsLoading.clear();
    this.commentsContainers.clear();

    // Clear episode comment counts
    this.episodeCommentCounts.clear();
    this.episodeCommentCountsLoading.clear();

    // Clear remaining data caches
    this.streamingUrls.clear();
    this.prefetchCache.clear();
    this.previewInfoCache.clear();
    this.previewInfoLoading.clear();
    this.pendingReadUpdates.clear();
    if (this.readUpdateDebounceTimer) {
      clearTimeout(this.readUpdateDebounceTimer);
      this.readUpdateDebounceTimer = null;
    }
  }

  /**
   * Cleanup on unload
   */
  onunload(): void {
    // Run cleanup functions for document-level listeners
    for (const cleanup of this.cleanupFunctions) {
      cleanup();
    }
    this.cleanupFunctions = [];

    this.clearCaches();
  }

  /**
   * Open a series card in fullscreen with streaming mode
   * Finds the real card and opens it - no temporary cards
   * Used by WebtoonArchiveModal for stream-first mode
   *
   * @param series - The series data
   * @param episodeNo - The episode number to display
   * @param remoteImageUrls - Remote image URLs for streaming (Workers proxy)
   */
  async openSeriesInStreamingFullscreen(
    series: SeriesGroup,
    episodeNo: number,
    remoteImageUrls: string[]
  ): Promise<void> {
    const seriesId = series.seriesId;

    // Find the real card
    const card = this.cardElements.get(seriesId);
    if (!card) {
      console.warn(`[SeriesCardRenderer] Card not found for series ${seriesId}`);
      return;
    }

    // Store streaming URLs for this series (WebtoonReader will use these)
    this.streamingUrls.set(seriesId, remoteImageUrls);

    // Switch to the episode
    series.currentEpisode = episodeNo;
    this.viewStates.set(seriesId, {
      currentEpisode: episodeNo,
      expandedTOC: false,
    });

    // Find the episode in the series
    const episode = series.episodes.find(ep => ep.episode === episodeNo);
    if (!episode) {
      console.warn(`[SeriesCardRenderer] Episode ${episodeNo} not found in series ${seriesId}`);
      return;
    }

    // Re-render the episode content with streaming mode
    const contentContainer = this.contentContainers.get(seriesId);
    if (contentContainer) {
      // For webtoons, use renderWebtoonContent which checks streamingUrls
      if (this.isWebtoon(series)) {
        await this.renderWebtoonContent(contentContainer, series, episode);
      } else {
        await this.renderEpisodeContent(contentContainer, episode);
      }
    }

    // Enter fullscreen
    this.enterFullscreen(series, card);
  }

  /**
   * Clear streaming URLs for a series (called when images are downloaded)
   */
  clearStreamingUrls(seriesId: string): void {
    this.streamingUrls.delete(seriesId);
  }

  /**
   * Exit streaming fullscreen and cleanup temporary card
   * @deprecated Use regular exitFullscreen instead - no more temp cards
   */
  private exitStreamingFullscreen(seriesId: string): void {
    const card = this.cardElements.get(seriesId);

    // Cleanup reader
    const reader = this.webtoonReaders.get(seriesId);
    if (reader) {
      reader.destroy();
      this.webtoonReaders.delete(seriesId);
    }

    // Remove card
    if (card) {
      card.remove();
      this.cardElements.delete(seriesId);
      this.contentContainers.delete(seriesId);
    }

    // Remove backdrop
    const backdrop = document.querySelector('.series-fullscreen-backdrop');
    if (backdrop) {
      backdrop.remove();
    }

    // Clear fullscreen state
    this.fullscreenSeriesId = null;
    this.fullscreenOriginalParent = null;
    this.fullscreenNextSibling = null;

    // Remove ESC handler
    if (this.escKeyHandler) {
      document.removeEventListener('keydown', this.escKeyHandler);
      this.escKeyHandler = null;
    }
  }

  /**
   * Delete all files for a series (markdown notes and attachments)
   */
  private async deleteSeriesFiles(series: SeriesGroup): Promise<void> {
    const vault = this.app.vault;

    let deletedMarkdown = 0;
    let deletedMedia = 0;
    const foldersToCheck = new Set<string>();
    const deletedFilePaths: string[] = [];

    try {
      // 1. Collect file paths first (before deletion) for callback
      for (const episode of series.episodes) {
        deletedFilePaths.push(episode.filePath);
      }

      // 2. Delete all episode markdown files and track their media
      for (const episode of series.episodes) {
        const file = vault.getAbstractFileByPath(episode.filePath);
        if (file instanceof TFile) {
          // Get media paths from PostData (cache first, then load from file)
          let postData = this.postDataCache.get(episode.filePath);
          if (!postData) {
            // PostData not in cache - try to load from file
            postData = (await this.callbacks.getPostData(episode.filePath)) ?? undefined;
          }

          if (postData?.media) {
            for (const media of postData.media) {
              // Media URL is relative path in vault
              const mediaFile = vault.getAbstractFileByPath(media.url);
              if (mediaFile instanceof TFile) {
                await this.app.fileManager.trashFile(mediaFile);
                deletedMedia++;
                // Track parent folder for cleanup
                const parentPath = media.url.substring(0, media.url.lastIndexOf('/'));
                if (parentPath) foldersToCheck.add(parentPath);
              }
            }
          }

          // Track markdown file's parent folder
          const parentPath = episode.filePath.substring(0, episode.filePath.lastIndexOf('/'));
          if (parentPath) foldersToCheck.add(parentPath);

          // Delete markdown file
          await this.app.fileManager.trashFile(file);
          deletedMarkdown++;
        }
      }

      // 2. Clean up empty folders (deepest first)
      const sortedFolders = Array.from(foldersToCheck).sort((a, b) => b.length - a.length);
      for (const folderPath of sortedFolders) {
        const folder = vault.getAbstractFileByPath(folderPath);
        if (folder instanceof TFolder && folder.children.length === 0) {
          await this.app.fileManager.trashFile(folder);
        }
      }

      // 3. Destroy webtoon reader first to stop image loading
      const existingReader = this.webtoonReaders.get(series.seriesId);
      if (existingReader) {
        existingReader.destroy();
      }

      // 4. Remove card element from DOM immediately to prevent image loading
      const cardEl = this.cardElements.get(series.seriesId);
      if (cardEl) {
        cardEl.remove();
      }

      // 5. Clear series episodes to prevent any lingering references
      series.episodes.length = 0;

      // 6. Clear caches for this series
      this.postDataCache.clear();
      this.streamingUrls.delete(series.seriesId);
      this.viewStates.delete(series.seriesId);
      this.cardElements.delete(series.seriesId);
      this.contentContainers.delete(series.seriesId);
      this.episodeLists.delete(series.seriesId);
      this.episodeIndicators.delete(series.seriesId);
      this.webtoonReaders.delete(series.seriesId);
      this.commentsCache.delete(series.seriesId);
      this.commentsExpanded.delete(series.seriesId);
      this.previewInfoCache.delete(series.seriesId);
      this.episodeCommentCounts.delete(series.seriesId);

      // 7. Remove deleted posts from timeline's posts array (prevents re-render of deleted files)
      if (this.callbacks.onSeriesDeleted && deletedFilePaths.length > 0) {
        this.callbacks.onSeriesDeleted(deletedFilePaths);
      }

      // 8. Trigger timeline refresh
      if (this.callbacks.onRefreshNeeded) {
        this.callbacks.onRefreshNeeded();
      }

      // Show success notice
      new Notice(`Deleted ${deletedMarkdown} episodes and ${deletedMedia} media files for "${series.seriesTitle}"`);
    } catch (error) {
      console.error('[SeriesCardRenderer] Failed to delete series files:', error);
      new Notice(`Failed to delete some files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
