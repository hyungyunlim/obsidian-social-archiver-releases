import { setIcon, MarkdownRenderer, Platform } from 'obsidian';
import type { Component } from 'obsidian';
import type { AICommentMeta, AICli } from '../../../types/ai-comment';
import { COMMENT_TYPE_DISPLAY_NAMES } from '../../../types/ai-comment';

/**
 * Options for AICommentRenderer
 */
export interface AICommentRendererOptions {
  /** AI comment metadata array */
  comments: AICommentMeta[];
  /** Map of comment ID to comment text content */
  commentTexts: Map<string, string>;
  /** Callback when delete button is clicked */
  onDelete: (id: string) => Promise<void>;
  /** Callback when "Add more" button is clicked */
  onAddMore: () => void;
  /** Start collapsed (default: false for new inline style) */
  startCollapsed?: boolean;
  /** Obsidian component for markdown rendering lifecycle */
  component?: Component;
  /** Source path for markdown links */
  sourcePath?: string;
  /** Callback when a timestamp is clicked (for podcast/video seeking) */
  onTimestampClick?: (seconds: number) => void;
  /** Callback when apply reformat button is clicked (for reformat type only) */
  onApplyReformat?: (id: string, newContent: string) => Promise<void>;
}

/**
 * CLI display icons (emoji style for avatar)
 */
const CLI_ICONS: Record<AICli, string> = {
  claude: '🤖',
  gemini: '✨',
  codex: '💡',
};

/**
 * CLI display names
 */
const CLI_NAMES: Record<AICli, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  codex: 'Codex',
};

/**
 * AICommentRenderer - Renders AI-generated comments in Instagram-style (same as regular comments)
 * Single Responsibility: Display AI comments like regular user comments
 *
 * Features:
 * - Renders exactly like regular user comments (Instagram style)
 * - **Name** content format (inline)
 * - Type badge and timestamp inline
 * - Delete button on hover
 * - Add more button on last comment
 * - Copy on double-click
 */
export class AICommentRenderer {
  private container: HTMLElement | null = null;
  private commentsListEl: HTMLElement | null = null;
  private comments: AICommentMeta[] = [];
  private commentTexts: Map<string, string> = new Map();
  private onDelete: ((id: string) => Promise<void>) | null = null;
  private onAddMore: (() => void) | null = null;
  private component: Component | null = null;
  private sourcePath: string = '';
  private onTimestampClick: ((seconds: number) => void) | null = null;
  private onApplyReformat: ((id: string, newContent: string) => Promise<void>) | null = null;

  /**
   * Render AI comments component (Instagram style, same as regular comments)
   */
  render(container: HTMLElement, options: AICommentRendererOptions): void {
    this.container = container;
    this.comments = options.comments;
    this.commentTexts = options.commentTexts;
    this.onDelete = options.onDelete;
    this.onAddMore = options.onAddMore;
    this.component = options.component ?? null;
    this.sourcePath = options.sourcePath ?? '';
    this.onTimestampClick = options.onTimestampClick ?? null;
    this.onApplyReformat = options.onApplyReformat ?? null;

    if (this.comments.length === 0) {
      return;
    }

    // Main container - simple list matching regular comments
    const commentSection = container.createDiv({ cls: 'ai-comment-viewer' });
    commentSection.style.cssText = `
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--background-modifier-border);
    `;

    // Comments list
    this.commentsListEl = commentSection.createDiv({ cls: 'ai-comments-list' });
    this.commentsListEl.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    this.renderComments(this.commentsListEl);
  }

  /**
   * Render all comments
   */
  private renderComments(parent: HTMLElement): void {
    for (let i = 0; i < this.comments.length; i++) {
      const comment = this.comments[i];
      if (!comment) continue;

      const text = this.commentTexts.get(comment.id) ?? '';
      const isLast = i === this.comments.length - 1;
      this.renderComment(parent, comment, text, isLast);
    }
  }

  /**
   * Render a single comment (Instagram style - same as regular comments)
   * Format: **Name** content · Type · Date [delete] [+]
   */
  private renderComment(
    parent: HTMLElement,
    meta: AICommentMeta,
    text: string,
    isLast: boolean
  ): HTMLElement {
    const commentDiv = parent.createDiv({
      cls: 'ai-comment-item',
      attr: { 'data-comment-id': meta.id },
    });
    // Subtle styling: faint background only
    commentDiv.style.cssText = `
      font-size: 13px;
      line-height: 1.5;
      background: color-mix(in srgb, var(--background-secondary) 50%, transparent);
      border-radius: 4px;
      padding: 6px 8px;
    `;

    // Header line: **name** · type · date · buttons
    const headerLine = commentDiv.createDiv({ cls: 'ai-comment-header' });
    headerLine.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 4px;';

    // Sparkles icon (Lucide)
    const aiIcon = headerLine.createSpan({ cls: 'ai-comment-icon' });
    aiIcon.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      color: var(--interactive-accent);
      opacity: 0.8;
    `;
    setIcon(aiIcon, 'sparkles');

    // CLI name (bold, like username)
    const nameSpan = headerLine.createEl('strong');
    nameSpan.style.cssText = 'font-weight: 600; color: var(--text-normal);';
    nameSpan.textContent = CLI_NAMES[meta.cli] || meta.cli;

    // Separator after name
    headerLine.createSpan({ text: '·' }).style.cssText = 'color: var(--text-faint);';

    // Type badge
    const typeSpan = headerLine.createSpan();
    typeSpan.style.cssText = 'font-size: 11px; color: var(--text-muted); padding: 1px 6px; background: var(--background-modifier-hover); border-radius: 4px;';
    typeSpan.textContent = COMMENT_TYPE_DISPLAY_NAMES[meta.type] || meta.type;

    // Separator
    headerLine.createSpan({ text: '·' }).style.cssText = 'color: var(--text-faint);';

    // Date
    const dateSpan = headerLine.createSpan();
    dateSpan.style.cssText = 'font-size: 12px; color: var(--text-muted);';
    dateSpan.textContent = this.formatDate(meta.generatedAt);

    // Spacer
    const spacer = headerLine.createSpan();
    spacer.style.flex = '1';

    // Add more button (only on last comment, hide on mobile since CLI not available)
    let addBtn: HTMLSpanElement | null = null;
    if (isLast && !Platform.isMobile) {
      addBtn = headerLine.createSpan({ cls: 'ai-comment-add-btn' });
      addBtn.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 4px;
        cursor: pointer;
        color: var(--text-muted);
        opacity: 0;
        transition: all 0.2s;
      `;
      setIcon(addBtn, 'plus');
      addBtn.setAttribute('title', 'Add another AI comment');

      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onAddMore?.();
      });

      addBtn.addEventListener('mouseenter', () => {
        if (addBtn) {
          addBtn.style.color = 'var(--interactive-accent)';
          addBtn.style.background = 'var(--background-modifier-hover)';
        }
      });
      addBtn.addEventListener('mouseleave', () => {
        if (addBtn) {
          addBtn.style.color = 'var(--text-muted)';
          addBtn.style.background = 'transparent';
        }
      });
    }

    // Apply button (for reformat type only)
    let applyBtn: HTMLSpanElement | null = null;
    if (meta.type === 'reformat' && this.onApplyReformat) {
      applyBtn = headerLine.createSpan({ cls: 'ai-comment-apply' });
      applyBtn.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 4px;
        cursor: pointer;
        color: var(--text-faint);
        opacity: 0;
        transition: all 0.2s;
      `;
      setIcon(applyBtn, 'check');
      applyBtn.setAttribute('aria-label', 'Apply to content');

      applyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (this.onApplyReformat) {
          // Show loading state
          applyBtn!.style.opacity = '0.5';
          applyBtn!.style.pointerEvents = 'none';
          try {
            await this.onApplyReformat(meta.id, text);
          } finally {
            if (applyBtn) {
              applyBtn.style.opacity = '1';
              applyBtn.style.pointerEvents = 'auto';
            }
          }
        }
      });

      applyBtn.addEventListener('mouseenter', () => {
        applyBtn!.style.color = 'var(--text-success)';
        applyBtn!.style.background = 'var(--background-modifier-success)';
      });
      applyBtn.addEventListener('mouseleave', () => {
        applyBtn!.style.color = 'var(--text-faint)';
        applyBtn!.style.background = 'transparent';
      });
    }

    // Delete button
    const deleteBtn = headerLine.createSpan({ cls: 'ai-comment-delete' });
    deleteBtn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      cursor: pointer;
      color: var(--text-faint);
      opacity: 0;
      transition: all 0.2s;
    `;
    setIcon(deleteBtn, 'trash-2');

    // Show buttons on hover
    commentDiv.addEventListener('mouseenter', () => {
      if (addBtn) addBtn.style.opacity = '1';
      if (applyBtn) applyBtn.style.opacity = '1';
      deleteBtn.style.opacity = '1';
    });
    commentDiv.addEventListener('mouseleave', () => {
      if (addBtn) addBtn.style.opacity = '0';
      if (applyBtn) applyBtn.style.opacity = '0';
      deleteBtn.style.opacity = '0';
    });

    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.handleDelete(meta.id, commentDiv);
    });

    deleteBtn.addEventListener('mouseenter', () => {
      deleteBtn.style.color = 'var(--text-error)';
      deleteBtn.style.background = 'var(--background-modifier-error)';
    });
    deleteBtn.addEventListener('mouseleave', () => {
      deleteBtn.style.color = 'var(--text-faint)';
      deleteBtn.style.background = 'transparent';
    });

    // Content area (separate line, allows proper text wrapping)
    const textContainer = commentDiv.createDiv({ cls: 'ai-comment-text-container' });

    const textSpan = textContainer.createDiv({ cls: 'ai-comment-text' });
    textSpan.style.cssText = 'color: var(--text-normal); line-height: 1.5;';

    // Plain text style - minimal markdown formatting
    textSpan.addClass('ai-comment-plain');
    const style = document.createElement('style');
    style.textContent = `
      .ai-comment-plain,
      .ai-comment-plain * {
        font-size: 13px !important;
        font-weight: normal !important;
        line-height: 1.5 !important;
      }
      .ai-comment-plain h1,
      .ai-comment-plain h2,
      .ai-comment-plain h3,
      .ai-comment-plain h4,
      .ai-comment-plain h5,
      .ai-comment-plain h6 {
        font-size: 13px !important;
        font-weight: 600 !important;
        margin-top: 1em !important;
        margin-bottom: 0.3em !important;
        padding: 0 !important;
        display: block !important;
      }
      .ai-comment-plain h1 {
        margin-top: 1.5em !important;
      }
      .ai-comment-plain h2 {
        margin-top: 1.2em !important;
      }
      .ai-comment-plain > h1:first-child,
      .ai-comment-plain > h2:first-child,
      .ai-comment-plain > h3:first-child,
      .ai-comment-plain > p:first-child + h1,
      .ai-comment-plain > p:first-child + h2,
      .ai-comment-plain > p:first-child + h3 {
        margin-top: 0.5em !important;
      }
      .ai-comment-plain > *:first-child {
        margin-top: 0 !important;
      }
      .ai-comment-plain p {
        margin: 0.5em 0 !important;
      }
      .ai-comment-plain p:first-child {
        margin-top: 0 !important;
      }
      .ai-comment-plain ul,
      .ai-comment-plain ol {
        margin: 0.3em 0 !important;
        padding-left: 1.2em !important;
      }
      .ai-comment-plain li {
        margin: 0 !important;
        padding: 0 !important;
      }
      .ai-comment-plain li::marker {
        color: var(--text-muted) !important;
      }
      .ai-comment-plain table {
        font-size: 12px !important;
        margin: 0.5em 0 !important;
        border-collapse: collapse !important;
      }
      .ai-comment-plain th,
      .ai-comment-plain td {
        padding: 2px 6px !important;
        border: 1px solid var(--background-modifier-border) !important;
      }
      .ai-comment-plain th {
        font-weight: 600 !important;
        background: var(--background-secondary) !important;
      }
      .ai-comment-plain code {
        font-size: 12px !important;
        background: var(--background-secondary) !important;
        padding: 1px 4px !important;
        border-radius: 3px !important;
      }
      .ai-comment-plain blockquote {
        margin: 0.3em 0 !important;
        padding-left: 8px !important;
        border-left: 2px solid var(--text-faint) !important;
        color: var(--text-muted) !important;
      }
      .ai-comment-plain hr {
        margin: 0.5em 0 !important;
        border: none !important;
        border-top: 1px solid var(--background-modifier-border) !important;
      }
      .ai-comment-plain strong {
        font-weight: 600 !important;
      }
      .ai-comment-plain a {
        color: var(--text-accent) !important;
      }
    `;
    textSpan.appendChild(style);

    // Render markdown content
    if (this.component) {
      MarkdownRenderer.render(
        (window as any).app,
        text,
        textSpan,
        this.sourcePath,
        this.component
      );

      // Add click handlers for internal links (wiki links)
      this.addInternalLinkHandlers(textSpan);

      // Add click handlers for timestamps (for podcast/video seeking)
      this.addTimestampHandlers(textSpan);
    } else {
      // Fallback to plain text if no component
      textSpan.textContent = text;
    }

    // Check if text is long enough to need collapse (more than 600 chars for markdown)
    // Using higher threshold because markdown syntax inflates character count
    const isLongText = text.length > 600;
    let isExpanded = false;

    if (isLongText) {
      // Wrap textSpan in a container for proper fade effect
      const textWrapper = textContainer.createDiv({ cls: 'ai-comment-text-wrapper' });
      textWrapper.style.cssText = `
        position: relative;
        max-height: 12em;
        overflow: hidden;
      `;
      // Move textSpan into wrapper
      textWrapper.appendChild(textSpan);

      // Add gradient fade at bottom when collapsed
      const fadeOverlay = textWrapper.createDiv({ cls: 'ai-comment-fade' });
      fadeOverlay.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 2.5em;
        background: linear-gradient(to bottom, transparent 0%, var(--background-primary) 80%);
        pointer-events: none;
      `;

      // Add expand/collapse toggle
      const toggleBtn = textContainer.createSpan({ cls: 'ai-comment-toggle' });
      toggleBtn.style.cssText = `
        display: inline-block;
        color: var(--text-accent);
        cursor: pointer;
        font-size: 12px;
        margin-top: 4px;
      `;
      toggleBtn.textContent = 'Show more';

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;

        if (isExpanded) {
          textWrapper.style.maxHeight = 'none';
          textWrapper.style.overflow = 'visible';
          fadeOverlay.style.display = 'none';
          toggleBtn.textContent = 'Show less';
        } else {
          textWrapper.style.maxHeight = '12em'; // Same as initial collapsed height
          textWrapper.style.overflow = 'hidden';
          fadeOverlay.style.display = 'block';
          toggleBtn.textContent = 'Show more';
        }
      });

      toggleBtn.addEventListener('mouseenter', () => {
        toggleBtn.style.textDecoration = 'underline';
      });
      toggleBtn.addEventListener('mouseleave', () => {
        toggleBtn.style.textDecoration = 'none';
      });
    }

    return commentDiv;
  }

  /**
   * Handle delete with confirmation
   * Note: UI refresh is handled by PostCardRenderer.refreshPostCard after onDelete
   */
  private async handleDelete(id: string, element: HTMLElement): Promise<void> {
    // Simple confirmation
    const confirmed = window.confirm('Delete this AI comment?');
    if (!confirmed) return;

    // Visual feedback
    element.style.opacity = '0.5';
    element.style.pointerEvents = 'none';

    try {
      // onDelete callback will handle file update and UI refresh
      await this.onDelete?.(id);
      // Note: refreshPostCard will re-render the entire AI comments section
    } catch (error) {
      // Restore on error
      element.style.opacity = '1';
      element.style.pointerEvents = 'auto';
      console.error('[AICommentRenderer] Delete failed:', error);
    }
  }

  /**
   * Check if all comments removed and cleanup, or update + button on new last comment
   */
  private checkEmptyState(): void {
    const remainingItems = this.commentsListEl?.querySelectorAll('.ai-comment-item');
    const remaining = remainingItems?.length ?? 0;

    if (remaining === 0 && this.container) {
      // Remove the entire container when no comments left
      this.container.innerHTML = '';
    } else if (remaining > 0 && remainingItems && !Platform.isMobile) {
      // Add + button to the new last comment if not on mobile
      const lastItem = remainingItems[remaining - 1] as HTMLElement;
      const headerLine = lastItem?.querySelector('.ai-comment-header') as HTMLElement;

      // Check if + button already exists
      if (headerLine && !headerLine.querySelector('.ai-comment-add-btn')) {
        // Find the delete button to insert before it
        const deleteBtn = headerLine.querySelector('.ai-comment-delete');

        const addBtn = document.createElement('span');
        addBtn.className = 'ai-comment-add-btn';
        addBtn.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 4px;
          cursor: pointer;
          color: var(--text-muted);
          opacity: 0;
          transition: all 0.2s;
        `;
        setIcon(addBtn, 'plus');
        addBtn.setAttribute('title', 'Add another AI comment');

        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onAddMore?.();
        });

        addBtn.addEventListener('mouseenter', () => {
          addBtn.style.color = 'var(--interactive-accent)';
          addBtn.style.background = 'var(--background-modifier-hover)';
        });
        addBtn.addEventListener('mouseleave', () => {
          addBtn.style.color = 'var(--text-muted)';
          addBtn.style.background = 'transparent';
        });

        // Insert before delete button
        if (deleteBtn) {
          headerLine.insertBefore(addBtn, deleteBtn);
        } else {
          headerLine.appendChild(addBtn);
        }

        // Show buttons on hover
        lastItem.addEventListener('mouseenter', () => {
          addBtn.style.opacity = '1';
        });
        lastItem.addEventListener('mouseleave', () => {
          addBtn.style.opacity = '0';
        });
      }
    }
  }

  /**
   * Show copy feedback
   */
  private showCopyFeedback(element: HTMLElement): void {
    const feedback = document.createElement('div');
    feedback.textContent = 'Copied!';
    feedback.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--background-modifier-success);
      color: var(--text-on-accent);
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      pointer-events: none;
      z-index: 100;
      animation: fadeOut 1s ease forwards;
    `;

    element.style.position = 'relative';
    element.appendChild(feedback);

    setTimeout(() => {
      feedback.remove();
    }, 1000);
  }

  /**
   * Add click handlers for internal links (wiki links)
   * Makes [[Note Name]] links clickable to open the file
   */
  private addInternalLinkHandlers(container: HTMLElement): void {
    const app = (window as any).app;
    if (!app) return;

    // Find all internal links (Obsidian renders wiki links with class 'internal-link')
    const internalLinks = container.querySelectorAll('a.internal-link');

    internalLinks.forEach((link) => {
      const anchor = link as HTMLAnchorElement;
      const href = anchor.getAttribute('href') || anchor.dataset.href || '';

      // Remove default href behavior and add custom click handler
      anchor.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Get the link path (decoded)
        let linkPath = decodeURIComponent(href);

        // Try to find the file
        const file = app.metadataCache.getFirstLinkpathDest(linkPath, this.sourcePath);

        if (file) {
          // Open the file in a new leaf
          await app.workspace.openLinkText(linkPath, this.sourcePath, false);
        } else {
          // File not found - could show a notice or create the file
          console.warn(`[AICommentRenderer] File not found: ${linkPath}`);
        }
      });

      // Add hover preview (optional - Obsidian's native behavior)
      anchor.addEventListener('mouseover', (e) => {
        const target = e.target as HTMLElement;
        app.workspace.trigger('hover-link', {
          event: e,
          source: 'ai-comment-renderer',
          hoverParent: container,
          targetEl: target,
          linktext: href,
          sourcePath: this.sourcePath,
        });
      });
    });
  }

  /**
   * Add click handlers for timestamps in AI comments
   * Makes timestamps like [12:34], [1:23:45], or [12:34-56:78] clickable for podcast/video seeking
   */
  private addTimestampHandlers(container: HTMLElement): void {
    // Only process if we have a timestamp click handler
    if (!this.onTimestampClick) return;

    // Regex to match timestamps:
    // - Single: [MM:SS] or [HH:MM:SS] or [H:MM:SS]
    // - Range: [MM:SS-MM:SS] or [HH:MM:SS-HH:MM:SS] (will seek to start time)
    const timestampRegex = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:-\d{1,2}:\d{2}(?::\d{2})?)?\]/g;

    // Walk through all text nodes to find and replace timestamps
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );

    const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = [];

    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
      const text = textNode.textContent || '';
      const matches = [...text.matchAll(timestampRegex)];
      if (matches.length > 0) {
        nodesToProcess.push({ node: textNode, matches });
      }
    }

    // Process nodes in reverse to avoid offset issues
    for (const { node, matches } of nodesToProcess.reverse()) {
      const text = node.textContent || '';
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      for (const match of matches) {
        const fullMatch = match[0];
        const index = match.index!;

        // Add text before the timestamp
        if (index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
        }

        // Parse timestamp to seconds
        const hours = match[3] ? parseInt(match[1] || '0', 10) : 0;
        const minutes = match[3] ? parseInt(match[2] || '0', 10) : parseInt(match[1] || '0', 10);
        const seconds = match[3] ? parseInt(match[3] || '0', 10) : parseInt(match[2] || '0', 10);
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;

        // Create clickable timestamp span
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'ai-comment-timestamp';
        timestampSpan.textContent = fullMatch;
        timestampSpan.style.cssText = `
          color: var(--text-accent);
          cursor: pointer;
          font-family: var(--font-monospace);
          background: var(--background-modifier-hover);
          padding: 1px 4px;
          border-radius: 3px;
          transition: all 0.15s ease;
        `;
        timestampSpan.title = `Jump to ${fullMatch}`;

        // Add hover effect
        timestampSpan.addEventListener('mouseenter', () => {
          timestampSpan.style.background = 'var(--interactive-accent)';
          timestampSpan.style.color = 'var(--text-on-accent)';
        });
        timestampSpan.addEventListener('mouseleave', () => {
          timestampSpan.style.background = 'var(--background-modifier-hover)';
          timestampSpan.style.color = 'var(--text-accent)';
        });

        // Add click handler
        timestampSpan.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.onTimestampClick?.(totalSeconds);
        });

        fragment.appendChild(timestampSpan);
        lastIndex = index + fullMatch.length;
      }

      // Add remaining text after last timestamp
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      // Replace the original text node with the fragment
      node.parentNode?.replaceChild(fragment, node);
    }
  }

  /**
   * Format ISO date to readable string
   */
  private formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return 'Today';
      } else if (diffDays === 1) {
        return 'Yesterday';
      } else if (diffDays < 7) {
        return `${diffDays} days ago`;
      } else {
        return date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        });
      }
    } catch {
      return isoDate;
    }
  }

  /**
   * Expand the comment section (no-op for inline style)
   */
  expand(): void {
    // No-op for inline style (always visible)
  }

  /**
   * Collapse the comment section (no-op for inline style)
   */
  collapse(): void {
    // No-op for inline style (always visible)
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.container = null;
    this.commentsListEl = null;
    this.comments = [];
    this.commentTexts.clear();
  }
}
