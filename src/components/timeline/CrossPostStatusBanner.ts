/**
 * CrossPostStatusBanner - Lightweight ephemeral status banner for cross-posting
 *
 * Unlike CrawlStatusBanner (multi-job, tracker-driven), this component
 * manages a single ephemeral cross-post operation with three states:
 * - posting: spinner + "Cross-posting to Threads..."
 * - complete: check icon + success message (auto-dismiss 3s)
 * - failed: x icon + error message (manual dismiss)
 *
 * Usage:
 * ```typescript
 * const banner = new CrossPostStatusBanner(parentEl);
 * banner.show();
 * // on success:
 * banner.complete('Cross-posted to Threads!');
 * // on failure:
 * banner.fail('Rate limit exceeded');
 * ```
 */

import { setIcon } from 'obsidian';

type CrossPostBannerStatus = 'posting' | 'complete' | 'failed';

export class CrossPostStatusBanner {
  private containerEl: HTMLElement;
  private bannerEl: HTMLElement | null = null;
  private iconEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupFunctions: Array<() => void> = [];

  constructor(parentEl: HTMLElement) {
    this.containerEl = parentEl.createDiv({ cls: 'crosspost-status-banners' });
  }

  /**
   * Show the banner in "posting" state with a spinner
   */
  public show(): void {
    this.clearBanner();

    this.containerEl.addClass('xpb-visible');

    this.bannerEl = this.containerEl.createDiv({
      cls: 'crosspost-banner banner-posting',
      attr: {
        'role': 'status',
        'aria-live': 'polite'
      }
    });

    // Icon
    this.iconEl = this.bannerEl.createSpan({ cls: 'banner-icon xpb-icon-posting' });
    setIcon(this.iconEl, 'loader-2');
    this.iconEl.addClass('spin');

    // Text
    this.textEl = this.bannerEl.createSpan({ cls: 'banner-text' });
    this.textEl.setText('Cross-posting to Threads...');
  }

  /**
   * Transition to "complete" state — auto-dismisses after 3s
   */
  public complete(message?: string): void {
    if (!this.bannerEl) return;

    this.bannerEl.removeClass('banner-posting');
    this.bannerEl.addClass('banner-complete');

    // Update icon
    if (this.iconEl) {
      this.iconEl.empty();
      this.iconEl.removeClass('xpb-icon-posting', 'spin');
      this.iconEl.addClass('xpb-icon-complete');
      setIcon(this.iconEl, 'check-circle');
    }

    // Update text
    if (this.textEl) {
      this.textEl.setText(message ?? 'Cross-posted to Threads!');
    }

    // Auto-dismiss after 3 seconds
    this.autoDismissTimer = setTimeout(() => {
      this.dismiss();
    }, 3000);
  }

  /**
   * Transition to "failed" state — shows dismiss button
   */
  public fail(errorMessage: string): void {
    if (!this.bannerEl) return;

    this.bannerEl.removeClass('banner-posting');
    this.bannerEl.addClass('banner-failed');

    // Update icon
    if (this.iconEl) {
      this.iconEl.empty();
      this.iconEl.removeClass('xpb-icon-posting', 'spin');
      this.iconEl.addClass('xpb-icon-failed');
      setIcon(this.iconEl, 'x-circle');
    }

    // Update text
    if (this.textEl) {
      this.textEl.setText(`Cross-post failed: ${errorMessage}`);
    }

    // Add dismiss button
    this.addDismissButton();
  }

  /**
   * Dismiss (remove) the banner
   */
  public dismiss(): void {
    this.clearBanner();
    this.containerEl.removeClass('xpb-visible');
  }

  /**
   * Clean up all resources and remove from DOM
   */
  public destroy(): void {
    this.clearBanner();
    for (const cleanup of this.cleanupFunctions) {
      cleanup();
    }
    this.cleanupFunctions = [];
    this.containerEl.remove();
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private addDismissButton(): void {
    if (!this.bannerEl) return;

    const dismissBtn = this.bannerEl.createEl('button', {
      cls: 'banner-dismiss clickable-icon xpb-dismiss-btn',
      attr: { 'aria-label': 'Dismiss' }
    });
    setIcon(dismissBtn, 'x');

    const handleClick = (e: MouseEvent) => {
      e.stopPropagation();
      this.dismiss();
    };
    dismissBtn.addEventListener('click', handleClick);
    this.cleanupFunctions.push(() => dismissBtn.removeEventListener('click', handleClick));
  }

  private clearBanner(): void {
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
    if (this.bannerEl) {
      this.bannerEl.remove();
      this.bannerEl = null;
      this.iconEl = null;
      this.textEl = null;
    }
  }
}
