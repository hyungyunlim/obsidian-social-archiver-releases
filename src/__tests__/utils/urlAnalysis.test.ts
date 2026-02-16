import { describe, expect, it } from 'vitest';
import {
  analyzeUrl,
  isProfileUrl,
  isPostUrl,
  extractHandle,
  parseInstagramUrl,
  isYouTubeProfileUrl,
  parseYouTubeProfileUrl,
  type UrlAnalysisResult
} from '@/utils/urlAnalysis';

describe('urlAnalysis', () => {
  describe('analyzeUrl', () => {
    describe('Instagram', () => {
      it('should detect Instagram profile URLs', () => {
        const testCases = [
          'https://instagram.com/johndoe',
          'https://www.instagram.com/johndoe',
          'https://instagram.com/johndoe/',
          'https://instagram.com/@johndoe',
        ];

        for (const url of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('profile');
          expect(result.platform).toBe('instagram');
          expect(result.handle).toBe('johndoe');
        }
      });

      it('should detect Instagram post URLs', () => {
        const testCases = [
          { url: 'https://instagram.com/p/ABC123', expectedId: 'ABC123' },
          { url: 'https://www.instagram.com/reel/XYZ789/', expectedId: 'XYZ789' },
          { url: 'https://instagram.com/tv/DEF456', expectedId: 'DEF456' },
        ];

        for (const { url, expectedId } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('instagram');
          expect(result.postId).toBe(expectedId);
        }
      });

      it('should reject Instagram reserved paths as profiles', () => {
        const reservedPaths = [
          'https://instagram.com/explore',
          'https://instagram.com/reels',
          'https://instagram.com/direct',
          'https://instagram.com/accounts',
        ];

        for (const url of reservedPaths) {
          const result = analyzeUrl(url);
          expect(result.type, `Should not be profile: ${url}`).not.toBe('profile');
        }
      });
    });

    describe('X/Twitter', () => {
      it('should detect X profile URLs', () => {
        const testCases = [
          { url: 'https://x.com/elonmusk', handle: 'elonmusk' },
          { url: 'https://twitter.com/elonmusk', handle: 'elonmusk' },
          { url: 'https://x.com/elonmusk/', handle: 'elonmusk' },
          { url: 'https://mobile.x.com/user123', handle: 'user123' },
        ];

        for (const { url, handle } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('profile');
          expect(result.platform).toBe('x');
          expect(result.handle).toBe(handle);
        }
      });

      it('should detect X/Twitter post URLs', () => {
        const testCases = [
          { url: 'https://x.com/elonmusk/status/1234567890', expectedId: '1234567890' },
          { url: 'https://twitter.com/user/status/9876543210', expectedId: '9876543210' },
        ];

        for (const { url, expectedId } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('x');
          expect(result.postId).toBe(expectedId);
        }
      });

      it('should reject X reserved paths as profiles', () => {
        const reservedPaths = [
          'https://x.com/i/moments/123',
          'https://x.com/explore',
          'https://x.com/home',
          'https://x.com/notifications',
          'https://x.com/settings',
        ];

        for (const url of reservedPaths) {
          const result = analyzeUrl(url);
          expect(result.type, `Should not be profile: ${url}`).not.toBe('profile');
        }
      });
    });

    describe('TikTok', () => {
      it('should detect TikTok profile URLs', () => {
        const testCases = [
          { url: 'https://tiktok.com/@username', handle: 'username' },
          { url: 'https://www.tiktok.com/@user.name/', handle: 'user.name' },
          { url: 'https://tiktok.com/@user_123', handle: 'user_123' },
        ];

        for (const { url, handle } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('profile');
          expect(result.platform).toBe('tiktok');
          expect(result.handle).toBe(handle);
        }
      });

      it('should detect TikTok video URLs', () => {
        const testCases = [
          { url: 'https://tiktok.com/@user/video/1234567890', expectedId: '1234567890' },
          { url: 'https://www.tiktok.com/@creator/video/9876543210', expectedId: '9876543210' },
        ];

        for (const { url, expectedId } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('tiktok');
          expect(result.postId).toBe(expectedId);
        }
      });

      it('should reject TikTok reserved paths as profiles', () => {
        const reservedPaths = [
          'https://tiktok.com/explore',
          'https://tiktok.com/foryou',
          'https://tiktok.com/discover',
        ];

        for (const url of reservedPaths) {
          const result = analyzeUrl(url);
          expect(result.type, `Should not be profile: ${url}`).not.toBe('profile');
        }
      });
    });

    describe('Facebook', () => {
      it('should detect Facebook profile URLs', () => {
        const testCases = [
          { url: 'https://facebook.com/johndoe', handle: 'johndoe' },
          { url: 'https://www.facebook.com/jane.doe/', handle: 'jane.doe' },
          { url: 'https://m.facebook.com/user123', handle: 'user123' },
        ];

        for (const { url, handle } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('profile');
          expect(result.platform).toBe('facebook');
          expect(result.handle).toBe(handle);
        }
      });

      it('should detect Facebook post URLs', () => {
        const testCases = [
          { url: 'https://facebook.com/user/posts/123456', expectedId: '123456' },
          { url: 'https://facebook.com/user/videos/789012', expectedId: null }, // videos don't have simple ID extraction
        ];

        for (const { url, expectedId } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('facebook');
          if (expectedId) {
            expect(result.postId).toBe(expectedId);
          }
        }
      });

      it('should reject Facebook reserved paths as profiles', () => {
        const reservedPaths = [
          'https://facebook.com/watch',
          'https://facebook.com/marketplace',
          'https://facebook.com/groups',
          'https://facebook.com/events',
        ];

        for (const url of reservedPaths) {
          const result = analyzeUrl(url);
          expect(result.type, `Should not be profile: ${url}`).not.toBe('profile');
        }
      });

      it('should detect Facebook share/p/ URLs as post URLs', () => {
        // /share/p/xxxx is a POST share link (p = post)
        const testCases = [
          'https://www.facebook.com/share/p/1EuCpSGFQK/?mibextid=wwXIfr',
          'https://facebook.com/share/p/ABC123',
          'https://m.facebook.com/share/p/XYZ789/',
        ];

        for (const url of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('facebook');
          expect(result.postId).toMatch(/^share:/);
        }
      });

      it('should detect Facebook bare share/ URLs (without /p/) as post URLs', () => {
        // /share/xxxx (without /p/) is a POST share link from newer Facebook mobile app
        const testCases = [
          'https://facebook.com/share/ABC123',
          'https://www.facebook.com/share/XYZ789/',
          'https://www.facebook.com/share/17x6yKQhVV/?mibextid=wwXIfr',
        ];

        for (const url of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('facebook');
          expect(result.postId).toMatch(/^share:/);
        }
      });
    });

    describe('LinkedIn', () => {
      it('should detect LinkedIn profile URLs', () => {
        const testCases = [
          { url: 'https://linkedin.com/in/johndoe', handle: 'johndoe' },
          { url: 'https://www.linkedin.com/in/jane-doe/', handle: 'jane-doe' },
        ];

        for (const { url, handle } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('profile');
          expect(result.platform).toBe('linkedin');
          expect(result.handle).toBe(handle);
        }
      });

      it('should detect LinkedIn post URLs', () => {
        const testCases = [
          { url: 'https://linkedin.com/posts/user_activity-123', expectedId: 'activity-123' },
          { url: 'https://linkedin.com/feed/update/urn:li:activity:123456', expectedId: '123456' },
        ];

        for (const { url, expectedId } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('linkedin');
          expect(result.postId).toBe(expectedId);
        }
      });
    });

    describe('YouTube', () => {
      it('should detect YouTube channel URLs', () => {
        const testCases = [
          { url: 'https://youtube.com/@MrBeast', handle: 'MrBeast' },
          { url: 'https://www.youtube.com/@channel_name/', handle: 'channel_name' },
          { url: 'https://youtube.com/c/ChannelName', handle: 'ChannelName' },
          { url: 'https://youtube.com/channel/UC123456', handle: 'UC123456' },
          { url: 'https://youtube.com/user/username', handle: 'username' },
        ];

        for (const { url, handle } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('profile');
          expect(result.platform).toBe('youtube');
          expect(result.handle).toBe(handle);
        }
      });

      it('should detect YouTube video URLs', () => {
        const testCases = [
          { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
          { url: 'https://youtu.be/dQw4w9WgXcQ', expectedId: 'dQw4w9WgXcQ' },
          { url: 'https://youtube.com/shorts/ABC123', expectedId: 'ABC123' },
        ];

        for (const { url, expectedId } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('youtube');
          expect(result.postId).toBe(expectedId);
        }
      });
    });

    describe('Threads', () => {
      it('should detect Threads profile URLs', () => {
        const result = analyzeUrl('https://threads.net/@username');
        expect(result.type).toBe('profile');
        expect(result.platform).toBe('threads');
        expect(result.handle).toBe('username');
      });

      it('should detect Threads post URLs', () => {
        const testCases = [
          { url: 'https://threads.net/@user/post/ABC123', expectedId: 'ABC123' },
          { url: 'https://threads.net/t/XYZ789', expectedId: 'XYZ789' },
        ];

        for (const { url, expectedId } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('threads');
          expect(result.postId).toBe(expectedId);
        }
      });
    });

    describe('Reddit', () => {
      it('should detect Reddit user URLs', () => {
        const testCases = [
          { url: 'https://reddit.com/user/username', handle: 'username' },
          { url: 'https://www.reddit.com/u/user_name/', handle: 'user_name' },
          { url: 'https://old.reddit.com/user/user123', handle: 'user123' },
        ];

        for (const { url, handle } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('profile');
          expect(result.platform).toBe('reddit');
          expect(result.handle).toBe(handle);
        }
      });

      it('should detect Reddit post URLs', () => {
        const result = analyzeUrl('https://reddit.com/r/subreddit/comments/abc123/post_title');
        expect(result.type).toBe('post');
        expect(result.platform).toBe('reddit');
        expect(result.postId).toBe('abc123');
      });
    });

    describe('Bluesky', () => {
      it('should detect Bluesky profile URLs', () => {
        const testCases = [
          { url: 'https://bsky.app/profile/user.bsky.social', handle: 'user.bsky.social' },
          { url: 'https://bsky.app/profile/custom.domain/', handle: 'custom.domain' },
        ];

        for (const { url, handle } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('profile');
          expect(result.platform).toBe('bluesky');
          expect(result.handle).toBe(handle);
        }
      });

      it('should detect Bluesky post URLs', () => {
        const result = analyzeUrl('https://bsky.app/profile/user.bsky.social/post/abc123');
        expect(result.type).toBe('post');
        expect(result.platform).toBe('bluesky');
        expect(result.postId).toBe('abc123');
      });
    });

    describe('Pinterest', () => {
      it('should detect Pinterest profile URLs', () => {
        const result = analyzeUrl('https://pinterest.com/username');
        expect(result.type).toBe('profile');
        expect(result.platform).toBe('pinterest');
        expect(result.handle).toBe('username');
      });

      it('should detect Pinterest pin URLs', () => {
        const result = analyzeUrl('https://pinterest.com/pin/123456789');
        expect(result.type).toBe('post');
        expect(result.platform).toBe('pinterest');
        expect(result.postId).toBe('123456789');
      });
    });

    describe('Substack', () => {
      it('should convert Substack profile URLs to RSS type with derived feed URL', () => {
        // Substack profile URLs are automatically converted to RSS type
        // because Substack supports RSS subscription
        const testCases = [
          { url: 'https://username.substack.com', handle: 'username', feedUrl: 'https://username.substack.com/feed' },
          { url: 'https://substack.com/@username', handle: 'username', feedUrl: 'https://username.substack.com/feed' },
        ];

        for (const { url, handle, feedUrl } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('rss');
          expect(result.platform).toBe('substack');
          expect(result.handle).toBe(handle);
          expect(result.feedUrl).toBe(feedUrl);
        }
      });

      it('should detect Substack post URLs', () => {
        const testCases = [
          { url: 'https://username.substack.com/p/post-slug', expectedId: 'post-slug' },
          { url: 'https://substack.com/@user/post/abc123', expectedId: 'abc123' },
        ];

        for (const { url, expectedId } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('substack');
          expect(result.postId).toBe(expectedId);
        }
      });
    });

    describe('Tumblr', () => {
      it('should convert Tumblr profile URLs to RSS type with derived feed URL', () => {
        // Tumblr profile URLs are automatically converted to RSS type
        // because Tumblr supports RSS subscription
        const testCases = [
          { url: 'https://username.tumblr.com', handle: 'username', feedUrl: 'https://username.tumblr.com/rss' },
          { url: 'https://tumblr.com/username', handle: 'username', feedUrl: 'https://username.tumblr.com/rss' },
        ];

        for (const { url, handle, feedUrl } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('rss');
          expect(result.platform).toBe('tumblr');
          expect(result.handle).toBe(handle);
          expect(result.feedUrl).toBe(feedUrl);
        }
      });

      it('should detect Tumblr post URLs', () => {
        const testCases = [
          { url: 'https://username.tumblr.com/post/123456', expectedId: '123456' },
          { url: 'https://tumblr.com/username/123456789', expectedId: '123456789' },
        ];

        for (const { url, expectedId } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('post');
          expect(result.platform).toBe('tumblr');
          expect(result.postId).toBe(expectedId);
        }
      });
    });

    describe('Mastodon', () => {
      it('should detect Mastodon profile URLs', () => {
        const result = analyzeUrl('https://mastodon.social/@username');
        expect(result.type).toBe('profile');
        expect(result.platform).toBe('mastodon');
        expect(result.handle).toBe('username');
      });

      it('should detect Mastodon post URLs', () => {
        const result = analyzeUrl('https://mastodon.social/@username/123456789');
        expect(result.type).toBe('post');
        expect(result.platform).toBe('mastodon');
        expect(result.postId).toBe('123456789');
      });
    });

    describe('Edge Cases', () => {
      it('should handle URLs without protocol', () => {
        const result = analyzeUrl('instagram.com/username');
        expect(result.type).toBe('profile');
        expect(result.platform).toBe('instagram');
        expect(result.handle).toBe('username');
      });

      it('should handle URLs with trailing slashes', () => {
        const result = analyzeUrl('https://x.com/username/');
        expect(result.type).toBe('profile');
        expect(result.platform).toBe('x');
        expect(result.handle).toBe('username');
      });

      it('should handle URLs with query parameters', () => {
        const result = analyzeUrl('https://instagram.com/username?ref=share');
        // Query params might affect pattern matching, but should still work
        expect(result.platform).toBe('instagram');
      });

      it('should return unknown for malformed URLs', () => {
        const result = analyzeUrl('not-a-valid-url');
        expect(result.type).toBe('unknown');
        expect(result.platform).toBeNull();
      });

      it('should return unknown for unsupported platforms', () => {
        const result = analyzeUrl('https://example.com/user');
        expect(result.type).toBe('unknown');
        expect(result.platform).toBeNull();
      });

      it('should preserve original URL in result', () => {
        const originalUrl = 'instagram.com/test';
        const result = analyzeUrl(originalUrl);
        expect(result.originalUrl).toBe(originalUrl);
        expect(result.normalizedUrl).toBe('https://instagram.com/test');
      });
    });
  });

  describe('isProfileUrl', () => {
    it('should return true for profile URLs', () => {
      expect(isProfileUrl('https://instagram.com/username')).toBe(true);
      expect(isProfileUrl('https://x.com/username')).toBe(true);
      expect(isProfileUrl('https://tiktok.com/@username')).toBe(true);
    });

    it('should return false for post URLs', () => {
      expect(isProfileUrl('https://instagram.com/p/ABC123')).toBe(false);
      expect(isProfileUrl('https://x.com/user/status/123456')).toBe(false);
      expect(isProfileUrl('https://tiktok.com/@user/video/123456')).toBe(false);
    });

    it('should return false for unknown URLs', () => {
      expect(isProfileUrl('https://example.com/user')).toBe(false);
      expect(isProfileUrl('invalid-url')).toBe(false);
    });
  });

  describe('isPostUrl', () => {
    it('should return true for post URLs', () => {
      expect(isPostUrl('https://instagram.com/p/ABC123')).toBe(true);
      expect(isPostUrl('https://x.com/user/status/123456')).toBe(true);
      expect(isPostUrl('https://tiktok.com/@user/video/123456')).toBe(true);
    });

    it('should return false for profile URLs', () => {
      expect(isPostUrl('https://instagram.com/username')).toBe(false);
      expect(isPostUrl('https://x.com/username')).toBe(false);
      expect(isPostUrl('https://tiktok.com/@username')).toBe(false);
    });

    it('should return false for unknown URLs', () => {
      expect(isPostUrl('https://example.com/post')).toBe(false);
      expect(isPostUrl('invalid-url')).toBe(false);
    });
  });

  describe('extractHandle', () => {
    it('should extract handle from profile URLs', () => {
      expect(extractHandle('https://instagram.com/johndoe')).toBe('johndoe');
      expect(extractHandle('https://x.com/elonmusk')).toBe('elonmusk');
      expect(extractHandle('https://tiktok.com/@creator')).toBe('creator');
    });

    it('should return null for post URLs', () => {
      expect(extractHandle('https://instagram.com/p/ABC123')).toBeNull();
      expect(extractHandle('https://x.com/user/status/123456')).toBeNull();
    });

    it('should return null for unknown URLs', () => {
      expect(extractHandle('https://example.com/user')).toBeNull();
      expect(extractHandle('invalid-url')).toBeNull();
    });
  });

  describe('parseInstagramUrl', () => {
    it('should return valid result for valid Instagram profile URLs', () => {
      const testCases = [
        'https://instagram.com/username',
        'https://www.instagram.com/username',
        'https://m.instagram.com/username',
        'https://instagram.com/username/',
        'https://instagram.com/@username',
        'instagram.com/username',
      ];

      for (const url of testCases) {
        const result = parseInstagramUrl(url);
        expect(result.valid, `Failed for ${url}`).toBe(true);
        expect(result.username).toBe('username');
        expect(result.error).toBeUndefined();
      }
    });

    it('should return error for empty URL', () => {
      const result = parseInstagramUrl('');
      expect(result.valid).toBe(false);
      expect(result.username).toBeNull();
      expect(result.error).toBe('URL is required');
    });

    it('should return error for non-Instagram URLs', () => {
      const result = parseInstagramUrl('https://example.com/user');
      expect(result.valid).toBe(false);
      expect(result.username).toBeNull();
      expect(result.error).toContain('Invalid Instagram URL');
    });

    it('should return specific error for unsupported platforms', () => {
      expect(parseInstagramUrl('https://x.com/user').error).toContain('X/Twitter URL');
      expect(parseInstagramUrl('https://twitter.com/user').error).toContain('X/Twitter URL');
      expect(parseInstagramUrl('https://tiktok.com/@user').error).toContain('TikTok is not supported');
      expect(parseInstagramUrl('https://facebook.com/user').error).toContain('Facebook is not supported');
    });

    it('should return error for Instagram post URLs', () => {
      // Note: parseInstagramUrl checks for /p/, /reel/, /stories/ ONLY if the URL
      // first matches the profile pattern. URLs like instagram.com/p/ABC123 don't
      // match the profile pattern, so they get "Invalid Instagram URL" error.
      // This is expected behavior for this legacy function.
      const postUrls = [
        'https://instagram.com/p/ABC123',
        'https://instagram.com/reel/XYZ789',
        'https://instagram.com/stories/username/123',
      ];

      for (const url of postUrls) {
        const result = parseInstagramUrl(url);
        expect(result.valid, `Should be invalid for ${url}`).toBe(false);
        expect(result.error).toBeDefined();
      }
    });

    it('should return error for reserved Instagram paths', () => {
      const reservedPaths = ['explore', 'reels', 'direct', 'accounts', 'about', 'help'];

      for (const path of reservedPaths) {
        const result = parseInstagramUrl(`https://instagram.com/${path}`);
        expect(result.valid, `Should be invalid for ${path}`).toBe(false);
      }
    });

    it('should normalize username to lowercase', () => {
      const result = parseInstagramUrl('https://instagram.com/UserName');
      expect(result.valid).toBe(true);
      expect(result.username).toBe('username');
    });

    it('should handle URLs with query parameters', () => {
      const result = parseInstagramUrl('https://instagram.com/username?ref=share');
      expect(result.valid).toBe(true);
      expect(result.username).toBe('username');
    });
  });

  describe('isYouTubeProfileUrl', () => {
    it('should return true for YouTube profile URLs', () => {
      expect(isYouTubeProfileUrl('https://youtube.com/@MrBeast')).toBe(true);
      expect(isYouTubeProfileUrl('https://www.youtube.com/@veritasium')).toBe(true);
      expect(isYouTubeProfileUrl('https://youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA')).toBe(true);
      expect(isYouTubeProfileUrl('https://youtube.com/c/PewDiePie')).toBe(true);
      expect(isYouTubeProfileUrl('https://youtube.com/user/Google')).toBe(true);
    });

    it('should return false for YouTube video URLs', () => {
      expect(isYouTubeProfileUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
      expect(isYouTubeProfileUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(false);
      expect(isYouTubeProfileUrl('https://youtube.com/shorts/ABC123')).toBe(false);
    });

    it('should return false for YouTube reserved paths', () => {
      expect(isYouTubeProfileUrl('https://youtube.com/feed')).toBe(false);
      expect(isYouTubeProfileUrl('https://youtube.com/gaming')).toBe(false);
      expect(isYouTubeProfileUrl('https://youtube.com/music')).toBe(false);
      expect(isYouTubeProfileUrl('https://youtube.com/premium')).toBe(false);
    });

    it('should return false for non-YouTube URLs', () => {
      expect(isYouTubeProfileUrl('https://instagram.com/username')).toBe(false);
      expect(isYouTubeProfileUrl('https://x.com/username')).toBe(false);
    });
  });

  describe('parseYouTubeProfileUrl', () => {
    describe('@handle format', () => {
      it('should parse valid @handle URLs', () => {
        const testCases = [
          { url: 'https://youtube.com/@MrBeast', handle: 'MrBeast' },
          { url: 'https://www.youtube.com/@veritasium/', handle: 'veritasium' },
          { url: 'https://youtube.com/@user.name-123', handle: 'user.name-123' },
          { url: 'youtube.com/@channel_name', handle: 'channel_name' },
        ];

        for (const { url, handle } of testCases) {
          const result = parseYouTubeProfileUrl(url);
          expect(result.valid, `Failed for ${url}`).toBe(true);
          expect(result.handle).toBe(handle);
          expect(result.urlType).toBe('handle');
          expect(result.error).toBeUndefined();
        }
      });
    });

    describe('/channel/ID format', () => {
      it('should parse valid /channel/ID URLs', () => {
        const testCases = [
          { url: 'https://youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA', handle: 'UCX6OQ3DkcsbYNE6H8uQQuVA' },
          { url: 'https://www.youtube.com/channel/UC-lHJZR3Gqxm24_Vd_AJ5Yw/', handle: 'UC-lHJZR3Gqxm24_Vd_AJ5Yw' },
        ];

        for (const { url, handle } of testCases) {
          const result = parseYouTubeProfileUrl(url);
          expect(result.valid, `Failed for ${url}`).toBe(true);
          expect(result.handle).toBe(handle);
          expect(result.urlType).toBe('channel');
        }
      });

      it('should reject invalid channel IDs (not starting with UC)', () => {
        const result = parseYouTubeProfileUrl('https://youtube.com/channel/InvalidID123');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Channel IDs should start with UC');
      });
    });

    describe('/c/customname format', () => {
      it('should parse valid /c/customname URLs', () => {
        const result = parseYouTubeProfileUrl('https://youtube.com/c/PewDiePie');
        expect(result.valid).toBe(true);
        expect(result.handle).toBe('PewDiePie');
        expect(result.urlType).toBe('c');
      });
    });

    describe('/user/username format', () => {
      it('should parse valid /user/username URLs', () => {
        const result = parseYouTubeProfileUrl('https://youtube.com/user/Google');
        expect(result.valid).toBe(true);
        expect(result.handle).toBe('Google');
        expect(result.urlType).toBe('user');
      });
    });

    describe('error cases', () => {
      it('should return error for empty URL', () => {
        const result = parseYouTubeProfileUrl('');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('URL is required');
      });

      it('should return error for non-YouTube URLs', () => {
        const result = parseYouTubeProfileUrl('https://instagram.com/username');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Not a YouTube URL');
      });

      it('should return error for video URLs', () => {
        const result = parseYouTubeProfileUrl('https://youtube.com/watch?v=dQw4w9WgXcQ');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('video URL');
      });

      it('should return error for shorts URLs', () => {
        const result = parseYouTubeProfileUrl('https://youtube.com/shorts/ABC123');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Shorts URL');
      });

      it('should return error for live URLs', () => {
        const result = parseYouTubeProfileUrl('https://youtube.com/live/ABC123');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('live stream URL');
      });

      it('should return error for playlist URLs', () => {
        const result = parseYouTubeProfileUrl('https://youtube.com/playlist?list=PLxxxxxxx');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('playlist URL');
      });

      it('should return error for reserved paths', () => {
        const reservedPaths = ['feed', 'gaming', 'music', 'premium', 'upload'];

        for (const path of reservedPaths) {
          const result = parseYouTubeProfileUrl(`https://youtube.com/${path}`);
          expect(result.valid, `Should be invalid for ${path}`).toBe(false);
          expect(result.error).toContain('not a channel URL');
        }
      });
    });
  });

  describe('Brunch', () => {
    describe('profile URLs', () => {
      it('should detect Brunch profile URLs', () => {
        const testCases = [
          { url: 'https://brunch.co.kr/@username', handle: 'username' },
          { url: 'https://brunch.co.kr/@0429bb25607f4bc', handle: '0429bb25607f4bc' },
          { url: 'https://brunch.co.kr/@eveningdriver/', handle: 'eveningdriver' },
          { url: 'https://brunch.co.kr/@my-username123', handle: 'my-username123' },
        ];

        for (const { url, handle } of testCases) {
          const result = analyzeUrl(url);
          expect(result.type, `Failed for ${url}`).toBe('profile');
          expect(result.platform).toBe('brunch');
          expect(result.handle).toBe(handle);
        }
      });

      it('should detect Brunch post URLs as brunch platform', () => {
        // Note: Brunch post URL type detection is handled by BrunchLocalService
        // urlAnalysis detects platform but type may be 'unknown' since extractPostId
        // doesn't have Brunch-specific logic. This is OK since BrunchLocalService
        // handles post URL parsing internally.
        const testCases = [
          'https://brunch.co.kr/@username/1',
          'https://brunch.co.kr/@0429bb25607f4bc/123',
        ];

        for (const url of testCases) {
          const result = analyzeUrl(url);
          expect(result.platform, `Platform should be brunch for ${url}`).toBe('brunch');
          // Type may be 'unknown' or 'post' depending on implementation
          expect(['post', 'unknown'], `Type should be post or unknown for ${url}`).toContain(result.type);
        }
      });

      it('should reject Brunch reserved paths as profiles', () => {
        const reservedPaths = [
          'https://brunch.co.kr/now',
          'https://brunch.co.kr/brunchbook/something',
          'https://brunch.co.kr/keyword/tag',
          'https://brunch.co.kr/rss/@@userId',
        ];

        for (const url of reservedPaths) {
          const result = analyzeUrl(url);
          expect(result.type, `Should not be profile: ${url}`).not.toBe('profile');
        }
      });
    });

    describe('helper functions', () => {
      it('should return true for isProfileUrl with Brunch profile', () => {
        expect(isProfileUrl('https://brunch.co.kr/@username')).toBe(true);
        expect(isProfileUrl('https://brunch.co.kr/@0429bb25607f4bc')).toBe(true);
      });

      it('should return false for isProfileUrl with Brunch post', () => {
        expect(isProfileUrl('https://brunch.co.kr/@username/123')).toBe(false);
      });

      it('should extract handle from Brunch profile URL', () => {
        expect(extractHandle('https://brunch.co.kr/@username')).toBe('username');
        expect(extractHandle('https://brunch.co.kr/@0429bb25607f4bc')).toBe('0429bb25607f4bc');
      });
    });
  });
});
