import { describe, expect, it } from 'vitest';
import { isComposedPostNote, readCoAuthors } from '../../utils/composedPostNote';

describe('isComposedPostNote', () => {
  it('is a composer note unless it is a meeting or audio note', () => {
    expect(isComposedPostNote({ postOrigin: 'composer' })).toBe(true);
    expect(isComposedPostNote({ postOrigin: 'composer', contentType: 'post' })).toBe(true);
    expect(isComposedPostNote({ postOrigin: 'composer', contentType: 'meeting-note' })).toBe(false);
    expect(isComposedPostNote({ postOrigin: 'composer', contentType: 'audio-note' })).toBe(false);
  });

  it('needs postOrigin composer', () => {
    expect(isComposedPostNote({ postOrigin: 'shared' })).toBe(false);
    expect(isComposedPostNote({ platform: 'post' })).toBe(false);
    expect(isComposedPostNote(null)).toBe(false);
    expect(isComposedPostNote(undefined)).toBe(false);
  });
});

describe('readCoAuthors', () => {
  it('keeps trimmed non-empty strings', () => {
    expect(readCoAuthors({ coAuthors: [' Ann ', '', 3, 'Bo'] })).toEqual(['Ann', 'Bo']);
  });

  it('is empty when absent or malformed', () => {
    expect(readCoAuthors({})).toEqual([]);
    expect(readCoAuthors({ coAuthors: 'Ann' })).toEqual([]);
    expect(readCoAuthors(null)).toEqual([]);
  });
});
