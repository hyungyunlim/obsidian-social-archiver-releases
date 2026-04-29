/**
 * Publisher lookup tests — covers PRD §"Shared Lookup Tests".
 *
 * Verifies URL → entry resolution, slug → entry resolution, label fallback,
 * and the discriminated `PublisherIcon` shape across all three icon sources
 * (`simple-icons`, `custom`, `google-cdn`).
 */

import { describe, it, expect } from 'vitest';
import {
  PUBLISHER_REGISTRY,
  getPublisherFromUrl,
  getPublisherBySlug,
  getPublisherLabel,
} from '../publisher-lookup';

describe('publisher-lookup: getPublisherFromUrl', () => {
  it('resolves an exact domain match', () => {
    const entry = getPublisherFromUrl('https://www.newyorker.com/x');
    expect(entry?.slug).toBe('newyorker');
  });

  it('resolves a subdomain via dot-boundary suffix match', () => {
    const entry = getPublisherFromUrl('https://magazine.newyorker.com/x');
    expect(entry?.slug).toBe('newyorker');
  });

  it('does NOT match a non-boundary suffix', () => {
    expect(getPublisherFromUrl('https://fakenewyorker.com/x')).toBeNull();
  });

  it('returns null for an unrecognized site', () => {
    expect(getPublisherFromUrl('https://example.com')).toBeNull();
  });

  it('returns null for an invalid URL string', () => {
    expect(getPublisherFromUrl('not-a-url')).toBeNull();
  });

  it('returns null for missing input', () => {
    expect(getPublisherFromUrl(undefined)).toBeNull();
    expect(getPublisherFromUrl(null)).toBeNull();
    expect(getPublisherFromUrl('')).toBeNull();
  });

  it('matches alternative domains (bbc.co.uk → bbc)', () => {
    const entry = getPublisherFromUrl('https://bbc.co.uk/news/abc');
    expect(entry?.slug).toBe('bbc');
  });

  it('strips a leading www. and lowercases the hostname', () => {
    const entry = getPublisherFromUrl('https://WWW.Newyorker.COM/');
    expect(entry?.slug).toBe('newyorker');
  });
});

describe('publisher-lookup: getPublisherBySlug', () => {
  it('resolves a known slug', () => {
    const entry = getPublisherBySlug('medium');
    expect(entry?.name).toBe('Medium');
  });

  it('returns null for an unknown slug', () => {
    expect(getPublisherBySlug('nope')).toBeNull();
  });

  it('returns null for missing input', () => {
    expect(getPublisherBySlug(undefined)).toBeNull();
    expect(getPublisherBySlug(null)).toBeNull();
    expect(getPublisherBySlug('')).toBeNull();
  });
});

describe('publisher-lookup: getPublisherLabel', () => {
  it('prefers the persisted slug over a URL fallback', () => {
    expect(getPublisherLabel('newyorker', 'https://www.bbc.com/x')).toBe('The New Yorker');
  });

  it('falls back to URL resolution when slug is missing', () => {
    expect(getPublisherLabel(undefined, 'https://www.bbc.com/x')).toBe('BBC');
  });

  it('returns null when neither resolves', () => {
    expect(getPublisherLabel(undefined, 'https://example.com/x')).toBeNull();
    expect(getPublisherLabel(null)).toBeNull();
  });
});

describe('publisher-lookup: PublisherIcon discriminated union', () => {
  it('emits svg + simple-icons path for `medium`', () => {
    const entry = getPublisherFromUrl('https://medium.com/some/post');
    expect(entry?.icon.type).toBe('svg');
    if (entry?.icon.type === 'svg') {
      expect(typeof entry.icon.data.path).toBe('string');
      expect(entry.icon.data.path.length).toBeGreaterThan(10);
      expect(entry.icon.data.title).toBe('Medium');
    }
  });

  it('emits svg + custom inline path for `bbc` with viewBox', () => {
    const entry = getPublisherFromUrl('https://www.bbc.com/news');
    expect(entry?.icon.type).toBe('svg');
    if (entry?.icon.type === 'svg') {
      expect(entry.icon.data.title).toBe('BBC');
      expect(entry.icon.viewBox).toBeDefined();
      expect(typeof entry.icon.data.path).toBe('string');
    }
  });

  it('emits image + Google CDN URL for `nytimes`', () => {
    const entry = getPublisherFromUrl('https://www.nytimes.com/abc');
    expect(entry?.icon.type).toBe('image');
    if (entry?.icon.type === 'image') {
      expect(entry.icon.url).toMatch(/\/s2\/favicons\?domain=nytimes\.com/);
    }
  });

  it('emits image + Google CDN URL for `washingtonpost` (favicon-svg fallback)', () => {
    const entry = getPublisherFromUrl('https://www.washingtonpost.com/x');
    expect(entry?.icon.type).toBe('image');
    if (entry?.icon.type === 'image') {
      expect(entry.icon.url).toContain('domain=washingtonpost.com');
    }
  });
});

describe('publisher-lookup: registry health', () => {
  it('contains the v1 starter set (34 publishers)', () => {
    expect(PUBLISHER_REGISTRY.length).toBe(34);
  });

  it('has unique slugs', () => {
    const seen = new Set<string>();
    for (const entry of PUBLISHER_REGISTRY) {
      expect(seen.has(entry.slug)).toBe(false);
      seen.add(entry.slug);
    }
  });

  it('every entry exposes a renderable icon', () => {
    for (const entry of PUBLISHER_REGISTRY) {
      if (entry.icon.type === 'svg') {
        expect(entry.icon.data.path.length).toBeGreaterThan(0);
        expect(entry.icon.data.title.length).toBeGreaterThan(0);
      } else {
        expect(entry.icon.url).toMatch(/^https:\/\//);
      }
    }
  });
});
