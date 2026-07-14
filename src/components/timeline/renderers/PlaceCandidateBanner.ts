/**
 * PlaceCandidateBanner - UI component for pending place-candidate suggestions
 *
 * Single Responsibility: display the "a place was found in this post" banner
 * on timeline cards whose server archive has pending place candidates.
 * Structure mirrors AICommentBanner (render(container, options) / destroy()).
 */

import { setIcon } from 'obsidian';

// ============================================================================
// Types
// ============================================================================

export interface PlaceCandidateBannerOptions {
  /** Number of pending candidates for the archive. */
  pendingCount: number;
  /**
   * True when no pending candidate carries applyable data (name /
   * addressText / externalPlaceId) — i.e. every candidate is a data-less
   * hint that only offers the manual path.
   */
  hintOnly: boolean;
  /** Open the review modal. */
  onReview: () => void;
}

// ============================================================================
// PlaceCandidateBanner Class
// ============================================================================

export class PlaceCandidateBanner {
  private contentEl: HTMLElement | null = null;

  render(container: HTMLElement, options: PlaceCandidateBannerOptions): void {
    const banner = container.createDiv({ cls: 'place-candidate-banner' });
    banner.addClass('sa-flex-between', 'sa-gap-12', 'sa-bg-transparent', 'sa-p-8', 'sa-px-12', 'sa-clickable');
    banner.addClass('acb-banner');
    this.contentEl = banner;

    // Left: map-pin icon + message
    const messageSection = banner.createDiv();
    messageSection.addClass('sa-flex-row', 'sa-gap-6', 'sa-flex-1', 'sa-min-w-0');

    const pinIcon = messageSection.createDiv();
    pinIcon.addClass('sa-icon-16', 'sa-text-muted', 'sa-pointer-none');
    setIcon(pinIcon, 'map-pin');

    // Copy mirrors mobile (places.bannerFound / places.bannerAnchor);
    // hardcoded English per plugin string convention.
    const text = options.hintOnly
      ? 'Look for a place in this post?'
      : options.pendingCount > 1
        ? `${options.pendingCount} places were found in this post — want to review them?`
        : 'A place was found in this post — want to review it?';
    const message = messageSection.createSpan({ text });
    message.addClass('sa-text-base', 'sa-text-normal');

    // Right: review chevron button
    const reviewButton = banner.createEl('button');
    reviewButton.addClass('sa-p-0', 'sa-flex-center', 'sa-bg-transparent', 'sa-text-accent', 'sa-clickable', 'sa-transition');
    reviewButton.addClass('acb-icon-btn');
    reviewButton.setAttribute('aria-label', 'Review places');
    reviewButton.setAttribute('title', 'Review places');
    const chevron = reviewButton.createDiv();
    chevron.addClass('sa-icon-20');
    setIcon(chevron, 'chevron-right');

    // Whole banner opens the review modal
    banner.addEventListener('click', (event) => {
      event.stopPropagation();
      options.onReview();
    });
  }

  destroy(): void {
    this.contentEl?.remove();
    this.contentEl = null;
  }
}
