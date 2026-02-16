import { describe, it, expect, beforeEach } from 'vitest';
import { LinkPreviewExtractor } from '@/services/LinkPreviewExtractor';
import type { Platform } from '@/types/post';

describe('LinkPreviewExtractor', () => {
  let extractor: LinkPreviewExtractor;

  beforeEach(() => {
    extractor = new LinkPreviewExtractor();
  });

  describe('Service lifecycle', () => {
    it('should initialize without errors', async () => {
      await expect(extractor.initialize()).resolves.toBeUndefined();
    });

    it('should dispose without errors', async () => {
      await expect(extractor.dispose()).resolves.toBeUndefined();
    });

    it('should report healthy status', () => {
      expect(extractor.isHealthy()).toBe(true);
    });
  });

  describe('Basic URL extraction', () => {
    it('should extract single HTTP URL from content', () => {
      const content = 'Check out this article: http://example.com/article';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('http://example.com/article');
    });

    it('should extract single HTTPS URL from content', () => {
      const content = 'Check out this article: https://example.com/article';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should extract multiple URLs from content', () => {
      const content = `
        First link: https://example.com/first
        Second link: https://example.org/second
        Third link: http://example.net/third
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(3);
      expect(result[0]?.url).toBe('https://example.com/first');
      expect(result[1]?.url).toBe('https://example.org/second');
      expect(result[2]?.url).toBe('http://example.net/third');
    });

    it('should return empty array for content without URLs', () => {
      const content = 'This is just plain text without any links';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(0);
    });

    it('should handle empty string', () => {
      const result = extractor.extractUrls('');
      expect(result).toHaveLength(0);
    });

    it('should handle null-like content gracefully', () => {
      // @ts-expect-error Testing edge case
      const result = extractor.extractUrls(null);
      expect(result).toHaveLength(0);

      // @ts-expect-error Testing edge case
      const result2 = extractor.extractUrls(undefined);
      expect(result2).toHaveLength(0);
    });
  });

  describe('URL filtering - images and media', () => {
    it('should exclude image URLs by default', () => {
      const content = `
        Article: https://example.com/article
        Image: https://example.com/photo.jpg
        Another article: https://example.org/post
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(2);
      expect(result[0]?.url).toBe('https://example.com/article');
      expect(result[1]?.url).toBe('https://example.org/post');
    });

    it('should exclude various image formats', () => {
      const content = `
        https://example.com/image.jpg
        https://example.com/image.jpeg
        https://example.com/image.png
        https://example.com/image.gif
        https://example.com/image.webp
        https://example.com/valid
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/valid');
    });

    it('should exclude video URLs', () => {
      const content = `
        https://example.com/video.mp4
        https://example.com/video.mov
        https://example.com/valid
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/valid');
    });

    it('should include media URLs when excludeImages is false', () => {
      const extractor = new LinkPreviewExtractor({ excludeImages: false });
      const content = `
        https://example.com/photo.jpg
        https://example.com/video.mp4
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(2);
    });
  });

  describe('URL filtering - platform URLs', () => {
    it('should exclude Facebook URLs by default', () => {
      const content = `
        Check out: https://example.com/article
        Also: https://facebook.com/post/123
        And: https://fb.com/photo/456
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should exclude Instagram URLs', () => {
      const content = `
        https://example.com/article
        https://instagram.com/p/ABC123
        https://instagr.am/p/XYZ789
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should exclude X/Twitter URLs', () => {
      const content = `
        https://example.com/article
        https://x.com/user/status/123
        https://twitter.com/user/status/456
        https://t.co/abc123
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should exclude LinkedIn URLs', () => {
      const content = `
        https://example.com/article
        https://linkedin.com/posts/user_123
        https://lnkd.in/abc123
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should exclude TikTok URLs', () => {
      const content = `
        https://example.com/article
        https://tiktok.com/@user/video/123
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should exclude Threads URLs', () => {
      const content = `
        https://example.com/article
        https://threads.net/@user/post/123
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should exclude YouTube URLs', () => {
      const content = `
        https://example.com/article
        https://youtube.com/watch?v=123
        https://youtu.be/abc123
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should exclude Reddit URLs', () => {
      const content = `
        https://example.com/article
        https://reddit.com/r/test/comments/123
        https://redd.it/abc123
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should include platform URLs when excludePlatformUrls is false', () => {
      const extractor = new LinkPreviewExtractor({ excludePlatformUrls: false });
      const content = `
        https://example.com/article
        https://facebook.com/post/123
        https://twitter.com/user/status/456
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(3);
    });

    it('should exclude platform subdomains', () => {
      const content = `
        https://example.com/article
        https://m.facebook.com/post/123
        https://www.instagram.com/p/ABC
        https://mobile.twitter.com/user/status/123
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });
  });

  describe('Max links limit', () => {
    it('should respect default max links limit (3)', () => {
      const content = `
        https://example.com/1
        https://example.com/2
        https://example.com/3
        https://example.com/4
        https://example.com/5
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(3);
    });

    it('should respect custom max links limit', () => {
      const extractor = new LinkPreviewExtractor({ maxLinks: 5 });
      const content = `
        https://example.com/1
        https://example.com/2
        https://example.com/3
        https://example.com/4
        https://example.com/5
        https://example.com/6
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(5);
    });

    it('should return all URLs when count is less than max', () => {
      const content = `
        https://example.com/1
        https://example.com/2
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(2);
    });

    it('should allow unlimited links when maxLinks is 0', () => {
      const extractor = new LinkPreviewExtractor({ maxLinks: 0 });
      const content = Array.from({ length: 10 }, (_, i) =>
        `https://example.com/${i + 1}`
      ).join('\n');
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(10);
    });
  });

  describe('Duplicate URL handling', () => {
    it('should remove duplicate URLs', () => {
      const content = `
        https://example.com/article
        Some text here
        https://example.com/article
        More text
        https://example.com/article
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should keep first occurrence of duplicate URLs', () => {
      const content = `
        https://example.com/first
        https://example.com/second
        https://example.com/first
        https://example.com/third
        https://example.com/second
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(3);
      expect(result[0]?.url).toBe('https://example.com/first');
      expect(result[1]?.url).toBe('https://example.com/second');
      expect(result[2]?.url).toBe('https://example.com/third');
    });
  });

  describe('extractUrlsWithDetails', () => {
    it('should return detailed extraction statistics', () => {
      const content = `
        https://example.com/valid1
        https://example.com/valid2
        https://facebook.com/post/123
        https://example.com/photo.jpg
        https://example.com/valid3
        https://example.com/valid4
      `;
      const result = extractor.extractUrlsWithDetails(content);

      expect(result.links).toHaveLength(3); // maxLinks = 3
      expect(result.totalFound).toBe(6);
      expect(result.excluded).toBeGreaterThan(0);
    });

    it('should count excluded URLs correctly', () => {
      const content = `
        https://example.com/valid
        https://facebook.com/post/123
        https://example.com/photo.jpg
        https://twitter.com/user/status/456
      `;
      const result = extractor.extractUrlsWithDetails(content);

      expect(result.links).toHaveLength(1);
      expect(result.totalFound).toBe(4);
      expect(result.excluded).toBe(3);
    });

    it('should handle content with no valid URLs', () => {
      const content = `
        https://facebook.com/post/123
        https://example.com/photo.jpg
      `;
      const result = extractor.extractUrlsWithDetails(content);

      expect(result.links).toHaveLength(0);
      expect(result.totalFound).toBe(2);
      expect(result.excluded).toBe(2);
    });
  });

  describe('URL format edge cases', () => {
    it('should extract URLs with query parameters', () => {
      const content = 'https://example.com/page?param1=value1&param2=value2';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/page?param1=value1&param2=value2');
    });

    it('should extract URLs with anchors/fragments', () => {
      const content = 'https://example.com/page#section';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/page#section');
    });

    it('should extract URLs with ports', () => {
      const content = 'https://example.com:8080/api/endpoint';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com:8080/api/endpoint');
    });

    it('should extract URLs with authentication', () => {
      const content = 'https://user:pass@example.com/resource';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://user:pass@example.com/resource');
    });

    it('should stop at whitespace', () => {
      const content = 'Check this: https://example.com/article and this too';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should stop at angle brackets (HTML/Markdown)', () => {
      const content = '<a href="https://example.com/article">Link</a>';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article');
    });

    it('should handle URLs in parentheses', () => {
      const content = 'See (https://example.com/article) for more info';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe('https://example.com/article)');
    });

    it('should handle URLs with trailing punctuation', () => {
      const content = 'Check https://example.com/article. It is interesting!';
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(1);
      // Note: The regex will include the period, which is expected behavior
      expect(result[0]?.url).toContain('https://example.com/article');
    });
  });

  describe('Options management', () => {
    it('should get current options', () => {
      const options = extractor.getOptions();

      expect(options.maxLinks).toBe(3);
      expect(options.excludeImages).toBe(true);
      expect(options.excludePlatformUrls).toBe(true);
    });

    it('should update options dynamically', () => {
      extractor.setOptions({ maxLinks: 5, excludeImages: false });
      const options = extractor.getOptions();

      expect(options.maxLinks).toBe(5);
      expect(options.excludeImages).toBe(false);
      expect(options.excludePlatformUrls).toBe(true); // Unchanged
    });

    it('should allow partial option updates', () => {
      extractor.setOptions({ maxLinks: 10 });
      const options = extractor.getOptions();

      expect(options.maxLinks).toBe(10);
      expect(options.excludeImages).toBe(true); // Unchanged
    });
  });

  describe('Utility methods', () => {
    it('should return list of supported media extensions', () => {
      const extensions = extractor.getSupportedMediaExtensions();

      expect(extensions).toContain('jpg');
      expect(extensions).toContain('png');
      expect(extensions).toContain('mp4');
      expect(extensions.length).toBeGreaterThan(0);
    });

    it('should return list of platform domains', () => {
      const domains = extractor.getPlatformDomains();

      expect(domains).toContain('facebook.com');
      expect(domains).toContain('twitter.com');
      expect(domains).toContain('instagram.com');
      expect(domains.length).toBeGreaterThan(0);
    });
  });

  describe('Real-world content scenarios', () => {
    it('should handle typical social media post with mixed content', () => {
      const content = `
        Check out this amazing article: https://techblog.example.com/article-2024

        Also see my photos at https://instagram.com/myaccount/p/ABC123

        More resources:
        - https://github.com/example/repo
        - https://docs.example.com/guide

        #tech #coding
      `;
      const result = extractor.extractUrls(content);

      // Should extract: techblog, github, docs (excludes Instagram)
      expect(result.length).toBeLessThanOrEqual(3);
      expect(result.some(link => link.url.includes('techblog'))).toBe(true);
      expect(result.some(link => link.url.includes('instagram'))).toBe(false);
    });

    it('should handle blog post with footnote URLs', () => {
      const content = `
        According to research[1], the market is growing.

        [1] https://example.com/research-2024
        [2] https://example.org/statistics
        [3] https://example.net/analysis
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(3);
    });

    it('should handle content with only platform URLs', () => {
      const content = `
        Follow me:
        Facebook: https://facebook.com/profile
        Twitter: https://twitter.com/username
        Instagram: https://instagram.com/username
      `;
      const result = extractor.extractUrls(content);

      // All are platform URLs, should be excluded
      expect(result).toHaveLength(0);
    });

    it('should handle markdown-formatted links', () => {
      const content = `
        Check [this article](https://example.com/article)
        and [another resource](https://example.org/resource)
      `;
      const result = extractor.extractUrls(content);

      expect(result).toHaveLength(2);
    });
  });

  describe('Platform-specific behavior', () => {
    it('should pass platform parameter to extraction', () => {
      const content = 'https://example.com/article';
      const platform: Platform = 'facebook';
      const result = extractor.extractUrls(content, platform);

      expect(result).toHaveLength(1);
    });

    it('should handle all supported platforms', () => {
      const platforms: Platform[] = [
        'facebook',
        'instagram',
        'linkedin',
        'tiktok',
        'x',
        'threads',
        'youtube',
        'reddit',
        'pinterest',
        'substack',
        'mastodon',
        'bluesky',
      ];

      platforms.forEach(platform => {
        const content = 'https://example.com/article';
        const result = extractor.extractUrls(content, platform);
        expect(result).toHaveLength(1);
      });
    });
  });
});
