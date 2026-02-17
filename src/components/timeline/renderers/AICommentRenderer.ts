import { setIcon, MarkdownRenderer, Platform } from 'obsidian';
import type { App, Component } from 'obsidian';
import type { AICommentMeta, AICli } from '../../../types/ai-comment';
import { COMMENT_TYPE_DISPLAY_NAMES } from '../../../types/ai-comment';
import { showConfirmModal } from '../../../utils/confirm-modal';

/**
 * Options for AICommentRenderer
 */
export interface AICommentRendererOptions {
  /** Obsidian App instance for confirmation modals */
  app: App;
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
  private app: App | null = null;
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
    this.app = options.app;
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
    commentSection.addClass('sa-mt-12');
    commentSection.addClass('sa-py-12');
    commentSection.addClass('sa-border-t');

    // Comments list
    this.commentsListEl = commentSection.createDiv({ cls: 'ai-comments-list' });
    this.commentsListEl.addClass('sa-flex-col');
    this.commentsListEl.addClass('sa-gap-8');

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
    commentDiv.addClass('sa-text-base');
    commentDiv.addClass('sa-leading-normal');
    commentDiv.addClass('sa-rounded-4');
    commentDiv.addClass('sa-py-6');
    commentDiv.addClass('sa-px-8');
    // Dynamic background (color-mix)
    commentDiv.setCssProps({ '--sa-bg': 'color-mix(in srgb, var(--background-secondary) 50%, transparent)' });
    commentDiv.addClass('sa-dynamic-bg');

    // Header line: **name** · type · date · buttons
    const headerLine = commentDiv.createDiv({ cls: 'ai-comment-header' });
    headerLine.addClass('sa-flex-row');
    headerLine.addClass('sa-gap-6');
    headerLine.addClass('sa-mb-4');

    // Sparkles icon (Lucide)
    const aiIcon = headerLine.createSpan({ cls: 'ai-comment-icon' });
    aiIcon.addClass('sa-icon-14');
    aiIcon.addClass('sa-opacity-80');
    aiIcon.setCssProps({ '--sa-color': 'var(--interactive-accent)' });
    aiIcon.addClass('sa-dynamic-color');
    setIcon(aiIcon, 'sparkles');

    // CLI name (bold, like username)
    const nameSpan = headerLine.createEl('strong');
    nameSpan.addClass('sa-font-semibold');
    nameSpan.addClass('sa-text-normal');
    nameSpan.textContent = CLI_NAMES[meta.cli] || meta.cli;

    // Separator after name
    const sep1 = headerLine.createSpan({ text: '·' });
    sep1.addClass('sa-text-faint');

    // Type badge
    const typeSpan = headerLine.createSpan();
    typeSpan.addClass('sa-text-xs');
    typeSpan.addClass('sa-text-muted');
    typeSpan.addClass('sa-py-1');
    typeSpan.addClass('sa-px-6');
    typeSpan.addClass('sa-bg-hover');
    typeSpan.addClass('sa-rounded-4');
    typeSpan.textContent = COMMENT_TYPE_DISPLAY_NAMES[meta.type] || meta.type;

    // Separator
    const sep2 = headerLine.createSpan({ text: '·' });
    sep2.addClass('sa-text-faint');

    // Date
    const dateSpan = headerLine.createSpan();
    dateSpan.addClass('sa-text-sm');
    dateSpan.addClass('sa-text-muted');
    dateSpan.textContent = this.formatDate(meta.generatedAt);

    // Spacer
    const spacer = headerLine.createSpan();
    spacer.addClass('sa-flex-1');

    // Add more button (only on last comment, hide on mobile since CLI not available)
    let addBtn: HTMLSpanElement | null = null;
    if (isLast && !Platform.isMobile) {
      addBtn = headerLine.createSpan({ cls: 'ai-comment-add-btn' });
      addBtn.addClass('sa-icon-20');
      addBtn.addClass('sa-rounded-4');
      addBtn.addClass('sa-clickable');
      addBtn.addClass('sa-text-muted');
      addBtn.addClass('sa-opacity-0');
      addBtn.addClass('sa-transition');
      setIcon(addBtn, 'plus');
      addBtn.setAttribute('title', 'Add another AI comment');

      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onAddMore?.();
      });

      addBtn.addEventListener('mouseenter', () => {
        if (addBtn) {
          addBtn.removeClass('sa-text-muted');
          addBtn.removeClass('sa-bg-transparent');
          addBtn.setCssProps({ '--sa-color': 'var(--interactive-accent)' });
          addBtn.addClass('sa-dynamic-color');
          addBtn.addClass('sa-bg-hover');
        }
      });
      addBtn.addEventListener('mouseleave', () => {
        if (addBtn) {
          addBtn.addClass('sa-text-muted');
          addBtn.removeClass('sa-dynamic-color');
          addBtn.removeClass('sa-bg-hover');
          addBtn.addClass('sa-bg-transparent');
        }
      });
    }

    // Apply button (for reformat type only)
    let applyBtn: HTMLSpanElement | null = null;
    if (meta.type === 'reformat' && this.onApplyReformat) {
      applyBtn = headerLine.createSpan({ cls: 'ai-comment-apply' });
      applyBtn.addClass('sa-icon-20');
      applyBtn.addClass('sa-rounded-4');
      applyBtn.addClass('sa-clickable');
      applyBtn.addClass('sa-text-faint');
      applyBtn.addClass('sa-opacity-0');
      applyBtn.addClass('sa-transition');
      setIcon(applyBtn, 'check');
      applyBtn.setAttribute('aria-label', 'Apply to content');

      applyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (this.onApplyReformat) {
          // Show loading state
          applyBtn!.removeClass('sa-opacity-0');
          applyBtn!.addClass('sa-opacity-50');
          applyBtn!.addClass('sa-pointer-none');
          try {
            await this.onApplyReformat(meta.id, text);
          } finally {
            if (applyBtn) {
              applyBtn.removeClass('sa-opacity-50');
              applyBtn.addClass('sa-opacity-100');
              applyBtn.removeClass('sa-pointer-none');
            }
          }
        }
      });

      applyBtn.addEventListener('mouseenter', () => {
        applyBtn!.removeClass('sa-text-faint');
        applyBtn!.addClass('sa-text-success');
        applyBtn!.setCssProps({ '--sa-bg': 'var(--background-modifier-success)' });
        applyBtn!.addClass('sa-dynamic-bg');
      });
      applyBtn.addEventListener('mouseleave', () => {
        applyBtn!.addClass('sa-text-faint');
        applyBtn!.removeClass('sa-text-success');
        applyBtn!.removeClass('sa-dynamic-bg');
        applyBtn!.addClass('sa-bg-transparent');
      });
    }

    // Delete button
    const deleteBtn = headerLine.createSpan({ cls: 'ai-comment-delete' });
    deleteBtn.addClass('sa-icon-20');
    deleteBtn.addClass('sa-rounded-4');
    deleteBtn.addClass('sa-clickable');
    deleteBtn.addClass('sa-text-faint');
    deleteBtn.addClass('sa-opacity-0');
    deleteBtn.addClass('sa-transition');
    setIcon(deleteBtn, 'trash-2');

    // Show buttons on hover
    commentDiv.addEventListener('mouseenter', () => {
      if (addBtn) {
        addBtn.removeClass('sa-opacity-0');
        addBtn.addClass('sa-opacity-100');
      }
      if (applyBtn) {
        applyBtn.removeClass('sa-opacity-0');
        applyBtn.addClass('sa-opacity-100');
      }
      deleteBtn.removeClass('sa-opacity-0');
      deleteBtn.addClass('sa-opacity-100');
    });
    commentDiv.addEventListener('mouseleave', () => {
      if (addBtn) {
        addBtn.removeClass('sa-opacity-100');
        addBtn.addClass('sa-opacity-0');
      }
      if (applyBtn) {
        applyBtn.removeClass('sa-opacity-100');
        applyBtn.addClass('sa-opacity-0');
      }
      deleteBtn.removeClass('sa-opacity-100');
      deleteBtn.addClass('sa-opacity-0');
    });

    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.handleDelete(meta.id, commentDiv);
    });

    deleteBtn.addEventListener('mouseenter', () => {
      deleteBtn.removeClass('sa-text-faint');
      deleteBtn.addClass('sa-text-error');
      deleteBtn.setCssProps({ '--sa-bg': 'var(--background-modifier-error)' });
      deleteBtn.addClass('sa-dynamic-bg');
    });
    deleteBtn.addEventListener('mouseleave', () => {
      deleteBtn.addClass('sa-text-faint');
      deleteBtn.removeClass('sa-text-error');
      deleteBtn.removeClass('sa-dynamic-bg');
      deleteBtn.addClass('sa-bg-transparent');
    });

    // Content area (separate line, allows proper text wrapping)
    const textContainer = commentDiv.createDiv({ cls: 'ai-comment-text-container' });

    const textSpan = textContainer.createDiv({ cls: 'ai-comment-text' });
    textSpan.addClass('sa-text-normal');
    textSpan.addClass('sa-leading-normal');

    // Plain text style - minimal markdown formatting (styles in content-renderers.css)
    textSpan.addClass('ai-comment-plain');

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
      textWrapper.addClass('sa-relative');
      textWrapper.addClass('sa-overflow-hidden');
      textWrapper.setCssProps({ '--sa-max-height': '12em' });
      textWrapper.addClass('sa-dynamic-max-height');
      // Move textSpan into wrapper
      textWrapper.appendChild(textSpan);

      // Add gradient fade at bottom when collapsed
      const fadeOverlay = textWrapper.createDiv({ cls: 'ai-comment-fade' });
      fadeOverlay.addClass('sa-absolute');
      fadeOverlay.addClass('sa-bottom-0');
      fadeOverlay.addClass('sa-left-0');
      fadeOverlay.addClass('sa-right-0');
      fadeOverlay.addClass('sa-pointer-none');
      fadeOverlay.setCssProps({
        '--sa-height': '2.5em',
        '--sa-bg': 'linear-gradient(to bottom, transparent 0%, var(--background-primary) 80%)'
      });
      fadeOverlay.addClass('sa-dynamic-height');
      fadeOverlay.addClass('sa-dynamic-bg');

      // Add expand/collapse toggle
      const toggleBtn = textContainer.createSpan({ cls: 'ai-comment-toggle' });
      toggleBtn.addClass('sa-inline-block');
      toggleBtn.addClass('sa-text-accent');
      toggleBtn.addClass('sa-clickable');
      toggleBtn.addClass('sa-text-sm');
      toggleBtn.addClass('sa-mt-4');
      toggleBtn.textContent = 'Show more';

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isExpanded = !isExpanded;

        if (isExpanded) {
          textWrapper.setCssProps({ '--sa-max-height': 'none' });
          textWrapper.removeClass('sa-overflow-hidden');
          fadeOverlay.addClass('sa-hidden');
          toggleBtn.textContent = 'Show less';
        } else {
          textWrapper.setCssProps({ '--sa-max-height': '12em' }); // Same as initial collapsed height
          textWrapper.addClass('sa-overflow-hidden');
          fadeOverlay.removeClass('sa-hidden');
          toggleBtn.textContent = 'Show more';
        }
      });

      // Hover underline handled by CSS .acr-toggle:hover
      toggleBtn.addClass('acr-toggle');
    }

    return commentDiv;
  }

  /**
   * Handle delete with confirmation
   * Note: UI refresh is handled by PostCardRenderer.refreshPostCard after onDelete
   */
  private async handleDelete(id: string, element: HTMLElement): Promise<void> {
    // Use Obsidian modal for confirmation
    if (!this.app) return;
    const confirmed = await showConfirmModal(this.app, {
      title: 'Delete AI comment',
      message: 'Are you sure you want to delete this AI comment?',
      confirmText: 'Delete',
      confirmClass: 'danger',
    });
    if (!confirmed) return;

    // Visual feedback
    element.addClass('sa-opacity-50');
    element.addClass('sa-pointer-none');

    try {
      // onDelete callback will handle file update and UI refresh
      await this.onDelete?.(id);
      // Note: refreshPostCard will re-render the entire AI comments section
    } catch (error) {
      // Restore on error
      element.removeClass('sa-opacity-50');
      element.removeClass('sa-pointer-none');
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
      this.container.empty();
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
        addBtn.classList.add('sa-icon-20');
        addBtn.classList.add('sa-rounded-4');
        addBtn.classList.add('sa-clickable');
        addBtn.classList.add('sa-text-muted');
        addBtn.classList.add('sa-opacity-0');
        addBtn.classList.add('sa-transition');
        setIcon(addBtn, 'plus');
        addBtn.setAttribute('title', 'Add another AI comment');

        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onAddMore?.();
        });

        addBtn.addEventListener('mouseenter', () => {
          addBtn.classList.remove('sa-text-muted');
          addBtn.classList.add('sa-text-accent');
          addBtn.classList.add('sa-bg-hover');
        });
        addBtn.addEventListener('mouseleave', () => {
          addBtn.classList.remove('sa-text-accent');
          addBtn.classList.add('sa-text-muted');
          addBtn.classList.remove('sa-bg-hover');
          addBtn.classList.add('sa-bg-transparent');
        });

        // Insert before delete button
        if (deleteBtn) {
          headerLine.insertBefore(addBtn, deleteBtn);
        } else {
          headerLine.appendChild(addBtn);
        }

        // Show buttons on hover
        lastItem.addEventListener('mouseenter', () => {
          addBtn.classList.remove('sa-opacity-0');
          addBtn.classList.add('sa-opacity-100');
        });
        lastItem.addEventListener('mouseleave', () => {
          addBtn.classList.remove('sa-opacity-100');
          addBtn.classList.add('sa-opacity-0');
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
    feedback.classList.add('sa-absolute');
    feedback.classList.add('sa-py-4');
    feedback.classList.add('sa-px-12');
    feedback.classList.add('sa-rounded-4');
    feedback.classList.add('sa-text-sm');
    feedback.classList.add('sa-font-medium');
    feedback.classList.add('sa-pointer-none');
    feedback.classList.add('sa-z-100');
    feedback.classList.add('acr-copy-feedback');

    element.classList.add('sa-relative');
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
        timestampSpan.classList.add('sa-text-accent');
        timestampSpan.classList.add('sa-clickable');
        timestampSpan.classList.add('sa-bg-hover');
        timestampSpan.classList.add('sa-rounded-4');
        timestampSpan.classList.add('acr-timestamp');
        timestampSpan.title = `Jump to ${fullMatch}`;

        // Hover effect handled entirely by CSS .acr-timestamp:hover

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
