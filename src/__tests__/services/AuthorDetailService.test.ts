/**
 * AuthorDetailService Tests
 *
 * Tests for author lookup, post matching (filePaths primary + authorName fallback),
 * sorting, filtering, text search, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  AuthorDetailService,
  type AuthorDetailFilter,
  DEFAULT_AUTHOR_DETAIL_FILTER,
} from '../../services/AuthorDetailService';
import {
  createAuthorCatalogStore,
  type AuthorCatalogStoreAPI,
} from '../../services/AuthorCatalogStore';
import type { AuthorCatalogEntry } from '../../types/author-catalog';
import type { PostIndexEntry } from '../../services/PostIndexService';
import type { Platform } from '../../types/post';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Minimal PostIndexService stub that returns configurable entries.
 * Only implements the methods used by AuthorDetailService.
 */
function createMockPostIndexService(entries: PostIndexEntry[]) {
  return {
    getEntriesArray: () => entries,
    getEntries: () => {
      const map: Record<string, PostIndexEntry> = {};
      for (const e of entries) {
        map[e.filePath] = e;
      }
      return map;
    },
    getEntry: (filePath: string) => entries.find((e) => e.filePath === filePath),
    // Stub remaining methods (not used by AuthorDetailService)
    load: async () => true,
    scheduleSave: () => {},
    flush: async () => {},
    setEntry: () => {},
    removeEntry: () => {},
    renameEntry: () => {},
    diffWithVault: () => ({ toParse: [], toRemove: [] }),
    clear: () => {},
    get size() { return entries.length; },
  } as unknown as import('../../services/PostIndexService').PostIndexService;
}

function createAuthor(overrides: Partial<AuthorCatalogEntry> = {}): AuthorCatalogEntry {
  return {
    authorName: 'John Doe',
    authorUrl: 'https://x.com/johndoe',
    platform: 'x' as Platform,
    avatar: null,
    lastSeenAt: new Date('2026-01-15'),
    archiveCount: 3,
    subscriptionId: null,
    status: 'not_subscribed',
    filePaths: [],
    ...overrides,
  };
}

function createPostEntry(overrides: Partial<PostIndexEntry> = {}): PostIndexEntry {
  const defaults: PostIndexEntry = {
    id: 'post-1',
    platform: 'x' as Platform,
    filePath: 'Social Archives/X/2026/01/post-1.md',
    fileModifiedTime: Date.now(),
    authorName: 'John Doe',
    publishedDate: new Date('2026-01-15').getTime(),
    archivedDate: new Date('2026-01-15').getTime(),
    tags: [],
    hashtags: [],
    like: false,
    archive: false,
    subscribed: false,
    searchText: 'john doe x post content',
    url: 'https://x.com/johndoe/status/123',
    mediaCount: 0,
    commentCount: 0,
    metadataTimestamp: Date.now(),
  };
  return { ...defaults, ...overrides };
}

// ============================================================================
// Tests
// ============================================================================

describe('AuthorDetailService', () => {
  let store: AuthorCatalogStoreAPI;
  let service: AuthorDetailService;

  // Default test entries
  const postEntries: PostIndexEntry[] = [
    createPostEntry({
      id: 'post-1',
      filePath: 'Social Archives/X/2026/01/post-1.md',
      authorName: 'John Doe',
      platform: 'x',
      publishedDate: new Date('2026-01-10').getTime(),
      title: 'Beta post',
      tags: ['tech', 'news'],
      like: true,
      searchText: 'john doe x beta post about technology',
    }),
    createPostEntry({
      id: 'post-2',
      filePath: 'Social Archives/X/2026/01/post-2.md',
      authorName: 'John Doe',
      platform: 'x',
      publishedDate: new Date('2026-01-15').getTime(),
      title: 'Alpha post',
      tags: ['personal'],
      like: false,
      searchText: 'john doe x alpha post about personal life',
    }),
    createPostEntry({
      id: 'post-3',
      filePath: 'Social Archives/X/2026/02/post-3.md',
      authorName: 'John Doe',
      platform: 'x',
      publishedDate: new Date('2026-02-01').getTime(),
      title: 'Charlie post',
      tags: ['tech'],
      like: true,
      searchText: 'john doe x charlie post about software development',
    }),
    // Different author
    createPostEntry({
      id: 'post-4',
      filePath: 'Social Archives/Instagram/2026/01/post-4.md',
      authorName: 'Jane Smith',
      platform: 'instagram',
      publishedDate: new Date('2026-01-20').getTime(),
      title: 'Instagram post',
      tags: [],
      like: false,
      searchText: 'jane smith instagram vacation photo',
    }),
    // Same author name but different platform
    createPostEntry({
      id: 'post-5',
      filePath: 'Social Archives/Facebook/2026/01/post-5.md',
      authorName: 'John Doe',
      platform: 'facebook',
      publishedDate: new Date('2026-01-25').getTime(),
      title: 'Facebook post',
      tags: [],
      like: false,
      searchText: 'john doe facebook post about cooking',
    }),
  ];

  beforeEach(() => {
    store = createAuthorCatalogStore();
    const mockPostIndex = createMockPostIndexService(postEntries);
    service = new AuthorDetailService(store, mockPostIndex);
  });

  // ==========================================================================
  // findAuthor
  // ==========================================================================

  describe('findAuthor', () => {
    it('should find author by authorUrl and platform', () => {
      const author = createAuthor();
      store.setAuthors([author]);

      const found = service.findAuthor('https://x.com/johndoe', 'x');
      expect(found).toBeDefined();
      expect(found?.authorName).toBe('John Doe');
      expect(found?.platform).toBe('x');
    });

    it('should return undefined when author is not found', () => {
      store.setAuthors([createAuthor()]);

      const found = service.findAuthor('https://x.com/nonexistent', 'x');
      expect(found).toBeUndefined();
    });

    it('should not match when platform differs', () => {
      store.setAuthors([createAuthor({ platform: 'x' })]);

      const found = service.findAuthor('https://x.com/johndoe', 'instagram');
      expect(found).toBeUndefined();
    });

    it('should not match when authorUrl differs', () => {
      store.setAuthors([createAuthor({ authorUrl: 'https://x.com/johndoe' })]);

      const found = service.findAuthor('https://x.com/janedoe', 'x');
      expect(found).toBeUndefined();
    });

    it('should find correct author among multiple authors', () => {
      store.setAuthors([
        createAuthor({ authorUrl: 'https://x.com/alice', authorName: 'Alice', platform: 'x' }),
        createAuthor({ authorUrl: 'https://x.com/bob', authorName: 'Bob', platform: 'x' }),
        createAuthor({ authorUrl: 'https://instagram.com/alice', authorName: 'Alice', platform: 'instagram' }),
      ]);

      const found = service.findAuthor('https://x.com/bob', 'x');
      expect(found?.authorName).toBe('Bob');
    });

    it('should return undefined when store is empty', () => {
      const found = service.findAuthor('https://x.com/johndoe', 'x');
      expect(found).toBeUndefined();
    });
  });

  // ==========================================================================
  // getPostsForAuthor - filePaths primary matching
  // ==========================================================================

  describe('getPostsForAuthor - filePaths primary matching', () => {
    it('should match posts via filePaths when available', () => {
      const author = createAuthor({
        filePaths: [
          'Social Archives/X/2026/01/post-1.md',
          'Social Archives/X/2026/01/post-2.md',
        ],
      });

      const posts = service.getPostsForAuthor(author);
      expect(posts).toHaveLength(2);
      expect(posts.map((p) => p.id)).toEqual(expect.arrayContaining(['post-1', 'post-2']));
    });

    it('should not include posts from other authors when using filePaths', () => {
      const author = createAuthor({
        filePaths: ['Social Archives/X/2026/01/post-1.md'],
      });

      const posts = service.getPostsForAuthor(author);
      expect(posts).toHaveLength(1);
      expect(posts[0]?.id).toBe('post-1');
    });

    it('should use filePaths even when authorName matches other posts', () => {
      // Author has filePaths pointing to only post-1, even though post-2/post-3
      // also have authorName 'John Doe' on platform 'x'
      const author = createAuthor({
        authorName: 'John Doe',
        platform: 'x',
        filePaths: ['Social Archives/X/2026/01/post-1.md'],
      });

      const posts = service.getPostsForAuthor(author);
      expect(posts).toHaveLength(1);
      expect(posts[0]?.id).toBe('post-1');
    });
  });

  // ==========================================================================
  // getPostsForAuthor - authorName + platform fallback
  // ==========================================================================

  describe('getPostsForAuthor - authorName + platform fallback', () => {
    it('should fallback to authorName + platform when filePaths is empty', () => {
      const author = createAuthor({
        authorName: 'John Doe',
        platform: 'x',
        filePaths: [],
      });

      const posts = service.getPostsForAuthor(author);
      // Should match post-1, post-2, post-3 (all John Doe on x)
      // Should NOT match post-5 (John Doe on facebook)
      expect(posts).toHaveLength(3);
      const ids = posts.map((p) => p.id);
      expect(ids).toContain('post-1');
      expect(ids).toContain('post-2');
      expect(ids).toContain('post-3');
      expect(ids).not.toContain('post-5');
    });

    it('should fallback to authorName + platform when filePaths is undefined', () => {
      const author = createAuthor({
        authorName: 'John Doe',
        platform: 'x',
        filePaths: undefined,
      });

      const posts = service.getPostsForAuthor(author);
      expect(posts).toHaveLength(3);
    });

    it('should fallback when filePaths contains no matching entries in index', () => {
      // filePaths point to files that don't exist in the index (stale paths)
      const author = createAuthor({
        authorName: 'John Doe',
        platform: 'x',
        filePaths: ['Social Archives/X/deleted/old-post.md'],
      });

      const posts = service.getPostsForAuthor(author);
      // Falls back to authorName + platform match
      expect(posts).toHaveLength(3);
    });

    it('should not match posts from different platform in fallback mode', () => {
      const author = createAuthor({
        authorName: 'John Doe',
        platform: 'facebook',
        filePaths: [],
      });

      const posts = service.getPostsForAuthor(author);
      // Only matches post-5 (John Doe on facebook)
      expect(posts).toHaveLength(1);
      expect(posts[0]?.id).toBe('post-5');
    });

    it('should return empty array when no matches in fallback mode', () => {
      const author = createAuthor({
        authorName: 'Nobody',
        platform: 'x',
        filePaths: [],
      });

      const posts = service.getPostsForAuthor(author);
      expect(posts).toHaveLength(0);
    });
  });

  // ==========================================================================
  // sortPosts
  // ==========================================================================

  describe('sortPosts', () => {
    const unsortedPosts = [
      createPostEntry({ id: 'a', publishedDate: new Date('2026-01-10').getTime(), title: 'Beta' }),
      createPostEntry({ id: 'b', publishedDate: new Date('2026-02-01').getTime(), title: 'Alpha' }),
      createPostEntry({ id: 'c', publishedDate: new Date('2026-01-20').getTime(), title: 'Charlie' }),
    ];

    it('should sort by newest first (publishedDate descending)', () => {
      const sorted = service.sortPosts(unsortedPosts, 'newest');
      expect(sorted.map((p) => p.id)).toEqual(['b', 'c', 'a']);
    });

    it('should sort by oldest first (publishedDate ascending)', () => {
      const sorted = service.sortPosts(unsortedPosts, 'oldest');
      expect(sorted.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    });

    it('should sort by title alphabetically', () => {
      const sorted = service.sortPosts(unsortedPosts, 'title');
      expect(sorted.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    });

    it('should not mutate the original array', () => {
      const original = [...unsortedPosts];
      service.sortPosts(unsortedPosts, 'newest');
      expect(unsortedPosts.map((p) => p.id)).toEqual(original.map((p) => p.id));
    });

    it('should use archivedDate as fallback when publishedDate is undefined', () => {
      const posts = [
        createPostEntry({ id: 'a', publishedDate: undefined, archivedDate: new Date('2026-03-01').getTime() }),
        createPostEntry({ id: 'b', publishedDate: undefined, archivedDate: new Date('2026-01-01').getTime() }),
      ];

      const sorted = service.sortPosts(posts, 'newest');
      expect(sorted.map((p) => p.id)).toEqual(['a', 'b']);
    });

    it('should handle posts with undefined titles in title sort', () => {
      const posts = [
        createPostEntry({ id: 'a', title: undefined }),
        createPostEntry({ id: 'b', title: 'Zeta' }),
        createPostEntry({ id: 'c', title: 'Alpha' }),
      ];

      const sorted = service.sortPosts(posts, 'title');
      // Empty string sorts before letters
      expect(sorted[0]?.id).toBe('a');
      expect(sorted[1]?.id).toBe('c');
      expect(sorted[2]?.id).toBe('b');
    });

    it('should handle empty array', () => {
      const sorted = service.sortPosts([], 'newest');
      expect(sorted).toEqual([]);
    });
  });

  // ==========================================================================
  // filterPosts
  // ==========================================================================

  describe('filterPosts', () => {
    it('should filter by tag', () => {
      const author = createAuthor({
        filePaths: [
          'Social Archives/X/2026/01/post-1.md',
          'Social Archives/X/2026/01/post-2.md',
          'Social Archives/X/2026/02/post-3.md',
        ],
      });
      const posts = service.getPostsForAuthor(author);

      const filtered = service.filterPosts(posts, {
        ...DEFAULT_AUTHOR_DETAIL_FILTER,
        tag: 'tech',
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map((p) => p.id)).toEqual(expect.arrayContaining(['post-1', 'post-3']));
    });

    it('should filter by tag case-insensitively', () => {
      const posts = [
        createPostEntry({ id: 'a', tags: ['Tech'] }),
        createPostEntry({ id: 'b', tags: ['personal'] }),
      ];

      const filtered = service.filterPosts(posts, {
        ...DEFAULT_AUTHOR_DETAIL_FILTER,
        tag: 'tech',
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.id).toBe('a');
    });

    it('should filter by liked only', () => {
      const author = createAuthor({
        filePaths: [
          'Social Archives/X/2026/01/post-1.md',
          'Social Archives/X/2026/01/post-2.md',
          'Social Archives/X/2026/02/post-3.md',
        ],
      });
      const posts = service.getPostsForAuthor(author);

      const filtered = service.filterPosts(posts, {
        ...DEFAULT_AUTHOR_DETAIL_FILTER,
        likedOnly: true,
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map((p) => p.id)).toEqual(expect.arrayContaining(['post-1', 'post-3']));
    });

    it('should filter by text search', () => {
      const author = createAuthor({
        filePaths: [
          'Social Archives/X/2026/01/post-1.md',
          'Social Archives/X/2026/01/post-2.md',
          'Social Archives/X/2026/02/post-3.md',
        ],
      });
      const posts = service.getPostsForAuthor(author);

      const filtered = service.filterPosts(posts, {
        ...DEFAULT_AUTHOR_DETAIL_FILTER,
        searchQuery: 'technology',
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.id).toBe('post-1');
    });

    it('should support case-insensitive text search', () => {
      const posts = [
        createPostEntry({ id: 'a', searchText: 'UPPERCASE content here' }),
        createPostEntry({ id: 'b', searchText: 'lowercase content here' }),
      ];

      const filtered = service.filterPosts(posts, {
        ...DEFAULT_AUTHOR_DETAIL_FILTER,
        searchQuery: 'CONTENT',
      });

      expect(filtered).toHaveLength(2);
    });

    it('should combine multiple filters', () => {
      const author = createAuthor({
        filePaths: [
          'Social Archives/X/2026/01/post-1.md',
          'Social Archives/X/2026/01/post-2.md',
          'Social Archives/X/2026/02/post-3.md',
        ],
      });
      const posts = service.getPostsForAuthor(author);

      // tech tag + liked only
      const filtered = service.filterPosts(posts, {
        tag: 'tech',
        likedOnly: true,
        searchQuery: '',
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map((p) => p.id)).toEqual(expect.arrayContaining(['post-1', 'post-3']));
    });

    it('should return all posts when no filters are active', () => {
      const posts = [
        createPostEntry({ id: 'a' }),
        createPostEntry({ id: 'b' }),
      ];

      const filtered = service.filterPosts(posts, DEFAULT_AUTHOR_DETAIL_FILTER);
      expect(filtered).toHaveLength(2);
    });

    it('should return empty array when no posts match filters', () => {
      const posts = [
        createPostEntry({ id: 'a', tags: ['tech'], like: false }),
      ];

      const filtered = service.filterPosts(posts, {
        ...DEFAULT_AUTHOR_DETAIL_FILTER,
        likedOnly: true,
      });

      expect(filtered).toHaveLength(0);
    });

    it('should handle empty input array', () => {
      const filtered = service.filterPosts([], {
        tag: 'tech',
        likedOnly: true,
        searchQuery: 'test',
      });

      expect(filtered).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getFilteredSortedPosts (combined pipeline)
  // ==========================================================================

  describe('getFilteredSortedPosts', () => {
    it('should combine matching, filtering, and sorting', () => {
      const author = createAuthor({
        authorName: 'John Doe',
        platform: 'x',
        filePaths: [
          'Social Archives/X/2026/01/post-1.md',
          'Social Archives/X/2026/01/post-2.md',
          'Social Archives/X/2026/02/post-3.md',
        ],
      });
      store.setAuthors([author]);

      const result = service.getFilteredSortedPosts(
        author,
        { tag: 'tech', likedOnly: false, searchQuery: '' },
        'newest'
      );

      // post-1 (tech, Jan 10) and post-3 (tech, Feb 1), sorted newest first
      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('post-3');
      expect(result[1]?.id).toBe('post-1');
    });

    it('should return empty array for author with no posts', () => {
      const author = createAuthor({
        authorName: 'Nobody',
        platform: 'x',
        filePaths: [],
      });

      const result = service.getFilteredSortedPosts(
        author,
        DEFAULT_AUTHOR_DETAIL_FILTER,
        'newest'
      );

      expect(result).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getUniqueTags
  // ==========================================================================

  describe('getUniqueTags', () => {
    it('should extract unique tags sorted alphabetically', () => {
      const posts = [
        createPostEntry({ tags: ['tech', 'news'] }),
        createPostEntry({ tags: ['tech', 'personal'] }),
        createPostEntry({ tags: ['news'] }),
      ];

      const tags = service.getUniqueTags(posts);
      expect(tags).toEqual(['news', 'personal', 'tech']);
    });

    it('should return empty array when no posts have tags', () => {
      const posts = [
        createPostEntry({ tags: [] }),
        createPostEntry({ tags: [] }),
      ];

      const tags = service.getUniqueTags(posts);
      expect(tags).toEqual([]);
    });

    it('should return empty array for empty post list', () => {
      const tags = service.getUniqueTags([]);
      expect(tags).toEqual([]);
    });
  });

  // ==========================================================================
  // Empty / Edge Cases
  // ==========================================================================

  describe('empty and edge cases', () => {
    it('should handle service with empty post index', () => {
      const emptyService = new AuthorDetailService(
        store,
        createMockPostIndexService([])
      );

      const author = createAuthor({ filePaths: ['some/path.md'] });
      const posts = emptyService.getPostsForAuthor(author);
      expect(posts).toHaveLength(0);
    });

    it('should handle author with both filePaths and fallback returning same posts', () => {
      // When filePaths matches successfully, fallback should not be used
      const author = createAuthor({
        authorName: 'John Doe',
        platform: 'x',
        filePaths: [
          'Social Archives/X/2026/01/post-1.md',
          'Social Archives/X/2026/01/post-2.md',
          'Social Archives/X/2026/02/post-3.md',
        ],
      });

      const posts = service.getPostsForAuthor(author);
      expect(posts).toHaveLength(3);
    });

    it('should handle DEFAULT_AUTHOR_DETAIL_FILTER constant values', () => {
      expect(DEFAULT_AUTHOR_DETAIL_FILTER.tag).toBe('');
      expect(DEFAULT_AUTHOR_DETAIL_FILTER.likedOnly).toBe(false);
      expect(DEFAULT_AUTHOR_DETAIL_FILTER.searchQuery).toBe('');
    });
  });
});
