/**
 * ArchiveProgressBanner - Pure TypeScript UI component
 *
 * Renders status banners for active archive jobs.
 * Follows CrawlStatusBanner pattern with:
 * - Obsidian API for DOM manipulation (createDiv, setIcon)
 * - Obsidian CSS variables for theme compatibility
 * - Observer pattern for dismiss/retry callbacks
 * - Cleanup pattern for event listeners
 *
 * Usage:
 * ```typescript
 * const banner = new ArchiveProgressBanner(parentEl);
 * banner.onDismiss((jobId) => archiveJobTracker.dismissJob(jobId));
 * banner.onRetry((jobId) => archiveJobTracker.retryJob(jobId));
 * archiveJobTracker.onUpdate((jobs) => banner.update(jobs));
 * ```
 */

import { setIcon } from 'obsidian';
import type { ActiveArchiveJob } from '../../services/ArchiveJobTracker';

type DismissCallback = (jobId: string) => void;
type RetryCallback = (jobId: string) => void;

// ============================================================================
// ArchiveProgressBanner Component
// ============================================================================

/**
 * ArchiveProgressBanner - Pure TypeScript UI component
 * Renders status banners for active archive jobs
 */
export class ArchiveProgressBanner {
  private containerEl: HTMLElement;
  private jobs: ActiveArchiveJob[] = [];
  private bannerElements: Map<string, HTMLElement> = new Map();
  private iconElements: Map<string, HTMLElement> = new Map();
  private onDismissCallback?: DismissCallback;
  private onRetryCallback?: RetryCallback;
  private cleanupFunctions: Array<() => void> = [];

  constructor(parentEl: HTMLElement) {
    this.containerEl = parentEl.createDiv({ cls: 'archive-progress-banners' });
    this.applyContainerStyles();
    this.injectSpinAnimation();
  }

  /**
   * Set callback for dismiss button clicks
   */
  public onDismiss(callback: DismissCallback): void {
    this.onDismissCallback = callback;
  }

  /**
   * Set callback for retry button clicks
   */
  public onRetry(callback: RetryCallback): void {
    this.onRetryCallback = callback;
  }

  /**
   * Update displayed jobs (reactive update)
   * Efficiently adds/removes/updates banner elements
   */
  public update(newJobs: ActiveArchiveJob[]): void {
    const newJobIds = new Set(newJobs.map(j => j.jobId));
    const existingJobIds = new Set(this.jobs.map(j => j.jobId));

    // Remove banners for jobs no longer in list
    for (const job of this.jobs) {
      if (!newJobIds.has(job.jobId)) {
        this.removeBanner(job.jobId);
      }
    }

    // Update or add banners
    for (const job of newJobs) {
      if (existingJobIds.has(job.jobId)) {
        this.updateBanner(job);
      } else {
        this.createBanner(job);
      }
    }

    this.jobs = [...newJobs];

    // Toggle visibility
    this.containerEl.style.display = this.jobs.length > 0 ? 'flex' : 'none';
  }

  /**
   * Create a new banner element for a job
   */
  private createBanner(job: ActiveArchiveJob): void {
    const bannerEl = this.containerEl.createDiv({
      cls: `archive-banner banner-${job.status}`,
      attr: {
        'role': 'status',
        'aria-live': 'polite',
        'aria-busy': this.isActiveStatus(job.status) ? 'true' : 'false',
        'data-job-id': job.jobId
      }
    });

    this.applyBannerStyles(bannerEl, job.status);

    // Icon container
    const iconEl = bannerEl.createSpan({ cls: 'banner-icon' });
    this.applyIconStyles(iconEl, job.status);
    this.setStatusIcon(iconEl, job.status);
    this.iconElements.set(job.jobId, iconEl);

    // Text container
    const textEl = bannerEl.createSpan({ cls: 'banner-text' });
    textEl.setText(this.getStatusText(job));
    textEl.style.flex = '1';
    textEl.style.color = 'var(--text-normal)';

    // Actions container
    const actionsEl = bannerEl.createSpan({ cls: 'banner-actions' });
    actionsEl.style.display = 'flex';
    actionsEl.style.gap = '4px';
    actionsEl.style.alignItems = 'center';

    // Retry button (only for failed jobs)
    if (job.status === 'failed') {
      this.addRetryButton(actionsEl, job.jobId);
    }

    // Dismiss button for all states
    this.addDismissButton(actionsEl, job.jobId);

    this.bannerElements.set(job.jobId, bannerEl);
  }

  /**
   * Update an existing banner element
   */
  private updateBanner(job: ActiveArchiveJob): void {
    const bannerEl = this.bannerElements.get(job.jobId);
    if (!bannerEl) return;

    const oldJob = this.jobs.find(j => j.jobId === job.jobId);
    const statusChanged = oldJob?.status !== job.status;

    // Update CSS class and aria-busy if status changed
    if (statusChanged && oldJob) {
      bannerEl.removeClass(`banner-${oldJob.status}`);
      bannerEl.addClass(`banner-${job.status}`);
      bannerEl.setAttribute('aria-busy', this.isActiveStatus(job.status) ? 'true' : 'false');
      this.applyBannerStyles(bannerEl, job.status);

      // Update icon
      const iconEl = this.iconElements.get(job.jobId);
      if (iconEl) {
        this.applyIconStyles(iconEl, job.status);
        this.setStatusIcon(iconEl, job.status);
      }

      // Update actions (retry/dismiss buttons)
      const actionsEl = bannerEl.querySelector('.banner-actions') as HTMLElement;
      if (actionsEl) {
        actionsEl.empty();

        // Add retry button if failed
        if (job.status === 'failed') {
          this.addRetryButton(actionsEl, job.jobId);
        }

        // Add dismiss button for all non-queued states (completed, failed, archiving, retrying)
        if (job.status !== 'queued') {
          this.addDismissButton(actionsEl, job.jobId);
        }
      }
    }

    // Update text content
    const textEl = bannerEl.querySelector('.banner-text');
    if (textEl) {
      textEl.setText(this.getStatusText(job));
    }
  }

  /**
   * Add retry button to actions container
   */
  private addRetryButton(actionsEl: HTMLElement, jobId: string): void {
    const retryBtn = actionsEl.createEl('button', {
      cls: 'banner-retry clickable-icon',
      attr: { 'aria-label': 'Retry' }
    });
    this.applyActionButtonStyles(retryBtn);
    setIcon(retryBtn, 'rotate-ccw');

    const handleClick = (e: MouseEvent) => {
      e.stopPropagation();
      this.onRetryCallback?.(jobId);
    };
    retryBtn.addEventListener('click', handleClick);
    this.cleanupFunctions.push(() => retryBtn.removeEventListener('click', handleClick));
  }

  /**
   * Add dismiss button to actions container
   */
  private addDismissButton(actionsEl: HTMLElement, jobId: string): void {
    const dismissBtn = actionsEl.createEl('button', {
      cls: 'banner-dismiss clickable-icon',
      attr: { 'aria-label': 'Dismiss' }
    });
    this.applyActionButtonStyles(dismissBtn);
    setIcon(dismissBtn, 'x');

    const handleClick = (e: MouseEvent) => {
      e.stopPropagation();
      this.onDismissCallback?.(jobId);
    };
    dismissBtn.addEventListener('click', handleClick);
    this.cleanupFunctions.push(() => dismissBtn.removeEventListener('click', handleClick));
  }

  /**
   * Remove a banner element
   */
  private removeBanner(jobId: string): void {
    const bannerEl = this.bannerElements.get(jobId);
    if (bannerEl) {
      bannerEl.remove();
      this.bannerElements.delete(jobId);
      this.iconElements.delete(jobId);
    }
  }

  /**
   * Set the appropriate icon based on status
   */
  private setStatusIcon(iconEl: HTMLElement, status: ActiveArchiveJob['status']): void {
    iconEl.empty();

    if (status === 'queued') {
      setIcon(iconEl, 'clock');
      iconEl.removeClass('spin');
    } else if (status === 'archiving') {
      setIcon(iconEl, 'loader-2');
      iconEl.addClass('spin');
    } else if (status === 'retrying') {
      setIcon(iconEl, 'loader-2');
      iconEl.addClass('spin');
    } else if (status === 'completed') {
      setIcon(iconEl, 'check-circle');
      iconEl.removeClass('spin');
    } else if (status === 'failed') {
      setIcon(iconEl, 'x-circle');
      iconEl.removeClass('spin');
    }
  }

  /**
   * Generate status text for a job
   */
  private getStatusText(job: ActiveArchiveJob): string {
    const truncatedUrl = this.truncateUrl(job.url);

    if (job.status === 'queued') {
      return `Queued: ${truncatedUrl}`;
    } else if (job.status === 'archiving') {
      return job.progressText || `Archiving ${truncatedUrl}`;
    } else if (job.status === 'retrying') {
      return `Retrying (${job.retryCount}/${job.maxRetries}): ${truncatedUrl}`;
    } else if (job.status === 'completed') {
      return `Archived: ${truncatedUrl}`;
    } else {
      return `Failed: ${truncatedUrl}${job.error ? ` - ${job.error}` : ''}`;
    }
  }

  /**
   * Truncate URL to domain + first path segment (max 40 chars)
   * Example: "https://facebook.com/post/123456789" -> "facebook.com/post/123..."
   */
  private truncateUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      const firstPath = pathParts.length > 0 ? `/${pathParts[0]}` : '';
      let displayUrl = urlObj.hostname + firstPath;

      if (displayUrl.length > 40) {
        displayUrl = displayUrl.slice(0, 37) + '...';
      }

      return displayUrl;
    } catch {
      // Fallback for invalid URLs
      return url.length > 40 ? url.slice(0, 37) + '...' : url;
    }
  }

  /**
   * Check if status represents an active/in-progress state
   */
  private isActiveStatus(status: ActiveArchiveJob['status']): boolean {
    return status === 'queued' || status === 'archiving' || status === 'retrying';
  }

  // =========================================================================
  // Inline Styles (using Obsidian CSS variables)
  // =========================================================================

  private applyContainerStyles(): void {
    Object.assign(this.containerEl.style, {
      display: 'none', // Hidden until jobs exist
      flexDirection: 'column',
      gap: '8px',
      marginTop: '0',
      marginBottom: '12px'
    });
  }

  private applyBannerStyles(el: HTMLElement, status: ActiveArchiveJob['status']): void {
    Object.assign(el.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 14px',
      background: 'var(--background-secondary)',
      border: '1px solid var(--background-modifier-border)',
      borderRadius: 'var(--radius-s)',
      fontSize: 'var(--font-ui-small)'
    });
  }

  private applyIconStyles(el: HTMLElement, status: ActiveArchiveJob['status']): void {
    Object.assign(el.style, {
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center'
    });

    // Set icon size via CSS variable
    el.style.setProperty('--icon-size', '16px');

    // Status-specific colors
    if (status === 'queued') {
      el.style.color = 'var(--text-muted)';
    } else if (status === 'archiving' || status === 'retrying') {
      el.style.color = 'var(--text-muted)';
    } else if (status === 'completed') {
      el.style.color = 'var(--color-green)';
    } else if (status === 'failed') {
      el.style.color = 'var(--color-red)';
    }
  }

  private applyActionButtonStyles(el: HTMLElement): void {
    Object.assign(el.style, {
      padding: '4px',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'var(--text-muted)',
      borderRadius: 'var(--radius-s)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    });

    // Hover effects
    const handleMouseEnter = () => {
      el.style.color = 'var(--text-normal)';
      el.style.background = 'var(--background-modifier-hover)';
    };
    const handleMouseLeave = () => {
      el.style.color = 'var(--text-muted)';
      el.style.background = 'none';
    };

    el.addEventListener('mouseenter', handleMouseEnter);
    el.addEventListener('mouseleave', handleMouseLeave);

    this.cleanupFunctions.push(() => {
      el.removeEventListener('mouseenter', handleMouseEnter);
      el.removeEventListener('mouseleave', handleMouseLeave);
    });
  }

  /**
   * Inject spinner animation CSS
   * Respects prefers-reduced-motion
   */
  private injectSpinAnimation(): void {
    const styleId = 'archive-banner-spin-animation';

    // Check if already injected
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes archive-banner-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .archive-banner .banner-icon.spin svg {
        animation: archive-banner-spin 1s linear infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .archive-banner .banner-icon.spin svg {
          animation: none;
        }
      }
    `;
    document.head.appendChild(style);

    this.cleanupFunctions.push(() => {
      const styleEl = document.getElementById(styleId);
      if (styleEl) {
        styleEl.remove();
      }
    });
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  /**
   * Clean up resources and remove from DOM
   */
  public destroy(): void {
    // Run all cleanup functions (event listeners, style element)
    for (const cleanup of this.cleanupFunctions) {
      cleanup();
    }
    this.cleanupFunctions = [];

    // Clear maps
    this.bannerElements.clear();
    this.iconElements.clear();
    this.jobs = [];

    // Remove container from DOM
    this.containerEl.remove();
  }
}
