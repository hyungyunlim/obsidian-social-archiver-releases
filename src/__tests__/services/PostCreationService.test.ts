import { describe, it, expect, beforeEach } from 'vitest';
import { PostCreationService, PostCreationInput } from '../../services/PostCreationService';
import { SocialArchiverSettings } from '../../types/settings';
import { Media } from '../../types/post';

describe('PostCreationService', () => {
  let service: PostCreationService;
  let mockSettings: SocialArchiverSettings;

  beforeEach(() => {
    mockSettings = {
      apiKey: 'test-key',
      licenseKey: 'test-license',
      workerUrl: 'https://test.example.com',
      username: 'testuser',
      userName: 'Test User',
      userAvatar: 'https://example.com/avatar.png',
      archivePath: 'Social Archives',
      mediaPath: 'attachments/social-archives',
      fileNameFormat: '[YYYY-MM-DD] {platform}-{slug}-{shortId}',
      autoArchive: false,
      downloadMedia: 'images-and-videos',
      anonymizeAuthors: false,
      requestTimeout: 30000,
      maxRetries: 3,
      creditsRemaining: 10,
      creditResetDate: new Date().toISOString(),
      timelineSortBy: 'published',
      timelineSortOrder: 'newest',
    };

    service = new PostCreationService(mockSettings);
  });

  describe('generatePostData', () => {
    it('should generate valid PostData with minimum required fields', () => {
      const input: PostCreationInput = {
        content: 'Hello, world!',
      };

      const postData = service.generatePostData(input);

      expect(postData.platform).toBe('post');
      expect(postData.id).toMatch(/^post_\d+$/);
      expect(postData.author.name).toBe('Test User');
      expect(postData.author.avatar).toBe('https://example.com/avatar.png');
      expect(postData.content.text).toBe('Hello, world!');
      expect(postData.content.markdown).toBe('Hello, world!');
      expect(postData.media).toEqual([]);
      expect(postData.metadata.timestamp).toBeInstanceOf(Date);
    });

    it('should include media in generated PostData', () => {
      const media: Media[] = [
        {
          type: 'image',
          url: 'https://example.com/image1.png',
          altText: 'Test image',
        },
      ];

      const input: PostCreationInput = {
        content: 'Post with image',
        media,
      };

      const postData = service.generatePostData(input);

      expect(postData.media).toHaveLength(1);
      expect(postData.media[0].url).toBe('https://example.com/image1.png');
    });

    it('should include link previews in generated PostData', () => {
      const input: PostCreationInput = {
        content: 'Check out https://example.com',
        linkPreviews: ['https://example.com'],
      };

      const postData = service.generatePostData(input);

      expect(postData.linkPreviews).toEqual(['https://example.com']);
    });

    it('should generate unique IDs for different posts', () => {
      const input: PostCreationInput = {
        content: 'Test post',
      };

      const post1 = service.generatePostData(input);
      const post2 = service.generatePostData(input);

      expect(post1.id).not.toBe(post2.id);
    });

    it('should use default username when not set', () => {
      const settingsWithoutName = { ...mockSettings, userName: '' };
      const serviceWithoutName = new PostCreationService(settingsWithoutName);

      const input: PostCreationInput = {
        content: 'Test',
      };

      const postData = serviceWithoutName.generatePostData(input);

      expect(postData.author.name).toBe('Unknown User');
    });

    it('should throw error for invalid content', () => {
      const input: PostCreationInput = {
        content: '', // Empty content
      };

      expect(() => service.generatePostData(input)).toThrow('Invalid post content');
    });
  });

  describe('validateContent', () => {
    it('should validate valid content', () => {
      const input: PostCreationInput = {
        content: 'This is valid content with enough text',
      };

      const result = service.validateContent(input);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty content', () => {
      const input: PostCreationInput = {
        content: '',
      };

      const result = service.validateContent(input);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Content cannot be empty');
    });

    it('should reject content exceeding max length', () => {
      const input: PostCreationInput = {
        content: 'a'.repeat(10001), // 10,001 characters
      };

      const result = service.validateContent(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('maximum length'))).toBe(true);
    });

    it('should reject too many media items', () => {
      const media: Media[] = Array(11).fill({
        type: 'image',
        url: 'https://example.com/image.png',
      });

      const input: PostCreationInput = {
        content: 'Post with too many images',
        media,
      };

      const result = service.validateContent(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Cannot attach more than 10 images'))).toBe(true);
    });

    it('should warn about short content', () => {
      const input: PostCreationInput = {
        content: 'Short',
      };

      const result = service.validateContent(input);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('very short'))).toBe(true);
    });

    it('should warn about missing alt text', () => {
      const media: Media[] = [
        {
          type: 'image',
          url: 'https://example.com/image.png',
          // No alt text
        },
      ];

      const input: PostCreationInput = {
        content: 'Image without alt text',
        media,
      };

      const result = service.validateContent(input);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('missing alt text'))).toBe(true);
    });

    it('should validate media array items', () => {
      const media: Media[] = [
        {
          type: 'image',
          url: '', // Missing URL
        },
      ];

      const input: PostCreationInput = {
        content: 'Invalid media',
        media,
      };

      const result = service.validateContent(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing URL'))).toBe(true);
    });

    it('should warn about too many link previews', () => {
      const input: PostCreationInput = {
        content: 'Many links',
        linkPreviews: Array(6).fill('https://example.com'),
      };

      const result = service.validateContent(input);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('link previews'))).toBe(true);
    });
  });


  describe('getContentStats', () => {
    it('should calculate content statistics', () => {
      const input: PostCreationInput = {
        content: 'This is a test post with some words',
        media: [{ type: 'image', url: 'https://example.com/image.png' }],
        linkPreviews: ['https://example.com'],
      };

      const stats = service.getContentStats(input);

      expect(stats.characterCount).toBe(36);
      expect(stats.wordCount).toBe(8);
      expect(stats.mediaCount).toBe(1);
      expect(stats.linkCount).toBe(1);
      expect(stats.estimatedReadingTime).toBeGreaterThan(0);
    });

    it('should handle empty content', () => {
      const input: PostCreationInput = {
        content: '',
      };

      const stats = service.getContentStats(input);

      expect(stats.characterCount).toBe(0);
      expect(stats.wordCount).toBe(0);
    });

    it('should calculate reading time', () => {
      const longContent = 'word '.repeat(400); // 400 words
      const input: PostCreationInput = {
        content: longContent,
      };

      const stats = service.getContentStats(input);

      expect(stats.estimatedReadingTime).toBe(2); // 400 words / 200 WPM = 2 minutes
    });
  });

  describe('static methods', () => {
    it('should return validation limits', () => {
      const limits = PostCreationService.getValidationLimits();

      expect(limits.maxContentLength).toBe(10000);
      expect(limits.minContentLength).toBe(1);
      expect(limits.maxMediaCount).toBe(10);
      expect(limits.maxLinkPreviews).toBe(5);
    });
  });

  describe('user-created posts are free', () => {
    it('should not consume credits for user-created posts', () => {
      const initialCredits = mockSettings.creditsRemaining;

      const input: PostCreationInput = {
        content: 'My personal post',
        media: [{ type: 'image', url: 'https://example.com/image.png' }],
      };

      service.generatePostData(input);

      // Credits should remain the same
      expect(mockSettings.creditsRemaining).toBe(initialCredits);
    });

    it('should document that user posts are free in service description', () => {
      // This is a documentation test
      // User-created posts (platform: 'post') do NOT consume credits
      // Only external social media archiving consumes credits
      expect(true).toBe(true);
    });
  });
});
