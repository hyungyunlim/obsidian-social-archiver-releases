/**
 * AuthorDetailContainer - Pure TypeScript orchestrator for Author Detail View
 *
 * Renders author posts using the SAME PostCardRenderer as the main timeline,
 * ensuring identical post card appearance. Composes:
 *   - AuthorProfileHeader (Svelte component, mounted at top)
 *   - Toolbar (search, sort, view toggle) built with pure DOM APIs
 *   - Post feed rendered with PostCardRenderer (timeline) / GalleryViewRenderer (gallery)
 *
 * Follows the same patterns as TimelineContainer.ts for renderer instantiation,
 * post loading, and feed rendering.
 *
 * The parent AuthorDetailView only handles:
 * - Obsidian ItemView lifecycle (onOpen/onClose)
 * - State persistence (getState/setState)
 * - Vault event listeners (debounced, delegating to reload())
 */

import { setIcon, TFile, Platform as ObsidianPlatform, type Vault, type App } from 'obsidian';
import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import type { PostData, Platform } from '../../types/post';
import type SocialArchiverPlugin from '../../main';
import type {
  AuthorCatalogEntry,
  AuthorSubscribeOptions,
} from '../../types/author-catalog';
import { PostIndexService } from '../../services/PostIndexService';
import { AuthorDetailService } from '../../services/AuthorDetailService';
import { getAuthorCatalogStore, type AuthorCatalogStoreAPI } from '../../services/AuthorCatalogStore';
import { PostDataParser } from '../timeline/parsers/PostDataParser';
import { MediaGalleryRenderer } from '../timeline/renderers/MediaGalleryRenderer';
import { CommentRenderer } from '../timeline/renderers/CommentRenderer';
import { YouTubeEmbedRenderer } from '../timeline/renderers/YouTubeEmbedRenderer';
import { LinkPreviewRenderer } from '../timeline/renderers/LinkPreviewRenderer';
import { PostCardRenderer } from '../timeline/renderers/PostCardRenderer';
import { GalleryViewRenderer } from '../timeline/renderers/GalleryViewRenderer';
import { YouTubePlayerController } from '../timeline/controllers/YouTubePlayerController';
import { FilterSortManager } from '../timeline/filters/FilterSortManager';
import { FilterPanel } from '../timeline/filters/FilterPanel';
import { SortDropdown } from '../timeline/filters/SortDropdown';
import { TagChipBar } from '../timeline/filters/TagChipBar';
import { ReaderModeOverlay, type ReaderModeContext } from '../timeline/reader/ReaderModeOverlay';
import {
  getPlatformSimpleIcon as getIconServiceSimpleIcon,
  getPlatformLucideIcon as getIconServiceLucideIcon
} from '../../services/IconService';
import type { TagWithCount } from '../../types/tag';
import AuthorProfileHeader from './AuthorProfileHeader.svelte';

// ============================================================================
// Types
// ============================================================================

export interface AuthorDetailContainerProps {
  vault: Vault;
  app: App;
  plugin: SocialArchiverPlugin;
  archivePath: string;
  /** Initial author (may be undefined on workspace restore before store is populated) */
  author?: AuthorCatalogEntry;
  /** Navigate back to timeline */
  onGoBack?: () => void;
  /** Navigate to another author detail view */
  onViewAuthor?: (author: AuthorCatalogEntry) => void;
  /** Subscription callbacks (forwarded to AuthorProfileHeader) */
  onSubscribe?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<void>;
  onUpdateSubscription?: (author: AuthorCatalogEntry, options: AuthorSubscribeOptions) => Promise<void>;
  onUnsubscribe?: (author: AuthorCatalogEntry) => Promise<void>;
  onManualRun?: (author: AuthorCatalogEntry) => Promise<void>;
  onEditSubscription?: (author: AuthorCatalogEntry) => void;
  onOpenProfile?: (author: AuthorCatalogEntry) => void;
  onOpenNote?: (author: AuthorCatalogEntry) => void;
  onCreateNote?: (author: AuthorCatalogEntry) => void;
}

// ============================================================================
// AuthorDetailContainer
// ============================================================================

export class AuthorDetailContainer {
  // Container & props
  private readonly target: HTMLElement;
  private contentRoot: HTMLElement | null = null;
  private readonly props: AuthorDetailContainerProps;
  private vault: Vault;
  private app: App;
  private plugin: SocialArchiverPlugin;
  private archivePath: string;

  // Current author state
  private currentAuthor: AuthorCatalogEntry | undefined;

  // Data services
  private postIndexService: PostIndexService | null = null;
  private detailService: AuthorDetailService | null = null;
  private postDataParser: PostDataParser;

  // Renderers (same as TimelineContainer)
  private mediaGalleryRenderer: MediaGalleryRenderer;
  private commentRenderer: CommentRenderer;
  private youtubeEmbedRenderer: YouTubeEmbedRenderer;
  private linkPreviewRenderer: LinkPreviewRenderer;
  private postCardRenderer: PostCardRenderer;
  private youtubeControllers: Map<string, YouTubePlayerController> = new Map();

  // Filter/sort (reuses timeline components)
  private filterSortManager: FilterSortManager;
  private filterPanel: FilterPanel;
  private sortDropdown: SortDropdown;

  // Gallery view
  private galleryRenderer: GalleryViewRenderer | null = null;

  // Tag chip bar (reuses timeline component)
  private tagChipBar: TagChipBar;

  // Reader mode overlay
  private readerModeOverlay: ReaderModeOverlay | null = null;

  // Svelte component (AuthorProfileHeader)
  private headerComponent: ReturnType<typeof mount> | null = null;
  private headerTarget: HTMLElement | null = null;

  // Store subscription
  private storeUnsubscribe: (() => void) | null = null;

  // Post data
  private posts: PostData[] = [];
  private filteredPosts: PostData[] = [];

  // Local UI state
  private searchQuery = '';
  private viewMode: 'timeline' | 'gallery' = 'timeline';
  private isLoading = true;

  // DOM references
  private toolbarEl: HTMLElement | null = null;
  private feedWrapper: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private searchContainer: HTMLElement | null = null;
  // postCountEl removed — post count not shown in toolbar

  // Toolbar state
  private searchExpanded = false;
  private searchTimeout: number | null = null;
  private updateSearchButtonState: (() => void) | undefined;
  private updateFilterButtonState: (() => void) | undefined;

  // Render generation counter to detect stale async renders
  private renderGeneration = 0;

  constructor(target: HTMLElement, props: AuthorDetailContainerProps) {
    this.target = target;
    this.props = props;
    this.vault = props.vault;
    this.app = props.app;
    this.plugin = props.plugin;
    this.archivePath = props.archivePath;
    this.currentAuthor = props.author;

    // Initialize data services
    const pluginDir = `${props.app.vault.configDir}/plugins/social-archiver`;
    this.postIndexService = new PostIndexService(props.vault, props.app, pluginDir);
    const store = this.getStore();
    if (store && this.postIndexService) {
      this.detailService = new AuthorDetailService(store, this.postIndexService);
    }

    // Initialize PostDataParser
    this.postDataParser = new PostDataParser(this.vault, this.app);

    // Initialize renderers (same pattern as TimelineContainer lines 337-381)
    this.mediaGalleryRenderer = new MediaGalleryRenderer(
      (path: string) => {
        if (path.startsWith('http://') || path.startsWith('https://')) {
          return path;
        }
        let resolvedPath = path;
        if (!path.includes('/')) {
          const file = this.app.metadataCache.getFirstLinkpathDest(path, '');
          if (file) {
            resolvedPath = file.path;
          }
        }
        return this.app.vault.adapter.getResourcePath(resolvedPath);
      }
    );

    this.commentRenderer = new CommentRenderer();
    this.youtubeEmbedRenderer = new YouTubeEmbedRenderer();

    const workerUrl = this.getWorkerUrl();
    this.linkPreviewRenderer = new LinkPreviewRenderer(workerUrl);

    // Initialize PostCardRenderer (exact same as TimelineContainer lines 372-381)
    this.postCardRenderer = new PostCardRenderer(
      this.vault,
      this.app,
      this.plugin,
      this.mediaGalleryRenderer,
      this.commentRenderer,
      this.youtubeEmbedRenderer,
      this.linkPreviewRenderer,
      this.youtubeControllers
    );

    // Initialize FilterSortManager (reuse timeline component for sort logic)
    this.filterSortManager = new FilterSortManager(
      { includeArchived: true },
      {
        by: this.plugin.settings.timelineSortBy,
        order: this.plugin.settings.timelineSortOrder,
      }
    );

    // Initialize FilterPanel (reuse timeline component)
    this.filterPanel = new FilterPanel(
      (platform) => getIconServiceSimpleIcon(platform),
      (platform) => getIconServiceLucideIcon(platform)
    );
    this.filterPanel.onFilterChange((filter) => {
      this.filterSortManager.updateFilter(filter);
      this.applyFiltersAndRenderFeed();
    });
    this.filterPanel.onRerender(() => this.rerenderToolbar());

    // Initialize SortDropdown (reuse timeline component for sort UI)
    this.sortDropdown = new SortDropdown(this.plugin);
    this.sortDropdown.onSortChange((sort) => {
      this.filterSortManager.updateSort(sort);
      this.applyFiltersAndRenderFeed();
    });
    this.sortDropdown.onRerender(() => this.rerenderToolbar());

    // Initialize TagChipBar
    this.tagChipBar = new TagChipBar((tagName: string | null) => {
      if (tagName) {
        this.filterSortManager.updateFilter({ selectedTags: new Set([tagName]) });
      } else {
        this.filterSortManager.updateFilter({ selectedTags: new Set() });
      }
      this.applyFiltersAndRenderFeed();
    });

    // Wire PostCardRenderer callbacks
    this.setupRendererCallbacks();

    // Build the initial DOM structure (must come before store subscription
    // to avoid handleStoreUpdate running before headerTarget exists)
    this.renderShell();

    // Subscribe to AuthorCatalogStore for reactive header updates
    // (after renderShell so the initial synchronous callback doesn't
    // try to remount a header that doesn't exist yet)
    this.subscribeToStore();

    // Load data
    void this.initialLoad();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Set or switch the displayed author.
   * If the same author is already displayed, refreshes post data.
   * If a different author is passed, does a full reload.
   */
  public setAuthor(author: AuthorCatalogEntry): void {
    const isSameAuthor =
      this.currentAuthor?.authorUrl === author.authorUrl &&
      this.currentAuthor?.platform === author.platform;

    this.currentAuthor = author;

    // Always remount header to reflect latest author data
    // (even for same author — store data may have been stale on initial mount)
    this.remountProfileHeader();

    if (isSameAuthor) {
      void this.reload();
    } else {
      // Reset search/filters for new author
      this.searchQuery = '';
      if (this.searchInput) {
        this.searchInput.value = '';
      }
      if (this.searchExpanded) {
        this.toggleSearchBar();
        this.updateSearchButtonState?.();
      }

      void this.loadPosts();
    }
  }

  /**
   * Reload post data and re-render the feed.
   * Called by the parent View on vault file changes.
   */
  public async reload(): Promise<void> {
    // Refresh author from store
    if (this.currentAuthor) {
      const latestAuthor = this.findAuthorInStore(
        this.currentAuthor.authorUrl,
        this.currentAuthor.platform
      );
      if (latestAuthor) {
        this.currentAuthor = latestAuthor;
      }
    }

    await this.loadPosts();
  }

  /**
   * Clean up all resources.
   * Called by the parent View in onClose().
   */
  public destroy(): void {
    // Unsubscribe from store
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }

    // Unmount Svelte header
    this.unmountProfileHeader();

    // Clean up YouTube controllers
    this.youtubeControllers.clear();
    this.youtubeEmbedRenderer.disconnectAllObservers();

    // Clean up renderers and UI components
    this.postCardRenderer.unload();
    this.filterPanel.close();
    this.sortDropdown.close();
    this.tagChipBar.destroy();
    if (this.readerModeOverlay?.isActive) {
      this.readerModeOverlay.close();
    }
    this.readerModeOverlay = null;
    this.galleryRenderer = null;

    // Clear DOM
    this.target.empty();

    // Clear references
    this.postIndexService = null;
    this.detailService = null;
    this.currentAuthor = undefined;
    this.posts = [];
    this.filteredPosts = [];
    this.contentRoot = null;
    this.feedWrapper = null;
    this.toolbarEl = null;
    this.searchInput = null;
    this.searchContainer = null;
    // postCountEl removed
  }

  // --------------------------------------------------------------------------
  // Private: Shell rendering (one-time DOM structure)
  // --------------------------------------------------------------------------

  /**
   * Build the full container DOM structure.
   * Called once in constructor. Content is updated in-place afterward.
   */
  private renderShell(): void {
    this.target.empty();
    this.target.addClass('author-detail-ts-container');
    const contentRoot = this.target.createDiv({ cls: 'author-detail-content' });
    this.contentRoot = contentRoot;

    // 1. Profile header (Svelte component)
    this.mountProfileHeader();

    // 2. Toolbar (search + filter + sort + view toggle)
    this.renderToolbar();

    // 3. Tag chip bar (rendered after posts load, placeholder position)
    // Will be populated in renderTagChipBar() after loadPosts()

    // 4. Feed wrapper (posts rendered here)
    this.feedWrapper = contentRoot.createDiv({ cls: 'author-detail-feed-wrapper' });
  }

  // --------------------------------------------------------------------------
  // Private: Profile header (Svelte mount/unmount)
  // --------------------------------------------------------------------------

  private mountProfileHeader(): void {
    const contentRoot = this.contentRoot;
    if (!contentRoot) return;

    this.headerTarget = contentRoot.createDiv({
      cls: 'author-detail-profile-header-target author-detail-pane-content',
    });

    if (!this.currentAuthor) return;

    this.headerComponent = mount(AuthorProfileHeader, {
      target: this.headerTarget,
      props: this.buildProfileHeaderProps(),
    });
  }

  private remountProfileHeader(): void {
    this.unmountProfileHeader();

    // Remove old target
    if (this.headerTarget?.isConnected) {
      this.headerTarget.remove();
    }

    const contentRoot = this.contentRoot;
    if (!contentRoot) return;

    // Re-create at top (before toolbar)
    const firstChild = contentRoot.firstChild;
    this.headerTarget = contentRoot.createDiv({
      cls: 'author-detail-profile-header-target author-detail-pane-content',
    });
    if (firstChild && firstChild !== this.headerTarget) {
      contentRoot.insertBefore(this.headerTarget, firstChild);
    }

    if (!this.currentAuthor) return;

    this.headerComponent = mount(AuthorProfileHeader, {
      target: this.headerTarget,
      props: this.buildProfileHeaderProps(),
    });
  }

  private unmountProfileHeader(): void {
    if (this.headerComponent) {
      try {
        unmount(this.headerComponent);
      } catch {
        // Ignore unmount errors
      }
      this.headerComponent = null;
    }
  }

  private buildProfileHeaderProps(): Record<string, unknown> {
    return {
      app: this.app,
      author: this.currentAuthor,
      onGoBack: this.props.onGoBack,
      onOpenProfile: this.props.onOpenProfile ?? ((a: AuthorCatalogEntry) => {
        if (a.authorUrl) {
          window.open(a.authorUrl, '_blank');
        }
      }),
      onSubscribe: this.props.onSubscribe,
      onUpdateSubscription: this.props.onUpdateSubscription,
      onUnsubscribe: this.props.onUnsubscribe,
      onManualRun: this.props.onManualRun,
      onEditSubscription: this.props.onEditSubscription,
      onOpenNote: this.props.onOpenNote,
      onCreateNote: this.props.onCreateNote,
    };
  }

  // --------------------------------------------------------------------------
  // Private: Toolbar
  // --------------------------------------------------------------------------

  /**
   * Render toolbar — follows exact same pattern as TimelineContainer.renderHeader()
   * using identical CSS classes for visual consistency.
   */
  private renderToolbar(): void {
    const contentRoot = this.contentRoot;
    if (!contentRoot) return;

    const headerWrapper = contentRoot.createDiv();
    headerWrapper.addClass('author-detail-toolbar', 'author-detail-pane-content', 'sa-mb-4');
    this.toolbarEl = headerWrapper;

    // Remove stuck hover/focus state on toolbar buttons after click/tap
    // Skip when filter panel or search is open (active state should persist)
    const clearHoverStates = () => {
      window.setTimeout(() => {
        if (this.filterPanel.isOpened || this.searchExpanded || this.sortDropdown.isOpened) return;
        headerWrapper.querySelectorAll('.sa-bg-hover').forEach((el) => {
          el.removeClass('sa-bg-hover');
          el.addClass('sa-bg-transparent');
        });
        if (document.activeElement instanceof HTMLElement && document.activeElement !== this.searchInput) {
          document.activeElement.blur();
        }
      }, 150);
    };
    headerWrapper.addEventListener('click', clearHoverStates);

    const header = headerWrapper.createDiv();
    header.addClass('sa-flex-between', 'sa-gap-12', 'sa-relative');

    // Left side: Search, Filter, Sort
    const leftButtons = header.createDiv();
    leftButtons.addClass('sa-flex-row', 'sa-gap-8');

    this.renderSearchButton(leftButtons);
    this.renderFilterButton(leftButtons, header);

    const sortState = this.filterSortManager.getSortState();
    this.sortDropdown.renderSortControls(leftButtons, sortState);

    // Right side: View toggle
    const rightButtons = header.createDiv();
    rightButtons.addClass('sa-flex-row', 'sa-gap-4');

    this.renderViewSwitcherButton(rightButtons);

    // Search bar (below header, collapsible)
    this.renderSearchBar(headerWrapper);
  }

  /**
   * Rebuild the toolbar to reflect new sort/view state.
   * Called by SortDropdown.onRerender callback.
   */
  private rerenderToolbar(): void {
    if (!this.toolbarEl) return;

    // Preserve search bar state
    const wasSearchExpanded = this.searchExpanded;
    const currentSearchValue = this.searchInput?.value ?? '';

    // Remove old toolbar
    const toolbarParent = this.toolbarEl.parentElement;
    const toolbarNextSibling = this.toolbarEl.nextSibling;
    this.toolbarEl.remove();
    this.toolbarEl = null;
    this.searchInput = null;
    this.searchContainer = null;

    // Re-render toolbar
    // We need to insert before the feed wrapper, not at the end
    if (toolbarParent && toolbarNextSibling) {
      // Create a temporary container to hold the new toolbar
      const tempDiv = document.createElement('div');
      toolbarParent.insertBefore(tempDiv, toolbarNextSibling);

      // Now render toolbar into the target, which will place it at the end
      this.renderToolbar();

      // Move the newly created toolbar before the feed wrapper
      if (this.toolbarEl && tempDiv.parentElement) {
        toolbarParent.insertBefore(this.toolbarEl, tempDiv);
        tempDiv.remove();
      }
    } else {
      this.renderToolbar();
    }

    // Restore search bar state and search text.
    // renderToolbar() re-creates this.searchInput, so we need to restore state.
    this.restoreSearchState(wasSearchExpanded, currentSearchValue);
  }

  private renderSearchButton(parent: HTMLElement): void {
    const isMobile = ObsidianPlatform.isMobile;
    const searchBtn = parent.createDiv();
    searchBtn.addClass('sa-flex-row', 'sa-gap-6', 'sa-rounded-8', 'sa-bg-transparent',
      'sa-clickable', 'sa-transition', 'sa-flex-shrink-0', 'sa-text-base',
      'sa-text-muted', 'sa-flex-center');
    searchBtn.setCssProps({ '--sa-height': '40px' });
    searchBtn.addClass('sa-dynamic-height');
    if (isMobile) {
      searchBtn.setCssProps({ '--sa-width': '40px' });
      searchBtn.addClass('sa-dynamic-width', 'sa-p-0');
    } else {
      searchBtn.addClass('sa-px-12', 'tc-btn-auto-width');
    }
    searchBtn.setAttribute('title', 'Search posts');

    const searchIcon = searchBtn.createDiv();
    searchIcon.addClass('sa-icon-16', 'sa-transition-color');
    setIcon(searchIcon, 'search');

    const searchText = searchBtn.createSpan({ text: 'Search' });
    searchText.addClass('sa-font-medium', 'tc-btn-text');
    if (isMobile) searchText.addClass('sa-hidden');

    const updateButtonState = () => {
      const hasQuery = this.searchInput && this.searchInput.value.trim().length > 0;
      if (hasQuery || this.searchExpanded) {
        searchBtn.setCssProps({ '--sa-bg': 'var(--interactive-accent)', '--sa-color': 'var(--text-on-accent)' });
        searchBtn.addClass('sa-dynamic-bg', 'sa-dynamic-color');
        searchIcon.setCssProps({ '--sa-color': 'var(--text-on-accent)' });
        searchIcon.addClass('sa-dynamic-color');
      } else {
        searchBtn.removeClass('sa-dynamic-bg');
        searchBtn.addClass('sa-bg-transparent');
        searchBtn.setCssProps({ '--sa-color': 'var(--text-muted)' });
        searchBtn.addClass('sa-dynamic-color');
        searchIcon.setCssProps({ '--sa-color': 'var(--text-muted)' });
        searchIcon.addClass('sa-dynamic-color');
      }
    };

    searchBtn.addEventListener('mouseenter', () => {
      if (!this.searchExpanded) {
        searchBtn.removeClass('sa-bg-transparent');
        searchBtn.addClass('sa-bg-hover');
      }
    });
    searchBtn.addEventListener('mouseleave', () => updateButtonState());
    searchBtn.addEventListener('click', () => {
      this.toggleSearchBar();
      updateButtonState();
    });

    this.updateSearchButtonState = updateButtonState;
  }

  /**
   * Render filter button — opens FilterPanel (same as TimelineContainer.renderFilterButton)
   */
  private renderFilterButton(parent: HTMLElement, header: HTMLElement): void {
    const filterBtn = parent.createDiv();
    const isMobile = ObsidianPlatform.isMobile;
    filterBtn.addClass('sa-flex-row', 'sa-gap-6', 'sa-rounded-8', 'sa-bg-transparent',
      'sa-clickable', 'sa-transition', 'sa-flex-shrink-0', 'sa-text-base',
      'sa-text-muted', 'sa-flex-center');
    filterBtn.setCssProps({ '--sa-height': '40px' });
    filterBtn.addClass('sa-dynamic-height');
    if (isMobile) {
      filterBtn.setCssProps({ '--sa-width': '40px' });
      filterBtn.addClass('sa-dynamic-width', 'sa-p-0');
    } else {
      filterBtn.addClass('sa-px-12', 'tc-btn-auto-width');
    }
    filterBtn.setAttribute('title', 'Filter posts');

    const filterIcon = filterBtn.createDiv();
    filterIcon.addClass('sa-icon-16', 'sa-transition-color');
    setIcon(filterIcon, 'filter');

    const filterText = filterBtn.createSpan({ text: 'Filter' });
    filterText.addClass('sa-font-medium', 'tc-btn-text');
    if (isMobile) filterText.addClass('sa-hidden');

    const updateFilterButton = () => {
      const hasActiveFilters = this.filterSortManager.hasActiveFilters();
      if (hasActiveFilters) {
        filterBtn.setCssProps({ '--sa-bg': 'var(--interactive-accent)', '--sa-color': 'var(--text-on-accent)' });
        filterBtn.addClass('sa-dynamic-bg', 'sa-dynamic-color');
        filterIcon.setCssProps({ '--sa-color': 'var(--text-on-accent)' });
        filterIcon.addClass('sa-dynamic-color');
      } else {
        filterBtn.removeClass('sa-dynamic-bg');
        filterBtn.addClass('sa-bg-transparent');
        filterBtn.setCssProps({ '--sa-color': 'var(--text-muted)' });
        filterBtn.addClass('sa-dynamic-color');
        filterIcon.setCssProps({ '--sa-color': 'var(--text-muted)' });
        filterIcon.addClass('sa-dynamic-color');
      }
    };
    updateFilterButton();
    this.updateFilterButtonState = updateFilterButton;

    filterBtn.addEventListener('mouseenter', () => {
      if (!this.filterPanel.isOpened) {
        filterBtn.removeClass('sa-bg-transparent');
        filterBtn.addClass('sa-bg-hover');
      }
    });
    filterBtn.addEventListener('mouseleave', () => {
      if (!this.filterPanel.isOpened) {
        updateFilterButton();
      }
    });
    filterBtn.addEventListener('click', () => {
      const filterState = this.filterSortManager.getFilterState();
      this.filterPanel.toggle(header, filterState, updateFilterButton);
    });
  }

  /**
   * Render view switcher button — toggles between timeline and gallery views.
   * Uses the same icon pattern as TimelineContainer.renderViewSwitcherButton().
   * Icons: layout-grid (timeline mode, click to switch to gallery) / list (gallery mode, click to switch to timeline)
   */
  private renderViewSwitcherButton(parent: HTMLElement): void {
    const viewSwitcherBtn = parent.createDiv();
    viewSwitcherBtn.addClass('sa-action-btn');

    const viewIcon = viewSwitcherBtn.createDiv();
    viewIcon.addClass('sa-icon-16', 'sa-text-muted', 'sa-transition-color');

    const updateViewButton = () => {
      const isGallery = this.viewMode === 'gallery';
      setIcon(viewIcon, isGallery ? 'list' : 'layout-grid');
      viewSwitcherBtn.setAttribute('title', isGallery ? 'Switch to Timeline' : 'Switch to Media Gallery');
    };
    updateViewButton();

    viewSwitcherBtn.addEventListener('mouseenter', () => {
      viewSwitcherBtn.removeClass('sa-bg-transparent');
      viewSwitcherBtn.addClass('sa-bg-hover');
      viewIcon.removeClass('sa-text-muted');
      viewIcon.addClass('sa-text-accent');
    });

    viewSwitcherBtn.addEventListener('mouseleave', () => {
      viewSwitcherBtn.removeClass('sa-bg-hover');
      viewSwitcherBtn.addClass('sa-bg-transparent');
      viewIcon.removeClass('sa-text-accent');
      viewIcon.addClass('sa-text-muted');
    });

    viewSwitcherBtn.addEventListener('click', () => {
      this.viewMode = this.viewMode === 'timeline' ? 'gallery' : 'timeline';
      updateViewButton();

      if (this.viewMode === 'gallery') {
        void this.renderGalleryView();
      } else {
        this.renderFeed();
      }
    });
  }

  /**
   * Render tag chip bar from loaded posts.
   * Extracts tags with counts from the current author's posts
   * and renders using the same TagChipBar as the main timeline.
   */
  private renderTagChipBar(): void {
    // Build tag counts from loaded posts
    const tagCounts = new Map<string, number>();
    const tagStore = this.plugin.tagStore;
    if (!tagStore) return;

    for (const post of this.posts) {
      const tags = post.tags ?? [];
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    if (tagCounts.size === 0) {
      this.tagChipBar.destroy();
      return;
    }

    // Build TagWithCount[] matching the global tag store definitions
    const allTags = tagStore.getTagsWithCounts();
    const authorTags: TagWithCount[] = [];
    for (const [tagName, count] of tagCounts) {
      const definition = allTags.find(t => t.name === tagName);
      if (definition) {
        authorTags.push({ ...definition, archiveCount: count });
      } else {
        // Tag exists in posts but not in tag store — create minimal entry
        authorTags.push({
          id: tagName,
          name: tagName,
          color: null,
          sortOrder: 999,
          createdAt: '',
          updatedAt: '',
          archiveCount: count,
        });
      }
    }

    // Sort by count descending
    authorTags.sort((a, b) => b.archiveCount - a.archiveCount);

    // Render between toolbar and feed (insert before feedWrapper)
    if (this.feedWrapper && this.toolbarEl) {
      this.tagChipBar.render(this.contentRoot ?? this.target, authorTags);
      // Move to correct position (after toolbar, before feed)
      const chipBar = (this.contentRoot ?? this.target).querySelector('.tag-chip-bar');
      if (chipBar && this.feedWrapper) {
        chipBar.addClass('author-detail-tag-chip-bar', 'author-detail-pane-content');
        (this.contentRoot ?? this.target).insertBefore(chipBar, this.feedWrapper);
      }
    }
  }

  private renderSearchBar(parent: HTMLElement): void {
    this.searchContainer = parent.createDiv();
    this.searchContainer.addClass('sa-mt-12', 'sa-overflow-hidden', 'tc-search-container', 'tc-search-collapsed');

    const searchWrapper = this.searchContainer.createDiv();
    searchWrapper.addClass('tc-search-wrapper');

    const searchInner = searchWrapper.createDiv();
    searchInner.addClass('sa-flex-row', 'tc-search-inner');

    // Mobile: inline styles to override Obsidian defaults
    if (ObsidianPlatform.isMobile) {
      searchWrapper.style.border = 'none';
      searchWrapper.style.background = 'transparent';
      searchWrapper.style.boxShadow = 'none';
      searchWrapper.style.padding = '2px 0';

      searchInner.style.background = 'var(--background-modifier-form-field)';
      searchInner.style.border = 'none';
      searchInner.style.borderRadius = '8px';
      searchInner.style.padding = '0 10px';
      searchInner.style.height = '36px';
    }

    this.searchInput = searchInner.createEl('input', {
      type: 'text',
      placeholder: 'Search posts by content, hashtags...',
      attr: { 'aria-label': 'Search posts' },
    });
    this.searchInput.addClass('sa-flex-1', 'sa-w-full', 'sa-bg-transparent', 'sa-text-normal', 'sa-text-md', 'tc-search-input');

    if (ObsidianPlatform.isMobile) {
      this.searchInput.style.fontSize = '15px';
      this.searchInput.style.padding = '0 4px';
      this.searchInput.style.lineHeight = '36px';
      this.searchInput.style.height = '36px';
      this.searchInput.style.background = 'transparent';
      this.searchInput.style.border = 'none';
      this.searchInput.style.boxShadow = 'none';
    }

    // Clear button
    const clearButton = searchInner.createDiv();
    clearButton.addClass('sa-icon-20', 'sa-ml-auto', 'sa-clickable', 'sa-text-muted',
      'sa-opacity-0', 'sa-transition-opacity', 'sa-flex-shrink-0');
    setIcon(clearButton, 'x');

    const updateClearButton = () => {
      if (this.searchInput && this.searchInput.value.trim().length > 0) {
        clearButton.removeClass('sa-opacity-0');
        clearButton.addClass('sa-opacity-100');
      } else {
        clearButton.removeClass('sa-opacity-100');
        clearButton.addClass('sa-opacity-0');
      }
    };

    const handleSearch = () => {
      if (this.searchTimeout !== null) window.clearTimeout(this.searchTimeout);
      this.searchTimeout = window.setTimeout(() => {
        this.searchQuery = (this.searchInput?.value ?? '').trim();
        this.applyFiltersAndRenderFeed();
        this.updateSearchButtonState?.();
        this.searchTimeout = null;
      }, 300);
    };

    this.searchInput.addEventListener('input', () => {
      updateClearButton();
      handleSearch();
      this.updateSearchButtonState?.();
    });

    clearButton.addEventListener('click', () => {
      if (this.searchInput) this.searchInput.value = '';
      updateClearButton();
      handleSearch();
      this.searchInput?.focus();
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.toggleSearchBar();
        this.updateSearchButtonState?.();
      }
    });

    updateClearButton();
  }

  private toggleSearchBar(): void {
    this.searchExpanded = !this.searchExpanded;
    if (this.searchExpanded) {
      this.searchContainer?.addClass('tc-search-expanded');
      this.searchContainer?.removeClass('tc-search-collapsed');
      window.setTimeout(() => this.searchInput?.focus(), 50);
    } else {
      this.searchContainer?.addClass('tc-search-collapsed');
      this.searchContainer?.removeClass('tc-search-expanded');
    }
  }

  /**
   * Restore search bar state after toolbar re-render.
   * Extracted to a separate method to avoid TS narrowing issues
   * (renderToolbar() re-creates this.searchInput which TS cannot track).
   */
  private restoreSearchState(wasExpanded: boolean, searchValue: string): void {
    if (wasExpanded && !this.searchExpanded) {
      this.toggleSearchBar();
    }
    if (this.searchInput && searchValue) {
      this.searchInput.value = searchValue;
    }
    this.updateSearchButtonState?.();
  }

  // --------------------------------------------------------------------------
  // Private: Post loading
  // --------------------------------------------------------------------------

  private async initialLoad(): Promise<void> {
    if (!this.currentAuthor) {
      this.isLoading = false;
      this.renderEmptyState();
      return;
    }

    await this.loadPosts();
  }

  /**
   * Load posts for the current author and render the feed.
   *
   * Strategy:
   * 1. Use AuthorCatalogEntry.filePaths if available (fast path)
   * 2. Parse each file with PostDataParser.parseFile()
   * 3. Apply filters/sort and render
   */
  private async loadPosts(): Promise<void> {
    if (!this.currentAuthor) {
      this.isLoading = false;
      this.renderEmptyState();
      return;
    }

    this.isLoading = true;
    this.renderLoadingState();

    try {
      const filePaths = this.currentAuthor.filePaths ?? [];

      if (filePaths.length > 0) {
        // Fast path: parse known file paths
        const posts: PostData[] = [];
        for (const filePath of filePaths) {
          const abstractFile = this.vault.getAbstractFileByPath(filePath);
          if (abstractFile instanceof TFile) {
            const post = await this.postDataParser.parseFile(abstractFile);
            if (post) {
              posts.push(post);
            }
          }
        }
        this.posts = posts;
      } else {
        // Fallback: load all posts and filter by author
        const allPosts = await this.postDataParser.loadFromVault(this.archivePath);
        this.posts = allPosts.filter((p) => this.isPostByCurrentAuthor(p));
      }

      this.isLoading = false;

      // Enrich author entry from loaded PostData if header data is incomplete
      this.enrichAuthorFromPosts();

      // Render tag chip bar from loaded posts
      this.renderTagChipBar();

      this.applyFiltersAndRenderFeed();
    } catch (error) {
      console.error('[AuthorDetailContainer] Failed to load posts:', error);
      this.isLoading = false;
      this.renderErrorState();
    }
  }

  /**
   * Enrich currentAuthor with metadata from loaded posts.
   * Fills in avatar, bio, followers, localAvatar, archiveCount, and filePaths
   * that may be missing when the entry was built from PostData in handleViewAuthor
   * rather than from the full AuthorCatalogStore.
   */
  private enrichAuthorFromPosts(): void {
    if (!this.currentAuthor || this.posts.length === 0) return;

    let enriched = false;
    const author = this.currentAuthor;

    // --- 1. Enrich from PostData.author fields ---
    for (const post of this.posts) {
      if (!post.author) continue;

      if (!author.avatar && post.author.avatar) {
        author.avatar = post.author.avatar;
        enriched = true;
      }
      if (!author.localAvatar && post.author.localAvatar) {
        author.localAvatar = post.author.localAvatar;
        enriched = true;
      }
      if (!author.bio && post.author.bio) {
        author.bio = post.author.bio;
        enriched = true;
      }
      if (author.followers == null && post.author.followers != null) {
        author.followers = post.author.followers;
        enriched = true;
      }
      if (author.postsCount == null && post.author.postsCount != null) {
        author.postsCount = post.author.postsCount;
        enriched = true;
      }
      if (!author.handle && (post.author.handle || post.author.username)) {
        author.handle = post.author.handle || post.author.username;
        enriched = true;
      }
    }

    // --- 2. Enrich bio/avatar/followers from vault frontmatter ---
    // PostDataParser doesn't put authorBio into PostData.author.bio,
    // but the vault frontmatter has it. Read directly via MetadataCache.
    if (!author.bio || !author.avatar || !author.localAvatar || author.followers == null) {
      for (const post of this.posts) {
        if (!post.filePath) continue;
        const file = this.vault.getAbstractFileByPath(post.filePath);
        if (!(file instanceof TFile)) continue;
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm) continue;

        if (!author.bio) {
          const bio = fm.authorBio ?? fm.bio ?? fm.synopsis;
          if (typeof bio === 'string' && bio.trim()) {
            author.bio = bio.trim().slice(0, 2000);
            enriched = true;
          }
        }
        if (!author.avatar && !author.localAvatar) {
          const avatar = fm.authorAvatar;
          if (typeof avatar === 'string' && avatar.trim()) {
            // Wikilink format: [[path/to/avatar.jpg]]
            const wikiMatch = avatar.match(/^\[\[(.+?)]]$/);
            if (wikiMatch) {
              author.localAvatar = wikiMatch[1];
            } else {
              author.avatar = avatar;
            }
            enriched = true;
          }
        }
        if (author.followers == null) {
          const followers = fm.authorFollowers;
          if (typeof followers === 'number') {
            author.followers = followers;
            enriched = true;
          }
        }
        if (author.postsCount == null) {
          const postsCount = fm.authorPostsCount;
          if (typeof postsCount === 'number') {
            author.postsCount = postsCount;
            enriched = true;
          }
        }

        // Stop once we have all fields
        if (author.bio && (author.avatar || author.localAvatar) && author.followers != null) {
          break;
        }
      }
    }

    // --- 3. Enrich subscription status from SubscriptionManager ---
    if (author.status === 'not_subscribed' && this.plugin.subscriptionManager) {
      const subscriptions = this.plugin.subscriptionManager.getSubscriptions();
      const matched = subscriptions.find((sub) => {
        const subUrl = sub.target?.profileUrl?.toLowerCase().replace(/\/+$/, '');
        const authorUrlNorm = author.authorUrl?.toLowerCase().replace(/\/+$/, '');
        return subUrl === authorUrlNorm && sub.platform === author.platform;
      });
      if (matched) {
        author.subscriptionId = matched.id;
        author.status = matched.enabled ? 'subscribed' : 'error';
        author.schedule = matched.schedule?.cron || undefined;
        author.lastRunAt = matched.state?.lastRunAt ? new Date(matched.state.lastRunAt) : undefined;
        author.maxPostsPerRun = matched.options?.maxPostsPerRun;
        enriched = true;
      }
    }

    // --- 4. Update archiveCount and filePaths ---
    if (author.archiveCount !== this.posts.length) {
      author.archiveCount = this.posts.length;
      enriched = true;
    }

    const loadedPaths = this.posts
      .map((p) => p.filePath)
      .filter((fp): fp is string => !!fp);
    if (loadedPaths.length > 0 && (!author.filePaths || author.filePaths.length === 0)) {
      author.filePaths = loadedPaths;
      enriched = true;
    }

    // Remount header if any field was enriched
    if (enriched) {
      this.remountProfileHeader();
    }
  }

  /**
   * Check if a post belongs to the current author.
   * Used as a fallback when filePaths are not available.
   */
  private isPostByCurrentAuthor(post: PostData): boolean {
    if (!this.currentAuthor || !post.author) return false;

    const authorUrl = this.currentAuthor.authorUrl;
    const platform = this.currentAuthor.platform;

    // Match by author URL (primary)
    if (post.author.url && authorUrl) {
      const normalizedPostUrl = post.author.url.toLowerCase().replace(/\/+$/, '');
      const normalizedAuthorUrl = authorUrl.toLowerCase().replace(/\/+$/, '');
      if (normalizedPostUrl === normalizedAuthorUrl && post.platform === platform) {
        return true;
      }
    }

    // Match by author name + platform (fallback)
    if (post.author.name && this.currentAuthor.authorName) {
      const normalizedPostName = post.author.name.toLowerCase().trim();
      const normalizedAuthorName = this.currentAuthor.authorName.toLowerCase().trim();
      if (normalizedPostName === normalizedAuthorName && post.platform === platform) {
        return true;
      }
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Private: Filtering & sorting
  // --------------------------------------------------------------------------

  private applyFiltersAndRenderFeed(): void {
    // Update FilterSortManager with current search query
    this.filterSortManager.updateFilter({
      searchQuery: this.searchQuery,
    });

    // Use FilterSortManager for filtering and sorting (same as timeline)
    this.filteredPosts = this.filterSortManager.applyFiltersAndSort([...this.posts]);

    if (this.viewMode === 'gallery') {
      void this.renderGalleryView();
    } else {
      this.renderFeed();
    }
  }

  // --------------------------------------------------------------------------
  // Private: Feed rendering
  // --------------------------------------------------------------------------

  /**
   * Render the post feed using PostCardRenderer (timeline mode only).
   * Follows the same pattern as TimelineContainer.renderPostsFeedImmediate().
   */
  private renderFeed(): void {
    if (!this.feedWrapper) return;

    // Bump render generation to invalidate stale async renders
    this.renderGeneration++;
    const currentGeneration = this.renderGeneration;

    // Clear existing feed
    this.feedWrapper.empty();

    if (this.isLoading) {
      this.renderLoadingState();
      return;
    }

    if (this.filteredPosts.length === 0) {
      this.renderEmptyOrFilteredEmptyState();
      return;
    }

    // Clear YouTube controllers and observers before re-render
    this.youtubeControllers.clear();
    this.youtubeEmbedRenderer.disconnectAllObservers();

    // Create feed with same CSS classes as timeline
    const feed = this.feedWrapper.createDiv({
      cls: 'author-detail-timeline-feed author-detail-pane-content timeline-feed',
    });

    // Render posts asynchronously
    void this.renderPostsToFeed(feed, currentGeneration);
  }

  private async renderPostsToFeed(feed: HTMLElement, generation: number): Promise<void> {
    for (const post of this.filteredPosts) {
      // Check if this render is still current
      if (generation !== this.renderGeneration || !feed.isConnected) return;

      await this.postCardRenderer.render(feed, post);
    }
  }

  /**
   * Render gallery view using GalleryViewRenderer.
   * Follows the same pattern as TimelineContainer.renderGalleryContentFull().
   */
  private async renderGalleryView(): Promise<void> {
    if (!this.feedWrapper) return;
    this.feedWrapper.empty();

    // Reset gallery renderer for full re-render
    this.galleryRenderer = new GalleryViewRenderer(this.app, this.vault, this.archivePath);

    // Show loading indicator
    const loadingEl = this.feedWrapper.createDiv({
      cls: 'author-detail-gallery-loading author-detail-pane-content sa-media-gallery-loading',
    });
    loadingEl.createDiv('sa-media-gallery-spinner');
    loadingEl.createDiv({ cls: 'sa-media-gallery-loading-text', text: 'Loading media...' });

    try {
      // Get TFile references from current filtered posts
      const files = this.filteredPosts
        .map((p) => (p.filePath ? this.vault.getAbstractFileByPath(p.filePath) : null))
        .filter((f): f is TFile => f instanceof TFile);

      // Extract media items (author detail doesn't need platform filter — already scoped to one author)
      const mediaItems = await this.galleryRenderer.extractMediaItems(
        undefined,
        this.searchQuery,
        files.length > 0 ? files : undefined
      );

      loadingEl.remove();

      if (mediaItems.length === 0) {
        const emptyEl = this.feedWrapper.createDiv({ cls: 'ad-empty-state author-detail-pane-content' });
        const iconEl = emptyEl.createDiv({ cls: 'ad-empty-icon' });
        setIcon(iconEl, 'image');
        emptyEl.createEl('p', {
          text: 'No media found in archived posts.',
          cls: 'ad-empty-text',
        });
        return;
      }

      const galleryContainer = this.feedWrapper.createDiv('sa-media-gallery-container');
      galleryContainer.addClass(
        'author-detail-gallery-container',
        'author-detail-pane-content',
        'tc-gallery-fadein'
      );
      this.galleryRenderer.renderGallery(galleryContainer, mediaItems, 'none');

      // Fade in
      requestAnimationFrame(() => {
        galleryContainer.addClass('tc-gallery-visible');
      });
    } catch (error) {
      loadingEl.remove();
      const errorEl = this.feedWrapper.createDiv({ cls: 'ad-error-state author-detail-pane-content' });
      const iconEl = errorEl.createDiv({ cls: 'ad-error-icon' });
      setIcon(iconEl, 'alert-triangle');
      errorEl.createEl('p', {
        text: 'Failed to load media gallery.',
        cls: 'ad-error-text',
      });
      console.error('[AuthorDetailContainer] Gallery view error:', error);
    }
  }

  // --------------------------------------------------------------------------
  // Private: Loading / empty / error states
  // --------------------------------------------------------------------------

  private renderLoadingState(): void {
    if (!this.feedWrapper) return;
    this.feedWrapper.empty();

    const loadingEl = this.feedWrapper.createDiv({ cls: 'ad-loading-state author-detail-pane-content' });

    // Render skeleton cards for loading feel
    for (let i = 0; i < 3; i++) {
      const skeleton = loadingEl.createDiv({ cls: 'ad-skeleton-card' });
      skeleton.createDiv({ cls: 'ad-skeleton-header' });
      skeleton.createDiv({ cls: 'ad-skeleton-body' });
      skeleton.createDiv({ cls: 'ad-skeleton-footer' });
    }
  }

  private renderEmptyState(): void {
    if (!this.feedWrapper) return;
    this.feedWrapper.empty();

    const emptyEl = this.feedWrapper.createDiv({ cls: 'ad-empty-state author-detail-pane-content' });
    const iconEl = emptyEl.createDiv({ cls: 'ad-empty-icon' });
    setIcon(iconEl, 'inbox');
    emptyEl.createEl('p', {
      text: 'No archived posts from this author yet.',
      cls: 'ad-empty-text',
    });
  }

  private renderEmptyOrFilteredEmptyState(): void {
    if (!this.feedWrapper) return;
    this.feedWrapper.empty();

    const emptyEl = this.feedWrapper.createDiv({ cls: 'ad-empty-state author-detail-pane-content' });
    const iconEl = emptyEl.createDiv({ cls: 'ad-empty-icon' });
    setIcon(iconEl, 'inbox');

    if (this.posts.length === 0) {
      emptyEl.createEl('p', {
        text: 'No archived posts from this author yet.',
        cls: 'ad-empty-text',
      });
    } else {
      emptyEl.createEl('p', {
        text: 'No posts match your search.',
        cls: 'ad-empty-text',
      });
      const clearBtn = emptyEl.createEl('button', {
        text: 'Clear search',
        cls: 'ad-empty-clear-btn',
      });
      clearBtn.addEventListener('click', () => {
        this.searchQuery = '';
        if (this.searchInput) {
          this.searchInput.value = '';
        }
        // Collapse search bar if expanded
      if (this.searchExpanded) {
        this.toggleSearchBar();
        this.updateSearchButtonState?.();
      }
        this.applyFiltersAndRenderFeed();
      });
    }
  }

  private renderErrorState(): void {
    if (!this.feedWrapper) return;
    this.feedWrapper.empty();

    const errorEl = this.feedWrapper.createDiv({ cls: 'ad-error-state author-detail-pane-content' });
    const iconEl = errorEl.createDiv({ cls: 'ad-error-icon' });
    setIcon(iconEl, 'alert-triangle');
    errorEl.createEl('p', {
      text: 'Failed to load posts. Please try again.',
      cls: 'ad-error-text',
    });
  }

  // --------------------------------------------------------------------------
  // Private: Renderer callbacks
  // --------------------------------------------------------------------------

  /**
   * Wire callbacks for PostCardRenderer.
   * Same pattern as TimelineContainer lines 910-937.
   */
  private setupRendererCallbacks(): void {
    // View author: navigate to another author's detail
    this.postCardRenderer.onViewAuthor((authorUrl, platform) => {
      if (this.props.onViewAuthor) {
        // Look up the full author entry from the store
        const entry = this.postCardRenderer.findAuthorEntry(authorUrl, platform);
        if (entry) {
          this.props.onViewAuthor(entry);
        }
      }
    });

    // Edit post: open note in a new tab
    this.postCardRenderer.onEditPost((_post, filePath) => {
      const file = this.app.vault.getFileByPath(filePath);
      if (file) {
        void this.app.workspace.getLeaf('tab').openFile(file);
      }
    });

    // Hashtag click: set search query
    this.postCardRenderer.onHashtagClick((hashtag) => {
      this.searchQuery = `#${hashtag}`;
      if (this.searchInput) {
        this.searchInput.value = `#${hashtag}`;
      }
      if (!this.searchExpanded) {
        this.toggleSearchBar();
      }
      this.updateSearchButtonState?.();
      this.applyFiltersAndRenderFeed();
    });

    // Archive toggle: no-op at container level (PostCardRenderer handles internally)
    this.postCardRenderer.onArchiveToggle(() => {
      // No additional handling needed
    });

    // UI delete: remove from local arrays and update count
    this.postCardRenderer.onUIDelete((filePath: string) => {
      this.posts = this.posts.filter((p) => p.filePath !== filePath);
      this.filteredPosts = this.filteredPosts.filter((p) => p.filePath !== filePath);
      // post count update removed
    });

    // Reader mode: open ReaderModeOverlay with author's filtered posts
    this.postCardRenderer.onReaderMode((post) => {
      this.openReaderMode(post);
    });
  }

  // --------------------------------------------------------------------------
  // Private: Reader mode
  // --------------------------------------------------------------------------

  /**
   * Open reader mode for a post — cycles through the author's filtered posts.
   * Uses the same ReaderModeOverlay as the main timeline.
   */
  private openReaderMode(post: PostData): void {
    if (this.readerModeOverlay?.isActive) {
      this.readerModeOverlay.close();
    }

    const currentIndex = this.filteredPosts.findIndex(
      (p) => p.id === post.id && p.filePath === post.filePath
    );
    if (currentIndex === -1) return;

    const context: ReaderModeContext = {
      posts: this.filteredPosts,
      currentIndex,
      app: this.app,
      plugin: this.plugin,
      mediaGalleryRenderer: this.mediaGalleryRenderer,
      linkPreviewRenderer: this.linkPreviewRenderer,
      onClose: (dirty) => {
        if (dirty) {
          void this.reload();
        }
      },
      onShare: async (p) => {
        await this.postCardRenderer.toggleShareForReader(p);
      },
      onEdit: (p) => {
        if (p.filePath) {
          const file = this.vault.getAbstractFileByPath(p.filePath);
          if (file instanceof TFile) {
            void this.app.workspace.getLeaf('tab').openFile(file);
          }
        }
      },
      onDelete: async (p) => {
        return this.postCardRenderer.deletePostForReader(p);
      },
      onTagsChanged: () => {
        this.renderTagChipBar();
      },
      isAuthorSubscribed: (authorUrl, platform) => {
        return this.postCardRenderer.isAuthorSubscribed(authorUrl, platform as Platform);
      },
      onSubscribeAuthor: async (p) => {
        // No-op in author detail — already viewing a single author
      },
      onUnsubscribeAuthor: async (p) => {
        // No-op in author detail
      },
    };

    this.readerModeOverlay = new ReaderModeOverlay(context);
    void this.readerModeOverlay.open();
  }

  // --------------------------------------------------------------------------
  // Private: Store access & subscription
  // --------------------------------------------------------------------------

  private getStore(): AuthorCatalogStoreAPI | null {
    try {
      return getAuthorCatalogStore();
    } catch {
      return null;
    }
  }

  private findAuthorInStore(authorUrl: string, platform: Platform): AuthorCatalogEntry | undefined {
    if (this.detailService) {
      return this.detailService.findAuthor(authorUrl, platform);
    }

    // Fallback: direct store access
    try {
      const store = this.getStore();
      if (!store) return undefined;
      const state = get(store.state);
      return state.authors.find(
        (a) => a.authorUrl === authorUrl && a.platform === platform
      );
    } catch {
      return undefined;
    }
  }

  private subscribeToStore(): void {
    const store = this.getStore();
    if (!store) return;

    this.storeUnsubscribe = store.state.subscribe(() => {
      this.handleStoreUpdate();
    });
  }

  /**
   * Handle store state changes: check if the current author's data changed
   * and trigger a header remount + post refresh if needed.
   */
  private handleStoreUpdate(): void {
    if (!this.currentAuthor || !this.headerTarget) return;

    const latestAuthor = this.findAuthorInStore(
      this.currentAuthor.authorUrl,
      this.currentAuthor.platform
    );
    if (!latestAuthor) return;

    // Only adopt store data if it has a real authorName (not a URL fallback)
    // The passed author from AuthorCatalog always has correct data;
    // the store may have stale or incomplete entries.
    if (latestAuthor.authorName.startsWith('http://') || latestAuthor.authorName.startsWith('https://')) {
      return;
    }

    // Check if author data meaningfully changed
    const prev = this.currentAuthor;
    if (
      prev.status !== latestAuthor.status ||
      prev.archiveCount !== latestAuthor.archiveCount ||
      prev.subscriptionId !== latestAuthor.subscriptionId ||
      prev.followers !== latestAuthor.followers ||
      prev.bio !== latestAuthor.bio ||
      prev.localAvatar !== latestAuthor.localAvatar ||
      prev.authorName !== latestAuthor.authorName
    ) {
      this.currentAuthor = latestAuthor;
      this.remountProfileHeader();
    }
  }

  // --------------------------------------------------------------------------
  // Private: Helpers
  // --------------------------------------------------------------------------

  private getWorkerUrl(): string {
    const configuredUrl = this.plugin.settings.workerUrl || 'https://social-archiver-api.social-archive.org';

    if (ObsidianPlatform.isMobile && configuredUrl.includes('localhost')) {
      return 'https://social-archiver-api.social-archive.org';
    }

    return configuredUrl;
  }

}
