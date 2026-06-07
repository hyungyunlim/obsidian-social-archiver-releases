/**
 * note-mentions — plugin unit tests.
 *
 * Pins the exact token grammar (parse side of the FROZEN mobile contract) plus
 * the plugin-only `convertInternalMentions` token→wikilink conversion. The
 * fixtures mirror `mobile-app/src/utils/__tests__/note-mentions.test.ts` so a
 * drift between the two mirrors fails here.
 *
 * NOTE: run by the user — never executed in this environment (plugin test rule).
 */

import { describe, it, expect } from 'vitest';
import {
  INTERNAL_LINK_SCHEME,
  parseArchiveMentionUrl,
  parseAuthorMentionUrl,
  unescapeAnchorText,
  splitNoteDisplayContent,
  sanitizeWikilinkAlias,
  convertInternalMentions,
  type MentionResolvers,
} from '../../utils/note-mentions';

// ─── Token fixtures (byte-identical to mobile serializers) ───────────────────

const arc = (id: string, title: string) =>
  `[${title}](${INTERNAL_LINK_SCHEME}://archive/${encodeURIComponent(id)})`;
const author = (q: string) => `[@x](${INTERNAL_LINK_SCHEME}://author?${q})`;

// ─── parseArchiveMentionUrl ──────────────────────────────────────────────────

describe('parseArchiveMentionUrl', () => {
  it('returns the id for a valid archive url', () => {
    expect(parseArchiveMentionUrl('socialarchiver://archive/abc-123')).toBe('abc-123');
  });

  it('percent-decodes the id segment', () => {
    expect(parseArchiveMentionUrl('socialarchiver://archive/id%2Fwith%20space')).toBe('id/with space');
  });

  it('strips trailing query/hash from the id segment', () => {
    expect(parseArchiveMentionUrl('socialarchiver://archive/abc?x=1')).toBe('abc');
    expect(parseArchiveMentionUrl('socialarchiver://archive/abc#frag')).toBe('abc');
  });

  it('returns null for non-archive urls', () => {
    expect(parseArchiveMentionUrl('https://example.com')).toBeNull();
    expect(parseArchiveMentionUrl('socialarchiver://author?platform=x&name=a')).toBeNull();
    expect(parseArchiveMentionUrl('socialarchiver://archive/')).toBeNull();
  });
});

// ─── parseAuthorMentionUrl ───────────────────────────────────────────────────

describe('parseAuthorMentionUrl', () => {
  it('returns null when platform or name is missing', () => {
    expect(parseAuthorMentionUrl('socialarchiver://author?platform=x')).toBeNull();
    expect(parseAuthorMentionUrl('socialarchiver://author?name=jack')).toBeNull();
    expect(parseAuthorMentionUrl('socialarchiver://author')).toBeNull();
  });

  it('omits absent optional fields', () => {
    expect(parseAuthorMentionUrl('socialarchiver://author?platform=x&name=Jack')).toEqual({
      platform: 'x',
      name: 'Jack',
    });
  });

  it('decodes name, handle, and profile url', () => {
    const url =
      'socialarchiver://author?platform=mastodon&name=Alice+%26+Bob&handle=%40alice&url=https%3A%2F%2Fmastodon.social%2F%40alice';
    expect(parseAuthorMentionUrl(url)).toEqual({
      platform: 'mastodon',
      name: 'Alice & Bob',
      handle: '@alice',
      profileUrl: 'https://mastodon.social/@alice',
    });
  });
});

// ─── unescapeAnchorText ──────────────────────────────────────────────────────

describe('unescapeAnchorText', () => {
  it('reverses bracket escaping', () => {
    expect(unescapeAnchorText('A \\[tagged\\] post')).toBe('A [tagged] post');
  });

  it('leaves unescaped text untouched', () => {
    expect(unescapeAnchorText('plain title')).toBe('plain title');
  });
});

// ─── splitNoteDisplayContent (parity with mobile) ────────────────────────────

describe('splitNoteDisplayContent', () => {
  it('strips a trailing archive token and reports it as attached', () => {
    const content = `읽어볼 것 ${arc('arc-1', 'Some Post')}`;
    const out = splitNoteDisplayContent(content);
    expect(out.displayContent).toBe('읽어볼 것');
    expect(out.attachedArchiveIds).toEqual(['arc-1']);
  });

  it('strips multiple trailing tokens', () => {
    const content = `메모 ${arc('a1', 'P')} ${arc('a2', 'P')}`;
    const out = splitNoteDisplayContent(content);
    expect(out.displayContent).toBe('메모');
    expect(out.attachedArchiveIds).toEqual(['a1', 'a2']);
  });

  it('keeps mid-sentence tokens inline but still attaches the card', () => {
    const content = `${arc('a1', 'P')} 이 글이 흥미롭다`;
    const out = splitNoteDisplayContent(content);
    expect(out.displayContent).toBe(content);
    expect(out.attachedArchiveIds).toEqual(['a1']);
  });

  it('never strips author tokens', () => {
    const content = `참고: ${author('platform=x&name=Kim')}`;
    const out = splitNoteDisplayContent(content);
    expect(out.displayContent).toBe(content.trimEnd());
    expect(out.attachedArchiveIds).toEqual([]);
  });

  it('passes through notes without mentions untouched', () => {
    const out = splitNoteDisplayContent('그냥 메모');
    expect(out.displayContent).toBe('그냥 메모');
    expect(out.attachedArchiveIds).toEqual([]);
  });
});

// ─── sanitizeWikilinkAlias ───────────────────────────────────────────────────

describe('sanitizeWikilinkAlias', () => {
  it('replaces pipe with hyphen', () => {
    expect(sanitizeWikilinkAlias('a|b')).toBe('a-b');
  });

  it('removes wikilink-breaking bracket sequences', () => {
    expect(sanitizeWikilinkAlias('x [[y]] z')).toBe('x y z');
  });

  it('strips heading/block subpath delimiters', () => {
    expect(sanitizeWikilinkAlias('title #tag ^block')).toBe('title tag block');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeWikilinkAlias('  padded  ')).toBe('padded');
  });
});

// ─── convertInternalMentions ─────────────────────────────────────────────────

describe('convertInternalMentions', () => {
  const resolvers: MentionResolvers = {
    resolveArchiveLink: (id, alias, _sourcePath) =>
      id === 'known' ? `[[2026-06-06 - Author - Title (known)|${alias}]]` : null,
    resolveAuthorLink: ({ name, alias }) =>
      name === 'Known Author' ? `[[x-known-author|@${alias}]]` : null,
  };

  it('converts a resolvable archive token into a wikilink with the anchor as alias', () => {
    const input = `read ${arc('known', 'Cool Title')}`;
    expect(convertInternalMentions(input, resolvers)).toBe(
      'read [[2026-06-06 - Author - Title (known)|Cool Title]]',
    );
  });

  it('keeps an unresolvable archive token verbatim (timeline resolves at render time)', () => {
    const input = `read ${arc('missing', 'Gone Title')}`;
    expect(convertInternalMentions(input, resolvers)).toBe(input);
  });

  it('keeps bracket-escaped anchors intact when the token stays unresolved', () => {
    const input = `[A \\[tagged\\] post](${INTERNAL_LINK_SCHEME}://archive/missing)`;
    expect(convertInternalMentions(input, resolvers)).toBe(input);
  });

  it('converts a resolvable author token into a wikilink', () => {
    const input = `${author('platform=x&name=Known+Author')}`;
    expect(convertInternalMentions(input, resolvers)).toBe('[[x-known-author|@x]]');
  });

  it('keeps an unresolvable author token verbatim (detail view opens from token params)', () => {
    const input = `${author('platform=x&name=Other')}`;
    expect(convertInternalMentions(input, resolvers)).toBe(input);
  });

  it('keeps an unresolved author token with a non-@ anchor verbatim too', () => {
    const input = `[label](${INTERNAL_LINK_SCHEME}://author?platform=x&name=Other)`;
    expect(convertInternalMentions(input, resolvers)).toBe(input);
  });

  it('sanitizes a pipe in the alias so the wikilink cannot be split', () => {
    const input = `[a|b](${INTERNAL_LINK_SCHEME}://archive/known)`;
    expect(convertInternalMentions(input, resolvers)).toBe(
      '[[2026-06-06 - Author - Title (known)|a-b]]',
    );
  });

  it('leaves non-internal markdown links verbatim', () => {
    const input = '[plain](https://example.com) and text';
    expect(convertInternalMentions(input, resolvers)).toBe(input);
  });

  it('is idempotent — a second pass over converted output is a no-op', () => {
    const input = `read ${arc('known', 'Cool Title')}`;
    const once = convertInternalMentions(input, resolvers);
    expect(convertInternalMentions(once, resolvers)).toBe(once);
  });

  it('returns empty input unchanged', () => {
    expect(convertInternalMentions('', resolvers)).toBe('');
  });
});
