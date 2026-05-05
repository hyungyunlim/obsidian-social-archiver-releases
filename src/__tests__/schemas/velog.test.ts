import { describe, it, expect } from 'vitest';
import {
  VelogURLSchema,
  extractVelogUsername,
  extractVelogPostParts,
} from '../../schemas/platforms/velog';
import { validateAndDetectPlatform } from '../../schemas/platforms';

describe('Velog URL Schema', () => {
  describe('VelogURLSchema', () => {
    it('should accept single-post URLs', () => {
      const result = VelogURLSchema.safeParse('https://velog.io/@velog/test-post-slug');
      expect(result.success).toBe(true);
    });

    it('should accept single-post URLs with www subdomain', () => {
      const result = VelogURLSchema.safeParse('https://www.velog.io/@velog/test-post-slug');
      expect(result.success).toBe(true);
    });

    it('should accept percent-encoded Korean slug URLs', () => {
      const url = 'https://velog.io/@velog/' + encodeURIComponent('개발자-블로그');
      const result = VelogURLSchema.safeParse(url);
      expect(result.success).toBe(true);
    });

    it('should accept RSS feed URLs (regression)', () => {
      const result = VelogURLSchema.safeParse('https://v2.velog.io/rss/@velog');
      expect(result.success).toBe(true);
    });

    it('should reject post URLs with extra path segments', () => {
      const result = VelogURLSchema.safeParse('https://velog.io/@user/slug/extra');
      expect(result.success).toBe(false);
    });

    it('should reject non-post, non-RSS Velog paths', () => {
      const result = VelogURLSchema.safeParse('https://velog.io/tags/foo');
      expect(result.success).toBe(false);
    });

    it('should reject malformed RSS paths', () => {
      const result = VelogURLSchema.safeParse('https://v2.velog.io/rss/@user/post');
      expect(result.success).toBe(false);
    });
  });

  describe('extractVelogUsername', () => {
    it('should extract username from post URL', () => {
      expect(extractVelogUsername('https://velog.io/@alice/my-post')).toBe('alice');
    });

    it('should extract username from profile URL', () => {
      expect(extractVelogUsername('https://velog.io/@alice')).toBe('alice');
    });

    it('should extract username from RSS URL', () => {
      expect(extractVelogUsername('https://v2.velog.io/rss/@alice')).toBe('alice');
    });
  });

  describe('extractVelogPostParts', () => {
    it('should extract username and slug from post URL', () => {
      expect(extractVelogPostParts('https://velog.io/@alice/my-post')).toEqual({
        username: 'alice',
        slug: 'my-post',
      });
    });

    it('should decode percent-encoded slug', () => {
      const url = 'https://velog.io/@velog/' + encodeURIComponent('개발자-블로그');
      expect(extractVelogPostParts(url)).toEqual({
        username: 'velog',
        slug: '개발자-블로그',
      });
    });

    it('should return null for profile URL', () => {
      expect(extractVelogPostParts('https://velog.io/@alice')).toBeNull();
    });

    it('should return null for RSS URL', () => {
      expect(extractVelogPostParts('https://v2.velog.io/rss/@alice')).toBeNull();
    });
  });

  describe('validateAndDetectPlatform integration', () => {
    it('should detect velog for single-post URL (AC4)', () => {
      const result = validateAndDetectPlatform('https://velog.io/@velog/test-slug');
      expect(result.valid).toBe(true);
      expect(result.platform).toBe('velog');
    });

    it('should detect velog for RSS feed URL (AC5)', () => {
      const result = validateAndDetectPlatform('https://v2.velog.io/rss/@velog');
      expect(result.valid).toBe(true);
      expect(result.platform).toBe('velog');
    });
  });
});
