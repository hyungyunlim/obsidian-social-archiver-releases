/**
 * MediaPlaceholderGenerator Tests
 *
 * Tests for generating and parsing Obsidian callout placeholders for expired/unavailable media.
 * Ensures roundtrip consistency (generate → parse → same data).
 */

import { describe, it, expect } from 'vitest';
import { MediaPlaceholderGenerator, type MediaExpiredResult } from '../../services/MediaPlaceholderGenerator';

describe('MediaPlaceholderGenerator', () => {
  /**
   * Create a test MediaExpiredResult object
   */
  function createTestExpiredResult(overrides: Partial<MediaExpiredResult> = {}): MediaExpiredResult {
    return {
      originalUrl: 'https://scontent.fbcdn.net/v/t1.0-9/12345_67890.jpg',
      type: 'image',
      reason: 'cdn_expired',
      detectedAt: '2024-03-15T10:30:00.000Z',
      ...overrides,
    };
  }

  describe('generatePlaceholder', () => {
    it('should generate valid Obsidian callout syntax with warning type', () => {
      const expired = createTestExpiredResult();
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      expect(placeholder).toContain('> [!warning] Media Unavailable (1)');
      expect(placeholder.startsWith('> [!warning]')).toBe(true);
    });

    it('should include original URL in backticks', () => {
      const expired = createTestExpiredResult({
        originalUrl: 'https://scontent.fbcdn.net/v/t1.0-9/test.jpg',
      });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      expect(placeholder).toContain('> Original URL: `https://scontent.fbcdn.net/v/t1.0-9/test.jpg`');
    });

    it('should include original URL in HTML comment for parsing', () => {
      const expired = createTestExpiredResult({
        originalUrl: 'https://example.com/media.jpg',
      });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      expect(placeholder).toContain('<!-- social-archiver:expired-media:image:https://example.com/media.jpg -->');
    });

    it('should handle image type', () => {
      const expired = createTestExpiredResult({ type: 'image' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      expect(placeholder).toContain('This image could not be downloaded');
      expect(placeholder).toContain('<!-- social-archiver:expired-media:image:');
    });

    it('should handle video type', () => {
      const expired = createTestExpiredResult({ type: 'video' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      expect(placeholder).toContain('This video could not be downloaded');
      expect(placeholder).toContain('<!-- social-archiver:expired-media:video:');
    });

    it('should handle audio type', () => {
      const expired = createTestExpiredResult({ type: 'audio' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      expect(placeholder).toContain('This audio could not be downloaded');
      expect(placeholder).toContain('<!-- social-archiver:expired-media:audio:');
    });

    it('should handle document type', () => {
      const expired = createTestExpiredResult({ type: 'document' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      expect(placeholder).toContain('This document could not be downloaded');
      expect(placeholder).toContain('<!-- social-archiver:expired-media:document:');
    });

    it('should display "CDN URL expired" reason text', () => {
      const expired = createTestExpiredResult({ reason: 'cdn_expired' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      expect(placeholder).toContain('CDN URL expired');
    });

    it('should display "download failed" reason text', () => {
      const expired = createTestExpiredResult({ reason: 'download_failed' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      expect(placeholder).toContain('download failed');
    });

    it('should use 1-based index numbering', () => {
      const expired = createTestExpiredResult();

      const placeholder0 = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      expect(placeholder0).toContain('Media Unavailable (1)');

      const placeholder1 = MediaPlaceholderGenerator.generatePlaceholder(expired, 1);
      expect(placeholder1).toContain('Media Unavailable (2)');

      const placeholder9 = MediaPlaceholderGenerator.generatePlaceholder(expired, 9);
      expect(placeholder9).toContain('Media Unavailable (10)');
    });

    it('should generate multi-line callout with all lines prefixed with >', () => {
      const expired = createTestExpiredResult();
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      const lines = placeholder.split('\n');
      expect(lines.length).toBe(4);
      expect(lines.every((line) => line.startsWith('>'))).toBe(true);
    });
  });

  describe('parsePlaceholder', () => {
    it('should parse placeholder generated by generatePlaceholder', () => {
      const original = createTestExpiredResult({
        originalUrl: 'https://example.com/test.jpg',
        type: 'image',
        reason: 'cdn_expired',
      });

      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(original, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed).not.toBeNull();
      expect(parsed!.originalUrl).toBe('https://example.com/test.jpg');
      expect(parsed!.type).toBe('image');
      expect(parsed!.reason).toBe('cdn_expired');
      expect(parsed!.detectedAt).toBeDefined();
    });

    it('should return null for non-placeholder markdown', () => {
      const markdown = 'This is just regular markdown text.';
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(markdown);

      expect(parsed).toBeNull();
    });

    it('should return null for markdown without HTML comment', () => {
      const markdown = '> [!warning] Some warning\n> But not a media placeholder';
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(markdown);

      expect(parsed).toBeNull();
    });

    it('should parse image type correctly', () => {
      const expired = createTestExpiredResult({ type: 'image' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.type).toBe('image');
    });

    it('should parse video type correctly', () => {
      const expired = createTestExpiredResult({ type: 'video' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.type).toBe('video');
    });

    it('should parse audio type correctly', () => {
      const expired = createTestExpiredResult({ type: 'audio' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.type).toBe('audio');
    });

    it('should parse document type correctly', () => {
      const expired = createTestExpiredResult({ type: 'document' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.type).toBe('document');
    });

    it('should parse cdn_expired reason correctly', () => {
      const expired = createTestExpiredResult({ reason: 'cdn_expired' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.reason).toBe('cdn_expired');
    });

    it('should parse download_failed reason correctly', () => {
      const expired = createTestExpiredResult({ reason: 'download_failed' });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.reason).toBe('download_failed');
    });

    it('should detect reason from callout text when parsing', () => {
      // Test with cdn_expired
      const cdnExpiredMarkdown = `
> [!warning] Media Unavailable (1)
> This image could not be downloaded (CDN URL expired).
> Original URL: \`https://example.com/test.jpg\`
> <!-- social-archiver:expired-media:image:https://example.com/test.jpg -->
      `.trim();
      const cdnParsed = MediaPlaceholderGenerator.parsePlaceholder(cdnExpiredMarkdown);
      expect(cdnParsed!.reason).toBe('cdn_expired');

      // Test with download_failed
      const downloadFailedMarkdown = `
> [!warning] Media Unavailable (1)
> This image could not be downloaded (download failed).
> Original URL: \`https://example.com/test.jpg\`
> <!-- social-archiver:expired-media:image:https://example.com/test.jpg -->
      `.trim();
      const downloadParsed = MediaPlaceholderGenerator.parsePlaceholder(downloadFailedMarkdown);
      expect(downloadParsed!.reason).toBe('download_failed');
    });

    it('should generate new detectedAt timestamp when parsing', () => {
      const original = createTestExpiredResult({
        detectedAt: '2024-01-01T00:00:00.000Z',
      });

      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(original, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.detectedAt).toBeDefined();
      // Parsed detectedAt should be a recent ISO timestamp, not the original one
      const parsedDate = new Date(parsed!.detectedAt);
      expect(parsedDate.getTime()).toBeGreaterThan(new Date('2024-01-01').getTime());
    });
  });

  describe('roundtrip consistency', () => {
    it('should maintain originalUrl through generate → parse cycle', () => {
      const testUrls = [
        'https://scontent.fbcdn.net/v/t1.0-9/12345_67890.jpg',
        'https://instagram.com/p/ABC123/media/?size=l',
        'https://pbs.twimg.com/media/FxYz123.jpg:large',
      ];

      for (const url of testUrls) {
        const expired = createTestExpiredResult({ originalUrl: url });
        const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
        const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

        expect(parsed!.originalUrl).toBe(url);
      }
    });

    it('should maintain type through generate → parse cycle', () => {
      const types: Array<MediaExpiredResult['type']> = ['image', 'video', 'audio', 'document'];

      for (const type of types) {
        const expired = createTestExpiredResult({ type });
        const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
        const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

        expect(parsed!.type).toBe(type);
      }
    });

    it('should maintain reason through generate → parse cycle', () => {
      const reasons: Array<MediaExpiredResult['reason']> = ['cdn_expired', 'download_failed'];

      for (const reason of reasons) {
        const expired = createTestExpiredResult({ reason });
        const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
        const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

        expect(parsed!.reason).toBe(reason);
      }
    });

    it('should maintain all data through complete roundtrip', () => {
      const testCases: MediaExpiredResult[] = [
        {
          originalUrl: 'https://scontent.fbcdn.net/test1.jpg',
          type: 'image',
          reason: 'cdn_expired',
          detectedAt: '2024-03-15T10:00:00.000Z',
        },
        {
          originalUrl: 'https://video.cdn.com/test2.mp4',
          type: 'video',
          reason: 'download_failed',
          detectedAt: '2024-03-15T11:00:00.000Z',
        },
        {
          originalUrl: 'https://audio.cdn.com/test3.mp3',
          type: 'audio',
          reason: 'cdn_expired',
          detectedAt: '2024-03-15T12:00:00.000Z',
        },
        {
          originalUrl: 'https://docs.cdn.com/test4.pdf',
          type: 'document',
          reason: 'download_failed',
          detectedAt: '2024-03-15T13:00:00.000Z',
        },
      ];

      for (const original of testCases) {
        const placeholder = MediaPlaceholderGenerator.generatePlaceholder(original, 0);
        const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

        expect(parsed).not.toBeNull();
        expect(parsed!.originalUrl).toBe(original.originalUrl);
        expect(parsed!.type).toBe(original.type);
        expect(parsed!.reason).toBe(original.reason);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle very long URLs', () => {
      const longUrl = 'https://scontent.fbcdn.net/v/t1.0-9/' + 'x'.repeat(500) + '.jpg?param1=value1&param2=value2';
      const expired = createTestExpiredResult({ originalUrl: longUrl });

      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.originalUrl).toBe(longUrl);
    });

    it('should handle URLs with special characters', () => {
      const specialUrls = [
        'https://example.com/media?id=123&type=image&format=jpg',
        'https://example.com/path/to/file%20with%20spaces.jpg',
        'https://example.com/media#fragment',
        'https://example.com/media?query=hello+world',
        'https://example.com/media/файл.jpg', // Cyrillic
        'https://example.com/media/파일.jpg', // Korean
      ];

      for (const url of specialUrls) {
        const expired = createTestExpiredResult({ originalUrl: url });
        const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
        const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

        expect(parsed!.originalUrl).toBe(url);
      }
    });

    it('should handle URLs with encoded characters', () => {
      const encodedUrl = 'https://example.com/media?name=%E3%83%86%E3%82%B9%E3%83%88&id=123';
      const expired = createTestExpiredResult({ originalUrl: encodedUrl });

      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.originalUrl).toBe(encodedUrl);
    });

    it('should handle URLs with multiple query parameters', () => {
      const queryUrl = 'https://example.com/media?a=1&b=2&c=3&d=4&e=5';
      const expired = createTestExpiredResult({ originalUrl: queryUrl });

      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.originalUrl).toBe(queryUrl);
    });

    it('should handle data URLs (though unlikely in practice)', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
      const expired = createTestExpiredResult({ originalUrl: dataUrl });

      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder);

      expect(parsed!.originalUrl).toBe(dataUrl);
    });

    it('should handle large index numbers', () => {
      const expired = createTestExpiredResult();

      const placeholder999 = MediaPlaceholderGenerator.generatePlaceholder(expired, 999);
      expect(placeholder999).toContain('Media Unavailable (1000)');

      const parsed = MediaPlaceholderGenerator.parsePlaceholder(placeholder999);
      expect(parsed).not.toBeNull();
    });

    it('should handle markdown with extra whitespace', () => {
      const expired = createTestExpiredResult();
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      // Add extra whitespace
      const withWhitespace = placeholder + '\n\n\n';
      const parsed = MediaPlaceholderGenerator.parsePlaceholder(withWhitespace);

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe(expired.type);
    });

    it('should handle markdown embedded in larger document', () => {
      const expired = createTestExpiredResult();
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      const fullDocument = `
# My Post

Some content here...

${placeholder}

More content below...
      `;

      const parsed = MediaPlaceholderGenerator.parsePlaceholder(fullDocument);
      expect(parsed).not.toBeNull();
      expect(parsed!.originalUrl).toBe(expired.originalUrl);
    });
  });

  describe('format validation', () => {
    it('should generate exactly 4 lines', () => {
      const expired = createTestExpiredResult();
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      const lines = placeholder.split('\n');
      expect(lines.length).toBe(4);
    });

    it('should have consistent line structure', () => {
      const expired = createTestExpiredResult();
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      const lines = placeholder.split('\n');

      // Line 1: Warning header
      expect(lines[0]).toMatch(/^> \[!warning\] Media Unavailable \(\d+\)$/);

      // Line 2: Description with type and reason
      expect(lines[1]).toMatch(/^> This (image|video|audio|document) could not be downloaded \((CDN URL expired|download failed)\)\.$/);

      // Line 3: Original URL
      expect(lines[2]).toMatch(/^> Original URL: `.+`$/);

      // Line 4: HTML comment
      expect(lines[3]).toMatch(/^> <!-- social-archiver:expired-media:(image|video|audio|document):.+ -->$/);
    });

    it('should include HTML comment on last line', () => {
      const expired = createTestExpiredResult();
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      const lines = placeholder.split('\n');
      const lastLine = lines[lines.length - 1];

      expect(lastLine).toContain('<!--');
      expect(lastLine).toContain('-->');
      expect(lastLine).toContain('social-archiver:expired-media');
    });

    it('should not include line breaks in HTML comment', () => {
      const expired = createTestExpiredResult({
        originalUrl: 'https://example.com/very/long/path/to/media/file.jpg',
      });
      const placeholder = MediaPlaceholderGenerator.generatePlaceholder(expired, 0);

      const commentMatch = placeholder.match(/<!-- .+ -->/);
      expect(commentMatch).not.toBeNull();
      expect(commentMatch![0]).not.toContain('\n');
    });
  });
});
