import { describe, expect, it } from 'vitest';
import {
  getPinnedSortTimestamp,
  sortPinnedCommentRoots,
  findCommentById,
  findCommentPath,
} from '@/utils/comments';
import type { Comment } from '@/types/post';

function c(id: string, extra: Partial<Comment> = {}): Comment {
  return { id, author: { name: id, url: '' }, content: id, ...extra };
}

describe('getPinnedSortTimestamp', () => {
  it('returns null for an unpinned thread', () => {
    expect(getPinnedSortTimestamp(c('a', { replies: [c('b')] }))).toBeNull();
  });

  it('returns the newest pinnedAt found anywhere in the thread (including deep replies)', () => {
    const thread = c('root', {
      pinnedAt: '2026-06-01T00:00:00.000Z',
      replies: [
        c('r1', {
          replies: [c('r2', { pinnedAt: '2026-06-09T00:00:00.000Z' })],
        }),
      ],
    });
    expect(getPinnedSortTimestamp(thread)).toBe('2026-06-09T00:00:00.000Z');
  });

  it('ignores invalid pinnedAt values', () => {
    expect(getPinnedSortTimestamp(c('a', { pinnedAt: 'not-a-date' }))).toBeNull();
  });
});

describe('sortPinnedCommentRoots', () => {
  it('places pinned roots above unpinned roots, newest pin first', () => {
    const comments: Comment[] = [
      c('u1'),
      c('p-old', { pinnedAt: '2026-06-01T00:00:00.000Z' }),
      c('u2'),
      c('p-new', { pinnedAt: '2026-06-09T00:00:00.000Z' }),
    ];
    const sorted = sortPinnedCommentRoots(comments);
    expect(sorted.map((x) => x.id)).toEqual(['p-new', 'p-old', 'u1', 'u2']);
  });

  it('keeps unpinned roots in stable original order', () => {
    const comments: Comment[] = [c('a'), c('b'), c('c')];
    expect(sortPinnedCommentRoots(comments).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('promotes a root whose only pin is on a deep reply', () => {
    const comments: Comment[] = [
      c('plain'),
      c('haspin', {
        replies: [c('reply', { pinnedAt: '2026-06-09T00:00:00.000Z' })],
      }),
    ];
    expect(sortPinnedCommentRoots(comments).map((x) => x.id)).toEqual(['haspin', 'plain']);
  });

  it('does not mutate the input array', () => {
    const comments: Comment[] = [c('u'), c('p', { pinnedAt: '2026-06-09T00:00:00.000Z' })];
    const snapshot = comments.map((x) => x.id);
    sortPinnedCommentRoots(comments);
    expect(comments.map((x) => x.id)).toEqual(snapshot);
  });
});

describe('findCommentById / findCommentPath', () => {
  const tree: Comment[] = [
    c('root', {
      replies: [c('r1', { replies: [c('r2')] })],
    }),
  ];

  it('finds a node anywhere in the tree', () => {
    expect(findCommentById(tree, 'r2')?.id).toBe('r2');
    expect(findCommentById(tree, 'nope')).toBeNull();
  });

  it('returns the ancestor chain for a deep reply', () => {
    const path = findCommentPath(tree, 'r2');
    expect(path?.map((x) => x.id)).toEqual(['root', 'r1', 'r2']);
    expect(findCommentPath(tree, 'nope')).toBeNull();
  });
});
