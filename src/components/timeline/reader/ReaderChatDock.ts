/**
 * "Chat about this post" docked in reader mode, so the article stays readable
 * while chatting: a pane right of the article on wide screens (drag its left
 * edge to resize; the width is remembered on this device), a bottom sheet over
 * it on narrow ones (the handle toggles half and full height; CSS picks the
 * layout). Owns the layout only; the conversation is an AIChatPanel.
 *
 * The dock shows the chat of the post on screen: each post keeps its own
 * conversation (postChatSessions), so moving on or closing the dock loses
 * nothing, and the header names the post.
 */
import { setIcon, type App } from 'obsidian';
import { AIChatPanel, type AIChatPanelOptions } from '../../ai-chat/AIChatPanel';
import type { PostData } from '../../../types/post';
import { t } from '../../../i18n';

export type ReaderChatPanelOptions = Omit<AIChatPanelOptions, 'onDone' | 'onDialog'>;

export interface ReaderChatDockOptions {
  app: App;
  /** The reader's container; the dock lives beside its panel so post re-renders keep it. */
  container: HTMLElement;
  /** Panel options for a post; null when the post has no note to save to. */
  panelOptions: (post: PostData) => ReaderChatPanelOptions | null;
  /** A confirm dialog opens (true) or closes (false): the reader holds its shortcuts meanwhile. */
  onDialog: (open: boolean) => void;
  /** The dock is gone (closed, saved, or the reader closed); the chat stays with its post. */
  onClosed: () => void;
}

export const READER_CHAT_WIDTH_KEY = 'social-archiver-reader-chat-width';
export const READER_CHAT_WIDTH = { min: 320, default: 400, max: 720 } as const;

export class ReaderChatDock {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private panel: AIChatPanel | null = null;
  private post: PostData | null = null;
  private destroyed = false;

  constructor(private readonly options: ReaderChatDockOptions, post: PostData) {
    const { container } = options;
    container.addClass('has-chat-dock');
    this.applyWidth(this.loadWidth());

    this.el = container.createDiv({ cls: 'sa-reader-chat-dock' });
    this.el.setAttribute('role', 'complementary');
    this.el.setAttribute('aria-label', t('byok.chat.title'));
    this.bindResize(this.el.createDiv({ cls: 'sa-reader-chat-resize' }));

    const header = this.el.createDiv({ cls: 'sa-reader-chat-header' });
    const handle = header.createEl('button', {
      cls: 'sa-reader-chat-sheet-handle',
      attr: { 'aria-label': t('byok.chat.dock.resize'), type: 'button' },
    });
    handle.addEventListener('click', () => {
      this.el.toggleClass('is-expanded', !this.el.hasClass('is-expanded'));
    });
    const heading = header.createDiv({ cls: 'sa-reader-chat-heading' });
    heading.createDiv({ cls: 'sa-reader-chat-title', text: t('byok.chat.title') });
    this.subtitleEl = heading.createDiv({ cls: 'sa-reader-chat-subtitle' });
    const close = header.createEl('button', {
      cls: 'clickable-icon sa-reader-chat-close',
      attr: { 'aria-label': t('byok.chat.dock.close'), type: 'button' },
    });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.destroy());

    this.body = this.el.createDiv({ cls: 'sa-reader-chat-body' });
    this.bind(post);
  }

  contains(node: Node | null): boolean {
    return node !== null && this.el.contains(node);
  }

  /** The reader moved to another post: the dock shows that post's chat. */
  followPost(post: PostData): void {
    if (this.destroyed || post.filePath === this.post?.filePath) return;
    this.bind(post);
  }

  focus(): void {
    this.panel?.focus();
  }

  /** The close button, Esc inside the dock, a saved chat or the reader closing: the chat is put down, not ended. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.panel?.destroy();
    this.panel = null;
    this.el.remove();
    this.options.container.removeClass('has-chat-dock');
    this.options.onClosed();
  }

  private bind(post: PostData): void {
    this.panel?.destroy();
    this.panel = null;
    this.post = post;
    this.subtitleEl.textContent = chatPostLabel(post);
    this.body.empty();
    const panelOptions = this.options.panelOptions(post);
    if (!panelOptions) {
      this.body.createDiv({ cls: 'sa-ai-chat-empty', text: t('byok.chat.dock.noNote') });
      return;
    }
    this.panel = new AIChatPanel(this.options.app, this.body.createDiv(), {
      ...panelOptions,
      onDone: (): void => this.destroy(),
      onDialog: this.options.onDialog,
    });
  }

  /** Drag the pane's left edge (wide layout only; the handle is hidden in the sheet layout). */
  private bindResize(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (down: PointerEvent) => {
      if (down.button !== 0) return;
      down.preventDefault();
      const right = this.options.container.getBoundingClientRect().right;
      let width = this.loadWidth();
      const move = (event: PointerEvent): void => {
        width = clampWidth(right - event.clientX);
        this.applyWidth(width);
      };
      const up = (): void => {
        activeDocument.removeEventListener('pointermove', move);
        activeDocument.removeEventListener('pointerup', up);
        this.options.app.saveLocalStorage(READER_CHAT_WIDTH_KEY, String(width));
      };
      activeDocument.addEventListener('pointermove', move);
      activeDocument.addEventListener('pointerup', up);
    });
  }

  private loadWidth(): number {
    const raw = Number(this.options.app.loadLocalStorage(READER_CHAT_WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : READER_CHAT_WIDTH.default;
  }

  private applyWidth(width: number): void {
    this.options.container.setCssProps({ '--sa-reader-chat-width': `${width}px` });
  }
}

function clampWidth(width: number): number {
  return Math.round(Math.min(READER_CHAT_WIDTH.max, Math.max(READER_CHAT_WIDTH.min, width)));
}

/** The header's "about which post" line: its title, else its first line, else the author. */
export function chatPostLabel(post: PostData): string {
  const firstLine = post.content?.text?.trim().split('\n')[0]?.trim() ?? '';
  const label = post.title?.trim() || firstLine || post.author?.name || '';
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}
