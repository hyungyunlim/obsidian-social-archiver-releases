/**
 * AuthorDeduplicator Tests
 *
 * Tests for the deduplication logic, especially the URL/name-based key merge
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AuthorDeduplicator,
  generateAuthorKey,
  normalizeAuthorName,
  normalizeAuthorUrl,
} from '../../services/AuthorDeduplicator';
import type { RawAuthorData } from '../../types/author-catalog';
import type { Platform } from '../../types/post';

describe('AuthorDeduplicator', () => {
  let deduplicator: AuthorDeduplicator;

  beforeEach(() => {
    deduplicator = new AuthorDeduplicator();
  });

  describe('generateAuthorKey', () => {
    it('should generate URL-based key when URL is provided', () => {
      const key = generateAuthorKey(
        'https://x.com/karpathy',
        'Andrej Karpathy',
        'x'
      );
      expect(key).toBe('x:https://x.com/karpathy');
      expect(key).not.toContain(':name:');
    });

    it('should generate name-based key when URL is empty', () => {
      const key = generateAuthorKey('', 'Andrej Karpathy', 'x');
      expect(key).toBe('x:name:andrej karpathy');
    });

    it('should normalize URLs for consistent keys', () => {
      const key1 = generateAuthorKey(
        'https://twitter.com/karpathy',
        'Andrej Karpathy',
        'x'
      );
      const key2 = generateAuthorKey(
        'https://x.com/karpathy',
        'Andrej Karpathy',
        'x'
      );
      // Both should normalize to x.com
      expect(key1).toBe(key2);
    });
  });

  describe('normalizeAuthorName', () => {
    it('should lowercase and trim names', () => {
      expect(normalizeAuthorName('  Andrej Karpathy  ')).toBe('andrej karpathy');
    });

    it('should remove @ prefix', () => {
      expect(normalizeAuthorName('@karpathy')).toBe('karpathy');
    });

    it('should remove parenthetical notes', () => {
      expect(normalizeAuthorName('John Doe (Official)')).toBe('john doe');
    });

    it('should handle empty strings', () => {
      expect(normalizeAuthorName('')).toBe('');
    });
  });

  describe('mergeNameBasedWithUrlBased', () => {
    it('should merge name-based entry into URL-based entry for same author', () => {
      const rawData: RawAuthorData[] = [
        // Old archive without author_url (name-based key)
        {
          filePath: 'archives/old-post.md',
          authorName: 'Andrej Karpathy',
          authorUrl: '', // No URL
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-01-01'),
          sourceType: 'direct',
        },
        {
          filePath: 'archives/old-post-2.md',
          authorName: 'Andrej Karpathy',
          authorUrl: '', // No URL
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-01-15'),
          sourceType: 'direct',
        },
        // New archive with author_url (URL-based key)
        {
          filePath: 'archives/new-post.md',
          authorName: 'Andrej Karpathy',
          authorUrl: 'https://x.com/karpathy',
          platform: 'x',
          avatar: 'https://avatar.com/karpathy.jpg',
          handle: '@karpathy',
          archivedAt: new Date('2024-03-01'),
          sourceType: 'direct',
          followers: 1400000,
          bio: 'AI researcher',
        },
      ];

      const result = deduplicator.deduplicate(rawData);

      // Should be merged into single entry
      expect(result.authors).toHaveLength(1);

      const author = result.authors[0];
      expect(author.authorName).toBe('Andrej Karpathy');
      expect(author.authorUrl).toBe('https://x.com/karpathy');
      expect(author.archiveCount).toBe(3); // 2 old + 1 new
      expect(author.avatar).toBe('https://avatar.com/karpathy.jpg');
      expect(author.handle).toBe('@karpathy');
      expect(author.followers).toBe(1400000);
      expect(author.bio).toBe('AI researcher');
      expect(author.filePaths).toHaveLength(3);
    });

    it('should not merge entries from different platforms', () => {
      const rawData: RawAuthorData[] = [
        {
          filePath: 'archives/x-post.md',
          authorName: 'John Doe',
          authorUrl: '',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-01-01'),
          sourceType: 'direct',
        },
        {
          filePath: 'archives/instagram-post.md',
          authorName: 'John Doe',
          authorUrl: 'https://instagram.com/johndoe',
          platform: 'instagram',
          avatar: 'https://avatar.com/johndoe.jpg',
          handle: '@johndoe',
          archivedAt: new Date('2024-03-01'),
          sourceType: 'direct',
        },
      ];

      const result = deduplicator.deduplicate(rawData);

      // Should NOT be merged - different platforms
      expect(result.authors).toHaveLength(2);
    });

    it('should not merge entries with different names', () => {
      const rawData: RawAuthorData[] = [
        {
          filePath: 'archives/post1.md',
          authorName: 'John Doe',
          authorUrl: '',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-01-01'),
          sourceType: 'direct',
        },
        {
          filePath: 'archives/post2.md',
          authorName: 'Jane Doe',
          authorUrl: 'https://x.com/janedoe',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-03-01'),
          sourceType: 'direct',
        },
      ];

      const result = deduplicator.deduplicate(rawData);

      // Should NOT be merged - different names
      expect(result.authors).toHaveLength(2);
    });

    it('should keep unmerged name-based entries', () => {
      const rawData: RawAuthorData[] = [
        // Name-based entry with no matching URL-based entry
        {
          filePath: 'archives/orphan.md',
          authorName: 'Orphan User',
          authorUrl: '',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-01-01'),
          sourceType: 'direct',
        },
        // URL-based entry with different name
        {
          filePath: 'archives/other.md',
          authorName: 'Other User',
          authorUrl: 'https://x.com/other',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-03-01'),
          sourceType: 'direct',
        },
      ];

      const result = deduplicator.deduplicate(rawData);

      // Both should remain separate
      expect(result.authors).toHaveLength(2);
      expect(result.authors.map((a) => a.authorName)).toContain('Orphan User');
      expect(result.authors.map((a) => a.authorName)).toContain('Other User');
    });

    it('should prefer URL-based metadata over name-based metadata', () => {
      const rawData: RawAuthorData[] = [
        // Name-based with some metadata
        {
          filePath: 'archives/old.md',
          authorName: 'Test User',
          authorUrl: '',
          platform: 'x',
          avatar: 'https://old-avatar.jpg',
          handle: '@oldhandle',
          archivedAt: new Date('2024-01-01'),
          sourceType: 'direct',
          bio: 'Old bio',
        },
        // URL-based with newer metadata
        {
          filePath: 'archives/new.md',
          authorName: 'Test User',
          authorUrl: 'https://x.com/testuser',
          platform: 'x',
          avatar: 'https://new-avatar.jpg',
          handle: '@newhandle',
          archivedAt: new Date('2024-03-01'),
          sourceType: 'direct',
          bio: 'New bio',
          followers: 5000,
        },
      ];

      const result = deduplicator.deduplicate(rawData);

      expect(result.authors).toHaveLength(1);

      const author = result.authors[0];
      // URL-based entry is the target, so its data should be preserved
      expect(author.authorUrl).toBe('https://x.com/testuser');
      expect(author.avatar).toBe('https://new-avatar.jpg');
      expect(author.handle).toBe('@newhandle');
      expect(author.bio).toBe('New bio');
      expect(author.followers).toBe(5000);
      expect(author.archiveCount).toBe(2);
    });

    it('should fill missing metadata from name-based entry', () => {
      const rawData: RawAuthorData[] = [
        // Name-based with some unique metadata
        {
          filePath: 'archives/old.md',
          authorName: 'Test User',
          authorUrl: '',
          platform: 'x',
          avatar: 'https://avatar.jpg',
          handle: '@testhandle',
          archivedAt: new Date('2024-01-01'),
          sourceType: 'direct',
          bio: 'User bio',
        },
        // URL-based missing some metadata
        {
          filePath: 'archives/new.md',
          authorName: 'Test User',
          authorUrl: 'https://x.com/testuser',
          platform: 'x',
          avatar: null, // No avatar
          handle: null, // No handle
          archivedAt: new Date('2024-03-01'),
          sourceType: 'direct',
          // No bio
          followers: 5000,
        },
      ];

      const result = deduplicator.deduplicate(rawData);

      expect(result.authors).toHaveLength(1);

      const author = result.authors[0];
      // URL-based is target, missing fields filled from name-based
      expect(author.authorUrl).toBe('https://x.com/testuser');
      expect(author.avatar).toBe('https://avatar.jpg'); // From name-based
      expect(author.handle).toBe('@testhandle'); // From name-based
      expect(author.bio).toBe('User bio'); // From name-based
      expect(author.followers).toBe(5000); // From URL-based
    });

    it('should merge file paths from both entries', () => {
      const rawData: RawAuthorData[] = [
        {
          filePath: 'archives/old1.md',
          authorName: 'Test User',
          authorUrl: '',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-01-01'),
          sourceType: 'direct',
        },
        {
          filePath: 'archives/old2.md',
          authorName: 'Test User',
          authorUrl: '',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-01-15'),
          sourceType: 'direct',
        },
        {
          filePath: 'archives/new.md',
          authorName: 'Test User',
          authorUrl: 'https://x.com/testuser',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-03-01'),
          sourceType: 'direct',
        },
      ];

      const result = deduplicator.deduplicate(rawData);

      expect(result.authors).toHaveLength(1);
      expect(result.authors[0].filePaths).toHaveLength(3);
      expect(result.authors[0].filePaths).toContain('archives/old1.md');
      expect(result.authors[0].filePaths).toContain('archives/old2.md');
      expect(result.authors[0].filePaths).toContain('archives/new.md');
    });

    it('should use most recent lastSeenAt after merge', () => {
      const oldDate = new Date('2024-01-01');
      const newDate = new Date('2024-03-01');

      const rawData: RawAuthorData[] = [
        {
          filePath: 'archives/old.md',
          authorName: 'Test User',
          authorUrl: '',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: oldDate,
          sourceType: 'direct',
        },
        {
          filePath: 'archives/new.md',
          authorName: 'Test User',
          authorUrl: 'https://x.com/testuser',
          platform: 'x',
          avatar: null,
          handle: null,
          archivedAt: newDate,
          sourceType: 'direct',
        },
      ];

      const result = deduplicator.deduplicate(rawData);

      expect(result.authors).toHaveLength(1);
      expect(result.authors[0].lastSeenAt.getTime()).toBe(newDate.getTime());
    });
  });

  describe('merge method', () => {
    it('should also apply URL/name merge logic', () => {
      const existingAuthors = [
        {
          authorName: 'Test User',
          authorUrl: '',
          platform: 'x' as Platform,
          avatar: null,
          localAvatar: null,
          lastSeenAt: new Date('2024-01-01'),
          archiveCount: 2,
          subscriptionId: null,
          status: 'not_subscribed' as const,
          filePaths: ['old1.md', 'old2.md'],
          followers: null,
          postsCount: null,
          bio: null,
        },
      ];

      const newData: RawAuthorData[] = [
        {
          filePath: 'new.md',
          authorName: 'Test User',
          authorUrl: 'https://x.com/testuser',
          platform: 'x',
          avatar: 'https://avatar.jpg',
          handle: '@testuser',
          archivedAt: new Date('2024-03-01'),
          sourceType: 'direct',
          followers: 1000,
        },
      ];

      const result = deduplicator.merge(existingAuthors, newData);

      // Should merge into single entry
      expect(result).toHaveLength(1);
      expect(result[0].authorUrl).toBe('https://x.com/testuser');
      expect(result[0].archiveCount).toBe(3); // 2 + 1
      expect(result[0].avatar).toBe('https://avatar.jpg');
      expect(result[0].followers).toBe(1000);
    });
  });

  describe('normalizeAuthorUrl for GitHub Pages / Jekyll blogs', () => {
    it('should normalize GitHub Pages user site URL (strip post path)', () => {
      const result = normalizeAuthorUrl(
        'https://hyungyunlim.github.io/2024/07/15/my-post-title',
        'blog'
      );
      expect(result.url).toBe('https://hyungyunlim.github.io');
      expect(result.handle).toBe('hyungyunlim');
    });

    it('should normalize GitHub Pages user site URL (no path)', () => {
      const result = normalizeAuthorUrl(
        'https://hyungyunlim.github.io',
        'blog'
      );
      expect(result.url).toBe('https://hyungyunlim.github.io');
      expect(result.handle).toBe('hyungyunlim');
    });

    it('should normalize GitHub Pages project site URL (keep repo name)', () => {
      const result = normalizeAuthorUrl(
        'https://username.github.io/my-project/2024/01/01/post-title',
        'blog'
      );
      expect(result.url).toBe('https://username.github.io/my-project');
      expect(result.handle).toBe('username');
    });

    it('should normalize GitHub Pages project site URL (strip nested post path)', () => {
      const result = normalizeAuthorUrl(
        'https://username.github.io/blog-repo/posts/article',
        'blog'
      );
      expect(result.url).toBe('https://username.github.io/blog-repo');
      expect(result.handle).toBe('username');
    });

    it('should strip common Jekyll paths like /feed.xml', () => {
      const result = normalizeAuthorUrl(
        'https://username.github.io/feed.xml',
        'blog'
      );
      expect(result.url).toBe('https://username.github.io');
      expect(result.handle).toBe('username');
    });

    it('should strip /about, /archive, etc from user site', () => {
      const aboutResult = normalizeAuthorUrl(
        'https://username.github.io/about',
        'blog'
      );
      expect(aboutResult.url).toBe('https://username.github.io');

      const archiveResult = normalizeAuthorUrl(
        'https://username.github.io/archives',
        'blog'
      );
      expect(archiveResult.url).toBe('https://username.github.io');
    });

    it('should deduplicate posts from same GitHub Pages blog', () => {
      const rawData: RawAuthorData[] = [
        {
          filePath: 'archives/post1.md',
          authorName: 'Jun Lim',
          authorUrl: 'https://hyungyunlim.github.io/2024/07/15/first-post',
          platform: 'blog',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-07-15'),
          sourceType: 'direct',
        },
        {
          filePath: 'archives/post2.md',
          authorName: 'Jun Lim',
          authorUrl: 'https://hyungyunlim.github.io/2024/08/20/second-post',
          platform: 'blog',
          avatar: null,
          handle: null,
          archivedAt: new Date('2024-08-20'),
          sourceType: 'direct',
        },
      ];

      const result = deduplicator.deduplicate(rawData);

      // Should be merged into single entry (key is normalized, but authorUrl keeps first URL)
      expect(result.authors).toHaveLength(1);
      expect(result.authors[0].archiveCount).toBe(2);
      // The key is normalized for deduplication, but authorUrl is kept as-is from first entry
      expect(result.authors[0].authorUrl).toContain('hyungyunlim.github.io');
    });

    it('should generate same key for different posts from same GitHub Pages blog', () => {
      const key1 = generateAuthorKey(
        'https://hyungyunlim.github.io/2024/07/15/first-post',
        'Jun Lim',
        'blog'
      );
      const key2 = generateAuthorKey(
        'https://hyungyunlim.github.io/2024/08/20/second-post',
        'Jun Lim',
        'blog'
      );
      // Both should normalize to same key
      expect(key1).toBe(key2);
      expect(key1).toContain('hyungyunlim.github.io');
    });
  });
});
