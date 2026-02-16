import { Modal, App, Notice, Setting, Platform, TFile, setIcon } from 'obsidian';
import type SocialArchiverPlugin from '../main';
import type { Platform as PlatformType } from '../types/post';
import type { MediaDownloadMode } from '../types/settings';
import { getVaultOrganizationStrategy } from '../types/settings';
import { isAuthenticated } from '../utils/auth';
import { validateAndDetectPlatform } from '@/schemas/platforms';
import { resolvePinterestUrl } from '@/utils/pinterest';
import { analyzeUrl, type UrlAnalysisResult } from '@/utils/urlAnalysis';
import { ProfileQuickPreview, type QuickPreviewResult, type ExpandedUrlResult } from '@/services/ProfileQuickPreview';
import { NaverCafeLocalService } from '@/services/NaverCafeLocalService';
import { NaverBlogLocalService } from '@/services/NaverBlogLocalService';
import { BrunchLocalService } from '@/services/BrunchLocalService';
import type { BrunchComment } from '@/types/brunch';
import type { FeedDetectionData } from '@/services/WorkersAPIClient';
import {
  RSS_PLATFORMS_FOR_SUBSCRIPTION_MATCH,
  isRssPlatformWithOwnId,
  PROFILE_CRAWL_SUPPORTED_PLATFORMS,
  PROFILE_ARCHIVE_SUPPORTED_PLATFORMS,
  NEW_SUBSCRIPTION_PLATFORMS,
} from '@/constants/rssPlatforms';
import { getAuthorCatalogStore } from '@/services/AuthorCatalogStore';
import {
  CRAWL_LIMITS,
  type ProfileArchiveRequest,
  type ProfileCrawlOptions,
  validateCrawlOptions,
  type CrawlError,
  parseCrawlError,
  type TimeRangePreset,
  TIME_RANGE_LABELS,
  timeRangePresetToDates,
  timeRangePresetToBackfillDays,
  type RedditSortBy,
  type RedditSortByTime,
  REDDIT_SORT_BY_OPTIONS,
  REDDIT_SORT_BY_TIME_OPTIONS,
  isLocalFetchPlatform,
} from '@/types/profile-crawl';
import { detectUserTimezone } from '@/utils/date';
import {
  getPlatformSimpleIcon,
  type PlatformIcon,
} from '@/services/IconService';

/**
 * Archive Modal - Minimal Obsidian Native Style
 * Uses Obsidian's built-in components for native look and feel
 */
export class ArchiveModal extends Modal {
  private plugin: SocialArchiverPlugin;
  private url: string = '';
  private detectedPlatform: PlatformType | null = null;
  private isValidUrl: boolean = false;
  private isPinterestBoard: boolean = false;
  private isBlueskyBridge: boolean = false;
  private isResolving: boolean = false;
  private urlInput!: HTMLInputElement;
  private archiveBtn!: HTMLButtonElement;
  private platformBadge!: HTMLElement;
  private generalOptions!: HTMLElement;
  private youtubeOptions!: HTMLElement;
  private commentContainer!: HTMLElement;
  private videoModeWarningEl: HTMLElement | null = null;

  // General options
  private downloadMedia: MediaDownloadMode = 'images-and-videos'; // Will be set from settings
  private includeComments: boolean = true; // Will be set from settings

  // YouTube options
  private includeTranscript: boolean = true;
  private includeFormattedTranscript: boolean = false;

  // User comment
  private comment: string = '';
  private commentTextarea!: HTMLTextAreaElement;
  private resolvedUrl: string | null = null;
  private validationRequestId = 0;

  // Profile detection state
  private urlAnalysis: UrlAnalysisResult | null = null;
  private quickPreview: QuickPreviewResult | null = null;
  private isLoadingPreview: boolean = false;
  private quickPreviewService: ProfileQuickPreview | null = null;
  private expandedUrlResult: ExpandedUrlResult | null = null;
  private isExpandingUrl: boolean = false;

  // Profile Crawl options
  private postCount: number = CRAWL_LIMITS.DEFAULT_POST_COUNT;
  private timeRangePreset: TimeRangePreset = 'last_3_days';

  // Reddit-specific options
  private redditSortBy: RedditSortBy = 'Hot';
  private redditSortByTime: RedditSortByTime = 'Today';
  private redditKeyword: string = '';
  private redditOptionsContainer!: HTMLElement;

  // Naver cafe member options
  private naverCafeKeyword: string = '';
  private naverCafeOptionsContainer!: HTMLElement;

  // Subscribe options
  private subscribeEnabled: boolean = false;

  // Profile UI containers
  private profileOptionsContainer!: HTMLElement;
  private profilePreviewContainer!: HTMLElement;
  private subscribeOptionsContainer!: HTMLElement;
  private profileActionButtons!: HTMLElement;

  // Shared UI containers
  private disclaimerEl!: HTMLElement;
  private postFooterEl!: HTMLElement;

  // Processing state (prevents double-submit)
  private isProcessing: boolean = false;
  private crawlButton: HTMLButtonElement | null = null;

  // Debounce timer for URL validation
  private urlValidationTimer?: number;
  private subscribeOnlyButton: HTMLButtonElement | null = null;

  // Error state
  private currentError: CrawlError | null = null;
  private errorContainer: HTMLElement | null = null;

  // Input validation error (for unsupported URLs)
  private inputValidationError: string | null = null;

  // Feed detection state (for RSS feeds)
  private feedDetection: FeedDetectionData | null = null;
  private isDetectingFeed: boolean = false;

  // Collapsible sections state (for mobile)
  private isCrawlOptionsCollapsed: boolean = false;
  private isSubscribeOptionsCollapsed: boolean = true;

  constructor(app: App, plugin: SocialArchiverPlugin, initialUrl?: string) {
    super(app);
    this.plugin = plugin;
    // Set defaults from settings
    this.downloadMedia = plugin.settings.downloadMedia;
    this.includeComments = plugin.settings.includeComments;
    if (initialUrl) {
      this.url = initialUrl;
    }

    // Initialize ProfileQuickPreview service
    const workerUrl = plugin.settings.workerUrl;
    if (workerUrl) {
      this.quickPreviewService = new ProfileQuickPreview({ endpoint: workerUrl });
      this.quickPreviewService.initialize().catch(() => {
        // Silently fail - fallback to URL parsing
        this.quickPreviewService = null;
      });
    }
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Add spinner animation styles
    this.addSpinnerAnimation();

    // Clear any previous error state
    this.currentError = null;
    this.errorContainer = null;

    // Add modal class for styling (mobile-responsive)
    modalEl.addClass('social-archiver-modal');

    // ARIA attributes for modal accessibility
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', 'archive-modal-title');

    // Mobile modal size adjustments
    if (Platform.isMobile) {
      // Fill most of screen while keeping Obsidian's native modal style
      modalEl.style.setProperty('width', '92vw', 'important');
      modalEl.style.setProperty('max-width', '92vw', 'important');
      modalEl.style.setProperty('height', 'auto', 'important');
      modalEl.style.setProperty('max-height', '90vh', 'important');
      modalEl.style.setProperty('overflow-y', 'auto', 'important');

      // Reduce contentEl padding on mobile to prevent input overflow
      contentEl.style.paddingLeft = '12px';
      contentEl.style.paddingRight = '12px';
    }

    // Check authentication status
    if (!isAuthenticated(this.plugin)) {
      this.renderUnauthenticatedState(contentEl);
      return;
    }

    // Title with id for ARIA labelledby
    const title = contentEl.createEl('h2', { text: 'Archive Social Post', cls: 'archive-modal-title' });
    title.id = 'archive-modal-title';

    // URL Input (full width, separate line)
    const inputContainer = contentEl.createDiv({ cls: 'archive-url-container' });

    this.urlInput = inputContainer.createEl('input', {
      type: 'text',
      placeholder: 'Paste URL from Facebook, LinkedIn, Instagram, TikTok, X, Threads, YouTube, Reddit, Pinterest, Substack, Tumblr, Mastodon, or Bluesky',
      cls: 'archive-url-input',
      value: this.url
    });

    // ARIA attributes for URL input
    this.urlInput.setAttribute('aria-label', 'Social media URL to archive');
    this.urlInput.setAttribute('aria-describedby', 'platform-badge');
    this.urlInput.setAttribute('autocomplete', 'url');

    // Ensure box-sizing: border-box for proper width calculation
    this.urlInput.style.boxSizing = 'border-box';

    this.urlInput.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      this.url = target.value;

      // Debounce URL validation to avoid validating while user is still typing
      if (this.urlValidationTimer) {
        window.clearTimeout(this.urlValidationTimer);
      }
      this.urlValidationTimer = window.setTimeout(() => {
        void this.validateUrl(target.value);
      }, 400); // 400ms debounce
    });

    // Platform Badge (shown when detected)
    this.platformBadge = contentEl.createDiv({ cls: 'archive-platform-badge' });
    this.platformBadge.id = 'platform-badge';
    this.platformBadge.setAttribute('aria-live', 'polite');

    // General options (shown when URL is detected)
    this.generalOptions = contentEl.createDiv({ cls: 'archive-general-options' });
    this.generalOptions.style.display = 'none';

    new Setting(this.generalOptions)
      .setName('Download media')
      .setDesc('Choose what media to download with this post')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('text-only', 'Text only')
          .addOption('images-only', 'Images only')
          .addOption('images-and-videos', 'Images and videos')
          .setValue(this.downloadMedia)
          .onChange((value: string) => {
            this.downloadMedia = value as MediaDownloadMode;
            this.updateVideoDownloadWarning();
          })
      );

    this.videoModeWarningEl = this.generalOptions.createDiv({ cls: 'archive-video-mode-warning' });
    this.videoModeWarningEl.style.cssText = `
      margin: 2px 0 10px 0;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--background-modifier-border);
      background: var(--background-modifier-warning);
      color: var(--text-warning);
      font-size: 12px;
      line-height: 1.4;
    `;
    this.videoModeWarningEl.setText(
      '⚠️ Video download can fail on some platforms (especially feed/reels style posts). ' +
      'If it fails, the note will include a visible failure status.'
    );
    this.updateVideoDownloadWarning();

    new Setting(this.generalOptions)
      .setName('Include comments')
      .setDesc('Include platform comments in the archived note')
      .addToggle((toggle) =>
        toggle
          .setValue(this.includeComments)
          .onChange((value) => {
            this.includeComments = value;
          })
      );

    // YouTube-specific options (hidden by default)
    this.youtubeOptions = contentEl.createDiv({ cls: 'archive-youtube-options' });
    this.youtubeOptions.style.display = 'none';

    new Setting(this.youtubeOptions)
      .setName('Include transcript')
      .setDesc('Download full transcript text')
      .addToggle((toggle) =>
        toggle
          .setValue(this.includeTranscript)
          .onChange((value) => {
            this.includeTranscript = value;
          })
      );

    new Setting(this.youtubeOptions)
      .setName('Include formatted transcript')
      .setDesc('Add clickable chapter links with timestamps')
      .addToggle((toggle) =>
        toggle
          .setValue(this.includeFormattedTranscript)
          .onChange((value) => {
            this.includeFormattedTranscript = value;
          })
      );

    // Comment section (shown when URL is detected)
    this.commentContainer = contentEl.createDiv({ cls: 'archive-comment-container' });
    this.commentContainer.style.display = 'none';
    this.commentContainer.style.marginTop = '12px';

    const commentLabel = this.commentContainer.createDiv({ cls: 'archive-comment-label' });
    commentLabel.setText('💭 My Notes (optional)');

    this.commentTextarea = this.commentContainer.createEl('textarea', {
      cls: 'archive-comment-textarea',
      placeholder: 'Add your thoughts, tags, or reminders about this post...'
    });
    this.commentTextarea.addEventListener('input', (e) => {
      const target = e.target as HTMLTextAreaElement;
      this.comment = target.value;
    });

    // ============================================================================
    // Profile Options Section (hidden by default, shown for profile URLs)
    // ============================================================================

    // Profile preview container (shows avatar, name, bio)
    this.profilePreviewContainer = contentEl.createDiv({ cls: 'archive-profile-preview' });
    this.profilePreviewContainer.style.display = 'none';

    // Profile crawl options container
    this.profileOptionsContainer = contentEl.createDiv({ cls: 'archive-profile-options' });
    this.profileOptionsContainer.style.display = 'none';

    // Reddit-specific options container (after profile options, before subscribe)
    this.redditOptionsContainer = contentEl.createDiv({ cls: 'archive-reddit-options' });
    this.redditOptionsContainer.style.display = 'none';

    // Naver cafe member options container
    this.naverCafeOptionsContainer = contentEl.createDiv({ cls: 'archive-naver-cafe-options' });
    this.naverCafeOptionsContainer.style.display = 'none';

    // Subscribe options container
    this.subscribeOptionsContainer = contentEl.createDiv({ cls: 'archive-subscribe-options' });
    this.subscribeOptionsContainer.style.display = 'none';

    // Profile action buttons container (separate from post buttons)
    this.profileActionButtons = contentEl.createDiv({ cls: 'archive-profile-actions modal-button-container' });
    this.profileActionButtons.style.display = 'none';

    // Disclaimer (minimal, with Lucide icon)
    this.disclaimerEl = contentEl.createDiv({ cls: 'archive-disclaimer' });
    this.disclaimerEl.style.cssText = `
      display: flex;
      align-items: center;
      gap: var(--size-4-2);
      font-size: var(--font-smallest);
      color: var(--text-faint);
      margin-top: var(--size-4-3);
    `;
    const disclaimerIcon = this.disclaimerEl.createSpan();
    setIcon(disclaimerIcon, 'alert-triangle');
    disclaimerIcon.style.cssText = '--icon-size: var(--icon-xs);';
    this.disclaimerEl.createSpan({ text: 'Archive only content you have permission to save.' });

    // Footer buttons (for post mode)
    this.postFooterEl = contentEl.createDiv({ cls: 'modal-button-container' });

    // On mobile, stack buttons vertically and make them full width
    if (Platform.isMobile) {
      this.postFooterEl.style.flexDirection = 'column';
      this.postFooterEl.style.gap = '12px';
    }

    // Create Archive button first (will be on top on mobile)
    this.archiveBtn = this.postFooterEl.createEl('button', {
      text: 'Archive',
      cls: 'mod-cta',
      attr: { disabled: 'true' }
    });
    this.archiveBtn.addEventListener('click', () => this.handleArchive());

    // Make button full width on mobile
    if (Platform.isMobile) {
      this.archiveBtn.style.width = '100%';
    }

    // Create Cancel button (will be below Archive on mobile)
    const cancelBtn = this.postFooterEl.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    // Make button full width on mobile
    if (Platform.isMobile) {
      cancelBtn.style.width = '100%';
    }

    // Keyboard shortcuts
    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });

    this.scope.register(['Mod'], 'Enter', () => {
      if (this.isValidUrl) {
        // Route to correct handler based on URL type
        if (this.urlAnalysis?.type === 'profile') {
          this.handleProfileCrawl();
        } else {
          this.handleArchive();
        }
      }
      return false;
    });

    // Try to paste from clipboard if no initial URL provided
    if (!this.url) {
      this.tryPasteFromClipboard();
    }

    // Focus input
    setTimeout(() => this.urlInput.focus(), 100);

    // Initial validation if URL provided
    if (this.url) {
      void this.validateUrl(this.url);
    }
  }

  onClose(): void {
    // Clear debounce timer
    if (this.urlValidationTimer) {
      window.clearTimeout(this.urlValidationTimer);
    }
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * Validate URL and detect platform
   * Now includes profile URL detection using analyzeUrl
   */
  private async validateUrl(url: string): Promise<void> {
    const requestId = ++this.validationRequestId;
    this.isValidUrl = false;
    this.detectedPlatform = null;
    this.isPinterestBoard = false;
    this.isBlueskyBridge = false;
    this.resolvedUrl = null;
    this.urlAnalysis = null;
    this.quickPreview = null;
    this.feedDetection = null;
    this.isDetectingFeed = false;
    this.isLoadingPreview = false;
    this.isResolving = true;
    this.inputValidationError = null;
    this.expandedUrlResult = null;
    this.isExpandingUrl = false;
    this.updateUI();

    if (!url || url.trim().length === 0) {
      this.updateUI();
      return;
    }

    try {
      let trimmedUrl = url.trim();

      // Auto-add https:// if missing protocol
      if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
        trimmedUrl = 'https://' + trimmedUrl;
      }

      // First, analyze URL type (post vs profile)
      let analysis = analyzeUrl(trimmedUrl);
      this.urlAnalysis = analysis;

      // Check if this is a Facebook share URL that needs expansion
      // Share URLs have handle like 'share:xxx'
      if (
        analysis.type === 'profile' &&
        analysis.platform === 'facebook' &&
        analysis.handle?.startsWith('share:') &&
        this.quickPreviewService
      ) {
        this.isExpandingUrl = true;
        this.updateUI();

        try {
          const expanded = await this.quickPreviewService.expandShareUrl(trimmedUrl);
          this.expandedUrlResult = expanded;

          if (expanded.wasExpanded) {
            // Update the URL analysis with expanded values
            analysis = {
              ...analysis,
              handle: expanded.handle,
              normalizedUrl: expanded.expandedUrl,
            };
            this.urlAnalysis = analysis;
            // Update trimmedUrl for subsequent operations
            trimmedUrl = expanded.expandedUrl;
          }
        } catch (error) {
          console.warn('[ArchiveModal] Failed to expand share URL:', error);
          // Continue with original URL - server will try to expand
        } finally {
          this.isExpandingUrl = false;
        }

        if (requestId !== this.validationRequestId) {
          return;
        }
      }

      // If unknown or no platform, try legacy validation
      if (analysis.type === 'unknown' || !analysis.platform) {
        const validation = validateAndDetectPlatform(trimmedUrl);
        if (!validation.valid || !validation.platform) {
          // URL validation failed - check if it looks like a search query
          // Use original input (not trimmedUrl which has https:// added)
          const originalInput = url.trim();
          // Require at least 2 characters to avoid triggering during Korean input composition
          if (originalInput && !originalInput.startsWith('http') && originalInput.length >= 2) {
            // Looks like a search query, not a URL - open WebtoonArchiveModal directly
            // Let WebtoonArchiveModal handle the search (avoids double search)
            this.isResolving = false;
            this.close();
            import('./WebtoonArchiveModal').then(({ WebtoonArchiveModal }) => {
              const modal = new WebtoonArchiveModal(this.app, this.plugin, originalInput);
              modal.open();
            });
          } else {
            this.isResolving = false;
            this.updateUI();
          }
          return;
        }
        // Legacy path: treat as post
        this.detectedPlatform = validation.platform;
        this.urlAnalysis = { ...analysis, type: 'post', platform: validation.platform };
      } else {
        this.detectedPlatform = analysis.platform;
      }

      // Redirect Webtoon URLs to specialized modal (both Naver Webtoon and WEBTOON Global)
      if (this.detectedPlatform === 'naver-webtoon' || this.detectedPlatform === 'webtoons') {
        this.isResolving = false;
        this.close();
        // Import and open WebtoonArchiveModal
        import('./WebtoonArchiveModal').then(({ WebtoonArchiveModal }) => {
          const modal = new WebtoonArchiveModal(this.app, this.plugin, trimmedUrl);
          modal.open();
        });
        return;
      }

      // Check for Bluesky bridge URLs (bsky.brid.gy)
      // These are Mastodon URLs that bridge to Bluesky posts
      if (this.detectedPlatform === 'mastodon' && trimmedUrl.includes('bsky.brid.gy')) {
        this.isBlueskyBridge = true;
        this.detectedPlatform = 'bluesky';
        // Update urlAnalysis to reflect the actual platform
        if (this.urlAnalysis) {
          this.urlAnalysis = { ...this.urlAnalysis, platform: 'bluesky' };
        }
      }

      // Check for unsupported profile platforms
      if (analysis.type === 'profile') {
        if (!PROFILE_CRAWL_SUPPORTED_PLATFORMS.includes(analysis.platform as typeof PROFILE_CRAWL_SUPPORTED_PLATFORMS[number])) {
          this.inputValidationError = `Profile crawling for ${this.getPlatformName(analysis.platform ?? '')} is not supported yet. Supported: Instagram, Facebook, X (Twitter), Reddit, TikTok, Pinterest, Bluesky, Mastodon, and YouTube.`;
          // Keep detectedPlatform for display but don't mark as valid
          this.isValidUrl = false;
          this.isResolving = false;
          this.updateUI();
          return;
        }
      }

      // Handle RSS feed URLs - detect podcast vs blog
      if (analysis.type === 'rss') {
        // Try to detect feed type (podcast vs blog) from Workers API
        this.feedDetection = null;
        this.isDetectingFeed = true;
        this.updateUI();

        try {
          const workersClient = this.plugin.workersApiClient;
          const detection = await workersClient.detectFeed(trimmedUrl);

          if (requestId !== this.validationRequestId) {
            return; // User typed something else
          }

          if (detection) {
            this.feedDetection = detection;
            // Update platform based on feed analysis
            this.detectedPlatform = detection.platform;
            if (this.urlAnalysis) {
              this.urlAnalysis = { ...this.urlAnalysis, platform: detection.platform };
            }
          }
        } catch (error) {
          console.warn('[ArchiveModal] Feed detection failed, using URL-based detection:', error);
          // Fallback to URL-based detection (already set from analysis.platform)
        } finally {
          this.isDetectingFeed = false;
        }

        if (requestId !== this.validationRequestId) {
          return;
        }

        // RSS feeds are valid for subscription creation
        this.isValidUrl = true;
        this.isResolving = false;
        this.updateUI();
        return;
      }

      let resolvedUrl = trimmedUrl;
      let isPinterestBoard = false;

      // Pinterest-specific resolution (for posts and boards)
      if (this.detectedPlatform === 'pinterest' && analysis.type !== 'profile') {
        const resolution = await resolvePinterestUrl(trimmedUrl);
        resolvedUrl = resolution.resolvedUrl;
        isPinterestBoard = resolution.isBoard;
      }

      if (requestId !== this.validationRequestId) {
        return;
      }

      this.isValidUrl = true;
      this.isPinterestBoard = this.detectedPlatform === 'pinterest' ? isPinterestBoard : false;
      this.resolvedUrl = resolvedUrl !== trimmedUrl ? resolvedUrl : null;

      // Set Naver-specific defaults (3 posts, last month)
      const isNaverUrl = this.detectedPlatform === 'naver' ||
        trimmedUrl.includes('blog.naver.com') ||
        trimmedUrl.includes('rss.blog.naver.com') ||
        trimmedUrl.includes('cafe.naver.com');
      if (isNaverUrl) {
        this.postCount = 3;
        this.timeRangePreset = 'last_month';
      }

      // If profile URL detected, load quick preview
      if (this.urlAnalysis?.type === 'profile') {
        this.loadQuickPreview(trimmedUrl);
      }

    } catch {
      this.isValidUrl = false;
      this.detectedPlatform = null;
      this.isPinterestBoard = false;
      this.resolvedUrl = null;
      this.urlAnalysis = null;
      this.feedDetection = null;
      this.isDetectingFeed = false;
    } finally {
      this.isResolving = false;
      this.updateUI();
    }
  }

  /**
   * Load quick preview for profile URL
   * Shows avatar, display name, and bio from og:tags
   * For Naver cafe members, uses local API instead of Worker
   */
  private async loadQuickPreview(url: string): Promise<void> {
    const handle = this.urlAnalysis?.handle ?? '';

    // Check if it's a Naver cafe member profile (handle format: "cafe:{cafeId}:{memberKey}")
    if (this.detectedPlatform === 'naver' && handle.startsWith('cafe:')) {
      await this.loadNaverCafeMemberPreview(url, handle);
      return;
    }

    if (!this.quickPreviewService) {
      // No service - use URL-parsed fallback
      this.quickPreview = {
        handle: handle || 'unknown',
        displayName: null,
        avatar: null,
        bio: null,
        profileUrl: url,
        platform: this.detectedPlatform ?? 'facebook',
        source: 'url_parse',
      };
      this.updateUI();
      return;
    }

    this.isLoadingPreview = true;
    this.updateUI();

    try {
      const preview = await this.quickPreviewService.fetchQuickPreview(
        url,
        this.detectedPlatform ?? undefined
      );
      this.quickPreview = preview;
    } catch (error) {
      console.warn('[ArchiveModal] Quick preview failed:', error);
      // Create fallback preview
      this.quickPreview = {
        handle: handle || 'unknown',
        displayName: null,
        avatar: null,
        bio: null,
        profileUrl: url,
        platform: this.detectedPlatform ?? 'facebook',
        source: 'url_parse',
      };
    } finally {
      this.isLoadingPreview = false;
      this.updateUI();
    }
  }

  /**
   * Load preview for Naver cafe member profile using local API
   * This uses NaverCafeLocalService to fetch member profile directly with cookies
   */
  private async loadNaverCafeMemberPreview(url: string, handle: string): Promise<void> {
    this.isLoadingPreview = true;
    this.updateUI();

    try {
      // Parse handle: "cafe:{cafeId}:{memberKey}"
      const parts = handle.split(':');
      const cafeId = parts[1];
      const memberKey = parts[2];

      if (!cafeId || !memberKey) {
        throw new Error('Invalid cafe member handle format');
      }

      // Check if Naver cookie is available
      const cookie = this.plugin.settings.naverCookie;
      if (!cookie) {
        console.warn('[ArchiveModal] No Naver cookie set for cafe member preview');
        // Fallback without API call - don't show memberKey
        this.quickPreview = {
          handle: '',  // Don't show memberKey
          displayName: null,
          avatar: null,
          bio: 'Naver cafe member (쿠키 필요)',
          profileUrl: url,
          platform: 'naver',
          source: 'url_parse',
        };
        return;
      }

      // Fetch member profile using local service
      const service = new NaverCafeLocalService(cookie);
      const profile = await service.fetchMemberProfile(cafeId, memberKey);

      if (profile) {
        // Display name: nickname (required)
        const displayName = profile.nickname || null;
        // Handle: show cafe name instead of memberKey (cleaner UX)
        const handleText = profile.cafeName || null;

        this.quickPreview = {
          handle: handleText || '',  // Cafe name as handle, empty if not available
          displayName,
          avatar: profile.avatar || profile.cafeImageUrl || null,
          bio: profile.grade || null,  // Use grade as bio (e.g., "매니저")
          profileUrl: url,
          platform: 'naver',
          source: 'og_tags',  // Mark as API-fetched
        };

      } else {
        // API call succeeded but no profile data - hide handle entirely
        this.quickPreview = {
          handle: '',  // Don't show memberKey
          displayName: null,
          avatar: null,
          bio: 'Naver cafe member',
          profileUrl: url,
          platform: 'naver',
          source: 'url_parse',
        };
      }
    } catch (error) {
      console.warn('[ArchiveModal] Naver cafe member preview failed:', error);
      // Fallback preview - don't show memberKey
      this.quickPreview = {
        handle: '',  // Don't show memberKey
        displayName: null,
        avatar: null,
        bio: 'Naver cafe member',
        profileUrl: url,
        platform: 'naver',
        source: 'url_parse',
      };
    } finally {
      this.isLoadingPreview = false;
      this.updateUI();
    }
  }

  /**
   * Update UI based on detected platform
   * Branches between post UI and profile UI
   */
  private updateUI(): void {
    const isProfile = this.urlAnalysis?.type === 'profile';
    const isRss = this.urlAnalysis?.type === 'rss';

    // Update platform badge
    if (this.isResolving) {
      this.platformBadge.setText('Detecting link…');
      this.platformBadge.style.color = 'var(--text-muted)';
      this.platformBadge.style.display = 'block';
    } else if (this.inputValidationError) {
      // Show error for unsupported URLs
      this.platformBadge.setText(`⚠ ${this.inputValidationError}`);
      this.platformBadge.style.color = 'var(--text-error)';
      this.platformBadge.style.display = 'block';
    } else if (isRss && this.isDetectingFeed) {
      // Feed type detection in progress
      this.platformBadge.setText('Detecting feed type…');
      this.platformBadge.style.color = 'var(--text-muted)';
      this.platformBadge.style.display = 'block';
    } else if (isRss && this.detectedPlatform) {
      // RSS feed detected - show platform from feed analysis or URL
      let platformName: string;
      if (this.feedDetection) {
        // Use detected platform from feed content analysis
        platformName = this.detectedPlatform === 'podcast' ? 'Podcast' : this.getPlatformName(this.detectedPlatform);
      } else {
        // Fallback to URL-based detection
        platformName = this.detectedPlatform === 'blog'
          ? this.getRSSPlatformName(this.urlAnalysis?.feedUrl ?? this.url)
          : this.getPlatformName(this.detectedPlatform);
      }

      // Include feed title if available
      const feedTitle = this.feedDetection?.feedTitle;
      if (feedTitle) {
        const truncatedTitle = feedTitle.length > 30 ? feedTitle.substring(0, 30) + '…' : feedTitle;
        this.platformBadge.setText(`✓ ${platformName}: ${truncatedTitle}`);
      } else {
        this.platformBadge.setText(`✓ ${platformName} feed detected`);
      }
      this.platformBadge.style.color = 'var(--text-muted)';
      this.platformBadge.style.display = 'block';
    } else if (this.detectedPlatform) {
      this.platformBadge.style.color = 'var(--text-muted)';
      if (isProfile) {
        const handle = this.urlAnalysis?.handle ?? '';
        // Reddit subreddit uses different wording
        if (this.detectedPlatform === 'reddit' && this.url.includes('/r/')) {
          this.platformBadge.setText(`✓ Reddit subreddit detected${handle ? ` (r/${handle})` : ''}`);
        } else if (this.detectedPlatform === 'naver' && handle.startsWith('cafe:')) {
          // Naver cafe member - show cleaner message
          const displayName = this.quickPreview?.displayName;
          if (displayName) {
            this.platformBadge.setText(`✓ Naver cafe member detected`);
          } else {
            this.platformBadge.setText(`✓ Naver cafe member detected`);
          }
        } else {
          this.platformBadge.setText(`✓ ${this.getPlatformName(this.detectedPlatform)} profile detected${handle ? ` (@${handle})` : ''}`);
        }
      } else if (this.detectedPlatform === 'pinterest' && this.isPinterestBoard) {
        this.platformBadge.setText('✓ Pinterest board detected (captures all pins)');
      } else if (this.isBlueskyBridge) {
        this.platformBadge.setText('✓ Bluesky detected (via Mastodon bridge)');
      } else {
        this.platformBadge.setText(`✓ ${this.getPlatformName(this.detectedPlatform)} detected`);
      }
      this.platformBadge.style.display = 'block';
    } else {
      this.platformBadge.style.display = 'none';
    }

    // Branch between Post UI and Profile/RSS UI
    if ((isProfile || isRss) && this.isValidUrl && !this.isResolving) {
      // Hide post-specific options
      this.generalOptions.style.display = 'none';
      this.youtubeOptions.style.display = 'none';
      this.commentContainer.style.display = 'none';
      this.postFooterEl.style.display = 'none';
      this.disclaimerEl.style.display = 'none';

      // Show profile/RSS subscription options
      this.showProfileUI();
    } else {
      // Hide profile options
      this.profilePreviewContainer.style.display = 'none';
      this.profileOptionsContainer.style.display = 'none';
      this.subscribeOptionsContainer.style.display = 'none';
      this.profileActionButtons.style.display = 'none';

      // Show post-specific options (existing behavior)
      if (this.isValidUrl && !this.isResolving && this.detectedPlatform !== 'youtube' && this.detectedPlatform !== 'tiktok') {
        this.generalOptions.style.display = 'block';
      } else {
        this.generalOptions.style.display = 'none';
      }

      if (this.detectedPlatform === 'youtube') {
        this.youtubeOptions.style.display = 'block';
      } else {
        this.youtubeOptions.style.display = 'none';
      }

      if (this.isValidUrl && !this.isResolving) {
        this.commentContainer.style.display = 'block';
        this.postFooterEl.style.display = 'flex';
        this.disclaimerEl.style.display = 'flex';
      } else {
        this.commentContainer.style.display = 'none';
        this.postFooterEl.style.display = 'none';
        this.disclaimerEl.style.display = 'none';
      }

      // Update archive button
      this.updateArchiveButton();
    }

    this.updateVideoDownloadWarning();
  }

  private updateVideoDownloadWarning(): void {
    if (!this.videoModeWarningEl) return;
    this.videoModeWarningEl.style.display = this.downloadMedia === 'images-and-videos' ? 'block' : 'none';
  }

  /**
   * Show profile-specific UI
   */
  private showProfileUI(): void {
    const isRss = this.urlAnalysis?.type === 'rss';

    // Build profile preview (for profiles, not RSS)
    if (!isRss) {
      this.buildProfilePreview();
    } else {
      // Hide profile preview for RSS
      this.profilePreviewContainer.style.display = 'none';
    }

    // Build crawl options
    if (!isRss) {
      this.buildProfileOptions();
      // Build Reddit-specific options (only shown for Reddit)
      this.buildRedditOptions();
      // Build Naver options (for both Blog and Cafe)
      this.renderNaverCafeOptions();
    } else {
      // Build RSS-specific options (simpler - just post count)
      this.buildRSSOptions();
      // Build Naver options for RSS-based Naver Blog
      this.renderNaverCafeOptions();
    }

    // Build subscribe options (for both profiles and RSS)
    this.buildSubscribeOptions();

    // Build action buttons
    this.buildProfileActionButtons();
  }

  /**
   * Build profile preview section
   */
  private buildProfilePreview(): void {
    this.profilePreviewContainer.empty();
    this.profilePreviewContainer.style.display = 'block';

    if (this.isLoadingPreview) {
      // Minimal loading state
      const loading = this.profilePreviewContainer.createDiv({ cls: 'profile-preview-loading' });
      loading.style.cssText = `
        display: flex;
        align-items: center;
        gap: var(--size-4-3);
        padding: var(--size-4-3) 0;
      `;

      const avatarSkeleton = loading.createDiv();
      avatarSkeleton.style.cssText = `
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--background-modifier-border);
      `;

      const textSkeleton = loading.createDiv();
      textSkeleton.style.cssText = `
        width: 120px;
        height: 14px;
        background: var(--background-modifier-border);
        border-radius: var(--radius-s);
      `;
      return;
    }

    // Minimal profile row
    const preview = this.profilePreviewContainer.createDiv({ cls: 'profile-preview' });
    preview.style.cssText = `
      display: flex;
      align-items: center;
      gap: var(--size-4-3);
      padding: var(--size-4-3) 0;
    `;

    // Avatar (40px, minimal)
    const avatarContainer = preview.createDiv({ cls: 'profile-avatar' });
    if (this.quickPreview?.avatar) {
      const img = avatarContainer.createEl('img', {
        attr: { src: this.quickPreview.avatar, alt: '' }
      });
      img.style.cssText = `
        width: 40px;
        height: 40px;
        border-radius: 50%;
        object-fit: cover;
      `;
    } else {
      // Use platform icon as placeholder
      const platformIcon = this.detectedPlatform ? getPlatformSimpleIcon(this.detectedPlatform) : null;
      const placeholder = avatarContainer.createDiv();
      placeholder.style.cssText = `
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: ${platformIcon ? `#${platformIcon.hex}` : 'var(--background-modifier-border)'};
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-faint);
      `;
      if (platformIcon) {
        const svg = placeholder.createSvg('svg', {
          attr: {
            viewBox: '0 0 24 24',
            width: '20',
            height: '20',
            fill: 'white',
          }
        });
        svg.createSvg('path', { attr: { d: platformIcon.path } });
      } else {
        placeholder.setText('👤');
      }
    }

    // Name + handle only (no bio, minimal)
    const info = preview.createDiv({ cls: 'profile-info' });

    // Get display name, but filter out platform names like "x.com", "instagram.com"
    const rawDisplayName = this.quickPreview?.displayName;
    const platformNames = ['x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com'];
    const isValidDisplayName = rawDisplayName && !platformNames.some(p => rawDisplayName.toLowerCase().includes(p));
    const finalDisplayName = isValidDisplayName ? rawDisplayName : (this.urlAnalysis?.handle ?? 'Unknown');

    const displayName = info.createDiv({ cls: 'profile-name' });
    displayName.setText(finalDisplayName);
    displayName.style.cssText = `
      font-size: var(--font-ui-small);
      font-weight: var(--font-semibold);
      color: var(--text-normal);
      line-height: 1.3;
    `;

    // Handle display - hide if empty, show without @ for cafe names
    const handleText = this.quickPreview?.handle ?? this.urlAnalysis?.handle ?? '';
    if (handleText) {
      const handle = info.createDiv({ cls: 'profile-handle' });
      // For Naver cafe members, handle contains cafe name (no @ prefix)
      const isNaverCafeMember = this.detectedPlatform === 'naver' &&
        (this.urlAnalysis?.handle ?? '').startsWith('cafe:');
      handle.setText(isNaverCafeMember ? handleText : `@${handleText}`);
      handle.style.cssText = `
        font-size: var(--font-ui-smaller);
        color: var(--text-muted);
      `;
    }
  }

  /**
   * Build profile crawl options section
   * Clean, minimal UI with number input + time range dropdown
   */
  private buildProfileOptions(): void {
    this.profileOptionsContainer.empty();
    this.profileOptionsContainer.style.display = 'block';

    // Content container
    const contentContainer = this.profileOptionsContainer;

    // Store reference for hint element
    let hintEl: HTMLElement | null = null;

    if (Platform.isMobile) {
      // Mobile: Compact custom layout matching Obsidian's design system
      contentContainer.style.cssText = 'display: flex; flex-direction: column; gap: 14px; margin-top: 4px;';

      // Shared input styles (compact)
      const inputStyle = `
        height: 28px;
        padding: 0 8px;
        border-radius: var(--input-radius);
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-form-field);
        color: var(--text-normal);
        font-size: var(--font-ui-smaller);
        -webkit-appearance: none;
      `;

      const labelStyle = 'font-size: var(--font-ui-small); color: var(--text-normal); flex-shrink: 0;';
      const rowStyle = 'display: flex; align-items: center; justify-content: space-between; gap: 12px;';

      // Row 1: Number of posts
      const postCountRow = contentContainer.createDiv();
      postCountRow.style.cssText = rowStyle;

      // Determine max post count based on platform
      // YouTube: 15 (RSS limit), Local fetch platforms (Naver/Brunch): 100 (no API cost), Others: 20
      const maxPostCount = this.detectedPlatform === 'youtube'
        ? CRAWL_LIMITS.MAX_POST_COUNT_YOUTUBE
        : isLocalFetchPlatform(this.detectedPlatform ?? '')
          ? CRAWL_LIMITS.MAX_POST_COUNT_LOCAL
          : CRAWL_LIMITS.MAX_POST_COUNT;

      const postCountLabel = postCountRow.createEl('label', { text: `Number of posts (max ${maxPostCount})` });
      postCountLabel.style.cssText = labelStyle;

      // Adjust post count if exceeds platform limit
      if (this.postCount > maxPostCount) {
        this.postCount = maxPostCount;
      }

      const postCountInput = postCountRow.createEl('input', {
        type: 'number',
        value: String(this.postCount),
      });
      postCountInput.min = String(CRAWL_LIMITS.MIN_POST_COUNT);
      postCountInput.max = String(maxPostCount);
      postCountInput.style.cssText = inputStyle + 'width: 80px; text-align: center;';
      postCountInput.addEventListener('input', (e) => {
        const input = e.target as HTMLInputElement;
        const num = parseInt(input.value, 10);
        if (!isNaN(num)) {
          if (num > maxPostCount) {
            this.postCount = maxPostCount;
            input.value = String(maxPostCount);
            const limitReason = this.detectedPlatform === 'youtube' ? ' (YouTube RSS limit)' : '';
            new Notice(`Maximum ${maxPostCount} posts allowed per crawl${limitReason}`);
          } else if (num < CRAWL_LIMITS.MIN_POST_COUNT) {
            this.postCount = CRAWL_LIMITS.MIN_POST_COUNT;
            input.value = String(CRAWL_LIMITS.MIN_POST_COUNT);
          } else {
            this.postCount = num;
          }
          this.updateCrawlHintMobile(hintEl);
        }
      });

      // Row 2: Time range (not shown for Reddit - uses Reddit-specific options instead)
      const isRedditProfile = this.detectedPlatform === 'reddit' &&
        (this.url.includes('/r/') || this.url.includes('/user/') || this.url.includes('/u/'));
      if (!isRedditProfile) {
        const timeRangeRow = contentContainer.createDiv();
        timeRangeRow.style.cssText = rowStyle;

        const timeRangeLabel = timeRangeRow.createEl('label', { text: 'Time range' });
        timeRangeLabel.style.cssText = labelStyle;

        const timeRangeSelect = timeRangeRow.createEl('select');
        timeRangeSelect.style.cssText = inputStyle + 'min-width: 130px; padding-right: 24px;';
        for (const [value, label] of Object.entries(TIME_RANGE_LABELS)) {
          const option = timeRangeSelect.createEl('option', { value, text: label });
          if (value === this.timeRangePreset) option.selected = true;
        }
        timeRangeSelect.addEventListener('change', (e) => {
          this.timeRangePreset = (e.target as HTMLSelectElement).value as TimeRangePreset;
          this.updateCrawlHintMobile(hintEl);
        });

        // Hint row (for large crawls)
        hintEl = contentContainer.createDiv();
        hintEl.style.cssText = 'font-size: var(--font-ui-smaller); color: var(--text-warning); display: none; margin-top: -8px;';
        this.updateCrawlHintMobile(hintEl);
      }

    } else {
      // Desktop: Use standard Setting class
      let timeRangeSetting: Setting | null = null;
      const isRedditProfile = this.detectedPlatform === 'reddit' &&
        (this.url.includes('/r/') || this.url.includes('/user/') || this.url.includes('/u/'));

      // Determine max post count based on platform
      // YouTube: 15 (RSS limit), Local fetch platforms (Naver/Brunch): 100 (no API cost), Others: 20
      const maxPostCountDesktop = this.detectedPlatform === 'youtube'
        ? CRAWL_LIMITS.MAX_POST_COUNT_YOUTUBE
        : isLocalFetchPlatform(this.detectedPlatform ?? '')
          ? CRAWL_LIMITS.MAX_POST_COUNT_LOCAL
          : CRAWL_LIMITS.MAX_POST_COUNT;

      // Adjust post count if exceeds platform limit
      if (this.postCount > maxPostCountDesktop) {
        this.postCount = maxPostCountDesktop;
      }

      new Setting(contentContainer)
        .setName(`Number of posts (max ${maxPostCountDesktop})`)
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = String(CRAWL_LIMITS.MIN_POST_COUNT);
          text.inputEl.max = String(maxPostCountDesktop);
          text.inputEl.style.width = '70px';
          text.inputEl.style.textAlign = 'center';
          text
            .setPlaceholder(String(CRAWL_LIMITS.DEFAULT_POST_COUNT))
            .setValue(String(this.postCount))
            .onChange((value) => {
              const num = parseInt(value, 10);
              if (!isNaN(num)) {
                if (num > maxPostCountDesktop) {
                  this.postCount = maxPostCountDesktop;
                  text.setValue(String(maxPostCountDesktop));
                  const limitReason = this.detectedPlatform === 'youtube' ? ' (YouTube RSS limit)' : '';
                  new Notice(`Maximum ${maxPostCountDesktop} posts allowed per crawl${limitReason}`);
                } else if (num < CRAWL_LIMITS.MIN_POST_COUNT) {
                  this.postCount = CRAWL_LIMITS.MIN_POST_COUNT;
                  text.setValue(String(CRAWL_LIMITS.MIN_POST_COUNT));
                } else {
                  this.postCount = num;
                }
                if (timeRangeSetting) {
                  this.updateCrawlHint(timeRangeSetting);
                }
              }
            });
        });

      // Time range setting (not shown for Reddit - uses Reddit-specific options instead)
      if (!isRedditProfile) {
        timeRangeSetting = new Setting(contentContainer)
          .setName('Time range')
          .addDropdown((dropdown) => {
            for (const [value, label] of Object.entries(TIME_RANGE_LABELS)) {
              dropdown.addOption(value, label);
            }
            return dropdown
              .setValue(this.timeRangePreset)
              .onChange((value: string) => {
                this.timeRangePreset = value as TimeRangePreset;
                this.updateCrawlHint(timeRangeSetting!);
              });
          });

        this.updateCrawlHint(timeRangeSetting);
      }
    }
  }

  /**
   * Update crawl hint for mobile layout
   */
  private updateCrawlHintMobile(hintEl: HTMLElement | null): void {
    if (!hintEl) return;

    const isLargeCrawl = this.postCount > 30 ||
      ['last_month', 'last_3_months'].includes(this.timeRangePreset);

    if (isLargeCrawl) {
      hintEl.style.display = 'flex';
      hintEl.style.alignItems = 'center';
      hintEl.style.gap = '4px';
      hintEl.empty();
      const iconEl = hintEl.createSpan();
      iconEl.style.cssText = '--icon-size: 14px; display: flex;';
      setIcon(iconEl, 'clock');
      hintEl.createSpan({ text: 'May take a few minutes' });
    } else {
      hintEl.style.display = 'none';
    }
  }

  /**
   * Update crawl hint in Time range setting description
   */
  private updateCrawlHint(setting: Setting): void {
    // Show hint only for large crawls: > 30 posts or 1 month+
    const isLargeCrawl = this.postCount > 30 ||
      ['last_month', 'last_3_months'].includes(this.timeRangePreset);

    const descEl = setting.descEl;
    descEl.empty();

    if (isLargeCrawl) {
      descEl.style.cssText = 'display: flex; align-items: center; gap: 4px; color: var(--text-warning);';
      const iconEl = descEl.createSpan();
      iconEl.style.cssText = '--icon-size: 14px; display: flex;';
      setIcon(iconEl, 'clock');
      descEl.createSpan({ text: 'May take a few minutes' });
    } else {
      descEl.style.cssText = '';
    }
  }

  /**
   * Build RSS-specific options section
   * Simpler than profile options - just post count
   */
  private buildRSSOptions(): void {
    this.profileOptionsContainer.empty();
    this.profileOptionsContainer.style.display = 'block';

    const contentContainer = this.profileOptionsContainer;

    // Determine max post count based on platform
    // Local fetch platforms (Naver): 100 (no API cost), Others: 50 (typical RSS feed limit)
    const maxPostCount = isLocalFetchPlatform(this.detectedPlatform ?? '')
      ? CRAWL_LIMITS.MAX_POST_COUNT_LOCAL
      : 50;

    // Adjust post count if exceeds limit
    if (this.postCount > maxPostCount) {
      this.postCount = maxPostCount;
    }

    if (Platform.isMobile) {
      // Mobile: Compact custom layout
      contentContainer.style.cssText = 'display: flex; flex-direction: column; gap: 14px; margin-top: 4px;';

      const inputStyle = `
        height: 28px;
        padding: 0 8px;
        border-radius: var(--input-radius);
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-form-field);
        color: var(--text-normal);
        font-size: var(--font-ui-smaller);
        -webkit-appearance: none;
      `;

      const labelStyle = 'font-size: var(--font-ui-small); color: var(--text-normal); flex-shrink: 0;';
      const rowStyle = 'display: flex; align-items: center; justify-content: space-between; gap: 12px;';

      // Row: Number of posts
      const postCountRow = contentContainer.createDiv();
      postCountRow.style.cssText = rowStyle;

      const postCountLabel = postCountRow.createEl('label', { text: `Number of posts (max ${maxPostCount})` });
      postCountLabel.style.cssText = labelStyle;

      const postCountInput = postCountRow.createEl('input', {
        type: 'number',
        value: String(this.postCount),
      });
      postCountInput.min = String(CRAWL_LIMITS.MIN_POST_COUNT);
      postCountInput.max = String(maxPostCount);
      postCountInput.style.cssText = inputStyle + 'width: 80px; text-align: center;';
      const isLocalPlatform = isLocalFetchPlatform(this.detectedPlatform ?? '');
      postCountInput.addEventListener('input', (e) => {
        const input = e.target as HTMLInputElement;
        const num = parseInt(input.value, 10);
        if (!isNaN(num)) {
          if (num > maxPostCount) {
            this.postCount = maxPostCount;
            input.value = String(maxPostCount);
            new Notice(`Maximum ${maxPostCount} posts allowed per crawl`);
          } else if (num < CRAWL_LIMITS.MIN_POST_COUNT) {
            this.postCount = CRAWL_LIMITS.MIN_POST_COUNT;
            input.value = String(CRAWL_LIMITS.MIN_POST_COUNT);
          } else {
            this.postCount = num;
          }
        }
      });

      // Hint row
      const hintEl = contentContainer.createDiv();
      hintEl.style.cssText = 'font-size: var(--font-ui-smaller); color: var(--text-muted); margin-top: -8px;';
      hintEl.setText(isLocalPlatform ? 'Fetch posts directly from the blog' : 'RSS feeds typically return the latest posts');

    } else {
      // Desktop: Use standard Setting class
      const isLocalPlatformDesktop = isLocalFetchPlatform(this.detectedPlatform ?? '');
      new Setting(contentContainer)
        .setName(`Number of posts (max ${maxPostCount})`)
        .setDesc(isLocalPlatformDesktop ? 'Fetch posts directly from the blog' : 'RSS feeds typically return the latest posts')
        .addText((text) => {
          text.inputEl.type = 'number';
          text.inputEl.min = String(CRAWL_LIMITS.MIN_POST_COUNT);
          text.inputEl.max = String(maxPostCount);
          text.inputEl.style.width = '70px';
          text.inputEl.style.textAlign = 'center';
          text.setValue(String(this.postCount));
          text.onChange((value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num)) {
              if (num > maxPostCount) {
                this.postCount = maxPostCount;
                text.setValue(String(maxPostCount));
                new Notice(`Maximum ${maxPostCount} posts allowed per crawl`);
              } else if (num < CRAWL_LIMITS.MIN_POST_COUNT) {
                this.postCount = CRAWL_LIMITS.MIN_POST_COUNT;
                text.setValue(String(CRAWL_LIMITS.MIN_POST_COUNT));
              } else {
                this.postCount = num;
              }
            }
          });
        });
    }
  }

  /**
   * Build Reddit-specific options section
   * Only shown when platform is 'reddit' for subreddits or user profiles
   */
  private buildRedditOptions(): void {
    this.redditOptionsContainer.empty();

    // Show for Reddit subreddits (/r/) and user profiles (/user/, /u/)
    const isRedditSubreddit = this.detectedPlatform === 'reddit' && this.url.includes('/r/');
    const isRedditUserProfile = this.detectedPlatform === 'reddit' &&
      (this.url.includes('/user/') || this.url.includes('/u/'));

    if (!isRedditSubreddit && !isRedditUserProfile) {
      this.redditOptionsContainer.style.display = 'none';
      return;
    }

    this.redditOptionsContainer.style.display = 'block';
    this.redditOptionsContainer.style.marginTop = '14px';

    const inputStyle = `
      height: 28px;
      padding: 0 8px;
      border-radius: var(--input-radius);
      border: 1px solid var(--background-modifier-border);
      background: var(--background-modifier-form-field);
      color: var(--text-normal);
      font-size: var(--font-ui-smaller);
      -webkit-appearance: none;
    `;
    const labelStyle = 'font-size: var(--font-ui-small); color: var(--text-normal); flex-shrink: 0;';
    const rowStyle = 'display: flex; align-items: center; justify-content: space-between; gap: 12px;';

    if (Platform.isMobile) {
      // Mobile: Compact custom layout
      this.redditOptionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 14px;';

      // Row 1: Sort by
      const sortByRow = this.redditOptionsContainer.createDiv();
      sortByRow.style.cssText = rowStyle;

      const sortByLabel = sortByRow.createEl('label', { text: 'Sort by' });
      sortByLabel.style.cssText = labelStyle;

      const sortBySelect = sortByRow.createEl('select');
      sortBySelect.style.cssText = inputStyle + 'min-width: 100px; padding-right: 24px;';
      for (const opt of REDDIT_SORT_BY_OPTIONS) {
        const option = sortBySelect.createEl('option', { value: opt.value, text: opt.label });
        if (opt.value === this.redditSortBy) option.selected = true;
      }
      sortBySelect.addEventListener('change', (e) => {
        this.redditSortBy = (e.target as HTMLSelectElement).value as RedditSortBy;
      });

      // Row 2: Time range
      const timeRangeRow = this.redditOptionsContainer.createDiv();
      timeRangeRow.style.cssText = rowStyle;

      const timeRangeLabel = timeRangeRow.createEl('label', { text: 'Time range' });
      timeRangeLabel.style.cssText = labelStyle;

      const timeRangeSelect = timeRangeRow.createEl('select');
      timeRangeSelect.style.cssText = inputStyle + 'min-width: 120px; padding-right: 24px;';
      for (const opt of REDDIT_SORT_BY_TIME_OPTIONS) {
        const option = timeRangeSelect.createEl('option', { value: opt.value, text: opt.label });
        if (opt.value === this.redditSortByTime) option.selected = true;
      }
      timeRangeSelect.addEventListener('change', (e) => {
        this.redditSortByTime = (e.target as HTMLSelectElement).value as RedditSortByTime;
      });

      // Row 3: Keyword (optional)
      const keywordRow = this.redditOptionsContainer.createDiv();
      keywordRow.style.cssText = rowStyle;

      const keywordLabel = keywordRow.createEl('label', { text: 'Keyword filter' });
      keywordLabel.style.cssText = labelStyle;

      const keywordInput = keywordRow.createEl('input', {
        type: 'text',
        placeholder: 'Optional',
        value: this.redditKeyword,
      });
      keywordInput.style.cssText = inputStyle + 'flex: 1; min-width: 80px;';
      keywordInput.addEventListener('input', (e) => {
        this.redditKeyword = (e.target as HTMLInputElement).value;
      });

    } else {
      // Desktop: Use Setting class
      new Setting(this.redditOptionsContainer)
        .setName('Sort by')
        .setDesc('How to sort posts')
        .addDropdown(dropdown => {
          for (const opt of REDDIT_SORT_BY_OPTIONS) {
            dropdown.addOption(opt.value, opt.label);
          }
          dropdown.setValue(this.redditSortBy);
          dropdown.onChange(value => {
            this.redditSortBy = value as RedditSortBy;
          });
        });

      new Setting(this.redditOptionsContainer)
        .setName('Time range')
        .setDesc('Time period for sorting (applies to Hot and Top)')
        .addDropdown(dropdown => {
          for (const opt of REDDIT_SORT_BY_TIME_OPTIONS) {
            dropdown.addOption(opt.value, opt.label);
          }
          dropdown.setValue(this.redditSortByTime);
          dropdown.onChange(value => {
            this.redditSortByTime = value as RedditSortByTime;
          });
        });

      new Setting(this.redditOptionsContainer)
        .setName('Keyword filter')
        .setDesc('Optional: Filter posts by keyword')
        .addText(text => {
          text
            .setPlaceholder('Optional keyword')
            .setValue(this.redditKeyword)
            .onChange(value => {
              this.redditKeyword = value;
            });
        });
    }
  }

  /**
   * Render Naver options (keyword filter) for both Naver Blog and Cafe
   */
  private renderNaverCafeOptions(): void {
    this.naverCafeOptionsContainer.empty();

    // Check if it's Naver Blog (URL-based) or Naver Cafe (handle-based)
    const handle = this.urlAnalysis?.handle ?? '';
    const isNaverBlog = this.url.includes('blog.naver.com') || this.url.includes('rss.blog.naver.com');
    const isNaverCafe = this.detectedPlatform === 'naver' && handle.startsWith('cafe:');

    // Show options for both Naver Blog and Cafe
    if (!isNaverBlog && !isNaverCafe) {
      this.naverCafeOptionsContainer.style.display = 'none';
      return;
    }

    this.naverCafeOptionsContainer.style.display = 'block';
    this.naverCafeOptionsContainer.style.marginTop = '14px';

    // Time range options for dropdown (only for Naver Blog - Cafe already has it in buildProfileOptions)
    const timeRangeOptions: { value: TimeRangePreset; label: string }[] = [
      { value: 'last_3_days', label: 'Last 3 days' },
      { value: 'last_week', label: 'Last week' },
      { value: 'last_2_weeks', label: 'Last 2 weeks' },
      { value: 'last_month', label: 'Last month' },
    ];

    if (Platform.isMobile) {
      // Mobile: Compact inline layout
      this.naverCafeOptionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 14px; margin-top: 14px;';

      const rowStyle = 'display: flex; align-items: center; justify-content: space-between; gap: 12px;';
      const labelStyle = 'font-size: var(--font-ui-small); color: var(--text-normal); flex-shrink: 0;';
      const inputStyle = 'font-size: var(--font-ui-small); padding: 6px 10px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); background: var(--background-primary);';

      // Row 1: Time range (only for Naver Blog - Cafe already has it in buildProfileOptions)
      if (isNaverBlog) {
        const periodRow = this.naverCafeOptionsContainer.createDiv();
        periodRow.style.cssText = rowStyle;

        const periodLabel = periodRow.createEl('label', { text: 'Time range' });
        periodLabel.style.cssText = labelStyle;

        const periodSelect = periodRow.createEl('select');
        periodSelect.style.cssText = inputStyle + 'min-width: 120px;';
        timeRangeOptions.forEach(opt => {
          const option = periodSelect.createEl('option', { text: opt.label, value: opt.value });
          if (opt.value === this.timeRangePreset) option.selected = true;
        });
        periodSelect.addEventListener('change', (e) => {
          this.timeRangePreset = (e.target as HTMLSelectElement).value as TimeRangePreset;
        });
      }

      // Row 2: Keyword filter
      const keywordRow = this.naverCafeOptionsContainer.createDiv();
      keywordRow.style.cssText = rowStyle;

      const keywordLabel = keywordRow.createEl('label', { text: 'Keyword filter' });
      keywordLabel.style.cssText = labelStyle;

      const keywordInput = keywordRow.createEl('input', {
        type: 'text',
        placeholder: 'Optional (e.g., 홈킷)',
        value: this.naverCafeKeyword,
      });
      keywordInput.style.cssText = inputStyle + 'flex: 1; min-width: 80px;';
      keywordInput.addEventListener('input', (e) => {
        this.naverCafeKeyword = (e.target as HTMLInputElement).value;
      });
    } else {
      // Desktop: Use Obsidian Setting
      // Time range only for Naver Blog (Cafe already has it in buildProfileOptions)
      if (isNaverBlog) {
        new Setting(this.naverCafeOptionsContainer)
          .setName('Time range')
          .setDesc('How far back to fetch posts')
          .addDropdown(dropdown => {
            timeRangeOptions.forEach(opt => {
              dropdown.addOption(opt.value, opt.label);
            });
            dropdown.setValue(this.timeRangePreset);
            dropdown.onChange(value => {
              this.timeRangePreset = value as TimeRangePreset;
            });
          });
      }

      new Setting(this.naverCafeOptionsContainer)
        .setName('Keyword filter')
        .setDesc('Only archive posts containing this keyword')
        .addText(text => {
          text
            .setPlaceholder('Optional (e.g., 홈킷)')
            .setValue(this.naverCafeKeyword)
            .onChange(value => {
              this.naverCafeKeyword = value;
            });
        });
    }
  }

  /**
   * Build subscribe options section
   */
  private buildSubscribeOptions(): void {
    this.subscribeOptionsContainer.empty();
    this.subscribeOptionsContainer.style.display = 'block';

    // Add ARIA attributes
    this.subscribeOptionsContainer.setAttribute('role', 'group');
    this.subscribeOptionsContainer.setAttribute('aria-label', 'Subscribe options');

    // Add margin-top to separate from time range
    this.subscribeOptionsContainer.style.marginTop = '14px';

    if (Platform.isMobile) {
      // Mobile: Compact inline layout matching other rows
      const row = this.subscribeOptionsContainer.createDiv();
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px;';

      const label = row.createEl('label', { text: 'Subscribe to new posts' });
      label.style.cssText = 'font-size: var(--font-ui-small); color: var(--text-normal); flex-shrink: 0;';

      // Use Obsidian's checkbox-container pattern for toggle
      const toggleEl = row.createEl('div', { cls: 'checkbox-container' });
      toggleEl.classList.toggle('is-enabled', this.subscribeEnabled);
      toggleEl.addEventListener('click', () => {
        this.subscribeEnabled = !this.subscribeEnabled;
        toggleEl.classList.toggle('is-enabled', this.subscribeEnabled);
        this.buildProfileActionButtons();
      });
    } else {
      // Desktop: Use standard Setting class
      new Setting(this.subscribeOptionsContainer)
        .setName('Subscribe to new posts')
        .addToggle((toggle) =>
          toggle
            .setValue(this.subscribeEnabled)
            .onChange((value) => {
              this.subscribeEnabled = value;
              this.buildProfileActionButtons();
            })
        );
    }
  }

  /**
   * Build profile action buttons
   */
  private buildProfileActionButtons(): void {
    this.profileActionButtons.empty();
    const isRss = this.urlAnalysis?.type === 'rss';

    // Container styling
    if (Platform.isMobile) {
      // Mobile: no border, stack vertically
      this.profileActionButtons.style.cssText = `
        display: flex;
        flex-direction: column-reverse;
        gap: var(--size-4-2);
        margin-top: var(--size-4-4);
      `;
    } else {
      // Desktop: border on top
      this.profileActionButtons.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: var(--size-4-2);
        margin-top: var(--size-4-4);
        padding-top: var(--size-4-3);
        border-top: 1px solid var(--background-modifier-border);
      `;
    }

    // Cancel button first (will be on right due to flex-end, bottom on mobile due to reverse)
    const cancelBtn = this.profileActionButtons.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    if (Platform.isMobile) {
      cancelBtn.style.width = '100%';
    }

    // RSS feeds: show "Subscribe Only" (if enabled) and "Fetch Posts" buttons
    if (isRss) {
      // Subscribe Only button (only if subscribe is enabled)
      this.subscribeOnlyButton = null;
      if (this.subscribeEnabled) {
        this.subscribeOnlyButton = this.profileActionButtons.createEl('button', {
          text: this.isProcessing ? 'Processing...' : 'Subscribe Only'
        });
        this.subscribeOnlyButton.addEventListener('click', () => this.handleSubscribeOnly());
        if (this.isProcessing) {
          this.subscribeOnlyButton.disabled = true;
        }
        if (Platform.isMobile) {
          this.subscribeOnlyButton.style.width = '100%';
        }
      }

      // Fetch Posts button (primary action for immediate fetch)
      const fetchButtonText = this.subscribeEnabled ? 'Fetch & Subscribe' : 'Fetch Posts';
      this.crawlButton = this.profileActionButtons.createEl('button', {
        text: this.isProcessing ? 'Processing...' : fetchButtonText,
        cls: 'mod-cta'
      });
      this.crawlButton.addEventListener('click', () => this.handleRSSFetch());
      if (this.isProcessing) {
        this.crawlButton.disabled = true;
      }
      if (Platform.isMobile) {
        this.crawlButton.style.width = '100%';
      }
      return;
    }

    // Subscribe Only button (if enabled, for profiles)
    this.subscribeOnlyButton = null;
    if (this.subscribeEnabled) {
      this.subscribeOnlyButton = this.profileActionButtons.createEl('button', {
        text: this.isProcessing ? 'Processing...' : 'Subscribe Only'
      });
      this.subscribeOnlyButton.addEventListener('click', () => this.handleSubscribeOnly());
      if (this.isProcessing) {
        this.subscribeOnlyButton.disabled = true;
      }
      if (Platform.isMobile) {
        this.subscribeOnlyButton.style.width = '100%';
      }
    }

    // Primary action button (Crawl Now) - only for profiles, not RSS
    const buttonText = this.subscribeEnabled ? 'Crawl & Subscribe' : 'Crawl Now';
    this.crawlButton = this.profileActionButtons.createEl('button', {
      text: this.isProcessing ? 'Processing...' : buttonText,
      cls: 'mod-cta'
    });
    this.crawlButton.addEventListener('click', () => this.handleProfileCrawl());
    if (this.isProcessing) {
      this.crawlButton.disabled = true;
    }
    if (Platform.isMobile) {
      this.crawlButton.style.width = '100%';
    }
  }

  /**
   * Handle profile crawl action
   */
  private async handleProfileCrawl(): Promise<void> {
    // Prevent double-submit
    if (this.isProcessing) {
      return;
    }

    // Clear previous error
    this.clearErrorState();

    if (!this.urlAnalysis || this.urlAnalysis.type !== 'profile') {
      this.renderErrorState(parseCrawlError(new Error('Invalid profile URL')));
      return;
    }

    if (!this.isValidUrl || !this.detectedPlatform) {
      this.renderErrorState(parseCrawlError(new Error('Invalid profile URL')));
      return;
    }

    if (!isAuthenticated(this.plugin)) {
      this.renderErrorState({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required. Please authenticate in settings first.',
        retryable: false,
      });
      return;
    }

    // Check if it's a Naver Cafe member profile - requires special handling (local API, not Worker)
    const handle = this.urlAnalysis?.handle ?? this.quickPreview?.handle;
    if (this.detectedPlatform === 'naver' && handle?.startsWith('cafe:')) {
      await this.handleNaverCafeMemberSubscribe();
      return;
    }

    // Brunch requires local fetching (similar to Naver Blog) - uses RSS + full content scraping
    if (this.detectedPlatform === 'brunch') {
      await this.handleBrunchFetch();
      return;
    }

    // Profile crawling is supported for Instagram, Facebook, LinkedIn, Reddit, TikTok, Pinterest, Bluesky, Mastodon, and YouTube
    // X disabled - BrightData returns non-chronological posts when not logged in
    // Bluesky, Mastodon use free direct API (no BrightData credits)
    // YouTube uses free RSS feed (no BrightData credits for subscription runs)
    if (!PROFILE_ARCHIVE_SUPPORTED_PLATFORMS.includes(this.detectedPlatform as typeof PROFILE_ARCHIVE_SUPPORTED_PLATFORMS[number])) {
      const isX = this.detectedPlatform === 'x';
      this.renderErrorState({
        code: 'UNSUPPORTED_PLATFORM',
        message: isX
          ? 'X (Twitter) profile crawling is temporarily disabled. Only Instagram, Facebook, LinkedIn, Reddit, TikTok, Pinterest, Bluesky, Mastodon, and YouTube are supported.'
          : `Profile crawling is currently only supported for Instagram, Facebook, LinkedIn, Reddit, TikTok, Pinterest, Bluesky, Mastodon, and YouTube. ${this.getPlatformName(this.detectedPlatform)} support coming soon!`,
        retryable: false,
      });
      return;
    }

    // handle is already defined above for Naver cafe member check
    if (!handle) {
      this.renderErrorState(parseCrawlError(new Error('Could not extract profile handle from URL')));
      return;
    }

    // Build ProfileArchiveRequest with time range preset
    const timezone = detectUserTimezone();
    const dateRange = timeRangePresetToDates(this.timeRangePreset);

    // Use date_range mode if preset is not 'all_time', otherwise post_count
    // Reddit uses post_count mode since it doesn't support date filtering via API
    const crawlOptions: ProfileCrawlOptions = {
      mode: this.detectedPlatform === 'reddit' ? 'post_count' : (dateRange ? 'date_range' : 'post_count'),
      postCount: this.postCount,
      startDate: this.detectedPlatform === 'reddit' ? undefined : dateRange?.startDate,
      endDate: this.detectedPlatform === 'reddit' ? undefined : dateRange?.endDate,
      timezone,
      maxPosts: CRAWL_LIMITS.MAX_POST_COUNT,
      // Reddit-specific options
      reddit: this.detectedPlatform === 'reddit' ? {
        sortBy: this.redditSortBy,
        sortByTime: this.redditSortByTime,
        keyword: this.redditKeyword || undefined,
      } : undefined,
    };

    // Validate crawl options before submission
    const validation = validateCrawlOptions(crawlOptions);
    if (!validation.valid) {
      this.renderErrorState({
        code: 'CRAWL_RANGE_EXCEEDED',
        message: validation.errors[0] ?? 'Invalid crawl options',
        retryable: false,
      });
      return;
    }

    // Show warnings if any (but don't block)
    if (validation.warnings.length > 0) {
      console.warn('[ArchiveModal] Crawl option warnings:', validation.warnings);
    }

    // For subscription, use current hour as the daily check time
    const currentHour = new Date().getHours();

    const request: ProfileArchiveRequest = {
      profileUrl: this.urlAnalysis.normalizedUrl,
      platform: this.detectedPlatform,
      handle,
      crawlOptions,
      destination: {
        folder: this.plugin.settings.archivePath,
      },
      subscribeOptions: this.subscribeEnabled ? {
        enabled: true,
        hour: currentHour,
        timezone,
        destinationFolder: this.plugin.settings.archivePath,
      } : undefined,
      // Include Naver options for Naver Blog/Cafe subscriptions
      ...(this.detectedPlatform === 'naver' && {
        naverOptions: this.buildNaverOptions(handle),
      }),
    };

    // Set processing state with loading UI
    this.isProcessing = true;
    if (this.crawlButton) {
      const loadingText = this.subscribeEnabled ? 'Processing...' : 'Starting crawl...';
      this.showButtonLoading(this.crawlButton, loadingText);
    }
    if (this.subscribeOnlyButton) {
      this.subscribeOnlyButton.disabled = true;
      this.subscribeOnlyButton.style.opacity = '0.5';
    }

    try {
      // Submit to Worker API
      const response = await this.plugin.workersApiClient.crawlProfile(request);

      // Check if this is a cached/idempotent response (no actual crawl triggered)
      if (response.cached) {
        // Cached response - crawl was already triggered recently
        // Don't register a new job since no WebSocket events will come
        this.close();
        new Notice(`📄 Profile crawl for @${handle} is already in progress. Please wait a few minutes before retrying.`, 5000);
        return;
      }

      // Register job with CrawlJobTracker for real-time status banner display
      // Skip for free API platforms (Fediverse, YouTube, X) - they complete synchronously
      // and the WebSocket event will handle job completion before this code runs
      const isFreeApiPlatform = request.platform === 'bluesky' || request.platform === 'mastodon' || request.platform === 'youtube' || request.platform === 'x';
      if (!isFreeApiPlatform) {
        this.plugin.crawlJobTracker.startJob(
          {
            jobId: response.jobId,
            handle: handle,
            platform: this.detectedPlatform!,
            estimatedPosts: response.estimatedPosts,
          },
          response.jobId // workerJobId for WebSocket event matching
        );
      }

      // Add job to PendingJobsManager
      // For free API platforms (Fediverse, YouTube): skip adding since WebSocket handles everything synchronously
      // For BrightData: use 'processing' status to prevent re-submission
      if (!isFreeApiPlatform) {
        await this.plugin.pendingJobsManager.addJob({
          id: response.jobId,
          url: request.profileUrl,
          platform: request.platform,
          status: 'processing',
          timestamp: Date.now(),
          retryCount: 0,
          metadata: {
            type: 'profile-crawl',
            workerJobId: response.jobId,
            handle: handle,
            estimatedPosts: response.estimatedPosts,
            estimatedCredits: response.estimatedPosts,
            notes: `Profile crawl: @${handle}`,
            startedAt: Date.now(),
          },
        });
      }

      // Close modal
      this.close();

      // Refresh SubscriptionManager to update UI immediately (if subscription was created)
      if (response.subscriptionId) {
        try {
          await this.plugin.subscriptionManager?.refresh();
        } catch (refreshError) {
          console.warn('[ArchiveModal] Failed to refresh subscriptions:', refreshError);
        }
      }

      // Show success notice with pointer to Timeline status banner
      const subscribeMsg = response.subscriptionId ? ' Subscription created.' : '';
      new Notice(`📄 Profile crawl started for @${handle}. Check status in Timeline.${subscribeMsg}`, 5000);

    } catch (error) {
      console.error('[ArchiveModal] Profile crawl failed:', error);

      // Parse and render error with retry option
      const crawlError = parseCrawlError(error);
      this.renderErrorState(crawlError);
    } finally {
      this.isProcessing = false;
      if (this.crawlButton) {
        this.hideButtonLoading(this.crawlButton);
      }
      if (this.subscribeOnlyButton) {
        this.subscribeOnlyButton.disabled = false;
        this.subscribeOnlyButton.style.opacity = '1';
      }
    }
  }

  /**
   * Handle RSS feed fetch action (immediate fetch without subscription)
   */
  private async handleRSSFetch(): Promise<void> {
    // Prevent double-submit
    if (this.isProcessing) {
      return;
    }

    // Clear previous error
    this.clearErrorState();

    if (!this.urlAnalysis || this.urlAnalysis.type !== 'rss') {
      this.renderErrorState(parseCrawlError(new Error('Invalid RSS URL')));
      return;
    }

    if (!this.isValidUrl || !this.detectedPlatform) {
      this.renderErrorState(parseCrawlError(new Error('Invalid RSS URL')));
      return;
    }

    if (!isAuthenticated(this.plugin)) {
      this.renderErrorState({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required. Please authenticate in settings first.',
        retryable: false,
      });
      return;
    }

    // Naver Blog requires local fetching to get full content (RSS is trimmed)
    // Check both detectedPlatform and URL pattern (feed detection may override platform to 'blog')
    const isNaverBlog = this.detectedPlatform === 'naver' ||
      this.url.includes('blog.naver.com') ||
      this.url.includes('rss.blog.naver.com');
    if (isNaverBlog) {
      await this.handleNaverBlogFetch();
      return;
    }

    // Brunch RSS requires local fetching (similar to Naver Blog)
    const isBrunch = this.detectedPlatform === 'brunch' ||
      this.url.includes('brunch.co.kr');
    if (isBrunch) {
      await this.handleBrunchFetch();
      return;
    }

    const feedUrl = this.urlAnalysis.feedUrl ?? this.url;
    const handle = this.extractSiteNameFromUrl(feedUrl);

    if (!handle) {
      this.renderErrorState(parseCrawlError(new Error('Could not extract site name from RSS URL')));
      return;
    }

    // Build ProfileArchiveRequest for immediate RSS fetch (without subscription)
    const timezone = detectUserTimezone();

    // For RSS feeds, keep platform-specific IDs or use 'blog' for generic RSS
    const apiPlatform: PlatformType = isRssPlatformWithOwnId(this.detectedPlatform ?? '')
      ? this.detectedPlatform
      : 'blog';

    const crawlOptions: ProfileCrawlOptions = {
      mode: 'post_count',
      postCount: this.postCount,
      timezone,
      maxPosts: CRAWL_LIMITS.MAX_POST_COUNT,
    };

    const request: ProfileArchiveRequest = {
      profileUrl: feedUrl,
      platform: apiPlatform, // Keep platform-specific IDs for velog, substack, tumblr, naver
      handle,
      crawlOptions,
      destination: {
        folder: this.plugin.settings.archivePath,
      },
      // No subscribeOptions - immediate fetch only
      // Include RSS metadata for RSS feed
      rssMetadata: {
        feedUrl: feedUrl,
        feedType: 'rss',
        siteTitle: handle,
      },
      // Note: Naver Blog is handled separately by handleNaverBlogFetch()
    };

    // Set processing state with loading UI
    this.isProcessing = true;
    if (this.crawlButton) {
      this.showButtonLoading(this.crawlButton, 'Fetching posts...');
    }
    if (this.subscribeOnlyButton) {
      this.subscribeOnlyButton.disabled = true;
      this.subscribeOnlyButton.style.opacity = '0.5';
    }

    try {
      // Submit to Worker API (immediate crawl)
      const response = await this.plugin.workersApiClient.crawlProfile(request);

      // Close modal
      this.close();

      // Show success notice
      new Notice(`📄 RSS feed fetch started for ${handle}. Check status in Timeline.`, 5000);

    } catch (error) {
      console.error('[ArchiveModal] RSS fetch failed:', error);

      // Parse and render error with retry option
      const crawlError = parseCrawlError(error);
      this.renderErrorState(crawlError);
    } finally {
      this.isProcessing = false;
      if (this.crawlButton) {
        this.hideButtonLoading(this.crawlButton);
      }
      if (this.subscribeOnlyButton) {
        this.subscribeOnlyButton.disabled = false;
        this.subscribeOnlyButton.style.opacity = '1';
      }
    }
  }

  /**
   * Handle subscribe only action (no immediate crawl, just create subscription)
   */
  private async handleSubscribeOnly(): Promise<void> {
    // Prevent double-submit
    if (this.isProcessing) {
      return;
    }

    // Clear previous error
    this.clearErrorState();

    const isRss = this.urlAnalysis?.type === 'rss';

    if (!this.urlAnalysis || (this.urlAnalysis.type !== 'profile' && this.urlAnalysis.type !== 'rss')) {
      this.renderErrorState(parseCrawlError(new Error('Invalid profile or RSS URL')));
      return;
    }

    if (!this.isValidUrl || !this.detectedPlatform) {
      this.renderErrorState(parseCrawlError(new Error('Invalid profile or RSS URL')));
      return;
    }

    if (!isAuthenticated(this.plugin)) {
      this.renderErrorState({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required. Please authenticate in settings first.',
        retryable: false,
      });
      return;
    }

    // Supported platforms for subscriptions
    // RSS feeds (blog, substack, tumblr, velog, medium, etc.) are also supported
    if (!NEW_SUBSCRIPTION_PLATFORMS.includes(this.detectedPlatform as typeof NEW_SUBSCRIPTION_PLATFORMS[number])) {
      this.renderErrorState({
        code: 'UNSUPPORTED_PLATFORM',
        message: `Subscriptions are currently only supported for Instagram, Facebook, X (Twitter), LinkedIn, Reddit, TikTok, Pinterest, Bluesky, Mastodon, and YouTube. ${this.getPlatformName(this.detectedPlatform)} support coming soon!`,
        retryable: false,
      });
      return;
    }

    // For RSS feeds, use feedUrl; for profiles, use handle
    const handle = isRss
      ? this.extractSiteNameFromUrl(this.urlAnalysis.feedUrl ?? this.url)
      : (this.urlAnalysis?.handle ?? this.quickPreview?.handle);
    if (!handle) {
      this.renderErrorState(parseCrawlError(new Error(isRss ? 'Could not extract site name from RSS URL' : 'Could not extract profile handle from URL')));
      return;
    }

    // For Naver cafe members, handle locally (Worker API doesn't support this)
    if (this.detectedPlatform === 'naver' && handle.startsWith('cafe:')) {
      await this.handleNaverCafeMemberSubscribeOnly(handle);
      return;
    }

    // For Naver Blog, handle locally (uses NaverBlogLocalService, not RSS)
    const isNaverBlog = this.url.includes('blog.naver.com') || this.url.includes('rss.blog.naver.com');
    if (isNaverBlog) {
      await this.handleNaverBlogSubscribeOnly();
      return;
    }

    // Build ProfileArchiveRequest for subscribe only
    const timezone = detectUserTimezone();

    // For RSS feeds, keep platform-specific IDs or use 'blog' for generic RSS
    const apiPlatform: PlatformType = isRss && !isRssPlatformWithOwnId(this.detectedPlatform ?? '')
      ? 'blog'
      : this.detectedPlatform;

    const crawlOptions: ProfileCrawlOptions = {
      mode: 'post_count',
      postCount: this.postCount,
      timezone,
      maxPosts: CRAWL_LIMITS.MAX_POST_COUNT,
      // Reddit-specific options
      reddit: this.detectedPlatform === 'reddit' ? {
        sortBy: this.redditSortBy,
        sortByTime: this.redditSortByTime,
        keyword: this.redditKeyword || undefined,
      } : undefined,
    };

    // Use current hour as the daily check time
    const currentHour = new Date().getHours();

    const request: ProfileArchiveRequest = {
      profileUrl: isRss ? (this.urlAnalysis.feedUrl ?? this.url) : this.urlAnalysis.normalizedUrl,
      platform: apiPlatform,
      handle,
      crawlOptions,
      destination: {
        folder: this.plugin.settings.archivePath,
      },
      subscribeOptions: {
        enabled: true,
        hour: currentHour,
        timezone,
        destinationFolder: this.plugin.settings.archivePath,
        subscribeOnly: true, // Skip immediate crawl
      },
      // Include RSS metadata for RSS feed subscriptions
      ...(isRss && {
        rssMetadata: {
          feedUrl: this.urlAnalysis.feedUrl ?? this.url,
          feedType: 'rss', // Will be detected by server
          siteTitle: handle,
        },
      }),
      // Include Naver options for Naver Blog/Cafe subscriptions
      ...(this.detectedPlatform === 'naver' && {
        naverOptions: this.buildNaverOptions(handle),
      }),
    };

    // Set processing state with loading UI
    this.isProcessing = true;
    if (this.subscribeOnlyButton) {
      this.showButtonLoading(this.subscribeOnlyButton, 'Creating subscription...');
    }
    if (this.crawlButton) {
      this.crawlButton.disabled = true;
      this.crawlButton.style.opacity = '0.5';
    }

    try {
      // Submit to Worker API (subscribe only mode)
      const response = await this.plugin.workersApiClient.crawlProfile(request);

      // Close modal
      this.close();

      // Refresh SubscriptionManager to update UI immediately
      try {
        await this.plugin.subscriptionManager?.refresh();
      } catch (refreshError) {
        console.warn('[ArchiveModal] Failed to refresh subscriptions:', refreshError);
        // Don't show error to user - subscription was created successfully
      }

      // Update AuthorCatalogStore immediately for reactive UI update
      if (response.subscriptionId && apiPlatform) {
        try {
          const authorCatalogStore = getAuthorCatalogStore();
          // Build author URL based on platform (matching buildSubscriptionMap logic)
          let authorUrl: string | undefined;
          const cleanHandle = handle.replace(/^@/, '');

          if (RSS_PLATFORMS_FOR_SUBSCRIPTION_MATCH.includes(apiPlatform as typeof RSS_PLATFORMS_FOR_SUBSCRIPTION_MATCH[number])) {
            if (apiPlatform === 'medium') {
              authorUrl = `https://medium.com/@${cleanHandle}`;
            } else if (apiPlatform === 'velog') {
              authorUrl = `https://velog.io/@${cleanHandle}`;
            } else if (apiPlatform === 'substack') {
              authorUrl = `https://${cleanHandle}.substack.com`;
            } else if (apiPlatform === 'tumblr') {
              authorUrl = `https://${cleanHandle}.tumblr.com`;
            }
          } else if (apiPlatform === 'youtube') {
            if (cleanHandle.toUpperCase().startsWith('UC') && cleanHandle.length === 24) {
              authorUrl = `https://www.youtube.com/channel/${cleanHandle}`;
            } else {
              authorUrl = `https://www.youtube.com/@${cleanHandle}`;
            }
          } else if (apiPlatform === 'x') {
            authorUrl = `https://x.com/${cleanHandle}`;
          } else if (apiPlatform === 'facebook') {
            authorUrl = `https://www.facebook.com/${cleanHandle}/`;
          } else if (apiPlatform === 'instagram') {
            authorUrl = `https://www.instagram.com/${cleanHandle}/`;
          } else if (apiPlatform === 'linkedin') {
            authorUrl = `https://www.linkedin.com/in/${cleanHandle}/`;
          } else if (apiPlatform === 'reddit') {
            authorUrl = cleanHandle.startsWith('r/')
              ? `https://www.reddit.com/${cleanHandle}/`
              : `https://www.reddit.com/user/${cleanHandle}/`;
          } else if (apiPlatform === 'tiktok') {
            authorUrl = `https://www.tiktok.com/@${cleanHandle}`;
          } else if (apiPlatform === 'pinterest') {
            authorUrl = `https://www.pinterest.com/${cleanHandle}/`;
          } else if (apiPlatform === 'bluesky') {
            authorUrl = `https://bsky.app/profile/${cleanHandle}`;
          } else if (apiPlatform === 'mastodon') {
            // For Mastodon, use the profile URL from request if available
            authorUrl = request.profileUrl;
          }

          if (authorUrl) {
            authorCatalogStore.updateAuthorStatus(authorUrl, apiPlatform, 'subscribed', response.subscriptionId, handle);
          }
        } catch (storeError) {
          console.warn('[ArchiveModal] Failed to update AuthorCatalogStore:', storeError);
          // Don't show error to user - subscription was created successfully
        }
      }

      // Show success notice (uses current hour for daily check time)
      const scheduleHour = new Date().getHours();
      new Notice(`📬 Subscription created for @${handle}. New posts will be archived daily at ${scheduleHour.toString().padStart(2, '0')}:00.`, 5000);

    } catch (error) {
      console.error('[ArchiveModal] Subscribe only failed:', error);

      // Parse and render error with retry option
      const crawlError = parseCrawlError(error);
      this.renderErrorState(crawlError);
    } finally {
      this.isProcessing = false;
      if (this.subscribeOnlyButton) {
        this.hideButtonLoading(this.subscribeOnlyButton);
      }
      if (this.crawlButton) {
        this.crawlButton.disabled = false;
        this.crawlButton.style.opacity = '1';
      }
    }
  }

  /**
   * Update archive button state
   */
  private updateArchiveButton(): void {
    if (this.isProcessing) {
      this.archiveBtn.setAttribute('disabled', 'true');
      return;
    }

    if (this.isValidUrl && !this.isResolving) {
      this.archiveBtn.removeAttribute('disabled');
    } else {
      this.archiveBtn.setAttribute('disabled', 'true');
    }
  }

  /**
   * Handle archive action - Async mode with PendingJobsManager
   */
  private async handleArchive(): Promise<void> {
    // Prevent double-submit (click + keyboard shortcut race, rapid double-click)
    if (this.isProcessing) {
      return;
    }

    if (!this.isValidUrl) {
      new Notice('Please enter a valid URL');
      return;
    }

    // Double-check authentication before proceeding
    if (!isAuthenticated(this.plugin)) {
      new Notice('❌ Authentication required. Please authenticate in settings first.', 8000);
      return;
    }

    if (!this.detectedPlatform) {
      new Notice('❌ Unable to detect platform from URL');
      return;
    }

    const archiveUrl = (this.resolvedUrl ?? this.url).trim();
    const submissionLockKey = this.plugin.tryAcquireArchiveQueueLock(archiveUrl, this.detectedPlatform ?? undefined);
    if (!submissionLockKey) {
      new Notice('⏳ This URL is already being queued. Please wait.');
      return;
    }

    this.isProcessing = true;
    const originalButtonText = this.archiveBtn.textContent ?? 'Archive';
    this.archiveBtn.textContent = 'Archiving...';
    this.archiveBtn.setAttribute('disabled', 'true');
    this.archiveBtn.style.opacity = '0.7';

    try {
      // Step 1: Close modal immediately (no preliminary doc - banner shows progress)
      this.close();

      // Step 2: Create pending job (no filePath - single-write on completion)
      const jobId = `job-${Date.now()}`;
      const pendingJob = {
        id: jobId,
        url: archiveUrl,
        platform: this.detectedPlatform,
        status: 'pending' as const,
        timestamp: Date.now(),
        retryCount: 0,
          metadata: {
            notes: this.comment && this.comment.trim() ? this.comment.trim() : undefined,
            downloadMedia: this.downloadMedia,
            includeComments: this.includeComments,
            includeTranscript: this.detectedPlatform === 'youtube' ? this.includeTranscript : undefined,
            includeFormattedTranscript: this.detectedPlatform === 'youtube' ? this.includeFormattedTranscript : undefined,
            isPinterestBoard: this.detectedPlatform === 'pinterest' ? this.isPinterestBoard : undefined,
            originalUrl: this.url,
          }
        };

      // Step 3: Add job to PendingJobsManager
      await this.plugin.pendingJobsManager.addJob(pendingJob);

      // Step 4: Start tracking in ArchiveJobTracker (drives banner UI)
      this.plugin.archiveJobTracker.startJob({
        jobId,
        url: archiveUrl,
        platform: this.detectedPlatform!,
      });

      // Step 5: Show notice
      new Notice('📄 Archive queued. Processing in background...');

      // Step 6: Trigger immediate background check
      try {
        await this.plugin.checkPendingJobs?.();
      } catch (checkError) {
        // Non-critical: periodic checker will retry, but log for visibility
        console.warn('[Social Archiver] Initial job check failed, will retry via periodic checker:', checkError);
      }

    } catch (error) {
      if (error instanceof Error && error.message.includes('Duplicate job already exists')) {
        new Notice('⏳ Archive is already queued for this URL.');
        return;
      }

      new Notice(
        `❌ Failed to queue archive job: ${error instanceof Error ? error.message : 'Unknown error'}`,
        8000
      );
    } finally {
      this.plugin.releaseArchiveQueueLock(submissionLockKey);
      this.isProcessing = false;
      if (this.archiveBtn?.isConnected) {
        this.archiveBtn.textContent = originalButtonText;
        this.archiveBtn.style.opacity = '1';
        this.updateArchiveButton();
      }
    }
  }

  /**
   * Get platform display name
   */
  private getPlatformName(platform: string): string {
    const names: Record<string, string> = {
      facebook: 'Facebook',
      linkedin: 'LinkedIn',
      instagram: 'Instagram',
      tiktok: 'TikTok',
      x: 'X',
      threads: 'Threads',
      youtube: 'YouTube',
      reddit: 'Reddit',
      pinterest: 'Pinterest',
      substack: 'Substack',
      tumblr: 'Tumblr',
      mastodon: 'Mastodon',
      bluesky: 'Bluesky',
      googlemaps: 'Google Maps',
      blog: 'Blog',
      post: 'User Post'
    };

    return names[platform] || platform;
  }

  /**
   * Get display name for RSS feed platform from URL
   * Extracts platform name from domain (e.g., medium.com -> "Medium")
   */
  private getRSSPlatformName(url: string): string {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      // Known platform mappings
      const platformNames: Record<string, string> = {
        'medium.com': 'Medium',
        'ghost.io': 'Ghost',
        'ghost.org': 'Ghost',
        'wordpress.com': 'WordPress',
        'wordpress.org': 'WordPress',
        'blogger.com': 'Blogger',
        'blogspot.com': 'Blogger',
        'beehiiv.com': 'Beehiiv',
        'buttondown.email': 'Buttondown',
        'revue.email': 'Revue',
        'dev.to': 'DEV',
        'hashnode.dev': 'Hashnode',
        'hackernoon.com': 'HackerNoon',
        'substack.com': 'Substack',
        'tumblr.com': 'Tumblr',
      };

      // Check for exact domain match or subdomain match
      for (const [domain, name] of Object.entries(platformNames)) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          return name;
        }
      }

      // Fallback: capitalize domain name (e.g., example.com -> "Example")
      const domainParts = hostname.replace(/^www\./, '').split('.');
      if (domainParts.length >= 2) {
        const mainDomain = domainParts[domainParts.length - 2] ?? '';
        return mainDomain ? mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1) : 'RSS';
      }

      return 'RSS';
    } catch {
      return 'RSS';
    }
  }

  /**
   * Extract site name from RSS feed URL
   * Used as handle for RSS subscriptions
   */
  private extractSiteNameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      // Velog: https://v2.velog.io/rss/@username or https://v2.velog.io/rss/username
      if (hostname === 'v2.velog.io' && urlObj.pathname.startsWith('/rss/')) {
        const rssPath = urlObj.pathname.replace('/rss/', '');
        // Remove @ prefix if present
        const username = rssPath.startsWith('@') ? rssPath.substring(1) : rssPath;
        // Remove any trailing path segments
        return username.split('/')[0] || 'velog';
      }

      // Feedburner: https://feeds.feedburner.com/{feedname}/{id}
      // Extract the feed name from first path segment
      if (hostname.includes('feedburner.com')) {
        const segments = urlObj.pathname.split('/').filter(Boolean);
        return segments[0] ?? 'feedburner';
      }

      // Platform-hosted sites: extract subdomain
      const platformPatterns = [
        { pattern: /^([^.]+)\.substack\.com$/i, prefix: '' },
        { pattern: /^([^.]+)\.tumblr\.com$/i, prefix: '' },
        { pattern: /^([^.]+)\.ghost\.io$/i, prefix: '' },
        { pattern: /^([^.]+)\.wordpress\.com$/i, prefix: '' },
        { pattern: /^([^.]+)\.blogspot\.com$/i, prefix: '' },
        { pattern: /^([^.]+)\.medium\.com$/i, prefix: '' },
      ];

      for (const { pattern } of platformPatterns) {
        const match = hostname.match(pattern);
        if (match && match[1] && match[1] !== 'www') {
          return match[1];
        }
      }

      // Remove common prefixes (www, blog, feeds, rss)
      const parts = hostname.split('.');
      const cleanParts = parts.filter(p => !['www', 'blog', 'feeds', 'rss', 'feed'].includes(p));

      // Return the main domain name (without TLD)
      if (cleanParts.length >= 2 && cleanParts[0]) {
        return cleanParts[0];
      }
      if (cleanParts.length === 1 && cleanParts[0]) {
        return cleanParts[0];
      }

      // Fallback to first part of hostname
      const first = parts[0];
      const second = parts[1];
      return first === 'www' && second ? second : (first ?? 'Unknown');
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Build Naver-specific options for subscription
   * Handles both Naver Blog (RSS) and Cafe member (JSON API) subscriptions
   *
   * @param handle - Profile handle, may be "cafe:{cafeId}:{memberKey}" for cafe members
   * @returns NaverCrawlOptions with appropriate subscriptionType and metadata
   */
  private buildNaverOptions(handle: string): import('@/types/profile-crawl').NaverCrawlOptions {
    const cookie = this.plugin.settings.naverCookie || undefined;

    // Check if it's a cafe member URL (handle format: "cafe:{cafeId}:{memberKey}")
    if (handle.startsWith('cafe:')) {
      const parts = handle.split(':');
      const cafeId = parts[1];
      const memberKey = parts[2];

      return {
        cookie,
        subscriptionType: 'cafe-member',
        cafeId,
        memberKey,
        localFetchRequired: true, // Polled locally by NaverSubscriptionPoller
      };
    }

    // Otherwise it's a Naver Blog subscription (uses RSS)
    // handle is the blog ID for blog subscriptions
    return {
      cookie,
      subscriptionType: 'blog',
      blogId: handle, // Blog ID for RSS fetching
      localFetchRequired: true, // Polled locally by NaverSubscriptionPoller
    };
  }

  /**
   * Handle Naver Cafe member archive/subscription
   * Uses local API (NaverCafeLocalService) instead of Worker API
   * Worker doesn't support cafe-member crawlProfile, only subscription polling
   */
  private async handleNaverCafeMemberSubscribe(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    const handle = this.urlAnalysis?.handle ?? '';
    if (!handle.startsWith('cafe:')) {
      this.renderErrorState(parseCrawlError(new Error('Invalid Naver cafe member URL')));
      return;
    }

    // Parse handle: "cafe:{cafeId}:{memberKey}"
    const parts = handle.split(':');
    const cafeId = parts[1];
    const memberKey = parts[2];

    if (!cafeId || !memberKey) {
      this.renderErrorState(parseCrawlError(new Error('Invalid Naver cafe member URL format')));
      return;
    }

    // Check if Naver cookie is available
    const cookie = this.plugin.settings.naverCookie;
    if (!cookie) {
      this.renderErrorState({
        code: 'NAVER_COOKIE_REQUIRED',
        message: 'Naver cookie is required for cafe member archiving. Please add your Naver cookie in settings.',
        retryable: false,
      });
      return;
    }

    // Get display info from preview
    const displayName = this.quickPreview?.displayName || 'Unknown Member';
    const cafeName = this.quickPreview?.handle || `Cafe ${cafeId}`;

    this.isProcessing = true;
    if (this.crawlButton) {
      this.showButtonLoading(this.crawlButton, 'Fetching posts...');
    }
    if (this.subscribeOnlyButton) {
      this.subscribeOnlyButton.disabled = true;
      this.subscribeOnlyButton.style.opacity = '0.5';
    }

    try {
      // 1. Fetch posts locally using NaverCafeLocalService
      const cafeService = new NaverCafeLocalService(cookie);
      const { posts } = await cafeService.fetchMemberPosts(cafeId, memberKey, {
        limit: this.postCount,
        backfillDays: timeRangePresetToBackfillDays(this.timeRangePreset),
      });


      // 2. Filter by keyword if specified
      let filteredPosts = posts;
      if (this.naverCafeKeyword) {
        const keyword = this.naverCafeKeyword.toLowerCase();
        filteredPosts = posts.filter(post =>
          post.title.toLowerCase().includes(keyword) ||
          post.text?.toLowerCase().includes(keyword)
        );
      }

      // 3. Save posts to vault
      const { VaultManager } = await import('@/services/VaultManager');
      const { MarkdownConverter } = await import('@/services/MarkdownConverter');

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

      let savedCount = 0;
      for (const post of filteredPosts) {
        try {
          // Convert to PostData format (matching NaverSubscriptionPoller)
          const convertedMedia = post.media.map(m => ({
            ...m,
            type: m.type === 'photo' ? 'image' as const : m.type as 'video',
          }));

          const postData = {
            platform: 'naver' as const,
            id: post.id,
            url: post.url,
            author: {
              name: post.author.name,
              handle: post.author.id,
              url: post.author.url,
              avatar: post.author.avatar,
              bio: post.author.grade,
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
              timestamp: post.timestamp,
            },
            title: post.title,
          };

          const markdown = await markdownConverter.convert(
            postData as any,
            undefined,
            undefined,
            undefined
          );

          await vaultManager.savePost(postData as any, markdown);
          savedCount++;
        } catch (error) {
          console.error(`[ArchiveModal] Failed to save post ${post.id}:`, error);
        }
      }

      // 4. Create subscription if enabled
      let subscriptionCreated = false;
      if (this.subscribeEnabled) {
        const subscriptionManager = this.plugin.subscriptionManager;
        if (subscriptionManager) {
          const timezone = detectUserTimezone();
          const currentHour = new Date().getHours();

          const subscriptionInput = {
            name: `${displayName} (${cafeName})`,
            platform: 'naver' as const,
            target: {
              handle: handle,
              profileUrl: this.urlAnalysis?.normalizedUrl || this.url,
            },
            schedule: {
              cron: `0 ${currentHour} * * *`,
              timezone,
            },
            destination: {
              folder: this.plugin.settings.archivePath,
            },
            options: {
              maxPostsPerRun: this.postCount,
              backfillDays: timeRangePresetToBackfillDays(this.timeRangePreset),
            },
            naverOptions: {
              cookie: undefined,
              subscriptionType: 'cafe-member' as const,
              cafeId,
              memberKey,
              memberNickname: displayName,
              localFetchRequired: true,
              keyword: this.naverCafeKeyword || undefined,
            },
          };

          await subscriptionManager.addSubscription(subscriptionInput as any);
          subscriptionCreated = true;

          try {
            await subscriptionManager.refresh();
          } catch (refreshError) {
            console.warn('[ArchiveModal] Failed to refresh subscriptions:', refreshError);
          }
        }
      }

      // Close modal
      this.close();

      // Show success notice
      const subscribeMsg = subscriptionCreated ? ' Subscription created.' : '';
      new Notice(`✓ Archived ${savedCount} posts from ${displayName}.${subscribeMsg}`, 5000);

    } catch (error) {
      console.error('[ArchiveModal] Naver cafe member subscription failed:', error);
      this.renderErrorState(parseCrawlError(error));
    } finally {
      this.isProcessing = false;
      if (this.crawlButton) {
        this.hideButtonLoading(this.crawlButton);
      }
      if (this.subscribeOnlyButton) {
        this.subscribeOnlyButton.disabled = false;
        this.subscribeOnlyButton.style.opacity = '1';
      }
    }
  }

  /**
   * Handle Naver Blog fetch action
   * Uses NaverBlogLocalService to fetch full content (RSS is trimmed)
   */
  private async handleNaverBlogFetch(): Promise<void> {
    const handle = this.urlAnalysis?.handle ?? this.quickPreview?.handle;

    if (!handle) {
      this.renderErrorState(parseCrawlError(new Error('Could not extract blog ID from URL')));
      return;
    }

    // Extract blogId from handle (remove any prefix if present)
    const blogId = handle.replace(/^blog:/, '');

    // Get display info from preview or handle
    const displayName = this.quickPreview?.displayName || blogId;

    this.isProcessing = true;
    if (this.crawlButton) {
      this.showButtonLoading(this.crawlButton, 'Fetching posts...');
    }
    if (this.subscribeOnlyButton) {
      this.subscribeOnlyButton.disabled = true;
      this.subscribeOnlyButton.style.opacity = '0.5';
    }

    try {
      // 1. Fetch posts locally using NaverBlogLocalService
      const blogService = new NaverBlogLocalService();
      const { posts } = await blogService.fetchMemberPosts(blogId, {
        limit: this.postCount,
        backfillDays: timeRangePresetToBackfillDays(this.timeRangePreset),
      });


      // 2. Save posts to vault
      const { VaultManager } = await import('@/services/VaultManager');
      const { MarkdownConverter } = await import('@/services/MarkdownConverter');

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

      let savedCount = 0;
      for (const post of posts) {
        try {
          // Convert to PostData format (matching NaverSubscriptionPoller)
          const convertedMedia = post.media.map(m => ({
            ...m,
            type: m.type === 'photo' ? 'image' as const : m.type as 'video',
          }));

          const postData = {
            platform: 'naver' as const,
            id: post.id,
            url: post.url,
            author: {
              name: post.author?.name || blogId,
              handle: post.author?.id || blogId,
              url: post.author?.url || `https://blog.naver.com/${blogId}`,
              avatar: post.author?.avatar,
              bio: post.author?.bio,
            },
            content: {
              text: post.text,
              html: undefined,
            },
            media: convertedMedia,
            metadata: {
              likes: post.likes || 0,
              comments: post.commentCount || 0,
              views: post.viewCount || 0,
              timestamp: post.timestamp,
            },
            title: post.title,
          };

          const markdown = await markdownConverter.convert(
            postData as any,
            undefined,
            undefined,
            undefined
          );

          await vaultManager.savePost(postData as any, markdown);
          savedCount++;
        } catch (error) {
          console.error(`[ArchiveModal] Failed to save post ${post.id}:`, error);
        }
      }

      // 3. Create subscription if enabled
      let subscriptionCreated = false;
      if (this.subscribeEnabled) {
        const subscriptionManager = this.plugin.subscriptionManager;
        if (subscriptionManager) {
          const timezone = detectUserTimezone();
          const currentHour = new Date().getHours();

          const subscriptionInput = {
            name: displayName,
            platform: 'naver' as const,
            target: {
              handle: blogId,
              profileUrl: this.urlAnalysis?.normalizedUrl || this.url,
            },
            schedule: {
              cron: `0 ${currentHour} * * *`,
              timezone,
            },
            destination: {
              folder: this.plugin.settings.archivePath,
            },
            options: {
              maxPostsPerRun: this.postCount,
              backfillDays: timeRangePresetToBackfillDays(this.timeRangePreset),
            },
            naverOptions: {
              cookie: undefined,
              subscriptionType: 'blog' as const,
              blogId,
              localFetchRequired: true,
              keyword: this.naverCafeKeyword || undefined,
            },
          };

          await subscriptionManager.addSubscription(subscriptionInput as any);
          subscriptionCreated = true;

          try {
            await subscriptionManager.refresh();
          } catch (refreshError) {
            console.warn('[ArchiveModal] Failed to refresh subscriptions:', refreshError);
          }
        }
      }

      // Close modal
      this.close();

      // Show success notice
      const subscribeMsg = subscriptionCreated ? ' Subscription created.' : '';
      new Notice(`✓ Archived ${savedCount} posts from ${displayName}.${subscribeMsg}`, 5000);

    } catch (error) {
      console.error('[ArchiveModal] Naver blog fetch failed:', error);
      this.renderErrorState(parseCrawlError(error));
    } finally {
      this.isProcessing = false;
      if (this.crawlButton) {
        this.hideButtonLoading(this.crawlButton);
      }
      if (this.subscribeOnlyButton) {
        this.subscribeOnlyButton.disabled = false;
        this.subscribeOnlyButton.style.opacity = '1';
      }
    }
  }

  /**
   * Handle Brunch profile/brunchbook crawl locally
   * Brunch uses RSS-based fetching similar to Naver Blog
   * Supports both author profiles (@username) and brunchbooks (book:bookId)
   *
   * Now uses background processing - modal closes immediately and
   * progress is shown in Timeline's CrawlStatusBanner
   */
  private async handleBrunchFetch(): Promise<void> {
    const handle = this.urlAnalysis?.handle ?? this.quickPreview?.handle;

    if (!handle) {
      this.renderErrorState(parseCrawlError(new Error('Could not extract username from URL')));
      return;
    }

    // Check if this is a brunchbook URL (handle starts with "book:")
    const isBrunchbook = handle.startsWith('book:');
    const identifier = isBrunchbook ? handle.replace('book:', '') : handle;

    // Get display info from preview or handle
    const displayName = this.quickPreview?.displayName || (isBrunchbook ? `📚 ${identifier}` : `@${identifier}`);

    // Generate job ID for tracking
    const jobId = crypto.randomUUID();

    // Register job with CrawlJobTracker (shows in Timeline banner)
    this.plugin.crawlJobTracker.startJob({
      jobId,
      handle: displayName,
      platform: 'brunch',
      estimatedPosts: this.postCount,
    });

    // Capture settings before closing modal
    const postCount = this.postCount;
    const timeRangePreset = this.timeRangePreset;
    const subscribeEnabled = this.subscribeEnabled;
    const archivePath = this.plugin.settings.archivePath || 'Social Archives';
    const normalizedUrl = this.urlAnalysis?.normalizedUrl || this.url;

    // Close modal immediately
    this.close();

    // Show notice
    new Notice(`📄 Fetching posts from ${displayName}... Check Timeline for progress.`, 3000);

    // Execute in background (fire-and-forget)
    this.executeBrunchFetchBackground({
      jobId,
      handle,
      identifier,
      displayName,
      isBrunchbook,
      postCount,
      timeRangePreset,
      subscribeEnabled,
      archivePath,
      normalizedUrl,
    }).catch(error => {
      console.error('[ArchiveModal] Background Brunch fetch failed:', error);
      // failJob is called inside executeBrunchFetchBackground
    });
  }

  /**
   * Execute Brunch fetch in background
   * Updates CrawlJobTracker progress and completes/fails job when done
   */
  private async executeBrunchFetchBackground(params: {
    jobId: string;
    handle: string;
    identifier: string;
    displayName: string;
    isBrunchbook: boolean;
    postCount: number;
    timeRangePreset: TimeRangePreset;
    subscribeEnabled: boolean;
    archivePath: string;
    normalizedUrl: string;
  }): Promise<void> {
    const {
      jobId,
      handle,
      identifier,
      displayName,
      isBrunchbook,
      postCount,
      timeRangePreset,
      subscribeEnabled,
      archivePath,
      normalizedUrl,
    } = params;

    try {
      const brunchService = new BrunchLocalService();
      let posts: import('@/types/brunch').BrunchPostData[];
      let authorUsername = identifier;
      let userId: string | null = null;

      if (isBrunchbook) {
        // Brunchbook: fetch using fetchBrunchBookPosts
        const result = await brunchService.fetchBrunchBookPosts(identifier, {
          limit: postCount,
        });
        posts = result.posts;

        // Get author username from first post if available
        const firstPost = posts[0];
        if (firstPost && firstPost.author?.id) {
          authorUsername = firstPost.author.id;
        }
      } else {
        // Author profile: discover userId and fetch member posts
        userId = await brunchService.discoverUserId(identifier);

        if (!userId) {
          throw new Error(`Could not discover Brunch userId for @${identifier}. The profile may not exist or is private.`);
        }

        const result = await brunchService.fetchMemberPosts(userId, identifier, {
          limit: postCount,
          backfillDays: timeRangePresetToBackfillDays(timeRangePreset),
        });
        posts = result.posts;
      }

      // Save posts to vault
      const { VaultManager } = await import('@/services/VaultManager');
      const { MarkdownConverter } = await import('@/services/MarkdownConverter');

      const vaultManager = new VaultManager({
        vault: this.plugin.app.vault,
        basePath: archivePath,
        organizationStrategy: getVaultOrganizationStrategy(this.plugin.settings.archiveOrganization),
      });
      await vaultManager.initialize();

      const markdownConverter = new MarkdownConverter({
        frontmatterSettings: this.plugin.settings.frontmatter,
      });
      await markdownConverter.initialize();

      let savedCount = 0;
      for (const post of posts) {
        try {
          // Convert BrunchPostData to PostData format
          const convertedMedia = post.media.map(m => ({
            ...m,
            type: m.type === 'photo' ? 'image' as const : m.type as 'video' | 'image',
          }));

          // Fetch comments if available
          let commentsMarkdown = '';
          if (post.author?.userId && post.commentCount && post.commentCount > 0) {
            try {
              const comments = await brunchService.fetchComments(post.author.userId, post.id);
              if (comments.length > 0) {
                // Extract internal IDs from comments
                const allInternalIds: string[] = [];
                const collectInternalIds = (commentList: typeof comments) => {
                  for (const c of commentList) {
                    allInternalIds.push(...BrunchLocalService.extractInternalIds(c.content));
                    if (c.authorUrl) {
                      const match = c.authorUrl.match(/brunch\.co\.kr\/@([^/]+)/);
                      if (match?.[1] && BrunchLocalService.isInternalId(match[1])) {
                        allInternalIds.push(match[1]);
                      }
                    }
                    if (c.replies) collectInternalIds(c.replies);
                  }
                };
                collectInternalIds(comments);

                // Resolve internal IDs
                let authorMap = new Map<string, string>();
                if (allInternalIds.length > 0) {
                  authorMap = await brunchService.resolveInternalIds(allInternalIds);
                }

                // Format comments
                commentsMarkdown = this.formatBrunchCommentsMarkdown(comments, authorMap);
              }
            } catch (commentError) {
              console.warn(`[ArchiveModal] Failed to fetch comments for ${post.id}:`, commentError);
            }
          }

          const postData = {
            platform: 'brunch' as const,
            id: post.id,
            url: post.url,
            author: {
              name: post.author?.name || authorUsername,
              handle: post.author?.id || authorUsername,
              url: post.author?.url || `https://brunch.co.kr/@${authorUsername}`,
              avatar: post.author?.avatar,
              bio: post.author?.bio,
            },
            content: {
              text: post.text + commentsMarkdown,
              html: post.contentHtml,
            },
            media: convertedMedia,
            metadata: {
              likes: post.likes || 0,
              comments: post.commentCount || 0,
              views: post.viewCount || 0,
              timestamp: post.timestamp,
            },
            title: post.title,
            // Brunch series/book info
            series: post.series,
          };

          const markdown = await markdownConverter.convert(
            postData as any,
            undefined,
            undefined
          );

          await vaultManager.savePost(postData as any, markdown);
          savedCount++;

          // Update progress in CrawlJobTracker
          this.plugin.crawlJobTracker.incrementProgress(jobId);
        } catch (error) {
          console.error(`[ArchiveModal] Failed to save Brunch post ${post.id}:`, error);
        }
      }

      // Create subscription if enabled
      let subscriptionCreated = false;
      if (subscribeEnabled) {
        const subscriptionManager = this.plugin.subscriptionManager;
        if (subscriptionManager) {
          const timezone = detectUserTimezone();
          const currentHour = new Date().getHours();

          const subscriptionInput = {
            name: displayName,
            platform: 'brunch' as const,
            target: {
              handle: identifier,
              profileUrl: normalizedUrl,
            },
            schedule: {
              cron: `0 ${currentHour} * * *`,
              timezone,
            },
            destination: {
              folder: archivePath,
            },
            options: {
              maxPostsPerRun: postCount,
              backfillDays: timeRangePresetToBackfillDays(timeRangePreset),
            },
            brunchOptions: {
              userId: userId || undefined,
              bookId: isBrunchbook ? identifier : undefined,
              localFetchRequired: true,
            },
          };

          await subscriptionManager.addSubscription(subscriptionInput as any);
          subscriptionCreated = true;

          try {
            await subscriptionManager.refresh();
          } catch (refreshError) {
            console.warn('[ArchiveModal] Failed to refresh subscriptions:', refreshError);
          }
        }
      }

      // Complete job in CrawlJobTracker
      this.plugin.crawlJobTracker.completeJob(jobId, savedCount);

      // Show success notice
      const subscribeMsg = subscriptionCreated ? ' Subscription created.' : '';
      new Notice(`✓ Archived ${savedCount} posts from ${displayName}.${subscribeMsg}`, 5000);

    } catch (error) {
      console.error('[ArchiveModal] Brunch fetch failed:', error);
      this.plugin.crawlJobTracker.failJob(jobId, error instanceof Error ? error.message : 'Unknown error');
      new Notice(`❌ Failed to archive ${displayName}: ${error instanceof Error ? error.message : 'Unknown error'}`, 5000);
    }
  }

  /**
   * Handle Naver Blog subscribe-only (no crawl)
   * Creates subscription locally with proper display info
   */
  private async handleNaverBlogSubscribeOnly(): Promise<void> {
    const handle = this.urlAnalysis?.handle ?? this.quickPreview?.handle;

    if (!handle) {
      this.renderErrorState(parseCrawlError(new Error('Could not extract blog ID from URL')));
      return;
    }

    // Extract blogId from handle (remove any prefix if present)
    const blogId = handle.replace(/^blog:/, '');

    // Get display info from preview or handle
    const displayName = this.quickPreview?.displayName || blogId;

    this.isProcessing = true;
    if (this.subscribeOnlyButton) {
      this.showButtonLoading(this.subscribeOnlyButton, 'Creating subscription...');
    }
    if (this.crawlButton) {
      this.crawlButton.disabled = true;
      this.crawlButton.style.opacity = '0.5';
    }

    try {
      // Create subscription via SubscriptionManager
      const subscriptionManager = this.plugin.subscriptionManager;
      if (!subscriptionManager) {
        throw new Error('SubscriptionManager not available');
      }

      const timezone = detectUserTimezone();
      const currentHour = new Date().getHours();

      const backfillDays = timeRangePresetToBackfillDays(this.timeRangePreset);

      const subscriptionInput = {
        name: displayName,
        platform: 'naver' as const,
        target: {
          handle: blogId,
          profileUrl: this.urlAnalysis?.normalizedUrl || this.url,
        },
        schedule: {
          cron: `0 ${currentHour} * * *`,
          timezone,
        },
        destination: {
          folder: this.plugin.settings.archivePath,
        },
        options: {
          maxPostsPerRun: this.postCount,
          backfillDays,
        },
        naverOptions: {
          cookie: undefined,
          subscriptionType: 'blog' as const,
          blogId,
          localFetchRequired: true,
          keyword: this.naverCafeKeyword || undefined,
        },
      };

      await subscriptionManager.addSubscription(subscriptionInput as any);

      try {
        await subscriptionManager.refresh();
      } catch (refreshError) {
        console.warn('[ArchiveModal] Failed to refresh subscriptions:', refreshError);
      }

      // Close modal
      this.close();

      // Show success notice
      new Notice(`✓ Subscribed to ${displayName}. Posts will be fetched on next scheduled run.`, 5000);

    } catch (error) {
      console.error('[ArchiveModal] Naver Blog subscribe-only failed:', error);
      this.renderErrorState(parseCrawlError(error));
    } finally {
      this.isProcessing = false;
      if (this.subscribeOnlyButton) {
        this.hideButtonLoading(this.subscribeOnlyButton);
      }
      if (this.crawlButton) {
        this.crawlButton.disabled = false;
        this.crawlButton.style.opacity = '1';
      }
    }
  }

  /**
   * Handle Naver cafe member subscribe-only (no crawl)
   * Creates subscription locally with proper display info
   */
  private async handleNaverCafeMemberSubscribeOnly(handle: string): Promise<void> {
    // Parse handle: "cafe:{cafeId}:{memberKey}"
    const parts = handle.split(':');
    const cafeId = parts[1];
    const memberKey = parts[2];

    if (!cafeId || !memberKey) {
      this.renderErrorState(parseCrawlError(new Error('Invalid Naver cafe member URL format')));
      return;
    }

    // Check if Naver cookie is available
    const cookie = this.plugin.settings.naverCookie;
    if (!cookie) {
      this.renderErrorState({
        code: 'NAVER_COOKIE_REQUIRED',
        message: 'Naver cookie is required for cafe member subscription. Please add your Naver cookie in settings.',
        retryable: false,
      });
      return;
    }

    this.isProcessing = true;
    if (this.subscribeOnlyButton) {
      this.showButtonLoading(this.subscribeOnlyButton, 'Creating subscription...');
    }
    if (this.crawlButton) {
      this.crawlButton.disabled = true;
      this.crawlButton.style.opacity = '0.5';
    }

    try {
      // Get display info - either from preview or fetch it
      let displayName = this.quickPreview?.displayName || 'Unknown Member';
      let cafeName = this.quickPreview?.handle || `Cafe ${cafeId}`;
      let avatar = this.quickPreview?.avatar;

      // If preview wasn't loaded, fetch member profile now
      if (!this.quickPreview?.displayName) {
        try {
          const { NaverCafeLocalService } = await import('@/services/NaverCafeLocalService');
          const cafeService = new NaverCafeLocalService(cookie);
          const profile = await cafeService.fetchMemberProfile(cafeId, memberKey);
          if (profile) {
            displayName = profile.nickname || displayName;
            cafeName = profile.cafeName || cafeName;
            avatar = profile.avatar || avatar;
          }
        } catch (profileError) {
          console.warn('[ArchiveModal] Failed to fetch member profile:', profileError);
          // Continue with default values
        }
      }

      // Create subscription via SubscriptionManager
      const subscriptionManager = this.plugin.subscriptionManager;
      if (!subscriptionManager) {
        throw new Error('SubscriptionManager not available');
      }

      const timezone = detectUserTimezone();
      const currentHour = new Date().getHours();

      const subscriptionInput = {
        name: `${displayName} (${cafeName})`,
        platform: 'naver' as const,
        target: {
          handle: handle,
          profileUrl: this.urlAnalysis?.normalizedUrl || this.url,
        },
        schedule: {
          cron: `0 ${currentHour} * * *`,
          timezone,
        },
        destination: {
          folder: this.plugin.settings.archivePath,
        },
        options: {
          maxPostsPerRun: this.postCount,
          backfillDays: timeRangePresetToBackfillDays(this.timeRangePreset),
        },
        naverOptions: {
          cookie: undefined,
          subscriptionType: 'cafe-member' as const,
          cafeId,
          memberKey,
          memberNickname: displayName,
          memberAvatar: avatar,
          cafeName: cafeName,
          localFetchRequired: true,
          keyword: this.naverCafeKeyword || undefined,
        },
      };

      await subscriptionManager.addSubscription(subscriptionInput as any);

      try {
        await subscriptionManager.refresh();
      } catch (refreshError) {
        console.warn('[ArchiveModal] Failed to refresh subscriptions:', refreshError);
      }

      // Close modal
      this.close();

      // Show success notice
      new Notice(`✓ Subscription created for ${displayName} (${cafeName})`, 5000);

    } catch (error) {
      console.error('[ArchiveModal] Naver cafe member subscribe-only failed:', error);
      this.renderErrorState(parseCrawlError(error));
    } finally {
      this.isProcessing = false;
      if (this.subscribeOnlyButton) {
        this.hideButtonLoading(this.subscribeOnlyButton);
      }
      if (this.crawlButton) {
        this.crawlButton.disabled = false;
        this.crawlButton.style.opacity = '1';
      }
    }
  }

  /**
   * Set initial URL (for clipboard paste feature)
   */
  public setUrl(url: string): void {
    this.url = url;
  }

  /**
   * Render unauthenticated state UI
   * Prompts user to authenticate before archiving
   */
  private renderUnauthenticatedState(contentEl: HTMLElement): void {
    // Apply centered layout style
    contentEl.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 32px 20px;
      text-align: center;
    `;

    // Title (no icon)
    const title = contentEl.createEl('h2', { text: 'Sign in to Archive' });
    title.style.cssText = `
      font-size: 18px;
      font-weight: 600;
      color: var(--text-normal);
      margin: 0 0 20px 0;
    `;

    // Centered message
    const messageContainer = contentEl.createDiv();
    messageContainer.style.cssText = 'margin-bottom: 28px;';

    const mainMessage = messageContainer.createEl('p', {
      text: 'Archive your favorite social media posts'
    });
    mainMessage.style.cssText = `
      font-size: 14px;
      color: var(--text-normal);
      margin: 0 0 8px 0;
      line-height: 1.4;
    `;

    const subMessage = messageContainer.createEl('p', {
      text: 'Free during beta • No password needed • Magic link authentication'
    });
    subMessage.style.cssText = `
      font-size: 12px;
      color: var(--text-muted);
      margin: 0;
      line-height: 1.4;
    `;

    // Simple steps (no icons)
    const stepsContainer = contentEl.createDiv();
    stepsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0 auto 28px auto;
      max-width: 260px;
      width: 100%;
    `;

    const createStep = (number: string, text: string) => {
      const step = stepsContainer.createDiv();
      step.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: var(--background-secondary);
        border-radius: var(--radius-s, 6px);
        text-align: left;
        transition: opacity 0.2s ease;
      `;

      step.addEventListener('mouseenter', () => {
        step.style.opacity = '0.9';
      });
      step.addEventListener('mouseleave', () => {
        step.style.opacity = '1';
      });

      const stepNumber = step.createEl('span', { text: number });
      stepNumber.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: var(--text-muted);
        flex-shrink: 0;
      `;

      const stepText = step.createEl('span', { text: text });
      stepText.style.cssText = `
        font-size: 13px;
        color: var(--text-normal);
        line-height: 1.3;
      `;
    };

    createStep('1', 'Enter email & username');
    createStep('2', 'Click magic link in email');
    createStep('3', 'Start archiving');

    // Subtle disclaimer at bottom (no icon)
    const disclaimerContainer = contentEl.createDiv();
    disclaimerContainer.setText('Only archive content you have permission to save');
    disclaimerContainer.style.cssText = `
      font-size: 11px;
      color: var(--text-faint);
      padding: 8px 14px;
      background: var(--background-secondary);
      border-radius: var(--radius-s, 4px);
      margin-bottom: 28px;
      line-height: 1.3;
      opacity: 0.7;
    `;

    // Footer buttons with proper spacing from border
    const footer = contentEl.createDiv({ cls: 'modal-button-container' });
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      width: 100%;
      max-width: 320px;
      margin: 0 auto;
      padding-top: 16px;
      border-top: none;
    `;

    const closeBtn = footer.createEl('button', { text: 'Cancel', cls: 'mod-cancel' });
    closeBtn.style.cssText = `
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
    `;
    closeBtn.addEventListener('click', () => this.close());

    const settingsBtn = footer.createEl('button', {
      text: 'Open Settings →',
      cls: 'mod-cta'
    });
    settingsBtn.style.cssText = `
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
    `;
    settingsBtn.addEventListener('click', () => {
      this.close();
      // Open settings and navigate to Social Archiver tab
      // @ts-ignore - Obsidian internal API
      if (this.app.setting.open) {
        // @ts-ignore
        this.app.setting.open();
        // @ts-ignore - Access the plugin settings tab
        this.app.setting.openTabById(this.plugin.manifest.id);
      }
    });

    // Keyboard shortcut to close
    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });
  }

  /**
   * Render error state UI with retry button
   * Preserves input values and shows user-friendly error message
   */
  private renderErrorState(error: CrawlError): void {
    // Clear previous error
    this.clearErrorState();

    this.currentError = error;

    // Create minimal error container
    this.errorContainer = this.contentEl.createDiv({ cls: 'crawl-error-container' });

    // ARIA attributes for screen readers
    this.errorContainer.setAttribute('role', 'alert');
    this.errorContainer.setAttribute('aria-live', 'assertive');

    this.errorContainer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      margin-bottom: 12px;
    `;

    // Display error message (with fallback for empty/undefined messages)
    const displayMessage = error.message || error.details || `Error: ${error.code}`;
    const messageText = this.errorContainer.createDiv();
    messageText.textContent = displayMessage;
    messageText.style.cssText = `
      margin: 0;
      color: var(--text-error);
      font-size: var(--font-ui-small);
      line-height: 1.4;
    `;

    // Auto-clear error when user interacts with form (no dismiss button needed)

    // Insert error container before profile options
    if (this.profileOptionsContainer && this.profileOptionsContainer.parentElement) {
      this.profileOptionsContainer.parentElement.insertBefore(
        this.errorContainer,
        this.profileOptionsContainer
      );
    }
  }

  /**
   * Clear error state and remove error UI
   */
  private clearErrorState(): void {
    this.currentError = null;
    if (this.errorContainer) {
      this.errorContainer.remove();
      this.errorContainer = null;
    }
  }

  /**
   * Show loading spinner on a button
   */
  private showButtonLoading(button: HTMLButtonElement, loadingText: string): void {
    button.disabled = true;
    button.style.opacity = '0.7';
    button.style.cursor = 'wait';
    button.setAttribute('aria-busy', 'true');

    // Store original text
    const originalText = button.textContent ?? '';
    button.setAttribute('data-original-text', originalText);

    // Create loading spinner
    const spinner = document.createElement('span');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    spinner.style.cssText = `
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 6px;
      vertical-align: middle;
    `;

    button.textContent = '';
    button.appendChild(spinner);
    button.appendChild(document.createTextNode(loadingText));
  }

  /**
   * Hide loading spinner and restore button state
   */
  private hideButtonLoading(button: HTMLButtonElement): void {
    button.disabled = false;
    button.style.opacity = '1';
    button.style.cursor = 'pointer';
    button.removeAttribute('aria-busy');

    // Restore original text
    const originalText = button.getAttribute('data-original-text');
    if (originalText) {
      button.textContent = originalText;
      button.removeAttribute('data-original-text');
    }

    // Remove spinner
    const spinner = button.querySelector('.loading-spinner');
    if (spinner) {
      spinner.remove();
    }
  }

  /**
   * Add CSS animation for spinner (called once on modal open)
   */
  private addSpinnerAnimation(): void {
    // Check if animation already exists
    if (document.getElementById('social-archiver-spinner-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'social-archiver-spinner-style';
    style.textContent = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 0.8; }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Build collapsible section header for mobile
   */
  private buildCollapsibleHeader(
    container: HTMLElement,
    title: string,
    isCollapsed: boolean,
    onToggle: () => void
  ): HTMLElement {
    const header = container.createDiv({ cls: 'collapsible-header' });
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      cursor: pointer;
      border-bottom: 1px solid var(--background-modifier-border);
      margin-bottom: ${isCollapsed ? '0' : '12px'};
    `;

    // ARIA attributes
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', String(!isCollapsed));
    header.setAttribute('aria-label', `${title}, ${isCollapsed ? 'collapsed' : 'expanded'}`);

    const titleEl = header.createEl('span', { text: title });
    titleEl.style.cssText = `
      font-weight: 600;
      font-size: 14px;
      color: var(--text-normal);
    `;

    const chevron = header.createEl('span', { text: isCollapsed ? '▶' : '▼' });
    chevron.style.cssText = `
      font-size: 10px;
      color: var(--text-muted);
      transition: transform 0.2s ease;
    `;
    chevron.setAttribute('aria-hidden', 'true');

    // Click handler
    header.addEventListener('click', () => {
      onToggle();
      chevron.textContent = isCollapsed ? '▼' : '▶';
      header.setAttribute('aria-expanded', String(isCollapsed));
      header.setAttribute('aria-label', `${title}, ${isCollapsed ? 'expanded' : 'collapsed'}`);
    });

    // Keyboard handler
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
        chevron.textContent = isCollapsed ? '▼' : '▶';
        header.setAttribute('aria-expanded', String(isCollapsed));
      }
    });

    return header;
  }

  /**
   * Try to paste URL from clipboard automatically
   * Uses Web API navigator.clipboard.readText() (desktop & mobile)
   *
   * Note: On iOS, clipboard access may be restricted when modal opens.
   * The API will fail silently and user can paste manually.
   */
  private async tryPasteFromClipboard(): Promise<void> {
    try {
      // Check if Clipboard API is available
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        return;
      }

      // Read clipboard contents
      // On iOS, this may require user gesture and will throw if denied
      const text = await navigator.clipboard.readText();

      // Only paste if clipboard contains text that looks like a URL
      if (text && text.trim().length > 0 && (text.startsWith('http://') || text.startsWith('https://'))) {
        this.url = text.trim();
        this.urlInput.value = this.url;
        await this.validateUrl(this.url);

        // Focus the input for user convenience
        this.urlInput.focus();
        // Select the text so user can easily replace it if needed
        this.urlInput.select();
      }
    } catch {
      // Clipboard access denied or failed - silently ignore
      // This is expected behavior on mobile/iOS where clipboard access
      // requires user interaction (e.g., tap on input field to paste)
    }
  }

  /**
   * Format Brunch comments to Markdown
   */
  private formatBrunchCommentsMarkdown(
    comments: BrunchComment[],
    authorMap: Map<string, string>
  ): string {
    if (!comments || comments.length === 0) return '';

    const lines: string[] = ['', '## 💬 Comments', ''];

    const formatComment = (comment: BrunchComment, isReply = false): string => {
      const result: string[] = [];

      // Format timestamp
      const date = new Date(comment.timestamp);
      const formattedDate = date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });

      // Resolve internal ID in authorUrl
      let authorUrl = comment.authorUrl || `https://brunch.co.kr/@${comment.author}`;
      const match = authorUrl.match(/brunch\.co\.kr\/@([^/]+)/);
      if (match?.[1] && BrunchLocalService.isInternalId(match[1])) {
        const resolved = authorMap.get(match[1]);
        if (resolved) authorUrl = `https://brunch.co.kr/@${resolved}`;
      }

      // Build header
      let header = isReply ? '↳ ' : '';
      header += `**[@${comment.author}](${authorUrl})** · ${formattedDate}`;
      if (comment.likes && comment.likes > 0) header += ` · ${comment.likes} likes`;
      if (comment.isTopCreator) header += ' 🌟';
      result.push(header);

      // Content with mention conversion
      const content = BrunchLocalService.convertMentions(comment.content, authorMap);
      if (isReply) {
        content.split('\n').forEach(line => result.push(`  ${line}`));
      } else {
        result.push(content);
      }
      result.push('');

      // Nested replies
      if (comment.replies?.length) {
        comment.replies.forEach(reply => {
          result.push(formatComment(reply, true));
        });
      }

      return result.join('\n');
    };

    comments.forEach((comment, i) => {
      lines.push(formatComment(comment));
      if (i < comments.length - 1) {
        lines.push('---', '');
      }
    });

    return lines.join('\n');
  }
}
