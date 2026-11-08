/**
 * Composed posts the one-time migration could not decide: the note and the
 * server both changed before two-way sync (prd-plugin-my-posts-two-way-sync
 * §5.6). Per post: use the server version (the vault text is kept as a
 * conflict copy first), send the vault version, or open the note.
 */

import { Modal, Notice, Setting, type App, type TFile } from 'obsidian';
import { t } from '../i18n';
import type { ComposedPostMigrationService } from '../plugin/sync/composed/ComposedPostMigrationService';

export class DivergedPostsModal extends Modal {
  constructor(
    app: App,
    private readonly migration: ComposedPostMigrationService,
    private readonly onClosed: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t('composed.diverged.modal.title'));
    this.contentEl.createEl('p', { text: t('composed.diverged.modal.desc'), cls: 'setting-item-description' });
    const list = this.contentEl.createDiv();
    const files = this.migration.listDivergedNotes();
    if (files.length === 0) this.showEmpty(list);
    for (const file of files) this.renderRow(list, file);
  }

  onClose(): void {
    this.contentEl.empty();
    this.onClosed();
  }

  private renderRow(list: HTMLElement, file: TFile): void {
    const row = new Setting(list).setName(file.basename).setDesc(file.parent?.path ?? '');
    const run = (action: (target: TFile) => Promise<void>) => async (): Promise<void> => {
      row.setDisabled(true);
      try {
        await action(file);
        new Notice(t('composed.diverged.done'));
        row.settingEl.remove();
        if (list.childElementCount === 0) this.showEmpty(list);
      } catch (error) {
        new Notice(t('composed.diverged.failed', { message: error instanceof Error ? error.message : String(error) }));
        row.setDisabled(false);
      }
    };
    row
      .addButton((button) => button
        .setButtonText(t('composed.diverged.useServer'))
        .onClick(run((target) => this.migration.useServerVersion(target))))
      .addButton((button) => button
        .setButtonText(t('composed.diverged.sendVault'))
        .onClick(run((target) => this.migration.sendVaultVersion(target))))
      .addButton((button) => button
        .setButtonText(t('composed.diverged.open'))
        .onClick(() => {
          void this.app.workspace.getLeaf('tab').openFile(file);
          this.close();
        }));
  }

  private showEmpty(list: HTMLElement): void {
    list.createEl('p', { text: t('composed.diverged.empty'), cls: 'setting-item-description' });
  }
}
