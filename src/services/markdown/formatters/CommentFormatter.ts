import type { PostData, Platform, Comment, Media } from '@/types/post';
import { DateNumberFormatter } from './DateNumberFormatter';
import { TextFormatter } from './TextFormatter';
import { encodePathForMarkdownLink } from '@/utils/url';

/**
 * CommentFormatter - Format comments for markdown
 * Single Responsibility: Comment and reply formatting with platform-specific features
 */
export class CommentFormatter {
  private dateNumberFormatter: DateNumberFormatter;
  private textFormatter: TextFormatter;

  constructor(dateNumberFormatter: DateNumberFormatter, textFormatter: TextFormatter) {
    this.dateNumberFormatter = dateNumberFormatter;
    this.textFormatter = textFormatter;
  }

  /**
   * Fix Reddit comment data (BrightData returns incorrect format)
   */
  private fixRedditComment(comment: Comment): Comment {
    const fixed: Comment = { ...comment };

    // Fix author URL if empty
    if (fixed.author && (!fixed.author.url || fixed.author.url === '')) {
      const username = fixed.author.username || fixed.author.name;
      fixed.author = { ...fixed.author, url: `https://www.reddit.com/user/${username}` };
    }

    // Parse upvote info from timestamp field
    if (fixed.timestamp && typeof fixed.timestamp === 'string' && fixed.timestamp.includes('like')) {
      const match = fixed.timestamp.match(/(\d+)\s+like/);
      if (match && match[1]) {
        fixed.likes = parseInt(match[1], 10);
        fixed.timestamp = undefined; // Clear incorrect timestamp
      }
    }

    // Fix replies
    if (fixed.replies && Array.isArray(fixed.replies)) {
      fixed.replies = fixed.replies.map((reply: Comment) => this.fixRedditComment(reply));
    }

    return fixed;
  }

  /**
   * Format comments for markdown (nested style with indentation).
   * Top-level comments are separated by `---`. Nested replies are joined by blank lines
   * and indented by `'  '.repeat(depth)`.
   */
  formatComments(comments: PostData['comments'], platform: Platform): string {
    if (!comments || comments.length === 0) {
      return '';
    }

    try {
      // Fix Reddit comment data before processing
      const processedComments = platform === 'reddit'
        ? comments.map(c => this.fixRedditComment(c))
        : comments;

      return processedComments
        .map((comment) => this.renderCommentRecursive(comment, platform, 0))
        .filter(c => c.length > 0)
        .join('\n\n---\n\n');
    } catch {
      return '';
    }
  }

  /**
   * Render a single comment and its reply subtree at the given depth.
   *
   * depth 0: no prefix, no indent.
   * depth N >= 1: `↳ **author** ...` prefix, body indented by `'  '.repeat(N)`.
   *
   * Returns an empty string for invalid/missing comments so the caller can filter them out.
   */
  private renderCommentRecursive(comment: Comment, platform: Platform, depth: number): string {
    if (!comment || !comment.author || !comment.content) {
      return '';
    }

    const indent = '  '.repeat(depth);
    const prefix = depth === 0 ? '' : '↳ ';
    // At depth >= 1 treat this as a reply for platform-specific @mention handling
    // (e.g. Instagram strips the redundant leading @mention).
    const isReply = depth >= 1;

    const authorDisplay = this.buildAuthorDisplay(comment, platform);
    const timestamp = this.dateNumberFormatter.formatDate(comment.timestamp);
    const timestampPart = timestamp ? ` · ${timestamp}` : '';
    const likes = comment.likes ? ` · ${comment.likes} likes` : '';

    const normalizedCommentContent = this.normalizeCommentContent(comment.content);
    const commentContent = platform === 'instagram'
      ? this.textFormatter.linkifyInstagramMentions(normalizedCommentContent, isReply)
      : platform === 'x'
      ? this.textFormatter.linkifyXMentions(normalizedCommentContent)
      : normalizedCommentContent;

    const mediaBlock = this.formatCommentMedia(comment.media, indent);
    const mediaSection = mediaBlock ? `\n${mediaBlock}` : '';

    let result = `${indent}${prefix}**${authorDisplay}**${timestampPart}${likes}\n${indent}${commentContent}${mediaSection}`;

    if (comment.replies && comment.replies.length > 0) {
      const formattedReplies = comment.replies
        .map((reply) => this.renderCommentRecursive(reply, platform, depth + 1))
        .filter((r) => r.length > 0)
        .join('\n\n');

      if (formattedReplies.length > 0) {
        result += '\n\n' + formattedReplies;
      }
    }

    return result;
  }

  /**
   * Build the platform-specific author display string (plain text or markdown link).
   */
  private buildAuthorDisplay(comment: Comment, platform: Platform): string {
    const authorHandle = comment.author.handle || comment.author.username;

    if (platform === 'linkedin') {
      // LinkedIn: always use display name with link
      return comment.author.url
        ? `[${comment.author.name}](${comment.author.url})`
        : comment.author.name;
    }

    if (platform === 'instagram' && authorHandle) {
      return `[@${authorHandle}](https://instagram.com/${authorHandle})`;
    }

    if (platform === 'reddit' && authorHandle) {
      return comment.author.url
        ? `[@${authorHandle}](${comment.author.url})`
        : `@${authorHandle}`;
    }

    if (platform === 'x' && authorHandle) {
      return `[@${authorHandle}](https://x.com/${authorHandle})`;
    }

    if (comment.author.name === '[deleted]') {
      return '@[deleted]';
    }

    return authorHandle ? `@${authorHandle}` : comment.author.name;
  }

  /**
   * Format media items inline for a comment or reply
   * @param media - Media items from comment
   * @param indent - Indentation prefix (e.g., '  ' for a depth-1 reply)
   */
  private formatCommentMedia(media?: Media[], indent = ''): string {
    if (!media || media.length === 0) return '';

    return media
      .map((item, index) => {
        const alt = item.altText || item.alt || `${item.type} ${index + 1}`;
        if (item.type === 'image') {
          return `${indent}![${this.escapeMarkdown(alt)}](${encodePathForMarkdownLink(item.url)})`;
        } else if (item.type === 'video') {
          const commentVideoUrl = item.thumbnail || item.url;
          const isRemote = commentVideoUrl.startsWith('http://') || commentVideoUrl.startsWith('https://');
          if (isRemote) {
            return `${indent}[🎥 Video](${commentVideoUrl})`;
          }
          return `${indent}![🎥 Video](${encodePathForMarkdownLink(commentVideoUrl)})`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
  }

  private normalizeCommentContent(content: string): string {
    const decoded = this.decodeHtmlEntities(content);
    const withLinks = decoded.replace(
      /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, doubleQuotedHref, singleQuotedHref, bareHref, rawLabel) => {
        const label = this.stripHtmlTags(rawLabel).trim();
        if (!label) return '';

        const href = this.normalizeCommentHref(doubleQuotedHref || singleQuotedHref || bareHref);
        if (!href) return label;

        return `[${this.escapeMarkdown(label)}](${href})`;
      },
    );

    return withLinks.replace(/<[^>]*>/g, '');
  }

  private decodeHtmlEntities(text: string): string {
    try {
      let decoded = text.replace(/&#x([0-9A-Fa-f]+);/g, (_match, hex) =>
        String.fromCodePoint(parseInt(hex, 16))
      );
      decoded = decoded.replace(/&#(\d+);/g, (_match, dec) =>
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
}
