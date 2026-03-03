import { describe, it, expect } from 'vitest';
import { mergeTagsCaseInsensitive, sanitizeTagNames, validateTagName } from '@/utils/tags';

describe('mergeTagsCaseInsensitive', () => {
  it('merges non-overlapping tags', () => {
    const result = mergeTagsCaseInsensitive(['auto/facebook'], ['Recipe', 'Tech']);
    expect(result).toEqual(['auto/facebook', 'Recipe', 'Tech']);
  });

  it('deduplicates case-insensitive matches', () => {
    const result = mergeTagsCaseInsensitive(['Recipe', 'auto/facebook'], ['recipe', 'Tech']);
    expect(result).toEqual(['Recipe', 'auto/facebook', 'Tech']);
  });

  it('preserves existing tag casing over new tag casing', () => {
    const result = mergeTagsCaseInsensitive(['RECIPE'], ['recipe']);
    expect(result).toEqual(['RECIPE']);
  });

  it('handles empty existing tags', () => {
    const result = mergeTagsCaseInsensitive([], ['Tech', 'Design']);
    expect(result).toEqual(['Tech', 'Design']);
  });

  it('handles empty selected tags', () => {
    const result = mergeTagsCaseInsensitive(['auto/facebook'], []);
    expect(result).toEqual(['auto/facebook']);
  });

  it('handles both empty', () => {
    const result = mergeTagsCaseInsensitive([], []);
    expect(result).toEqual([]);
  });

  it('deduplicates within existing tags', () => {
    const result = mergeTagsCaseInsensitive(['Tech', 'tech'], ['Design']);
    expect(result).toEqual(['Tech', 'Design']);
  });

  it('deduplicates within selected tags', () => {
    const result = mergeTagsCaseInsensitive([], ['Tech', 'TECH', 'tech']);
    expect(result).toEqual(['Tech']);
  });

  it('handles complex auto archive tags with selected tags', () => {
    const result = mergeTagsCaseInsensitive(
      ['social-archives/facebook/2024/03'],
      ['Recipe', 'social-archives/facebook/2024/03']
    );
    expect(result).toEqual(['social-archives/facebook/2024/03', 'Recipe']);
  });
});

describe('sanitizeTagNames', () => {
  it('trims whitespace', () => {
    expect(sanitizeTagNames(['  Tech  ', ' Design '])).toEqual(['Tech', 'Design']);
  });

  it('removes empty strings', () => {
    expect(sanitizeTagNames(['Tech', '', '  ', 'Design'])).toEqual(['Tech', 'Design']);
  });

  it('handles all empty', () => {
    expect(sanitizeTagNames(['', '  '])).toEqual([]);
  });

  it('preserves valid tags', () => {
    expect(sanitizeTagNames(['Recipe', 'Tech/AI'])).toEqual(['Recipe', 'Tech/AI']);
  });

  it('removes tags containing spaces', () => {
    expect(sanitizeTagNames(['My Tag', 'ValidTag', 'Another Tag'])).toEqual(['ValidTag']);
  });
});

describe('validateTagName', () => {
  it('rejects tags containing spaces', () => {
    expect(validateTagName('my tag')).toBe('Tag name cannot contain spaces');
  });

  it('accepts trimmed valid tags', () => {
    expect(validateTagName('  my-tag  ')).toBeNull();
  });
});
