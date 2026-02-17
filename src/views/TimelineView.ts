import { ItemView, WorkspaceLeaf, TFile, debounce, Platform as ObsidianPlatform, type Debouncer } from 'obsidian';
import type SocialArchiverPlugin from '../main';
// Use original TypeScript version of TimelineContainer (fully functional)
import { TimelineContainer } from '../components/timeline/TimelineContainer';

/**
 * Unique identifier for the Timeline View
 */
export const VIEW_TYPE_TIMELINE = 'social-archiver-timeline';

/**
 * TimelineView - Custom Obsidian view for displaying archived social media posts
 *
 * Provides a chronological timeline interface with:
 * - Virtual scrolling for performance
 * - Platform-specific post cards
 * - Date grouping and filtering
 * - Search capabilities
 * - Responsive mobile-first design
 *
 * @extends ItemView
 */
interface TimelineComponent {
  isFullscreenActive?(): boolean;
  handleVaultFileChange?(type: string, filePath: string, oldPath?: string): Promise<void>;
  reload?(): Promise<void>;
  destroy?(): void;
  softRefresh?(): Promise<void>;
  openStreamingFullscreen?(
    seriesInfo: { seriesId: string; seriesTitle: string; author: string; platform: string; thumbnailUrl?: string },
    episodeDetail: { titleId: number; no: number; subtitle: string; imageUrls: string[]; thumbnailUrl?: string },
    episodeTitle: string
  ): Promise<void>;
}

export class TimelineView extends ItemView {
  private plugin: SocialArchiverPlugin;
  private component: TimelineComponent | undefined;
  private suppressRefresh = false; // Suppress refresh during batch operations
  private uiDeletedPaths: Set<string> = new Set(); // Track files deleted via UI to skip refresh
  private uiModifiedPaths: Set<string> = new Set(); // Track files modified via UI to skip refresh
  private pendingCleanupTimers: Set<ReturnType<typeof setTimeout>> = new Set(); // Track cleanup timers
  private timelineSafeAreaListener: (() => void) | null = null;
  private timelineVisualViewport: VisualViewport | null = null;

  /** Pending incremental vault changes, batched by debounce timer */
  private pendingVaultChanges: Array<{
    type: 'create' | 'modify' | 'delete' | 'rename';
    filePath: string;
    oldPath?: string;
  }> = [];
  private incrementalUpdateInProgress = false;
  private incrementalUpdatePending = false;

  /**
   * Debounced refresh using Obsidian's built-in debounce
   * Waits 1000ms after last change before refreshing
   * (increased from 500ms to allow MetadataCache to update for preliminary documents)
   */
  private debouncedRefresh: Debouncer<[], void> = debounce(() => {
    if (this.suppressRefresh) return;
    // Don't refresh while fullscreen or reader mode is active - would destroy overlay state
    if (this.component?.isFullscreenActive?.()) return;
    void this.refresh();
  }, 1000, true);

  /**
   * Debounced incremental vault update — batches rapid file changes
   * into a single incremental index update (much faster than full reload).
   */
  private debouncedIncrementalUpdate: Debouncer<[], void> = debounce(() => {
    if (this.suppressRefresh) return;
    if (this.component?.isFullscreenActive?.()) return;
    void this.processIncrementalChanges();
  }, 1000, true);

  /**
   * Process batched incremental vault changes.
   * Each change is applied to the index one by one, then a single re-filter/re-render.
   */
  private async processIncrementalChanges(): Promise<void> {
    if (this.incrementalUpdateInProgress) {
      this.incrementalUpdatePending = true;
      return;
    }

    this.incrementalUpdateInProgress = true;
    if (!this.component?.handleVaultFileChange) {
      // Fallback: full refresh if component doesn't support incremental updates
      this.incrementalUpdateInProgress = false;
      void this.refresh();
      return;
    }

    try {
      do {
        this.incrementalUpdatePending = false;
        const changes = this.pendingVaultChanges.splice(0);
        if (changes.length === 0) {
          continue;
        }

        // If too many changes, fall back to full reload (batch operations)
        if (changes.length > 20) {
          await this.component?.reload?.();
          continue;
        }

        // Apply each change incrementally in a single serialized pass
        for (const change of changes) {
          await this.component.handleVaultFileChange(change.type, change.filePath, change.oldPath);
        }
      } while (this.incrementalUpdatePending || this.pendingVaultChanges.length > 0);
    } finally {
      this.incrementalUpdateInProgress = false;
    }
  }

  /**
   * Queue an incremental vault change (debounced).
   */
  private queueIncrementalChange(
    type: 'create' | 'modify' | 'delete' | 'rename',
    filePath: string,
    oldPath?: string
  ): void {
    // Safety cap: if too many changes accumulate, flush immediately via full reload
    if (this.pendingVaultChanges.length >= 50) {
      this.pendingVaultChanges = [];
      this.debouncedIncrementalUpdate.cancel();
      this.debouncedRefresh();
      return;
    }

    // Deduplicate by filePath: when a file is created, both vault.on('create')
    // and metadataCache.on('changed') (as 'modify') fire. If we only dedup by
    // filePath+type, both get queued and processed, causing duplicate renders.
    // 'create'/'delete'/'rename' take priority over 'modify' for the same file.
    const existing = this.pendingVaultChanges.find(
      c => c.filePath === filePath
    );
    if (existing) {
      // Upgrade: 'create'/'delete'/'rename' are more significant than 'modify'
      if (type !== 'modify') {
        existing.type = type;
        if (oldPath) existing.oldPath = oldPath;
      }
    } else {
      this.pendingVaultChanges.push({ type, filePath, oldPath });
    }
    this.debouncedIncrementalUpdate();
  }

  /**
   * Check if a path is a webtoon image file that should be ignored for refresh
   * Pattern: {mediaPath}/(naver-webtoon|webtoons)/{titleId}/{episodeNo}/{filename}.{ext}
   * See: WebtoonDownloadQueue.ts line 386 for media path pattern
   */
  private isWebtoonImageFile(path: string): boolean {
    // Match pattern: /(naver-webtoon|webtoons)/{titleId}/{episodeNo}/{filename}.{imageExt}
    // - /(naver-webtoon|webtoons)/ - folder name for either platform
    // - \d+ - titleId (numeric)
    // - \d+ - episodeNo (numeric)
    // - [^/]+ - filename (any chars except slash)
    // - \.(jpg|jpeg|png|webp|gif)$ - image extensions only
    const webtoonImagePattern = /\/(naver-webtoon|webtoons)\/\d+\/\d+\/[^/]+\.(jpg|jpeg|png|webp|gif)$/i;
    return webtoonImagePattern.test(path);
  }

  constructor(leaf: WorkspaceLeaf, plugin: SocialArchiverPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  /**
   * Returns the unique view type identifier
   */
  getViewType(): string {
    return VIEW_TYPE_TIMELINE;
  }

  /**
   * Returns the display text shown in the view header
   */
  getDisplayText(): string {
    return 'Social Archive Timeline';
  }

  /**
   * Returns the icon identifier for the view
   */
  getIcon(): string {
    return 'calendar-clock';
  }

  /**
   * Called when the view is opened
   * Initializes the timeline container and renders content
   */
  onOpen(): Promise<void> {
    // Add archive button to header (before containerEl.empty())
    this.addAction('bookmark-plus', 'Archive social media post', () => {
      // Open archive modal via plugin
      this.plugin.openArchiveModal();
    });

    const container = this.containerEl;
    container.empty();
    container.addClass('social-archiver-timeline-view');

    this.setupTimelineSafeAreaFallback(container);

    // Create timeline container (pure TypeScript)
    this.component = new TimelineContainer(container, {
      vault: this.app.vault,
      app: this.app,
      archivePath: this.plugin.settings.archivePath || 'Social Archives',
      plugin: this.plugin,
      onUIDelete: (filePath) => this.registerUIDelete(filePath),
      onUIModify: (filePath) => this.registerUIModify(filePath),
    });

    // Register vault file change listeners
    const archivePath = this.plugin.settings.archivePath || 'Social Archives';

    // Wrap vault event listeners in onLayoutReady() to avoid performance issues during initial vault loading
    // This prevents the 'create' event from firing for all existing files during startup
    // See: https://docs.obsidian.md/Plugins/Guides/Optimizing+plugin+load+time
    this.app.workspace.onLayoutReady(() => {
      // Listen for file creation (new posts archived)
      this.registerEvent(
        this.app.vault.on('create', (file) => {
          // Skip webtoon image files - only markdown files should trigger refresh
          // This prevents Timeline refresh during webtoon episode image downloads
          if (this.isWebtoonImageFile(file.path)) {
            return;
          }
          if (file.path.startsWith(archivePath)) {
            // Use incremental index update instead of full reload
            this.queueIncrementalChange('create', file.path);
          }
        })
      );

      // Listen for file deletion (posts deleted)
      this.registerEvent(
        this.app.vault.on('delete', (file) => {
          if (file.path.startsWith(archivePath)) {
            // Skip refresh if this file was deleted via UI (card already removed)
            if (this.uiDeletedPaths.has(file.path)) {
              this.uiDeletedPaths.delete(file.path);
              return;
            }
            // Use incremental index update instead of full reload
            this.queueIncrementalChange('delete', file.path);
          }
        })
      );

      // Listen for file modification (posts edited)
      this.registerEvent(
        this.app.vault.on('modify', async (file) => {
        // Skip webtoon image files - no need to process or refresh for binary images
        if (this.isWebtoonImageFile(file.path)) {
          return;
        }
        if (file.path.startsWith(archivePath)) {
          // Check if this file was modified via UI (toggle actions) - skip refresh but still process share updates
          // Note: Don't remove from set here - let the timeout handle it, so metadataCache.on('changed') can also check
          const isUIModified = this.uiModifiedPaths.has(file.path);

          // Check if this post is shared and auto-update it
          try {
            // Type guard: ensure file is TFile (has content)
            if (!('stat' in file)) return;
            if (!(file instanceof TFile)) return; // Additional type guard

            const content = await this.app.vault.read(file);
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
              const frontmatter = frontmatterMatch[1];
              const shareUrlMatch = frontmatter?.match(/shareUrl:\s*["']?([^"'\n]+)["']?/);

              if (shareUrlMatch && shareUrlMatch[1]) {
                const shareUrl = shareUrlMatch[1];
                const shareId = shareUrl.split('/').pop();

                if (shareId) {
                  // Parse the updated post
                  const { PostDataParser } = await import('../components/timeline/parsers/PostDataParser');
                  const parser = new PostDataParser(this.app.vault, this.app);
                  const postData = await parser.parseFile(file);

                  if (postData) {
                    // IMPORTANT: Ensure embeddedArchives is explicitly set
                    // If PostDataParser didn't find any, set to empty array (not undefined)
                    // This tells Workers to clear embeddedArchives, not preserve them
                    if (postData.embeddedArchives === undefined) {
                      postData.embeddedArchives = [];
                    }

                    // IMPORTANT: Ensure linkPreviews is explicitly set
                    // If PostDataParser didn't find any, set to empty array (not undefined)
                    // This tells Workers to clear linkPreviews, not preserve them
                    if (postData.linkPreviews === undefined) {
                      postData.linkPreviews = [];
                    }

                    // Update the share
                    const { ShareAPIClient } = await import('../services/ShareAPIClient');
                    const shareClient = new ShareAPIClient({
                      baseURL: this.plugin.settings.workerUrl,
                      apiKey: this.plugin.settings.authToken,
                      vault: this.app.vault
                    });

                    await shareClient.updateShareWithMedia(shareId, postData, {
                      username: this.plugin.settings.username,
                      tier: this.plugin.settings.tier
                    });
                  }
                }
              }
            }
          } catch (error) {
            // Silent fail
          }

          // Skip refresh if this was a UI modification (card already updated)
          if (!isUIModified) {
            // Use incremental index update instead of full reload
            this.queueIncrementalChange('modify', file.path);
          }
        }
      })
    );

      // Listen for file rename (posts renamed)
      this.registerEvent(
        this.app.vault.on('rename', (file, oldPath) => {
          if (file.path.startsWith(archivePath) || oldPath.startsWith(archivePath)) {
            // Use incremental index update instead of full reload
            this.queueIncrementalChange('rename', file.path, oldPath);
          }
        })
      );

      // Listen for MetadataCache changes for cache invalidation
      // This fires when a file's metadata (frontmatter, embeds, links) is updated
      this.registerEvent(
        this.app.metadataCache.on('changed', (file) => {
          // Skip webtoon image files (MetadataCache typically doesn't fire for images,
          // but adding check for consistency and future-proofing)
          if (this.isWebtoonImageFile(file.path)) {
            return;
          }
          if (file.path.startsWith(archivePath)) {
            // Skip refresh if this file was modified via UI (card already updated)
            if (this.uiModifiedPaths.has(file.path)) {
              return;
            }
            // Use incremental index update instead of full reload
            this.queueIncrementalChange('modify', file.path);
          }
        })
      );
    }); // End of workspace.onLayoutReady()

    // Listen for settings change (archive path changed)
    // This doesn't need to be in onLayoutReady since it's not a vault event
    this.registerEvent(
      this.plugin.events.on('settings-changed', () => {
        this.debouncedRefresh();
      })
    );

    return Promise.resolve();
  }

  /**
   * Called when the view is closed
   * Cleanup resources and destroy timeline
   */
  onClose(): Promise<void> {
    this.teardownTimelineSafeAreaFallback();

    // Cancel any pending debounced refresh
    this.debouncedRefresh.cancel();
    this.debouncedIncrementalUpdate.cancel();
    this.pendingVaultChanges = [];

    // Clear all pending cleanup timers
    for (const timer of this.pendingCleanupTimers) {
      clearTimeout(timer);
    }
    this.pendingCleanupTimers.clear();

    if (this.component) {
      this.component?.destroy?.();
      this.component = undefined;
    }
    return Promise.resolve();
  }

  /**
   * Refresh the timeline view
   * Useful when new posts are archived or view is re-activated
   */
  public async refresh(): Promise<void> {
    // Reload the timeline without re-mounting
    if (this.component && this.component.reload) {
      await this.component?.reload?.();
    }
  }

  /**
   * Soft refresh - update data without disrupting fullscreen view
   * Used when new episodes are downloaded in background during streaming
   */
  public async softRefresh(): Promise<void> {
    if (this.component?.softRefresh) {
      await this.component.softRefresh();
    }
  }

  /**
   * Suppress automatic refresh during batch operations
   * Call this before starting batch operations like subscription sync
   */
  public suppressAutoRefresh(): void {
    this.suppressRefresh = true;
    // Cancel any pending debounced refresh
    this.debouncedRefresh.cancel();
  }

  /**
   * Resume automatic refresh after batch operations
   * @param triggerRefresh - Whether to trigger a refresh immediately (default: true)
   */
  public resumeAutoRefresh(triggerRefresh = true): void {
    this.suppressRefresh = false;
    // Only trigger refresh if requested
    if (triggerRefresh) {
      this.debouncedRefresh();
    }
  }

  /**
   * Register a file path that was deleted via UI
   * This prevents the vault 'delete' event from triggering a refresh
   * since the card is already removed from DOM
   */
  public registerUIDelete(filePath: string): void {
    this.uiDeletedPaths.add(filePath);
    // Auto-cleanup after 5 seconds in case the deletion fails
    const timer = setTimeout(() => {
      this.pendingCleanupTimers.delete(timer);
      this.uiDeletedPaths.delete(filePath);
    }, 5000);
    this.pendingCleanupTimers.add(timer);
  }

  /**
   * Register a file path that was modified via UI
   * This prevents the vault 'modify' event from triggering a refresh
   * since the card is already updated in the UI
   */
  public registerUIModify(filePath: string): void {
    this.uiModifiedPaths.add(filePath);
    // Auto-cleanup after 5 seconds in case the modification fails
    const timer = setTimeout(() => {
      this.pendingCleanupTimers.delete(timer);
      this.uiModifiedPaths.delete(filePath);
    }, 5000);
    this.pendingCleanupTimers.add(timer);
  }

  /**
   * Open streaming episode in fullscreen mode
   * Used by WebtoonArchiveModal for stream-first mode
   */
  public openStreamingFullscreen(
    seriesInfo: {
      seriesId: string;
      seriesTitle: string;
      author: string;
      platform: 'naver-webtoon' | 'webtoons';
      thumbnailUrl?: string;
    },
    episodeDetail: {
      titleId: number;
      no: number;
      subtitle: string;
      imageUrls: string[];
      thumbnailUrl?: string;
    },
    episodeTitle: string
  ): Promise<void> {
    if (this.component?.openStreamingFullscreen) {
      return this.component.openStreamingFullscreen(seriesInfo, episodeDetail, episodeTitle);
    }
    return Promise.resolve();
  }

  /**
   * Android WebView may report env(safe-area-inset-*) as 0.
   * Use visualViewport offsets as fallback and expose CSS vars for timeline container/composer.
   */
  private setupTimelineSafeAreaFallback(container: HTMLElement): void {
    if (!ObsidianPlatform.isMobile || this.timelineSafeAreaListener) return;

    const applyInsets = () => {
      const viewport = window.visualViewport;
      const viewportTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
      // Some Android WebView builds always report 0 for visualViewport.offsetTop.
      // Keep a sensible minimum so composer/header do not overlap the status bar.
      const androidMinTopInset = ObsidianPlatform.isAndroidApp ? 24 : 0;
      const androidExtraTopGap = ObsidianPlatform.isAndroidApp ? 8 : 0;
      const topInset = Math.max(viewportTop, androidMinTopInset);

      let bottomInset = 0;
      if (viewport) {
        const layoutHeight = window.innerHeight || document.documentElement.clientHeight;
        const viewportBottom = viewport.offsetTop + viewport.height;
        bottomInset = Math.max(0, Math.round(layoutHeight - viewportBottom));

        // Keyboard may shrink viewport dramatically; keep bottom inset focused on system UI.
        if (bottomInset > 120) bottomInset = 0;
      }

      container.setCssProps({
        '--timeline-safe-area-top-fallback': `${topInset}px`,
        '--timeline-safe-area-bottom-fallback': `${bottomInset}px`,
        '--timeline-safe-area-top-extra': `${androidExtraTopGap}px`,
      });
      container.addClass('sa-timeline-safe-area');
    };

    this.timelineSafeAreaListener = applyInsets;
    this.timelineVisualViewport = window.visualViewport ?? null;

    applyInsets();
    this.timelineVisualViewport?.addEventListener('resize', applyInsets);
    this.timelineVisualViewport?.addEventListener('scroll', applyInsets);
    window.addEventListener('resize', applyInsets);
  }

  private teardownTimelineSafeAreaFallback(): void {
    if (!this.timelineSafeAreaListener) return;

    this.timelineVisualViewport?.removeEventListener('resize', this.timelineSafeAreaListener);
    this.timelineVisualViewport?.removeEventListener('scroll', this.timelineSafeAreaListener);
    window.removeEventListener('resize', this.timelineSafeAreaListener);

    this.timelineSafeAreaListener = null;
    this.timelineVisualViewport = null;
  }
}
