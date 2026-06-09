import { describe, expect, it } from 'vitest';
import {
  convertUserArchiveToPostData,
  mapUserArchiveComment,
} from '@/plugin/mobile/UserArchiveConverter';
import type { UserArchive, UserArchiveComment } from '@/services/WorkersAPIClient';

/**
 * Phase 4: UserArchiveConverter must map comment pin metadata and preserve the
 * FULL reply subtree at every depth (recursive), so a depth-≥2 pinned reply
 * survives conversion and can be detected/rendered (PRD R10).
 */

function makeArchive(comments: UserArchiveComment[]): UserArchive {
  return {
    id: 'archive-1',
    userId: 'user-1',
    platform: 'reddit',
    postId: 'p1',
    originalUrl: 'https://www.reddit.com/r/test/comments/p1',
    title: 'Test',
    authorName: 'op',
    authorUrl: 'https://www.reddit.com/user/op',
    authorHandle: 'op',
    authorAvatarUrl: null,
    previewText: null,
    fullContent: null,
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: null,
    postedAt: '2026-06-01T00:00:00.000Z',
    archivedAt: '2026-06-02T00:00:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    metadata: null,
    isLiked: false,
    isBookmarked: false,
    isArchived: false,
    isShared: false,
    comments,
  };
}

describe('mapUserArchiveComment / convertUserArchiveToPostData — comment pin mapping', () => {
  it('maps pinnedAt / pinnedByClientId / updatedAt on a root comment', () => {
    const archive = makeArchive([
      {
        id: 'c1',
        author: { name: 'alice', handle: 'alice' },
        content: 'pinned root',
        pinnedAt: '2026-06-09T04:00:00.000Z',
        pinnedByClientId: 'client-xyz',
        updatedAt: '2026-06-09T04:00:00.000Z',
      },
    ]);

    const post = convertUserArchiveToPostData(archive);
    const comments = post.comments ?? [];

    expect(comments).toHaveLength(1);
    expect(comments[0]?.id).toBe('c1');
    expect(comments[0]?.pinnedAt).toBe('2026-06-09T04:00:00.000Z');
    expect(comments[0]?.pinnedByClientId).toBe('client-xyz');
    expect(comments[0]?.updatedAt).toBe('2026-06-09T04:00:00.000Z');
  });

  it('maps a depth-≥2 pinned reply without flattening the tree', () => {
    const archive = makeArchive([
      {
        id: 'root',
        author: { name: 'op', handle: 'op' },
        content: 'root',
        replies: [
          {
            id: 'r1',
            author: { name: 'bob', handle: 'bob' },
            content: 'depth 1',
            replies: [
              {
                id: 'r2',
                author: { name: 'carol', handle: 'carol' },
                content: 'depth 2 pinned',
                pinnedAt: '2026-06-09T05:00:00.000Z',
              },
            ],
          },
        ],
      },
    ]);

    const post = convertUserArchiveToPostData(archive);
    const root = (post.comments ?? [])[0];

    // Tree is preserved, not flattened.
    expect(root?.id).toBe('root');
    expect(root?.replies).toHaveLength(1);
    const depth1 = root?.replies?.[0];
    expect(depth1?.id).toBe('r1');
    expect(depth1?.pinnedAt).toBeUndefined();
    expect(depth1?.replies).toHaveLength(1);
    const depth2 = depth1?.replies?.[0];
    expect(depth2?.id).toBe('r2');
    expect(depth2?.content).toBe('depth 2 pinned');
    // The pin survived all the way to depth 2.
    expect(depth2?.pinnedAt).toBe('2026-06-09T05:00:00.000Z');
  });

  it('omits pin fields when the server node has none (additive optional)', () => {
    const mapped = mapUserArchiveComment(
      { id: 'c1', author: { name: 'x' }, content: 'no pin' },
      'reddit',
    );
    expect(mapped.pinnedAt).toBeUndefined();
    expect(mapped.pinnedByClientId).toBeUndefined();
    expect(mapped.updatedAt).toBeUndefined();
    expect(mapped.replies).toBeUndefined();
  });

  it('builds an author url from handle when the server url is absent', () => {
    const mapped = mapUserArchiveComment(
      { id: 'c1', author: { name: 'alice', handle: 'alice' }, content: 'hi' },
      'reddit',
    );
    expect(mapped.author.url).toBe('https://www.reddit.com/user/alice');
    expect(mapped.author.handle).toBe('@alice');
  });
});
