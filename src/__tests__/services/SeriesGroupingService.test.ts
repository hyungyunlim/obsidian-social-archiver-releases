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
