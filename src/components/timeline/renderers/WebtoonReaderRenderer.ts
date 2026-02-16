/**
 * WebtoonReaderRenderer - Renders webtoon episodes in continuous vertical scroll format
 *
 * Features:
 * - Continuous vertical scroll (no gallery/carousel)
 * - Lazy loading for images (IntersectionObserver)
 * - Separates cover image from content images
 * - Optimized for mobile reading experience
 * - Touch-friendly navigation
 */

import type { Media, PostData } from '../../../types/post';

export interface WebtoonReaderOptions {
  /** Maximum height for the reader container (default: 600px) */
  maxHeight?: number;
  /** Number of images to preload ahead (default: 3) */
  preloadAhead?: number;
  /** Show episode header info (default: true) */
  showHeader?: boolean;
  /** Get resource path from vault path */
  getResourcePath: (path: string) => string;
  /** Whether there's a next episode available */
  hasNextEpisode?: boolean;
  /** Callback when user wants to go to next episode */
  onNextEpisode?: () => void;
  /** Callback when user wants to check for new episodes */
  onCheckNewEpisodes?: () => void;
  /** Callback when scroll reaches end (95%+) - for auto-marking as read */
  onScrollComplete?: () => void;

  // Streaming mode options
  /** Enable streaming mode (load images via proxy instead of local files) */
  streamingMode?: boolean;
  /** Remote image URLs for streaming mode (original CDN URLs) */
  remoteImageUrls?: string[];
  /** Workers API endpoint for media proxy (default: production API) */
  workersEndpoint?: string;

  // Prefetching options
  /** Callback when scroll reaches prefetch threshold (90%) - for preloading next episode */
  onPrefetchThreshold?: () => void;
}

/**
 * WebtoonReaderRenderer - Renders webtoon content in vertical scroll format
 */
// Default Workers API endpoint for media proxy
const DEFAULT_WORKERS_ENDPOINT = 'https://social-archiver-api.social-archive.org';

export class WebtoonReaderRenderer {
  private options: Required<WebtoonReaderOptions>;
  private loadedImages: Set<string> = new Set();
  private observer: IntersectionObserver | null = null;
  private prefetchTriggered = false;

  constructor(options: WebtoonReaderOptions) {
    this.options = {
      maxHeight: options.maxHeight ?? 600,
      preloadAhead: options.preloadAhead ?? 3,
      showHeader: options.showHeader ?? true,
      getResourcePath: options.getResourcePath,
      hasNextEpisode: options.hasNextEpisode ?? false,
      onNextEpisode: options.onNextEpisode ?? (() => {}),
      onCheckNewEpisodes: options.onCheckNewEpisodes ?? (() => {}),
      onScrollComplete: options.onScrollComplete ?? (() => {}),
      // Streaming mode options
      streamingMode: options.streamingMode ?? false,
      remoteImageUrls: options.remoteImageUrls ?? [],
      workersEndpoint: options.workersEndpoint ?? DEFAULT_WORKERS_ENDPOINT,
      // Prefetch options
      onPrefetchThreshold: options.onPrefetchThreshold ?? (() => {})
    };
  }

  /**
   * Extract cover image (first image) from media array
   */
  public getCoverImage(media: Media[]): Media | null {
    if (media.length === 0) return null;
    // First image is typically the episode cover/thumbnail
    return media[0] ?? null;
  }

  /**
   * Extract content images (all except first) from media array
   */
  public getContentImages(media: Media[]): Media[] {
    if (media.length <= 1) return [];
    return media.slice(1);
  }

  /**
   * Render webtoon reader with continuous vertical scroll
   */
  public render(container: HTMLElement, post: PostData): HTMLElement {
    const wrapper = container.createDiv({ cls: 'webtoon-reader-wrapper' });

    // Episode header (optional - can be hidden in series view)
    if (this.options.showHeader) {
      this.renderHeader(wrapper, post);
    }

    // Scrollable content area
    const scrollContainer = wrapper.createDiv({ cls: 'webtoon-scroll-container' });
    scrollContainer.style.cssText = `
      max-height: ${this.options.maxHeight}px;
      overflow-y: auto;
      overflow-x: hidden;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
    `;

    // Image container
    const imageContainer = scrollContainer.createDiv({ cls: 'webtoon-image-container' });
    imageContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
      background: var(--background-primary);
      width: 100%;
    `;

    // Setup lazy loading observer
    this.setupLazyLoading(imageContainer, post.media);

    // Render all images (lazy loaded)
    this.renderImages(imageContainer, post.media);

    // Progress indicator at bottom
    this.renderProgressIndicator(wrapper, scrollContainer, post.media.length);

    return wrapper;
  }

  /**
   * Render just the content images (for embedding in series card)
   * Excludes header and uses provided container directly
   */
  public renderContentOnly(
    container: HTMLElement,
    media: Media[],
    maxHeight?: number
  ): HTMLElement {
    const height = maxHeight ?? this.options.maxHeight;

    // Scrollable content area
    const scrollContainer = container.createDiv({ cls: 'webtoon-scroll-container' });
    scrollContainer.style.cssText = `
      max-height: ${height}px;
      overflow-y: auto;
      overflow-x: hidden;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      scrollbar-color: var(--background-modifier-border) transparent;
    `;

    // Image container
    const imageContainer = scrollContainer.createDiv({ cls: 'webtoon-image-container' });
    imageContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
      background: var(--background-primary);
      width: 100%;
    `;

    // Get content images only (skip cover for local mode, but not for streaming)
    // In streaming mode, remoteImageUrls already contains only content images (no cover)
    const contentImages = this.options.streamingMode ? media : this.getContentImages(media);

    // Setup lazy loading observer
    this.setupLazyLoading(imageContainer, contentImages);

    // Render content images
    this.renderImages(imageContainer, contentImages);

    // Progress indicator
    if (contentImages.length > 0) {
      this.renderProgressIndicator(container, scrollContainer, contentImages.length);
    }

    return scrollContainer;
  }

  /**
   * Render episode header with metadata
   */
  private renderHeader(container: HTMLElement, post: PostData): void {
    const header = container.createDiv({ cls: 'webtoon-episode-header' });
    header.style.cssText = `
      padding: 12px 16px;
      background: var(--background-secondary);
      border-bottom: 1px solid var(--background-modifier-border);
    `;

    // Title
    const title = header.createDiv({ cls: 'webtoon-episode-title' });
    title.style.cssText = `
      font-size: 14px;
      font-weight: 600;
      color: var(--text-normal);
      margin-bottom: 4px;
      line-height: 1.3;
    `;
    title.textContent = post.title || '';

    // Metadata row (genre, age rating, etc.)
    const metadata = post.series;
    if (metadata) {
      const metaRow = header.createDiv({ cls: 'webtoon-episode-meta' });
      metaRow.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 11px;
      `;

      // Genre badges
      if (metadata.genre && metadata.genre.length > 0) {
        for (const genre of metadata.genre.slice(0, 3)) {
          const badge = metaRow.createSpan({ cls: 'webtoon-genre-badge' });
          badge.style.cssText = `
            padding: 2px 6px;
            background: var(--background-modifier-hover);
            border-radius: 4px;
            color: var(--text-muted);
          `;
          badge.textContent = genre;
        }
      }

      // Age rating
      if (metadata.ageRating) {
        const ageBadge = metaRow.createSpan({ cls: 'webtoon-age-badge' });
        ageBadge.style.cssText = `
          padding: 2px 6px;
          background: var(--background-modifier-error-hover);
          border-radius: 4px;
          color: var(--text-muted);
        `;
        ageBadge.textContent = metadata.ageRating;
      }

      // Publish day
      if (metadata.publishDay) {
        const dayBadge = metaRow.createSpan({ cls: 'webtoon-day-badge' });
        dayBadge.style.cssText = `
          padding: 2px 6px;
          background: var(--background-modifier-hover);
          border-radius: 4px;
          color: var(--text-muted);
        `;
        dayBadge.textContent = metadata.publishDay;
        if (metadata.finished) {
          dayBadge.textContent += ' (Complete)';
        }
      }
    }
  }

  /**
   * Setup IntersectionObserver for lazy loading
   */
  private setupLazyLoading(container: HTMLElement, media: Media[]): void {
    // Cleanup previous observer
    if (this.observer) {
      this.observer.disconnect();
    }

    this.loadedImages.clear();

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const img = entry.target as HTMLImageElement;
            const src = img.dataset.src;

            if (src && !this.loadedImages.has(src)) {
              // Load this image
              img.src = src;
              this.loadedImages.add(src);

              // Preload ahead
              const index = parseInt(img.dataset.index || '0', 10);
              this.preloadImages(container, media, index);

              // Stop observing loaded image
              this.observer?.unobserve(img);
            }
          }
        }
      },
      {
        // Use null (viewport) as root - works reliably in fullscreen mode
        // where DOM structure changes when card moves to document.body
        root: null,
        rootMargin: '500px 0px', // Preload when 500px away for smoother scrolling
        threshold: 0.01
      }
    );
  }

  /**
   * Preload images ahead of current position
   */
  private preloadImages(container: HTMLElement, media: Media[], currentIndex: number): void {
    const images = container.querySelectorAll('img[data-src]');

    for (let i = currentIndex + 1; i <= currentIndex + this.options.preloadAhead && i < media.length; i++) {
      const img = images[i] as HTMLImageElement | undefined;
      if (img && img.dataset.src && !this.loadedImages.has(img.dataset.src)) {
        img.src = img.dataset.src;
        this.loadedImages.add(img.dataset.src);
      }
    }
  }

  /**
   * Get image source URL based on mode (streaming vs local)
   * @param index - Image index in the media array
   * @param localPath - Local vault file path
   * @returns Image source URL
   */
  private getImageSource(index: number, localPath: string): string {
    if (this.options.streamingMode && this.options.remoteImageUrls?.[index]) {
      // Streaming mode: use Workers proxy for CORS bypass
      const remoteUrl = this.options.remoteImageUrls[index];
      return `${this.options.workersEndpoint}/api/proxy-media?url=${encodeURIComponent(remoteUrl)}`;
    }
    // Local mode: use vault file path
    return this.options.getResourcePath(localPath);
  }

  /**
   * Get fallback image source for error recovery
   * @param index - Image index
   * @param localPath - Local vault file path
   * @returns Fallback URL or null if no fallback available
   */
  private getFallbackSource(index: number, localPath: string): string | null {
    if (this.options.streamingMode) {
      // Streaming failed, try local file as fallback
      return this.options.getResourcePath(localPath);
    }
    // Local mode has no fallback
    return null;
  }

  /**
   * Render images with lazy loading
   */
  private renderImages(container: HTMLElement, media: Media[]): void {
    for (let i = 0; i < media.length; i++) {
      const mediaItem = media[i];
      if (!mediaItem || mediaItem.type !== 'image') continue;

      const localPath = mediaItem.url;
      const imgSrc = this.getImageSource(i, localPath);

      const imgWrapper = container.createDiv({ cls: 'webtoon-image-wrapper' });
      imgWrapper.style.cssText = `
        width: 100%;
        display: flex;
        justify-content: center;
        background: var(--background-primary);
        min-height: 100px;
        contain: layout paint;
        margin: 0;
        padding: 0;
        line-height: 0;
        font-size: 0;
      `;

      const img = imgWrapper.createEl('img', {
        attr: {
          'data-src': imgSrc,
          'data-index': String(i),
          'data-local-path': localPath, // Store local path for fallback
          alt: mediaItem.altText || `Page ${i + 1}`,
          loading: 'lazy'
        }
      });

      img.style.cssText = `
        width: 100%;
        max-width: 800px;
        height: auto;
        display: block;
        object-fit: contain;
        margin: 0;
        padding: 0;
        border: none;
      `;

      // Load first few images immediately
      if (i < 3) {
        img.src = imgSrc;
        this.loadedImages.add(imgSrc);
      } else {
        // Placeholder while loading
        img.style.minHeight = '200px';
        img.style.background = 'var(--background-secondary)';

        // Observe for lazy loading
        this.observer?.observe(img);
      }

      // Handle load event
      img.addEventListener('load', () => {
        img.style.minHeight = '';
        img.style.background = '';
      });

      // Handle error with fallback support
      img.addEventListener('error', () => {
        const imgIndex = parseInt(img.dataset.index || '0', 10);
        const imgLocalPath = img.dataset.localPath;

        // Try fallback if available and not already tried
        if (imgLocalPath && !img.dataset.fallbackTried) {
          const fallbackSrc = this.getFallbackSource(imgIndex, imgLocalPath);
          if (fallbackSrc && fallbackSrc !== img.src) {
            img.dataset.fallbackTried = 'true';
            img.src = fallbackSrc;
            return;
          }
        }

        // No fallback available or fallback also failed
        imgWrapper.style.display = 'none';
      });
    }
  }

  /**
   * Render scroll progress indicator
   */
  private renderProgressIndicator(
    container: HTMLElement,
    scrollContainer: HTMLElement,
    totalImages: number
  ): void {
    const progressBar = container.createDiv({ cls: 'webtoon-progress-bar' });
    progressBar.style.cssText = `
      height: 3px;
      background: var(--background-modifier-border);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 8px;
    `;

    const progressFill = progressBar.createDiv({ cls: 'webtoon-progress-fill' });
    progressFill.style.cssText = `
      height: 100%;
      width: 0%;
      background: var(--interactive-accent);
      border-radius: 2px;
      transition: width 0.1s ease;
    `;

    // Create next episode floating button inside scroll container (hidden by default)
    const nextButton = this.createNextEpisodeButton(scrollContainer);

    // Track if button is visible to avoid repeated DOM operations
    let isButtonVisible = false;
    // Track if scroll complete callback has been triggered (only once per session)
    let hasTriggeredScrollComplete = false;

    // Update progress on scroll (throttled with rAF to avoid layout thrashing)
    let scrollRafPending = false;
    scrollContainer.addEventListener('scroll', () => {
      if (scrollRafPending) return;
      scrollRafPending = true;
      requestAnimationFrame(() => {
        scrollRafPending = false;
        const scrollTop = scrollContainer.scrollTop;
        const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
        const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        progressFill.style.width = `${Math.min(100, progress)}%`;

        // Show/hide next episode button at 95% scroll
        const shouldShow = progress >= 95;
        if (shouldShow !== isButtonVisible) {
          isButtonVisible = shouldShow;
          nextButton.style.opacity = shouldShow ? '1' : '0';
          nextButton.style.pointerEvents = shouldShow ? 'auto' : 'none';
          nextButton.style.transform = shouldShow ? 'translateY(0)' : 'translateY(20px)';
        }

        // Trigger prefetch at 90% (once per episode view)
        // This allows background download of next episode for instant transition
        if (progress >= 90 && !this.prefetchTriggered) {
          this.prefetchTriggered = true;
          this.options.onPrefetchThreshold();
        }

        // Trigger scroll complete at 98%+ (once per episode view)
        if (progress >= 98 && !hasTriggeredScrollComplete) {
          hasTriggeredScrollComplete = true;
          this.options.onScrollComplete();
        }
      });
    }, { passive: true });
  }

  /**
   * Create floating "Next Episode" button
   */
  private createNextEpisodeButton(scrollContainer: HTMLElement): HTMLElement {
    const { hasNextEpisode, onNextEpisode, onCheckNewEpisodes } = this.options;

    // Make scroll container the positioning context
    scrollContainer.style.position = 'relative';

    const button = scrollContainer.createDiv({ cls: 'webtoon-next-episode-btn' });
    button.style.cssText = `
      position: sticky;
      bottom: 12px;
      float: right;
      margin-right: 12px;
      margin-top: -44px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: var(--interactive-accent);
      color: var(--text-on-accent);
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      opacity: 0;
      pointer-events: none;
      transform: translateY(20px);
      transition: opacity 0.3s ease, transform 0.3s ease, background 0.2s ease;
      z-index: 10;
    `;

    // Icon + Text
    const icon = button.createSpan();
    icon.style.cssText = 'display: flex; align-items: center;';
    icon.innerHTML = hasNextEpisode
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;

    const text = button.createSpan();
    text.textContent = hasNextEpisode ? 'Next Episode' : 'Check for Updates';

    // Hover effect
    button.addEventListener('mouseenter', () => {
      button.style.background = 'var(--interactive-accent-hover)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'var(--interactive-accent)';
    });

    // Click handler
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hasNextEpisode && onNextEpisode) {
        onNextEpisode();
      } else if (onCheckNewEpisodes) {
        onCheckNewEpisodes();
      }
    });

    return button;
  }

  /**
   * Reset prefetch state (call when switching episodes)
   */
  public resetPrefetchState(): void {
    this.prefetchTriggered = false;
  }

  /**
   * Cleanup observer
   */
  public destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.loadedImages.clear();
    this.prefetchTriggered = false;
  }
}
