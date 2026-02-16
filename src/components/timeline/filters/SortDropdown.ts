import { setIcon, Platform } from 'obsidian';
import type { SortState } from './FilterSortManager';
import type SocialArchiverPlugin from '../../../main';

interface SortOption {
  by: 'published' | 'archived';
  label: string;
  icon: string;
}

/**
 * SortDropdown - Renders and manages sort UI
 * Single Responsibility: Sort dropdown and order toggle UI
 */
export class SortDropdown {
  private dropdownEl: HTMLElement | null = null;
  private isOpen = false;
  private closeHandler: ((e: MouseEvent) => void) | null = null;

  // Callbacks
  private onSortChangeCallback?: (sort: Partial<SortState>) => void;
  private onRerenderCallback?: () => void;

  constructor(private plugin: SocialArchiverPlugin) {}

  /**
   * Render sort controls (dropdown + order toggle)
   */
  renderSortControls(parent: HTMLElement, sortState: SortState): HTMLElement {
    // Sort controls container (group dropdown and toggle tightly)
    const sortControls = parent.createDiv();
    sortControls.style.cssText = 'display: flex; align-items: center; gap: 0;';

    this.renderSortByButton(sortControls, parent, sortState);
    this.renderOrderToggle(sortControls, sortState);

    return sortControls;
  }

  /**
   * Render sort by dropdown button (Published / Archived)
   */
  private renderSortByButton(container: HTMLElement, header: HTMLElement, sortState: SortState): void {
    const sortByBtn = container.createDiv();
    // Mobile: icon-only (adjust border radius for single button), Desktop: icon + text
    const isMobile = Platform.isMobile;
    const padding = isMobile ? '0' : '0 12px';
    const borderRadius = isMobile ? '8px 0 0 8px' : '8px 0 0 8px'; // Keep grouped with order toggle
    sortByBtn.style.cssText = `display: flex; align-items: center; gap: 6px; padding: ${padding}; height: 40px; border-radius: ${borderRadius}; background: transparent; cursor: pointer; transition: all 0.2s; flex-shrink: 0; font-size: 13px; color: var(--text-muted); justify-content: center; min-width: 40px;`;

    const updateSortByButton = () => {
      const text = sortState.by === 'published' ? 'Published' : 'Archived';
      sortByBtn.setAttribute('title', `Sort by ${text.toLowerCase()}`);
      sortByText.setText(text);
    };

    const sortByIcon = sortByBtn.createDiv();
    sortByIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: color 0.2s;';
    setIcon(sortByIcon, 'calendar');

    const sortByText = sortByBtn.createSpan();
    // Hide text on mobile
    sortByText.style.cssText = `font-weight: 500; line-height: 1; ${isMobile ? 'display: none;' : ''}`;
    updateSortByButton();

    sortByBtn.addEventListener('mouseenter', () => {
      if (!this.isOpen) {
        sortByBtn.style.background = 'var(--background-modifier-hover)';
      }
    });

    sortByBtn.addEventListener('mouseleave', () => {
      if (!this.isOpen) {
        sortByBtn.style.background = 'transparent';
      }
    });

    sortByBtn.addEventListener('click', () => {
      if (this.isOpen) {
        this.close();
      } else {
        this.open(header, sortByBtn, sortState, updateSortByButton);
      }
    });
  }

  /**
   * Render order toggle button (Newest ⬇️ / Oldest ⬆️)
   */
  private renderOrderToggle(container: HTMLElement, sortState: SortState): void {
    const orderBtn = container.createDiv();
    orderBtn.style.cssText = 'display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 0 8px 8px 0; background: transparent; cursor: pointer; transition: all 0.2s; flex-shrink: 0;';

    const orderIcon = orderBtn.createDiv();
    orderIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--text-muted); transition: all 0.2s;';

    const updateOrderButton = () => {
      const iconName = sortState.order === 'newest' ? 'arrow-down' : 'arrow-up';
      const title = sortState.order === 'newest' ? 'Newest first' : 'Oldest first';
      orderBtn.setAttribute('title', title);
      orderIcon.empty();
      setIcon(orderIcon, iconName);
    };

    updateOrderButton();

    orderBtn.addEventListener('mouseenter', () => {
      orderBtn.style.background = 'var(--background-modifier-hover)';
      orderIcon.style.color = 'var(--interactive-accent)';
    });

    orderBtn.addEventListener('mouseleave', () => {
      orderBtn.style.background = 'transparent';
      orderIcon.style.color = 'var(--text-muted)';
    });

    orderBtn.addEventListener('click', async () => {
      // Toggle order
      const newOrder = sortState.order === 'newest' ? 'oldest' : 'newest';
      sortState.order = newOrder;

      // Save to settings
      this.plugin.settings.timelineSortOrder = newOrder;
      await this.plugin.saveSettings();

      // Update UI and notify
      updateOrderButton();
      this.onSortChangeCallback?.({ order: newOrder });
      this.onRerenderCallback?.();
    });
  }

  /**
   * Open sort by dropdown
   */
  private open(header: HTMLElement, sortByBtn: HTMLElement, sortState: SortState, updateSortByButton: () => void): void {
    // Remove existing panels
    header.querySelectorAll('.filter-panel').forEach(el => el.remove());

    // Calculate dropdown position based on button position
    const btnRect = sortByBtn.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const leftOffset = btnRect.left - headerRect.left;

    this.dropdownEl = header.createDiv({ cls: 'sort-dropdown' });
    this.dropdownEl.style.cssText = `
      position: absolute;
      top: 48px;
      left: ${leftOffset}px;
      z-index: 1000;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 8px;
      min-width: 140px;
    `;

    const sortOptions: SortOption[] = [
      { by: 'published', label: 'Published', icon: 'calendar' },
      { by: 'archived', label: 'Archived', icon: 'archive' }
    ];

    sortOptions.forEach((option, index) => {
      this.renderSortOption(this.dropdownEl!, option, sortState, index > 0, updateSortByButton);
    });

    this.attachOutsideClickHandler(sortByBtn);
    this.isOpen = true;
  }

  /**
   * Render individual sort option
   */
  private renderSortOption(
    dropdown: HTMLElement,
    option: SortOption,
    sortState: SortState,
    hasMarginTop: boolean,
    updateSortByButton: () => void
  ): void {
    const item = dropdown.createDiv();
    const isActive = sortState.by === option.by;

    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      background: ${isActive ? 'var(--interactive-accent)' : 'transparent'};
      color: ${isActive ? 'var(--text-on-accent)' : 'var(--text-normal)'};
      ${hasMarginTop ? 'margin-top: 4px;' : ''}
    `;

    const icon = item.createDiv();
    icon.style.cssText = 'width: 16px; height: 16px;';
    setIcon(icon, option.icon);

    const label = item.createSpan({ text: option.label });
    label.style.cssText = 'font-size: 13px; flex: 1;';

    item.addEventListener('click', async () => {
      sortState.by = option.by;

      // Save to settings
      this.plugin.settings.timelineSortBy = sortState.by;
      await this.plugin.saveSettings();

      this.close();
      updateSortByButton();
      this.onSortChangeCallback?.({ by: option.by });
      this.onRerenderCallback?.();
    });

    item.addEventListener('mouseenter', () => {
      if (!isActive) {
        item.style.background = 'var(--background-modifier-hover)';
      }
    });

    item.addEventListener('mouseleave', () => {
      if (!isActive) {
        item.style.background = 'transparent';
      }
    });
  }

  /**
   * Close dropdown
   */
  close(): void {
    if (this.closeHandler) {
      document.removeEventListener('click', this.closeHandler);
      this.closeHandler = null;
    }
    this.dropdownEl?.remove();
    this.dropdownEl = null;
    this.isOpen = false;
  }

  /**
   * Attach outside click handler to close dropdown
   */
  private attachOutsideClickHandler(sortByBtn: HTMLElement): void {
    this.closeHandler = (e: MouseEvent) => {
      if (this.dropdownEl && !this.dropdownEl.contains(e.target as Node) && !sortByBtn.contains(e.target as Node)) {
        this.close();
      }
    };
    setTimeout(() => {
      // Guard: dropdown may have been closed during the timeout delay
      if (this.closeHandler && this.isOpen) {
        document.addEventListener('click', this.closeHandler);
      }
    }, 0);
  }

  /**
   * Set callback for sort changes
   */
  onSortChange(callback: (sort: Partial<SortState>) => void): void {
    this.onSortChangeCallback = callback;
  }

  /**
   * Set callback for re-rendering
   */
  onRerender(callback: () => void): void {
    this.onRerenderCallback = callback;
  }
}
