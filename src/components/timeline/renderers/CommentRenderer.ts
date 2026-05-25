import type { Comment, Author } from '../../../types/post';

import type { Platform } from '../../../types/post';
import { TextFormatter } from '../../../services/markdown/formatters/TextFormatter';

type CommentDepthLimit = number | null;

interface CommentRenderContext {
  depth: number;
  commentKey: string;
  maxVisibleDepth: CommentDepthLimit;
  expandedCommentKeys: Set<string>;
  collapsedCommentKeys: Set<string>;
  onToggleComment: (commentKey: string, currentlyExpanded: boolean) => void;
}

const MAX_COMMENT_RENDER_DEPTH = 20;
/**
 * CommentRenderer - Renders Instagram-style comments section
 * Single Responsibility: Comments rendering with replies
 */
export class CommentRenderer {
  private platform?: Platform;
  private postAuthor?: Author;
  private textFormatter = new TextFormatter();

  constructor(
    private getRelativeTimeCallback?: (date: Date) => string
  ) {}

  /**
   * Check if comment author is the same as the post author
   */
  private isPostAuthor(commentAuthor: Author): boolean {
    if (!this.postAuthor) return false;

    // Compare by URL (most reliable - same profile URL)
    if (commentAuthor.url && this.postAuthor.url) {
      const normalizeUrl = (url: string) => url.toLowerCase().replace(/\/$/, '');
      if (normalizeUrl(commentAuthor.url) === normalizeUrl(this.postAuthor.url)) {
        return true;
      }
    }

    // Compare by name (display name) - important for Brunch where URLs may differ
    // due to internal ID vs public handle
    if (commentAuthor.name && this.postAuthor.name) {
      const normalizeName = (s: string) => s.toLowerCase().trim();
      if (normalizeName(commentAuthor.name) === normalizeName(this.postAuthor.name)) {
        return true;
      }
    }

    // Compare by username/handle (fallback)
    const commentUsername = commentAuthor.username || commentAuthor.handle;
    const postUsername = this.postAuthor.username || this.postAuthor.handle;

    if (commentUsername && postUsername) {
      // Normalize: lowercase, remove @ prefix
      const normalize = (s: string) => s.toLowerCase().replace(/^@/, '');
      if (normalize(commentUsername) === normalize(postUsername)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Fix Reddit comment author URL if empty
   */
  private fixRedditAuthorUrl(comment: Comment): string {
    if (this.platform === 'reddit' && (!comment.author.url || comment.author.url === '')) {
      const username = comment.author.username || comment.author.name;
      return `https://www.reddit.com/user/${username}`;
    }
    return comment.author.url;
  }

  /**
   * Format relative time (e.g., "2h ago", "Yesterday", "Mar 15")
   */
  private getRelativeTime(timestamp: Date): string {
    // Use callback if provided, otherwise use built-in implementation
    if (this.getRelativeTimeCallback) {
      return this.getRelativeTimeCallback(timestamp);
    }

    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) {
      return 'Just now';
    } else if (diffMin < 60) {
      return `${diffMin}m ago`;
    } else if (diffHour < 24) {
      return `${diffHour}h ago`;
    } else if (diffDay === 1) {
      return 'Yesterday';
    } else if (diffDay < 7) {
      return `${diffDay}d ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    }
  }

  private decodeHtmlEntities(text: string): string {
    try {
      let decoded = text.replace(/&#x([0-9A-Fa-f]+);/g, (_match: string, hex: string) =>
        String.fromCodePoint(parseInt(hex, 16))
      );
      decoded = decoded.replace(/&#(\d+);/g, (_match: string, dec: string) =>
        String.fromCodePoint(parseInt(dec, 10))
      );
      return decoded
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    } catch {
      return text;
    }
  }

  private stripHtmlTags(html: string): string {
    return this.decodeHtmlEntities(html.replace(/<[^>]*>/g, ''));
  }

  private normalizeCommentHref(rawHref: string | undefined): string | undefined {
    const raw = this.decodeHtmlEntities(rawHref || '').trim();
    if (!raw || raw === '#') return undefined;
    if (/^javascript:/i.test(raw)) return undefined;
    if (raw.startsWith('//')) return `https:${raw}`;
    if (/^\/(?:in|company|school|showcase)\//i.test(raw)) return `https://www.linkedin.com${raw}`;
    if (/^(?:www\.)?(?:linkedin|instagram|threads|facebook|youtube|reddit)\.com\//i.test(raw)) {
      return `https://${raw}`;
    }
    if (/^(?:x|twitter)\.com\//i.test(raw)) return `https://${raw}`;
    if (/^bsky\.app\//i.test(raw)) return `https://${raw}`;
    if (/^https?:\/\//i.test(raw)) return raw;
    return undefined;
  }

  private countCommentTree(comments: Comment[] | undefined | null): number {
    if (!comments || comments.length === 0) return 0;

    let count = 0;
    const stack = [...comments];
    while (stack.length > 0) {
      const item = stack.pop();
      if (!item) continue;
      count += 1;
      if (item.replies && item.replies.length > 0) {
        stack.push(...item.replies);
      }
    }
    return count;
  }

  /**
   * Render comments section (Instagram style)
   * @param container - Container element to render into
   * @param comments - Array of comments to render
   * @param platform - Platform for URL generation
   * @param postAuthor - Original post author (to highlight their comments)
   */
  render(container: HTMLElement, comments: Comment[], platform?: Platform, postAuthor?: Author): void {
    this.platform = platform; // Store platform for URL generation
    this.postAuthor = postAuthor; // Store post author for highlighting
    const commentsContainer = container.createDiv();
    commentsContainer.addClass('sa-mt-12', 'sa-pt-12', 'sa-border-b');

    const maxVisibleComments = 2;
    const hasMoreComments = comments.length > maxVisibleComments;
    let showingAll = false;
    let expandedCommentKeys = new Set<string>();
    let collapsedCommentKeys = new Set<string>();
    let commentsListContainer: HTMLElement;

    const renderVisibleComments = () => {
      commentsListContainer.empty();
      const commentsToShow = hasMoreComments && !showingAll ? comments.slice(-maxVisibleComments) : comments;

      commentsToShow.forEach((comment, index) => {
        this.renderComment(commentsListContainer, comment, {
          depth: 0,
          commentKey: `root-${index}-${comment.id || 'comment'}`,
          maxVisibleDepth: null,
          expandedCommentKeys,
          collapsedCommentKeys,
          onToggleComment: (commentKey, currentlyExpanded) => {
            const nextExpanded = new Set(expandedCommentKeys);
            const nextCollapsed = new Set(collapsedCommentKeys);
            if (currentlyExpanded) {
              nextExpanded.delete(commentKey);
              nextCollapsed.add(commentKey);
            } else {
              nextCollapsed.delete(commentKey);
              nextExpanded.add(commentKey);
            }
            expandedCommentKeys = nextExpanded;
            collapsedCommentKeys = nextCollapsed;
            renderVisibleComments();
          },
        });
      });
    };

    // "View all X comments" button (if there are more than 2 comments)
    if (hasMoreComments) {
      const viewAllBtn = commentsContainer.createDiv();
      viewAllBtn.addClass('sa-text-base', 'sa-text-muted', 'sa-clickable', 'sa-mb-8', 'sa-transition-color');
      viewAllBtn.setText(`View all ${comments.length} comments`);

      viewAllBtn.addEventListener('mouseenter', () => {
        viewAllBtn.removeClass('sa-text-muted');
        viewAllBtn.addClass('sa-text-normal');
      });
      viewAllBtn.addEventListener('mouseleave', () => {
        viewAllBtn.removeClass('sa-text-normal');
        viewAllBtn.addClass('sa-text-muted');
      });

      viewAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showingAll = !showingAll;
        renderVisibleComments();
        viewAllBtn.setText(showingAll ? 'Hide comments' : `View all ${comments.length} comments`);
      });
    }

    // Comments list
    commentsListContainer = commentsContainer.createDiv();
    commentsListContainer.addClass('sa-flex-col', 'sa-gap-8');
    renderVisibleComments();
  }

  /**
   * Parse markdown links, plain URLs, and mentions in text and render as HTML
   * Handles: [@username](url), [text](url), and plain https://... URLs
   */
  private renderTextWithLinks(container: HTMLElement, text: string): void {
    // Normalize URLs with space after :// (e.g., "https:// example.com" -> "https://example.com")
    const decodedText = this.decodeHtmlEntities(text).replace(/https?:\/\/\s+/g, (match) => match.replace(/\s+/g, ''));
    const normalizedText = this.platform === 'reddit'
      ? this.textFormatter.linkifyRedditReferences(decodedText)
      : decodedText;

    // Combined regex to match:
    // 1. Safe HTML anchors: <a href="...">text</a>
    // 2. Markdown links: [text](url)
    // 3. Plain URLs: https://... or http://...
    const combinedRegex =
      /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>[\]()]+)/gi;

    let lastIndex = 0;
    let match;

    while ((match = combinedRegex.exec(normalizedText)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        container.createSpan({ text: normalizedText.substring(lastIndex, match.index) });
      }

      let linkText: string;
      let linkUrl: string | undefined;

      if (match[1] !== undefined || match[2] !== undefined || match[3] !== undefined) {
        // HTML anchor
        linkText = this.stripHtmlTags(match[4] || '').trim();
        linkUrl = this.normalizeCommentHref(match[1] || match[2] || match[3]);
      } else if (match[5] !== undefined && match[6] !== undefined) {
        // Markdown link: [text](url)
        linkText = match[5];
        linkUrl = this.normalizeCommentHref(match[6]);
      } else if (match[7] !== undefined) {
        // Plain URL
        linkUrl = this.normalizeCommentHref(match[7]);
        // Truncate display text for long URLs
        linkText = match[7].length > 50 ? match[7].substring(0, 47) + '...' : match[7];
      } else {
        lastIndex = match.index + match[0].length;
        continue;
      }

      if (!linkText || !linkUrl) {
        if (linkText) {
          container.createSpan({ text: linkText });
        }
        lastIndex = match.index + match[0].length;
        continue;
      }

      const link = container.createEl('a', { text: linkText });
      link.addClass('sa-text-accent', 'sa-clickable', 'sa-word-break');
      link.addClass('cr-link');
      link.href = linkUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = linkUrl; // Show full URL on hover

      // Hover underline handled by CSS .cr-link:hover
      link.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text after the last match
    if (lastIndex < normalizedText.length) {
      container.createSpan({ text: normalizedText.substring(lastIndex) });
    }
  }

  /**
   * Render a single comment (Instagram style)
   */
  private renderComment(container: HTMLElement, comment: Comment, context: CommentRenderContext): void {
    const commentDiv = container.createDiv();
    commentDiv.addClass('sa-text-base', 'sa-leading-normal');
    commentDiv.setAttribute('data-depth', String(context.depth));

    if (context.depth > MAX_COMMENT_RENDER_DEPTH) {
      commentDiv.addClass('sa-text-muted', 'cr-more-fallback');
      commentDiv.setText('… more nested replies');
      return;
    }

    if (context.depth > 0) {
      commentDiv.addClass('cr-reply');
    }

    const author: Author = comment.author ?? { name: 'Anonymous', url: '' };
    const children = comment.replies ?? [];
    const hasChildren = children.length > 0;
    const hiddenReplyCount = this.countCommentTree(children);
    const depthLimited = typeof context.maxVisibleDepth === 'number' && context.depth >= context.maxVisibleDepth;
    const manuallyExpanded = context.expandedCommentKeys.has(context.commentKey);
    const manuallyCollapsed = context.collapsedCommentKeys.has(context.commentKey);
    const repliesCollapsed = hasChildren && (manuallyCollapsed || (depthLimited && !manuallyExpanded));

    // Comment content: **name** content (on same line)
    const contentSpan = commentDiv.createSpan();
    contentSpan.addClass('cr-comment-line');

    if (hasChildren) {
      const toggleBtn = contentSpan.createEl('button');
      toggleBtn.addClass('cr-thread-toggle');
      if (repliesCollapsed) {
        toggleBtn.addClass('is-collapsed');
      }
      toggleBtn.setAttribute('type', 'button');
      toggleBtn.setAttribute('aria-expanded', String(!repliesCollapsed));
      toggleBtn.setAttribute('aria-label', repliesCollapsed ? `Show ${hiddenReplyCount} replies` : `Hide ${hiddenReplyCount} replies`);
      toggleBtn.createSpan({ cls: 'cr-thread-toggle-icon' });
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        context.onToggleComment(context.commentKey, !repliesCollapsed);
      });
    }

    const usernameSpan = contentSpan.createSpan();
    usernameSpan.addClass('sa-font-semibold', 'sa-text-normal', 'sa-clickable');
    // Use author.name for display (e.g., "Charlie Moon" for LinkedIn)
    usernameSpan.setText(author.name || 'Anonymous');

    // Add "Author" badge if this is the post author's comment
    if (this.isPostAuthor(author)) {
      const authorBadge = contentSpan.createSpan({ cls: 'comment-author-badge' });
      authorBadge.setText('Author');
      authorBadge.addClass('sa-text-accent', 'sa-bg-hover', 'sa-ml-4');
      authorBadge.addClass('cr-author-badge');
    }

    // Fix Reddit author URL if empty
    const authorUrl = this.fixRedditAuthorUrl({ ...comment, author });

    if (authorUrl) {
      usernameSpan.addClass('cr-username');
      usernameSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(authorUrl, '_blank');
      });
      // Hover underline handled by CSS .cr-username:hover
    }

    // Add space after username
    contentSpan.createSpan({ text: ' ' });

    // Render comment content with parsed links/mentions
    const commentContentSpan = contentSpan.createSpan();
    commentContentSpan.addClass('sa-text-normal', 'cr-comment-content');
    this.renderTextWithLinks(commentContentSpan, comment.content ?? '');

    // Time and likes (inline for both main comments and replies)
    // Only show time if timestamp exists and is valid
    if (comment.timestamp) {
      const timeSpan = contentSpan.createSpan();
      timeSpan.addClass('sa-text-sm', 'sa-text-muted', 'sa-ml-8');
      const relativeTime = this.getRelativeTime(new Date(comment.timestamp));
      if (relativeTime && relativeTime !== 'Invalid Date') {
        timeSpan.setText(relativeTime);
      }
    }

    if (comment.likes && comment.likes > 0) {
      const likesSpan = contentSpan.createSpan();
      likesSpan.addClass('sa-text-sm', 'sa-text-muted');
      // Add separator if timestamp was shown
      const separator = comment.timestamp ? ' · ' : ' ';
      if (!comment.timestamp) {
        likesSpan.addClass('sa-ml-8');
      }
      likesSpan.setText(`${separator}${comment.likes} ${comment.likes === 1 ? 'like' : 'likes'}`);
    }

    // Render replies (nested) - inside commentDiv to avoid gap duplication
    if (hasChildren && !repliesCollapsed) {
      const repliesContainer = commentDiv.createDiv();
      repliesContainer.addClass('sa-mt-4');
      repliesContainer.addClass('cr-replies');

      children.forEach((reply, index) => {
        this.renderComment(repliesContainer, reply, {
          ...context,
          depth: context.depth + 1,
          commentKey: `${context.commentKey}/${reply.id || index}`,
        });
      });
    } else if (hasChildren) {
      const hiddenBtn = commentDiv.createEl('button', {
        text: `Show ${hiddenReplyCount} ${hiddenReplyCount === 1 ? 'reply' : 'replies'}`,
      });
      hiddenBtn.addClass('cr-hidden-replies');
      hiddenBtn.setAttribute('type', 'button');
      hiddenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        context.onToggleComment(context.commentKey, false);
      });
    }
  }
}
