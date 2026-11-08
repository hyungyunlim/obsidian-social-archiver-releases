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
  serializeArchiveMention,
  splitArchiveRefLines,
  joinArchiveRefLines,
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

// ─── Composed-post ref lines (pinned to desktop sourceRefs + workers composed-post-refs) ───

describe('serializeArchiveMention', () => {
  it('escapes brackets, caps at 24 code points and falls back to Untitled (desktop fixtures)', () => {
    expect(serializeArchiveMention('abc123', 'Hello [World]')).toBe('[Hello \\[World\\]](socialarchiver://archive/abc123)');
    expect(serializeArchiveMention('x', '   ')).toBe('[Untitled](socialarchiver://archive/x)');
    expect(serializeArchiveMention('a/1', 'A [bracketed] title that is far too long')).toBe(
      '[A \\[bracketed\\] title that…](socialarchiver://archive/a%2F1)',
    );
    expect(serializeArchiveMention('k', '가나다라마바사아자차카타파하가나다라마바사아자차카타')).toBe(
      '[가나다라마바사아자차카타파하가나다라마바사아자차…](socialarchiver://archive/k)',
    );
  });
});

describe('splitArchiveRefLines', () => {
  it('takes the trailing mention lines as refs, in order, and leaves the body', () => {
    const markdown = 'My take.\n\n> a quote\n\n[First](socialarchiver://archive/a1)\n[Second](socialarchiver://archive/a2)\n';
    expect(splitArchiveRefLines(markdown)).toEqual({
      body: 'My take.\n\n> a quote',
      refs: [
        { archiveId: 'a1', label: 'First' },
        { archiveId: 'a2', label: 'Second' },
      ],
    });
  });

  it('skips blank lines, decodes ids, unescapes labels and drops duplicates', () => {
    const markdown = 'Body\n\n[A \\[1\\]](socialarchiver://archive/x%2Fy)\n\n  [B](socialarchiver://archive/b)  \n[A again](socialarchiver://archive/x%2Fy)';
    expect(splitArchiveRefLines(markdown)).toEqual({
      body: 'Body',
      refs: [
        { archiveId: 'x/y', label: 'A [1]' },
        { archiveId: 'b', label: 'B' },
      ],
    });
  });

  it('stops at the first other line, and leaves the input untouched without a block', () => {
    expect(splitArchiveRefLines('See [this](socialarchiver://archive/in-text) here\n\n[Card](socialarchiver://archive/c1)')).toEqual({
      body: 'See [this](socialarchiver://archive/in-text) here',
      refs: [{ archiveId: 'c1', label: 'Card' }],
    });
    for (const tail of [
      '[x](https://example.com)',
      '[@Ann](socialarchiver://author?platform=x&name=Ann)',
      '[Card](socialarchiver://archive/c1) and more',
      '[x](socialarchiver://archive/)',
    ]) {
      const markdown = `Body\n\n${tail}`;
      expect(splitArchiveRefLines(markdown)).toEqual({ body: markdown, refs: [] });
    }
    expect(splitArchiveRefLines('Just text\n\n')).toEqual({ body: 'Just text\n\n', refs: [] });
  });

  it('drops a query/fragment, keeps a raw id on bad encoding, and takes a post that is only quotes', () => {
    expect(splitArchiveRefLines('[x](socialarchiver://archive/c?from=share#top)').refs[0]?.archiveId).toBe('c');
    expect(splitArchiveRefLines('[x](socialarchiver://archive/bad%E0%A4)').refs[0]?.archiveId).toBe('bad%E0%A4');
    expect(splitArchiveRefLines('[Only](socialarchiver://archive/o1)')).toEqual({ body: '', refs: [{ archiveId: 'o1', label: 'Only' }] });
  });
});

describe('joinArchiveRefLines', () => {
  it('round-trips through split', () => {
    const joined = joinArchiveRefLines('Body text\n', [
      { archiveId: 'a/1', label: 'A [bracketed] title that is far too long' },
      { archiveId: 'b2', label: '' },
    ]);
    expect(joined).toBe(
      'Body text\n\n[A \\[bracketed\\] title that…](socialarchiver://archive/a%2F1)\n[Untitled](socialarchiver://archive/b2)',
    );
    const split = splitArchiveRefLines(joined);
    expect(joinArchiveRefLines(split.body, split.refs)).toBe(joined);
  });

  it('drops backslashes from labels so the line still reads as a ref', () => {
    const joined = joinArchiveRefLines('Body', [
      { archiveId: 'p1', label: 'C:\\Temp\\' },
      { archiveId: 'p2', label: 'x\\]y' },
    ]);
    expect(joined).toBe('Body\n\n[C:Temp](socialarchiver://archive/p1)\n[x\\]y](socialarchiver://archive/p2)');
    expect(splitArchiveRefLines(joined).refs.map((r) => r.label)).toEqual(['C:Temp', 'x]y']);
  });

  it('leaves a body without refs as it is, and writes refs alone for an empty body', () => {
    expect(joinArchiveRefLines('Just text', [])).toBe('Just text');
    expect(joinArchiveRefLines('', [{ archiveId: 'x', label: 'X' }])).toBe('[X](socialarchiver://archive/x)');
  });
});
