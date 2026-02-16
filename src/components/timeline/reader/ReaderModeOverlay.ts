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

import { TFile, Notice, setIcon, type App } from 'obsidian';
import type { PostData } from '../../../types/post';
import type SocialArchiverPlugin from '../../../main';
import { MediaGalleryRenderer } from '../renderers/MediaGalleryRenderer';
import { LinkPreviewRenderer } from '../renderers/LinkPreviewRenderer';
import { ReaderModeContentRenderer } from './ReaderModeContentRenderer';
import { ReaderModeGestureHandler } from './ReaderModeGestureHandler';

export interface ReaderModeContext {
  posts: PostData[];
  currentIndex: number;
  app: App;
  plugin: SocialArchiverPlugin;
  mediaGalleryRenderer: MediaGalleryRenderer;
  linkPreviewRenderer: LinkPreviewRenderer;
  onUIModify?: (filePath: string) => void;
  onUIDelete?: (filePath: string) => void;
  onClose?: (dirty: boolean) => void;
  onShare?: (post: PostData) => Promise<void>;
  onEdit?: (post: PostData) => void;
  onDelete?: (post: PostData) => Promise<void>;
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

  // Keyboard handler ref
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Animation state
  private transitioning = false;
  private _isActive = false;

  // Track whether any archive state was changed during the session
  private dirty = false;

  // Track whether a child modal (e.g. TagModal) is open — suppress keys while true
  private modalOpen = false;

  // Font size state
  private static readonly FONT_SIZE_KEY = 'social-archiver-reader-font-size';
  private static readonly MIN_FONT = 14;
  private static readonly MAX_FONT = 28;
  private fontSize: number;

  // Safe-area fallback listeners (for Android WebView where env() may resolve to 0)
  private viewportSafeAreaListener: (() => void) | null = null;
  private attachedVisualViewport: VisualViewport | null = null;

  constructor(context: ReaderModeContext) {
    this.context = context;
    this.currentIndex = context.currentIndex;

    // Restore persisted font size
    const stored = localStorage.getItem(ReaderModeOverlay.FONT_SIZE_KEY);
    this.fontSize = stored ? Math.max(ReaderModeOverlay.MIN_FONT, Math.min(ReaderModeOverlay.MAX_FONT, Number(stored))) : 19;
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
    this.backdrop.className = 'reader-mode-backdrop';
    this.backdrop.addEventListener('click', () => this.close());
    document.body.appendChild(this.backdrop);

    // Create container
    this.container = document.createElement('div');
    this.container.className = 'reader-mode-container';
    document.body.appendChild(this.container);
    this.setupSafeAreaFallback();

    // Apply persisted font size
    this.applyFontSize();

    // Single panel
    this.panel = this.container.createDiv({ cls: 'reader-mode-panel-wrapper' });

    // Keyboard handler (register early so ESC always works)
    this.keyHandler = (e: KeyboardEvent) => {
      // Skip when a child modal (e.g. TagModal) is open so ESC only closes the modal
      if (this.modalOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.navigate(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.navigate(1);
      } else if (e.code === 'KeyA') {
        e.preventDefault();
        this.archiveAndAdvance();
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
      this.backdrop?.addClass('reader-mode-backdrop-visible');
      this.container?.addClass('reader-mode-container-visible');
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
        onSwipeLeft: () => this.navigate(1, true),
        onSwipeRight: () => this.navigate(-1, true),
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

    // Cleanup active renderer
    this.cleanupRenderer();

    // Cleanup safe-area fallback listeners
    this.teardownSafeAreaFallback();

    // Animate out then remove
    this.backdrop?.removeClass('reader-mode-backdrop-visible');
    this.container?.removeClass('reader-mode-container-visible');

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
      this.context.onClose?.(wasDirty);
    };

    if (this.container) {
      this.container.addEventListener('transitionend', onTransitionEnd, { once: true });
      setTimeout(onTransitionEnd, 400); // Fallback if transitionend doesn't fire
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
      const topInset = Math.max(0, Math.round(viewport?.offsetTop ?? 0));

      let bottomInset = 0;
      if (viewport) {
        const layoutHeight = window.innerHeight || document.documentElement.clientHeight;
        const viewportBottom = viewport.offsetTop + viewport.height;
        bottomInset = Math.max(0, Math.round(layoutHeight - viewportBottom));

        // Ignore keyboard-driven viewport shrink; we only want system UI inset.
        if (bottomInset > 120) bottomInset = 0;
      }

      this.container.style.setProperty('--reader-safe-area-top-fallback', `${topInset}px`);
      this.container.style.setProperty('--reader-safe-area-bottom-fallback', `${bottomInset}px`);
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

    this.viewportSafeAreaListener = null;
    this.attachedVisualViewport = null;
  }

  // ---------- Navigation ----------

  /**
   * @param fromSwipe true when triggered by swipe gesture (panel already offset)
   */
  private async navigate(direction: -1 | 1, fromSwipe = false): Promise<void> {
    if (this.transitioning) return;

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
        this.panel.style.transition = 'transform 0.18s ease-out, opacity 0.12s ease-out';
        this.panel.style.transform = `translateX(${direction === 1 ? '-100%' : '100%'})`;
        this.panel.style.opacity = '0';
      }
      await this.wait(180);
    } else {
      // Keyboard / button: subtle slide + fade
      if (this.panel) {
        this.panel.style.transition = 'transform 0.2s ease-in, opacity 0.2s ease-in';
        this.panel.style.transform = `translateX(${direction === 1 ? '-60px' : '60px'})`;
        this.panel.style.opacity = '0';
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
      this.panel.style.transition = 'none';
      this.panel.style.transform = `translateX(${direction === 1 ? enterOffset : `-${enterOffset}`})`;
      this.panel.style.opacity = '0';

      // Force reflow
      void this.panel.offsetHeight;

      const enterDuration = fromSwipe ? '0.22s' : '0.25s';
      this.panel.style.transition = `transform ${enterDuration} ease-out, opacity ${enterDuration} ease-out`;
      this.panel.style.transform = 'translateX(0)';
      this.panel.style.opacity = '1';
    }

    await this.wait(fromSwipe ? 220 : 250);
    this.transitioning = false;
  }

  private bounceEdge(direction: 1 | -1): void {
    if (!this.panel) return;

    this.panel.style.transition = 'transform 0.15s ease-out';
    this.panel.style.transform = `translateX(${direction * 20}px)`;

    setTimeout(() => {
      if (!this.panel) return;
      this.panel.style.transition = 'transform 0.2s ease-in';
      this.panel.style.transform = 'translateX(0)';
    }, 150);
  }

  // ---------- Swipe Handling ----------

  private onSwipeProgress(progress: number): void {
    if (!this.panel || this.transitioning) return;
    this.panel.style.transition = 'none';
    this.panel.style.transform = `translateX(${progress * 100}vw)`;
    // Fade slightly during drag
    this.panel.style.opacity = String(Math.max(0.3, 1 - Math.abs(progress) * 1.5));
  }

  private onSwipeCancel(): void {
    if (!this.panel) return;
    this.panel.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
    this.panel.style.transform = 'translateX(0)';
    this.panel.style.opacity = '1';
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

      const content = await vault.read(file);
      const newArchiveStatus = !post.archive;

      // Update YAML frontmatter
      const updatedContent = this.updateFrontmatterArchive(content, newArchiveStatus);

      // Notify UI-modify to prevent timeline refresh
      this.context.onUIModify?.(filePath);

      await vault.modify(file, updatedContent);
      post.archive = newArchiveStatus;
      this.dirty = true;

      return newArchiveStatus;
    } catch {
      console.error('[Social Archiver] Failed to toggle archive');
      return null;
    }
  }

  private updateFrontmatterArchive(content: string, archive: boolean): string {
    return this.updateFrontmatterField(content, 'archive', archive);
  }

  private updateFrontmatterField(content: string, field: string, value: boolean): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);
    if (!match || !match[1]) return content;

    const fm = match[1];
    const fieldRegex = new RegExp(`^${field}:\\s*.*`, 'm');

    let updatedFm: string;
    if (fieldRegex.test(fm)) {
      updatedFm = fm.replace(fieldRegex, `${field}: ${value}`);
    } else {
      updatedFm = fm + `\n${field}: ${value}`;
    }

    return content.replace(frontmatterRegex, `---\n${updatedFm}\n---\n`);
  }

  // ---------- Toggle Like ----------

  private async toggleLike(post: PostData): Promise<void> {
    try {
      const filePath = post.filePath;
      if (!filePath) return;

      const vault = this.context.app.vault;
      const file = vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) return;

      const content = await vault.read(file);
      const newLikeStatus = !post.like;

      const updatedContent = this.updateFrontmatterField(content, 'like', newLikeStatus);

      this.context.onUIModify?.(filePath);
      await vault.modify(file, updatedContent);
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

    import('../modals/TagModal').then(({ TagModal }) => {
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
        setTimeout(() => { this.modalOpen = false; }, 0);
      };

      modal.open();

      // Ensure modal appears above reader mode overlay (z-index 1000)
      requestAnimationFrame(() => {
        const containerEl = modal.containerEl;
        if (containerEl) {
          containerEl.style.zIndex = '1001';
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
    leaf.openFile(file);
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
      try {
        await this.context.onDelete(post);
      } finally {
        setTimeout(() => { this.modalOpen = false; }, 0);
      }
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
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 1001;
      background: var(--background-modifier-cover);
      display: flex; align-items: center; justify-content: center;
    `;

    // Modal container
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 12px;
      width: min(480px, 92vw);
      max-height: 80vh;
      display: flex; flex-direction: column;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px 10px; border-bottom: 1px solid var(--background-modifier-border);
    `;
    const title = document.createElement('div');
    title.style.cssText = 'font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px;';
    const titleIcon = document.createElement('span');
    titleIcon.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center;';
    setIcon(titleIcon, 'message-square-text');
    title.appendChild(titleIcon);
    title.appendChild(document.createTextNode(post.comment ? 'Edit Note' : 'Add Note'));
    header.appendChild(title);

    const closeBtn = document.createElement('div');
    closeBtn.style.cssText = `
      cursor: pointer; width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 4px; color: var(--text-muted);
    `;
    closeBtn.setAttribute('title', 'Close (Escape)');
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'var(--background-modifier-hover)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = ''; });
    header.appendChild(closeBtn);

    // Textarea
    const body = document.createElement('div');
    body.style.cssText = 'padding: 12px 16px; flex: 1;';
    const textarea = document.createElement('textarea');
    textarea.value = post.comment || '';
    textarea.placeholder = 'Write a personal note about this post...';
    textarea.style.cssText = `
      width: 100%; min-height: 120px; max-height: 300px;
      resize: vertical; padding: 10px 12px;
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px; color: var(--text-normal);
      font-size: 14px; line-height: 1.6;
      font-family: inherit; outline: none;
    `;
    textarea.addEventListener('focus', () => { textarea.style.borderColor = 'var(--interactive-accent)'; });
    textarea.addEventListener('blur', () => { textarea.style.borderColor = 'var(--background-modifier-border)'; });
    body.appendChild(textarea);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 16px 14px;
      border-top: 1px solid var(--background-modifier-border);
    `;
    const hint = document.createElement('span');
    hint.style.cssText = 'font-size: 11px; color: var(--text-muted);';
    hint.textContent = 'Cmd/Ctrl+Enter to save';
    footer.appendChild(hint);

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display: flex; gap: 8px;';

    // Delete button (only if comment exists)
    if (post.comment) {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.cssText = `
        padding: 6px 14px; border-radius: 6px; font-size: 13px; cursor: pointer;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary); color: var(--text-error);
      `;
      deleteBtn.addEventListener('click', () => void handleSave(''));
      btnGroup.appendChild(deleteBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 6px 14px; border-radius: 6px; font-size: 13px; cursor: pointer;
      border: 1px solid var(--background-modifier-border);
      background: var(--background-secondary); color: var(--text-normal);
    `;

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = `
      padding: 6px 14px; border-radius: 6px; font-size: 13px; cursor: pointer;
      border: none; background: var(--interactive-accent); color: var(--text-on-accent);
    `;

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
      setTimeout(() => { this.modalOpen = false; }, 0);
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
        const content = await vault.read(tfile);
        const updatedContent = this.updateYamlComment(content, newComment || null);

        this.context.onUIModify?.(filePath);
        await vault.modify(tfile, updatedContent);
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

  /**
   * Update the `comment` field in YAML frontmatter.
   * Null removes the field; a string sets/adds it.
   */
  private updateYamlComment(content: string, comment: string | null): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);
    if (!match || !match[1]) return content;

    const lines = match[1].split('\n');
    const restContent = content.slice(match[0].length);
    const updatedLines: string[] = [];
    let found = false;

    for (const line of lines) {
      const keyMatch = line.match(/^comment:/);
      if (keyMatch) {
        found = true;
        if (comment) {
          updatedLines.push(`comment: ${JSON.stringify(comment)}`);
        }
        // else: skip line to remove
      } else {
        updatedLines.push(line);
      }
    }

    // Add if not found and value is non-null
    if (!found && comment) {
      updatedLines.push(`comment: ${JSON.stringify(comment)}`);
    }

    return `---\n${updatedLines.join('\n')}\n---\n${restContent}`;
  }

  // ---------- Font Size ----------

  private applyFontSize(): void {
    if (this.container) {
      this.container.style.setProperty('--reader-font-size', `${this.fontSize}px`);
    }
  }

  private changeFontSize(delta: number): void {
    const next = this.fontSize + delta;
    if (next < ReaderModeOverlay.MIN_FONT || next > ReaderModeOverlay.MAX_FONT) return;
    this.fontSize = next;
    this.applyFontSize();
    localStorage.setItem(ReaderModeOverlay.FONT_SIZE_KEY, String(this.fontSize));
    // Re-render to update the font label in header
    this.reRenderPreservingScroll().catch(console.error);
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

    await this.activeRenderer.render(
      this.panel,
      post,
      this.currentIndex,
      total,
      {
        onClose: () => this.close(),
        onFontSizeChange: (delta) => this.changeFontSize(delta),
        onArchive: () => this.archiveAndAdvance(),
        onToggleLike: () => void this.toggleLike(post),
        onShare: () => void this.sharePost(post),
        onTag: () => this.tagPost(post),
        onOpenNote: () => this.openNote(post),
        onEdit: () => this.editPost(post),
        onDelete: () => void this.deletePost(post),
        currentFontSize: this.fontSize,
        isArchived: !!post.archive,
        isLiked: !!post.like,
        isShared: !!(post as any).shareUrl,
        hasTags: (post.tags?.length ?? 0) > 0,
        showEdit: post.platform === 'post',
        hasComment: !!post.comment,
        onComment: () => this.openCommentModal(post),
        subscriptionStatus,
        onSubscribe: () => void this.subscribeAuthor(post),
        onUnsubscribe: () => void this.unsubscribeAuthor(post),
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
    const scrollEl = this.panel?.querySelector('.reader-mode-scroll');
    const savedScroll = scrollEl ? scrollEl.scrollTop : 0;

    this.cleanupRenderer();
    await this.renderCurrentPost();

    // Restore scroll position after DOM is rebuilt
    if (savedScroll > 0) {
      const newScrollEl = this.panel?.querySelector('.reader-mode-scroll');
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

  // ---------- Utilities ----------

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
