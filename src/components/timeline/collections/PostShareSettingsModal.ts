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
 *
 * NewPostShareModal is the same settings for a post with no link yet: chosen
 * locally, published only by "Create link and copy" (mobile/desktop parity).
 */

export interface PostShareSettingsOptions {
  load: () => Promise<OnlineResult<PostShareSettingsResponse>>;
  update: (patch: Partial<PostShareSettings>) => Promise<OnlineResult<PostShareSettingsResponse>>;
  copy: (url: string) => Promise<void>;
  reportFailure: (reason: OnlineFailure, action: 'load' | 'update') => void;
}

const POST_VISIBILITY_ICON: Record<PostShareVisibility, string> = { public: 'globe', unlisted: 'link' };

/** Who can see it, what viewers see first, notes and highlights — for a live share or a new one. */
export function renderPostShareSettingsFields(
  body: HTMLElement,
  settings: PostShareSettings,
  disabled: boolean,
  onChange: (patch: Partial<PostShareSettings>) => void,
): void {
  body.createDiv({ cls: 'sa-collection-section-label', text: t('col.share.visibility'), attr: { id: 'sa-post-visibility-label' } });
  const handle = renderVisibilityChoices<PostShareVisibility>(body, {
    labelledBy: 'sa-post-visibility-label',
    choices: POST_SHARE_VISIBILITIES.map((value) => ({
      value,
      label: value === 'public' ? t('col.visibility.public') : t('col.visibility.unlisted'),
      hint: value === 'public' ? t('col.visibility.publicHint') : t('col.visibility.unlistedHint'),
      icon: POST_VISIBILITY_ICON[value],
    })),
    value: settings.visibility,
    onSelect: (visibility) => onChange({ visibility }),
  });
  handle.setDisabled(disabled);

  new Setting(body)
    .setName(t('col.share.displayMode'))
    .setDesc(t('col.share.displayModeHintPost'))
    .addDropdown((dropdown) => {
      for (const mode of POST_SHARE_DISPLAY_MODES) dropdown.addOption(mode, displayModeLabel(mode));
      dropdown.setValue(settings.displayMode);
      dropdown.setDisabled(disabled);
      dropdown.onChange((value) => onChange({ displayMode: value as PostShareDisplayMode }));
    });

  new Setting(body)
    .setName(t('col.share.includeAnnotations'))
    .addToggle((toggle) => {
      toggle.setValue(settings.includeAnnotations);
      toggle.setDisabled(disabled);
      toggle.onChange((includeAnnotations) => onChange({ includeAnnotations }));
    });
}

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

    renderPostShareSettingsFields(body, state.settings, this.busy, (patch) => void this.apply(patch));

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

export interface NewPostShareOptions {
  initial: PostShareSettings;
  /** Publishes with the chosen settings and copies; null when it failed (it reports why). */
  create: (settings: PostShareSettings) => Promise<string | null>;
  /** Once, when the modal closes: the new link, or null when nothing was published. */
  onClosed?: (shareUrl: string | null) => void;
}

export class NewPostShareModal extends Modal {
  private settings: PostShareSettings;
  private busy = false;
  private shareUrl: string | null = null;

  constructor(app: App, private readonly options: NewPostShareOptions) {
    super(app);
    this.settings = { ...options.initial };
  }

  onOpen(): void {
    this.modalEl.addClass('sa-collection-share-settings');
    if (Platform.isMobile) this.modalEl.addClass('sa-collection-modal-mobile');
    this.setTitle(t('col.share.title'));
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    this.options.onClosed?.(this.shareUrl);
  }

  private render(): void {
    const body = this.contentEl;
    body.empty();
    renderPostShareSettingsFields(body, this.settings, this.busy, (patch) => {
      this.settings = { ...this.settings, ...patch };
      this.render();
    });
    new Setting(body)
      .setDesc(t('col.share.createLinkHint'))
      .addButton((button) => {
        button.setButtonText(t('col.share.createLink')).setCta().setDisabled(this.busy);
        button.onClick(() => void this.create());
      });
  }

  private async create(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      this.shareUrl = await this.options.create(this.settings);
    } finally {
      this.busy = false;
    }
    // A failure leaves the modal open to try again.
    if (this.shareUrl) this.close();
    else this.render();
  }
}
