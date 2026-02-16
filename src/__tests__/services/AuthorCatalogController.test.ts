/**
 * AuthorCatalogController Tests
 *
 * Tests for the pure functions and controller class extracted
 * from AuthorCatalog.svelte.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  formatCronSchedule,
  buildSubscriptionMapFromApi,
  AuthorCatalogController,
  type ScheduleInput,
} from '../../services/AuthorCatalogController';
import type { AuthorCatalogEntry } from '../../types/author-catalog';
import { createAuthorCatalogStore, type AuthorCatalogStoreAPI } from '../../services/AuthorCatalogStore';
import { get } from 'svelte/store';

// ============================================================================
// formatCronSchedule
// ============================================================================

describe('formatCronSchedule', () => {
  it('should return "No schedule" when no schedule provided', () => {
    expect(formatCronSchedule()).toBe('No schedule');
    expect(formatCronSchedule(undefined)).toBe('No schedule');
    expect(formatCronSchedule({})).toBe('No schedule');
  });

  it('should return "Invalid schedule" for malformed cron', () => {
    expect(formatCronSchedule({ cron: '0 9' })).toBe('Invalid schedule');
    expect(formatCronSchedule({ cron: '' })).toBe('No schedule');
  });

  it('should format daily schedule from localCron', () => {
    const result = formatCronSchedule({
      localCron: '0 9 * * *',
      timezone: 'Asia/Seoul',
    });
    expect(result).toBe('Daily at 09:00 (Asia/Seoul)');
  });

  it('should format daily schedule with UTC cron and timezone conversion', () => {
    const result = formatCronSchedule({
      cron: '0 0 * * *',
      timezone: 'Asia/Seoul',
    });
    // UTC 0:00 → KST 9:00
    expect(result).toBe('Daily at 09:00 (Asia/Seoul)');
  });

  it('should format weekly schedule', () => {
    const result = formatCronSchedule({
      localCron: '0 14 * * 1',
      timezone: 'UTC',
    });
    expect(result).toBe('Every Mon at 14:00');
  });

  it('should handle all weekday numbers', () => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < 7; i++) {
      const result = formatCronSchedule({ localCron: `0 10 * * ${i}` });
      expect(result).toBe(`Every ${days[i]} at 10:00`);
    }
  });

  it('should prefer localCron over cron', () => {
    const result = formatCronSchedule({
      cron: '0 0 * * *',
      localCron: '0 15 * * *',
      timezone: 'US/Eastern',
    });
    expect(result).toBe('Daily at 15:00 (US/Eastern)');
  });

  it('should default timezone to UTC', () => {
    const result = formatCronSchedule({ localCron: '0 12 * * *' });
    expect(result).toBe('Daily at 12:00 (UTC)');
  });
});

// ============================================================================
// buildSubscriptionMapFromApi
// ============================================================================

describe('buildSubscriptionMapFromApi', () => {
  it('should return empty map for empty array', () => {
    const map = buildSubscriptionMapFromApi([]);
    expect(map.size).toBe(0);
  });

  it('should skip disabled subscriptions', () => {
    const map = buildSubscriptionMapFromApi([
      { id: '1', enabled: false, platform: 'x', handle: 'testuser', name: 'Test' },
    ]);
    expect(map.size).toBe(0);
  });

  it('should build entry for X (Twitter) subscription', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-1',
        enabled: true,
        platform: 'x',
        handle: 'elonmusk',
        name: 'Elon Musk',
        profileUrl: 'https://x.com/elonmusk',
        schedule: { cron: '0 9 * * *', timezone: 'UTC' },
      },
    ]);

    expect(map.size).toBeGreaterThanOrEqual(1);
    // Find the entry
    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-1');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('subscribed');
    expect(entry!.platform).toBe('x');
  });

  it('should build entry for YouTube subscription with handle', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-yt',
        enabled: true,
        platform: 'youtube',
        handle: 'mkbhd',
        name: 'MKBHD',
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-yt');
    expect(entry).toBeDefined();
    expect(entry!.authorUrl).toBe('https://www.youtube.com/@mkbhd');
  });

  it('should build entry for YouTube subscription with channel ID', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-yt-ch',
        enabled: true,
        platform: 'youtube',
        handle: 'UCxxxxxxxxxxxxxxxxxxxxxx', // 24 char channel ID
        name: 'Some Channel',
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-yt-ch');
    expect(entry).toBeDefined();
    expect(entry!.authorUrl).toContain('/channel/');
  });

  it('should regenerate LinkedIn URL from handle', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-li',
        enabled: true,
        platform: 'linkedin',
        handle: 'johndoe',
        name: 'John Doe',
        profileUrl: 'https://www.linkedin.com/company/johndoe/', // stored as company URL
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-li');
    expect(entry).toBeDefined();
    // Should always use /in/ format
    expect(entry!.authorUrl).toBe('https://www.linkedin.com/in/johndoe/');
  });

  it('should build entry for Reddit subscription', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-reddit',
        enabled: true,
        platform: 'reddit',
        handle: 'programming',
        name: 'r/programming',
        redditOptions: { sortBy: 'Hot', sortByTime: 'Today' },
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-reddit');
    expect(entry).toBeDefined();
    expect(entry!.redditOptions).toEqual({
      sortBy: 'Hot',
      sortByTime: 'Today',
      keyword: undefined,
    });
  });

  it('should build entry for Mastodon subscription', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-mast',
        enabled: true,
        platform: 'mastodon',
        handle: 'user@mastodon.social',
        name: 'Mastodon User',
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-mast');
    expect(entry).toBeDefined();
    expect(entry!.authorUrl).toBe('https://mastodon.social/@user');
  });

  it('should build entry for Naver Webtoon subscription', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-webtoon',
        enabled: true,
        platform: 'naver-webtoon',
        handle: '650305',
        name: 'My Webtoon',
        naverWebtoonOptions: {
          titleId: '650305',
          titleName: 'My Webtoon',
          publishDay: '토요웹툰',
        },
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-webtoon');
    expect(entry).toBeDefined();
    expect(entry!.authorUrl).toContain('titleId=650305');
  });

  it('should parse lastRunAt from stats', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-run',
        enabled: true,
        platform: 'x',
        handle: 'test',
        name: 'Test',
        stats: { lastRunAt: '2026-01-15T10:00:00Z' },
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-run');
    expect(entry).toBeDefined();
    expect(entry!.lastRunAt).toBeInstanceOf(Date);
  });

  it('should include X metadata (avatar, bio)', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-x-meta',
        enabled: true,
        platform: 'x',
        handle: 'testuser',
        name: 'Test User',
        xMetadata: {
          avatar: 'https://pbs.twimg.com/profile_images/avatar.jpg',
          bio: 'Developer & writer',
        },
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-x-meta');
    expect(entry).toBeDefined();
    expect(entry!.authorAvatar).toBe('https://pbs.twimg.com/profile_images/avatar.jpg');
    expect(entry!.bio).toBe('Developer & writer');
  });

  it('should handle Substack subscription', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-substack',
        enabled: true,
        platform: 'substack',
        handle: 'techblog',
        name: 'Tech Blog',
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-substack');
    expect(entry).toBeDefined();
    expect(entry!.authorUrl).toBe('https://techblog.substack.com');
  });

  it('should handle Tumblr subscription', () => {
    const map = buildSubscriptionMapFromApi([
      {
        id: 'sub-tumblr',
        enabled: true,
        platform: 'tumblr',
        handle: 'myblog',
        name: 'My Blog',
      },
    ]);

    const entries = [...map.values()];
    const entry = entries.find((e) => e.subscriptionId === 'sub-tumblr');
    expect(entry).toBeDefined();
    expect(entry!.authorUrl).toBe('https://myblog.tumblr.com');
  });
});

// ============================================================================
// AuthorCatalogController
// ============================================================================

describe('AuthorCatalogController', () => {
  let store: AuthorCatalogStoreAPI;

  const createMockApp = () => ({
    vault: {
      adapter: {
        exists: vi.fn().mockResolvedValue(false),
      },
      getFolderByPath: vi.fn().mockReturnValue(null),
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
    },
  });

  beforeEach(() => {
    store = createAuthorCatalogStore();
  });

  describe('subscribe', () => {
    it('should call onSubscribe and update store on success', async () => {
      const mockApp = createMockApp();
      const onSubscribe = vi.fn().mockResolvedValue({
        id: 'new-sub-id',
        schedule: { localCron: '0 9 * * *', timezone: 'UTC' },
      });

      // Seed store with an author
      const author: AuthorCatalogEntry = {
        authorName: 'Test Author',
        authorUrl: 'https://x.com/testauthor',
        platform: 'x',
        avatar: null,
        lastSeenAt: new Date(),
        archiveCount: 5,
        subscriptionId: null,
        status: 'not_subscribed',
        followers: null,
        postsCount: null,
        bio: null,
        lastMetadataUpdate: null,
      };
      store.setAuthors([author]);

      const controller = new AuthorCatalogController({
        app: mockApp as any,
        archivePath: 'Social Archives',
        store,
        onSubscribe,
      });

      await controller.subscribe(author, {
        cadence: 'daily',
        destinationPath: 'Social Archives',
        templateId: null,
        timezone: 'UTC',
      });

      expect(onSubscribe).toHaveBeenCalledOnce();

      const state = get(store.state);
      const updatedAuthor = state.authors[0];
      expect(updatedAuthor.status).toBe('subscribed');
      expect(updatedAuthor.subscriptionId).toBe('new-sub-id');
    });

    it('should set error status on failure', async () => {
      const mockApp = createMockApp();
      const onSubscribe = vi.fn().mockRejectedValue(new Error('API error'));

      const author: AuthorCatalogEntry = {
        authorName: 'Failing Author',
        authorUrl: 'https://x.com/fail',
        platform: 'x',
        avatar: null,
        lastSeenAt: new Date(),
        archiveCount: 1,
        subscriptionId: null,
        status: 'not_subscribed',
        followers: null,
        postsCount: null,
        bio: null,
        lastMetadataUpdate: null,
      };
      store.setAuthors([author]);

      const controller = new AuthorCatalogController({
        app: mockApp as any,
        archivePath: 'Social Archives',
        store,
        onSubscribe,
      });

      await expect(
        controller.subscribe(author, {
          cadence: 'daily',
          destinationPath: 'Social Archives',
          templateId: null,
          timezone: 'UTC',
        })
      ).rejects.toThrow('API error');

      // Store should have error status
      const state = get(store.state);
      const updatedAuthor = state.authors.find((a) => a.authorUrl === 'https://x.com/fail');
      expect(updatedAuthor?.status).toBe('error');
    });
  });

  describe('unsubscribe', () => {
    it('should call onUnsubscribe and update store', async () => {
      const mockApp = createMockApp();
      const onUnsubscribe = vi.fn().mockResolvedValue(undefined);

      const author: AuthorCatalogEntry = {
        authorName: 'Subscribed Author',
        authorUrl: 'https://x.com/subscribed',
        platform: 'x',
        avatar: null,
        lastSeenAt: new Date(),
        archiveCount: 3,
        subscriptionId: 'sub-123',
        status: 'subscribed',
        followers: null,
        postsCount: null,
        bio: null,
        lastMetadataUpdate: null,
      };
      store.setAuthors([author]);

      const controller = new AuthorCatalogController({
        app: mockApp as any,
        archivePath: 'Social Archives',
        store,
        onUnsubscribe,
      });

      await controller.unsubscribe(author);

      expect(onUnsubscribe).toHaveBeenCalledOnce();

      const state = get(store.state);
      const updatedAuthor = state.authors[0];
      expect(updatedAuthor.status).toBe('not_subscribed');
      expect(updatedAuthor.subscriptionId).toBeNull();
    });
  });

  describe('countArchiveFiles', () => {
    it('should return 0 when folder does not exist', () => {
      const mockApp = createMockApp();
      const controller = new AuthorCatalogController({
        app: mockApp as any,
        archivePath: 'Social Archives',
        store,
      });

      expect(controller.countArchiveFiles()).toBe(0);
    });

    it('should count markdown files recursively', () => {
      const mockApp = createMockApp();
      mockApp.vault.getFolderByPath = vi.fn().mockReturnValue({
        children: [
          { extension: 'md', children: undefined },
          { extension: 'md', children: undefined },
          {
            children: [
              { extension: 'md', children: undefined },
              { extension: 'png', children: undefined },
            ],
          },
        ],
      });

      const controller = new AuthorCatalogController({
        app: mockApp as any,
        archivePath: 'Social Archives',
        store,
      });

      expect(controller.countArchiveFiles()).toBe(3);
    });
  });

  describe('findExistingAvatar', () => {
    it('should return null for empty handle', async () => {
      const mockApp = createMockApp();
      const controller = new AuthorCatalogController({
        app: mockApp as any,
        archivePath: 'Social Archives',
        store,
      });

      expect(await controller.findExistingAvatar('x', '')).toBeNull();
    });

    it('should find existing avatar file', async () => {
      const mockApp = createMockApp();
      (mockApp.vault.getAbstractFileByPath as Mock).mockImplementation((path: string) =>
        path === 'attachments/social-archives/authors/x-testuser.jpg' ? ({ path } as any) : null
      );

      const controller = new AuthorCatalogController({
        app: mockApp as any,
        archivePath: 'Social Archives',
        store,
      });

      const result = await controller.findExistingAvatar('x', 'testuser');
      expect(result).toBe('attachments/social-archives/authors/x-testuser.jpg');
    });

    it('should try multiple extensions', async () => {
      const mockApp = createMockApp();
      (mockApp.vault.getAbstractFileByPath as Mock).mockImplementation((path: string) =>
        path === 'attachments/social-archives/authors/instagram-user.webp' ? ({ path } as any) : null
      );

      const controller = new AuthorCatalogController({
        app: mockApp as any,
        archivePath: 'Social Archives',
        store,
      });

      const result = await controller.findExistingAvatar('instagram', 'user');
      expect(result).toBe('attachments/social-archives/authors/instagram-user.webp');
    });
  });

  describe('updateConfig', () => {
    it('should update config partially', () => {
      const mockApp = createMockApp();
      const controller = new AuthorCatalogController({
        app: mockApp as any,
        archivePath: 'Social Archives',
        store,
      });

      controller.updateConfig({ archivePath: 'New Archives' });
      // Verify by counting files with new path
      expect(controller.countArchiveFiles()).toBe(0);
    });
  });
});
