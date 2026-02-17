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
    scrollContainer.addClass('sa-overflow-y-auto', 'sa-overflow-x-hidden', 'sa-scroll-smooth');
    scrollContainer.setCssProps({ '--sa-max-height': `${this.options.maxHeight}px` });
    scrollContainer.addClass('sa-dynamic-max-height');
    scrollContainer.addClass('wrr-scroll-container');

    // Image container
    const imageContainer = scrollContainer.createDiv({ cls: 'webtoon-image-container' });
    imageContainer.addClass('sa-flex-col', 'sa-flex-center', 'sa-bg-primary', 'sa-w-full', 'wrr-image-container-gap-0');

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
    scrollContainer.addClass('sa-overflow-y-auto', 'sa-overflow-x-hidden', 'sa-scroll-smooth', 'sa-scrollbar-thin', 'wrr-scroll-container', 'wrr-scrollbar-color');
    scrollContainer.setCssProps({ '--sa-max-height': `${height}px` });
    scrollContainer.addClass('sa-dynamic-max-height');

    // Image container
    const imageContainer = scrollContainer.createDiv({ cls: 'webtoon-image-container' });
    imageContainer.addClass('sa-flex-col', 'sa-flex-center', 'sa-bg-primary', 'sa-w-full', 'wrr-image-container-gap-0');

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
    header.addClass('sa-p-12', 'sa-px-16', 'sa-bg-secondary', 'sa-border-b');

    // Title
    const title = header.createDiv({ cls: 'webtoon-episode-title' });
    title.addClass('sa-text-md', 'sa-font-semibold', 'sa-text-normal', 'sa-mb-4', 'sa-leading-tight');
    title.textContent = post.title || '';

    // Metadata row (genre, age rating, etc.)
    const metadata = post.series;
    if (metadata) {
      const metaRow = header.createDiv({ cls: 'webtoon-episode-meta' });
      metaRow.addClass('sa-flex', 'sa-flex-wrap', 'sa-gap-6', 'sa-text-xs');

      // Genre badges
      if (metadata.genre && metadata.genre.length > 0) {
        for (const genre of metadata.genre.slice(0, 3)) {
          const badge = metaRow.createSpan({ cls: 'webtoon-genre-badge' });
          badge.addClass('sa-px-6', 'sa-py-4', 'sa-bg-hover', 'sa-rounded-4', 'sa-text-muted');
          badge.textContent = genre;
        }
      }

      // Age rating
      if (metadata.ageRating) {
        const ageBadge = metaRow.createSpan({ cls: 'webtoon-age-badge' });
        ageBadge.addClass('sa-px-6', 'sa-py-4', 'sa-rounded-4', 'sa-text-muted', 'wrr-age-badge');
        ageBadge.textContent = metadata.ageRating;
      }

      // Publish day
      if (metadata.publishDay) {
        const dayBadge = metaRow.createSpan({ cls: 'webtoon-day-badge' });
        dayBadge.addClass('sa-px-6', 'sa-py-4', 'sa-bg-hover', 'sa-rounded-4', 'sa-text-muted');
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

      const imgWrapper = container.createDiv({ cls: 'webtoon-image-wrapper wrr-image-wrapper' });

      const img = imgWrapper.createEl('img', {
        attr: {
          'data-src': imgSrc,
          'data-index': String(i),
          'data-local-path': localPath, // Store local path for fallback
          alt: mediaItem.altText || `Page ${i + 1}`,
          loading: 'lazy'
        }
      });

      img.addClass('wrr-image');

      // Load first few images immediately
      if (i < 3) {
        img.src = imgSrc;
        this.loadedImages.add(imgSrc);
      } else {
        // Placeholder while loading
        img.addClass('wrr-image--placeholder');

        // Observe for lazy loading
        this.observer?.observe(img);
      }

      // Handle load event
      img.addEventListener('load', () => {
        img.removeClass('wrr-image--placeholder');
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
        imgWrapper.addClass('sa-hidden');
      });
    }
  }

  /**
   * Render scroll progress indicator
   */
  private renderProgressIndicator(
    container: HTMLElement,
    scrollContainer: HTMLElement,
    _totalImages: number
  ): void {
    const progressBar = container.createDiv({ cls: 'webtoon-progress-bar wrr-progress-bar' });

    const progressFill = progressBar.createDiv({ cls: 'webtoon-progress-fill wrr-progress-fill' });

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
        progressFill.setCssStyles({ width: `${Math.min(100, progress)}%` });

        // Show/hide next episode button at 95% scroll
        const shouldShow = progress >= 95;
        if (shouldShow !== isButtonVisible) {
          isButtonVisible = shouldShow;
          nextButton.setCssProps({
            '--sa-opacity': shouldShow ? '1' : '0',
            '--sa-transform': shouldShow ? 'translateY(0)' : 'translateY(20px)',
          });
          nextButton.addClass('sa-dynamic-opacity', 'sa-dynamic-transform');
          nextButton.setCssStyles({ pointerEvents: shouldShow ? 'auto' : 'none' });
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
    scrollContainer.addClass('sa-relative');

    const button = scrollContainer.createDiv({ cls: 'webtoon-next-episode-btn wrr-next-btn' });
    button.setCssProps({ '--sa-transform': 'translateY(20px)' });
    button.addClass('sa-dynamic-transform');

    // Icon + Text (safe SVG creation, no innerHTML)
    const icon = button.createSpan();
    icon.addClass('sa-inline-flex');
    if (hasNextEpisode) {
      // "Next episode" icon (skip forward)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2.5');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '5 4 15 12 5 20 5 4');
      svg.appendChild(polygon);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '19');
      line.setAttribute('y1', '5');
      line.setAttribute('x2', '19');
      line.setAttribute('y2', '19');
      svg.appendChild(line);
      icon.appendChild(svg);
    } else {
      // "Check for updates" icon (refresh)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2.5');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      const paths = [
        'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8',
        'M3 3v5h5',
        'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16',
        'M16 16h5v5',
      ];
      for (const d of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
      }
      icon.appendChild(svg);
    }

    const text = button.createSpan();
    text.textContent = hasNextEpisode ? 'Next Episode' : 'Check for Updates';

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
