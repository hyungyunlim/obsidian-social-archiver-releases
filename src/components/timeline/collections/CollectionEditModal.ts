import { App, Modal, Platform } from 'obsidian';
import { t } from '../../../i18n';
import { COLLECTION_LIMITS, type LocalCollection } from '../../../types/collections';

/**
 * Create / edit a collection: name (1–60) and an optional description (≤500).
 * The caller validates against the store and answers with an error key to
 * show inline, so a taken name never closes the modal.
 */

export type CollectionEditError = 'invalid-name' | 'name-taken' | 'invalid-description' | 'limit' | 'signed-out' | null;

export interface CollectionEditOptions {
  /** Undefined = create. */
  collection?: LocalCollection;
  submit: (values: { name: string; description: string | null }) => CollectionEditError;
  /** Shown in edit mode when the user may delete (owner). */
  onDelete?: () => void;
}

const ERROR_TEXT: Record<Exclude<CollectionEditError, null>, () => string> = {
  'invalid-name': () => t('col.edit.nameInvalid'),
  'name-taken': () => t('col.edit.nameTaken'),
  'invalid-description': () => t('col.edit.descriptionInvalid'),
  limit: () => t('col.limitReached'),
  'signed-out': () => t('col.signedOut'),
};

export class CollectionEditModal extends Modal {
  constructor(app: App, private readonly options: CollectionEditOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    const editing = Boolean(this.options.collection);
    modalEl.addClass('sa-collection-edit');
    if (Platform.isMobile) modalEl.addClass('sa-collection-modal-mobile');
    this.setTitle(editing ? t('col.edit.editTitle') : t('col.edit.createTitle'));

    const form = contentEl.createEl('form', { cls: 'sa-collection-form' });

    const nameLabel = form.createEl('label', { cls: 'sa-collection-field' });
    nameLabel.createSpan({ cls: 'sa-collection-field-label', text: t('col.edit.name') });
    const nameInput = nameLabel.createEl('input', {
      type: 'text',
      placeholder: t('col.edit.namePlaceholder'),
      value: this.options.collection?.name ?? '',
    });
    nameInput.maxLength = COLLECTION_LIMITS.nameMaxLength;
    nameInput.required = true;

    const descriptionLabel = form.createEl('label', { cls: 'sa-collection-field' });
    descriptionLabel.createSpan({ cls: 'sa-collection-field-label', text: t('col.edit.description') });
    const descriptionInput = descriptionLabel.createEl('textarea', {
      placeholder: t('col.edit.descriptionPlaceholder'),
    });
    descriptionInput.value = this.options.collection?.description ?? '';
    descriptionInput.maxLength = COLLECTION_LIMITS.descriptionMaxLength;
    descriptionInput.rows = 3;

    const errorEl = form.createDiv({ cls: 'sa-collection-form-error', attr: { role: 'alert' } });
    errorEl.hide();

    const footer = form.createDiv({ cls: 'sa-collection-modal-footer' });
    if (editing && this.options.onDelete) {
      const deleteButton = footer.createEl('button', { type: 'button', text: t('col.delete'), cls: 'mod-warning' });
      deleteButton.addEventListener('click', () => {
        this.close();
        this.options.onDelete?.();
      });
    }
    footer.createDiv({ cls: 'sa-collection-footer-spacer' });
    const cancel = footer.createEl('button', { type: 'button', text: t('col.edit.cancel') });
    cancel.addEventListener('click', () => this.close());
    footer.createEl('button', { type: 'submit', text: editing ? t('col.edit.save') : t('col.edit.create'), cls: 'mod-cta' });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const description = descriptionInput.value.trim();
      const error = this.options.submit({ name: nameInput.value, description: description ? description : null });
      if (!error) {
        this.close();
        return;
      }
      errorEl.setText(ERROR_TEXT[error]());
      errorEl.show();
      nameInput.focus();
    });

    window.setTimeout(() => nameInput.focus(), 10);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
