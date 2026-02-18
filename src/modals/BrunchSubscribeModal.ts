import { Modal, App, Platform } from 'obsidian';
import type { AuthorCatalogEntry } from '@/types/author-catalog';

/**
 * Brunch Subscribe Options returned from modal
 */
export interface BrunchSubscribeOptions {
  maxPostsPerRun: number;
  backfillDays: number;
  keyword: string;
  includeComments: boolean;
}

/**
 * Initial values for edit mode
 */
export interface BrunchSubscribeInitialValues {
  maxPostsPerRun?: number;
  backfillDays?: number;
  keyword?: string;
  includeComments?: boolean;
}

const MAX_POSTS_PER_RUN = {
  MIN: 1,
  MAX: 50,
  DEFAULT: 10,
};

const BACKFILL_DAYS_OPTIONS = [
  { value: 3, label: '3 days' },
  { value: 7, label: '1 week' },
  { value: 14, label: '2 weeks' },
  { value: 30, label: '1 month' },
  { value: 90, label: '3 months' },
];

/**
 * BrunchSubscribeModal - Obsidian Native Modal for Brunch Author Subscription
 *
 * Allows users to configure subscription options for Brunch authors:
 * - maxPostsPerRun: How many posts to fetch per polling cycle
 * - backfillDays: How far back to go on first sync
 * - keyword: Optional filter to only archive posts with specific keyword in title
 * - includeComments: Whether to fetch and include comments
 */
export class BrunchSubscribeModal extends Modal {
  private author: AuthorCatalogEntry;
  private isEditMode: boolean;
  private initialValues?: BrunchSubscribeInitialValues;
  private onSubmit: (options: BrunchSubscribeOptions) => Promise<void>;

  // Form state
  private maxPostsPerRun: number = MAX_POSTS_PER_RUN.DEFAULT;
  private backfillDays: number = 7;
  private keyword: string = '';
  private includeComments: boolean = true;

  // UI elements
  private submitBtn!: HTMLButtonElement;
  private errorContainer!: HTMLElement;
  private isSubmitting: boolean = false;

  constructor(
    app: App,
    author: AuthorCatalogEntry,
    onSubmit: (options: BrunchSubscribeOptions) => Promise<void>,
    isEditMode: boolean = false,
    initialValues?: BrunchSubscribeInitialValues
  ) {
    super(app);
    this.author = author;
    this.onSubmit = onSubmit;
    this.isEditMode = isEditMode;
    this.initialValues = initialValues;

    // Set initial values if provided
    if (initialValues) {
      this.maxPostsPerRun = initialValues.maxPostsPerRun ?? MAX_POSTS_PER_RUN.DEFAULT;
      this.backfillDays = initialValues.backfillDays ?? 7;
      this.keyword = initialValues.keyword ?? '';
      this.includeComments = initialValues.includeComments ?? true;
    }
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Add modal class for styling
    modalEl.addClass('social-archiver-modal', 'brunch-subscribe-modal');

    // Mobile modal size adjustments
    if (Platform.isMobile) {
      modalEl.addClass('am-modal--mobile');
      contentEl.addClass('am-content--mobile');
    }

    // Title
    const titleText = this.isEditMode ? 'Edit subscription' : 'Subscribe to Brunch author';
    contentEl.createEl('h2', { text: titleText });

    // Profile card
    this.renderProfileCard(contentEl);

    // Error container (hidden by default)
    this.errorContainer = contentEl.createDiv({ cls: 'brunch-error-container' });
    this.errorContainer.addClass('sa-hidden');

    // Options
    this.renderOptions(contentEl);

    // Footer buttons
    this.renderFooter(contentEl);

    // Keyboard shortcuts
    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });

    this.scope.register(['Mod'], 'Enter', () => {
      if (!this.isSubmitting) {
        void this.handleSubmit();
      }
      return false;
    });
  }

  private renderProfileCard(container: HTMLElement): void {
    const card = container.createDiv({ cls: 'brunch-profile-card' });
    card.addClass('sa-flex-row', 'sa-gap-12', 'sa-p-12', 'sa-bg-secondary', 'sa-rounded-8', 'sa-mb-16');

    // Avatar - use author avatar or Kakao green (Brunch is a Kakao service)
    const avatar = card.createDiv({ cls: 'brunch-avatar' });
    avatar.addClass('sa-rounded-full', 'sa-flex-center', 'sa-flex-shrink-0', 'sa-overflow-hidden');
    avatar.setCssProps({'--sa-width': '44px', '--sa-height': '44px', '--sa-bg': '#00C473'});
    avatar.addClass('sa-dynamic-width', 'sa-dynamic-height', 'sa-dynamic-bg');

    if (this.author.avatar) {
      const img = avatar.createEl('img');
      img.src = this.author.avatar;
      img.addClass('sa-cover');
      img.onerror = () => {
        img.remove();
        const span = avatar.createSpan({ text: 'B' });
        span.addClass('bsm-avatar-letter');
      };
    } else {
      const span = avatar.createSpan({ text: 'B' });
      span.addClass('bsm-avatar-letter');
    }

    // Info
    const info = card.createDiv({ cls: 'brunch-info' });

    const name = info.createDiv({ cls: 'brunch-name' });
    name.addClass('sa-font-semibold', 'sa-text-normal');
    name.setText(this.author.authorName || 'Brunch Author');

    const platform = info.createDiv({ cls: 'brunch-platform' });
    platform.addClass('sa-text-sm', 'sa-text-muted', 'sa-mt-2');
    platform.setText('Brunch (brunch.co.kr)');

    if (this.author.archiveCount > 0) {
      const stats = info.createDiv({ cls: 'brunch-stats' });
      stats.addClass('sa-text-sm', 'sa-text-muted', 'sa-mt-2');
      stats.setText(`${this.author.archiveCount} archived posts`);
    }
  }

  private showError(message: string): void {
    this.errorContainer.empty();
    this.errorContainer.removeClass('sa-hidden');
    this.errorContainer.addClass('sa-flex-between', 'sa-gap-12', 'sa-py-8', 'sa-px-12', 'sa-mb-12');

    const messageText = this.errorContainer.createDiv();
    messageText.textContent = message;
    messageText.addClass('sa-m-0', 'sa-text-error', 'sa-text-sm', 'bsm-error-message');
  }

  private hideError(): void {
    this.errorContainer.addClass('sa-hidden');
    this.errorContainer.empty();
  }

  private renderOptions(container: HTMLElement): void {
    const optionsContainer = container.createDiv({ cls: 'brunch-options' });

    if (Platform.isMobile) {
      // Mobile: Compact custom layout
      optionsContainer.addClass('sa-flex-col', 'sa-gap-16');

      // Row 1: Max posts per run
      const maxPostsRow = optionsContainer.createDiv();
      maxPostsRow.addClass('sa-flex-between', 'sa-gap-12');
      const maxPostsLabel = maxPostsRow.createEl('label');
      maxPostsLabel.addClass('sa-text-sm', 'sa-text-normal', 'sa-flex-shrink-0');
      maxPostsLabel.setText('Posts per run');
      const maxPostsInput = maxPostsRow.createEl('input', { type: 'number' });
      maxPostsInput.addClass('sa-px-8', 'sa-text-xs', 'sa-text-center', 'sa-border', 'bsm-mobile-input');
      maxPostsInput.setCssProps({'--sa-height': '28px', '--sa-width': '70px', '--sa-bg': 'var(--background-modifier-form-field)'});
      maxPostsInput.addClass('sa-dynamic-height', 'sa-dynamic-width', 'sa-dynamic-bg', 'sa-text-normal');
      maxPostsInput.min = String(MAX_POSTS_PER_RUN.MIN);
      maxPostsInput.max = String(MAX_POSTS_PER_RUN.MAX);
      maxPostsInput.value = String(this.maxPostsPerRun);
      maxPostsInput.addEventListener('change', () => {
        const val = parseInt(maxPostsInput.value, 10);
        this.maxPostsPerRun = Math.max(MAX_POSTS_PER_RUN.MIN, Math.min(MAX_POSTS_PER_RUN.MAX, val));
        maxPostsInput.value = String(this.maxPostsPerRun);
      });

      // Row 2: Backfill days
      const backfillRow = optionsContainer.createDiv();
      backfillRow.addClass('sa-flex-between', 'sa-gap-12');
      const backfillLabel = backfillRow.createEl('label');
      backfillLabel.addClass('sa-text-sm', 'sa-text-normal', 'sa-flex-shrink-0');
      backfillLabel.setText('Initial sync period');
      const backfillSelect = backfillRow.createEl('select');
      backfillSelect.addClass('sa-px-8', 'sa-text-xs', 'sa-border', 'bsm-mobile-input');
      backfillSelect.setCssProps({'--sa-height': '28px', '--sa-width': '110px', '--sa-bg': 'var(--background-modifier-form-field)'});
      backfillSelect.addClass('sa-dynamic-height', 'sa-dynamic-width', 'sa-dynamic-bg', 'sa-text-normal');
      BACKFILL_DAYS_OPTIONS.forEach(opt => {
        const option = backfillSelect.createEl('option', { value: String(opt.value), text: opt.label });
        if (opt.value === this.backfillDays) option.selected = true;
      });
      backfillSelect.addEventListener('change', () => {
        this.backfillDays = parseInt(backfillSelect.value, 10);
      });

      // Row 3: Keyword filter
      const keywordRow = optionsContainer.createDiv();
      keywordRow.addClass('sa-flex-between', 'sa-gap-12');
      const keywordLabel = keywordRow.createEl('label');
      keywordLabel.addClass('sa-text-sm', 'sa-text-normal', 'sa-flex-shrink-0');
      keywordLabel.setText('Keyword filter');
      const keywordInput = keywordRow.createEl('input', { type: 'text' });
      keywordInput.addClass('sa-flex-1', 'sa-px-8', 'sa-text-xs', 'sa-border', 'bsm-mobile-input');
      keywordInput.setCssProps({'--sa-height': '28px', '--sa-bg': 'var(--background-modifier-form-field)'});
      keywordInput.addClass('sa-dynamic-height', 'sa-dynamic-bg', 'sa-text-normal');
      keywordInput.placeholder = 'Optional';
      keywordInput.value = this.keyword;
      keywordInput.addEventListener('input', () => {
        this.keyword = keywordInput.value.trim();
      });

      // Row 4: Include comments (toggle)
      const commentsRow = optionsContainer.createDiv();
      commentsRow.addClass('sa-flex-between', 'sa-gap-12');
      const commentsLabel = commentsRow.createEl('label');
      commentsLabel.addClass('sa-text-sm', 'sa-text-normal', 'sa-flex-shrink-0');
      commentsLabel.setText('Include comments');

      const toggleContainer = commentsRow.createDiv({ cls: 'checkbox-container' });
      if (this.includeComments) {
        toggleContainer.addClass('is-enabled');
      }
      toggleContainer.addEventListener('click', () => {
        this.includeComments = !this.includeComments;
        toggleContainer.toggleClass('is-enabled', this.includeComments);
      });

    } else {
      // Desktop: Similar layout but with more spacing
      optionsContainer.addClass('sa-flex-col', 'sa-gap-16');

      // Row 1: Max posts per run
      const maxPostsRow = optionsContainer.createDiv();
      maxPostsRow.addClass('sa-flex-between', 'sa-gap-16');
      const maxPostsLabel = maxPostsRow.createEl('label');
      maxPostsLabel.addClass('sa-text-sm', 'sa-text-normal');
      maxPostsLabel.setText('Posts per run (max 50)');
      const maxPostsInput = maxPostsRow.createEl('input', { type: 'number' });
      maxPostsInput.addClass('sa-px-10', 'sa-text-sm', 'sa-text-center', 'sa-border', 'bsm-mobile-input');
      maxPostsInput.setCssProps({'--sa-height': '32px', '--sa-width': '80px', '--sa-bg': 'var(--background-modifier-form-field)'});
      maxPostsInput.addClass('sa-dynamic-height', 'sa-dynamic-width', 'sa-dynamic-bg', 'sa-text-normal');
      maxPostsInput.min = String(MAX_POSTS_PER_RUN.MIN);
      maxPostsInput.max = String(MAX_POSTS_PER_RUN.MAX);
      maxPostsInput.value = String(this.maxPostsPerRun);
      maxPostsInput.addEventListener('change', () => {
        const val = parseInt(maxPostsInput.value, 10);
        this.maxPostsPerRun = Math.max(MAX_POSTS_PER_RUN.MIN, Math.min(MAX_POSTS_PER_RUN.MAX, val));
        maxPostsInput.value = String(this.maxPostsPerRun);
      });

      // Row 2: Backfill days
      const backfillRow = optionsContainer.createDiv();
      backfillRow.addClass('sa-flex-between', 'sa-gap-16');
      const backfillLabel = backfillRow.createEl('label');
      backfillLabel.addClass('sa-text-sm', 'sa-text-normal');
      backfillLabel.setText('Initial sync period');
      const backfillSelect = backfillRow.createEl('select');
      backfillSelect.addClass('sa-px-10', 'sa-text-sm', 'sa-border', 'bsm-mobile-input');
      backfillSelect.setCssProps({'--sa-height': '32px', '--sa-width': '120px', '--sa-bg': 'var(--background-modifier-form-field)'});
      backfillSelect.addClass('sa-dynamic-height', 'sa-dynamic-width', 'sa-dynamic-bg', 'sa-text-normal');
      BACKFILL_DAYS_OPTIONS.forEach(opt => {
        const option = backfillSelect.createEl('option', { value: String(opt.value), text: opt.label });
        if (opt.value === this.backfillDays) option.selected = true;
      });
      backfillSelect.addEventListener('change', () => {
        this.backfillDays = parseInt(backfillSelect.value, 10);
      });

      // Row 3: Keyword filter
      const keywordRow = optionsContainer.createDiv();
      keywordRow.addClass('sa-flex-between', 'sa-gap-16');
      const keywordLabelContainer = keywordRow.createDiv();
      const keywordLabel = keywordLabelContainer.createEl('label');
      keywordLabel.addClass('sa-text-sm', 'sa-text-normal');
      keywordLabel.setText('Keyword filter (optional)');
      const keywordHint = keywordLabelContainer.createDiv();
      keywordHint.addClass('sa-text-xs', 'sa-text-muted', 'sa-mt-2');
      keywordHint.setText('Only archive posts with this keyword in title');
      const keywordInput = keywordRow.createEl('input', { type: 'text' });
      keywordInput.addClass('sa-px-10', 'sa-text-sm', 'sa-border', 'bsm-mobile-input');
      keywordInput.setCssProps({'--sa-height': '32px', '--sa-width': '150px', '--sa-bg': 'var(--background-modifier-form-field)'});
      keywordInput.addClass('sa-dynamic-height', 'sa-dynamic-width', 'sa-dynamic-bg', 'sa-text-normal');
      keywordInput.placeholder = 'e.g., review';
      keywordInput.value = this.keyword;
      keywordInput.addEventListener('input', () => {
        this.keyword = keywordInput.value.trim();
      });

      // Row 4: Include comments (toggle)
      const commentsRow = optionsContainer.createDiv();
      commentsRow.addClass('sa-flex-between', 'sa-gap-16');
      const commentsLabelContainer = commentsRow.createDiv();
      const commentsLabel = commentsLabelContainer.createEl('label');
      commentsLabel.addClass('sa-text-sm', 'sa-text-normal');
      commentsLabel.setText('Include comments');
      const commentsHint = commentsLabelContainer.createDiv();
      commentsHint.addClass('sa-text-xs', 'sa-text-muted', 'sa-mt-2');
      commentsHint.setText('Fetch and archive post comments');

      const toggleContainer = commentsRow.createDiv({ cls: 'checkbox-container' });
      if (this.includeComments) {
        toggleContainer.addClass('is-enabled');
      }
      toggleContainer.addEventListener('click', () => {
        this.includeComments = !this.includeComments;
        toggleContainer.toggleClass('is-enabled', this.includeComments);
      });
    }
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv({ cls: 'brunch-footer' });
    footer.addClass('sa-flex', 'sa-gap-8', 'sa-mt-20', 'bsm-footer');

    // Cancel button
    const cancelBtn = footer.createEl('button');
    cancelBtn.setText('Cancel');
    cancelBtn.addClass('sa-py-8', 'sa-px-16', 'sa-bg-hover', 'sa-text-normal', 'sa-clickable', 'bsm-btn');
    cancelBtn.addEventListener('click', () => this.close());

    // Submit button
    this.submitBtn = footer.createEl('button');
    this.submitBtn.setText(this.isEditMode ? 'Save' : 'Subscribe');
    this.submitBtn.addClass('sa-py-8', 'sa-px-16', 'sa-clickable', 'sa-font-medium', 'bsm-btn');
    this.submitBtn.setCssProps({'--sa-bg': 'var(--interactive-accent)', '--sa-color': 'var(--text-on-accent)'});
    this.submitBtn.addClass('sa-dynamic-bg', 'sa-dynamic-color');
    this.submitBtn.addEventListener('click', () => void this.handleSubmit());
  }

  private async handleSubmit(): Promise<void> {
    if (this.isSubmitting) return;

    this.isSubmitting = true;
    this.submitBtn.disabled = true;
    this.submitBtn.setText('Processing...');
    this.hideError();

    try {
      console.debug('[BrunchSubscribeModal] Submitting options:', {
        maxPostsPerRun: this.maxPostsPerRun,
        backfillDays: this.backfillDays,
        keyword: this.keyword,
        includeComments: this.includeComments,
      });
      await this.onSubmit({
        maxPostsPerRun: this.maxPostsPerRun,
        backfillDays: this.backfillDays,
        keyword: this.keyword,
        includeComments: this.includeComments,
      });
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Subscription failed';
      this.showError(message);
      this.submitBtn.disabled = false;
      this.submitBtn.setText(this.isEditMode ? 'Save' : 'Subscribe');
    } finally {
      this.isSubmitting = false;
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
