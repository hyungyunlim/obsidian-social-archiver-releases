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
    sortControls.addClass('sa-flex-row', 'sd-controls');

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
    sortByBtn.addClass('sa-flex-row', 'sa-gap-6', 'sa-bg-transparent', 'sa-clickable', 'sa-transition', 'sa-flex-shrink-0', 'sa-text-base', 'sa-text-muted', 'sa-flex-center', 'sd-sort-btn');
    if (!isMobile) {
      sortByBtn.addClass('sa-px-12');
    }

    const updateSortByButton = () => {
      const text = sortState.by === 'published' ? 'Published' : 'Archived';
      sortByBtn.setAttribute('title', `Sort by ${text.toLowerCase()}`);
      sortByText.setText(text);
    };

    const sortByIcon = sortByBtn.createDiv();
    sortByIcon.addClass('sa-icon-16', 'sa-flex-shrink-0', 'sa-transition-color');
    setIcon(sortByIcon, 'calendar');

    const sortByText = sortByBtn.createSpan();
    // Hide text on mobile
    sortByText.addClass('sa-font-medium', 'sd-sort-btn-text');
    if (isMobile) {
      sortByText.addClass('sa-hidden');
    }
    updateSortByButton();

    sortByBtn.addEventListener('mouseenter', () => {
      if (!this.isOpen) {
        sortByBtn.removeClass('sa-bg-transparent');
        sortByBtn.addClass('sa-bg-hover');
      }
    });

    sortByBtn.addEventListener('mouseleave', () => {
      if (!this.isOpen) {
        sortByBtn.removeClass('sa-bg-hover');
        sortByBtn.addClass('sa-bg-transparent');
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
    orderBtn.addClass('sa-flex-center', 'sa-bg-transparent', 'sa-clickable', 'sa-transition', 'sa-flex-shrink-0', 'sd-order-btn');

    const orderIcon = orderBtn.createDiv();
    orderIcon.addClass('sa-icon-16', 'sa-flex-shrink-0', 'sa-text-muted', 'sa-transition');

    const updateOrderButton = () => {
      const iconName = sortState.order === 'newest' ? 'arrow-down' : 'arrow-up';
      const title = sortState.order === 'newest' ? 'Newest first' : 'Oldest first';
      orderBtn.setAttribute('title', title);
      orderIcon.empty();
      setIcon(orderIcon, iconName);
    };

    updateOrderButton();

    orderBtn.addEventListener('mouseenter', () => {
      orderBtn.removeClass('sa-bg-transparent');
      orderBtn.addClass('sa-bg-hover');
      orderIcon.removeClass('sa-text-muted');
      orderIcon.addClass('sa-text-accent');
    });

    orderBtn.addEventListener('mouseleave', () => {
      orderBtn.removeClass('sa-bg-hover');
      orderBtn.addClass('sa-bg-transparent');
      orderIcon.removeClass('sa-text-accent');
      orderIcon.addClass('sa-text-muted');
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
    this.dropdownEl.addClass('sa-absolute', 'sa-z-1000', 'sa-bg-primary', 'sa-border', 'sa-rounded-8', 'sa-p-8', 'sd-dropdown');
    this.dropdownEl.setCssProps({ '--sd-left': `${leftOffset}px` });

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

    item.addClass('sa-flex-row', 'sa-gap-8', 'sa-p-8', 'sa-rounded-6', 'sa-clickable', 'sa-transition');
    if (isActive) {
      item.addClass('sa-bg-accent', 'sd-option-active');
    } else {
      item.addClass('sa-bg-transparent', 'sa-text-normal');
    }
    if (hasMarginTop) {
      item.addClass('sa-mt-4');
    }

    const icon = item.createDiv();
    icon.addClass('sa-icon-16');
    setIcon(icon, option.icon);

    const label = item.createSpan({ text: option.label });
    label.addClass('sa-text-base', 'sa-flex-1');

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
        item.removeClass('sa-bg-transparent');
        item.addClass('sa-bg-hover');
      }
    });

    item.addEventListener('mouseleave', () => {
      if (!isActive) {
        item.removeClass('sa-bg-hover');
        item.addClass('sa-bg-transparent');
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
