/**
 * "Research this post": an engine (the user's own keys; on desktop also an
 * installed AI CLI), Quick or Deep (OpenAI and Gemini keys), an optional
 * focus. Quick runs while the modal shows progress — closing it keeps the run
 * going and a notice reports the result. Deep starts a background job on the
 * provider and closes; ByokResearchRunner polls and saves it.
 */
import { Modal, Notice, Platform, type App } from 'obsidian';
import { BYOK_PROVIDERS, RESEARCH_MAX_FOCUS_CHARS, toStoredProviderId } from '../vendor/byok-ai-core';
import type { AICommentEngineId, AIOutputLanguage } from '../types/ai-comment';
import type { AICommentTarget } from '../services/ai-comment/AICommentSaver';
import type { ByokService } from '../services/byok/ByokService';
import {
  researchErrorMessage,
  type ByokResearchRunner,
  type DeepResearchProvider,
} from '../services/byok/ByokResearchRunner';
import { byokEngineLabel } from '../services/byok/byokText';
import { AI_CLI_INFO, type AICli } from '../utils/ai-cli';
import { t } from '../i18n';

export interface AIResearchModalOptions {
  target: AICommentTarget;
  runner: ByokResearchRunner;
  byok: ByokService | null;
  /** Installed AI CLIs on desktop; none on mobile. */
  detectClis: () => Promise<AICli[]>;
  archiveId: string | null;
  outputLanguage?: AIOutputLanguage;
  openSettings: () => void;
  /** After the modal is gone (reader mode gives its keys back). */
  onClosed?: () => void;
}

export interface ResearchEngineOption {
  id: AICommentEngineId;
  label: string;
  /** Set when the engine can run deep research (an OpenAI or Gemini key). */
  deep: DeepResearchProvider | null;
}

/** The user's own keys first, then installed CLIs (Quick only). */
export function researchEngineOptions(byok: ByokService | null, clis: readonly AICli[]): ResearchEngineOption[] {
  const own = (byok?.readyProviders() ?? []).map((provider): ResearchEngineOption => ({
    id: toStoredProviderId(provider),
    label: byokEngineLabel(provider),
    deep: provider === 'openai' || provider === 'gemini' ? provider : null,
  }));
  return [...own, ...clis.map((cli): ResearchEngineOption => ({ id: cli, label: AI_CLI_INFO[cli].displayName, deep: null }))];
}

export class AIResearchModal extends Modal {
  private engines: ResearchEngineOption[] = [];
  private isOpen = false;
  private running: AbortController | null = null;
  private elapsedTimer: number | null = null;

  private formEl: HTMLElement | null = null;
  private engineSelect: HTMLSelectElement | null = null;
  private quickInput: HTMLInputElement | null = null;
  private deepInput: HTMLInputElement | null = null;
  private depthNoteEl: HTMLElement | null = null;
  private focusInput: HTMLTextAreaElement | null = null;
  private runButton: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, private readonly options: AIResearchModalOptions) {
    super(app);
  }

  onOpen(): void {
    this.isOpen = true;
    this.modalEl.addClass('sa-ai-research-modal');
    this.setTitle(t('byok.research.title'));
    this.contentEl.empty();
    const loading = this.contentEl.createDiv({ cls: 'sa-ai-research-note', text: '…' });
    void this.options
      .detectClis()
      .catch((): AICli[] => [])
      .then((clis) => {
        if (!this.isOpen) return;
        loading.remove();
        this.engines = researchEngineOptions(this.options.byok, clis);
        this.render();
      });
  }

  onClose(): void {
    this.isOpen = false;
    this.stopElapsed();
    this.contentEl.empty();
    this.options.onClosed?.();
  }

  private render(): void {
    const { contentEl } = this;
    if (this.engines.length === 0) {
      const box = contentEl.createDiv({ cls: 'sa-ai-chat-no-engine' });
      box.createEl('p', { text: Platform.isMobile ? t('byok.research.noEngine') : t('byok.research.noEngineDesktop') });
      box.createEl('button', { cls: 'mod-cta', text: t('byok.openSettings') }).addEventListener('click', () => {
        this.close();
        this.options.openSettings();
      });
      return;
    }

    const form = contentEl.createDiv({ cls: 'sa-ai-research-form' });
    this.formEl = form;
    form.createEl('p', { cls: 'sa-ai-research-intro', text: t('byok.research.intro') });

    const engineLabel = form.createEl('label', { cls: 'sa-ai-research-field', text: t('byok.research.engine') });
    const select = engineLabel.createEl('select', { cls: 'dropdown' });
    this.engineSelect = select;
    for (const engine of this.engines) select.createEl('option', { text: engine.label, attr: { value: engine.id } });
    select.addEventListener('change', () => this.updateDepth());

    const depth = form.createEl('fieldset', { cls: 'sa-ai-research-depth' });
    depth.createEl('legend', { text: t('byok.research.depth') });
    this.quickInput = this.radio(depth, 'quick', t('byok.research.quick'), true);
    this.deepInput = this.radio(depth, 'deep', t('byok.research.deep'), false);
    this.depthNoteEl = form.createDiv({ cls: 'sa-ai-research-note' });

    const focusLabel = form.createEl('label', { cls: 'sa-ai-research-field', text: t('byok.research.focus') });
    this.focusInput = focusLabel.createEl('textarea', {
      cls: 'sa-ai-research-focus',
      attr: { rows: '2', maxlength: String(RESEARCH_MAX_FOCUS_CHARS), placeholder: t('byok.research.focusPlaceholder') },
    });

    this.errorEl = contentEl.createDiv({ cls: 'sa-ai-chat-error is-hidden' });
    this.errorEl.setAttribute('role', 'alert');
    this.statusEl = contentEl.createDiv({ cls: 'sa-ai-research-status is-hidden' });

    const footer = contentEl.createDiv({ cls: 'sa-ai-chat-footer' });
    this.runButton = footer.createEl('button', { cls: 'mod-cta', text: t('byok.research.run') });
    this.runButton.addEventListener('click', () => {
      if (this.running) this.running.abort();
      else void this.run();
    });
    this.updateDepth();
  }

  private radio(parent: HTMLElement, value: string, text: string, checked: boolean): HTMLInputElement {
    const label = parent.createEl('label', { cls: 'sa-ai-research-choice' });
    const input = label.createEl('input', { attr: { type: 'radio', name: 'sa-ai-research-depth', value } });
    input.checked = checked;
    input.addEventListener('change', () => this.updateDepth());
    label.createSpan({ text });
    return input;
  }

  private selectedEngine(): ResearchEngineOption | undefined {
    return this.engines.find((engine) => engine.id === this.engineSelect?.value) ?? this.engines[0];
  }

  private updateDepth(): void {
    const engine = this.selectedEngine();
    const deepOk = Boolean(engine?.deep);
    if (this.deepInput) {
      this.deepInput.disabled = !deepOk;
      if (!deepOk && this.deepInput.checked && this.quickInput) this.quickInput.checked = true;
    }
    if (this.depthNoteEl) {
      this.depthNoteEl.textContent = this.deepInput?.checked && engine?.deep
        ? t('byok.research.deepDesc', { provider: BYOK_PROVIDERS[engine.deep].label })
        : deepOk
          ? t('byok.research.quickDesc')
          : `${t('byok.research.quickDesc')} ${t('byok.research.deepUnavailable')}`;
    }
  }

  private async run(): Promise<void> {
    const engine = this.selectedEngine();
    if (!engine || this.running) return;
    const focus = this.focusInput?.value ?? '';
    const deep = Boolean(this.deepInput?.checked && engine.deep);
    this.showError('');
    if (deep && engine.deep) {
      await this.startDeep(engine.deep, focus);
      return;
    }

    const abort = new AbortController();
    this.running = abort;
    this.setRunning(engine.label);
    try {
      await this.options.runner.runQuick({
        target: this.options.target,
        engine: engine.id,
        focus,
        ...(this.options.outputLanguage ? { outputLanguage: this.options.outputLanguage } : {}),
        signal: abort.signal,
        onProgress: (progress) => {
          if (this.isOpen && progress.status && this.statusEl) this.statusText(progress.status);
        },
      });
      new Notice(t('byok.research.saved'));
      if (this.isOpen) this.close();
    } catch (error) {
      if (abort.signal.aborted) {
        if (this.isOpen) this.setIdle();
        return;
      }
      const message = researchErrorMessage(error);
      if (this.isOpen) {
        this.setIdle();
        this.showError(message);
      } else {
        new Notice(t('byok.research.failed', { reason: message }), 8000);
      }
    } finally {
      this.running = null;
    }
  }

  private async startDeep(provider: DeepResearchProvider, focus: string): Promise<void> {
    if (this.runButton) this.runButton.disabled = true;
    try {
      await this.options.runner.startDeep({
        target: this.options.target,
        provider,
        archiveId: this.options.archiveId,
        focus,
        ...(this.options.outputLanguage ? { outputLanguage: this.options.outputLanguage } : {}),
      });
      new Notice(t('byok.research.deepStarted', { provider: BYOK_PROVIDERS[provider].label }), 8000);
      if (this.isOpen) this.close();
    } catch (error) {
      this.showError(researchErrorMessage(error));
    } finally {
      if (this.runButton) this.runButton.disabled = false;
    }
  }

  private setRunning(engineLabel: string): void {
    this.formEl?.addClass('is-running');
    for (const input of [this.engineSelect, this.quickInput, this.deepInput, this.focusInput]) {
      if (input) input.disabled = true;
    }
    if (this.runButton) {
      this.runButton.textContent = t('byok.research.cancel');
      this.runButton.removeClass('mod-cta');
    }
    const status = this.statusEl;
    if (!status) return;
    status.removeClass('is-hidden');
    status.empty();
    status.createDiv({ cls: 'sa-ai-research-status-line', text: t('byok.research.running', { engine: engineLabel }) });
    status.createDiv({ cls: 'sa-ai-research-status-detail' });
    status.createDiv({ cls: 'sa-ai-research-note', text: t('byok.research.backgroundHint') });
    const startedAt = Date.now();
    const elapsed = status.createDiv({ cls: 'sa-ai-research-elapsed' });
    const tick = (): void => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };
    tick();
    this.elapsedTimer = window.setInterval(tick, 1000);
  }

  private statusText(text: string): void {
    const detail = this.statusEl?.querySelector('.sa-ai-research-status-detail');
    if (detail) detail.textContent = text;
  }

  private setIdle(): void {
    this.stopElapsed();
    this.formEl?.removeClass('is-running');
    if (this.engineSelect) this.engineSelect.disabled = false;
    if (this.quickInput) this.quickInput.disabled = false;
    if (this.focusInput) this.focusInput.disabled = false;
    if (this.runButton) {
      this.runButton.textContent = t('byok.research.run');
      this.runButton.addClass('mod-cta');
    }
    this.statusEl?.addClass('is-hidden');
    this.updateDepth();
  }

  private stopElapsed(): void {
    if (this.elapsedTimer !== null) window.clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
  }

  private showError(message: string): void {
    if (!this.errorEl) return;
    this.errorEl.textContent = message;
    this.errorEl.toggleClass('is-hidden', !message);
  }
}
