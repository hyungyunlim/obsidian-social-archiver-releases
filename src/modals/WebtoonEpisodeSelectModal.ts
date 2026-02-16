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
      modalEl.style.setProperty('width', '95vw', 'important');
      modalEl.style.setProperty('max-width', '95vw', 'important');
      modalEl.style.setProperty('height', '85vh', 'important');
      modalEl.style.setProperty('max-height', '85vh', 'important');
      contentEl.style.paddingLeft = '8px';
      contentEl.style.paddingRight = '8px';
    } else {
      modalEl.style.setProperty('width', '500px', 'important');
      modalEl.style.setProperty('max-width', '500px', 'important');
      modalEl.style.setProperty('height', '80vh', 'important');
      modalEl.style.setProperty('max-height', '80vh', 'important');
    }

    // Main layout
    contentEl.style.cssText = 'display: flex; flex-direction: column; height: 100%; padding: 0;';

    // Header
    this.renderHeader(contentEl);

    // Error container (hidden by default)
    this.errorContainer = contentEl.createDiv({ cls: 'webtoon-error-container' });
    this.errorContainer.style.display = 'none';

    // Episode list (scrollable)
    this.episodeListContainer = contentEl.createDiv({ cls: 'webtoon-episode-list' });
    this.episodeListContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 8px 16px;
    `;
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
    header.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid var(--background-modifier-border);
      flex-shrink: 0;
    `;

    // Title
    const titleRow = header.createDiv();
    titleRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;';

    const title = titleRow.createEl('h2');
    title.style.cssText = 'margin: 0; font-size: var(--font-ui-medium);';
    title.setText(this.multiSelect ? 'Select Episodes' : 'Select Episode');

    // Series info
    const seriesRow = header.createDiv();
    seriesRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    // Mini thumbnail
    if (this.seriesInfo.thumbnailUrl) {
      const thumb = seriesRow.createDiv();
      thumb.style.cssText = `
        width: 36px;
        height: 36px;
        border-radius: 6px;
        overflow: hidden;
        flex-shrink: 0;
      `;
      const img = thumb.createEl('img');
      img.src = this.seriesInfo.thumbnailUrl;
      img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
    }

    const seriesInfo = seriesRow.createDiv();
    const seriesTitle = seriesInfo.createDiv();
    seriesTitle.style.cssText = 'font-weight: 500; color: var(--text-normal); font-size: var(--font-ui-small);';
    seriesTitle.setText(this.seriesInfo.titleName);

    const seriesMeta = seriesInfo.createDiv();
    seriesMeta.style.cssText = 'font-size: var(--font-ui-smaller); color: var(--text-muted);';
    const metaParts: string[] = [];
    if (this.seriesInfo.publishDay) metaParts.push(this.seriesInfo.publishDay);
    metaParts.push(`${this.seriesInfo.totalEpisodes} episodes`);
    seriesMeta.setText(metaParts.join(' · '));

    // Selection count (if multi-select)
    if (this.multiSelect) {
      const selectionInfo = header.createDiv({ cls: 'webtoon-selection-info' });
      selectionInfo.style.cssText = `
        margin-top: 8px;
        padding: 6px 10px;
        background: var(--background-secondary);
        border-radius: 6px;
        font-size: var(--font-ui-smaller);
        color: var(--text-muted);
      `;
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

      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 6px;
        cursor: ${isPaid ? 'not-allowed' : 'pointer'};
        background: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)'};
        opacity: ${isPaid ? '0.5' : '1'};
        transition: background 0.15s ease;
      `;

      if (!isPaid) {
        item.addEventListener('click', () => this.toggleEpisode(episode.no, item));
        item.addEventListener('mouseenter', () => {
          if (!this.selectedEpisodes.has(episode.no)) {
            item.style.background = 'var(--background-modifier-hover)';
          }
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = this.selectedEpisodes.has(episode.no)
            ? 'var(--interactive-accent)'
            : 'var(--background-secondary)';
        });
      }

      // Thumbnail
      const thumb = item.createDiv({ cls: 'episode-thumb' });
      thumb.style.cssText = `
        width: 48px;
        height: 48px;
        border-radius: 6px;
        overflow: hidden;
        flex-shrink: 0;
        background: var(--background-modifier-border);
      `;

      if (episode.thumbnailUrl) {
        const img = thumb.createEl('img');
        img.src = episode.thumbnailUrl;
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
      }

      // Episode info
      const info = item.createDiv({ cls: 'episode-info' });
      info.style.cssText = 'flex: 1; min-width: 0;';

      const titleRow = info.createDiv();
      titleRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
      `;

      const episodeNum = titleRow.createSpan();
      episodeNum.style.cssText = 'font-weight: 600; font-size: var(--font-ui-small);';
      episodeNum.setText(`Ep. ${episode.no}`);

      const subtitle = titleRow.createSpan();
      subtitle.style.cssText = `
        font-size: var(--font-ui-smaller);
        color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-muted)'};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      `;
      subtitle.setText(episode.subtitle.replace(/^\d+화\s*/, ''));

      // Meta row (date, rating)
      const metaRow = info.createDiv();
      metaRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 2px;
        font-size: var(--font-ui-smaller);
        color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-muted)'};
      `;

      // Date or paid status
      if (isPaid) {
        const paidBadge = metaRow.createSpan();
        paidBadge.style.cssText = `
          padding: 1px 6px;
          background: var(--text-error);
          color: white;
          border-radius: 3px;
          font-size: 10px;
        `;
        paidBadge.setText(episode.serviceDateDescription.includes('무료')
          ? episode.serviceDateDescription
          : 'Paid');
      } else {
        metaRow.createSpan().setText(episode.serviceDateDescription);
      }

      // Star rating
      if (episode.starScore !== undefined && episode.starScore > 0) {
        const rating = metaRow.createSpan();
        rating.innerHTML = `⭐ ${episode.starScore.toFixed(1)}`;
      }

      // Selection checkbox/indicator
      const indicator = item.createDiv({ cls: 'episode-indicator' });
      indicator.style.cssText = `
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      `;

      if (isPaid) {
        indicator.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="color: var(--text-muted);">
          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
        </svg>`;
      } else if (isSelected) {
        indicator.style.background = 'white';
        indicator.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="3">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>`;
      } else {
        indicator.style.cssText += `
          border: 2px solid var(--background-modifier-border);
          background: var(--background-primary);
        `;
      }
    });

    // Pagination controls
    if (totalPages > 1) {
      const pagination = this.episodeListContainer.createDiv({ cls: 'webtoon-pagination' });
      pagination.style.cssText = `
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        padding: 12px 0;
        margin-top: 8px;
      `;

      // Previous button
      const prevBtn = pagination.createEl('button');
      prevBtn.style.cssText = this.getPaginationButtonStyle(this.currentPage === 1);
      prevBtn.setText('← Prev');
      prevBtn.disabled = this.currentPage === 1;
      prevBtn.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.renderEpisodeList();
        }
      });

      // Page info
      const pageInfo = pagination.createSpan();
      pageInfo.style.cssText = 'font-size: var(--font-ui-smaller); color: var(--text-muted); padding: 0 8px;';
      pageInfo.setText(`${this.currentPage} / ${totalPages}`);

      // Next button
      const nextBtn = pagination.createEl('button');
      nextBtn.style.cssText = this.getPaginationButtonStyle(this.currentPage === totalPages);
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

  private getPaginationButtonStyle(disabled: boolean): string {
    return `
      padding: 6px 12px;
      border-radius: var(--button-radius);
      border: 1px solid var(--background-modifier-border);
      background: ${disabled ? 'var(--background-secondary)' : 'var(--background-primary)'};
      color: ${disabled ? 'var(--text-muted)' : 'var(--text-normal)'};
      font-size: var(--font-ui-smaller);
      cursor: ${disabled ? 'not-allowed' : 'pointer'};
    `;
  }

  private toggleEpisode(episodeNo: number, itemEl: HTMLElement): void {
    if (this.multiSelect) {
      if (this.selectedEpisodes.has(episodeNo)) {
        this.selectedEpisodes.delete(episodeNo);
        itemEl.style.background = 'var(--background-secondary)';
      } else {
        this.selectedEpisodes.add(episodeNo);
        itemEl.style.background = 'var(--interactive-accent)';
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
      this.submitBtn.style.opacity = this.selectedEpisodes.size === 0 ? '0.5' : '1';
    }
  }

  private showError(message: string): void {
    this.errorContainer.empty();
    this.errorContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      margin: 0 16px 8px;
      background: var(--background-modifier-error);
      border-radius: 6px;
    `;

    const messageText = this.errorContainer.createDiv();
    messageText.textContent = message;
    messageText.style.cssText = `
      margin: 0;
      color: var(--text-error);
      font-size: var(--font-ui-small);
    `;
  }

  private hideError(): void {
    this.errorContainer.style.display = 'none';
    this.errorContainer.empty();
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv({ cls: 'webtoon-footer' });
    footer.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--background-modifier-border);
      flex-shrink: 0;
    `;

    // Left side: Select all (if multi-select)
    const leftSide = footer.createDiv();
    if (this.multiSelect) {
      const freeEpisodes = this.episodes.filter(ep => !ep.charge);
      if (freeEpisodes.length > 0) {
        const selectAllBtn = leftSide.createEl('button');
        selectAllBtn.style.cssText = `
          padding: 6px 12px;
          border-radius: var(--button-radius);
          background: transparent;
          color: var(--text-accent);
          border: 1px solid var(--text-accent);
          cursor: pointer;
          font-size: var(--font-ui-smaller);
        `;
        selectAllBtn.setText(this.selectedEpisodes.size === freeEpisodes.length ? 'Deselect All' : 'Select All Free');
        selectAllBtn.addEventListener('click', () => {
          if (this.selectedEpisodes.size === freeEpisodes.length) {
            this.selectedEpisodes.clear();
          } else {
            freeEpisodes.forEach(ep => this.selectedEpisodes.add(ep.no));
          }
          this.renderEpisodeList();
          this.updateSelectionInfo();
          this.updateSubmitButton();
          selectAllBtn.setText(this.selectedEpisodes.size === freeEpisodes.length ? 'Deselect All' : 'Select All Free');
        });
      }
    }

    // Right side: Cancel and Submit buttons
    const rightSide = footer.createDiv();
    rightSide.style.cssText = 'display: flex; gap: 8px;';

    // Cancel button
    const cancelBtn = rightSide.createEl('button');
    cancelBtn.setText('Cancel');
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      border-radius: var(--button-radius);
      background: var(--background-modifier-hover);
      color: var(--text-normal);
      border: none;
      cursor: pointer;
    `;
    cancelBtn.addEventListener('click', () => this.close());

    // Submit button
    this.submitBtn = rightSide.createEl('button');
    this.submitBtn.setText(this.multiSelect ? 'Archive Selected' : 'Archive');
    this.submitBtn.disabled = true;
    this.submitBtn.style.cssText = `
      padding: 8px 16px;
      border-radius: var(--button-radius);
      background: #00DC64;
      color: white;
      border: none;
      cursor: pointer;
      font-weight: 500;
      opacity: 0.5;
    `;
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
      console.log('[WebtoonEpisodeSelectModal] Submitting selection:', selectedArray);

      await this.onSubmit({
        selectedEpisodes: selectedArray,
      });
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Archive failed';
      this.showError(message);
      this.submitBtn.disabled = false;
      this.submitBtn.setText(this.multiSelect ? 'Archive Selected' : 'Archive');
    } finally {
      this.isSubmitting = false;
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
