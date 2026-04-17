import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { truncatePreview } from '@/utils/preview-truncate';

interface FixtureExpected {
  content: string;
  preview: string;
  truncated: boolean;
  boundary: 'none' | 'block' | 'sentence' | 'word' | 'cjk-punct' | 'hard';
}

interface FixtureCase {
  name: string;
  input: string;
  maxChars: number;
  ellipsis?: string;
  expected: FixtureExpected;
}

interface FixtureFile {
  version: number;
  note?: string;
  fixtures: FixtureCase[];
}

const fixturePath = resolve(
  __dirname,
  '../../../.taskmaster/fixtures/preview-truncate.json',
);

const fixtureFile = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
) as FixtureFile;

describe('truncatePreview', () => {
  it('ships at least 14 shared fixtures', () => {
    expect(fixtureFile.fixtures.length).toBeGreaterThanOrEqual(14);
  });

  describe.each(fixtureFile.fixtures)('fixture: $name', (fixture) => {
    const result = truncatePreview({
      markdown: fixture.input,
      maxChars: fixture.maxChars,
      ellipsis: fixture.ellipsis,
    });

    it('matches expected preview, content, truncated flag and boundary', () => {
      expect(result.content).toBe(fixture.expected.content);
      expect(result.preview).toBe(fixture.expected.preview);
      expect(result.truncated).toBe(fixture.expected.truncated);
      expect(result.boundary).toBe(fixture.expected.boundary);
    });

    it('respects the maxChars budget invariant', () => {
      expect(Array.from(result.preview).length).toBeLessThanOrEqual(
        fixture.maxChars,
      );
    });
  });

  describe('short input behaviour', () => {
    it('returns input unchanged when already under budget', () => {
      const result = truncatePreview({
        markdown: 'Short text.',
        maxChars: 300,
      });
      expect(result.truncated).toBe(false);
      expect(result.boundary).toBe('none');
      expect(result.preview).toBe('Short text.');
      expect(result.content).toBe('Short text.');
    });

    it('normalizes CRLF and CR newlines before measuring', () => {
      const result = truncatePreview({
        markdown: 'line-a\r\nline-b\rline-c',
        maxChars: 300,
      });
      expect(result.truncated).toBe(false);
      expect(result.preview).toBe('line-a\nline-b\nline-c');
    });
  });

  describe('ellipsis handling', () => {
    it('omits ellipsis when disabled via empty string', () => {
      const result = truncatePreview({
        markdown:
          'Hello world this sentence has no terminator and should stop at a word boundary here',
        maxChars: 32,
        ellipsis: '',
      });
      expect(result.truncated).toBe(true);
      expect(result.preview.endsWith('…')).toBe(false);
      expect(Array.from(result.preview).length).toBeLessThanOrEqual(32);
    });

    it('does not append ellipsis when content already ends in a terminator', () => {
      const result = truncatePreview({
        markdown:
          'The quick brown fox jumps fast. Then the lazy dog slowly runs behind the fence over there.',
        maxChars: 40,
        ellipsis: '…',
      });
      expect(result.boundary).toBe('sentence');
      expect(result.preview.endsWith('…')).toBe(false);
      expect(result.preview.endsWith('.')).toBe(true);
    });
  });

  describe('markdown safety', () => {
    it('never ends inside an unclosed link token', () => {
      const result = truncatePreview({
        markdown:
          'Check this great resource [Obsidian documentation site that is very',
        maxChars: 40,
        ellipsis: '…',
      });
      expect(result.content.includes('[')).toBe(false);
    });

    it('never ends inside an unclosed image token', () => {
      const result = truncatePreview({
        markdown:
          'Gallery of photos below and ![cover image with a long alt text description',
        maxChars: 40,
        ellipsis: '…',
      });
      expect(result.content.includes('![')).toBe(false);
    });

    it('keeps complete markdown links intact when they fit', () => {
      const md = 'See [the docs](https://example.com) for more info and notes here to extend the length';
      const result = truncatePreview({
        markdown: md,
        maxChars: 60,
        ellipsis: '…',
      });
      // If the complete link fits within budget it should not be stripped.
      expect(result.content.includes('[the docs](https://example.com)')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles non-positive maxChars gracefully', () => {
      const result = truncatePreview({ markdown: 'anything', maxChars: 0 });
      expect(result.preview).toBe('');
      expect(result.boundary).toBe('hard');
    });

    it('handles empty input', () => {
      const result = truncatePreview({ markdown: '', maxChars: 100 });
      expect(result.preview).toBe('');
      expect(result.truncated).toBe(false);
      expect(result.boundary).toBe('none');
    });
  });
});
