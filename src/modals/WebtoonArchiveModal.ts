/**
 * WebtoonArchiveModal - Webtoon Archive Interface
 *
 * Supports:
 * - Naver Webtoon (Korean): comic.naver.com
 * - WEBTOON (Global): webtoons.com (multi-language)
 *
 * Design: Matches ArchiveModal styling (Obsidian native)
 * Features:
 * - Auto-detect platform from URL
 * - Server-side pagination with page navigation
 * - Sort order (newest/oldest first)
 * - Checkbox selection for batch download
 * - Deep linking support (episode URL → auto-select)
 * - Progress tracking during download
 * - Language selector for WEBTOON (Global)
 */

import { Modal, App, Notice, Platform, setIcon, ToggleComponent } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import {
  NaverWebtoonLocalService,
  type WebtoonAPIInfo,
  type WebtoonEpisode,
  type WebtoonPageInfo,
  type WebtoonSearchResult,
} from '../services/NaverWebtoonLocalService';
import { VIEW_TYPE_TIMELINE, type TimelineView } from '../views/TimelineView';
import {
  WebtoonsLocalService,
  type WebtoonsUrlInfo,
  type WebtoonsSeriesInfo,
  type WebtoonsEpisode as WebtoonsGlobalEpisode,
  WEBTOONS_LANGUAGES,
} from '../services/WebtoonsLocalService';
import {
  WebtoonDownloadQueue,
  type DownloadProgress,
} from '../services/WebtoonDownloadQueue';
import {
  WebtoonsDownloadQueue,
  type WebtoonsEpisodeJob,
  type WebtoonsDownloadProgress,
} from '../services/WebtoonsDownloadQueue';
import { WEBTOON_DAILY_CRON_LOCAL, WEBTOONS_PUBLISH_DAY_TO_CRON } from '@/shared/platforms/definitions';
import { DEFAULT_ARCHIVE_PATH } from '@/shared/constants';
import { getPlatformName } from '@/shared/platforms';
import type { Subscription } from '../services/SubscriptionManager';
import { invalidateAuthorCatalogCache } from '../services/AuthorCatalogStore';

// ============================================================================
// Types
// ============================================================================

/** Supported webtoon platforms */
type WebtoonPlatform = 'naver-webtoon' | 'webtoons';

interface EpisodeSelection {
  episode: WebtoonEpisode;
  selected: boolean;
}

/** WEBTOON (Global) episode adapted for selection */
interface WebtoonsEpisodeSelection {
  episode: WebtoonsGlobalEpisode;
  selected: boolean;
}

type ModalState = 'idle' | 'loading' | 'searching' | 'search-results' | 'ready' | 'downloading' | 'completed' | 'error';
type SortOrder = 'newest' | 'oldest';

// ============================================================================
// WebtoonArchiveModal
// ============================================================================

export class WebtoonArchiveModal extends Modal {
  private plugin: SocialArchiverPlugin;
  private naverWebtoonService: NaverWebtoonLocalService;
  private webtoonsService: WebtoonsLocalService;
  private downloadQueue: WebtoonDownloadQueue;
  private webtoonsDownloadQueue: WebtoonsDownloadQueue;

  // Platform state
  private platform: WebtoonPlatform = 'naver-webtoon';
  private selectedLanguage: string = 'en';
  private webtoonsUrlInfo: WebtoonsUrlInfo | null = null;
  private webtoonsSeriesInfo: WebtoonsSeriesInfo | null = null;
  private webtoonsEpisodes: WebtoonsEpisodeSelection[] = [];

  // WEBTOON Global pagination state
  private webtoonsCurrentPage: number = 1;
  private webtoonsTotalPages: number = 1;
  private webtoonsHasMorePages: boolean = true;
  private isLoadingWebtoonsPage: boolean = false;

  // State
  private state: ModalState = 'idle';
  private url: string = '';
  private titleId: string = '';
  private webtoonInfo: WebtoonAPIInfo | null = null;
  private episodes: EpisodeSelection[] = [];
  private pageInfo: WebtoonPageInfo | null = null;
  private totalEpisodeCount: number = 0;
  private currentPage: number = 1;
  private sortOrder: SortOrder = 'newest';
  private isLoadingPage: boolean = false;
  private errorMessage: string = '';
  private preSelectedEpisodeNo: number | null = null;

  // Search state
  private searchResults: WebtoonSearchResult[] = [];
  private searchQuery: string = '';
  private selectedSearchIndex: number = -1;

  // Episode list keyboard navigation
  private selectedEpisodeIndex: number = -1;

  // Mobile infinite scroll state
  private isLoadingMore: boolean = false;
  private hasMorePages: boolean = true;

  // Selection state (persists across page changes)
  private selectedEpisodeNos: Set<number> = new Set();

  // Already archived episodes (checked on load)
  private archivedEpisodeNos: Set<number> = new Set();

  // Download progress
  private downloadProgress: DownloadProgress | null = null;

  // Stream-first mode: track if first episode has been handled
  private streamFirstHandled: boolean = false;

  // Subscription state
  private isSubscribed: boolean = false;
  private subscriptionId: string | null = null;

  // Preview episodes info (charged episodes with free date)
  private previewEpisodes: Array<{
    no: number;
    subtitle: string;
    freeSchedule: string; // "오늘밤 무료", "3일 후 무료", etc.
  }> = [];

  // Event listener cleanup functions (to prevent leaks on close)
  private eventCleanups: Array<() => void> = [];

  // DOM references (for partial updates without full re-render)
  private contentContainer!: HTMLElement;
  private statsEl: HTMLElement | null = null;
  private downloadBtn: HTMLButtonElement | null = null;
  private selectAllCb: HTMLInputElement | null = null;

  constructor(app: App, plugin: SocialArchiverPlugin, initialUrl?: string) {
    super(app);
    this.plugin = plugin;

    // Initialize Naver Webtoon service with cookie for adult content access (18+)
    const naverCookie = plugin.settings.naverCookie;
    this.naverWebtoonService = new NaverWebtoonLocalService(naverCookie);

    // Initialize WEBTOON (Global) service
    this.webtoonsService = new WebtoonsLocalService();

    // Get worker client for fallback on adult content (18+ webtoons)
    // Local service fails on adult content due to redirect cookie loss
    let workerClient;
    try {
      workerClient = plugin.workersApiClient;
    } catch {
      // WorkersAPIClient not configured - adult content fallback won't be available
      console.warn('[WebtoonArchiveModal] WorkersAPIClient not available, adult content fallback disabled');
    }

    this.downloadQueue = new WebtoonDownloadQueue(
      app,
      {},
      plugin.settings.mediaPath || 'attachments/social-archives',
      workerClient,
      naverCookie
    );

    // Initialize WEBTOON Global download queue
    this.webtoonsDownloadQueue = new WebtoonsDownloadQueue(
      app,
      {},
      plugin.settings.mediaPath || 'attachments/social-archives',
      plugin.settings.workerUrl || 'https://social-archiver-api.social-archive.org'
    );

    if (initialUrl) {
      this.url = initialUrl;
      // Auto-detect platform from URL
      if (WebtoonsLocalService.isWebtoonsUrl(initialUrl)) {
        this.platform = 'webtoons';
        const urlInfo = this.webtoonsService.parseUrl(initialUrl);
        if (urlInfo) {
          this.webtoonsUrlInfo = urlInfo;
          this.selectedLanguage = urlInfo.language;
          if (urlInfo.episodeNo) {
            this.preSelectedEpisodeNo = urlInfo.episodeNo;
            this.selectedEpisodeNos.add(urlInfo.episodeNo);
          }
        }
      } else {
        this.platform = 'naver-webtoon';
        const urlInfo = this.naverWebtoonService.parseUrl(initialUrl);
        if (urlInfo?.episodeNo) {
          this.preSelectedEpisodeNo = urlInfo.episodeNo;
          this.selectedEpisodeNos.add(urlInfo.episodeNo);
        }
      }
    }

    this.setupDownloadEvents();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    modalEl.addClass('social-archiver-modal', 'webtoon-archive-modal');

    if (Platform.isMobile) {
      // Fullscreen on mobile (respecting safe areas)
      // Dynamic values must use CSS custom properties
      modalEl.setCssProps({'--sa-modal-padding-top': 'env(safe-area-inset-top, 0px)'});
      modalEl.addClass('sa-mobile-fullscreen');

      // Position close button below safe area
      const closeBtn = modalEl.querySelector('.modal-close-button') as HTMLElement;
      if (closeBtn) {
        closeBtn.setCssProps({'--sa-close-btn-top': 'calc(env(safe-area-inset-top, 0px) + 8px)'});
        closeBtn.addClass('sa-mobile-close-btn');
      }

      contentEl.setCssProps({
        '--sa-padding-left': 'max(16px, env(safe-area-inset-left))',
        '--sa-padding-right': 'max(16px, env(safe-area-inset-right))',
      });
      contentEl.addClass('sa-mobile-content');
    } else {
      // Desktop: taller modal
      modalEl.addClass('sa-desktop-modal');
    }

    this.contentContainer = contentEl;
    this.render();

    this.scope.register([], 'Escape', () => {
      if (this.state === 'downloading') {
        this.downloadQueue.cancel();
        this.webtoonsDownloadQueue.cancel();
      }
      this.close();
      return false;
    });

    // Keyboard navigation for search results and episode list
    this.scope.register([], 'ArrowDown', (): boolean => {
      if (this.state === 'search-results' && this.searchResults.length > 0) {
        this.selectedSearchIndex = Math.min(
          this.selectedSearchIndex + 1,
          this.searchResults.length - 1
        );
        this.updateSearchResultsHighlight();
        return false;
      }
      if (this.state === 'ready' && this.episodes.length > 0) {
        this.selectedEpisodeIndex = Math.min(
          this.selectedEpisodeIndex + 1,
          this.episodes.length - 1
        );
        this.updateEpisodeListHighlight();
        return false;
      }
      return true;
    });

    this.scope.register([], 'ArrowUp', (): boolean => {
      if (this.state === 'search-results' && this.searchResults.length > 0) {
        this.selectedSearchIndex = Math.max(this.selectedSearchIndex - 1, -1);
        this.updateSearchResultsHighlight();
        return false;
      }
      if (this.state === 'ready' && this.episodes.length > 0) {
        this.selectedEpisodeIndex = Math.max(this.selectedEpisodeIndex - 1, -1);
        this.updateEpisodeListHighlight();
        return false;
      }
      return true;
    });

    this.scope.register([], 'Enter', (): boolean => {
      if (this.state === 'search-results' && this.selectedSearchIndex >= 0) {
        const selected = this.searchResults[this.selectedSearchIndex];
        if (selected) {
          void this.selectWebtoonFromSearch(selected);
        }
        return false;
      }
      // In episode list: Enter starts download
      if (this.state === 'ready' && this.selectedEpisodeNos.size > 0) {
        void this.startDownload();
        return false;
      }
      return true;
    });

    // Space: Toggle episode selection
    this.scope.register([], ' ', (): boolean => {
      if (this.state === 'ready' && this.selectedEpisodeIndex >= 0) {
        const item = this.episodes[this.selectedEpisodeIndex];
        if (item && !item.episode.charge && !this.archivedEpisodeNos.has(item.episode.no)) {
          const isCurrentlySelected = this.selectedEpisodeNos.has(item.episode.no);
          this.toggleEpisodeSelection(item.episode.no, !isCurrentlySelected);
        }
        return false;
      }
      return true;
    });

    // ArrowLeft: Previous page
    this.scope.register([], 'ArrowLeft', (): boolean => {
      if (this.state === 'ready' && this.pageInfo && this.currentPage > 1) {
        void this.loadPage(this.currentPage - 1);
        return false;
      }
      return true;
    });

    // ArrowRight: Next page
    this.scope.register([], 'ArrowRight', (): boolean => {
      if (this.state === 'ready' && this.pageInfo && this.currentPage < this.pageInfo.totalPages) {
        void this.loadPage(this.currentPage + 1);
        return false;
      }
      return true;
    });

    if (this.url) {
      void this.loadWebtoon();
    }
  }

  onClose(): void {
    if (this.state === 'downloading') {
      this.downloadQueue.cancel();
      this.webtoonsDownloadQueue.cancel();
    }

    // Remove all tracked event listeners to prevent memory leaks
    for (const cleanup of this.eventCleanups) {
      cleanup();
    }
    this.eventCleanups = [];

    this.contentEl.empty();
  }

  /**
   * Register an event listener on a target with automatic cleanup tracking.
   */
  private trackEventListener(target: EventTarget, event: string, handler: EventListener): void {
    target.addEventListener(event, handler);
    this.eventCleanups.push(() => target.removeEventListener(event, handler));
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================

  private render(): void {
    const el = this.contentContainer;
    el.empty();

    // URL Input (no title - saves space)
    this.renderUrlInput(el);

    // Status badge (inline with less margin)
    this.renderStatusBadge(el);

    // Search results (when searching)
    if (this.state === 'search-results' && this.searchResults.length > 0) {
      this.renderSearchResults(el);
    } else if (this.state === 'search-results' && this.searchResults.length === 0) {
      this.renderNoSearchResults(el);
    }

    // Preview (when loaded) - support both platforms
    const hasSeriesInfo = this.platform === 'webtoons'
      ? this.webtoonsSeriesInfo
      : this.webtoonInfo;

    if (hasSeriesInfo && (this.state === 'ready' || this.state === 'downloading' || this.state === 'completed')) {
      this.renderPreview(el);
      this.renderSubscriptionSection(el);
      this.renderEpisodeList(el);
    }

    // Progress (when downloading)
    if (this.state === 'downloading') {
      this.renderProgress(el);
    }

    // Footer
    this.renderFooter(el);
  }

  private renderUrlInput(container: HTMLElement): void {
    const inputContainer = container.createDiv({ cls: 'archive-url-container' });
    inputContainer.addClass('wam-url-container');

    // URL input row with optional language selector
    const inputRow = inputContainer.createDiv();
    inputRow.addClass('sa-flex-row', 'sa-gap-8');

    const input = inputRow.createEl('input', {
      type: 'text',
      placeholder: 'Search webtoon or paste URL (Naver/WEBTOON)',
      cls: 'archive-url-input',
      value: this.url,
    });

    input.addClass('sa-flex-1');

    let debounceTimer: number;
    input.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      this.url = target.value;
      this.selectedSearchIndex = -1; // Reset selection on input change

      // Auto-detect platform from URL as user types
      if (WebtoonsLocalService.isWebtoonsUrl(this.url)) {
        this.platform = 'webtoons';
        const urlInfo = this.webtoonsService.parseUrl(this.url);
        if (urlInfo) {
          this.selectedLanguage = urlInfo.language;
        }
      } else if (this.url.includes('comic.naver.com')) {
        this.platform = 'naver-webtoon';
      }

      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        void this.loadWebtoon();
      }, 500);
    });

    // Language selector for WEBTOON (Global) - shows when platform is webtoons
    if (this.platform === 'webtoons') {
      this.renderLanguageSelector(inputRow);
    }

    // Only focus on desktop and only on initial render (no URL yet)
    if (!Platform.isMobile && !this.url) {
      setTimeout(() => input.focus(), 100);
    }
  }

  /**
   * Render language selector dropdown for WEBTOON (Global)
   */
  private renderLanguageSelector(container: HTMLElement): void {
    const langContainer = container.createDiv({ cls: 'webtoon-language-selector' });
    langContainer.addClass('sa-flex-row', 'sa-gap-4', 'sa-flex-shrink-0');

    // Globe icon
    const globeIcon = langContainer.createSpan();
    globeIcon.addClass('sa-icon-16', 'sa-text-muted');
    setIcon(globeIcon, 'globe');

    const select = langContainer.createEl('select');
    select.addClass('sa-webtoon-lang-select');

    const languages = this.webtoonsService.getSupportedLanguages();
    for (const lang of languages) {
      const option = select.createEl('option', {
        value: lang.code,
        text: lang.label,
      });
      if (lang.code === this.selectedLanguage) {
        option.selected = true;
      }
    }

    select.addEventListener('change', () => {
      const targetLanguage = select.value;
      this.selectedLanguage = targetLanguage;

      if (!this.webtoonsUrlInfo) {
        return;
      }

      this.state = 'loading';
      this.render();

      void (async () => {
        try {
          const localized = await this.webtoonsService.findLocalizedSeries(
            this.webtoonsUrlInfo!,
            targetLanguage,
            this.webtoonsSeriesInfo?.title,
          );

          if (!localized) {
            new Notice('Could not find this series in the selected language.');
            // Clear content but keep original URL info so user can try another language
            this.webtoonsSeriesInfo = null;
            this.webtoonsEpisodes = [];
            this.state = 'error';
            this.errorMessage = 'Series not available in the selected language.';
            this.render();
            return;
          }

          this.webtoonsUrlInfo = localized;
          this.url = this.webtoonsService.buildSeriesUrl(localized);
          await this.loadWebtoonsGlobal(localized);
        } catch (error) {
          console.error('[WebtoonArchiveModal] Language switch failed:', error);
          new Notice('Language change failed. Please try again.');
          this.webtoonsSeriesInfo = null;
          this.webtoonsEpisodes = [];
          this.state = 'error';
          this.errorMessage = 'Language change failed.';
          this.render();
        }
      })();
    });
  }

  private renderStatusBadge(container: HTMLElement): void {
    const badge = container.createDiv({ cls: 'archive-platform-badge' });
    badge.addClass('sa-flex-row', 'sa-gap-4', 'sa-mt-4', 'sa-text-xs');

    switch (this.state) {
      case 'loading':
        badge.setText('Loading...');
        badge.addClass('sa-text-muted');
        break;
      case 'searching':
        badge.setText('Searching...');
        badge.addClass('sa-text-muted');
        break;
      case 'search-results': {
        const searchIcon = badge.createSpan();
        searchIcon.addClass('sa-icon-14');
        setIcon(searchIcon, 'search');
        badge.createSpan({ text: `${this.searchResults.length} results for "${this.searchQuery}"` });
        badge.addClass('sa-text-accent');
        break;
      }
      case 'ready':
      case 'downloading':
      case 'completed': {
        const icon = badge.createSpan();
        icon.addClass('sa-icon-14');
        setIcon(icon, 'check');
        // Show platform name based on detected platform
        const platformName = this.platform === 'webtoons'
          ? `WEBTOON (${this.selectedLanguage.toUpperCase()})`
          : 'Naver Webtoon';
        badge.createSpan({ text: platformName });
        badge.addClass('sa-text-accent');
        break;
      }
      case 'error': {
        const errIcon = badge.createSpan();
        errIcon.addClass('sa-icon-14');
        setIcon(errIcon, 'alert-triangle');
        badge.createSpan({ text: this.errorMessage });
        badge.addClass('sa-text-error');
        break;
      }
      default:
        badge.addClass('sa-hidden');
    }
  }

  private renderSearchResults(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: 'webtoon-search-results' });
    wrapper.addClass('sa-flex-col', 'sa-gap-8', 'sa-search-results-wrapper');

    this.searchResults.forEach((webtoon, index) => {
      const item = wrapper.createDiv({ cls: 'webtoon-search-item' });
      item.dataset.searchIndex = String(index);
      const isSelected = index === this.selectedSearchIndex;

      item.addClass('sa-search-item');
      if (isSelected) {
        item.addClass('sa-search-item-selected');
      }

      item.addEventListener('mouseenter', () => {
        if (this.selectedSearchIndex !== index) {
          item.addClass('sa-bg-hover');
        }
      });
      item.addEventListener('mouseleave', () => {
        if (this.selectedSearchIndex !== index) {
          item.removeClass('sa-bg-hover');
        }
      });

      // Click to select this webtoon
      item.addEventListener('click', () => {
        void this.selectWebtoonFromSearch(webtoon);
      });

      // Thumbnail
      if (webtoon.thumbnailUrl) {
        const thumb = item.createEl('img');
        thumb.src = webtoon.thumbnailUrl;
        thumb.alt = webtoon.titleName;
        thumb.addClass('sa-search-item-thumb');
      }

      // Info
      const info = item.createDiv();
      info.addClass('sa-flex-1', 'sa-min-w-0');

      // Title
      const title = info.createDiv();
      title.addClass('sa-font-semibold', 'sa-text-md', 'sa-truncate');
      title.setText(webtoon.titleName);

      // Author & episode count
      const meta = info.createDiv();
      meta.addClass('sa-text-xs', 'sa-text-muted', 'sa-mt-2');
      const finishedText = webtoon.finished ? ' · Complete' : ' · Ongoing';
      meta.setText(`${webtoon.displayAuthor} · ${webtoon.articleTotalCount} episodes${finishedText}`);

      // Synopsis (truncated)
      if (webtoon.synopsis) {
        const synopsis = info.createDiv();
        synopsis.addClass('sa-search-item-synopsis');
        synopsis.setText(webtoon.synopsis.replace(/\n/g, ' '));
      }
    });
  }

  private renderNoSearchResults(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: 'webtoon-no-results' });
    wrapper.addClass('wam-no-results');

    const icon = wrapper.createDiv();
    icon.addClass('sa-flex-center', 'sa-mb-8');
    const iconSpan = icon.createSpan();
    iconSpan.addClass('sa-icon-32');
    setIcon(iconSpan, 'search-x');

    wrapper.createDiv({ text: 'No webtoons found' });
    wrapper.createDiv({
      text: 'Try a different search term or paste a direct URL',
      cls: 'setting-item-description',
    });
  }

  /**
   * Update visual highlight for search results based on keyboard navigation
   */
  private updateSearchResultsHighlight(): void {
    const items = this.contentContainer.querySelectorAll('.webtoon-search-item');

    items.forEach((item, index) => {
      const el = item as HTMLElement;
      const isSelected = index === this.selectedSearchIndex;

      el.toggleClass('sa-search-item-selected', isSelected);

      // Scroll into view if selected
      if (isSelected) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  /**
   * Update visual highlight for episode list based on keyboard navigation
   */
  private updateEpisodeListHighlight(): void {
    const rows = this.contentContainer.querySelectorAll('.webtoon-episode-row');

    rows.forEach((row, index) => {
      const el = row as HTMLElement;
      const isHighlighted = index === this.selectedEpisodeIndex;

      // Apply highlight styling
      el.toggleClass('sa-episode-highlighted', isHighlighted);

      // Scroll into view if highlighted
      if (isHighlighted) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  private renderPreview(container: HTMLElement): void {
    // Handle both platforms
    if (this.platform === 'webtoons') {
      this.renderWebtoonsPreview(container);
    } else {
      this.renderNaverWebtoonPreview(container);
    }
  }

  /**
   * Render preview for Naver Webtoon
   */
  private renderNaverWebtoonPreview(container: HTMLElement): void {
    if (!this.webtoonInfo) return;

    // Outer wrapper with column layout
    const preview = container.createDiv({ cls: 'webtoon-preview' });
    preview.addClass('wam-preview');

    // Header row: Thumbnail + Info
    const headerRow = preview.createDiv();
    headerRow.addClass('wam-preview-header');

    // Thumbnail (larger, proper aspect ratio for webtoon covers)
    if (this.webtoonInfo.thumbnailUrl) {
      const thumb = headerRow.createEl('img');
      thumb.src = this.webtoonInfo.thumbnailUrl;
      thumb.alt = this.webtoonInfo.titleName;
      thumb.addClass('wam-preview-thumb');
    }

    // Info column
    const info = headerRow.createDiv();
    info.addClass('wam-preview-info');

    // Title
    const title = info.createDiv({ text: this.webtoonInfo.titleName });
    title.addClass('wam-preview-title');

    // Author
    const authors = this.webtoonInfo.communityArtists?.map(a => a.name).join(', ');
    if (authors) {
      const authorEl = info.createDiv({ text: authors });
      authorEl.addClass('wam-preview-author');
    }

    // Stats row
    const totalEpisodes = this.pageInfo?.totalRows ?? 0;
    const selectedCount = this.selectedEpisodeNos.size;
    this.statsEl = info.createDiv();
    this.statsEl.addClass('wam-preview-stats');
    this.statsEl.setText(`${totalEpisodes} episodes · ${selectedCount} selected`);

    // Genre tags (inline with info)
    if (this.webtoonInfo.curationTagList?.length) {
      const tagsEl = info.createDiv();
      tagsEl.addClass('wam-preview-tags');

      for (const tag of this.webtoonInfo.curationTagList.slice(0, 4)) {
        const tagEl = tagsEl.createSpan({ text: `#${tag.tagName}` });
        tagEl.addClass('wam-tag');
      }
    }

    // Synopsis (separate row below header)
    if (this.webtoonInfo.synopsis) {
      const synopsisEl = preview.createDiv();
      synopsisEl.addClass('wam-synopsis');
      synopsisEl.setText(this.webtoonInfo.synopsis);
    }
  }

  /**
   * Render preview for WEBTOON (Global)
   */
  private renderWebtoonsPreview(container: HTMLElement): void {
    if (!this.webtoonsSeriesInfo) return;

    // Outer wrapper with column layout
    const preview = container.createDiv({ cls: 'webtoon-preview' });
    preview.addClass('wam-preview');

    // Header row: Thumbnail + Info
    const headerRow = preview.createDiv();
    headerRow.addClass('wam-preview-header');

    // Thumbnail
    if (this.webtoonsSeriesInfo.thumbnailUrl) {
      const thumb = headerRow.createEl('img');
      thumb.src = this.webtoonsSeriesInfo.thumbnailUrl;
      thumb.alt = this.webtoonsSeriesInfo.title;
      thumb.addClass('wam-preview-thumb');
    }

    // Info column
    const info = headerRow.createDiv();
    info.addClass('wam-preview-info');

    // Title
    const title = info.createDiv({ text: this.webtoonsSeriesInfo.title });
    title.addClass('wam-preview-title');

    // Author
    if (this.webtoonsSeriesInfo.authorNames) {
      const authorEl = info.createDiv({ text: this.webtoonsSeriesInfo.authorNames });
      authorEl.addClass('wam-preview-author');
    }

    // Stats row
    const totalEpisodes = this.webtoonsEpisodes.length;
    const selectedCount = this.selectedEpisodeNos.size;
    this.statsEl = info.createDiv();
    this.statsEl.addClass('wam-preview-stats');
    this.statsEl.setText(`${totalEpisodes} episodes · ${selectedCount} selected`);

    // Status tags (completed, genre, update day)
    const tagsEl = info.createDiv();
    tagsEl.addClass('wam-preview-tags');

    // Genre tag
    if (this.webtoonsSeriesInfo.genre) {
      const genreTag = tagsEl.createSpan({ text: `#${this.webtoonsSeriesInfo.genre}` });
      genreTag.addClass('wam-tag');
    }

    // Update day or completed tag
    if (this.webtoonsSeriesInfo.isCompleted) {
      const completedTag = tagsEl.createSpan({ text: 'Completed' });
      completedTag.addClass('wam-tag--completed');
    } else if (this.webtoonsSeriesInfo.updateDay) {
      const updateTag = tagsEl.createSpan({ text: this.webtoonsSeriesInfo.updateDay });
      updateTag.addClass('wam-tag');
    }

    // Canvas tag if applicable
    if (this.webtoonsSeriesInfo.isCanvas) {
      const canvasTag = tagsEl.createSpan({ text: 'Canvas' });
      canvasTag.addClass('wam-tag--canvas');
    }

    // Synopsis (separate row below header)
    if (this.webtoonsSeriesInfo.description) {
      const synopsisEl = preview.createDiv();
      synopsisEl.addClass('wam-synopsis');
      synopsisEl.setText(this.webtoonsSeriesInfo.description);
    }
  }

  private renderEpisodeList(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: 'webtoon-episode-wrapper' });
    wrapper.addClass(Platform.isMobile ? 'wam-episode-wrapper--mobile' : 'wam-episode-wrapper');

    // Header: Select all + Sort toggle
    this.renderListHeader(wrapper);

    // Preview banner (shows preview count and next free episode) - Naver only
    if (this.platform === 'naver-webtoon') {
      this.renderPreviewBanner(wrapper);
    }

    // Episode list (flexible height)
    const list = wrapper.createDiv({ cls: 'webtoon-episode-list' });
    list.addClass(Platform.isMobile ? 'wam-episode-list--mobile' : 'wam-episode-list--desktop');

    // Handle both platforms
    if (this.platform === 'webtoons') {
      // WEBTOON (Global) with pagination
      if (this.isLoadingWebtoonsPage && this.webtoonsEpisodes.length === 0) {
        // Initial loading state
        const loading = list.createDiv();
        loading.addClass('wam-loading-text');
        loading.setText('Loading episodes...');
      } else {
        for (const item of this.webtoonsEpisodes) {
          this.renderWebtoonsEpisodeRow(list, item);
        }

        // Mobile: infinite scroll loading indicator
        if (Platform.isMobile && this.isLoadingMore) {
          const loadingMore = list.createDiv({ cls: 'webtoon-loading-more' });
          loadingMore.addClass('wam-loading-more');
          loadingMore.setText('Loading more...');
        }

        // Mobile: infinite scroll trigger
        if (Platform.isMobile && this.webtoonsHasMorePages && !this.isLoadingMore) {
          const sentinel = list.createDiv({ cls: 'webtoon-scroll-sentinel' });
          sentinel.addClass('wam-scroll-sentinel');

          const observer = new IntersectionObserver(
            (entries) => {
              if (entries[0]?.isIntersecting && !this.isLoadingMore && this.webtoonsHasMorePages) {
                observer.disconnect();
                void this.loadMoreWebtoonsEpisodes();
              }
            },
            { root: list, threshold: 0.1 }
          );
          observer.observe(sentinel);
          this.eventCleanups.push(() => observer.disconnect());
        }
      }
    } else {
      // Naver Webtoon with pagination
      if (this.isLoadingPage && this.episodes.length === 0) {
        // Initial loading state (no episodes yet)
        const loading = list.createDiv();
        loading.addClass('wam-loading-text');
        loading.setText('Loading episodes...');
      } else {
        for (const item of this.episodes) {
          this.renderEpisodeRow(list, item);
        }

        // Mobile: infinite scroll loading indicator
        if (Platform.isMobile && this.isLoadingMore) {
          const loadingMore = list.createDiv({ cls: 'webtoon-loading-more' });
          loadingMore.addClass('wam-loading-more');
          loadingMore.setText('Loading more...');
        }

        // Mobile: infinite scroll trigger
        if (Platform.isMobile && this.hasMorePages && !this.isLoadingMore) {
          const sentinel = list.createDiv({ cls: 'webtoon-scroll-sentinel' });
          sentinel.addClass('wam-scroll-sentinel');

          // Use IntersectionObserver for efficient scroll detection
          const observer = new IntersectionObserver(
            (entries) => {
              if (entries[0]?.isIntersecting && !this.isLoadingMore && this.hasMorePages) {
                observer.disconnect();
                void this.loadMoreEpisodes();
              }
            },
            { root: list, threshold: 0.1 }
          );
          observer.observe(sentinel);
          this.eventCleanups.push(() => observer.disconnect());
        }
      }
    }

    // Desktop only: Pagination controls
    if (!Platform.isMobile) {
      if (this.platform === 'webtoons' && this.webtoonsTotalPages > 1) {
        this.renderWebtoonsPaginationControls(wrapper);
      } else if (this.platform === 'naver-webtoon') {
        this.renderPaginationControls(wrapper);
      }
    }
  }

  /**
   * Render a WEBTOON (Global) episode row
   */
  private renderWebtoonsEpisodeRow(container: HTMLElement, item: WebtoonsEpisodeSelection): void {
    const { episode } = item;
    const isArchived = this.archivedEpisodeNos.has(episode.episodeNo);
    const isDisabled = isArchived;
    const isSelected = this.selectedEpisodeNos.has(episode.episodeNo);

    const row = container.createDiv({ cls: 'webtoon-episode-row' });
    row.addClass(isDisabled ? 'wam-episode-row--disabled' : 'wam-episode-row');

    if (!isDisabled) {
      row.addEventListener('click', (e) => {
        (document.activeElement as HTMLElement)?.blur?.();
        if ((e.target as HTMLElement).tagName !== 'INPUT') {
          this.toggleWebtoonsEpisodeSelection(episode.episodeNo, !isSelected);
        }
      });
    }

    // Checkbox
    const cb = row.createEl('input', { type: 'checkbox' });
    cb.addClass('wam-episode-cb');
    cb.checked = isArchived ? true : isSelected;
    cb.disabled = isDisabled;
    if (!isDisabled) {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        this.toggleWebtoonsEpisodeSelection(episode.episodeNo, cb.checked);
      });
    }

    // Episode number
    const numEl = row.createSpan({ text: `#${episode.episodeNo}` });
    numEl.addClass('wam-episode-num');

    // Title (flexible, truncate)
    const titleContainer = row.createDiv();
    titleContainer.addClass('wam-episode-title-container');

    const subtitle = titleContainer.createSpan({ text: episode.title });
    subtitle.addClass('wam-episode-subtitle');

    if (isArchived) {
      const badge = titleContainer.createSpan({ text: 'Archived' });
      badge.addClass('wam-badge--archived');
    }

    // Meta on right (date)
    const meta = row.createDiv();
    meta.addClass('wam-episode-meta--wide');
    meta.setText(episode.pubDate.toLocaleDateString());
  }

  /**
   * Toggle WEBTOON (Global) episode selection
   */
  private toggleWebtoonsEpisodeSelection(episodeNo: number, selected: boolean): void {
    if (selected) {
      this.selectedEpisodeNos.add(episodeNo);
    } else {
      this.selectedEpisodeNos.delete(episodeNo);
    }

    const item = this.webtoonsEpisodes.find(e => e.episode.episodeNo === episodeNo);
    if (item) item.selected = selected;

    // Update the specific checkbox in the row
    const rows = this.contentContainer.querySelectorAll('.webtoon-episode-row');
    const idx = this.webtoonsEpisodes.findIndex(e => e.episode.episodeNo === episodeNo);
    if (idx >= 0 && idx < rows.length) {
      const cb = rows[idx]?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb && !cb.disabled) {
        cb.checked = selected;
      }
    }

    this.updateSelectionUI();
  }

  private renderListHeader(wrapper: HTMLElement): void {
    const header = wrapper.createDiv({ cls: 'webtoon-episode-header' });
    header.addClass('wam-list-header');

    // Left: Select all - handle both platforms
    const selectAllLabel = header.createEl('label');
    selectAllLabel.addClass('wam-select-all-label');

    this.selectAllCb = selectAllLabel.createEl('input', { type: 'checkbox' });

    // Calculate selectable episodes based on platform
    let selectableEpisodeNos: number[] = [];
    if (this.platform === 'webtoons') {
      // WEBTOON (Global) - all episodes without charge concept
      selectableEpisodeNos = this.webtoonsEpisodes
        .filter(e => !this.archivedEpisodeNos.has(e.episode.episodeNo))
        .map(e => e.episode.episodeNo);
    } else {
      // Naver Webtoon - exclude paid and archived
      selectableEpisodeNos = this.episodes
        .filter(e => !e.episode.charge && !this.archivedEpisodeNos.has(e.episode.no))
        .map(e => e.episode.no);
    }

    const allSelectableSelected = selectableEpisodeNos.length > 0 &&
      selectableEpisodeNos.every(no => this.selectedEpisodeNos.has(no));
    const someSelectableSelected = selectableEpisodeNos.some(no => this.selectedEpisodeNos.has(no));
    this.selectAllCb.checked = allSelectableSelected;
    this.selectAllCb.indeterminate = someSelectableSelected && !allSelectableSelected;
    this.selectAllCb.disabled = selectableEpisodeNos.length === 0;

    this.selectAllCb.addEventListener('change', () => {
      // Blur any focused input to hide keyboard on mobile
      (document.activeElement as HTMLElement)?.blur?.();

      const isChecked = this.selectAllCb?.checked ?? false;

      if (this.platform === 'webtoons') {
        // WEBTOON (Global)
        for (const ep of this.webtoonsEpisodes) {
          if (!this.archivedEpisodeNos.has(ep.episode.episodeNo)) {
            if (isChecked) {
              this.selectedEpisodeNos.add(ep.episode.episodeNo);
            } else {
              this.selectedEpisodeNos.delete(ep.episode.episodeNo);
            }
            ep.selected = isChecked;
          }
        }
      } else {
        // Naver Webtoon
        for (const ep of this.episodes) {
          if (!ep.episode.charge && !this.archivedEpisodeNos.has(ep.episode.no)) {
            if (isChecked) {
              this.selectedEpisodeNos.add(ep.episode.no);
            } else {
              this.selectedEpisodeNos.delete(ep.episode.no);
            }
            ep.selected = isChecked;
          }
        }
      }

      // Update checkboxes in the list
      const rows = this.contentContainer.querySelectorAll('.webtoon-episode-row');
      rows.forEach((row) => {
        const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (cb && !cb.disabled) {
          cb.checked = isChecked;
        }
      });
      this.updateSelectionUI();
    });

    // Label text - "Select all" for WEBTOON (no pagination), "Select page" for Naver
    selectAllLabel.createSpan({ text: this.platform === 'webtoons' ? 'Select all' : 'Select page' });

    // Right: Sort toggle
    const sortBtn = header.createEl('button');
    sortBtn.addClass('wam-sort-btn', 'clickable-icon');

    const sortIcon = sortBtn.createSpan();
    sortIcon.addClass('wam-sort-icon');
    setIcon(sortIcon, this.sortOrder === 'newest' ? 'arrow-down' : 'arrow-up');
    sortBtn.createSpan({ text: this.sortOrder === 'newest' ? 'Newest' : 'Oldest' });

    sortBtn.addEventListener('click', () => {
      // Blur to hide keyboard on mobile
      (document.activeElement as HTMLElement)?.blur?.();

      this.sortOrder = this.sortOrder === 'newest' ? 'oldest' : 'newest';

      if (this.platform === 'webtoons') {
        // WEBTOON (Global) - reload from appropriate page
        // Newest first: page 1, Oldest first: last page
        const targetPage = this.sortOrder === 'oldest' ? this.webtoonsTotalPages : 1;
        this.webtoonsEpisodes = []; // Clear to show loading state
        this.webtoonsHasMorePages = true;
        void this.loadWebtoonsPage(targetPage);
      } else {
        // Naver Webtoon - reload from server
        this.currentPage = 1;
        void this.loadPage(1);
      }
    });
  }

  private renderPaginationControls(wrapper: HTMLElement): void {
    if (!this.pageInfo || this.pageInfo.totalPages <= 1) return;

    const isMobile = Platform.isMobile;

    const controls = wrapper.createDiv({ cls: 'webtoon-pagination' });
    controls.addClass(isMobile ? 'wam-pagination--mobile' : 'wam-pagination');

    const { totalPages } = this.pageInfo;
    const currentPage = this.currentPage;

    // First page button
    const firstBtn = this.createPaginationButton(controls, 'chevrons-left', 'First');
    firstBtn.disabled = currentPage === 1 || this.isLoadingPage;
    firstBtn.addEventListener('click', () => {
      (document.activeElement as HTMLElement)?.blur?.();
      void this.loadPage(1);
    });

    // Previous button
    const prevBtn = this.createPaginationButton(controls, 'chevron-left', 'Previous');
    prevBtn.disabled = currentPage === 1 || this.isLoadingPage;
    prevBtn.addEventListener('click', () => {
      (document.activeElement as HTMLElement)?.blur?.();
      void this.loadPage(currentPage - 1);
    });

    // Page dropdown with subtle border
    const pageSelect = controls.createEl('select');
    pageSelect.addClass(isMobile ? 'wam-page-select--mobile' : 'wam-page-select');
    pageSelect.disabled = this.isLoadingPage;

    for (let i = 1; i <= totalPages; i++) {
      const option = pageSelect.createEl('option', {
        value: String(i),
        text: `${i} / ${totalPages}`,
      });
      if (i === currentPage) option.selected = true;
    }

    pageSelect.addEventListener('change', () => {
      void this.loadPage(parseInt(pageSelect.value, 10));
      pageSelect.blur(); // Remove focus after selection
    });

    // Next button
    const nextBtn = this.createPaginationButton(controls, 'chevron-right', 'Next');
    nextBtn.disabled = currentPage === totalPages || this.isLoadingPage;
    nextBtn.addEventListener('click', () => {
      (document.activeElement as HTMLElement)?.blur?.();
      void this.loadPage(currentPage + 1);
    });

    // Last page button
    const lastBtn = this.createPaginationButton(controls, 'chevrons-right', 'Last');
    lastBtn.disabled = currentPage === totalPages || this.isLoadingPage;
    lastBtn.addEventListener('click', () => {
      (document.activeElement as HTMLElement)?.blur?.();
      void this.loadPage(totalPages);
    });
  }

  /**
   * Render pagination controls for WEBTOON Global (desktop only)
   */
  private renderWebtoonsPaginationControls(wrapper: HTMLElement): void {
    if (this.webtoonsTotalPages <= 1) return;

    const controls = wrapper.createDiv({ cls: 'webtoon-pagination' });
    controls.addClass('wam-pagination');

    const totalPages = this.webtoonsTotalPages;
    const currentPage = this.webtoonsCurrentPage;

    // First page button
    const firstBtn = this.createPaginationButton(controls, 'chevrons-left', 'First');
    firstBtn.disabled = currentPage === 1 || this.isLoadingWebtoonsPage;
    firstBtn.addEventListener('click', () => {
      (document.activeElement as HTMLElement)?.blur?.();
      void this.loadWebtoonsPage(1);
    });

    // Previous button
    const prevBtn = this.createPaginationButton(controls, 'chevron-left', 'Previous');
    prevBtn.disabled = currentPage === 1 || this.isLoadingWebtoonsPage;
    prevBtn.addEventListener('click', () => {
      (document.activeElement as HTMLElement)?.blur?.();
      void this.loadWebtoonsPage(currentPage - 1);
    });

    // Page dropdown
    const pageSelect = controls.createEl('select');
    pageSelect.addClass('wam-page-select');
    pageSelect.disabled = this.isLoadingWebtoonsPage;

    for (let i = 1; i <= totalPages; i++) {
      const option = pageSelect.createEl('option', {
        value: String(i),
        text: `${i} / ${totalPages}`,
      });
      if (i === currentPage) option.selected = true;
    }

    pageSelect.addEventListener('change', () => {
      void this.loadWebtoonsPage(parseInt(pageSelect.value, 10));
      pageSelect.blur();
    });

    // Next button
    const nextBtn = this.createPaginationButton(controls, 'chevron-right', 'Next');
    nextBtn.disabled = currentPage === totalPages || this.isLoadingWebtoonsPage;
    nextBtn.addEventListener('click', () => {
      (document.activeElement as HTMLElement)?.blur?.();
      void this.loadWebtoonsPage(currentPage + 1);
    });

    // Last page button
    const lastBtn = this.createPaginationButton(controls, 'chevrons-right', 'Last');
    lastBtn.disabled = currentPage === totalPages || this.isLoadingWebtoonsPage;
    lastBtn.addEventListener('click', () => {
      (document.activeElement as HTMLElement)?.blur?.();
      void this.loadWebtoonsPage(totalPages);
    });
  }

  private createPaginationButton(container: HTMLElement, iconName: string, title: string): HTMLButtonElement {
    const isMobile = Platform.isMobile;
    const btn = container.createEl('button', { attr: { title } });
    btn.addClass(isMobile ? 'wam-page-btn--mobile' : 'wam-page-btn', 'clickable-icon');

    const icon = btn.createSpan();
    icon.addClass('wam-page-btn-icon');
    setIcon(icon, iconName);

    return btn;
  }

  private renderEpisodeRow(container: HTMLElement, item: EpisodeSelection): void {
    const { episode } = item;
    const isPaid = episode.charge;
    const isArchived = this.archivedEpisodeNos.has(episode.no);
    const isDisabled = isPaid || isArchived;
    const isSelected = this.selectedEpisodeNos.has(episode.no);

    const row = container.createDiv({ cls: 'webtoon-episode-row' });
    row.addClass(isDisabled ? 'wam-episode-row--disabled' : 'wam-episode-row');

    if (!isDisabled) {
      row.addEventListener('click', (e) => {
        // Blur to hide keyboard on mobile
        (document.activeElement as HTMLElement)?.blur?.();

        if ((e.target as HTMLElement).tagName !== 'INPUT') {
          this.toggleEpisodeSelection(episode.no, !isSelected);
        }
      });
    }

    // Checkbox
    const cb = row.createEl('input', { type: 'checkbox' });
    cb.addClass('wam-episode-cb');
    cb.checked = isArchived ? true : isSelected; // Archived shows as checked+disabled
    cb.disabled = isDisabled;
    if (!isDisabled) {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        this.toggleEpisodeSelection(episode.no, cb.checked);
      });
    }

    // Episode number
    const numEl = row.createSpan({ text: `#${episode.no}` });
    numEl.addClass('wam-episode-num');

    // Title (flexible, truncate)
    const titleContainer = row.createDiv();
    titleContainer.addClass('wam-episode-title-container');

    const subtitle = titleContainer.createSpan({ text: episode.subtitle });
    subtitle.addClass('wam-episode-subtitle');

    if (isArchived) {
      const badge = titleContainer.createSpan({ text: 'Archived' });
      badge.addClass('wam-badge--archived');
    } else if (isPaid) {
      const badge = titleContainer.createSpan({ text: 'Paid' });
      badge.addClass('wam-badge--paid');
    }

    // Meta on right (rating + date)
    const meta = row.createDiv();
    meta.addClass('wam-episode-meta');

    const parts: string[] = [];
    if (episode.starScore) parts.push(`★${episode.starScore.toFixed(1)}`);
    if (episode.serviceDateDescription) parts.push(episode.serviceDateDescription);
    meta.setText(parts.join(' · '));
  }

  private renderProgress(container: HTMLElement): void {
    if (!this.downloadProgress) return;

    const {
      completedEpisodes,
      totalEpisodes,
      currentEpisode,
      failedEpisodes,
      currentImageIndex,
      totalImages
    } = this.downloadProgress;

    // Calculate overall progress including current episode's image progress
    const currentEpisodeProgress = (currentEpisode && totalImages > 0)
      ? currentImageIndex / totalImages
      : 0;
    const percent = totalEpisodes > 0
      ? ((completedEpisodes + currentEpisodeProgress) / totalEpisodes) * 100
      : 0;

    const progress = container.createDiv({ cls: 'webtoon-progress' });
    progress.addClass('wam-progress');

    // Top row: Episode info
    const topRow = progress.createDiv();
    topRow.addClass('wam-progress-row');

    const episodeInfo = topRow.createDiv();
    episodeInfo.addClass('wam-progress-episode-info');

    if (currentEpisode) {
      // Show episode number and truncated subtitle
      const subtitle = currentEpisode.subtitle.length > 20
        ? currentEpisode.subtitle.slice(0, 20) + '...'
        : currentEpisode.subtitle;
      episodeInfo.setText(`#${currentEpisode.no} ${subtitle}`);
    } else {
      // Summary after complete
      const parts: string[] = [];
      if (completedEpisodes > 0) parts.push(`${completedEpisodes} completed`);
      if (failedEpisodes > 0) parts.push(`${failedEpisodes} failed`);
      episodeInfo.setText(parts.join(', ') || 'Done');
    }

    // Episode count on right
    const episodeCount = topRow.createDiv();
    episodeCount.addClass('wam-progress-episode-count');
    episodeCount.setText(`Episode ${completedEpisodes + (currentEpisode ? 1 : 0)}/${totalEpisodes}`);

    // Middle: Progress bar
    const barBg = progress.createDiv();
    barBg.addClass('wam-progress-bar-bg');

    const barFill = barBg.createDiv();
    barFill.addClass('wam-progress-bar-fill');
    barFill.setCssProps({'--sa-width': `${percent}%`});
    barFill.addClass('sa-dynamic-width');

    // Bottom row: Image progress (only show when downloading)
    if (currentEpisode && totalImages > 0) {
      const bottomRow = progress.createDiv();
      bottomRow.addClass('wam-progress-row');

      const imageInfo = bottomRow.createDiv();
      imageInfo.addClass('wam-progress-image-info');
      imageInfo.setText(`Downloading image ${currentImageIndex + 1} of ${totalImages}`);

      // Image progress percentage
      const imagePercent = totalImages > 0 ? Math.round(((currentImageIndex + 1) / totalImages) * 100) : 0;
      const imagePercentEl = bottomRow.createDiv();
      imagePercentEl.addClass('wam-progress-image-info');
      imagePercentEl.setText(`${imagePercent}%`);
    }
  }

  private renderFooter(container: HTMLElement): void {
    // Buttons
    const footer = container.createDiv({ cls: 'modal-button-container' });
    footer.addClass(Platform.isMobile ? 'wam-footer--mobile' : 'wam-footer');

    // Download button
    if (this.state === 'ready' || this.state === 'completed') {
      const selectedCount = this.selectedEpisodeNos.size;

      this.downloadBtn = footer.createEl('button', {
        text: `Archive ${selectedCount} episode${selectedCount !== 1 ? 's' : ''}`,
        cls: 'mod-cta',
      });
      this.downloadBtn.disabled = selectedCount === 0;

      if (Platform.isMobile) this.downloadBtn.addClass('wam-footer-btn-full');

      this.downloadBtn.addEventListener('click', () => void this.startDownload());
    }

    // Cancel button
    const cancelBtn = footer.createEl('button', {
      text: this.state === 'downloading' ? 'Cancel' : 'Close',
    });

    if (Platform.isMobile) cancelBtn.addClass('wam-footer-btn-full');

    cancelBtn.addEventListener('click', () => {
      if (this.state === 'downloading') {
        this.downloadQueue.cancel();
        this.webtoonsDownloadQueue.cancel();
      }
      this.close();
    });

    // Compact disclaimer
    const disclaimer = container.createDiv();
    disclaimer.addClass('wam-disclaimer');
    disclaimer.setText('Archive only content you have permission to save.');
  }

  // ==========================================================================
  // Data Loading
  // ==========================================================================

  private async loadWebtoon(): Promise<void> {
    const input = this.url.trim();

    if (!input) {
      this.state = 'idle';
      this.webtoonInfo = null;
      this.webtoonsSeriesInfo = null;
      this.webtoonsUrlInfo = null;
      this.episodes = [];
      this.webtoonsEpisodes = [];
      this.searchResults = [];
      this.searchQuery = '';
      this.selectedEpisodeNos.clear();
      this.render();
      return;
    }

    // Auto-detect platform from URL
    if (WebtoonsLocalService.isWebtoonsUrl(input)) {
      this.platform = 'webtoons';
      const urlInfo = this.webtoonsService.parseUrl(input);
      if (urlInfo) {
        this.webtoonsUrlInfo = urlInfo;
        this.selectedLanguage = urlInfo.language;
        await this.loadWebtoonsGlobal(urlInfo);
        return;
      }
    }

    // Try Naver Webtoon URL parsing
    const urlInfo = this.naverWebtoonService.parseUrl(input);
    if (urlInfo) {
      this.platform = 'naver-webtoon';
      // Valid URL - load webtoon directly
      await this.loadWebtoonByUrl(urlInfo);
      return;
    }

    // Not a valid URL - treat as search query (Naver only for now)
    this.platform = 'naver-webtoon';
    await this.performSearch(input);
  }

  /**
   * Load WEBTOON (Global) series and episodes via RSS
   */
  private async loadWebtoonsGlobal(urlInfo: WebtoonsUrlInfo): Promise<void> {
    this.state = 'loading';
    this.searchResults = [];
    this.searchQuery = '';
    this.selectedEpisodeIndex = -1;

    // Reset WEBTOON Global pagination state
    this.webtoonsCurrentPage = 1;
    this.webtoonsTotalPages = 1;
    this.webtoonsHasMorePages = true;
    this.isLoadingWebtoonsPage = false;
    this.isLoadingMore = false;

    // Clear Naver Webtoon state
    this.webtoonInfo = null;
    this.episodes = [];

    this.render();

    try {
      // Fetch series info, first page of episodes, and RSS feed in parallel
      const [seriesInfo, firstPageResult, rssFeed] = await Promise.all([
        this.webtoonsService.fetchSeriesInfo(urlInfo),
        this.webtoonsService.fetchEpisodeList(urlInfo, 1),
        this.webtoonsService.fetchRssFeed(urlInfo),
      ]);

      this.webtoonsSeriesInfo = seriesInfo;

      // Fallback: use RSS feed thumbnail if series page parsing didn't find one
      if (!this.webtoonsSeriesInfo.thumbnailUrl && rssFeed.thumbnailUrl) {
        this.webtoonsSeriesInfo.thumbnailUrl = rssFeed.thumbnailUrl;
      }

      // Store pagination info
      this.webtoonsTotalPages = firstPageResult.totalPages;
      this.totalEpisodeCount = firstPageResult.totalCount;
      this.webtoonsHasMorePages = firstPageResult.totalPages > 1;

      // Check which episodes are already archived
      await this.checkWebtoonsArchivedEpisodes(firstPageResult.episodes);

      // Convert episodes to selection format
      this.webtoonsEpisodes = firstPageResult.episodes.map(ep => ({
        episode: ep,
        selected: this.selectedEpisodeNos.has(ep.episodeNo),
      }));

      // Note: First page is already sorted by server (newest first)
      // If user selected "oldest first", we need to load the last page first
      if (this.sortOrder === 'oldest') {
        // For oldest first, start from the last page
        const lastPageResult = await this.webtoonsService.fetchEpisodeList(urlInfo, this.webtoonsTotalPages);
        await this.checkWebtoonsArchivedEpisodes(lastPageResult.episodes);
        this.webtoonsEpisodes = lastPageResult.episodes.map(ep => ({
          episode: ep,
          selected: this.selectedEpisodeNos.has(ep.episodeNo),
        }));
        this.webtoonsCurrentPage = this.webtoonsTotalPages;
      }

      // Check subscription status
      await this.checkWebtoonsSubscriptionStatus();

      this.state = 'ready';
      this.render();
    } catch (error) {
      console.error('[WebtoonArchiveModal] Load WEBTOON error:', error);
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : 'Failed to load webtoon';
      this.render();
    }
  }

  /**
   * Load a specific page of WEBTOON Global episodes (desktop pagination)
   */
  private async loadWebtoonsPage(page: number): Promise<void> {
    if (!this.webtoonsUrlInfo || this.isLoadingWebtoonsPage) return;
    if (page < 1 || page > this.webtoonsTotalPages) return;

    this.isLoadingWebtoonsPage = true;
    this.webtoonsCurrentPage = page;
    this.render();

    try {
      const pageResult = await this.webtoonsService.fetchEpisodeList(this.webtoonsUrlInfo, page);

      // Check archived status for new episodes
      await this.checkWebtoonsArchivedEpisodes(pageResult.episodes);

      // Replace episodes with new page
      this.webtoonsEpisodes = pageResult.episodes.map(ep => ({
        episode: ep,
        selected: this.selectedEpisodeNos.has(ep.episodeNo),
      }));

      this.webtoonsHasMorePages = page < this.webtoonsTotalPages;
    } catch (error) {
      console.error('[WebtoonArchiveModal] Load WEBTOON page error:', error);
    } finally {
      this.isLoadingWebtoonsPage = false;
      this.render();
    }
  }

  /**
   * Load more WEBTOON Global episodes (mobile infinite scroll)
   */
  private async loadMoreWebtoonsEpisodes(): Promise<void> {
    if (!this.webtoonsUrlInfo || this.isLoadingMore || !this.webtoonsHasMorePages) return;

    const nextPage = this.sortOrder === 'oldest'
      ? this.webtoonsCurrentPage - 1  // Go to earlier pages for oldest first
      : this.webtoonsCurrentPage + 1; // Go to later pages for newest first

    if (nextPage < 1 || nextPage > this.webtoonsTotalPages) {
      this.webtoonsHasMorePages = false;
      return;
    }

    this.isLoadingMore = true;
    this.render();

    try {
      const pageResult = await this.webtoonsService.fetchEpisodeList(this.webtoonsUrlInfo, nextPage);

      // Check archived status for new episodes
      await this.checkWebtoonsArchivedEpisodes(pageResult.episodes);

      // Append new episodes
      const newEpisodes = pageResult.episodes.map(ep => ({
        episode: ep,
        selected: this.selectedEpisodeNos.has(ep.episodeNo),
      }));
      this.webtoonsEpisodes.push(...newEpisodes);

      this.webtoonsCurrentPage = nextPage;
      this.webtoonsHasMorePages = this.sortOrder === 'oldest'
        ? nextPage > 1
        : nextPage < this.webtoonsTotalPages;
    } catch (error) {
      console.error('[WebtoonArchiveModal] Load more WEBTOON episodes error:', error);
    } finally {
      this.isLoadingMore = false;
      this.render();
    }
  }

  /**
   * Check which WEBTOON (Global) episodes are already archived
   */
  private async checkWebtoonsArchivedEpisodes(episodes: WebtoonsGlobalEpisode[]): Promise<void> {
    if (!this.webtoonsSeriesInfo) return;

    const seriesTitle = this.sanitizeFilename(this.webtoonsSeriesInfo.title);
    const platformName = getPlatformName('webtoons');
    const noteFolder = `${DEFAULT_ARCHIVE_PATH}/${platformName}/${seriesTitle}`;

    const folder = this.app.vault.getAbstractFileByPath(noteFolder);
    if (!folder) return;

    const filesInFolder = this.app.vault.getFiles()
      .filter(f => f.path.startsWith(noteFolder + '/') && f.extension === 'md')
      .map(f => f.name);

    for (const ep of episodes) {
      const episodeNo = String(ep.episodeNo).padStart(3, '0');
      const isArchived = filesInFolder.some(filename => filename.startsWith(`${episodeNo} - `));

      if (isArchived) {
        this.archivedEpisodeNos.add(ep.episodeNo);
        this.selectedEpisodeNos.delete(ep.episodeNo);
      }
    }
  }

  /**
   * Check WEBTOON (Global) subscription status
   */
  private async checkWebtoonsSubscriptionStatus(): Promise<void> {
    if (!this.webtoonsUrlInfo || !this.plugin.subscriptionManager?.isInitialized) {
      this.isSubscribed = false;
      this.subscriptionId = null;
      return;
    }

    try {
      if (!this.plugin.subscriptionManager.getIsRefreshing()) {
        await this.plugin.subscriptionManager.refresh();
      }

      const subscriptions = this.plugin.subscriptionManager.getSubscriptions();
      const existing = subscriptions.find(
        (s: Subscription) =>
          s.platform === 'webtoons' &&
          s.webtoonsOptions?.titleNo === this.webtoonsUrlInfo?.titleNo &&
          s.enabled
      );

      if (existing) {
        this.isSubscribed = true;
        this.subscriptionId = existing.id;
      } else {
        this.isSubscribed = false;
        this.subscriptionId = null;
      }
    } catch (error) {
      console.error('[WebtoonArchiveModal] Failed to check WEBTOON subscription status:', error);
      this.isSubscribed = false;
      this.subscriptionId = null;
    }
  }

  /**
   * Load webtoon by URL info (existing logic extracted)
   */
  private async loadWebtoonByUrl(urlInfo: { titleId: string; episodeNo?: number; urlType: 'series' | 'episode' }): Promise<void> {
    this.titleId = urlInfo.titleId;
    this.state = 'loading';
    this.currentPage = 1;
    this.sortOrder = 'newest';
    this.searchResults = [];
    this.searchQuery = '';
    this.selectedEpisodeIndex = -1; // Reset keyboard navigation
    this.hasMorePages = true; // Reset infinite scroll state
    this.isLoadingMore = false;

    if (urlInfo.episodeNo) {
      this.preSelectedEpisodeNo = urlInfo.episodeNo;
      this.selectedEpisodeNos.add(urlInfo.episodeNo);
    }

    this.render();

    try {
      const [info, episodeList] = await Promise.all([
        this.naverWebtoonService.fetchWebtoonInfo(urlInfo.titleId),
        this.naverWebtoonService.fetchEpisodeList(urlInfo.titleId, 1),
      ]);

      this.webtoonInfo = info;
      this.pageInfo = episodeList.pageInfo;
      this.totalEpisodeCount = episodeList.totalCount;
      this.currentPage = 1;
      this.hasMorePages = this.pageInfo.totalPages > 1; // For mobile infinite scroll

      // Check which episodes are already archived
      await this.checkArchivedEpisodes(episodeList.articleList);

      // Check if already subscribed to this webtoon
      await this.checkSubscriptionStatus();

      // Extract preview episodes from chargeFolderArticleList (API returns them separately)
      this.previewEpisodes = episodeList.previewEpisodes
        .map(ep => ({
          no: ep.no,
          subtitle: ep.subtitle,
          freeSchedule: ep.serviceDateDescription,
        }));

      this.episodes = episodeList.articleList.map(ep => ({
        episode: ep,
        selected: this.selectedEpisodeNos.has(ep.no),
      }));

      this.state = 'ready';
      this.render();

      // Auto-paginate to pre-selected episode if not on current page
      if (this.preSelectedEpisodeNo && this.pageInfo) {
        const episodeOnCurrentPage = this.episodes.some(
          e => e.episode.no === this.preSelectedEpisodeNo
        );

        if (!episodeOnCurrentPage && this.pageInfo.totalPages > 1 && this.totalEpisodeCount > 0) {
          // Check if pre-selected episode exists (not beyond total count)
          if (this.preSelectedEpisodeNo > this.totalEpisodeCount) {
            // Episode doesn't exist yet - clear selection and stay on page 1 (newest)
            this.selectedEpisodeNos.delete(this.preSelectedEpisodeNo);
            this.preSelectedEpisodeNo = null;
            this.updateSelectionUI();
          } else {
            // Calculate which page the episode is on (newest first order)
            // In newest first: page 1 has highest episode numbers, last page has lowest
            const pageSize = this.pageInfo.pageSize || 20;
            const positionFromNewest = this.totalEpisodeCount - this.preSelectedEpisodeNo + 1;
            // Clamp to totalPages - last page may contain more items than pageSize
            const targetPage = Math.min(
              Math.ceil(positionFromNewest / pageSize),
              this.pageInfo.totalPages
            );

            if (targetPage > 0) {
              await this.loadPage(targetPage);
            }
          }
        }
      }
    } catch (error) {
      console.error('[WebtoonArchiveModal] Load error:', error);
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : 'Failed to load webtoon';
      this.render();
    }
  }

  /**
   * Perform search by keyword
   */
  private async performSearch(query: string): Promise<void> {
    this.searchQuery = query;
    this.state = 'searching';
    this.webtoonInfo = null;
    this.episodes = [];
    this.render();

    try {
      const results = await this.naverWebtoonService.searchWebtoons(query);
      this.searchResults = results;
      this.state = 'search-results';
      this.render();
    } catch (error) {
      console.error('[WebtoonArchiveModal] Search error:', error);
      this.state = 'error';
      this.errorMessage = 'Failed to search webtoons';
      this.render();
    }
  }

  /**
   * Select a webtoon from search results and load its episodes
   */
  private async selectWebtoonFromSearch(webtoon: WebtoonSearchResult): Promise<void> {
    // Clear search state
    this.searchResults = [];
    this.searchQuery = '';

    // Update URL input to show the selected webtoon URL
    this.url = `https://comic.naver.com/webtoon/list?titleId=${webtoon.titleId}`;

    // Load the webtoon
    const urlInfo = {
      titleId: String(webtoon.titleId),
      urlType: 'series' as const,
    };
    await this.loadWebtoonByUrl(urlInfo);
  }

  private async loadPage(page: number): Promise<void> {
    if (!this.titleId || this.isLoadingPage) return;

    this.isLoadingPage = true;
    this.currentPage = page;
    this.selectedEpisodeIndex = -1; // Reset keyboard navigation on page change

    // Reset infinite scroll state when loading page 1 (e.g., sort change)
    if (page === 1) {
      this.hasMorePages = true;
      this.isLoadingMore = false;
    }

    this.render();

    try {
      const episodeList = await this.naverWebtoonService.fetchEpisodeList(
        this.titleId,
        page,
        this.sortOrder === 'oldest'
      );

      // Check which episodes are already archived
      await this.checkArchivedEpisodes(episodeList.articleList);

      this.pageInfo = episodeList.pageInfo;
      this.totalEpisodeCount = episodeList.totalCount;
      this.hasMorePages = page < this.pageInfo.totalPages; // Update for infinite scroll
      this.episodes = episodeList.articleList.map(ep => ({
        episode: ep,
        selected: this.selectedEpisodeNos.has(ep.no),
      }));
    } catch (error) {
      console.error('[WebtoonArchiveModal] Load page error:', error);
      new Notice('Failed to load page');
    } finally {
      this.isLoadingPage = false;
      this.render();
    }
  }

  /**
   * Load more episodes for mobile infinite scroll (appends to existing list)
   */
  private async loadMoreEpisodes(): Promise<void> {
    if (!this.titleId || this.isLoadingMore || !this.hasMorePages || !this.pageInfo) return;

    const nextPage = this.currentPage + 1;
    if (nextPage > this.pageInfo.totalPages) {
      this.hasMorePages = false;
      return;
    }

    this.isLoadingMore = true;

    // Save scroll position before render
    const listEl = this.contentContainer.querySelector('.webtoon-episode-list');
    const scrollTop = listEl?.scrollTop ?? 0;

    this.render();

    try {
      const episodeList = await this.naverWebtoonService.fetchEpisodeList(
        this.titleId,
        nextPage,
        this.sortOrder === 'oldest'
      );

      // Check which episodes are already archived
      await this.checkArchivedEpisodes(episodeList.articleList);

      // Append new episodes to existing list
      const newEpisodes = episodeList.articleList.map(ep => ({
        episode: ep,
        selected: this.selectedEpisodeNos.has(ep.no),
      }));
      this.episodes = [...this.episodes, ...newEpisodes];

      this.currentPage = nextPage;
      this.pageInfo = episodeList.pageInfo;
      this.hasMorePages = nextPage < this.pageInfo.totalPages;
    } catch (error) {
      console.error('[WebtoonArchiveModal] Load more error:', error);
      new Notice('Failed to load more episodes');
    } finally {
      this.isLoadingMore = false;
      this.render();

      // Restore scroll position after render
      requestAnimationFrame(() => {
        const newListEl = this.contentContainer.querySelector('.webtoon-episode-list');
        if (newListEl) {
          newListEl.scrollTop = scrollTop;
        }
      });
    }
  }

  private toggleEpisodeSelection(episodeNo: number, selected: boolean): void {
    if (selected) {
      this.selectedEpisodeNos.add(episodeNo);
    } else {
      this.selectedEpisodeNos.delete(episodeNo);
    }

    const item = this.episodes.find(e => e.episode.no === episodeNo);
    if (item) item.selected = selected;

    // Update the specific checkbox in the row
    const rows = this.contentContainer.querySelectorAll('.webtoon-episode-row');
    const idx = this.episodes.findIndex(e => e.episode.no === episodeNo);
    if (idx >= 0 && idx < rows.length) {
      const cb = rows[idx]?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb && !cb.disabled) {
        cb.checked = selected;
      }
    }

    this.updateSelectionUI();
  }

  /**
   * Update only selection-related UI without full re-render
   */
  private updateSelectionUI(): void {
    const selectedCount = this.selectedEpisodeNos.size;

    // Get total episodes based on platform
    const totalEpisodes = this.platform === 'webtoons'
      ? this.webtoonsEpisodes.length
      : (this.pageInfo?.totalRows ?? 0);

    // Update stats text
    if (this.statsEl) {
      this.statsEl.setText(`${totalEpisodes} episodes · ${selectedCount} selected`);
    }

    // Update download button
    if (this.downloadBtn) {
      this.downloadBtn.textContent = `Archive ${selectedCount} episode${selectedCount !== 1 ? 's' : ''}`;
      this.downloadBtn.disabled = selectedCount === 0;
    }

    // Update select all checkbox state based on platform
    if (this.selectAllCb) {
      let selectableEpisodeNos: number[] = [];

      if (this.platform === 'webtoons') {
        // WEBTOON (Global) - all non-archived episodes
        selectableEpisodeNos = this.webtoonsEpisodes
          .filter(e => !this.archivedEpisodeNos.has(e.episode.episodeNo))
          .map(e => e.episode.episodeNo);
      } else {
        // Naver Webtoon - exclude paid and archived
        selectableEpisodeNos = this.episodes
          .filter(e => !e.episode.charge && !this.archivedEpisodeNos.has(e.episode.no))
          .map(e => e.episode.no);
      }

      const allSelectableSelected = selectableEpisodeNos.length > 0 &&
        selectableEpisodeNos.every(no => this.selectedEpisodeNos.has(no));
      const someSelectableSelected = selectableEpisodeNos.some(no => this.selectedEpisodeNos.has(no));
      this.selectAllCb.checked = allSelectableSelected;
      this.selectAllCb.indeterminate = someSelectableSelected && !allSelectableSelected;
      this.selectAllCb.disabled = selectableEpisodeNos.length === 0;
    }
  }

  /**
   * Check which episodes are already archived in the vault
   * Uses episode number prefix matching since subtitle may differ between LIST and DETAIL APIs
   */
  private async checkArchivedEpisodes(episodes: WebtoonEpisode[]): Promise<void> {
    if (!this.webtoonInfo) return;

    const seriesTitle = this.sanitizeFilename(this.webtoonInfo.titleName);
    const platformName = getPlatformName('naver-webtoon');
    const noteFolder = `${DEFAULT_ARCHIVE_PATH}/${platformName}/${seriesTitle}`;

    // Get all files in the series folder
    const folder = this.app.vault.getAbstractFileByPath(noteFolder);
    if (!folder) return;

    // Get list of files in folder
    const filesInFolder = this.app.vault.getFiles()
      .filter(f => f.path.startsWith(noteFolder + '/') && f.extension === 'md')
      .map(f => f.name);

    for (const ep of episodes) {
      const episodeNo = String(ep.no).padStart(3, '0');
      // Check if any file starts with the episode number pattern
      const isArchived = filesInFolder.some(filename => filename.startsWith(`${episodeNo} - `));

      if (isArchived) {
        this.archivedEpisodeNos.add(ep.no);
        // Remove from selection if already archived
        this.selectedEpisodeNos.delete(ep.no);
      }
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  // ==========================================================================
  // Subscription
  // ==========================================================================

  /**
   * Check if user has an active subscription for this webtoon
   * Refreshes the subscription cache first to ensure we have the latest data
   */
  private async checkSubscriptionStatus(): Promise<void> {
    if (!this.titleId || !this.plugin.subscriptionManager?.isInitialized) {
      this.isSubscribed = false;
      this.subscriptionId = null;
      return;
    }

    try {
      // Refresh subscriptions to get latest data from server
      // This ensures the toggle reflects the current subscription state
      if (!this.plugin.subscriptionManager.getIsRefreshing()) {
        await this.plugin.subscriptionManager.refresh();
      }

      const subscriptions = this.plugin.subscriptionManager.getSubscriptions();

      const existing = subscriptions.find(
        (s: Subscription) =>
          s.platform === 'naver-webtoon' &&
          String(s.naverWebtoonOptions?.titleId) === String(this.titleId) &&
          s.enabled
      );

      if (existing) {
        this.isSubscribed = true;
        this.subscriptionId = existing.id;
      } else {
        this.isSubscribed = false;
        this.subscriptionId = null;
      }
    } catch (error) {
      console.error('[WebtoonArchiveModal] Failed to check subscription status:', error);
      this.isSubscribed = false;
      this.subscriptionId = null;
    }
  }

  /**
   * Render subscription toggle section
   */
  private renderSubscriptionSection(container: HTMLElement): void {
    // Handle both platforms
    if (this.platform === 'webtoons' && !this.webtoonsSeriesInfo) return;
    if (this.platform === 'naver-webtoon' && !this.webtoonInfo) return;

    const isMobile = Platform.isMobile;

    const section = container.createDiv({ cls: 'webtoon-subscription-section' });
    section.addClass(isMobile ? 'wam-subscription--mobile' : 'wam-subscription');

    // Left: Bell icon + text
    const labelRow = section.createDiv();
    labelRow.addClass('wam-subscription-label');

    const bellIcon = labelRow.createSpan();
    bellIcon.addClass(isMobile ? 'wam-subscription-bell--mobile' : 'wam-subscription-bell');
    setIcon(bellIcon, 'bell');

    const textContainer = labelRow.createDiv();
    const mainText = textContainer.createDiv({ text: isMobile ? 'Auto-archive' : 'Auto-archive new episodes' });
    mainText.addClass(isMobile ? 'wam-subscription-text--mobile' : 'wam-subscription-text');

    // Schedule info (shown when subscribed) - hidden on mobile to save space
    const scheduleInfo = textContainer.createDiv({ cls: 'subscription-schedule-info' });
    if (isMobile) {
      scheduleInfo.addClass('sa-hidden');
    } else {
      scheduleInfo.addClass('wam-subscription-schedule');
      this.updateScheduleInfo(scheduleInfo);
    }

    // Right: Toggle (smaller on mobile)
    const toggleContainer = section.createDiv();
    toggleContainer.addClass(isMobile ? 'wam-subscription-toggle--mobile' : 'wam-subscription-toggle');

    const toggle = new ToggleComponent(toggleContainer);
    toggle.setValue(this.isSubscribed);
    // No need to disable - using optimistic UI pattern

    toggle.onChange(async (value: boolean) => {
      await this.handleSubscriptionToggle(value, scheduleInfo);
    });
  }

  /**
   * Update schedule info text
   */
  private updateScheduleInfo(scheduleEl: HTMLElement): void {
    if (!this.isSubscribed) {
      scheduleEl.removeClass('wam-schedule-visible');
      scheduleEl.addClass('wam-schedule-hidden');
      return;
    }

    if (this.platform === 'webtoons' && this.webtoonsSeriesInfo?.updateDay) {
      // WEBTOON (Global) - show update day
      scheduleEl.setText(`Checks every ${this.webtoonsSeriesInfo.updateDay}`);
      scheduleEl.removeClass('wam-schedule-hidden');
      scheduleEl.addClass('wam-schedule-visible');
    } else if (this.platform === 'naver-webtoon' && this.webtoonInfo?.publishDescription) {
      const checkDay = this.getCheckDayName(this.webtoonInfo.publishDescription);
      scheduleEl.setText(`Checks every ${checkDay} at 11 PM KST`);
      scheduleEl.removeClass('wam-schedule-hidden');
      scheduleEl.addClass('wam-schedule-visible');
    } else {
      scheduleEl.removeClass('wam-schedule-visible');
      scheduleEl.addClass('wam-schedule-hidden');
    }
  }

  /**
   * Get the day name when the subscription will check (one day before release)
   * For Naver Webtoon only
   */
  private getCheckDayName(publishDay: string): string {
    const dayMap: Record<string, string> = {
      '월요웹툰': 'Sunday',
      '화요웹툰': 'Monday',
      '수요웹툰': 'Tuesday',
      '목요웹툰': 'Wednesday',
      '금요웹툰': 'Thursday',
      '토요웹툰': 'Friday',
      '일요웹툰': 'Saturday',
    };
    return dayMap[publishDay] || 'Friday';
  }

  /**
   * Handle subscription toggle change (Optimistic UI)
   *
   * Uses optimistic update pattern:
   * 1. Immediately update UI to reflect intended state
   * 2. Make API call in background
   * 3. Revert UI if API call fails
   *
   * This eliminates the perceived delay when toggling subscription.
   */
  private async handleSubscriptionToggle(enabled: boolean, scheduleEl: HTMLElement): Promise<void> {
    // Check for platform-specific info
    const hasInfo = this.platform === 'webtoons'
      ? !!this.webtoonsSeriesInfo
      : !!this.webtoonInfo;

    if (!hasInfo || !this.plugin.subscriptionManager?.isInitialized) {
      new Notice('Subscription manager not available');
      return;
    }

    // Store previous state for potential rollback
    const previousSubscribed = this.isSubscribed;
    const previousSubscriptionId = this.subscriptionId;

    // Optimistic update: immediately reflect the intended state
    this.isSubscribed = enabled;
    this.updateScheduleInfo(scheduleEl);

    // Get series name for notification
    const seriesName = this.platform === 'webtoons'
      ? this.webtoonsSeriesInfo?.title
      : this.webtoonInfo?.titleName;

    // Don't block UI - run API call in background
    try {
      if (enabled) {
        // Create subscription in background - handles both platforms
        await this.createSubscription();
        new Notice(`Subscribed to ${seriesName}`);
      } else {
        // Delete subscription in background
        if (previousSubscriptionId) {
          await this.plugin.subscriptionManager.deleteSubscription(previousSubscriptionId);
          this.subscriptionId = null;
          new Notice(`Unsubscribed from ${seriesName}`);
        }
      }
      // Refresh timeline to update subscription badge in series header
      this.plugin.refreshTimelineView();
    } catch (error) {
      // Rollback on error
      console.error('[WebtoonArchiveModal] Subscription toggle error:', error);
      new Notice(error instanceof Error ? error.message : 'Failed to update subscription');

      // Revert to previous state
      this.isSubscribed = previousSubscribed;
      this.subscriptionId = previousSubscriptionId;
      this.updateScheduleInfo(scheduleEl);

      // Need to re-render to reset the toggle component
      this.render();
    }
  }

  /**
   * Create a new subscription for this webtoon (handles both platforms)
   */
  private async createSubscription(): Promise<void> {
    if (!this.plugin.subscriptionManager) {
      throw new Error('Cannot create subscription: manager not available');
    }

    if (this.platform === 'webtoons') {
      await this.createWebtoonsSubscription();
    } else {
      await this.createNaverWebtoonSubscription();
    }
  }

  /**
   * Create Naver Webtoon subscription
   */
  private async createNaverWebtoonSubscription(): Promise<void> {
    if (!this.webtoonInfo || !this.plugin.subscriptionManager) {
      throw new Error('Cannot create subscription: webtoon info or manager not available');
    }

    // Use daily check at 23:45 KST to catch episodes as soon as they become free
    const cronSchedule = WEBTOON_DAILY_CRON_LOCAL;
    const artistNames = this.webtoonInfo.communityArtists?.map(a => a.name).join(', ');

    const subscription = await this.plugin.subscriptionManager.addSubscription({
      name: this.webtoonInfo.titleName,
      platform: 'naver-webtoon' as any,
      target: {
        handle: this.titleId,
        profileUrl: `https://comic.naver.com/webtoon/list?titleId=${this.titleId}`,
      },
      schedule: {
        cron: cronSchedule,
        timezone: 'Asia/Seoul',
      },
      options: {
        maxPostsPerRun: 5, // Multiple episodes may become free at once
        backfillDays: 0,
      },
      naverWebtoonOptions: {
        titleId: this.titleId,
        titleName: this.webtoonInfo.titleName,
        publishDay: this.webtoonInfo.publishDescription || '토요웹툰',
        thumbnailUrl: this.webtoonInfo.thumbnailUrl,
        artistNames: artistNames,
      },
    });

    this.isSubscribed = true;
    this.subscriptionId = subscription.id;
  }

  /**
   * Create WEBTOON (Global) subscription
   */
  private async createWebtoonsSubscription(): Promise<void> {
    if (!this.webtoonsSeriesInfo || !this.webtoonsUrlInfo || !this.plugin.subscriptionManager) {
      throw new Error('Cannot create subscription: series info or manager not available');
    }

    // Determine CRON schedule based on update day
    const updateDay = this.webtoonsSeriesInfo.updateDay?.toUpperCase() || 'SATURDAY';
    const cronSchedule = WEBTOONS_PUBLISH_DAY_TO_CRON[updateDay] || WEBTOONS_PUBLISH_DAY_TO_CRON['SATURDAY'];

    const subscription = await this.plugin.subscriptionManager.addSubscription({
      name: this.webtoonsSeriesInfo.title,
      platform: 'webtoons' as any,
      target: {
        handle: this.webtoonsUrlInfo.titleNo,
        profileUrl: this.webtoonsService.buildSeriesUrl(this.webtoonsUrlInfo),
      },
      schedule: {
        cron: cronSchedule,
        timezone: 'UTC', // WEBTOON (Global) uses UTC
      },
      options: {
        maxPostsPerRun: 5,
        backfillDays: 0,
      },
      webtoonsOptions: {
        titleNo: this.webtoonsUrlInfo.titleNo,
        seriesTitle: this.webtoonsSeriesInfo.title,
        language: this.webtoonsUrlInfo.language,
        genre: this.webtoonsUrlInfo.genre,
        seriesSlug: this.webtoonsUrlInfo.seriesSlug,
        updateDay: updateDay,
        isCanvas: this.webtoonsUrlInfo.isCanvas,
        thumbnailUrl: this.webtoonsSeriesInfo.thumbnailUrl,
        authorNames: this.webtoonsSeriesInfo.authorNames,
      },
    });

    this.isSubscribed = true;
    this.subscriptionId = subscription.id;
  }

  // ==========================================================================
  // Download
  // ==========================================================================

  private async startDownload(): Promise<void> {
    if (this.selectedEpisodeNos.size === 0) return;

    // Check stream-first mode
    const streamingSettings = this.plugin.settings.webtoonStreaming;
    const isStreamFirst = streamingSettings?.viewMode === 'stream-first';

    // Handle WEBTOON (Global) download
    if (this.platform === 'webtoons') {
      await this.startWebtoonsDownload(isStreamFirst);
      return;
    }

    // Naver Webtoon download
    if (!this.webtoonInfo) return;

    // We need episode info for all selected episodes
    // For now, we only have info for currently loaded page
    // Need to load metadata for all selected episodes
    const selected = Array.from(this.selectedEpisodeNos).map(no => {
      const ep = this.episodes.find(e => e.episode.no === no)?.episode;
      return {
        no,
        subtitle: ep?.subtitle || `Episode ${no}`,
        thumbnailUrl: ep?.thumbnailUrl,
        starScore: ep?.starScore,
        serviceDateDescription: ep?.serviceDateDescription,
      };
    });

    // Stream-first mode: create markdown first, then open fullscreen with streaming
    // The markdown-created event will trigger opening the real card in fullscreen
    if (isStreamFirst && selected.length > 0) {
      // Reset flag - only first episode opens fullscreen, rest download in background
      this.streamFirstHandled = false;

      this.downloadQueue.addEpisodes(selected);

      // Start download with streamFirst option - markdown will be created first
      // The markdown-created event handler will open fullscreen for first episode only
      void this.downloadQueue.start(this.webtoonInfo, { streamFirst: true }).catch(error => {
        console.error('[WebtoonArchiveModal] Background download error:', error);
        new Notice(`Background download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      });

      // Show brief notification - fullscreen will open when markdown is ready
      new Notice('Preparing episode...', 2000);
      return;
    }

    // Download-first mode: normal download flow
    this.downloadQueue.addEpisodes(selected);
    this.state = 'downloading';
    this.render();

    try {
      await this.downloadQueue.start(this.webtoonInfo);
    } catch (error) {
      console.error('[WebtoonArchiveModal] Download error:', error);
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : 'Download failed';
      this.render();
    }
  }

  /**
   * Handle markdown-created event from download queue (stream-first mode)
   * Closes modal, refreshes timeline, and opens fullscreen with streaming
   */
  private async handleMarkdownCreated(
    filePath: string,
    imageUrls: string[],
    platform: 'naver-webtoon' | 'webtoons',
    seriesInfo: {
      titleId: number;
      titleName: string;
      thumbnailUrl?: string;
      communityArtists?: Array<{ name: string }>;
    },
    episodeDetail: {
      no: number;
      titleId: number;
      subtitle: string;
      imageUrls: string[];
    }
  ): Promise<void> {
    try {
      // Close the modal since we're opening fullscreen
      this.close();

      // Get TimelineView
      const timelineLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)[0];
      if (!timelineLeaf) {
        new Notice('Timeline view not found. Opening episode...');
        return;
      }

      const timelineView = timelineLeaf.view as TimelineView;

      // Trigger timeline refresh to pick up the new markdown
      await timelineView.refresh();

      // Small delay to ensure the refresh completes and card renders
      await new Promise(resolve => setTimeout(resolve, 300));

      // Open fullscreen with streaming URLs
      await timelineView.openStreamingFullscreen(
        {
          seriesId: String(seriesInfo.titleId),
          seriesTitle: seriesInfo.titleName,
          author: seriesInfo.communityArtists?.[0]?.name || 'Unknown',
          platform: platform,
          thumbnailUrl: seriesInfo.thumbnailUrl,
        },
        {
          titleId: episodeDetail.titleId,
          no: episodeDetail.no,
          subtitle: episodeDetail.subtitle,
          imageUrls: imageUrls,
        },
        episodeDetail.subtitle
      );

      new Notice('Downloading images in background...', 3000);

    } catch (error) {
      console.error('[WebtoonArchiveModal] Failed to open streaming fullscreen:', error);
      new Notice(`Failed to open viewer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Refresh timeline to pick up new episode without closing fullscreen
   * Called when subsequent episodes are downloaded in background during stream-first mode
   */
  private async refreshTimelineForNewEpisode(episodeNo: number): Promise<void> {
    try {
      const timelineLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)[0];
      if (!timelineLeaf) return;

      const timelineView = timelineLeaf.view as TimelineView;

      // Delay to ensure file is fully written and vault has registered it
      // 500ms gives Obsidian's MetadataCache time to process the new file
      await new Promise(resolve => setTimeout(resolve, 500));

      // Use soft refresh that updates data without disrupting fullscreen
      await timelineView.softRefresh();

      // Brief notification
      new Notice(`Episode ${episodeNo} added`, 1500);
    } catch (error) {
      console.error('[WebtoonArchiveModal] Failed to refresh timeline for new episode:', error);
    }
  }

  /**
   * Start WEBTOON Global episode download
   */
  private async startWebtoonsDownload(isStreamFirst: boolean = false): Promise<void> {
    if (!this.webtoonsUrlInfo || !this.webtoonsSeriesInfo) {
      new Notice('Series info not loaded. Please try again.');
      return;
    }

    // Build episode jobs from selected episodes
    const selected: WebtoonsEpisodeJob[] = Array.from(this.selectedEpisodeNos).map(no => {
      const ep = this.webtoonsEpisodes.find(e => e.episode.episodeNo === no)?.episode;
      return {
        episodeNo: no,
        title: ep?.title || `Episode ${no}`,
        thumbnailUrl: ep?.thumbnailUrls?.[0],
        pubDate: ep?.pubDate,
        status: 'pending' as const,
      };
    });

    // Stream-first mode: create markdown first, then open fullscreen with streaming
    // The markdown-created event will trigger opening the real card in fullscreen
    if (isStreamFirst && selected.length > 0) {
      // Reset flag - only first episode opens fullscreen, rest download in background
      this.streamFirstHandled = false;

      this.webtoonsDownloadQueue.addEpisodes(selected);

      // Start download with streamFirst option - markdown will be created first
      // The markdown-created event handler will open fullscreen for first episode only
      void this.webtoonsDownloadQueue.start(
        this.webtoonsUrlInfo,
        this.webtoonsSeriesInfo,
        { streamFirst: true }
      ).catch(error => {
        console.error('[WebtoonArchiveModal] Background download error:', error);
        new Notice(`Background download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      });

      // Show brief notification - fullscreen will open when markdown is ready
      new Notice('Preparing episode...', 2000);
      return;
    }

    // Download-first mode: normal download flow
    this.webtoonsDownloadQueue.addEpisodes(selected);
    this.state = 'downloading';
    this.render();

    try {
      await this.webtoonsDownloadQueue.start(this.webtoonsUrlInfo, this.webtoonsSeriesInfo);
    } catch (error) {
      console.error('[WebtoonArchiveModal] WEBTOON download error:', error);
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : 'Download failed';
      this.render();
    }
  }

  private setupDownloadEvents(): void {
    // Naver Webtoon download queue events
    const updateNaverProgress = () => {
      this.downloadProgress = this.downloadQueue.getProgress();
      this.render();
    };

    this.trackEventListener(this.downloadQueue, 'episode-started', updateNaverProgress as EventListener);
    this.trackEventListener(this.downloadQueue, 'episode-progress', updateNaverProgress as EventListener);
    this.trackEventListener(this.downloadQueue, 'episode-completed', updateNaverProgress as EventListener);

    this.trackEventListener(this.downloadQueue, 'episode-failed', ((e: CustomEvent) => {
      updateNaverProgress();
      new Notice(`Failed: ${e.detail.error}`);
    }) as EventListener);

    this.trackEventListener(this.downloadQueue, 'queue-completed', ((e: CustomEvent) => {
      this.state = 'completed';
      this.downloadProgress = this.downloadQueue.getProgress();
      new Notice(`✓ ${e.detail.completed} episodes archived!`);

      // Invalidate Author Catalog cache to refresh with new cover/data
      invalidateAuthorCatalogCache();

      // Auto-close after brief delay to show success
      setTimeout(() => this.close(), 1200);
    }) as EventListener);

    this.trackEventListener(this.downloadQueue, 'queue-cancelled', (() => {
      this.state = 'ready';
      this.downloadProgress = null;
      this.render();
      new Notice('Download cancelled');
    }) as EventListener);

    // Naver Webtoon: markdown-created event for stream-first mode
    // First episode opens fullscreen, subsequent episodes just update timeline
    this.trackEventListener(this.downloadQueue, 'markdown-created', ((e: CustomEvent) => {
      if (this.streamFirstHandled) {
        // Already handled first episode - just refresh timeline for new episodes
        void this.refreshTimelineForNewEpisode(e.detail.episodeDetail.no);
        return;
      }
      this.streamFirstHandled = true;

      void this.handleMarkdownCreated(
        e.detail.filePath,
        e.detail.imageUrls,
        'naver-webtoon',
        e.detail.webtoonInfo,
        e.detail.episodeDetail
      );
    }) as EventListener);

    // WEBTOON Global download queue events
    const updateWebtoonsProgress = () => {
      this.downloadProgress = this.webtoonsDownloadQueue.getProgress();
      this.render();
    };

    this.trackEventListener(this.webtoonsDownloadQueue, 'episode-started', updateWebtoonsProgress as EventListener);
    this.trackEventListener(this.webtoonsDownloadQueue, 'episode-progress', updateWebtoonsProgress as EventListener);
    this.trackEventListener(this.webtoonsDownloadQueue, 'episode-completed', updateWebtoonsProgress as EventListener);

    this.trackEventListener(this.webtoonsDownloadQueue, 'episode-failed', ((e: CustomEvent) => {
      updateWebtoonsProgress();
      new Notice(`Failed: ${e.detail.error}`);
    }) as EventListener);

    this.trackEventListener(this.webtoonsDownloadQueue, 'queue-completed', ((e: CustomEvent) => {
      this.state = 'completed';
      this.downloadProgress = this.webtoonsDownloadQueue.getProgress();
      new Notice(`✓ ${e.detail.completed} episodes archived!`);

      // Invalidate Author Catalog cache to refresh with new cover/data
      invalidateAuthorCatalogCache();

      // Auto-close after brief delay to show success
      setTimeout(() => this.close(), 1200);
    }) as EventListener);

    this.trackEventListener(this.webtoonsDownloadQueue, 'queue-cancelled', (() => {
      this.state = 'ready';
      this.downloadProgress = null;
      this.render();
      new Notice('Download cancelled');
    }) as EventListener);

    // WEBTOON Global: markdown-created event for stream-first mode
    // Only handle first episode - rest download in background
    this.trackEventListener(this.webtoonsDownloadQueue, 'markdown-created', ((e: CustomEvent) => {
      if (this.streamFirstHandled) {
        // Already handled first episode - just refresh timeline for new episodes
        void this.refreshTimelineForNewEpisode(e.detail.episodeDetail.episodeNo);
        return;
      }
      this.streamFirstHandled = true;

      void this.handleMarkdownCreated(
        e.detail.filePath,
        e.detail.imageUrls,
        'webtoons',
        {
          titleId: parseInt(e.detail.urlInfo.titleNo, 10),
          titleName: e.detail.seriesInfo.title,
          thumbnailUrl: e.detail.seriesInfo.thumbnailUrl,
          communityArtists: [{ name: e.detail.seriesInfo.authorNames || 'Unknown' }],
        },
        {
          no: e.detail.episodeDetail.episodeNo,
          titleId: parseInt(e.detail.urlInfo.titleNo, 10),
          subtitle: e.detail.episodeDetail.title || `Episode ${e.detail.episodeDetail.episodeNo}`,
          imageUrls: e.detail.imageUrls,
        }
      );
    }) as EventListener);
  }

  /**
   * Check if serviceDateDescription indicates a preview schedule
   * Examples: "오늘밤 무료", "3일 후 무료", "14일 후 무료"
   */
  private isPreviewSchedule(description: string): boolean {
    if (!description) return false;
    return description.includes('무료') || description.includes('후');
  }

  /**
   * Render preview episodes banner
   */
  private renderPreviewBanner(container: HTMLElement): void {
    if (this.previewEpisodes.length === 0) return;

    const banner = container.createDiv({ cls: 'webtoon-preview-banner wam-preview-banner' });

    // Calendar icon
    const icon = banner.createSpan({ cls: 'wam-preview-icon' });
    icon.setText('📅');

    // Preview count
    const countSpan = banner.createSpan({ cls: 'wam-preview-count' });
    countSpan.setText(`${this.previewEpisodes.length} previews`);

    // Separator
    banner.createSpan({ text: '·' });

    // Next free episode
    const nextFree = this.previewEpisodes[this.previewEpisodes.length - 1]; // Last one is closest to free
    if (nextFree) {
      const nextSpan = banner.createSpan({ cls: 'wam-preview-next' });
      nextSpan.setText(`Next free: Ep. ${nextFree.no} (${nextFree.freeSchedule})`);
    }
  }
}
