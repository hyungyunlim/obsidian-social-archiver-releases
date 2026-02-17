import type { Comment, Author } from '../../../types/post';

import type { Platform } from '../../../types/post';

/**
 * CommentRenderer - Renders Instagram-style comments section
 * Single Responsibility: Comments rendering with replies
 */
export class CommentRenderer {
  private platform?: Platform;
  private postAuthor?: Author;

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

    // "View all X comments" button (if there are more than 2 comments)
    if (hasMoreComments) {
      const viewAllBtn = commentsContainer.createDiv();
      viewAllBtn.addClass('sa-text-base', 'sa-text-muted', 'sa-clickable', 'sa-mb-8', 'sa-transition-color');
      viewAllBtn.setText(`View all ${comments.length} comments`);

      let showingAll = false;

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

        // Clear and re-render
        commentsListContainer.empty();
        const commentsToShow = showingAll ? comments : comments.slice(-maxVisibleComments);

        for (const comment of commentsToShow) {
          this.renderComment(commentsListContainer, comment);
        }

        viewAllBtn.setText(showingAll ? 'Hide comments' : `View all ${comments.length} comments`);
      });
    }

    // Comments list
    const commentsListContainer = commentsContainer.createDiv();
    commentsListContainer.addClass('sa-flex-col', 'sa-gap-8');

    // Show last 2 comments initially (like Instagram)
    const commentsToShow = hasMoreComments ? comments.slice(-maxVisibleComments) : comments;

    for (const comment of commentsToShow) {
      this.renderComment(commentsListContainer, comment);
    }
  }

  /**
   * Parse markdown links, plain URLs, and mentions in text and render as HTML
   * Handles: [@username](url), [text](url), and plain https://... URLs
   */
  private renderTextWithLinks(container: HTMLElement, text: string): void {
    // Normalize URLs with space after :// (e.g., "https:// example.com" -> "https://example.com")
    const normalizedText = text.replace(/https?:\/\/\s+/g, (match) => match.replace(/\s+/g, ''));

    // Combined regex to match:
    // 1. Markdown links: [text](url)
    // 2. Plain URLs: https://... or http://...
    const combinedRegex = /\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s<>[\]()]+)/g;

    let lastIndex = 0;
    let match;

    while ((match = combinedRegex.exec(normalizedText)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        container.createSpan({ text: normalizedText.substring(lastIndex, match.index) });
      }

      let linkText: string;
      let linkUrl: string;

      if (match[1] !== undefined && match[2] !== undefined) {
        // Markdown link: [text](url)
        linkText = match[1];
        linkUrl = match[2];
      } else if (match[3] !== undefined) {
        // Plain URL
        linkUrl = match[3];
        // Truncate display text for long URLs
        linkText = linkUrl.length > 50 ? linkUrl.substring(0, 47) + '...' : linkUrl;
      } else {
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
  private renderComment(container: HTMLElement, comment: Comment, isReply: boolean = false): void {
    const commentDiv = container.createDiv();
    commentDiv.addClass('sa-text-base', 'sa-leading-normal');
    if (isReply) {
      commentDiv.addClass('cr-reply');
    }

    // Comment content: **name** content (on same line)
    const contentSpan = commentDiv.createSpan();

    const usernameSpan = contentSpan.createEl('strong');
    usernameSpan.addClass('sa-font-semibold', 'sa-text-normal', 'sa-clickable');
    // Use author.name for display (e.g., "Charlie Moon" for LinkedIn)
    usernameSpan.setText(comment.author.name);

    // Add "Author" badge if this is the post author's comment
    if (this.isPostAuthor(comment.author)) {
      const authorBadge = contentSpan.createSpan({ cls: 'comment-author-badge' });
      authorBadge.setText('Author');
      authorBadge.addClass('sa-text-accent', 'sa-bg-hover', 'sa-ml-4');
      authorBadge.addClass('cr-author-badge');
    }

    // Fix Reddit author URL if empty
    const authorUrl = this.fixRedditAuthorUrl(comment);

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
    commentContentSpan.addClass('sa-text-normal');
    this.renderTextWithLinks(commentContentSpan, comment.content);

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
    if (comment.replies && comment.replies.length > 0) {
      const repliesContainer = commentDiv.createDiv();
      repliesContainer.addClass('sa-mt-4');

      for (const reply of comment.replies) {
        this.renderComment(repliesContainer, reply, true);
      }
    }
  }
}
