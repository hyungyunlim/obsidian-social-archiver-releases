import { describe, it, expect } from 'vitest';
import { normalizeSeriesId } from '@/services/SeriesGroupingService';

describe('normalizeSeriesId', () => {
  it('converts scalar string/number/boolean values to strings', () => {
    expect(normalizeSeriesId('812354')).toBe('812354');
    expect(normalizeSeriesId(812354)).toBe('812354');
    expect(normalizeSeriesId(true)).toBe('true');
  });

  it('unwraps list values stored by the Obsidian Properties UI', () => {
    expect(normalizeSeriesId([812354])).toBe('812354');
    expect(normalizeSeriesId(['812354'])).toBe('812354');
    // Multi-entry lists group by the first entry
    expect(normalizeSeriesId([812354, 999])).toBe('812354');
  });

  it('returns undefined for missing or non-primitive values', () => {
    expect(normalizeSeriesId(undefined)).toBeUndefined();
    expect(normalizeSeriesId(null)).toBeUndefined();
    expect(normalizeSeriesId({})).toBeUndefined();
    expect(normalizeSeriesId([])).toBeUndefined();
    expect(normalizeSeriesId([{ id: 1 }])).toBeUndefined();
  });
});

import { prefersReplacementEpisode } from '@/services/SeriesGroupingService';

/**
 * Two files can exist for one episode: a streaming stub and the completed
 * background download. Picking the wrong one shows an episode with no images.
 */
describe('prefersReplacementEpisode', () => {
  const at = (archived: string, mediaCount = 0): { archived: string; mediaCount: number } =>
    ({ archived, mediaCount });

  it('prefers the more recently archived file', () => {
    expect(prefersReplacementEpisode(at('2026-07-27 10:00'), at('2026-07-28 10:00'))).toBe(true);
    expect(prefersReplacementEpisode(at('2026-07-28 10:00'), at('2026-07-27 10:00'))).toBe(false);
  });

  it('breaks a tie on media count, so the completed download beats the stub', () => {
    expect(prefersReplacementEpisode(at('2026-07-27 10:00', 0), at('2026-07-27 10:00', 20))).toBe(true);
    expect(prefersReplacementEpisode(at('2026-07-27 10:00', 20), at('2026-07-27 10:00', 0))).toBe(false);
  });

  it('keeps the incumbent when a tie has nothing to separate it', () => {
    expect(prefersReplacementEpisode(at('2026-07-27 10:00', 5), at('2026-07-27 10:00', 5))).toBe(false);
  });

  it('compares across the two formats this field actually holds', () => {
    // Space-formatted local (FrontmatterGenerator) vs ISO UTC (webtoon queues).
    // Parsed, not string-compared — lexicographically 'T' > ' ' would invert this.
    const iso = new Date('2026-07-27T00:30:00.000Z').toISOString();
    const laterLocal = new Date('2026-07-27T00:30:00.000Z');
    laterLocal.setHours(laterLocal.getHours() + 1);
    const pad = (n: number): string => String(n).padStart(2, '0');
    const spaced = `${laterLocal.getFullYear()}-${pad(laterLocal.getMonth() + 1)}-${pad(laterLocal.getDate())} ${pad(laterLocal.getHours())}:${pad(laterLocal.getMinutes())}`;

    expect(prefersReplacementEpisode(at(iso), at(spaced))).toBe(true);
  });

  it('treats a missing date as the oldest possible', () => {
    expect(prefersReplacementEpisode(at(''), at('2026-07-27 10:00'))).toBe(true);
    expect(prefersReplacementEpisode(at('2026-07-27 10:00'), at(''))).toBe(false);
  });
});
