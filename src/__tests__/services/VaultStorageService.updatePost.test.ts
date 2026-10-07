import { describe, it, expect, vi } from 'vitest';
import { TFile, type App, type Vault } from 'obsidian';
import { VaultStorageService } from '@/services/VaultStorageService';
import { MarkdownConverter } from '@/services/MarkdownConverter';
import type { VaultManager } from '@/services/VaultManager';
import { PostDataParser } from '@/components/timeline/parsers/PostDataParser';
import type { Media, PostData } from '@/types/post';
import type { SocialArchiverSettings } from '@/types/settings';

/**
 * updatePost with the real MarkdownConverter. Its two callers want different
 * bodies: a PostComposer edit (`replaceBody`) carries the user's new text and
 * media, while adding an embedded archive works from PostData parsed back out
 * of the note, so it keeps the body the note has.
 */

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  // updatePost writes frontmatter with stringifyYaml. JSON is valid YAML and
  // reads back without a YAML parser.
  stringifyYaml: (value: unknown): string => `${JSON.stringify(value)}\n`,
}));

/** What PostComposer hands onPostCreated. */
function composerPost(text: string, extra: Partial<PostData> = {}): PostData {
  return {
    platform: 'post',
    author: { name: 'tester', url: 'https://social-archive.org/tester', handle: '@tester' },
    content: { text },
    media: [],
    metadata: { timestamp: new Date('2026-10-06T09:30:00.000Z') },
    linkPreviews: [],
    processedUrls: [],
    ...extra,
  } as unknown as PostData;
}

/** An X post as the server archives it, to embed in a composer note. */
function xPost(id: string): PostData {
  return {
    platform: 'x',
    id,
    url: `https://x.com/a/status/${id}`,
    author: { name: 'A', url: 'https://x.com/a' },
    content: { text: `Archived post ${id}` },
    media: [],
    metadata: { timestamp: new Date('2026-10-01T00:00:00.000Z') },
  } as unknown as PostData;
}

/** jsdom's File has no arrayBuffer(), and saveMedia needs nothing more. */
function image(name: string): File {
  return { name, type: 'image/png', size: 3, arrayBuffer: async () => new ArrayBuffer(3) } as unknown as File;
}

/** savePost writes `key: value` lines; updatePost writes JSON (stringifyYaml above). */
function readFrontmatter(block: string): Record<string, unknown> {
  if (block.startsWith('{')) return JSON.parse(block) as Record<string, unknown>;
  const fm: Record<string, unknown> = {};
  for (const [, key, value] of block.matchAll(/^(\w+): (.*)$/gm)) {
    if (!key || value === undefined) continue;
    try {
      fm[key] = JSON.parse(value);
    } catch {
      fm[key] = value;
    }
  }
  return fm;
}

function harness(): {
  storage: VaultStorageService;
  files: Map<string, string>;
  frontmatter: Map<string, Record<string, unknown>>;
  /** The PostData the timeline hands PostComposer's edit mode. */
  parse: (path: string) => Promise<PostData>;
} {
  const files = new Map<string, string>();
  /** What MetadataCache would report: the note's frontmatter, then every processFrontMatter write. No embeds. */
  const frontmatter = new Map<string, Record<string, unknown>>();
  const fileAt = (path: string): TFile => new (TFile as unknown as new (p: string) => TFile)(path);

  const write = (path: string, content: string): void => {
    files.set(path, content);
    const block = /^---\n([\s\S]*?)\n---\n/.exec(content)?.[1];
    if (block !== undefined) frontmatter.set(path, readFrontmatter(block));
  };
  const read = vi.fn(async (file: TFile) => files.get(file.path) ?? '');

  const vault = {
    getFileByPath: (path: string) => (files.has(path) ? fileAt(path) : null),
    create: vi.fn(async (path: string, content: string) => {
      write(path, content);
      return fileAt(path);
    }),
    createBinary: vi.fn(async (path: string) => {
      files.set(path, '<binary>');
      return fileAt(path);
    }),
    process: vi.fn(async (file: TFile, fn: (current: string) => string) => {
      write(file.path, fn(files.get(file.path) ?? ''));
      return files.get(file.path);
    }),
    read,
    cachedRead: read,
    readBinary: vi.fn(async () => new ArrayBuffer(3)),
  } as unknown as Vault;

  const app = {
    vault,
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter.get(file.path) }),
    },
    fileManager: {
      processFrontMatter: vi.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm = frontmatter.get(file.path) ?? {};
        fn(fm);
        frontmatter.set(file.path, fm);
      }),
      trashFile: vi.fn(async (file: TFile) => {
        files.delete(file.path);
      }),
    },
  } as unknown as App;

  const storage = new VaultStorageService({
    app,
    vault,
    settings: { archivePath: 'Social Archives', mediaPath: 'attachments/social-archives' } as unknown as SocialArchiverSettings,
    vaultManager: { createFolderIfNotExists: vi.fn(async () => undefined) } as unknown as VaultManager,
    markdownConverter: new MarkdownConverter(),
  });

  const parser = new PostDataParser(vault, app);
  const parse = async (path: string): Promise<PostData> => {
    const post = await parser.parseFile(fileAt(path));
    if (!post) throw new Error(`PostDataParser could not read ${path}`);
    return post;
  };

  return { storage, files, frontmatter, parse };
}

/** The note below its frontmatter. */
function bodyOf(note: string | undefined): string {
  return (note ?? '').replace(/^---\n[\s\S]*?\n---\n/, '');
}

/** The body a fresh save writes for `postData`. */
async function freshBody(postData: PostData): Promise<string> {
  const h = harness();
  const { path } = await h.storage.savePost(postData);
  return bodyOf(h.files.get(path));
}

/**
 * The note as updates before 1aec2c16e left it: whatever followed the author
 * line moved above it, behind a `---`.
 */
function asOlderUpdatesLeftIt(note: string): string {
  const bar = /\n---\n\n\*\*Author:\*\*.*\n/.exec(note)!;
  const after = note.slice(bar.index + bar[0].length);
  return `${note.slice(0, bar.index)}\n---\n${`\n${after}`.trimEnd()}\n${bar[0]}`;
}

describe('VaultStorageService.updatePost — composer edit (replaceBody)', () => {
  it('writes what PostComposer hands over: new text, one image removed, one added', async () => {
    const h = harness();
    const { path, mediaSaved } = await h.storage.savePost(
      { ...composerPost('First draft'), id: 'post_1' } as PostData,
      [image('Screenshot (1).png'), image('Screenshot (2).png')],
    );
    const [removed, kept] = mediaSaved.map((saved) => saved.savedPath);
    // TimelineContainer opens the composer on the parsed note. Until
    // MetadataCache has its embeds, the parser reads the `![…](…)` links,
    // where a `)` is written `%29`.
    const opened = await h.parse(path);
    expect(opened.media.map((m) => m.url)).toEqual([removed, kept]);

    // The composer marks a removed image by the url it was opened with.
    const { mediaSaved: [added] } = await h.storage.updatePost({
      filePath: path,
      postData: composerPost('Second draft'),
      mediaFiles: [image('dog.png')],
      deletedMediaPaths: [opened.media[0]!.url],
      existingMedia: opened.media,
      replaceBody: true,
    });

    expect(h.files.has(removed!)).toBe(false);
    expect(h.files.has(kept!)).toBe(true);
    const edited = await h.parse(path);
    expect(edited.content.text).toBe('Second draft');
    expect(edited.media.map((m) => m.url)).toEqual([kept, added!.savedPath]);
    // One rule before the media, one before the author line.
    expect(bodyOf(h.files.get(path)).match(/^---$/gm)).toHaveLength(2);
  });

  it('writes the edited text', async () => {
    const h = harness();
    const { path } = await h.storage.savePost(composerPost('First draft'));

    await h.storage.updatePost({ filePath: path, postData: composerPost('Second draft'), replaceBody: true });

    expect(bodyOf(h.files.get(path))).toContain('Second draft');
    expect(bodyOf(h.files.get(path))).not.toContain('First draft');
  });

  it('writes the kept and added media, and drops the removed', async () => {
    const h = harness();
    const { path, mediaSaved } = await h.storage.savePost(composerPost('Photos'), [image('a.png'), image('b.png')]);
    const [a, b] = mediaSaved.map((saved) => saved.savedPath);
    const existingMedia: Media[] = [{ type: 'image', url: a! }, { type: 'image', url: b! }];

    const { mediaSaved: added } = await h.storage.updatePost({
      filePath: path,
      postData: composerPost('Photos'),
      mediaFiles: [image('c.png')],
      deletedMediaPaths: [b!],
      existingMedia,
      replaceBody: true,
    });

    const body = bodyOf(h.files.get(path));
    expect(body).toContain(`(${a})`);
    expect(body).toContain(`(${added[0]!.savedPath})`);
    expect(body).not.toContain(`(${b})`);
    expect(h.files.has(b!)).toBe(false);
  });

  it('keeps the frontmatter the edit does not own', async () => {
    const h = harness();
    const { path } = await h.storage.savePost(composerPost('First draft'));
    const owned = {
      archived: '2026-10-01 08:00',
      share: true,
      shareUrl: 'https://social-archive.org/s/abc123',
      tags: ['mine'],
      postOrigin: 'composer',
      clientPostId: 'post_1',
      sourceArchiveId: 'post_1',
    };
    h.frontmatter.set(path, { platform: 'post', ...owned });

    await h.storage.updatePost({ filePath: path, postData: composerPost('Second draft'), replaceBody: true });

    expect(h.frontmatter.get(path)).toMatchObject(owned);
  });
});

describe('VaultStorageService.updatePost — embedded archive (default)', () => {
  it('keeps the note body and adds the archive', async () => {
    // ArchiveCompletionService rebuilds PostData by parsing the note.
    const h = harness();
    const { path } = await h.storage.savePost(composerPost('Look at https://x.com/a/status/1'));
    const archived = {
      platform: 'x',
      id: '1',
      url: 'https://x.com/a/status/1',
      author: { name: 'A', url: 'https://x.com/a' },
      content: { text: 'The archived post' },
      media: [],
      metadata: { timestamp: new Date('2026-10-01T00:00:00.000Z') },
    } as unknown as PostData;

    await h.storage.updatePost({
      filePath: path,
      postData: composerPost('What a lossy parse gave back', { embeddedArchives: [archived] }),
    });

    const body = bodyOf(h.files.get(path));
    expect(body).toContain('Look at https://x.com/a/status/1');
    expect(body).not.toContain('What a lossy parse gave back');
    expect(body).toContain('The archived post');
  });

  it('keeps one copy of a place block the parsed PostData carries back', async () => {
    // The parser reads `%% sa:locations %%` into metadata.locations, so the
    // regenerated note has the block below the author line — where the kept
    // remainder of the note already has it.
    const h = harness();
    const place = {
      id: 'p1', archiveId: 'a1', placeKey: 'kakaomap:1', name: 'Cafe', address: 'Seoul', latitude: 37.5, longitude: 127,
      source: 'kakaomap', externalId: '1', url: 'https://place.map.kakao.com/1', category: 'Cafe', isPrimary: true, sortOrder: 0,
      placeArchiveId: null, promotionStatus: 'metadata_only', createdAt: '2026-10-06T09:30:00.000Z', updatedAt: '2026-10-06T09:30:00.000Z',
    };
    const { path } = await h.storage.savePost(composerPost('Coffee', {
      metadata: { timestamp: new Date('2026-10-06T09:30:00.000Z'), locations: [place] },
    } as unknown as Partial<PostData>));
    const parsed = await h.parse(path);
    expect(parsed.metadata.locations).toHaveLength(1);

    await h.storage.updatePost({ filePath: path, postData: parsed, existingMedia: parsed.media });

    expect(h.files.get(path)?.match(/sa:locations/g)).toHaveLength(1);
  });

  it('replaces the archives section rather than adding a second', async () => {
    // The kept body ends with the section, and the regenerated one (every
    // parsed archive plus the new) went in below it: the second archive wrote
    // the heading, and the first archive, twice.
    const h = harness();
    const text = 'Look at https://x.com/a/status/1 and https://x.com/a/status/2';
    const { path } = await h.storage.savePost(composerPost(text));

    await h.storage.updatePost({ filePath: path, postData: composerPost(text, { embeddedArchives: [xPost('1')] }) });
    await h.storage.updatePost({ filePath: path, postData: composerPost(text, { embeddedArchives: [xPost('1'), xPost('2')] }) });

    expect(bodyOf(h.files.get(path))).toBe(
      await freshBody(composerPost(text, { embeddedArchives: [xPost('1'), xPost('2')] })),
    );
  });

  it('keeps an archive written after its PostData was parsed', async () => {
    // Two archives of one note finishing together: each job parses the note,
    // downloads media, then writes. The later write must not drop the earlier's.
    const h = harness();
    const text = 'Look at https://x.com/a/status/1, https://x.com/a/status/2 and https://x.com/a/status/3';
    const { path } = await h.storage.savePost(composerPost(text));
    await h.storage.updatePost({ filePath: path, postData: composerPost(text, { embeddedArchives: [xPost('1')] }) });

    await h.storage.updatePost({ filePath: path, postData: composerPost(text, { embeddedArchives: [xPost('1'), xPost('2')] }) });
    await h.storage.updatePost({ filePath: path, postData: composerPost(text, { embeddedArchives: [xPost('1'), xPost('3')] }) });

    expect(bodyOf(h.files.get(path))).toBe(
      await freshBody(composerPost(text, { embeddedArchives: [xPost('1'), xPost('3'), xPost('2')] })),
    );
  });

  it('writes once what the note keeps after the author line', async () => {
    // PostData parsed out of the note carries its transcript (and place and
    // product blocks), which the converter appends after the author line —
    // where the note still has them.
    const h = harness();
    const text = 'Voice note https://x.com/a/status/1';
    const whisperTranscript = { language: 'en', segments: [{ id: 0, start: 0, end: 4, text: 'Hello there' }] };
    const { path } = await h.storage.savePost(composerPost(text, { whisperTranscript }));

    await h.storage.updatePost({
      filePath: path,
      postData: composerPost(text, { whisperTranscript, embeddedArchives: [xPost('1')] }),
    });

    expect(bodyOf(h.files.get(path))).toBe(
      await freshBody(composerPost(text, { whisperTranscript, embeddedArchives: [xPost('1')] })),
    );
  });
});

describe('VaultStorageService.updatePost — either mode', () => {
  it('leaves a note as a fresh save writes it, however often it is updated', async () => {
    // Every update used to add a `---` above the author line.
    const h = harness();
    const { path } = await h.storage.savePost(composerPost('Same text'));
    const saved = bodyOf(h.files.get(path));

    for (const replaceBody of [true, false, true, false]) {
      await h.storage.updatePost({ filePath: path, postData: composerPost('Same text'), replaceBody });
    }

    expect(bodyOf(h.files.get(path))).toBe(saved);
  });

  it.each([true, false])('keeps what was appended after the author line in place (replaceBody: %s)', async (replaceBody) => {
    // AI comments, transcripts, place/product blocks, annotations and
    // downloaded videos are all appended there; they used to be moved above it.
    const h = harness();
    const { path } = await h.storage.savePost(composerPost('Text'));
    const appended = '\n## AI Comments\n\n### Claude · Summary · 2026-10-06\n\nA summary.\n\n![[attachments/social-archives/youtube/clip.mp4]]';
    const saved = bodyOf(h.files.get(path)) + appended;
    h.files.set(path, h.files.get(path)! + appended);

    await h.storage.updatePost({ filePath: path, postData: composerPost('Text'), replaceBody });

    expect(bodyOf(h.files.get(path))).toBe(saved);
  });

  it.each([true, false])('moves back below the author line what older updates left after the archives (replaceBody: %s)', async (replaceBody) => {
    // They moved it above the author line behind a `---`: in a note with
    // embedded archives, to the end of their section, which is now replaced.
    const h = harness();
    const text = 'Look at https://x.com/a/status/1 and https://x.com/a/status/2';
    const { path } = await h.storage.savePost(composerPost(text));
    await h.storage.updatePost({ filePath: path, postData: composerPost(text, { embeddedArchives: [xPost('1')] }) });
    const appended = [
      '',
      '## AI Comments',
      '',
      '### Claude · Summary · 2026-10-06',
      '',
      'A summary.',
      '',
      '---',
      '',
      '### Claude · Glossary · 2026-10-06',
      '',
      'Terms.',
      '',
      '<!-- social-archiver:annotations:start -->',
      '',
      '---',
      '',
      '## Mobile Annotations',
      '',
      '> [!note]+ 2026-10-06 18:40',
      '> Read later.',
      '',
      '<!-- social-archiver:annotations:end -->',
      '',
      '%% sa:product',
      '{"v":1,"product":{"name":"Lamp"}}',
      '%%',
      '',
      '![[attachments/social-archives/youtube/clip.mp4]]',
      '',
    ].join('\n');
    h.files.set(path, asOlderUpdatesLeftIt(h.files.get(path)! + appended));

    await h.storage.updatePost({
      filePath: path,
      postData: composerPost(text, { embeddedArchives: [xPost('1'), xPost('2')] }),
      replaceBody,
    });

    expect(bodyOf(h.files.get(path))).toBe(
      await freshBody(composerPost(text, { embeddedArchives: [xPost('1'), xPost('2')] })) + appended,
    );
  });
});

/** An X post with a reply, as the server archives it. */
function xPostWithReply(id: string): PostData {
  return {
    ...xPost(id),
    comments: [{ id: `c${id}`, author: { name: 'B', url: 'https://x.com/b', username: 'b' }, content: `Reply ${id}`, timestamp: '2026-10-01T01:00:00.000Z' }],
  } as unknown as PostData;
}

/** A web article, its markup written as it is rather than escaped. */
function webArticle(id: string): PostData {
  return {
    platform: 'web',
    id,
    url: `https://example.com/article-${id}`,
    author: { name: 'Site', url: 'https://example.com' },
    content: { text: `Article ${id} with <b>markup</b>` },
    media: [],
    metadata: { timestamp: new Date('2026-10-01T00:00:00.000Z') },
  } as unknown as PostData;
}

/** AI comments and an annotation, as other writers append them below the author line. */
function appendedBelow(name: string): string {
  return [
    '',
    '## AI Comments',
    '',
    `### Claude · Summary · ${name}`,
    '',
    `A <b>${name}</b> summary.`,
    '',
    '---',
    '',
    '<!-- social-archiver:annotations:start -->',
    '',
    '## Mobile Annotations',
    '',
    '> [!note]+ 2026-10-06 18:40',
    `> Read ${name}.`,
    '',
    '<!-- social-archiver:annotations:end -->',
    '',
  ].join('\n');
}

/** The archives the parser reads out of `note`. */
function readBack(note: string, path: string): PostData[] {
  const parser = new PostDataParser({} as Vault) as unknown as {
    extractEmbeddedArchives(markdown: string, downloadedUrls: string[], processedUrls: string[], filePath: string): PostData[];
  };
  return parser.extractEmbeddedArchives(note, [], [], path);
}

/**
 * The archives the parser read back before this fix. It split the section only
 * where a hidden header follows a rule, so a repeated heading joined the blocks
 * either side of it into one archive. Each such block is read here with
 * today's parser, the headings in it hidden.
 */
function readBackBeforeThisFix(note: string, path: string): PostData[] {
  const heading = '## Referenced Social Media Posts';
  const hidden = `${heading} (hidden)`;
  const section = /## Referenced Social Media Posts\n\n([\s\S]*?)(?=\n---\n\n\*\*Author:)/.exec(note)?.[1];
  return (section?.split(/\n---\n\n(?=<!-- Embedded:)/) ?? []).map((block) => {
    const [archive] = readBack(`${heading}\n\n${block.replaceAll(heading, hidden)}`, path);
    const read = JSON.parse(JSON.stringify(archive).replaceAll(hidden, heading)) as PostData;
    return { ...read, metadata: { ...read.metadata, timestamp: new Date(read.metadata.timestamp) } };
  });
}

/**
 * Save `postData` into `note` the way updates did before 1aec2c16e: the body
 * above the author line kept, the archives section regenerated from
 * `postData` written below it, and whatever followed the author line moved
 * above it, behind a `---`.
 */
function saveAsOlderUpdatesDid(note: string, postData: PostData, path: string): string {
  const [frontmatter = ''] = /^---\n[\s\S]*?\n---\n/.exec(note) ?? [];
  const body = note.slice(frontmatter.length);
  const bar = /\n---\n\n\*\*Author:\*\*/.exec(body)!;
  const existingBody = body.slice(0, bar.index).replace(/\n---\n\s*$/, '\n');
  const lineEnd = body.indexOf('\n', bar.index + bar[0].length);
  const afterAuthorLine = lineEnd < 0 ? '' : body.slice(lineEnd);
  const regenerated = bodyOf(new MarkdownConverter().convert(postData, undefined, [], { outputFilePath: path }).fullDocument);
  const section = /\n---\n\n## Referenced Social Media Posts\n[\s\S]*?(?=\n---\n\n\*\*Author:\*\*)/.exec(regenerated)?.[0] ?? '';
  const authorLineAndBelow = /\n---\n\n\*\*Author:\*\*[\s\S]*/.exec(regenerated)![0];
  const moved = afterAuthorLine ? `\n---\n${afterAuthorLine.trimEnd()}\n` : '';
  return `${frontmatter}${existingBody.trimEnd()}\n${section}${moved}${authorLineAndBelow}`;
}

describe('VaultStorageService.updatePost — a section older updates repeated', () => {
  // From 4532fddeb until c0caacab2, each embedded archive added (and, until
  // 1aec2c16e, each PostComposer edit) wrote the section again below the
  // note's own, the archives in it as the parser read them back. That parser read on from the
  // first heading to the author line, so from the third save on, archive 1
  // came back holding the blocks either side of a repeated heading.
  const text = 'Look at the links';

  /**
   * A composer note after older updates: each save adds its archive, or none
   * (a PostComposer edit), once `appended` was written below the author line.
   */
  async function savedByOlderUpdates(
    saves: { add?: PostData; appended?: string }[],
    tail?: string,
  ): Promise<{ h: ReturnType<typeof harness>; path: string; note: string; notes: string[]; archives: PostData[] }> {
    const h = harness();
    const { path } = await h.storage.savePost(composerPost(text));
    let note = h.files.get(path)!;
    const archives: PostData[] = [];
    const notes: string[] = [];
    for (const { add, appended } of saves) {
      if (appended) note += appendedBelow(appended);
      if (add) archives.push(add);
      const readBefore = note.includes('## Referenced Social Media Posts') ? readBackBeforeThisFix(note, path) : [];
      note = saveAsOlderUpdatesDid(note, composerPost(text, { embeddedArchives: [...readBefore, ...(add ? [add] : [])] }), path);
      notes.push(note);
    }
    if (tail) note += appendedBelow(tail);
    h.files.set(path, note);
    return { h, path, note, notes, archives };
  }

  /** Add `added` as ArchiveCompletionService does: to the archives read back from the note. */
  async function addArchive(h: ReturnType<typeof harness>, path: string, added: PostData): Promise<string> {
    const embeddedArchives = [...readBack(h.files.get(path)!, path), added];
    await h.storage.updatePost({ filePath: path, postData: composerPost(text, { embeddedArchives }) });
    return bodyOf(h.files.get(path));
  }

  it.each([2, 3, 4])('leaves a note %i adds left as a fresh save, what they moved below the author line once', async (adds) => {
    const saves = ['1', '2', '3', '4'].slice(0, adds).map((id) => ({ add: xPost(id), appended: { '1': 'one', '2': 'two' }[id] }));
    const { h, path, note } = await savedByOlderUpdates(saves, 'tail');
    // From the third add on, archive 1 holds a heading and an escaped header
    expect(note.includes('## Referenced Social Media Posts\n\n&lt;!-- Embedded:')).toBe(adds >= 3);

    expect(await addArchive(h, path, xPost('5'))).toBe(
      await freshBody(composerPost(text, { embeddedArchives: [...saves.map(({ add }) => add), xPost('5')] }))
        + appendedBelow('one') + appendedBelow('two') + appendedBelow('tail'),
    );
  });

  it('does the same where archive 1 is a web article, which holds them as markup', async () => {
    const saves = [{ add: webArticle('1'), appended: 'one' }, { add: webArticle('2'), appended: 'two' }, { add: webArticle('3') }];
    const { h, path } = await savedByOlderUpdates(saves, 'tail');

    expect(await addArchive(h, path, webArticle('4'))).toBe(
      await freshBody(composerPost(text, { embeddedArchives: ['1', '2', '3', '4'].map(webArticle) }))
        + appendedBelow('one') + appendedBelow('two') + appendedBelow('tail'),
    );
  });

  it('writes a PostComposer edit of such a note as a fresh save', async () => {
    const { h, path, archives } = await savedByOlderUpdates([{ add: xPost('1'), appended: 'one' }, { add: xPost('2'), appended: 'two' }, { add: xPost('3') }]);

    await h.storage.updatePost({ filePath: path, postData: composerPost('Edited', { embeddedArchives: readBack(h.files.get(path)!, path) }), replaceBody: true });

    expect(bodyOf(h.files.get(path))).toBe(
      await freshBody(composerPost('Edited', { embeddedArchives: archives })) + appendedBelow('one') + appendedBelow('two'),
    );
  });

  it('keeps an archive its PostData lacks once, however often the note repeats it', async () => {
    const { h, path } = await savedByOlderUpdates([{ add: xPost('1') }, { add: xPost('2') }, { add: xPost('3') }]);
    const withoutTwo = readBack(h.files.get(path)!, path).filter((archive) => archive.url !== xPost('2').url);

    await h.storage.updatePost({ filePath: path, postData: composerPost(text, { embeddedArchives: [...withoutTwo, xPost('4')] }) });

    expect(bodyOf(h.files.get(path))).toBe(
      await freshBody(composerPost(text, { embeddedArchives: ['1', '3', '4', '2'].map(xPost) })),
    );
  });

  it('keeps what was moved after the copy of an archive with comments a PostComposer edit ended with', async () => {
    // Comments run on to the next archive, so what was moved after them reads
    // as the last comment's: the first archive's keeps it (as since
    // c0caacab2), and the copies' come back below the author line.
    const { h, path, notes } = await savedByOlderUpdates(
      [{ add: xPostWithReply('1'), appended: 'one' }, { appended: 'two' }, { appended: 'three' }],
      'tail',
    );
    const asFirstSaved = readBack(notes[0]!, path);

    expect(await addArchive(h, path, xPost('2'))).toBe(
      await freshBody(composerPost(text, { embeddedArchives: [...asFirstSaved, xPost('2')] }))
        + appendedBelow('two') + appendedBelow('three') + appendedBelow('tail'),
    );
  });

  it('leaves archive 1 as c0caacab2 rewrote it, when the joined blocks are all it has', async () => {
    // c0caacab2 replaced the section with what the parser read back: archive
    // 1 joined with its copy, the escaped header and heading in its text.
    const { h, path, note } = await savedByOlderUpdates([{ add: xPost('1'), appended: 'one' }, { add: xPost('2') }]);
    const [joined] = readBackBeforeThisFix(note, path);
    const rewritten = [joined!, xPost('2'), xPost('3')];
    h.files.set(path, /^---\n[\s\S]*?\n---\n/.exec(note)![0] + await freshBody(composerPost(text, { embeddedArchives: rewritten })));

    expect(await addArchive(h, path, xPost('4'))).toBe(
      await freshBody(composerPost(text, { embeddedArchives: [...rewritten, xPost('4')] })),
    );
  });
});
