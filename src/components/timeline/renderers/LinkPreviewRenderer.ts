import { setIcon, Platform } from 'obsidian';
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
    urls: (string | { url: string; [key: string]: any })[],
    onDelete?: (url: string) => Promise<void>
  ): Promise<void> {
    if (!urls || urls.length === 0) return;

    // Create container for previews
    const previewsContainer = container.createDiv({
      cls: 'link-previews-container'
    });
    previewsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-top: 12px;';

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
    wrapper.style.cssText = 'position: relative;';

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

    card.style.cssText = `
      display: flex;
      flex-direction: row;
      align-items: center;
      text-decoration: none;
      color: inherit;
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.2s ease;
      background: var(--background-primary);
      padding: 12px;
      min-height: 60px;
      position: relative;
    `;

    // Loading spinner
    const spinner = card.createDiv({ cls: 'link-preview-loading' });
    spinner.style.cssText = `
      width: 20px;
      height: 20px;
      border: 2px solid var(--background-modifier-border);
      border-top-color: var(--interactive-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 12px;
    `;

    // Loading text
    const loadingText = card.createSpan({ text: 'Loading preview...' });
    loadingText.style.cssText = 'font-size: 0.875rem; color: var(--text-muted);';

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
    deleteIcon.style.cssText = `
      position: absolute;
      top: 6px;
      right: 6px;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s, color 0.15s;
      background: transparent;
      border-radius: 3px;
      z-index: 10;
      color: var(--text-faint);
    `;
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
      deleteIcon.style.opacity = '0.6';
    });
    wrapper.addEventListener('mouseleave', () => {
      deleteIcon.style.opacity = '0';
    });

    // Subtle hover effect on icon itself
    deleteIcon.addEventListener('mouseenter', () => {
      deleteIcon.style.opacity = '1';
      deleteIcon.style.color = 'var(--text-muted)';
    });
    deleteIcon.addEventListener('mouseleave', () => {
      deleteIcon.style.opacity = '0.6';
      deleteIcon.style.color = 'var(--text-faint)';
    });

    // Delete action
    deleteIcon.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Fade out animation
      wrapper.style.opacity = '0';
      wrapper.style.transition = 'opacity 0.2s';

      // Wait for animation
      setTimeout(async () => {
        await onDelete(url);
        wrapper.remove();
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

    card.style.cssText = `
      display: flex;
      flex-direction: row;
      align-items: center;
      text-decoration: none;
      color: inherit;
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.2s ease;
      background: var(--background-primary);
      padding: 12px;
      min-height: 60px;
      position: relative;
    `;

    // Loading spinner
    const spinner = card.createDiv({ cls: 'link-preview-loading' });
    spinner.style.cssText = `
      width: 20px;
      height: 20px;
      border: 2px solid var(--background-modifier-border);
      border-top-color: var(--interactive-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 12px;
    `;

    // Loading text
    const loadingText = card.createSpan({ text: 'Loading preview...' });
    loadingText.style.cssText = 'font-size: 0.875rem; color: var(--text-muted);';

    return card;
  }

  /**
   * Update placeholder card with error state
   * @deprecated - Currently unused but kept for future error handling
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _updateCardWithError(card: HTMLElement, preview: LinkPreview, _onRetry: () => void): void {
    if (!preview.error) return;

    // Clear placeholder content
    card.empty();

    // Reset styles for error card
    card.style.cssText = `
      display: flex;
      flex-direction: row;
      align-items: center;
      text-decoration: none;
      color: inherit;
      border: 1px solid var(--background-modifier-error);
      border-radius: 8px;
      overflow: hidden;
      background: var(--background-primary);
      padding: 12px;
      min-height: 60px;
      position: relative;
      cursor: default;
    `;

    // Error icon
    const iconContainer = card.createDiv();
    iconContainer.style.cssText = 'width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 12px; color: var(--text-error);';

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
    content.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 4px;';

    // Error title
    const title = content.createEl('div');
    title.style.cssText = 'font-size: 0.875rem; font-weight: 600; color: var(--text-error);';
    title.setText(preview.error.message);

    // URL
    const urlText = content.createDiv();
    urlText.style.cssText = 'font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    urlText.setText(preview.url);

    // Retry button (if retryable)
    if (preview.error.retryable) {
      const retryBtn = card.createEl('button');
      retryBtn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        font-size: 0.75rem;
        color: var(--text-normal);
        background: var(--background-modifier-hover);
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        flex-shrink: 0;
        margin-left: 8px;
      `;

      const retryIcon = retryBtn.createDiv();
      retryIcon.style.cssText = 'width: 14px; height: 14px; display: flex; align-items: center; justify-content: center;';
      setIcon(retryIcon, 'refresh-cw');

      retryBtn.createSpan({ text: 'Retry' });

      retryBtn.addEventListener('mouseenter', () => {
        retryBtn.style.background = 'var(--interactive-accent)';
        retryBtn.style.color = 'var(--text-on-accent)';
        retryBtn.style.borderColor = 'var(--interactive-accent)';
      });

      retryBtn.addEventListener('mouseleave', () => {
        retryBtn.style.background = 'var(--background-modifier-hover)';
        retryBtn.style.color = 'var(--text-normal)';
        retryBtn.style.borderColor = 'var(--background-modifier-border)';
      });

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
    card.style.cssText = `
      display: flex;
      flex-direction: row;
      align-items: stretch;
      text-decoration: none;
      color: inherit;
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.2s ease;
      background: var(--background-primary);
      position: relative;
      cursor: pointer;
    `;

    // Update aria-label
    card.setAttribute('aria-label', `Link preview: ${preview.title}`);

    // Add hover effect
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'var(--interactive-accent)';
      card.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
      card.style.transform = 'translateY(-1px)';
    });

    card.addEventListener('mouseleave', () => {
      card.style.borderColor = 'var(--background-modifier-border)';
      card.style.boxShadow = 'none';
      card.style.transform = 'translateY(0)';
    });

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
    content.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 12px; min-height: 60px; justify-content: center;';

    // Meta (Favicon + Domain)
    const meta = content.createDiv();
    meta.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-muted);';

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
      favicon.style.cssText = 'width: 16px; height: 16px; object-fit: contain;';
      favicon.addEventListener('error', () => {
        favicon.style.display = 'none';
      });
    }

    // Domain
    const domain = this.extractDomain(preview.url);
    const domainSpan = meta.createSpan({ text: preview.siteName || domain });
    domainSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

    // Title
    const title = content.createEl('h3', { text: this.truncate(preview.title, 60) });
    title.style.cssText = `
      margin: 0;
      font-size: 0.8125rem;
      font-weight: 600;
      line-height: 1.3;
      color: var(--text-normal);
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
    `;

    // Description (if available, desktop only)
    if (preview.description && !Platform.isMobile) {
      const description = content.createDiv({
        text: this.truncate(preview.description, 100),
        cls: 'link-preview-description'
      });
      description.style.cssText = `
        margin: 0;
        font-size: 0.6875rem;
        line-height: 1.4;
        color: var(--text-muted);
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      `;
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
      const response = await fetch(`${this.workerUrl}/api/link-preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      const result = await response.json();

      if (!response.ok) {
        // API returned error - parse error details
        const errorPreview = this.createErrorPreview(url, response.status, result.error?.message || response.statusText);

        // Cache permanent errors (404, 403, 410), don't cache temporary errors (5xx, timeout)
        if (errorPreview.error && !errorPreview.error.retryable) {
          this.previewCache.set(url, errorPreview);
        }

        return errorPreview;
      }

      if (result.success && result.data) {
        const preview: LinkPreview = result.data;
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
    } catch (error) {
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
