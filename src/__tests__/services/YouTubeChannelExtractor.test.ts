/**
 * YouTube Channel Extractor Service Tests
 *
 * Tests the extraction of YouTube Channel ID from various URL formats
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  extractYouTubeChannelInfo,
  isLikelyYouTubeProfileUrl,
} from '@/services/YouTubeChannelExtractor';

// Mock Obsidian's requestUrl
const mockRequestUrl = vi.fn();

vi.mock('obsidian', () => ({
  requestUrl: (params: { url: string }) => mockRequestUrl(params),
}));

// Sample HTML responses for testing
const createMockHtmlWithChannelId = (
  channelId: string,
  channelName: string
) => `
<!DOCTYPE html>
<html>
<head>
  <title>${channelName} - YouTube</title>
</head>
<body>
  <link rel="canonical" href="https://www.youtube.com/channel/${channelId}">
  <meta property="og:url" content="https://www.youtube.com/channel/${channelId}">
  <script>{"browseId":"${channelId}"}</script>
</body>
</html>
`;

const MOCK_CHANNEL_ID = 'UCX6OQ3DkcsbYNE6H8uQQuVA';
const MOCK_CHANNEL_NAME = 'MrBeast';

describe('YouTubeChannelExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractYouTubeChannelInfo', () => {
    describe('@handle URL format', () => {
      it('should extract channel info from @handle URL', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: createMockHtmlWithChannelId(MOCK_CHANNEL_ID, MOCK_CHANNEL_NAME),
        });

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/@MrBeast'
        );

        expect(result).not.toBeNull();
        expect(result?.channelId).toBe(MOCK_CHANNEL_ID);
        expect(result?.channelName).toBe(MOCK_CHANNEL_NAME);
        expect(result?.rssFeedUrl).toBe(
          `https://www.youtube.com/feeds/videos.xml?channel_id=${MOCK_CHANNEL_ID}`
        );
      });

      it('should handle @handle URL without www', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: createMockHtmlWithChannelId(MOCK_CHANNEL_ID, MOCK_CHANNEL_NAME),
        });

        const result = await extractYouTubeChannelInfo(
          'https://youtube.com/@TestChannel'
        );

        expect(result).not.toBeNull();
        expect(result?.channelId).toBe(MOCK_CHANNEL_ID);
      });

      it('should handle @handle URL without protocol', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: createMockHtmlWithChannelId(MOCK_CHANNEL_ID, MOCK_CHANNEL_NAME),
        });

        const result = await extractYouTubeChannelInfo(
          'youtube.com/@TestChannel'
        );

        expect(result).not.toBeNull();
        expect(mockRequestUrl).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://youtube.com/@TestChannel',
          })
        );
      });
    });

    describe('/channel/ID URL format', () => {
      it('should extract channel info from /channel/ID URL', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: createMockHtmlWithChannelId(MOCK_CHANNEL_ID, MOCK_CHANNEL_NAME),
        });

        const result = await extractYouTubeChannelInfo(
          `https://www.youtube.com/channel/${MOCK_CHANNEL_ID}`
        );

        expect(result).not.toBeNull();
        expect(result?.channelId).toBe(MOCK_CHANNEL_ID);
      });
    });

    describe('/c/customname URL format', () => {
      it('should extract channel info from /c/customname URL', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: createMockHtmlWithChannelId(MOCK_CHANNEL_ID, 'Linus Tech Tips'),
        });

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/c/LinusTechTips'
        );

        expect(result).not.toBeNull();
        expect(result?.channelId).toBe(MOCK_CHANNEL_ID);
        expect(result?.channelName).toBe('Linus Tech Tips');
      });
    });

    describe('/user/username URL format', () => {
      it('should extract channel info from /user/username URL', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: createMockHtmlWithChannelId(MOCK_CHANNEL_ID, 'Google'),
        });

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/user/Google'
        );

        expect(result).not.toBeNull();
        expect(result?.channelId).toBe(MOCK_CHANNEL_ID);
      });
    });

    describe('error handling', () => {
      it('should return null when channel ID not found in HTML', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: '<html><head><title>Page</title></head><body>No channel info</body></html>',
        });

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/@Unknown'
        );

        expect(result).toBeNull();
      });

      it('should return null on network error', async () => {
        mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/@MrBeast'
        );

        expect(result).toBeNull();
      });

      it('should return null on 404 response', async () => {
        mockRequestUrl.mockRejectedValueOnce(new Error('Status 404'));

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/@NonExistentChannel'
        );

        expect(result).toBeNull();
      });
    });

    describe('channel name extraction', () => {
      it('should extract channel name from title tag', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: createMockHtmlWithChannelId(MOCK_CHANNEL_ID, 'Test Channel'),
        });

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/@TestChannel'
        );

        expect(result?.channelName).toBe('Test Channel');
      });

      it('should handle title without " - YouTube" suffix', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: `
            <html>
            <head><title>Just A Title</title></head>
            <body>
              <link href="https://www.youtube.com/channel/${MOCK_CHANNEL_ID}">
            </body>
            </html>
          `,
        });

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/@Test'
        );

        expect(result?.channelName).toBe('Just A Title');
      });

      it('should handle missing title tag', async () => {
        mockRequestUrl.mockResolvedValueOnce({
          text: `
            <html>
            <head></head>
            <body>
              <link href="https://www.youtube.com/channel/${MOCK_CHANNEL_ID}">
            </body>
            </html>
          `,
        });

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/@Test'
        );

        expect(result?.channelId).toBe(MOCK_CHANNEL_ID);
        expect(result?.channelName).toBeUndefined();
      });
    });

    describe('RSS feed URL generation', () => {
      it('should generate correct RSS feed URL', async () => {
        const testChannelId = 'UCsT0YIqwnpJCM-mx7-gSA4Q';
        mockRequestUrl.mockResolvedValueOnce({
          text: createMockHtmlWithChannelId(testChannelId, 'TEDx Talks'),
        });

        const result = await extractYouTubeChannelInfo(
          'https://www.youtube.com/@TEDxTalks'
        );

        expect(result?.rssFeedUrl).toBe(
          `https://www.youtube.com/feeds/videos.xml?channel_id=${testChannelId}`
        );
      });
    });
  });

  describe('isLikelyYouTubeProfileUrl', () => {
    it('should return true for @handle URLs', () => {
      expect(isLikelyYouTubeProfileUrl('https://www.youtube.com/@MrBeast')).toBe(
        true
      );
    });

    it('should return true for /channel/ID URLs', () => {
      expect(
        isLikelyYouTubeProfileUrl(
          'https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA'
        )
      ).toBe(true);
    });

    it('should return true for /c/customname URLs', () => {
      expect(
        isLikelyYouTubeProfileUrl('https://www.youtube.com/c/LinusTechTips')
      ).toBe(true);
    });

    it('should return true for /user/username URLs', () => {
      expect(
        isLikelyYouTubeProfileUrl('https://www.youtube.com/user/Google')
      ).toBe(true);
    });

    it('should return false for video URLs', () => {
      expect(
        isLikelyYouTubeProfileUrl(
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
        )
      ).toBe(false);
    });

    it('should return false for shorts URLs', () => {
      expect(
        isLikelyYouTubeProfileUrl('https://www.youtube.com/shorts/abc123')
      ).toBe(false);
    });

    it('should return false for live URLs', () => {
      expect(
        isLikelyYouTubeProfileUrl('https://www.youtube.com/live/xyz789')
      ).toBe(false);
    });

    it('should return false for playlist URLs', () => {
      expect(
        isLikelyYouTubeProfileUrl(
          'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'
        )
      ).toBe(false);
    });

    it('should return false for embed URLs', () => {
      expect(
        isLikelyYouTubeProfileUrl(
          'https://www.youtube.com/embed/dQw4w9WgXcQ'
        )
      ).toBe(false);
    });

    it('should return false for non-YouTube URLs', () => {
      expect(isLikelyYouTubeProfileUrl('https://www.instagram.com/@user')).toBe(
        false
      );
    });
  });
});
