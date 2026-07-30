import { describe, it, expect, vi, beforeAll } from 'vitest';
import { TFile, type App, type Vault } from 'obsidian';
import { VaultStorageService } from '@/services/VaultStorageService';
import { MarkdownConverter } from '@/services/MarkdownConverter';
import { VaultManager } from '@/services/VaultManager';
import type { PostData } from '@/types/post';
import type { SocialArchiverSettings } from '@/types/settings';

/**
 * Overwriting an existing note regenerates frontmatter from `PostData`, and
 * `PostData` carries none of the user's tags, share state, or per-URL media
 * decisions. The subscription "limited archive upgrade" path went through
 * `savePost`, which had no preservation merge — so upgrading a note silently
 * destroyed all of it, and a published shareUrl stopped resolving.
 *
 * Uses the real MarkdownConverter on purpose: the pre-existing suite mocks it,
 * which cannot catch a frontmatter merge that never happens.
 */

const EXISTING_PATH = 'Social Archives/Web Article/2026/07/existing.md';

/**
 * `getTimestampParts` reaches for Obsidian's `window.moment`. Only the format
 * tokens this service asks for are implemented — a real moment shim would be a
 * dependency this test does not need.
 */
beforeAll(() => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  (window as unknown as { moment: unknown }).moment = (input: Date | string) => {
    const d = input instanceof Date ? input : new Date(input);
    const tokens: Record<string, string> = {
      YYYY: String(d.getFullYear()),
      MM: pad(d.getMonth() + 1),
      DD: pad(d.getDate()),
      'YYYY-MM-DD': `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      HHmmss: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    };
    return { format: (token: string) => tokens[token] ?? '' };
  };
});

/** What the user owns on the note being overwritten. */
const USER_FRONTMATTER = {
  platform: 'web',
  author: 'Some Shop',
  archived: '2026-07-27 12:00',
  share: true,
  shareId: 'abc123',
  shareUrl: 'https://social-archive.org/s/abc123',
  sharePassword: 'hunter2',
  like: true,
  comment: 'why I saved this',
  tags: ['shopping', 'wishlist'],
  archiveTags: ['archive/2026/07'],
  mediaDetached: true,
  mediaPromptSuppressed: true,
  downloadedUrls: ['https://cdn.example.com/a.jpg'],
  transcribedUrls: ['https://cdn.example.com/v.mp4'],
  mediaSourceUrls: { 'attachments/a.jpg': 'https://cdn.example.com/a.jpg' },
  authorNote: '[[Authors/Some Shop]]',
};

function settings(): SocialArchiverSettings {
  return {
    archivePath: 'Social Archives',
    mediaPath: 'attachments/social-archives',
    fileNameFormat: '{title}',
    timelineSortBy: 'published',
    timelineSortOrder: 'newest',
  } as unknown as SocialArchiverSettings;
}

function postData(): PostData {
  return {
    platform: 'web',
    id: 'existing',
    url: 'https://shop.example.com/products/thing',
    author: { name: 'Some Shop', url: 'https://shop.example.com' },
    content: { text: 'Richer article body that triggered the upgrade.' },
    media: [],
    metadata: { timestamp: new Date('2026-07-27T12:00:00.000Z') },
  } as PostData;
}

/** Harness whose vault reports EXISTING_PATH as already present. */
function harness(): { service: VaultStorageService; written: { current: string } } {
  const existing = new (TFile as unknown as new (path: string) => TFile)(EXISTING_PATH);
  const written = { current: '' };

  const vault = {
    getFileByPath: (path: string) => (path === EXISTING_PATH ? existing : null),
    getAbstractFileByPath: (path: string) => (path === EXISTING_PATH ? existing : null),
    process: vi.fn(async (_file: TFile, fn: (c: string) => string) => {
      written.current = fn('');
      return written.current;
    }),
    create: vi.fn(async (_path: string, content: string) => {
      written.current = content;
      return existing;
    }),
    read: vi.fn(async () => ''),
    adapter: { exists: vi.fn(async () => false) },
  } as unknown as Vault;

  const app = {
    vault,
    metadataCache: {
      getFileCache: (file: TFile) =>
        file.path === EXISTING_PATH ? { frontmatter: { ...USER_FRONTMATTER } } : null,
    },
    fileManager: {
      processFrontMatter: vi.fn(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
        fn({});
      }),
    },
  } as unknown as App;

  const service = new VaultStorageService({
    app,
    vault,
    settings: settings(),
    vaultManager: { createFolderIfNotExists: vi.fn(async () => undefined) } as unknown as VaultManager,
    markdownConverter: new MarkdownConverter(),
  });

  return { service, written };
}

function frontmatterOf(document: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---/.exec(document)?.[1] ?? '';
  const out: Record<string, string> = {};
  let currentKey = '';
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (match) {
      currentKey = match[1]!;
      out[currentKey] = match[2] ?? '';
    } else if (currentKey && line.trim()) {
      // list item or nested value continuing the previous key
      out[currentKey] = `${out[currentKey]} ${line.trim()}`.trim();
    }
  }
  // YAML quotes values that need it (URLs, strings with colons). The quoting is
  // not what these tests are about.
  for (const key of Object.keys(out)) {
    out[key] = (out[key] ?? '').replace(/^"(.*)"$/, '$1');
  }
  return out;
}

describe('VaultStorageService.savePost — overwriting an existing note', () => {
  it('keeps the user share state, so a published link keeps resolving', async () => {
    const { service, written } = harness();

    await service.savePost(postData(), undefined, EXISTING_PATH);
    const fm = frontmatterOf(written.current);

    expect(fm['share']).toBe('true');
    expect(fm['shareId']).toBe('abc123');
    expect(fm['shareUrl']).toBe('https://social-archive.org/s/abc123');
    expect(fm['sharePassword']).toBe('hunter2');
  });

  it('keeps the user tags', async () => {
    const { service, written } = harness();

    await service.savePost(postData(), undefined, EXISTING_PATH);
    const fm = frontmatterOf(written.current);

    expect(fm['tags']).toContain('shopping');
    expect(fm['tags']).toContain('wishlist');
    expect(fm['archiveTags']).toContain('archive/2026/07');
  });

  it('keeps the star and the personal note', async () => {
    const { service, written } = harness();

    await service.savePost(postData(), undefined, EXISTING_PATH);
    const fm = frontmatterOf(written.current);

    expect(fm['like']).toBe('true');
    expect(fm['comment']).toContain('why I saved this');
  });

  it('keeps local-only media decisions, which the server cannot restore', async () => {
    const { service, written } = harness();

    await service.savePost(postData(), undefined, EXISTING_PATH);
    const fm = frontmatterOf(written.current);

    expect(fm['mediaDetached']).toBe('true');
    expect(fm['mediaPromptSuppressed']).toBe('true');
    expect(fm['downloadedUrls']).toContain('https://cdn.example.com/a.jpg');
    expect(fm['transcribedUrls']).toContain('https://cdn.example.com/v.mp4');
  });

  it('still regenerates archiver-owned content', async () => {
    // Preservation must not turn the upgrade into a no-op — the whole reason
    // the note is being replaced is that the server has richer content.
    const { service, written } = harness();

    await service.savePost(postData(), undefined, EXISTING_PATH);

    expect(written.current).toContain('Richer article body that triggered the upgrade.');
  });

  it('writes a brand-new note without inventing preserved fields', async () => {
    const { service, written } = harness();

    await service.savePost(postData(), undefined, 'Social Archives/Web Article/2026/07/brand-new.md');
    const fm = frontmatterOf(written.current);

    expect(fm['shareUrl']).toBeUndefined();
    expect(fm['comment']).toBeUndefined();
    expect(fm['share']).toBe('false');
  });
});
