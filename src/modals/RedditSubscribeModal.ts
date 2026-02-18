import { Modal, App, Platform, Setting } from 'obsidian';
import type { AuthorCatalogEntry } from '@/types/author-catalog';
import { siReddit } from '@/constants/platform-icons';
import { createSVGElement } from '@/utils/dom-helpers';

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
      modalEl.addClass('am-modal--mobile');
      contentEl.addClass('sa-px-12');
    }

    // Title - different text for subreddits vs user profiles
    const titleText = this.isEditMode
      ? 'Edit subscription'
      : this.isUserProfile
        ? 'Subscribe to user'
        : 'Subscribe to subreddit';
    contentEl.createEl('h2', { text: titleText });

    // Profile card
    this.renderProfileCard(contentEl);

    // Error container (hidden by default)
    this.errorContainer = contentEl.createDiv({ cls: 'reddit-error-container' });
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
    const card = container.createDiv({ cls: 'reddit-profile-card' });
    card.addClass('sa-flex-row', 'sa-gap-12', 'sa-p-12', 'sa-bg-secondary', 'sa-rounded-8', 'sa-mb-16');

    // Avatar with Reddit icon
    const avatar = card.createDiv({ cls: 'reddit-avatar' });
    avatar.addClass('sa-flex-center', 'sa-rounded-full', 'sa-flex-shrink-0', 'rsm-avatar');
    const svg = createSVGElement(siReddit, {
      width: '24px',
      height: '24px',
      fill: 'white'
    });
    avatar.appendChild(svg);

    // Info
    const info = card.createDiv({ cls: 'reddit-info' });

    const name = info.createDiv({ cls: 'reddit-name' });
    name.addClass('sa-font-semibold', 'sa-text-normal');
    name.setText(this.author.authorName || 'Unknown');

    if (this.author.archiveCount > 0) {
      const stats = info.createDiv({ cls: 'reddit-stats' });
      stats.addClass('sa-text-xs', 'sa-text-muted', 'sa-mt-2');
      stats.setText(`${this.author.archiveCount} archived posts`);
    }
  }

  private showError(message: string): void {
    this.errorContainer.empty();
    this.errorContainer.removeClass('sa-hidden');
    this.errorContainer.addClass('sa-flex-between', 'sa-gap-12', 'sa-p-8', 'sa-px-12', 'sa-mb-12');

    const messageText = this.errorContainer.createDiv();
    messageText.textContent = message;
    messageText.addClass('sa-m-0', 'sa-text-error', 'sa-text-sm', 'sa-leading-normal');
  }

  private hideError(): void {
    this.errorContainer.addClass('sa-hidden');
    this.errorContainer.empty();
  }

  private renderOptions(container: HTMLElement): void {
    const optionsContainer = container.createDiv({ cls: 'reddit-options' });

    if (Platform.isMobile) {
      // Mobile: Compact custom layout (same as ArchiveModal)
      optionsContainer.addClass('sa-flex-col', 'sa-gap-16');

      // Row 1: Sort by
      const sortByRow = optionsContainer.createDiv();
      sortByRow.addClass('sa-flex-between', 'sa-gap-12');

      const sortByLabel = sortByRow.createEl('label', { text: 'Sort by' });
      sortByLabel.addClass('sa-text-sm', 'sa-text-normal', 'sa-flex-shrink-0');

      const sortBySelect = sortByRow.createEl('select');
      sortBySelect.addClass('rsm-mobile-select');
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
      timeRangeRow.addClass('sa-flex-between', 'sa-gap-12');

      const timeRangeLabel = timeRangeRow.createEl('label', { text: 'Time range' });
      timeRangeLabel.addClass('sa-text-sm', 'sa-text-normal', 'sa-flex-shrink-0');

      const timeRangeSelect = timeRangeRow.createEl('select');
      timeRangeSelect.addClass('rsm-mobile-select');
      for (const opt of TIME_RANGE_OPTIONS) {
        const option = timeRangeSelect.createEl('option', { value: opt.value, text: opt.label });
        if (opt.value === this.sortByTime) option.selected = true;
      }
      timeRangeSelect.addEventListener('change', (e) => {
        this.sortByTime = (e.target as HTMLSelectElement).value as typeof this.sortByTime;
      });

      // Row 3: Keyword filter
      const keywordRow = optionsContainer.createDiv();
      keywordRow.addClass('sa-flex-between', 'sa-gap-12');

      const keywordLabel = keywordRow.createEl('label', { text: 'Keyword filter' });
      keywordLabel.addClass('sa-text-sm', 'sa-text-normal', 'sa-flex-shrink-0');

      const keywordInput = keywordRow.createEl('input', {
        type: 'text',
        placeholder: 'Optional',
        value: this.keyword
      });
      keywordInput.addClass('sa-flex-1', 'sa-min-w-0', 'rsm-mobile-input');
      keywordInput.addEventListener('input', (e) => {
        this.keyword = (e.target as HTMLInputElement).value;
      });

      // Row 4: Posts per run
      const postsRow = optionsContainer.createDiv();
      postsRow.addClass('sa-flex-between', 'sa-gap-12');

      const postsLabel = postsRow.createEl('label', { text: `Posts per run (max ${MAX_POSTS_PER_RUN.MAX})` });
      postsLabel.addClass('sa-text-sm', 'sa-text-normal', 'sa-flex-shrink-0');

      const postsInput = postsRow.createEl('input', {
        type: 'number',
        value: String(this.maxPostsPerRun)
      });
      postsInput.addClass('rsm-mobile-input', 'sa-text-center');
      postsInput.setCssProps({'--sa-width': '70px'});
      postsInput.addClass('sa-dynamic-width');
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
        .setDesc('Optional: filter posts by keyword')
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
          text.inputEl.setCssProps({'--sa-width': '70px'});
          text.inputEl.addClass('sa-dynamic-width', 'sa-text-center');
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
      postsSetting.settingEl.addClass('rsm-setting-last');
      postsSetting.settingEl.addClass('sa-p-0');
    }
  }

  private renderFooter(container: HTMLElement): void {
    const footer = container.createDiv({ cls: 'modal-button-container' });

    // Mobile: stack buttons vertically
    if (Platform.isMobile) {
      footer.addClass('sa-flex-col', 'sa-gap-12');
    }

    // Submit button first (on top for mobile)
    this.submitBtn = footer.createEl('button', {
      text: this.isEditMode ? 'Update' : 'Subscribe',
      cls: 'mod-cta'
    });
    this.submitBtn.addEventListener('click', () => void this.handleSubmit());

    if (Platform.isMobile) {
      this.submitBtn.addClass('sa-w-full');
    }

    // Cancel button
    const cancelBtn = footer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    if (Platform.isMobile) {
      cancelBtn.addClass('sa-w-full');
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
