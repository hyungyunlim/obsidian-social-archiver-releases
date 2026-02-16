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
      modalEl.style.setProperty('width', '92vw', 'important');
      modalEl.style.setProperty('max-width', '92vw', 'important');
      modalEl.style.setProperty('height', 'auto', 'important');
      modalEl.style.setProperty('max-height', '90vh', 'important');
      modalEl.style.setProperty('overflow-y', 'auto', 'important');

      contentEl.style.paddingLeft = '12px';
      contentEl.style.paddingRight = '12px';
    }

    // Title
    const titleText = this.isEditMode ? 'Edit Subscription' : 'Subscribe to Brunch Author';
    contentEl.createEl('h2', { text: titleText });

    // Profile card
    this.renderProfileCard(contentEl);

    // Error container (hidden by default)
    this.errorContainer = contentEl.createDiv({ cls: 'brunch-error-container' });
    this.errorContainer.style.display = 'none';

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
    card.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--background-secondary);
      border-radius: 8px;
      margin-bottom: 16px;
    `;

    // Avatar - use author avatar or Kakao green (Brunch is a Kakao service)
    const avatar = card.createDiv({ cls: 'brunch-avatar' });
    avatar.style.cssText = `
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #00C473;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
    `;

    if (this.author.avatar) {
      const img = avatar.createEl('img');
      img.src = this.author.avatar;
      img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
      img.onerror = () => {
        img.remove();
        avatar.innerHTML = '<span style="color: white; font-weight: bold; font-size: 18px;">B</span>';
      };
    } else {
      avatar.innerHTML = '<span style="color: white; font-weight: bold; font-size: 18px;">B</span>';
    }

    // Info
    const info = card.createDiv({ cls: 'brunch-info' });

    const name = info.createDiv({ cls: 'brunch-name' });
    name.style.cssText = 'font-weight: 600; color: var(--text-normal);';
    name.setText(this.author.authorName || 'Brunch Author');

    const platform = info.createDiv({ cls: 'brunch-platform' });
    platform.style.cssText = 'font-size: var(--font-smaller); color: var(--text-muted); margin-top: 2px;';
    platform.setText('Brunch (brunch.co.kr)');

    if (this.author.archiveCount > 0) {
      const stats = info.createDiv({ cls: 'brunch-stats' });
      stats.style.cssText = 'font-size: var(--font-smaller); color: var(--text-muted); margin-top: 2px;';
      stats.setText(`${this.author.archiveCount} archived posts`);
    }
  }

  private showError(message: string): void {
    this.errorContainer.empty();
    this.errorContainer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      margin-bottom: 12px;
    `;

    const messageText = this.errorContainer.createDiv();
    messageText.textContent = message;
    messageText.style.cssText = `
      margin: 0;
      color: var(--text-error);
      font-size: var(--font-ui-small);
      line-height: 1.4;
    `;
  }

  private hideError(): void {
    this.errorContainer.style.display = 'none';
    this.errorContainer.empty();
  }

  private renderOptions(container: HTMLElement): void {
    const optionsContainer = container.createDiv({ cls: 'brunch-options' });

    if (Platform.isMobile) {
      // Mobile: Compact custom layout
      optionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 14px;';

      const rowStyle = 'display: flex; align-items: center; justify-content: space-between; gap: 12px;';
      const labelStyle = 'font-size: var(--font-ui-small); color: var(--text-normal); flex-shrink: 0;';
      const inputStyle = `
        height: 28px;
        padding: 0 8px;
        border-radius: var(--input-radius);
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-form-field);
        color: var(--text-normal);
        font-size: var(--font-ui-smaller);
        -webkit-appearance: none;
      `;

      // Row 1: Max posts per run
      const maxPostsRow = optionsContainer.createDiv();
      maxPostsRow.style.cssText = rowStyle;
      const maxPostsLabel = maxPostsRow.createEl('label');
      maxPostsLabel.style.cssText = labelStyle;
      maxPostsLabel.setText('Posts per run');
      const maxPostsInput = maxPostsRow.createEl('input', { type: 'number' });
      maxPostsInput.style.cssText = inputStyle + 'width: 70px; text-align: center;';
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
      backfillRow.style.cssText = rowStyle;
      const backfillLabel = backfillRow.createEl('label');
      backfillLabel.style.cssText = labelStyle;
      backfillLabel.setText('Initial sync period');
      const backfillSelect = backfillRow.createEl('select');
      backfillSelect.style.cssText = inputStyle + 'width: 110px;';
      BACKFILL_DAYS_OPTIONS.forEach(opt => {
        const option = backfillSelect.createEl('option', { value: String(opt.value), text: opt.label });
        if (opt.value === this.backfillDays) option.selected = true;
      });
      backfillSelect.addEventListener('change', () => {
        this.backfillDays = parseInt(backfillSelect.value, 10);
      });

      // Row 3: Keyword filter
      const keywordRow = optionsContainer.createDiv();
      keywordRow.style.cssText = rowStyle;
      const keywordLabel = keywordRow.createEl('label');
      keywordLabel.style.cssText = labelStyle;
      keywordLabel.setText('Keyword filter');
      const keywordInput = keywordRow.createEl('input', { type: 'text' });
      keywordInput.style.cssText = inputStyle + 'flex: 1; min-width: 100px;';
      keywordInput.placeholder = 'Optional';
      keywordInput.value = this.keyword;
      keywordInput.addEventListener('input', () => {
        this.keyword = keywordInput.value.trim();
      });

      // Row 4: Include comments (toggle)
      const commentsRow = optionsContainer.createDiv();
      commentsRow.style.cssText = rowStyle;
      const commentsLabel = commentsRow.createEl('label');
      commentsLabel.style.cssText = labelStyle;
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
      optionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 16px;';

      const rowStyle = 'display: flex; align-items: center; justify-content: space-between; gap: 16px;';
      const labelStyle = 'font-size: var(--font-ui-small); color: var(--text-normal);';
      const inputStyle = `
        height: 32px;
        padding: 0 10px;
        border-radius: var(--input-radius);
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-form-field);
        color: var(--text-normal);
        font-size: var(--font-ui-small);
      `;

      // Row 1: Max posts per run
      const maxPostsRow = optionsContainer.createDiv();
      maxPostsRow.style.cssText = rowStyle;
      const maxPostsLabel = maxPostsRow.createEl('label');
      maxPostsLabel.style.cssText = labelStyle;
      maxPostsLabel.setText('Posts per run (max 50)');
      const maxPostsInput = maxPostsRow.createEl('input', { type: 'number' });
      maxPostsInput.style.cssText = inputStyle + 'width: 80px; text-align: center;';
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
      backfillRow.style.cssText = rowStyle;
      const backfillLabel = backfillRow.createEl('label');
      backfillLabel.style.cssText = labelStyle;
      backfillLabel.setText('Initial sync period');
      const backfillSelect = backfillRow.createEl('select');
      backfillSelect.style.cssText = inputStyle + 'width: 120px;';
      BACKFILL_DAYS_OPTIONS.forEach(opt => {
        const option = backfillSelect.createEl('option', { value: String(opt.value), text: opt.label });
        if (opt.value === this.backfillDays) option.selected = true;
      });
      backfillSelect.addEventListener('change', () => {
        this.backfillDays = parseInt(backfillSelect.value, 10);
      });

      // Row 3: Keyword filter
      const keywordRow = optionsContainer.createDiv();
      keywordRow.style.cssText = rowStyle;
      const keywordLabelContainer = keywordRow.createDiv();
      const keywordLabel = keywordLabelContainer.createEl('label');
      keywordLabel.style.cssText = labelStyle;
      keywordLabel.setText('Keyword filter (optional)');
      const keywordHint = keywordLabelContainer.createDiv();
      keywordHint.style.cssText = 'font-size: var(--font-ui-smaller); color: var(--text-muted); margin-top: 2px;';
      keywordHint.setText('Only archive posts with this keyword in title');
      const keywordInput = keywordRow.createEl('input', { type: 'text' });
      keywordInput.style.cssText = inputStyle + 'width: 150px;';
      keywordInput.placeholder = 'e.g., review';
      keywordInput.value = this.keyword;
      keywordInput.addEventListener('input', () => {
        this.keyword = keywordInput.value.trim();
      });

      // Row 4: Include comments (toggle)
      const commentsRow = optionsContainer.createDiv();
      commentsRow.style.cssText = rowStyle;
      const commentsLabelContainer = commentsRow.createDiv();
      const commentsLabel = commentsLabelContainer.createEl('label');
      commentsLabel.style.cssText = labelStyle;
      commentsLabel.setText('Include comments');
      const commentsHint = commentsLabelContainer.createDiv();
      commentsHint.style.cssText = 'font-size: var(--font-ui-smaller); color: var(--text-muted); margin-top: 2px;';
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
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--background-modifier-border);
    `;

    // Cancel button
    const cancelBtn = footer.createEl('button');
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
    this.submitBtn = footer.createEl('button');
    this.submitBtn.setText(this.isEditMode ? 'Save' : 'Subscribe');
    this.submitBtn.style.cssText = `
      padding: 8px 16px;
      border-radius: var(--button-radius);
      background: var(--interactive-accent);
      color: var(--text-on-accent);
      border: none;
      cursor: pointer;
      font-weight: 500;
    `;
    this.submitBtn.addEventListener('click', () => void this.handleSubmit());
  }

  private async handleSubmit(): Promise<void> {
    if (this.isSubmitting) return;

    this.isSubmitting = true;
    this.submitBtn.disabled = true;
    this.submitBtn.setText('Processing...');
    this.hideError();

    try {
      console.log('[BrunchSubscribeModal] Submitting options:', {
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
