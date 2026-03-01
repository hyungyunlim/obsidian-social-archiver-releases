/**
 * TTSScrollSync
 *
 * Synchronizes scroll position with TTS sentence highlighting.
 * Three states:
 *   idle      — TTS not active, no scroll tracking
 *   following — auto-scrolling to keep highlighted sentence visible
 *   detached  — user manually scrolled, "Follow along" button shown
 *
 * User scroll detection:
 *   - `isAutoScrolling` flag distinguishes programmatic vs user scrolls
 *   - User scroll -> transition to 'detached'
 *   - "Follow along" click -> transition back to 'following'
 */

// ============================================================================
// Types
// ============================================================================

export type ScrollSyncState = 'idle' | 'following' | 'detached';

export interface ScrollSyncCallbacks {
  /** Called when state changes, so UI can show/hide "Follow along" button. */
  onStateChange: (state: ScrollSyncState) => void;
}

// ============================================================================
// TTSScrollSync
// ============================================================================

export class TTSScrollSync {
  private scrollContainer: HTMLElement | null = null;
  private state: ScrollSyncState = 'idle';
  private isAutoScrolling = false;
  private autoScrollTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollHandler: (() => void) | null = null;
  private callbacks: ScrollSyncCallbacks;

  constructor(callbacks: ScrollSyncCallbacks) {
    this.callbacks = callbacks;
  }

  // ---------- Lifecycle -----------------------------------------------------

  /**
   * Attach to a scroll container and start tracking.
   */
  attach(scrollContainer: HTMLElement): void {
    this.detachListeners();
    this.scrollContainer = scrollContainer;

    this.scrollHandler = () => {
      if (this.isAutoScrolling) return; // Ignore our own scrolls
      if (this.state === 'following') {
        this.setState('detached');
      }
    };

    this.scrollContainer.addEventListener('scroll', this.scrollHandler, { passive: true });
  }

  /**
   * Start following mode (called when TTS playback begins).
   */
  startFollowing(): void {
    this.setState('following');
  }

  /**
   * Stop following mode (called when TTS stops).
   */
  stopFollowing(): void {
    this.setState('idle');
  }

  /**
   * Re-attach follow mode (called from "Follow along" button).
   */
  refollow(): void {
    this.setState('following');
  }

  /**
   * Scroll to an element if in 'following' mode.
   */
  scrollToElement(element: HTMLElement): void {
    if (this.state !== 'following') return;
    if (!this.scrollContainer) return;

    this.isAutoScrolling = true;

    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });

    // Clear the auto-scrolling flag after animation completes
    if (this.autoScrollTimer) clearTimeout(this.autoScrollTimer);
    this.autoScrollTimer = setTimeout(() => {
      this.isAutoScrolling = false;
    }, 500); // Smooth scroll typically completes within 500ms
  }

  /**
   * Clean up listeners.
   */
  destroy(): void {
    this.detachListeners();
    this.setState('idle');
    this.scrollContainer = null;
  }

  // ---------- Getters -------------------------------------------------------

  getState(): ScrollSyncState {
    return this.state;
  }

  // ---------- Private -------------------------------------------------------

  private setState(newState: ScrollSyncState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.callbacks.onStateChange(newState);
  }

  private detachListeners(): void {
    if (this.scrollHandler && this.scrollContainer) {
      this.scrollContainer.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
    if (this.autoScrollTimer) {
      clearTimeout(this.autoScrollTimer);
      this.autoScrollTimer = null;
    }
    this.isAutoScrolling = false;
  }
}
