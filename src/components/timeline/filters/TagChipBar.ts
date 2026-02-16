import { setIcon } from 'obsidian';
import type { TagWithCount } from '@/types/tag';

/**
 * TagChipBar - Horizontal scrollable tag chip bar for filtering
 *
 * Single Responsibility: Render tag chips and handle tag selection
 */
export class TagChipBar {
  private containerEl: HTMLElement | null = null;
  private onTagSelect: (tagName: string | null) => void;
  private selectedTag: string | null = null;
  private currentTags: TagWithCount[] = [];

  constructor(onTagSelect: (tagName: string | null) => void) {
    this.onTagSelect = onTagSelect;
  }

  /**
   * Render the tag chip bar into a parent element
   * Returns null if no tags exist
   */
  render(parent: HTMLElement, tags: TagWithCount[]): HTMLElement | null {
    // Remove existing bar
    this.destroy();

    if (tags.length === 0) return null;

    this.currentTags = tags;

    this.containerEl = parent.createDiv({ cls: 'tag-chip-bar' });
    this.containerEl.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 0 12px;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    `;

    this.renderChips();

    return this.containerEl;
  }

  /** Update tags and re-render chips in place (keeps container position) */
  update(tags: TagWithCount[]): void {
    this.currentTags = tags;
    this.renderChips();
  }

  /** Set the selected tag externally */
  setSelectedTag(tagName: string | null): void {
    this.selectedTag = tagName;
  }

  /** Destroy the component */
  destroy(): void {
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
  }

  /**
   * Re-render chips inside the existing container.
   * Updates visual selection state without recreating the container div.
   */
  private renderChips(): void {
    if (!this.containerEl) return;

    // Clear existing chips but keep the container in place
    this.containerEl.empty();

    // Hide scrollbar for webkit
    const style = document.createElement('style');
    style.textContent = `.tag-chip-bar::-webkit-scrollbar { display: none; }`;
    this.containerEl.prepend(style);

    // "All" chip
    this.renderChip(this.containerEl, {
      label: 'All',
      count: null,
      color: null,
      isSelected: this.selectedTag === null,
      onClick: () => {
        this.selectedTag = null;
        this.renderChips();
        this.onTagSelect(null);
      },
    });

    // Tag chips (sorted by sortOrder)
    const sorted = [...this.currentTags].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const tag of sorted) {
      this.renderChip(this.containerEl, {
        label: tag.name,
        count: tag.archiveCount,
        color: tag.color,
        isSelected: this.selectedTag === tag.name,
        onClick: () => {
          if (this.selectedTag === tag.name) {
            this.selectedTag = null;
          } else {
            this.selectedTag = tag.name;
          }
          this.renderChips();
          this.onTagSelect(this.selectedTag);
        },
      });
    }
  }

  private renderChip(
    parent: HTMLElement,
    options: {
      label: string;
      count: number | null;
      color: string | null;
      isSelected: boolean;
      onClick: () => void;
    }
  ): void {
    const chip = parent.createDiv({ cls: 'tag-chip' });

    const bgColor = options.isSelected && options.color
      ? options.color + '20' // 12% opacity
      : options.isSelected
        ? 'var(--interactive-accent)'
        : 'var(--background-secondary)';

    const textColor = options.isSelected && options.color
      ? options.color
      : options.isSelected
        ? 'var(--text-on-accent)'
        : 'var(--text-muted)';

    const borderColor = options.isSelected && options.color
      ? options.color + '40'
      : 'transparent';

    chip.style.cssText = `
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 16px;
      background: ${bgColor};
      border: 1px solid ${borderColor};
      color: ${textColor};
      font-size: 12px;
      font-weight: ${options.isSelected ? '600' : '500'};
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.15s ease;
      user-select: none;
    `;

    // Color dot (for tags with color, when not selected)
    if (options.color && !options.isSelected) {
      const dot = chip.createDiv();
      dot.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: ${options.color};
        flex-shrink: 0;
        align-self: center;
      `;
    }

    // Label
    chip.createSpan({ text: options.label });

    // Count badge
    if (options.count !== null && options.count > 0) {
      const countSpan = chip.createSpan({ text: String(options.count) });
      countSpan.style.cssText = `
        font-size: 10px;
        opacity: 0.7;
        margin-left: 2px;
      `;
    }

    // Hover effect
    chip.addEventListener('mouseenter', () => {
      if (!options.isSelected) {
        chip.style.background = 'var(--background-modifier-hover)';
      }
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.background = bgColor;
    });

    // Click handler
    chip.addEventListener('click', () => {
      options.onClick();
    });
  }
}
