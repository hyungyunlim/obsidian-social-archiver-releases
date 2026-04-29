import { describe, expect, it } from 'vitest';
import { getPublisherIconEntry } from '@/services/IconService';

describe('IconService - getPublisherIconEntry', () => {
  it('returns image-source entry for known image-only publisher slug (newyorker)', () => {
    // The New Yorker is a `google-cdn` source in the registry — image variant.
    const entry = getPublisherIconEntry('newyorker', undefined);

    expect(entry).not.toBeNull();
    expect(entry?.slug).toBe('newyorker');
    expect(entry?.name).toBe('The New Yorker');
    expect(entry?.icon.type).toBe('image');
    if (entry?.icon.type === 'image') {
      // Google favicon CDN URL points at the canonical domain.
      expect(entry.icon.url).toContain('newyorker.com');
      expect(entry.icon.url).toMatch(/google\.com\/s2\/favicons/);
    }
  });

  it('returns svg-source entry for known svg publisher resolved from URL (BBC)', () => {
    // BBC ships an inline custom SVG path — svg variant.
    const entry = getPublisherIconEntry(undefined, 'https://www.bbc.com/news/articles/abc123');

    expect(entry).not.toBeNull();
    expect(entry?.slug).toBe('bbc');
    expect(entry?.name).toBe('BBC');
    expect(entry?.icon.type).toBe('svg');
    if (entry?.icon.type === 'svg') {
      expect(typeof entry.icon.data.path).toBe('string');
      expect(entry.icon.data.path.length).toBeGreaterThan(0);
      // BBC was authored in a non-default coordinate space.
      expect(entry.icon.viewBox).toBeDefined();
    }
  });

  it('returns null for an unknown URL with no slug', () => {
    expect(getPublisherIconEntry(undefined, 'https://example.com/article/123')).toBeNull();
  });

  it('returns null when both slug and url are absent', () => {
    expect(getPublisherIconEntry(undefined, undefined)).toBeNull();
    expect(getPublisherIconEntry('', '')).toBeNull();
  });

  it('returns null when both slug and url are unknown', () => {
    expect(getPublisherIconEntry('not-a-real-slug', 'https://nowhere.example/x')).toBeNull();
  });

  it('prefers the slug-based match over a conflicting URL fallback', () => {
    // Slug resolves to The New Yorker; URL would not match anything in the
    // registry. The slug-resolved entry must win.
    const entry = getPublisherIconEntry('newyorker', 'https://example.com/some/article');

    expect(entry).not.toBeNull();
    expect(entry?.slug).toBe('newyorker');
    expect(entry?.name).toBe('The New Yorker');
  });

  it('falls back to URL when slug is provided but does not match the registry', () => {
    const entry = getPublisherIconEntry('not-a-real-slug', 'https://www.bbc.com/news/article-x');

    expect(entry).not.toBeNull();
    expect(entry?.slug).toBe('bbc');
  });
});
