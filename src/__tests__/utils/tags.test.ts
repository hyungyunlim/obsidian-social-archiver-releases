import { describe, it, expect } from 'vitest';
import { mergeTagsCaseInsensitive, normalizeTagName, sanitizeTagNames, validateTagName } from '@/utils/tags';

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

  it('deduplicates tags with and without # prefix', () => {
    const result = mergeTagsCaseInsensitive(['work'], ['#work']);
    expect(result).toEqual(['work']);
  });

  it('strips # prefix from existing tags', () => {
    const result = mergeTagsCaseInsensitive(['#design'], ['Tech']);
    expect(result).toEqual(['design', 'Tech']);
  });

  it('strips # prefix from both arrays and deduplicates', () => {
    const result = mergeTagsCaseInsensitive(['#Recipe'], ['#recipe', 'Tech']);
    expect(result).toEqual(['Recipe', 'Tech']);
  });

  it('strips multiple leading # characters', () => {
    const result = mergeTagsCaseInsensitive(['##heading'], ['heading']);
    expect(result).toEqual(['heading']);
  });
});

describe('normalizeTagName', () => {
  it('strips leading # characters', () => {
    expect(normalizeTagName('#work')).toBe('work');
  });

  it('strips multiple leading # characters', () => {
    expect(normalizeTagName('##heading')).toBe('heading');
    expect(normalizeTagName('###deep')).toBe('deep');
  });

  it('trims whitespace', () => {
    expect(normalizeTagName('  travel  ')).toBe('travel');
  });

  it('trims whitespace before stripping #', () => {
    expect(normalizeTagName('  #work  ')).toBe('work');
  });

  it('returns empty string for # only', () => {
    expect(normalizeTagName('#')).toBe('');
    expect(normalizeTagName('###')).toBe('');
  });

  it('preserves mid-string # characters', () => {
    expect(normalizeTagName('c#sharp')).toBe('c#sharp');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeTagName('')).toBe('');
    expect(normalizeTagName('   ')).toBe('');
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

  it('strips # prefix during sanitization', () => {
    expect(sanitizeTagNames(['#work', '#design', 'Tech'])).toEqual(['work', 'design', 'Tech']);
  });

  it('removes tags that are only # characters', () => {
    expect(sanitizeTagNames(['#', '##', 'Valid'])).toEqual(['Valid']);
  });
});

describe('validateTagName', () => {
  it('rejects tags containing spaces', () => {
    expect(validateTagName('my tag')).toBe('Tag name cannot contain spaces');
  });

  it('accepts trimmed valid tags', () => {
    expect(validateTagName('  my-tag  ')).toBeNull();
  });

  it('accepts tags with # prefix (normalized before validation)', () => {
    expect(validateTagName('#work')).toBeNull();
    expect(validateTagName('##design')).toBeNull();
  });

  it('rejects bare # (empty after normalization)', () => {
    expect(validateTagName('#')).not.toBeNull();
    expect(validateTagName('###')).not.toBeNull();
  });
});
