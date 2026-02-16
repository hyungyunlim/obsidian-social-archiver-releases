/**
 * AuthorCatalogStore Tests
 *
 * Tests for the updateAuthorMetadata method and related functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  createAuthorCatalogStore,
  type AuthorCatalogStoreAPI,
  type AuthorMetadataUpdate,
} from '../../services/AuthorCatalogStore';
import type { AuthorCatalogEntry } from '../../types/author-catalog';
import type { Platform } from '../../types/post';

describe('AuthorCatalogStore', () => {
  let store: AuthorCatalogStoreAPI;

  beforeEach(() => {
    store = createAuthorCatalogStore();
  });

  describe('updateAuthorMetadata', () => {
    describe('new author creation', () => {
      it('should create a new author entry when author does not exist', () => {
        const metadata: AuthorMetadataUpdate = {
          authorName: 'John Doe',
          avatarUrl: 'https://example.com/avatar.jpg',
          handle: '@johndoe',
          followers: 1000,
          postsCount: 50,
          bio: 'Software developer',
          verified: true,
        };

        store.updateAuthorMetadata(
          'https://twitter.com/johndoe',
          'x',
          metadata,
          'attachments/authors/x-johndoe.jpg'
        );

        const state = get(store.state);
        expect(state.authors).toHaveLength(1);

        const author = state.authors[0];
        expect(author.authorName).toBe('John Doe');
        expect(author.authorUrl).toBe('https://twitter.com/johndoe');
        expect(author.platform).toBe('x');
        expect(author.avatar).toBe('https://example.com/avatar.jpg');
        expect(author.localAvatar).toBe('attachments/authors/x-johndoe.jpg');
        expect(author.followers).toBe(1000);
        expect(author.postsCount).toBe(50);
        expect(author.bio).toBe('Software developer');
        expect(author.handle).toBe('@johndoe');
        expect(author.archiveCount).toBe(1);
        expect(author.status).toBe('not_subscribed');
        expect(author.subscriptionId).toBeNull();
        expect(author.lastSeenAt).toBeInstanceOf(Date);
        expect(author.lastMetadataUpdate).toBeInstanceOf(Date);
      });

      it('should create author with default name when authorName is not provided', () => {
        const metadata: AuthorMetadataUpdate = {
          followers: 500,
        };

        store.updateAuthorMetadata(
          'https://instagram.com/unknown',
          'instagram',
          metadata
        );

        const state = get(store.state);
        expect(state.authors[0].authorName).toBe('Unknown');
      });

      it('should handle null localAvatarPath', () => {
        const metadata: AuthorMetadataUpdate = {
          authorName: 'Jane Doe',
          avatarUrl: 'https://example.com/jane.jpg',
        };

        store.updateAuthorMetadata(
          'https://facebook.com/janedoe',
          'facebook',
          metadata,
          null
        );

        const state = get(store.state);
        expect(state.authors[0].localAvatar).toBeNull();
      });

      it('should handle undefined localAvatarPath', () => {
        const metadata: AuthorMetadataUpdate = {
          authorName: 'Test User',
        };

        store.updateAuthorMetadata(
          'https://tiktok.com/@testuser',
          'tiktok',
          metadata
        );

        const state = get(store.state);
        expect(state.authors[0].localAvatar).toBeNull();
      });
    });

    describe('existing author update', () => {
      const existingAuthor: AuthorCatalogEntry = {
        authorName: 'Existing User',
        authorUrl: 'https://twitter.com/existing',
        platform: 'x' as Platform,
        avatar: 'https://old-avatar.com/img.jpg',
        localAvatar: 'attachments/authors/x-existing.jpg',
        followers: 500,
        postsCount: 25,
        bio: 'Old bio',
        lastSeenAt: new Date('2024-01-01'),
        lastMetadataUpdate: new Date('2024-01-01'),
        archiveCount: 5,
        subscriptionId: null,
        status: 'not_subscribed',
        handle: '@existing',
      };

      beforeEach(() => {
        store.setAuthors([existingAuthor]);
      });

      it('should increment archiveCount when updating existing author', () => {
        store.updateAuthorMetadata(
          'https://twitter.com/existing',
          'x',
          { authorName: 'Updated Name' }
        );

        const state = get(store.state);
        expect(state.authors[0].archiveCount).toBe(6);
      });

      it('should update lastSeenAt when updating existing author', () => {
        const beforeUpdate = new Date();

        store.updateAuthorMetadata(
          'https://twitter.com/existing',
          'x',
          { authorName: 'Updated Name' }
        );

        const state = get(store.state);
        expect(state.authors[0].lastSeenAt.getTime()).toBeGreaterThanOrEqual(
          beforeUpdate.getTime()
        );
      });

      it('should update metadata when timestamp is newer', () => {
        const metadata: AuthorMetadataUpdate = {
          authorName: 'Updated Name',
          avatarUrl: 'https://new-avatar.com/img.jpg',
          followers: 1500,
          postsCount: 100,
          bio: 'New bio',
          handle: '@updated',
        };

        store.updateAuthorMetadata(
          'https://twitter.com/existing',
          'x',
          metadata,
          'attachments/authors/x-updated.jpg'
        );

        const state = get(store.state);
        const author = state.authors[0];

        expect(author.authorName).toBe('Updated Name');
        expect(author.avatar).toBe('https://new-avatar.com/img.jpg');
        expect(author.localAvatar).toBe('attachments/authors/x-updated.jpg');
        expect(author.followers).toBe(1500);
        expect(author.postsCount).toBe(100);
        expect(author.bio).toBe('New bio');
        expect(author.handle).toBe('@updated');
      });

      it('should preserve existing values when new metadata is null', () => {
        const metadata: AuthorMetadataUpdate = {
          authorName: 'Updated Name',
          followers: null,
          postsCount: null,
          bio: null,
        };

        store.updateAuthorMetadata(
          'https://twitter.com/existing',
          'x',
          metadata
        );

        const state = get(store.state);
        const author = state.authors[0];

        expect(author.authorName).toBe('Updated Name');
        expect(author.followers).toBe(500); // Preserved
        expect(author.postsCount).toBe(25); // Preserved
        expect(author.bio).toBe('Old bio'); // Preserved
      });

      it('should preserve localAvatar when null is passed', () => {
        store.updateAuthorMetadata(
          'https://twitter.com/existing',
          'x',
          { authorName: 'Updated' },
          null
        );

        const state = get(store.state);
        expect(state.authors[0].localAvatar).toBe('attachments/authors/x-existing.jpg');
      });

      it('should preserve subscription status when updating metadata', () => {
        // First set author as subscribed
        store.updateAuthorStatus(
          'https://twitter.com/existing',
          'x',
          'subscribed',
          'sub-123'
        );

        // Then update metadata
        store.updateAuthorMetadata(
          'https://twitter.com/existing',
          'x',
          { authorName: 'Updated Name' }
        );

        const state = get(store.state);
        expect(state.authors[0].status).toBe('subscribed');
        expect(state.authors[0].subscriptionId).toBe('sub-123');
      });
    });

    describe('partial metadata update', () => {
      it('should only update provided fields', () => {
        store.updateAuthorMetadata(
          'https://youtube.com/channel/abc',
          'youtube',
          {
            authorName: 'YouTuber',
            followers: 10000,
          }
        );

        const state = get(store.state);
        const author = state.authors[0];

        expect(author.authorName).toBe('YouTuber');
        expect(author.followers).toBe(10000);
        expect(author.postsCount).toBeNull();
        expect(author.bio).toBeNull();
        expect(author.handle).toBeUndefined();
      });
    });

    describe('platform matching', () => {
      it('should not update author with different platform', () => {
        store.setAuthors([{
          authorName: 'Cross Platform',
          authorUrl: 'https://example.com/user',
          platform: 'x' as Platform,
          avatar: null,
          localAvatar: null,
          followers: null,
          postsCount: null,
          bio: null,
          lastSeenAt: new Date(),
          archiveCount: 1,
          subscriptionId: null,
          status: 'not_subscribed',
        }]);

        // Try to update with different platform
        store.updateAuthorMetadata(
          'https://example.com/user',
          'instagram', // Different platform
          { authorName: 'Updated' }
        );

        const state = get(store.state);
        // Should have created a new entry instead of updating
        expect(state.authors).toHaveLength(2);
        expect(state.authors[0].authorName).toBe('Cross Platform'); // Original unchanged
        expect(state.authors[1].authorName).toBe('Updated'); // New entry
      });
    });

    describe('multiple authors', () => {
      it('should only update the matching author', () => {
        store.setAuthors([
          {
            authorName: 'User 1',
            authorUrl: 'https://twitter.com/user1',
            platform: 'x' as Platform,
            avatar: null,
            localAvatar: null,
            followers: 100,
            postsCount: null,
            bio: null,
            lastSeenAt: new Date(),
            archiveCount: 1,
            subscriptionId: null,
            status: 'not_subscribed',
          },
          {
            authorName: 'User 2',
            authorUrl: 'https://twitter.com/user2',
            platform: 'x' as Platform,
            avatar: null,
            localAvatar: null,
            followers: 200,
            postsCount: null,
            bio: null,
            lastSeenAt: new Date(),
            archiveCount: 1,
            subscriptionId: null,
            status: 'not_subscribed',
          },
        ]);

        store.updateAuthorMetadata(
          'https://twitter.com/user1',
          'x',
          { followers: 500 }
        );

        const state = get(store.state);
        expect(state.authors[0].followers).toBe(500);
        expect(state.authors[0].archiveCount).toBe(2);
        expect(state.authors[1].followers).toBe(200); // Unchanged
        expect(state.authors[1].archiveCount).toBe(1); // Unchanged
      });
    });
  });

  describe('derived stores after updateAuthorMetadata', () => {
    it('should update platformCounts when new author is added', () => {
      store.updateAuthorMetadata(
        'https://instagram.com/user',
        'instagram',
        { authorName: 'IG User' }
      );

      const counts = get(store.platformCounts);
      expect(counts.all).toBe(1);
      expect(counts.instagram).toBe(1);
    });

    it('should update subscriptionStats correctly', () => {
      store.updateAuthorMetadata(
        'https://tiktok.com/@user',
        'tiktok',
        { authorName: 'TikToker' }
      );

      const stats = get(store.subscriptionStats);
      expect(stats.total).toBe(1);
      expect(stats.subscribed).toBe(0);
    });

    it('should include new author in filteredAuthors', () => {
      store.updateAuthorMetadata(
        'https://facebook.com/user',
        'facebook',
        { authorName: 'FB User' }
      );

      const filtered = get(store.filteredAuthors);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].authorName).toBe('FB User');
    });
  });
});
