/**
 * Paste one provider's API key. The key is saved under our own secret id
 * (social-archiver-<provider>), so the user never meets Obsidian's secret
 * "ID" field, which reads like an id the provider issues.
 *
 * Resolves with the trimmed key, or null when cancelled — never with the
 * modal: Obsidian components are thenables.
 */
import { Modal, type App } from 'obsidian';
import { t } from '../i18n';
import { BYOK_PROVIDERS, type ByokProviderId } from '../vendor/byok-ai-core';

export function openByokKeyModal(app: App, provider: ByokProviderId): Promise<string | null> {
  return new Promise((resolve) => {
    new ByokKeyModal(app, provider, resolve).open();
  });
}

export class ByokKeyModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly provider: ByokProviderId,
    private readonly onResult: (key: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { label, keyPrefixHint } = BYOK_PROVIDERS[this.provider];
    this.modalEl.addClass('sa-byok-key-modal');
    this.setTitle(t('byok.keyModal.title', { provider: label }));
    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: t('byok.keyModal.desc', { provider: label }),
    });
    const input = this.contentEl.createEl('input', {
      type: 'password',
      attr: {
        placeholder: `${keyPrefixHint}…`,
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': t('byok.keyModal.title', { provider: label }),
      },
    });
    const error = this.contentEl.createDiv({ cls: ['setting-item-description', 'mod-warning'] });

    const submit = (): void => {
      const key = input.value.trim();
      if (!key) {
        error.setText(t('byok.keyModal.empty'));
        input.focus();
        return;
      }
      this.finish(key);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    });

    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { text: t('byok.keyModal.cancel') }).addEventListener('click', () => this.finish(null));
    buttons.createEl('button', { cls: 'mod-cta', text: t('byok.keyModal.save') }).addEventListener('click', submit);
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle(null);
  }

  private finish(key: string | null): void {
    this.settle(key);
    this.close();
  }

  private settle(key: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.onResult(key);
  }
}
