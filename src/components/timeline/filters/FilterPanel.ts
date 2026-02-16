import { setIcon } from 'obsidian';
import type { FilterState } from './FilterSortManager';
import type { PlatformIcon as SimpleIcon } from '../../../constants/platform-icons';
import { TIMELINE_PLATFORM_IDS, TIMELINE_PLATFORM_LABELS } from '../../../constants/timelinePlatforms';

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

    this.panelEl = parent.createDiv({ cls: 'filter-panel' });
    this.panelEl.style.cssText = `
      position: absolute;
      top: 48px;
      left: 0;
      z-index: 1000;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 16px;
      min-width: 320px;
      max-width: 400px;
    `;

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
    platformSection.style.cssText = 'margin-bottom: 16px;';

    const headerRow = platformSection.createDiv();
    headerRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; gap: 8px;';

    const platformLabel = headerRow.createEl('div', { text: 'Platforms' });
    platformLabel.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;';

    const toggleButton = headerRow.createDiv();
    toggleButton.style.cssText = `
      width: 32px;
      height: 32px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      background: transparent;
      transition: all 0.2s;
      position: relative;
    `;

    const toggleIcon = toggleButton.createDiv();
    toggleIcon.style.cssText = `
      width: 18px;
      height: 18px;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const setIconColor = (allSelected: boolean, isHover: boolean = false) => {
      if (allSelected) {
        toggleIcon.style.color = 'var(--interactive-accent)';
      } else if (isHover) {
        toggleIcon.style.color = 'var(--text-normal)';
      } else {
        toggleIcon.style.color = 'var(--text-muted)';
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
      toggleButton.style.background = 'rgba(var(--mono-rgb-100), 0.05)';
      updateToggleState(true);
    });
    toggleButton.addEventListener('mouseleave', () => {
      toggleButton.style.background = 'transparent';
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
    platformsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;';

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
    checkbox.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      cursor: ${isDisabled ? 'not-allowed' : 'pointer'};
      transition: all 0.2s;
      background: ${isSelected ? 'var(--background-modifier-hover)' : 'transparent'};
      opacity: ${isDisabled ? '0.4' : '1'};
    `;

    // Platform icon
    const iconWrapper = checkbox.createDiv();
    iconWrapper.style.cssText = `width: 18px; height: 18px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: ${isDisabled ? 'var(--text-faint)' : 'var(--text-accent)'};`;

    const icon = this.getPlatformIcon(platform.id);
    if (icon) {
      iconWrapper.innerHTML = `
        <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="fill: var(--text-accent); width: 100%; height: 100%;">
          <title>${icon.title}</title>
          <path d="${icon.path}"/>
        </svg>
      `;
    } else {
      const lucideIconName = this.getLucideIconName(platform.id);
      setIcon(iconWrapper, lucideIconName);
    }

    const label = checkbox.createSpan({ text: platform.label });
    label.style.cssText = `font-size: 13px; flex: 1; color: ${isDisabled ? 'var(--text-faint)' : 'inherit'};`;

    const checkIcon = checkbox.createDiv();
    checkIcon.style.cssText = `width: 16px; height: 16px; display: ${isSelected ? 'block' : 'none'};`;
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
        checkbox.style.background = 'transparent';
        checkIcon.style.display = 'none';
      } else {
        newPlatforms.add(platform.id);
        checkbox.style.background = 'var(--background-modifier-hover)';
        checkIcon.style.display = 'block';
      }

      this.onFilterChangeCallback?.({ platforms: newPlatforms });
      this.onRerenderCallback?.();
      updateFilterButton();
      this.updatePlatformToggleState?.();
    });

    // Hover handlers
    checkbox.addEventListener('mouseenter', () => {
      if (!filterState.platforms.has(platform.id) && !isDisabled) {
        checkbox.style.background = 'var(--background-secondary)';
      }
    });

    checkbox.addEventListener('mouseleave', () => {
      if (!filterState.platforms.has(platform.id) && !isDisabled) {
        checkbox.style.background = 'transparent';
      }
    });
  }

  /**
   * Render divider
   */
  private renderDivider(panel: HTMLElement): void {
    const divider = panel.createDiv();
    divider.style.cssText = 'height: 1px; background: var(--background-modifier-border); margin: 16px 0;';
  }

  /**
   * Render like filter
   */
  private renderLikeFilter(panel: HTMLElement, filterState: FilterState, updateFilterButton: () => void): void {
    const likeOption = panel.createDiv();
    likeOption.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 8px;
      background: ${filterState.likedOnly ? 'var(--background-modifier-hover)' : 'transparent'};
    `;

    const likeIcon = likeOption.createDiv();
    likeIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; flex-shrink: 0; color: var(--text-accent);';
    setIcon(likeIcon, 'star');

    const likeLabel = likeOption.createSpan({ text: 'Liked posts only' });
    likeLabel.style.cssText = 'font-size: 13px; flex: 1; line-height: 16px;';

    const likeCheckIcon = likeOption.createDiv();
    likeCheckIcon.style.cssText = `width: 16px; height: 16px; flex-shrink: 0; display: ${filterState.likedOnly ? 'flex' : 'none'}; align-items: center;`;
    setIcon(likeCheckIcon, 'check');

    likeOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newLikedOnly = !currentState.likedOnly;
      likeOption.style.background = newLikedOnly ? 'var(--background-modifier-hover)' : 'transparent';
      likeCheckIcon.style.display = newLikedOnly ? 'flex' : 'none';

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
    commentOption.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 8px;
      background: ${filterState.commentedOnly ? 'var(--background-modifier-hover)' : 'transparent'};
    `;

    const commentIcon = commentOption.createDiv();
    commentIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; flex-shrink: 0; color: var(--text-accent);';
    setIcon(commentIcon, 'message-square');

    const commentLabel = commentOption.createSpan({ text: 'With notes only' });
    commentLabel.style.cssText = 'font-size: 13px; flex: 1; line-height: 16px;';

    const commentCheckIcon = commentOption.createDiv();
    commentCheckIcon.style.cssText = `width: 16px; height: 16px; flex-shrink: 0; display: ${filterState.commentedOnly ? 'flex' : 'none'}; align-items: center;`;
    setIcon(commentCheckIcon, 'check');

    commentOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newCommentedOnly = !currentState.commentedOnly;
      commentOption.style.background = newCommentedOnly ? 'var(--background-modifier-hover)' : 'transparent';
      commentCheckIcon.style.display = newCommentedOnly ? 'flex' : 'none';

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
    sharedOption.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 8px;
      background: ${filterState.sharedOnly ? 'var(--background-modifier-hover)' : 'transparent'};
    `;

    const sharedIcon = sharedOption.createDiv();
    sharedIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; flex-shrink: 0; color: var(--text-accent);';
    setIcon(sharedIcon, 'share-2');

    const sharedLabel = sharedOption.createSpan({ text: 'Shared posts only' });
    sharedLabel.style.cssText = 'font-size: 13px; flex: 1; line-height: 16px;';

    const sharedCheckIcon = sharedOption.createDiv();
    sharedCheckIcon.style.cssText = `width: 16px; height: 16px; flex-shrink: 0; display: ${filterState.sharedOnly ? 'flex' : 'none'}; align-items: center;`;
    setIcon(sharedCheckIcon, 'check');

    sharedOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newSharedOnly = !currentState.sharedOnly;
      sharedOption.style.background = newSharedOnly ? 'var(--background-modifier-hover)' : 'transparent';
      sharedCheckIcon.style.display = newSharedOnly ? 'flex' : 'none';

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
    subscribedOption.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 8px;
      background: ${filterState.subscribedOnly ? 'var(--background-modifier-hover)' : 'transparent'};
    `;

    const subscribedIcon = subscribedOption.createDiv();
    subscribedIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; flex-shrink: 0; color: var(--text-accent);';
    setIcon(subscribedIcon, 'bell');

    const subscribedLabel = subscribedOption.createSpan({ text: 'Subscribed posts only' });
    subscribedLabel.style.cssText = 'font-size: 13px; flex: 1; line-height: 16px;';

    const subscribedCheckIcon = subscribedOption.createDiv();
    subscribedCheckIcon.style.cssText = `width: 16px; height: 16px; flex-shrink: 0; display: ${filterState.subscribedOnly ? 'flex' : 'none'}; align-items: center;`;
    setIcon(subscribedCheckIcon, 'check');

    subscribedOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newSubscribedOnly = !currentState.subscribedOnly;
      subscribedOption.style.background = newSubscribedOnly ? 'var(--background-modifier-hover)' : 'transparent';
      subscribedCheckIcon.style.display = newSubscribedOnly ? 'flex' : 'none';

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
    archiveOption.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      background: ${filterState.includeArchived ? 'var(--background-modifier-hover)' : 'transparent'};
    `;

    const archiveIcon = archiveOption.createDiv();
    archiveIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; flex-shrink: 0;';
    setIcon(archiveIcon, 'archive');

    const archiveLabel = archiveOption.createSpan({ text: 'Include archived' });
    archiveLabel.style.cssText = 'font-size: 13px; flex: 1; line-height: 16px;';

    const archiveCheckIcon = archiveOption.createDiv();
    archiveCheckIcon.style.cssText = `width: 16px; height: 16px; flex-shrink: 0; display: ${filterState.includeArchived ? 'flex' : 'none'}; align-items: center;`;
    setIcon(archiveCheckIcon, 'check');

    archiveOption.addEventListener('click', () => {
      // Get latest filter state
      const currentState = this.getFilterStateCallback?.() || filterState;
      const newIncludeArchived = !currentState.includeArchived;
      archiveOption.style.background = newIncludeArchived ? 'var(--background-modifier-hover)' : 'transparent';
      archiveCheckIcon.style.display = newIncludeArchived ? 'flex' : 'none';

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
