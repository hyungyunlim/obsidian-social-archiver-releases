import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownConverter } from '@/services/MarkdownConverter';
import { DateNumberFormatter } from '@/services/markdown/formatters/DateNumberFormatter';
import type { PostData, Platform } from '@/types/post';

describe('MarkdownConverter', () => {
  let converter: MarkdownConverter;

  const mockPostData: PostData = {
    platform: 'facebook' as Platform,
    id: 'test-123',
    url: 'https://facebook.com/post/123',
    author: {
      name: 'Test User',
      url: 'https://facebook.com/user/test',
      verified: true,
    },
    content: {
      text: 'This is a test post with **markdown**.',
    },
    media: [
      {
        type: 'image',
        url: 'https://example.com/image.jpg',
        altText: 'Test image',
      },
      {
        type: 'video',
        url: 'https://example.com/video.mp4',
        thumbnail: 'https://example.com/thumb.jpg',
      },
    ],
    metadata: {
      timestamp: new Date('2024-01-01T12:00:00Z'),
      likes: 100,
      comments: 50,
      shares: 25,
    },
    ai: {
      summary: 'This is a summary of the post',
      sentiment: 'positive',
      topics: ['tech', 'innovation'],
      language: 'en',
      readingTime: 1,
      factCheck: [
        {
          claim: 'AI is revolutionary',
          verdict: 'true',
          evidence: 'Multiple studies confirm',
          confidence: 0.95,
        },
      ],
    },
  };

  beforeEach(() => {
    converter = new MarkdownConverter();
  });

  describe('convert', () => {
    it('should convert PostData to MarkdownResult', async () => {
      const result = await converter.convert(mockPostData);

      expect(result).toBeDefined();
      expect(result.frontmatter).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.fullDocument).toBeDefined();
    });

    it('should generate correct frontmatter', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.frontmatter.platform).toBe('facebook');
      expect(result.frontmatter.author).toBe('Test User');
      expect(result.frontmatter.authorUrl).toBe('https://facebook.com/user/test');
      expect(result.frontmatter.originalUrl).toBe('https://facebook.com/post/123');
      expect(result.frontmatter.share).toBe(false);
      // Tags are user-managed (empty by default, no auto-generation)
      expect(result.frontmatter.tags).toEqual([]);
      expect(result.frontmatter.ai_summary).toBe('This is a summary of the post');
      expect(result.frontmatter.sentiment).toBe('positive');
    });

    it('should include platform in metadata footer', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.content).toContain('**Platform:** Facebook');
    });

    it('should include post text in content', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.content).toContain('This is a test post with **markdown**.');
    });

    it('should format media correctly', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.content).toContain('![Test image](https://example.com/image.jpg)');
      expect(result.content).toContain('[🎥 Video](https://example.com/video.mp4)');
    });

    it('should include metadata statistics', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.content).toContain('Likes:** 100');
      expect(result.content).toContain('Comments:** 50');
      expect(result.content).toContain('Shares:** 25');
    });

    it('should include AI analysis', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.content).toContain('🤖 AI Analysis');
      expect(result.content).toContain('**Summary:** This is a summary of the post');
      expect(result.content).toContain('**Sentiment:** positive');
      expect(result.content).toContain('**Topics:** tech, innovation');
    });

    it('should format fact checks correctly', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.content).toContain('Fact Checks');
      expect(result.content).toContain('AI is revolutionary');
      expect(result.content).toContain('Verdict: true');
      expect(result.content).toContain('Confidence: 95%');
      expect(result.content).toContain('Evidence: Multiple studies confirm');
    });

    it('should show verified badge for verified accounts', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.content).toContain('✓');
    });

    it('should generate full document with frontmatter', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.fullDocument).toMatch(/^---\n/);
      expect(result.fullDocument).toContain('platform: facebook');
      expect(result.fullDocument).toContain('author: Test User');
      expect(result.fullDocument).toMatch(/---\n\nThis is a test post/);
    });
  });

  describe('platform-specific templates', () => {
    it('should use LinkedIn template for LinkedIn posts', async () => {
      const linkedinPost = {
        ...mockPostData,
        platform: 'linkedin' as Platform,
      };

      const result = await converter.convert(linkedinPost);

      expect(result.content).toContain('LinkedIn');
      expect(result.content).toContain('Reactions:'); // LinkedIn-specific term
    });

    it('should use Instagram template for Instagram posts', async () => {
      const instagramPost = {
        ...mockPostData,
        platform: 'instagram' as Platform,
      };

      const result = await converter.convert(instagramPost);

      expect(result.content).toContain('Instagram');
    });

    it('should use TikTok template for TikTok posts', async () => {
      const tiktokPost = {
        ...mockPostData,
        platform: 'tiktok' as Platform,
        metadata: {
          ...mockPostData.metadata,
          views: 10000,
        },
      };

      const result = await converter.convert(tiktokPost);

      expect(result.content).toContain('TikTok');
      const formatter = new DateNumberFormatter();
      expect(result.content).toContain(`Views:** ${formatter.formatNumber(10000)}`);
    });

    it('should use X template for X posts', async () => {
      const xPost = {
        ...mockPostData,
        platform: 'x' as Platform,
      };

      const result = await converter.convert(xPost);

      expect(result.content).toContain('X (Twitter)');
      expect(result.content).toContain('Retweets:'); // X-specific term
    });

    it('should use Threads template for Threads posts', async () => {
      const threadsPost = {
        ...mockPostData,
        platform: 'threads' as Platform,
      };

      const result = await converter.convert(threadsPost);

      expect(result.content).toContain('Threads');
    });

    it('should include media section for user-created posts with attachments', async () => {
      const userPost: PostData = {
        platform: 'post',
        id: 'user-1',
        url: '',
        author: {
          name: 'User',
          url: '',
        },
        content: {
          text: 'Personal note with image',
        },
        media: [
          {
            type: 'image',
            url: 'attachments/social-archives/post/2024-03-15/image.png',
            altText: 'Screenshot',
          },
        ],
        metadata: {
          timestamp: new Date('2024-03-15T12:00:00Z'),
        },
      };

      const result = await converter.convert(userPost);

      expect(result.content).toContain('![Screenshot](attachments/social-archives/post/2024-03-15/image.png)');
      expect(result.content).toContain('**Author:** User | **Published:**');
    });
  });

  describe('frontmatter customization settings', () => {
    const createVisibility = (overrides: Partial<Record<
      'authorDetails' | 'engagement' | 'aiAnalysis' | 'externalLinks' | 'location' |
      'subscription' | 'seriesInfo' | 'podcastInfo' | 'reblogInfo' | 'mediaMetadata' | 'workflow',
      boolean
    >> = {}) => ({
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

    it('should apply constructor frontmatter settings', async () => {
      const customConverter = new MarkdownConverter({
        frontmatterSettings: {
          enabled: true,
          fieldVisibility: createVisibility({ engagement: false }),
          customProperties: [],
        },
      });

      const result = await customConverter.convert(mockPostData);

      expect(result.frontmatter.likes).toBeUndefined();
      expect(result.frontmatter.comments).toBeUndefined();
      expect(result.frontmatter.shares).toBeUndefined();
    });

    it('should apply runtime frontmatter settings updates', async () => {
      converter.setFrontmatterSettings({
        enabled: true,
        fieldVisibility: createVisibility(),
        customProperties: [
          { id: '1', key: 'source', value: '{{platform}}', enabled: true },
        ],
      });

      const result = await converter.convert(mockPostData);
      expect(result.frontmatter.source).toBe('facebook');
    });
  });

  describe('custom templates', () => {
    it('should use custom template when provided', async () => {
      const customTemplate = 'Custom: {{author.name}}\n\n{{content.text}}';

      const result = await converter.convert(mockPostData, customTemplate);

      expect(result.content).toContain('Custom: Test User');
      expect(result.content).not.toContain('**Platform:**');
    });

    it('should allow setting platform-specific custom template', async () => {
      const customTemplate = 'My Custom Template\n\n{{content.text}}';
      converter.setTemplate('facebook', customTemplate);

      const result = await converter.convert(mockPostData);

      expect(result.content).toContain('My Custom Template');
    });
  });

  describe('conditional rendering', () => {
    it('should show media section only if media exists', async () => {
      const postWithoutMedia = {
        ...mockPostData,
        media: [],
      };

      const result = await converter.convert(postWithoutMedia);

      // Content should start with text when no media
      expect(result.content).toMatch(/^This is a test post/);
    });

    it('should show comments section when comments exist', async () => {
      const postWithComments = {
        ...mockPostData,
        comments: [
          {
            id: 'comment-1',
            author: {
              name: 'Commenter',
              url: 'https://facebook.com/commenter',
              handle: 'commenter',
            },
            content: 'Great post!',
            timestamp: '2024-01-01T12:30:00Z',
            likes: 5,
          },
        ],
      };

      const result = await converter.convert(postWithComments);

      expect(result.content).toContain('💬 Comments');
      expect(result.content).toContain('@commenter');
      expect(result.content).toContain('Great post!');
      expect(result.content).toContain('5 likes');
    });

    it('should format nested comment replies with indentation', async () => {
      const postWithNestedComments = {
        ...mockPostData,
        comments: [
          {
            id: 'comment-1',
            author: {
              name: 'First Commenter',
              url: 'https://facebook.com/first',
              handle: 'first',
            },
            content: 'Original comment',
            timestamp: '2024-01-01T12:30:00Z',
            likes: 10,
            replies: [
              {
                id: 'reply-1',
                author: {
                  name: 'Replier',
                  url: 'https://facebook.com/replier',
                  handle: 'replier',
                },
                content: 'Reply to comment',
                timestamp: '2024-01-01T12:35:00Z',
                likes: 3,
              },
            ],
          },
        ],
      };

      const result = await converter.convert(postWithNestedComments);

      expect(result.content).toContain('💬 Comments');
      expect(result.content).toContain('@first');
      expect(result.content).toContain('Original comment');
      expect(result.content).toContain('↳ **@replier**');
      expect(result.content).toContain('Reply to comment');
    });

    it('should not show comments section when no comments', async () => {
      const postWithoutComments = {
        ...mockPostData,
        comments: undefined,
      };

      const result = await converter.convert(postWithoutComments);

      expect(result.content).not.toContain('💬 Comments');
    });

    it('should show AI section only if AI data exists', async () => {
      const postWithoutAI = {
        ...mockPostData,
        ai: undefined,
      };

      const result = await converter.convert(postWithoutAI);

      expect(result.content).not.toContain('🤖 AI Analysis');
    });

    it('should not show verified badge for unverified accounts', async () => {
      const unverifiedPost = {
        ...mockPostData,
        author: {
          ...mockPostData.author,
          verified: false,
        },
      };

      const result = await converter.convert(unverifiedPost);

      // Should not have verified checkmark in platform line
      expect(result.content).not.toMatch(/Facebook\s*✓/);
    });
  });

  describe('date formatting', () => {
    it('should format dates in ISO-like format by default', async () => {
      const result = await converter.convert(mockPostData);

      const formatter = new DateNumberFormatter();
      const expectedDate = formatter.formatDate(mockPostData.metadata.timestamp as Date);
      expect(result.content).toContain(expectedDate);
    });

    it('should use custom date formatter when set', async () => {
      converter.setDateFormat((date) => date.toLocaleDateString('en-US'));

      const result = await converter.convert(mockPostData);

      expect(result.content).toContain('1/1/2024');
    });
  });

  describe('markdown escaping', () => {
    it('should escape markdown special characters in alt text', async () => {
      const postWithSpecialChars = {
        ...mockPostData,
        media: [
          {
            type: 'image' as const,
            url: 'https://example.com/image.jpg',
            altText: 'Image with *asterisks* and [brackets]',
          },
        ],
      };

      const result = await converter.convert(postWithSpecialChars);

      expect(result.content).toContain('\\*asterisks\\*');
      expect(result.content).toContain('\\[brackets\\]');
    });
  });

  describe('YAML frontmatter formatting', () => {
    it('should format arrays correctly in YAML', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.fullDocument).toContain('tags:');
      expect(result.fullDocument).toContain('  - social/facebook');
      expect(result.fullDocument).toContain('  - topic/tech');
    });

    it('should quote values with special characters', async () => {
      const postWithSpecialUrl = {
        ...mockPostData,
        url: 'https://example.com/post#section:detail',
      };

      const result = await converter.convert(postWithSpecialUrl);

      expect(result.fullDocument).toMatch(/originalUrl: ".*#.*"/);
    });

    it('should omit undefined values from frontmatter', async () => {
      const result = await converter.convert(mockPostData);

      expect(result.fullDocument).not.toContain('shareUrl:');
      expect(result.fullDocument).not.toContain('sharePassword:');
    });
  });

  describe('media type formatting', () => {
    it('should format audio files correctly', async () => {
      const postWithAudio = {
        ...mockPostData,
        media: [
          {
            type: 'audio' as const,
            url: 'https://example.com/audio.mp3',
          },
        ],
      };

      const result = await converter.convert(postWithAudio);

      expect(result.content).toContain('[🎵 Audio](https://example.com/audio.mp3)');
    });

    it('should format documents correctly', async () => {
      const postWithDocument = {
        ...mockPostData,
        media: [
          {
            type: 'document' as const,
            url: 'https://example.com/doc.pdf',
          },
        ],
      };

      const result = await converter.convert(postWithDocument);

      expect(result.content).toContain('[📄 Document](https://example.com/doc.pdf)');
    });
  });

  describe('naver-webtoon platform', () => {
    const mockWebtoonPostData: PostData = {
      platform: 'naver-webtoon' as Platform,
      id: '819217-150',
      url: 'https://comic.naver.com/webtoon/detail?titleId=819217&no=150',
      title: '150화 - 새로운 시작',
      author: {
        name: '우투룹 / 낭천',
        url: 'https://comic.naver.com/webtoon/list?titleId=819217',
      },
      content: {
        text: '작가의 말: 많은 응원 감사합니다!',
      },
      media: [
        {
          type: 'image',
          url: 'https://image-comic.naver.com/webtoon/819217/150/01.jpg',
        },
      ],
      metadata: {
        timestamp: new Date('2024-12-15T10:00:00Z'),
      },
      series: {
        id: '819217',
        title: '귀환자의 마법은 특별해야 합니다',
        url: 'https://comic.naver.com/webtoon/list?titleId=819217',
        episode: 150,
        totalEpisodes: 200,
        starScore: 9.95,
        genre: ['판타지', '액션'],
        ageRating: '15세 이용가',
        finished: false,
        publishDay: '토요웹툰',
      },
    };

    it('should include series title and episode in header', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('## 📖 귀환자의 마법은 특별해야 합니다 — 150화');
    });

    it('should include genre in content', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('**Genre:** 판타지, 액션');
    });

    it('should include star score rating', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('**Rating:** ⭐ 9.95');
    });

    it('should include age rating', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('**Age Rating:** 15세 이용가');
    });

    it('should include publish day', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('**Publish Day:** 토요웹툰');
    });

    it('should include series link in footer', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('**Series:** [귀환자의 마법은 특별해야 합니다](https://comic.naver.com/webtoon/list?titleId=819217)');
    });

    it('should include episode count in footer', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('(Ep. 150/200)');
    });

    it('should include platform identifier', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('**Platform:** 📖 Naver Webtoon');
    });

    it('should include author in content', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('**Author:** 우투룹 / 낭천');
    });

    it('should include author comment (content.text)', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.content).toContain('작가의 말: 많은 응원 감사합니다!');
    });

    it('should generate correct frontmatter', async () => {
      const result = await converter.convert(mockWebtoonPostData);

      expect(result.frontmatter.platform).toBe('naver-webtoon');
      expect(result.frontmatter.series).toBe('귀환자의 마법은 특별해야 합니다');
      expect(result.frontmatter.episode).toBe(150);
      expect(result.frontmatter.totalEpisodes).toBe(200);
      expect(result.frontmatter.starScore).toBe(9.95);
      expect(result.frontmatter.genre).toEqual(['판타지', '액션']);
      expect(result.frontmatter.ageRating).toBe('15세 이용가');
      expect(result.frontmatter.finished).toBe(false);
      expect(result.frontmatter.publishDay).toBe('토요웹툰');
    });

    it('should handle webtoon without series info gracefully', async () => {
      const postWithoutSeries = {
        ...mockWebtoonPostData,
        series: undefined,
      };

      const result = await converter.convert(postWithoutSeries);

      expect(result.content).not.toContain('## 📖');
      expect(result.content).not.toContain('**Genre:**');
      expect(result.content).toContain('**Platform:** 📖 Naver Webtoon');
    });
  });
});
