/**
 * LibrarySyncBanner - Pure TypeScript UI component
 *
 * Renders a single status banner for the library sync service.
 * Follows CrawlStatusBanner / ArchiveProgressBanner patterns with:
 * - Obsidian API for DOM manipulation (createDiv, setIcon)
 * - Obsidian CSS variables for theme compatibility
 * - Observer pattern for cancel/retry/dismiss callbacks
 * - Cleanup pattern for event listeners
 * - `sawRunningState` guard: terminal banners (completed/error) are only
 *   shown if this banner instance witnessed a running phase transition.
 *
 * Design decision: this component does NOT subscribe to the service itself.
 * The owner (TimelineContainer) drives updates via `hydrateInitial()` and
 * `update()`. This keeps the component strictly a render-only concern (SRP).
 *
 * Usage:
 * ```typescript
 * const banner = new LibrarySyncBanner(parentEl);
 * banner.onCancel(() => archiveLibrarySyncService.cancel());
 * banner.onRetry(() => archiveLibrarySyncService.startSync());
 * banner.onDismiss(() => {});
 * banner.hydrateInitial(archiveLibrarySyncService.getState());
 * const unsub = archiveLibrarySyncService.onProgress(state => banner.update(state));
 * ```
 */

import { setIcon } from 'obsidian';
import type { ArchiveLibrarySyncRuntimeState } from '../../plugin/sync/ArchiveLibrarySyncService';

// ============================================================================
// Internal types
// ============================================================================

type CancelCallback = () => void;
type RetryCallback = () => void;
type DismissCallback = () => void;

// ============================================================================
// LibrarySyncBanner Component
// ============================================================================

/**
 * LibrarySyncBanner - Pure TypeScript UI component
 * Renders a status banner for the library sync service state.
 */
export class LibrarySyncBanner {
  private readonly containerEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly actionsEl: HTMLElement;

  /** True once this instance has seen a running phase (scanning / delta-sweep). */
  private sawRunningState = false;

  /** Auto-dismiss timer handle for completed state. */
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

  private onCancelCallback?: CancelCallback;
  private onRetryCallback?: RetryCallback;
  private onDismissCallback?: DismissCallback;
  private readonly cleanupFunctions: Array<() => void> = [];

  constructor(parentEl: HTMLElement) {
    this.containerEl = parentEl.createDiv({ cls: 'library-sync-banner' });

    this.bannerEl = this.containerEl.createDiv({
      cls: 'library-sync-banner-row',
      attr: {
        role: 'status',
        'aria-live': 'polite',
      },
    });

    // Icon container
    this.iconEl = this.bannerEl.createSpan({ cls: 'banner-icon' });

    // Text container
    this.textEl = this.bannerEl.createSpan({ cls: 'banner-text' });

    // Actions container
    this.actionsEl = this.bannerEl.createSpan({ cls: 'banner-actions' });
  }

  // =========================================================================
  // Public callback registration
  // =========================================================================

  /** Set callback for Cancel button clicks. */
  public onCancel(cb: CancelCallback): void {
    this.onCancelCallback = cb;
  }

  /** Set callback for Retry button clicks. */
  public onRetry(cb: RetryCallback): void {
    this.onRetryCallback = cb;
  }

  /** Set callback for Dismiss button clicks (local hide only). */
  public onDismiss(cb: DismissCallback): void {
    this.onDismissCallback = cb;
  }

  // =========================================================================
  // Public update API
  // =========================================================================

  /**
   * Called once on initialisation with the current service snapshot.
   * Only renders the banner if the sync is already in a running phase.
   * Terminal phases (completed / error / idle) are intentionally skipped here
   * to prevent stale banners re-appearing when the Timeline view re-opens.
   */
  public hydrateInitial(state: ArchiveLibrarySyncRuntimeState): void {
    if (!this.isRunningPhase(state.phase)) {
      // Do not show stale terminal or idle state.
      return;
    }

    this.sawRunningState = true;
    this.render(state);
  }

  /**
   * Called on every progress update pushed from the service.
   * Applies the `sawRunningState` guard for terminal phases.
   */
  public update(state: ArchiveLibrarySyncRuntimeState): void {
    if (this.isRunningPhase(state.phase)) {
      this.sawRunningState = true;
      this.render(state);
      return;
    }

    // Terminal or idle phases: only render if we saw a running state first.
    if (state.phase === 'idle') {
      this.hide();
      return;
    }

    if (!this.sawRunningState) {
      // Stale terminal state — do not re-expose.
      return;
    }

    // completed or error — we witnessed a running state, so show it.
    this.render(state);
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  private render(state: ArchiveLibrarySyncRuntimeState): void {
    this.clearAutoDismiss();
    this.show();
    this.updateAriaBusy(state);
    this.renderIcon(state);
    this.renderText(state);
    this.renderActions(state);

    if (state.phase === 'completed') {
      this.scheduleAutoDismiss();
    }
  }

  private show(): void {
    this.containerEl.addClass('lsb-visible');
  }

  private hide(): void {
    this.clearAutoDismiss();
    this.containerEl.removeClass('lsb-visible');
  }

  private updateAriaBusy(state: ArchiveLibrarySyncRuntimeState): void {
    const busy = this.isRunningPhase(state.phase);
    this.bannerEl.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  // =========================================================================
  // Icon rendering
  // =========================================================================

  private renderIcon(state: ArchiveLibrarySyncRuntimeState): void {
    this.iconEl.empty();
    this.iconEl.removeClass('lsb-icon-syncing', 'lsb-icon-completed', 'lsb-icon-failed', 'spin');

    if (this.isRunningPhase(state.phase)) {
      setIcon(this.iconEl, 'loader-2');
      this.iconEl.addClass('lsb-icon-syncing', 'spin');
    } else if (state.phase === 'completed') {
      setIcon(this.iconEl, 'check');
      this.iconEl.addClass('lsb-icon-completed');
    } else if (state.phase === 'error') {
      setIcon(this.iconEl, 'x');
      this.iconEl.addClass('lsb-icon-failed');
    }
  }

  // =========================================================================
  // Text rendering
  // =========================================================================

  private renderText(state: ArchiveLibrarySyncRuntimeState): void {
    this.textEl.setText(this.buildStatusText(state));
  }

  private buildStatusText(state: ArchiveLibrarySyncRuntimeState): string {
    const { phase, mode, scannedCount, totalServerArchives, savedCount, lastError } = state;

    if (phase === 'scanning') {
      if (mode === 'resume') {
        return `Resuming library sync... (${scannedCount} scanned)`;
      }

      const progressSegment =
        totalServerArchives !== null
          ? `(${scannedCount}/${totalServerArchives})`
          : `(${scannedCount} scanned)`;

      const newSegment = savedCount > 0 ? ` · ${savedCount} new` : '';
      return `Syncing library... ${progressSegment}${newSegment}`;
    }

    if (phase === 'delta-sweep') {
      return 'Checking server changes before finishing...';
    }

    if (phase === 'completed') {
      if (savedCount > 0) {
        return `Library sync complete · ${savedCount} new ${savedCount === 1 ? 'archive' : 'archives'} added`;
      }
      return 'Library sync complete';
    }

    if (phase === 'error') {
      const errorSegment = lastError ? ` · ${lastError}` : '';
      return `Library sync failed${errorSegment}`;
    }

    return '';
  }

  // =========================================================================
  // Actions rendering
  // =========================================================================

  private renderActions(state: ArchiveLibrarySyncRuntimeState): void {
    // Remove all existing event-listener cleanup entries for action buttons
    // so that we don't leak listeners across re-renders.
    this.clearActionCleanups();
    this.actionsEl.empty();

    if (this.isRunningPhase(state.phase)) {
      this.addCancelButton();
      return;
    }

    if (state.phase === 'error') {
      this.addRetryButton();
      this.addDismissButton();
      return;
    }

    // completed: auto-dismiss handles removal; no manual buttons needed.
  }

  private addCancelButton(): void {
    const btn = this.actionsEl.createEl('button', {
      cls: 'banner-cancel clickable-icon lsb-action-btn',
      attr: { 'aria-label': 'Cancel sync' },
      text: 'Cancel',
    });

    const handleClick = (e: MouseEvent): void => {
      e.stopPropagation();
      this.onCancelCallback?.();
    };
    btn.addEventListener('click', handleClick);
    this.cleanupFunctions.push(() => btn.removeEventListener('click', handleClick));
  }

  private addRetryButton(): void {
    const btn = this.actionsEl.createEl('button', {
      cls: 'banner-retry clickable-icon lsb-action-btn',
      attr: { 'aria-label': 'Retry sync' },
      text: 'Retry',
    });

    const handleClick = (e: MouseEvent): void => {
      e.stopPropagation();
      this.onRetryCallback?.();
    };
    btn.addEventListener('click', handleClick);
    this.cleanupFunctions.push(() => btn.removeEventListener('click', handleClick));
  }

  private addDismissButton(): void {
    const btn = this.actionsEl.createEl('button', {
      cls: 'banner-dismiss clickable-icon lsb-action-btn',
      attr: { 'aria-label': 'Dismiss' },
    });
    setIcon(btn, 'x');

    const handleClick = (e: MouseEvent): void => {
      e.stopPropagation();
      this.hide();
      this.onDismissCallback?.();
    };
    btn.addEventListener('click', handleClick);
    this.cleanupFunctions.push(() => btn.removeEventListener('click', handleClick));
  }

  // =========================================================================
  // Auto-dismiss
  // =========================================================================

  private scheduleAutoDismiss(): void {
    this.autoDismissTimer = setTimeout(() => {
      this.hide();
    }, 5000);
  }

  private clearAutoDismiss(): void {
    if (this.autoDismissTimer !== null) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private isRunningPhase(phase: ArchiveLibrarySyncRuntimeState['phase']): boolean {
    return phase === 'scanning' || phase === 'delta-sweep';
  }

  /**
   * Removes cleanup entries for action buttons only (not the full cleanupFunctions
   * array, which may hold other long-lived listeners). We do this by rebuilding
   * the array from a tagged set — but since all cleanups here are anonymous we
   * instead drain the entire array before each render, accepting that the only
   * long-lived listeners come from action buttons (which we rebuild on each render).
   */
  private clearActionCleanups(): void {
    // Run existing listener removals before discarding the cleanup entries.
    for (const cleanup of this.cleanupFunctions) {
      cleanup();
    }
    this.cleanupFunctions.length = 0;
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  /**
   * Tear down all resources and remove the element from the DOM.
   * Must be called when the owning component is destroyed.
   */
  public destroy(): void {
    this.clearAutoDismiss();

    for (const cleanup of this.cleanupFunctions) {
      cleanup();
    }
    this.cleanupFunctions.length = 0;

    this.containerEl.remove();
  }
}
