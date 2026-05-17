import { describe, expect, it } from 'vitest';
import { extractGoogleMapsLinks } from '@/utils/googleMapsLinks';

describe('extractGoogleMapsLinks', () => {
  it('returns an empty array for empty or non-matching content', () => {
    expect(extractGoogleMapsLinks('')).toEqual([]);
    expect(extractGoogleMapsLinks('no maps here, just text')).toEqual([]);
  });

  it('extracts maps.app.goo.gl short links', () => {
    const out = extractGoogleMapsLinks(
      'visit https://maps.app.goo.gl/abc123 and https://maps.app.goo.gl/XyZ_99?ref=share',
    );
    expect(out).toEqual([
      'https://maps.app.goo.gl/abc123',
      'https://maps.app.goo.gl/XyZ_99?ref=share',
    ]);
  });

  it('extracts goo.gl/maps short links', () => {
    const out = extractGoogleMapsLinks('see https://goo.gl/maps/Foo123');
    expect(out).toEqual(['https://goo.gl/maps/Foo123']);
  });

  it('extracts google.com/maps/place full URLs', () => {
    const out = extractGoogleMapsLinks(
      'https://www.google.com/maps/place/Test+Cafe/@1.2,3.4,15z',
    );
    expect(out[0]).toMatch(/maps\/place\/Test\+Cafe/);
  });

  it('deduplicates exact matches preserving order', () => {
    const out = extractGoogleMapsLinks(
      'https://maps.app.goo.gl/abc and again https://maps.app.goo.gl/abc',
    );
    expect(out).toEqual(['https://maps.app.goo.gl/abc']);
  });

  it('strips trailing punctuation common in markdown', () => {
    const out = extractGoogleMapsLinks('(https://maps.app.goo.gl/abc) "https://maps.app.goo.gl/def"');
    expect(out).toContain('https://maps.app.goo.gl/abc');
    expect(out).toContain('https://maps.app.goo.gl/def');
    expect(out.every((link) => !/[)"\]<>]+$/.test(link))).toBe(true);
  });

  it('honors max cap', () => {
    const out = extractGoogleMapsLinks(
      'https://maps.app.goo.gl/a https://maps.app.goo.gl/b https://maps.app.goo.gl/c',
      { max: 2 },
    );
    expect(out).toEqual(['https://maps.app.goo.gl/a', 'https://maps.app.goo.gl/b']);
  });
});
