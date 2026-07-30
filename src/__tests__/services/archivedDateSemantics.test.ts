import { describe, it, expect } from 'vitest';
import { MarkdownConverter } from '@/services/MarkdownConverter';
import { convertUserArchiveToPostData } from '@/plugin/mobile/UserArchiveConverter';
import type { UserArchive } from '@/services/WorkersAPIClient';
import type { PostData } from '@/types/post';

/**
 * `archived` means WHEN THE USER ARCHIVED IT — not when this vault happened to
 * write the file.
 *
 * Measured before the fix: 84% of a 743-note vault had `archived` more than a
 * week after `published`, because a library sweep stamped every note with the
 * download time. The field was recording the sync, not the archive.
 *
 * Nothing pinned the semantics previously — the only assertions were
 * `expect(archived).toBeDefined()` — which is how it drifted unnoticed.
 */

const SERVER_ARCHIVED_AT = '2026-07-27T03:15:00.000Z';

function serverArchive(overrides: Partial<UserArchive> = {}): UserArchive {
  return {
    id: 'arc_1',
    postId: 'p1',
    platform: 'web',
    originalUrl: 'https://shop.example.com/products/thing',
    title: 'A Thing',
    authorName: 'Some Shop',
    authorUrl: 'https://shop.example.com',
    authorHandle: null,
    authorAvatarUrl: null,
    previewText: 'body',
    fullContent: 'body',
    thumbnailUrl: null,
    archivedAt: SERVER_ARCHIVED_AT,
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    ...overrides,
  } as UserArchive;
}

/** A post the user archived right now, from the plugin — no server date. */
function directArchive(): PostData {
  return {
    platform: 'web',
    id: 'direct',
    url: 'https://example.com/a',
    author: { name: 'Someone', url: 'https://example.com' },
    content: { text: 'body' },
    media: [],
    metadata: { timestamp: new Date('2026-07-01T00:00:00.000Z') },
  } as PostData;
}

function frontmatterArchived(document: string): string | undefined {
  return /^archived:\s*"?(.+?)"?$/m.exec(document)?.[1];
}

describe('UserArchiveConverter — archivedDate', () => {
  it('carries the server archive time onto PostData', () => {
    const post = convertUserArchiveToPostData(serverArchive());

    expect(post.archivedDate?.toISOString()).toBe(SERVER_ARCHIVED_AT);
  });

  it('drops an unparseable server value instead of propagating Invalid Date', () => {
    const post = convertUserArchiveToPostData(serverArchive({ archivedAt: 'not a date' }));

    expect(post.archivedDate).toBeUndefined();
  });
});

describe('FrontmatterGenerator — archived', () => {
  it('writes the server archive time for a synced note, not the write time', () => {
    const post = convertUserArchiveToPostData(serverArchive());
    const result = new MarkdownConverter().convert(post);

    // Formatted `YYYY-MM-DD HH:mm` in local time — SeriesGroupingService compares
    // this field as a raw string, so the shape has to stay uniform.
    const expected = new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(SERVER_ARCHIVED_AT)).replace(',', '');

    expect(frontmatterArchived(result.fullDocument)).toBe(expected);
    expect(result.frontmatter.archived).toBe(expected);
  });

  it('is not the same as lastModified for a synced note', () => {
    // The whole bug was these two being identical on every note.
    const post = convertUserArchiveToPostData(serverArchive());
    const result = new MarkdownConverter().convert(post);

    expect(result.frontmatter.archived).not.toBe(result.frontmatter.lastModified);
  });

  it('still uses now for a direct archive, which genuinely happens now', () => {
    const before = Date.now();
    const result = new MarkdownConverter().convert(directArchive());
    const archived = result.frontmatter.archived;

    expect(archived).toBeDefined();
    // Same minute as the write, i.e. the clock — not the 2026-07-01 publish date.
    expect(archived).toBe(result.frontmatter.lastModified);
    expect(new Date(String(archived)).getTime()).toBeGreaterThanOrEqual(
      new Date(before).setSeconds(0, 0) - 60_000,
    );
  });

  it('keeps published independent of archived', () => {
    const post = convertUserArchiveToPostData(
      serverArchive({ archivedAt: SERVER_ARCHIVED_AT }),
    );
    post.metadata.timestamp = new Date('2026-01-05T00:00:00.000Z');
    const result = new MarkdownConverter().convert(post);

    expect(String(result.frontmatter.published)).toContain('2026-01-05');
    expect(String(result.frontmatter.archived)).toContain('2026-07-2');
  });
});
