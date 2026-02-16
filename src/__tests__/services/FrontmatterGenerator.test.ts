/**
 * FrontmatterGenerator Tests
 *
 * Tests for extended author metadata fields in YAML frontmatter generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FrontmatterGenerator } from '../../services/markdown/frontmatter/FrontmatterGenerator';
import { DateNumberFormatter } from '../../services/markdown/formatters/DateNumberFormatter';
import { TextFormatter } from '../../services/markdown/formatters/TextFormatter';
import type { PostData } from '../../types/post';

describe('FrontmatterGenerator', () => {
  let generator: FrontmatterGenerator;
  let dateFormatter: DateNumberFormatter;
  let textFormatter: TextFormatter;

  beforeEach(() => {
    dateFormatter = new DateNumberFormatter();
    textFormatter = new TextFormatter();
    generator = new FrontmatterGenerator(dateFormatter, textFormatter);
  });

  /**
   * Create a minimal PostData object for testing
   */
  function createTestPostData(overrides: Partial<PostData> = {}): PostData {
    return {
      platform: 'x',
      id: 'test-123',
      url: 'https://twitter.com/testuser/status/123',
      author: {
        name: 'Test User',
        url: 'https://twitter.com/testuser',
        ...overrides.author,
      },
      content: {
        text: 'Test content',
        html: '<p>Test content</p>',
        hashtags: [],
        ...overrides.content,
      },
      media: [],
      metadata: {
        timestamp: new Date('2024-03-15T10:30:00Z'),
        ...overrides.metadata,
      },
      linkPreviews: [],
      ...overrides,
    } as PostData;
  }

  describe('extended author metadata fields', () => {
    describe('authorHandle', () => {
      it('should include authorHandle when handle is provided', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            handle: '@testuser',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorHandle).toBe('@testuser');
      });

      it('should omit authorHandle when handle is not provided', () => {
        const postData = createTestPostData();
        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorHandle).toBeUndefined();
      });

      it('should omit authorHandle when handle is empty string', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            handle: '',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorHandle).toBeUndefined();
      });
    });

    describe('authorAvatar (wikilink format)', () => {
      it('should include authorAvatar as wikilink when localAvatar is provided', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            localAvatar: 'attachments/authors/x-testuser.jpg',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorAvatar).toBe('[[attachments/authors/x-testuser.jpg]]');
      });

      it('should omit authorAvatar when localAvatar is not provided', () => {
        const postData = createTestPostData();
        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorAvatar).toBeUndefined();
      });

      it('should handle paths with special characters', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            localAvatar: 'attachments/authors/x-user name (1).jpg',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorAvatar).toBe('[[attachments/authors/x-user name (1).jpg]]');
      });
    });

    describe('authorFollowers', () => {
      it('should include authorFollowers when followers count is provided', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            followers: 12500,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorFollowers).toBe(12500);
      });

      it('should include authorFollowers when followers is 0', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            followers: 0,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorFollowers).toBe(0);
      });

      it('should omit authorFollowers when followers is null', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            followers: null as unknown as number,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorFollowers).toBeUndefined();
      });

      it('should omit authorFollowers when followers is undefined', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            followers: undefined,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorFollowers).toBeUndefined();
      });
    });

    describe('authorPostsCount', () => {
      it('should include authorPostsCount when postsCount is provided', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            postsCount: 500,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorPostsCount).toBe(500);
      });

      it('should include authorPostsCount when postsCount is 0', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            postsCount: 0,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorPostsCount).toBe(0);
      });

      it('should omit authorPostsCount when postsCount is null', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            postsCount: null as unknown as number,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorPostsCount).toBeUndefined();
      });
    });

    describe('authorBio', () => {
      it('should include authorBio when bio is provided', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            bio: 'Software developer and open source enthusiast.',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorBio).toBe('Software developer and open source enthusiast.');
      });

      it('should omit authorBio when bio is not provided', () => {
        const postData = createTestPostData();
        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorBio).toBeUndefined();
      });

      it('should omit authorBio when bio is empty string', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            bio: '',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorBio).toBeUndefined();
      });

      it('should truncate bio to 280 characters with ellipsis', () => {
        const longBio = 'A'.repeat(300);
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            bio: longBio,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorBio).toBe('A'.repeat(277) + '...');
        expect(frontmatter.authorBio.length).toBe(280);
      });

      it('should normalize newlines in bio', () => {
        const bioWithNewlines = 'Line 1\nLine 2\r\nLine 3';
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            bio: bioWithNewlines,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorBio).toBe('Line 1 Line 2 Line 3');
      });

      it('should normalize multiple spaces in bio', () => {
        const bioWithSpaces = 'Hello    World   Test';
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            bio: bioWithSpaces,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorBio).toBe('Hello World Test');
      });

      it('should handle bio with emoji', () => {
        const bioWithEmoji = '🚀 Building cool stuff! 💻';
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            bio: bioWithEmoji,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorBio).toBe('🚀 Building cool stuff! 💻');
      });
    });

    describe('authorVerified', () => {
      it('should include authorVerified: true when verified is true', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            verified: true,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorVerified).toBe(true);
      });

      it('should omit authorVerified when verified is false', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            verified: false,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorVerified).toBeUndefined();
      });

      it('should omit authorVerified when verified is undefined', () => {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            verified: undefined,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.authorVerified).toBeUndefined();
      });
    });
  });

  describe('all author fields populated', () => {
    it('should generate frontmatter with all author fields', () => {
      const postData = createTestPostData({
        author: {
          name: 'Complete User',
          url: 'https://twitter.com/completeuser',
          handle: '@completeuser',
          localAvatar: 'attachments/authors/x-completeuser.jpg',
          followers: 50000,
          postsCount: 1200,
          bio: 'Full-stack developer | Open source contributor',
          verified: true,
        },
      });

      const frontmatter = generator.generateFrontmatter(postData);

      expect(frontmatter.author).toBe('Complete User');
      expect(frontmatter.authorUrl).toBe('https://twitter.com/completeuser');
      expect(frontmatter.authorHandle).toBe('@completeuser');
      expect(frontmatter.authorAvatar).toBe('[[attachments/authors/x-completeuser.jpg]]');
      expect(frontmatter.authorFollowers).toBe(50000);
      expect(frontmatter.authorPostsCount).toBe(1200);
      expect(frontmatter.authorBio).toBe('Full-stack developer | Open source contributor');
      expect(frontmatter.authorVerified).toBe(true);
    });
  });

  describe('generateFullDocument', () => {
    it('should correctly serialize extended author fields to YAML', () => {
      const postData = createTestPostData({
        author: {
          name: 'Test User',
          url: 'https://twitter.com/testuser',
          handle: '@testuser',
          followers: 1000,
          bio: 'Developer',
          verified: true,
        },
      });

      const frontmatter = generator.generateFrontmatter(postData);
      const document = generator.generateFullDocument(frontmatter, 'Test content');

      // @ starts a YAML anchor/alias, so it must be quoted
      expect(document).toContain('authorHandle: "@testuser"');
      expect(document).toContain('authorFollowers: 1000');
      expect(document).toContain('authorBio: Developer');
      expect(document).toContain('authorVerified: true');
    });

    it('should handle bio with YAML special characters', () => {
      const postData = createTestPostData({
        author: {
          name: 'Test User',
          url: 'https://twitter.com/testuser',
          bio: 'Code: Python # Developer',
        },
      });

      const frontmatter = generator.generateFrontmatter(postData);
      const document = generator.generateFullDocument(frontmatter, 'Test content');

      // Bio should be quoted because it contains colon and hash
      expect(document).toContain('authorBio: "Code: Python # Developer"');
    });

    it('should quote bio containing single quotes to prevent YAML parsing errors', () => {
      const postData = createTestPostData({
        author: {
          name: 'Test User',
          url: 'https://twitter.com/testuser',
          bio: "'리버럴 아재' 테크와 미디어 이야기합니다. Profile · Blogger",
        },
      });

      const frontmatter = generator.generateFrontmatter(postData);
      const document = generator.generateFullDocument(frontmatter, 'Test content');

      // Bio with single quotes must be double-quoted to prevent YAML misinterpretation
      expect(document).toContain("authorBio: \"'리버럴 아재' 테크와 미디어 이야기합니다. Profile · Blogger\"");
    });

    it('should quote bio containing double quotes and escape them', () => {
      const postData = createTestPostData({
        author: {
          name: 'Test User',
          url: 'https://twitter.com/testuser',
          bio: 'Said "hello world" to everyone',
        },
      });

      const frontmatter = generator.generateFrontmatter(postData);
      const document = generator.generateFullDocument(frontmatter, 'Test content');

      // Double quotes inside bio must be escaped with backslash
      expect(document).toContain('authorBio: "Said \\"hello world\\" to everyone"');
    });

    it('should quote values starting with YAML special indicators', () => {
      const testCases = [
        { bio: '!important person', desc: 'exclamation (YAML tag)' },
        { bio: '&anchor ref', desc: 'ampersand (YAML anchor)' },
        { bio: '*star developer', desc: 'asterisk (YAML alias)' },
        { bio: '| pipe character bio', desc: 'pipe (YAML block scalar)' },
        { bio: '> folded text bio', desc: 'greater-than (YAML folded scalar)' },
        { bio: '%directive text', desc: 'percent (YAML directive)' },
      ];

      for (const { bio, desc } of testCases) {
        const postData = createTestPostData({
          author: {
            name: 'Test User',
            url: 'https://twitter.com/testuser',
            bio,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        const document = generator.generateFullDocument(frontmatter, 'Test content');

        // Value must be double-quoted
        expect(document).toContain(`authorBio: "${bio}"`, `Failed for: ${desc}`);
      }
    });

    it('should quote title that starts with brackets to prevent YAML array parsing', () => {
      const postData = createTestPostData({
        title: '[백패킹 텐트] 싱글월 동계 텐트 테스트',
      });

      const frontmatter = generator.generateFrontmatter(postData);
      const document = generator.generateFullDocument(frontmatter, 'Test content');

      // Title starting with [ must be quoted to prevent YAML interpreting it as array
      expect(document).toContain('title: "[백패킹 텐트] 싱글월 동계 텐트 테스트"');
    });

    it('should quote title that starts with curly braces', () => {
      const postData = createTestPostData({
        title: '{special} title with braces',
      });

      const frontmatter = generator.generateFrontmatter(postData);
      const document = generator.generateFullDocument(frontmatter, 'Test content');

      // Title starting with { must be quoted to prevent YAML interpreting it as object
      expect(document).toContain('title: "{special} title with braces"');
    });
  });

  describe('backward compatibility', () => {
    it('should preserve existing author and authorUrl fields', () => {
      const postData = createTestPostData({
        author: {
          name: 'Legacy User',
          url: 'https://twitter.com/legacyuser',
        },
      });

      const frontmatter = generator.generateFrontmatter(postData);

      // Existing fields should still work
      expect(frontmatter.author).toBe('Legacy User');
      expect(frontmatter.authorUrl).toBe('https://twitter.com/legacyuser');

      // New fields should be omitted when not provided
      expect(frontmatter.authorHandle).toBeUndefined();
      expect(frontmatter.authorAvatar).toBeUndefined();
      expect(frontmatter.authorFollowers).toBeUndefined();
      expect(frontmatter.authorPostsCount).toBeUndefined();
      expect(frontmatter.authorBio).toBeUndefined();
      expect(frontmatter.authorVerified).toBeUndefined();
    });

    it('should include all standard frontmatter fields', () => {
      const postData = createTestPostData();
      const frontmatter = generator.generateFrontmatter(postData);

      expect(frontmatter.share).toBe(false);
      expect(frontmatter.platform).toBe('x');
      expect(frontmatter.published).toBeDefined();
      expect(frontmatter.archived).toBeDefined();
      expect(frontmatter.lastModified).toBeDefined();
      expect(frontmatter.archive).toBe(false);
      expect(frontmatter.tags).toBeDefined();
      expect(Array.isArray(frontmatter.tags)).toBe(true);
    });
  });

  describe('platform-specific scenarios', () => {
    it('should handle Instagram post with handle', () => {
      const postData = createTestPostData({
        platform: 'instagram',
        author: {
          name: 'Instagram User',
          url: 'https://instagram.com/instauser',
          handle: '@instauser',
          followers: 25000,
        },
      });

      const frontmatter = generator.generateFrontmatter(postData);
      expect(frontmatter.platform).toBe('instagram');
      expect(frontmatter.authorHandle).toBe('@instauser');
      expect(frontmatter.authorFollowers).toBe(25000);
    });

    it('should handle TikTok post with bio', () => {
      const postData = createTestPostData({
        platform: 'tiktok',
        author: {
          name: 'TikTok Creator',
          url: 'https://tiktok.com/@tiktoker',
          handle: '@tiktoker',
          bio: 'Creating fun content! 🎬',
          followers: 100000,
          postsCount: 250,
        },
      });

      const frontmatter = generator.generateFrontmatter(postData);
      expect(frontmatter.platform).toBe('tiktok');
      expect(frontmatter.authorBio).toBe('Creating fun content! 🎬');
      expect(frontmatter.authorPostsCount).toBe(250);
    });
  });

  describe('series fields', () => {
    describe('basic series info', () => {
      it('should include series title when provided', () => {
        const postData = createTestPostData({
          series: {
            id: 'series-123',
            title: 'My Series',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.series).toBe('My Series');
        expect(frontmatter.seriesId).toBe('series-123');
      });

      it('should include series URL when provided', () => {
        const postData = createTestPostData({
          series: {
            id: 'series-123',
            title: 'My Series',
            url: 'https://example.com/series/123',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.seriesUrl).toBe('https://example.com/series/123');
      });

      it('should include episode number when provided', () => {
        const postData = createTestPostData({
          series: {
            id: 'series-123',
            title: 'My Series',
            episode: 5,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.episode).toBe(5);
      });

      it('should include totalEpisodes when provided', () => {
        const postData = createTestPostData({
          series: {
            id: 'series-123',
            title: 'My Series',
            totalEpisodes: 50,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.totalEpisodes).toBe(50);
      });

      it('should omit series fields when series is undefined', () => {
        const postData = createTestPostData();
        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.series).toBeUndefined();
        expect(frontmatter.seriesId).toBeUndefined();
        expect(frontmatter.seriesUrl).toBeUndefined();
      });
    });

    describe('webtoon-specific fields', () => {
      it('should include starScore when provided', () => {
        const postData = createTestPostData({
          platform: 'naver-webtoon',
          series: {
            id: '123456',
            title: '산군',
            starScore: 9.87,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.starScore).toBe(9.87);
      });

      it('should include starScore of 0', () => {
        const postData = createTestPostData({
          platform: 'naver-webtoon',
          series: {
            id: '123456',
            title: '산군',
            starScore: 0,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.starScore).toBe(0);
      });

      it('should include genre array when provided', () => {
        const postData = createTestPostData({
          platform: 'naver-webtoon',
          series: {
            id: '123456',
            title: '산군',
            genre: ['판타지', '액션', '드라마'],
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.genre).toEqual(['판타지', '액션', '드라마']);
      });

      it('should omit genre when empty array', () => {
        const postData = createTestPostData({
          platform: 'naver-webtoon',
          series: {
            id: '123456',
            title: '산군',
            genre: [],
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.genre).toBeUndefined();
      });

      it('should include ageRating when provided', () => {
        const postData = createTestPostData({
          platform: 'naver-webtoon',
          series: {
            id: '123456',
            title: '산군',
            ageRating: '15세 이용가',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.ageRating).toBe('15세 이용가');
      });

      it('should include finished flag when true', () => {
        const postData = createTestPostData({
          platform: 'naver-webtoon',
          series: {
            id: '123456',
            title: '산군',
            finished: true,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.finished).toBe(true);
      });

      it('should include finished flag when false', () => {
        const postData = createTestPostData({
          platform: 'naver-webtoon',
          series: {
            id: '123456',
            title: '산군',
            finished: false,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.finished).toBe(false);
      });

      it('should include publishDay when provided', () => {
        const postData = createTestPostData({
          platform: 'naver-webtoon',
          series: {
            id: '123456',
            title: '산군',
            publishDay: '토요웹툰',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);
        expect(frontmatter.publishDay).toBe('토요웹툰');
      });
    });

    describe('complete webtoon series', () => {
      it('should generate frontmatter with all webtoon fields', () => {
        const postData = createTestPostData({
          platform: 'naver-webtoon',
          author: {
            name: '윤태호',
            url: 'https://comic.naver.com/artistTitle?id=1234',
          },
          series: {
            id: '123456',
            title: '산군',
            url: 'https://comic.naver.com/webtoon/list?titleId=123456',
            episode: 10,
            totalEpisodes: 100,
            starScore: 9.87,
            genre: ['판타지', '액션'],
            ageRating: '15세 이용가',
            finished: false,
            publishDay: '토요웹툰',
          },
        });

        const frontmatter = generator.generateFrontmatter(postData);

        expect(frontmatter.platform).toBe('naver-webtoon');
        expect(frontmatter.series).toBe('산군');
        expect(frontmatter.seriesId).toBe('123456');
        expect(frontmatter.seriesUrl).toBe('https://comic.naver.com/webtoon/list?titleId=123456');
        expect(frontmatter.episode).toBe(10);
        expect(frontmatter.totalEpisodes).toBe(100);
        expect(frontmatter.starScore).toBe(9.87);
        expect(frontmatter.genre).toEqual(['판타지', '액션']);
        expect(frontmatter.ageRating).toBe('15세 이용가');
        expect(frontmatter.finished).toBe(false);
        expect(frontmatter.publishDay).toBe('토요웹툰');
      });
    });

    describe('frontmatter customization', () => {
      const createVisibility = (
        overrides: Partial<Record<
          'authorDetails' | 'engagement' | 'aiAnalysis' | 'externalLinks' | 'location' |
          'subscription' | 'seriesInfo' | 'podcastInfo' | 'reblogInfo' | 'mediaMetadata' | 'workflow',
          boolean
        >> = {}
      ) => ({
        authorDetails: true,
        engagement: true,
        aiAnalysis: true,
        externalLinks: true,
        location: true,
        subscription: true,
        seriesInfo: true,
        podcastInfo: true,
        reblogInfo: true,
        mediaMetadata: true,
        workflow: true,
        ...overrides,
      });

      it('should hide engagement fields when engagement visibility is disabled', () => {
        const postData = createTestPostData({
          metadata: {
            timestamp: new Date('2024-03-15T10:30:00Z'),
            likes: 10,
            comments: 4,
            shares: 2,
            views: 100,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility({ engagement: false }),
            customProperties: [],
          },
        });

        expect(frontmatter.likes).toBeUndefined();
        expect(frontmatter.comments).toBeUndefined();
        expect(frontmatter.shares).toBeUndefined();
        expect(frontmatter.views).toBeUndefined();
      });

      it('should add custom properties with template variables', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [
              { id: '1', key: 'source', value: '{{platform}}', enabled: true },
              { id: '2', key: 'author_name', value: '{{author.name}}', enabled: true },
            ],
          },
        });

        expect(frontmatter.source).toBe('x');
        expect(frontmatter.author_name).toBe('Test User');
      });

      it('should not override core locked fields with custom properties', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [
              { id: '1', key: 'platform', value: 'custom-platform', enabled: true },
            ],
          },
        });

        expect(frontmatter.platform).toBe('x');
      });

      it('should ignore invalid custom property keys', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [
              { id: '1', key: 'bad key', value: 'value', enabled: true },
            ],
          },
        });

        expect((frontmatter as any)['bad key']).toBeUndefined();
      });

      it('should use checkbox value when template override is empty', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [
              { id: '1', key: 'reviewed', type: 'checkbox', checked: true, value: '', enabled: true },
            ],
          },
        });

        expect(frontmatter.reviewed).toBe(true);
      });

      it('should prioritize checkbox template override when provided', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [
              {
                id: '1',
                key: 'reviewed',
                type: 'checkbox',
                checked: false,
                template: 'true',
                value: '',
                enabled: true
              },
            ],
          },
        });

        expect(frontmatter.reviewed).toBe(true);
      });

      it('should use date picker value for date type when template override is empty', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [
              { id: '1', key: 'dueDate', type: 'date', dateValue: '2026-02-12', value: '', enabled: true },
            ],
          },
        });

        expect(frontmatter.dueDate).toBe('2026-02-12');
      });

      it('should convert list type into YAML array values', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [
              {
                id: '1',
                key: 'labels',
                type: 'list',
                value: 'inbox\n{{platform}}\nimportant',
                enabled: true
              },
            ],
          },
        });

        expect(frontmatter.labels).toEqual(['inbox', 'x', 'important']);
      });

      it('should convert number type to number when possible', () => {
        const postData = createTestPostData({ id: '42' });

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [
              { id: '1', key: 'priority', type: 'number', value: '{{post.id}}', enabled: true },
            ],
          },
        });

        expect(frontmatter.priority).toBe(42);
      });

      it('should apply configured property order for default and custom keys', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [
              { id: '1', key: 'source', value: '{{platform}}', enabled: true },
            ],
            propertyOrder: ['platform', 'author', 'source', 'tags'],
          },
        });

        const keys = Object.keys(frontmatter);
        expect(keys[0]).toBe('platform');
        expect(keys[1]).toBe('author');
        expect(keys[2]).toBe('source');
        expect(keys[3]).toBe('tags');
      });

      it('should rename default keys using field aliases', () => {
        const postData = createTestPostData({
          metadata: {
            timestamp: new Date('2024-03-15T10:30:00Z'),
            likes: 42,
            comments: 7,
          },
        });

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [],
            fieldAliases: {
              likes: 'jaimeCount',
              comments: 'commentCountLocalized',
            },
            propertyOrder: ['likes', 'comments', 'author'],
          },
        });

        expect(frontmatter.likes).toBeUndefined();
        expect(frontmatter.comments).toBeUndefined();
        expect(frontmatter.jaimeCount).toBe(42);
        expect(frontmatter.commentCountLocalized).toBe(7);
        expect(Object.keys(frontmatter)[0]).toBe('jaimeCount');
        expect(Object.keys(frontmatter)[1]).toBe('commentCountLocalized');
      });

      it('should ignore alias mapping for core locked fields', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [],
            fieldAliases: {
              platform: 'source',
              archived: 'savedAt',
            },
          },
        });

        expect(frontmatter.platform).toBe('x');
        expect(frontmatter.archived).toBeDefined();
        expect((frontmatter as any).source).toBeUndefined();
        expect((frontmatter as any).savedAt).toBeUndefined();
      });

      it('should generate flat archive tag when tag structure is flat', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [],
            tagRoot: '#maintag',
            tagOrganization: 'flat',
          },
        });

        expect(frontmatter.tags).toEqual(['maintag']);
      });

      it('should generate platform-only archive tag when configured', () => {
        const postData = createTestPostData();

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [],
            tagRoot: 'maintag',
            tagOrganization: 'platform-only',
          },
        });

        expect(frontmatter.tags).toEqual(['maintag/x']);
      });

      it('should generate platform-year-month archive tag when configured', () => {
        const postData = createTestPostData({
          metadata: {
            timestamp: new Date('2024-03-15T10:30:00Z'),
          },
        });

        const frontmatter = generator.generateFrontmatter(postData, {
          customization: {
            enabled: true,
            fieldVisibility: createVisibility(),
            customProperties: [],
            tagRoot: 'maintag',
            tagOrganization: 'platform-year-month',
          },
        });

        expect(frontmatter.tags).toEqual(['maintag/x/2024/03']);
      });
    });
  });
});
