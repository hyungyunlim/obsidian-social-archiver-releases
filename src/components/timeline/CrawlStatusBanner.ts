/**
 * CrawlStatusBanner - Pure TypeScript UI component
 *
 * Renders status banners for active profile crawl jobs.
 * Follows TimelineContainer/PostCardRenderer patterns with:
 * - Obsidian API for DOM manipulation (createDiv, setIcon)
 * - Obsidian CSS variables for theme compatibility
 * - Observer pattern for dismiss callbacks
 * - Cleanup pattern for event listeners
 *
 * Usage:
 * ```typescript
 * const banner = new CrawlStatusBanner(parentEl);
 * banner.onDismiss((jobId) => crawlJobTracker.dismissJob(jobId));
 * crawlJobTracker.onUpdate((jobs) => banner.update(jobs));
 * ```
 */

import { setIcon } from 'obsidian';
import type { Platform } from '../../types/post';

// ============================================================================
// Types
// ============================================================================

/**
 * Active crawl job state interface
 * Matches CrawlJobTracker's ActiveCrawlJob type
 */
export interface ActiveCrawlJob {
  jobId: string;
  handle: string;
  platform: Platform;
  estimatedPosts: number;
  receivedPosts: number;
  startedAt: number;
  status: 'crawling' | 'completed' | 'failed';
  error?: string;
}

type DismissCallback = (jobId: string) => void;

// ============================================================================
// CrawlStatusBanner Component
// ============================================================================

/**
 * CrawlStatusBanner - Pure TypeScript UI component
 * Renders status banners for active profile crawl jobs
 */
export class CrawlStatusBanner {
  private containerEl: HTMLElement;
  private jobs: ActiveCrawlJob[] = [];
  private bannerElements: Map<string, HTMLElement> = new Map();
  private iconElements: Map<string, HTMLElement> = new Map();
  private onDismissCallback?: DismissCallback;
  private cleanupFunctions: Array<() => void> = [];

  constructor(parentEl: HTMLElement) {
    this.containerEl = parentEl.createDiv({ cls: 'crawl-status-banners' });
    this.applyContainerStyles();
  }

  /**
   * Set callback for dismiss button clicks
   */
  public onDismiss(callback: DismissCallback): void {
    this.onDismissCallback = callback;
  }

  /**
   * Update displayed jobs (reactive update)
   * Efficiently adds/removes/updates banner elements
   */
  public update(newJobs: ActiveCrawlJob[]): void {
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
  private createBanner(job: ActiveCrawlJob): void {
    const bannerEl = this.containerEl.createDiv({
      cls: `crawl-banner banner-${job.status}`,
      attr: {
        'role': 'status',
        'aria-live': 'polite',
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

    // Dismiss button (only for completed or failed jobs)
    if (job.status === 'failed' || job.status === 'completed') {
      this.addDismissButton(bannerEl, job.jobId);
    }

    this.bannerElements.set(job.jobId, bannerEl);
  }

  /**
   * Update an existing banner element
   */
  private updateBanner(job: ActiveCrawlJob): void {
    const bannerEl = this.bannerElements.get(job.jobId);
    if (!bannerEl) return;

    const oldJob = this.jobs.find(j => j.jobId === job.jobId);
    const statusChanged = oldJob?.status !== job.status;

    // Update CSS class if status changed
    if (statusChanged && oldJob) {
      bannerEl.removeClass(`banner-${oldJob.status}`);
      bannerEl.addClass(`banner-${job.status}`);
      this.applyBannerStyles(bannerEl, job.status);

      // Update icon
      const iconEl = this.iconElements.get(job.jobId);
      if (iconEl) {
        this.applyIconStyles(iconEl, job.status);
        this.setStatusIcon(iconEl, job.status);
      }

      // Add dismiss button if transitioned to completed/failed
      if ((job.status === 'failed' || job.status === 'completed') &&
          !bannerEl.querySelector('.banner-dismiss')) {
        this.addDismissButton(bannerEl, job.jobId);
      }
    }

    // Update text content
    const textEl = bannerEl.querySelector('.banner-text');
    if (textEl) {
      textEl.setText(this.getStatusText(job));
    }
  }

  /**
   * Add dismiss button to a banner
   */
  private addDismissButton(bannerEl: HTMLElement, jobId: string): void {
    const dismissBtn = bannerEl.createEl('button', {
      cls: 'banner-dismiss clickable-icon',
      attr: { 'aria-label': 'Dismiss' }
    });
    this.applyDismissButtonStyles(dismissBtn);
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
  private setStatusIcon(iconEl: HTMLElement, status: ActiveCrawlJob['status']): void {
    iconEl.empty();

    if (status === 'crawling') {
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
  private getStatusText(job: ActiveCrawlJob): string {
    const handle = job.handle.startsWith('@') ? job.handle : `@${job.handle}`;

    if (job.status === 'crawling') {
      if (job.estimatedPosts > 0) {
        return `Crawling ${handle}... (${job.receivedPosts}/${job.estimatedPosts})`;
      }
      return `Crawling ${handle}... (${job.receivedPosts} posts)`;
    } else if (job.status === 'completed') {
      return `Archived ${job.receivedPosts} posts from ${handle}`;
    } else {
      return `Failed: ${handle} - ${job.error || 'Unknown error'}`;
    }
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

  private applyBannerStyles(el: HTMLElement, status: ActiveCrawlJob['status']): void {
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

  private applyIconStyles(el: HTMLElement, status: ActiveCrawlJob['status']): void {
    Object.assign(el.style, {
      flexShrink: '0',
      display: 'flex',
      alignItems: 'center'
    });

    // Set icon size via CSS variable
    el.style.setProperty('--icon-size', '16px');

    // Status-specific colors
    if (status === 'crawling') {
      el.style.color = 'var(--text-muted)';
    } else if (status === 'completed') {
      el.style.color = 'var(--color-green)';
    } else if (status === 'failed') {
      el.style.color = 'var(--color-red)';
    }
  }

  private applyDismissButtonStyles(el: HTMLElement): void {
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

  // =========================================================================
  // Cleanup
  // =========================================================================

  /**
   * Clean up resources and remove from DOM
   */
  public destroy(): void {
    // Run all cleanup functions (event listeners)
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
