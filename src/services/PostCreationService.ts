/**
 * PostCreationService
 *
 * Handles business logic for creating user-generated posts:
 * - PostData generation with platform: 'post'
 * - Content validation (character limits, media count)
 * - Author info integration from Obsidian settings
 *
 * Note: User-created posts are FREE and do NOT consume credits.
 * Credits are only used for archiving external social media posts.
 *
 * Single Responsibility: Post creation business logic
 */

import { PostData, Media } from '../types/post';
import { SocialArchiverSettings } from '../types/settings';
import { uniqueStrings } from '@/utils/array';
import { normalizeUrlForDedup } from '@/utils/url';

/**
 * Post creation input data
 */
export interface PostCreationInput {
  content: string; // Markdown content
  media?: Media[]; // Attached images/videos
  linkPreviews?: string[]; // Extracted URLs for preview
}

/**
 * Content validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}


/**
 * PostCreationService class
 */
export class PostCreationService {
  // Content validation limits
  private static readonly MAX_CONTENT_LENGTH = 10000; // 10,000 characters (from MarkdownEditor)
  private static readonly MIN_CONTENT_LENGTH = 1; // At least 1 character
  private static readonly MAX_MEDIA_COUNT = 10; // Maximum 10 images
  private static readonly MAX_LINK_PREVIEWS = 5; // Maximum 5 link previews

  constructor(private settings: SocialArchiverSettings) {}

  /**
   * Generate PostData for user-created post
   */
  generatePostData(input: PostCreationInput): PostData {
    // Validate input first
    const validation = this.validateContent(input);
    if (!validation.valid) {
      throw new Error(`Invalid post content: ${validation.errors.join(', ')}`);
    }

    // Generate unique ID (timestamp-based)
    const timestamp = new Date();
    const id = `post_${timestamp.getTime()}`;

    // Generate vault file path (consistent with other platforms)
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const date = timestamp.toISOString().split('T')[0] || '';
    const timeStr = (timestamp.toTimeString().split(' ')[0] || '00:00:00').replace(/:/g, '');
    const fileName = `${date}-${timeStr}.md`;
    const url = `${this.settings.archivePath}/Post/${year}/${month}/${fileName}`;

    // Get author info from settings
    const author = {
      name: this.settings.username || 'You',
      url: url, // Post URL as author URL
      avatar: this.settings.userAvatar || undefined,
      username: this.settings?.username || undefined,
    };

    // Create PostData
    const postData: PostData = {
      platform: 'post',
      id,
      url,
      author,
      content: {
        text: input.content,
        markdown: input.content,
      },
      media: input.media || [],
      metadata: {
        timestamp,
      },
      linkPreviews: uniqueStrings(input.linkPreviews, normalizeUrlForDedup),
      filePath: url,
      publishedDate: timestamp,
      archivedDate: timestamp,
    };

    return postData;
  }

  /**
   * Validate post content
   */
  validateContent(input: PostCreationInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate content length
    if (!input.content || input.content.trim().length < PostCreationService.MIN_CONTENT_LENGTH) {
      errors.push('Content cannot be empty');
    }

    if (input.content && input.content.length > PostCreationService.MAX_CONTENT_LENGTH) {
      errors.push(
        `Content exceeds maximum length of ${PostCreationService.MAX_CONTENT_LENGTH} characters`
      );
    }

    // Validate media count
    if (input.media && input.media.length > PostCreationService.MAX_MEDIA_COUNT) {
      errors.push(`Cannot attach more than ${PostCreationService.MAX_MEDIA_COUNT} images`);
    }

    // Validate media array
    if (input.media) {
      input.media.forEach((media, index) => {
        if (!media.url) {
          errors.push(`Media item ${index + 1} is missing URL`);
        }
        if (!media.type) {
          errors.push(`Media item ${index + 1} is missing type`);
        }
      });
    }

    // Validate link previews count
    if (input.linkPreviews && input.linkPreviews.length > PostCreationService.MAX_LINK_PREVIEWS) {
      warnings.push(
        `Only first ${PostCreationService.MAX_LINK_PREVIEWS} link previews will be generated`
      );
    }

    // Check for very short content (warning only)
    if (input.content && input.content.trim().length < 10) {
      warnings.push('Content is very short. Consider adding more details.');
    }

    // Check for media without alt text (warning only)
    if (input.media) {
      const missingAlt = input.media.filter(m => !m.alt && !m.altText).length;
      if (missingAlt > 0) {
        warnings.push(
          `${missingAlt} image(s) missing alt text. Consider adding descriptions for accessibility.`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }


  /**
   * Get content statistics
   */
  getContentStats(input: PostCreationInput): {
    characterCount: number;
    wordCount: number;
    mediaCount: number;
    linkCount: number;
    estimatedReadingTime: number; // in minutes
  } {
    const characterCount = input.content?.length || 0;
    const words = input.content?.trim().split(/\s+/) || [];
    const wordCount = words.filter(w => w.length > 0).length;
    const mediaCount = input.media?.length || 0;
    const linkCount = input.linkPreviews?.length || 0;

    // Estimate reading time: average 200 words per minute
    const estimatedReadingTime = Math.ceil(wordCount / 200);

    return {
      characterCount,
      wordCount,
      mediaCount,
      linkCount,
      estimatedReadingTime: Math.max(1, estimatedReadingTime),
    };
  }

  /**
   * Get validation limits for UI display
   */
  static getValidationLimits() {
    return {
      maxContentLength: PostCreationService.MAX_CONTENT_LENGTH,
      minContentLength: PostCreationService.MIN_CONTENT_LENGTH,
      maxMediaCount: PostCreationService.MAX_MEDIA_COUNT,
      maxLinkPreviews: PostCreationService.MAX_LINK_PREVIEWS,
    };
  }
}
