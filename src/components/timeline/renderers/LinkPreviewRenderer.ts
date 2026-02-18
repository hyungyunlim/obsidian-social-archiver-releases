import { setIcon, Platform, requestUrl } from 'obsidian';
import type { LinkPreview, LinkPreviewError } from '../../../types/post';
import { isValidPreviewUrl } from '../../../utils/url';

/**
 * LinkPreviewRenderer - Renders link preview cards in timeline
 * Single Responsibility: Render link preview metadata as compact cards
 *
 * Fetches preview metadata from Worker API on-demand (lazy loading)
 * with built-in caching to minimize API calls
 */
export class LinkPreviewRenderer {
  private workerUrl: string;
  // In-memory cache for fetched previews (per session), bounded to prevent memory growth
  private static readonly MAX_CACHE_SIZE = 200;
  private previewCache: Map<string, LinkPreview | null> = new Map();
  // Track loading states to prevent duplicate requests
  private loadingUrls: Set<string> = new Set();

  constructor(workerUrl: string = 'https://social-archiver-api.social-archive.org') {
    // On mobile, always use production API (localhost doesn't work)
    if (Platform.isMobile && workerUrl.includes('localhost')) {
      this.workerUrl = 'https://social-archiver-api.social-archive.org';
    } else {
      this.workerUrl = workerUrl;
    }
  }

  /**
   * Render link preview in compact mode (minimal, no large image)
   * Lazy loads metadata from Worker API
   */
  public async renderCompact(container: HTMLElement, url: string): Promise<void> {
    // Create placeholder card
    const card = this.createPlaceholderCard(container, url);

    // Fetch preview metadata
    const preview = await this.fetchPreview(url);

    if (preview) {
      if (preview.error) {
        // Error occurred - remove the card to hide failed previews
        card.remove();
      } else {
        // Replace placeholder with actual preview
        this.updateCardWithPreview(card, preview);
      }
    } else {
      // Unexpected error - remove card
      card.remove();
    }
  }

  /**
   * Render multiple link previews
   * @param onDelete Optional callback when delete icon is clicked (url, postPath)
   */
  public async renderPreviews(
    container: HTMLElement,
    urls: (string | { url: string; [key: string]: unknown })[],
    onDelete?: (url: string) => Promise<void>
  ): Promise<void> {
    if (!urls || urls.length === 0) return;

    // Create container for previews
    const previewsContainer = container.createDiv({
      cls: 'link-previews-container'
    });
    previewsContainer.addClass('sa-flex-col');
    previewsContainer.addClass('sa-gap-12');
    previewsContainer.addClass('sa-mt-12');

    // Render all previews in parallel for better performance
    const promises = urls.map(urlItem => {
      const url = typeof urlItem === 'string' ? urlItem : urlItem.url;
      return this.renderCompactWithDelete(previewsContainer, url, onDelete);
    });
    await Promise.all(promises);
  }

  /**
   * Render compact preview with optional delete icon
   */
  private async renderCompactWithDelete(
    container: HTMLElement,
    url: string,
    onDelete?: (url: string) => Promise<void>
  ): Promise<void> {
    // Create wrapper for card + delete icon
    const wrapper = container.createDiv({ cls: 'link-preview-wrapper' });
    wrapper.addClass('sa-relative');

    // Create placeholder card
    const card = this.createPlaceholderCardInWrapper(wrapper, url);

    // Add delete icon if callback provided
    if (onDelete) {
      this.addDeleteIcon(wrapper, card, url, onDelete);
    }

    // Fetch preview metadata
    const preview = await this.fetchPreview(url);

    if (preview) {
      if (preview.error) {
        // Error occurred - remove the wrapper to hide failed previews
        wrapper.remove();
      } else {
        // Replace placeholder with actual preview
        this.updateCardWithPreview(card, preview);
      }
    } else {
      // Unexpected error - remove wrapper
      wrapper.remove();
    }
  }

  /**
   * Create placeholder card inside wrapper
   */
  private createPlaceholderCardInWrapper(wrapper: HTMLElement, url: string): HTMLElement {
    const card = wrapper.createEl('a', {
      attr: {
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': 'Link preview (loading...)'
      }
    });

    card.addClass('sa-flex-row');
    card.addClass('sa-border');
    card.addClass('sa-rounded-8');
    card.addClass('sa-overflow-hidden');
    card.addClass('sa-transition');
    card.addClass('sa-bg-primary');
    card.addClass('sa-p-12');
    card.addClass('sa-relative');
    card.addClass('lpr-card');

    // Loading spinner
    const spinner = card.createDiv({ cls: 'link-preview-loading' });
    spinner.addClass('sa-icon-20');
    spinner.addClass('sa-rounded-full');
    spinner.addClass('lpr-spinner');

    // Loading text
    const loadingText = card.createSpan({ text: 'Loading preview...' });
    loadingText.addClass('sa-text-sm');
    loadingText.addClass('sa-text-muted');

    return card;
  }

  /**
   * Add delete icon to preview card
   */
  private addDeleteIcon(
    wrapper: HTMLElement,
    _card: HTMLElement,
    url: string,
    onDelete: (url: string) => Promise<void>
  ): void {
    const deleteIcon = wrapper.createDiv({ cls: 'link-preview-delete' });
    deleteIcon.addClass('sa-absolute');
    deleteIcon.addClass('sa-icon-16');
    deleteIcon.addClass('sa-clickable');
    deleteIcon.addClass('sa-opacity-0');
    deleteIcon.addClass('sa-bg-transparent');
    deleteIcon.addClass('sa-rounded-4');
    deleteIcon.addClass('sa-z-10');
    deleteIcon.addClass('lpr-delete-icon');
    deleteIcon.setCssProps({ '--sa-color': 'var(--text-faint)' });
    deleteIcon.addClass('sa-dynamic-color');
    deleteIcon.setAttribute('aria-label', 'Remove link preview');
    deleteIcon.setAttribute('role', 'button');
    deleteIcon.setAttribute('tabindex', '0');

    // Use Obsidian's setIcon for 'x' icon
    setIcon(deleteIcon, 'x');

    // Adjust icon size
    const svg = deleteIcon.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
    }

    // Show on hover
    wrapper.addEventListener('mouseenter', () => {
      deleteIcon.setCssProps({ '--sa-opacity': '0.6' });
      deleteIcon.addClass('sa-dynamic-opacity');
    });
    wrapper.addEventListener('mouseleave', () => {
      deleteIcon.removeClass('sa-dynamic-opacity');
    });

    // Subtle hover effect on icon itself
    deleteIcon.addEventListener('mouseenter', () => {
      deleteIcon.setCssProps({ '--sa-opacity': '1', '--sa-color': 'var(--text-muted)' });
      deleteIcon.addClass('sa-dynamic-opacity');
    });
    deleteIcon.addEventListener('mouseleave', () => {
      deleteIcon.setCssProps({ '--sa-opacity': '0.6', '--sa-color': 'var(--text-faint)' });
    });

    // Delete action
    deleteIcon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Fade out animation
      wrapper.addClass('sa-transition-opacity');
      wrapper.setCssProps({ '--sa-opacity': '0' });
      wrapper.addClass('sa-dynamic-opacity');

      // Wait for animation
      setTimeout(() => {
        void onDelete(url).then(() => { wrapper.remove(); });
      }, 200);
    });

    // Keyboard support
    deleteIcon.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        deleteIcon.click();
      }
    });
  }

  /**
   * Create placeholder card while loading
   */
  private createPlaceholderCard(container: HTMLElement, url: string): HTMLElement {
    const card = container.createEl('a', {
      attr: {
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': 'Link preview (loading...)'
      }
    });

    card.addClass('sa-flex-row');
    card.addClass('sa-border');
    card.addClass('sa-rounded-8');
    card.addClass('sa-overflow-hidden');
    card.addClass('sa-transition');
    card.addClass('sa-bg-primary');
    card.addClass('sa-p-12');
    card.addClass('sa-relative');
    card.addClass('lpr-card');

    // Loading spinner
    const spinner = card.createDiv({ cls: 'link-preview-loading' });
    spinner.addClass('sa-icon-20');
    spinner.addClass('sa-rounded-full');
    spinner.addClass('lpr-spinner');

    // Loading text
    const loadingText = card.createSpan({ text: 'Loading preview...' });
    loadingText.addClass('sa-text-sm');
    loadingText.addClass('sa-text-muted');

    return card;
  }

  /**
   * Update placeholder card with error state
   * @deprecated - Currently unused but kept for future error handling
   */
  private _updateCardWithError(card: HTMLElement, preview: LinkPreview, _onRetry: () => void): void {
    if (!preview.error) return;

    // Clear placeholder content
    card.empty();

    // Reset styles for error card
    card.addClass('sa-flex-row');
    card.addClass('sa-rounded-8');
    card.addClass('sa-overflow-hidden');
    card.addClass('sa-bg-primary');
    card.addClass('sa-p-12');
    card.addClass('sa-relative');
    card.addClass('lpr-error-card');

    // Error icon
    const iconContainer = card.createDiv();
    iconContainer.addClass('sa-icon-32');
    iconContainer.addClass('sa-text-error');
    iconContainer.addClass('lpr-error-icon');

    // Choose icon based on error type
    let iconName: string;
    switch (preview.error.type) {
      case 'not_found':
        iconName = 'file-x';
        break;
      case 'forbidden':
        iconName = 'lock';
        break;
      case 'timeout':
        iconName = 'clock';
        break;
      case 'server_error':
        iconName = 'server-crash';
        break;
      case 'invalid_content':
        iconName = 'file-warning';
        break;
      default:
        iconName = 'alert-circle';
    }
    setIcon(iconContainer, iconName);

    // Content section
    const content = card.createDiv();
    content.addClass('sa-flex-1');
    content.addClass('sa-flex-col');
    content.addClass('sa-gap-4');

    // Error title
    const title = content.createEl('div');
    title.addClass('sa-text-sm');
    title.addClass('sa-font-semibold');
    title.addClass('sa-text-error');
    title.setText(preview.error.message);

    // URL
    const urlText = content.createDiv();
    urlText.addClass('sa-text-xs');
    urlText.addClass('sa-text-muted');
    urlText.addClass('sa-truncate');
    urlText.setText(preview.url);

    // Retry button (if retryable)
    if (preview.error.retryable) {
      const retryBtn = card.createEl('button');
      retryBtn.addClass('sa-flex-row');
      retryBtn.addClass('sa-gap-4');
      retryBtn.addClass('sa-px-12');
      retryBtn.addClass('sa-py-6');
      retryBtn.addClass('sa-text-xs');
      retryBtn.addClass('sa-text-normal');
      retryBtn.addClass('sa-bg-hover');
      retryBtn.addClass('sa-border');
      retryBtn.addClass('sa-rounded-4');
      retryBtn.addClass('sa-clickable');
      retryBtn.addClass('sa-transition');
      retryBtn.addClass('sa-flex-shrink-0');
      retryBtn.addClass('lpr-retry-btn');

      const retryIcon = retryBtn.createDiv();
      retryIcon.addClass('sa-icon-14');
      setIcon(retryIcon, 'refresh-cw');

      retryBtn.createSpan({ text: 'Retry' });

      retryBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _onRetry();
      });
    }
  }

  /**
   * Update placeholder card with actual preview data
   */
  private updateCardWithPreview(card: HTMLElement, preview: LinkPreview): void {
    // Clear placeholder content
    card.empty();

    // Reset styles for actual preview
    card.addClass('sa-flex');
    card.addClass('sa-border');
    card.addClass('sa-rounded-8');
    card.addClass('sa-overflow-hidden');
    card.addClass('sa-transition');
    card.addClass('sa-bg-primary');
    card.addClass('sa-relative');
    card.addClass('sa-clickable');
    card.addClass('lpr-card-loaded');

    // Update aria-label
    card.setAttribute('aria-label', `Link preview: ${preview.title}`);

    // Image section (responsive - hidden on mobile, visible on desktop)
    if (preview.image && !Platform.isMobile) {
      const imageContainer = card.createDiv({ cls: 'link-preview-image-container' });

      const img = imageContainer.createEl('img', {
        attr: {
          src: preview.image,
          alt: preview.title,
          loading: 'lazy'
        },
        cls: 'link-preview-image'
      });

      // Handle image load error - remove the entire container
      img.addEventListener('error', () => {
        imageContainer.remove();
      });
    }

    // Content section
    const content = card.createDiv();
    content.addClass('sa-flex-1');
    content.addClass('sa-flex-col');
    content.addClass('sa-gap-4');
    content.addClass('sa-p-12');
    content.addClass('lpr-content');

    // Meta (Favicon + Domain)
    const meta = content.createDiv();
    meta.addClass('sa-flex-row');
    meta.addClass('sa-gap-6');
    meta.addClass('sa-text-xs');
    meta.addClass('sa-text-muted');

    // Favicon
    if (preview.favicon) {
      const favicon = meta.createEl('img', {
        attr: {
          src: preview.favicon,
          alt: '',
          width: '16',
          height: '16'
        }
      });
      favicon.addClass('sa-icon-16');
      favicon.addClass('sa-object-contain');
      favicon.addEventListener('error', () => {
        favicon.addClass('sa-hidden');
      });
    }

    // Domain
    const domain = this.extractDomain(preview.url);
    const domainSpan = meta.createSpan({ text: preview.siteName || domain });
    domainSpan.addClass('sa-truncate');

    // Title
    const title = content.createEl('h3', { text: this.truncate(preview.title, 60) });
    title.addClass('sa-m-0');
    title.addClass('sa-text-base');
    title.addClass('sa-font-semibold');
    title.addClass('sa-leading-tight');
    title.addClass('sa-text-normal');
    title.addClass('sa-overflow-hidden');
    title.addClass('lpr-title');

    // Description (if available, desktop only)
    if (preview.description && !Platform.isMobile) {
      const description = content.createDiv({
        text: this.truncate(preview.description, 100),
        cls: 'link-preview-description'
      });
      description.addClass('sa-m-0');
      description.addClass('sa-text-xs');
      description.addClass('sa-text-muted');
      description.addClass('sa-overflow-hidden');
      description.addClass('lpr-description');
    }
  }

  /**
   * Fetch preview metadata from Worker API with caching
   */
  private async fetchPreview(url: string): Promise<LinkPreview | null> {
    // Validate URL before making API call (safety net for truncated URLs)
    if (!isValidPreviewUrl(url)) {
      console.warn('[LinkPreviewRenderer] Skipping invalid/truncated URL:', url);
      return this.createErrorPreview(url, 400, 'Invalid or truncated URL');
    }

    // Check cache first
    if (this.previewCache.has(url)) {
      const cached = this.previewCache.get(url);
      return cached || null;
    }

    // Check if already loading
    if (this.loadingUrls.has(url)) {
      return null;
    }

    // Mark as loading
    this.loadingUrls.add(url);

    try {
      const response = await requestUrl({
        url: `${this.workerUrl}/api/link-preview`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
        throw: false
      });

      const result = response.json as Record<string, unknown>;

      if (response.status !== 200) {
        // API returned error - parse error details
        const resultError = result['error'] as Record<string, unknown> | undefined;
        const errorMsg = typeof resultError?.['message'] === 'string' ? resultError['message'] : `Error ${response.status}`;
        const errorPreview = this.createErrorPreview(url, response.status, errorMsg);

        // Cache permanent errors (404, 403, 410), don't cache temporary errors (5xx, timeout)
        if (errorPreview.error && !errorPreview.error.retryable) {
          this.previewCache.set(url, errorPreview);
        }

        return errorPreview;
      }

      if (result['success'] && result['data']) {
        const preview: LinkPreview = result['data'] as LinkPreview;
        // Cache successful result (evict oldest if over limit)
        this.previewCache.set(url, preview);
        this.evictOldestIfNeeded();
        return preview;
      } else {
        // Create generic error
        const errorPreview = this.createErrorPreview(url, 0, 'Invalid response from server');
        return errorPreview;
      }
    } catch (error) {
      // Network error - retryable
      const errorPreview = this.createErrorPreview(url, 0, error instanceof Error ? error.message : 'Network error');
      return errorPreview;
    } finally {
      // Remove from loading set
      this.loadingUrls.delete(url);
    }
  }

  /**
   * Evict oldest cache entries when exceeding max size
   */
  private evictOldestIfNeeded(): void {
    if (this.previewCache.size <= LinkPreviewRenderer.MAX_CACHE_SIZE) return;
    const excess = this.previewCache.size - LinkPreviewRenderer.MAX_CACHE_SIZE;
    const iterator = this.previewCache.keys();
    for (let i = 0; i < excess; i++) {
      const key = iterator.next().value;
      if (key !== undefined) this.previewCache.delete(key);
    }
  }

  /**
   * Create error preview based on HTTP status code
   */
  private createErrorPreview(url: string, statusCode: number, message: string): LinkPreview {
    let errorType: LinkPreviewError['type'];
    let errorMessage: string;
    let retryable: boolean;

    switch (statusCode) {
      case 404:
        errorType = 'not_found';
        errorMessage = 'Page not found';
        retryable = false;
        break;
      case 403:
        errorType = 'forbidden';
        errorMessage = 'Access denied';
        retryable = false;
        break;
      case 408:
      case 504:
        errorType = 'timeout';
        errorMessage = 'Request timeout';
        retryable = true;
        break;
      case 500:
      case 502:
      case 503:
        errorType = 'server_error';
        errorMessage = 'Server error';
        retryable = true;
        break;
      default:
        if (message.toLowerCase().includes('timeout')) {
          errorType = 'timeout';
          errorMessage = 'Request timeout';
          retryable = true;
        } else if (message.toLowerCase().includes('invalid content')) {
          errorType = 'invalid_content';
          errorMessage = 'Invalid content type';
          retryable = false;
        } else {
          errorType = 'network_error';
          errorMessage = message || 'Network error';
          retryable = true;
        }
    }

    return {
      url,
      title: this.extractDomain(url),
      error: {
        type: errorType,
        message: errorMessage,
        retryable
      }
    };
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /**
   * Truncate text to maximum length
   */
  private truncate(text: string, maxLength: number): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  /**
   * Clear cache (useful for testing or memory management)
   */
  public clearCache(): void {
    this.previewCache.clear();
    this.loadingUrls.clear();
  }
}
