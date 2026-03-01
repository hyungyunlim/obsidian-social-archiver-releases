import { Modal, Notice, Platform, setIcon, type App } from 'obsidian';
import type { TagStore } from '@/services/TagStore';
import type { TagDefinition } from '@/types/tag';
import { TAG_COLORS, TAG_NAME_MAX_LENGTH } from '@/types/tag';

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function toColorPickerHex(value: string | null): string {
  const normalized = value ? normalizeHexColor(value) : null;
  if (!normalized) return TAG_COLORS[0] as string;
  if (normalized.length === 4) {
    const [r, g, b] = [normalized[1], normalized[2], normalized[3]];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return normalized;
}

class TagEditModal extends Modal {
  private tagStore: TagStore;
  private tag: TagDefinition;
  private onSaved: (updatedTag: TagDefinition, previousName: string) => void;
  private nameInput: HTMLInputElement | null = null;
  private colorInput: HTMLInputElement | null = null;
  private nativeColorInput: HTMLInputElement | null = null;
  private previewDot: HTMLElement | null = null;
  private previewText: HTMLElement | null = null;
  private paletteButtons: Map<string, HTMLButtonElement> = new Map();
  private currentColor: string | null;
  private pickerColor: string;

  constructor(
    app: App,
    tagStore: TagStore,
    tag: TagDefinition,
    onSaved: (updatedTag: TagDefinition, previousName: string) => void
  ) {
    super(app);
    this.tagStore = tagStore;
    this.tag = tag;
    this.onSaved = onSaved;
    this.currentColor = typeof tag.color === 'string' ? normalizeHexColor(tag.color) : null;
    this.pickerColor = toColorPickerHex(this.currentColor);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('social-archiver-tag-modal', 'tm-edit-modal');

    if (Platform.isMobile) {
      this.modalEl.addClass('tm-mobile');
      contentEl.addClass('tm-mobile-content');
    }

    const titleEl = contentEl.createEl('h3', { text: 'Edit tag' });
    titleEl.addClass('tm-edit-title');
    const desc = contentEl.createEl('p', {
      text: 'Rename the tag or change its color. Renaming updates all archived posts that use this tag.',
    });
    desc.addClass('tm-edit-desc');

    const nameLabel = contentEl.createEl('label', { text: 'Tag name' });
    nameLabel.addClass('tm-edit-label');

    this.nameInput = contentEl.createEl('input', {
      type: 'text',
      value: this.tag.name,
      placeholder: 'Tag name',
    });
    this.nameInput.maxLength = TAG_NAME_MAX_LENGTH;
    this.nameInput.addClass('sa-w-full', 'sa-p-8', 'sa-border', 'sa-rounded-8', 'sa-bg-primary', 'sa-text-normal', 'sa-text-md', 'sa-box-border', 'tm-edit-input');
    this.nameInput.addEventListener('input', () => this.refreshPreviewTagName());

    const colorHeader = contentEl.createDiv();
    colorHeader.addClass('tm-edit-color-header');

    const colorLabel = colorHeader.createEl('label', { text: 'Color' });
    colorLabel.addClass('tm-edit-label');

    const colorRow = contentEl.createDiv();
    colorRow.addClass('tm-edit-color-row');

    this.nativeColorInput = colorRow.createEl('input', {
      type: 'color',
      value: this.pickerColor,
    });
    this.nativeColorInput.addClass('tm-edit-color-picker');
    this.nativeColorInput.setAttribute('aria-label', 'Color picker');
    this.nativeColorInput.addEventListener('input', () => {
      const pickedColor = this.nativeColorInput?.value || this.pickerColor;
      this.setColor(pickedColor);
      this.colorInput?.focus();
      this.colorInput?.select();
    });

    const colorInputWrap = colorRow.createDiv();
    colorInputWrap.addClass('tm-edit-color-input-wrap', 'sa-flex-1');

    this.colorInput = colorInputWrap.createEl('input', {
      type: 'text',
      placeholder: '#3b82f6',
      value: this.currentColor ?? '',
    });
    this.colorInput.addClass('sa-w-full', 'sa-p-8', 'sa-border', 'sa-rounded-8', 'sa-bg-primary', 'sa-text-normal', 'sa-text-md', 'sa-box-border', 'tm-edit-input', 'tm-edit-color-input');
    this.colorInput.maxLength = 7;
    this.colorInput.addEventListener('input', () => {
      const normalized = normalizeHexColor(this.colorInput?.value || '');
      this.currentColor = normalized;
      if (normalized) {
        this.pickerColor = toColorPickerHex(normalized);
      }
      this.refreshColorPreview();
    });

    const clearBtn = colorInputWrap.createEl('button');
    clearBtn.type = 'button';
    clearBtn.addClass('tm-edit-color-clear');
    clearBtn.setAttribute('aria-label', 'Clear color');
    clearBtn.setAttribute('title', 'Clear color');
    setIcon(clearBtn, 'rotate-ccw');
    clearBtn.querySelector('svg')?.setAttribute('width', '14');
    clearBtn.querySelector('svg')?.setAttribute('height', '14');
    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.setColor(null);
      this.colorInput?.focus();
    });

    const previewRow = contentEl.createDiv();
    previewRow.addClass('tm-edit-preview-row');
    const previewLabel = previewRow.createSpan({ text: 'Preview' });
    previewLabel.addClass('tm-edit-preview-label');

    const previewChip = previewRow.createDiv();
    previewChip.addClass('tm-edit-preview-chip');

    this.previewDot = previewChip.createDiv();
    this.previewDot.addClass('tm-edit-preview-dot');

    this.previewText = previewChip.createSpan();
    this.previewText.addClass('tm-edit-preview-text');

    const colorHint = contentEl.createEl('p', {
      text: 'Use the picker, palette, or type #RGB / #RRGGBB.',
    });
    colorHint.addClass('tm-edit-hint');

    const paletteWrap = contentEl.createDiv();
    paletteWrap.addClass('tm-edit-palette');

    for (const paletteColor of TAG_COLORS) {
      const btn = paletteWrap.createEl('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', `Select color ${paletteColor}`);
      btn.addClass('tm-edit-swatch');
      btn.style.background = paletteColor;
      btn.addEventListener('click', () => {
        this.setColor(paletteColor);
      });
      this.paletteButtons.set(paletteColor.toLowerCase(), btn);
    }

    const footer = contentEl.createDiv();
    footer.addClass('tm-edit-footer');

    const cancelButton = footer.createEl('button', { text: 'Cancel' });
    cancelButton.addClass('tm-edit-btn', 'tm-edit-btn-secondary');
    cancelButton.addEventListener('click', () => this.close());

    const saveButton = footer.createEl('button', { text: 'Save changes' });
    saveButton.addClass('tm-edit-btn', 'tm-edit-btn-primary');
    saveButton.addEventListener('click', () => {
      void this.save();
    });

    const submitOnEnter = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.save();
      }
    };
    this.nameInput.addEventListener('keydown', submitOnEnter);
    this.colorInput.addEventListener('keydown', submitOnEnter);

    this.refreshColorPreview();
    this.refreshPreviewTagName();
    this.nameInput.focus();
    this.nameInput.select();
  }

  private setColor(color: string | null): void {
    const normalized = color ? normalizeHexColor(color) : null;
    this.currentColor = normalized;
    if (normalized) {
      this.pickerColor = toColorPickerHex(normalized);
    }
    if (this.colorInput) {
      this.colorInput.value = this.currentColor ?? '';
    }
    this.refreshColorPreview();
  }

  private refreshColorPreview(): void {
    if (this.previewDot) {
      this.previewDot.style.background = this.currentColor || 'var(--background-modifier-border)';
    }
    if (this.nativeColorInput && this.nativeColorInput.value !== this.pickerColor) {
      this.nativeColorInput.value = this.pickerColor;
    }

    const selected = this.currentColor?.toLowerCase() || '';
    for (const [paletteColor, button] of this.paletteButtons) {
      const isSelected = paletteColor === selected;
      button.style.boxShadow = isSelected ? '0 0 0 2px var(--interactive-accent)' : 'none';
      button.style.borderColor = isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
    }
  }

  private refreshPreviewTagName(): void {
    if (!this.previewText) return;
    const nextName = this.nameInput?.value.trim() || this.tag.name;
    this.previewText.textContent = nextName;
  }

  private async save(): Promise<void> {
    const rawName = this.nameInput?.value ?? '';
    const trimmedName = rawName.trim();

    if (!trimmedName || trimmedName.length > TAG_NAME_MAX_LENGTH) {
      new Notice(`Tag name must be 1-${TAG_NAME_MAX_LENGTH} characters`);
      this.nameInput?.focus();
      return;
    }

    const rawHex = this.colorInput?.value ?? '';
    const normalizedColor = rawHex.trim() ? normalizeHexColor(rawHex) : null;
    if (rawHex.trim() && !normalizedColor) {
      new Notice('Invalid HEX color. Use #RGB or #RRGGBB (example: #3b82f6)');
      this.colorInput?.focus();
      return;
    }

    try {
      const updated = await this.tagStore.updateTag(this.tag.id, {
        name: trimmedName,
        color: normalizedColor,
      });
      if (!updated) {
        new Notice('Tag not found');
        return;
      }
      this.onSaved(updated, this.tag.name);
      this.close();
      new Notice(`Updated tag "${updated.name}"`);
    } catch (err) {
      new Notice(`Failed to update tag: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
}

/**
 * TagModal - Modal for managing tags
 *
 * Two modes:
 * - Post mode (filePath provided): assign/remove tags on a specific post
 * - Global mode (filePath null): manage tag definitions (create/delete)
 *
 * Defers timeline re-render to onClose to avoid per-action re-renders
 * (especially important for bulk delete which touches many files).
 */
export class TagModal extends Modal {
  private tagStore: TagStore;
  private filePath: string | null;
  private onTagsChanged: () => void;
  private onUIModify?: (filePath: string) => void;
  private searchInput: HTMLInputElement | null = null;
  private listContainer: HTMLElement | null = null;
  private dirty: boolean = false; // Track if any changes were made
  /** Tags deleted this session — filters stale metadataCache results */
  private deletedTagNames: Set<string> = new Set();
  /** Tags toggled off/on this session — optimistic UI before cache updates */
  private toggledOffTags: Set<string> = new Set();
  private toggledOnTags: Set<string> = new Set();
  /** Keyboard navigation: index of highlighted row (-1 = none) */
  private highlightedIndex: number = -1;
  /** Total number of selectable rows in current render (tags + create row) */
  private totalRowCount: number = 0;
  /** Whether the "Create" row is currently visible */
  private hasCreateRow: boolean = false;

  constructor(
    app: App,
    tagStore: TagStore,
    filePath: string | null,
    onTagsChanged: () => void,
    onUIModify?: (filePath: string) => void
  ) {
    super(app);
    this.tagStore = tagStore;
    this.filePath = filePath;
    this.onTagsChanged = onTagsChanged;
    this.onUIModify = onUIModify;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('social-archiver-tag-modal');

    // Mobile: standard form modal pattern (consistent with ArchiveModal, Subscribe modals)
    if (Platform.isMobile) {
      const { modalEl } = this;
      modalEl.addClass('tm-mobile');
      contentEl.addClass('tm-mobile-content');

      // Shrink the built-in close button on mobile
      const closeBtn = modalEl.querySelector('.modal-close-button') as HTMLElement;
      if (closeBtn) {
        closeBtn.addClass('tm-mobile-close');
      }
    }

    // Title row: "Manage Tags (count)" + "Delete All" button
    const titleRow = contentEl.createDiv();
    titleRow.addClass('sa-flex-between', 'sa-mb-12');

    const titleEl = titleRow.createDiv();
    titleEl.addClass('sa-flex-row', 'sa-gap-8', 'sa-text-lg', 'sa-font-semibold');
    titleEl.createSpan({ text: 'Manage Tags' });

    const allTags = this.getFilteredTags();
    if (allTags.length > 0) {
      const countBadge = titleEl.createSpan({ text: String(allTags.length) });
      countBadge.addClass('sa-text-sm', 'sa-font-medium', 'sa-text-muted', 'sa-bg-secondary', 'tm-count-badge');

      // Delete All button
      const deleteAllBtn = titleRow.createDiv();
      deleteAllBtn.addClass('sa-flex-row', 'sa-gap-4', 'sa-px-10', 'sa-py-4', 'sa-rounded-6', 'sa-text-sm', 'sa-font-medium', 'sa-text-muted', 'sa-clickable', 'sa-transition');
      deleteAllBtn.createSpan({ text: 'Delete All' });

      deleteAllBtn.addEventListener('mouseenter', () => {
        deleteAllBtn.removeClass('sa-text-muted');
        deleteAllBtn.addClass('sa-text-error', 'sa-bg-hover');
      });
      deleteAllBtn.addEventListener('mouseleave', () => {
        deleteAllBtn.removeClass('sa-text-error', 'sa-bg-hover');
        deleteAllBtn.addClass('sa-text-muted');
      });

      deleteAllBtn.addEventListener('click', () => {
        this.showDeleteAllConfirmation();
      });
    }

    // Search / Create input
    const searchContainer = contentEl.createDiv();
    searchContainer.addClass('sa-relative', 'sa-mb-12');

    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search or create tag...',
    });
    this.searchInput.addClass('sa-w-full', 'sa-p-8', 'sa-border', 'sa-rounded-8', 'sa-bg-primary', 'sa-text-normal', 'sa-text-md', 'tm-search-input');
    this.searchInput.maxLength = TAG_NAME_MAX_LENGTH;

    // Tag list container
    this.listContainer = contentEl.createDiv();
    this.listContainer.addClass('sa-overflow-y-auto');
    this.listContainer.setCssProps({ '--sa-max-height': '300px' });
    this.listContainer.addClass('sa-dynamic-max-height');

    // Keyboard hints footer (desktop only)
    if (Platform.isDesktop) {
      const hintsEl = contentEl.createDiv();
      hintsEl.addClass('sa-flex-row', 'sa-gap-12', 'sa-py-8', 'sa-px-4', 'sa-mt-8', 'sa-border-b', 'sa-text-faint', 'sa-text-xs');
      const hints = [
        { key: '↑↓', label: 'navigate' },
        { key: '↵', label: 'select' },
        { key: 'del', label: 'delete' },
        { key: 'esc', label: 'close' },
      ];
      for (const hint of hints) {
        const hintItem = hintsEl.createSpan();
        hintItem.addClass('sa-inline-flex', 'tm-hint-gap');
        const kbd = hintItem.createEl('kbd');
        kbd.textContent = hint.key;
        kbd.addClass('sa-border', 'sa-bg-secondary', 'sa-text-muted', 'tm-kbd');
        hintItem.createSpan({ text: hint.label });
      }
    }

    // Render initially
    this.renderTagList(this.listContainer, '');

    // Search input handler — reset highlight on every keystroke
    this.searchInput.addEventListener('input', () => {
      this.highlightedIndex = -1;
      const query = this.searchInput?.value || '';
      if (this.listContainer) this.renderTagList(this.listContainer, query);
    });

    // Keyboard navigation: ArrowDown, ArrowUp, Enter
    this.scope.register([], 'ArrowDown', (): boolean => {
      if (this.totalRowCount > 0) {
        this.highlightedIndex = Math.min(this.highlightedIndex + 1, this.totalRowCount - 1);
        this.updateHighlight();
      }
      return false;
    });

    this.scope.register([], 'ArrowUp', (): boolean => {
      if (this.totalRowCount > 0) {
        this.highlightedIndex = Math.max(this.highlightedIndex - 1, -1);
        this.updateHighlight();
        // If moved back to -1, refocus search input
        if (this.highlightedIndex === -1) {
          this.searchInput?.focus();
        }
      }
      return false;
    });

    this.scope.register([], 'Enter', (): boolean => {
      if (!this.listContainer) return true;
      const rows = this.listContainer.querySelectorAll('.sa-tag-row');

      // If a row is highlighted, click it
      if (this.highlightedIndex >= 0) {
        const row = rows[this.highlightedIndex] as HTMLElement | undefined;
        if (row) {
          row.click();
          return false;
        }
      }

      // No highlight — if create row is visible, trigger it directly
      if (this.hasCreateRow && rows.length > 0) {
        const createRow = rows[rows.length - 1] as HTMLElement;
        createRow.click();
        return false;
      }

      return true;
    });

    // Delete highlighted tag with Delete or Backspace (only when search input is empty)
    const handleDelete = (): boolean => {
      if (this.highlightedIndex < 0 || !this.listContainer) return true;
      // Only delete when search input is empty to avoid interfering with typing
      const query = this.searchInput?.value || '';
      if (query.length > 0) return true;
      // Don't delete the create row
      if (this.hasCreateRow && this.highlightedIndex === this.totalRowCount - 1) return true;

      const rows = this.listContainer.querySelectorAll('.sa-tag-row');
      const row = rows[this.highlightedIndex] as HTMLElement | undefined;
      const deleteBtn = row?.querySelector('.sa-tag-delete-btn') as HTMLElement | undefined;
      if (deleteBtn) {
        deleteBtn.click();
        return false;
      }
      return true;
    };
    this.scope.register([], 'Delete', handleDelete);
    this.scope.register([], 'Backspace', handleDelete);

    // Focus search input
    this.searchInput.focus();
  }

  onClose(): void {
    this.contentEl.empty();
    // Notify timeline once when modal closes (if any changes were made)
    // Delay slightly to let metadataCache update from background YAML writes
    if (this.dirty) {
      this.onTagsChanged();
      setTimeout(() => this.onTagsChanged(), 500);
    }
  }

  /** Mark that changes were made (defers onTagsChanged to onClose) */
  private markDirty(): void {
    this.dirty = true;
  }

  private rerenderCurrentList(): void {
    if (!this.listContainer) return;
    this.renderTagList(this.listContainer, this.searchInput?.value || '');
  }

  private openEditTagModal(tag: TagDefinition): void {
    const editModal = new TagEditModal(this.app, this.tagStore, tag, (updatedTag, previousName) => {
      this.markDirty();

      if (this.filePath && previousName.toLowerCase() !== updatedTag.name.toLowerCase()) {
        const prevLower = previousName.toLowerCase();
        const nextLower = updatedTag.name.toLowerCase();

        // Keep post-mode UI stable while metadataCache catches up after bulk rename.
        const currentTags = this.tagStore.getTagsForPost(this.filePath);
        if (currentTags.some(t => t.toLowerCase() === prevLower)) {
          this.toggledOffTags.add(prevLower);
          this.toggledOnTags.add(nextLower);
          if (this.onUIModify) this.onUIModify(this.filePath);
        }
      }

      this.rerenderCurrentList();
    });
    editModal.open();
  }

  private async convertAutoTagToManaged(tag: TagDefinition): Promise<void> {
    try {
      await this.tagStore.createTag(tag.name);
      this.markDirty();
      this.rerenderCurrentList();
      new Notice(`Converted "${tag.name}" to a managed tag`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (typeof message === 'string' && /already exists/i.test(message)) {
        this.markDirty();
        this.rerenderCurrentList();
        new Notice(`"${tag.name}" is already a managed tag`);
        return;
      }
      new Notice(`Failed to convert tag: ${message}`);
    }
  }

  /** Update visual highlight for keyboard-navigated row */
  private updateHighlight(): void {
    if (!this.listContainer) return;
    const rows = this.listContainer.querySelectorAll('.sa-tag-row');
    rows.forEach((row, index) => {
      const el = row as HTMLElement;
      const isHighlighted = index === this.highlightedIndex;
      if (isHighlighted) {
        el.addClass('sa-bg-hover', 'tm-row-highlighted');
      } else {
        el.removeClass('sa-bg-hover', 'tm-row-highlighted');
      }
      if (isHighlighted) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  /** Get all tags, filtering out tags deleted this session (stale cache workaround) */
  private getFilteredTags(): TagDefinition[] {
    const allTags = this.tagStore.getAllDiscoveredTags();
    if (this.deletedTagNames.size === 0) return allTags;
    return allTags.filter(t => !this.deletedTagNames.has(t.name.toLowerCase()));
  }

  /** Show confirmation before deleting all tags */
  private showDeleteAllConfirmation(): void {
    const allTags = this.getFilteredTags();
    if (allTags.length === 0) return;

    // Replace content with confirmation UI
    const { contentEl } = this;
    contentEl.empty();

    const confirmEl = contentEl.createDiv();
    confirmEl.addClass('sa-text-center', 'sa-py-12');

    const iconEl = confirmEl.createDiv();
    iconEl.addClass('sa-icon-32', 'sa-text-error', 'sa-mb-12', 'tm-confirm-icon');
    setIcon(iconEl, 'alert-triangle');

    const titleP = confirmEl.createEl('p', { text: `Delete all ${allTags.length} tags?` });
    titleP.addClass('sa-text-lg', 'sa-font-semibold', 'sa-m-0', 'sa-mb-4');

    const descP = confirmEl.createEl('p', { text: 'This will remove all tag definitions and tags from all posts. This cannot be undone.' });
    descP.addClass('sa-text-base', 'sa-text-muted', 'sa-m-0', 'tm-confirm-desc');

    const btnRow = confirmEl.createDiv();
    btnRow.addClass('sa-flex', 'sa-gap-8', 'tm-confirm-btns');

    // Cancel
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addClass('sa-py-8', 'sa-px-20', 'sa-rounded-6', 'sa-text-md', 'sa-clickable');
    cancelBtn.addEventListener('click', () => {
      // Re-render the modal
      this.onOpen();
    });

    // Confirm delete
    const confirmBtn = btnRow.createEl('button', { text: 'Delete all' });
    confirmBtn.addClass('sa-py-8', 'sa-px-20', 'sa-rounded-6', 'sa-text-md', 'sa-clickable', 'sa-font-semibold', 'tm-confirm-delete-btn');
    confirmBtn.addEventListener('click', () => {
      // Collect everything to delete before closing
      const definitions = [...this.tagStore.getTagDefinitions()];
      const autoTags = allTags.filter(t => t.id.startsWith('auto:'));
      const totalCount = definitions.length + autoTags.length;

      // Optimistic: close modal immediately, run deletions in background
      this.markDirty();
      this.close();
      new Notice(`Deleting ${totalCount} tag${totalCount !== 1 ? 's' : ''}...`);

      // Background: delete definitions then bulk-remove auto tags
      void (async () => {
        try {
          for (const def of definitions) {
            await this.tagStore.deleteTag(def.id);
          }
          for (const tag of autoTags) {
            await this.tagStore.bulkRemoveTag(tag.name);
          }
          new Notice(`Deleted ${totalCount} tag${totalCount !== 1 ? 's' : ''}`);
        } catch (err) {
          new Notice(`Some tags failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      })();
    });
  }

  private renderTagList(container: HTMLElement, query: string): void {
    container.empty();

    // Get ALL tags, excluding those deleted this session
    const allTags = this.getFilteredTags();
    const postTags = this.filePath ? this.tagStore.getTagsForPost(this.filePath) : [];
    // Apply optimistic toggles over stale cache
    const postTagsLower = new Set(
      postTags.map(t => t.toLowerCase()).filter(t => !this.toggledOffTags.has(t))
    );
    // Add optimistically toggled-on tags
    for (const t of this.toggledOnTags) {
      postTagsLower.add(t);
    }

    // Filter by search query
    const trimmedQuery = query.trim().toLowerCase();
    const filteredTags = trimmedQuery
      ? allTags.filter(t => t.name.toLowerCase().includes(trimmedQuery))
      : allTags;

    // Sort: applied tags first, then defined before undefined, then by sortOrder
    const sorted = [...filteredTags].sort((a, b) => {
      const aApplied = postTagsLower.has(a.name.toLowerCase()) ? 0 : 1;
      const bApplied = postTagsLower.has(b.name.toLowerCase()) ? 0 : 1;
      if (aApplied !== bApplied) return aApplied - bApplied;
      return a.sortOrder - b.sortOrder;
    });

    // Render each tag
    let rowIndex = 0;
    for (const tag of sorted) {
      const isApplied = postTagsLower.has(tag.name.toLowerCase());
      const isUndefined = tag.id.startsWith('auto:');
      this.renderTagRow(container, tag, isApplied, isUndefined);
      rowIndex++;
    }

    // "Create" option if search doesn't match any existing tag
    const showCreate = !!(trimmedQuery && !allTags.some(t => t.name.toLowerCase() === trimmedQuery));
    this.hasCreateRow = showCreate;
    if (showCreate) {
      this.renderCreateRow(container, query.trim());
      rowIndex++;
    }

    // Update total row count for keyboard navigation
    this.totalRowCount = rowIndex;
    // Clamp highlighted index to new bounds
    if (this.highlightedIndex >= this.totalRowCount) {
      this.highlightedIndex = this.totalRowCount - 1;
    }
    // Re-apply highlight styling after re-render
    if (this.highlightedIndex >= 0) {
      this.updateHighlight();
    }

    // Empty state
    if (sorted.length === 0 && !trimmedQuery) {
      const emptyEl = container.createDiv();
      emptyEl.addClass('sa-empty-state');
      emptyEl.textContent = 'No tags yet. Type a name above to create one.';
    }
  }

  private renderTagRow(container: HTMLElement, tag: TagDefinition, isApplied: boolean, isUndefined: boolean = false): void {
    const row = container.createDiv();
    row.addClass('sa-tag-row', 'sa-flex-row', 'sa-gap-10', 'sa-p-8', 'sa-px-12', 'sa-rounded-6', 'sa-clickable', 'sa-transition-bg');

    // Color dot (or muted dot for undefined tags)
    const dot = row.createDiv();
    dot.addClass('sa-flex-shrink-0', 'sa-rounded-full', 'tm-tag-dot');
    dot.setCssProps({ '--tm-dot-color': tag.color || 'var(--background-modifier-border)' });

    // Tag name
    const nameEl = row.createSpan({ text: tag.name });
    nameEl.addClass('sa-flex-1', 'sa-text-md');
    if (isUndefined) {
      nameEl.addClass('sa-text-muted', 'tm-tag-italic');
    } else {
      nameEl.addClass('sa-text-normal');
    }
    if (isApplied) {
      nameEl.addClass('sa-font-semibold');
    }

    // Checkmark for applied tags
    if (isApplied) {
      const checkEl = row.createDiv();
      checkEl.addClass('sa-icon-16', 'sa-flex-shrink-0', 'tm-check-accent');
      setIcon(checkEl, 'check');
    }

    const actionsEl = row.createDiv();
    actionsEl.addClass('sa-flex-row', 'sa-gap-4');

    const hoverButtons: HTMLElement[] = [];
    const alwaysShowActions = Platform.isMobile || isApplied || !this.filePath;

    const applyHoverVisibility = (visible: boolean): void => {
      for (const btn of hoverButtons) {
        btn.removeClass(visible ? 'tm-delete-btn-hidden' : 'tm-delete-btn-visible');
        btn.addClass(visible ? 'tm-delete-btn-visible' : 'tm-delete-btn-hidden');
      }
    };

    const createActionButton = (title: string, icon: string): HTMLDivElement => {
      const btn = actionsEl.createDiv();
      btn.addClass('sa-flex-center', 'sa-rounded-4', 'sa-text-muted', 'sa-clickable', 'sa-transition', 'sa-flex-shrink-0', 'tm-delete-btn');
      btn.setAttribute('title', title);
      setIcon(btn, icon);
      btn.querySelector('svg')?.setAttribute('width', '14');
      btn.querySelector('svg')?.setAttribute('height', '14');
      if (alwaysShowActions) {
        btn.addClass('tm-delete-btn-visible');
      } else {
        btn.addClass('tm-delete-btn-hidden');
        hoverButtons.push(btn);
      }
      return btn;
    };

    if (isUndefined) {
      const convertBtn = createActionButton('Convert to managed tag', 'plus');
      convertBtn.addEventListener('mouseenter', () => {
        convertBtn.removeClass('sa-text-muted');
        convertBtn.addClass('sa-text-accent', 'sa-bg-hover');
      });
      convertBtn.addEventListener('mouseleave', () => {
        convertBtn.removeClass('sa-text-accent', 'sa-bg-hover');
        convertBtn.addClass('sa-text-muted');
      });
      convertBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.convertAutoTagToManaged(tag);
      });
    } else {
      const editBtn = createActionButton('Edit tag', 'pencil');
      editBtn.addEventListener('mouseenter', () => {
        editBtn.removeClass('sa-text-muted');
        editBtn.addClass('sa-text-accent', 'sa-bg-hover');
      });
      editBtn.addEventListener('mouseleave', () => {
        editBtn.removeClass('sa-text-accent', 'sa-bg-hover');
        editBtn.addClass('sa-text-muted');
      });
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditTagModal(tag);
      });
    }

    // Delete button (for ALL tags)
    const deleteBtn = createActionButton(
      isUndefined ? 'Remove from all posts' : 'Delete tag and remove from all posts',
      'trash-2'
    );
    deleteBtn.addClass('sa-tag-delete-btn');

    deleteBtn.addEventListener('mouseenter', () => {
      deleteBtn.removeClass('sa-text-muted');
      deleteBtn.addClass('sa-text-error', 'sa-bg-hover');
    });
    deleteBtn.addEventListener('mouseleave', () => {
      deleteBtn.removeClass('sa-text-error', 'sa-bg-hover');
      deleteBtn.addClass('sa-text-muted');
    });

    // Show/hide delete button on row hover (non-applied tags only)
    // On mobile: skip hover effects to allow direct tap selection
    // Also clear keyboard highlight on mouse interaction
    if (!Platform.isMobile) {
      row.addEventListener('mouseenter', () => {
        // Clear keyboard highlight when mouse takes over
        if (this.highlightedIndex >= 0) {
          this.highlightedIndex = -1;
          this.updateHighlight();
        }
        row.addClass('sa-bg-hover');
        applyHoverVisibility(true);
      });
      row.addEventListener('mouseleave', () => {
        row.removeClass('sa-bg-hover');
        if (!alwaysShowActions) {
          applyHoverVisibility(false);
        }
      });
    }

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void (async () => {
        try {
          if (isUndefined) {
            // Auto-discovered tag: bulk remove from all posts
            const count = await this.tagStore.bulkRemoveTag(tag.name);
            new Notice(`Removed "${tag.name}" from ${count} post${count !== 1 ? 's' : ''}`);
          } else {
            // User-defined tag: delete definition + remove from all posts
            await this.tagStore.deleteTag(tag.id);
            new Notice(`Deleted tag "${tag.name}"`);
          }
          // Track deleted name to filter stale metadataCache results
          this.deletedTagNames.add(tag.name.toLowerCase());
          this.markDirty();
          this.rerenderCurrentList();
        } catch (err) {
          new Notice(`Failed to delete tag: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      })();
    });

    // Toggle on click (only in post mode) — optimistic UI
    if (this.filePath) {
      row.addEventListener('click', () => {
        const lower = tag.name.toLowerCase();
        // Optimistic: update sets immediately, re-render
        this.markDirty();
        if (isApplied) {
          this.toggledOffTags.add(lower);
          this.toggledOnTags.delete(lower);
        } else {
          this.toggledOnTags.add(lower);
          this.toggledOffTags.delete(lower);
        }
        this.rerenderCurrentList();

        // Register UI modify to prevent timeline refresh from vault watcher
        if (this.onUIModify && this.filePath) this.onUIModify(this.filePath);
        // Background: actual YAML update
        this.tagStore.toggleTagOnPost(this.filePath ?? '', tag.name).catch(() => {
          // Revert on failure
          if (isApplied) {
            this.toggledOffTags.delete(lower);
          } else {
            this.toggledOnTags.delete(lower);
          }
          this.rerenderCurrentList();
          new Notice(`Failed to toggle tag`);
        });
      });
    }
  }

  private renderCreateRow(container: HTMLElement, name: string): void {
    const row = container.createDiv();
    row.addClass('sa-tag-row', 'sa-flex-row', 'sa-gap-10', 'sa-p-8', 'sa-px-12', 'sa-rounded-6', 'sa-clickable', 'sa-transition-bg', 'sa-border-b', 'sa-mt-4', 'tm-create-row');

    row.addEventListener('mouseenter', () => {
      if (this.highlightedIndex >= 0) {
        this.highlightedIndex = -1;
        this.updateHighlight();
      }
      row.addClass('sa-bg-hover');
    });
    row.addEventListener('mouseleave', () => {
      row.removeClass('sa-bg-hover');
    });

    // Plus icon
    const plusEl = row.createDiv();
    plusEl.addClass('sa-icon-16', 'sa-flex-shrink-0', 'sa-text-accent');
    setIcon(plusEl, 'plus');

    // Text
    const textEl = row.createSpan({ text: `Create "${name}"` });
    textEl.addClass('sa-text-md', 'sa-text-accent', 'sa-font-medium');

    // Create (and optionally apply) on click
    row.addEventListener('click', () => {
      this.markDirty();
      this.highlightedIndex = -1;
      if (this.searchInput) this.searchInput.value = '';

      void (async () => {
        try {
          const tag = await this.tagStore.createTag(name);
          if (this.filePath) {
            this.toggledOnTags.add(tag.name.toLowerCase());
            // Register UI modify to prevent timeline refresh from vault watcher
            if (this.onUIModify) this.onUIModify(this.filePath);
            await this.tagStore.addTagToPost(this.filePath, tag.name);
          }
        } catch (err) {
          new Notice(`Failed to create tag: ${err instanceof Error ? err.message : 'Unknown error'}`);
          this.toggledOnTags.delete(name.toLowerCase());
        }
        // Re-render after creation completes — tag is now in definitions
        if (this.listContainer) this.renderTagList(this.listContainer, this.searchInput?.value || '');
      })();
    });
  }
}
