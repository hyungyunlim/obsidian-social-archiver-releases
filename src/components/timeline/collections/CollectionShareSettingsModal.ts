import { App, Modal, Platform, Setting } from 'obsidian';
import { t } from '../../../i18n';
import {
  COLLECTION_DISPLAY_MODES,
  COLLECTION_VISIBILITIES,
  type CollectionDisplayMode,
  type CollectionShareState,
  type CollectionShareUpdate,
  type CollectionVisibility,
  type LocalCollection,
} from '../../../types/collections';
import type { OnlineFailure, OnlineResult } from '../../../services/collections/CollectionService';
import { VISIBILITY_ICON, displayModeLabel, visibilityHint, visibilityLabel } from './collectionVisuals';
import { renderVisibilityChoices, type VisibilityChoicesHandle } from './visibilityChoices';

/**
 * Collection share settings (prd-collections-obsidian-plugin §4.2, O8):
 * who can see it, what viewers see, my notes, the link. Changes apply at
 * once and roll back on failure. Leaving Private asks first, because a
 * shared collection shows posts in full — unlike the plugin's Preview mode.
 */

export interface CollectionShareSettingsOptions {
  collection: LocalCollection;
  load: () => Promise<OnlineResult<CollectionShareState>>;
  update: (update: CollectionShareUpdate) => Promise<OnlineResult<CollectionShareState>>;
  rotate: () => Promise<OnlineResult<CollectionShareState>>;
  confirmLeavingPrivate: () => Promise<boolean>;
  confirm: (options: { title: string; message: string; confirmText: string }) => Promise<boolean>;
  copy: (url: string) => Promise<void>;
  reportFailure: (reason: OnlineFailure, action: 'load' | 'update') => void;
}

export class CollectionShareSettingsModal extends Modal {
  private state: CollectionShareState | null = null;
  private busy = false;
  private visibilityHandle: VisibilityChoicesHandle<CollectionVisibility> | null = null;
  private bodyEl: HTMLElement | null = null;
  /** The visibility before the latest change, for the search-engine note. */
  private lastVisibility: CollectionVisibility | null = null;

  constructor(app: App, private readonly options: CollectionShareSettingsOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('sa-collection-share-settings');
    if (Platform.isMobile) this.modalEl.addClass('sa-collection-modal-mobile');
    this.setTitle(`${t('col.share.title')} · ${this.options.collection.name}`);
    this.bodyEl = this.contentEl.createDiv({ cls: 'sa-collection-share-body' });
    this.bodyEl.createDiv({ cls: 'sa-collection-loading', text: '…' });
    void this.load();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    const result = await this.options.load();
    if (!result.ok) {
      this.options.reportFailure(result.reason, 'load');
      this.close();
      return;
    }
    this.state = result.value;
    this.render();
  }

  private render(): void {
    const body = this.bodyEl;
    const state = this.state;
    if (!body || !state) return;
    body.empty();

    body.createDiv({ cls: 'sa-collection-section-label', text: t('col.share.visibility'), attr: { id: 'sa-collection-visibility-label' } });
    this.visibilityHandle = renderVisibilityChoices<CollectionVisibility>(body, {
      labelledBy: 'sa-collection-visibility-label',
      choices: COLLECTION_VISIBILITIES.map((value) => ({
        value,
        label: visibilityLabel(value),
        hint: visibilityHint(value),
        icon: VISIBILITY_ICON[value],
      })),
      value: state.visibility,
      onSelect: (value) => void this.changeVisibility(value),
    });

    if (state.visibility === 'unlisted' && this.lastVisibility === 'public') {
      body.createDiv({ cls: 'sa-collection-hint', text: t('col.share.searchEngineDelay') });
    }

    new Setting(body)
      .setName(t('col.share.displayMode'))
      .setDesc(t('col.share.displayModeHintCollection'))
      .addDropdown((dropdown) => {
        for (const mode of COLLECTION_DISPLAY_MODES) dropdown.addOption(mode, displayModeLabel(mode));
        dropdown.setValue(state.displayMode);
        dropdown.setDisabled(this.busy);
        dropdown.onChange((value) => void this.apply({ visibility: state.visibility, displayMode: value as CollectionDisplayMode }));
      });

    new Setting(body)
      .setName(t('col.share.includeAnnotations'))
      .addToggle((toggle) => {
        toggle.setValue(state.includeAnnotations);
        toggle.setDisabled(this.busy);
        toggle.onChange((value) => void this.apply({ visibility: state.visibility, includeAnnotations: value }));
      });

    if (state.hiddenItemCount > 0) {
      const hidden = body.createDiv({ cls: 'sa-collection-hidden-items' });
      hidden.createDiv({ text: t('col.share.hiddenItems', { count: state.hiddenItemCount }) });
      hidden.createDiv({ cls: 'sa-collection-hint', text: t('col.share.hiddenItemsHint') });
    }

    if (state.visibility !== 'private' && state.shareUrl) this.renderLink(body, state.shareUrl);
  }

  private renderLink(body: HTMLElement, url: string): void {
    const linkRow = body.createDiv({ cls: 'sa-collection-link-row' });
    const input = linkRow.createEl('input', { type: 'text', value: url, cls: 'sa-collection-link-input', attr: { readonly: 'true', 'aria-label': t('col.share.copyLink') } });
    input.addEventListener('focus', () => input.select());
    const copy = linkRow.createEl('button', { text: t('col.share.copyLink'), cls: 'mod-cta' });
    copy.addEventListener('click', () => void this.options.copy(url));

    const actions = body.createDiv({ cls: 'sa-collection-link-actions' });
    const rotate = actions.createEl('button', { text: t('col.share.rotateLink') });
    rotate.disabled = this.busy;
    rotate.addEventListener('click', () => void this.rotate());
    const stop = actions.createEl('button', { text: t('col.share.stopSharing'), cls: 'mod-warning' });
    stop.disabled = this.busy;
    stop.addEventListener('click', () => void this.stop());
  }

  private async changeVisibility(next: CollectionVisibility): Promise<void> {
    const current = this.state;
    if (!current || this.busy) return;
    if (current.visibility === 'private' && next !== 'private' && !(await this.options.confirmLeavingPrivate())) {
      this.visibilityHandle?.setValue(current.visibility);
      return;
    }
    await this.apply({ visibility: next });
  }

  private async rotate(): Promise<void> {
    const confirmed = await this.options.confirm({
      title: t('col.share.rotateConfirmTitle'),
      message: t('col.share.rotateConfirmBody'),
      confirmText: t('col.share.rotateLink'),
    });
    if (!confirmed) return;
    await this.run(() => this.options.rotate());
  }

  private async stop(): Promise<void> {
    const confirmed = await this.options.confirm({
      title: t('col.share.stopSharing'),
      message: t('col.share.stopConfirmBody'),
      confirmText: t('col.share.stopSharing'),
    });
    if (!confirmed) return;
    await this.apply({ visibility: 'private' });
  }

  private apply(update: CollectionShareUpdate): Promise<void> {
    return this.run(() => this.options.update(update));
  }

  private async run(call: () => Promise<OnlineResult<CollectionShareState>>): Promise<void> {
    if (this.busy) return;
    const before = this.state;
    this.busy = true;
    this.visibilityHandle?.setDisabled(true);
    const result = await call();
    this.busy = false;
    if (result.ok) {
      this.lastVisibility = before?.visibility ?? null;
      this.state = result.value;
    } else {
      this.options.reportFailure(result.reason, 'update');
    }
    this.render();
  }
}
