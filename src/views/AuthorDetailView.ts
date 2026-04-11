import {
  ItemView,
  WorkspaceLeaf,
  Platform as ObsidianPlatform,
  debounce,
  type Debouncer,
  type ViewStateResult,
} from 'obsidian';
import type SocialArchiverPlugin from '../main';
import type { AuthorCatalogEntry } from '../types/author-catalog';
import type { Platform } from '../types/post';
import { getAuthorCatalogStore, type AuthorCatalogStoreAPI } from '../services/AuthorCatalogStore';
import { get } from 'svelte/store';
import { AuthorDetailContainer } from '../components/author-detail/AuthorDetailContainer';

// ============================================================================
// Constants
// ============================================================================

/**
 * Unique identifier for the Author Detail View.
 * Registered alongside VIEW_TYPE_TIMELINE in main.ts.
 */
export const VIEW_TYPE_AUTHOR_DETAIL = 'social-archiver-author-detail';

// ============================================================================
// View State Interface
// ============================================================================

/** Persisted state for workspace restoration across Obsidian restarts */
interface AuthorDetailViewState {
  authorUrl: string;
  platform: Platform;
  authorName?: string;
}

// ============================================================================
// AuthorDetailView
// ============================================================================

/**
 * AuthorDetailView - Obsidian ItemView for displaying author profile and posts.
 *
 * Thin view layer that follows the TimelineView pattern:
 * - Lifecycle management (onOpen/onClose)
 * - State persistence (getState/setState for workspace restore)
 * - Vault event listeners (debounced, delegating to container.reload())
 * - Public showAuthor() API for switching authors
 *
 * All rendering and data loading is delegated to AuthorDetailContainer.
 */
export class AuthorDetailView extends ItemView {
  private plugin: SocialArchiverPlugin;
  private safeAreaListener: (() => void) | null = null;
  private safeAreaVisualViewport: VisualViewport | null = null;

  /** Currently displayed author identity (canonical key for persistence) */
  private authorUrl = '';
  private authorPlatform: Platform = 'facebook';

  /** Currently displayed author (resolved from store on workspace restore) */
  private currentAuthor: AuthorCatalogEntry | undefined = undefined;

  /** Currently displayed author name (for dynamic display text) */
  private authorDisplayName = 'Author Detail';

  /** TypeScript container instance (owns rendering + data) */
  private component: AuthorDetailContainer | undefined;

  /** Store subscription for deferred author resolution (workspace restore) */
  private storeUnsubscribe: (() => void) | null = null;

  /**
   * Debounced vault file change handler.
   * Only triggers reload for files that belong to the archive path.
   * Waits 1000ms after last change to batch rapid vault events.
   */
  private debouncedFileChange: Debouncer<[], void> = debounce(() => {
    void this.component?.reload();
  }, 1000, true);

  constructor(leaf: WorkspaceLeaf, plugin: SocialArchiverPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  // --------------------------------------------------------------------------
  // ItemView overrides
  // --------------------------------------------------------------------------

  getViewType(): string {
    return VIEW_TYPE_AUTHOR_DETAIL;
  }

  getDisplayText(): string {
    return this.authorDisplayName;
  }

  getIcon(): string {
    return 'user';
  }

  // --------------------------------------------------------------------------
  // State persistence
  // --------------------------------------------------------------------------

  /**
   * Return persisted state for workspace serialization.
   * Obsidian calls this when saving the workspace layout.
   */
  getState(): Record<string, unknown> {
    return {
      authorUrl: this.authorUrl,
      platform: this.authorPlatform,
      authorName: this.authorDisplayName,
    };
  }

  /**
   * Restore state when Obsidian reopens a saved workspace layout.
   * Called before onOpen() during workspace restore.
   */
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);

    if (state && typeof state === 'object') {
      const s = state as Partial<AuthorDetailViewState>;
      if (typeof s.authorUrl === 'string' && s.authorUrl) {
        this.authorUrl = s.authorUrl;
      }
      if (typeof s.platform === 'string' && s.platform) {
        this.authorPlatform = s.platform as Platform;
      }
      if (typeof s.authorName === 'string' && s.authorName) {
        this.authorDisplayName = s.authorName;
      }
    }

    // If container is already mounted (onOpen ran first), resolve and set author now
    if (this.component && this.authorUrl) {
      const author = this.findAuthorInStore();
      if (author) {
        this.currentAuthor = author;
        this.authorDisplayName = author.authorName || 'Author Detail';
        this.updateLeafHeader();
        this.component.setAuthor(author);
      } else {
        // Store not populated yet — use stub so container can load posts from vault
        this.currentAuthor = {
          authorName: this.authorDisplayName !== 'Author Detail' ? this.authorDisplayName : '',
          authorUrl: this.authorUrl,
          platform: this.authorPlatform,
          avatar: null,
          lastSeenAt: new Date(),
          archiveCount: 0,
          subscriptionId: null,
          status: 'not_subscribed',
        };
        this.component.setAuthor(this.currentAuthor);
        this.subscribeToDeferredRestore();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  onOpen(): Promise<void> {
    const container = this.containerEl;
    container.empty();
    container.addClass('social-archiver-author-detail-view');
    this.setupSafeAreaFallback(container);

    // Detect main-area vs sidebar for layout adjustments
    const root = this.leaf.getRoot();
    const isMainArea = root !== this.app.workspace.rightSplit && root !== this.app.workspace.leftSplit;
    container.toggleClass('is-main-area', isMainArea);

    // Resolve initial author from store (for workspace restore)
    if (this.authorUrl && !this.currentAuthor) {
      this.currentAuthor = this.findAuthorInStore();
      if (this.currentAuthor) {
        this.authorDisplayName = this.currentAuthor.authorName || 'Author Detail';
        this.updateLeafHeader();
      } else {
        // Store not yet populated (plugin reload) — create a stub entry
        // so the container can load posts from vault and enrich author data.
        this.currentAuthor = {
          authorName: this.authorDisplayName !== 'Author Detail' ? this.authorDisplayName : '',
          authorUrl: this.authorUrl,
          platform: this.authorPlatform,
          avatar: null,
          lastSeenAt: new Date(),
          archiveCount: 0,
          subscriptionId: null,
          status: 'not_subscribed',
        };
        // Upgrade stub once store loads (fills in avatar, bio, etc.)
        this.subscribeToDeferredRestore();
      }
    }

    // Create the TypeScript container
    this.createContainer(container);

    // Register vault file change listeners (inside onLayoutReady to avoid startup noise)
    this.registerVaultListeners();

    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.teardownSafeAreaFallback();

    // Cancel pending debounced refreshes
    this.debouncedFileChange.cancel();

    // Unsubscribe from store
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }

    // Destroy the container
    if (this.component) {
      this.component.destroy();
      this.component = undefined;
    }

    this.currentAuthor = undefined;

    return Promise.resolve();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Create the AuthorDetailContainer with a resolved author.
   */
  private createContainer(target: HTMLElement): void {
    this.component = new AuthorDetailContainer(target, {
      vault: this.app.vault,
      app: this.app,
      plugin: this.plugin,
      archivePath: this.plugin.settings.archivePath || 'Social Archives',
      author: this.currentAuthor,
      onGoBack: () => this.plugin.activateTimelineView('sidebar'),
      onViewAuthor: (author: AuthorCatalogEntry) => {
        void this.plugin.activateAuthorDetailView(author);
      },
      onOpenNote: (author: AuthorCatalogEntry) => {
        if (author.noteFilePath) {
          const file = this.app.vault.getFileByPath(author.noteFilePath);
          if (file) {
            void this.app.workspace.getLeaf('tab').openFile(file);
            return;
          }
        }
        // Fallback: search by URL
        const noteService = this.plugin.getAuthorNoteService();
        if (noteService) {
          const file = noteService.findNote(author.authorUrl, author.authorName, author.platform);
          if (file) {
            void this.app.workspace.getLeaf('tab').openFile(file);
          }
        }
      },
    });
  }

  /**
   * Show a specific author in the view.
   * If the same author is already displayed, refreshes data.
   * If a different author is passed, switches to the new author.
   */
  showAuthor(author: AuthorCatalogEntry): void {
    // Update internal state for persistence
    this.authorUrl = author.authorUrl;
    this.authorPlatform = author.platform;
    this.authorDisplayName = author.authorName || 'Author Detail';
    this.currentAuthor = author;

    // Update the leaf title in the tab header
    this.updateLeafHeader();

    // Delegate to container, or create it if deferred
    if (this.component) {
      this.component.setAuthor(author);
    } else {
      this.createContainer(this.containerEl);
    }
  }

  // --------------------------------------------------------------------------
  // Private: Author lookup (for workspace restore)
  // --------------------------------------------------------------------------

  private findAuthorInStore(): AuthorCatalogEntry | undefined {
    if (!this.authorUrl) return undefined;

    try {
      const store = this.getStore();
      if (!store) return undefined;
      const state = get(store.state);
      return state.authors.find(
        (a) => a.authorUrl === this.authorUrl && a.platform === this.authorPlatform
      );
    } catch {
      return undefined;
    }
  }

  private getStore(): AuthorCatalogStoreAPI | null {
    try {
      return getAuthorCatalogStore();
    } catch {
      return null;
    }
  }

  /**
   * Subscribe to store and resolve the author once vault scan completes.
   * Called when workspace restores this view before the store is populated.
   * Creates the container once the author is found.
   */
  private subscribeToDeferredRestore(): void {
    const store = this.getStore();
    if (!store) return;

    this.storeUnsubscribe = store.state.subscribe((state) => {
      // Wait until vault scan populates the store
      if (!state.hasVaultSnapshot || state.authors.length === 0) return;

      const found = state.authors.find(
        (a) => a.authorUrl === this.authorUrl && a.platform === this.authorPlatform
      );
      if (!found) return;

      // Resolved — update view
      this.currentAuthor = found;
      this.authorDisplayName = found.authorName || 'Author Detail';
      this.updateLeafHeader();

      if (this.component) {
        // Container exists but had no author — give it the author
        this.component.setAuthor(found);
      } else {
        // Container not yet created — create it now
        this.createContainer(this.containerEl);
      }

      // Unsubscribe — one-shot resolution
      if (this.storeUnsubscribe) {
        this.storeUnsubscribe();
        this.storeUnsubscribe = null;
      }
    });
  }

  // --------------------------------------------------------------------------
  // Private: Vault event listeners
  // --------------------------------------------------------------------------

  private registerVaultListeners(): void {
    const archivePath = this.plugin.settings.archivePath || 'Social Archives';

    this.app.workspace.onLayoutReady(() => {
      // File creation (new post archived)
      this.registerEvent(
        this.app.vault.on('create', (file) => {
          if (file.path.startsWith(archivePath)) {
            this.debouncedFileChange();
          }
        })
      );

      // File deletion
      this.registerEvent(
        this.app.vault.on('delete', (file) => {
          if (file.path.startsWith(archivePath)) {
            this.debouncedFileChange();
          }
        })
      );

      // File modification
      this.registerEvent(
        this.app.vault.on('modify', (file) => {
          if (file.path.startsWith(archivePath)) {
            this.debouncedFileChange();
          }
        })
      );

      // File rename
      this.registerEvent(
        this.app.vault.on('rename', (file, oldPath) => {
          if (file.path.startsWith(archivePath) || oldPath.startsWith(archivePath)) {
            this.debouncedFileChange();
          }
        })
      );

      // MetadataCache changes (frontmatter updates)
      this.registerEvent(
        this.app.metadataCache.on('changed', (file) => {
          if (file.path.startsWith(archivePath)) {
            this.debouncedFileChange();
          }
        })
      );
    });
  }

  // --------------------------------------------------------------------------
  // Private: Helpers
  // --------------------------------------------------------------------------

  /**
   * Update the leaf tab header with current display name.
   * updateHeader() is available at runtime but not in the type definitions.
   */
  private updateLeafHeader(): void {
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
  }

  /**
   * Mobile WebView environments may report env(safe-area-inset-*) as 0.
   * Mirror TimelineView behavior so author detail headers do not clip under
   * the status bar / notch when opened as a dedicated ItemView on mobile.
   */
  private setupSafeAreaFallback(container: HTMLElement): void {
    if (!ObsidianPlatform.isMobile || this.safeAreaListener) return;
    const dynamicIslandHeights = new Set([852, 874, 932, 956]);

    const applyInsets = () => {
      const viewport = window.visualViewport;
      const viewportTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
      const isPortrait = window.innerHeight >= window.innerWidth;
      const isIPhone = ObsidianPlatform.isIosApp && ObsidianPlatform.isPhone;
      const screenLongestEdge = Math.round(
        Math.max(window.screen.width || 0, window.screen.height || 0),
      );
      const isDynamicIslandIPhone = isIPhone && dynamicIslandHeights.has(screenLongestEdge);
      const androidMinTopInset = ObsidianPlatform.isAndroidApp ? 24 : 0;
      const iosMinTopInset = ObsidianPlatform.isIosApp && isPortrait
        ? (isIPhone ? (isDynamicIslandIPhone ? 59 : 44) : 24)
        : 0;
      const androidExtraTopGap = ObsidianPlatform.isAndroidApp ? 8 : 0;
      const topInset = Math.max(viewportTop, androidMinTopInset, iosMinTopInset);

      const androidMinBottomInset = ObsidianPlatform.isAndroidApp ? 24 : 0;
      let bottomInset = 0;
      if (viewport) {
        const layoutHeight = window.innerHeight || document.documentElement.clientHeight;
        const viewportBottom = viewport.offsetTop + viewport.height;
        bottomInset = Math.max(0, Math.round(layoutHeight - viewportBottom));
        if (bottomInset > 120) bottomInset = 0;
      }
      bottomInset = Math.max(androidMinBottomInset, bottomInset);

      container.setCssProps({
        '--author-detail-safe-area-top-fallback': `${topInset}px`,
        '--author-detail-safe-area-bottom-fallback': `${bottomInset}px`,
        '--author-detail-safe-area-top-extra': `${androidExtraTopGap}px`,
      });
      container.addClass('sa-author-detail-safe-area');
    };

    this.safeAreaListener = applyInsets;
    this.safeAreaVisualViewport = window.visualViewport ?? null;

    applyInsets();
    this.safeAreaVisualViewport?.addEventListener('resize', applyInsets);
    this.safeAreaVisualViewport?.addEventListener('scroll', applyInsets);
    window.addEventListener('resize', applyInsets);
  }

  private teardownSafeAreaFallback(): void {
    if (!this.safeAreaListener) return;

    this.safeAreaVisualViewport?.removeEventListener('resize', this.safeAreaListener);
    this.safeAreaVisualViewport?.removeEventListener('scroll', this.safeAreaListener);
    window.removeEventListener('resize', this.safeAreaListener);

    this.safeAreaListener = null;
    this.safeAreaVisualViewport = null;
  }
}
