import { Modal, App, Platform, Setting } from 'obsidian';
import type { AuthorCatalogEntry } from '@/types/author-catalog';
import { siReddit } from '@/constants/platform-icons';

/**
 * Reddit Subscribe Options returned from modal
 */
export interface RedditSubscribeOptions {
  sortBy: 'Best' | 'Hot' | 'New' | 'Top' | 'Rising';
  sortByTime: 'Now' | 'Today' | 'This Week' | 'This Month' | 'This Year' | 'All Time' | '';
  keyword: string;
  maxPostsPerRun: number;
}

/**
 * Initial values for edit mode
 */
export interface RedditSubscribeInitialValues {
  sortBy?: 'Best' | 'Hot' | 'New' | 'Top' | 'Rising';
  sortByTime?: 'Now' | 'Today' | 'This Week' | 'This Month' | 'This Year' | 'All Time' | '';
  keyword?: string;
  maxPostsPerRun?: number;
}

// Sort options for subreddits (no Best)
const SORT_BY_OPTIONS_SUBREDDIT = [
  { value: 'Hot', label: 'Hot' },
  { value: 'New', label: 'New' },
  { value: 'Top', label: 'Top' },
  { value: 'Rising', label: 'Rising' },
];

// Sort options for user profiles (includes Best)
const SORT_BY_OPTIONS_USER = [
  { value: 'Best', label: 'Best' },
  { value: 'Hot', label: 'Hot' },
  { value: 'New', label: 'New' },
  { value: 'Top', label: 'Top' },
  { value: 'Rising', label: 'Rising' },
];

const TIME_RANGE_OPTIONS = [
  { value: 'Now', label: 'Now' },
  { value: 'Today', label: 'Today' },
  { value: 'This Week', label: 'This Week' },
  { value: 'This Month', label: 'This Month' },
  { value: 'This Year', label: 'This Year' },
  { value: 'All Time', label: 'All Time' },
];

const MAX_POSTS_PER_RUN = {
  MIN: 1,
  MAX: 20,
  DEFAULT: 20,
};

/**
 * RedditSubscribeModal - Obsidian Native Modal for Reddit Subscription
 *
 * Uses Obsidian's built-in Modal with custom layout (no Setting class to avoid dividers).
 * Matches the design pattern of ArchiveModal.
 */
export class RedditSubscribeModal extends Modal {
  private author: AuthorCatalogEntry;
  private isEditMode: boolean;
  private initialValues?: RedditSubscribeInitialValues;
  private onSubmit: (options: RedditSubscribeOptions) => Promise<void>;
  private isUserProfile: boolean;

  // Form state
  private sortBy: 'Best' | 'Hot' | 'New' | 'Top' | 'Rising' = 'New';
  private sortByTime: 'Now' | 'Today' | 'This Week' | 'This Month' | 'This Year' | 'All Time' | '' = 'Today';
  private keyword: string = '';
  private maxPostsPerRun: number = MAX_POSTS_PER_RUN.DEFAULT;

  // UI elements
  private submitBtn!: HTMLButtonElement;
  private errorContainer!: HTMLElement;
  private isSubmitting: boolean = false;

  constructor(
    app: App,
    author: AuthorCatalogEntry,
    onSubmit: (options: RedditSubscribeOptions) => Promise<void>,
    isEditMode: boolean = false,
    initialValues?: RedditSubscribeInitialValues
  ) {
    super(app);
    this.author = author;
    this.onSubmit = onSubmit;
    this.isEditMode = isEditMode;
    this.initialValues = initialValues;

    // Detect if this is a user profile (not a subreddit)
    const authorUrl = author.authorUrl ?? '';
    this.isUserProfile = authorUrl.includes('/user/') || authorUrl.includes('/u/');

    // Set initial values if provided
    if (initialValues) {
      this.sortBy = initialValues.sortBy ?? 'New';
      this.sortByTime = initialValues.sortByTime || 'Today';
      this.keyword = initialValues.keyword ?? '';
      this.maxPostsPerRun = initialValues.maxPostsPerRun ?? MAX_POSTS_PER_RUN.DEFAULT;
    }
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Add modal class for styling
    modalEl.addClass('social-archiver-modal', 'reddit-subscribe-modal');

    // Mobile modal size adjustments (same as ArchiveModal)
    if (Platform.isMobile) {
      modalEl.style.setProperty('width', '92vw', 'important');
      modalEl.style.setProperty('max-width', '92vw', 'important');
      modalEl.style.setProperty('height', 'auto', 'important');
      modalEl.style.setProperty('max-height', '90vh', 'important');
      modalEl.style.setProperty('overflow-y', 'auto', 'important');

      contentEl.style.paddingLeft = '12px';
      contentEl.style.paddingRight = '12px';
    }

    // Title - different text for subreddits vs user profiles
    const titleText = this.isEditMode
      ? 'Edit Subscription'
      : this.isUserProfile
        ? 'Subscribe to User'
        : 'Subscribe to Subreddit';
    contentEl.createEl('h2', { text: titleText });

    // Profile card
    this.renderProfileCard(contentEl);

    // Error container (hidden by default)
    this.errorContainer = contentEl.createDiv({ cls: 'reddit-error-container' });
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
    const card = container.createDiv({ cls: 'reddit-profile-card' });
    card.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--background-secondary);
      border-radius: 8px;
      margin-bottom: 16px;
    `;

    // Avatar with Reddit icon
    const avatar = card.createDiv({ cls: 'reddit-avatar' });
    avatar.style.cssText = `
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #FF4500;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    `;
    avatar.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="${siReddit.path}"/></svg>`;

    // Info
    const info = card.createDiv({ cls: 'reddit-info' });

    const name = info.createDiv({ cls: 'reddit-name' });
    name.style.cssText = 'font-weight: 600; color: var(--text-normal);';
    name.setText(this.author.authorName || 'Unknown');

    if (this.author.archiveCount > 0) {
      const stats = info.createDiv({ cls: 'reddit-stats' });
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
    const optionsContainer = container.createDiv({ cls: 'reddit-options' });

    if (Platform.isMobile) {
      // Mobile: Compact custom layout (same as ArchiveModal)
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

      // Row 1: Sort by
      const sortByRow = optionsContainer.createDiv();
      sortByRow.style.cssText = rowStyle;

      const sortByLabel = sortByRow.createEl('label', { text: 'Sort by' });
      sortByLabel.style.cssText = labelStyle;

      const sortBySelect = sortByRow.createEl('select');
      sortBySelect.style.cssText = inputStyle + 'min-width: 100px; padding-right: 24px;';
      const sortByOptions = this.isUserProfile ? SORT_BY_OPTIONS_USER : SORT_BY_OPTIONS_SUBREDDIT;
      for (const opt of sortByOptions) {
        const option = sortBySelect.createEl('option', { value: opt.value, text: opt.label });
        if (opt.value === this.sortBy) option.selected = true;
      }
      sortBySelect.addEventListener('change', (e) => {
        this.sortBy = (e.target as HTMLSelectElement).value as typeof this.sortBy;
      });

      // Row 2: Time range
      const timeRangeRow = optionsContainer.createDiv();
      timeRangeRow.style.cssText = rowStyle;

      const timeRangeLabel = timeRangeRow.createEl('label', { text: 'Time range' });
      timeRangeLabel.style.cssText = labelStyle;

      const timeRangeSelect = timeRangeRow.createEl('select');
      timeRangeSelect.style.cssText = inputStyle + 'min-width: 120px; padding-right: 24px;';
      for (const opt of TIME_RANGE_OPTIONS) {
        const option = timeRangeSelect.createEl('option', { value: opt.value, text: opt.label });
        if (opt.value === this.sortByTime) option.selected = true;
      }
      timeRangeSelect.addEventListener('change', (e) => {
        this.sortByTime = (e.target as HTMLSelectElement).value as typeof this.sortByTime;
      });

      // Row 3: Keyword filter
      const keywordRow = optionsContainer.createDiv();
      keywordRow.style.cssText = rowStyle;

      const keywordLabel = keywordRow.createEl('label', { text: 'Keyword filter' });
      keywordLabel.style.cssText = labelStyle;

      const keywordInput = keywordRow.createEl('input', {
        type: 'text',
        placeholder: 'Optional',
        value: this.keyword
      });
      keywordInput.style.cssText = inputStyle + 'flex: 1; min-width: 80px;';
      keywordInput.addEventListener('input', (e) => {
        this.keyword = (e.target as HTMLInputElement).value;
      });

      // Row 4: Posts per run
      const postsRow = optionsContainer.createDiv();
      postsRow.style.cssText = rowStyle;

      const postsLabel = postsRow.createEl('label', { text: `Posts per run (max ${MAX_POSTS_PER_RUN.MAX})` });
      postsLabel.style.cssText = labelStyle;

      const postsInput = postsRow.createEl('input', {
        type: 'number',
        value: String(this.maxPostsPerRun)
      });
      postsInput.style.cssText = inputStyle + 'width: 70px; text-align: center;';
      postsInput.min = String(MAX_POSTS_PER_RUN.MIN);
      postsInput.max = String(MAX_POSTS_PER_RUN.MAX);
      postsInput.addEventListener('input', (e) => {
        const input = e.target as HTMLInputElement;
        const num = parseInt(input.value, 10);
        if (!isNaN(num)) {
          if (num > MAX_POSTS_PER_RUN.MAX) {
            this.maxPostsPerRun = MAX_POSTS_PER_RUN.MAX;
            input.value = String(MAX_POSTS_PER_RUN.MAX);
          } else if (num < MAX_POSTS_PER_RUN.MIN) {
            this.maxPostsPerRun = MAX_POSTS_PER_RUN.MIN;
            input.value = String(MAX_POSTS_PER_RUN.MIN);
          } else {
            this.maxPostsPerRun = num;
          }
        }
      });

    } else {
      // Desktop: Use Setting class (same as ArchiveModal)
      const sortByOptions = this.isUserProfile ? SORT_BY_OPTIONS_USER : SORT_BY_OPTIONS_SUBREDDIT;
      new Setting(optionsContainer)
        .setName('Sort by')
        .addDropdown(dropdown => {
          for (const opt of sortByOptions) {
            dropdown.addOption(opt.value, opt.label);
          }
          dropdown.setValue(this.sortBy);
          dropdown.onChange(value => {
            this.sortBy = value as typeof this.sortBy;
          });
        });

      new Setting(optionsContainer)
        .setName('Time range')
        .addDropdown(dropdown => {
          for (const opt of TIME_RANGE_OPTIONS) {
            dropdown.addOption(opt.value, opt.label);
          }
          dropdown.setValue(this.sortByTime);
          dropdown.onChange(value => {
            this.sortByTime = value as typeof this.sortByTime;
          });
        });

      new Setting(optionsContainer)
        .setName('Keyword filter')
        .setDesc('Optional: Filter posts by keyword')
        .addText(text => {
          text
            .setPlaceholder('Optional keyword')
            .setValue(this.keyword)
            .onChange(value => {
              this.keyword = value;
            });
        });

      const postsSetting = new Setting(optionsContainer)
        .setName(`Posts per run (max ${MAX_POSTS_PER_RUN.MAX})`)
        .addText(text => {
          text.inputEl.type = 'number';
          text.inputEl.min = String(MAX_POSTS_PER_RUN.MIN);
          text.inputEl.max = String(MAX_POSTS_PER_RUN.MAX);
          text.inputEl.style.width = '70px';
          text.inputEl.style.textAlign = 'center';
          text
            .setPlaceholder(String(MAX_POSTS_PER_RUN.DEFAULT))
            .setValue(String(this.maxPostsPerRun))
            .onChange(value => {
              const num = parseInt(value, 10);
              if (!isNaN(num)) {
                if (num > MAX_POSTS_PER_RUN.MAX) {
                  this.maxPostsPerRun = MAX_POSTS_PER_RUN.MAX;
                  text.setValue(String(MAX_POSTS_PER_RUN.MAX));
                } else if (num < MAX_POSTS_PER_RUN.MIN) {
                  this.maxPostsPerRun = MAX_POSTS_PER_RUN.MIN;
                  text.setValue(String(MAX_POSTS_PER_RUN.MIN));
                } else {
                  this.maxPostsPerRun = num;
                }
              }
            });
        });
      // Remove bottom border and margin from last setting
      postsSetting.settingEl.style.borderBottom = 'none';
      postsSetting.settingEl.style.paddingBottom = '0';
    }
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv({ cls: 'modal-button-container' });

    // Mobile: stack buttons vertically
    if (Platform.isMobile) {
      footer.style.flexDirection = 'column';
      footer.style.gap = '12px';
    }

    // Submit button first (on top for mobile)
    this.submitBtn = footer.createEl('button', {
      text: this.isEditMode ? 'Update' : 'Subscribe',
      cls: 'mod-cta'
    });
    this.submitBtn.addEventListener('click', () => void this.handleSubmit());

    if (Platform.isMobile) {
      this.submitBtn.style.width = '100%';
    }

    // Cancel button
    const cancelBtn = footer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    if (Platform.isMobile) {
      cancelBtn.style.width = '100%';
    }
  }

  private async handleSubmit(): Promise<void> {
    if (this.isSubmitting) return;

    this.isSubmitting = true;
    this.hideError();
    this.submitBtn.disabled = true;
    this.submitBtn.textContent = this.isEditMode ? 'Updating...' : 'Subscribing...';

    try {
      await this.onSubmit({
        sortBy: this.sortBy,
        sortByTime: this.sortByTime,
        keyword: this.keyword.trim(),
        maxPostsPerRun: this.maxPostsPerRun
      });
      this.close();
    } catch (error) {
      // Show error in modal
      const rawMessage = error instanceof Error ? error.message : 'Subscription failed';
      // Parse API error response if present
      const jsonMatch = rawMessage.match(/\{.*"message"\s*:\s*"([^"]+)"/);
      const message = jsonMatch?.[1] ?? rawMessage;
      this.showError(message);

      // Reset button state
      this.submitBtn.disabled = false;
      this.submitBtn.textContent = this.isEditMode ? 'Update' : 'Subscribe';
    } finally {
      this.isSubmitting = false;
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
