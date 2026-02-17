import { Modal, Notice, Platform, setIcon, type App } from 'obsidian';
import type { TagStore } from '@/services/TagStore';
import type { TagDefinition } from '@/types/tag';
import { TAG_COLORS, TAG_NAME_MAX_LENGTH } from '@/types/tag';

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
    const confirmBtn = btnRow.createEl('button', { text: 'Delete All' });
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
      (async () => {
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

    // Delete button (for ALL tags) — always visible for applied tags, hover-only otherwise
    const deleteBtn = row.createDiv();
    deleteBtn.addClass('sa-tag-delete-btn', 'sa-flex-center', 'sa-rounded-4', 'sa-text-muted', 'sa-clickable', 'sa-transition', 'sa-flex-shrink-0', 'tm-delete-btn');
    deleteBtn.addClass(isApplied || Platform.isMobile ? 'tm-delete-btn-visible' : 'tm-delete-btn-hidden');
    deleteBtn.setAttribute('title', isUndefined ? 'Remove from all posts' : 'Delete tag and remove from all posts');
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.querySelector('svg')?.setAttribute('width', '14');
    deleteBtn.querySelector('svg')?.setAttribute('height', '14');

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
        deleteBtn.removeClass('tm-delete-btn-hidden');
        deleteBtn.addClass('tm-delete-btn-visible');
      });
      row.addEventListener('mouseleave', () => {
        row.removeClass('sa-bg-hover');
        if (!isApplied) {
          deleteBtn.removeClass('tm-delete-btn-visible');
          deleteBtn.addClass('tm-delete-btn-hidden');
        }
      });
    }

    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
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
        const query = this.searchInput?.value || '';
        this.renderTagList(container, query);
      } catch (err) {
        new Notice(`Failed to delete tag: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
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
        const query = this.searchInput?.value || '';
        this.renderTagList(container, query);

        // Register UI modify to prevent timeline refresh from vault watcher
        if (this.onUIModify && this.filePath) this.onUIModify(this.filePath);
        // Background: actual YAML update
        this.tagStore.toggleTagOnPost(this.filePath!, tag.name).catch(() => {
          // Revert on failure
          if (isApplied) {
            this.toggledOffTags.delete(lower);
          } else {
            this.toggledOnTags.delete(lower);
          }
          const q = this.searchInput?.value || '';
          this.renderTagList(container, q);
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
    row.addEventListener('click', async () => {
      this.markDirty();
      this.highlightedIndex = -1;
      if (this.searchInput) this.searchInput.value = '';

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
    });
  }
}
