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
      modalEl.style.setProperty('width', '92vw', 'important');
      modalEl.style.setProperty('max-width', '92vw', 'important');
      modalEl.style.setProperty('height', 'auto', 'important');
      modalEl.style.setProperty('max-height', '90vh', 'important');
      modalEl.style.setProperty('overflow-y', 'auto', 'important');

      contentEl.style.paddingLeft = '12px';
      contentEl.style.paddingRight = '12px';

      // Shrink the built-in close button on mobile
      const closeBtn = modalEl.querySelector('.modal-close-button') as HTMLElement;
      if (closeBtn) {
        closeBtn.style.setProperty('width', '28px', 'important');
        closeBtn.style.setProperty('height', '28px', 'important');
        closeBtn.style.setProperty('font-size', '14px', 'important');
        closeBtn.style.setProperty('top', '10px', 'important');
        closeBtn.style.setProperty('right', '10px', 'important');
      }
    }

    // Title row: "Manage Tags (count)" + "Delete All" button
    const titleRow = contentEl.createDiv();
    titleRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin: 0 0 12px;';

    const titleEl = titleRow.createDiv();
    titleEl.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600;';
    titleEl.createSpan({ text: 'Manage Tags' });

    const allTags = this.getFilteredTags();
    if (allTags.length > 0) {
      const countBadge = titleEl.createSpan({ text: String(allTags.length) });
      countBadge.style.cssText = 'font-size: 12px; font-weight: 500; color: var(--text-muted); background: var(--background-secondary); padding: 1px 8px; border-radius: 10px;';

      // Delete All button
      const deleteAllBtn = titleRow.createDiv();
      deleteAllBtn.style.cssText = `
        display: flex; align-items: center; gap: 4px;
        padding: 4px 10px; border-radius: 6px;
        font-size: 12px; font-weight: 500;
        color: var(--text-muted); cursor: pointer;
        transition: all 0.15s;
      `;
      deleteAllBtn.createSpan({ text: 'Delete All' });

      deleteAllBtn.addEventListener('mouseenter', () => {
        deleteAllBtn.style.color = 'var(--text-error)';
        deleteAllBtn.style.background = 'var(--background-modifier-hover)';
      });
      deleteAllBtn.addEventListener('mouseleave', () => {
        deleteAllBtn.style.color = 'var(--text-muted)';
        deleteAllBtn.style.background = 'transparent';
      });

      deleteAllBtn.addEventListener('click', () => {
        this.showDeleteAllConfirmation();
      });
    }

    // Search / Create input
    const searchContainer = contentEl.createDiv();
    searchContainer.style.cssText = 'position: relative; margin-bottom: 12px;';

    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search or create tag...',
    });
    this.searchInput.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      background: var(--background-primary);
      color: var(--text-normal);
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
    `;
    this.searchInput.maxLength = TAG_NAME_MAX_LENGTH;

    // Tag list container
    this.listContainer = contentEl.createDiv();
    this.listContainer.style.cssText = 'max-height: 300px; overflow-y: auto;';

    // Keyboard hints footer (desktop only)
    if (Platform.isDesktop) {
      const hintsEl = contentEl.createDiv();
      hintsEl.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 4px 0;
        margin-top: 8px;
        border-top: 1px solid var(--background-modifier-border);
        color: var(--text-faint);
        font-size: 11px;
      `;
      const hints = [
        { key: '↑↓', label: 'navigate' },
        { key: '↵', label: 'select' },
        { key: 'del', label: 'delete' },
        { key: 'esc', label: 'close' },
      ];
      for (const hint of hints) {
        const hintItem = hintsEl.createSpan();
        hintItem.style.cssText = 'display: flex; align-items: center; gap: 3px;';
        const kbd = hintItem.createEl('kbd');
        kbd.textContent = hint.key;
        kbd.style.cssText = `
          font-family: inherit;
          font-size: 10px;
          padding: 1px 4px;
          border-radius: 3px;
          border: 1px solid var(--background-modifier-border);
          background: var(--background-secondary);
          color: var(--text-muted);
          line-height: 1.4;
        `;
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
      el.style.background = isHighlighted
        ? 'var(--background-modifier-hover)'
        : '';
      el.style.outline = isHighlighted
        ? '2px solid var(--interactive-accent)'
        : 'none';
      el.style.outlineOffset = isHighlighted ? '-2px' : '0';
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
    confirmEl.style.cssText = 'text-align: center; padding: 12px 0;';

    const iconEl = confirmEl.createDiv();
    iconEl.style.cssText = 'width: 32px; height: 32px; margin: 0 auto 12px; color: var(--text-error);';
    setIcon(iconEl, 'alert-triangle');

    confirmEl.createEl('p', { text: `Delete all ${allTags.length} tags?` }).style.cssText =
      'font-size: 16px; font-weight: 600; margin: 0 0 4px;';
    confirmEl.createEl('p', { text: 'This will remove all tag definitions and tags from all posts. This cannot be undone.' }).style.cssText =
      'font-size: 13px; color: var(--text-muted); margin: 0 0 20px;';

    const btnRow = confirmEl.createDiv();
    btnRow.style.cssText = 'display: flex; gap: 8px; justify-content: center;';

    // Cancel
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
    cancelBtn.style.cssText = 'padding: 8px 20px; border-radius: 6px; font-size: 14px; cursor: pointer;';
    cancelBtn.addEventListener('click', () => {
      // Re-render the modal
      this.onOpen();
    });

    // Confirm delete
    const confirmBtn = btnRow.createEl('button', { text: 'Delete All' });
    confirmBtn.style.cssText = 'padding: 8px 20px; border-radius: 6px; font-size: 14px; cursor: pointer; background: var(--text-error); color: white; border: none; font-weight: 600;';
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
      emptyEl.style.cssText = 'padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;';
      emptyEl.textContent = 'No tags yet. Type a name above to create one.';
    }
  }

  private renderTagRow(container: HTMLElement, tag: TagDefinition, isApplied: boolean, isUndefined: boolean = false): void {
    const row = container.createDiv();
    row.addClass('sa-tag-row');
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s;
    `;

    // Color dot (or muted dot for undefined tags)
    const dot = row.createDiv();
    dot.style.cssText = `
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: ${tag.color || 'var(--background-modifier-border)'};
      flex-shrink: 0;
    `;

    // Tag name
    const nameEl = row.createSpan({ text: tag.name });
    nameEl.style.cssText = `
      flex: 1;
      font-size: 14px;
      color: ${isUndefined ? 'var(--text-muted)' : 'var(--text-normal)'};
      font-weight: ${isApplied ? '600' : '400'};
      ${isUndefined ? 'font-style: italic;' : ''}
    `;

    // Checkmark for applied tags
    if (isApplied) {
      const checkEl = row.createDiv();
      checkEl.style.cssText = `
        width: 16px;
        height: 16px;
        color: var(--interactive-accent);
        flex-shrink: 0;
      `;
      setIcon(checkEl, 'check');
    }

    // Delete button (for ALL tags) — always visible for applied tags, hover-only otherwise
    const deleteBtn = row.createDiv();
    deleteBtn.addClass('sa-tag-delete-btn');
    deleteBtn.style.cssText = `
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s;
      flex-shrink: 0;
      opacity: ${isApplied || Platform.isMobile ? '1' : '0'};
    `;
    deleteBtn.setAttribute('title', isUndefined ? 'Remove from all posts' : 'Delete tag and remove from all posts');
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.querySelector('svg')?.setAttribute('width', '14');
    deleteBtn.querySelector('svg')?.setAttribute('height', '14');

    deleteBtn.addEventListener('mouseenter', () => {
      deleteBtn.style.color = 'var(--text-error)';
      deleteBtn.style.background = 'var(--background-modifier-hover)';
    });
    deleteBtn.addEventListener('mouseleave', () => {
      deleteBtn.style.color = 'var(--text-muted)';
      deleteBtn.style.background = 'transparent';
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
        row.style.background = 'var(--background-modifier-hover)';
        deleteBtn.style.opacity = '1';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = '';
        if (!isApplied) deleteBtn.style.opacity = '0';
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
    row.addClass('sa-tag-row');
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s;
      border-top: 1px solid var(--background-modifier-border);
      margin-top: 4px;
      padding-top: 12px;
    `;

    row.addEventListener('mouseenter', () => {
      if (this.highlightedIndex >= 0) {
        this.highlightedIndex = -1;
        this.updateHighlight();
      }
      row.style.background = 'var(--background-modifier-hover)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = '';
    });

    // Plus icon
    const plusEl = row.createDiv();
    plusEl.style.cssText = 'width: 16px; height: 16px; color: var(--interactive-accent); flex-shrink: 0;';
    setIcon(plusEl, 'plus');

    // Text
    const textEl = row.createSpan({ text: `Create "${name}"` });
    textEl.style.cssText = 'font-size: 14px; color: var(--interactive-accent); font-weight: 500;';

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
