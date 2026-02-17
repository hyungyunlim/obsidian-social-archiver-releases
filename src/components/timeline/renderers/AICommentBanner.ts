/**
 * AICommentBanner - UI component for AI comment generation suggestions
 *
 * Single Responsibility: Display AI comment generation UI with state management
 * Design: Matches whisper/transcription banner style - simple inline dropdown
 */

import { setIcon } from 'obsidian';
import type { AICli, AICommentType, AICommentProgress, AIOutputLanguage } from '../../../types/ai-comment';
import { COMMENT_TYPE_DISPLAY_NAMES } from '../../../types/ai-comment';
import { AI_CLI_INFO } from '../../../utils/ai-cli';

// ============================================================================
// Types
// ============================================================================

export type AICommentBannerState =
  | 'default'
  | 'generating'
  | 'complete'
  | 'authRequired'
  | 'dismissed';

export interface AICommentBannerOptions {
  availableClis: AICli[];
  defaultCli: AICli;
  defaultType: AICommentType;
  onGenerate: (cli: AICli, type: AICommentType, customPrompt?: string, language?: AIOutputLanguage) => Promise<void>;
  onGenerateMulti?: (clis: AICli[], type: AICommentType, customPrompt?: string, language?: AIOutputLanguage) => Promise<void>;
  onDecline: () => void;
  isGenerating: boolean;
  progress?: AICommentProgress;
  initialState?: AICommentBannerState;
  /** Multi-AI parallel generation mode */
  multiAiEnabled?: boolean;
  /** CLIs to use in multi-AI mode */
  multiAiSelection?: AICli[];
  /** Output language for AI response */
  outputLanguage?: AIOutputLanguage;
  /** Whether the post has a transcript (enables translate-transcript type) */
  hasTranscript?: boolean;
}

// Simplified type options (removed redundant keypoints, translation)
const BASE_AVAILABLE_TYPES: AICommentType[] = [
  'summary',
  'factcheck',
  'critique',
  'sentiment',
  'connections',
  'glossary',
  'reformat',
  'custom',
];

function getAvailableTypes(hasTranscript?: boolean): AICommentType[] {
  if (hasTranscript) {
    // Insert translate-transcript before glossary
    const idx = BASE_AVAILABLE_TYPES.indexOf('glossary');
    const types = [...BASE_AVAILABLE_TYPES];
    types.splice(idx, 0, 'translate-transcript');
    return types;
  }
  return BASE_AVAILABLE_TYPES;
}

// ============================================================================
// AICommentBanner Class
// ============================================================================

// Language display names for dropdown (shorter versions for UI)
const LANGUAGE_DISPLAY_NAMES: Record<AIOutputLanguage, string> = {
  auto: 'Auto',
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
};

export class AICommentBanner {
  private container: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private state: AICommentBannerState = 'default';
  private selectedCli: AICli | null = null;
  private selectedType: AICommentType = 'summary';
  private selectedLanguage: AIOutputLanguage = 'auto';
  private customPrompt: string = '';
  private customPromptInput: HTMLInputElement | null = null;
  private options: AICommentBannerOptions | null = null;
  private generatingStartTime: number = 0;
  private elapsedTimerInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  render(container: HTMLElement, options: AICommentBannerOptions): void {
    this.container = container;
    this.options = options;
    this.state = options.initialState || 'default';
    this.selectedCli = options.defaultCli;
    this.selectedType = options.defaultType;
    this.selectedLanguage = options.outputLanguage || 'auto';

    if (options.availableClis.length === 0 || this.state === 'dismissed') {
      return;
    }

    const banner = container.createDiv({ cls: 'ai-comment-banner' });
    banner.addClass('sa-flex-between', 'sa-gap-12', 'sa-bg-transparent', 'sa-py-8');
    banner.addClass('acb-banner');

    this.contentEl = banner;
    this.renderCurrentState();
  }

  private renderCurrentState(): void {
    if (!this.contentEl || !this.options) return;
    this.contentEl.empty();

    switch (this.state) {
      case 'default':
        this.renderDefaultState(this.contentEl);
        break;
      case 'generating':
        this.renderGeneratingState(this.contentEl);
        break;
      case 'complete':
        this.renderCompleteState(this.contentEl);
        break;
      case 'authRequired':
        this.renderAuthRequiredState(this.contentEl);
        break;
      case 'dismissed':
        this.contentEl.remove();
        break;
    }
  }

  /**
   * Default state - whisper banner style with dropdowns
   * Format: "Add AI [Summary ▼]? using [Claude ▼]" or "Add AI [Summary ▼]? using Claude, Gemini"
   */
  private renderDefaultState(parent: HTMLElement): void {
    if (!this.options) return;

    // Change parent to column layout for potential second row
    parent.removeClass('sa-flex-between', 'sa-flex-row');
    parent.addClass('sa-flex-col', 'sa-gap-8', 'sa-p-8', 'sa-px-12');

    // Main row container
    const mainRow = parent.createDiv();
    mainRow.addClass('sa-flex-between', 'sa-gap-12');

    // Check if multi-AI mode is enabled
    const isMultiAi = this.options.multiAiEnabled &&
      this.options.multiAiSelection &&
      this.options.multiAiSelection.length > 1;

    // Left section: "Add AI [Type ▼]?" + CLI info
    const messageSection = mainRow.createDiv();
    messageSection.addClass('sa-flex-row', 'sa-flex-1', 'sa-min-w-0');

    // "Add " prefix
    const prefix = messageSection.createSpan({ text: 'Add' });
    prefix.addClass('sa-text-base', 'sa-text-normal');
    prefix.addClass('acb-label-prefix');

    // Type dropdown wrapper (inline with text)
    const typeWrapper = messageSection.createDiv();
    typeWrapper.addClass('sa-flex-row', 'sa-clickable');
    typeWrapper.addClass('acb-type-wrapper');

    const typeSelect = this.createMinimalSelect(typeWrapper);

    for (const type of getAvailableTypes(this.options.hasTranscript)) {
      const option = typeSelect.createEl('option', {
        value: type,
        text: COMMENT_TYPE_DISPLAY_NAMES[type]
      });
      if (type === this.selectedType) {
        option.selected = true;
      }
    }

    // Chevron icon for type
    const typeChevron = typeWrapper.createDiv();
    typeChevron.addClass('sa-icon-14', 'sa-text-muted', 'sa-pointer-none');
    setIcon(typeChevron, 'chevron-down');

    // "using" label
    const usingLabel = messageSection.createSpan({ text: 'using' });
    usingLabel.addClass('sa-text-base', 'sa-text-normal');
    usingLabel.addClass('acb-label-using');

    // Adjust width helper
    const adjustWidth = (select: HTMLSelectElement) => {
      const tempSpan = document.createElement('span');
      tempSpan.classList.add('acb-measure-span');
      tempSpan.textContent = select.options[select.selectedIndex]?.text || '';
      document.body.appendChild(tempSpan);
      select.setCssStyles({ width: `${tempSpan.offsetWidth + 2}px` });
      document.body.removeChild(tempSpan);
    };

    adjustWidth(typeSelect);

    // Store reference to update custom prompt visibility later
    let customPromptRow: HTMLElement | null = null;

    typeSelect.addEventListener('change', () => {
      this.selectedType = typeSelect.value as AICommentType;
      adjustWidth(typeSelect);
      // Update custom prompt row visibility
      if (customPromptRow) {
        if (typeSelect.value === 'custom') {
          customPromptRow.removeClass('sa-hidden');
          if (this.customPromptInput) {
            this.customPromptInput.focus();
          }
        } else {
          customPromptRow.addClass('sa-hidden');
        }
      }
    });

    // Multi-AI mode: show selected AIs as text
    if (isMultiAi && this.options.multiAiSelection) {
      const aiNames = this.options.multiAiSelection
        .map(cli => AI_CLI_INFO[cli].displayName)
        .join(', ');

      const aiList = messageSection.createSpan({ text: aiNames });
      aiList.addClass('sa-text-base', 'sa-text-muted');
    }
    // Single AI mode: show dropdown if multiple CLIs available
    else if (this.options.availableClis.length > 1) {
      const cliWrapper = messageSection.createDiv();
      cliWrapper.addClass('sa-flex-row', 'sa-clickable');
      cliWrapper.addClass('acb-select-wrapper');

      const cliSelect = this.createMinimalSelect(cliWrapper);

      for (const cli of this.options.availableClis) {
        const option = cliSelect.createEl('option', {
          value: cli,
          text: AI_CLI_INFO[cli].displayName
        });
        if (cli === this.selectedCli) {
          option.selected = true;
        }
      }

      const cliChevron = cliWrapper.createDiv();
      cliChevron.addClass('sa-icon-14', 'sa-text-muted', 'sa-pointer-none');
      setIcon(cliChevron, 'chevron-down');

      adjustWidth(cliSelect);

      cliSelect.addEventListener('change', () => {
        this.selectedCli = cliSelect.value as AICli;
        adjustWidth(cliSelect);
      });
    }
    // Single AI mode with only one CLI: show CLI name as text
    else if (this.options.availableClis.length === 1) {
      const singleCli = this.options.availableClis[0];
      if (singleCli) {
        const cliName = messageSection.createSpan({ text: AI_CLI_INFO[singleCli].displayName });
        cliName.addClass('sa-text-base', 'sa-text-muted');
      }
    }

    // "in" label for language
    const inLabel = messageSection.createSpan({ text: 'in' });
    inLabel.addClass('sa-text-base', 'sa-text-normal');
    inLabel.addClass('acb-label-using');

    // Language dropdown
    const langWrapper = messageSection.createDiv();
    langWrapper.addClass('sa-flex-row', 'sa-clickable');
    langWrapper.addClass('acb-select-wrapper');

    const langSelect = this.createMinimalSelect(langWrapper);

    // Add all available languages
    const languages: AIOutputLanguage[] = ['auto', 'en', 'ko', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi'];
    for (const lang of languages) {
      const option = langSelect.createEl('option', {
        value: lang,
        text: LANGUAGE_DISPLAY_NAMES[lang]
      });
      if (lang === this.selectedLanguage) {
        option.selected = true;
      }
    }

    const langChevron = langWrapper.createDiv();
    langChevron.addClass('sa-icon-14', 'sa-text-muted', 'sa-pointer-none');
    setIcon(langChevron, 'chevron-down');

    adjustWidth(langSelect);

    langSelect.addEventListener('change', () => {
      this.selectedLanguage = langSelect.value as AIOutputLanguage;
      adjustWidth(langSelect);
    });

    // "?" suffix at the end
    const suffix = messageSection.createSpan({ text: '?' });
    suffix.addClass('sa-text-base', 'sa-text-normal');
    suffix.addClass('acb-label-suffix');

    // Right section: buttons
    const buttonSection = mainRow.createDiv();
    buttonSection.addClass('sa-flex-row', 'sa-gap-4', 'sa-flex-shrink-0');

    // No button (X)
    const noButton = this.createIconButton(buttonSection, 'x', 'No');
    noButton.addEventListener('click', () => {
      this.state = 'dismissed';
      this.options?.onDecline();
      this.contentEl?.remove();
    });
    noButton.addEventListener('mouseenter', () => {
      noButton.removeClass('sa-text-muted', 'sa-bg-transparent');
      noButton.addClass('sa-text-error', 'sa-bg-hover', 'sa-rounded-4');
    });
    noButton.addEventListener('mouseleave', () => {
      noButton.removeClass('sa-text-error', 'sa-bg-hover', 'sa-rounded-4');
      noButton.addClass('sa-text-muted', 'sa-bg-transparent');
    });

    // Yes button (Check)
    const yesButton = this.createIconButton(buttonSection, 'check', 'Yes');
    yesButton.addClass('sa-text-accent');
    yesButton.addEventListener('click', () => {
      void this.handleGenerate();
    });
    yesButton.addEventListener('mouseenter', () => {
      yesButton.removeClass('sa-bg-transparent');
      yesButton.addClass('sa-bg-hover', 'sa-rounded-4');
    });
    yesButton.addEventListener('mouseleave', () => {
      yesButton.removeClass('sa-bg-hover', 'sa-rounded-4');
      yesButton.addClass('sa-bg-transparent');
    });

    // Custom prompt input row (hidden by default, shown when 'custom' type is selected)
    customPromptRow = parent.createDiv();
    customPromptRow.addClass('sa-flex-row', 'sa-gap-8');
    if (this.selectedType !== 'custom') {
      customPromptRow.addClass('sa-hidden');
    }

    const promptInput = customPromptRow.createEl('input', {
      type: 'text',
      placeholder: 'Enter your custom prompt...',
    });
    promptInput.addClass('sa-flex-1', 'sa-p-6', 'sa-px-10', 'sa-text-base', 'sa-border', 'sa-rounded-4', 'sa-bg-primary', 'sa-text-normal');
    promptInput.addClass('acb-prompt-input');
    promptInput.value = this.customPrompt;
    this.customPromptInput = promptInput;

    // Update custom prompt on input
    promptInput.addEventListener('input', () => {
      this.customPrompt = promptInput.value;
    });

    // Handle Enter key to trigger generation
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && promptInput.value.trim()) {
        e.preventDefault();
        void this.handleGenerate();
      }
    });

    // Focus styling handled by CSS .acb-prompt-input:focus
  }

  /**
   * Generating state with elapsed time and status message
   */
  private renderGeneratingState(parent: HTMLElement): void {
    if (!this.options || !this.selectedType) return;

    // Reset parent to row layout (default state uses column for custom prompt row)
    parent.removeClass('sa-flex-col');
    parent.addClass('sa-flex-between', 'sa-gap-12', 'sa-p-8', 'sa-px-12');

    // Start timer if not already started
    if (this.generatingStartTime === 0) {
      this.generatingStartTime = Date.now();
    }

    // Message with elapsed time and status
    const message = parent.createSpan({ cls: 'ai-generating-message' });
    message.addClass('sa-text-base', 'sa-text-normal', 'sa-flex-1');

    // Store current status for display - use type-specific message
    const typeMessages: Record<AICommentType, string> = {
      summary: 'Summarizing content',
      factcheck: 'Searching & verifying facts',
      critique: 'Analyzing content',
      keypoints: 'Extracting key points',
      sentiment: 'Analyzing sentiment',
      connections: 'Finding connections',
      translation: 'Translating',
      'translate-transcript': 'Translating transcript',
      glossary: 'Identifying terms & definitions',
      reformat: 'Reformatting content',
      custom: 'Processing',
    };
    let currentStatus = typeMessages[this.selectedType] || `Generating ${COMMENT_TYPE_DISPLAY_NAMES[this.selectedType]}`;

    const formatElapsed = (seconds: number): string => {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
    };

    const updateDisplay = () => {
      const elapsed = Math.floor((Date.now() - this.generatingStartTime) / 1000);
      message.textContent = `${currentStatus}... (${formatElapsed(elapsed)})`;
    };

    // Method to update status from progress callback
    this.updateStatusMessage = (status: string) => {
      if (status && status.trim()) {
        // Remove trailing ellipsis if present
        currentStatus = status.replace(/\.{2,}$/, '').trim();
        updateDisplay();
      }
    };

    // Initial update
    updateDisplay();

    // Clear any existing interval
    if (this.elapsedTimerInterval) {
      clearInterval(this.elapsedTimerInterval);
    }

    // Update every second
    this.elapsedTimerInterval = setInterval(updateDisplay, 1000);

    // Cancel button
    const cancelBtn = this.createIconButton(parent, 'x', 'Cancel');
    cancelBtn.addEventListener('click', () => this.handleCancel());
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.removeClass('sa-text-muted', 'sa-bg-transparent');
      cancelBtn.addClass('sa-text-error', 'sa-bg-hover', 'sa-rounded-4');
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.removeClass('sa-text-error', 'sa-bg-hover', 'sa-rounded-4');
      cancelBtn.addClass('sa-text-muted', 'sa-bg-transparent');
    });
  }

  /** Callback to update status message during generation */
  private updateStatusMessage: ((status: string) => void) | null = null;

  /**
   * Stop elapsed timer and cleanup
   */
  private stopElapsedTimer(): void {
    if (this.elapsedTimerInterval) {
      clearInterval(this.elapsedTimerInterval);
      this.elapsedTimerInterval = null;
    }
    this.generatingStartTime = 0;
    this.updateStatusMessage = null;
  }

  /**
   * Complete state - simple success message that auto-dismisses
   */
  private renderCompleteState(parent: HTMLElement): void {
    // Reset parent to row layout
    parent.removeClass('sa-flex-col');
    parent.addClass('sa-flex-row', 'sa-gap-12', 'sa-p-8', 'sa-px-12');

    // Success message only - auto-dismisses after 2 seconds
    const successMsg = parent.createSpan();
    successMsg.addClass('sa-text-base', 'sa-text-success', 'sa-flex-1', 'sa-flex-row', 'sa-gap-6');

    const checkIcon = successMsg.createDiv();
    checkIcon.addClass('sa-icon-16');
    setIcon(checkIcon, 'check');

    successMsg.createSpan({ text: 'AI comment added' });

    // Auto-dismiss after 2 seconds (shorter since no action needed)
    setTimeout(() => {
      if (this.state === 'complete') {
        this.contentEl?.remove();
      }
    }, 2000);
  }

  /**
   * Auth required state
   */
  private renderAuthRequiredState(parent: HTMLElement): void {
    if (!this.options || !this.selectedCli) return;

    // Reset parent to row layout
    parent.removeClass('sa-flex-col');
    parent.addClass('sa-flex-row', 'sa-gap-12', 'sa-p-8', 'sa-px-12');

    // Back button
    const backBtn = this.createIconButton(parent, 'arrow-left', 'Back');
    backBtn.addEventListener('click', () => {
      this.state = 'default';
      this.renderCurrentState();
    });
    backBtn.addEventListener('mouseenter', () => {
      backBtn.removeClass('sa-bg-transparent');
      backBtn.addClass('sa-bg-hover', 'sa-rounded-4');
    });
    backBtn.addEventListener('mouseleave', () => {
      backBtn.removeClass('sa-bg-hover', 'sa-rounded-4');
      backBtn.addClass('sa-bg-transparent');
    });

    // Warning message
    const message = parent.createSpan();
    message.addClass('sa-text-base', 'sa-text-warning', 'sa-flex-1');
    message.textContent = `${AI_CLI_INFO[this.selectedCli].displayName} requires authentication`;

    // Setup link
    const setupLink = parent.createEl('a', { text: 'Setup' });
    setupLink.href = AI_CLI_INFO[this.selectedCli].installUrl;
    setupLink.target = '_blank';
    setupLink.addClass('sa-text-sm', 'sa-text-accent');
    setupLink.addClass('acb-setup-link');
    // Hover underline handled by CSS .acb-setup-link:hover
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private createMinimalSelect(parent: HTMLElement): HTMLSelectElement {
    const select = parent.createEl('select');
    select.addClass('sa-p-0', 'sa-m-0', 'sa-text-base', 'sa-bg-transparent', 'sa-text-muted', 'sa-clickable');
    select.addClass('acb-minimal-select');
    return select;
  }

  private createIconButton(parent: HTMLElement, icon: string, title: string): HTMLElement {
    const button = parent.createEl('button');
    button.addClass('sa-p-0', 'sa-flex-center', 'sa-bg-transparent', 'sa-text-muted', 'sa-clickable', 'sa-transition');
    button.addClass('acb-icon-btn');
    button.setAttribute('aria-label', title);
    button.setAttribute('title', title);

    const iconEl = button.createDiv();
    iconEl.addClass('sa-icon-20');
    setIcon(iconEl, icon);

    return button;
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private async handleGenerate(): Promise<void> {
    if (!this.options || !this.selectedType) return;

    // Validate custom prompt for custom type
    if (this.selectedType === 'custom' && !this.customPrompt.trim()) {
      // Focus the input if empty
      this.customPromptInput?.focus();
      return;
    }

    // Check if multi-AI mode
    const isMultiAi = this.options.multiAiEnabled &&
      this.options.multiAiSelection &&
      this.options.multiAiSelection.length > 1;

    // For single AI mode, need selectedCli
    if (!isMultiAi && !this.selectedCli) return;

    // Get custom prompt if type is custom
    const customPrompt = this.selectedType === 'custom' ? this.customPrompt.trim() : undefined;

    this.state = 'generating';
    this.abortController = new AbortController();
    this.renderCurrentState();

    try {
      if (isMultiAi && this.options.onGenerateMulti && this.options.multiAiSelection) {
        // Multi-AI parallel generation
        await this.options.onGenerateMulti(this.options.multiAiSelection, this.selectedType, customPrompt, this.selectedLanguage);
      } else if (this.selectedCli) {
        // Single AI generation
        await this.options.onGenerate(this.selectedCli, this.selectedType, customPrompt, this.selectedLanguage);
      }
      this.state = 'complete';
    } catch (error) {
      if (error instanceof Error && error.message.includes('not authenticated')) {
        this.state = 'authRequired';
      } else {
        this.state = 'default';
      }
    }

    this.abortController = null;
    this.renderCurrentState();
  }

  private handleCancel(): void {
    this.stopElapsedTimer();
    this.abortController?.abort();
    this.state = 'default';
    this.renderCurrentState();
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  updateProgress(progress: AICommentProgress): void {
    if (!this.options) return;
    this.options.progress = progress;

    // Update status message if in generating state
    if (this.state === 'generating' && this.updateStatusMessage && progress.status) {
      this.updateStatusMessage(progress.status);
    }
  }

  setState(state: AICommentBannerState): void {
    // Stop timer when leaving generating state
    if (this.state === 'generating' && state !== 'generating') {
      this.stopElapsedTimer();
    }
    this.state = state;
    this.renderCurrentState();
  }

  getState(): AICommentBannerState {
    return this.state;
  }

  getAbortSignal(): AbortSignal | undefined {
    return this.abortController?.signal;
  }

  destroy(): void {
    this.stopElapsedTimer();
    this.abortController?.abort();
    this.contentEl?.remove();
    this.container = null;
    this.contentEl = null;
    this.options = null;
  }
}
