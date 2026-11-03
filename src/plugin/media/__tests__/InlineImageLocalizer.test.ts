/**
 * InlineImageLocalizer tests (inline image preservation PRD §6.3, §11).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile, __setRequestUrlHandler, type App, type RequestUrlParam } from 'obsidian';
import { InlineImageLocalizer, rewriteImageTargets } from '../InlineImageLocalizer';
import { MediaPathGenerator } from '@/services/MediaHandler';
import type { InlinePreservedImage, UserArchive } from '@/services/WorkersAPIClient';
import type { SocialArchiverSettings } from '@/types/settings';

const NOTE_PATH = 'Social Archives/Web/2026/11/story.md';
const CHART_URL = 'https://cdn.example.com/chart.png';
const PHOTO_KEY = 'https://cdn.example.com/photo.jpg?w=1&amp;h=2';
const CHART_R2_KEY = 'archives/u1/a1/inline/i-0123456789abcdef.png';
const PHOTO_R2_KEY = 'archives/u1/a1/inline/i-fedcba9876543210.webp';

function record(originalUrl: string, r2Key: string): InlinePreservedImage {
  return {
    originalUrl,
    r2Url: `https://social-archiver-api.social-archive.org/media/${r2Key}`,
    r2Key,
    type: 'image',
    size: 10,
    contentType: 'image/webp',
    preservedAt: '2026-11-03T00:00:00.000Z',
  };
}

function makeArchive(overrides: Partial<UserArchive> = {}): UserArchive {
  return {
    id: 'a1',
    userId: 'u1',
    platform: 'web',
    postId: 'web:story 1',
    originalUrl: 'https://example.com/story',
    title: 'Story',
    authorName: 'Writer',
    authorUrl: null,
    authorAvatarUrl: null,
    previewText: null,
    fullContent: 'body',
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: [{ type: 'image', url: 'https://cdn.example.com/hero.jpg' }],
    postedAt: null,
    archivedAt: '2026-11-03T00:00:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    isLiked: false,
    isBookmarked: false,
    inlineMediaPreserved: [record(CHART_URL, CHART_R2_KEY), record(PHOTO_KEY, PHOTO_R2_KEY)],
    ...overrides,
  } as UserArchive;
}

const BODY = [
  '---',
  'platform: web',
  '---',
  '',
  '![Hero](attachments/social-archives/web/web-story_1/20261103-writer-web-story_1-1.jpg)',
  '',
  `![Chart](${CHART_URL} "Q3 revenue")`,
  '',
  // The note carries the decoded form; the record key keeps `&amp;`.
  '<img alt="photo" src="https://cdn.example.com/photo.jpg?w=1&h=2">',
  '',
  '[Source](https://cdn.example.com/chart.png)',
].join('\n');

interface Harness {
  app: App;
  file: TFile;
  content: () => string;
  written: Map<string, ArrayBuffer>;
  requests: string[];
  process: ReturnType<typeof vi.fn>;
  cachedRead: ReturnType<typeof vi.fn>;
}

function makeHarness(body = BODY, existingFiles: string[] = []): Harness {
  let noteContent = body;
  const files = new Set(existingFiles);
  const folders = new Set<string>();
  const written = new Map<string, ArrayBuffer>();
  const requests: string[] = [];
  const file = new TFile(NOTE_PATH);

  const process = vi.fn(async (_file: TFile, fn: (data: string) => string) => {
    noteContent = fn(noteContent);
    return noteContent;
  });
  const cachedRead = vi.fn(async () => noteContent);

  const app = {
    vault: {
      cachedRead,
      process,
      getAbstractFileByPath: vi.fn((path: string) => (files.has(path) ? new TFile(path) : null)),
      getFolderByPath: vi.fn((path: string) => (folders.has(path) ? { path } : null)),
      createFolder: vi.fn(async (path: string) => {
        folders.add(path);
      }),
      createBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
        if (files.has(path)) throw new Error('File already exists.');
        files.add(path);
        written.set(path, data);
        return new TFile(path);
      }),
      adapter: { exists: vi.fn(async (path: string) => files.has(path)) },
    },
  } as unknown as App;

  __setRequestUrlHandler(async (params: RequestUrlParam) => {
    requests.push(params.url);
    return {
      status: 200,
      headers: { 'Content-Type': 'image/webp' },
      text: '',
      json: null,
      arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
    };
  });

  return { app, file, content: () => noteContent, written, requests, process, cachedRead };
}

function makeLocalizer(app: App, overrides: Partial<SocialArchiverSettings> = {}): InlineImageLocalizer {
  const settings = {
    downloadMedia: 'images-and-videos',
    mediaPath: 'attachments/social-archives',
    ...overrides,
  } as SocialArchiverSettings;
  return new InlineImageLocalizer({ app, settings: () => settings });
}

describe('InlineImageLocalizer.reconcile', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    __setRequestUrlHandler(null);
    vi.restoreAllMocks();
  });

  it("downloads into the hero's media folder under the i-{hash} file name", async () => {
    const h = makeHarness();
    const changed = await makeLocalizer(h.app).reconcile(h.file, makeArchive());

    expect(changed).toBe(true);
    // Hero path as SubscriptionSyncService derives it for this archive.
    const heroPath = new MediaPathGenerator('attachments/social-archives')
      .generatePath('web', 'web:story 1', '20261103-writer-web-story_1-1.jpg');
    const heroFolder = heroPath.slice(0, heroPath.lastIndexOf('/'));
    expect(heroFolder).toBe('attachments/social-archives/web/web-story_1');
    expect([...h.written.keys()]).toEqual([
      `${heroFolder}/i-0123456789abcdef.png`,
      `${heroFolder}/i-fedcba9876543210.webp`,
    ]);
    expect(h.requests).toEqual([
      `https://social-archiver-api.social-archive.org/media/${CHART_R2_KEY}`,
      `https://social-archiver-api.social-archive.org/media/${PHOTO_R2_KEY}`,
    ]);
  });

  it('rewrites image targets to encoded markdown paths, never wikilinks', async () => {
    const h = makeHarness();
    await makeLocalizer(h.app, { mediaPath: 'My Media' }).reconcile(h.file, makeArchive());

    const folder = 'My%20Media/web/web-story_1';
    expect(h.content()).toContain(`![Chart](${folder}/i-0123456789abcdef.png "Q3 revenue")`);
    expect(h.content()).toContain(`<img alt="photo" src="${folder}/i-fedcba9876543210.webp">`);
    expect(h.content()).not.toContain('![[');
    // Plain links and the hero embed stay as they were.
    expect(h.content()).toContain('[Source](https://cdn.example.com/chart.png)');
    expect(h.content()).toContain('![Hero](attachments/social-archives/web/web-story_1/20261103-writer-web-story_1-1.jpg)');
  });

  it('is a no-op on the second run: no download, no write', async () => {
    const h = makeHarness();
    const localizer = makeLocalizer(h.app);
    await localizer.reconcile(h.file, makeArchive());
    const afterFirst = h.content();
    h.process.mockClear();
    h.requests.length = 0;

    const changed = await localizer.reconcile(h.file, makeArchive());

    expect(changed).toBe(false);
    expect(h.process).not.toHaveBeenCalled();
    expect(h.requests).toEqual([]);
    expect(h.content()).toBe(afterFirst);
  });

  it('reuses an existing vault file instead of downloading', async () => {
    const existing = 'attachments/social-archives/web/web-story_1/i-0123456789abcdef.png';
    const h = makeHarness(`![Chart](${CHART_URL})`, [existing]);

    const changed = await makeLocalizer(h.app).reconcile(h.file, makeArchive());

    expect(changed).toBe(true);
    expect(h.requests).toEqual([]);
    expect(h.written.size).toBe(0);
    expect(h.content()).toBe(`![Chart](${existing})`);
  });

  it('leaves the original URL when the download fails or is not an image', async () => {
    const h = makeHarness(`![Chart](${CHART_URL})\n\n<img src="${PHOTO_KEY}">`);
    __setRequestUrlHandler(async (params) => {
      if (params.url.endsWith('.png')) throw new Error('offline');
      return { status: 200, headers: { 'content-type': 'text/html' }, text: '', json: null, arrayBuffer: new ArrayBuffer(4) };
    });

    const changed = await makeLocalizer(h.app).reconcile(h.file, makeArchive());

    expect(changed).toBe(false);
    expect(h.process).not.toHaveBeenCalled();
    expect(h.written.size).toBe(0);
  });

  it('localizes what it can when only some downloads succeed', async () => {
    const h = makeHarness(`![Chart](${CHART_URL})\n\n![Photo](${PHOTO_KEY})`);
    __setRequestUrlHandler(async (params) => ({
      status: params.url.endsWith('.png') ? 503 : 200,
      headers: { 'content-type': 'image/webp' },
      text: '',
      json: null,
      arrayBuffer: new ArrayBuffer(4),
    }));

    await makeLocalizer(h.app).reconcile(h.file, makeArchive());

    expect(h.content()).toBe(
      `![Chart](${CHART_URL})\n\n![Photo](attachments/social-archives/web/web-story_1/i-fedcba9876543210.webp)`,
    );
  });

  it('is a no-op in text-only mode, for non-web platforms and without records', async () => {
    for (const [settings, archive] of [
      [{ downloadMedia: 'text-only' }, makeArchive()],
      [{}, makeArchive({ platform: 'x' })],
      [{}, makeArchive({ inlineMediaPreserved: undefined })],
      [{}, makeArchive({ inlineMediaPreserved: [] })],
    ] as const) {
      const h = makeHarness();
      const changed = await makeLocalizer(h.app, settings as Partial<SocialArchiverSettings>).reconcile(h.file, archive);
      expect(changed).toBe(false);
      expect(h.cachedRead).not.toHaveBeenCalled();
      expect(h.content()).toBe(BODY);
    }
  });

  it('never touches the note when no record key is in the body', async () => {
    const body = '![Other](https://cdn.example.com/other.jpg)';
    const h = makeHarness(body);

    const changed = await makeLocalizer(h.app).reconcile(h.file, makeArchive());

    expect(changed).toBe(false);
    expect(h.process).not.toHaveBeenCalled();
    expect(h.requests).toEqual([]);
  });

  it('ignores records whose r2Key is not a server inline file name', async () => {
    const h = makeHarness(`![Evil](${CHART_URL})`);
    const archive = makeArchive({
      inlineMediaPreserved: [{ ...record(CHART_URL, 'archives/u1/a1/inline/../../../.obsidian/x.png') }],
    });

    const changed = await makeLocalizer(h.app).reconcile(h.file, archive);

    expect(changed).toBe(false);
    expect(h.cachedRead).not.toHaveBeenCalled();
  });

  it('never throws: a failing vault read resolves false', async () => {
    const h = makeHarness();
    h.cachedRead.mockRejectedValueOnce(new Error('disk gone'));

    await expect(makeLocalizer(h.app).reconcile(h.file, makeArchive())).resolves.toBe(false);
  });
});

describe('rewriteImageTargets', () => {
  const resolve = (target: string) => (target === 'https://c/a b.png' || target === 'https://c/a.png' ? 'local/a.png' : undefined);

  it('rewrites angle-bracketed destinations and keeps the brackets', () => {
    expect(rewriteImageTargets('![A](<https://c/a b.png>)', resolve)).toBe('![A](<local/a.png>)');
  });

  it('rewrites only the inner image of a linked image', () => {
    expect(rewriteImageTargets('[![A](https://c/a.png)](https://c/a.png)', resolve)).toBe(
      '[![A](local/a.png)](https://c/a.png)',
    );
  });

  it('leaves srcset and unmatched targets alone', () => {
    const text = '<img srcset="https://c/a.png 2x" src="https://c/b.png">';
    expect(rewriteImageTargets(text, resolve)).toBe(text);
  });
});
