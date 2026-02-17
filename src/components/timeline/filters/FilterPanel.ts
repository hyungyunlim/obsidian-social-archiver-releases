import { setIcon } from 'obsidian';
import type { FilterState } from './FilterSortManager';
import type { PlatformIcon as SimpleIcon } from '../../../constants/platform-icons';
import { TIMELINE_PLATFORM_IDS, TIMELINE_PLATFORM_LABELS } from '../../../constants/timelinePlatforms';
import { createSVGElement } from '../../../utils/dom-helpers';

type PlatformOption = {
  id: string;
  label: string;
};

/**
 * FilterPanel - Renders and manages filter UI
 * Single Responsibility: Filter panel UI and interactions
 */
export class FilterPanel {
  private panelEl: HTMLElement | null = null;
  private isOpen = false;
  private closeHandler: ((e: MouseEvent) => void) | null = null;
  private updatePlatformToggleState?: () => void;

  // Callbacks
  private onFilterChangeCallback?: (filter: Partial<FilterState>) => void;
  private onRerenderCallback?: () => void;
  private getFilterStateCallback?: () => FilterState;

  constructor(
    private getPlatformIcon: (platform: string) => SimpleIcon | null,
    private getLucideIconName: (platform: string) => string,
    private getPlatformCounts?: () => Record<string, number>
  ) {}

  /**
   * Toggle filter panel open/close
   */
  toggle(parent: HTMLElement, filterState: FilterState, updateFilterButton: () => void): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(parent, filterState, updateFilterButton);
    }
  }

  /**
   * Open filter panel
   */
  private open(parent: HTMLElement, filterState: FilterState, updateFilterButton: () => void): void {
    // Remove existing dropdowns
    parent.querySelectorAll('.sort-dropdown').forEach(el => el.remove());

    this.panelEl = parent.createDiv({ cls: 'filter-panel fp-panel' });
    this.panelEl.addClass('sa-absolute', 'sa-z-1000', 'sa-bg-primary', 'sa-border', 'sa-rounded-8', 'sa-p-16');

    this.renderPlatformFilters(this.panelEl, filterState, updateFilterButton);
    this.renderDivider(this.panelEl);
    this.renderLikeFilter(this.panelEl, filterState, updateFilterButton);
    this.renderCommentFilter(this.panelEl, filterState, updateFilterButton);
    this.renderSharedFilter(this.panelEl, filterState, updateFilterButton);
    this.renderSubscribedFilter(this.panelEl, filterState, updateFilterButton);
    this.renderArchiveFilter(this.panelEl, filterState, updateFilterButton);

    this.attachOutsideClickHandler();
    this.isOpen = true;
  }

  /**
   * Close filter panel
   */
  close(): void {
    if (this.closeHandler) {
      document.removeEventListener('click', this.closeHandler);
      this.closeHandler = null;
    }
    this.panelEl?.remove();
    this.panelEl = null;
    this.isOpen = false;
  }

  /**
   * Render platform filters
   */
  private renderPlatformFilters(panel: HTMLElement, filterState: FilterState, updateFilterButton: () => void): void {
    const platformSection = panel.createDiv();
    platformSection.addClass('sa-mb-16');

    const headerRow = platformSection.createDiv();
    headerRow.addClass('sa-flex-between', 'sa-gap-8', 'sa-mb-8');

    const platformLabel = headerRow.createEl('div', { text: 'Platforms' });
    platformLabel.addClass('sa-text-sm', 'sa-font-semibold', 'sa-text-muted', 'fp-label-uppercase');

    const toggleButton = headerRow.createDiv();
    toggleButton.addClass('sa-icon-32', 'sa-rounded-6', 'sa-clickable', 'sa-bg-transparent', 'sa-transition', 'sa-relative');

    const toggleIcon = toggleButton.createDiv();
    toggleIcon.addClass('sa-icon-16', 'sa-pointer-none');

    const setIconColor = (allSelected: boolean, isHover: boolean = false) => {
      toggleIcon.removeClass('sa-text-accent', 'sa-text-normal', 'sa-text-muted');
      if (allSelected) {
        toggleIcon.addClass('sa-text-accent');
      } else if (isHover) {
        toggleIcon.addClass('sa-text-normal');
      } else {
        toggleIcon.addClass('sa-text-muted');
      }
    };

    const updateToggleState = (isHover = false) => {
      const latestState = this.getFilterStateCallback?.() || filterState;
      const platformCounts = this.getPlatformCounts?.() || {};

      // Only consider platforms that have data
      const activePlatforms = TIMELINE_PLATFORM_IDS.filter(id => (platformCounts[id] || 0) > 0);
      const allActiveSelected = activePlatforms.length > 0 && activePlatforms.every(id => latestState.platforms.has(id));

      toggleButton.setAttribute('title', allActiveSelected ? 'Clear all platforms' : 'Select all platforms');
      setIconColor(allActiveSelected, isHover);
      setIcon(toggleIcon, allActiveSelected ? 'minus-square' : 'check-square');
    };
    this.updatePlatformToggleState = updateToggleState;
    updateToggleState();

    // Combined hover effect handler
    toggleButton.addEventListener('mouseenter', () => {
      toggleButton.addClass('fp-toggle-hover');
      updateToggleState(true);
    });
    toggleButton.addEventListener('mouseleave', () => {
      toggleButton.removeClass('fp-toggle-hover');
      updateToggleState(false);
    });

    toggleButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const latestState = this.getFilterStateCallback?.() || filterState;
      const platformCounts = this.getPlatformCounts?.() || {};

      // Only consider platforms that have data
      const activePlatforms = TIMELINE_PLATFORM_IDS.filter(id => (platformCounts[id] || 0) > 0);
      const allActiveSelected = activePlatforms.every(id => latestState.platforms.has(id));

      const newPlatforms = allActiveSelected
        ? new Set<string>()
        : new Set<string>(activePlatforms);

      this.onFilterChangeCallback?.({ platforms: newPlatforms });
      this.onRerenderCallback?.();
      updateFilterButton();
      const refreshedState = this.getFilterStateCallback?.() || filterState;
      this.rerenderPlatformsGrid(platformSection, refreshedState, newPlatforms, updateFilterButton);
      this.updatePlatformToggleState?.();
    });

    this.rerenderPlatformsGrid(platformSection, filterState, filterState.platforms, updateFilterButton);
  }

  private rerenderPlatformsGrid(
    section: HTMLElement,
    baseFilterState: FilterState,
    currentSelection: Set<string>,
    updateFilterButton: () => void
  ): void {
    section.querySelector('.platforms-grid')?.remove();
    const platformsGrid = section.createDiv({ cls: 'platforms-grid' });
    platformsGrid.addClass('sa-gap-8', 'fp-platforms-grid');

    // Get platform counts
    const platformCounts = this.getPlatformCounts?.() || {};

    // Sort platforms: active (has data) first, then inactive
    const sortedPlatforms = [...TIMELINE_PLATFORM_IDS].sort((a, b) => {
      const aCount = platformCounts[a] || 0;
      const bCount = platformCounts[b] || 0;

      // First sort by has data vs no data
      if (aCount > 0 && bCount === 0) return -1;
      if (aCount === 0 && bCount > 0) return 1;

      // Then sort by count (descending) for active platforms
      if (aCount > 0 && bCount > 0) {
        return bCount - aCount;
      }

      // Keep original order for inactive platforms
      return 0;
    });

    sortedPlatforms.forEach(platformId => {
      const latestState = this.getFilterStateCallback?.() || baseFilterState;
      this.renderPlatformCheckbox(
        platformsGrid,
        { id: platformId, label: TIMELINE_PLATFORM_LABELS[platformId] },
        { ...latestState, platforms: currentSelection },
        updateFilterButton
      );
    });
    this.updatePlatformToggleState?.();
  }

  /**
   * Render individual platform checkbox
   */
  private renderPlatformCheckbox(
    container: HTMLElement,
    platform: PlatformOption,
    filterState: FilterState,
    updateFilterButton: () => void
  ): void {
    const isSelected = filterState.platforms.has(platform.id);

    // Check if platform has any posts
    const platformCounts = this.getPlatformCounts?.() || {};
    const postCount = platformCounts[platform.id] || 0;
    const hasData = postCount > 0;
    const isDisabled = !hasData;

    const checkbox = container.createDiv();
    checkbox.addClass('sa-flex-row', 'sa-gap-8', 'sa-p-8', 'sa-rounded-6', 'sa-transition');
    if (isDisabled) {
      checkbox.addClass('sa-opacity-60', 'fp-disabled');
    } else {
      checkbox.addClass('sa-clickable');
    }
    if (isSelected) {
      checkbox.addClass('sa-bg-hover');
    }

    // Platform icon
    const iconWrapper = checkbox.createDiv();
    iconWrapper.addClass('sa-icon-16');
    if (isDisabled) {
      iconWrapper.addClass('sa-text-faint');
    } else {
      iconWrapper.addClass('sa-text-accent');
    }

    const icon = this.getPlatformIcon(platform.id);
    if (icon) {
      const svg = createSVGElement(icon, {
        fill: 'var(--text-accent)',
        width: '100%',
        height: '100%'
      });
      iconWrapper.appendChild(svg);
    } else {
      const lucideIconName = this.getLucideIconName(platform.id);
      setIcon(iconWrapper, lucideIconName);
    }

    const label = checkbox.createSpan({ text: platform.label });
    label.addClass('sa-text-base', 'sa-flex-1');
    if (isDisabled) {
      label.addClass('sa-text-faint');
    }

    const checkIcon = checkbox.createDiv();
    checkIcon.addClass('sa-icon-16');
    if (!isSelected) {
      checkIcon.addClass('sa-hidden');
    }
    setIcon(checkIcon, 'check');

    // Click handler
    checkbox.addEventListener('click', () => {
      // Ignore clicks on disabled platforms
      if (isDisabled) return;

      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newPlatforms = new Set(currentState.platforms);

      if (newPlatforms.has(platform.id)) {
        newPlatforms.delete(platform.id);
        checkbox.removeClass('sa-bg-hover');
        checkIcon.addClass('sa-hidden');
      } else {
        newPlatforms.add(platform.id);
        checkbox.addClass('sa-bg-hover');
        checkIcon.removeClass('sa-hidden');
      }

      this.onFilterChangeCallback?.({ platforms: newPlatforms });
      this.onRerenderCallback?.();
      updateFilterButton();
      this.updatePlatformToggleState?.();
    });

    // Hover handlers
    checkbox.addEventListener('mouseenter', () => {
      if (!filterState.platforms.has(platform.id) && !isDisabled) {
        checkbox.addClass('sa-bg-secondary');
      }
    });

    checkbox.addEventListener('mouseleave', () => {
      if (!filterState.platforms.has(platform.id) && !isDisabled) {
        checkbox.removeClass('sa-bg-secondary');
      }
    });
  }

  /**
   * Render divider
   */
  private renderDivider(panel: HTMLElement): void {
    const divider = panel.createDiv();
    divider.addClass('sa-border-b', 'fp-divider');
  }

  /**
   * Render like filter
   */
  private renderLikeFilter(panel: HTMLElement, filterState: FilterState, updateFilterButton: () => void): void {
    const likeOption = panel.createDiv();
    likeOption.addClass('sa-flex-row', 'sa-gap-8', 'sa-p-8', 'sa-rounded-6', 'sa-clickable', 'sa-transition', 'sa-mb-8');
    if (filterState.likedOnly) {
      likeOption.addClass('sa-bg-hover');
    }

    const likeIcon = likeOption.createDiv();
    likeIcon.addClass('sa-icon-16', 'sa-text-accent');
    setIcon(likeIcon, 'star');

    const likeLabel = likeOption.createSpan({ text: 'Liked posts only' });
    likeLabel.addClass('sa-text-base', 'sa-flex-1', 'sa-leading-16');

    const likeCheckIcon = likeOption.createDiv();
    likeCheckIcon.addClass('sa-icon-16', 'sa-flex-center');
    if (!filterState.likedOnly) {
      likeCheckIcon.addClass('sa-hidden');
    }
    setIcon(likeCheckIcon, 'check');

    likeOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newLikedOnly = !currentState.likedOnly;
      likeOption.toggleClass('sa-bg-hover', newLikedOnly);
      likeCheckIcon.toggleClass('sa-hidden', !newLikedOnly);

      this.onFilterChangeCallback?.({ likedOnly: newLikedOnly });
      this.onRerenderCallback?.();
      updateFilterButton();
    });
  }

  /**
   * Render comment filter
   */
  private renderCommentFilter(panel: HTMLElement, filterState: FilterState, updateFilterButton: () => void): void {
    const commentOption = panel.createDiv();
    commentOption.addClass('sa-flex-row', 'sa-gap-8', 'sa-p-8', 'sa-rounded-6', 'sa-clickable', 'sa-transition', 'sa-mb-8');
    if (filterState.commentedOnly) {
      commentOption.addClass('sa-bg-hover');
    }

    const commentIcon = commentOption.createDiv();
    commentIcon.addClass('sa-icon-16', 'sa-text-accent');
    setIcon(commentIcon, 'message-square');

    const commentLabel = commentOption.createSpan({ text: 'With notes only' });
    commentLabel.addClass('sa-text-base', 'sa-flex-1', 'sa-leading-16');

    const commentCheckIcon = commentOption.createDiv();
    commentCheckIcon.addClass('sa-icon-16', 'sa-flex-center');
    if (!filterState.commentedOnly) {
      commentCheckIcon.addClass('sa-hidden');
    }
    setIcon(commentCheckIcon, 'check');

    commentOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newCommentedOnly = !currentState.commentedOnly;
      commentOption.toggleClass('sa-bg-hover', newCommentedOnly);
      commentCheckIcon.toggleClass('sa-hidden', !newCommentedOnly);

      this.onFilterChangeCallback?.({ commentedOnly: newCommentedOnly });
      this.onRerenderCallback?.();
      updateFilterButton();
    });
  }

  /**
   * Render shared filter
   */
  private renderSharedFilter(panel: HTMLElement, filterState: FilterState, updateFilterButton: () => void): void {
    const sharedOption = panel.createDiv();
    sharedOption.addClass('sa-flex-row', 'sa-gap-8', 'sa-p-8', 'sa-rounded-6', 'sa-clickable', 'sa-transition', 'sa-mb-8');
    if (filterState.sharedOnly) {
      sharedOption.addClass('sa-bg-hover');
    }

    const sharedIcon = sharedOption.createDiv();
    sharedIcon.addClass('sa-icon-16', 'sa-text-accent');
    setIcon(sharedIcon, 'share-2');

    const sharedLabel = sharedOption.createSpan({ text: 'Shared posts only' });
    sharedLabel.addClass('sa-text-base', 'sa-flex-1', 'sa-leading-16');

    const sharedCheckIcon = sharedOption.createDiv();
    sharedCheckIcon.addClass('sa-icon-16', 'sa-flex-center');
    if (!filterState.sharedOnly) {
      sharedCheckIcon.addClass('sa-hidden');
    }
    setIcon(sharedCheckIcon, 'check');

    sharedOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newSharedOnly = !currentState.sharedOnly;
      sharedOption.toggleClass('sa-bg-hover', newSharedOnly);
      sharedCheckIcon.toggleClass('sa-hidden', !newSharedOnly);

      this.onFilterChangeCallback?.({ sharedOnly: newSharedOnly });
      this.onRerenderCallback?.();
      updateFilterButton();
    });
  }

  /**
   * Render subscribed filter
   */
  private renderSubscribedFilter(panel: HTMLElement, filterState: FilterState, updateFilterButton: () => void): void {
    const subscribedOption = panel.createDiv();
    subscribedOption.addClass('sa-flex-row', 'sa-gap-8', 'sa-p-8', 'sa-rounded-6', 'sa-clickable', 'sa-transition', 'sa-mb-8');
    if (filterState.subscribedOnly) {
      subscribedOption.addClass('sa-bg-hover');
    }

    const subscribedIcon = subscribedOption.createDiv();
    subscribedIcon.addClass('sa-icon-16', 'sa-text-accent');
    setIcon(subscribedIcon, 'bell');

    const subscribedLabel = subscribedOption.createSpan({ text: 'Subscribed posts only' });
    subscribedLabel.addClass('sa-text-base', 'sa-flex-1', 'sa-leading-16');

    const subscribedCheckIcon = subscribedOption.createDiv();
    subscribedCheckIcon.addClass('sa-icon-16', 'sa-flex-center');
    if (!filterState.subscribedOnly) {
      subscribedCheckIcon.addClass('sa-hidden');
    }
    setIcon(subscribedCheckIcon, 'check');

    subscribedOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newSubscribedOnly = !currentState.subscribedOnly;
      subscribedOption.toggleClass('sa-bg-hover', newSubscribedOnly);
      subscribedCheckIcon.toggleClass('sa-hidden', !newSubscribedOnly);

      this.onFilterChangeCallback?.({ subscribedOnly: newSubscribedOnly });
      this.onRerenderCallback?.();
      updateFilterButton();
    });
  }

  /**
   * Render archive filter
   */
  private renderArchiveFilter(panel: HTMLElement, filterState: FilterState, updateFilterButton: () => void): void {
    const archiveOption = panel.createDiv();
    archiveOption.addClass('sa-flex-row', 'sa-gap-8', 'sa-p-8', 'sa-rounded-6', 'sa-clickable', 'sa-transition');
    if (filterState.includeArchived) {
      archiveOption.addClass('sa-bg-hover');
    }

    const archiveIcon = archiveOption.createDiv();
    archiveIcon.addClass('sa-icon-16');
    setIcon(archiveIcon, 'archive');

    const archiveLabel = archiveOption.createSpan({ text: 'Include archived' });
    archiveLabel.addClass('sa-text-base', 'sa-flex-1', 'sa-leading-16');

    const archiveCheckIcon = archiveOption.createDiv();
    archiveCheckIcon.addClass('sa-icon-16', 'sa-flex-center');
    if (!filterState.includeArchived) {
      archiveCheckIcon.addClass('sa-hidden');
    }
    setIcon(archiveCheckIcon, 'check');

    archiveOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newIncludeArchived = !currentState.includeArchived;
      archiveOption.toggleClass('sa-bg-hover', newIncludeArchived);
      archiveCheckIcon.toggleClass('sa-hidden', !newIncludeArchived);

      this.onFilterChangeCallback?.({ includeArchived: newIncludeArchived });
      this.onRerenderCallback?.();
      updateFilterButton();
    });
  }

  /**
   * Attach outside click handler to close panel
   */
  private attachOutsideClickHandler(): void {
    this.closeHandler = (e: MouseEvent) => {
      if (this.panelEl && !this.panelEl.contains(e.target as Node) && !(e.target as HTMLElement).closest('.filter-panel')) {
        this.close();
      }
    };
    setTimeout(() => {
      // Guard: panel may have been closed during the timeout delay
      if (this.closeHandler && this.isOpen) {
        document.addEventListener('click', this.closeHandler);
      }
    }, 0);
  }

  /**
   * Set callback for filter changes
   */
  onFilterChange(callback: (filter: Partial<FilterState>) => void): void {
    this.onFilterChangeCallback = callback;
  }

  /**
   * Set callback for re-rendering
   */
  onRerender(callback: () => void): void {
    this.onRerenderCallback = callback;
  }

  /**
   * Set callback to get latest filter state
   */
  onGetFilterState(callback: () => FilterState): void {
    this.getFilterStateCallback = callback;
  }

  /**
   * Check if panel is currently open
   */
  get isOpened(): boolean {
    return this.isOpen;
  }
}
