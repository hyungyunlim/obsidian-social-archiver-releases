import { afterEach, describe, expect, it } from 'vitest';
import { __setLanguageForTests } from '../../../i18n';
import { formatCollectionActivity } from '../../../plugin/collections/CollectionActivityNotifier';
import { shareIdFromUrl } from '../../../utils/shareUrl';

describe('formatCollectionActivity', () => {
  afterEach(() => __setLanguageForTests(null));

  const base = { actors: ['bob'], actorCount: 1, count: 1 } as const;

  it('words added posts like the apps (prd-collections-collaboration §10.5)', () => {
    __setLanguageForTests('en');
    expect(formatCollectionActivity({ ...base, kind: 'items_added' })).toBe('@bob added a post');
    expect(formatCollectionActivity({ ...base, kind: 'items_added', count: 3 })).toBe('@bob added 3 posts');
    expect(formatCollectionActivity({ kind: 'items_added', actors: ['bob', 'carol'], actorCount: 2, count: 4 })).toBe('@bob and 1 other added 4 posts');
    expect(formatCollectionActivity({ kind: 'items_added', actors: ['bob', 'carol', 'dan'], actorCount: 5, count: 9 })).toBe('@bob and 4 others added 9 posts');
  });

  it('words joins and shares', () => {
    __setLanguageForTests('en');
    expect(formatCollectionActivity({ ...base, kind: 'member_joined' })).toBe('@bob joined');
    expect(formatCollectionActivity({ ...base, kind: 'collection_shared', visibility: 'public' })).toBe('@bob made this collection public');
    expect(formatCollectionActivity({ ...base, kind: 'collection_shared', visibility: 'unlisted' })).toBe('@bob shared this collection with anyone who has the link');
  });

  it('speaks Korean', () => {
    __setLanguageForTests('ko');
    expect(formatCollectionActivity({ ...base, kind: 'items_added', count: 2 })).toBe('@bob님이 게시물 2개를 추가했습니다');
    expect(formatCollectionActivity({ kind: 'member_joined', actors: ['bob', 'carol', 'dan'], actorCount: 3, count: 1 })).toBe('@bob님 외 2명이 참여했습니다');
  });
});

describe('shareIdFromUrl', () => {
  it('takes the last path segment, ignoring a #reader fragment', () => {
    expect(shareIdFromUrl('https://social-archive.org/alice/abc123')).toBe('abc123');
    expect(shareIdFromUrl('https://social-archive.org/alice/abc123#reader')).toBe('abc123');
    expect(shareIdFromUrl('not a url')).toBeNull();
  });
});
