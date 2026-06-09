import { describe, it, expect } from 'vitest';
import {
  isLocalSentinel,
  stripLocalpathPrefix,
  LOCALPATH_GUARD_VECTOR,
} from '@/services/markdown/formatters/LocalpathGuard';

/**
 * Pins the plugin LocalpathGuard contract against the shared C1 vector. Must
 * stay behaviorally identical to the workers `local-sentinel` and the share-web
 * mirror (Ship 3, item 1).
 */
describe('LocalpathGuard — shared vector', () => {
  for (const [input, stripped, isSentinel] of LOCALPATH_GUARD_VECTOR) {
    it(`isLocalSentinel(${JSON.stringify(input)}) === ${isSentinel}`, () => {
      expect(isLocalSentinel(input)).toBe(isSentinel);
    });

    it(`stripLocalpathPrefix(${JSON.stringify(input)}) === ${JSON.stringify(stripped)}`, () => {
      expect(stripLocalpathPrefix(input)).toBe(stripped);
    });
  }
});

describe('isLocalSentinel', () => {
  it('returns false for non-string / empty', () => {
    expect(isLocalSentinel(null)).toBe(false);
    expect(isLocalSentinel(undefined)).toBe(false);
    expect(isLocalSentinel('')).toBe(false);
  });

  it('returns true for the localpath: prefix', () => {
    expect(isLocalSentinel('localpath:media/a.jpg')).toBe(true);
    expect(isLocalSentinel('localpath:anything')).toBe(true);
  });

  it('returns false for absolute http(s) URLs (case-insensitive)', () => {
    expect(isLocalSentinel('https://cdn.example.com/media/a.jpg')).toBe(false);
    expect(isLocalSentinel('HTTP://example.com/media/x')).toBe(false);
  });

  it('returns true for bare relative media/ paths', () => {
    expect(isLocalSentinel('media/a.jpg')).toBe(true);
    expect(isLocalSentinel('./media/a.jpg')).toBe(true);
    expect(isLocalSentinel('../media/a.jpg')).toBe(true);
  });

  it('returns false for unrelated relative paths (attachments/, media.jpg)', () => {
    expect(isLocalSentinel('attachments/social-archives/x.jpg')).toBe(false);
    expect(isLocalSentinel('media.jpg')).toBe(false);
  });
});

describe('stripLocalpathPrefix', () => {
  it('removes only the localpath: prefix (keeps a following ./)', () => {
    expect(stripLocalpathPrefix('localpath:media/a.jpg')).toBe('media/a.jpg');
    expect(stripLocalpathPrefix('localpath:./media/a.jpg')).toBe('./media/a.jpg');
  });

  it('removes a single leading ./ or ../ token from bare relatives', () => {
    expect(stripLocalpathPrefix('./media/a.jpg')).toBe('media/a.jpg');
    expect(stripLocalpathPrefix('../media/a.jpg')).toBe('media/a.jpg');
    expect(stripLocalpathPrefix('media/a.jpg')).toBe('media/a.jpg');
  });

  it('leaves a remote URL untouched', () => {
    const url = 'https://example.com/a/b/c.mp4';
    expect(stripLocalpathPrefix(url)).toBe(url);
  });
});
