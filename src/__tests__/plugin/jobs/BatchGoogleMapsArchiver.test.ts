import { describe, expect, it } from 'vitest';
import { extractGoogleMapsLinks } from '@/utils/googleMapsLinks';

/**
 * BatchGoogleMapsArchiver itself opens an Obsidian modal which is hard
 * to exercise headlessly. These tests focus on the extracted pure helper
 * it now delegates to — verifying that the extraction-side regressions
 * are caught when the archiver is wired up through the CLI surface.
 */
describe('BatchGoogleMapsArchiver — extractGoogleMapsLinks (extracted util)', () => {
  it('extracts maps.app.goo.gl and google.com/maps/place from mixed content', () => {
    const out = extractGoogleMapsLinks(
      [
        'Cafe A: https://maps.app.goo.gl/abc',
        'Place B: https://www.google.com/maps/place/Cafe+B/@1.2,3.4',
        'Short C: https://goo.gl/maps/foo',
      ].join('\n'),
    );
    expect(out).toEqual(
      expect.arrayContaining([
        'https://maps.app.goo.gl/abc',
        expect.stringMatching(/maps\/place\/Cafe\+B/),
        'https://goo.gl/maps/foo',
      ]),
    );
  });

  it('honors max parameter', () => {
    const out = extractGoogleMapsLinks(
      'https://maps.app.goo.gl/a https://maps.app.goo.gl/b https://maps.app.goo.gl/c https://maps.app.goo.gl/d',
      { max: 2 },
    );
    expect(out).toHaveLength(2);
    expect(out).toEqual(['https://maps.app.goo.gl/a', 'https://maps.app.goo.gl/b']);
  });

  it('returns empty array when no Google Maps links are present', () => {
    expect(extractGoogleMapsLinks('plain note with https://example.com link only')).toEqual([]);
  });
});
