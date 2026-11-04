/**
 * "Use a key already saved in Obsidian": pick one of the secrets in
 * Obsidian's secret storage (for example one another plugin uses) instead of
 * pasting the key again. Resolves with the secret id, or null when closed.
 */
import { SuggestModal, type App } from 'obsidian';
import { t } from '../i18n';

export function pickSavedSecret(app: App, names: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    new ByokSecretPickerModal(app, names, resolve).open();
  });
}

export class ByokSecretPickerModal extends SuggestModal<string> {
  private settled = false;

  constructor(
    app: App,
    private readonly names: readonly string[],
    private readonly onResult: (name: string | null) => void,
  ) {
    super(app);
    this.setPlaceholder(t('byok.secretPicker.placeholder'));
    this.emptyStateText = t('byok.secretPicker.empty');
  }

  getSuggestions(query: string): string[] {
    const needle = query.trim().toLowerCase();
    return this.names.filter((name) => name.toLowerCase().includes(needle));
  }

  renderSuggestion(name: string, el: HTMLElement): void {
    el.setText(name);
  }

  onChooseSuggestion(name: string): void {
    this.settle(name);
  }

  onClose(): void {
    // Obsidian closes the modal before it calls onChooseSuggestion: wait a
    // tick so a choice is not reported as a cancel.
    window.setTimeout(() => this.settle(null), 0);
  }

  private settle(name: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.onResult(name);
  }
}
