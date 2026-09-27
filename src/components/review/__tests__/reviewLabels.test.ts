import { afterEach, describe, expect, it } from 'vitest';
import { __setLanguageForTests } from '../../../i18n';
import type { ReviewArchiveLabel, ReviewCardUnit } from '../../../services/learning/LearningReviewClient';
import { bylineOf, nameOf, savedAgeLabel } from '../reviewLabels';

function label(overrides: Partial<ReviewArchiveLabel> = {}): ReviewArchiveLabel {
  return { title: null, authorName: null, originalUrl: null, savedAge: null, ...overrides };
}

function unit(text: string): ReviewCardUnit {
  return { id: 'a', archiveId: 'a', kind: 'post', text, platform: 'x', archivedAt: '2026-01-01T00:00:00.000Z' };
}

afterEach(() => __setLanguageForTests(null));

describe('review card labels', () => {
  it('words the server-counted age, singular in English, and in Korean', () => {
    __setLanguageForTests('en');
    expect(savedAgeLabel(label({ savedAge: { unit: 'months', count: 8 } }))).toBe('Saved 8 months ago');
    expect(savedAgeLabel(label({ savedAge: { unit: 'weeks', count: 1 } }))).toBe('Saved 1 week ago');
    expect(savedAgeLabel(label({ savedAge: { unit: 'yesterday', count: 1 } }))).toBe('Saved yesterday');
    expect(savedAgeLabel(label())).toBeNull();

    __setLanguageForTests('ko');
    expect(savedAgeLabel(label({ savedAge: { unit: 'months', count: 8 } }))).toBe('8개월 전 저장');
  });

  it('joins whichever half of the byline is known', () => {
    __setLanguageForTests('en');
    expect(bylineOf(label({ authorName: 'Ada', savedAge: { unit: 'years', count: 2 } }))).toBe('Ada · Saved 2 years ago');
    expect(bylineOf(label({ authorName: '  ' }))).toBe('');
  });

  it('names a post by its title, else its first line, never blank', () => {
    __setLanguageForTests('en');
    expect(nameOf(unit('body'), label({ title: ' A title ' }))).toBe('A title');
    expect(nameOf(unit('\n  First line\nsecond'), label())).toBe('First line');
    expect(nameOf(unit('x'.repeat(100)), label())).toHaveLength(70);
    expect(nameOf(unit('   '), label())).toBe('Untitled post');
  });
});
