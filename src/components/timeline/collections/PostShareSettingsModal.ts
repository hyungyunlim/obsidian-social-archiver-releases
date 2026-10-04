import { App, Modal, Platform, Setting } from 'obsidian';
import { t } from '../../../i18n';
import {
  POST_SHARE_DISPLAY_MODES,
  POST_SHARE_VISIBILITIES,
  type PostShareDisplayMode,
  type PostShareSettings,
  type PostShareSettingsResponse,
  type PostShareVisibility,
} from '../../../types/collections';
import type { OnlineFailure, OnlineResult } from '../../../services/collections/CollectionService';
import { displayModeLabel } from './collectionVisuals';
import { renderVisibilityChoices } from './visibilityChoices';

/**
 * Share settings for one shared post (prd-collections-obsidian-plugin O9),
 * through GET/PATCH /api/share/:shareId/settings. Stopping the share stays
 * in the card's share menu, which also clears the note's share fields.
 */

export interface PostShareSettingsOptions {
  load: () => Promise<OnlineResult<PostShareSettingsResponse>>;
  update: (patch: Partial<PostShareSettings>) => Promise<OnlineResult<PostShareSettingsResponse>>;
  copy: (url: string) => Promise<void>;
  reportFailure: (reason: OnlineFailure, action: 'load' | 'update') => void;
}

const POST_VISIBILITY_ICON: Record<PostShareVisibility, string> = { public: 'globe', unlisted: 'link' };

export class PostShareSettingsModal extends Modal {
  private state: PostShareSettingsResponse | null = null;
  private busy = false;

  constructor(app: App, private readonly options: PostShareSettingsOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('sa-collection-share-settings');
    if (Platform.isMobile) this.modalEl.addClass('sa-collection-modal-mobile');
    this.setTitle(t('col.share.title'));
    this.contentEl.createDiv({ cls: 'sa-collection-loading', text: '…' });
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
    const state = this.state;
    if (!state) return;
    const body = this.contentEl;
    body.empty();

    body.createDiv({ cls: 'sa-collection-section-label', text: t('col.share.visibility'), attr: { id: 'sa-post-visibility-label' } });
    const handle = renderVisibilityChoices<PostShareVisibility>(body, {
      labelledBy: 'sa-post-visibility-label',
      choices: POST_SHARE_VISIBILITIES.map((value) => ({
        value,
        label: value === 'public' ? t('col.visibility.public') : t('col.visibility.unlisted'),
        hint: value === 'public' ? t('col.visibility.publicHint') : t('col.visibility.unlistedHint'),
        icon: POST_VISIBILITY_ICON[value],
      })),
      value: state.settings.visibility,
      onSelect: (visibility) => void this.apply({ visibility }),
    });
    handle.setDisabled(this.busy);

    new Setting(body)
      .setName(t('col.share.displayMode'))
      .setDesc(t('col.share.displayModeHintPost'))
      .addDropdown((dropdown) => {
        for (const mode of POST_SHARE_DISPLAY_MODES) dropdown.addOption(mode, displayModeLabel(mode));
        dropdown.setValue(state.settings.displayMode);
        dropdown.setDisabled(this.busy);
        dropdown.onChange((value) => void this.apply({ displayMode: value as PostShareDisplayMode }));
      });

    new Setting(body)
      .setName(t('col.share.includeAnnotations'))
      .addToggle((toggle) => {
        toggle.setValue(state.settings.includeAnnotations);
        toggle.setDisabled(this.busy);
        toggle.onChange((includeAnnotations) => void this.apply({ includeAnnotations }));
      });

    const linkRow = body.createDiv({ cls: 'sa-collection-link-row' });
    const input = linkRow.createEl('input', { type: 'text', value: state.shareUrl, cls: 'sa-collection-link-input', attr: { readonly: 'true', 'aria-label': t('col.share.copyLink') } });
    input.addEventListener('focus', () => input.select());
    const copy = linkRow.createEl('button', { text: t('col.share.copyLink'), cls: 'mod-cta' });
    copy.addEventListener('click', () => void this.options.copy(state.shareUrl));
  }

  private async apply(patch: Partial<PostShareSettings>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const result = await this.options.update(patch);
    this.busy = false;
    if (result.ok) this.state = result.value;
    else this.options.reportFailure(result.reason, 'update');
    this.render();
  }
}
