/**
 * The "@" picker on a note textarea: typing "@" (or "@cl") lists, under the
 * box, the AIs this vault can ask about the post, and picking one writes the
 * plain-text mention ("@Claude "). Arrow Up/Down move, Enter or Tab inserts,
 * Escape closes. While the list is open those keys belong to it, through a
 * key scope on top of the editor's (Obsidian handles keys before any element
 * does), so they never reach the editor's own save or cancel.
 */
import { Scope, type App } from 'obsidian';
import {
  AI_MENTION_HANDLES,
  aiMentionQueryAt,
  aiMentionSuggestions,
  insertAIMention,
  type AIMentionHandle,
  type AIMentionTarget,
} from '../../vendor/byok-ai-core';
import type { ChatEngine } from '../../services/byok/PostChatSession';
import type { ChatEngineOption } from './AIChatPanel';
import { t } from '../../i18n';

export interface AIMentionPickerOptions {
  app: App;
  textarea: HTMLTextAreaElement;
  /** What chat on the post can use (chatEnginesFor): only these AIs are offered. */
  engines: readonly ChatEngineOption[];
  /** The editor's key scope: its other shortcuts keep working while the list is open. */
  scope?: Scope;
}

interface Offer {
  handle: AIMentionHandle;
  /** The engine as chat names it ("Anthropic (my key)", "Cloud AI"). */
  label: string;
}

export class AIMentionPicker {
  private readonly offers: Offer[];
  private readonly handles: AIMentionHandle[];
  private query: { start: number; query: string } | null = null;
  private items: AIMentionHandle[] = [];
  private active = 0;
  /** Escape closed the list for the "@" at this index. */
  private dismissedAt: number | null = null;
  private listEl: HTMLElement | null = null;
  private keys: Scope | null = null;

  constructor(private readonly options: AIMentionPickerOptions) {
    this.offers = AI_MENTION_HANDLES.flatMap((handle) => {
      const engine = options.engines.find((option) => sameTarget(option.engine, handle.target));
      return engine ? [{ handle, label: engine.label }] : [];
    });
    this.handles = this.offers.map((offer) => offer.handle);
    if (this.handles.length === 0) return;
    const { textarea } = options;
    textarea.addEventListener('input', this.onInput);
    textarea.addEventListener('click', this.refresh);
    textarea.addEventListener('keyup', this.onKeyUp);
    textarea.addEventListener('blur', this.close);
  }

  get isOpen(): boolean {
    return this.listEl !== null;
  }

  /** The editor closed: the list and its keys go too. */
  destroy(): void {
    this.close();
    const { textarea } = this.options;
    textarea.removeEventListener('input', this.onInput);
    textarea.removeEventListener('click', this.refresh);
    textarea.removeEventListener('keyup', this.onKeyUp);
    textarea.removeEventListener('blur', this.close);
  }

  private readonly onInput = (): void => {
    this.dismissedAt = null;
    this.refresh();
  };

  /** The caret moved without typing (arrows, Home, End). */
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!LIST_KEYS.has(event.key)) this.refresh();
  };

  /** Shows the AIs matching the "@…" just before the caret, or closes. */
  private readonly refresh = (): void => {
    const { value, selectionStart, selectionEnd } = this.options.textarea;
    const query = selectionStart === selectionEnd ? aiMentionQueryAt(value, selectionStart) : null;
    const items = query && query.start !== this.dismissedAt ? aiMentionSuggestions(query.query, this.handles) : [];
    if (!query || items.length === 0) {
      this.close();
      return;
    }
    if (this.query?.start !== query.start || this.query.query !== query.query) this.active = 0;
    this.query = query;
    this.items = items;
    this.render();
    this.holdKeys();
  };

  private readonly close = (): void => {
    this.listEl?.remove();
    this.listEl = null;
    this.query = null;
    this.items = [];
    if (this.keys) this.options.app.keymap.popScope(this.keys);
    this.keys = null;
  };

  private render(): void {
    const { textarea } = this.options;
    const parent = textarea.parentElement;
    if (!parent) return;
    if (!this.listEl) {
      this.listEl = parent.createDiv({ cls: 'sa-ai-mention-picker', attr: { role: 'listbox', 'aria-label': t('byok.mention.picker') } });
      textarea.insertAdjacentElement('afterend', this.listEl);
      // The box keeps focus (and a phone its keyboard); the card behind the editor never sees the click.
      this.listEl.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      this.listEl.addEventListener('click', (event) => event.stopPropagation());
    }
    const list = this.listEl;
    list.empty();
    this.items.forEach((handle, index) => {
      const row = list.createDiv({
        cls: 'sa-ai-mention-option',
        attr: { role: 'option', 'aria-selected': String(index === this.active) },
      });
      row.toggleClass('is-selected', index === this.active);
      row.createSpan({ cls: 'sa-ai-mention-handle', text: `@${handle.handle}` });
      row.createSpan({ cls: 'sa-ai-mention-engine', text: this.offers.find((offer) => offer.handle === handle)?.label ?? '' });
      // On mousedown, before the box would lose focus (and the keyboard on a phone).
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.pick(index);
      });
    });
  }

  /** The list's keys, above the editor's: taken while it is open, given back when it closes. */
  private holdKeys(): void {
    if (this.keys) return;
    const { app } = this.options;
    const keys = new Scope(this.options.scope ?? app.scope);
    const take = (action: () => void) => (event: KeyboardEvent): false | undefined => {
      // Mid-IME the key belongs to the composition; a box that went away gives its keys back.
      if (event.isComposing) return undefined;
      if (!this.options.textarea.isConnected) {
        this.destroy();
        return undefined;
      }
      action();
      return false;
    };
    keys.register([], 'ArrowDown', take(() => this.move(1)));
    keys.register([], 'ArrowUp', take(() => this.move(-1)));
    keys.register([], 'Enter', take(() => this.pick(this.active)));
    keys.register(['Mod'], 'Enter', take(() => this.pick(this.active)));
    keys.register([], 'Tab', take(() => this.pick(this.active)));
    keys.register([], 'Escape', take(() => {
      this.dismissedAt = this.query?.start ?? null;
      this.close();
    }));
    app.keymap.pushScope(keys);
    this.keys = keys;
  }

  private move(delta: number): void {
    const count = this.items.length;
    if (count === 0) return;
    this.active = (this.active + delta + count) % count;
    this.render();
  }

  private pick(index: number): void {
    const handle = this.items[index];
    const query = this.query;
    const { textarea } = this.options;
    if (!handle || !query) return;
    const next = insertAIMention(textarea.value, query.start, textarea.selectionStart, handle);
    textarea.value = next.text;
    textarea.setSelectionRange(next.cursor, next.cursor);
    // Listeners on the box (autosize) see the edit as typing.
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    // "@Claude" right before the caret (text followed it) must not offer itself again.
    this.dismissedAt = query.start;
    this.close();
  }
}

/** Keys the open list handles itself (their keyup must not reopen it). */
const LIST_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']);

function sameTarget(engine: ChatEngine, target: AIMentionTarget): boolean {
  return engine.kind === 'cloud' ? target.kind === 'cloud' : target.kind === 'byok' && target.provider === engine.provider;
}
