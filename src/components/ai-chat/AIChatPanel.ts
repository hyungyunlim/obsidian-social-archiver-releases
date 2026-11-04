/**
 * "Chat about this post", the view: a chat grounded in one archived post, on
 * the user's own key (streamed) or Cloud AI. The conversation is the post's
 * session (postChatSessions), so closing the panel puts the chat down: its
 * draft and an answer on its way stay, and opening chat on the post again
 * shows them. The first answer fixes the engine ("New chat" starts over);
 * "Save to note" stores the transcript as a `chat` AI comment, replacing the
 * saved chat it continues, oldest turns left out when it would not fit. On
 * the user's own key the web search chip under the question lets the next
 * question search the web; nothing else does. Renders into any host element:
 * the modal and the reader-mode dock both use it. The host decides when the
 * panel goes away (`onDone`, `destroy`).
 */
import { Component, MarkdownRenderer, Notice, Platform, setIcon, type App } from 'obsidian';
import {
  BYOK_PROVIDERS,
  CHAT_MAX_QUESTION_CHARS,
  CHAT_MAX_USER_TURNS,
  toStoredProviderId,
  type ByokArticleInput,
  type ByokMessage,
  type ByokProviderId,
} from '../../vendor/byok-ai-core';
import type { AICommentTarget } from '../../services/ai-comment/AICommentSaver';
import type { ByokService } from '../../services/byok/ByokService';
import type { WorkersAPIClient } from '../../services/WorkersAPIClient';
import type { ChatEngine, PostChatSession } from '../../services/byok/PostChatSession';
import { openPostChatSession } from '../../services/byok/postChatSessions';
import { buildPostArticleInput } from '../../services/byok/postArticleInput';
import { byokEngineLabel } from '../../services/byok/byokText';
import { showConfirmModal } from '../../utils/confirm-modal';
import { t } from '../../i18n';

export interface AIChatPanelOptions {
  target: AICommentTarget;
  byok: ByokService | null;
  /** Cloud AI client; null while unconfigured. */
  cloud: () => Pick<WorkersAPIClient, 'askChatAI' | 'getChatAIAvailability'> | null;
  /** Server archive id: Cloud AI is offered only for posts the server has, while signed in. */
  archiveId: string | null;
  signedIn: boolean;
  /** 'auto' | ISO code. */
  outputLanguage?: string;
  openSettings: () => void;
  /** The chat is saved, or the user went to settings: the host closes it. */
  onDone: () => void;
  /** A confirm dialog opens (true) or closes (false): reader mode holds its shortcuts meanwhile. */
  onDialog?: (open: boolean) => void;
}

export interface ChatEngineOption {
  id: string;
  label: string;
  engine: ChatEngine;
}

const CLOUD_ENGINE_ID = 'cloud';

/** The user's own keys first, then Cloud AI (signed in, post on the server). */
export function chatEngineOptions(options: Pick<AIChatPanelOptions, 'byok' | 'archiveId' | 'signedIn'>): ChatEngineOption[] {
  const own: ChatEngineOption[] = (options.byok?.readyProviders() ?? []).map((provider) => ({
    id: toStoredProviderId(provider),
    label: byokEngineLabel(provider),
    engine: { kind: 'byok', provider },
  }));
  return options.signedIn && options.archiveId
    ? [...own, { id: CLOUD_ENGINE_ID, label: 'Cloud AI', engine: { kind: 'cloud' } }]
    : own;
}

export class AIChatPanel {
  private readonly session: PostChatSession;
  private readonly unsubscribe: () => void;
  private engines: ChatEngineOption[];
  private markdown = new Component();
  /** How many of the session's messages the list shows. */
  private rendered = 0;
  private pendingEls: { questionEl: HTMLElement; answerEl: HTMLElement } | null = null;
  private saving = false;
  private saveError = '';
  private destroyed = false;
  private cloudCredits: number | undefined;
  private sendShowsStop: boolean | null = null;
  /** The provider asked whether its chat model can search the web, and the model that cannot (null: it can, or unknown). */
  private webCheck: { provider: ByokProviderId; noWebModel: string | null } | null = null;

  private engineSelect: HTMLSelectElement | null = null;
  private noteEl: HTMLElement | null = null;
  private newChatButton: HTMLButtonElement | null = null;
  private listEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private webButton: HTMLButtonElement | null = null;
  private webNoteEl: HTMLElement | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private footerEl: HTMLElement | null = null;
  private saveButton: HTMLButtonElement | null = null;

  constructor(
    private readonly app: App,
    private readonly host: HTMLElement,
    private readonly options: AIChatPanelOptions,
  ) {
    const { target } = options;
    this.session = openPostChatSession(target, {
      byok: (): ByokService | null => options.byok,
      cloud: options.cloud,
      article: (): ByokArticleInput => buildPostArticleInput(target.post),
      archiveId: options.archiveId,
      ...(options.outputLanguage ? { outputLanguage: options.outputLanguage } : {}),
    });
    this.engines = chatEngineOptions(options);
    // A chat put down keeps its engine; a new one starts on the first offered.
    const first = this.engines[0];
    if (first && !this.engines.some((option) => sameEngine(option.engine, this.session.engine))) {
      this.session.setEngine(first.engine);
    }
    this.markdown.load();
    this.render();
    this.unsubscribe = this.session.subscribe(() => this.sync());
  }

  focus(): void {
    // Phones would pop the keyboard over the article.
    if (!Platform.isMobile) this.inputEl?.focus();
  }

  /** The panel goes away, the chat does not: its session keeps it, an answer on its way included. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.markdown.unload();
    this.host.empty();
  }

  private render(): void {
    const host = this.host;
    host.empty();
    host.addClass('sa-ai-chat-panel');

    if (this.engines.length === 0) {
      this.renderNoEngine(host, t('byok.chat.noEngine'));
      return;
    }

    const toolbar = host.createDiv({ cls: 'sa-ai-chat-toolbar' });
    const label = toolbar.createEl('label', { cls: 'sa-ai-chat-engine', text: t('byok.chat.engine') });
    const select = label.createEl('select', { cls: 'dropdown' });
    this.engineSelect = select;
    this.renderEngineOptions();
    select.addEventListener('change', () => {
      const option = this.engines.find((entry) => entry.id === select.value);
      if (option) this.session.setEngine(option.engine);
      this.updateControls();
    });
    this.newChatButton = toolbar.createEl('button', { cls: 'sa-ai-chat-new', text: t('byok.chat.newChat') });
    this.newChatButton.addEventListener('click', () => void this.newChat());
    this.noteEl = host.createDiv({ cls: 'sa-ai-chat-note' });

    this.listEl = host.createDiv({ cls: 'sa-ai-chat-list' });
    this.emptyEl = this.listEl.createDiv({ cls: 'sa-ai-chat-empty', text: t('byok.chat.empty') });
    this.errorEl = host.createDiv({ cls: 'sa-ai-chat-error' });
    this.errorEl.setAttribute('role', 'alert');

    // One box: the question, and under it a row with the web search chip and send.
    const composer = host.createDiv({ cls: 'sa-ai-chat-composer' });
    const input = composer.createEl('textarea', {
      cls: 'sa-ai-chat-input',
      // One line to start (grows with `field-sizing: content` where supported).
      attr: { rows: '1', maxlength: String(CHAT_MAX_QUESTION_CHARS), placeholder: t('byok.chat.placeholder') },
    });
    this.inputEl = input;
    // The half-typed question waits in the session while the chat is closed.
    input.addEventListener('input', () => this.session.setInput(input.value));
    input.addEventListener('keydown', (event) => {
      // Phones insert a newline with Enter; desktop sends (Shift+Enter for a newline, never mid-IME).
      if (Platform.isMobile || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      this.send();
    });
    const actions = composer.createDiv({ cls: 'sa-ai-chat-composer-actions' });
    // Own key only: web access for the next question, off by default. Same words as the custom comment's option.
    this.webButton = actions.createEl('button', { cls: 'sa-ai-chat-web', attr: { type: 'button' } });
    setIcon(this.webButton.createSpan({ cls: 'sa-ai-chat-web-icon' }), 'globe');
    this.webButton.createSpan({ text: t('byok.web.comment') });
    this.webButton.addEventListener('click', () => this.session.setWeb(!this.session.web));
    this.sendButton = actions.createEl('button', { cls: 'sa-ai-chat-send mod-cta' });
    this.sendButton.addEventListener('click', () => {
      if (this.session.pending) this.session.stop();
      else this.send();
    });
    this.webNoteEl = host.createDiv({ cls: 'sa-ai-chat-web-note' });

    this.footerEl = host.createDiv({ cls: 'sa-ai-chat-footer' });
    this.saveButton = this.footerEl.createEl('button', { cls: 'sa-ai-chat-save mod-cta', text: t('byok.chat.save') });
    this.saveButton.addEventListener('click', () => void this.save());

    this.sync();
    void this.refreshCloudAvailability();
  }

  private renderNoEngine(parent: HTMLElement, message: string): void {
    const box = parent.createDiv({ cls: 'sa-ai-chat-no-engine' });
    box.createEl('p', { text: message });
    const button = box.createEl('button', { cls: 'mod-cta', text: t('byok.openSettings') });
    button.addEventListener('click', () => {
      this.options.onDone();
      this.options.openSettings();
    });
  }

  private renderEngineOptions(): void {
    const select = this.engineSelect;
    if (!select) return;
    select.empty();
    for (const option of this.engines) select.createEl('option', { text: option.label, attr: { value: option.id } });
    const current = this.session.engine;
    const selected = this.engines.find((option) => sameEngine(option.engine, current)) ?? this.engines[0];
    if (selected) select.value = selected.id;
  }

  /** Drops Cloud AI for accounts that keep it off (local only, server disabled); learns its price. */
  private async refreshCloudAvailability(): Promise<void> {
    if (!this.engines.some((option) => option.id === CLOUD_ENGINE_ID)) return;
    try {
      const api = this.options.cloud();
      if (!api) return;
      const { cloud } = await api.getChatAIAvailability();
      if (this.destroyed) return;
      this.cloudCredits = typeof cloud.credits === 'number' ? cloud.credits : undefined;
      if (!cloud.available && !cloud.consentRequired && !this.session.locked && this.engines.length > 1) {
        this.engines = this.engines.filter((option) => option.id !== CLOUD_ENGINE_ID);
        if (this.session.engine?.kind === 'cloud' && this.engines[0]) this.session.setEngine(this.engines[0].engine);
        this.renderEngineOptions();
      }
    } catch {
      // Offline or older server: keep Cloud AI listed; a question reports what went wrong.
    }
    this.updateControls();
  }

  /** Brings the view up to the session: new turns, the answer streaming in, the draft, the controls. */
  private sync(): void {
    const list = this.listEl;
    if (this.destroyed || !list) return;
    const { messages, pending } = this.session;
    let grew = false;
    if (messages.length < this.rendered) this.clearList(list);
    if (messages.length > this.rendered) {
      this.dropPending();
      for (const message of messages.slice(this.rendered)) this.renderMessage(list, message);
      this.rendered = messages.length;
      grew = true;
    }
    if (pending) {
      this.pendingEls ??= {
        questionEl: list.createDiv({ cls: 'sa-ai-chat-message sa-ai-chat-message-user', text: pending.question }),
        answerEl: list.createDiv({ cls: 'sa-ai-chat-message sa-ai-chat-message-ai is-pending' }),
      };
      const text = pending.partial || t('byok.chat.thinking');
      if (this.pendingEls.answerEl.textContent !== text) {
        this.pendingEls.answerEl.textContent = text;
        grew = true;
      }
    } else {
      this.dropPending();
    }
    if (this.inputEl && this.inputEl.value !== this.session.input) this.inputEl.value = this.session.input;
    this.showError(this.saveError || this.session.error);
    this.updateControls();
    if (grew) this.scrollToEnd();
  }

  private renderMessage(list: HTMLElement, message: ByokMessage): void {
    if (message.role === 'user') {
      list.createDiv({ cls: 'sa-ai-chat-message sa-ai-chat-message-user', text: message.content });
      return;
    }
    const answerEl = list.createDiv({ cls: 'sa-ai-chat-message sa-ai-chat-message-ai' });
    void MarkdownRenderer.render(this.app, message.content, answerEl, this.options.target.post.filePath ?? '', this.markdown).then(
      () => this.scrollToEnd(),
      () => {
        answerEl.textContent = message.content;
      },
    );
  }

  /** The session started over (New chat): so does the list. */
  private clearList(list: HTMLElement): void {
    this.markdown.unload();
    this.markdown = new Component();
    this.markdown.load();
    list.empty();
    if (this.emptyEl) list.appendChild(this.emptyEl);
    this.pendingEls = null;
    this.rendered = 0;
  }

  private dropPending(): void {
    this.pendingEls?.questionEl.remove();
    this.pendingEls?.answerEl.remove();
    this.pendingEls = null;
  }

  private send(): void {
    const input = this.inputEl;
    if (!input || this.saving || this.session.pending) return;
    this.saveError = '';
    void this.session.send(input.value);
    // Phones: the answer gets the screen; tapping the box brings the keyboard back.
    if (this.session.pending && Platform.isMobile) input.blur();
  }

  /** Starts over; only turns the note does not have yet are worth a question first. */
  private async newChat(): Promise<void> {
    if (this.session.hasUnsaved && !(await this.confirmDiscard())) return;
    this.saveError = '';
    this.session.reset();
  }

  private confirmDiscard(): Promise<boolean> {
    this.options.onDialog?.(true);
    return showConfirmModal(this.app, {
      title: t('byok.chat.discardTitle'),
      message: t('byok.chat.discardMessage'),
      confirmText: t('byok.chat.discard'),
      cancelText: t('byok.chat.keep'),
      confirmClass: 'warning',
    }).finally(() => this.options.onDialog?.(false));
  }

  /** Saves the whole conversation, replacing the saved chat it continues, then hands the panel back to the host. */
  private async save(): Promise<void> {
    const session = this.session;
    if (this.saving || session.pending || !session.hasUnsaved) return;
    this.saving = true;
    this.saveError = '';
    this.sync();
    try {
      const replaceId = session.savedCommentId ?? undefined;
      const budget = await this.options.target.budget('chat', replaceId);
      const turns = session.messages;
      const comment = budget ? session.buildComment(budget) : null;
      if (!comment) {
        this.saveError = t('byok.noRoom');
        return;
      }
      await this.options.target.save(comment.meta, comment.content, replaceId);
      session.markSaved(comment.meta.id, turns);
      new Notice(comment.droppedTurns > 0 ? t('byok.chat.savedTrimmed', { count: comment.droppedTurns }) : t('byok.chat.saved'));
      if (!this.destroyed) this.options.onDone();
    } catch (error) {
      this.saveError = t('byok.saveFailed', { reason: error instanceof Error ? error.message : String(error) });
    } finally {
      this.saving = false;
      this.sync();
    }
  }

  private showError(message: string): void {
    if (!this.errorEl) return;
    this.errorEl.textContent = message;
    this.errorEl.toggleClass('is-hidden', !message);
  }

  private scrollToEnd(): void {
    const list = this.listEl;
    if (list) list.scrollTop = list.scrollHeight;
  }

  private updateControls(): void {
    const session = this.session;
    const busy = session.pending !== null;
    const started = session.locked || busy;
    if (this.engineSelect) this.engineSelect.disabled = started;
    if (this.noteEl) {
      this.noteEl.textContent = session.atTurnLimit
        ? t('byok.chat.turnLimit', { max: CHAT_MAX_USER_TURNS })
        : started
          ? t('byok.chat.engineLocked')
          : session.engine?.kind === 'cloud' && this.cloudCredits !== undefined
            ? t('byok.chat.cloudCredits', { credits: this.cloudCredits })
            : '';
    }
    if (this.newChatButton) this.newChatButton.disabled = this.saving || (!busy && session.messages.length === 0);
    this.emptyEl?.toggleClass('is-hidden', session.messages.length > 0 || busy);
    if (this.inputEl) this.inputEl.disabled = this.saving || session.atTurnLimit;
    if (this.sendButton) {
      // The icon only changes with the turn, not with every streamed word.
      if (this.sendShowsStop !== busy) {
        this.sendShowsStop = busy;
        const label = busy ? t('byok.chat.stop') : t('byok.chat.send');
        this.sendButton.empty();
        setIcon(this.sendButton, busy ? 'square' : 'arrow-up');
        this.sendButton.setAttribute('aria-label', label);
        this.sendButton.setAttribute('title', label);
      }
      this.sendButton.disabled = this.saving || (!busy && session.atTurnLimit);
    }
    this.updateWebControls();
    // Save shows only for turns the note does not have yet.
    this.footerEl?.toggleClass('is-hidden', !session.hasUnsaved);
    if (this.saveButton) this.saveButton.disabled = this.saving || busy;
  }

  /** The web toggle shows for the user's own key (never Cloud AI); greyed out, with why, when the model cannot search. */
  private updateWebControls(): void {
    const session = this.session;
    const provider = session.engine?.kind === 'byok' ? session.engine.provider : null;
    if (provider && this.webCheck?.provider !== provider) void this.checkWebSearch(provider);
    const noWebModel = provider ? this.webCheck?.noWebModel ?? null : null;
    if (this.webButton) {
      const on = session.web && !noWebModel;
      const label = noWebModel ? t('byok.web.unsupported', { model: noWebModel }) : t('byok.chat.web');
      this.webButton.toggleClass('is-hidden', !provider);
      this.webButton.toggleClass('is-active', on);
      this.webButton.setAttribute('aria-pressed', String(on));
      this.webButton.setAttribute('aria-label', label);
      this.webButton.setAttribute('title', label);
      this.webButton.disabled = this.saving || session.atTurnLimit || noWebModel !== null;
    }
    if (this.webNoteEl) {
      const note = !provider
        ? ''
        : noWebModel
          ? t('byok.web.unsupported', { model: noWebModel })
          : session.web
            ? t('byok.web.cost', { provider: BYOK_PROVIDERS[provider].label })
            : '';
      this.webNoteEl.textContent = note;
      this.webNoteEl.toggleClass('is-hidden', !note);
    }
  }

  /** Asks once per engine whether its chat model can search the web; until it says no, the toggle works. */
  private async checkWebSearch(provider: ByokProviderId): Promise<void> {
    const check: { provider: ByokProviderId; noWebModel: string | null } = { provider, noWebModel: null };
    this.webCheck = check;
    try {
      check.noWebModel = (await this.options.byok?.modelWithoutWebSearch(provider, 'chat')) ?? null;
    } catch {
      return; // No model list to ask: unknown, so the request just tries.
    }
    if (this.destroyed || this.webCheck !== check || !check.noWebModel) return;
    this.session.setWeb(false);
    this.updateControls();
  }
}

function sameEngine(a: ChatEngine, b: ChatEngine | null): boolean {
  if (!b || a.kind !== b.kind) return false;
  return a.kind === 'cloud' || (b.kind === 'byok' && a.provider === b.provider);
}
