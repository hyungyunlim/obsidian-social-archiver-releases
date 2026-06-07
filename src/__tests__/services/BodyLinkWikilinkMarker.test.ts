/**
 * BodyLinkWikilinkMarker tests — body-link → wikilink reconcile pass.
 *
 * Pins the scope guards (frontmatter / managed blocks / code / images), the
 * URL matching rules (raw + normalized), idempotency, and the alias
 * sanitization that keeps generated wikilinks parseable.
 */

import { describe, it, expect } from 'vitest';
import {
  BodyLinkWikilinkMarker,
  normalizeUrlForMatch,
  type BodyWikilinkTarget,
} from '../../services/BodyLinkWikilinkMarker';

const TARGET: BodyWikilinkTarget = {
  urls: ['https://example.com/article', 'https://example.com/article'],
  linktext: '2026-06-07 - Author - Target Title (abc123)',
};

const marker = new BodyLinkWikilinkMarker();

describe('normalizeUrlForMatch', () => {
  it('lowercases scheme+host, drops fragment and trailing slash, keeps query', () => {
    expect(normalizeUrlForMatch('HTTPS://Example.COM/Path/?q=1#frag')).toBe(
      'https://example.com/Path?q=1',
    );
  });

  it('falls back to trimmed input on unparsable urls', () => {
    expect(normalizeUrlForMatch('  not-a-url  ')).toBe('not-a-url');
  });
});

describe('BodyLinkWikilinkMarker.reconcile', () => {
  it('converts a markdown link whose url matches a target', () => {
    const input = 'Read [the article](https://example.com/article) today.';
    expect(marker.reconcile(input, [TARGET])).toBe(
      `Read [[${TARGET.linktext}|the article]] today.`,
    );
  });

  it('matches via normalization (trailing slash / fragment differences)', () => {
    const input = 'See [link](https://example.com/article/#section).';
    expect(marker.reconcile(input, [TARGET])).toBe(
      `See [[${TARGET.linktext}|link]].`,
    );
  });

  it('converts a bare url, keeping the visible url text as alias', () => {
    const input = 'More at https://example.com/article today.';
    expect(marker.reconcile(input, [TARGET])).toBe(
      `More at [[${TARGET.linktext}|https://example.com/article]] today.`,
    );
  });

  it('keeps trailing sentence punctuation outside the wikilink', () => {
    const input = 'See https://example.com/article.';
    expect(marker.reconcile(input, [TARGET])).toBe(
      `See [[${TARGET.linktext}|https://example.com/article]].`,
    );
  });

  it('leaves non-matching urls untouched', () => {
    const input = 'Read [other](https://other.com/x) and https://other.com/y.';
    expect(marker.reconcile(input, [TARGET])).toBe(input);
  });

  it('never touches image embeds', () => {
    const input = '![cover](https://example.com/article)';
    expect(marker.reconcile(input, [TARGET])).toBe(input);
  });

  it('never touches fenced code blocks or inline code', () => {
    const input = [
      '```',
      '[in fence](https://example.com/article)',
      '```',
      'Inline `[code](https://example.com/article)` stays.',
    ].join('\n');
    expect(marker.reconcile(input, [TARGET])).toBe(input);
  });

  it('preserves frontmatter verbatim even when it contains the url', () => {
    const input = [
      '---',
      'originalUrl: https://example.com/article',
      '---',
      '',
      '[anchor](https://example.com/article)',
    ].join('\n');
    const result = marker.reconcile(input, [TARGET]);
    expect(result).toContain('originalUrl: https://example.com/article');
    expect(result).toContain(`[[${TARGET.linktext}|anchor]]`);
  });

  it('preserves everything from the first managed marker onward', () => {
    const input = [
      'Body [anchor](https://example.com/article).',
      '',
      '<!-- social-archiver:annotations:start -->',
      '> [!note]+ ts',
      '> [token](https://example.com/article)',
      '<!-- social-archiver:annotations:end -->',
    ].join('\n');
    const result = marker.reconcile(input, [TARGET]);
    expect(result).toContain(`[[${TARGET.linktext}|anchor]]`);
    // The annotation block copy of the url must stay a markdown link.
    expect(result).toContain('> [token](https://example.com/article)');
  });

  it('is idempotent — a second pass returns the same string', () => {
    const input = 'Read [the article](https://example.com/article) today.';
    const once = marker.reconcile(input, [TARGET]);
    expect(marker.reconcile(once, [TARGET])).toBe(once);
  });

  it('sanitizes pipes in the anchor alias', () => {
    const input = '[a|b](https://example.com/article)';
    expect(marker.reconcile(input, [TARGET])).toBe(
      `[[${TARGET.linktext}|a-b]]`,
    );
  });

  it('falls back to the linktext when the anchor is empty', () => {
    const input = '[](https://example.com/article)';
    expect(marker.reconcile(input, [TARGET])).toBe(
      `[[${TARGET.linktext}|${TARGET.linktext}]]`,
    );
  });

  it('returns the input unchanged when there are no targets', () => {
    const input = '[anchor](https://example.com/article)';
    expect(marker.reconcile(input, [])).toBe(input);
  });
});
