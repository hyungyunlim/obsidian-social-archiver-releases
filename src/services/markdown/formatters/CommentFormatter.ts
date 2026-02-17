import type { PostData, Platform, Comment } from '@/types/post';
import { DateNumberFormatter } from './DateNumberFormatter';
import { TextFormatter } from './TextFormatter';

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
   * Format comments for markdown (nested style with indentation)
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
        .map((comment) => {
          // Defensive checks
          if (!comment || !comment.author || !comment.content) {
            return '';
          }

          // Main comment - support both handle and username
          // LinkedIn: use name instead of handle (handles can be URL-encoded)
          // Instagram: use handle with link
          // Reddit: use username with link
          // Others: use handle if available, otherwise name
          const authorHandle = comment.author.handle || comment.author.username;

          let authorDisplay: string;
          if (platform === 'linkedin') {
            // LinkedIn: always use display name with link
            authorDisplay = comment.author.url
              ? `[${comment.author.name}](${comment.author.url})`
              : comment.author.name;
          } else if (platform === 'instagram' && authorHandle) {
            // Instagram: use handle with link
            authorDisplay = `[@${authorHandle}](https://instagram.com/${authorHandle})`;
          } else if (platform === 'reddit' && authorHandle) {
            // Reddit: use username with link
            authorDisplay = comment.author.url
              ? `[@${authorHandle}](${comment.author.url})`
              : `@${authorHandle}`;
          } else if (platform === 'x' && authorHandle) {
            // X: use handle with link
            authorDisplay = `[@${authorHandle}](https://x.com/${authorHandle})`;
          } else {
            // Others: use handle or name
            authorDisplay = authorHandle ? `@${authorHandle}` : comment.author.name;
          }

          const timestamp = this.dateNumberFormatter.formatDate(comment.timestamp);
          const likes = comment.likes ? ` · ${comment.likes} likes` : '';

          // Convert @mentions in comment content to links
          const commentContent = platform === 'instagram'
            ? this.textFormatter.linkifyInstagramMentions(comment.content)
            : platform === 'x'
            ? this.textFormatter.linkifyXMentions(comment.content)
            : comment.content;

          // Format header: author [· timestamp] [· likes]
          const timestampPart = timestamp ? ` · ${timestamp}` : '';
          let result = `**${authorDisplay}**${timestampPart}${likes}\n${commentContent}`;

          // Nested replies with indentation
          if (comment.replies && comment.replies.length > 0) {
            const formattedReplies = comment.replies
              .map((reply: Comment) => {
                if (!reply || !reply.author || !reply.content) {
                  return '';
                }
                const replyHandle = reply.author.handle || reply.author.username;

                // Same logic as main comment
                let replyAuthorDisplay: string;
                if (platform === 'linkedin') {
                  // LinkedIn: always use display name with link
                  replyAuthorDisplay = reply.author.url
                    ? `[${reply.author.name}](${reply.author.url})`
                    : reply.author.name;
                } else if (platform === 'instagram' && replyHandle) {
                  // Instagram: use handle with link
                  replyAuthorDisplay = `[@${replyHandle}](https://instagram.com/${replyHandle})`;
                } else if (platform === 'reddit' && replyHandle) {
                  // Reddit: use username with link
                  replyAuthorDisplay = reply.author.url
                    ? `[@${replyHandle}](${reply.author.url})`
                    : `@${replyHandle}`;
                } else if (platform === 'x' && replyHandle) {
                  // X: use handle with link
                  replyAuthorDisplay = `[@${replyHandle}](https://x.com/${replyHandle})`;
                } else {
                  // Others: use handle or name
                  replyAuthorDisplay = replyHandle ? `@${replyHandle}` : reply.author.name;
                }

                const replyTime = this.dateNumberFormatter.formatDate(reply.timestamp);
                const replyLikes = reply.likes ? ` · ${reply.likes} likes` : '';

                // Convert @mentions in reply content to links
                // Pass isReply=true to remove redundant first @mention (Instagram)
                const replyContent = platform === 'instagram'
                  ? this.textFormatter.linkifyInstagramMentions(reply.content, true)
                  : platform === 'x'
                  ? this.textFormatter.linkifyXMentions(reply.content)
                  : reply.content;

                // Format reply header: author [· timestamp] [· likes]
                const replyTimePart = replyTime ? ` · ${replyTime}` : '';
                return `  ↳ **${replyAuthorDisplay}**${replyTimePart}${replyLikes}\n  ${replyContent}`;
              })
              .filter((r: string) => r.length > 0)
              .join('\n\n');

            if (formattedReplies.length > 0) {
              result += '\n\n' + formattedReplies;
            }
          }

          return result;
        })
        .filter(c => c.length > 0)
        .join('\n\n---\n\n');
    } catch (error) {
      return '';
    }
  }
}
