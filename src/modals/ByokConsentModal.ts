/**
 * The one-time consent sheet before content goes to a provider with the
 * user's own key (App Store 5.1.2(i), Play User Data): what is sent, to whom,
 * who pays, and that the key never reaches Social Archiver. ByokService
 * records the answer per provider on this device.
 */
import { Modal, Platform, type App } from 'obsidian';
import { BYOK_PROVIDERS, type ByokProviderId } from '../vendor/byok-ai-core';
import { t } from '../i18n';

/** Resolves true when the user allows the provider (never with the modal itself). */
export function openByokConsentModal(app: App, provider: ByokProviderId): Promise<boolean> {
  return new Promise((resolve) => {
    new ByokConsentModal(app, provider, resolve).open();
  });
}

export class ByokConsentModal extends Modal {
  private decided = false;

  constructor(
    app: App,
    private readonly provider: ByokProviderId,
    private readonly onDecide: (accepted: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    const spec = BYOK_PROVIDERS[this.provider];
    const vars = { provider: spec.label };
    contentEl.empty();
    modalEl.addClass('social-archiver-modal', Platform.isMobile ? 'cm-mobile' : 'cm-desktop');
    this.setTitle(t('byok.consent.title', vars));

    contentEl.createEl('p', { text: t('byok.consent.intro', vars) });
    const list = contentEl.createEl('ul');
    list.createEl('li', { text: t('byok.consent.itemContent') });
    list.createEl('li', { text: t('byok.consent.itemQuestion') });
    contentEl.createEl('p', { text: t('byok.consent.billing', vars) });
    contentEl.createEl('p', { text: t('byok.consent.key') });
    contentEl.createEl('p').createEl('a', { text: t('byok.consent.privacy', vars), href: spec.privacyUrl });

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { text: t('byok.consent.cancel') }).addEventListener('click', () => this.decide(false));
    buttons
      .createEl('button', { text: t('byok.consent.accept'), cls: 'mod-cta' })
      .addEventListener('click', () => this.decide(true));
  }

  onClose(): void {
    this.contentEl.empty();
    // Closed any other way (Esc, tap outside) = not allowed.
    this.decide(false);
  }

  private decide(accepted: boolean): void {
    if (this.decided) return;
    this.decided = true;
    this.onDecide(accepted);
    this.close();
  }
}
