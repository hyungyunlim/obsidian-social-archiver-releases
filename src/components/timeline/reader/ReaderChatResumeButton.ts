/**
 * The reader's way back to a chat put down on the post on screen: while that
 * post's session has turns or an answer on its way, one tap reopens the dock.
 * A spinning icon stands in while the answer is coming.
 */
import { setIcon } from 'obsidian';
import type { PostChatSession } from '../../../services/byok/PostChatSession';
import { t } from '../../../i18n';

export class ReaderChatResumeButton {
  readonly el: HTMLButtonElement;
  private readonly iconEl: HTMLElement;
  private session: PostChatSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private busy: boolean | null = null;

  constructor(container: HTMLElement, onOpen: () => void) {
    this.el = container.createEl('button', {
      cls: 'sa-reader-chat-resume is-hidden',
      attr: { type: 'button', 'aria-label': t('byok.chat.title') },
    });
    this.iconEl = this.el.createSpan({ cls: 'sa-reader-chat-resume-icon' });
    this.el.createSpan({ text: t('byok.chat.resume') });
    this.el.addEventListener('click', (event) => {
      event.stopPropagation();
      onOpen();
    });
  }

  /** Follows `session`; null hides the button (no chat on this post, or the dock is open). */
  show(session: PostChatSession | null): void {
    if (session !== this.session) {
      this.unsubscribe?.();
      this.session = session;
      this.unsubscribe = session ? session.subscribe(() => this.update()) : null;
    }
    this.update();
  }

  destroy(): void {
    this.show(null);
    this.el.remove();
  }

  private update(): void {
    const session = this.session;
    const busy = Boolean(session?.pending);
    this.el.toggleClass('is-hidden', !session || (session.messages.length === 0 && !busy));
    if (busy === this.busy) return;
    this.busy = busy;
    this.el.toggleClass('is-busy', busy);
    this.el.setAttribute('aria-busy', String(busy));
    this.iconEl.empty();
    setIcon(this.iconEl, busy ? 'loader-2' : 'message-circle');
  }
}
