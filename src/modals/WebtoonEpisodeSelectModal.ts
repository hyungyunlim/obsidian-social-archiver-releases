import { Modal, App, Platform } from 'obsidian';

/**
 * Episode info for display in modal
 */
export interface WebtoonEpisodeInfo {
  no: number;
  subtitle: string;
  thumbnailUrl?: string;
  starScore?: number;
  charge: boolean;
  serviceDateDescription: string;
}

/**
 * Webtoon series info
 */
export interface WebtoonSeriesInfo {
  titleId: string;
  titleName: string;
  thumbnailUrl?: string;
  artistNames?: string;
  genre?: string[];
  publishDay?: string;
  finished?: boolean;
  totalEpisodes: number;
}

/**
 * Selection result from modal
 */
export interface WebtoonEpisodeSelectResult {
  selectedEpisodes: number[]; // Episode numbers to archive
}

/**
 * WebtoonEpisodeSelectModal - Obsidian Native Modal for selecting webtoon episodes
 *
 * Allows users to:
 * - Browse list of episodes
 * - Select one or more free episodes to archive
 * - See which episodes are paid (locked)
 */
export class WebtoonEpisodeSelectModal extends Modal {
  private seriesInfo: WebtoonSeriesInfo;
  private episodes: WebtoonEpisodeInfo[];
  private multiSelect: boolean;
  private onSubmit: (result: WebtoonEpisodeSelectResult) => Promise<void>;

  // Selection state
  private selectedEpisodes: Set<number> = new Set();

  // UI elements
  private submitBtn!: HTMLButtonElement;
  private errorContainer!: HTMLElement;
  private episodeListContainer!: HTMLElement;
  private isSubmitting: boolean = false;

  // Pagination
  private currentPage: number = 1;
  private readonly pageSize: number = 20;

  constructor(
    app: App,
    seriesInfo: WebtoonSeriesInfo,
    episodes: WebtoonEpisodeInfo[],
    onSubmit: (result: WebtoonEpisodeSelectResult) => Promise<void>,
    multiSelect: boolean = false
  ) {
    super(app);
    this.seriesInfo = seriesInfo;
    this.episodes = episodes;
    this.onSubmit = onSubmit;
    this.multiSelect = multiSelect;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Add modal class for styling
    modalEl.addClass('social-archiver-modal', 'webtoon-episode-select-modal');

    // Modal size
    if (Platform.isMobile) {
      modalEl.addClass('wesm-modal--mobile');
      contentEl.addClass('wesm-content--mobile');
    } else {
      modalEl.addClass('wesm-modal--desktop');
    }

    // Main layout
    contentEl.addClass('sa-flex-col', 'sa-h-full', 'wesm-content-layout');

    // Header
    this.renderHeader(contentEl);

    // Error container (hidden by default)
    this.errorContainer = contentEl.createDiv({ cls: 'webtoon-error-container' });
    this.errorContainer.addClass('sa-hidden');

    // Episode list (scrollable)
    this.episodeListContainer = contentEl.createDiv({ cls: 'webtoon-episode-list' });
    this.episodeListContainer.addClass('sa-flex-1', 'sa-overflow-y-auto', 'sa-py-8', 'sa-px-16');
    this.renderEpisodeList();

    // Footer
    this.renderFooter(contentEl);

    // Keyboard shortcuts
    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });

    this.scope.register(['Mod'], 'Enter', () => {
      if (!this.isSubmitting && this.selectedEpisodes.size > 0) {
        void this.handleSubmit();
      }
      return false;
    });
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'webtoon-header' });
    header.addClass('sa-p-16', 'sa-border-b', 'sa-flex-shrink-0');

    // Title
    const titleRow = header.createDiv();
    titleRow.addClass('sa-flex-between', 'sa-mb-8');

    const title = titleRow.createEl('h2');
    title.addClass('sa-m-0', 'sa-text-md');
    title.setText(this.multiSelect ? 'Select episodes' : 'Select episode');

    // Series info
    const seriesRow = header.createDiv();
    seriesRow.addClass('sa-flex-row', 'sa-gap-10');

    // Mini thumbnail
    if (this.seriesInfo.thumbnailUrl) {
      const thumb = seriesRow.createDiv();
      thumb.addClass('sa-rounded-6', 'sa-overflow-hidden', 'sa-flex-shrink-0');
      thumb.setCssProps({'--sa-width': '36px', '--sa-height': '36px'});
      thumb.addClass('sa-dynamic-width', 'sa-dynamic-height');
      const img = thumb.createEl('img');
      img.src = this.seriesInfo.thumbnailUrl;
      img.addClass('sa-cover');
    }

    const seriesInfo = seriesRow.createDiv();
    const seriesTitle = seriesInfo.createDiv();
    seriesTitle.addClass('sa-font-medium', 'sa-text-normal', 'sa-text-sm');
    seriesTitle.setText(this.seriesInfo.titleName);

    const seriesMeta = seriesInfo.createDiv();
    seriesMeta.addClass('sa-text-xs', 'sa-text-muted');
    const metaParts: string[] = [];
    if (this.seriesInfo.publishDay) metaParts.push(this.seriesInfo.publishDay);
    metaParts.push(`${this.seriesInfo.totalEpisodes} episodes`);
    seriesMeta.setText(metaParts.join(' · '));

    // Selection count (if multi-select)
    if (this.multiSelect) {
      const selectionInfo = header.createDiv({ cls: 'webtoon-selection-info' });
      selectionInfo.addClass('sa-mt-8', 'sa-py-6', 'sa-px-10', 'sa-bg-secondary', 'sa-rounded-6', 'sa-text-xs', 'sa-text-muted');
      this.updateSelectionInfo(selectionInfo);
    }
  }

  private updateSelectionInfo(container?: HTMLElement): void {
    const infoEl = container || this.contentEl.querySelector('.webtoon-selection-info') as HTMLElement;
    if (!infoEl) return;

    const count = this.selectedEpisodes.size;
    const freeCount = this.episodes.filter(ep => !ep.charge).length;
    infoEl.textContent = count > 0
      ? `${count} episode${count > 1 ? 's' : ''} selected`
      : `${freeCount} free episodes available`;
  }

  private renderEpisodeList(): void {
    this.episodeListContainer.empty();

    // Calculate pagination
    const totalPages = Math.ceil(this.episodes.length / this.pageSize);
    const startIdx = (this.currentPage - 1) * this.pageSize;
    const endIdx = startIdx + this.pageSize;
    const pageEpisodes = this.episodes.slice(startIdx, endIdx);

    // Episode items
    pageEpisodes.forEach(episode => {
      const item = this.episodeListContainer.createDiv({ cls: 'webtoon-episode-item' });
      const isPaid = episode.charge;
      const isSelected = this.selectedEpisodes.has(episode.no);

      item.addClass('sa-flex-row', 'sa-gap-12', 'sa-p-10', 'sa-rounded-8', 'sa-mb-8', 'sa-transition-bg');
      if (!isPaid) {
        item.addClass('sa-clickable');
      } else {
        item.addClass('wesm-episode-item--disabled');
      }
      if (isSelected) {
        item.addClass('sa-bg-accent');
      } else {
        item.addClass('sa-bg-secondary');
      }
      if (isPaid) {
        item.addClass('sa-opacity-50');
      }

      if (!isPaid) {
        item.addEventListener('click', () => this.toggleEpisode(episode.no, item));
        item.addEventListener('mouseenter', () => {
          if (!this.selectedEpisodes.has(episode.no)) {
            item.removeClass('sa-bg-secondary');
            item.addClass('sa-bg-hover');
          }
        });
        item.addEventListener('mouseleave', () => {
          if (this.selectedEpisodes.has(episode.no)) {
            item.removeClass('sa-bg-hover');
            item.addClass('sa-bg-accent');
          } else {
            item.removeClass('sa-bg-hover');
            item.addClass('sa-bg-secondary');
          }
        });
      }

      // Thumbnail
      const thumb = item.createDiv({ cls: 'episode-thumb' });
      thumb.addClass('sa-rounded-6', 'sa-overflow-hidden', 'sa-flex-shrink-0');
      thumb.setCssProps({'--sa-width': '48px', '--sa-height': '48px', '--sa-bg': 'var(--background-modifier-border)'});
      thumb.addClass('sa-dynamic-width', 'sa-dynamic-height', 'sa-dynamic-bg');

      if (episode.thumbnailUrl) {
        const img = thumb.createEl('img');
        img.src = episode.thumbnailUrl;
        img.addClass('sa-cover');
      }

      // Episode info
      const info = item.createDiv({ cls: 'episode-info' });
      info.addClass('sa-flex-1', 'sa-min-w-0');

      const titleRow = info.createDiv();
      titleRow.addClass('sa-flex-row', 'sa-gap-6');
      if (isSelected) {
        titleRow.setCssProps({'--sa-color': 'var(--text-on-accent)'});
        titleRow.addClass('sa-dynamic-color');
      } else {
        titleRow.addClass('sa-text-normal');
      }

      const episodeNum = titleRow.createSpan();
      episodeNum.addClass('sa-font-semibold', 'sa-text-sm');
      episodeNum.setText(`Ep. ${episode.no}`);

      const subtitle = titleRow.createSpan();
      subtitle.addClass('sa-text-xs', 'sa-truncate');
      if (isSelected) {
        subtitle.setCssProps({'--sa-color': 'var(--text-on-accent)'});
        subtitle.addClass('sa-dynamic-color');
      } else {
        subtitle.addClass('sa-text-muted');
      }
      subtitle.setText(episode.subtitle.replace(/^\d+화\s*/, ''));

      // Meta row (date, rating)
      const metaRow = info.createDiv();
      metaRow.addClass('sa-flex-row', 'sa-gap-8', 'sa-mt-2', 'sa-text-xs');
      if (isSelected) {
        metaRow.setCssProps({'--sa-color': 'var(--text-on-accent)'});
        metaRow.addClass('sa-dynamic-color');
      } else {
        metaRow.addClass('sa-text-muted');
      }

      // Date or paid status
      if (isPaid) {
        const paidBadge = metaRow.createSpan();
        paidBadge.addClass('wesm-paid-badge', 'sa-rounded-4');
        paidBadge.setText(episode.serviceDateDescription.includes('무료')
          ? episode.serviceDateDescription
          : 'Paid');
      } else {
        metaRow.createSpan().setText(episode.serviceDateDescription);
      }

      // Star rating
      if (episode.starScore !== undefined && episode.starScore > 0) {
        const rating = metaRow.createSpan();
        rating.textContent = `\u2B50 ${episode.starScore.toFixed(1)}`;
      }

      // Selection checkbox/indicator
      const indicator = item.createDiv({ cls: 'episode-indicator' });
      indicator.addClass('sa-rounded-full', 'sa-flex-center', 'sa-flex-shrink-0');
      indicator.setCssProps({'--sa-width': '24px', '--sa-height': '24px'});
      indicator.addClass('sa-dynamic-width', 'sa-dynamic-height');

      if (isPaid) {
        const lockSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        lockSvg.setAttribute('width', '16');
        lockSvg.setAttribute('height', '16');
        lockSvg.setAttribute('viewBox', '0 0 24 24');
        lockSvg.setAttribute('fill', 'currentColor');
        lockSvg.addClass('sa-text-muted');
        const lockPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        lockPath.setAttribute('d', 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z');
        lockSvg.appendChild(lockPath);
        indicator.appendChild(lockSvg);
      } else if (isSelected) {
        indicator.addClass('wesm-indicator--checked');
        const checkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        checkSvg.setAttribute('width', '14');
        checkSvg.setAttribute('height', '14');
        checkSvg.setAttribute('viewBox', '0 0 24 24');
        checkSvg.setAttribute('fill', 'none');
        checkSvg.setAttribute('stroke', 'var(--interactive-accent)');
        checkSvg.setAttribute('stroke-width', '3');
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '20 6 9 17 4 12');
        checkSvg.appendChild(polyline);
        indicator.appendChild(checkSvg);
      } else {
        indicator.addClass('sa-border', 'sa-bg-primary', 'wesm-indicator--empty');
      }
    });

    // Pagination controls
    if (totalPages > 1) {
      const pagination = this.episodeListContainer.createDiv({ cls: 'webtoon-pagination' });
      pagination.addClass('sa-flex-center', 'sa-gap-8', 'sa-py-12', 'sa-mt-8');

      // Previous button
      const prevBtn = pagination.createEl('button');
      prevBtn.addClass('sa-py-6', 'sa-px-12', 'sa-border', 'sa-text-xs', 'wesm-pagination-btn');
      if (this.currentPage === 1) {
        prevBtn.addClass('sa-bg-secondary', 'sa-text-muted', 'wesm-pagination-btn--disabled');
      } else {
        prevBtn.addClass('sa-bg-primary', 'sa-text-normal', 'sa-clickable');
      }
      prevBtn.setText('← prev');
      prevBtn.disabled = this.currentPage === 1;
      prevBtn.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.renderEpisodeList();
        }
      });

      // Page info
      const pageInfo = pagination.createSpan();
      pageInfo.addClass('sa-text-xs', 'sa-text-muted', 'sa-px-8');
      pageInfo.setText(`${this.currentPage} / ${totalPages}`);

      // Next button
      const nextBtn = pagination.createEl('button');
      nextBtn.addClass('sa-py-6', 'sa-px-12', 'sa-border', 'sa-text-xs', 'wesm-pagination-btn');
      if (this.currentPage === totalPages) {
        nextBtn.addClass('sa-bg-secondary', 'sa-text-muted', 'wesm-pagination-btn--disabled');
      } else {
        nextBtn.addClass('sa-bg-primary', 'sa-text-normal', 'sa-clickable');
      }
      nextBtn.setText('Next →');
      nextBtn.disabled = this.currentPage === totalPages;
      nextBtn.addEventListener('click', () => {
        if (this.currentPage < totalPages) {
          this.currentPage++;
          this.renderEpisodeList();
        }
      });
    }
  }

  private toggleEpisode(episodeNo: number, itemEl: HTMLElement): void {
    if (this.multiSelect) {
      if (this.selectedEpisodes.has(episodeNo)) {
        this.selectedEpisodes.delete(episodeNo);
        itemEl.removeClass('sa-bg-accent');
        itemEl.addClass('sa-bg-secondary');
      } else {
        this.selectedEpisodes.add(episodeNo);
        itemEl.removeClass('sa-bg-secondary');
        itemEl.addClass('sa-bg-accent');
      }
    } else {
      // Single select: clear previous and select new
      this.selectedEpisodes.clear();
      this.selectedEpisodes.add(episodeNo);
      this.renderEpisodeList(); // Re-render to update all items
    }

    this.updateSelectionInfo();
    this.updateSubmitButton();
  }

  private updateSubmitButton(): void {
    if (this.submitBtn) {
      this.submitBtn.disabled = this.selectedEpisodes.size === 0;
      if (this.selectedEpisodes.size === 0) {
        this.submitBtn.addClass('sa-opacity-50');
        this.submitBtn.removeClass('sa-opacity-100');
      } else {
        this.submitBtn.removeClass('sa-opacity-50');
        this.submitBtn.addClass('sa-opacity-100');
      }
    }
  }

  private showError(message: string): void {
    this.errorContainer.empty();
    this.errorContainer.removeClass('sa-hidden');
    this.errorContainer.addClass('sa-flex-row', 'sa-gap-12', 'sa-py-8', 'sa-px-16', 'sa-mb-8', 'sa-rounded-6', 'wesm-error');
    this.errorContainer.setCssProps({'--sa-bg': 'var(--background-modifier-error)'});
    this.errorContainer.addClass('sa-dynamic-bg');

    const messageText = this.errorContainer.createDiv();
    messageText.textContent = message;
    messageText.addClass('sa-m-0', 'sa-text-error', 'sa-text-sm');
  }

  private hideError(): void {
    this.errorContainer.addClass('sa-hidden');
    this.errorContainer.empty();
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv({ cls: 'webtoon-footer' });
    footer.addClass('sa-flex-between', 'sa-gap-8', 'sa-p-12', 'sa-flex-shrink-0', 'wesm-footer');

    // Left side: Select all (if multi-select)
    const leftSide = footer.createDiv();
    if (this.multiSelect) {
      const freeEpisodes = this.episodes.filter(ep => !ep.charge);
      if (freeEpisodes.length > 0) {
        const selectAllBtn = leftSide.createEl('button');
        selectAllBtn.addClass('sa-py-6', 'sa-px-12', 'sa-bg-transparent', 'sa-text-accent', 'sa-border', 'sa-clickable', 'sa-text-xs', 'wesm-select-all-btn');
        selectAllBtn.setText(this.selectedEpisodes.size === freeEpisodes.length ? 'Deselect all' : 'Select all free');
        selectAllBtn.addEventListener('click', () => {
          if (this.selectedEpisodes.size === freeEpisodes.length) {
            this.selectedEpisodes.clear();
          } else {
            freeEpisodes.forEach(ep => this.selectedEpisodes.add(ep.no));
          }
          this.renderEpisodeList();
          this.updateSelectionInfo();
          this.updateSubmitButton();
          selectAllBtn.setText(this.selectedEpisodes.size === freeEpisodes.length ? 'Deselect all' : 'Select all free');
        });
      }
    }

    // Right side: Cancel and Submit buttons
    const rightSide = footer.createDiv();
    rightSide.addClass('sa-flex', 'sa-gap-8');

    // Cancel button
    const cancelBtn = rightSide.createEl('button');
    cancelBtn.setText('Cancel');
    cancelBtn.addClass('sa-py-8', 'sa-px-16', 'sa-bg-hover', 'sa-text-normal', 'sa-clickable', 'wesm-cancel-btn');
    cancelBtn.addEventListener('click', () => this.close());

    // Submit button
    this.submitBtn = rightSide.createEl('button');
    this.submitBtn.setText(this.multiSelect ? 'Archive selected' : 'Archive');
    this.submitBtn.disabled = true;
    this.submitBtn.addClass('sa-py-8', 'sa-px-16', 'sa-clickable', 'sa-font-medium', 'sa-opacity-50', 'wesm-submit-btn');
    this.submitBtn.setCssProps({'--sa-bg': '#00DC64', '--sa-color': 'white'});
    this.submitBtn.addClass('sa-dynamic-bg', 'sa-dynamic-color');
    this.submitBtn.addEventListener('click', () => void this.handleSubmit());
  }

  private async handleSubmit(): Promise<void> {
    if (this.isSubmitting || this.selectedEpisodes.size === 0) return;

    this.isSubmitting = true;
    this.submitBtn.disabled = true;
    this.submitBtn.setText('Archiving...');
    this.hideError();

    try {
      const selectedArray = Array.from(this.selectedEpisodes).sort((a, b) => a - b);
      console.debug('[WebtoonEpisodeSelectModal] Submitting selection:', selectedArray);

      await this.onSubmit({
        selectedEpisodes: selectedArray,
      });
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Archive failed';
      this.showError(message);
      this.submitBtn.disabled = false;
      this.submitBtn.setText(this.multiSelect ? 'Archive selected' : 'Archive');
    } finally {
      this.isSubmitting = false;
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
