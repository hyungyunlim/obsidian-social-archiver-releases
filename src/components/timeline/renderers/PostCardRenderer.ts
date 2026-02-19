import { setIcon, Notice, Scope, TFile, TFolder, MarkdownRenderer, Component, Modal, Platform as ObsidianPlatform, requestUrl, type Vault, type App } from 'obsidian';
import type { PostData, Comment, PostMetadata, Platform } from '../../../types/post';
import type SocialArchiverPlugin from '../../../main';
import * as L from 'leaflet';
import {
  getPlatformSimpleIcon,
  getPlatformLucideIcon,
} from '../../../services/IconService';
import { MediaGalleryRenderer } from './MediaGalleryRenderer';
import { CommentRenderer } from './CommentRenderer';
import { YouTubeEmbedRenderer } from './YouTubeEmbedRenderer';
import { LinkPreviewRenderer } from './LinkPreviewRenderer';
import { CompactPostCardRenderer } from './CompactPostCardRenderer';
import { YouTubePlayerController } from '../controllers/YouTubePlayerController';
import { VideoTranscriptPlayer } from './VideoTranscriptPlayer';
import { ShareAPIClient } from '../../../services/ShareAPIClient';
import { TextFormatter } from '../../../services/markdown/formatters/TextFormatter';
import { TranscriptFormatter } from '../../../services/markdown/formatters/TranscriptFormatter';
import { getAuthorCatalogStore } from '../../../services/AuthorCatalogStore';
import { normalizeAuthorUrl } from '../../../services/AuthorDeduplicator';
import { isValidPreviewUrl, encodePathForMarkdownLink } from '../../../utils/url';
import { get } from 'svelte/store';
import type { AuthorCatalogEntry } from '../../../types/author-catalog';
import { isRssBasedPlatform } from '../../../constants/rssPlatforms';
import { getPlatformName } from '@/shared/platforms';
import { isSupportedPlatformUrl, validateAndDetectPlatform, isPinterestBoardUrl } from '../../../schemas/platforms';
import { resolvePinterestUrl } from '../../../utils/pinterest';
import { AICommentBanner, type AICommentBannerOptions } from './AICommentBanner';
import { AICommentRenderer, type AICommentRendererOptions } from './AICommentRenderer';
import { AICliDetector, type AICli, type AICliDetectionResult } from '../../../utils/ai-cli';
import { parseAIComments, appendAIComment, removeAIComment, updateFrontmatterAIComments } from '../../../services/ai-comment/markdown-handler';
import type { AICommentMeta, AICommentType, AICommentProgress, AICommentResult, AIOutputLanguage } from '../../../types/ai-comment';
import { insertTranscriptSection, extractTranscriptLanguages } from '../../../services/markdown/TranscriptSectionManager';
import { languageCodeToName } from '../../../constants/languages';
import { getPlatformCategory } from '../../../shared/platforms/types';
import { createSVGElement } from '../../../utils/dom-helpers';
import type { WhisperModel } from '../../../utils/whisper';

/**
 * PostCardRenderer - Renders individual post cards
 * Handles post card HTML generation, interactions, and state updates
 * Extends Component for lifecycle management with MarkdownRenderer
 */
export class PostCardRenderer extends Component {
  private vault: Vault;
  private app: App;
  private plugin: SocialArchiverPlugin;

  // Renderer dependencies
  private mediaGalleryRenderer: MediaGalleryRenderer;
  private commentRenderer: CommentRenderer;
  private youtubeEmbedRenderer: YouTubeEmbedRenderer;
  private linkPreviewRenderer: LinkPreviewRenderer;
  private compactPostCardRenderer: CompactPostCardRenderer;
  private textFormatter: TextFormatter;

  // YouTube player controllers map (shared with parent)
  private youtubeControllers: Map<string, YouTubePlayerController>;

  // Video transcript players map
  private videoTranscriptPlayers: Map<string, VideoTranscriptPlayer> = new Map();

  // Callback for archive toggle
  private onArchiveToggleCallback?: (post: PostData, newArchiveStatus: boolean, cardElement: HTMLElement) => void;

  // Callback for edit post
  private onEditPostCallback?: (post: PostData, filePath: string) => void;

  // Callback for hashtag click
  private onHashtagClickCallback?: (hashtag: string) => void;

  // Callback for viewing author in Author Catalog
  private onViewAuthorCallback?: (authorUrl: string, platform: Platform) => void;

  // Callback for subscribing to author
  private onSubscribeAuthorCallback?: (author: AuthorCatalogEntry) => Promise<void>;

  // Callback for unsubscribing from author
  private onUnsubscribeAuthorCallback?: (subscriptionId: string, authorName: string, authorUrl: string, platform: Platform) => Promise<void>;

  // Callback for UI-initiated deletions (to prevent double refresh)
  private onUIDeleteCallback?: (filePath: string) => void;

  // Callback for UI-initiated modifications (to prevent double refresh)
  private onUIModifyCallback?: (filePath: string) => void;

  // Callback for tag changes (to refresh TagChipBar)
  private onTagsChangedCallback?: () => void;

  // Callback for reader mode
  private onReaderModeCallback?: (post: PostData) => void;

  // Cached subscriptions for quick lookup (set by TimelineContainer)
  private subscriptionsCache: Map<string, { subscriptionId: string; handle: string }> = new Map();

  // Track badge elements by author key for real-time updates
  private badgeUpdateCallbacks: Map<string, Set<(isSubscribed: boolean) => void>> = new Map();

  // AI Comment components
  private aiCommentBanners: Map<string, AICommentBanner> = new Map();
  private aiCommentRenderers: Map<string, AICommentRenderer> = new Map();
  private cachedCliDetection: Map<AICli, AICliDetectionResult> | null = null;
  private cliDetectionTimestamp: number = 0;
  private readonly CLI_DETECTION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    vault: Vault,
    app: App,
    plugin: SocialArchiverPlugin,
    mediaGalleryRenderer: MediaGalleryRenderer,
    commentRenderer: CommentRenderer,
    youtubeEmbedRenderer: YouTubeEmbedRenderer,
    linkPreviewRenderer: LinkPreviewRenderer,
    youtubeControllers: Map<string, YouTubePlayerController>
  ) {
    super();
    this.vault = vault;
    this.app = app;
    this.plugin = plugin;
    this.mediaGalleryRenderer = mediaGalleryRenderer;
    this.commentRenderer = commentRenderer;
    this.youtubeEmbedRenderer = youtubeEmbedRenderer;
    this.linkPreviewRenderer = linkPreviewRenderer;
    this.compactPostCardRenderer = new CompactPostCardRenderer();
    this.compactPostCardRenderer.setApp(app); // Set app for resource path conversion
    this.compactPostCardRenderer.setLinkPreviewRenderer(linkPreviewRenderer); // Set LinkPreviewRenderer for external links
    this.youtubeControllers = youtubeControllers;
    this.textFormatter = new TextFormatter();
  }

  /**
   * Set callback for archive toggle events
   */
  public onArchiveToggle(callback: (post: PostData, newArchiveStatus: boolean, cardElement: HTMLElement) => void): void {
    this.onArchiveToggleCallback = callback;
  }

  /**
   * Set callback for edit post events
   */
  public onEditPost(callback: (post: PostData, filePath: string) => void): void {
    this.onEditPostCallback = callback;
  }

  /**
   * Set callback for hashtag click events
   */
  public onHashtagClick(callback: (hashtag: string) => void): void {
    this.onHashtagClickCallback = callback;
  }

  /**
   * Set callback for viewing author in Author Catalog
   */
  public onViewAuthor(callback: (authorUrl: string, platform: Platform) => void): void {
    this.onViewAuthorCallback = callback;
  }

  /**
   * Set callback for subscribing to author
   */
  public onSubscribeAuthor(callback: (author: AuthorCatalogEntry) => Promise<void>): void {
    this.onSubscribeAuthorCallback = callback;
  }

  /**
   * Set callback for unsubscribing from author
   */
  public onUnsubscribeAuthor(callback: (subscriptionId: string, authorName: string, authorUrl: string, platform: Platform) => Promise<void>): void {
    this.onUnsubscribeAuthorCallback = callback;
  }

  /**
   * Set callback for UI-initiated deletions
   * This is called before a file is deleted to prevent double refresh
   */
  public onUIDelete(callback: (filePath: string) => void): void {
    this.onUIDeleteCallback = callback;
  }

  /**
   * Set callback for UI-initiated modifications
   * This is called before a file is modified to prevent double refresh
   */
  public onUIModify(callback: (filePath: string) => void): void {
    this.onUIModifyCallback = callback;
  }

  /**
   * Set callback for tag changes (to refresh TagChipBar in timeline)
   */
  public onTagsChanged(callback: () => void): void {
    this.onTagsChangedCallback = callback;
  }

  /**
   * Set callback for reader mode activation
   */
  public onReaderMode(callback: (post: PostData) => void): void {
    this.onReaderModeCallback = callback;
  }

  /**
   * Set subscriptions cache for quick subscription status lookup
   * Called by TimelineContainer after fetching subscriptions from API
   */
  public setSubscriptionsCache(subscriptions: Array<{ id: string; platform: string; target: { handle: string; profileUrl?: string } }>): void {
    this.subscriptionsCache.clear();
    for (const sub of subscriptions) {
      // Key by normalized profile URL or handle
      const profileUrl = sub.target.profileUrl;
      if (profileUrl) {
        const normalizedUrl = this.normalizeUrlForComparison(profileUrl);
        this.subscriptionsCache.set(`${sub.platform}:${normalizedUrl}`, {
          subscriptionId: sub.id,
          handle: sub.target.handle
        });
      }
      // Also key by handle for fallback matching
      if (sub.target.handle) {
        const normalizedHandle = sub.target.handle.toLowerCase().replace(/^@/, '');
        this.subscriptionsCache.set(`${sub.platform}:handle:${normalizedHandle}`, {
          subscriptionId: sub.id,
          handle: sub.target.handle
        });
      }
    }
  }

  /**
   * Add a single subscription to cache (called after successful subscribe)
   */
  public addSubscriptionToCache(subscription: { id: string; platform: string; target: { handle: string; profileUrl?: string } }): void {
    const profileUrl = subscription.target.profileUrl;
    if (profileUrl) {
      // Use full URL normalization to match getSubscriptionFromCache behavior
      // This handles post URLs -> base URLs (e.g., blog post URL -> origin)
      const normalized = normalizeAuthorUrl(profileUrl, subscription.platform as Platform);
      const normalizedUrl = normalized.url || this.normalizeUrlForComparison(profileUrl);
      this.subscriptionsCache.set(`${subscription.platform}:${normalizedUrl}`, {
        subscriptionId: subscription.id,
        handle: subscription.target.handle
      });
    }
    if (subscription.target.handle) {
      const normalizedHandle = subscription.target.handle.toLowerCase().replace(/^@/, '');
      this.subscriptionsCache.set(`${subscription.platform}:handle:${normalizedHandle}`, {
        subscriptionId: subscription.id,
        handle: subscription.target.handle
      });
    }
  }

  /**
   * Remove a subscription from cache by subscription ID (called after successful unsubscribe)
   */
  public removeSubscriptionFromCache(subscriptionId: string): void {
    // Find and remove all cache entries with this subscription ID
    const keysToRemove: string[] = [];
    this.subscriptionsCache.forEach((value, key) => {
      if (value.subscriptionId === subscriptionId) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach(key => this.subscriptionsCache.delete(key));
  }

  /**
   * Normalize URL for comparison (remove trailing slash, lowercase)
   */
  private normalizeUrlForComparison(url: string): string {
    if (!url) return '';
    return url.toLowerCase().replace(/\/+$/, '');
  }

  /**
   * Generate a badge key for tracking callbacks by author
   */
  private generateBadgeKey(authorUrl: string, platform: Platform): string {
    const normalizedUrl = this.normalizeUrlForComparison(authorUrl);
    return `${platform}:${normalizedUrl}`;
  }

  /**
   * Update all badges for a specific author when subscription status changes
   * Called after successful subscribe/unsubscribe to update other cards for same author
   */
  public updateBadgesForAuthor(authorUrl: string, platform: Platform, isSubscribed: boolean): void {
    const badgeKey = this.generateBadgeKey(authorUrl, platform);
    const callbacks = this.badgeUpdateCallbacks.get(badgeKey);
    if (callbacks) {
      callbacks.forEach(callback => callback(isSubscribed));
    }
  }

  /**
   * Find author entry from AuthorCatalogStore
   */
  public findAuthorEntry(authorUrl: string, platform: Platform): AuthorCatalogEntry | null {
    if (!authorUrl || platform === 'post') return null;

    try {
      const store = getAuthorCatalogStore();
      const state = get(store.state);
      const normalizedUrl = this.normalizeUrlForComparison(authorUrl);

      const author = state.authors.find(a => {
        const normalizedAuthorUrl = this.normalizeUrlForComparison(a.authorUrl);
        return normalizedAuthorUrl === normalizedUrl && a.platform === platform;
      });

      return author || null;
    } catch (e) {
      console.error('[PostCardRenderer] Error finding author:', e);
      return null;
    }
  }

  /**
   * Get subscription info from cache
   */
  public getSubscriptionFromCache(authorUrl: string, platform: Platform): { subscriptionId: string; handle: string } | null {
    if (!authorUrl || platform === 'post') return null;

    // Use full URL normalization (handles Medium, Substack, Tumblr post URLs -> base URLs)
    const normalized = normalizeAuthorUrl(authorUrl, platform);
    const normalizedUrl = normalized.url || this.normalizeUrlForComparison(authorUrl);
    const cacheKey = `${platform}:${normalizedUrl}`;
    if (this.subscriptionsCache.has(cacheKey)) {
      return this.subscriptionsCache.get(cacheKey) ?? null;
    }

    // Check by handle extracted from normalization or URL
    const handle = normalized.handle || (() => {
      try {
        const url = new URL(authorUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1]?.toLowerCase().replace(/^@/, '');
      } catch {
        return null;
      }
    })();

    if (handle) {
      const handleKey = `${platform}:handle:${handle}`;
      if (this.subscriptionsCache.has(handleKey)) {
        return this.subscriptionsCache.get(handleKey) ?? null;
      }
    }

    return null;
  }

  /**
   * Check if author is subscribed
   * Priority: 1) subscriptionsCache (fast, from API), 2) AuthorCatalogStore
   */
  public isAuthorSubscribed(authorUrl: string, platform: Platform): boolean {
    if (!authorUrl || platform === 'post') return false;

    // First check subscriptions cache (fast path)
    if (this.getSubscriptionFromCache(authorUrl, platform)) {
      return true;
    }

    // Fallback to AuthorCatalogStore
    const author = this.findAuthorEntry(authorUrl, platform);
    return author?.status === 'subscribed';
  }

  /**
   * Get worker URL with mobile fallback
   * On mobile, always use production API since localhost doesn't work
   */
  private getWorkerUrl(): string {
    const configuredUrl = this.plugin.settings.workerUrl || 'https://social-archiver-api.social-archive.org';

    // On mobile, force production API if localhost is configured
    if (ObsidianPlatform.isMobile && configuredUrl.includes('localhost')) {
      return 'https://social-archiver-api.social-archive.org';
    }

    return configuredUrl;
  }

  /**
   * Main render method for post card
   * Returns the root element (wrapper if comment exists, otherwise cardContainer)
   */
  public async render(container: HTMLElement, post: PostData, isEmbedded: boolean = false): Promise<HTMLElement> {
    // Check if post is in archiving state - show loading placeholder
    if (post.archiveStatus === 'archiving') {
      return this.renderArchivingPlaceholder(container, post);
    }

    // Check if post is in failed state - show error message
    if (post.archiveStatus === 'failed') {
      return this.renderFailedPlaceholder(container, post);
    }

    // Always create wrapper for entire card (for consistent structure)
    const wrapper = container.createDiv({ cls: 'mb-2' }); // Reduced spacing between cards
    const rootElement: HTMLElement = wrapper;

    const userName = this.plugin.settings.username || 'You';
    const archivedTime = this.getRelativeTime(post.archivedDate);

    if (post.comment) {
      // Comment section container (editable)
      const commentSection = wrapper.createDiv({ cls: 'mb-3' });
      commentSection.addClass('sa-relative');
      commentSection.addClass('sa-clickable');

      // Comment header: "Jun commented on this post · 2h ago"
      const commentHeader = commentSection.createDiv({ cls: 'mb-2' });
      commentHeader.addClass('sa-text-base');
      commentHeader.addClass('sa-text-muted');

      commentHeader.createSpan({ text: userName, cls: 'pcr-comment-username' });

      // Use "commented on this user" for profile documents
      const commentOnText = post.type === 'profile' ? ' commented on this user' : ' commented on this post';
      commentHeader.createSpan({ text: commentOnText });

      // Add archived time
      if (archivedTime) {
        commentHeader.createSpan({ text: ` · ${archivedTime}` });
      }

      // Comment text with inline edit icon
      const commentTextContainer = commentSection.createDiv();
      commentTextContainer.addClass('sa-inline-block');

      const commentTextDiv = commentTextContainer.createSpan();
      commentTextDiv.addClass('sa-text-md');
      commentTextDiv.addClass('sa-leading-normal');
      commentTextDiv.addClass('sa-text-normal');
      this.renderMarkdownLinks(commentTextDiv, post.comment, undefined, post.platform);

      // Edit icon (appears on hover, inline at the end of text)
      const editIcon = commentTextContainer.createSpan();
      editIcon.addClass('sa-inline-flex');
      editIcon.addClass('sa-ml-4');
      editIcon.addClass('sa-icon-14');
      editIcon.addClass('sa-opacity-0');
      editIcon.addClass('sa-transition-opacity');
      editIcon.addClass('sa-text-muted');
      editIcon.addClass('pcr-edit-icon-inline');
      setIcon(editIcon, 'pencil');

      // Hover effects
      commentSection.addEventListener('mouseenter', () => {
        editIcon.removeClass('sa-opacity-0');
        editIcon.addClass('sa-opacity-60');
      });
      commentSection.addEventListener('mouseleave', () => {
        editIcon.removeClass('sa-opacity-60');
        editIcon.addClass('sa-opacity-0');
      });

      // Click to edit inline
      commentSection.addEventListener('click', (e) => {
        e.stopPropagation();
        // Don't trigger edit if user is selecting text
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          return;
        }
        this.editCommentInline(post, commentSection);
      });
    } else if (post.platform !== 'post') {
      // Saved header: "Jun saved this post/user · 2h ago" (clickable to add note inline)
      // Only show for archived social media posts, not user posts
      const savedSection = wrapper.createDiv({ cls: 'mb-3' });
      savedSection.addClass('sa-relative');
      savedSection.addClass('sa-clickable');

      const savedHeader = savedSection.createDiv();
      savedHeader.addClass('sa-text-base');
      savedHeader.addClass('sa-text-muted');
      savedHeader.addClass('sa-inline-block');

      savedHeader.createSpan({ text: userName, cls: 'pcr-comment-username' });

      // Use "saved this user" for profile documents, "saved this place" for Google Maps, "saved this post" for regular posts
      let savedText = ' saved this post';
      if (post.type === 'profile') {
        savedText = ' saved this user';
      } else if (post.platform === 'googlemaps') {
        savedText = ' saved this place';
      }
      savedHeader.createSpan({ text: savedText });

      // Add archived time
      if (archivedTime) {
        savedHeader.createSpan({ text: ` · ${archivedTime}` });
      }

      // Edit icon (appears on hover, inline at the end)
      const editIcon = savedSection.createSpan();
      editIcon.addClass('sa-inline-flex');
      editIcon.addClass('sa-ml-4');
      editIcon.addClass('sa-icon-14');
      editIcon.addClass('sa-opacity-0');
      editIcon.addClass('sa-transition-opacity');
      editIcon.addClass('sa-text-muted');
      editIcon.addClass('pcr-edit-icon-inline');
      setIcon(editIcon, 'pencil');

      // Hover effects - only show icon
      savedSection.addEventListener('mouseenter', () => {
        editIcon.removeClass('sa-opacity-0');
        editIcon.addClass('sa-opacity-60');
      });
      savedSection.addEventListener('mouseleave', () => {
        editIcon.removeClass('sa-opacity-60');
        editIcon.addClass('sa-opacity-0');
      });

      // Click to add note inline (same as comment editing)
      savedSection.addEventListener('click', (e) => {
        e.stopPropagation();
        // Don't trigger edit if user is selecting text
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          return;
        }
        this.editCommentInline(post, savedSection);
      });
    }

    // Create nested container for the actual card (always nested now)
    // For user posts (platform === 'post'), don't show left border
    const cardContainer = wrapper.createDiv();
    cardContainer.addClass('sa-w-full');
    if (post.platform === 'post') {
      cardContainer.addClass('sa-p-0');
    } else {
      cardContainer.addClass('pcr-card-container-nested');
    }

    const card = cardContainer.createDiv({
      cls: 'relative rounded-lg bg-[var(--background-primary)]'
    });
    card.addClass('pcr-card');

    // Content area
    const contentArea = card.createDiv({ cls: 'post-content-area' });
    contentArea.addClass('sa-w-full');
    contentArea.addClass('sa-overflow-hidden');

    // For profile documents, render a compact profile card instead of regular content
    if (post.type === 'profile') {
      this.renderProfileCard(contentArea, post);
      return rootElement;
    }

    // Google Maps has a specialized card layout (Yelp/native style)
    if (post.platform === 'googlemaps') {
      this.renderGoogleMapsHeader(contentArea, post);
      this.renderGoogleMapsBusinessInfo(contentArea, post);
    } else {
      // Header: Author + Time + Avatar (in same line)
      this.renderHeader(contentArea, post);

      // Content (full text with expand/collapse)
      await this.renderContent(contentArea, post);
    }

    // YouTube embed (if YouTube platform)
    if (post.platform === 'youtube') {
      // Extract video ID first - this takes priority
      let videoId = post.videoId;
      if (!videoId && post.url) {
        videoId = this.extractYouTubeVideoId(post.url) || undefined;
      }

      // Check if video was downloaded with yt-dlp (actual video file, not thumbnail)
      const downloadedVideoFile = await this.findDownloadedVideo(post);
      const downloadedVideoPath = downloadedVideoFile ? null : await this.findDownloadedVideoPath(post);

      // Track video element/controller for transcript integration
      let videoEl: HTMLVideoElement | undefined;
      let ytController: YouTubePlayerController | undefined;

      if (downloadedVideoFile) {
        // Render local video file with fallback to iframe on error
        videoEl = this.renderLocalVideoWithRef(contentArea, downloadedVideoFile, post);
      } else if (downloadedVideoPath) {
        // Vault index can lag right after download; render directly from path.
        videoEl = this.renderLocalVideoWithRef(contentArea, downloadedVideoPath, post);
      } else if (videoId) {
        // Render YouTube iframe (prioritize this over local thumbnail images)
        const iframe = this.youtubeEmbedRenderer.renderYouTube(contentArea, videoId, isEmbedded);

        // Create player controller for this YouTube video
        const controller = new YouTubePlayerController(iframe);
        this.youtubeControllers.set(post.id, controller);
        ytController = controller;
      } else {
        // Fallback: Check if media is available (e.g., from embeddedArchives with local video)
        const hasLocalVideo = post.media && post.media.length > 0 &&
          post.media.some(m => m.type === 'video' && !m.url.startsWith('http'));

        if (hasLocalVideo) {
          // Render local video from media (for embeddedArchives)
          this.mediaGalleryRenderer.render(contentArea, post.media, post);
        }
      }

      // Render transcript below video if transcript data is available
      const hasTranscript = (post.transcript?.formatted && post.transcript.formatted.length > 0)
        || (post.whisperTranscript?.segments && post.whisperTranscript.segments.length > 0);

      if (hasTranscript && (videoEl || ytController)) {
        const player = new VideoTranscriptPlayer(this.app);
        player.render(contentArea, post, {
          videoElement: videoEl,
          youtubeController: ytController
        });
        this.videoTranscriptPlayers.set(post.id, player);
      }
    }
    // TikTok embed (if TikTok platform)
    else if (post.platform === 'tiktok' && post.url) {
      // Check if we have local video in media (excluding CDN URLs)
      const hasLocalVideo = post.media && post.media.length > 0 &&
        post.media.some(m =>
          m.type === 'video' &&
          !m.url.startsWith('http') &&
          !m.url.includes('tiktok.com/video/')
        );

      if (hasLocalVideo) {
        // Render local video instead of iframe
        this.mediaGalleryRenderer.render(contentArea, post.media, post);
      } else {
        // Use original URL (not CDN URL) for TikTok embed
        // Pass both URL and ID - ID will be used for short URLs like vt.tiktok.com
        this.youtubeEmbedRenderer.renderTikTok(contentArea, post.url, post.id);
      }
    }
    // Google Maps embed (show location map)
    else if (post.platform === 'googlemaps') {
      this.renderGoogleMapsEmbed(contentArea, post);
    }

    // Media carousel (only show if no embedded archives exist AND not YouTube/TikTok)
    // YouTube and TikTok already have their video embeds rendered above
    // If embedded archives exist, media will be shown in the embedded cards instead
    const hasEmbeddedArchives = post.embeddedArchives && post.embeddedArchives.length > 0;

    // For reblogs, media will be shown in the quotedPost card instead
    const isReblogWithQuote = post.isReblog && post.quotedPost;

    // Check if TikTok/YouTube has local media (if so, it was already rendered above)
    const isVideoEmbed = post.platform === 'youtube' || post.platform === 'tiktok';
    const hasLocalVideoForEmbed = isVideoEmbed && post.media && post.media.length > 0 &&
      post.media.some(m => m.type === 'video' && !m.url.startsWith('http'));

    // RSS-based platforms and X articles render images inline with content, so skip media gallery
    // Exception: podcast platform needs audio player rendered via media gallery
    // Exception: blog with audio media should also render audio player (podcast-like feeds without iTunes namespace)
    const hasAudioMedia = post.media.some(m => m.type === 'audio');
    const isXArticleWithInline = post.platform === 'x' && !!post.content.rawMarkdown;
    const isBlogWithInlineImages = (isRssBasedPlatform(post.platform) && post.platform !== 'podcast' && !hasAudioMedia && post.content.rawMarkdown) || isXArticleWithInline;

    if (post.media.length > 0 && !hasEmbeddedArchives && !isReblogWithQuote && !isVideoEmbed && !hasLocalVideoForEmbed && !isBlogWithInlineImages) {
      // Use renderWithTranscript for podcast/audio posts to display Whisper transcripts
      if (post.platform === 'podcast' || hasAudioMedia) {
        this.mediaGalleryRenderer.renderWithTranscript(contentArea, post.media, post);
      } else {
        this.mediaGalleryRenderer.render(contentArea, post.media, post);
      }
    }

    // Show transcription intent banner for notes with local video attachments.
    // For YouTube/TikTok, render it inside renderArchiveSuggestions so it appears
    // where the download banner was shown.
    if (!isEmbedded && post.platform !== 'podcast' && post.platform !== 'youtube' && post.platform !== 'tiktok') {
      await this.renderVideoTranscriptionSuggestion(contentArea, post, rootElement);
    }

    // Link previews (if any) - Don't show if embedded archives exist (already showing the archived post)
    if (post.linkPreviews && post.linkPreviews.length > 0 && !hasEmbeddedArchives) {
      // Create a wrapper for link previews + archive suggestion
      const linkPreviewWrapper = contentArea.createDiv();
      linkPreviewWrapper.addClass('sa-mb-0');

      // Filter out downloaded videos from link previews
      const downloadedUrls: string[] = Array.isArray((post as unknown as Record<string, unknown>).downloadedUrls) ? ((post as unknown as Record<string, unknown>).downloadedUrls as string[]) : [];
      const { YtDlpDetector } = await import('@/utils/yt-dlp');

      const linkPreviewsToShow = post.linkPreviews.filter(url => {
        // Filter out invalid/truncated URLs first
        if (!isValidPreviewUrl(url)) return false;
        const isDownloaded = downloadedUrls.some(p => p === `downloaded:${url}`);
        return !isDownloaded || !YtDlpDetector.isSupportedUrl(url);
      });

      // Delete callback for link previews
      const onDeletePreview = async (url: string) => {
        await this.deleteLinkPreview(post, url, rootElement);
      };

      if (linkPreviewsToShow.length > 0) {
        await this.linkPreviewRenderer.renderPreviews(linkPreviewWrapper, linkPreviewsToShow, onDeletePreview);
      }
    }

    // Embedded archives + Downloaded videos - Compact cards
    const downloadedVideos: PostData[] = [];

    // Collect downloaded videos (skip if already in post.media)
    const hasVideoInMedia = post.media && post.media.some(m => m.type === 'video');

    if (!hasVideoInMedia && post.linkPreviews && post.linkPreviews.length > 0) {
      const downloadedUrls: string[] = Array.isArray((post as unknown as Record<string, unknown>).downloadedUrls) ? ((post as unknown as Record<string, unknown>).downloadedUrls as string[]) : [];
      const { YtDlpDetector } = await import('@/utils/yt-dlp');

      for (const url of post.linkPreviews) {
        const isDownloaded = downloadedUrls.some(p => p === `downloaded:${url}`);

        if (isDownloaded && YtDlpDetector.isSupportedUrl(url)) {
          // Check processedUrls status
              const postRec4 = post as unknown as Record<string, unknown>;
    const processedUrls: string[] = Array.isArray(postRec4.processedUrls) ? (postRec4.processedUrls as string[]) : [];
          const isArchived = processedUrls.some(p => !p.startsWith('declined:') && p.includes(url));
          const isDeclined = processedUrls.some(p => p.startsWith('declined:') && p.includes(url));
          const isNotProcessed = !processedUrls.some(p => p.includes(url));

          // Only create downloadedVideo if NOT archived (not processed OR declined)
          // This shows video-only card when user downloaded video but didn't archive the post
          if (isNotProcessed || isDeclined) {
            const videoFile = await this.findDownloadedVideoByUrl(post, url);
            if (videoFile) {
              const platform = this.detectPlatformFromUrl(url);
              const videoPostData: PostData = {
                id: videoFile.name,
                platform: platform as Platform,
                url: url,
                author: {
                  name: platform.toUpperCase(),
                  url: url
                },
                content: {
                  text: ''
                },
                media: [{
                  type: 'video',
                  url: videoFile.path
                }],
                metadata: {
                  timestamp: new Date(videoFile.stat.mtime)
                },
                filePath: post.filePath,
                archivedDate: new Date(videoFile.stat.mtime),
                comments: [],
                linkPreviews: []
              };

              downloadedVideos.push(videoPostData);
            }
          } else if (isArchived) {
            // Post is archived, no download action needed
          }
        }
      }
    }

    // Render quoted/shared/reblogged post (Facebook, X, Threads, Mastodon, Bluesky)
    // Only render quotedPost for top-level posts (isEmbedded=false)
    // Embedded posts should not render their quotedPost to prevent nesting
    // Render quotedPost for:
    // 1. Top-level posts (isEmbedded=false) - always render
    // 2. Embedded archives (isEmbedded=true) - render if it's an expanded view (has quotedPost)
    if (post.quotedPost) {
      const quotedPostContainer = contentArea.createDiv();
      // For reblogs, reduce top margin since there's no content above
      quotedPostContainer.addClass('sa-mb-12');
      if (post.isReblog) {
        quotedPostContainer.addClass('sa-mt-4');
      } else {
        quotedPostContainer.addClass('sa-mt-12');
      }

      this.compactPostCardRenderer.setOnExpandCallback(async (embeddedPost, expandedContainer) => {
        // For self-boost: inject parent's localAvatar into embeddedPost if same author
        const enrichedPost = this.enrichWithParentAvatar(embeddedPost, post);
        await this.renderFullPostInline(enrichedPost, expandedContainer);
      });
      // Set parent post for self-boost avatar lookup
      this.compactPostCardRenderer.setParentPost(post);
      this.compactPostCardRenderer.render(quotedPostContainer, post.quotedPost);
    }

    // Render embedded archives + downloaded videos together
    // Only render for top-level posts (isEmbedded=false) to prevent nesting
    if (!isEmbedded && ((post.embeddedArchives && post.embeddedArchives.length > 0) || downloadedVideos.length > 0)) {
      // Container for embedded archives
      const embeddedContainer = contentArea.createDiv();
      embeddedContainer.addClass('sa-mt-8');
      embeddedContainer.addClass('sa-flex-col');
      embeddedContainer.addClass('sa-gap-8');

      // Set expand callback to render full post inline
      this.compactPostCardRenderer.setOnExpandCallback(async (embeddedPost, expandedContainer) => {
        await this.renderFullPostInline(embeddedPost, expandedContainer);
      });

      // Render downloaded videos first
      for (const videoPost of downloadedVideos) {
        this.compactPostCardRenderer.render(embeddedContainer, videoPost);
      }

      // Then render embedded archives
      if (post.embeddedArchives) {
        for (const embeddedPost of post.embeddedArchives) {
              const downloadedUrls: string[] = Array.isArray(embeddedPost.downloadedUrls) ? embeddedPost.downloadedUrls : [];

          // Check if local video exists for this embedded archive
          const hasLocalVideoMarker = downloadedUrls.some((entry) => {
            if (!entry.startsWith('downloaded:')) return false;
            const downloadedUrl = entry.substring('downloaded:'.length);
            return downloadedUrl === embeddedPost.url
              || downloadedUrl.includes(embeddedPost.url)
              || embeddedPost.url.includes(downloadedUrl);
          });

          if (hasLocalVideoMarker) {
            // Find local video file
            const videoFile = await this.findDownloadedVideoByUrl(post, embeddedPost.url);
            if (videoFile) {
              // Replace media with local video (whether media exists or not)
              embeddedPost.media = [{
                type: 'video',
                url: videoFile.path
              }];
            }
            // No fallback to parent media — copying the parent's local video
            // causes the same video to render in both the parent card and
            // the embedded archive card, resulting in duplicate players.
          }

          this.compactPostCardRenderer.render(embeddedContainer, embeddedPost);
        }
      }
    }

    // Archive suggestions for user posts with unprocessed social media URLs
    // Also render download suggestions for TikTok/YouTube main posts and podcast audio
    // Render after embedded archives/downloaded videos, before interaction bar
    if (post.platform === 'post' || post.platform === 'youtube' || post.platform === 'tiktok' || post.platform === 'podcast') {
      await this.renderArchiveSuggestions(contentArea, post, rootElement, isEmbedded);
    }

    // Tag chips row (only for non-embedded posts)
    if (!isEmbedded) {
      this.renderTagChips(contentArea, post, rootElement);
    }

    // Interaction bar (always render to show action buttons)
    // Social interaction counts will be hidden inside renderInteractions if embedded archives exist
    // For reblogs, skip interaction bar on main card (original post already shows engagement)
    const hasInteractions =
      (post.metadata.likes !== undefined && post.metadata.likes > 0) ||
      (post.metadata.comments !== undefined && post.metadata.comments > 0) ||
      (post.metadata.shares !== undefined && post.metadata.shares > 0) ||
      (post.metadata.views !== undefined && post.metadata.views > 0);

    if (hasInteractions) {
      this.renderInteractions(contentArea, post, rootElement, isEmbedded);
    } else {
      // Even without social interactions, still render action buttons for user posts
      const actionsBar = contentArea.createDiv();
      actionsBar.addClass('sa-flex');
      actionsBar.addClass('sa-flex-row');
      actionsBar.addClass('sa-gap-16');
      actionsBar.addClass('sa-flex-wrap');
      actionsBar.addClass('sa-py-8');
      actionsBar.addClass('sa-mt-8');
      actionsBar.addClass('sa-text-muted');
      actionsBar.addClass('pcr-actions-end');
      if (!isEmbedded) {
        actionsBar.addClass('pcr-actions-border-top');
      }

      // Personal Like button
      this.renderPersonalLikeButton(actionsBar, post);

      // Share button
      this.renderShareButton(actionsBar, post);

      // Archive button
      this.renderArchiveButton(actionsBar, post, rootElement);

      // Open Note button
      this.renderOpenNoteButton(actionsBar, post);

      // Edit button (only for user posts)
      if (post.platform === 'post') {
        this.renderEditButton(actionsBar, post);
      }

      // Delete button
      this.renderDeleteButton(actionsBar, post, rootElement);
    }

    // Comments section - AI comments, regular comments, then AI comment banner at bottom
    // Only for non-embedded posts
    if (!isEmbedded) {
      const hasRegularComments = post.platform !== 'post' && post.comments && post.comments.length > 0;

      // 1. Render existing AI comments first (top)
      await this.renderExistingAIComments(contentArea, post, rootElement);

      // 2. Render regular comments below AI comments
      if (hasRegularComments && post.comments) {
        this.commentRenderer.render(contentArea, post.comments, post.platform, post.author);
      }

      // 3. Render AI comment banner at the bottom (only if no existing AI comments)
      const showBanner = await this.shouldShowAICommentBanner(post);
      if (showBanner) {
        const hasExistingComments = rootElement.querySelector('.ai-comment-renderer-container .ai-comment-item');
        if (!hasExistingComments) {
          await this.renderAICommentBanner(contentArea, post, rootElement);
        }
      }
    } else {
      // For embedded posts, only render regular comments (no AI comments)
      if (post.platform !== 'post' && post.comments && post.comments.length > 0) {
        this.commentRenderer.render(contentArea, post.comments, post.platform, post.author);
      }
    }

    // Mobile long-press → open reader mode (400ms hold, cancel on move > 10px)
    if (ObsidianPlatform.isMobile && !isEmbedded) {
      this.attachLongPress(card, post);
    }

    return rootElement;
  }

  /**
   * Get avatar image source with priority: localAvatar > avatar > null
   */
  private getAvatarSrc(post: PostData): string | null {
    // Priority 1: Local avatar (vault file)
    if (post.author.localAvatar) {
      // Use vault.adapter.getResourcePath with path string (same as AuthorRow)
      return this.app.vault.adapter.getResourcePath(post.author.localAvatar);
    }
    // Priority 2: External avatar URL
    if (post.author.avatar) {
      return post.author.avatar;
    }
    return null;
  }

  /**
   * Get initials from author name
   */
  private getAuthorInitials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
      const first = parts[0]?.[0] ?? '';
      const last = parts[parts.length - 1]?.[0] ?? '';
      return (first + last).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  /**
   * Render avatar (author image with platform badge) inline with header
   */
  private renderAvatarInline(header: HTMLElement, post: PostData): void {
    const avatarContainer = header.createDiv({ cls: 'author-avatar-container' });
    avatarContainer.addClass('sa-flex-shrink-0');
    avatarContainer.addClass('sa-icon-40');
    avatarContainer.addClass('sa-relative');
    avatarContainer.addClass('sa-clickable');
    avatarContainer.addClass('sa-transition-opacity');

    // For user posts (platform: 'post'), show user initial avatar
    if (post.platform === 'post') {
      avatarContainer.setAttribute('title', 'View this post');

      // Add click handler to open share URL
      const shareUrl = post.shareUrl;
      if (shareUrl) {
        avatarContainer.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(shareUrl, '_blank');
        });
      }

      // Create circular avatar with user initial
      const userName = this.plugin.settings.username || 'You';
      const userInitial = userName.charAt(0).toUpperCase();

      const avatar = avatarContainer.createDiv();
      avatar.addClass('sa-icon-40');
      avatar.addClass('sa-rounded-full');
      avatar.addClass('sa-bg-accent');
      avatar.addClass('sa-text-lg');
      avatar.addClass('sa-font-semibold');
      avatar.addClass('pcr-avatar-accent');
      avatar.textContent = userInitial;
    } else {
      // For archived posts: show author avatar with platform badge
      const targetUrl = post.author.url || this.getPostOriginalUrl(post);
      if (targetUrl) {
        avatarContainer.setAttribute('title', `Visit ${post.author.name}'s profile`);
        avatarContainer.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(targetUrl, '_blank');
        });
      }

      const avatarSrc = this.getAvatarSrc(post);

      if (avatarSrc) {
        // Show actual avatar image
        const avatarImg = avatarContainer.createEl('img');
        avatarImg.loading = 'lazy';
        avatarImg.addClass('sa-icon-40');
        avatarImg.addClass('sa-rounded-full');
        avatarImg.addClass('sa-object-cover');
        avatarImg.src = avatarSrc;
        avatarImg.alt = post.author.name;

        // Fallback to initials on image error
        avatarImg.onerror = () => {
          avatarImg.addClass('sa-hidden');
          const fallback = avatarContainer.createDiv();
          fallback.addClass('sa-icon-40');
          fallback.addClass('sa-rounded-full');
          fallback.addClass('sa-text-md');
          fallback.addClass('sa-font-semibold');
          fallback.addClass('pcr-avatar-fallback');
          fallback.textContent = this.getAuthorInitials(post.author.name);
        };
      } else {
        // No avatar: show initials
        const initialsAvatar = avatarContainer.createDiv();
        initialsAvatar.addClass('sa-icon-40');
        initialsAvatar.addClass('sa-rounded-full');
        initialsAvatar.addClass('sa-text-md');
        initialsAvatar.addClass('sa-font-semibold');
        initialsAvatar.addClass('pcr-avatar-fallback');
        initialsAvatar.textContent = this.getAuthorInitials(post.author.name);
      }
    }

    avatarContainer.addEventListener('mouseenter', () => {
      avatarContainer.removeClass('sa-opacity-100');
      avatarContainer.addClass('sa-opacity-80');
    });

    avatarContainer.addEventListener('mouseleave', () => {
      avatarContainer.removeClass('sa-opacity-80');
      avatarContainer.addClass('sa-opacity-100');
    });
  }

  /**
   * Render a compact profile card for profile-only documents
   * Shows avatar, name, bio, and stats in a compact format
   */
  private renderProfileCard(contentArea: HTMLElement, post: PostData): void {
    const profileMeta = post.profileMetadata;
    const handle = profileMeta?.handle || post.author.handle || 'Unknown';
    const displayName = profileMeta?.displayName || post.author.name || handle;

    // Main container with horizontal layout
    const profileContainer = contentArea.createDiv();
    profileContainer.addClass('pcr-profile-container');

    // Left: Large avatar
    const avatarContainer = profileContainer.createDiv();
    avatarContainer.addClass('sa-flex-shrink-0');

    const avatarSize = ObsidianPlatform.isMobile ? 56 : 64;
    const avatar = avatarContainer.createDiv();
    avatar.addClass('sa-rounded-full');
    avatar.addClass('sa-overflow-hidden');
    avatar.addClass('sa-flex-center');
    avatar.addClass('sa-dynamic-width');
    avatar.addClass('sa-dynamic-height');
    avatar.addClass('pcr-avatar-bg');
    avatar.setCssProps({'--sa-width': `${avatarSize}px`, '--sa-height': `${avatarSize}px`});

    // Load avatar image
    const avatarUrl = post.author.localAvatar
      ? this.app.vault.adapter.getResourcePath(post.author.localAvatar)
      : post.author.avatar;

    if (avatarUrl) {
      const img = avatar.createEl('img');
      img.loading = 'lazy';
      img.src = avatarUrl;
      img.alt = displayName;
      img.addClass('sa-cover');
      img.onerror = () => {
        img.remove();
        avatar.setText(displayName.charAt(0).toUpperCase());
        avatar.addClass('sa-text-2xl');
        avatar.addClass('sa-font-semibold');
        avatar.addClass('sa-text-muted');
      };
    } else {
      avatar.setText(displayName.charAt(0).toUpperCase());
      avatar.addClass('sa-text-2xl');
      avatar.addClass('sa-font-semibold');
      avatar.addClass('sa-text-muted');
    }

    // Right: Profile info
    const infoContainer = profileContainer.createDiv();
    infoContainer.addClass('sa-flex-1');
    infoContainer.addClass('sa-min-w-0');

    // Name and handle row
    const nameRow = infoContainer.createDiv();
    nameRow.addClass('sa-flex-row');
    nameRow.addClass('sa-gap-6');
    nameRow.addClass('sa-mb-4');

    // Display name
    const nameEl = nameRow.createEl('strong', { text: displayName });
    nameEl.addClass(ObsidianPlatform.isMobile ? 'sa-text-md' : 'sa-text-lg');
    nameEl.addClass('sa-text-normal');
    nameEl.addClass('sa-truncate');

    // Verified badge
    if (profileMeta?.verified || post.author.verified) {
      const verifiedBadge = nameRow.createSpan();
      verifiedBadge.addClass('sa-text-accent');
      verifiedBadge.addClass('sa-flex-row');
      setIcon(verifiedBadge, 'badge-check');
      verifiedBadge.setAttribute('title', 'Verified');
    }

    // Platform icon
    const platformIcon = getPlatformSimpleIcon(post.platform, post.author.url);
    if (platformIcon) {
      const iconWrapper = nameRow.createDiv();
      iconWrapper.addClass('sa-icon-14');
      iconWrapper.addClass('sa-opacity-50');
      const svg = createSVGElement(platformIcon, {
        fill: 'var(--text-muted)',
        width: '100%',
        height: '100%'
      });
      iconWrapper.appendChild(svg);
    }

    // Handle
    const handleEl = infoContainer.createDiv({ text: `@${handle}` });
    handleEl.addClass(ObsidianPlatform.isMobile ? 'sa-text-sm' : 'sa-text-base');
    handleEl.addClass('sa-text-muted');
    handleEl.addClass('sa-mb-8');

    // Make handle clickable to open profile
    if (profileMeta?.profileUrl || post.url) {
      handleEl.addClass('sa-clickable');
      handleEl.addClass('sa-transition-color');
      handleEl.addEventListener('click', () => {
        window.open(profileMeta?.profileUrl || post.url, '_blank');
      });
      handleEl.addEventListener('mouseenter', () => {
        handleEl.removeClass('sa-text-muted');
        handleEl.addClass('sa-text-accent');
      });
      handleEl.addEventListener('mouseleave', () => {
        handleEl.removeClass('sa-text-accent');
        handleEl.addClass('sa-text-muted');
      });
    }

    // Bio
    if (profileMeta?.bio) {
      const bioEl = infoContainer.createDiv({ text: profileMeta.bio });
      bioEl.addClass(ObsidianPlatform.isMobile ? 'sa-text-sm' : 'sa-text-base');
      bioEl.addClass('sa-text-normal');
      bioEl.addClass('sa-mb-8');
      bioEl.addClass('sa-overflow-hidden');
      bioEl.addClass('pcr-bio-clamp');
    }

    // Stats row
    const statsRow = infoContainer.createDiv();
    statsRow.addClass('sa-flex');
    statsRow.addClass('sa-gap-12');
    statsRow.addClass(ObsidianPlatform.isMobile ? 'sa-text-xs' : 'sa-text-sm');
    statsRow.addClass('sa-text-muted');

    // Helper to format numbers
    const formatNumber = (num: number | undefined): string => {
      if (num === undefined || num === null) return '0';
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return num.toLocaleString();
    };

    // Stats items
    const stats = [
      { label: 'Followers', value: profileMeta?.followers },
      { label: 'Following', value: profileMeta?.following },
      { label: 'Posts', value: profileMeta?.postsCount },
    ].filter(s => s.value !== undefined);

    for (const stat of stats) {
      const statEl = statsRow.createSpan();
      const valueSpan = statEl.createSpan({ text: formatNumber(stat.value) });
      valueSpan.addClass('sa-font-semibold');
      valueSpan.addClass('sa-text-normal');
      statEl.createSpan({ text: ` ${stat.label}` });
    }

    // Location (if available) - on separate line
    if (profileMeta?.location) {
      const locationRow = infoContainer.createDiv();
      locationRow.addClass('sa-flex-row');
      locationRow.addClass('sa-gap-4');
      locationRow.addClass('sa-mt-4');
      locationRow.addClass(ObsidianPlatform.isMobile ? 'sa-text-xs' : 'sa-text-sm');
      locationRow.addClass('sa-text-muted');
      const locIcon = locationRow.createSpan();
      locIcon.addClass('sa-icon-12');
      setIcon(locIcon, 'map-pin');
      locationRow.createSpan({ text: profileMeta.location });
    }

    // Action bar for profile cards (no social counts, no share button)
    const actionsBar = contentArea.createDiv();
    actionsBar.addClass('sa-flex-between');
    actionsBar.addClass('sa-gap-16');
    actionsBar.addClass('sa-py-8');
    actionsBar.addClass('sa-mt-8');
    actionsBar.addClass('sa-text-muted');
    actionsBar.addClass('pcr-actions-border-top');

    // Personal Like button (star)
    this.renderPersonalLikeButton(actionsBar, post);

    // Archive button
    // Note: rootElement is not available here, pass contentArea.parentElement as fallback
    const rootElement = contentArea.parentElement?.parentElement?.parentElement || contentArea;
    this.renderArchiveButton(actionsBar, post, rootElement);

    // Open Note button
    this.renderOpenNoteButton(actionsBar, post);

    // Delete button
    this.renderDeleteButton(actionsBar, post, rootElement);
  }

  /**
   * Render header (avatar + author name + timestamp - social media style)
   */
  private renderHeader(contentArea: HTMLElement, post: PostData): void {
    const header = contentArea.createDiv({ cls: 'mb-2' });
    header.addClass('sa-flex-row');
    header.addClass('sa-gap-10');

    // Left: Avatar (social media style - avatar on left)
    this.renderAvatarInline(header, post);

    // Middle section: Author name + timestamp
    const middleSection = header.createDiv();
    middleSection.addClass('sa-flex-1');
    middleSection.addClass('pcr-middle-section');

    // Author name row with subscription badge
    const authorNameRow = middleSection.createDiv();
    authorNameRow.addClass('sa-flex-row');
    authorNameRow.addClass('sa-gap-6');

    // Author name - for 'post' type, use current username
    // For podcasts: use channelTitle (podcast show name), author.handle contains episode author
    let displayName: string;
    if (post.platform === 'post') {
      displayName = this.plugin.settings.username || 'You';
    } else if (post.platform === 'podcast') {
      // Podcast: show channel title (podcast show name)
      displayName = post.channelTitle || post.author.name;
    } else {
      displayName = post.author.name;
    }

    // Author name - click to open author URL
    const authorName = authorNameRow.createEl('strong', {
      text: displayName,
    });
    authorName.addClass('pcr-author-name');
    authorName.setCssProps({
      '--pcr-author-font-size': ObsidianPlatform.isMobile ? '13px' : '14px',
      '--pcr-author-max-width': ObsidianPlatform.isMobile ? '200px' : '320px'
    });

    if (post.author.url) {
      authorName.setAttribute('title', `Visit ${displayName}'s profile`);

      authorName.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(post.author.url, '_blank');
      });
    }

    // Subscription badge (only for supported platforms - Instagram, Facebook, LinkedIn, Reddit, TikTok, Pinterest, Bluesky, Mastodon, YouTube, Naver, Brunch, X, RSS platforms)
    // For Reddit: show for both subreddits (r/xxx) and user profiles (user/xxx or u/xxx)
    const isRedditSubreddit = post.platform === 'reddit' && post.author.url?.includes('/r/');
    const isRedditUser = post.platform === 'reddit' && (post.author.url?.includes('/user/') || post.author.url?.includes('/u/'));
    const showSubscriptionBadge = (
      post.platform === 'instagram' ||
      post.platform === 'facebook' ||
      post.platform === 'linkedin' ||
      post.platform === 'tiktok' ||
      post.platform === 'pinterest' ||
      post.platform === 'bluesky' ||
      post.platform === 'mastodon' ||
      post.platform === 'youtube' ||
      post.platform === 'naver' ||
      post.platform === 'brunch' ||
      post.platform === 'blog' ||
      post.platform === 'substack' ||
      post.platform === 'tumblr' ||
      post.platform === 'velog' ||
      post.platform === 'medium' ||
      post.platform === 'podcast' ||
      post.platform === 'x' ||
      isRedditSubreddit ||
      isRedditUser
    ) && post.author.url;
    if (showSubscriptionBadge) {
      const isSubscribed = this.isAuthorSubscribed(post.author.url, post.platform);
      this.renderSubscriptionBadge(authorNameRow, post, isSubscribed);
    }

    // Relative time row (with subreddit for Reddit, title for YouTube)
    const timeRow = middleSection.createDiv();
    timeRow.addClass('pcr-time-row');

    const timestamp = typeof post.metadata.timestamp === 'string'
      ? new Date(post.metadata.timestamp)
      : post.metadata.timestamp;

    const timeSpan = timeRow.createSpan({
      cls: 'text-xs text-[var(--text-muted)]'
    });
    timeSpan.addClass('pcr-nowrap');
    timeSpan.setText(this.getRelativeTime(timestamp));

    // For Podcasts: show episode author next to timestamp (if different from channel title)
    if (post.platform === 'podcast' && post.author.handle) {
      const separator = timeRow.createSpan({ text: '·', cls: 'text-xs text-[var(--text-muted)]' });
      separator.addClass('pcr-separator');

      const episodeAuthorSpan = timeRow.createSpan({
        text: `by ${post.author.handle}`,
        cls: 'text-xs text-[var(--text-muted)]'
      });
      episodeAuthorSpan.addClass('pcr-episode-author');
    }

    // For Reddit: show subreddit info (r/xxx) with link and subscribed badge
    if (post.platform === 'reddit' && post.content.community) {
      const separator = timeRow.createSpan({ text: '·', cls: 'text-xs text-[var(--text-muted)]' });
      separator.addClass('pcr-separator');

      const subredditLink = timeRow.createEl('a', {
        text: `r/${post.content.community.name}`,
        cls: 'text-xs pcr-community-link'
      });
      subredditLink.href = post.content.community.url;
      subredditLink.setAttribute('target', '_blank');
      subredditLink.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // For Naver: show cafe info with link (truncate long names)
    if (post.platform === 'naver' && post.content.community) {
      const separator = timeRow.createSpan({ text: '·', cls: 'text-xs text-[var(--text-muted)]' });
      separator.addClass('pcr-separator');

      const cafeLink = timeRow.createEl('a', {
        text: post.content.community.name,
        cls: 'text-xs pcr-cafe-link',
        attr: { title: post.content.community.name } // Show full name on hover
      });
      cafeLink.href = post.content.community.url;
      cafeLink.setAttribute('target', '_blank');
      cafeLink.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // Right: Platform icon link to original post (for non-user posts)
    if (post.platform !== 'post') {
      this.renderOriginalPostLink(header, post);
    }
  }

  /**
   * Render platform icon that links to the original post
   */
  private renderOriginalPostLink(header: HTMLElement, post: PostData): void {
    const targetUrl = this.getPostOriginalUrl(post);
    // For podcast: show icon even without URL (links to author/feed URL instead)
    const isPodcast = post.platform === 'podcast';
    const podcastFallbackUrl = isPodcast ? post.author.url : null;

    // Skip if no URL and not podcast
    if (!targetUrl && !isPodcast) return;

    const linkContainer = header.createDiv({ cls: 'platform-icon-badge pcr-platform-link' });
    const hasLink = targetUrl || podcastFallbackUrl;
    if (hasLink) {
      linkContainer.addClass('pcr-platform-link-clickable');
    }
    linkContainer.setAttribute('title', hasLink ? `Open on ${post.platform}` : post.platform);

    const iconWrapper = linkContainer.createDiv();
    iconWrapper.addClass('pcr-platform-icon-wrapper');

    const icon = getPlatformSimpleIcon(post.platform, post.author.url);
    if (icon) {
      // Use Simple Icon with Obsidian theme color
      const svg = createSVGElement(icon, {
        fill: 'var(--text-accent)',
        width: '100%',
        height: '100%'
      });
      iconWrapper.appendChild(svg);
    } else {
      // Use Lucide icon for platforms not in simple-icons (e.g., LinkedIn)
      const lucideIconName = getPlatformLucideIcon(post.platform);
      const lucideWrapper = iconWrapper.createDiv();
      lucideWrapper.addClass('pcr-lucide-fill');
      setIcon(lucideWrapper, lucideIconName);
    }

    const finalUrl = targetUrl || podcastFallbackUrl;
    if (finalUrl) {
      linkContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(finalUrl, '_blank');
      });
    }
  }

  /**
   * Render subscription badge next to author name
   */
  private renderSubscriptionBadge(container: HTMLElement, post: PostData, isSubscribed: boolean): void {
    const badge = container.createDiv();
    let isLoading = false;
    let isUnsubscribing = false; // Track whether we're subscribing or unsubscribing
    let currentSubscribed = isSubscribed; // Local mutable state

    // Register callback for updates from other badges
    const badgeKey = this.generateBadgeKey(post.author.url, post.platform);
    const updateCallback = (newSubscribed: boolean) => {
      if (!isLoading) {
        currentSubscribed = newSubscribed;
        updateBadgeStyle(newSubscribed, false);
      }
    };

    // Add callback to tracking map
    if (!this.badgeUpdateCallbacks.has(badgeKey)) {
      this.badgeUpdateCallbacks.set(badgeKey, new Set());
    }
    (this.badgeUpdateCallbacks.get(badgeKey) as Set<(isSubscribed: boolean) => void>).add(updateCallback);

    const updateBadgeStyle = (subscribed: boolean, loading: boolean) => {
      badge.empty();
      badge.removeClass('pcr-badge-subscribed', 'pcr-badge-unsubscribed');
      badge.addClass('pcr-badge');
      badge.setCssProps({
        '--pcr-badge-cursor': loading ? 'wait' : 'pointer',
        '--pcr-badge-opacity': loading ? '0.7' : '1'
      });

      if (subscribed) {
        // Subscribed state - green badge
        badge.addClass('pcr-badge-subscribed');
        badge.setAttribute('title', 'Click to unsubscribe');

        // Bell icon
        const iconContainer = badge.createDiv({ cls: 'pcr-badge-icon' });
        setIcon(iconContainer, 'bell');
        const bellSvg = iconContainer.querySelector('svg');
        if (bellSvg) { bellSvg.addClass('pcr-badge-svg-subscribed'); }

        badge.createSpan({ text: 'Subscribed' });
      } else {
        // Not subscribed state - subtle badge
        badge.addClass('pcr-badge-unsubscribed');

        const loadingText = isUnsubscribing ? 'Unsubscribing...' : 'Subscribing...';
        badge.setAttribute('title', loading ? loadingText : 'Click to subscribe');

        // Bell-plus icon or loading spinner
        const iconContainer = badge.createDiv({ cls: 'pcr-badge-icon' });

        if (loading) {
          setIcon(iconContainer, 'loader-2');
          const loaderSvg = iconContainer.querySelector('svg');
          if (loaderSvg) { loaderSvg.addClass('pcr-badge-svg-loading'); }
        } else {
          setIcon(iconContainer, 'bell-plus');
          const bellSvg = iconContainer.querySelector('svg');
          if (bellSvg) { bellSvg.addClass('pcr-badge-svg-unsubscribed'); }
        }

        badge.createSpan({ text: loading ? loadingText : 'Subscribe' });
      }
    };

    // Initial render
    updateBadgeStyle(currentSubscribed, false);

    // Hover effects handled by CSS .pcr-badge-subscribed:hover and .pcr-badge-unsubscribed:hover

    // Click handler - Toggle subscribe/unsubscribe
    badge.addEventListener('click', (e) => { void (async () => {
      e.stopPropagation();
      if (isLoading) return;

      if (currentSubscribed) {
        // Unsubscribe
        const subscription = this.getSubscriptionFromCache(post.author.url, post.platform);
        if (subscription && this.onUnsubscribeAuthorCallback) {
          // Optimistic UI update
          isLoading = true;
          isUnsubscribing = true;
          currentSubscribed = false;
          updateBadgeStyle(false, true);

          try {
            await this.onUnsubscribeAuthorCallback(subscription.subscriptionId, post.author.name, post.author.url, post.platform);
            // Remove from cache
            const normalizedUrl = this.normalizeUrlForComparison(post.author.url);
            this.subscriptionsCache.delete(`${post.platform}:${normalizedUrl}`);
            this.subscriptionsCache.delete(`${post.platform}:handle:${subscription.handle.toLowerCase()}`);
            // Success - keep unsubscribed state
            isLoading = false;
            updateBadgeStyle(false, false);
            // Update all other badges for this author
            this.updateBadgesForAuthor(post.author.url, post.platform, false);
          } catch {
            // Revert to subscribed state on error
            currentSubscribed = true;
            isLoading = false;
            updateBadgeStyle(true, false);
          }
        }
      } else {
        // Subscribe
        const authorEntry = this.findAuthorEntry(post.author.url, post.platform);

        // Build minimal author entry if not in catalog store
        const entryToSubscribe = authorEntry || {
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

        if (this.onSubscribeAuthorCallback) {
          // Optimistic UI update
          isLoading = true;
          isUnsubscribing = false;
          updateBadgeStyle(false, true);

          try {
            await this.onSubscribeAuthorCallback(entryToSubscribe);
            // Success - update to subscribed state
            currentSubscribed = true;
            isLoading = false;
            updateBadgeStyle(true, false);
            // Update all other badges for this author
            this.updateBadgesForAuthor(post.author.url, post.platform, true);
          } catch {
            // Revert to original state on error
            isLoading = false;
            updateBadgeStyle(false, false);
          }
        }
      }
    })(); });
  }

  /**
   * Render content text with Obsidian native markdown rendering and expand/collapse
   */
  /**
   * Escape markdown patterns that could cause unwanted formatting
   * - Setext headings: text followed by line of - or = becomes h1/h2
   * - Standalone - or = lines that could trigger Setext headings
   */
  private escapeMarkdownHeadings(content: string): string {
    // Prevent Setext headings: escape standalone lines that are only - or = characters
    // These lines following text would make the preceding text a heading
    return content.replace(/^([-=]+)$/gm, '\\$1');
  }

  /**
   * Escape angle brackets to prevent HTML interpretation.
   * Social media text uses <book title> or <인수공통> literally,
   * but MarkdownRenderer treats them as HTML tags (e.g. <A ...> → anchor).
   */
  private escapeAngleBrackets(content: string): string {
    return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Escape ordered list patterns to prevent markdown parsing
   * "2025. 11. 6" would be parsed as nested ordered lists without escaping
   * "1.\n텍스트" would also be parsed as ordered list (markdown lazy continuation)
   */
  private escapeOrderedListPatterns(content: string): string {
    if (!content) return content;
    // Escape "number." at the start of a line followed by space, newline, or end of string
    // This prevents markdown from treating patterns like "1.\n" or "2. " as ordered lists
    return content.replace(/^(\s*)(\d+)\.(?=\s|$)/gm, '$1$2\\.');
  }

  private async renderContent(contentArea: HTMLElement, post: PostData): Promise<void> {
    // For reblogs (retweets/boosts), skip content rendering in main card
    // Content will be shown in the quotedPost card instead (like Bluesky/Mastodon style)
    if (post.isReblog && post.quotedPost) {
      return;
    }

    const contentContainer = contentArea.createDiv({ cls: 'mb-2' });

    // For YouTube: show video title at top of content area with title styling
    // Match embedded archive style: 📺 emoji + bold title
    if (post.platform === 'youtube' && post.title) {
      const titleEl = contentContainer.createDiv({ cls: 'youtube-video-title pcr-title-youtube' });
      titleEl.setText(`📺 ${post.title}`);
    }

    // For RSS-based platforms: show article title at top of content area with larger, bolder styling
    if (isRssBasedPlatform(post.platform) && post.title) {
      const titleEl = contentContainer.createDiv({ cls: 'blog-article-title pcr-title-blog' });
      titleEl.setText(post.title);
    }

    // For X articles: show article title with blog-style rendering
    if (post.platform === 'x' && post.content.rawMarkdown && post.title) {
      const titleEl = contentContainer.createDiv({ cls: 'blog-article-title pcr-title-blog' });
      titleEl.setText(post.title);
    }

    // For Reddit: show post title at top of content area
    if (post.platform === 'reddit' && post.title) {
      const titleEl = contentContainer.createDiv({ cls: 'reddit-post-title pcr-title-reddit' });
      titleEl.setText(post.title);
    }

    // For RSS-based platforms and X articles: use rawMarkdown with inline images
    if ((isRssBasedPlatform(post.platform) || (post.platform === 'x' && post.content.rawMarkdown))
        && post.content.rawMarkdown) {
      await this.renderBlogContent(contentContainer, post);
      return;
    }

    // Remove leading whitespace and get meaningful content
    let cleanContent = post.content.text.trim();

    // Remove external link text if link preview card will be rendered
    // Format: "🔗 **Link:** [title](url)" - rendered as rich card instead
    if (post.metadata.externalLink) {
      cleanContent = cleanContent.replace(/🔗 \*\*Link:\*\* \[.+?\]\(.+?\)\n?/g, '').trim();
    }

    // Escape Setext heading patterns (lines of - or = that make preceding text a heading)
    cleanContent = this.escapeMarkdownHeadings(cleanContent);

    // Escape ordered list patterns (e.g., "2025. 11. 6" -> "2025\. 11\. 6")
    cleanContent = this.escapeOrderedListPatterns(cleanContent);

    // Escape angle brackets to prevent HTML interpretation (e.g., <책 제목> → literal text)
    cleanContent = this.escapeAngleBrackets(cleanContent);

    // Process timestamps for YouTube videos (at render time for backward compatibility)
    if (post.platform === 'youtube' && post.videoId) {
      cleanContent = this.textFormatter.linkifyYouTubeTimestamps(cleanContent, post.videoId);
    }

    // Linkify @mentions for X posts
    if (post.platform === 'x') {
      cleanContent = this.textFormatter.linkifyXMentions(cleanContent);
    }

    const previewLength = 300; // Show 300 characters initially (about 2-3 sentences)
    const isLongContent = cleanContent.length > previewLength;

    const contentText = contentContainer.createDiv({
      cls: 'text-sm leading-relaxed text-[var(--text-normal)] post-body-text pcr-content-text'
    });

    if (isLongContent) {
      // Smart preview truncation - don't cut markdown in half
      let preview = cleanContent.substring(0, previewLength);

      // Check if we cut off in the middle of a markdown link
      const lastOpenBracket = preview.lastIndexOf('[');
      const lastCloseBracket = preview.lastIndexOf(']');

      // If there's an unclosed link at the end, truncate before it
      if (lastOpenBracket > lastCloseBracket) {
        preview = cleanContent.substring(0, lastOpenBracket);
      }

      // Use Obsidian's native markdown renderer
      await MarkdownRenderer.render(
        this.app,
        preview + '...',
        contentText,
        '', // sourcePath (empty for non-file content)
        this // component for lifecycle management
      );

      const seeMoreBtn = contentContainer.createEl('span', {
        text: 'See more...',
        cls: 'pcr-see-more-btn'
      });

      let expanded = false;
      seeMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        void (async () => {
          if (expanded) {
            contentText.empty();
            await MarkdownRenderer.render(this.app, cleanContent, contentText, '', this);
            seeMoreBtn.setText('See less');
            // Re-add timestamp handlers after re-rendering
            if (post.platform === 'youtube' && post.videoId) {
              this.addTimestampClickHandlers(contentText, post);
            }
            // Re-add hashtag handlers after re-rendering
            this.addHashtagClickHandlers(contentText);
            // Re-normalize tag font sizes after re-rendering
            this.normalizeTagFontSizes(contentText);
          } else {
            contentText.empty();
            await MarkdownRenderer.render(this.app, preview + '...', contentText, '', this);
            seeMoreBtn.setText('See more...');
            // Re-add timestamp handlers after re-rendering
            if (post.platform === 'youtube' && post.videoId) {
              this.addTimestampClickHandlers(contentText, post);
            }
            // Re-add hashtag handlers after re-rendering
            this.addHashtagClickHandlers(contentText);
            // Re-normalize tag font sizes after re-rendering
            this.normalizeTagFontSizes(contentText);
          }
        })();
      });
    } else {
      // Use Obsidian's native markdown renderer for short content
      await MarkdownRenderer.render(
        this.app,
        cleanContent,
        contentText,
        '', // sourcePath (empty for non-file content)
        this // component for lifecycle management
      );
    }

    // Add timestamp click handlers for YouTube videos
    if (post.platform === 'youtube' && post.videoId) {
      this.addTimestampClickHandlers(contentText, post);
    }

    // Add hashtag click handlers to open timeline search
    this.addHashtagClickHandlers(contentText);

    // Normalize tag font sizes to match surrounding text
    this.normalizeTagFontSizes(contentText);

    // Render external link preview card if exists (for quotedPost expanded view)
    // Use LinkPreviewRenderer to fetch metadata from Worker API
    if (post.metadata.externalLink) {
      const linkPreviewContainer = contentContainer.createDiv({ cls: 'pcr-link-preview' });
      // Fire and forget - async rendering
      void this.linkPreviewRenderer.renderCompact(linkPreviewContainer, post.metadata.externalLink);
    }
  }

  /**
   * Render podcast episode metadata (episode number, season, duration, hosts, guests)
   * Displayed as a compact metadata bar below the title
   */
  private renderPodcastMetadata(container: HTMLElement, post: PostData): void {
    const metadata = post.metadata;

    // Collect metadata items that exist
    const items: string[] = [];

    // Episode and Season
    if (metadata.episode !== undefined) {
      if (metadata.season !== undefined) {
        items.push(`S${metadata.season}E${metadata.episode}`);
      } else {
        items.push(`Episode ${metadata.episode}`);
      }
    } else if (metadata.season !== undefined) {
      items.push(`Season ${metadata.season}`);
    }

    // Duration (format as HH:MM:SS or MM:SS)
    if (metadata.duration !== undefined && metadata.duration > 0) {
      items.push(`⏱️ ${this.formatDuration(metadata.duration)}`);
    }

    // Hosts
    if (metadata.hosts && metadata.hosts.length > 0) {
      const hostsText = metadata.hosts.length === 1
        ? `Host: ${metadata.hosts[0]}`
        : `Hosts: ${metadata.hosts.join(', ')}`;
      items.push(`🎙️ ${hostsText}`);
    }

    // Guests
    if (metadata.guests && metadata.guests.length > 0) {
      const guestsText = metadata.guests.length === 1
        ? `Guest: ${metadata.guests[0]}`
        : `Guests: ${metadata.guests.join(', ')}`;
      items.push(`👤 ${guestsText}`);
    }

    // Explicit content warning
    if (metadata.explicit === true) {
      items.push('🔞 Explicit');
    }

    // Don't render if no metadata
    if (items.length === 0) {
      return;
    }

    // Create metadata bar
    const metadataBar = container.createDiv({ cls: 'podcast-metadata-bar pcr-podcast-metadata' });

    for (const item of items) {
      metadataBar.createSpan({ text: item, cls: 'pcr-podcast-metadata-item' });
    }
  }

  /**
   * Format duration in seconds to HH:MM:SS or MM:SS string
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Render blog content with inline images
   * Uses rawMarkdown to preserve image placement within text flow
   */
  private async renderBlogContent(contentContainer: HTMLElement, post: PostData): Promise<void> {
    let rawMarkdown = post.content.rawMarkdown || '';

    // For podcasts: strip <audio> tags since our custom player handles audio
    // This prevents duplicate audio players (markdown's <audio> + MediaGalleryRenderer)
    if (post.platform === 'podcast') {
      rawMarkdown = rawMarkdown.replace(/<audio[^>]*>.*?<\/audio>/gi, '').trim();
    }

    const previewLength = 500; // Blog posts get longer preview (about 4-5 paragraphs)
    const isLongContent = rawMarkdown.length > previewLength;

    const contentText = contentContainer.createDiv({
      cls: 'text-sm leading-relaxed text-[var(--text-normal)] blog-content-inline post-body-text pcr-content-text'
    });

    // Use file path for Obsidian to resolve internal links and images
    const sourcePath = post.filePath || '';

    // Clean up zero-width spaces that can break markdown parsing
    // Naver blog content often contains U+200B (zero-width space) that prevents proper paragraph breaks
    rawMarkdown = rawMarkdown.replace(/\u200B/g, '');

    // Convert wikilink images to standard markdown format for MarkdownRenderer
    // ![[filename.webp]] -> ![](filename.webp)
    rawMarkdown = this.convertWikilinkImages(rawMarkdown);

    if (isLongContent) {
      // For blog posts, find a good truncation point (end of paragraph)
      let preview = rawMarkdown.substring(0, previewLength);
      const lastParagraphEnd = preview.lastIndexOf('\n\n');
      if (lastParagraphEnd > previewLength * 0.5) {
        preview = rawMarkdown.substring(0, lastParagraphEnd);
      }

      // Use Obsidian's native markdown renderer with sourcePath for image resolution
      await MarkdownRenderer.render(
        this.app,
        preview + '\n\n...',
        contentText,
        sourcePath,
        this
      );

      // Resolve image paths after rendering
      this.resolveInlineImages(contentText, sourcePath);

      const seeMoreBtn = contentContainer.createEl('span', {
        text: 'See more...',
        cls: 'pcr-see-more-btn'
      });

      let expanded = false;
      seeMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        contentText.empty();
        void (async () => {
          if (expanded) {
            await MarkdownRenderer.render(this.app, rawMarkdown, contentText, sourcePath, this);
            seeMoreBtn.setText('See less');
          } else {
            await MarkdownRenderer.render(this.app, preview + '\n\n...', contentText, sourcePath, this);
            seeMoreBtn.setText('See more...');
          }
          // Resolve image paths after rendering
          this.resolveInlineImages(contentText, sourcePath);
          // Re-add hashtag handlers after re-rendering
          this.addHashtagClickHandlers(contentText);
          // Re-normalize tag font sizes after re-rendering
          this.normalizeTagFontSizes(contentText);
          // Style inline images
          this.styleBlogInlineImages(contentText);
        })();
      });
    } else {
      // Short blog content - render full markdown
      await MarkdownRenderer.render(this.app, rawMarkdown, contentText, sourcePath, this);
      // Resolve image paths after rendering
      this.resolveInlineImages(contentText, sourcePath);
    }

    // Add hashtag click handlers
    this.addHashtagClickHandlers(contentText);

    // Normalize tag font sizes
    this.normalizeTagFontSizes(contentText);

    // Style inline images for better presentation
    this.styleBlogInlineImages(contentText);
  }

  /**
   * Convert Obsidian wikilink images to standard markdown format
   * ![[filename.webp]] -> ![](filename.webp)
   */
  private convertWikilinkImages(markdown: string): string {
    // Match ![[filename]] or ![[filename|alt]]
    return markdown.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_match: string, filename: string, alt: string | undefined) => {
      const altText = alt ?? '';
      return `![${altText}](${encodePathForMarkdownLink(filename)})`;
    });
  }

  /**
   * Resolve image paths in rendered content using Obsidian's vault
   * Converts relative paths to proper vault resource URLs
   * Also handles Obsidian's internal-embed spans and converts them to img tags
   */
  private resolveInlineImages(contentEl: HTMLElement, sourcePath: string): void {
    // Helper to find file by name with URL encoding fallback
    const findFileByName = (filename: string): ReturnType<typeof this.app.metadataCache.getFirstLinkpathDest> => {
      // Try direct resolution first
      let linkedFile = this.app.metadataCache.getFirstLinkpathDest(filename, sourcePath);
      if (linkedFile) return linkedFile;

      // Try URL decoded version
      try {
        const decoded = decodeURIComponent(filename);
        if (decoded !== filename) {
          linkedFile = this.app.metadataCache.getFirstLinkpathDest(decoded, sourcePath);
          if (linkedFile) return linkedFile;
        }
      } catch { /* ignore decode errors */ }

      // Fallback: search vault for file by name (with both encoded and decoded)
      const allFiles = this.app.vault.getFiles();
      linkedFile = allFiles.find(f => {
        // Match exact filename or path ending
        if (f.name === filename || f.path.endsWith('/' + filename) || f.path === filename) {
          return true;
        }
        // Try decoded version
        try {
          const decoded = decodeURIComponent(filename);
          if (f.name === decoded || f.path.endsWith('/' + decoded) || f.path === decoded) {
            return true;
          }
        } catch { /* ignore */ }
        // Try matching encoded filename against decoded file path
        try {
          const decodedPath = decodeURIComponent(f.path);
          const decodedName = decodeURIComponent(f.name);
          if (decodedName === filename || decodedPath.endsWith('/' + filename)) {
            return true;
          }
        } catch { /* ignore */ }
        return false;
      }) || null;

      return linkedFile;
    };

    // First, handle Obsidian's internal-embed spans (these are unresolved embeds)
    // MarkdownRenderer creates: <span src="filename.webp" class="internal-embed"></span>
    const embedSpans = contentEl.querySelectorAll('span.internal-embed[src]');

    for (const span of Array.from(embedSpans)) {
      const src = span.getAttribute('src');
      if (!src) continue;

      const linkedFile = findFileByName(src);

      if (linkedFile) {
        // Convert to vault resource URL
        const resourcePath = this.app.vault.getResourcePath(linkedFile);

        // Check if it's a video file
        const isVideo = /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(linkedFile.path);

        if (isVideo) {
          // Create video element for video files
          const video = document.createElement('video');
          video.setAttribute('src', resourcePath);
          video.setAttribute('controls', 'true');
          video.setAttribute('preload', 'metadata');
          video.className = 'pcr-inline-media';
          span.replaceWith(video);
        } else {
          // Create img element for images
          const img = document.createElement('img');
          img.setAttribute('src', resourcePath);
          img.setAttribute('alt', src);
          span.replaceWith(img);
        }
      }
    }

    // Also handle any existing img tags that need path resolution
    const images = contentEl.querySelectorAll('img');
    for (const img of Array.from(images)) {
      const src = img.getAttribute('src');
      if (!src) continue;

      // Skip if already a valid URL or data URL
      if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('app://')) {
        continue;
      }

      const linkedFile = findFileByName(src);

      if (linkedFile) {
        const resourcePath = this.app.vault.getResourcePath(linkedFile);
        img.setAttribute('src', resourcePath);
      }
    }

    // Also handle any existing video tags that need path resolution
    const videos = contentEl.querySelectorAll('video');
    for (const video of Array.from(videos)) {
      const src = video.getAttribute('src');
      if (!src) continue;

      // Skip if already a valid URL or data URL
      if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('app://')) {
        continue;
      }

      const linkedFile = findFileByName(src);

      if (linkedFile) {
        const resourcePath = this.app.vault.getResourcePath(linkedFile);
        video.setAttribute('src', resourcePath);
      }
    }
  }

  /**
   * Style inline images in blog content for better presentation
   * Groups consecutive images into gallery format
   */
  private styleBlogInlineImages(contentEl: HTMLElement): void {
    // Find all paragraphs that contain only images (no text)
    const paragraphs = Array.from(contentEl.querySelectorAll('p'));

    // Helper function to check if two elements are truly adjacent in the DOM
    // (no meaningful content between them)
    const areElementsAdjacent = (el1: Element, el2: Element): boolean => {
      let current = el1.nextElementSibling;
      while (current && current !== el2) {
        // Check if the element between them has meaningful content
        const tagName = current.tagName.toLowerCase();
        // Skip empty paragraphs and whitespace-only elements
        if (tagName === 'p' && !current.textContent?.trim()) {
          current = current.nextElementSibling;
          continue;
        }
        // Any other element (ul, ol, div, etc.) or non-empty content means not adjacent
        if (current.textContent?.trim() || ['ul', 'ol', 'table', 'blockquote', 'pre', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
          return false;
        }
        current = current.nextElementSibling;
      }
      return current === el2;
    };

    // Group consecutive image-only paragraphs
    let i = 0;
    while (i < paragraphs.length) {
      const p = paragraphs[i];
      if (!p) {
        i++;
        continue;
      }
      const img = p.querySelector('img');
      const pText = p.textContent?.trim() ?? '';
      const hasOnlyImage = img && pText === '';

      if (!hasOnlyImage) {
        // Style single images that are mixed with text
        if (img) {
          img.addClass('pcr-inline-media');
        }
        i++;
        continue;
      }

      // Found an image-only paragraph, check for consecutive ones
      // Now we check DOM adjacency, not just array order
      const consecutiveImages: HTMLImageElement[] = [img];
      const paragraphsToRemove: HTMLParagraphElement[] = [];
      let j = i + 1;
      let lastP = p;

      while (j < paragraphs.length) {
        const nextP = paragraphs[j];
        if (!nextP) {
          j++;
          continue;
        }
        const nextImg = nextP.querySelector('img');
        const nextText = nextP.textContent?.trim() ?? '';
        const nextHasOnlyImage = nextImg && nextText === '';

        if (!nextHasOnlyImage) break;

        // Check if this paragraph is truly adjacent in the DOM (no content between)
        if (!areElementsAdjacent(lastP, nextP)) {
          break;
        }

        consecutiveImages.push(nextImg);
        paragraphsToRemove.push(nextP);
        lastP = nextP;
        j++;
      }

      if (consecutiveImages.length >= 2) {
        // Create gallery for 2+ consecutive images
        const gallery = this.createInlineImageGallery(consecutiveImages);
        p.replaceWith(gallery);

        // Remove the other paragraphs that were merged into gallery
        paragraphsToRemove.forEach(pToRemove => pToRemove.remove());

        // Skip the paragraphs we just processed
        i = j;
      } else {
        // Single image - style it normally
        img.addClass('pcr-inline-media');
        i++;
      }
    }

    // Handle any remaining images not in paragraphs
    const remainingImages = contentEl.querySelectorAll('img:not(.gallery-image)');
    remainingImages.forEach((img) => {
      if (!img.closest('.inline-image-gallery')) {
        (img as HTMLElement).addClass('pcr-inline-media');
      }
    });

    // Also handle internal embeds (Obsidian ![[image]] format)
    const embeds = contentEl.querySelectorAll('.internal-embed.image-embed');
    embeds.forEach((embed) => {
      (embed as HTMLElement).addClass('pcr-embed-container');
      const innerImg = embed.querySelector('img');
      if (innerImg) {
        (innerImg as HTMLElement).addClass('pcr-embed-inner-img');
      }
    });
  }

  /**
   * Create an inline image gallery similar to media gallery
   */
  private createInlineImageGallery(images: HTMLImageElement[]): HTMLElement {
    const gallery = document.createElement('div');
    gallery.className = 'inline-image-gallery pcr-gallery';

    const count = images.length;

    // Main display area
    const mainDisplay = document.createElement('div');
    mainDisplay.className = 'gallery-main-display pcr-gallery-main';

    // Create main image container
    const mainImageContainer = document.createElement('div');
    mainImageContainer.className = 'pcr-gallery-main-container';

    const firstImage = images[0];
    if (!firstImage) return gallery;
    const mainImage = firstImage.cloneNode(true) as HTMLImageElement;
    mainImage.className = 'gallery-image gallery-main-image pcr-gallery-main-image';
    mainImageContainer.appendChild(mainImage);
    mainDisplay.appendChild(mainImageContainer);

    // Add counter badge if more than 1 image
    if (count > 1) {
      const counter = document.createElement('div');
      counter.className = 'gallery-counter pcr-gallery-counter';
      counter.textContent = `1/${count}`;
      mainDisplay.appendChild(counter);

      // Navigation arrows (hover handled by CSS .pcr-gallery-main:hover .pcr-gallery-nav)
      const prevBtn = document.createElement('button');
      prevBtn.className = 'gallery-nav gallery-prev pcr-gallery-nav pcr-gallery-nav-prev';
      prevBtn.textContent = '‹';

      const nextBtn = document.createElement('button');
      nextBtn.className = 'gallery-nav gallery-next pcr-gallery-nav pcr-gallery-nav-next';
      nextBtn.textContent = '›';

      mainDisplay.appendChild(prevBtn);
      mainDisplay.appendChild(nextBtn);

      // Navigation logic
      let currentIndex = 0;
      const updateDisplay = () => {
        const currentImage = images[currentIndex];
        if (!currentImage) return;
        const newImg = currentImage.cloneNode(true) as HTMLImageElement;
        newImg.className = 'gallery-image gallery-main-image pcr-gallery-main-image';
        mainImageContainer.empty();
        mainImageContainer.appendChild(newImg);
        counter.textContent = `${currentIndex + 1}/${count}`;

        // Add click handler to new image
        newImg.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openImageLightbox(images.map(img => img.src), currentIndex);
        });
      };

      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex - 1 + count) % count;
        updateDisplay();
      });

      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex + 1) % count;
        updateDisplay();
      });

      // Click main image to open lightbox
      mainImage.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openImageLightbox(images.map(img => img.src), currentIndex);
      });
    } else {
      // Single image - just add click handler
      mainImage.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openImageLightbox([mainImage.src], 0);
      });
    }

    gallery.appendChild(mainDisplay);

    // Thumbnail strip for 3+ images
    if (count >= 3) {
      const thumbnailStrip = document.createElement('div');
      thumbnailStrip.className = 'gallery-thumbnails pcr-gallery-thumbnails';

      images.forEach((img, index) => {
        const thumb = document.createElement('div');
        thumb.className = index === 0 ? 'pcr-gallery-thumb pcr-gallery-thumb-active' : 'pcr-gallery-thumb pcr-gallery-thumb-inactive';

        const thumbImg = img.cloneNode(true) as HTMLImageElement;
        thumbImg.className = 'gallery-image pcr-gallery-thumb-img';
        thumb.appendChild(thumbImg);

        thumb.addEventListener('click', (e) => {
          e.stopPropagation();
          // Update main display
          const clickedImage = images[index];
          if (!clickedImage) return;
          const newImg = clickedImage.cloneNode(true) as HTMLImageElement;
          newImg.className = 'gallery-image gallery-main-image pcr-gallery-main-image';
          mainImageContainer.empty();
          mainImageContainer.appendChild(newImg);

          // Update counter
          const counter = mainDisplay.querySelector('.gallery-counter');
          if (counter) counter.textContent = `${index + 1}/${count}`;

          // Update thumbnail styles
          thumbnailStrip.querySelectorAll('div').forEach((t, i) => {
            const thumbEl = t as HTMLElement;
            thumbEl.removeClass('pcr-gallery-thumb-active', 'pcr-gallery-thumb-inactive');
            thumbEl.addClass(i === index ? 'pcr-gallery-thumb-active' : 'pcr-gallery-thumb-inactive');
          });

          // Add click handler to new main image
          newImg.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.openImageLightbox(images.map(img => img.src), index);
          });
        });

        thumbnailStrip.appendChild(thumb);
      });

      gallery.appendChild(thumbnailStrip);
    }

    return gallery;
  }

  /**
   * Open image lightbox for full-screen viewing
   */
  private openImageLightbox(imageSrcs: string[], startIndex: number): void {
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox-overlay pcr-lightbox-overlay';

    let currentIndex = startIndex;
    const count = imageSrcs.length;

    const imgContainer = document.createElement('div');
    imgContainer.className = 'pcr-lightbox-container';

    const img = document.createElement('img');
    img.src = imageSrcs[currentIndex] ?? '';
    img.className = 'pcr-lightbox-image';
    imgContainer.appendChild(img);

    // Counter
    if (count > 1) {
      const counter = document.createElement('div');
      counter.className = 'pcr-lightbox-counter';
      counter.textContent = `${currentIndex + 1} / ${count}`;
      imgContainer.appendChild(counter);

      // Navigation
      const prevBtn = document.createElement('button');
      prevBtn.textContent = '‹';
      prevBtn.className = 'pcr-lightbox-nav pcr-lightbox-prev';

      const nextBtn = document.createElement('button');
      nextBtn.textContent = '›';
      nextBtn.className = 'pcr-lightbox-nav pcr-lightbox-next';

      const updateLightbox = () => {
        img.src = imageSrcs[currentIndex] ?? '';
        counter.textContent = `${currentIndex + 1} / ${count}`;
      };

      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex - 1 + count) % count;
        updateLightbox();
      });

      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex + 1) % count;
        updateLightbox();
      });

      overlay.appendChild(prevBtn);
      overlay.appendChild(nextBtn);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.className = 'pcr-lightbox-close';
    closeBtn.addEventListener('click', () => overlay.remove());

    overlay.appendChild(imgContainer);
    overlay.appendChild(closeBtn);

    // Close on background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Close on Escape key
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handleKeydown);
      } else if (e.key === 'ArrowLeft' && count > 1) {
        currentIndex = (currentIndex - 1 + count) % count;
        img.src = imageSrcs[currentIndex] ?? '';
        const counter = imgContainer.querySelector('div');
        if (counter) counter.textContent = `${currentIndex + 1} / ${count}`;
      } else if (e.key === 'ArrowRight' && count > 1) {
        currentIndex = (currentIndex + 1) % count;
        img.src = imageSrcs[currentIndex] ?? '';
        const counter = imgContainer.querySelector('div');
        if (counter) counter.textContent = `${currentIndex + 1} / ${count}`;
      }
    };
    document.addEventListener('keydown', handleKeydown);

    document.body.appendChild(overlay);
  }

  /**
   * Normalize tag font sizes to match the surrounding text
   * Prevents Obsidian tags from appearing larger than body text
   * Also normalizes header sizes for better readability in post cards
   */
  private normalizeTagFontSizes(contentEl: HTMLElement): void {
    // The parent element already has 'post-body-text' class.
    // CSS rules in post-card.css handle normalization:
    //   .post-body-text .tag, .post-body-text a.tag { font-size: inherit; line-height: inherit; }
    //   .post-body-text h1/h2/h3/h4-h6 { adjusted sizes }
    // Ensure the class is present (it should already be set at creation time)
    if (!contentEl.hasClass('post-body-text')) {
      contentEl.addClass('post-body-text');
    }
  }

  /**
   * Add click handlers to timestamp links for YouTube player control
   */
  private addTimestampClickHandlers(contentEl: HTMLElement, post: PostData): void {
    // Find all links that point to YouTube with timestamp
    const links = contentEl.querySelectorAll('a[href*="youtube.com"][href*="&t="]');

    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (!href) return;

      // Extract timestamp from URL (e.g., &t=120s)
      const match = href.match(/[&?]t=(\d+)s?/);
      if (!match || !match[1]) return;

      const seconds = parseInt(match[1], 10);

      // Prevent default link behavior and control the player instead
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const controller = this.youtubeControllers.get(post.id);
        if (controller) {
          controller.seekTo(seconds);
          controller.play();
        }
      });
    });
  }

  /**
   * Add click handlers to hashtag links to trigger timeline search
   */
  private addHashtagClickHandlers(contentEl: HTMLElement): void {
    // Find all links in the content
    const allLinks = contentEl.querySelectorAll('a');

    allLinks.forEach((link) => {
      const href = link.getAttribute('href');
      const text = link.textContent;
      const classes = link.className;

      if (!href || !text) return;

      // Check if this is a hashtag link:
      // 1. Obsidian-rendered tags: class="tag" and href starts with "#"
      // 2. External platform hashtag URLs
      const isObsidianTag = classes.includes('tag') && href.startsWith('#') && text.startsWith('#');
      const isExternalHashtagLink = text.startsWith('#') && (
        href.includes('/tagged/') ||      // Tumblr
        href.includes('/tags/') ||        // Instagram, Mastodon
        href.includes('/hashtag/') ||     // Twitter/X, Facebook, LinkedIn, YouTube
        href.includes('/tag/') ||         // TikTok, Threads
        href.includes('/search/') ||      // Reddit, Substack
        href.includes('search?q=')        // Bluesky, Google
      );

      const isHashtagLink = isObsidianTag || isExternalHashtagLink;

      if (!isHashtagLink) return;

      // Extract hashtag text (remove # prefix)
      const hashtag = text.startsWith('#') ? text.substring(1) : text;

      // Use registerDomEvent for proper cleanup and to work with Obsidian's event system
      this.registerDomEvent(link, 'click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Trigger the hashtag click callback if registered
        if (this.onHashtagClickCallback) {
          this.onHashtagClickCallback(hashtag);
        }
      }, true); // Use capture phase to intercept before Obsidian's handler
    });
  }

  /**
   * Render tag chips row with add button
   */
  private renderTagChips(contentArea: HTMLElement, post: PostData, rootElement: HTMLElement): void {
    const filePath = post.filePath;
    if (!filePath) return;

    const tagStore = this.plugin.tagStore;
    if (!tagStore) return;

    const definitions = tagStore.getTagDefinitions();
    const postTags = post.tags || [];

    // Don't render container if no tags and we'll just show the action bar button
    if (postTags.length === 0) return;

    const tagContainer = contentArea.createDiv({ cls: 'post-tag-chips pcr-tag-container' });

    // Render existing tags (consistent with TagChipBar style)
    for (const tagName of postTags) {
      const def = definitions.find(d => d.name.toLowerCase() === tagName.toLowerCase());
      const color = def?.color || null;

      const chip = tagContainer.createDiv({ cls: 'pcr-tag-chip' });

      // Color dot (colored for defined tags, muted gray for undefined)
      const dot = chip.createDiv({ cls: 'pcr-tag-dot' });
      if (color) {
        dot.setCssProps({ '--pcr-dot-color': color });
      }

      chip.createSpan({ text: tagName });

      // Remove button (x) - hover handled by CSS .pcr-tag-remove:hover
      const removeBtn = chip.createDiv({ cls: 'pcr-tag-remove' });
      setIcon(removeBtn, 'x');
      removeBtn.querySelector('svg')?.setAttribute('width', '10');
      removeBtn.querySelector('svg')?.setAttribute('height', '10');

      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Optimistic: remove chip from DOM immediately
        post.tags = (post.tags || []).filter(t => t.toLowerCase() !== tagName.toLowerCase());
        chip.remove();
        // Remove entire tag container if no tags left
        if (post.tags.length === 0 && tagContainer.parentElement) {
          tagContainer.remove();
        }
        // Register UI modify to prevent timeline refresh from vault watcher
        if (this.onUIModifyCallback) this.onUIModifyCallback(filePath);
        // Background: YAML update, then refresh tag chip bar counts
        tagStore.removeTagFromPost(filePath, tagName).then(() => {
          if (this.onTagsChangedCallback) this.onTagsChangedCallback();
        }).catch(() => {});
      });

      // Click chip label to open tag modal (hover handled by CSS .pcr-tag-chip:hover)
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openTagModal(tagStore, filePath, tagContainer, post, rootElement);
      });
    }

    // Small "+" button (matching mobile design) - hover handled by CSS .pcr-tag-add:hover
    const addBtn = tagContainer.createDiv({ cls: 'pcr-tag-add' });
    addBtn.setAttribute('title', 'Add tag');
    setIcon(addBtn, 'plus');
    addBtn.querySelector('svg')?.setAttribute('width', '12');
    addBtn.querySelector('svg')?.setAttribute('height', '12');

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openTagModal(tagStore, filePath, tagContainer, post, rootElement);
    });
  }

  /** Open tag modal (shared by chip click and + button) */
  private openTagModal(tagStore: import('@/services/TagStore').TagStore, filePath: string, tagContainer: HTMLElement, post: PostData, rootElement: HTMLElement): void {
    void import('../modals/TagModal').then(({ TagModal }) => {
      const modal = new TagModal(this.plugin.app, tagStore, filePath, () => {
        this.refreshTagChips(tagContainer, post, rootElement);
        if (this.onTagsChangedCallback) {
          this.onTagsChangedCallback();
        }
      }, this.onUIModifyCallback);
      modal.open();
    });
  }

  /**
   * Refresh tag chips after modal changes
   */
  private refreshTagChips(tagContainer: HTMLElement, post: PostData, rootElement: HTMLElement): void {
    const filePath = post.filePath;
    if (!filePath) return;

    const tagStore = this.plugin.tagStore;
    if (!tagStore) return;

    // Re-read tags from frontmatter
    post.tags = tagStore.getTagsForPost(filePath);

    // Remove existing container
    const parent = tagContainer.parentElement;
    if (!parent) return;

    // Find the element after the tag container (interaction bar) for insertion point
    const nextSibling = tagContainer.nextElementSibling;
    tagContainer.remove();

    // Re-render (creates new container if tags exist, otherwise nothing)
    // We need to insert at the right position, so use a temporary wrapper
    const tempWrapper = document.createElement('div');
    parent.insertBefore(tempWrapper, nextSibling);
    this.renderTagChips(tempWrapper, post, rootElement);

    // Move children out of wrapper and remove it
    const newChips = tempWrapper.querySelector('.post-tag-chips');
    if (newChips) {
      parent.insertBefore(newChips, tempWrapper);
    }
    tempWrapper.remove();
  }

  /**
   * Render interaction bar (likes, comments, shares, actions)
   */
  private renderInteractions(contentArea: HTMLElement, post: PostData, rootElement: HTMLElement, isEmbedded: boolean = false): void {
    const interactions = contentArea.createDiv({ cls: 'pcr-interactions' });
    if (!isEmbedded) {
      interactions.addClass('pcr-interactions-bordered');
    }
    interactions.setCssProps({ '--pcr-interaction-gap': ObsidianPlatform.isMobile ? '12px' : '16px' });

    // Check if this post has embedded archives
    const hasEmbeddedArchives = post.embeddedArchives && post.embeddedArchives.length > 0;

    // Only show social interaction counts if no embedded archives and not a reblog
    // Reblogs show engagement on the original post, not the reblogger's card
    const metaGap = ObsidianPlatform.isMobile ? '4px' : '6px';
    if (!hasEmbeddedArchives && !post.isReblog) {
      // Likes - hover handled by CSS .pcr-action-btn:hover
      if (post.metadata.likes !== undefined) {
        const likeBtn = interactions.createDiv({ cls: 'pcr-action-btn' });
        likeBtn.setCssProps({ '--pcr-meta-gap': metaGap });

        const likeIcon = likeBtn.createDiv({ cls: 'pcr-action-icon' });
        setIcon(likeIcon, 'heart');

        likeBtn.createSpan({ text: this.formatNumber(post.metadata.likes), cls: 'pcr-action-count' });
      }

      // Comments - hover handled by CSS .pcr-action-btn:hover
      if (post.metadata.comments !== undefined) {
        const commentBtn = interactions.createDiv({ cls: 'pcr-action-btn' });
        commentBtn.setCssProps({ '--pcr-meta-gap': metaGap });

        const commentIcon = commentBtn.createDiv({ cls: 'pcr-action-icon' });
        setIcon(commentIcon, 'message-circle');

        commentBtn.createSpan({ text: this.formatNumber(post.metadata.comments), cls: 'pcr-action-count' });
      }

      // Shares (hidden on mobile to save space) - hover handled by CSS .pcr-action-btn:hover
      if (post.metadata.shares !== undefined && !ObsidianPlatform.isMobile) {
        const shareBtn = interactions.createDiv({ cls: 'pcr-action-btn' });
        shareBtn.setCssProps({ '--pcr-meta-gap': metaGap });

        const shareIcon = shareBtn.createDiv({ cls: 'pcr-action-icon' });
        setIcon(shareIcon, 'repeat-2');

        shareBtn.createSpan({ text: this.formatNumber(post.metadata.shares), cls: 'pcr-action-count' });
      }
    }

    // Spacer (always render to push action buttons to the right)
    interactions.createDiv({ cls: 'pcr-spacer' });

    // Personal Like button (star icon, right-aligned)
    this.renderPersonalLikeButton(interactions, post);

    // Share button (right-aligned)
    this.renderShareButton(interactions, post);

    // Tag button (right-aligned)
    if (!isEmbedded) {
      this.renderTagButton(interactions, post, rootElement);
    }

    // Archive button (right-aligned)
    this.renderArchiveButton(interactions, post, rootElement);

    // Reader mode button (right-aligned)
    this.renderReaderModeButton(interactions, post);

    // Open Note button (right-aligned)
    this.renderOpenNoteButton(interactions, post);

    // Edit button (right-aligned, only for user posts)
    if (post.platform === 'post') {
      this.renderEditButton(interactions, post);
    }

    // Delete button (right-aligned)
    this.renderDeleteButton(interactions, post, rootElement);
  }

  /**
   * Render personal like button
   */
  private renderPersonalLikeButton(parent: HTMLElement, post: PostData): void {
    const personalLikeBtn = parent.createDiv({ cls: 'pcr-action-btn' });
    personalLikeBtn.setAttribute('title', post.like ? 'Remove from favorites' : 'Add to favorites');

    const personalLikeIcon = personalLikeBtn.createDiv({ cls: 'pcr-action-icon' });

    // Set initial state
    if (post.like) {
      setIcon(personalLikeIcon, 'star');
      // Fill the star when liked
      const svgEl = personalLikeIcon.querySelector('svg');
      if (svgEl) {
        svgEl.addClass('pcr-svg-filled');
      }
      personalLikeBtn.addClass('pcr-action-btn-active');
    } else {
      setIcon(personalLikeIcon, 'star');
    }

    // Personal Like button click handler
    personalLikeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.togglePersonalLike(post, personalLikeBtn, personalLikeIcon);
    });
  }

  /**
   * Render archive button
   */
  private renderArchiveButton(parent: HTMLElement, post: PostData, rootElement: HTMLElement): void {
    const archiveBtn = parent.createDiv({ cls: 'pcr-action-btn' });
    archiveBtn.setAttribute('title', post.archive ? 'Unarchive this post' : 'Archive this post');

    const archiveIcon = archiveBtn.createDiv({ cls: 'pcr-action-icon' });

    // Set initial state
    if (post.archive) {
      setIcon(archiveIcon, 'archive');
      // Fill the archive icon when archived (with internal details visible)
      const svgEl = archiveIcon.querySelector('svg');
      if (svgEl) {
        svgEl.addClass('pcr-svg-archive-filled');
      }
      archiveBtn.addClass('pcr-action-btn-active');
    } else {
      setIcon(archiveIcon, 'archive');
    }

    // Archive button click handler
    archiveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.toggleArchive(post, archiveBtn, archiveIcon, rootElement);
    });
  }

  /**
   * Attach long-press (400ms) handler on mobile to open reader mode.
   * Uses setPointerCapture so all events route to the element (no document listeners needed).
   */
  private attachLongPress(el: HTMLElement, post: PostData): void {
    const HOLD_MS = 400;
    const MOVE_THRESHOLD = 10;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;

    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };

    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Skip mouse events (iPad/iPhone with external mouse) — long-press is touch-only.
      // setPointerCapture on mouse blocks child click events (action buttons).
      if (e.pointerType === 'mouse') return;
      startX = e.clientX;
      startY = e.clientY;
      el.setPointerCapture(e.pointerId);
      timer = setTimeout(() => {
        timer = null;
        el.releasePointerCapture(e.pointerId);
        this.onReaderModeCallback?.(post);
      }, HOLD_MS);
    });

    el.addEventListener('pointermove', (e: PointerEvent) => {
      if (!timer) return;
      if (Math.abs(e.clientX - startX) > MOVE_THRESHOLD || Math.abs(e.clientY - startY) > MOVE_THRESHOLD) {
        cancel();
      }
    });

    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
  }

  /**
   * Render reader mode button
   */
  private renderReaderModeButton(parent: HTMLElement, post: PostData): void {
    const readerBtn = parent.createDiv({ cls: 'pcr-action-btn' });
    readerBtn.setAttribute('title', 'Open in reader mode');

    const readerIcon = readerBtn.createDiv({ cls: 'pcr-action-icon' });
    setIcon(readerIcon, 'book-open');

    readerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onReaderModeCallback?.(post);
    });
  }

  /**
   * Render open note button
   */
  private renderOpenNoteButton(parent: HTMLElement, post: PostData): void {
    const openNoteBtn = parent.createDiv({ cls: 'pcr-action-btn' });
    openNoteBtn.setAttribute('title', 'Open note in Obsidian');

    const openNoteIcon = openNoteBtn.createDiv({ cls: 'pcr-action-icon' });
    setIcon(openNoteIcon, 'external-link');

    // Open Note button click handler
    openNoteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.openNote(post);
    });
  }

  /**
   * Render edit button (only for user posts)
   */
  private renderEditButton(parent: HTMLElement, post: PostData): void {
    const editBtn = parent.createDiv({ cls: 'pcr-action-btn' });
    editBtn.setAttribute('title', 'Edit this post');

    const editIcon = editBtn.createDiv({ cls: 'pcr-action-icon' });
    setIcon(editIcon, 'pencil');

    // Edit button click handler - open PostComposer in edit mode
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      if (this.onEditPostCallback && post.url) {
        // Call edit post callback with post data and file path
        this.onEditPostCallback(post, post.url);
      }
    });
  }

  /**
   * Render delete button
   */
  private renderDeleteButton(parent: HTMLElement, post: PostData, rootElement: HTMLElement): void {
    const deleteBtn = parent.createDiv({ cls: 'pcr-action-btn pcr-action-btn-error' });
    deleteBtn.setAttribute('title', 'Delete this post');

    const deleteIcon = deleteBtn.createDiv({ cls: 'pcr-action-icon' });
    setIcon(deleteIcon, 'trash-2');

    // Delete button click handler
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.deletePost(post, rootElement);
    });
  }

  /**
   * Render share button
   */
  private renderShareButton(parent: HTMLElement, post: PostData): void {
    // Check if user is logged in
    const isLoggedIn = this.plugin.settings.isVerified && this.plugin.settings.authToken;

    const shareBtn = parent.createDiv({ cls: 'pcr-action-btn' });

    // Check if already shared
    const isShared = !!post.shareUrl;

    // Set tooltip based on login state
    if (!isLoggedIn && !isShared) {
      shareBtn.setAttribute('title', 'Log in to share posts');
      shareBtn.addClass('pcr-action-btn-disabled');
    } else {
      shareBtn.setAttribute('title', isShared ? 'Shared - Click to unshare' : 'Share this post to the web');
    }

    const shareIcon = shareBtn.createDiv({ cls: 'pcr-action-icon' });

    // Use different icons for shared vs unshared state
    if (isShared) {
      setIcon(shareIcon, 'link');
      shareBtn.addClass('pcr-action-btn-active');
    } else {
      setIcon(shareIcon, 'share-2');
    }

    // Share button click handler
    shareBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      // Check current share state dynamically (not from closure)
      const currentShareUrl = post.shareUrl;
      const currentlyShared = !!currentShareUrl;

      void (async () => {
        if (currentlyShared) {
          // Click to unshare
          await this.unsharePost(post, shareBtn, shareIcon);
        } else {
          // Create new share
          await this.createShare(post, shareBtn, shareIcon);
        }
      })();
    });
  }

  /**
   * Render tag button in the action bar (opens TagModal)
   */
  private renderTagButton(parent: HTMLElement, post: PostData, rootElement: HTMLElement): void {
    const filePath = post.filePath;
    if (!filePath) return;

    const tagStore = this.plugin.tagStore;
    if (!tagStore) return;

    const hasTags = (post.tags?.length ?? 0) > 0;

    const tagBtn = parent.createDiv({ cls: 'pcr-action-btn' });
    tagBtn.setAttribute('title', 'Manage tags');

    const tagIcon = tagBtn.createDiv({ cls: 'pcr-action-icon' });
    setIcon(tagIcon, 'tag');

    // Accent color when tags exist, muted when none
    if (hasTags) {
      tagBtn.addClass('pcr-action-btn-active');
    }

    tagBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void import('../modals/TagModal').then(({ TagModal }) => {
        const modal = new TagModal(this.plugin.app, tagStore, filePath, () => {
          // Update post tags in-memory
          post.tags = tagStore.getTagsForPost(filePath);
          // Update button color
          const nowHasTags = (post.tags?.length ?? 0) > 0;
          tagBtn.toggleClass('pcr-action-btn-active', nowHasTags);
          // Refresh tag chips row (or create it if it didn't exist)
          const chipContainer = rootElement.querySelector('.post-tag-chips');
          if (chipContainer) {
            this.refreshTagChips(chipContainer as HTMLElement, post, rootElement);
          } else {
            // No chip container exists yet — insert one before the interaction bar
            const interactionBar = parent.closest('[style*="border-top"]') || parent.parentElement;
            if (interactionBar?.parentElement) {
              this.renderTagChips(interactionBar.parentElement, post, rootElement);
              // Move it before the interaction bar
              const newChips = interactionBar.parentElement.querySelector('.post-tag-chips:last-child');
              if (newChips && interactionBar) {
                interactionBar.parentElement.insertBefore(newChips, interactionBar);
              }
            }
          }
          // Notify timeline for tag bar refresh
          if (this.onTagsChangedCallback) {
            this.onTagsChangedCallback();
          }
        }, this.onUIModifyCallback);
        modal.open();
      });
    });
  }

  /**
   * Create share link for post
   */
  private async createShare(post: PostData, shareBtn: HTMLElement, shareIcon: HTMLElement): Promise<void> {
    try {
      const platform = post.platform;

      if (platform === 'pinterest') {
        try {
          const resolution = await resolvePinterestUrl(post.url);
          if (resolution.resolvedUrl) {
            post.url = resolution.resolvedUrl;
          }
        } catch {
          // Keep original URL on failure
        }
      }
      // Check if user is logged in
      if (!this.plugin.settings.isVerified || !this.plugin.settings.authToken) {
        new Notice('Please log in to share posts. Go to settings → Social Archiver → authentication');
        return;
      }

      const filePath = post.filePath;
      if (!filePath) {
        new Notice('Cannot share: file path not found');
        return;
      }

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) {
        new Notice('Cannot share: file not found');
        return;
      }

      // Show loading state
      shareBtn.addClass('pcr-action-btn-loading');

      // Read original file content
      const originalContent = await this.vault.read(file);

      // Extract link previews from post content
      const extractedLinkPreviews = post.content?.text && this.plugin.linkPreviewExtractor
        ? this.plugin.linkPreviewExtractor.extractUrls(post.content.text, post.platform)
        : [];
      const linkPreviewUrls = extractedLinkPreviews.map(link => link.url);

      const workerUrl = this.getWorkerUrl();

      // Get username from authenticated user settings
      const username = this.plugin.settings.username || 'anonymous';

      // PHASE 1: Create share WITHOUT media first (for instant link)
      const hasMedia = post.media && post.media.length > 0;
      const hasVideos = post.media?.some(m => m.type === 'video') ?? false;
      const isAdmin = this.plugin.settings.tier === 'admin';

      // Prepare PostData WITHOUT media for instant share creation
      const postData = this.serializePostForShare(post, { stripMedia: true });
      postData.shareMode = this.plugin.settings.shareMode;

      // Parse AI comments from markdown content and include in share data
      const parsedAIComments = parseAIComments(originalContent);
      if (parsedAIComments.comments.length > 0) {
        postData.aiComments = parsedAIComments.comments.map(meta => ({
          meta: {
            id: meta.id,
            cli: meta.cli,
            type: meta.type,
            generatedAt: meta.generatedAt,
          },
          content: parsedAIComments.commentTexts.get(meta.id) || '',
        }));
      }

      // Merge newly extracted link previews with existing ones (dedupe)
      // Filter out invalid/truncated URLs before combining
      const validLinkPreviews = [...(post.linkPreviews || []), ...linkPreviewUrls].filter(isValidPreviewUrl);
      const combinedLinkPreviews = Array.from(new Set(validLinkPreviews));
      postData.linkPreviews = combinedLinkPreviews;

      // Create share request with full post data
      const shareRequest = {
        postData,
        options: {
          expiry: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days for free tier
          username: username  // Username for URL generation
          // NOTE: Do not include shareId - let Workers generate it for new shares
        }
      };

      // Call Worker API to create share
      const response = await requestUrl({
        url: `${workerUrl}/api/share`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(shareRequest),
        throw: false
      });

      if (response.status !== 200) {
        throw new Error(`Share creation failed: ${response.status}`);
      }

      const resultRaw = response.json as Record<string, unknown>;
      if (!resultRaw.success || !resultRaw.data) {
        throw new Error('Invalid share response');
      }

      const shareData = resultRaw.data as Record<string, unknown>;
      // Extract shareId and shareUrl from Worker API response
      const shareId = shareData.shareId as string;
      const shareUrl = shareData.shareUrl as string;

      // Update YAML frontmatter in ORIGINAL content (preserves all existing fields)
      const yamlUpdates: Record<string, unknown> = {
        share: true,
        shareUrl: shareUrl,
        shareMode: this.plugin.settings.shareMode, // Add current share mode from settings
      };

      // Add linkPreviews if any were found
      if (linkPreviewUrls.length > 0) {
        yamlUpdates.linkPreviews = linkPreviewUrls;
      } // no link previews

      const updatedContent = this.updateYamlFrontmatter(originalContent, yamlUpdates);

      // Register UI modify to prevent double refresh
      if (this.onUIModifyCallback) {
        this.onUIModifyCallback(filePath);
      }

      await this.vault.modify(file, updatedContent);

      // Update post object
      post.shareUrl = shareUrl;

      // Update UI to show shared state
      shareBtn.removeClass('pcr-action-btn-loading');
      shareBtn.addClass('pcr-action-btn-active');
      shareBtn.setAttribute('title', 'Shared - click to copy link');

      // Update icon to link icon
      setIcon(shareIcon, 'link');

      // Copy to clipboard
      await navigator.clipboard.writeText(shareUrl);
      const mediaType = isAdmin && hasVideos ? 'media' : 'images';
      const mediaMessage = hasMedia ? ` (uploading ${mediaType}...)` : '';
      new Notice(`✅ Published! Share link copied to clipboard.${mediaMessage}`);


      // PHASE 2: Upload media in background and update share
      if (hasMedia) {
        const failMsg = isAdmin && hasVideos ? '⚠️ Some media failed to upload' : '⚠️ Some images failed to upload';
        void this.uploadMediaAndUpdateShare(post, shareId, username, workerUrl)
          .catch(_err => {
            new Notice(failMsg);
          });
      }

    } catch {
      new Notice('Failed to publish post');

      // Reset button state
      shareBtn.removeClass('pcr-action-btn-loading', 'pcr-action-btn-active');
    }
  }

  /**
   * Upload media in background and update share using ShareAPIClient
   * This delegates to ShareAPIClient.updateShareWithMedia() which handles:
   * - Detecting media changes (new uploads, deletions)
   * - Uploading new media to R2
   * - Deleting removed media from R2
   * - Converting markdown paths from local to R2 URLs
   */
  private async uploadMediaAndUpdateShare(
    post: PostData,
    shareId: string,
    username: string,
    workerUrl: string
  ): Promise<void> {

    // Filter out videos unless admin tier (admin can upload videos)
    const isAdmin = this.plugin.settings.tier === 'admin';
    const hasVideos = post.media.some(m => m.type === 'video');
    const filteredPost = isAdmin ? post : {
      ...post,
      media: post.media.filter(m => m.type !== 'video')
    };
    const sanitizedImagePost = this.serializePostForShare(filteredPost);

    // Progress tracking with Notice
    let progressNotice: Notice | undefined;
    const totalMedia = filteredPost.media.length;
    const progressMediaType = isAdmin && hasVideos ? 'media' : 'images';

    const onProgress = (current: number, total: number) => {
      // Hide previous notice
      if (progressNotice) {
        progressNotice.hide();
      }
      // Show new progress notice
      progressNotice = new Notice(`Uploading ${progressMediaType}... (${current}/${total})`, 0); // 0 = don't auto-hide
    };

    try {
      // Initialize ShareAPIClient with vault access for media operations
      const shareClient = new ShareAPIClient({
        baseURL: workerUrl,
        apiKey: this.plugin.settings.authToken,
        vault: this.vault,
        pluginVersion: this.plugin.manifest.version
      });

      // Use ShareAPIClient.updateShareWithMedia() to handle incremental media updates
      // This will:
      // 1. Fetch existing share data to detect changes
      // 2. Upload only NEW media files to R2 (images only, videos excluded)
      // 3. Delete REMOVED media files from R2
      // 4. Convert markdown image paths from local to R2 URLs
      // 5. Update the share in KV with the corrected data
      await shareClient.updateShareWithMedia(shareId, sanitizedImagePost, {
        username: username,
        tier: this.plugin.settings.tier
      }, onProgress);

      // Hide progress notice and show completion message
      progressNotice?.hide();

      if (totalMedia > 0) {
        const mediaType = isAdmin && hasVideos ? 'media file' : 'image';
        const successMsg = `✅ ${totalMedia} ${mediaType}${totalMedia > 1 ? 's' : ''} uploaded successfully!`;
        const videoMsg = !isAdmin && hasVideos ? ' (Videos excluded from upload)' : '';
        new Notice(successMsg + videoMsg);
      } else if (hasVideos && !isAdmin) {
        new Notice('⚠️ videos cannot be uploaded to web (excluded)');
      }
    } catch (err) {
      // Hide progress notice on error
      progressNotice?.hide();
      // Re-throw to be handled by caller
      throw err;
    }
  }

  /**
   * Unshare post - delete from Worker API and remove from YAML
   */
  private async unsharePost(post: PostData, shareBtn: HTMLElement, shareIcon: HTMLElement): Promise<void> {
    try {
      const filePath = post.filePath;
      if (!filePath) {
        new Notice('Cannot unshare: file path not found');
        return;
      }

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) {
        new Notice('Cannot unshare: file not found');
        return;
      }

      const shareUrl = post.shareUrl;

      if (!shareUrl) {
        new Notice('Post is not shared');
        return;
      }

      // Extract shareId from URL
      // URL format: https://social-archive.org/username/shareId
      const shareId = shareUrl.split('/').pop();
      if (!shareId) {
        new Notice('Invalid share URL');
        return;
      }

      // Show loading state
      shareBtn.addClass('pcr-action-btn-loading');

      // Delete from Worker API using ShareAPIClient
      const { ShareAPIClient } = await import('../../../services/ShareAPIClient');
      const shareClient = new ShareAPIClient({
        baseURL: this.plugin.settings.workerUrl,
        apiKey: this.plugin.settings.authToken,
        vault: this.vault
      });

      await shareClient.deleteShare(shareId);

      // Read file content
      const content = await this.vault.read(file);

      // Remove share-related fields from YAML frontmatter
      const updatedContent = this.removeShareFromYaml(content);

      // Register UI modify to prevent double refresh
      if (this.onUIModifyCallback) {
        this.onUIModifyCallback(filePath);
      }

      await this.vault.modify(file, updatedContent);

      // Update post object - remove all share-related properties
      delete post.shareUrl;
      delete post.shareId;
      delete post.share;

      // Update UI to show unshared state
      shareBtn.removeClass('pcr-action-btn-loading', 'pcr-action-btn-active');
      shareBtn.setAttribute('title', 'Share this post to the web');

      // Update icon to share icon
      setIcon(shareIcon, 'share-2');

      new Notice('✅ post unshared successfully');

    } catch {
      new Notice('Failed to unshare post');

      // Reset button state
      shareBtn.removeClass('pcr-action-btn-loading');
    }
  }

  /**
   * Open the original note in Obsidian
   */
  private async openNote(post: PostData): Promise<void> {
    try {
      const filePath = post.filePath;
      if (!filePath) {
        return;
      }

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!file) {
        return;
      }

      // Check if it's a TFile
      if (file instanceof TFile) {
        // Open the file in a new leaf
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.openFile(file);
      } else {
        // Not a TFile (e.g. TFolder) - no action needed
      }
    } catch {
    // Intentional: error silenced, action already complete
    }
  }

  /**
   * Show async confirmation dialog with minimal Obsidian styling
   * Returns a Promise that resolves to true if confirmed, false if cancelled
   */
  private showConfirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);

      // Set modal properties
      modal.titleEl.setText(title);
      modal.modalEl.addClass('social-archiver-confirm-modal');

      // Apply minimal modal styling
      modal.modalEl.addClass('pcr-confirm-modal');

      const contentEl = modal.contentEl;
      contentEl.empty();

      // Clean message container
      const messageContainer = contentEl.createDiv({ cls: 'pcr-confirm-message' });

      // Split message by newlines and format
      const lines = message.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i] ?? '';
        const line = currentLine.trim();
        if (!line) continue;

        const lineEl = messageContainer.createDiv({ cls: 'pcr-confirm-line' });

        if (line.includes(':')) {
          // Format as label: value
        const [label = '', value = ''] = line.split(':');

          lineEl.createEl('span', {
            text: label.trim(),
            cls: 'pcr-confirm-label'
          });

          lineEl.createEl('span', {
            text: value.trim(),
            cls: 'pcr-confirm-value'
          });
        } else if (line.includes('media file')) {
          // Media count line - subtle highlight
          lineEl.addClass('pcr-confirm-media-line');
          lineEl.removeClass('pcr-confirm-line');
          lineEl.setText(line);
        } else if (line.includes('cannot be undone')) {
          // Warning text - subtle but clear
          lineEl.addClass('pcr-confirm-warning');
          lineEl.removeClass('pcr-confirm-line');
          lineEl.setText(line);
        } else {
          lineEl.setText(line);
        }
      }

      // Button container
      const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container pcr-confirm-buttons' });

      // Cancel button (default style)
      const cancelBtn = buttonContainer.createEl('button', {
        text: 'Cancel'
      });
      cancelBtn.addEventListener('click', () => {
        modal.close();
        resolve(false);
      });

      // Delete button (subtle warning) - hover handled by CSS .pcr-confirm-delete-btn:hover
      const confirmBtn = buttonContainer.createEl('button', {
        text: 'Delete',
        cls: 'mod-cta pcr-confirm-delete-btn'
      });

      confirmBtn.addEventListener('click', () => {
        modal.close();
        resolve(true);
      });

      // Focus on cancel button by default (safer)
      setTimeout(() => cancelBtn.focus(), 50);

      // Handle escape key
      modal.scope.register([], 'Escape', () => {
        modal.close();
        resolve(false);
        return false;
      });

      // Handle enter key to confirm (but requires Mod key for safety)
      modal.scope.register(['Mod'], 'Enter', () => {
        modal.close();
        resolve(true);
        return false;
      });

      modal.open();
    });
  }

  /**
   * Delete post and remove card from timeline
   */
  private async deletePost(post: PostData, rootElement: HTMLElement): Promise<void> {
    try {
      const filePath = post.filePath;
      if (!filePath) {
        new Notice('Cannot delete post: file path not found');
        return;
      }

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!file || !('extension' in file)) {
        new Notice('Cannot delete post: file not found');
        return;
      }

      // Count media files that will be deleted (all relative paths, not http(s) URLs)
      // Include both post media and embedded archives media
      const allMedia = [
        ...post.media,
        ...(post.embeddedArchives || []).flatMap(archive => archive.media || [])
      ];

      const mediaCount = allMedia.filter(m =>
        m.url && !m.url.startsWith('http://') && !m.url.startsWith('https://')
      ).length;
      const mediaText = mediaCount > 0 ? `${mediaCount} media file(s) will also be deleted.` : '';

      // Show async confirmation dialog
      const message = [
        `Author: ${post.author.name}`,
        `Platform: ${post.platform}`,
        mediaText,
        'This action cannot be undone.'
      ].filter(Boolean).join('\n');

      const confirmed = await this.showConfirmDialog('Delete Post?', message);

      if (!confirmed) {
        return;
      }

      // Check if post is in archiving state - cancel the pending job
      if (post.archiveStatus === 'archiving') {
        try {
          // Find pending job by URL
          const pendingJobs = await this.plugin.pendingJobsManager.getJobs({ status: 'processing' });
          const matchingJob = pendingJobs.find(job => job.url === post.url);

          if (matchingJob?.metadata?.workerJobId) {
            // Cancel server-side pending job to prevent webhook from saving
            try {
              await this.plugin.workersApiClient.cancelPendingJob(matchingJob.metadata.workerJobId);
            } catch {
              // Ignore cancel errors - job might already be completed
            }
          }

          // Remove from local PendingJobsManager
          if (matchingJob) {
            await this.plugin.pendingJobsManager.removeJob(matchingJob.id);
          }
        } catch {
          // Continue with deletion even if cancel fails
        }
      }

      // Check if post is shared and unshare it first
      const shareUrl = post.shareUrl;

      // Extract shareId from shareUrl (format: https://domain/username/shareId)
      const shareId = shareUrl ? shareUrl.split('/').pop() : null;

      if (shareUrl && shareId) {
        try {
          // Call unshare API
          const workerUrl = this.getWorkerUrl();
          const authToken = this.plugin.settings.authToken || 'dev-key';

          const response = await requestUrl({
            url: `${workerUrl}/api/share/${shareId}`,
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'X-License-Key': authToken,
            },
            throw: false
          });

          if (response.status !== 200) {
            // Continue with deletion even if unshare fails
          }
        } catch {
          // Continue with deletion even if unshare fails
        }
      }

      // Animate card removal (fade out and slide up)
      rootElement.addClass('pcr-delete-animation');

      // Wait for animation to complete
      await new Promise(resolve => setTimeout(resolve, 300));

      // Delete media files first (all relative paths, not http(s) URLs)
      // Include both post media and embedded archives media
      const deletedMedia: string[] = [];
      const failedMedia: string[] = [];
      const mediaFolderPaths = new Set<string>();

      // Collect all media from post and embedded archives
      const allMediaToDelete = [
        ...post.media,
        ...(post.embeddedArchives || []).flatMap(archive => archive.media || [])
      ];

      for (const media of allMediaToDelete) {
        if (media.url && !media.url.startsWith('http://') && !media.url.startsWith('https://')) {
          try {
            // Convert relative path to absolute path
            let absolutePath = media.url;
            if (media.url.startsWith('../')) {
              // Get the directory of the post file
              const postDir = post.filePath ? post.filePath.substring(0, post.filePath.lastIndexOf('/')) : '';
              // Resolve relative path
              const parts = media.url.split('/');
              const postDirParts = postDir.split('/');

              for (const part of parts) {
                if (part === '..') {
                  postDirParts.pop();
                } else if (part !== '.') {
                  postDirParts.push(part);
                }
              }
              absolutePath = postDirParts.join('/');
            }

            const mediaFile = this.vault.getAbstractFileByPath(absolutePath);

            if (mediaFile && mediaFile instanceof TFile) {
              // Extract parent folder path from absolute path
              const pathParts = absolutePath.split('/');
              pathParts.pop(); // Remove filename
              const folderPath = pathParts.join('/');
              if (folderPath) {
                mediaFolderPaths.add(folderPath);
              }

              await this.app.fileManager.trashFile(mediaFile);
              deletedMedia.push(media.url);
            }
          } catch {
            failedMedia.push(media.url);
          }
        }
      }

      // Delete all media folders (after deleting their files)
      // IMPORTANT: Protect base media folder from accidental deletion
      const baseMediaPath = this.plugin.settings.mediaPath || 'attachments/social-archives';
      for (const folderPath of mediaFolderPaths) {
        try {
          // Skip if this is the base media folder or a parent of it
          if (folderPath === baseMediaPath ||
              baseMediaPath.startsWith(folderPath + '/') ||
              folderPath === 'attachments') {
            console.debug(`[PostCardRenderer] Skipping protected folder: ${folderPath}`);
            continue;
          }

          const mediaFolder = this.vault.getAbstractFileByPath(folderPath);
          if (mediaFolder && !('extension' in mediaFolder)) {
            await this.vault.adapter.rmdir(folderPath, true); // recursive delete
          }
        } catch {
        // Intentional: error silenced, action already complete
        }
      }

      // Clean up AI comment components for this post
      this.cleanupAICommentComponents(post.id);

      // Register UI delete to prevent double refresh from vault event
      if (this.onUIDeleteCallback) {
        this.onUIDeleteCallback(filePath);
      }

      // Delete the markdown file
      await this.app.fileManager.trashFile(file);

      // Clean up empty parent folders (walk up from deepest to archive root)
      const baseArchivePath = this.plugin.settings.archivePath || 'Social Archives';
      let parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
      while (parentPath && parentPath !== baseArchivePath && parentPath.startsWith(baseArchivePath + '/')) {
        try {
          const parentFolder = this.vault.getAbstractFileByPath(parentPath);
          if (parentFolder instanceof TFolder && parentFolder.children.length === 0) {
            await this.app.fileManager.trashFile(parentFolder);
            // Move up one level
            parentPath = parentPath.substring(0, parentPath.lastIndexOf('/'));
          } else {
            break; // Folder not empty or doesn't exist, stop climbing
          }
        } catch {
          break;
        }
      }

      // Remove from DOM
      rootElement.remove();

      // Show success notice
      const successMsg = deletedMedia.length > 0
        ? `Post and ${deletedMedia.length} media file(s) deleted successfully`
        : 'Post deleted successfully';
      new Notice(successMsg);

      if (failedMedia.length > 0) {
        // Failed media deletions are non-critical; main post was deleted
      }

    } catch {
      new Notice('Failed to delete post. Check console for details.');
    }
  }

  /**
   * Toggle personal like status for a post
   */
  private async togglePersonalLike(post: PostData, btn: HTMLElement, icon: HTMLElement): Promise<void> {
    try {
      const filePath = post.filePath;
      if (!filePath) {
        return;
      }

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) {
        return;
      }

      // Read current file content
      const content = await this.vault.read(file);

      // Toggle like status
      const newLikeStatus = !post.like;

      // Update YAML frontmatter
      const updatedContent = this.updateYamlFrontmatter(content, { like: newLikeStatus });

      // Register UI modify to prevent double refresh
      if (this.onUIModifyCallback) {
        this.onUIModifyCallback(filePath);
      }

      // Write back to file
      await this.vault.modify(file, updatedContent);

      // Update local state
      post.like = newLikeStatus;

      // Update UI
      btn.setAttribute('title', newLikeStatus ? 'Remove from favorites' : 'Add to favorites');
      btn.toggleClass('pcr-action-btn-active', newLikeStatus);

      // Update star icon fill
      const svgEl = icon.querySelector('svg');
      if (svgEl) {
        svgEl.toggleClass('pcr-svg-filled', newLikeStatus);
      }

    } catch {
    // Intentional: error silenced, action already complete
    }
  }

  /**
   * Edit comment inline (replace with textarea)
   */
  private editCommentInline(post: PostData, commentSection: HTMLElement): void {
    try {
      const filePath = post.filePath;
      if (!filePath) {
        return;
      }

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) {
        return;
      }

      // Helper function to restore UI with current post.comment value
      // Uses post.comment dynamically (not captured closure variable) to reflect saved changes
      const restoreOriginalUI = () => {
        commentSection.empty();
        commentSection.addClass('pcr-comment-section');

        const userName = this.plugin.settings.username || 'You';
        const archivedTime = this.getRelativeTime(post.archivedDate);
        // Use current post.comment value (not closure-captured value)
        const currentComment = post.comment;
        const hasCurrentComment = !!currentComment;

        if (hasCurrentComment) {
          // Restore comment UI: "Jun commented on this post · 2h ago"
          const commentHeader = commentSection.createDiv({ cls: 'mb-2 pcr-comment-header' });

          commentHeader.createSpan({ text: userName, cls: 'pcr-comment-username' });

          // Use "commented on this user" for profile documents
      const commentOnText = post.type === 'profile' ? ' commented on this user' : ' commented on this post';
      commentHeader.createSpan({ text: commentOnText });

          if (archivedTime) {
            commentHeader.createSpan({ text: ` · ${archivedTime}` });
          }

          // Comment text with inline edit icon
          const commentTextContainer = commentSection.createDiv({ cls: 'pcr-comment-text-container' });

          const commentTextDiv = commentTextContainer.createSpan({ cls: 'pcr-comment-text' });
          this.renderMarkdownLinks(commentTextDiv, currentComment, undefined, post.platform);

          // Edit icon (hover handled by parent .pcr-comment-section:hover via pcr-edit-icon-inline)
          const editIcon = commentTextContainer.createSpan({ cls: 'pcr-edit-icon-inline' });
          setIcon(editIcon, 'pencil');
        } else {
          // Restore saved UI: "Jun saved this post · 2h ago"
          const savedHeader = commentSection.createDiv({ cls: 'pcr-saved-header' });

          savedHeader.createSpan({ text: userName, cls: 'pcr-comment-username' });

          // Use "created a post" for post platform, "saved this post" for others
          const actionText = post.platform === 'post' ? ' created a post' : ' saved this post';
          savedHeader.createSpan({ text: actionText });

          if (archivedTime) {
            savedHeader.createSpan({ text: ` · ${archivedTime}` });
          }

          // Edit icon (hover handled by parent .pcr-comment-section:hover via pcr-edit-icon-inline)
          const editIcon = commentSection.createSpan({ cls: 'pcr-edit-icon-inline' });
          setIcon(editIcon, 'pencil');
        }

        // Click to edit
        commentSection.addEventListener('click', (e) => {
          e.stopPropagation();
          this.editCommentInline(post, commentSection);
        });
      };

      // Clear section and create edit UI
      commentSection.empty();
      commentSection.addClass('pcr-comment-section-editing');
      commentSection.removeClass('pcr-comment-section');

      // Create a scope for keyboard shortcuts
      const editScope = new Scope();

      // Textarea
      const textarea = commentSection.createEl('textarea', { cls: 'pcr-comment-textarea' });
      textarea.value = post.comment || '';

      // Focus and select
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }, 10);

      // Button container
      const btnContainer = commentSection.createDiv({ cls: 'pcr-comment-btn-container' });

      // Save button
      const saveBtn = btnContainer.createEl('button', {
        text: 'Save',
        cls: 'mod-cta pcr-comment-btn'
      });

      // Cancel button
      const cancelBtn = btnContainer.createEl('button', { text: 'Cancel', cls: 'pcr-comment-btn' });

      // Save handler
      const handleSave = async () => {
        const newComment = textarea.value.trim();

        try {
          const content = await this.vault.read(file);
          const updatedContent = this.updateYamlFrontmatter(content, {
            comment: newComment || null
          });

          // Register UI modify to prevent double refresh
          if (this.onUIModifyCallback) {
            this.onUIModifyCallback(filePath);
          }

          await this.vault.modify(file, updatedContent);

          post.comment = newComment || undefined;

          // Unregister scope
          this.app.keymap.popScope(editScope);

          // Restore UI manually (since we skip auto-refresh for UI-initiated changes)
          restoreOriginalUI();
        } catch {
          new Notice('Failed to save note');
          // Restore original on error
          this.app.keymap.popScope(editScope);
          restoreOriginalUI();
        }
      };

      const handleCancel = () => {
        this.app.keymap.popScope(editScope);
        restoreOriginalUI();
      };

      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void handleSave();
      });

      // Cancel handler
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCancel();
      });

      // Register keyboard shortcuts with Obsidian's keymap
      editScope.register(['Mod'], 'Enter', (evt: KeyboardEvent) => {
        evt.preventDefault();
        void handleSave();
        return false;
      });

      editScope.register([], 'Escape', (evt: KeyboardEvent) => {
        evt.preventDefault();
        handleCancel();
        return false;
      });

      // Push scope to keymap stack
      this.app.keymap.pushScope(editScope);

    } catch {
    // Intentional: error silenced, action already complete
    }
  }

  /**
   * Toggle archive status for a post
   */
  private async toggleArchive(post: PostData, btn: HTMLElement, icon: HTMLElement, rootElement: HTMLElement): Promise<void> {
    try {
      const filePath = post.filePath;
      if (!filePath) {
        return;
      }

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) {
        return;
      }

      // Read current file content
      const content = await this.vault.read(file);

      // Toggle archive status
      const newArchiveStatus = !post.archive;

      // Update YAML frontmatter
      const updatedContent = this.updateYamlFrontmatter(content, { archive: newArchiveStatus });

      // Register UI modify to prevent double refresh
      if (this.onUIModifyCallback) {
        this.onUIModifyCallback(filePath);
      }

      // Write back to file
      await this.vault.modify(file, updatedContent);

      // Update post object
      post.archive = newArchiveStatus;

      // Update UI
      btn.toggleClass('pcr-action-btn-active', newArchiveStatus);
      btn.setAttribute('title', newArchiveStatus ? 'Unarchive this post' : 'Archive this post');

      // Update archive icon fill (with internal details visible)
      const svgEl = icon.querySelector('svg');
      if (svgEl) {
        svgEl.toggleClass('pcr-svg-archive-filled', newArchiveStatus);
      }


      // Notify parent component
      if (this.onArchiveToggleCallback) {
        this.onArchiveToggleCallback(post, newArchiveStatus, rootElement);
      }
    } catch {
    // Intentional: error silenced, action already complete
    }
  }

  /**
   * Update YAML frontmatter with new values
   */
  private updateYamlFrontmatter(content: string, updates: Record<string, unknown>): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);

    // Helper function to format YAML value
    const formatYamlValue = (value: unknown): string => {
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'string') {
        // Use JSON.stringify for strings to handle newlines and quotes properly
        return JSON.stringify(value);
      }
      if (typeof value === 'object' && value !== null && 'url' in value) {
        // Format object with url property (for linkPreviews items)
        return `url: ${(value as { url: string }).url}`;
      }
      if (typeof value === 'object' && value !== null) {
        // Serialize remaining objects to JSON to avoid '[object Object]' output
        return JSON.stringify(value);
      }
      // At this point value is number | boolean | bigint | symbol
      return String(value as number | boolean | bigint | symbol);
    };

    // Helper function to format YAML key-value pair (handles arrays)
    const formatYamlEntry = (key: string, value: unknown): string | null => {
      if (value === null || value === undefined) {
        return null;
      }

      // Handle arrays
      if (Array.isArray(value)) {
        if (value.length === 0) return null;
        const arrayItems = value.map(v => `  - ${formatYamlValue(v)}`).join('\n');
        return `${key}:\n${arrayItems}`;
      }

      // Handle simple values
      return `${key}: ${formatYamlValue(value)}`;
    };

    if (!match || !match[1]) {
      // No frontmatter found, add it
      const yamlLines = Object.entries(updates)
        .map(([key, value]) => formatYamlEntry(key, value))
        .filter(Boolean)
        .join('\n');
      return `---\n${yamlLines}\n---\n\n${content}`;
    }

    const frontmatterContent = match[1];
    const restContent = content.slice(match[0].length);

    // Parse existing frontmatter
    const lines = frontmatterContent.split('\n');
    const updatedLines: string[] = [];
    const processedKeys = new Set<string>();

    // Track if we're inside an array (lines starting with "  -")
    let currentArrayKey: string | null = null;

    // Update existing keys
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue; // Skip undefined lines

      const keyMatch = line.match(/^(\w+):/);

      if (keyMatch && keyMatch[1]) {
        // This line defines a key
        const key = keyMatch[1];
        currentArrayKey = null; // Reset array tracking

        if (Object.hasOwn(updates, key)) {
          const value = updates[key];
          if (value === null || value === undefined) {
            // Skip this line to remove the field
            processedKeys.add(key);

            // Skip array items if this was an array key
            while (i + 1 < lines.length && lines[i + 1]?.match(/^\s+-\s/)) {
              i++;
            }
            continue;
          }

          // Add formatted entry (handles arrays automatically)
          const formatted = formatYamlEntry(key, value);
          if (formatted) {
            updatedLines.push(formatted);
          }
          processedKeys.add(key);

          // Skip old array items if this is now an array
          if (Array.isArray(value)) {
            while (i + 1 < lines.length && lines[i + 1]?.match(/^\s+-\s/)) {
              i++;
            }
          }
        } else {
          // Keep existing line
          updatedLines.push(line);
          // Track if this starts an array
          if (i + 1 < lines.length && lines[i + 1]?.match(/^\s+-\s/)) {
            currentArrayKey = key;
          }
        }
      } else if (line.match(/^\s+-\s/) && currentArrayKey && !Object.hasOwn(updates, currentArrayKey)) {
        // This is an array item line, keep it if we're not updating this key
        updatedLines.push(line);
      } else if (!line.match(/^\s+-\s/)) {
        // Other lines (empty, comments, etc.)
        updatedLines.push(line);
        currentArrayKey = null;
      }
    }

    // Add new keys
    for (const [key, value] of Object.entries(updates)) {
      if (!processedKeys.has(key) && value !== null && value !== undefined) {
        const formatted = formatYamlEntry(key, value);
        if (formatted) {
          updatedLines.push(formatted);
        }
      }
    }

    return `---\n${updatedLines.join('\n')}\n---\n${restContent}`;
  }

  /**
   * Remove share-related fields from YAML frontmatter
   */
  private removeShareFromYaml(content: string): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);

    if (!match || !match[1]) {
      // No frontmatter, nothing to remove
      return content;
    }

    const frontmatterContent = match[1];
    const restContent = content.slice(match[0].length);

    // Parse existing frontmatter and remove share-related keys
    const lines = frontmatterContent.split('\n');
    const shareKeys = ['share', 'shareUrl', 'shareExpiry'];
    const filteredLines = lines.filter(line => {
      const keyMatch = line.match(/^(\w+):/);
      if (keyMatch && keyMatch[1]) {
        return !shareKeys.includes(keyMatch[1]);
      }
      return true;
    });

    return `---\n${filteredLines.join('\n')}\n---\n${restContent}`;
  }

  /**
   * Resolve the external/original URL for a post
   */
  private getPostOriginalUrl(post: PostData): string | null {
    const candidates: Array<string | undefined> = [
      post.url,
      post.originalUrl,
      post.quotedPost?.url,
      post.quotedPost?.originalUrl,
      post.shareUrl
    ];

    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'string' && candidate.trim().length > 0 && candidate.startsWith('http')) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Format relative time (e.g., "2h ago", "Yesterday", "Mar 15")
   */
  public getRelativeTime(timestamp: Date | undefined): string {
    if (!timestamp) {
      return '';
    }

    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) {
      return 'Just now';
    } else if (diffMin < 60) {
      return `${diffMin}m ago`;
    } else if (diffHour < 24) {
      return `${diffHour}h ago`;
    } else if (diffDay === 1) {
      return 'Yesterday';
    } else if (diffDay < 7) {
      return `${diffDay}d ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    }
  }

  // ---------- Public API for Reader Mode ----------

  /**
   * Toggle share state from external callers (e.g., reader mode).
   * Uses detached DOM elements since caller handles its own UI re-render.
   */
  public async toggleShareForReader(post: PostData): Promise<void> {
    const tmpEl = document.createElement('div');
    const tmpIcon = document.createElement('div');
    if (post.shareUrl) {
      await this.unsharePost(post, tmpEl, tmpIcon);
    } else {
      await this.createShare(post, tmpEl, tmpIcon);
    }
  }

  /**
   * Delete post from external callers (e.g., reader mode).
   * Shows confirm dialog and deletes files, but skips card animation.
   */
  public async deletePostForReader(post: PostData): Promise<void> {
    const tmpEl = document.createElement('div');
    await this.deletePost(post, tmpEl);
  }

  /**
   * Format large numbers (e.g., 1000 -> 1K, 1000000 -> 1M)
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toString();
  }

  /**
   * Get hashtag URL for platform
   */
  private getHashtagUrl(hashtag: string, platform: string): string {
    // Remove leading #, trim, and encode (supports spaces)
    const clean = (hashtag.startsWith('#') ? hashtag.slice(1) : hashtag).trim();
    const encoded = encodeURIComponent(clean);

    const urlMap: Record<string, string> = {
      instagram: `https://www.instagram.com/explore/tags/${encoded}/`,
      x: `https://twitter.com/hashtag/${encoded}`,
      twitter: `https://twitter.com/hashtag/${encoded}`,
      facebook: `https://www.facebook.com/hashtag/${encoded}`,
      linkedin: `https://www.linkedin.com/feed/hashtag/${encoded}/`,
      tiktok: `https://www.tiktok.com/tag/${encoded}`,
      threads: `https://www.threads.net/tag/${encoded}`,
      youtube: `https://www.youtube.com/hashtag/${encoded}`,
      tumblr: `https://www.tumblr.com/tagged/${encoded}`,
      reddit: `https://www.reddit.com/search/?q=%23${encoded}`,
      pinterest: `https://www.pinterest.com/search/pins/?q=${encoded}`,
    };

    return urlMap[platform.toLowerCase()] || `https://www.google.com/search?q=${encodeURIComponent(`#${clean}`)}`;
  }

  /**
   * Extract display text from wiki link path
   * e.g., "folder/Note Name.md" -> "Note Name"
   */
  private getWikiLinkDisplayText(notePath: string): string {
    // Remove .md extension if present
    const displayText = notePath.replace(/\.md$/i, '');
    // Get the last part of the path (file name without folder)
    const parts = displayText.split('/');
    return parts[parts.length - 1] || displayText;
  }

  /**
   * Render text with hashtags highlighted and clickable
   */
  private renderTextWithHashtags(container: HTMLElement, text: string, platform?: string): void {
    // Hashtag pattern: capture from # until next # or line break (supports spaces)
    const hashtagPattern = /(#[^\n\r#]+)/g;
    const parts = text.split(hashtagPattern);

    for (const part of parts) {
      if (part.startsWith('#') && part.length > 1) {
        // This is a hashtag - make it clickable if platform is provided
        if (platform) {
          const hashtagLink = container.createEl('a', {
            text: part,
            attr: {
              href: this.getHashtagUrl(part, platform),
              target: '_blank',
              rel: 'noopener noreferrer',
              title: `Search ${part} on ${platform}`
            }
          });
          hashtagLink.addClass('pcr-hashtag-link');
          hashtagLink.addEventListener('click', (e) => {
            e.stopPropagation();
          });
        } else {
          // Just highlight without link
          container.createEl('span', { text: part, cls: 'pcr-hashtag-span' });
        }
      } else {
        // Regular text
        container.appendText(part);
      }
    }
  }

  /**
   * Render text with markdown links, wiki links, and plain URLs converted to HTML
   * Converts [text](url), [[note]], and plain URLs to clickable <a> tags
   * YouTube timestamp links (e.g., [00:00](youtube.com/...&t=0s)) are handled specially
   * Also highlights hashtags
   */
  private renderMarkdownLinks(container: HTMLElement, text: string, videoId?: string, platform?: string): void {
    container.empty();

    // First, extract wiki links [[note]] and replace with placeholders
    const wikiLinks: Array<{ notePath: string; displayText: string }> = [];
    const wikiLinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let processedText = text.replace(wikiLinkPattern, (_match: string, notePath: string, displayText: string | undefined) => {
      const index = wikiLinks.length;
      // Wiki link can have display text: [[path|display]] or just [[path]]
      wikiLinks.push({
        notePath: notePath.trim(),
        displayText: displayText?.trim() || this.getWikiLinkDisplayText(notePath.trim())
      });
      return `__WIKILINK${index}__`;
    });

    // Then, replace markdown links with a placeholder to avoid processing them again
    const markdownLinks: Array<{ text: string; url: string; isTimestamp: boolean; seconds?: number }> = [];
    const markdownPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    processedText = processedText.replace(markdownPattern, (_match: string, linkText: string, linkUrl: string) => {
      const index = markdownLinks.length;

      // Check if this is a YouTube timestamp link
      let isTimestamp = false;
      let seconds: number | undefined;

      if (videoId) {
        // Pattern: &t=123s or ?t=123s
        const timestampMatch = linkUrl.match(/[?&]t=(\d+)s?/);
        if (timestampMatch && (linkUrl.includes('youtube.com') || linkUrl.includes('youtu.be'))) {
          isTimestamp = true;
          seconds = parseInt(timestampMatch[1] ?? "0");
        }
      }

      markdownLinks.push({ text: linkText, url: linkUrl, isTimestamp, seconds });
      return `__MDLINK${index}__`;
    });

    // Now find plain URLs (not already in markdown format)
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const parts: Array<{ type: 'text' | 'markdown' | 'url'; content: string; url?: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = urlPattern.exec(processedText)) !== null) {
      // Add text before the URL
      if (match.index > lastIndex) {
        const textBefore = processedText.substring(lastIndex, match.index);
        parts.push({ type: 'text', content: textBefore });
      }

      // Add the URL
      const url = match[1];
      if (url) {
        parts.push({ type: 'url', content: url, url });
      }

      lastIndex = urlPattern.lastIndex;
    }

    // Add remaining text
    if (lastIndex < processedText.length) {
      const textAfter = processedText.substring(lastIndex);
      parts.push({ type: 'text', content: textAfter });
    }

    // Render all parts
    for (const part of parts) {
      if (part.type === 'text') {
        // Check for both wiki link and markdown link placeholders
        const placeholderPattern = /__(?:WIKILINK|MDLINK)(\d+)__/g;
        let textLastIndex = 0;
        let placeholderMatch: RegExpExecArray | null;

        while ((placeholderMatch = placeholderPattern.exec(part.content)) !== null) {
          const fullMatch = placeholderMatch[0];
          const isWikiLink = fullMatch.startsWith('__WIKILINK');

          // Add text before placeholder (with hashtag highlighting)
          if (placeholderMatch.index > textLastIndex) {
            const textBefore = part.content.substring(textLastIndex, placeholderMatch.index);
            this.renderTextWithHashtags(container, textBefore, platform);
          }

          if (!placeholderMatch[1]) {
            textLastIndex = placeholderPattern.lastIndex;
            continue;
          }
          const linkIndex = parseInt(placeholderMatch[1]);

          if (isWikiLink) {
            // Wiki link - open note in Obsidian
            const wikiData = wikiLinks[linkIndex];
            if (!wikiData) {
              textLastIndex = placeholderPattern.lastIndex;
              continue;
            }

            const wikiLink = container.createEl('a', {
              text: wikiData.displayText,
              cls: 'internal-link',
              attr: {
                href: wikiData.notePath,
                'data-href': wikiData.notePath,
                title: wikiData.notePath
              }
            });
            wikiLink.addClass('pcr-wiki-link');
            wikiLink.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              // Open the note in Obsidian
              void this.plugin.app.workspace.openLinkText(wikiData.notePath, '', false);
            });
          } else {
            // Markdown link
            const linkData = markdownLinks[linkIndex];
            if (!linkData) {
              textLastIndex = placeholderPattern.lastIndex;
              continue;
            }

            if (linkData.isTimestamp && linkData.seconds !== undefined && videoId) {
              // YouTube timestamp link - create button that seeks to timestamp
              const timestampBtn = container.createEl('a', {
                text: linkData.text,
                attr: {
                  href: '#',
                  title: 'Jump to timestamp in video'
                }
              });
              timestampBtn.addClass('pcr-timestamp-btn');
              timestampBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Find controller at click time (in case it wasn't ready during render)
                const controller = this.youtubeControllers.get(videoId);
                if (controller && linkData.seconds) {
                  controller.seekTo(linkData.seconds);
                } else {
                  // No seconds timestamp or no controller - no seek action
                }
              });
            } else {
              // Regular link
              const link = container.createEl('a', {
                text: linkData.text,
                cls: 'pcr-ext-link',
                attr: {
                  href: linkData.url,
                  target: '_blank',
                  rel: 'noopener noreferrer'
                }
              });
              link.addEventListener('click', (e) => {
                e.stopPropagation();
              });
            }
          }

          textLastIndex = placeholderPattern.lastIndex;
        }

        // Add remaining text (with hashtag highlighting)
        if (textLastIndex < part.content.length) {
          const textAfter = part.content.substring(textLastIndex);
          this.renderTextWithHashtags(container, textAfter, platform);
        }
      } else if (part.type === 'url' && part.url) {
        // Create clickable link for plain URL
        const link = container.createEl('a', {
          text: part.content,
          cls: 'pcr-ext-link',
          attr: {
            href: part.url,
            target: '_blank',
            rel: 'noopener noreferrer'
          }
        });
        link.addEventListener('click', (e) => {
          e.stopPropagation();
        });
      }
    }
  }

  /**
   * Generate random share ID (12 characters, alphanumeric)
   * @unused - Reserved for future use
   */
  private _generateShareId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Upload local images to R2 and replace markdown paths with R2 URLs
   */
  private async _uploadLocalImagesAndReplaceUrls(content: string, shareId: string, workerUrl: string): Promise<string> {
    let updatedContent = content;

    // Find all markdown image references
    const imageRegex = /!\[([^\]]*)\]\((attachments\/[^)]+)\)/g;
    const matches = Array.from(content.matchAll(imageRegex));

    for (const match of matches) {
      const [fullMatch, alt, localPath] = match;

      if (!localPath) continue;

      try {
        // Get the file from vault
        const imageFile = this.vault.getAbstractFileByPath(localPath);
        if (!imageFile || !(imageFile instanceof TFile)) {
          continue;
        }

        // Read image as binary
        const imageBuffer = await this.vault.readBinary(imageFile);

        // Convert to base64
        const base64 = this.arrayBufferToBase64(imageBuffer);

        // Extract filename
        const filename = localPath.split('/').pop() || 'image.jpg';

        // Determine content type from extension
        const ext = filename.split('.').pop()?.toLowerCase();
        const contentType = ext === 'png' ? 'image/png' :
                           ext === 'gif' ? 'image/gif' :
                           ext === 'webp' ? 'image/webp' : 'image/jpeg';

        // Upload to Worker
        const uploadResponse = await requestUrl({
          url: `${workerUrl}/api/upload-share-media`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            shareId,
            filename,
            contentType,
            data: base64
          }),
          throw: false
        });

        if (uploadResponse.status !== 200) {
          continue;
        }

        const uploadResult = uploadResponse.json as Record<string, unknown>;
        const r2Url = ((uploadResult.data as Record<string, unknown>).url) as string;

        // Replace local path with R2 URL in content
        updatedContent = updatedContent.replace(fullMatch, `![${alt}](${r2Url})`);


      } catch {
      // Intentional: error silenced, action already complete
      }
    }

    return updatedContent;
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i] as number);
    }
    return btoa(binary);
  }

  // Removed: uploadMediaFilesToR2() - Use ShareAPIClient.updateShareWithMedia() instead

  /**
   * Remove YAML frontmatter from markdown content
   */
  private _removeYamlFrontmatter(content: string): string {
    // Remove YAML frontmatter (---\n...\n---)
    return content.replace(/^---\n[\s\S]*?\n---\n/, '');
  }

  /**
   * Remove first H1 heading from markdown content
   */
  private _removeFirstH1(content: string): string {
    // Remove first # Title line
    return content.replace(/^#\s+.+\n/, '');
  }

  /**
   * Delete a link preview from post's frontmatter
   */
  private async deleteLinkPreview(post: PostData, urlToDelete: string, _rootElement: HTMLElement): Promise<void> {

    if (!post.filePath) {
      new Notice('Cannot delete preview: no file path');
      return;
    }

    try {
      // Get file
      const file = this.vault.getAbstractFileByPath(post.filePath);
      if (!file || !(file instanceof TFile)) {
        new Notice('Cannot delete preview: file not found');
        return;
      }

      // Read file content
      const content = await this.vault.read(file);

      // Parse frontmatter and body
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!frontmatterMatch) {
        new Notice('Cannot delete preview: invalid file format');
        return;
      }

      const [, frontmatterText, body] = frontmatterMatch;

      if (!frontmatterText) {
        new Notice('Cannot delete preview: empty frontmatter');
        return;
      }

      // Parse YAML frontmatter
      const frontmatterLines = frontmatterText.split('\n');
      const newFrontmatterLines: string[] = [];
      let inLinkPreviews = false;
      let skipNext = false;

      for (let i = 0; i < frontmatterLines.length; i++) {
        const line = frontmatterLines[i];

        if (!line) continue;

        if (skipNext) {
          skipNext = false;
          continue;
        }

        if (line.startsWith('linkPreviews:')) {
          inLinkPreviews = true;
          newFrontmatterLines.push(line);
          continue;
        }

        if (inLinkPreviews) {
          // Check if this is a link preview item
          if (line.match(/^\s+-\s+/)) {
            // Extract URL from this line
            const urlMatch = line.match(/^\s+-\s+["']?(.+?)["']?$/);
            if (urlMatch && urlMatch[1] === urlToDelete) {
              // Skip this line (delete the URL)
              continue;
            }
            newFrontmatterLines.push(line);
          } else {
            // End of linkPreviews array
            inLinkPreviews = false;
            newFrontmatterLines.push(line);
          }
        } else {
          newFrontmatterLines.push(line);
        }
      }

      // Reconstruct file content
      const newContent = `---\n${newFrontmatterLines.join('\n')}\n---\n${body}`;

      // Register UI modify to prevent double refresh
      if (this.onUIModifyCallback && post.filePath) {
        this.onUIModifyCallback(post.filePath);
      }

      // Write back to file
      await this.vault.modify(file, newContent);

      new Notice('Link preview removed');

      // Update post data
      if (post.linkPreviews) {
        post.linkPreviews = post.linkPreviews.filter(url => url !== urlToDelete);
      }

      // Note: The preview card is already removed by LinkPreviewRenderer's animation
      // No need to re-render the entire post card

    } catch {
      new Notice('Failed to remove link preview');
    }
  }

  /**
   * Extract YouTube video ID from URL
   */
  private extractYouTubeVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);

      // Standard youtube.com/watch?v=VIDEO_ID
      if (urlObj.hostname.includes('youtube.com')) {
        const videoId = urlObj.searchParams.get('v');
        if (videoId) return videoId;

        // youtube.com/embed/VIDEO_ID or youtube.com/shorts/VIDEO_ID
        const pathMatch = urlObj.pathname.match(/\/(embed|shorts|live)\/([A-Za-z0-9_-]+)/);
        if (pathMatch && pathMatch[2]) return pathMatch[2];
      }

      // Shortened youtu.be/VIDEO_ID
      if (urlObj.hostname === 'youtu.be') {
        const match = urlObj.pathname.match(/\/([A-Za-z0-9_-]+)/);
        return (match && match[1]) ? match[1] : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Enrich embedded post with parent's localAvatar if same author (self-boost)
   */
  private enrichWithParentAvatar(embeddedPost: PostData, parentPost: PostData): PostData {
    // Skip if embedded post already has localAvatar
    if (embeddedPost.author.localAvatar) {
      return embeddedPost;
    }

    // Skip if parent doesn't have localAvatar
    if (!parentPost.author.localAvatar) {
      return embeddedPost;
    }

    // Check if same author (by URL or handle)
    const isSameAuthor = this.isSameAuthorForAvatar(embeddedPost.author, parentPost.author);
    if (!isSameAuthor) {
      return embeddedPost;
    }

    // Inject parent's localAvatar
    return {
      ...embeddedPost,
      author: {
        ...embeddedPost.author,
        localAvatar: parentPost.author.localAvatar,
      },
    };
  }

  /**
   * Check if two authors are the same person for avatar inheritance
   */
  private isSameAuthorForAvatar(author1: PostData['author'], author2: PostData['author']): boolean {
    // Compare by URL first (most reliable)
    if (author1.url && author2.url) {
      const normalizeUrl = (url: string) => url.toLowerCase().replace(/\/+$/, '');
      if (normalizeUrl(author1.url) === normalizeUrl(author2.url)) {
        return true;
      }
    }
    // Compare by handle
    if (author1.handle && author2.handle) {
      const normalizeHandle = (h: string) => h.toLowerCase().replace(/^@/, '');
      if (normalizeHandle(author1.handle) === normalizeHandle(author2.handle)) {
        return true;
      }
    }
    // Compare by username
    if (author1.username && author2.username) {
      return author1.username.toLowerCase() === author2.username.toLowerCase();
    }
    return false;
  }

  /**
   * Render full post inline in expanded container
   */
  private async renderFullPostInline(post: PostData, container: HTMLElement): Promise<void> {
    container.empty();

    // Add padding and overflow handling (reduced padding for compact display)
    const contentWrapper = container.createDiv({ cls: 'pcr-expanded-content' });

    // Render the full post card (without the compact version inside to avoid recursion)
    // We'll create a temporary clone without embeddedArchives and comment to prevent nesting and hide header
    // Also convert media paths from relative to vault paths
    const convertedMedia = post.media.map(media => {
      let url = media.url;
      // Convert relative paths (../../../../attachments/...) to vault paths
      if (url.includes('../attachments/')) {
        url = url.replace(/^(\.\.\/)+/, '');
      }
      return { ...media, url };
    });

    const postClone: PostData = {
      ...post,
      media: convertedMedia,
      embeddedArchives: [], // Clear embedded archives to prevent nesting
      // Keep quotedPost to render it in the expanded view
      comment: '' // Clear comment to hide "saved this post" header
    };

    await this.render(contentWrapper, postClone, true); // isEmbedded = true

    // Remove the left border from nested card (embedded archive shouldn't have border)
    const nestedCardContainers = contentWrapper.querySelectorAll('div');
    nestedCardContainers.forEach((div) => {
      const element = div as HTMLElement;
      if (element.style.borderLeft) {
        element.addClass('pcr-expanded-no-border');
      }
    });

    // Hide the "saved this post" header and comment sections
    const savedSections = contentWrapper.querySelectorAll('.mb-3');
    savedSections.forEach((section) => {
      const element = section as HTMLElement;
      // Check if it contains "saved this post" or "commented on this post"
      if (element.textContent?.includes('saved this post') ||
          element.textContent?.includes('commented on this post') ||
          element.textContent?.includes('created a post')) {
        element.hide();
      }
    });

    // Hide action buttons (favorite, share, archive, open note, delete)
    // These actions should be done from the parent post, not the embedded archive
    const actionIcons = contentWrapper.querySelectorAll('[title="Add to favorites"], [title="Share this post to the web"], [title="Archive this post"], [title="Open note in Obsidian"], [title="Delete this post"]');
    actionIcons.forEach((icon) => {
      (icon as HTMLElement).hide();
    });
  }

  /**
   * Render archive suggestion banners for unprocessed social media URLs
   */
  private async renderArchiveSuggestions(contentArea: HTMLElement, post: PostData, rootElement: HTMLElement, isEmbedded: boolean = false): Promise<void> {
    // Get archive and download URLs from post
    const postRec4 = post as unknown as Record<string, unknown>;
    const processedUrls: string[] = Array.isArray(postRec4.processedUrls) ? (postRec4.processedUrls as string[]) : [];
    const downloadedUrls: string[] = Array.isArray(post.downloadedUrls) ? post.downloadedUrls : [];

    // Check if main post itself is TikTok/YouTube and show download banner
    // Skip download banner for embedded archives (they're already part of the parent post)
    if (!isEmbedded && (post.platform === 'youtube' || post.platform === 'tiktok') && post.url) {
      const mainPostUrl = post.url;
      const hasLocalVideo = post.media.some((mediaItem) =>
        mediaItem.type === 'video' && mediaItem.url && !mediaItem.url.startsWith('http')
      );
      const urlMarkerMatches = (markerPrefix: 'downloaded:' | 'declined:'): boolean =>
        downloadedUrls.some((entry) => {
          if (!entry.startsWith(markerPrefix)) return false;
          const markedUrl = entry.substring(markerPrefix.length);
          return markedUrl === mainPostUrl
            || markedUrl.includes(mainPostUrl)
            || mainPostUrl.includes(markedUrl);
        });
      const isDownloaded = urlMarkerMatches('downloaded:');
      const isDownloadDeclined = urlMarkerMatches('declined:');

      if (hasLocalVideo || isDownloaded) {
        await this.renderVideoTranscriptionSuggestion(contentArea, post, rootElement);
      } else if (!isDownloadDeclined) {
        // Check if yt-dlp is available
        const { YtDlpDetector } = await import('../../../utils/yt-dlp');
        const isSupportedUrl = YtDlpDetector.isSupportedUrl(mainPostUrl);
        const ytDlpAvailable = ObsidianPlatform.isDesktop && isSupportedUrl ? await YtDlpDetector.isAvailable() : false;

        if (ytDlpAvailable) {
          this.renderDownloadSuggestionBanner(contentArea, mainPostUrl, post.platform, post, rootElement);
        }
      }
    }

    // Check if main post is a podcast with audio to download
    // Skip for embedded archives
    if (!isEmbedded && post.platform === 'podcast') {
      const audioUrl: string | undefined = post.audioUrl || post.media?.find(m => m.type === 'audio')?.url;
      const audioSize: number | undefined = post.audioSize;

      if (audioUrl) {
        // Check if audio is already downloaded or declined (same pattern as video)
        // Local path means already downloaded, external URL needs downloadedUrls check
        const isLocalPath = !audioUrl.startsWith('http://') && !audioUrl.startsWith('https://');
        const isDownloaded = isLocalPath || downloadedUrls.includes(`downloaded:${audioUrl}`);
        const isDownloadDeclined = downloadedUrls.includes(`declined:${audioUrl}`);

        if (isLocalPath) {
          // Audio already downloaded - render audio player in media section
          // (handled by MediaGalleryRenderer)
        } else if (!isDownloaded && !isDownloadDeclined) {
          // External URL not yet downloaded - show download banner
          this.renderAudioDownloadBanner(contentArea, audioUrl, audioSize, post, rootElement);
        }

        // Check for transcription banner (only if audio is downloaded)
        if (isDownloaded || isLocalPath) {
          const localAudioPath = isLocalPath ? audioUrl : this.getLocalAudioPath(post, audioUrl);
          if (localAudioPath) {
            const transcribedUrls: string[] = Array.isArray(post.transcribedUrls)
              ? post.transcribedUrls : [];
            const isTranscribed = transcribedUrls.some(u =>
              u === `transcribed:${localAudioPath}` || u.endsWith(`:${localAudioPath}`)
            );
            const isTranscribeDeclined = transcribedUrls.includes(`declined:${localAudioPath}`);

            if (!isTranscribed && !isTranscribeDeclined) {
              // Check if Whisper is available and transcription is enabled (desktop only)
              if (ObsidianPlatform.isDesktop && this.plugin.settings.transcription?.enabled) {
                const { WhisperDetector } = await import('../../../utils/whisper');
                const whisperAvailable = await WhisperDetector.isAvailable();

                if (whisperAvailable) {
                  await this.renderTranscriptionBanner(contentArea, localAudioPath, post, rootElement);
                }
              }
            }
          }
        }
      }
    }

    // Skip linkPreviews archive suggestions for podcast posts
    // (podcast linkPreviews are typically "Support the show", social links, etc.)
    if (post.platform === 'podcast') return;

    // Categorize URLs by status
    for (const url of post.linkPreviews || []) {
      if (!isSupportedPlatformUrl(url)) continue;

      const validation = validateAndDetectPlatform(url);
      if (!validation.valid || !validation.platform) continue;

      const platform = validation.platform as string;
      let urlVariants = [url];
      let isPinterestBoard = false;

      if (platform === 'pinterest') {
        try {
          const resolution = await resolvePinterestUrl(url);
          const resolvedUrl = resolution.resolvedUrl;
          isPinterestBoard = resolution.isBoard;
          if (resolvedUrl && resolvedUrl !== url) {
            urlVariants = Array.from(new Set([url, resolvedUrl]));
          }
        } catch {
          // Fallback to original URL
        }
      } else {
        isPinterestBoard = platform === 'pinterest' && isPinterestBoardUrl(url);
      }

      // Check URL status (consider all variants: short + resolved)
      const isArchiving = urlVariants.some(u => processedUrls.includes(`archiving:${u}`));
      const isArchived = urlVariants.some(u => processedUrls.includes(u));
      const isDeclined = urlVariants.some(u => processedUrls.includes(`declined:${u}`));
      const isDownloaded = urlVariants.some(u => downloadedUrls.includes(`downloaded:${u}`));
      const isDownloadDeclined = urlVariants.some(u => downloadedUrls.includes(`declined:${u}`));

      // Priority: archiving > downloaded > download-declined > archived/declined > unprocessed
      if (isArchiving) {
        // Show "Archiving..." progress banner
        this.renderArchivingProgressBanner(contentArea, url, platform, post, rootElement);
      } else if (isDownloaded) {
        // Show "Downloaded" status banner
        this.renderStatusBanner(contentArea, url, platform, 'downloaded', post, rootElement);
      } else if (isDownloadDeclined) {
        // Show "Download declined" status banner (no archive status needed)
        this.renderStatusBanner(contentArea, url, platform, 'download-declined', post, rootElement);
      } else if (isArchived) {
        // Show download suggestion only for YouTube and TikTok (no "Archived" status banner)
        if (platform === 'youtube' || platform === 'tiktok') {
          const { YtDlpDetector } = await import('../../../utils/yt-dlp');
          const isSupportedUrl = YtDlpDetector.isSupportedUrl(url);
          const ytDlpAvailable = ObsidianPlatform.isDesktop && isSupportedUrl ? await YtDlpDetector.isAvailable() : false;

          if (ytDlpAvailable) {
            this.renderDownloadSuggestionBanner(contentArea, url, platform, post, rootElement);
          }
        }
      } else if (isDeclined) {
        // Don't show "Declined" banner, just show download suggestion if applicable (YouTube/TikTok only)
        if (platform === 'youtube' || platform === 'tiktok') {
          const { YtDlpDetector } = await import('../../../utils/yt-dlp');
          const isSupportedUrl = YtDlpDetector.isSupportedUrl(url);
          const ytDlpAvailable = ObsidianPlatform.isDesktop && isSupportedUrl ? await YtDlpDetector.isAvailable() : false;

          if (ytDlpAvailable) {
            this.renderDownloadSuggestionBanner(contentArea, url, platform, post, rootElement);
          }
        }
      } else {
        // Show suggestion banner for unprocessed URLs
        this.renderSuggestionBanner(contentArea, url, platform, post, rootElement, isPinterestBoard, urlVariants);
      }
    }
  }

  /**
   * Render archiving progress banner
   */
  private renderArchivingProgressBanner(
    contentArea: HTMLElement,
    _url: string,
    _platform: string,
    _post: PostData,
    _rootElement: HTMLElement
  ): void {
    // Note: url, platform, post, rootElement params available for future use
    const banner = contentArea.createDiv({ cls: 'archive-progress-banner pcr-suggestion-banner pcr-suggestion-banner-filled' });

    // Spinner
    banner.createDiv({ cls: 'pcr-spinner' });

    // Message
    banner.createSpan({ cls: 'pcr-banner-message', text: 'Archiving in background...' });
  }

  /**
   * Render a status banner (downloaded, download-declined)
   */
  private renderStatusBanner(
    contentArea: HTMLElement,
    url: string,
    platform: string,
    status: 'downloaded' | 'download-declined',
    post: PostData,
    rootElement: HTMLElement
  ): void {
    // For download-declined status, don't show any banner
    if (status === 'download-declined') {
      return;
    }

    // For downloaded status, check if post is archived or declined
    // If only downloaded but not archived/declined, suggest archiving
    if (status === 'downloaded') {
      const postRec4 = post as unknown as Record<string, unknown>;
    const processedUrls: string[] = Array.isArray(postRec4.processedUrls) ? (postRec4.processedUrls as string[]) : [];

      // Check if this URL was already archived (plain URL) or declined (declined: prefix)
      const hasArchived = processedUrls.includes(url);
      const hasDeclined = processedUrls.includes(`declined:${url}`);

      if (!hasArchived && !hasDeclined) {
        // Video downloaded but post not archived/declined - show archive suggestion
        this.renderSuggestionBanner(contentArea, url, platform, post, rootElement);
      }
      return;
    }

    // For other statuses, show the status banner
    const banner = contentArea.createDiv({ cls: 'archive-status-banner pcr-suggestion-banner' });

    // Status message - clear and descriptive (only 'downloaded' supported now)
    const messageText = 'Video downloaded';

    banner.createSpan({ cls: 'pcr-banner-message', text: messageText });

    // Auto-hide banner after 2 seconds
    setTimeout(() => {
      banner.addClass('pcr-fade-out');
      setTimeout(() => banner.remove(), 300);
    }, 2000);
  }

  /**
   * Render yt-dlp download suggestion banner (after archive)
   */
  private renderDownloadSuggestionBanner(
    contentArea: HTMLElement,
    url: string,
    platform: string,
    post: PostData,
    rootElement: HTMLElement
  ): void {
    const banner = contentArea.createDiv({ cls: 'download-suggestion-banner pcr-suggestion-banner' });

    // Message
    const message = banner.createSpan({ cls: 'pcr-banner-message', text: 'Download this video?' });

    // Buttons
    const buttonSection = banner.createDiv({ cls: 'pcr-banner-buttons' });

    // No button (X icon)
    const noButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-cancel' });
    noButton.setAttribute('aria-label', 'No');
    noButton.setAttribute('title', 'No');

    const noIcon = noButton.createDiv({ cls: 'pcr-icon-btn-icon' });
    setIcon(noIcon, 'x');
    noButton.addEventListener('click', () => {
      // Mark as download declined
      buttonSection.hide();
      message.textContent = 'Marking as declined...';

      void (async () => {
        try {
          await this.markUrlAsDownloadDeclined(post, url);
          banner.remove();

          // Refresh to show "Download declined" status
          setTimeout(() => {
            rootElement.empty();
            void this.render(rootElement, post);
          }, 500);
        } catch {
          banner.remove();
        }
      })();
    });

    // Yes button (Download icon)
    const yesButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-accent' });
    yesButton.setAttribute('aria-label', 'Download');
    yesButton.setAttribute('title', 'Yes, download');

    const yesIcon = yesButton.createDiv({ cls: 'pcr-icon-btn-icon' });
    setIcon(yesIcon, 'download');

    yesButton.addEventListener('click', () => { void (async () => {
      // Create AbortController for cancellation
      const abortController = new AbortController();

      // Replace buttons with cancel button
      buttonSection.empty();

      // Cancel button (X icon)
      const cancelButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-cancel-lg' });
      cancelButton.setAttribute('aria-label', 'Cancel download');
      cancelButton.setAttribute('title', 'Cancel download');

      const cancelIcon = cancelButton.createDiv({ cls: 'pcr-icon-btn-icon-sm' });
      setIcon(cancelIcon, 'x');

      cancelButton.addEventListener('click', () => {
        abortController.abort();
        message.textContent = 'Download cancelled';
        message.removeClass('pcr-text-normal');
        message.addClass('pcr-text-muted');

        // Remove banner after 2 seconds
        setTimeout(() => {
          banner.addClass('pcr-fade-out');
          setTimeout(() => banner.remove(), 300);
        }, 2000);
      });

      message.textContent = 'Downloading with yt-dlp...';
      message.removeClass('pcr-text-muted');
      message.addClass('pcr-text-normal');

      try {
        await this.downloadWithYtDlp(url, platform, post, rootElement, message, abortController.signal);

        // Hide cancel button on success
        buttonSection.hide();

        // Show success message for 2 seconds, then fade out
        setTimeout(() => {
          banner.addClass('pcr-fade-out');
          setTimeout(() => banner.remove(), 300);
        }, 2000);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Don't show error if it was cancelled
        if (errorMessage.includes('cancelled')) {
          message.textContent = 'Download cancelled';
          message.addClasses(['pcr-text-muted']);
        } else {
          message.textContent = `Download failed: ${errorMessage}`;
          message.addClasses(['pcr-text-error']);
        }

        // Remove cancel button and show original buttons on error
        buttonSection.empty();
        buttonSection.hide();

        // Remove banner after showing message
        setTimeout(() => {
          banner.addClass('pcr-fade-out');
          setTimeout(() => banner.remove(), 300);
        }, 3000);
      }
    })(); });
  }

  /**
   * Render podcast audio download banner
   */
  private renderAudioDownloadBanner(
    contentArea: HTMLElement,
    audioUrl: string,
    audioSize: number | undefined,
    post: PostData,
    rootElement: HTMLElement
  ): void {
    const banner = contentArea.createDiv({ cls: 'audio-download-suggestion-banner pcr-suggestion-banner' });

    // Message with file size
    const message = banner.createSpan({ cls: 'pcr-banner-message' });
    const sizeText = audioSize ? ` (~${this.formatFileSize(audioSize)})` : '';
    message.textContent = `Download this episode?${sizeText}`;

    // Buttons
    const buttonSection = banner.createDiv({ cls: 'pcr-banner-buttons' });

    // No button (X icon)
    const noButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-cancel' });
    noButton.setAttribute('aria-label', 'No');
    noButton.setAttribute('title', 'No');

    const noIcon = noButton.createDiv({ cls: 'pcr-icon-btn-icon' });
    setIcon(noIcon, 'x');

    noButton.addEventListener('click', () => {
      // Mark as download declined
      buttonSection.hide();
      message.textContent = 'Marking as declined...';

      void (async () => {
        try {
          await this.markUrlAsDownloadDeclined(post, audioUrl);
          banner.remove();
        } catch {
          banner.remove();
        }
      })();
    });

    // Yes button (Download icon)
    const yesButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-accent' });
    yesButton.setAttribute('aria-label', 'Download');
    yesButton.setAttribute('title', 'Yes, download');

    const yesIcon = yesButton.createDiv({ cls: 'pcr-icon-btn-icon' });
    setIcon(yesIcon, 'download');

    yesButton.addEventListener('click', () => { void (async () => {
      // Create AbortController for cancellation
      const abortController = new AbortController();

      // Replace buttons with cancel button
      buttonSection.empty();

      // Cancel button (X icon)
      const cancelButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-cancel-lg' });
      cancelButton.setAttribute('aria-label', 'Cancel download');
      cancelButton.setAttribute('title', 'Cancel download');

      const cancelIcon = cancelButton.createDiv({ cls: 'pcr-icon-btn-icon-sm' });
      setIcon(cancelIcon, 'x');

      cancelButton.addEventListener('click', () => {
        abortController.abort();
        message.textContent = 'Download cancelled';
        message.addClass('pcr-text-muted');

        // Remove banner after 2 seconds
        setTimeout(() => {
          banner.addClass('pcr-fade-out');
          setTimeout(() => banner.remove(), 300);
        }, 2000);
      });

      // Show downloading message with file size if available
      const sizeInfo = audioSize ? ` (${this.formatFileSize(audioSize)})` : '';
      message.textContent = `Downloading audio${sizeInfo}...`;

      // Add loading animation
      let dots = 0;
      const loadingInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        message.textContent = `Downloading audio${sizeInfo}${'.'.repeat(dots)}`;
      }, 400);

      try {
        await this.downloadPodcastAudio(audioUrl, post, rootElement, message, banner, abortController.signal);
        clearInterval(loadingInterval);

        // Hide cancel button on success
        buttonSection.hide();

        // Show success message for 2 seconds, then fade out
        setTimeout(() => {
          banner.addClass('pcr-fade-out');
          setTimeout(() => banner.remove(), 300);
        }, 2000);
      } catch (error) {
        clearInterval(loadingInterval);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Don't show error if it was cancelled
        if (errorMessage.includes('cancelled') || errorMessage.includes('aborted')) {
          message.textContent = 'Download cancelled';
          message.addClass('pcr-text-muted');
        } else {
          message.textContent = `Download failed: ${errorMessage}`;
          message.addClass('pcr-text-error');
        }

        // Remove cancel button and show original buttons on error
        buttonSection.empty();
        buttonSection.hide();

        // Remove banner after showing message
        setTimeout(() => {
          banner.addClass('pcr-fade-out');
          setTimeout(() => banner.remove(), 300);
        }, 3000);
      }
    })(); });
  }

  /**
   * Format file size to human-readable format
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Get local audio path from downloaded URLs
   */
  private getLocalAudioPath(post: PostData, originalAudioUrl: string): string | null {
    // If post has audioLocalPath, use it
    if (post.audioLocalPath) {
      return post.audioLocalPath;
    }

    // Check if audioUrl has been updated to a local path
    const currentAudioUrl = post.audioUrl;
    if (currentAudioUrl && !currentAudioUrl.startsWith('http://') && !currentAudioUrl.startsWith('https://')) {
      return currentAudioUrl;
    }

    // Try to find from downloadedUrls
    const downloadedUrls: string[] = Array.isArray(post.downloadedUrls) ? post.downloadedUrls : [];
    for (const entry of downloadedUrls) {
      if (entry.startsWith('downloaded:') && entry.includes(originalAudioUrl)) {
        // This just means it was downloaded, but we need the local path
        // which should be in audioUrl or audioLocalPath
        break;
      }
    }

    return null;
  }

  private async renderVideoTranscriptionSuggestion(
    contentArea: HTMLElement,
    post: PostData,
    rootElement: HTMLElement
  ): Promise<void> {
    if (!ObsidianPlatform.isDesktop) return;
    if (!this.plugin.settings.transcription?.enabled) return;
    if (!post.filePath) return;

    if (post.videoTranscribed === true) return;
    if (post.whisperTranscript?.segments && post.whisperTranscript.segments.length > 0) return;

    const localVideoFromParsedMedia = post.media.find((mediaItem) =>
      mediaItem.type === 'video' && mediaItem.url && !mediaItem.url.startsWith('http')
    )?.url;

    const localVideoPaths = await this.plugin.resolveLocalVideoPathsInNote(post.filePath);
    const targetVideoPath = localVideoFromParsedMedia || localVideoPaths[0];
    if (!targetVideoPath) return;

    // Backward compatibility: treat legacy transcribedUrls marker as already transcribed.
    const transcribedUrls: string[] = Array.isArray(post.transcribedUrls)
      ? post.transcribedUrls
      : [];
    const hasLegacyTranscribed = transcribedUrls.some((entry) =>
      entry === `transcribed:${targetVideoPath}` || entry.endsWith(`:${targetVideoPath}`)
    );
    if (hasLegacyTranscribed) return;

    const { WhisperDetector } = await import('../../../utils/whisper');
    const whisperAvailable = await WhisperDetector.isAvailable();
    if (!whisperAvailable) return;

    await this.renderTranscriptionBanner(contentArea, targetVideoPath, post, rootElement, 'video');
  }

  /**
   * Get media duration (audio/video) from file path
   */
  private async getMediaDuration(mediaPath: string): Promise<number | null> {
    try {
      const resourcePath = this.vault.adapter.getResourcePath(mediaPath);
      const lowerPath = mediaPath.toLowerCase();
      const isVideo = /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(lowerPath);

      return new Promise((resolve) => {
        const mediaElement = isVideo
          ? document.createElement('video')
          : document.createElement('audio');

        mediaElement.preload = 'metadata';
        mediaElement.src = resourcePath;

        mediaElement.addEventListener('loadedmetadata', () => {
          resolve(Number.isFinite(mediaElement.duration) ? mediaElement.duration : null);
        });
        mediaElement.addEventListener('error', () => {
          resolve(null);
        });
        // Timeout after 5 seconds
        setTimeout(() => resolve(null), 5000);
      });
    } catch {
      return null;
    }
  }

  /**
   * Render transcription banner for local media (audio/video)
   */
  private async renderTranscriptionBanner(
    contentArea: HTMLElement,
    mediaPath: string,
    post: PostData,
    rootElement: HTMLElement,
    mode: 'audio' | 'video' = 'audio'
  ): Promise<void> {
    const { WhisperDetector } = await import('../../../utils/whisper');
    const preferredVariant = this.plugin.settings.transcription?.preferredVariant || 'auto';
    // Use user's preferred variant if set, otherwise use auto-detected
    const variant = preferredVariant !== 'auto' ? preferredVariant : WhisperDetector.getVariant();
    const installedModels = WhisperDetector.getInstalledModels();
    const duration = await this.getMediaDuration(mediaPath);

    const banner = contentArea.createDiv({ cls: 'transcription-suggestion-banner pcr-suggestion-banner' });

    // Current selected model (mutable)
    let selectedModel: WhisperModel = (this.plugin.settings.transcription?.preferredModel || 'medium') as WhisperModel;

    // Helper to format estimated time
    const getTimeEstimate = (model: WhisperModel): string => {
      if (!duration || duration <= 0) return '';
      const estimatedSeconds = WhisperDetector.estimateTranscriptionTime(duration, model, variant);
      return WhisperDetector.formatEstimatedTime(estimatedSeconds);
    };

    // Message section: message + time estimate + dropdown
    const messageSection = banner.createDiv({ cls: 'pcr-banner-message-section' });

    const message = messageSection.createSpan({ cls: 'pcr-banner-message-nowrap' });
    message.textContent = `Transcribe with ${variant || 'Whisper'}?`;

    // Time estimate (will be updated when model changes)
    const timeEstimate = messageSection.createSpan({ cls: 'transcription-time pcr-banner-time-estimate' });
    const initialTime = getTimeEstimate(selectedModel);
    timeEstimate.textContent = initialTime ? `(~${initialTime})` : '';

    // Model dropdown (only show if multiple models available) - placed after time estimate
    if (installedModels.length > 1) {
      // Wrapper for select + arrow icon
      const selectWrapper = messageSection.createDiv({ cls: 'pcr-model-select-wrapper' });

      const modelSelect = selectWrapper.createEl('select', { cls: 'pcr-model-select' });

      // Helper to adjust select width based on selected text
      const adjustSelectWidth = () => {
        const tempSpan = document.createElement('span');
        tempSpan.addClass('pcr-model-select-measure');
        tempSpan.textContent = modelSelect.value;
        document.body.appendChild(tempSpan);
        modelSelect.setCssStyles({ width: `${tempSpan.offsetWidth + 2}px` });
        document.body.removeChild(tempSpan);
      };

      // Lucide chevron-down icon
      const arrowIcon = selectWrapper.createDiv({ cls: 'pcr-model-select-arrow' });
      setIcon(arrowIcon, 'chevron-down');

      // Add model options
      const modelOrder = ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3'];
      const sortedModels = installedModels.sort((a, b) =>
        modelOrder.indexOf(a) - modelOrder.indexOf(b)
      );

      for (const model of sortedModels) {
        const option = modelSelect.createEl('option', { value: model, text: model });
        if (model === selectedModel) {
          option.selected = true;
        }
      }

      // If preferred model not in installed list, select first available
      if (!installedModels.includes(selectedModel) && sortedModels.length > 0) {
        const firstModel = sortedModels[0];
        if (firstModel) {
          selectedModel = firstModel;
          modelSelect.value = selectedModel;
        }
      }

      // Set initial width
      adjustSelectWidth();

      modelSelect.addEventListener('change', () => {
        selectedModel = modelSelect.value as WhisperModel;
        const newTime = getTimeEstimate(selectedModel);
        timeEstimate.textContent = newTime ? `(~${newTime})` : '';
        adjustSelectWidth();
      });

      // Click on wrapper (including arrow) opens the select dropdown
      selectWrapper.addEventListener('click', (e) => {
        if (e.target !== modelSelect) {
          modelSelect.showPicker();
        }
      });
    }

    // Right section: buttons only
    const rightSection = banner.createDiv({ cls: 'pcr-banner-buttons' });

    // Buttons container
    const buttonSection = rightSection.createDiv({ cls: 'transcription-buttons pcr-banner-buttons-inner' });

    // No button (X icon)
    const noButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-cancel' });
    noButton.setAttribute('aria-label', 'No');
    noButton.setAttribute('title', 'No');

    const noIcon = noButton.createDiv({ cls: 'pcr-icon-btn-icon' });
    setIcon(noIcon, 'x');
    noButton.addEventListener('click', () => {
      buttonSection.hide();
      message.textContent = mode === 'video' ? 'Saving for batch...' : 'Marking as declined...';

      void (async () => {
        try {
          if (mode === 'video') {
            await this.markVideoTranscriptionDeferred(post);
          } else {
            await this.markUrlAsTranscribeDeclined(post, mediaPath);
          }
          banner.remove();
        } catch {
          banner.remove();
        }
      })();
    });

    // Yes button (Microphone icon)
    const yesButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-accent' });
    yesButton.setAttribute('aria-label', 'Transcribe');
    yesButton.setAttribute('title', 'Yes, transcribe');

    const yesIcon = yesButton.createDiv({ cls: 'pcr-icon-btn-icon' });
    setIcon(yesIcon, 'mic');
    yesButton.addEventListener('click', () => { void (async () => {
      const abortController = new AbortController();

      // Replace buttons with cancel button
      buttonSection.empty();

      const cancelButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-cancel-lg' });
      cancelButton.setAttribute('aria-label', 'Cancel transcription');
      cancelButton.setAttribute('title', 'Cancel transcription');

      const cancelIcon = cancelButton.createDiv({ cls: 'pcr-icon-btn-icon-sm' });
      setIcon(cancelIcon, 'x');
      cancelButton.addEventListener('click', () => {
        abortController.abort();
        message.textContent = 'Cancelling...';
        // Fallback: remove banner after 5 seconds if still visible
        setTimeout(() => {
          if (banner.isConnected) {
            message.textContent = 'Transcription cancelled';
            setTimeout(() => banner.remove(), 1500);
          }
        }, 5000);
      });

      // Hide model dropdown wrapper during transcription
      const modelDropdown = banner.querySelector('select');
      if (modelDropdown?.parentElement) {
        modelDropdown.parentElement?.hide();
      }

      // Execute transcription with selected model
      await this.executeTranscription(mediaPath, post, rootElement, message, banner, abortController.signal, selectedModel, variant, mode);
    })(); });
  }

  /**
   * Execute Whisper transcription for a local media file
   */
  private async executeTranscription(
    mediaPath: string,
    post: PostData,
    rootElement: HTMLElement,
    messageEl: HTMLElement,
    banner: HTMLElement,
    signal: AbortSignal,
    model?: WhisperModel,
    variant?: string | null,
    mode: 'audio' | 'video' = 'audio'
  ): Promise<void> {
    const { TranscriptionService } = await import('../../../services/TranscriptionService');
    const { TranscriptionError } = await import('../../../types/transcription');
    const transcriptionService = new TranscriptionService();

    // Use provided model or fall back to settings
    const selectedModel: WhisperModel = (model || this.plugin.settings.transcription?.preferredModel || 'medium') as WhisperModel;

    try {
      // Resolve full vault path
      const adapter = this.vault.adapter;
      const basePath = (adapter as unknown as { basePath?: string }).basePath || '';
      const fullPath = basePath ? `${basePath}/${mediaPath}` : mediaPath;

      messageEl.textContent = `Starting transcription (${selectedModel})...`;

      if (mode === 'video') {
        await this.markVideoTranscriptionRequested(post);
      }

      // Get duration from PostData (media or metadata)
      const mediaDuration = post.media.find((m) => (mode === 'video' ? m.type === 'video' : m.type === 'audio'))?.duration
        || post.metadata.duration;

      // Track elapsed time
      const startTime = Date.now();
      const formatElapsed = (ms: number) => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
      };

      const result = await transcriptionService.transcribe(fullPath, {
        model: selectedModel,
        language: this.plugin.settings.transcription?.language || 'auto',
        preferredVariant: this.plugin.settings.transcription?.preferredVariant || 'auto',
        customWhisperPath: this.plugin.settings.transcription?.customWhisperPath,
        forceEnableCustomPath: this.plugin.settings.transcription?.forceEnableCustomPath,
        audioDuration: mediaDuration, // Use duration from YAML frontmatter instead of ffprobe
        onProgress: (progress) => {
          if (signal.aborted) return;
          const elapsed = formatElapsed(Date.now() - startTime);
          messageEl.textContent = `Transcribing... ${progress.percentage.toFixed(0)}% (${elapsed})`;
        },
        signal
      });

      if (signal.aborted) {
        messageEl.textContent = 'Transcription cancelled';
        setTimeout(() => banner.remove(), 2000);
        return;
      }

      messageEl.textContent = 'Saving transcript...';

      // Save transcript to markdown file
      await this.saveTranscriptToPost(post, result, mediaPath, mode);

      messageEl.textContent = '✓ transcript added!';
      messageEl.addClass('pcr-text-success');

      // Refresh the post after a short delay
      setTimeout(() => {
        rootElement.empty();
        void this.render(rootElement, post);
      }, 2000);

    } catch (error) {
      if (signal.aborted) {
        messageEl.textContent = 'Transcription cancelled';
        setTimeout(() => banner.remove(), 2000);
        return;
      }

      const failureMessage = error instanceof Error ? error.message : 'Unknown error';

      // Show error message
      if (error instanceof TranscriptionError) {
        messageEl.textContent = error.userMessage;
        // Suggest smaller model for memory errors
        if (error.code === 'OUT_OF_MEMORY') {
          messageEl.textContent = 'Out of memory. Try a smaller model.';
        }
      } else {
        messageEl.textContent = 'Transcription failed';
        console.error('[TranscriptionBanner] Error:', error);
      }
      messageEl.addClass('pcr-text-error');

      if (mode === 'video') {
        await this.markVideoTranscriptionFailed(post, failureMessage);
      }

      // Hide time estimate and model dropdown during error state
      const timeEstimateEl = banner.querySelector('.transcription-time') as HTMLElement;
      if (timeEstimateEl) {
        timeEstimateEl.hide();
      }
      const selectWrapper = banner.querySelector('select')?.parentElement as HTMLElement;
      if (selectWrapper) {
        selectWrapper.hide();
      }

      // Show retry button
      const buttonSection = banner.querySelector('.transcription-buttons') as HTMLElement;
      if (buttonSection) {
        buttonSection.empty();

        const retryButton = buttonSection.createEl('button', { cls: 'pcr-retry-btn' });
        retryButton.setAttribute('aria-label', 'Retry');
        retryButton.textContent = 'Retry';

        const retryIcon = retryButton.createDiv({ cls: 'pcr-retry-icon' });
        setIcon(retryIcon, 'refresh-cw');
        retryButton.prepend(retryIcon);
        retryButton.addEventListener('click', () => {
          // Reset state and show model dropdown again
          messageEl.textContent = `Transcribe with ${variant || 'Whisper'}?`;
          messageEl.removeClass('pcr-text-error');

          // Show time estimate again
          const timeEl = banner.querySelector('.transcription-time') as HTMLElement;
          if (timeEl) {
            timeEl.show();
          }

          // Show model dropdown if exists
          const selectWrapper = banner.querySelector('select')?.parentElement as HTMLElement;
          if (selectWrapper) {
            selectWrapper.show();
            selectWrapper.setCssStyles({ display: 'flex' });
          }

          // Restore original buttons
          buttonSection.empty();

          // Recreate No button
          const noBtn = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-cancel' });
          noBtn.setAttribute('aria-label', mode === 'video' ? 'Later' : 'No');
          const noIcon = noBtn.createDiv({ cls: 'pcr-icon-btn-icon' });
          setIcon(noIcon, 'x');
          noBtn.addEventListener('click', () => {
            void (async () => {
              if (mode === 'video') {
                await this.markVideoTranscriptionDeferred(post);
              } else {
                await this.markUrlAsTranscribeDeclined(post, mediaPath);
              }
              banner.remove();
            })();
          });

          // Recreate Yes button
          const yesBtn = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-accent' });
          yesBtn.setAttribute('aria-label', 'Transcribe');
          const yesIcon = yesBtn.createDiv({ cls: 'pcr-icon-btn-icon' });
          setIcon(yesIcon, 'mic');

          yesBtn.addEventListener('click', () => { void (async () => {
            const newAbortController = new AbortController();
            buttonSection.empty();

            const cancelBtn = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-cancel-lg' });
            const cancelIcon = cancelBtn.createDiv({ cls: 'pcr-icon-btn-icon-sm' });
            setIcon(cancelIcon, 'x');
            cancelBtn.addEventListener('click', () => newAbortController.abort());

            // Hide dropdown during transcription
            if (selectWrapper) {
              selectWrapper.hide();
            }

            // Get selected model from dropdown
            const modelSelect = banner.querySelector('select') as HTMLSelectElement;
            const selectedModel = (modelSelect?.value || this.plugin.settings.transcription?.preferredModel || 'medium') as WhisperModel;

            await this.executeTranscription(mediaPath, post, rootElement, messageEl, banner, newAbortController.signal, selectedModel, variant, mode);
          })(); });
        });
      }
    }
  }

  /**
   * Save transcript to post markdown file
   */
  private async saveTranscriptToPost(
    post: PostData,
    result: import('../../../types/transcription').TranscriptionResult,
    mediaPath: string,
    mode: 'audio' | 'video' = 'audio'
  ): Promise<void> {
    if (!post.filePath) {
      throw new Error('Post has no file path');
    }

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) {
      throw new Error('Post file not found');
    }

    // Read current content
    let content = await this.vault.read(file);
    const completedAt = new Date().toISOString();

    // Update frontmatter
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      if (mode === 'video') {
        frontmatter.videoTranscribed = true;
        frontmatter.videoTranscribedAt = completedAt;
        delete frontmatter.videoTranscriptionError;
      } else {
        // Add to transcribedUrls (audio/podcast flow)
        const transcribedUrls: string[] = Array.isArray(frontmatter.transcribedUrls) ? (frontmatter.transcribedUrls as string[]) : [];
        const transcribedUrl = `transcribed:${mediaPath}`;
        if (!transcribedUrls.includes(transcribedUrl)) {
          transcribedUrls.push(transcribedUrl);
        }
        frontmatter.transcribedUrls = transcribedUrls;
      }

      // Add transcription metadata (flat structure - Obsidian Properties doesn't support nested objects)
      frontmatter.transcriptionModel = result.model;
      frontmatter.transcriptionLanguage = result.language;
      frontmatter.transcriptionDuration = result.duration;
      frontmatter.transcriptionTime = completedAt;
      frontmatter.transcriptionProcessingTime = result.processingTime;
    });

    // Re-read content after frontmatter update
    content = await this.vault.read(file);

    // Format transcript for markdown using unified TranscriptFormatter
    const hasTranscriptSection = /\n## Transcript\n/i.test(content);
    if (!hasTranscriptSection) {
      const formatter = new TranscriptFormatter();
      const body = formatter.formatWhisperTranscript(result.segments);
      if (body) {
        const normalizedContent = content.replace(/\s+$/, '');
        const newContent = `${normalizedContent}\n\n---\n\n## Transcript\n\n${body}\n`;
        await this.vault.modify(file, newContent);
      }
    }

    // Update local post data cache so re-render picks up transcript
    const postExt = post as unknown as Record<string, unknown>;
    if (mode === 'video') {
      postExt.videoTranscribed = true;
      postExt.videoTranscribedAt = completedAt;
      delete postExt.videoTranscriptionError;
    } else {
      post.transcribedUrls = Array.isArray(post.transcribedUrls)
        ? [...post.transcribedUrls, `transcribed:${mediaPath}`]
        : [`transcribed:${mediaPath}`];
    }

    // Update whisperTranscript so the re-render shows the transcript player
    post.whisperTranscript = {
      segments: result.segments.map((s, i) => ({
        id: s.id ?? i,
        start: s.start,
        end: s.end,
        text: s.text,
      })),
      language: result.language,
    };
  }


  /**
   * Mark audio path as transcription declined
   */
  private async markUrlAsTranscribeDeclined(post: PostData, audioPath: string): Promise<void> {
    if (!post.filePath) return;

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) return;

    const transcribedUrls: string[] = Array.isArray(post.transcribedUrls)
      ? post.transcribedUrls : [];
    const declinedUrl = `declined:${audioPath}`;

    if (!transcribedUrls.includes(declinedUrl)) {
      transcribedUrls.push(declinedUrl);
    }

    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.transcribedUrls = transcribedUrls;
    });

    // Update local post data
    post.transcribedUrls = transcribedUrls;
  }

  private async markVideoTranscriptionDeferred(post: PostData): Promise<void> {
    if (!post.filePath) return;

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.videoTranscribed = false;
      delete frontmatter.videoTranscriptionError;
    });

    const p1 = post as unknown as Record<string, unknown>;
    p1.videoTranscribed = false;
    delete p1.videoTranscriptionError;
  }

  private async markVideoTranscriptionRequested(post: PostData): Promise<void> {
    if (!post.filePath) return;

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) return;

    const requestedAt = new Date().toISOString();
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.videoTranscribed = false;
      frontmatter.videoTranscriptionRequestedAt = requestedAt;
      delete frontmatter.videoTranscriptionError;
    });

    post.videoTranscribed = false;
    post.videoTranscriptionRequestedAt = requestedAt;
    delete post.videoTranscriptionError;
  }

  private async markVideoTranscriptionFailed(post: PostData, errorMessage: string): Promise<void> {
    if (!post.filePath) return;

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) return;

    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.videoTranscribed = false;
      frontmatter.videoTranscriptionError = errorMessage;
    });

    const p2 = post as unknown as Record<string, unknown>;
    p2.videoTranscribed = false;
    p2.videoTranscriptionError = errorMessage;
  }

  /**
   * Download podcast audio file
   */
  private async downloadPodcastAudio(
    audioUrl: string,
    post: PostData,
    rootElement: HTMLElement,
    messageEl: HTMLElement,
    banner: HTMLElement,
    signal: AbortSignal
  ): Promise<void> {
    // Import MediaHandler dynamically
    const { MediaHandler } = await import('../../../services/MediaHandler');

    // Get settings from plugin
    const settings = this.plugin?.settings;
    const mediaPath = settings?.mediaPath || 'attachments/social-archives';

    // Create MediaHandler instance
    const mediaHandler = new MediaHandler({
      vault: this.vault,
      app: this.app,
      basePath: mediaPath,
      optimizeImages: false, // No optimization for audio
    });

    // Create a pseudo media object for the audio file
    const audioMedia = {
      type: 'audio' as const,
      url: audioUrl,
    };

    // Extract author username from post for file naming
    const authorUsername = post.author?.handle || post.author?.username || post.author?.name || 'podcast';

    // Use MediaHandler to download the audio file
    const result = await mediaHandler.downloadMedia(
      [audioMedia],
      post.platform,
      post.id || post.url || 'episode',
      authorUsername
    );

    // Check for cancellation
    if (signal.aborted) {
      throw new Error('Download cancelled');
    }

    if (result.length === 0 || !result[0]?.localPath) {
      throw new Error('Failed to download audio');
    }

    messageEl.textContent = 'Updating post...';

    // Update frontmatter with downloaded audio path
    if (post.filePath) {
      const file = this.vault.getFileByPath(post.filePath);
      if (file) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
          // Update audioUrl to local path (same pattern as video)
          frontmatter.audioUrl = result[0]?.localPath;

          // Mark as downloaded with original URL (for tracking)
          const downloadedUrls: string[] = Array.isArray(frontmatter.downloadedUrls) ? (frontmatter.downloadedUrls as string[]) : [];
          const downloadedUrl = `downloaded:${audioUrl}`;
          if (!downloadedUrls.includes(downloadedUrl)) {
            downloadedUrls.push(downloadedUrl);
          }
          frontmatter.downloadedUrls = downloadedUrls;
        });
      }
    }

    messageEl.textContent = 'Audio downloaded successfully!';
    messageEl.addClass('sa-text-success');

    // Refresh the card
    setTimeout(() => {
      rootElement.empty();
      void this.render(rootElement, post);
    }, 500);
  }

  /**
   * Render a single suggestion banner
   */
  private renderSuggestionBanner(
    contentArea: HTMLElement,
    url: string,
    platform: string,
    post: PostData,
    rootElement: HTMLElement,
    isPinterestBoard: boolean = false,
    urlVariants?: string[]
  ): void {
    const banner = contentArea.createDiv({ cls: 'archive-suggestion-banner pcr-suggestion-banner' });

    // Message
    const message = banner.createSpan({ cls: 'pcr-banner-message', text: 'Archive this post?' });

    // Buttons
    const buttonSection = banner.createDiv({ cls: 'pcr-banner-buttons' });

    // No button (X icon)
    const noButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-cancel' });
    noButton.setAttribute('aria-label', 'Decline archiving');
    noButton.setAttribute('title', 'No');

    const noIcon = noButton.createDiv({ cls: 'pcr-icon-btn-icon' });
    setIcon(noIcon, 'x');
    noButton.addEventListener('click', () => {
      banner.remove();
      // Mark URL as declined (prefix with "declined:")
      // File change will trigger timeline refresh and show "Archive declined" banner
      void this.markUrlAsDeclined(post, urlVariants ?? [url]);
    });

    // Yes button (Check icon)
    const yesButton = buttonSection.createEl('button', { cls: 'pcr-icon-btn pcr-icon-btn-accent' });
    yesButton.setAttribute('aria-label', 'Archive this post');
    yesButton.setAttribute('title', 'Yes');

    const yesIcon = yesButton.createDiv({ cls: 'pcr-icon-btn-icon' });
    setIcon(yesIcon, 'check');
    yesButton.addEventListener('click', () => { void (async () => {
      // Check authentication first
      const hasAuthToken = this.plugin.settings.authToken && this.plugin.settings.authToken.trim() !== '';
      const isVerified = this.plugin.settings.isVerified === true;

      if (!hasAuthToken || !isVerified) {
        // Show authentication required banner
        banner.empty();
        banner.addClasses(['pcr-suggestion-banner-filled']);

        banner.createSpan({ cls: 'pcr-banner-message', text: 'Sign in required to archive posts' });

        const settingsButton = banner.createEl('button', { cls: 'pcr-settings-btn', text: 'Open settings' });
        settingsButton.addEventListener('click', () => {
          // @ts-expect-error — app.setting is available at runtime but not in public Obsidian types
          const appSetting = this.app.setting as { open?: () => void; openTabById?: (id: string) => void } | undefined;
          if (appSetting?.open) {
            appSetting.open();
            appSetting.openTabById?.(this.plugin.manifest.id);
          }
        });

        return;
      }

      // Hide buttons while archiving
      buttonSection.hide();

      // Archive in background (async)
      try {
        await this.archiveUrl(url, platform, post, rootElement, message, isPinterestBoard, urlVariants);
        // archiveUrl() handles message display and banner removal
      } catch (error) {
        // Show error message in banner
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        message.textContent = `Error: ${errorMessage}`;
        message.addClass('pcr-text-error');

        // Show buttons again on error
        buttonSection.show();

        // Remove banner after showing error
        setTimeout(() => {
          banner.remove();
        }, 5000);
      }
    })(); });
  }

  /**
   * Download video with yt-dlp
   */
  private async downloadWithYtDlp(
    url: string,
    platform: string,
    post: PostData,
    rootElement: HTMLElement,
    message: HTMLElement,
    signal?: AbortSignal
  ): Promise<void> {
    const { YtDlpDetector } = await import('@/utils/yt-dlp');

    // Get vault base path (absolute path on file system)
    // @ts-expect-error — adapter.basePath is available but not in public Obsidian types
    const vaultBasePath = this.vault.adapter.basePath as string;

    // Use plugin's mediaPath setting (e.g., attachments/social-archives)
    const basePath = this.plugin.settings.mediaPath || 'attachments/social-archives';

    // Add platform subfolder (e.g., attachments/social-archives/tiktok)
    const platformFolder = `${basePath}/${platform}`;
    const outputPath = `${vaultBasePath}/${platformFolder}`;

    // Generate filename with platform prefix (e.g., tiktok_authorname_timestamp)
    const authorName = post.author.name.replace(/[^a-z0-9_-]/gi, '_');
    const filename = `${platform}_${authorName}_${Date.now()}`;

    message.textContent = 'Preparing download...';

    try {
      // Ensure platform folder exists (e.g., attachments/social-archives/tiktok)
      const folderExists = await this.vault.adapter.exists(platformFolder);
      if (!folderExists) {
        await this.vault.createFolder(platformFolder);
      }

      // Download video with progress tracking
      const videoPath = await YtDlpDetector.downloadVideo(
        url,
        outputPath,
        filename,
        (_progress, status) => {
          // status already contains formatted string like "Downloading: 15.2% at 1.2MiB/s (ETA 00:07)"
          message.textContent = status;
        },
        signal
      );


      // Check if downloaded file is browser-compatible
      // Only warn if it's not an MP4 (e.g., .ts, .webm, etc.)
      if (!videoPath.toLowerCase().endsWith('.mp4')) {
        const hasFFmpeg = await YtDlpDetector.isFfmpegAvailable();
        if (!hasFFmpeg) {
          new Notice('⚠️ this video may not play in the browser.\nInstall ffmpeg for browser-compatible video playback.\n\nVisit: ffmpeg.org', 10000);
        }
      }

      // Add video link to the note
      if (post.filePath) {
        const file = this.vault.getFileByPath(post.filePath);
        if (file) {
          const content = await this.vault.read(file);
          // Extract filename from path (handle both Windows \ and Unix / separators)
          const videoFilename = videoPath.split(/[/\\]/).pop() || '';
          // Include platform folder in the link path (e.g., attachments/tiktok/video.mp4)
          const videoLink = `![[${platformFolder}/${videoFilename}]]`;

          // Mark as downloaded in frontmatter BEFORE vault.modify() to prevent banner from re-appearing
          let updatedContent = this.addDownloadedUrlToContent(content, url);

          // Replace existing video thumbnail with actual video embed
          // Pattern matches: ![🎥 Video (duration)](path/to/thumbnail.jpg) or ![🎥 Video](path)
          const videoThumbnailRegex = /!\[🎥 Video[^\]]*\]\([^)]+\)/;

          if (videoThumbnailRegex.test(updatedContent)) {
            // Replace the first video thumbnail with video embed
            updatedContent = updatedContent.replace(videoThumbnailRegex, videoLink);
          } else if (!updatedContent.includes(videoLink)) {
            // No thumbnail found, add video link at the end
            updatedContent = updatedContent + `\n\n${videoLink}`;
          }

          // Register UI modify to prevent double refresh
          if (this.onUIModifyCallback) {
            this.onUIModifyCallback(post.filePath);
          }

          // Modify file with both video link and updated frontmatter
          await this.vault.modify(file, updatedContent);

          // Update UI: Replace TikTok/YouTube iframe with local video player.
          // If inline replacement misses, force re-render this card because
          // onUIModify suppresses vault-driven refresh for this file.
          let replacedInline = false;
          const videoVaultPath = `${platformFolder}/${videoFilename}`;
          const indexedVideoFile = this.vault.getFileByPath(videoVaultPath) || await this.findDownloadedVideoByUrl(post, url);
          const resolvedVideoPath = indexedVideoFile?.path || await this.resolveExistingLocalVideoPath(videoVaultPath);
          const localVideoPath = indexedVideoFile?.path || resolvedVideoPath || '';

          // Keep in-memory post state in sync so immediate re-render can show
          // local video + transcription banner without waiting for plugin reload.
          const downloadedMarkers: string[] = Array.isArray(post.downloadedUrls)
            ? [...post.downloadedUrls]
            : [];
          const downloadedMarker = `downloaded:${url}`;
          if (!downloadedMarkers.includes(downloadedMarker)) {
            downloadedMarkers.push(downloadedMarker);
          }
          post.downloadedUrls = downloadedMarkers;

          if (localVideoPath) {
            const nextMedia = Array.isArray(post.media) ? [...post.media] : [];
            const localVideoIndex = nextMedia.findIndex((mediaItem) =>
              mediaItem.type === 'video' && mediaItem.url && !mediaItem.url.startsWith('http')
            );
            if (localVideoIndex >= 0 && nextMedia[localVideoIndex]) {
              nextMedia[localVideoIndex] = { ...nextMedia[localVideoIndex], type: 'video', url: localVideoPath };
            } else {
              nextMedia.unshift({ type: 'video', url: localVideoPath });
            }
            post.media = nextMedia;
          }

          if (indexedVideoFile || resolvedVideoPath) {
            const tiktokIframe = rootElement.querySelector('iframe[src*="tiktok.com/embed"]');
            const youtubeIframe = rootElement.querySelector('iframe[src*="youtube-nocookie.com"]') ||
                                  rootElement.querySelector('iframe[src*="youtube.com"]');
            const targetIframe = tiktokIframe || youtubeIframe;

            if (targetIframe) {
              const embedContainer = targetIframe.parentElement as HTMLElement;
              if (embedContainer) {
                // YouTube has outerWrapper > embedContainer > iframe structure
                // TikTok has embedContainer > iframe structure
                const isYouTube = !!youtubeIframe;
                const targetContainer = isYouTube && embedContainer.parentElement
                  ? embedContainer.parentElement
                  : embedContainer;

                targetContainer.setCssStyles({ height: 'auto', maxWidth: '100%', paddingBottom: '0' });
                targetContainer.empty();
                this.renderLocalVideo(targetContainer, indexedVideoFile ?? resolvedVideoPath ?? '', post);
                replacedInline = true;
              }
            }
          }

          if (!replacedInline && post.filePath) {
            try {
              const refreshedFile = this.vault.getFileByPath(post.filePath);
              if (refreshedFile) {
                const { PostDataParser: Parser } = await import('../parsers/PostDataParser');
                const parser = new Parser(this.vault, this.app);
                const refreshedPost = await parser.parseFile(refreshedFile);
                if (refreshedPost) {
                  rootElement.empty();
                  await this.render(rootElement, refreshedPost);
                }
              }
            } catch {
              // Non-critical UI fallback.
            }
          }

          // Ensure follow-up banners (e.g., Whisper transcription prompt) are recalculated.
          if (rootElement.isConnected) {
            setTimeout(() => {
              void (async () => {
                if (!rootElement.isConnected) return;
                rootElement.empty();
                await this.render(rootElement, post);
              })();
            }, 150);
          }

          message.textContent = 'Download complete!';
          message.addClass('pcr-text-success');

          new Notice('Video downloaded successfully!');
        }
      }
    } catch (error) {

      // Remove from downloadedUrls since download failed
      await this.removeDownloadedUrl(post, url);

      message.textContent = 'Download failed. Please try again.';
      message.addClass('pcr-text-error');
      new Notice('Video download failed. Check console for details.');
      throw error;
    }
  }

  /**
   * Mark URL as processed (add to processedUrls in YAML)
   * @unused - Reserved for future use
   */
  private async _markUrlAsProcessed(post: PostData, url: string): Promise<void> {
    if (!post.filePath) return;

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) return;

    const postRecord = post as unknown as Record<string, unknown>;
    const processedUrls: string[] = Array.isArray(postRecord.processedUrls) ? (postRecord.processedUrls as string[]) : [];
    if (!processedUrls.includes(url)) {
      processedUrls.push(url);
    }

    // Update frontmatter
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.processedUrls = processedUrls;
    });

    // Update local post data
    postRecord.processedUrls = processedUrls;
  }

  /**
   * Add downloaded URL to frontmatter in file content (returns updated content)
   * Used when we need to update frontmatter before vault.modify()
   */
  private addDownloadedUrlToContent(content: string, url: string): string {
    const downloadedUrl = `downloaded:${url}`;

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch || !frontmatterMatch[1]) return content;

    const frontmatter = frontmatterMatch[1];

    // Check if downloadedUrls exists (both inline array and empty field)
    const inlineArrayMatch = frontmatter.match(/downloadedUrls:\s*\[(.*?)\]/);
    const emptyFieldMatch = frontmatter.match(/^downloadedUrls:\s*$/m);

    let updatedFrontmatter: string;
    if (inlineArrayMatch && inlineArrayMatch[1] !== undefined) {
      // Add to existing inline array
      const existingUrls = inlineArrayMatch[1];
      if (!existingUrls.includes(downloadedUrl)) {
        const newUrls = existingUrls ? `${existingUrls}, "${downloadedUrl}"` : `"${downloadedUrl}"`;
        updatedFrontmatter = frontmatter.replace(
          /downloadedUrls:\s*\[.*?\]/,
          `downloadedUrls: [${newUrls}]`
        );
      } else {
        updatedFrontmatter = frontmatter;
      }
    } else if (emptyFieldMatch) {
      // Replace empty field with inline array
      updatedFrontmatter = frontmatter.replace(
        /^downloadedUrls:\s*$/m,
        `downloadedUrls: ["${downloadedUrl}"]`
      );
    } else {
      // Add new downloadedUrls field
      updatedFrontmatter = frontmatter + `\ndownloadedUrls: ["${downloadedUrl}"]`;
    }

    // Replace frontmatter in content
    return content.replace(/^---\n[\s\S]*?\n---/, `---\n${updatedFrontmatter}\n---`);
  }

  /**
   * Mark URL as downloaded (add with "downloaded:" prefix to downloadedUrls)
   * @unused - Reserved for future use
   */
  private async _markUrlAsDownloaded(post: PostData, url: string): Promise<void> {
    if (!post.filePath) return;

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) return;

    const postRec1 = post as unknown as Record<string, unknown>;
    const downloadedUrls: string[] = Array.isArray(postRec1.downloadedUrls) ? (postRec1.downloadedUrls as string[]) : [];
    const downloadedUrl = `downloaded:${url}`;
    if (!downloadedUrls.includes(downloadedUrl)) {
      downloadedUrls.push(downloadedUrl);
    }

    // Update frontmatter
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.downloadedUrls = downloadedUrls;
    });

    // Update local post data
    postRec1.downloadedUrls = downloadedUrls;
  }

  /**
   * Mark URL as download declined (add with "declined:" prefix to downloadedUrls)
   */
  private async markUrlAsDownloadDeclined(post: PostData, url: string): Promise<void> {
    if (!post.filePath) return;

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) return;

    const postRec2 = post as unknown as Record<string, unknown>;
    const downloadedUrls: string[] = Array.isArray(postRec2.downloadedUrls) ? (postRec2.downloadedUrls as string[]) : [];
    const declinedDownloadUrl = `declined:${url}`;

    // Add declined download URL if not already present
    if (!downloadedUrls.includes(declinedDownloadUrl)) {
      downloadedUrls.push(declinedDownloadUrl);
    }

    // Update frontmatter
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.downloadedUrls = downloadedUrls;
    });

    // Update local post data
    postRec2.downloadedUrls = downloadedUrls;
  }

  /**
   * Remove URL from downloadedUrls (used when download fails)
   */
  private async removeDownloadedUrl(post: PostData, url: string): Promise<void> {
    if (!post.filePath) return;

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) return;

    const postRec3 = post as unknown as Record<string, unknown>;
    const downloadedUrls: string[] = Array.isArray(postRec3.downloadedUrls) ? (postRec3.downloadedUrls as string[]) : [];
    const downloadedUrl = `downloaded:${url}`;

    // Remove the downloaded URL
    const index = downloadedUrls.indexOf(downloadedUrl);
    if (index > -1) {
      downloadedUrls.splice(index, 1);
    }

    // Update frontmatter
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.downloadedUrls = downloadedUrls;
    });

    // Update local post data
    postRec3.downloadedUrls = downloadedUrls;
  }

  /**
   * Mark URL as declined (add with "declined:" prefix)
   */
  private async markUrlAsDeclined(post: PostData, urls: string | string[]): Promise<void> {
    if (!post.filePath) return;

    const file = this.vault.getFileByPath(post.filePath);
    if (!file) return;

    const urlList = Array.isArray(urls) ? urls : [urls];
    const postRec4 = post as unknown as Record<string, unknown>;
    const processedUrls: string[] = Array.isArray(postRec4.processedUrls) ? (postRec4.processedUrls as string[]) : [];

    urlList.forEach(url => {
      const declinedUrl = `declined:${url}`;

      // Remove plain URL if exists
      const plainIndex = processedUrls.indexOf(url);
      if (plainIndex > -1) {
        processedUrls.splice(plainIndex, 1);
      }

      // Add declined URL if not already present
      if (!processedUrls.includes(declinedUrl)) {
        processedUrls.push(declinedUrl);
      }
    });

    // Update frontmatter
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.processedUrls = processedUrls;
    });

    // Update local post data
    postRec4.processedUrls = processedUrls;
  }

  /**
   * Archive URL and embed in post
   */
  private async archiveUrl(
    url: string,
    _platform: string,
    post: PostData,
    rootElement: HTMLElement,
    message?: HTMLElement,
    isPinterestBoard: boolean = false,
    urlVariants?: string[]
  ): Promise<void> {
    if (!this.plugin.archiveOrchestrator) {
      new Notice('Archive orchestrator not initialized');
      return;
    }

    if (!post.filePath) {
      new Notice('Post file path not found');
      return;
    }

    const originalUrl = urlVariants?.[0] ?? url;
    let targetUrl = url;
    let resolvedPinterestBoard = isPinterestBoard;

    if (_platform === 'pinterest') {
      try {
        const resolution = await resolvePinterestUrl(url);
        if (resolution.resolvedUrl) {
          targetUrl = resolution.resolvedUrl;
        }
        resolvedPinterestBoard = resolution.isBoard || resolvedPinterestBoard;
      } catch {
        // Keep original URL on failure
      }
    }

    // ========== NEW: Create Pending Job (NON-BLOCKING) ==========
    if (message) {
      message.textContent = 'Archiving in background...';
    }

    const jobId = `embed-${Date.now()}`;
    const pendingJob = {
      id: jobId,
      url: targetUrl,
      platform: _platform as Platform,
      status: 'pending' as const,
      timestamp: Date.now(),
      retryCount: 0,
      metadata: {
        embeddedArchive: true,
        parentFilePath: post.filePath,
        isPinterestBoard: resolvedPinterestBoard ? true : undefined,
        originalUrl: originalUrl !== targetUrl ? originalUrl : undefined,
      }
    };

    await this.plugin.pendingJobsManager.addJob(pendingJob);

    // Mark URL as "archiving" to show progress banner after refresh
    const parentFile = this.vault.getFileByPath(post.filePath);
    if (parentFile) {
      try {
        const content = await this.vault.read(parentFile);
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

        if (frontmatterMatch && frontmatterMatch[1]) {
          // Parse existing processedUrls
          const processedUrlsMatch = frontmatterMatch[1].match(/processedUrls:\s*\[(.*?)\]/);
          let processedUrls: string[] = [];

          if (processedUrlsMatch && processedUrlsMatch[1]) {
            processedUrls = processedUrlsMatch[1]
              .split(',')
              .map(u => u.trim().replace(/^["']|["']$/g, ''))
              .filter(u => u);
          }

          const variants = Array.from(new Set([...(urlVariants ?? []), targetUrl, originalUrl].filter(Boolean)));

          // Add "archiving:" prefix to show progress banner
          let updated = false;
          variants.forEach(u => {
            const archivingUrl = `archiving:${u}`;
            if (!processedUrls.some(v => v === u || v === archivingUrl || v === `declined:${u}`)) {
              processedUrls.push(archivingUrl);
              updated = true;
            }
          });

          if (updated) {
            // Update frontmatter
            const newProcessedUrlsLine = `processedUrls: [${processedUrls.map(u => `"${u}"`).join(', ')}]`;

            let newContent: string;
            if (processedUrlsMatch) {
              // Replace existing processedUrls line
              newContent = content.replace(
                /processedUrls:\s*\[.*?\]/,
                newProcessedUrlsLine
              );
            } else {
              // Add processedUrls to frontmatter
              newContent = content.replace(
                /^(---\n[\s\S]*?)(---)/,
                `$1${newProcessedUrlsLine}\n$2`
              );
            }

            // Register UI modify to prevent double refresh
            if (this.onUIModifyCallback && post.filePath) {
              this.onUIModifyCallback(post.filePath);
            }

            await this.vault.modify(parentFile, newContent);
          }
        }
      } catch (error) {
        console.error('[PostCardRenderer] Failed to update processedUrls:', error);
        // Continue anyway - processCompletedJob will update it later
      }
    }

    // Update banner message (will stay until archiving completes)
    if (message) {
      message.textContent = 'Archiving in background... You can continue browsing.';
      // Banner will be removed automatically when timeline refreshes after completion
    }

    // Trigger immediate background check
    this.plugin.checkPendingJobs?.().catch(() => {
      // Silently fail - periodic checker will retry
    });

    // Processing continues in processCompletedJob()
  }

  /**
   * Find downloaded video file for a post
   * Looks for video file links in the post content (e.g., ![[video.mp4]])
   */
  private async findDownloadedVideo(post: PostData): Promise<TFile | null> {
    if (!post.filePath) return null;

    try {
      const file = this.vault.getFileByPath(post.filePath);
      if (!file) return null;

      const content = await this.vault.read(file);

      const candidates = this.extractLocalVideoEmbedPaths(content);
      for (const candidate of candidates) {
        const resolvedPath = await this.resolveExistingLocalVideoPath(candidate);
        if (!resolvedPath) continue;
        const videoFile = this.vault.getAbstractFileByPath(resolvedPath);
        if (videoFile instanceof TFile) {
          return videoFile;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async findDownloadedVideoPath(post: PostData): Promise<string | null> {
    if (!post.filePath) return null;

    try {
      const file = this.vault.getFileByPath(post.filePath);
      if (!file) return null;

      const content = await this.vault.read(file);
      const candidates = this.extractLocalVideoEmbedPaths(content);
      for (const candidate of candidates) {
        const resolvedPath = await this.resolveExistingLocalVideoPath(candidate);
        if (resolvedPath) return resolvedPath;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Render local video file (simple version, for embedded archives)
   */
  private renderLocalVideo(container: HTMLElement, videoSource: TFile | string, post?: PostData): void {
    const videoContainer = container.createDiv({ cls: 'local-video-container pcr-video-container' });

    const video = videoContainer.createEl('video', {
      cls: 'pcr-video-element',
      attr: {
        controls: 'true',
        preload: 'metadata',
        playsinline: 'true',
        'webkit-playsinline': 'true'
      }
    });

    const videoPath = typeof videoSource === 'string' ? videoSource : videoSource.path;
    // Use adapter path-based resource lookup to avoid requiring TFile indexing.
    const resourcePath = this.app.vault.adapter.getResourcePath(videoPath);
    video.src = resourcePath;

    // Prevent duplicate iframe rendering when both error + timeout fire.
    let loadTimeout: ReturnType<typeof setTimeout> | null = null;
    let hasLoaded = false;
    let fallbackTriggered = false;

    const clearLoadTimeout = () => {
      if (loadTimeout !== null) {
        clearTimeout(loadTimeout);
        loadTimeout = null;
      }
    };

    // Fallback function to render YouTube iframe
    const fallbackToYouTubeIframe = () => {
      if (fallbackTriggered) return;
      fallbackTriggered = true;
      clearLoadTimeout();

      // Remove failed video element
      videoContainer.remove();

      // Fallback to YouTube iframe if post info is available
      if (post && post.platform === 'youtube') {
        let videoId = post.videoId;
        if (!videoId && post.url) {
          videoId = this.extractYouTubeVideoId(post.url) || undefined;
        }

        if (videoId) {
          const iframe = this.youtubeEmbedRenderer.renderYouTube(container, videoId, false);
          const controller = new YouTubePlayerController(iframe);
          this.youtubeControllers.set(post.id, controller);
        }
      }
    };

    // Add error handler to fallback to YouTube iframe if video fails to load
    video.addEventListener('error', () => {
      fallbackToYouTubeIframe();
    });

    // loadedmetadata fires earlier and is enough to confirm the file is readable.
    video.addEventListener('loadedmetadata', () => {
      hasLoaded = true;
      clearLoadTimeout();
    });

    // Add timeout fallback (5 seconds) in case video doesn't load or error doesn't fire.
    // This is especially important for mobile where files might not be synced.
    loadTimeout = setTimeout(() => {
      if (!hasLoaded && !fallbackTriggered && post && post.platform === 'youtube') {
        fallbackToYouTubeIframe();
      }
    }, 5000);
  }

  /**
   * Render local video and return the HTMLVideoElement reference for transcript sync.
   * Delegates to renderLocalVideo for actual rendering, then extracts the video element.
   */
  private renderLocalVideoWithRef(container: HTMLElement, videoSource: TFile | string, post?: PostData): HTMLVideoElement | undefined {
    // Use existing renderLocalVideo
    this.renderLocalVideo(container, videoSource, post);
    // Extract the video element that was just created
    return container.querySelector('.local-video-container video') as HTMLVideoElement | undefined;
  }

  /**
   * Find downloaded video file by URL
   */
  private async findDownloadedVideoByUrl(post: PostData, url: string): Promise<TFile | null> {
    try {
      // Check if filePath exists
      if (!post.filePath) {
        return null;
      }

      // Get the note file
      const file = this.app.vault.getAbstractFileByPath(post.filePath);
      if (!file || !(file instanceof TFile)) {
        return null;
      }

      // Read note content
      const content = await this.vault.read(file);

      // Extract local video embeds from note content
      const embedPaths = this.extractLocalVideoEmbedPaths(content);
      if (embedPaths.length === 0) {
        return null;
      }

      // Get platform from URL
      const platform = this.detectPlatformFromUrl(url).toLowerCase();

      const resolvedPaths: string[] = [];
      for (const embedPath of embedPaths) {
        const resolvedPath = await this.resolveExistingLocalVideoPath(embedPath);
        if (resolvedPath) {
          resolvedPaths.push(resolvedPath);
        }
      }

      const uniqueResolvedPaths = Array.from(new Set(resolvedPaths));
      const resolvedFiles: TFile[] = uniqueResolvedPaths
        .map((path) => this.app.vault.getAbstractFileByPath(path))
        .filter((file): file is TFile => file instanceof TFile);

      if (resolvedFiles.length === 0) {
        return null;
      }

      // First, prefer files inside matching platform folder.
      const platformMatched = resolvedFiles.find((videoFile) => {
        const lowerPath = videoFile.path.toLowerCase();
        return lowerPath.includes(`/${platform}/`) || lowerPath.includes(`${platform}/`);
      });
      if (platformMatched) {
        return platformMatched;
      }

      // Fallback: if single candidate exists, use it.
      if (resolvedFiles.length === 1) {
        return resolvedFiles[0] || null;
      }

      // Final fallback: return first resolved local video.
      return resolvedFiles[0] || null;
    } catch {
      return null;
    }
  }

  private async resolveExistingLocalVideoPath(path: string): Promise<string | null> {
    const normalizedPath = this.normalizeLocalEmbedPath(path);
    if (!normalizedPath) return null;

    const candidates = normalizedPath.startsWith('attachments/')
      ? [normalizedPath]
      : [normalizedPath, `attachments/${normalizedPath}`];

    for (const candidate of candidates) {
      // Fast path: if indexed as TFile, use indexed path
      const indexed = this.vault.getAbstractFileByPath(candidate);
      if (indexed instanceof TFile) {
        try {
          const stat = await this.vault.adapter.stat(indexed.path);
          if (stat && stat.size > 0) {
            return indexed.path;
          }
        } catch {
          // Continue to adapter fallback.
        }
      }

      // Fallback: adapter stat can see files before vault index catches up.
      try {
        const stat = await this.vault.adapter.stat(candidate);
        if (stat && stat.size > 0) {
          return candidate;
        }
      } catch {
        // Ignore candidate miss.
      }
    }

    return null;
  }

  private extractLocalVideoEmbedPaths(content: string): string[] {
    const paths: string[] = [];

    // Obsidian wiki embeds: ![[path/to/video.mp4]] or ![[path/to/video.mp4|alias]]
    const wikiEmbedRegex = /!\[\[([^\]]+\.(mp4|webm|mov|avi|mkv|m4v)(?:\|[^\]]*)?)\]\]/gi;
    let wikiMatch;
    while ((wikiMatch = wikiEmbedRegex.exec(content)) !== null) {
      const rawPath = wikiMatch[1];
      if (!rawPath) continue;
      const cleanPath = rawPath.split('|')[0]?.trim() || '';
      if (cleanPath) paths.push(cleanPath);
    }

    // Markdown links/images: [title](path/to/video.mp4) or ![title](path/to/video.mp4)
    const markdownEmbedRegex = /!?\[[^\]]*?\]\(([^)\s]+?\.(mp4|webm|mov|avi|mkv|m4v))(?:\s+["'][^"']*["'])?\)/gi;
    let markdownMatch;
    while ((markdownMatch = markdownEmbedRegex.exec(content)) !== null) {
      const rawPath = markdownMatch[1];
      if (!rawPath) continue;
      const cleanPath = rawPath.replace(/^<|>$/g, '').trim();
      if (cleanPath) paths.push(cleanPath);
    }

    return Array.from(new Set(paths));
  }

  private normalizeLocalEmbedPath(path: string): string {
    let normalized = String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^<|>$/g, '')
      .replace(/^["']|["']$/g, '');

    if (!normalized) return '';

    normalized = normalized.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');

    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded) {
        normalized = decoded;
      }
    } catch {
      // Keep original when decode fails.
    }

    return normalized;
  }

  /**
   * Detect platform from URL
   */
  private detectPlatformFromUrl(url: string): string {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('tiktok.com')) return 'tiktok';
    if (url.includes('vimeo.com')) return 'vimeo';
    if (url.includes('dailymotion.com')) return 'dailymotion';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'x';
    if (url.includes('instagram.com')) return 'instagram';
    return 'video';
  }

  /**
   * Render archiving placeholder for posts being archived
   */
  private renderArchivingPlaceholder(container: HTMLElement, post: PostData): HTMLElement {
    const wrapper = container.createDiv({ cls: 'mb-2' });

    const card = wrapper.createDiv({
      cls: 'relative rounded-lg bg-[var(--background-primary)] pcr-archiving-card'
    });

    // Delete button (shown on hover) - top-right corner
    const deleteBtn = card.createDiv({ cls: 'pcr-archiving-delete-btn' });
    deleteBtn.setAttribute('title', 'Cancel and delete this placeholder');
    deleteBtn.setAttribute('aria-label', 'Delete placeholder');

    const deleteIcon = deleteBtn.createDiv({ cls: 'pcr-archiving-delete-icon' });
    setIcon(deleteIcon, 'x');

    // Delete handler
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.deletePost(post, wrapper);
    });

    // Platform badge
    const platformBadge = card.createDiv({ cls: 'pcr-platform-badge' });

    const platformIcon = getPlatformSimpleIcon(post.platform, post.author.url);
    if (platformIcon) {
      const iconSpan = platformBadge.createSpan({ cls: 'pcr-platform-badge-icon' });
      const svg = createSVGElement(platformIcon, {
        fill: 'var(--text-accent)',
        width: '14px',
        height: '14px'
      });
      iconSpan.appendChild(svg);
    }
    platformBadge.createSpan({ text: getPlatformName(post.platform) });

    // Loading animation
    const loadingContainer = card.createDiv({ cls: 'pcr-archiving-loading' });

    loadingContainer.createDiv({ cls: 'pcr-spinner' });

    loadingContainer.createDiv({ cls: 'pcr-archiving-text', text: 'Archiving content from original source...' });

    // Original URL
    if (post.originalUrl || post.url) {
      const urlContainer = card.createDiv({ cls: 'pcr-archiving-url' });
      urlContainer.setText(post.originalUrl || post.url);
    }

    // Info message
    card.createDiv({ cls: 'pcr-archiving-info', text: 'This document will update automatically when archiving completes.' });

    return wrapper;
  }

  /**
   * Render failed placeholder for posts that failed to archive
   */
  private renderFailedPlaceholder(container: HTMLElement, post: PostData): HTMLElement {
    const wrapper = container.createDiv({ cls: 'mb-2' });

    const card = wrapper.createDiv({
      cls: 'relative rounded-lg bg-[var(--background-primary)] pcr-failed-card'
    });

    // Delete button in top-right corner
    const deleteBtn = card.createDiv({ cls: 'pcr-failed-delete-btn' });
    deleteBtn.setAttribute('title', 'Delete this post');
    deleteBtn.setAttribute('aria-label', 'Delete post');

    const deleteIcon = deleteBtn.createDiv({ cls: 'pcr-archiving-delete-icon' });
    setIcon(deleteIcon, 'x');

    // Delete handler
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.deletePost(post, wrapper);
    });

    // Error header
    const errorHeader = card.createDiv({ cls: 'pcr-error-header' });
    errorHeader.createSpan({ text: '⚠️' });
    errorHeader.createSpan({ text: 'Archive Failed' });

    // Error message - softer background
    const errorMsg = card.createDiv({ cls: 'pcr-error-message' });
    const errorMsgFromFrontmatter = post.errorMessage || 'Unknown error occurred';
    errorMsg.setText(errorMsgFromFrontmatter);

    // Original URL link
    if (post.originalUrl || post.url) {
      const urlLink = card.createEl('a', {
        cls: 'pcr-error-url',
        text: '→ view original source',
        href: post.originalUrl || post.url
      });
      urlLink.setAttribute('target', '_blank');
      urlLink.setAttribute('rel', 'noopener noreferrer');
    }

    // Retry suggestion
    const retryMsg = card.createDiv({ cls: 'pcr-error-retry-msg' });
    retryMsg.createEl('strong', { text: 'You can:' });
    const ul = retryMsg.createEl('ul', { cls: 'pcr-error-list' });
    ul.createEl('li', { text: 'Try archiving again using the archive modal' });
    ul.createEl('li', { text: 'Check your internet connection' });
    ul.createEl('li', { text: 'Verify the URL is still accessible' });

    // Render archive suggestion banner at the bottom
    const url = post.originalUrl || post.url;
    if (url && post.platform) {
      this.renderSuggestionBanner(card, url, post.platform, post, wrapper);
    }

    return wrapper;
  }

  /**
   * Prepare PostData for sharing by cloning values, normalizing timestamps, and optionally stripping media
   */
  private serializePostForShare(post: PostData, options: { stripMedia?: boolean } = {}): PostData {
    const stripMedia = options.stripMedia ?? false;

    const clonedPost: PostData = {
      ...post,
      author: { ...post.author },
      content: { ...post.content },
      media: stripMedia ? [] : (post.media?.map(media => ({ ...media })) ?? []),
      metadata: this.serializePostMetadata(post.metadata),
      comments: this.cloneComments(post.comments),
      embeddedArchives: post.embeddedArchives?.map(archive => this.serializePostForShare(archive)),
      quotedPost: post.quotedPost
        ? this.serializePostForShare(post.quotedPost as PostData)
        : undefined
    };

    return clonedPost;
  }

  private serializePostMetadata(metadata: PostMetadata): PostMetadata {
    const timestamp = typeof metadata.timestamp === 'string'
      ? metadata.timestamp
      : metadata.timestamp.toISOString();

    const editedAt = metadata.editedAt
      ? (typeof metadata.editedAt === 'string' ? metadata.editedAt : metadata.editedAt.toISOString())
      : undefined;

    return {
      ...metadata,
      timestamp,
      editedAt
    };
  }

  private cloneComments(comments?: Comment[]): Comment[] | undefined {
    if (!comments) {
      return undefined;
    }

    return comments.map(comment => ({
      ...comment,
      author: { ...comment.author },
      replies: this.cloneComments(comment.replies)
    }));
  }

  // Track if Leaflet CSS is injected
  private static leafletCssInjected = false;

  /**
   * Inject Leaflet CSS styles (bundled, no external request)
   */
  private injectLeafletCss(): void {
    // Leaflet CSS is now in post-card.css - no runtime injection needed.
    // This method is kept for backward compatibility of call sites.
  }

  /**
   * Parse Google Maps business data from raw API response or content.text fallback
   * When reading from markdown, raw data isn't available, so we parse from content.text
   */
  private parseGoogleMapsBusinessData(post: PostData): {
    name: string;
    rating?: number;
    reviewsCount?: number;
    categories?: string[];
    phone?: string;
    website?: string;
    address?: string;
    hours?: Record<string, string>;
    priceLevel?: string;
    isVerified?: boolean;
    lat?: number;
    lng?: number;
  } {
    const raw = post.raw as Record<string, unknown> | undefined;
    const contentText = post.content.text || '';

    // Parse rating: try raw first, then metadata.likes (stored as rating * 20), then content.text
    let rating: number | undefined;
    if (typeof raw?.rating === 'number') {
      rating = raw.rating;
    } else if (typeof post.metadata.likes === 'number' && post.metadata.likes > 0 && post.metadata.likes <= 100) {
      // Rating was stored as likes * 20 (e.g., 4.8 * 20 = 96)
      rating = post.metadata.likes / 20;
    } else {
      // Parse from content: "⭐⭐⭐⭐⭐ 4.8/5 (7190 reviews)"
      const ratingMatch = contentText.match(/(\d+\.?\d*)\/5/);
      if (ratingMatch?.[1]) {
        rating = parseFloat(ratingMatch[1]);
      }
    }

    // Parse hours from raw data or content.text
    let hours: Record<string, string> | undefined;
    if (raw?.open_hours && typeof raw.open_hours === 'object') {
      hours = raw.open_hours as Record<string, string>;
    } else {
      // Parse from content: "Sunday: 6:30 AM–10:30 PM"
      const hoursMatch = contentText.match(/⏰ Hours:\n([\s\S]*?)(?:\n\n|$)/);
      if (hoursMatch?.[1]) {
        hours = {};
        const dayLines = hoursMatch[1].split('\n').filter(l => l.trim());
        dayLines.forEach(line => {
          const [day, time] = line.split(': ');
          if (day && time) {
            if (hours) hours[day.trim()] = time.trim();
          }
        });
      }
    }

    // Parse categories from raw or content.text
    let categories: string[] | undefined;
    if (raw?.all_categories && Array.isArray(raw.all_categories)) {
      categories = raw.all_categories as string[];
    } else {
      // Parse from content: "Categories: Vietnamese restaurant, Menu, ..."
      const catMatch = contentText.match(/Categories: ([^\n]+)/);
      if (catMatch?.[1]) {
        categories = catMatch[1].split(', ').map(c => c.trim());
      }
    }

    // Parse phone from raw or content.text
    let phone: string | undefined;
    if (typeof raw?.phone_number === 'string') {
      phone = raw.phone_number;
    } else {
      // Parse from content: "📞 +84946874615"
      const phoneMatch = contentText.match(/📞\s*(\+?[\d\s-]+)/);
      if (phoneMatch?.[1]) {
        phone = phoneMatch[1].trim();
      }
    }

    // Parse website from raw or content.text
    let website: string | undefined;
    if (typeof raw?.open_website === 'string') {
      website = raw.open_website;
    } else {
      // Parse from content: "🌐 https://..."
      const webMatch = contentText.match(/🌐\s*(https?:\/\/[^\s\n]+)/);
      if (webMatch?.[1]) {
        website = webMatch[1].trim();
      }
    }

    return {
      name: post.author.name || post.title || 'Unknown Place',
      rating,
      reviewsCount: post.metadata.comments,
      categories,
      phone,
      website,
      address: post.metadata.location,
      hours,
      priceLevel: typeof raw?.price_level === 'string' ? raw.price_level : undefined,
      isVerified: post.author.verified,
      lat: post.metadata.latitude,
      lng: post.metadata.longitude,
    };
  }

  /**
   * Format business hours smartly
   * - If all days same: "Daily 6:30 AM – 10:30 PM"
   * - If weekdays same: "Mon-Fri 9 AM – 5 PM, Sat-Sun Closed"
   * - Otherwise: show individual days
   */
  private formatBusinessHours(hours: Record<string, string>): {
    summary: string;
    isOpen?: boolean;
    detailed: Array<{ day: string; hours: string; isToday: boolean }>;
  } {
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const shortDays: Record<string, string> = {
      Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
      Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun'
    };

    // Get today's day
    const today = dayOrder[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];

    // Normalize hours entries
    const normalizedHours: Record<string, string> = {};
    for (const [day, time] of Object.entries(hours)) {
      const normalizedDay = dayOrder.find(d => d.toLowerCase() === day.toLowerCase()) || day;
      normalizedHours[normalizedDay] = time;
    }

    // Build detailed array
    const detailed = dayOrder.map(day => ({
      day: shortDays[day] || day,
      hours: normalizedHours[day] || 'Closed',
      isToday: day === today
    }));

    // Check if all hours are the same
    const uniqueHours = new Set(Object.values(normalizedHours));
    const allSame = uniqueHours.size === 1 && dayOrder.every(d => normalizedHours[d]);

    if (allSame) {
      const time = Object.values(normalizedHours)[0];
      return {
        summary: `Open daily ${time}`,
        detailed
      };
    }

    // Check for weekday/weekend pattern
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const weekend = ['Saturday', 'Sunday'];
    const weekdayHours = weekdays.map(d => normalizedHours[d]).filter(Boolean);
    const weekendHours = weekend.map(d => normalizedHours[d]).filter(Boolean);

    const allWeekdaysSame = new Set(weekdayHours).size === 1 && weekdayHours.length === 5;
    const allWeekendSame = new Set(weekendHours).size <= 1;

    if (allWeekdaysSame && allWeekendSame && weekdayHours.length > 0) {
      const weekdayTime = weekdayHours[0];
      const weekendTime = weekendHours[0] || 'Closed';

      if (weekdayTime === weekendTime) {
        return { summary: `Open daily ${weekdayTime}`, detailed };
      }

      return {
        summary: `Mon-Fri ${weekdayTime}${weekendTime !== 'Closed' ? `, Sat-Sun ${weekendTime}` : ', Sat-Sun Closed'}`,
        detailed
      };
    }

    // Check for days off
    const closedDays = dayOrder.filter(d => !normalizedHours[d] || normalizedHours[d].toLowerCase() === 'closed');
    if (closedDays.length === 1 && closedDays[0]) {
      const closedDay = closedDays[0];
      const openHours = Object.values(normalizedHours).find(h => h && h.toLowerCase() !== 'closed');
      return {
        summary: `${shortDays[closedDay] || closedDay} closed${openHours ? `, otherwise ${openHours}` : ''}`,
        detailed
      };
    }

    // Default: show today's hours
    const todayHours = (today && normalizedHours[today]) || 'Hours unavailable';
    return {
      summary: `Today: ${todayHours}`,
      detailed
    };
  }

  /**
   * Build Google Maps directions URL
   */
  private buildGoogleMapsDirectionsUrl(lat?: number, lng?: number, address?: string, placeName?: string): string {
    if (lat && lng) {
      const destination = encodeURIComponent(`${lat},${lng}`);
      return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    }
    if (address) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    }
    if (placeName) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(placeName)}`;
    }
    return 'https://www.google.com/maps';
  }

  /**
   * Abbreviate address for display
   * "126 Đường Trần Hưng Đạo, Dương Tơ, Phú Quốc, Kiên Giang 92000, Vietnam"
   * → "126 Đường Trần Hưng Đạo, Phú Quốc, Vietnam"
   */
  private abbreviateAddress(address: string): string {
    const parts = address.split(',').map(p => p.trim());

    if (parts.length <= 3) {
      return address; // Already short enough
    }

    // Keep first part (street), and last 2 parts (city/state, country)
    // Skip middle parts (district, ward, etc.)
    const street = parts[0];
    const lastParts = parts.slice(-2);

    // Remove postal codes from the result (e.g., "Kiên Giang 92000" → "Kiên Giang")
    const cleanLastParts = lastParts.map(p => p.replace(/\s*\d{4,6}\s*/, ' ').trim());

    return [street, ...cleanLastParts].join(', ');
  }

  /**
   * Render Google Maps header (Yelp-style)
   * Shows: Business name, rating stars, review count, verified badge
   */
  private renderGoogleMapsHeader(container: HTMLElement, post: PostData): void {
    const data = this.parseGoogleMapsBusinessData(post);

    const header = container.createDiv({ cls: 'gmaps-header pcr-gmaps-header' });

    // Avatar/Logo
    this.renderAvatarInline(header, post);

    // Info section
    const infoSection = header.createDiv({ cls: 'pcr-gmaps-info' });

    // Name row with verified badge
    const nameRow = infoSection.createDiv({ cls: 'pcr-gmaps-name-row' });

    const nameEl = nameRow.createEl('strong', { cls: 'pcr-gmaps-name', text: data.name });
    if (ObsidianPlatform.isMobile) {
      nameEl.setCssStyles({ fontSize: '15px' });
    }
    nameEl.addEventListener('click', () => window.open(post.url, '_blank'));

    // Verified badge
    if (data.isVerified) {
      const verifiedBadge = nameRow.createSpan({ cls: 'pcr-gmaps-verified', text: '✓' });
      verifiedBadge.setAttribute('title', 'Claimed business');
    }

    // Rating row (Yelp style: stars + number + review count)
    if (data.rating) {
      const ratingRow = infoSection.createDiv({ cls: 'pcr-gmaps-rating-row' });

      // Star rating display
      const starsContainer = ratingRow.createSpan({ cls: 'pcr-gmaps-stars' });

      const fullStars = Math.floor(data.rating);
      const hasHalfStar = data.rating % 1 >= 0.3 && data.rating % 1 <= 0.7;
      const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

      // Render stars with color
      const effectiveFullStars = fullStars + (hasHalfStar || data.rating % 1 > 0.7 ? 1 : 0);
      const effectiveEmptyStars = emptyStars - (data.rating % 1 > 0.7 ? 1 : 0);
      for (let i = 0; i < effectiveFullStars; i++) {
        starsContainer.createSpan({ cls: 'pcr-gmaps-star', text: '★' });
      }
      for (let i = 0; i < effectiveEmptyStars; i++) {
        starsContainer.createSpan({ cls: 'pcr-gmaps-star', text: '☆' });
      }

      // Rating number
      ratingRow.createSpan({ cls: 'pcr-gmaps-rating-num', text: data.rating.toFixed(1) });

      // Review count
      if (data.reviewsCount) {
        ratingRow.createSpan({
          cls: 'pcr-gmaps-review-count',
          text: `(${data.reviewsCount.toLocaleString()} reviews)`
        });
      }
    }

    // Category + Price row
    if (data.categories && data.categories.length > 0) {
      const categoryRow = infoSection.createDiv({ cls: 'pcr-gmaps-category-row' });

      // Show first 2-3 categories
      const displayCategories = data.categories.slice(0, 3);
      categoryRow.createSpan({
        cls: 'pcr-gmaps-category',
        text: displayCategories.join(' · ')
      });

      if (data.priceLevel) {
        categoryRow.createSpan({ cls: 'pcr-gmaps-category', text: '·' });
        categoryRow.createSpan({ cls: 'pcr-gmaps-price', text: data.priceLevel });
      }
    }

    // Right side: Action buttons (Call, Directions) + Platform icon
    const rightSection = header.createDiv({ cls: 'pcr-gmaps-right-section' });

    // Call button (compact)
    if (data.phone) {
      const callBtn = rightSection.createEl('a', { cls: 'pcr-gmaps-action-btn' });
      callBtn.href = `tel:${data.phone}`;
      callBtn.setAttribute('title', data.phone);
      const callIcon = callBtn.createDiv({ cls: 'pcr-gmaps-action-icon' });
      setIcon(callIcon, 'phone');
      callBtn.addEventListener('click', (e) => e.stopPropagation());
    }

    // Directions button (compact)
    const directionsUrl = this.buildGoogleMapsDirectionsUrl(data.lat, data.lng, data.address, data.name);
    const dirBtn = rightSection.createEl('a', { cls: 'pcr-gmaps-action-btn' });
    dirBtn.href = directionsUrl;
    dirBtn.target = '_blank';
    dirBtn.setAttribute('title', 'Get directions');
    const dirIcon = dirBtn.createDiv({ cls: 'pcr-gmaps-action-icon' });
    setIcon(dirIcon, 'navigation');
    dirBtn.addEventListener('click', (e) => e.stopPropagation());

    // Platform icon
    this.renderOriginalPostLink(rightSection, post);
  }

  /**
   * Render Google Maps business info (address, hours, website)
   */
  private renderGoogleMapsBusinessInfo(container: HTMLElement, post: PostData): void {
    const data = this.parseGoogleMapsBusinessData(post);
    const directionsUrl = this.buildGoogleMapsDirectionsUrl(data.lat, data.lng, data.address, data.name);

    // Address row (clickable to open in Maps)
    if (data.address) {
      const addressRow = container.createDiv({ cls: 'gmaps-address pcr-gmaps-address-row' });
      addressRow.addEventListener('click', () => {
        window.open(directionsUrl, '_blank');
      });

      const addressIconWrapper = addressRow.createDiv({ cls: 'pcr-gmaps-address-icon' });
      setIcon(addressIconWrapper, 'map-pin');

      const addressText = addressRow.createDiv({ cls: 'pcr-gmaps-address-text' });

      // Abbreviate address: "Street, District, City, State 12345, Country" → "Street, City, Country"
      const shortAddress = this.abbreviateAddress(data.address);
      const addressLabel = addressText.createDiv({ cls: 'pcr-gmaps-address-label', text: shortAddress });
      addressLabel.setAttribute('title', data.address); // Full address on hover

      addressText.createDiv({ cls: 'pcr-gmaps-direction-hint', text: 'Tap for directions' });

      const arrowIconWrapper = addressRow.createDiv({ cls: 'pcr-gmaps-arrow-icon' });
      setIcon(arrowIconWrapper, 'external-link');
    }

    // Hours section (collapsible)
    if (data.hours && Object.keys(data.hours).length > 0) {
      const formattedHours = this.formatBusinessHours(data.hours);

      const hoursSection = container.createDiv({ cls: 'gmaps-hours pcr-gmaps-hours-section' });

      // Summary row (clickable to expand)
      const summaryRow = hoursSection.createDiv({ cls: 'pcr-gmaps-hours-summary' });

      const clockIconWrapper = summaryRow.createDiv({ cls: 'pcr-gmaps-address-icon' });
      setIcon(clockIconWrapper, 'clock');

      summaryRow.createSpan({ cls: 'pcr-gmaps-hours-text', text: formattedHours.summary });

      // Detailed hours (hidden by default)
      const detailedHours = hoursSection.createDiv({ cls: 'pcr-gmaps-hours-detail' });

      formattedHours.detailed.forEach(({ day, hours, isToday }) => {
        const dayRow = detailedHours.createDiv({ cls: 'pcr-gmaps-day-row' });
        if (isToday) {
          dayRow.setCssStyles({ fontWeight: '600', color: 'var(--interactive-accent)' });
        }

        dayRow.createSpan({ text: day });
        const hoursSpan = dayRow.createSpan({ text: hours });
        if (hours.toLowerCase() === 'closed') {
          hoursSpan.addClass('pcr-gmaps-closed');
        }
      });

      let expanded = false;
      summaryRow.addEventListener('click', () => {
        expanded = !expanded;
        detailedHours.toggleClass('sa-hidden', !expanded);
        if (expanded) {
          detailedHours.setCssStyles({ display: 'block' });
        }
      });
    }

    // Website button (if available)
    if (data.website) {
      const websiteRow = container.createDiv({ cls: 'gmaps-website pcr-gmaps-website-row' });
      websiteRow.addEventListener('click', () => {
        window.open(data.website, '_blank');
      });

      const websiteIconWrapper = websiteRow.createDiv({ cls: 'pcr-gmaps-website-icon' });
      setIcon(websiteIconWrapper, 'globe');

      websiteRow.createSpan({ cls: 'pcr-gmaps-website-text', text: data.website.replace(/^https?:\/\//, '').replace(/\/$/, '') });

      const arrowIconWrapper = websiteRow.createDiv({ cls: 'pcr-gmaps-arrow-icon' });
      setIcon(arrowIconWrapper, 'external-link');
    }
  }

  /**
   * Create an action button for Google Maps card with Lucide icon
   */
  private createGmapsActionButton(container: HTMLElement, iconName: string, label: string, url: string): HTMLElement {
    const btn = container.createEl('a', { cls: 'pcr-gmaps-action-btn' });
    btn.href = url;
    btn.target = '_blank';

    const iconWrapper = btn.createDiv({ cls: 'pcr-gmaps-action-icon' });
    setIcon(iconWrapper, iconName);

    btn.createSpan({ text: label });
    btn.addEventListener('click', (e) => e.stopPropagation());
    return btn;
  }

  /**
   * Render Google Maps location embed using Leaflet + OpenStreetMap tiles
   * Shows an interactive map with the place location
   */
  private renderGoogleMapsEmbed(container: HTMLElement, post: PostData): void {
    const lat = post.metadata.latitude;
    const lng = post.metadata.longitude;

    // Skip if no coordinates available
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return;
    }

    // Inject CSS once
    this.injectLeafletCss();

    const mapWrapper = container.createDiv({ cls: 'sa-map-wrapper pcr-gmaps-map-wrapper' });

    // Map container
    const mapContainer = mapWrapper.createDiv({ cls: 'pcr-gmaps-map-container' });

    // Touch overlay to prevent Leaflet from capturing scroll events
    // This overlay intercepts all touch events and only allows clicks through
    const touchOverlay = mapWrapper.createDiv({ cls: 'pcr-gmaps-map-touch-overlay' });

    // Click on overlay opens Google Maps
    touchOverlay.addEventListener('click', () => {
      window.open(post.url || `https://www.google.com/maps?q=${lat},${lng}`, '_blank');
    });

    // Use IntersectionObserver to lazy-load map when visible
    // This fixes rendering issues when the container isn't visible on initial load
    let mapInitialized = false;

    const initializeMap = () => {
      if (mapInitialized) return;
      mapInitialized = true;

      try {
        const map = L.map(mapContainer, {
          center: [lat, lng],
          zoom: 15,
          zoomControl: !L.Browser.mobile, // Hide zoom controls on mobile
          scrollWheelZoom: false,
          attributionControl: false,
          // Completely disable all touch/mouse interactions to prevent scroll jitter
          dragging: false,
          touchZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          tap: false, // Valid Leaflet option for mobile, not in @types/leaflet
        } as L.MapOptions);

        // OpenStreetMap tiles
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
        }).addTo(map);

        // Custom attribution - top left corner (z-index low to stay below filter panels)
        const attr = document.createElement('div');
        attr.addClass('pcr-gmaps-map-attr');
        attr.textContent = '© ';
        const link = attr.createEl('a', { text: 'OSM' });
        link.href = 'https://www.openstreetmap.org/copyright';
        link.target = '_blank';
        mapWrapper.appendChild(attr);


        // Custom marker using div icon (no external images needed)
        const markerIcon = L.divIcon({
          className: 'sa-map-marker',
          html: '<div style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">📍</div>',
          iconSize: [30, 40],
          iconAnchor: [15, 40],
        });

        L.marker([lat, lng], { icon: markerIcon }).addTo(map);

        // Fix tile loading issue - invalidate size after container is rendered
        setTimeout(() => {
          map.invalidateSize();
        }, 100);
      } catch (err) {
        console.error('[PostCardRenderer] Failed to initialize Leaflet map:', err);
        // Fallback: show location text only
        mapContainer.addClass('pcr-map-fallback-text');
        mapContainer.textContent = `📍 ${post.metadata.location || `${lat}, ${lng}`}`;
      }
    };

    // Create IntersectionObserver to initialize map when visible
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !mapInitialized) {
            initializeMap();
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '100px', // Start loading slightly before visible
        threshold: 0.1,
      }
    );

    observer.observe(mapContainer);

    // Add location info bar
    const linkContainer = mapWrapper.createDiv({ cls: 'pcr-map-link-container' });

    // Location text
    if (post.metadata.location) {
      linkContainer.createSpan({ text: post.metadata.location, cls: 'pcr-map-location-text' });
    }

    // Links container
    const linksDiv = linkContainer.createDiv({ cls: 'pcr-map-links' });

    // Directions link
    const directionsUrl = this.buildGoogleMapsDirectionsUrl(lat, lng, post.metadata.location, post.author.name);
    const directionsLink = linksDiv.createEl('a', { text: 'Directions', cls: 'pcr-map-link' });
    directionsLink.href = directionsUrl;
    directionsLink.target = '_blank';
    directionsLink.addEventListener('click', (e) => e.stopPropagation());

    // Google Maps link
    const gmapLink = linksDiv.createEl('a', { text: 'Open in maps', cls: 'pcr-map-link' });
    gmapLink.href = post.url || `https://www.google.com/maps?q=${lat},${lng}`;
    gmapLink.target = '_blank';
    gmapLink.addEventListener('click', (e) => e.stopPropagation());
  }

  // ============================================================================
  // AI Comment Methods
  // ============================================================================

  /**
   * Check if AI comment banner should be shown for a post
   * Desktop only, archived posts, with available CLI tools
   */
  private async shouldShowAICommentBanner(post: PostData): Promise<boolean> {
    // Desktop only
    if (ObsidianPlatform.isMobile) return false;

    // Feature must be enabled
    if (!this.plugin.settings.aiComment?.enabled) return false;

    // Must be archived (has file path)
    if (!post.filePath) return false;

    // User hasn't declined for this post
    if (post.aiCommentDeclined) return false;

    // Podcast requires transcription (uses whisperTranscript, not transcript)
    if (post.platform === 'podcast' && !post.whisperTranscript?.segments?.length) return false;

    // Check platform visibility settings
    if (!this.isAICommentEnabledForPlatform(post.platform)) {
      return false;
    }

    // At least one AI CLI must be available
    const availableClis = await this.getAvailableClis();
    return availableClis.length > 0;
  }

  /**
   * Check if AI comments are enabled for the given platform based on settings
   */
  private isAICommentEnabledForPlatform(platform: Platform): boolean {
    const settings = this.plugin.settings.aiComment;
    if (!settings) return false;

    const visibility = settings.platformVisibility;

    // Check if platform is explicitly excluded
    if (visibility.excludedPlatforms.includes(platform)) {
      return false;
    }

    // Get platform category from centralized definitions
    const category = getPlatformCategory(platform);

    // Check if category is enabled
    switch (category) {
      case 'socialMedia':
        return visibility.socialMedia;
      case 'blogNews':
        return visibility.blogNews;
      case 'videoAudio':
        return visibility.videoAudio;
      default:
        // Platforms without a category (e.g., 'googlemaps', 'post')
        // Default: allow if any category is enabled
        return visibility.socialMedia || visibility.blogNews || visibility.videoAudio;
    }
  }

  /**
   * Get available CLI tools with caching
   */
  private async getAvailableClis(): Promise<AICli[]> {
    const now = Date.now();

    // Check if cache is valid
    if (this.cachedCliDetection && (now - this.cliDetectionTimestamp) < this.CLI_DETECTION_CACHE_TTL) {
      return Array.from(this.cachedCliDetection.entries())
        .filter(([_, result]) => result.available)
        .map(([cli]) => cli);
    }

    // Detect all CLIs
    const detection = await AICliDetector.detectAll();
    this.cachedCliDetection = detection;
    this.cliDetectionTimestamp = now;

    return Array.from(detection.entries())
      .filter(([_, result]) => result.available)
      .map(([cli]) => cli);
  }

  /**
   * Render AI comment banner on a post card
   */
  private async renderAICommentBanner(
    contentArea: HTMLElement,
    post: PostData,
    rootElement: HTMLElement
  ): Promise<void> {
    const availableClis = await this.getAvailableClis();
    if (availableClis.length === 0) return;

    const settings = this.plugin.settings.aiComment;
    // availableClis is guaranteed non-empty (checked above)
    const defaultCliFromSettings = settings.defaultCli;
    const defaultCli: AICli = availableClis.includes(defaultCliFromSettings)
      ? defaultCliFromSettings
      : (availableClis[0] ?? 'claude');

    // Create container for banner with top margin for separation
    const bannerContainer = contentArea.createDiv({ cls: 'ai-comment-banner-container pcr-banner-mt-16' });

    // Create banner instance
    const banner = new AICommentBanner();
    this.aiCommentBanners.set(post.id, banner);

    // Filter multi-AI selection to only available CLIs
    const multiAiSelection = settings.multiAiEnabled && settings.multiAiSelection
      ? settings.multiAiSelection.filter(cli => availableClis.includes(cli))
      : [];

    // Detect if post has any transcript data
    const hasTranscript = !!(
      post.whisperTranscript?.segments?.length
      || post.transcript?.formatted?.length
    );

    const options: AICommentBannerOptions = {
      availableClis,
      defaultCli,
      defaultType: settings.defaultType,
      isGenerating: false,
      onGenerate: async (cli: AICli, type: AICommentType, customPrompt?: string, language?: AIOutputLanguage) => {
        await this.handleAICommentGenerate(post, cli, type, banner, rootElement, customPrompt, language);
      },
      onGenerateMulti: async (clis: AICli[], type: AICommentType, customPrompt?: string, language?: AIOutputLanguage) => {
        await this.handleAICommentGenerateMulti(post, clis, type, banner, rootElement, customPrompt, language);
      },
      onDecline: () => {
        void this.handleAICommentDecline(post, rootElement);
      },
      // Multi-AI settings
      multiAiEnabled: settings.multiAiEnabled && multiAiSelection.length > 1,
      multiAiSelection: multiAiSelection.length > 1 ? multiAiSelection : undefined,
      // Language settings
      outputLanguage: settings.outputLanguage || 'auto',
      // Transcript availability (enables translate-transcript type)
      hasTranscript,
    };

    banner.render(bannerContainer, options);
  }

  /**
   * Render existing AI comments on a post card
   */
  private async renderExistingAIComments(
    contentArea: HTMLElement,
    post: PostData,
    rootElement: HTMLElement
  ): Promise<void> {
    const filePath = post.filePath;
    if (!filePath) return;

    try {
      const file = this.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) return;

      const content = await this.vault.read(file);
      const { comments, commentTexts } = parseAIComments(content);

      if (comments.length === 0) return;

      // Create container for comments
      const commentsContainer = contentArea.createDiv({ cls: 'ai-comment-renderer-container' });

      // Create renderer instance
      const renderer = new AICommentRenderer();
      this.aiCommentRenderers.set(post.id, renderer);

      const options: AICommentRendererOptions = {
        app: this.app,
        comments,
        commentTexts,
        component: this,
        sourcePath: filePath,
        onDelete: async (commentId: string) => {
          await this.handleAICommentDelete(post, commentId, rootElement);
        },
        onAddMore: () => {
          // Show the banner for adding more comments
          const existingBanner = this.aiCommentBanners.get(post.id);
          const bannerState = existingBanner?.getState();

          // If banner exists and is in a usable state, show it
          if (existingBanner && bannerState !== 'complete' && bannerState !== 'dismissed') {
            existingBanner.setState('default');
          } else {
            // Banner was dismissed/completed or doesn't exist - create new one
            // Clean up old banner first
            if (existingBanner) {
              existingBanner.destroy();
              this.aiCommentBanners.delete(post.id);
            }
            // Remove old container if exists
            const oldContainer = rootElement.querySelector('.ai-comment-banner-container');
            if (oldContainer) {
              oldContainer.remove();
            }
            // Create new banner
            void this.renderAICommentBanner(contentArea, post, rootElement);
          }
        },
        // Timestamp click handler for podcast/video seeking
        onTimestampClick: (seconds: number) => {
          this.seekToTimestamp(post, rootElement, seconds);
        },
        // Apply reformat handler - replaces body content with reformatted text
        onApplyReformat: async (commentId: string, newContent: string) => {
          await this.handleApplyReformat(post, commentId, newContent, rootElement);
        },
      };

      renderer.render(commentsContainer, options);
    } catch (error) {
      console.error('[PostCardRenderer] Failed to render AI comments:', error);
    }
  }

  /**
   * Handle AI comment generation
   */
  private async handleAICommentGenerate(
    post: PostData,
    cli: AICli,
    type: AICommentType,
    banner: AICommentBanner,
    rootElement: HTMLElement,
    customPrompt?: string,
    language?: AIOutputLanguage
  ): Promise<void> {
    const filePath = post.filePath;
    if (!filePath) {
      new Notice('Cannot generate AI comment: post is not archived');
      throw new Error('Post not archived');
    }

    try {
      // Import AICommentService dynamically
      const { AICommentService } = await import('../../../services/AICommentService');
      const service = new AICommentService();

      // Get content for analysis
      let content = post.content.rawMarkdown || post.content.text || '';

      // For translate-transcript: extract transcript segments as timestamped lines
      if (type === 'translate-transcript') {
        const transcriptSegments = post.whisperTranscript?.segments
          || post.transcript?.formatted?.map((entry, i) => ({
            id: i,
            start: entry.start_time / 1000,
            end: entry.end_time ? entry.end_time / 1000 : (entry.start_time / 1000) + 8,
            text: entry.text,
          }));

        if (!transcriptSegments?.length) {
          new Notice('No transcript available to translate');
          throw new Error('No transcript');
        }

        content = transcriptSegments.map(s => {
          const timestamp = this.formatTimestampForContent(s.start);
          return `[${timestamp}] ${s.text}`;
        }).join('\n');
      } else {
        // For podcasts, use whisperTranscript if available (with timestamps for AI citation)
        if (post.platform === 'podcast' && post.whisperTranscript?.segments?.length) {
          content = post.whisperTranscript.segments.map(s => {
            const timestamp = this.formatTimestampForContent(s.start);
            return `[${timestamp}] ${s.text}`;
          }).join('\n');
        }

        // Include embedded archives content (e.g., YouTube transcripts in user posts)
        if (post.embeddedArchives?.length) {
          const embeddedContent = post.embeddedArchives.map(embed => {
            // For YouTube embeds, prefer transcript
            if (embed.platform === 'youtube' && embed.transcript?.raw) {
              return `[Embedded ${embed.platform}: ${embed.title || 'Video'}]\n${embed.transcript.raw}`;
            }
            // For other embeds, use text content
            return `[Embedded ${embed.platform}: ${embed.title || 'Post'}]\n${embed.content.text || ''}`;
          }).join('\n\n');

          if (embeddedContent.trim()) {
            content = content.trim() + '\n\n--- Embedded Content ---\n\n' + embeddedContent;
          }
        }
      }

      if (!content.trim()) {
        new Notice('No content available for AI analysis');
        throw new Error('No content');
      }

      // Update banner progress
      banner.updateProgress({
        percentage: 10,
        status: `Starting ${cli} analysis...`,
        cli,
        phase: 'preparing',
      });

      // Get vault path and current note path for connections type
      // @ts-expect-error - adapter.basePath is available on desktop but not in types
      const vaultPath = type === 'connections' ? (this.vault.adapter.basePath as string) : undefined;
      const currentNotePath = type === 'connections' ? filePath : undefined;

      // Determine target language for translate-transcript
      // Use the language selected in the banner dropdown (language param),
      // fall back to settings, then default to 'ko'
      const targetLang = type === 'translate-transcript'
        ? (language || this.plugin.settings.aiComment.translationLanguage || 'ko')
        : undefined;

      // Generate comment (use language from banner, fallback to settings)
      const result = await service.generateComment(content, {
        cli,
        type,
        customPrompt,
        vaultPath,
        currentNotePath,
        targetLanguage: targetLang,
        outputLanguage: language || this.plugin.settings.aiComment.outputLanguage || 'auto',
        onProgress: (progress: AICommentProgress) => {
          banner.updateProgress(progress);
        },
        signal: banner.getAbortSignal(),
      });

      // Mark as UI modification to prevent refresh
      this.onUIModifyCallback?.(filePath);

      // Save to markdown file
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        const existingContent = await this.vault.read(file);

        if (type === 'translate-transcript' && targetLang) {
          // Save as transcript section instead of AI comment
          const defaultLangCode = post.whisperTranscript?.language
            || post.transcriptionLanguage
            || 'en';
          const updatedContent = insertTranscriptSection(
            existingContent,
            targetLang,
            result.content,
            defaultLangCode
          );

          if (updatedContent === null) {
            new Notice(`Transcript (${languageCodeToName(targetLang)}) already exists. Delete the existing translation first.`);
            return;
          }

          await this.vault.modify(file, updatedContent);

          // Update transcriptLanguages frontmatter
          const languages = extractTranscriptLanguages(updatedContent, defaultLangCode);
          await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            fm.transcriptLanguages = languages;
          });
        } else {
          // Standard AI comment save
          const newContent = appendAIComment(existingContent, result.meta, result.content);
          await this.vault.modify(file, newContent);

          // Update frontmatter
          const { comments, commentTexts } = parseAIComments(newContent);
          await updateFrontmatterAIComments(this.app, file, comments);

          // Update shared post if already shared
          let shareUrl = post.shareUrl;
          if (!shareUrl) {
            const cache = this.app.metadataCache.getFileCache(file);
            shareUrl = cache?.frontmatter?.shareUrl as string | undefined;
          }
          if (shareUrl) {
            this.updateSharedPostAIComments(post, shareUrl, comments, commentTexts)
              .catch(err => {
                console.error('[PostCardRenderer] Failed to update shared post with AI comments:', err);
              });
          }
        }
      }

      const displayName = type === 'translate-transcript' && targetLang
        ? `Transcript (${languageCodeToName(targetLang)})`
        : `AI ${type}`;
      new Notice(`${displayName} generated successfully!`);

      // Refresh the post card to show the new comment/transcript
      setTimeout(() => {
        if (type === 'translate-transcript') {
          // Full re-render needed to pick up new multilang transcript tabs
          void this.refreshPostCardFull(post, rootElement);
        } else {
          void this.refreshPostCard(post, rootElement);
        }
      }, 500);

    } catch (error) {
      if (error instanceof Error && error.message === 'Cancelled') {
        new Notice('AI comment generation cancelled');
      } else {
        console.error('[PostCardRenderer] AI comment generation failed:', error);
        new Notice(`Failed to generate AI comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      throw error;
    }
  }

  /**
   * Handle Multi-AI parallel comment generation
   */
  private async handleAICommentGenerateMulti(
    post: PostData,
    clis: AICli[],
    type: AICommentType,
    banner: AICommentBanner,
    rootElement: HTMLElement,
    customPrompt?: string,
    language?: AIOutputLanguage
  ): Promise<void> {
    const filePath = post.filePath;
    if (!filePath) {
      new Notice('Cannot generate AI comment: post is not archived');
      throw new Error('Post not archived');
    }

    try {
      // Import AICommentService dynamically
      const { AICommentService } = await import('../../../services/AICommentService');
      const service = new AICommentService();

      // Get content for analysis
      let content = post.content.rawMarkdown || post.content.text || '';

      // For podcasts, use whisperTranscript if available (with timestamps for AI citation)
      if (post.platform === 'podcast' && post.whisperTranscript?.segments?.length) {
        content = post.whisperTranscript.segments.map(s => {
          const timestamp = this.formatTimestampForContent(s.start);
          return `[${timestamp}] ${s.text}`;
        }).join('\n');
      }

      // Include embedded archives content (e.g., YouTube transcripts in user posts)
      if (post.embeddedArchives?.length) {
        const embeddedContent = post.embeddedArchives.map(embed => {
          // For YouTube embeds, prefer transcript
          if (embed.platform === 'youtube' && embed.transcript?.raw) {
            return `[Embedded ${embed.platform}: ${embed.title || 'Video'}]\n${embed.transcript.raw}`;
          }
          // For other embeds, use text content
          return `[Embedded ${embed.platform}: ${embed.title || 'Post'}]\n${embed.content.text || ''}`;
        }).join('\n\n');

        if (embeddedContent.trim()) {
          content = content.trim() + '\n\n--- Embedded Content ---\n\n' + embeddedContent;
        }
      }

      if (!content.trim()) {
        new Notice('No content available for AI analysis');
        throw new Error('No content');
      }

      // Update banner progress
      const firstCli = clis[0];
      if (!firstCli) {
        throw new Error('No CLIs provided');
      }
      banner.updateProgress({
        percentage: 10,
        status: `Starting parallel analysis with ${clis.length} AIs...`,
        cli: firstCli,
        phase: 'preparing',
      });

      // Get vault path and current note path for connections type
      // @ts-expect-error - adapter.basePath is available on desktop but not in types
      const vaultPath = type === 'connections' ? (this.vault.adapter.basePath as string) : undefined;
      const currentNotePath = type === 'connections' ? filePath : undefined;

      // Generate comments in parallel (use language from banner, fallback to settings)
      const outputLanguage = language || this.plugin.settings.aiComment.outputLanguage || 'auto';
      const results = await Promise.allSettled(
        clis.map(cli =>
          service.generateComment(content, {
            cli,
            type,
            customPrompt,
            vaultPath,
            currentNotePath,
            outputLanguage,
            onProgress: (progress: AICommentProgress) => {
              // Update progress (show the first CLI's progress as primary)
              if (cli === clis[0]) {
                banner.updateProgress({
                  ...progress,
                  status: `${progress.status} (${clis.length} AIs)`,
                });
              }
            },
            signal: banner.getAbortSignal(),
          })
        )
      );

      // Mark as UI modification to prevent refresh
      this.onUIModifyCallback?.(filePath);

      // Collect successful results
      const successfulResults: AICommentResult[] = [];
      const failedClis: string[] = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successfulResults.push(result.value);
        } else {
          const failedCli = clis[index];
          if (failedCli) {
            failedClis.push(failedCli);
          }
        }
      });

      if (successfulResults.length === 0) {
        throw new Error('All AI generations failed');
      }

      // Save all successful results to markdown file
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        let existingContent = await this.vault.read(file);

        // Append each result
        for (const result of successfulResults) {
          existingContent = appendAIComment(existingContent, result.meta, result.content);
        }

        await this.vault.modify(file, existingContent);

        // Update frontmatter
        const { comments, commentTexts } = parseAIComments(existingContent);
        await updateFrontmatterAIComments(this.app, file, comments);

        // Update shared post if already shared
        // Check both post object and frontmatter for shareUrl
        let shareUrl = post.shareUrl;
        if (!shareUrl) {
          // Try to get shareUrl from frontmatter
          const cache = this.app.metadataCache.getFileCache(file);
          shareUrl = cache?.frontmatter?.shareUrl as string | undefined;
        }
        if (shareUrl) {
          this.updateSharedPostAIComments(post, shareUrl, comments, commentTexts)
            .catch(err => {
              console.error('[PostCardRenderer] Failed to update shared post with AI comments:', err);
            });
        }
      }

      // Show result notice
      if (failedClis.length > 0) {
        new Notice(`AI ${type} generated with ${successfulResults.length}/${clis.length} AIs (${failedClis.join(', ')} failed)`);
      } else {
        new Notice(`AI ${type} generated successfully with ${clis.length} AIs!`);
      }

      // Refresh the post card to show the new comments
      setTimeout(() => {
        void this.refreshPostCard(post, rootElement);
      }, 500);

    } catch (error) {
      if (error instanceof Error && error.message === 'Cancelled') {
        new Notice('AI comment generation cancelled');
      } else {
        console.error('[PostCardRenderer] Multi-AI comment generation failed:', error);
        new Notice(`Failed to generate AI comments: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      throw error;
    }
  }

  /**
   * Handle AI comment decline
   */
  private async handleAICommentDecline(post: PostData, rootElement: HTMLElement): Promise<void> {
    const filePath = post.filePath;
    if (!filePath) return;

    try {
      // Mark as UI modification
      this.onUIModifyCallback?.(filePath);

      // Update frontmatter to mark as declined
      const file = this.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          fm.aiCommentDeclined = true;
        });
      }

      // Remove banner from UI
      const bannerContainer = rootElement.querySelector('.ai-comment-banner-container');
      if (bannerContainer) {
        bannerContainer.remove();
      }

      // Cleanup banner instance
      const banner = this.aiCommentBanners.get(post.id);
      if (banner) {
        banner.destroy();
        this.aiCommentBanners.delete(post.id);
      }
    } catch (error) {
      console.error('[PostCardRenderer] Failed to decline AI comment:', error);
    }
  }

  /**
   * Handle applying reformat content to the post body
   * Replaces the body text (between frontmatter and comments section) with new content
   */
  private async handleApplyReformat(
    post: PostData,
    commentId: string,
    newContent: string,
    rootElement: HTMLElement
  ): Promise<void> {
    const filePath = post.filePath;
    if (!filePath) {
      new Notice('Cannot apply reformat: post file not found');
      return;
    }

    try {
      // Mark as UI modification
      this.onUIModifyCallback?.(filePath);

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        new Notice('Cannot apply reformat: file not found');
        return;
      }

      const content = await this.vault.read(file);

      // Parse file structure:
      // 1. YAML frontmatter (--- to ---)
      // 2. Body content (reformat target)
      // 3. Media embeds and separators
      // 4. Comments section (## 💬 Comments)
      // 5. Footer metadata

      // Extract frontmatter
      let frontmatter = '';
      let bodyStart = 0;
      if (content.startsWith('---')) {
        const endIdx = content.indexOf('---', 3);
        if (endIdx !== -1) {
          frontmatter = content.substring(0, endIdx + 3);
          bodyStart = endIdx + 3;
        }
      }

      // Find the end of body content
      // Look for Comments section or media separator or footer
      const afterFrontmatter = content.substring(bodyStart);

      // Possible body end markers (in order of preference)
      const bodyEndMarkers = [
        '\n---\n\n![',           // Media section start
        '\n\n---\n\n![',         // Media section with extra newline
        '\n## 💬 Comments',       // Comments section
        '\n---\n\n## 💬 Comments', // Comments with separator
        '\n\n---\n\n**Platform:**', // Footer metadata
        '\n---\n\n**Platform:**',   // Footer without extra newline
      ];

      let bodyEndIdx = afterFrontmatter.length;
      let preservedContent = '';

      for (const marker of bodyEndMarkers) {
        const idx = afterFrontmatter.indexOf(marker);
        if (idx !== -1 && idx < bodyEndIdx) {
          bodyEndIdx = idx;
          preservedContent = afterFrontmatter.substring(idx);
        }
      }

      // Build new content
      const newFileContent = frontmatter + '\n\n' + newContent.trim() + preservedContent;

      // Save file
      await this.vault.modify(file, newFileContent);

      // Update post object with new content so UI reflects the change
      post.content.text = newContent.trim();
      if (post.content.rawMarkdown) {
        post.content.rawMarkdown = newContent.trim();
      }

      // Find and re-render the content text element
      // Use specific class selector that works for both regular and blog content
      const contentTextEl = rootElement.querySelector('.post-content-area .text-sm.leading-relaxed') as HTMLElement;

      if (contentTextEl) {
        // Remove any "See more/less" button as we'll show full reformatted content
        const seeMoreBtn = contentTextEl.parentElement?.querySelector('button');
        if (seeMoreBtn) {
          seeMoreBtn.remove();
        }

        contentTextEl.empty();
        await MarkdownRenderer.render(this.app, newContent.trim(), contentTextEl, filePath, this);
        this.normalizeTagFontSizes(contentTextEl);
        this.addHashtagClickHandlers(contentTextEl);
      }

      // Show success notice
      new Notice('Content reformatted successfully');

      // Refresh AI comments section
      setTimeout(() => {
        void this.refreshPostCard(post, rootElement);
      }, 500);

    } catch (error) {
      console.error('[PostCardRenderer] Failed to apply reformat:', error);
      new Notice('Failed to apply reformat');
    }
  }

  /**
   * Handle AI comment deletion
   */
  private async handleAICommentDelete(post: PostData, commentId: string, rootElement: HTMLElement): Promise<void> {
    const filePath = post.filePath;
    if (!filePath) return;

    try {
      // Mark as UI modification
      this.onUIModifyCallback?.(filePath);

      const file = this.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) return;

      // Remove from markdown
      const content = await this.vault.read(file);
      const newContent = removeAIComment(content, commentId);
      await this.vault.modify(file, newContent);

      // Update frontmatter
      const { comments, commentTexts } = parseAIComments(newContent);
      await updateFrontmatterAIComments(this.app, file, comments);

      // Update shared post if already shared
      // Check both post object and frontmatter for shareUrl
      let shareUrl = post.shareUrl;
      if (!shareUrl) {
        // Try to get shareUrl from frontmatter
        const cache = this.app.metadataCache.getFileCache(file);
        shareUrl = cache?.frontmatter?.shareUrl as string | undefined;
      }

      if (shareUrl) {
        // Delay aiComments update to ensure it executes AFTER other concurrent share updates
        // This prevents server-side race conditions where other updates overwrite aiComments
        setTimeout(() => {
          void this.updateSharedPostAIComments(post, shareUrl, comments, commentTexts)
            .catch(err => {
              console.error('[PostCardRenderer] Failed to update shared post after AI comment deletion:', err);
            });
        }, 1500); // 1.5 second delay to let other updates complete
      }

      new Notice('AI comment deleted');

      // Refresh the post card to re-render AI comments and show banner if needed
      await this.refreshPostCard(post, rootElement);
    } catch (error) {
      console.error('[PostCardRenderer] Failed to delete AI comment:', error);
      new Notice('Failed to delete AI comment');
      throw error;
    }
  }

  /**
   * Refresh a post card (re-render after changes)
   */
  private async refreshPostCard(post: PostData, rootElement: HTMLElement): Promise<void> {
    // Find the content area where AI comments should be rendered
    const contentArea = rootElement.querySelector('.post-content-area');
    if (!contentArea) return;

    // Remove existing AI comment container if present
    const existingContainer = rootElement.querySelector('.ai-comment-renderer-container');
    if (existingContainer) {
      existingContainer.remove();
    }

    // Also remove the AI comment banner (will be re-evaluated)
    const existingBanner = rootElement.querySelector('.ai-comment-banner');
    if (existingBanner) {
      existingBanner.remove();
    }

    // Cleanup existing renderer and banner
    this.cleanupAICommentComponents(post.id);

    // Re-render AI comments (this creates a new container if comments exist)
    await this.renderExistingAIComments(contentArea as HTMLElement, post, rootElement);

    // Check if should show AI comment banner (if no existing AI comments after refresh)
    const showBanner = await this.shouldShowAICommentBanner(post);
    if (showBanner) {
      const hasExistingComments = rootElement.querySelector('.ai-comment-renderer-container .ai-comment-item');
      if (!hasExistingComments) {
        await this.renderAICommentBanner(contentArea as HTMLElement, post, rootElement);
      }
    }
  }

  /**
   * Full post card re-render by re-parsing the file.
   * Used after translate-transcript to pick up new multilang transcript data.
   */
  private async refreshPostCardFull(post: PostData, rootElement: HTMLElement): Promise<void> {
    if (!post.filePath) return;
    try {
      const file = this.vault.getFileByPath(post.filePath);
      if (!file || !(file instanceof TFile)) return;
      const { PostDataParser } = await import('../parsers/PostDataParser');
      const parser = new PostDataParser(this.vault, this.app);
      const refreshedPost = await parser.parseFile(file);
      if (refreshedPost) {
        // Cleanup existing transcript player
        const existingPlayer = this.videoTranscriptPlayers.get(post.id);
        if (existingPlayer) {
          existingPlayer.destroy();
          this.videoTranscriptPlayers.delete(post.id);
        }
        this.cleanupAICommentComponents(post.id);
        rootElement.empty();
        await this.render(rootElement, refreshedPost);
      }
    } catch {
      // Fallback to partial refresh
      void this.refreshPostCard(post, rootElement);
    }
  }

  /**
   * Update shared post with new AI comments
   * Called after AI comment is generated for an already-shared post
   */
  private async updateSharedPostAIComments(
    post: PostData,
    shareUrl: string,
    comments: AICommentMeta[],
    commentTexts: Map<string, string>
  ): Promise<void> {
    try {
      // Extract shareId from shareUrl
      // URL formats: https://social-archive.org/{shareId} or https://social-archive.org/{username}/{shareId}
      const urlParts = shareUrl.split('/').filter(Boolean);
      const shareId = urlParts[urlParts.length - 1];

      if (!shareId) {
        console.warn('[PostCardRenderer] Could not extract shareId from shareUrl:', shareUrl);
        return;
      }

      // Get worker URL
      const workerUrl = this.getWorkerUrl();
      const username = this.plugin.settings.username;

      // Prepare aiComments data in the same format as share creation
      const aiComments = comments.map(meta => ({
        meta: {
          id: meta.id,
          cli: meta.cli,
          type: meta.type,
          generatedAt: meta.generatedAt,
        },
        content: commentTexts.get(meta.id) || '',
      }));

      // Create ShareAPIClient and update share
      const shareClient = new ShareAPIClient({
        baseURL: workerUrl,
        apiKey: this.plugin.settings.authToken,
        vault: this.vault,
        debug: false
      });

      // Prepare updated postData with aiComments
      const postData = this.serializePostForShare(post, { stripMedia: true });
      postData.aiComments = aiComments;

      const updateRequest = {
        postData,
        options: {
          shareId,
          username
        }
      };

      // Update share with new aiComments
      await shareClient.updateShare(shareId, updateRequest);

    } catch (error) {
      console.error('[PostCardRenderer] Failed to update shared post AI comments:', error);
      // Don't throw - this is a background operation, don't block the main flow
    }
  }

  /**
   * Cleanup AI comment components for a post
   */
  private cleanupAICommentComponents(postId: string): void {
    const banner = this.aiCommentBanners.get(postId);
    if (banner) {
      banner.destroy();
      this.aiCommentBanners.delete(postId);
    }

    const renderer = this.aiCommentRenderers.get(postId);
    if (renderer) {
      renderer.destroy();
      this.aiCommentRenderers.delete(postId);
    }
  }

  /**
   * Format seconds to timestamp string for AI content
   * Used to add timestamps to podcast transcripts for AI citation
   */
  private formatTimestampForContent(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Seek to a specific timestamp in podcast/video content
   * Handles both audio elements and YouTube embeds
   */
  private seekToTimestamp(post: PostData, rootElement: HTMLElement, seconds: number): void {
    // First, try to find audio element (for podcasts)
    const audioElement = rootElement.querySelector<HTMLAudioElement>('audio');
    if (audioElement) {
      audioElement.currentTime = seconds;
      audioElement.play().catch(() => {
        // Ignore autoplay errors
      });
      return;
    }

    // Try YouTube controller (for YouTube embeds)
    const youtubeController = this.youtubeControllers.get(post.id);
    if (youtubeController) {
      youtubeController.seekTo(seconds);
      youtubeController.play();
      return;
    }

    // If no player found, log a warning
    console.warn('[PostCardRenderer] No audio/video player found for timestamp seek');
  }

  /**
   * Clean up all cached data to prevent memory leaks on destroy
   */
  public clearCaches(): void {
    // Destroy and clear AI comment components
    for (const banner of this.aiCommentBanners.values()) {
      banner.destroy();
    }
    this.aiCommentBanners.clear();

    for (const renderer of this.aiCommentRenderers.values()) {
      renderer.destroy();
    }
    this.aiCommentRenderers.clear();

    // Cleanup video transcript players
    for (const player of this.videoTranscriptPlayers.values()) {
      player.destroy();
    }
    this.videoTranscriptPlayers.clear();

    this.cachedCliDetection = null;
    this.subscriptionsCache.clear();
    this.badgeUpdateCallbacks.clear();
  }
}
