import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertUserArchiveToPostData } from '@/plugin/mobile/UserArchiveConverter';
import { API, composedRow, resetRequestUrl, twoWayHarness } from './twoWayHarness';
import {
  composedFingerprint,
  isComposedServerRow,
  isSyncableComposedNote,
  normalizeComposedText,
  readComposedNote,
  sameComposedText,
  serverComposedText,
} from '@/plugin/sync/composed/composedNote';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  stringifyYaml: (value: unknown): string => `${JSON.stringify(value)}\n`,
  parseYaml: (block: string): unknown => {
    if (block.trim().startsWith('{')) return JSON.parse(block);
    const out: Record<string, unknown> = {};
    for (const [, key, value] of block.matchAll(/^(\w+): (.*)$/gm)) if (key) out[key] = value?.replace(/^"|"$/g, '');
    return out;
  },
}));

const FOOTER = '\n\n---\n\n**Author:** tester | **Published:** 2026-11-08\n';

function note(body: string, fm = 'platform: post'): string {
  return `---\n${fm}\n---\n${body}${FOOTER}`;
}

describe('readComposedNote', () => {
  it('reads the frontmatter title, not the leading H1, and the body as written', () => {
    const parts = readComposedNote(note('# Heading\n\nLine one\nLine two', 'title: "My title"'));
    expect(parts.title).toBe('My title');
    expect(parts.text).toBe('# Heading\n\nLine one\nLine two');
    expect(parts.attachments).toEqual([]);
    expect(parts.hasCrlf).toBe(false);
  });

  it('takes the last media-only section with a local file as the gallery (no sentinel)', () => {
    const parts = readComposedNote(note('Text\n\n---\n\n![a](attachments/post/a%20b.png)\n\n![🎥 Video](attachments/post/v.mp4)'));
    expect(parts.text).toBe('Text');
    expect(parts.attachments).toEqual([
      { target: 'attachments/post/a b.png', remote: false },
      { target: 'attachments/post/v.mp4', remote: false },
    ]);
  });

  it('keeps a remote-only last section as body text', () => {
    const body = 'Text\n\n---\n\n![](https://api.example/media/archives/u/p/inline-0.png)';
    expect(readComposedNote(note(body)).text).toBe(body);
    expect(readComposedNote(note(body)).attachments).toEqual([]);
  });

  it('reads the sentinel region as the gallery, remote entries included', () => {
    const body = 'Text\n\n---\n\nmore\n\n---\n\n<!-- sa:media:start id=arc1 -->\n![x](attachments/post/1.png)\n\n![y](https://api.example/media/archives/u/p/1.jpg)\n<!-- sa:media:end -->';
    const parts = readComposedNote(note(body));
    expect(parts.text).toBe('Text\n\n---\n\nmore');
    expect(parts.attachments).toEqual([
      { target: 'attachments/post/1.png', remote: false },
      { target: 'https://api.example/media/archives/u/p/1.jpg', remote: true },
    ]);
  });

  it('moves local inline media to attachments and keeps note embeds, wikilinks and remote images', () => {
    const body = 'Intro\n\n![[pic.png|300]]\n\nSee ![[Other note]] and [[Link]] ^id1\n\n![](https://cdn.example/a.png)\n\n![[doc.pdf]]';
    const parts = readComposedNote(note(body));
    expect(parts.text).toBe('Intro\n\nSee ![[Other note]] and [[Link]] ^id1\n\n![](https://cdn.example/a.png)\n\n![[doc.pdf]]');
    expect(parts.attachments).toEqual([{ target: 'pic.png', remote: false }]);
  });

  it('drops the archives section, the My Note block, highlight marks and trailing rules', () => {
    const body = '> **My Note:**\n> mine\n\n---\n\nHello ==world==\n\n---\n\n## Referenced Social Media Posts\n\n### X - someone\nquoted';
    const parts = readComposedNote(note(body));
    expect(parts.text).toBe('Hello world');
    expect(readComposedNote(note('Hello ==world==\n\n---'), { keepHighlights: true }).text).toBe('Hello ==world==');
  });

  it('flags CRLF and a missing author line', () => {
    expect(readComposedNote('---\r\na: 1\r\n---\r\nx').hasCrlf).toBe(true);
    expect(readComposedNote(note('Body')).hasFooter).toBe(true);
    const noFooter = readComposedNote('---\nplatform: post\n---\nBody\n\n## 🤖 AI Comments\n\nsecret');
    expect(noFooter.hasFooter).toBe(false);
    expect(isSyncableComposedNote(noFooter)).toBe(false);
  });

  it('fingerprints title, text and attachment targets', () => {
    const a = readComposedNote(note('Text'));
    expect(composedFingerprint(a)).toBe(composedFingerprint(readComposedNote(note('Text', 'like: true'))));
    expect(composedFingerprint(a)).not.toBe(composedFingerprint(readComposedNote(note('Text!'))));
  });
});

describe('server rows', () => {
  it('is a composed row only for composed posts that are not meeting/audio notes', () => {
    expect(isComposedServerRow({ platform: 'post', archiveSource: 'composed' })).toBe(true);
    expect(isComposedServerRow({ platform: 'post', archiveSource: 'composed', contentType: 'meeting-note' })).toBe(false);
    expect(isComposedServerRow({ platform: 'post', archiveSource: 'shared_import' })).toBe(false);
    expect(isComposedServerRow({ platform: 'x', archiveSource: 'composed' })).toBe(false);
  });

  it('appends archive refs as trailing lines; legacy summaries stay off', () => {
    expect(serverComposedText({
      fullContent: 'Body',
      embeddedArchives: [
        { id: 'p1', archiveId: 'arc-1', platform: 'x', title: 'Head', authorName: 'Ann', originalUrl: null },
        { id: 'legacy', platform: 'x', title: null, authorName: 'Old', originalUrl: null },
        { id: 'p2', archiveId: 'arc-2', platform: 'post', title: null, authorName: 'Bo', originalUrl: null },
      ],
    })).toBe('Body\n\n[Head](socialarchiver://archive/arc-1)\n[Bo](socialarchiver://archive/arc-2)');
    expect(serverComposedText({ fullContent: null })).toBe('');
  });
});

describe('normalizeComposedText', () => {
  it('undoes the note writer escapes and compares refs by id', () => {
    expect(normalizeComposedText('\\# Title\n1\\. one\n&lt;책>\n[#tag](https://x.com/hashtag/tag)  \n\n\n\nend\n---').body)
      .toBe('# Title\n1. one\n<책>\n#tag\n\nend');
    expect(sameComposedText('Body\n\n[Old label](socialarchiver://archive/a1)', 'Body  \n\n[New](socialarchiver://archive/a1)')).toBe(true);
    expect(sameComposedText('Body\n\n[A](socialarchiver://archive/a1)', 'Body')).toBe(false);
    expect(sameComposedText('Body ==marked==', 'Body marked')).toBe(true);
  });
});

describe('round trip (PRD §7): server → note → post text, byte for byte', () => {
  afterEach(() => resetRequestUrl());

  const inline = (n: number): string => `![](${API}/media/archives/tester/post_rt/inline-${n}.png)`;
  const FIXTURE = [
    inline(0),
    'Line one',
    'line two right below',
    '',
    '',
    'After a double blank',
    '<책> and 2025. 11. 6',
    '2025. 11. 6',
    '- [ ] open task',
    '- [x] done task',
    '',
    '```',
    '---',
    '# x',
    '```',
    '',
    `Middle ${inline(1)} image`,
    '# Heading in the body',
    '1. numbered',
    '#tag inline',
    '[[위키링크]] and \\*not italic\\*',
    '',
    inline(2),
  ].join('\n');

  const embeddedArchives = [
    { id: 'p1', archiveId: 'arc-1', platform: 'x', title: 'A quoted [post] with a long title', authorName: 'Ann', originalUrl: null },
    { id: 'legacy', platform: 'x', title: null, authorName: 'Old', originalUrl: null },
  ];

  it('Tier-3 save and pull rewrite both read back as the server text', async () => {
    const h = twoWayHarness();
    const created = composedRow('post_rt', FIXTURE, {
      embeddedArchives,
      media: [{ type: 'image', url: `${API}/media/archives/tester/post_rt/0.png` }],
    });
    h.server.rows.set('post_rt', created);
    const { file } = await h.storage.savePost(convertUserArchiveToPostData(created));
    expect(readComposedNote(h.read(file.path)).text).toBe(serverComposedText(created));

    await h.reconciler.stampNew(file, created);
    h.server.editElsewhere('post_rt', { fullContent: `${FIXTURE}\n\nOne more line` });
    const edited = h.server.rows.get('post_rt')!;
    expect(await h.reconciler.reconcile(file, edited)).toBe('pulled');
    expect(readComposedNote(h.read(file.path)).text).toBe(serverComposedText(edited));
    // Nothing reads as a local edit afterwards.
    expect(await h.reconciler.reconcile(file, edited)).toBe('none');
  });

  it('a meeting note keeps the escaping', async () => {
    const h = twoWayHarness();
    const meeting = composedRow('post_mt', '# Agenda\n1. one', { contentType: 'meeting-note' });
    const { file } = await h.storage.savePost(convertUserArchiveToPostData(meeting));
    expect(h.read(file.path)).toContain('\\# Agenda');
  });
});
