import { Modal, App, Platform } from 'obsidian';
import type { AuthorCatalogEntry } from '@/types/author-catalog';

/**
 * Naver subscription type
 */
export type NaverSubscriptionType = 'blog' | 'cafe-member';

/**
 * Naver Subscribe Options returned from modal
 */
export interface NaverSubscribeOptions {
  maxPostsPerRun: number;
  backfillDays: number;
  keyword: string;
}

/**
 * Initial values for edit mode
 */
export interface NaverSubscribeInitialValues {
  maxPostsPerRun?: number;
  backfillDays?: number;
  keyword?: string;
}

// Backward compatibility aliases
export type NaverCafeSubscribeOptions = NaverSubscribeOptions;
export type NaverCafeSubscribeInitialValues = NaverSubscribeInitialValues;

const MAX_POSTS_PER_RUN = {
  MIN: 1,
  MAX: 50,
  DEFAULT: 5,
};

const BACKFILL_DAYS_OPTIONS = [
  { value: 3, label: '3 days' },
  { value: 7, label: '1 week' },
  { value: 14, label: '2 weeks' },
  { value: 30, label: '1 month' },
  { value: 90, label: '3 months' },
];

/**
 * NaverSubscribeModal - Obsidian Native Modal for Naver Blog/Cafe Subscription
 *
 * Allows users to configure subscription options for Naver Blog or Cafe members:
 * - maxPostsPerRun: How many posts to fetch per polling cycle
 * - backfillDays: How far back to go on first sync
 * - keyword: Optional filter to only archive posts with specific keyword in title
 */
export class NaverSubscribeModal extends Modal {
  private author: AuthorCatalogEntry;
  private subscriptionType: NaverSubscriptionType;
  private isEditMode: boolean;
  private initialValues?: NaverSubscribeInitialValues;
  private onSubmit: (options: NaverSubscribeOptions) => Promise<void>;

  // Form state
  private maxPostsPerRun: number = MAX_POSTS_PER_RUN.DEFAULT;
  private backfillDays: number = 3;
  private keyword: string = '';

  // UI elements
  private submitBtn!: HTMLButtonElement;
  private errorContainer!: HTMLElement;
  private isSubmitting: boolean = false;

  constructor(
    app: App,
    author: AuthorCatalogEntry,
    onSubmit: (options: NaverSubscribeOptions) => Promise<void>,
    subscriptionType: NaverSubscriptionType = 'cafe-member',
    isEditMode: boolean = false,
    initialValues?: NaverSubscribeInitialValues
  ) {
    super(app);
    this.author = author;
    this.onSubmit = onSubmit;
    this.subscriptionType = subscriptionType;
    this.isEditMode = isEditMode;
    this.initialValues = initialValues;

    // Set initial values if provided
    if (initialValues) {
      this.maxPostsPerRun = initialValues.maxPostsPerRun ?? MAX_POSTS_PER_RUN.DEFAULT;
      this.backfillDays = initialValues.backfillDays ?? 3;
      this.keyword = initialValues.keyword ?? '';
    }
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Add modal class for styling
    modalEl.addClass('social-archiver-modal', 'naver-subscribe-modal');

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

    // Title based on subscription type
    const typeLabel = this.subscriptionType === 'blog' ? 'Naver Blog' : 'Cafe Member';
    const titleText = this.isEditMode ? 'Edit Subscription' : `Subscribe to ${typeLabel}`;
    contentEl.createEl('h2', { text: titleText });

    // Profile card
    this.renderProfileCard(contentEl);

    // Error container (hidden by default)
    this.errorContainer = contentEl.createDiv({ cls: 'naver-error-container' });
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
    const card = container.createDiv({ cls: 'naver-profile-card' });
    card.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--background-secondary);
      border-radius: 8px;
      margin-bottom: 16px;
    `;

    // Avatar - use author avatar or Naver green
    const avatar = card.createDiv({ cls: 'naver-avatar' });
    avatar.style.cssText = `
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #03C75A;
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
        avatar.innerHTML = '<span style="color: white; font-weight: bold; font-size: 18px;">N</span>';
      };
    } else {
      avatar.innerHTML = '<span style="color: white; font-weight: bold; font-size: 18px;">N</span>';
    }

    // Info
    const info = card.createDiv({ cls: 'naver-info' });

    const name = info.createDiv({ cls: 'naver-name' });
    name.style.cssText = 'font-weight: 600; color: var(--text-normal);';
    const defaultName = this.subscriptionType === 'blog' ? 'Blog Author' : 'Cafe Member';
    name.setText(this.author.authorName || defaultName);

    const platform = info.createDiv({ cls: 'naver-platform' });
    platform.style.cssText = 'font-size: var(--font-smaller); color: var(--text-muted); margin-top: 2px;';
    platform.setText(this.subscriptionType === 'blog' ? 'Naver Blog' : 'Naver Cafe');

    if (this.author.archiveCount > 0) {
      const stats = info.createDiv({ cls: 'naver-stats' });
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
    const optionsContainer = container.createDiv({ cls: 'naver-options' });

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

      // Hint text
      const hint = optionsContainer.createDiv();
      hint.style.cssText = 'font-size: var(--font-ui-smaller); color: var(--text-muted); margin-top: 4px;';
      hint.setText('Only posts with this keyword in title will be archived.');

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
    }
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv({ cls: 'naver-footer' });
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
      console.log('[NaverSubscribeModal] Submitting options:', {
        maxPostsPerRun: this.maxPostsPerRun,
        backfillDays: this.backfillDays,
        keyword: this.keyword,
      });
      await this.onSubmit({
        maxPostsPerRun: this.maxPostsPerRun,
        backfillDays: this.backfillDays,
        keyword: this.keyword,
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

// Backward compatibility - keep old class name as alias
export { NaverSubscribeModal as NaverCafeSubscribeModal };
