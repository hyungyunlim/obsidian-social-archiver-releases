/**
 * ReaderModeOverlay - Orchestrator for reader mode fullscreen overlay
 *
 * Single-panel approach: renders one post at a time in a centered panel.
 * Navigation (arrow keys / swipe) re-renders the panel with slide animation.
 *
 * Registers keyboard handler: Escape (close), ArrowLeft (prev), ArrowRight (next).
 * Delegates content rendering to ReaderModeContentRenderer (one Component per render).
 * Delegates gesture detection to ReaderModeGestureHandler.
 */

import { TFile, Notice, setIcon, Platform as ObsidianPlatform, type App } from 'obsidian';
import type { PostData } from '../../../types/post';
import type SocialArchiverPlugin from '../../../main';
import { MediaGalleryRenderer } from '../renderers/MediaGalleryRenderer';
import { LinkPreviewRenderer } from '../renderers/LinkPreviewRenderer';
import { ReaderModeContentRenderer } from './ReaderModeContentRenderer';
import { ReaderModeGestureHandler } from './ReaderModeGestureHandler';
import { ReaderHighlightManager } from './ReaderHighlightManager';
import { ReaderTTSController } from './ReaderTTSController';
import {
  ReaderTypographyPanel,
  FONT_SIZE,
  LINE_HEIGHT,
  LETTER_SPACING,
  CONTENT_WIDTH_PRESETS,
  CONTENT_WIDTH_DEFAULT,
  FONT_FAMILY_DEFAULT,
  FONT_FAMILIES,
  type ReaderTypographyState,
  type ReaderFontFamilyKey,
} from './ReaderTypographyPanel';
import { FEATURE_READER_TTS_ENABLED } from '../../../shared/constants';
import { resolveTTSProvider } from '../../../services/tts/resolveProvider';
import type { PluginTTSProvider } from '../../../services/tts/types';
import type { TextHighlight, HighlightRenderProfile } from '../../../types/annotations';
import { getRenderProfileForArchive, RENDER_PROFILE_CONFIG } from '../../../vendor/highlight-core';

export interface ReaderModeContext {
  posts: PostData[];
  currentIndex: number;
  app: App;
  plugin: SocialArchiverPlugin;
  mediaGalleryRenderer: MediaGalleryRenderer;
  linkPreviewRenderer: LinkPreviewRenderer;
  onUIModify?: (filePath: string) => void;
  onUIDelete?: (filePath: string) => void;
  onClose?: (dirty: boolean, dirtyPaths?: string[]) => void;
  onShare?: (post: PostData) => Promise<void>;
  onEdit?: (post: PostData) => void;
  onDelete?: (post: PostData) => Promise<boolean>;
  onTagsChanged?: () => void;
  /** Check if an author is subscribed (delegates to PostCardRenderer) */
  isAuthorSubscribed?: (authorUrl: string, platform: string) => boolean;
  /** Subscribe to an author from reader mode */
  onSubscribeAuthor?: (post: PostData) => Promise<void>;
  /** Unsubscribe from an author from reader mode */
  onUnsubscribeAuthor?: (post: PostData) => Promise<void>;
}

export class ReaderModeOverlay {
  private context: ReaderModeContext;
  private currentIndex: number;

  // DOM elements
  private backdrop: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  private panel: HTMLElement | null = null;

  // Active content renderer (one per render, for Component lifecycle isolation)
  private activeRenderer: ReaderModeContentRenderer | null = null;

  // Sub-components
  private gestureHandler: ReaderModeGestureHandler | null = null;
  private highlightManager: ReaderHighlightManager | null = null;
  private ttsController: ReaderTTSController | null = null;
  private ttsProvider: PluginTTSProvider | null = null;

  /** Per-post highlights cache (keyed by filePath) */
  private highlightsCache: Map<string, TextHighlight[]> = new Map();

  // Keyboard handler ref
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Animation state
  private transitioning = false;
  private _isActive = false;

  // Track whether any archive state was changed during the session
  private dirty = false;
  /** File paths modified during this reader session (for targeted re-parse on close) */
  private dirtyPaths: Set<string> = new Set();

  // Track whether a child modal (e.g. TagModal) is open — suppress keys while true
  private modalOpen = false;

  // Typography state (replaces old fontSize-only state)
  private static readonly FONT_SIZE_KEY = 'social-archiver-reader-font-size';
  private static readonly CONTENT_WIDTH_KEY = 'social-archiver-reader-content-width';
  private static readonly LINE_HEIGHT_KEY = 'social-archiver-reader-line-height';
  private static readonly LETTER_SPACING_KEY = 'social-archiver-reader-letter-spacing';
  private static readonly FONT_FAMILY_KEY = 'social-archiver-reader-font-family';
  private static readonly MIN_FONT = 12;
  private static readonly MAX_FONT = 40;
  private fontSize: number;
  private typographyState: ReaderTypographyState;
  private typographyPanel: ReaderTypographyPanel | null = null;
  private typographyPanelOpen = false;

  // Safe-area fallback listeners (for Android WebView where env() may resolve to 0)
  private viewportSafeAreaListener: (() => void) | null = null;
  private attachedVisualViewport: VisualViewport | null = null;

  constructor(context: ReaderModeContext) {
    this.context = context;
    this.currentIndex = context.currentIndex;

    // Restore persisted typography state
    this.typographyState = this.loadTypographyState();
    this.fontSize = this.typographyState.fontSize;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  // ---------- Public API ----------

  async open(): Promise<void> {
    if (this._isActive) return;
    this._isActive = true;

    // Create backdrop
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'sa-reader-mode-backdrop';
    this.backdrop.addEventListener('click', () => this.close());
    document.body.appendChild(this.backdrop);

    // Create container
    this.container = document.createElement('div');
    this.container.className = 'sa-reader-mode-container';
    document.body.appendChild(this.container);
    this.setupSafeAreaFallback();

    // Apply persisted typography (CSS variables)
    this.applyTypography();

    // Single panel
    this.panel = this.container.createDiv({ cls: 'sa-reader-mode-panel-wrapper rmo-panel-animated' });

    // Initialize highlight manager.
    //
    // `getRenderProfile` is called synchronously at selection time so the
    // manager can stamp `createdProfile` onto the outgoing highlight without
    // needing archive-level context itself (SRP: the manager only knows the
    // body element and the selection).
    this.highlightManager = new ReaderHighlightManager({
      onHighlightCreate: (highlight) => this.handleHighlightCreate(highlight),
      onHighlightRemove: (highlightId) => this.handleHighlightRemove(highlightId),
      getRenderProfile: () => this.resolveRenderProfileForCurrentPost(),
      getCanonicalBasis: () => this.resolveCanonicalBasisForCurrentPost(),
    });

    // Initialize TTS controller (feature-flagged)
    if (FEATURE_READER_TTS_ENABLED) {
      this.ttsController = new ReaderTTSController(this.context.plugin.settings, {
        onRequestNextPostForAutoplay: async () => this.advanceToNextPostForTTSAutoplay(),
        onResolvePrefetchCandidatePost: (offsetFromCurrent) =>
          this.resolvePrefetchCandidatePost(offsetFromCurrent),
      });
      this.ttsProvider = this.resolveProvider();
      if (this.ttsProvider) {
        this.ttsController.setProvider(this.ttsProvider);
      }
    }

    // Keyboard handler (register early so ESC always works)
    this.keyHandler = (e: KeyboardEvent) => {
      // Skip when a child modal (e.g. TagModal) is open so ESC only closes the modal
      if (this.modalOpen) return;

      // TTS keyboard shortcuts take priority
      if (this.ttsController?.handleKeyDown(e)) return;

      if (e.key === 'Escape') {
        // Typography panel Escape is handled by the panel's own keydown listener
        // (capture phase, stopPropagation). If we reach here, the panel is closed.
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        void this.navigate(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        void this.navigate(1);
      } else if (e.code === 'KeyA') {
        e.preventDefault();
        void this.archiveAndAdvance();
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        const post = this.context.posts[this.currentIndex];
        if (post) this.tagPost(post);
      } else if (e.code === 'KeyC') {
        e.preventDefault();
        const post = this.context.posts[this.currentIndex];
        if (post) this.openCommentModal(post);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const post = this.context.posts[this.currentIndex];
        if (post) void this.deletePost(post);
      }
    };
    document.addEventListener('keydown', this.keyHandler);

    // Show overlay immediately
    requestAnimationFrame(() => {
      this.backdrop?.addClass('sa-reader-mode-backdrop-visible');
      this.container?.addClass('sa-reader-mode-container-visible');
    });

    // Render content (errors won't prevent overlay from showing)
    try {
      await this.renderCurrentPost();
    } catch (err) {
      console.error('[Social Archiver] Reader mode render error:', err);
    }

    // Gesture handler
    if (this.container) {
      this.gestureHandler = new ReaderModeGestureHandler(this.container, {
        onSwipeProgress: (progress) => this.onSwipeProgress(progress),
        onSwipeLeft: () => { void this.navigate(1, true); },
        onSwipeRight: () => { void this.navigate(-1, true); },
        onSwipeCancel: () => this.onSwipeCancel(),
        isAtStart: () => this.currentIndex === 0,
        isAtEnd: () => this.currentIndex === this.context.posts.length - 1,
      });
    }
  }

  close(): void {
    if (!this._isActive) return;
    this._isActive = false;

    const wasDirty = this.dirty;
    const dirtyPathsSnapshot = [...this.dirtyPaths];

    // Cleanup keyboard
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }

    // Cleanup gesture
    if (this.gestureHandler) {
      this.gestureHandler.destroy();
      this.gestureHandler = null;
    }

    // Cleanup typography panel
    this.closeTypographyPanel();

    // Cleanup highlight manager
    if (this.highlightManager) {
      this.highlightManager.detach();
      this.highlightManager = null;
    }

    // Cleanup TTS
    if (this.ttsController) {
      void this.ttsController.destroy();
      this.ttsController = null;
    }
    if (this.ttsProvider) {
      void this.ttsProvider.destroy();
      this.ttsProvider = null;
    }

    // Cleanup active renderer
    this.cleanupRenderer();

    // Cleanup safe-area fallback listeners
    this.teardownSafeAreaFallback();

    // Animate out then remove
    this.backdrop?.removeClass('sa-reader-mode-backdrop-visible');
    this.container?.removeClass('sa-reader-mode-container-visible');

    let transitionHandled = false;
    const onTransitionEnd = () => {
      if (transitionHandled) return;
      transitionHandled = true;

      this.backdrop?.remove();
      this.container?.remove();
      this.backdrop = null;
      this.container = null;
      this.panel = null;

      // Notify parent after DOM cleanup so timeline can re-render
      this.context.onClose?.(wasDirty, dirtyPathsSnapshot);
    };

    if (this.container) {
      this.container.addEventListener('transitionend', onTransitionEnd, { once: true });
      window.setTimeout(onTransitionEnd, 400); // Fallback if transitionend doesn't fire
    } else {
      onTransitionEnd();
    }
  }

  /**
   * Some Android WebView environments report env(safe-area-inset-*) as 0.
   * Use visualViewport offsets as fallback and expose them as CSS vars.
   */
  private setupSafeAreaFallback(): void {
    if (!this.container || this.viewportSafeAreaListener) return;

    const applyInsets = () => {
      if (!this.container) return;

      const viewport = window.visualViewport;
      // Android WebView often reports 0 for both env(safe-area-inset-top) and
      // visualViewport.offsetTop.  Apply a platform-specific minimum so the
      // header never sits under the status bar / camera cutout.
      const androidMinTopInset = ObsidianPlatform.isAndroidApp ? 32 : 0;
      // Android gesture bar (~24dp) or 3-button nav (~48dp) is not reported
      // by env(safe-area-inset-bottom) or visualViewport in Obsidian WebView.
      const androidMinBottomInset = ObsidianPlatform.isAndroidApp ? 24 : 0;
      const topInset = Math.max(androidMinTopInset, Math.round(viewport?.offsetTop ?? 0));

      let bottomInset = 0;
      if (viewport) {
        const layoutHeight = window.innerHeight || document.documentElement.clientHeight;
        const viewportBottom = viewport.offsetTop + viewport.height;
        bottomInset = Math.max(0, Math.round(layoutHeight - viewportBottom));

        // Ignore keyboard-driven viewport shrink; we only want system UI inset.
        if (bottomInset > 120) bottomInset = 0;
      }
      bottomInset = Math.max(androidMinBottomInset, bottomInset);

      this.container.setCssProps({
        '--reader-safe-area-top-fallback': `${topInset}px`,
        '--reader-safe-area-bottom-fallback': `${bottomInset}px`,
      });
      // Also set on documentElement so elements outside the container (e.g.
      // highlight toolbar on document.body) can read the fallback values.
      document.documentElement.style.setProperty('--reader-safe-area-bottom-fallback', `${bottomInset}px`);
      document.documentElement.style.setProperty('--reader-safe-area-top-fallback', `${topInset}px`);
    };

    this.viewportSafeAreaListener = applyInsets;
    this.attachedVisualViewport = window.visualViewport ?? null;

    applyInsets();
    this.attachedVisualViewport?.addEventListener('resize', applyInsets);
    this.attachedVisualViewport?.addEventListener('scroll', applyInsets);
    window.addEventListener('resize', applyInsets);
  }

  private teardownSafeAreaFallback(): void {
    if (!this.viewportSafeAreaListener) return;

    this.attachedVisualViewport?.removeEventListener('resize', this.viewportSafeAreaListener);
    this.attachedVisualViewport?.removeEventListener('scroll', this.viewportSafeAreaListener);
    window.removeEventListener('resize', this.viewportSafeAreaListener);

    // Clean up global CSS vars
    document.documentElement.style.removeProperty('--reader-safe-area-bottom-fallback');
    document.documentElement.style.removeProperty('--reader-safe-area-top-fallback');

    this.viewportSafeAreaListener = null;
    this.attachedVisualViewport = null;
  }

  // ---------- Navigation ----------

  /**
   * @param fromSwipe true when triggered by swipe gesture (panel already offset)
   */
  private async navigate(direction: -1 | 1, fromSwipe = false): Promise<void> {
    if (this.transitioning) return;

    // Close typography panel before navigation re-render
    this.closeTypographyPanel();

    const newIndex = this.currentIndex + direction;
    if (newIndex < 0) {
      if (fromSwipe) this.onSwipeCancel();
      else this.bounceEdge(1);
      return;
    }
    if (newIndex >= this.context.posts.length) {
      if (fromSwipe) this.onSwipeCancel();
      else this.bounceEdge(-1);
      return;
    }

    this.transitioning = true;

    if (fromSwipe) {
      // Panel is already partially off-screen from the drag.
      // Continue sliding it off in the same direction.
      if (this.panel) {
        this.panel.setCssProps({
          '--rmo-transition': 'transform 0.18s ease-out, opacity 0.12s ease-out',
          '--rmo-transform': `translateX(${direction === 1 ? '-100%' : '100%'})`,
          '--rmo-opacity': '0',
        });
      }
      await this.wait(180);
    } else {
      // Keyboard / button: subtle slide + fade
      if (this.panel) {
        this.panel.setCssProps({
          '--rmo-transition': 'transform 0.2s ease-in, opacity 0.2s ease-in',
          '--rmo-transform': `translateX(${direction === 1 ? '-60px' : '60px'})`,
          '--rmo-opacity': '0',
        });
      }
      await this.wait(200);
    }

    this.currentIndex = newIndex;

    // Cleanup previous renderer before re-rendering
    this.cleanupRenderer();

    // Render new content
    try {
      await this.renderCurrentPost();
    } catch (err) {
      console.error('[Social Archiver] Reader mode render error:', err);
    }

    // Slide in new panel from opposite direction
    if (this.panel) {
      const enterOffset = fromSwipe ? '40%' : '60px';
      this.panel.setCssProps({
        '--rmo-transition': 'none',
        '--rmo-transform': `translateX(${direction === 1 ? enterOffset : `-${enterOffset}`})`,
        '--rmo-opacity': '0',
      });

      // Force reflow
      void this.panel.offsetHeight;

      const enterDuration = fromSwipe ? '0.22s' : '0.25s';
      this.panel.setCssProps({
        '--rmo-transition': `transform ${enterDuration} ease-out, opacity ${enterDuration} ease-out`,
        '--rmo-transform': 'translateX(0)',
        '--rmo-opacity': '1',
      });
    }

    await this.wait(fromSwipe ? 220 : 250);
    this.transitioning = false;
  }

  private bounceEdge(direction: 1 | -1): void {
    if (!this.panel) return;

    this.panel.setCssProps({
      '--rmo-transition': 'transform 0.15s ease-out',
      '--rmo-transform': `translateX(${direction * 20}px)`,
    });

    window.setTimeout(() => {
      if (!this.panel) return;
      this.panel.setCssProps({
        '--rmo-transition': 'transform 0.2s ease-in',
        '--rmo-transform': 'translateX(0)',
      });
    }, 150);
  }

  /**
   * Auto-advance hook used by reader TTS queue behavior.
   * Returns the next focused post, or null when advancing is not possible.
   */
  private async advanceToNextPostForTTSAutoplay(): Promise<PostData | null> {
    if (!this._isActive || this.transitioning || this.modalOpen) return null;
    if (this.currentIndex >= this.context.posts.length - 1) {
      new Notice('Reached the last post');
      return null;
    }

    await this.navigate(1);
    return this.context.posts[this.currentIndex] ?? null;
  }

  private resolvePrefetchCandidatePost(offsetFromCurrent: number): PostData | null {
    if (!this._isActive || this.transitioning) return null;
    if (offsetFromCurrent < 1) return null;
    return this.context.posts[this.currentIndex + offsetFromCurrent] ?? null;
  }

  // ---------- Swipe Handling ----------

  private onSwipeProgress(progress: number): void {
    if (!this.panel || this.transitioning) return;
    this.panel.setCssProps({
      '--rmo-transition': 'none',
      '--rmo-transform': `translateX(${progress * 100}vw)`,
      // Fade slightly during drag
      '--rmo-opacity': String(Math.max(0.3, 1 - Math.abs(progress) * 1.5)),
    });
  }

  private onSwipeCancel(): void {
    if (!this.panel) return;
    this.panel.setCssProps({
      '--rmo-transition': 'transform 0.3s ease-out, opacity 0.3s ease-out',
      '--rmo-transform': 'translateX(0)',
      '--rmo-opacity': '1',
    });
  }

  // ---------- Archive ----------

  private archiving = false;

  private async archiveAndAdvance(): Promise<void> {
    if (this.archiving || this.transitioning) return;
    const post = this.context.posts[this.currentIndex];
    if (!post) return;

    this.archiving = true;
    try {
      const newStatus = await this.toggleArchive(post);
      if (newStatus === null) return; // failed

      // Auto-advance to next post after archiving (not un-archiving)
      if (newStatus && this.currentIndex < this.context.posts.length - 1) {
        await this.wait(250);
        await this.navigate(1);
      } else {
        // Re-render to update the archive button state
        await this.reRenderPreservingScroll();
      }
    } finally {
      this.archiving = false;
    }
  }

  /**
   * Toggle archive frontmatter on the current post's file.
   * Returns new archive status, or null on failure.
   */
  private async toggleArchive(post: PostData): Promise<boolean | null> {
    try {
      const filePath = post.filePath;
      if (!filePath) return null;

      const vault = this.context.app.vault;
      const file = vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) return null;

      const newArchiveStatus = !post.archive;

      // Notify UI-modify to prevent timeline refresh
      this.context.onUIModify?.(filePath);

      // Update YAML frontmatter atomically via processFrontMatter
      await this.context.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm['archive'] = newArchiveStatus;
      });
      post.archive = newArchiveStatus;
      this.dirty = true;

      return newArchiveStatus;
    } catch {
      console.error('[Social Archiver] Failed to toggle archive');
      return null;
    }
  }

  // ---------- Toggle Like ----------

  private async toggleLike(post: PostData): Promise<void> {
    try {
      const filePath = post.filePath;
      if (!filePath) return;

      const vault = this.context.app.vault;
      const file = vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) return;

      const newLikeStatus = !post.like;

      this.context.onUIModify?.(filePath);
      await this.context.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm['like'] = newLikeStatus;
      });
      post.like = newLikeStatus;
      this.dirty = true;

      await this.reRenderPreservingScroll();
    } catch {
      console.error('[Social Archiver] Failed to toggle like');
    }
  }

  // ---------- Tag ----------

  private tagPost(post: PostData): void {
    const filePath = post.filePath;
    if (!filePath) return;

    const tagStore = this.context.plugin.tagStore;
    if (!tagStore) return;

    void import('../modals/TagModal').then(({ TagModal }) => {
      this.modalOpen = true;
      const modal = new TagModal(this.context.app, tagStore, filePath, () => {
        post.tags = tagStore.getTagsForPost(filePath);
        this.dirty = true;
        this.context.onTagsChanged?.();
        this.reRenderPreservingScroll().catch(console.error);
      }, (fp: string) => this.context.onUIModify?.(fp));

      // Clear flag when modal closes so reader mode keys resume.
      // Defer to next tick — Obsidian calls onClose synchronously during the
      // same keydown event, so the flag must stay true until the event finishes.
      const origOnClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        origOnClose();
        window.setTimeout(() => { this.modalOpen = false; }, 0);
      };

      modal.open();

      // Ensure modal appears above reader mode overlay (z-index 1000)
      requestAnimationFrame(() => {
        const containerEl = modal.containerEl;
        if (containerEl) {
          containerEl.addClass('sa-z-1001');
        }
      });
    });
  }

  // ---------- Open Note ----------

  private openNote(post: PostData): void {
    const filePath = post.filePath;
    if (!filePath) return;

    const vault = this.context.app.vault;
    const file = vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    const leaf = this.context.app.workspace.getLeaf('tab');
    void leaf.openFile(file);
  }

  // ---------- Share ----------

  private async sharePost(post: PostData): Promise<void> {
    if (this.context.onShare) {
      await this.context.onShare(post);
      this.dirty = true;
      await this.reRenderPreservingScroll();
    }
  }

  // ---------- Edit ----------

  private editPost(post: PostData): void {
    if (this.context.onEdit) {
      this.context.onEdit(post);
      this.close();
    }
  }

  // ---------- Delete ----------

  private async deletePost(post: PostData): Promise<void> {
    if (this.context.onDelete) {
      this.modalOpen = true;
      let deleted: boolean;
      try {
        deleted = await this.context.onDelete(post);
      } finally {
        window.setTimeout(() => { this.modalOpen = false; }, 0);
      }
      if (!deleted) return;
      // Post was deleted — remove from list and navigate or close
      const idx = this.context.posts.findIndex(p => p.filePath === post.filePath);
      if (idx !== -1) {
        this.context.posts.splice(idx, 1);
      }
      this.dirty = true;
      if (this.context.posts.length === 0) {
        this.close();
        return;
      }
      // Adjust current index if needed
      if (this.currentIndex >= this.context.posts.length) {
        this.currentIndex = this.context.posts.length - 1;
      }
      this.cleanupRenderer();
      await this.renderCurrentPost();
    }
  }

  // ---------- Comment / Note Modal ----------

  private openCommentModal(post: PostData): void {
    if (!post.filePath) return;
    this.modalOpen = true;

    const filePath = post.filePath;

    // Backdrop
    const overlay = document.createElement('div');
    overlay.addClass('sa-fixed');
    overlay.addClass('sa-inset-0');
    overlay.addClass('sa-z-1001');
    overlay.addClass('sa-flex-center');
    overlay.setCssProps({ '--sa-bg': 'var(--background-modifier-cover)' });
    overlay.addClass('sa-dynamic-bg');

    // Modal container
    const modal = document.createElement('div');
    modal.addClass('sa-bg-primary');
    modal.addClass('sa-border');
    modal.addClass('sa-rounded-12');
    modal.addClass('sa-flex-col');
    modal.addClass('rmo-note-modal');

    // Header
    const header = document.createElement('div');
    header.addClass('sa-flex-between');
    header.addClass('sa-px-16');
    header.addClass('sa-border-b');
    header.addClass('rmo-note-header');

    const title = document.createElement('div');
    title.addClass('sa-font-semibold');
    title.addClass('sa-text-md');
    title.addClass('sa-flex-row');
    title.addClass('sa-gap-6');
    const titleIcon = document.createElement('span');
    titleIcon.addClass('sa-icon-16');
    setIcon(titleIcon, 'message-square-text');
    title.appendChild(titleIcon);
    title.appendChild(document.createTextNode(post.comment ? 'Edit Note' : 'Add Note'));
    header.appendChild(title);

    const closeBtn = document.createElement('div');
    closeBtn.addClass('sa-clickable');
    closeBtn.addClass('sa-icon-24');
    closeBtn.addClass('sa-rounded-4');
    closeBtn.addClass('sa-text-muted');
    closeBtn.setAttribute('title', 'Close (escape)');
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.setCssProps({ '--sa-bg': 'var(--background-modifier-hover)' });
      closeBtn.addClass('sa-dynamic-bg');
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.removeClass('sa-dynamic-bg');
    });
    header.appendChild(closeBtn);

    // Textarea
    const body = document.createElement('div');
    body.addClass('sa-p-12');
    body.addClass('sa-flex-1');
    body.addClass('rmo-note-body');

    const textarea = document.createElement('textarea');
    textarea.value = post.comment || '';
    textarea.placeholder = 'Write a personal note about this post...';
    textarea.addClass('sa-w-full');
    textarea.addClass('sa-bg-secondary');
    textarea.addClass('sa-border');
    textarea.addClass('sa-rounded-8');
    textarea.addClass('sa-text-normal');
    textarea.addClass('sa-text-md');
    textarea.addClass('rmo-note-textarea');
    body.appendChild(textarea);

    // Footer
    const footer = document.createElement('div');
    footer.addClass('sa-flex-between');
    footer.addClass('sa-px-16');
    footer.addClass('rmo-note-footer');

    const hint = document.createElement('span');
    hint.addClass('sa-text-xs');
    hint.addClass('sa-text-muted');
    hint.textContent = 'Cmd/Ctrl+Enter to save';
    footer.appendChild(hint);

    const btnGroup = document.createElement('div');
    btnGroup.addClass('sa-flex');
    btnGroup.addClass('sa-gap-8');

    // Delete button (only if comment exists)
    if (post.comment) {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.addClass('sa-px-12');
      deleteBtn.addClass('sa-py-6');
      deleteBtn.addClass('sa-rounded-6');
      deleteBtn.addClass('sa-text-base');
      deleteBtn.addClass('sa-clickable');
      deleteBtn.addClass('sa-border');
      deleteBtn.addClass('sa-bg-secondary');
      deleteBtn.addClass('sa-text-error');
      deleteBtn.addClass('rmo-note-btn');
      deleteBtn.addEventListener('click', () => void handleSave(''));
      btnGroup.appendChild(deleteBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addClass('sa-px-12');
    cancelBtn.addClass('sa-py-6');
    cancelBtn.addClass('sa-rounded-6');
    cancelBtn.addClass('sa-text-base');
    cancelBtn.addClass('sa-clickable');
    cancelBtn.addClass('sa-border');
    cancelBtn.addClass('sa-bg-secondary');
    cancelBtn.addClass('sa-text-normal');
    cancelBtn.addClass('rmo-note-btn');

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addClass('sa-px-12');
    saveBtn.addClass('sa-py-6');
    saveBtn.addClass('sa-rounded-6');
    saveBtn.addClass('sa-text-base');
    saveBtn.addClass('sa-clickable');
    saveBtn.addClass('sa-bg-accent');
    saveBtn.addClass('rmo-note-save-btn');

    btnGroup.appendChild(cancelBtn);
    btnGroup.appendChild(saveBtn);
    footer.appendChild(btnGroup);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Focus textarea after render
    requestAnimationFrame(() => {
      textarea.focus();
      // Place cursor at end
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    });

    // --- Handlers ---

    const closeModal = () => {
      overlay.remove();
      window.setTimeout(() => { this.modalOpen = false; }, 0);
    };

    const handleSave = async (overrideValue?: string) => {
      const newComment = overrideValue !== undefined ? overrideValue : textarea.value.trim();
      const vault = this.context.app.vault;
      const tfile = vault.getAbstractFileByPath(filePath);
      if (!(tfile instanceof TFile)) {
        new Notice('File not found');
        closeModal();
        return;
      }

      try {
        this.context.onUIModify?.(filePath);
        await this.context.app.fileManager.processFrontMatter(tfile, (fm: Record<string, unknown>) => {
          if (newComment) {
            fm['comment'] = newComment;
          } else {
            delete fm['comment'];
          }
        });
        post.comment = newComment || undefined;
        this.dirty = true;

        closeModal();
        await this.reRenderPreservingScroll();
      } catch (err) {
        console.error('[Social Archiver] Failed to save comment:', err);
        new Notice('Failed to save note');
      }
    };

    saveBtn.addEventListener('click', () => void handleSave());
    cancelBtn.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Keyboard: Cmd/Ctrl+Enter = save, Escape = close
    const modalKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
        document.removeEventListener('keydown', modalKeyHandler, true);
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        void handleSave();
        document.removeEventListener('keydown', modalKeyHandler, true);
      }
    };
    document.addEventListener('keydown', modalKeyHandler, true);
  }

  // ---------- Highlight Handlers ----------

  /**
   * Handle highlight creation: apply ==text== to vault file, sync to API.
   */
  private async handleHighlightCreate(highlight: TextHighlight): Promise<void> {
    const post = this.context.posts[this.currentIndex];
    if (!post?.filePath) return;

    const postKey = post.filePath || post.id;

    // 1. Update local cache
    const cached = this.highlightsCache.get(postKey) || [];
    cached.push(highlight);
    this.highlightsCache.set(postKey, cached);

    // 2. Apply ==highlight== to vault markdown file
    await this.applyHighlightToVaultFile(post, highlight);

    // 3. Update in-memory PostData so timeline reflects the change on close
    post.highlightCount = cached.length;

    // 4. Sync to server API (fire-and-forget in background)
    this.syncHighlightsToServer(post, cached);

    this.dirty = true;
    if (post.filePath) this.dirtyPaths.add(post.filePath);
    new Notice('Highlight saved');
  }

  /**
   * Handle highlight removal: remove ==text== from vault file, sync to API.
   */
  private async handleHighlightRemove(highlightId: string): Promise<void> {
    const post = this.context.posts[this.currentIndex];
    if (!post?.filePath) return;

    const postKey = post.filePath || post.id;
    const cached = this.highlightsCache.get(postKey) || [];
    const removed = cached.find(h => h.id === highlightId);
    const updated = cached.filter(h => h.id !== highlightId);
    this.highlightsCache.set(postKey, updated);

    // Remove ==text== from vault file
    if (removed) {
      await this.removeHighlightFromVaultFile(post, removed);
    }

    // Update in-memory PostData so timeline reflects the change on close
    post.highlightCount = updated.length > 0 ? updated.length : undefined;

    // Sync to server
    this.syncHighlightsToServer(post, updated);

    this.dirty = true;
    if (post.filePath) this.dirtyPaths.add(post.filePath);
    new Notice('Highlight removed');
  }

  /**
   * Apply Obsidian ==highlight== markdown format to the vault note file.
   * Finds the highlight text in the file body and wraps with ==...==.
   */
  private async applyHighlightToVaultFile(post: PostData, highlight: TextHighlight): Promise<void> {
    try {
      const filePath = post.filePath;
      if (!filePath) return;

      const vault = this.context.app.vault;
      const file = vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) return;

      this.context.onUIModify?.(filePath);

      const content = await vault.read(file);

      // Find the text in the file body (after frontmatter)
      const fmEnd = this.findFrontmatterEnd(content);
      const body = content.substring(fmEnd);

      // Search for the highlight text, using context to disambiguate
      const idx = this.findTextInBody(body, highlight.text, highlight.contextBefore, highlight.contextAfter);
      if (idx < 0) {
        console.warn('[Social Archiver] Could not find highlight text in vault file');
        return;
      }

      // Check if already wrapped with ==
      const absoluteIdx = fmEnd + idx;
      const before2 = content.substring(Math.max(0, absoluteIdx - 2), absoluteIdx);
      const after2 = content.substring(absoluteIdx + highlight.text.length, absoluteIdx + highlight.text.length + 2);
      if (before2 === '==' && after2 === '==') return; // Already highlighted

      // Wrap with ==...==
      const newContent =
        content.substring(0, absoluteIdx) +
        '==' + highlight.text + '==' +
        content.substring(absoluteIdx + highlight.text.length);

      await vault.modify(file, newContent);
    } catch (err) {
      console.error('[Social Archiver] Failed to apply highlight to vault file:', err);
    }
  }

  /**
   * Remove ==highlight== markup from the vault note file.
   */
  private async removeHighlightFromVaultFile(post: PostData, highlight: TextHighlight): Promise<void> {
    try {
      const filePath = post.filePath;
      if (!filePath) return;

      const vault = this.context.app.vault;
      const file = vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) return;

      this.context.onUIModify?.(filePath);

      const content = await vault.read(file);
      const wrapped = '==' + highlight.text + '==';
      const idx = content.indexOf(wrapped);
      if (idx < 0) return;

      const newContent =
        content.substring(0, idx) +
        highlight.text +
        content.substring(idx + wrapped.length);

      await vault.modify(file, newContent);
    } catch (err) {
      console.error('[Social Archiver] Failed to remove highlight from vault file:', err);
    }
  }

  /**
   * Sync highlights to the server API (background, non-blocking).
   * Server broadcasts hasAnnotationUpdate via WebSocket to mobile app.
   *
   * `sourceArchiveId` fallback:
   *   - Inbound annotation sync auto-backfills this field when the archive
   *     is first touched by another client (mobile / share-web). Plugin
   *     archives that only ever saw plugin-side highlights may not have
   *     it yet — without it this method used to silently return, so
   *     plugin-authored highlights never left the vault.
   *   - When missing, look the archive up by `originalUrl` via
   *     `getUserArchives({ originalUrl })`, backfill the frontmatter,
   *     and proceed. If lookup finds nothing the archive is genuinely
   *     local-only and we skip quietly.
   */
  private syncHighlightsToServer(post: PostData, highlights: TextHighlight[]): void {
    const filePath = post.filePath;
    if (!filePath) return;

    const file = this.context.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    const cache = this.context.app.metadataCache.getFileCache(file);
    const directId = cache?.frontmatter?.sourceArchiveId as string | undefined;
    const originalUrl = cache?.frontmatter?.originalUrl as string | undefined;

    void (async () => {
      const archiveId = await this.resolveArchiveIdForSync(file, directId, originalUrl);
      if (!archiveId) return; // genuinely local-only — nothing to sync

      try {
        const apiClient = this.context.plugin.workersApiClient;
        await apiClient.updateArchiveActions(archiveId, {
          userHighlights: highlights,
        });
      } catch (err) {
        console.error('[Social Archiver] Failed to sync highlights to server:', err);
      }
    })();
  }

  /**
   * Resolve the server archive id for the current note, backfilling the
   * frontmatter when we have to look it up by `originalUrl`. Returns
   * `null` when the archive doesn't live on the server yet.
   */
  private async resolveArchiveIdForSync(
    file: TFile,
    directId: string | undefined,
    originalUrl: string | undefined
  ): Promise<string | null> {
    if (directId) return directId;
    if (!originalUrl) return null;

    let apiClient;
    try {
      apiClient = this.context.plugin.workersApiClient;
    } catch {
      return null;
    }
    if (!apiClient) return null;

    try {
      const response = await apiClient.getUserArchives({ originalUrl, limit: 1 });
      const found = response.archives?.[0]?.id;
      if (!found) {
        console.debug('[Social Archiver] No server archive found for originalUrl — skipping highlight sync.', originalUrl);
        return null;
      }

      try {
        await this.context.app.fileManager.processFrontMatter(file, (fm) => {
          if (!fm.sourceArchiveId) fm.sourceArchiveId = found;
        });
      } catch (err) {
        // Non-fatal — we can still sync even if the backfill write fails.
        console.warn('[Social Archiver] Failed to backfill sourceArchiveId frontmatter:', err);
      }

      return found;
    } catch (err) {
      console.error('[Social Archiver] Lookup by originalUrl failed:', err);
      return null;
    }
  }

  /**
   * Resolve the render profile that the manager should stamp onto new
   * highlights created inside the reader overlay.
   *
   * The plugin's `PostData` shape does not carry the canonical
   * `isArticle` / `contentType` flags that mobile uses, so we derive them
   * conservatively here:
   *   - `post.platform === 'web'` or `'post'` with a title/rawMarkdown →
   *      treat as structured markdown (long-form blog-style content).
   *   - X-article posts (platform `x` + presence of `rawMarkdown`) →
   *      structured-md.
   *   - Everything else → social-plain (default fallback in highlight-core).
   */
  private resolveRenderProfileForCurrentPost(): HighlightRenderProfile | undefined {
    const post = this.context.posts[this.currentIndex];
    if (!post) return undefined;

    const rawMarkdown = post.content.rawMarkdown ?? '';
    const hasRawMd = rawMarkdown.trim().length > 0;
    const platform = post.platform;

    const isWebArticle = platform === 'web' && hasRawMd;
    const isXArticle = platform === 'x' && hasRawMd;
    // `platform: 'post'` is user-created composed content — treat as article-
    // like when it carries raw markdown (matches the "writer" reader experience).
    const isUserPostArticle = platform === 'post' && hasRawMd;
    const isArticle = isWebArticle || isXArticle || isUserPostArticle;

    return getRenderProfileForArchive({
      platform,
      isArticle,
      isXArticle,
      isWebArticle,
    });
  }

  /**
   * Resolve the canonical fullText basis for the current post:
   *   - `title` — the post title (undefined when missing).
   *   - `includeTitlePrefix` — whether the current render profile prepends
   *     `title + "\n\n"` to the body when computing canonical fullText.
   *
   * Used by `ReaderHighlightManager.computeCanonicalOffsets` so plugin-side
   * saves record offsets in the same coordinate space as share-web / mobile
   * (both of which go through `computeFullText`). Without this, article
   * highlights stored by the plugin landed `title.length + 2` chars short
   * of the canonical frame and the other clients mis-rendered them.
   */
  private resolveCanonicalBasisForCurrentPost():
    | { title?: string; includeTitlePrefix: boolean }
    | undefined {
    const post = this.context.posts[this.currentIndex];
    if (!post) return undefined;
    const profile = this.resolveRenderProfileForCurrentPost();
    if (!profile) return undefined;
    const includeTitlePrefix = RENDER_PROFILE_CONFIG[profile]?.includeTitlePrefix ?? false;
    const rawTitle = (post.title ?? '').trim();
    return {
      title: rawTitle.length > 0 ? rawTitle : undefined,
      includeTitlePrefix,
    };
  }

  // ---------- Highlight Text Search Helpers ----------

  /**
   * Find the end of YAML frontmatter (position after closing ---\n).
   */
  private findFrontmatterEnd(content: string): number {
    if (!content.startsWith('---')) return 0;
    const secondDash = content.indexOf('\n---', 3);
    if (secondDash < 0) return 0;
    // Move past the closing --- and newline
    const afterDash = secondDash + 4;
    return afterDash < content.length ? afterDash : content.length;
  }

  /**
   * Find text in the body portion of the file, using context for disambiguation.
   */
  private findTextInBody(body: string, text: string, contextBefore?: string, contextAfter?: string): number {
    let searchFrom = 0;
    let bestMatch = -1;

    while (true) {
      const idx = body.indexOf(text, searchFrom);
      if (idx < 0) break;

      // First match is the default fallback
      if (bestMatch < 0) bestMatch = idx;

      // Check context match for disambiguation
      if (contextBefore) {
        const before = body.substring(Math.max(0, idx - 30), idx);
        if (before.includes(contextBefore.slice(-10))) {
          return idx;
        }
      } else {
        return idx; // No context to match, use first occurrence
      }

      searchFrom = idx + 1;
    }

    return bestMatch;
  }

  /**
   * Parse ==text== highlights from a vault file to rebuild the highlights cache.
   * This handles highlights created in previous sessions (not yet in memory cache).
   */
  private async parseHighlightsFromVault(filePath: string): Promise<TextHighlight[]> {
    try {
      const vault = this.context.app.vault;
      const file = vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) return [];

      const content = await vault.read(file);
      const fmEnd = this.findFrontmatterEnd(content);
      const body = content.substring(fmEnd);

      const highlights: TextHighlight[] = [];
      // Match ==text== (including multi-line) but not === or ==- (horizontal rules, etc.)
      const regex = /==(?![-=])([\s\S]+?)==/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(body)) !== null) {
        const text = match[1]!;
        const startOffset = match.index;
        const now = new Date().toISOString();
        highlights.push({
          id: `hl_vault_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
          text,
          startOffset,
          endOffset: startOffset + text.length,
          color: 'yellow', // Default color for vault-parsed highlights
          contextBefore: body.substring(Math.max(0, startOffset - 30), startOffset),
          contextAfter: body.substring(startOffset + text.length, startOffset + text.length + 30),
          createdAt: now,
          updatedAt: now,
        });
      }
      return highlights;
    } catch {
      return [];
    }
  }

  // ---------- Typography ----------

  /**
   * Load all typography settings from Obsidian localStorage, with validation.
   */
  private loadTypographyState(): ReaderTypographyState {
    const app = this.context.app;

    // Font size (backward compatible with existing key)
    const rawFs = app.loadLocalStorage(ReaderModeOverlay.FONT_SIZE_KEY) as unknown;
    let fontSize = FONT_SIZE.default;
    if (rawFs !== null && rawFs !== undefined) {
      const n = Number(rawFs);
      if (Number.isFinite(n)) fontSize = Math.max(FONT_SIZE.min, Math.min(FONT_SIZE.max, Math.round(n)));
    }

    // Content width
    const rawCw = app.loadLocalStorage(ReaderModeOverlay.CONTENT_WIDTH_KEY) as unknown;
    let contentWidth = CONTENT_WIDTH_DEFAULT;
    if (rawCw !== null && rawCw !== undefined) {
      const n = Number(rawCw);
      if (Number.isFinite(n)) {
        contentWidth = (CONTENT_WIDTH_PRESETS as readonly number[]).includes(n)
          ? n
          : this.snapToContentWidthPreset(n);
      }
    }

    // Line height
    const rawLh = app.loadLocalStorage(ReaderModeOverlay.LINE_HEIGHT_KEY) as unknown;
    let lineHeight = LINE_HEIGHT.default;
    if (rawLh !== null && rawLh !== undefined) {
      const n = Number(rawLh);
      if (Number.isFinite(n)) {
        lineHeight = Math.max(LINE_HEIGHT.min, Math.min(LINE_HEIGHT.max,
          Math.round(n / LINE_HEIGHT.step) * LINE_HEIGHT.step));
        lineHeight = parseFloat(lineHeight.toFixed(2));
      }
    }

    // Letter spacing
    const rawLs = app.loadLocalStorage(ReaderModeOverlay.LETTER_SPACING_KEY) as unknown;
    let letterSpacing = LETTER_SPACING.default;
    if (rawLs !== null && rawLs !== undefined) {
      const n = Number(rawLs);
      if (Number.isFinite(n)) {
        letterSpacing = Math.max(LETTER_SPACING.min, Math.min(LETTER_SPACING.max,
          Math.round(n / LETTER_SPACING.step) * LETTER_SPACING.step));
        letterSpacing = parseFloat(letterSpacing.toFixed(3));
      }
    }

    // Font family
    const rawFf = app.loadLocalStorage(ReaderModeOverlay.FONT_FAMILY_KEY) as unknown;
    let fontFamily: ReaderFontFamilyKey = FONT_FAMILY_DEFAULT;
    if (rawFf !== null && rawFf !== undefined && typeof rawFf === 'string') {
      const valid = FONT_FAMILIES.some(f => f.key === rawFf);
      if (valid) fontFamily = rawFf as ReaderFontFamilyKey;
    }

    return { fontSize, contentWidth, lineHeight, letterSpacing, fontFamily };
  }

  /**
   * Apply all typography CSS variables to the reader container.
   * This is the ONLY thing that changes on typography updates - no body re-render.
   */
  private applyTypography(): void {
    if (!this.container) return;
    const s = this.typographyState;
    const fontStack = FONT_FAMILIES.find(f => f.key === s.fontFamily)?.stack ?? 'inherit';
    this.container.setCssProps({
      '--reader-font-size': `${s.fontSize}px`,
      '--reader-content-width': `${s.contentWidth}px`,
      '--reader-line-height': String(s.lineHeight),
      '--reader-letter-spacing': `${s.letterSpacing}em`,
      '--reader-font-family': fontStack,
    });
  }

  /**
   * Persist all typography settings to Obsidian localStorage.
   */
  private saveTypographyState(): void {
    const app = this.context.app;
    const s = this.typographyState;
    app.saveLocalStorage(ReaderModeOverlay.FONT_SIZE_KEY, String(s.fontSize));
    app.saveLocalStorage(ReaderModeOverlay.CONTENT_WIDTH_KEY, String(s.contentWidth));
    app.saveLocalStorage(ReaderModeOverlay.LINE_HEIGHT_KEY, String(s.lineHeight));
    app.saveLocalStorage(ReaderModeOverlay.LETTER_SPACING_KEY, String(s.letterSpacing));
    app.saveLocalStorage(ReaderModeOverlay.FONT_FAMILY_KEY, s.fontFamily);
  }

  /**
   * Handle a partial typography change from the panel.
   * Validates, clamps, persists, and applies CSS variables without re-rendering.
   */
  private handleTypographyChange(patch: Partial<ReaderTypographyState>): void {
    const s = this.typographyState;

    if (patch.fontSize !== undefined) {
      s.fontSize = Math.max(FONT_SIZE.min, Math.min(FONT_SIZE.max, Math.round(patch.fontSize)));
    }
    if (patch.contentWidth !== undefined) {
      s.contentWidth = (CONTENT_WIDTH_PRESETS as readonly number[]).includes(patch.contentWidth)
        ? patch.contentWidth
        : this.snapToContentWidthPreset(patch.contentWidth);
    }
    if (patch.lineHeight !== undefined) {
      const raw = patch.lineHeight;
      const stepped = Math.round(raw / LINE_HEIGHT.step) * LINE_HEIGHT.step;
      s.lineHeight = Math.max(LINE_HEIGHT.min, Math.min(LINE_HEIGHT.max, parseFloat(stepped.toFixed(2))));
    }
    if (patch.letterSpacing !== undefined) {
      const raw = patch.letterSpacing;
      const stepped = Math.round(raw / LETTER_SPACING.step) * LETTER_SPACING.step;
      s.letterSpacing = Math.max(LETTER_SPACING.min, Math.min(LETTER_SPACING.max, parseFloat(stepped.toFixed(3))));
    }
    if (patch.fontFamily !== undefined) {
      const valid = FONT_FAMILIES.some(f => f.key === patch.fontFamily);
      if (valid) s.fontFamily = patch.fontFamily!;
    }

    // Keep legacy field in sync
    this.fontSize = s.fontSize;

    this.saveTypographyState();
    this.applyTypography();

    // Update the panel UI to reflect validated values
    this.typographyPanel?.updateState(s);
  }

  /**
   * Reset all typography to defaults, persist, and apply.
   */
  private resetTypography(): void {
    this.typographyState = {
      fontSize: FONT_SIZE.default,
      contentWidth: CONTENT_WIDTH_DEFAULT,
      lineHeight: LINE_HEIGHT.default,
      letterSpacing: LETTER_SPACING.default,
      fontFamily: FONT_FAMILY_DEFAULT,
    };
    this.fontSize = this.typographyState.fontSize;
    this.saveTypographyState();
    this.applyTypography();
    this.typographyPanel?.updateState(this.typographyState);
  }

  /**
   * Toggle the typography panel open/closed.
   */
  private toggleTypographyPanel(anchorEl: HTMLElement): void {
    if (this.typographyPanelOpen) {
      this.closeTypographyPanel();
    } else {
      this.openTypographyPanel(anchorEl);
    }
  }

  private openTypographyPanel(anchorEl: HTMLElement): void {
    if (this.typographyPanelOpen || !this.container) return;

    this.typographyPanelOpen = true;
    this.typographyPanel = new ReaderTypographyPanel({
      anchorEl,
      containerEl: this.container,
      state: { ...this.typographyState },
      onChange: (patch) => this.handleTypographyChange(patch),
      onReset: () => this.resetTypography(),
      onClose: () => this.closeTypographyPanel(),
    });
    this.typographyPanel.open();

    // Update the Aa button active state
    anchorEl.classList.add('sa-reader-typography-button-active');
    anchorEl.setAttribute('aria-expanded', 'true');
  }

  private closeTypographyPanel(): void {
    if (!this.typographyPanelOpen) return;
    this.typographyPanelOpen = false;
    this.typographyPanel?.destroy();
    this.typographyPanel = null;

    // Update the Aa button active state (if still in DOM)
    const aaBtn = this.container?.querySelector('.sa-reader-typography-button');
    if (aaBtn) {
      aaBtn.classList.remove('sa-reader-typography-button-active');
      aaBtn.setAttribute('aria-expanded', 'false');
    }
  }

  /**
   * Legacy font size change handler (still called by callbacks.onFontSizeChange).
   * Delegates to the typography change handler.
   */
  private changeFontSize(delta: number): void {
    this.handleTypographyChange({ fontSize: this.typographyState.fontSize + delta });
  }

  private snapToContentWidthPreset(value: number): number {
    return [...CONTENT_WIDTH_PRESETS].reduce((closest, preset) =>
      Math.abs(preset - value) < Math.abs(closest - value) ? preset : closest
    );
  }

  // ---------- Rendering ----------

  private async renderCurrentPost(): Promise<void> {
    if (!this.panel) return;

    const posts = this.context.posts;
    const total = posts.length;
    const post = posts[this.currentIndex];
    if (!post) return;

    // Create a fresh Component-based renderer for this specific render
    // This isolates MarkdownRenderer lifecycle per render
    this.activeRenderer = new ReaderModeContentRenderer(
      this.context.app,
      this.context.plugin,
      this.context.mediaGalleryRenderer,
      this.context.linkPreviewRenderer,
    );
    this.activeRenderer.load();

    // Determine subscription status for badge
    const subscriptionStatus = this.getSubscriptionStatus(post);

    // Get cached highlights for this post; if empty, parse from vault file ==text==
    const postKey = post.filePath || post.id;
    let highlights = this.highlightsCache.get(postKey) || [];
    if (highlights.length === 0 && post.filePath) {
      highlights = await this.parseHighlightsFromVault(post.filePath);
      if (highlights.length > 0) {
        this.highlightsCache.set(postKey, highlights);
      }
    }

    await this.activeRenderer.render(
      this.panel,
      post,
      this.currentIndex,
      total,
      {
        onClose: () => this.close(),
        onFontSizeChange: (delta) => this.changeFontSize(delta),
        onArchive: () => { void this.archiveAndAdvance(); },
        onToggleLike: () => void this.toggleLike(post),
        onShare: () => void this.sharePost(post),
        onTag: () => this.tagPost(post),
        onOpenNote: () => this.openNote(post),
        onEdit: () => this.editPost(post),
        onDelete: () => void this.deletePost(post),
        currentFontSize: this.fontSize,
        onTypographyToggle: (anchorEl) => this.toggleTypographyPanel(anchorEl),
        isTypographyOpen: () => this.typographyPanelOpen,
        isArchived: !!post.archive,
        isLiked: !!post.like,
        isShared: !!post.shareUrl,
        hasTags: (post.tags?.length ?? 0) > 0,
        showEdit: post.platform === 'post',
        hasComment: !!post.comment,
        onComment: () => this.openCommentModal(post),
        subscriptionStatus,
        onSubscribe: () => void this.subscribeAuthor(post),
        onUnsubscribe: () => void this.unsubscribeAuthor(post),
        ttsController: this.ttsController ?? undefined,
        hasHighlights: highlights.length > 0,
        highlightCount: highlights.length,
        onBodyRendered: (bodyEl, plainText) => {
          // Detach previous and attach highlight manager to new body element
          this.highlightManager?.detach();
          this.highlightManager?.attach(bodyEl, plainText, highlights);
        },
      },
    );
  }

  private cleanupRenderer(): void {
    if (this.activeRenderer) {
      this.activeRenderer.unload();
      this.activeRenderer = null;
    }
  }

  /**
   * Re-render the current post while preserving the scroll position.
   * Used when the post data changes in-place (tag, like, share, font size, etc.)
   * but we want the reader to stay where they were reading.
   */
  private async reRenderPreservingScroll(): Promise<void> {
    // Capture current scroll position before destroying DOM
    const scrollEl = this.panel?.querySelector('.sa-reader-mode-scroll');
    const savedScroll = scrollEl ? scrollEl.scrollTop : 0;

    this.cleanupRenderer();
    await this.renderCurrentPost();

    // Restore scroll position after DOM is rebuilt
    if (savedScroll > 0) {
      const newScrollEl = this.panel?.querySelector('.sa-reader-mode-scroll');
      if (newScrollEl) {
        newScrollEl.scrollTop = savedScroll;
      }
    }
  }

  // ---------- Subscription ----------

  /**
   * Determine subscription status for the subscribe badge.
   * Returns 'hidden' for platforms that don't support subscriptions.
   */
  private getSubscriptionStatus(post: PostData): 'subscribed' | 'not-subscribed' | 'hidden' {
    if (!this.context.isAuthorSubscribed || !post.author.url) return 'hidden';

    // Same platform eligibility check as PostCardRenderer
    const isRedditSubreddit = post.platform === 'reddit' && post.author.url?.includes('/r/');
    const isRedditUser = post.platform === 'reddit' && (post.author.url?.includes('/user/') || post.author.url?.includes('/u/'));
    const supported =
      post.platform === 'instagram' ||
      post.platform === 'facebook' ||
      post.platform === 'linkedin' ||
      post.platform === 'tiktok' ||
      post.platform === 'pinterest' ||
      post.platform === 'bluesky' ||
      post.platform === 'mastodon' ||
      post.platform === 'youtube' ||
      post.platform === 'naver' ||
      post.platform === 'brunch' ||
      post.platform === 'blog' ||
      post.platform === 'substack' ||
      post.platform === 'tumblr' ||
      post.platform === 'velog' ||
      post.platform === 'medium' ||
      post.platform === 'podcast' ||
      post.platform === 'x' ||
      isRedditSubreddit ||
      isRedditUser;

    if (!supported) return 'hidden';

    return this.context.isAuthorSubscribed(post.author.url, post.platform) ? 'subscribed' : 'not-subscribed';
  }

  private async subscribeAuthor(post: PostData): Promise<void> {
    if (!this.context.onSubscribeAuthor) return;
    try {
      await this.context.onSubscribeAuthor(post);
      this.dirty = true;
      await this.reRenderPreservingScroll();
    } catch (err) {
      console.error('[Social Archiver] Subscribe failed:', err);
    }
  }

  private async unsubscribeAuthor(post: PostData): Promise<void> {
    if (!this.context.onUnsubscribeAuthor) return;
    try {
      await this.context.onUnsubscribeAuthor(post);
      this.dirty = true;
      await this.reRenderPreservingScroll();
    } catch (err) {
      console.error('[Social Archiver] Unsubscribe failed:', err);
    }
  }

  // ---------- TTS ----------

  /**
   * Create the TTS provider based on settings.
   * Delegates to shared resolveTTSProvider utility.
   */
  private resolveProvider(): PluginTTSProvider | null {
    const resolved = resolveTTSProvider(this.context.plugin.settings, this.context.plugin.manifest.version);
    if (!resolved) return null;
    this.ttsController?.setFallbackProvider(resolved.fallback);
    return resolved.primary;
  }

  // ---------- Utilities ----------

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}
