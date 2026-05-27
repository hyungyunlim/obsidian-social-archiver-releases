import { describe, it, expect } from 'vitest';
import {
  isSubstackNoteUrl,
  resolveSubstackPostType,
  isSubstackNote,
  isHlsVideoUrl,
} from '@/utils/substack';

describe('substack url helpers (PRD §22.1)', () => {
  describe('isSubstackNoteUrl', () => {
    it('detects note URLs with c- prefix', () => {
      expect(
        isSubstackNoteUrl('https://substack.com/@oliverburkeman/note/c-250449025')
      ).toBe(true);
    });

    it('detects note URLs without c- prefix', () => {
      expect(
        isSubstackNoteUrl('https://substack.com/@oliverburkeman/note/250449025')
      ).toBe(true);
    });

    it('detects subdomain note URLs', () => {
      expect(isSubstackNoteUrl('https://example.substack.com/note/123')).toBe(true);
    });

    it('ignores tracking query when detecting note URLs', () => {
      expect(
        isSubstackNoteUrl('https://substack.com/@h/note/c-1?r=2owgqq&utm_source=x')
      ).toBe(true);
    });

    it('does NOT treat app post URLs (p-) as notes', () => {
      expect(isSubstackNoteUrl('https://substack.com/@handle/p-123456')).toBe(false);
    });

    it('does NOT treat subdomain blog posts (/p/) as notes', () => {
      expect(isSubstackNoteUrl('https://example.substack.com/p/my-slug')).toBe(false);
    });

    it('does NOT treat profile URLs as notes', () => {
      expect(isSubstackNoteUrl('https://substack.com/@handle')).toBe(false);
    });

    it('handles undefined/empty', () => {
      expect(isSubstackNoteUrl(undefined)).toBe(false);
      expect(isSubstackNoteUrl(null)).toBe(false);
      expect(isSubstackNoteUrl('')).toBe(false);
    });
  });

  describe('resolveSubstackPostType', () => {
    it('prefers explicit postType=note over URL', () => {
      // URL looks like an article, but postType says note → trust postType
      expect(
        resolveSubstackPostType('note', 'https://example.substack.com/p/slug')
      ).toBe('note');
    });

    it('prefers explicit postType=article over URL', () => {
      expect(
        resolveSubstackPostType('article', 'https://substack.com/@h/note/c-1')
      ).toBe('article');
    });

    it('falls back to URL-derived note when postType absent', () => {
      expect(
        resolveSubstackPostType(undefined, 'https://substack.com/@h/note/c-1')
      ).toBe('note');
    });

    it('falls back to URL-derived article for /p- and /p/ URLs', () => {
      expect(
        resolveSubstackPostType(undefined, 'https://substack.com/@h/p-123')
      ).toBe('article');
      expect(
        resolveSubstackPostType(undefined, 'https://example.substack.com/p/slug')
      ).toBe('article');
    });

    it('defaults to article when both postType and url are missing', () => {
      expect(resolveSubstackPostType(undefined, undefined)).toBe('article');
    });
  });

  describe('isSubstackNote', () => {
    it('is true for explicit note postType', () => {
      expect(isSubstackNote('note', 'https://example.substack.com/p/slug')).toBe(true);
    });

    it('is true for url-derived note (older archives without postType)', () => {
      expect(isSubstackNote(undefined, 'https://substack.com/@h/note/c-1')).toBe(true);
    });

    it('is false for articles', () => {
      expect(isSubstackNote('article', 'https://substack.com/@h/note/c-1')).toBe(false);
      expect(isSubstackNote(undefined, 'https://example.substack.com/p/slug')).toBe(false);
    });
  });

  describe('isHlsVideoUrl (PRD §22.4)', () => {
    it('detects the Substack HLS resolver URL', () => {
      expect(
        isHlsVideoUrl('https://substack.com/api/v1/video/upload/abc-123/src?type=hls')
      ).toBe(true);
    });

    it('detects type=hls regardless of position in query', () => {
      expect(isHlsVideoUrl('https://x.com/v/1/src?foo=bar&type=hls')).toBe(true);
    });

    it('detects .m3u8 playlist URLs', () => {
      expect(isHlsVideoUrl('https://stream.mux.com/playbackId.m3u8')).toBe(true);
    });

    it('detects .m3u8 with query/token', () => {
      expect(
        isHlsVideoUrl('https://stream.mux.com/playbackId.m3u8?token=JWT')
      ).toBe(true);
    });

    it('does NOT flag a normal mp4 video URL', () => {
      expect(isHlsVideoUrl('https://stream.mux.com/playbackId/high.mp4')).toBe(false);
    });

    it('does NOT flag a normal image URL', () => {
      expect(
        isHlsVideoUrl('https://substack-post-media.s3.amazonaws.com/public/images/x.png')
      ).toBe(false);
    });

    it('handles undefined/empty', () => {
      expect(isHlsVideoUrl(undefined)).toBe(false);
      expect(isHlsVideoUrl(null)).toBe(false);
      expect(isHlsVideoUrl('')).toBe(false);
    });
  });
});
