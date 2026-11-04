/**
 * "Chat about this post" in a modal: the fallback where reader mode cannot
 * dock the chat beside the article. The conversation is an AIChatPanel over
 * the post's session; closing puts the chat down without asking, and opening
 * chat on the post again picks it up.
 */
import { Modal, type App } from 'obsidian';
import { AIChatPanel, type AIChatPanelOptions } from '../components/ai-chat/AIChatPanel';
import { t } from '../i18n';

export { chatEngineOptions, type ChatEngineOption } from '../components/ai-chat/AIChatPanel';

export type AIChatModalOptions = Omit<AIChatPanelOptions, 'onDone' | 'onDialog'> & {
  /** After the modal is gone (reader mode gives its keys back). */
  onClosed?: () => void;
};

export class AIChatModal extends Modal {
  private panel: AIChatPanel | null = null;

  constructor(app: App, private readonly options: AIChatModalOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('sa-ai-chat-modal');
    this.setTitle(t('byok.chat.title'));
    const { onClosed: _onClosed, ...panelOptions } = this.options;
    this.panel = new AIChatPanel(this.app, this.contentEl, {
      ...panelOptions,
      onDone: (): void => this.close(),
    });
    this.panel.focus();
  }

  onClose(): void {
    this.panel?.destroy();
    this.panel = null;
    this.options.onClosed?.();
  }
}
