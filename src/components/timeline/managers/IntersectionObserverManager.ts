/**
 * IntersectionObserverManager - Manages lazy loading AND DOM recycling of timeline post cards
 *
 * Implements Obsidian's Deferred Views pattern at the post-card level:
 * - Observes viewport intersection for skeleton cards (lazy loading)
 * - Recycles off-screen real cards back to lightweight placeholders (DOM recycling)
 * - Keeps DOM node count bounded regardless of list length
 *
 * Two observers work together:
 * 1. **Render observer** (tighter margin): skeleton/placeholder → real card
 * 2. **Recycle observer** (wider margin): real card far from viewport → placeholder
 *
 * Performance optimizations:
 * - Single IntersectionObserver per concern (efficient)
 * - WeakMap for element references (memory safe)
 * - Debounced callbacks (prevents rapid re-renders)
 * - Mobile-optimized preload distance
 */

import { Platform } from 'obsidian';
import type { PostData } from '../../../types/post';
import type { PostIndexEntry } from '../../../services/PostIndexService';

/**
 * Configuration for IntersectionObserver behavior
 */
export interface ObserverConfig {
  /** Distance from viewport to start preloading (e.g., '200px') */
  rootMargin: string;
  /** Percentage of element visibility to trigger callback (0.0 - 1.0) */
  threshold: number;
}

/**
 * Callback function triggered when element intersects viewport
 * Returns Promise to support async rendering
 */
export type ObserverCallback = (
  element: HTMLElement,
  post: PostData
) => void | Promise<void>;

/**
 * Callback for re-rendering recycled cards (accepts PostData or PostIndexEntry)
 */
export type RecycleRenderCallback = (
  element: HTMLElement,
  post: PostData | PostIndexEntry
) => void | Promise<void>;

/**
 * Metadata tracked for each observed element
 */
interface ObservedElement {
  post: PostData;
  callback: ObserverCallback;
  debounceTimer?: number;
}

/**
 * Metadata for a recycled placeholder
 */
interface RecycledPlaceholder {
  /** PostData or index entry for re-rendering */
  post: PostData | PostIndexEntry;
  /** Preserved height of the original card */
  height: number;
  /** Whether this placeholder has already been scheduled for re-render */
  renderPending: boolean;
}

/**
 * Default configuration optimized for timeline post cards
 */
const DEFAULT_CONFIG: ObserverConfig = {
  rootMargin: Platform.isMobile ? '300px' : '200px', // Mobile needs more preload
  threshold: 0.01 // Trigger at 1% visibility
};

/**
 * Recycle margin: how far off-screen a card must be before recycling.
 * Must be larger than render margin to avoid flicker.
 */
const RECYCLE_ROOT_MARGIN = Platform.isMobile ? '800px' : '600px';

/**
 * Debounce delay for intersection callbacks (ms)
 * Prevents rapid re-renders during fast scrolling
 */
const DEBOUNCE_DELAY = 100;

/**
 * Manages IntersectionObserver lifecycle for lazy-loading and DOM recycling.
 */
export class IntersectionObserverManager {
  private observer: IntersectionObserver | null = null;
  private recycleObserver: IntersectionObserver | null = null;
  private observedElements: WeakMap<HTMLElement, ObservedElement>;
  private config: ObserverConfig;
  private isDestroyed = false;

  /** Enable/disable DOM recycling at runtime */
  private recyclingEnabled = false;

  /** Callback used to re-render cards that were recycled */
  private recycleRenderCallback: RecycleRenderCallback | null = null;

  /** Track recycled placeholders for re-render on scroll-back */
  private recycledPlaceholders: WeakMap<HTMLElement, RecycledPlaceholder> = new WeakMap();

  /** Track rendered real cards for recycling */
  private renderedCards: WeakMap<HTMLElement, PostData | PostIndexEntry> = new WeakMap();

  constructor(config?: Partial<ObserverConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.observedElements = new WeakMap();
    this.initializeObserver();
  }

  /**
   * Enable DOM recycling. Call after setting the re-render callback.
   * @param renderCallback Called when a recycled placeholder scrolls back into view
   */
  enableRecycling(renderCallback: RecycleRenderCallback): void {
    this.recyclingEnabled = true;
    this.recycleRenderCallback = renderCallback;
    this.initializeRecycleObserver();
  }

  /**
   * Initialize single IntersectionObserver instance for lazy loading
   */
  private initializeObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => this.handleIntersection(entries),
      {
        root: null,
        rootMargin: this.config.rootMargin,
        threshold: this.config.threshold
      }
    );
  }

  /**
   * Initialize recycling observer with wider margin.
   * Fires when real cards scroll far enough away from viewport.
   */
  private initializeRecycleObserver(): void {
    if (this.recycleObserver) {
      this.recycleObserver.disconnect();
    }

    this.recycleObserver = new IntersectionObserver(
      (entries) => this.handleRecycleIntersection(entries),
      {
        root: null,
        rootMargin: RECYCLE_ROOT_MARGIN,
        threshold: 0
      }
    );
  }

  /**
   * Handle intersection events (lazy loading)
   */
  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    if (this.isDestroyed) return;

    for (const entry of entries) {
      if (!entry.isIntersecting) continue;

      const element = entry.target as HTMLElement;

      // Check if this is a recycled placeholder being scrolled back into view
      const recycled = this.recycledPlaceholders.get(element);
      if (recycled && !recycled.renderPending && this.recycleRenderCallback) {
        recycled.renderPending = true;
        // Re-render the recycled card
        void this.reRenderRecycledCard(element, recycled);
        continue;
      }

      const metadata = this.observedElements.get(element);
      if (!metadata) continue;

      // Clear any existing debounce timer
      if (metadata.debounceTimer) {
        window.clearTimeout(metadata.debounceTimer);
      }

      // Debounce callback to prevent rapid re-renders
      metadata.debounceTimer = window.setTimeout(() => {
        this.triggerCallback(element, metadata);
      }, DEBOUNCE_DELAY);
    }
  }

  /**
   * Handle recycle intersection events.
   * When a REAL card exits the recycle margin, replace it with a height-preserving placeholder.
   */
  private handleRecycleIntersection(entries: IntersectionObserverEntry[]): void {
    if (this.isDestroyed || !this.recyclingEnabled) return;

    for (const entry of entries) {
      // We only recycle when the card is NOT intersecting (scrolled far away)
      if (entry.isIntersecting) continue;

      const element = entry.target as HTMLElement;
      const postRef = this.renderedCards.get(element);
      if (!postRef) continue;

      // Don't recycle series cards (data-series-card attribute)
      if (element.hasAttribute('data-series-card')) continue;

      // Replace real card with height-preserving placeholder
      this.recycleCard(element, postRef);
    }
  }

  /**
   * Replace a real card with a lightweight placeholder.
   */
  private recycleCard(realCard: HTMLElement, post: PostData | PostIndexEntry): void {
    if (!realCard.parentElement || !realCard.isConnected) return;

    const height = realCard.offsetHeight;
    if (height === 0) return; // Don't recycle cards with no height

    // Stop observing the real card in recycle observer
    this.recycleObserver?.unobserve(realCard);
    this.renderedCards.delete(realCard);

    // Create placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'post-card-recycled-placeholder';
    placeholder.addClass('sa-dynamic-height', 'sa-dynamic-min-height');
    placeholder.setCssProps({ '--sa-height': `${height}px`, '--sa-min-height': `${height}px` });
    // Copy identifying attributes for incremental DOM updates
    const postId = realCard.getAttribute('data-post-id');
    if (postId) placeholder.setAttribute('data-post-id', postId);
    const platform = realCard.getAttribute('data-platform');
    if (platform) placeholder.setAttribute('data-platform', platform);
    const filePath = realCard.getAttribute('data-file-path');
    if (filePath) placeholder.setAttribute('data-file-path', filePath);

    // Track as recycled placeholder
    this.recycledPlaceholders.set(placeholder, {
      post,
      height,
      renderPending: false,
    });

    // Replace in DOM
    realCard.parentElement.replaceChild(placeholder, realCard);

    // Observe placeholder with the render observer (so it re-renders on scroll back)
    this.observer?.observe(placeholder);
  }

  /**
   * Re-render a recycled placeholder back into a real card.
   */
  private async reRenderRecycledCard(
    placeholder: HTMLElement,
    recycled: RecycledPlaceholder
  ): Promise<void> {
    if (!placeholder.isConnected || !this.recycleRenderCallback) return;

    try {
      // Stop observing placeholder
      this.observer?.unobserve(placeholder);
      this.recycledPlaceholders.delete(placeholder);

      // Call the render callback (this replaces the placeholder in the DOM)
      await this.recycleRenderCallback(placeholder, recycled.post);
    } catch (error) {
      console.error('[IntersectionObserverManager] Re-render recycled card failed:', error);
      // Keep placeholder on error
      recycled.renderPending = false;
    }
  }

  /**
   * Trigger rendering callback for intersected element
   * Auto-unobserves after successful render
   */
  private async triggerCallback(
    element: HTMLElement,
    metadata: ObservedElement
  ): Promise<void> {
    // Safety check: element might have been removed during debounce
    if (!element.isConnected) {
      this.unobserve(element);
      return;
    }

    try {
      // Execute callback (can be sync or async)
      await metadata.callback(element, metadata.post);

      // Auto-unobserve from render observer after successful render
      this.unobserve(element);
    } catch (error) {
      console.error('[IntersectionObserverManager] Callback failed:', error);
      // Keep observing on error so user can retry by scrolling away and back
    }
  }

  /**
   * Start observing an element for lazy loading.
   * When element enters viewport, callback is triggered once.
   */
  public observe(
    element: HTMLElement,
    post: PostData,
    callback: ObserverCallback
  ): void {
    if (this.isDestroyed) {
      console.warn('[IntersectionObserverManager] Cannot observe: manager destroyed');
      return;
    }

    if (!this.observer) {
      console.error('[IntersectionObserverManager] Observer not initialized');
      return;
    }

    // Store metadata for this element
    this.observedElements.set(element, {
      post,
      callback
    });

    // Start observing
    this.observer.observe(element);
  }

  /**
   * Register a rendered real card for DOM recycling.
   * The recycle observer will monitor it and replace it with a placeholder
   * when it scrolls far enough off-screen.
   *
   * @param element - The fully rendered card element
   * @param post - PostData or PostIndexEntry associated with the card
   */
  public trackRenderedCard(
    element: HTMLElement,
    post: PostData | PostIndexEntry
  ): void {
    if (!this.recyclingEnabled || !this.recycleObserver) return;

    // Don't track series cards
    if (element.hasAttribute('data-series-card')) return;

    this.renderedCards.set(element, post);
    this.recycleObserver.observe(element);
  }

  /**
   * Stop observing a specific element
   */
  public unobserve(element: HTMLElement): void {
    if (!this.observer) return;

    // Clear any pending debounce timer
    const metadata = this.observedElements.get(element);
    if (metadata?.debounceTimer) {
      window.clearTimeout(metadata.debounceTimer);
    }

    // Stop observing
    this.observer.unobserve(element);
    this.observedElements.delete(element);
  }

  /**
   * Stop observing all elements (both render and recycle observers)
   */
  public unobserveAll(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.recycleObserver) {
      this.recycleObserver.disconnect();
    }
    // WeakMap entries will be garbage collected automatically
  }

  /**
   * Clean up observers and all references
   */
  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.recycleObserver) {
      this.recycleObserver.disconnect();
      this.recycleObserver = null;
    }

    this.recycleRenderCallback = null;
  }

  /**
   * Check if manager has been destroyed
   */
  public get destroyed(): boolean {
    return this.isDestroyed;
  }

  /**
   * Get current configuration
   */
  public getConfig(): Readonly<ObserverConfig> {
    return { ...this.config };
  }
}
