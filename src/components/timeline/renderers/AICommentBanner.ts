/**
 * AICommentBanner - UI component for AI comment generation suggestions
 *
 * Single Responsibility: Display AI comment generation UI with state management
 * Design: Matches whisper/transcription banner style - simple inline dropdown
 */

import { setIcon } from 'obsidian';
import type { AICli, AICommentType, AICommentProgress, AIOutputLanguage } from '../../../types/ai-comment';
import { COMMENT_TYPE_DISPLAY_NAMES, OUTPUT_LANGUAGE_NAMES } from '../../../types/ai-comment';
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
    banner.style.cssText = `
      margin: 8px 0 0 0;
      padding: 8px 0;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    `;

    this.contentEl = banner;
    this.renderCurrentState();
  }

  private renderCurrentState(): void {
    if (!this.contentEl || !this.options) return;
    this.contentEl.innerHTML = '';

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
    parent.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 12px;
    `;

    // Main row container
    const mainRow = parent.createDiv();
    mainRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px;';

    // Check if multi-AI mode is enabled
    const isMultiAi = this.options.multiAiEnabled &&
      this.options.multiAiSelection &&
      this.options.multiAiSelection.length > 1;

    // Left section: "Add AI [Type ▼]?" + CLI info
    const messageSection = mainRow.createDiv();
    messageSection.style.cssText = 'display: flex; align-items: center; gap: 0; flex: 1; min-width: 0;';

    // "Add " prefix
    const prefix = messageSection.createSpan({ text: 'Add' });
    prefix.style.cssText = 'font-size: 13px; color: var(--text-normal); white-space: nowrap; margin-right: 4px;';

    // Type dropdown wrapper (inline with text)
    const typeWrapper = messageSection.createDiv();
    typeWrapper.style.cssText = 'display: flex; align-items: center; gap: 1px; cursor: pointer; margin-right: 4px;';

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
    typeChevron.style.cssText = 'width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); pointer-events: none;';
    setIcon(typeChevron, 'chevron-down');

    // "using" label
    const usingLabel = messageSection.createSpan({ text: 'using' });
    usingLabel.style.cssText = 'font-size: 13px; color: var(--text-normal); white-space: nowrap; margin: 0 4px;';

    // Adjust width helper
    const adjustWidth = (select: HTMLSelectElement) => {
      const tempSpan = document.createElement('span');
      tempSpan.style.cssText = 'font-size: 13px; font-family: inherit; visibility: hidden; position: absolute;';
      tempSpan.textContent = select.options[select.selectedIndex]?.text || '';
      document.body.appendChild(tempSpan);
      select.style.width = `${tempSpan.offsetWidth + 2}px`;
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
        customPromptRow.style.display = typeSelect.value === 'custom' ? 'flex' : 'none';
        if (typeSelect.value === 'custom' && this.customPromptInput) {
          this.customPromptInput.focus();
        }
      }
    });

    // Multi-AI mode: show selected AIs as text
    if (isMultiAi && this.options.multiAiSelection) {
      const aiNames = this.options.multiAiSelection
        .map(cli => AI_CLI_INFO[cli].displayName)
        .join(', ');

      const aiList = messageSection.createSpan({ text: aiNames });
      aiList.style.cssText = 'font-size: 13px; color: var(--text-muted);';
    }
    // Single AI mode: show dropdown if multiple CLIs available
    else if (this.options.availableClis.length > 1) {
      const cliWrapper = messageSection.createDiv();
      cliWrapper.style.cssText = 'display: flex; align-items: center; gap: 1px; cursor: pointer;';

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
      cliChevron.style.cssText = 'width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); pointer-events: none;';
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
        cliName.style.cssText = 'font-size: 13px; color: var(--text-muted);';
      }
    }

    // "in" label for language
    const inLabel = messageSection.createSpan({ text: 'in' });
    inLabel.style.cssText = 'font-size: 13px; color: var(--text-normal); white-space: nowrap; margin: 0 4px;';

    // Language dropdown
    const langWrapper = messageSection.createDiv();
    langWrapper.style.cssText = 'display: flex; align-items: center; gap: 1px; cursor: pointer;';

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
    langChevron.style.cssText = 'width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; color: var(--text-muted); pointer-events: none;';
    setIcon(langChevron, 'chevron-down');

    adjustWidth(langSelect);

    langSelect.addEventListener('change', () => {
      this.selectedLanguage = langSelect.value as AIOutputLanguage;
      adjustWidth(langSelect);
    });

    // "?" suffix at the end
    const suffix = messageSection.createSpan({ text: '?' });
    suffix.style.cssText = 'font-size: 13px; color: var(--text-normal); white-space: nowrap; margin-left: 2px;';

    // Right section: buttons
    const buttonSection = mainRow.createDiv();
    buttonSection.style.cssText = 'display: flex; align-items: center; gap: 4px; flex-shrink: 0;';

    // No button (X)
    const noButton = this.createIconButton(buttonSection, 'x', 'No');
    noButton.addEventListener('click', () => {
      this.state = 'dismissed';
      this.options?.onDecline();
      this.contentEl?.remove();
    });
    noButton.addEventListener('mouseenter', () => {
      noButton.style.color = 'var(--text-error)';
      noButton.style.background = 'var(--background-modifier-hover)';
      noButton.style.borderRadius = '4px';
    });
    noButton.addEventListener('mouseleave', () => {
      noButton.style.color = 'var(--text-muted)';
      noButton.style.background = 'transparent';
    });

    // Yes button (Check)
    const yesButton = this.createIconButton(buttonSection, 'check', 'Yes');
    yesButton.style.color = 'var(--interactive-accent)';
    yesButton.addEventListener('click', () => {
      this.handleGenerate();
    });
    yesButton.addEventListener('mouseenter', () => {
      yesButton.style.background = 'var(--background-modifier-hover)';
      yesButton.style.borderRadius = '4px';
    });
    yesButton.addEventListener('mouseleave', () => {
      yesButton.style.background = 'transparent';
    });

    // Custom prompt input row (hidden by default, shown when 'custom' type is selected)
    customPromptRow = parent.createDiv();
    customPromptRow.style.cssText = `
      display: ${this.selectedType === 'custom' ? 'flex' : 'none'};
      align-items: center;
      gap: 8px;
    `;

    const promptInput = customPromptRow.createEl('input', {
      type: 'text',
      placeholder: 'Enter your custom prompt...',
    });
    promptInput.style.cssText = `
      flex: 1;
      padding: 6px 10px;
      font-size: 13px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      background: var(--background-primary);
      color: var(--text-normal);
      outline: none;
    `;
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
        this.handleGenerate();
      }
    });

    // Focus styling
    promptInput.addEventListener('focus', () => {
      promptInput.style.borderColor = 'var(--interactive-accent)';
    });
    promptInput.addEventListener('blur', () => {
      promptInput.style.borderColor = 'var(--background-modifier-border)';
    });
  }

  /**
   * Generating state with elapsed time and status message
   */
  private renderGeneratingState(parent: HTMLElement): void {
    if (!this.options || !this.selectedType) return;

    // Reset parent to row layout (default state uses column for custom prompt row)
    parent.style.cssText = `
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
    `;

    // Start timer if not already started
    if (this.generatingStartTime === 0) {
      this.generatingStartTime = Date.now();
    }

    // Message with elapsed time and status
    const message = parent.createSpan({ cls: 'ai-generating-message' });
    message.style.cssText = 'font-size: 13px; color: var(--text-normal); flex: 1;';

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
      cancelBtn.style.color = 'var(--text-error)';
      cancelBtn.style.background = 'var(--background-modifier-hover)';
      cancelBtn.style.borderRadius = '4px';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.color = 'var(--text-muted)';
      cancelBtn.style.background = 'transparent';
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
    parent.style.cssText = `
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
    `;

    // Success message only - auto-dismisses after 2 seconds
    const successMsg = parent.createSpan();
    successMsg.style.cssText = 'font-size: 13px; color: var(--text-success); flex: 1; display: flex; align-items: center; gap: 6px;';

    const checkIcon = successMsg.createDiv();
    checkIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center;';
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
    parent.style.cssText = `
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
    `;

    // Back button
    const backBtn = this.createIconButton(parent, 'arrow-left', 'Back');
    backBtn.addEventListener('click', () => {
      this.state = 'default';
      this.renderCurrentState();
    });
    backBtn.addEventListener('mouseenter', () => {
      backBtn.style.background = 'var(--background-modifier-hover)';
      backBtn.style.borderRadius = '4px';
    });
    backBtn.addEventListener('mouseleave', () => {
      backBtn.style.background = 'transparent';
    });

    // Warning message
    const message = parent.createSpan();
    message.style.cssText = 'font-size: 13px; color: var(--text-warning); flex: 1;';
    message.textContent = `${AI_CLI_INFO[this.selectedCli].displayName} requires authentication`;

    // Setup link
    const setupLink = parent.createEl('a', { text: 'Setup' });
    setupLink.href = AI_CLI_INFO[this.selectedCli].installUrl;
    setupLink.target = '_blank';
    setupLink.style.cssText = 'font-size: 12px; color: var(--text-accent); text-decoration: none;';
    setupLink.addEventListener('mouseenter', () => {
      setupLink.style.textDecoration = 'underline';
    });
    setupLink.addEventListener('mouseleave', () => {
      setupLink.style.textDecoration = 'none';
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private createMinimalSelect(parent: HTMLElement): HTMLSelectElement {
    const select = parent.createEl('select');
    select.style.cssText = `
      padding: 0;
      margin: 0;
      font-size: 13px;
      font-family: inherit;
      line-height: inherit;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      outline: none;
      box-shadow: none;
      appearance: none;
      -webkit-appearance: none;
      text-decoration: none;
      padding-right: 0;
      width: auto;
    `;
    return select;
  }

  private createIconButton(parent: HTMLElement, icon: string, title: string): HTMLElement {
    const button = parent.createEl('button');
    button.style.cssText = `
      padding: 0 !important;
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
      background: transparent !important;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      transition: all 0.2s;
    `;
    button.setAttribute('aria-label', title);
    button.setAttribute('title', title);

    const iconEl = button.createDiv();
    iconEl.style.cssText = 'width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;';
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
