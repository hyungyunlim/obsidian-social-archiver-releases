import { describe, it, expect } from 'vitest';
import { ProfileDataMapper } from '@/services/mappers/ProfileDataMapper';
import type { Platform } from '@/types/post';

describe('ProfileDataMapper', () => {
  describe('mapPlatformData', () => {
    describe('X (Twitter)', () => {
      it('should map X profile data correctly', () => {
        const rawData = {
          profile_image_link: 'https://example.com/avatar.jpg',
          followers: 23194,
          posts_count: 26743,
          biography: 'Test bio',
          verification_type: 'blue',
        };

        const result = ProfileDataMapper.mapPlatformData('x', rawData);

        expect(result.avatarUrl).toBe('https://example.com/avatar.jpg');
        expect(result.followers).toBe(23194);
        expect(result.postsCount).toBe(26743);
        expect(result.bio).toBe('Test bio');
        expect(result.verified).toBe(true);
      });

      it('should handle is_verified boolean for X', () => {
        const rawData = {
          is_verified: true,
          followers: 100,
        };

        const result = ProfileDataMapper.mapPlatformData('x', rawData);

        expect(result.verified).toBe(true);
      });

      it('should handle null profile_image_link for X', () => {
        const rawData = {
          profile_image_link: null,
          followers: 100,
          biography: 'Bio text',
        };

        const result = ProfileDataMapper.mapPlatformData('x', rawData);

        expect(result.avatarUrl).toBeNull();
        expect(result.followers).toBe(100);
        expect(result.bio).toBe('Bio text');
      });
    });

    describe('TikTok', () => {
      it('should map TikTok profile data correctly', () => {
        const rawData = {
          profile_avatar: 'https://example.com/tiktok-avatar.jpg',
          profile_followers: 111300,
          is_verified: false,
        };

        const result = ProfileDataMapper.mapPlatformData('tiktok', rawData);

        expect(result.avatarUrl).toBe('https://example.com/tiktok-avatar.jpg');
        expect(result.followers).toBe(111300);
        expect(result.postsCount).toBeNull(); // Not provided
        expect(result.bio).toBeNull();
        expect(result.verified).toBe(false);
      });

      it('should handle verified TikTok accounts', () => {
        const rawData = {
          profile_avatar: 'https://example.com/avatar.jpg',
          profile_followers: 5000000,
          is_verified: true,
        };

        const result = ProfileDataMapper.mapPlatformData('tiktok', rawData);

        expect(result.verified).toBe(true);
      });
    });

    describe('YouTube', () => {
      it('should map YouTube video response data correctly', () => {
        // Video response uses avatar_img_channel and lowercase description (which is video desc, not bio)
        const rawData = {
          avatar_img_channel: 'https://yt3.ggpht.com/avatar.jpg',
          subscribers: 77800,
          description: 'Video description (not channel bio)',
          verified: false,
        };

        const result = ProfileDataMapper.mapPlatformData('youtube', rawData);

        expect(result.avatarUrl).toBe('https://yt3.ggpht.com/avatar.jpg');
        expect(result.followers).toBe(77800);
        expect(result.postsCount).toBeNull();
        expect(result.bio).toBeNull(); // lowercase description is video desc, not channel bio
        expect(result.verified).toBe(false);
      });

      it('should map YouTube profile crawl response data correctly', () => {
        // Profile crawl uses profile_image, Description (capital D), and videos_count
        const rawData = {
          profile_image: 'https://yt3.googleusercontent.com/profile.jpg',
          subscribers: 35,
          Description: 'Channel bio from profile crawl',
          videos_count: 11,
          verified: true,
        };

        const result = ProfileDataMapper.mapPlatformData('youtube', rawData);

        expect(result.avatarUrl).toBe('https://yt3.googleusercontent.com/profile.jpg');
        expect(result.followers).toBe(35);
        expect(result.postsCount).toBe(11);
        expect(result.bio).toBe('Channel bio from profile crawl');
        expect(result.verified).toBe(true);
      });

      it('should prefer profile_image over avatar_img_channel', () => {
        const rawData = {
          profile_image: 'https://profile.jpg',
          avatar_img_channel: 'https://avatar_channel.jpg',
          subscribers: 100,
        };

        const result = ProfileDataMapper.mapPlatformData('youtube', rawData);

        expect(result.avatarUrl).toBe('https://profile.jpg');
      });

      it('should handle null Description gracefully', () => {
        const rawData = {
          profile_image: 'https://profile.jpg',
          subscribers: 50,
          Description: null,
          videos_count: 5,
        };

        const result = ProfileDataMapper.mapPlatformData('youtube', rawData);

        expect(result.bio).toBeNull();
        expect(result.postsCount).toBe(5);
      });
    });

    describe('Instagram', () => {
      it('should map Instagram profile data correctly', () => {
        const rawData = {
          profile_image_link: 'https://instagram.com/avatar.jpg',
          followers: 5248,
          posts_count: 437,
          is_verified: false,
        };

        const result = ProfileDataMapper.mapPlatformData('instagram', rawData);

        expect(result.avatarUrl).toBe('https://instagram.com/avatar.jpg');
        expect(result.followers).toBe(5248);
        expect(result.postsCount).toBe(437);
        expect(result.bio).toBeNull();
        expect(result.verified).toBe(false);
      });
    });

    describe('Facebook', () => {
      it('should map Facebook profile data with avatar_image_url', () => {
        const rawData = {
          avatar_image_url: 'https://facebook.com/avatar.jpg',
          page_followers: 4700,
          page_is_verified: false,
        };

        const result = ProfileDataMapper.mapPlatformData('facebook', rawData);

        expect(result.avatarUrl).toBe('https://facebook.com/avatar.jpg');
        expect(result.followers).toBe(4700);
        expect(result.verified).toBe(false);
      });

      it('should fall back to page_logo for avatar', () => {
        const rawData = {
          page_logo: 'https://facebook.com/page-logo.jpg',
          page_followers: 1000,
        };

        const result = ProfileDataMapper.mapPlatformData('facebook', rawData);

        expect(result.avatarUrl).toBe('https://facebook.com/page-logo.jpg');
      });

      it('should fall back to page_likes for followers', () => {
        const rawData = {
          avatar_image_url: 'https://facebook.com/avatar.jpg',
          page_likes: 5000,
        };

        const result = ProfileDataMapper.mapPlatformData('facebook', rawData);

        expect(result.followers).toBe(5000);
      });
    });

    describe('Threads', () => {
      it('should return null for avatar and followers (not provided)', () => {
        const rawData = {
          profile_name: '0xsojalsec',
          profile_url: 'https://www.threads.com/@0xsojalsec',
          bio: 'Some bio',
        };

        const result = ProfileDataMapper.mapPlatformData('threads', rawData);

        expect(result.avatarUrl).toBeNull();
        expect(result.followers).toBeNull();
        expect(result.postsCount).toBeNull();
        expect(result.bio).toBe('Some bio');
        expect(result.verified).toBe(false);
      });
    });

    describe('Pinterest', () => {
      it('should map Pinterest profile data correctly', () => {
        const rawData = {
          profile_picture: 'https://pinterest.com/avatar.jpg',
          follower_count: 147,
          boards_num: 10,
          about: 'Pinterest user',
        };

        const result = ProfileDataMapper.mapPlatformData('pinterest', rawData);

        expect(result.avatarUrl).toBe('https://pinterest.com/avatar.jpg');
        expect(result.followers).toBe(147);
        expect(result.postsCount).toBe(10);
        expect(result.bio).toBe('Pinterest user');
        expect(result.verified).toBe(false);
      });

      it('should handle followers field instead of follower_count', () => {
        const rawData = {
          followers: 200,
        };

        const result = ProfileDataMapper.mapPlatformData('pinterest', rawData);

        expect(result.followers).toBe(200);
      });
    });

    describe('Tumblr', () => {
      it('should map Tumblr profile data correctly', () => {
        const rawData = {
          author_avatar: 'https://tumblr.com/avatar.pnj',
          description: 'Tumblr blog description',
        };

        const result = ProfileDataMapper.mapPlatformData('tumblr', rawData);

        expect(result.avatarUrl).toBe('https://tumblr.com/avatar.pnj');
        expect(result.followers).toBeNull();
        expect(result.postsCount).toBeNull();
        expect(result.bio).toBe('Tumblr blog description');
        expect(result.verified).toBe(false);
      });
    });

    describe('Bluesky', () => {
      it('should map Bluesky profile data correctly', () => {
        const rawData = {
          author_avatar: 'https://cdn.bsky.app/avatar.jpeg',
          description: 'Bluesky bio',
        };

        const result = ProfileDataMapper.mapPlatformData('bluesky', rawData);

        expect(result.avatarUrl).toBe('https://cdn.bsky.app/avatar.jpeg');
        expect(result.followers).toBeNull();
        expect(result.postsCount).toBeNull();
        expect(result.bio).toBe('Bluesky bio');
        expect(result.verified).toBe(false);
      });
    });

    describe('Substack', () => {
      it('should map Substack profile data correctly', () => {
        const rawData = {
          author_image: 'https://substack.com/author.jpg',
          author_bio: 'Writer bio',
        };

        const result = ProfileDataMapper.mapPlatformData('substack', rawData);

        expect(result.avatarUrl).toBe('https://substack.com/author.jpg');
        expect(result.followers).toBeNull();
        expect(result.postsCount).toBeNull();
        expect(result.bio).toBe('Writer bio');
        expect(result.verified).toBe(false);
      });
    });

    describe('LinkedIn', () => {
      it('should map LinkedIn profile data correctly', () => {
        const rawData = {
          avatar_image_url: 'https://linkedin.com/avatar.jpg',
          page_followers: 1000,
          about: 'Professional bio',
        };

        const result = ProfileDataMapper.mapPlatformData('linkedin', rawData);

        expect(result.avatarUrl).toBe('https://linkedin.com/avatar.jpg');
        expect(result.followers).toBe(1000);
        expect(result.bio).toBe('Professional bio');
        expect(result.verified).toBe(false);
      });
    });

    describe('Mastodon', () => {
      it('should map Mastodon profile data correctly', () => {
        const rawData = {
          author_avatar: 'https://mastodon.social/avatar.png',
          followers_count: 500,
          statuses_count: 1200,
          note: 'Mastodon bio',
        };

        const result = ProfileDataMapper.mapPlatformData('mastodon', rawData);

        expect(result.avatarUrl).toBe('https://mastodon.social/avatar.png');
        expect(result.followers).toBe(500);
        expect(result.postsCount).toBe(1200);
        expect(result.bio).toBe('Mastodon bio');
        expect(result.verified).toBe(false);
      });

      it('should handle alternative field names', () => {
        const rawData = {
          profile_avatar: 'https://mastodon.social/avatar2.png',
          bio: 'Alternative bio field',
        };

        const result = ProfileDataMapper.mapPlatformData('mastodon', rawData);

        expect(result.avatarUrl).toBe('https://mastodon.social/avatar2.png');
        expect(result.bio).toBe('Alternative bio field');
      });
    });

    describe('User-created posts (post platform)', () => {
      it('should return empty profile for post platform', () => {
        const rawData = {
          author: 'User',
          content: 'Some content',
        };

        const result = ProfileDataMapper.mapPlatformData('post', rawData);

        expect(result.avatarUrl).toBeNull();
        expect(result.followers).toBeNull();
        expect(result.postsCount).toBeNull();
        expect(result.bio).toBeNull();
        expect(result.verified).toBe(false);
      });
    });

    describe('Unknown platform', () => {
      it('should return empty profile for unknown platform', () => {
        const rawData = {
          avatar: 'https://example.com/avatar.jpg',
          followers: 1000,
        };

        const result = ProfileDataMapper.mapPlatformData('unknown' as Platform, rawData);

        expect(result.avatarUrl).toBeNull();
        expect(result.followers).toBeNull();
        expect(result.postsCount).toBeNull();
        expect(result.bio).toBeNull();
        expect(result.verified).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle null rawData', () => {
        const result = ProfileDataMapper.mapPlatformData('x', null);

        expect(result.avatarUrl).toBeNull();
        expect(result.followers).toBeNull();
        expect(result.postsCount).toBeNull();
        expect(result.bio).toBeNull();
        expect(result.verified).toBe(false);
      });

      it('should handle undefined rawData', () => {
        const result = ProfileDataMapper.mapPlatformData('x', undefined);

        expect(result.avatarUrl).toBeNull();
        expect(result.followers).toBeNull();
      });

      it('should handle non-object rawData', () => {
        const result = ProfileDataMapper.mapPlatformData('x', 'not an object');

        expect(result.avatarUrl).toBeNull();
        expect(result.followers).toBeNull();
      });

      it('should handle empty string values', () => {
        const rawData = {
          profile_image_link: '',
          biography: '   ',
          followers: 100,
        };

        const result = ProfileDataMapper.mapPlatformData('x', rawData);

        expect(result.avatarUrl).toBeNull();
        expect(result.bio).toBeNull();
        expect(result.followers).toBe(100);
      });

      it('should handle string number values', () => {
        const rawData = {
          followers: '1000',
          posts_count: '500',
        };

        const result = ProfileDataMapper.mapPlatformData('x', rawData);

        expect(result.followers).toBe(1000);
        expect(result.postsCount).toBe(500);
      });

      it('should handle invalid number strings', () => {
        const rawData = {
          followers: 'not a number',
          posts_count: NaN,
        };

        const result = ProfileDataMapper.mapPlatformData('x', rawData);

        expect(result.followers).toBeNull();
        expect(result.postsCount).toBeNull();
      });

      it('should handle mixed valid and invalid data', () => {
        const rawData = {
          profile_image_link: 'https://example.com/avatar.jpg',
          followers: null,
          posts_count: undefined,
          biography: 'Valid bio',
          is_verified: 'not a boolean',
        };

        const result = ProfileDataMapper.mapPlatformData('x', rawData);

        expect(result.avatarUrl).toBe('https://example.com/avatar.jpg');
        expect(result.followers).toBeNull();
        expect(result.postsCount).toBeNull();
        expect(result.bio).toBe('Valid bio');
        expect(result.verified).toBe(false);
      });
    });

    describe('Real API response samples', () => {
      it('should handle real X API response', () => {
        // Based on docs/x.json
        const rawData = {
          id: '1987899008225026483',
          user_posted: 'danmusk4680',
          name: 'Dan Musk',
          followers: 23194,
          biography: '테슬라, 교육, 자유, 행복 / 제가 틀릴 수 있습니다 / NOT A FINANCIAL ADVISOR',
          posts_count: 26743,
          profile_image_link: null,
          verification_type: 'blue',
        };

        const result = ProfileDataMapper.mapPlatformData('x', rawData);

        expect(result.avatarUrl).toBeNull();
        expect(result.followers).toBe(23194);
        expect(result.postsCount).toBe(26743);
        expect(result.bio).toBe('테슬라, 교육, 자유, 행복 / 제가 틀릴 수 있습니다 / NOT A FINANCIAL ADVISOR');
        expect(result.verified).toBe(true);
      });

      it('should handle real TikTok API response', () => {
        // Based on docs/tiktok.json
        const rawData = {
          profile_id: '6895916520619590657',
          profile_username: 'Lê Trọng',
          profile_url: 'https://www.tiktok.com/@user3763491557765',
          profile_avatar: 'https://p16-common-sign.tiktokcdn-us.com/tos-alisg-avt-0068/avatar.jpeg',
          profile_followers: 111300,
          is_verified: false,
        };

        const result = ProfileDataMapper.mapPlatformData('tiktok', rawData);

        expect(result.avatarUrl).toBe('https://p16-common-sign.tiktokcdn-us.com/tos-alisg-avt-0068/avatar.jpeg');
        expect(result.followers).toBe(111300);
        expect(result.verified).toBe(false);
      });

      it('should handle real Instagram API response', () => {
        // Based on docs/Instagram - Posts_discover by url.json
        const rawData = {
          user_posted: 'stwey__',
          followers: 5248,
          posts_count: 437,
          profile_image_link: 'https://scontent.cdninstagram.com/avatar.jpg',
          is_verified: false,
        };

        const result = ProfileDataMapper.mapPlatformData('instagram', rawData);

        expect(result.avatarUrl).toBe('https://scontent.cdninstagram.com/avatar.jpg');
        expect(result.followers).toBe(5248);
        expect(result.postsCount).toBe(437);
        expect(result.verified).toBe(false);
      });

      it('should handle real Facebook API response', () => {
        // Based on docs/facebook.json
        const rawData = {
          user_username_raw: 'Martin Sae Hoon Oh',
          page_followers: 4700,
          page_is_verified: false,
          avatar_image_url: 'https://scontent-lga3-1.xx.fbcdn.net/avatar.jpg',
          page_logo: 'https://scontent.fprg3-1.fna.fbcdn.net/logo.jpg',
        };

        const result = ProfileDataMapper.mapPlatformData('facebook', rawData);

        expect(result.avatarUrl).toBe('https://scontent-lga3-1.xx.fbcdn.net/avatar.jpg');
        expect(result.followers).toBe(4700);
        expect(result.verified).toBe(false);
      });

      it('should handle real YouTube API response', () => {
        // Based on docs/youtube.json
        const rawData = {
          youtuber: '@thepark_woosung',
          handle_name: '정우성의 더파크 THE PARK',
          subscribers: 77800,
          avatar_img_channel: 'https://yt3.ggpht.com/avatar.jpg',
          verified: false,
          description: '00:00 지프를 해석하는 법...',
        };

        const result = ProfileDataMapper.mapPlatformData('youtube', rawData);

        expect(result.avatarUrl).toBe('https://yt3.ggpht.com/avatar.jpg');
        expect(result.followers).toBe(77800);
        expect(result.verified).toBe(false);
      });

      it('should handle real Tumblr API response', () => {
        // Based on docs/tumblr_output.json
        const rawData = {
          platform: 'tumblr',
          username: 'venicebitch-7',
          author_avatar: 'https://64.media.tumblr.com/avatar.pnj',
        };

        const result = ProfileDataMapper.mapPlatformData('tumblr', rawData);

        expect(result.avatarUrl).toBe('https://64.media.tumblr.com/avatar.pnj');
        expect(result.followers).toBeNull();
      });

      it('should handle real Bluesky API response', () => {
        // Based on docs/bluesky.json
        const rawData = {
          platform: 'bluesky',
          author_username: 'theverge.com',
          author_display_name: 'theverge.com',
          author_avatar: 'https://cdn.bsky.app/img/avatar_thumbnail/avatar.jpeg',
        };

        const result = ProfileDataMapper.mapPlatformData('bluesky', rawData);

        expect(result.avatarUrl).toBe('https://cdn.bsky.app/img/avatar_thumbnail/avatar.jpeg');
        expect(result.followers).toBeNull();
      });
    });
  });
});
