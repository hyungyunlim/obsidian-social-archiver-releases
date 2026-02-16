import { describe, it, expect } from 'vitest';
import { CdnExpiryDetector } from '@/services/CdnExpiryDetector';

describe('CdnExpiryDetector', () => {
  describe('isEphemeralCdn', () => {
    describe('Ephemeral CDN domains', () => {
      it('should detect cdninstagram.com', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/12345.jpg')).toBe(true);
        expect(CdnExpiryDetector.isEphemeralCdn('https://cdninstagram.com/image.jpg')).toBe(true);
      });

      it('should detect fbcdn.net', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://scontent.fbcdn.net/v/t1.0-9/12345.jpg')).toBe(true);
        expect(CdnExpiryDetector.isEphemeralCdn('https://external.fbcdn.net/safe_image.php?d=AQB')).toBe(true);
      });

      it('should detect twimg.com', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://pbs.twimg.com/media/abc123.jpg')).toBe(true);
        expect(CdnExpiryDetector.isEphemeralCdn('https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/abc.mp4')).toBe(true);
      });

      it('should detect tiktokcdn.com', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://v16-web.tiktokcdn.com/video/tos/abc/12345.mp4')).toBe(true);
        expect(CdnExpiryDetector.isEphemeralCdn('https://p16-sign.tiktokcdn.com/obj/tos-useast2a-p-0037/abc123')).toBe(true);
      });

      it('should detect tiktokcdn-us.com', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://v16m.tiktokcdn-us.com/video/tos/useast2a/12345.mp4')).toBe(true);
      });

      it('should detect tiktok.com', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://www.tiktok.com/video/12345')).toBe(true);
        expect(CdnExpiryDetector.isEphemeralCdn('https://m.tiktok.com/v/12345')).toBe(true);
      });

      it('should detect licdn.com', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://media.licdn.com/dms/image/D4E22AQH123/feedshare-shrink_800/0/')).toBe(true);
        expect(CdnExpiryDetector.isEphemeralCdn('https://static.licdn.com/aero-v1/sc/h/abc123')).toBe(true);
      });
    });

    describe('Stable CDN domains', () => {
      it('should not detect bsky.app (Bluesky)', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/xyz@jpeg')).toBe(false);
      });

      it('should not detect masto.host (Mastodon)', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://files.masto.host/media_attachments/files/123/456/789/original/abc.jpg')).toBe(false);
      });

      it('should not detect imgur.com', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://i.imgur.com/abc123.jpg')).toBe(false);
      });

      it('should not detect youtube.com', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://i.ytimg.com/vi/abc123/maxresdefault.jpg')).toBe(false);
      });

      it('should not detect reddit media domains', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://i.redd.it/abc123.jpg')).toBe(false);
        expect(CdnExpiryDetector.isEphemeralCdn('https://preview.redd.it/abc123.png')).toBe(false);
      });

      it('should not detect generic CDN domains', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://cdn.example.com/image.jpg')).toBe(false);
        expect(CdnExpiryDetector.isEphemeralCdn('https://cloudfront.net/media/abc.jpg')).toBe(false);
      });
    });

    describe('Invalid URLs', () => {
      it('should return false for malformed URLs', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('not-a-valid-url')).toBe(false);
        expect(CdnExpiryDetector.isEphemeralCdn('htp://broken.com')).toBe(false);
        expect(CdnExpiryDetector.isEphemeralCdn('')).toBe(false);
      });

      it('should return false for URLs without protocol', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('cdninstagram.com/image.jpg')).toBe(false);
      });
    });

    describe('Case sensitivity', () => {
      it('should handle uppercase hostnames', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://CDNINSTAGRAM.COM/image.jpg')).toBe(true);
        expect(CdnExpiryDetector.isEphemeralCdn('https://FBCDN.NET/image.jpg')).toBe(true);
      });

      it('should handle mixed case hostnames', () => {
        expect(CdnExpiryDetector.isEphemeralCdn('https://CdnInstagram.Com/image.jpg')).toBe(true);
      });
    });
  });

  describe('isCdnExpiryError', () => {
    describe('HTTP status codes from ephemeral CDNs', () => {
      it('should detect 403 Forbidden from ephemeral CDN', () => {
        const url = 'https://scontent.fbcdn.net/v/t1.0-9/12345.jpg';
        const error = { status: 403 };
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should detect 404 Not Found from ephemeral CDN', () => {
        const url = 'https://pbs.twimg.com/media/abc123.jpg';
        const error = { status: 404 };
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should detect 410 Gone from ephemeral CDN', () => {
        const url = 'https://cdninstagram.com/image.jpg';
        const error = { status: 410 };
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should not detect other status codes as expiry', () => {
        const url = 'https://fbcdn.net/image.jpg';
        expect(CdnExpiryDetector.isCdnExpiryError(url, { status: 500 })).toBe(false);
        expect(CdnExpiryDetector.isCdnExpiryError(url, { status: 502 })).toBe(false);
        expect(CdnExpiryDetector.isCdnExpiryError(url, { status: 503 })).toBe(false);
        expect(CdnExpiryDetector.isCdnExpiryError(url, { status: 200 })).toBe(false);
      });
    });

    describe('Non-ephemeral CDN domains', () => {
      it('should return false for 403 from stable CDN', () => {
        const url = 'https://cdn.bsky.app/img/feed.jpg';
        const error = { status: 403 };
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(false);
      });

      it('should return false for 404 from non-CDN domain', () => {
        const url = 'https://example.com/image.jpg';
        const error = { status: 404 };
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(false);
      });

      it('should return false for 410 from regular website', () => {
        const url = 'https://imgur.com/abc123.jpg';
        const error = { status: 410 };
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(false);
      });
    });

    describe('Error message patterns', () => {
      it('should detect "403" in error message', () => {
        const url = 'https://fbcdn.net/image.jpg';
        const error = new Error('Request failed with status code 403');
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should detect "404" in error message', () => {
        const url = 'https://twimg.com/media.jpg';
        const error = new Error('HTTP 404: Resource not found');
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should detect "forbidden" in error message', () => {
        const url = 'https://cdninstagram.com/image.jpg';
        const error = new Error('Access forbidden');
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should detect "not found" in error message', () => {
        const url = 'https://tiktokcdn.com/video.mp4';
        const error = new Error('The resource was not found');
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should detect "gone" in error message', () => {
        const url = 'https://licdn.com/media.jpg';
        const error = new Error('Resource is gone');
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should detect "access denied" in error message', () => {
        const url = 'https://fbcdn.net/video.mp4';
        const error = new Error('Access denied to resource');
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should be case-insensitive for error messages', () => {
        const url = 'https://fbcdn.net/image.jpg';
        expect(CdnExpiryDetector.isCdnExpiryError(url, new Error('FORBIDDEN'))).toBe(true);
        expect(CdnExpiryDetector.isCdnExpiryError(url, new Error('Not Found'))).toBe(true);
        expect(CdnExpiryDetector.isCdnExpiryError(url, new Error('ACCESS DENIED'))).toBe(true);
      });

      it('should handle error objects with message property', () => {
        const url = 'https://cdninstagram.com/image.jpg';
        const error = { message: 'Request failed: 403 Forbidden' };
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should not detect unrelated error messages', () => {
        const url = 'https://fbcdn.net/image.jpg';
        expect(CdnExpiryDetector.isCdnExpiryError(url, new Error('Network timeout'))).toBe(false);
        expect(CdnExpiryDetector.isCdnExpiryError(url, new Error('Connection refused'))).toBe(false);
        expect(CdnExpiryDetector.isCdnExpiryError(url, new Error('Invalid response'))).toBe(false);
      });
    });

    describe('Facebook oe parameter expiry', () => {
      it('should detect expired Facebook oe parameter', () => {
        // oe parameter is hex timestamp: 2 weeks ago (expired)
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);
        const url = `https://scontent.fbcdn.net/v/t1.0-9/12345.jpg?oe=${oeHex}&_nc_cat=1`;
        const error = new Error('Generic error');
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
      });

      it('should not detect valid Facebook oe parameter as expiry', () => {
        // oe parameter is hex timestamp: 1 month in future (valid)
        const oneMonthFuture = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = oneMonthFuture.toString(16);
        const url = `https://scontent.fbcdn.net/v/t1.0-9/12345.jpg?oe=${oeHex}&_nc_cat=1`;
        const error = new Error('Network error');
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle error without status or message', () => {
        const url = 'https://fbcdn.net/image.jpg';
        const error = {};
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(false);
      });

      it('should handle null-like error values', () => {
        const url = 'https://fbcdn.net/image.jpg';
        expect(CdnExpiryDetector.isCdnExpiryError(url, {} as Error)).toBe(false);
      });

      it('should handle invalid URL', () => {
        const url = 'not-a-valid-url';
        const error = { status: 403 };
        expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(false);
      });
    });
  });

  describe('isFacebookOeExpired', () => {
    describe('Expired oe parameter', () => {
      it('should detect expired oe parameter on fbcdn.net', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);
        const url = `https://scontent.fbcdn.net/v/t1.0-9/12345.jpg?oe=${oeHex}&_nc_cat=1`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(true);
      });

      it('should detect expired oe parameter on cdninstagram.com', () => {
        const oneMonthAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = oneMonthAgo.toString(16);
        const url = `https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/12345.jpg?oe=${oeHex}&_nc_ht=scontent-lax3-1.cdninstagram.com`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(true);
      });

      it('should handle uppercase oe parameter', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16).toUpperCase();
        const url = `https://fbcdn.net/image.jpg?OE=${oeHex}`;
        // Note: URL params are case-sensitive, so this should return false
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });
    });

    describe('Valid oe parameter', () => {
      it('should return false for future oe timestamp', () => {
        const twoMonthsFuture = Math.floor((Date.now() + 60 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoMonthsFuture.toString(16);
        const url = `https://scontent.fbcdn.net/v/t1.0-9/12345.jpg?oe=${oeHex}`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });

      it('should return false for current timestamp', () => {
        const now = Math.floor(Date.now() / 1000);
        const oeHex = now.toString(16);
        const url = `https://fbcdn.net/image.jpg?oe=${oeHex}`;
        // Current time should be considered valid (not expired yet)
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });
    });

    describe('Non-Facebook domains', () => {
      it('should return false for non-Facebook CDN with oe param', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);
        const url = `https://example.com/image.jpg?oe=${oeHex}`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });

      it('should return false for Twitter CDN', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);
        const url = `https://pbs.twimg.com/media/abc.jpg?oe=${oeHex}`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });

      it('should return false for TikTok CDN', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);
        const url = `https://v16-web.tiktokcdn.com/video/abc.mp4?oe=${oeHex}`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });
    });

    describe('Missing or invalid oe parameter', () => {
      it('should return false when oe parameter is missing', () => {
        const url = 'https://scontent.fbcdn.net/v/t1.0-9/12345.jpg?_nc_cat=1';
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });

      it('should return false for invalid hex oe parameter', () => {
        const url = 'https://fbcdn.net/image.jpg?oe=invalid-hex';
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });

      it('should return false for empty oe parameter', () => {
        const url = 'https://fbcdn.net/image.jpg?oe=';
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });

      it('should return false for oe parameter with non-numeric result', () => {
        const url = 'https://fbcdn.net/image.jpg?oe=ZZZZZZ';
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });
    });

    describe('URL variations', () => {
      it('should handle fbcdn.net subdomain variations', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);

        expect(CdnExpiryDetector.isFacebookOeExpired(`https://scontent.fbcdn.net/image.jpg?oe=${oeHex}`)).toBe(true);
        expect(CdnExpiryDetector.isFacebookOeExpired(`https://external.fbcdn.net/image.jpg?oe=${oeHex}`)).toBe(true);
        expect(CdnExpiryDetector.isFacebookOeExpired(`https://video.fbcdn.net/video.mp4?oe=${oeHex}`)).toBe(true);
      });

      it('should handle cdninstagram.com subdomain variations', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);

        expect(CdnExpiryDetector.isFacebookOeExpired(`https://scontent-lax3-1.cdninstagram.com/image.jpg?oe=${oeHex}`)).toBe(true);
        expect(CdnExpiryDetector.isFacebookOeExpired(`https://scontent-iad3-2.cdninstagram.com/image.jpg?oe=${oeHex}`)).toBe(true);
      });

      it('should handle case variations in hostname', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);

        expect(CdnExpiryDetector.isFacebookOeExpired(`https://FBCDN.NET/image.jpg?oe=${oeHex}`)).toBe(true);
        expect(CdnExpiryDetector.isFacebookOeExpired(`https://CdnInstagram.Com/image.jpg?oe=${oeHex}`)).toBe(true);
      });
    });

    describe('Error handling', () => {
      it('should return false for malformed URLs', () => {
        expect(CdnExpiryDetector.isFacebookOeExpired('not-a-valid-url')).toBe(false);
        expect(CdnExpiryDetector.isFacebookOeExpired('htp://broken.com')).toBe(false);
        expect(CdnExpiryDetector.isFacebookOeExpired('')).toBe(false);
      });

      it('should handle URLs without protocol', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);
        const url = `fbcdn.net/image.jpg?oe=${oeHex}`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });
    });

    describe('Realistic Facebook CDN URLs', () => {
      it('should handle typical Facebook photo URL', () => {
        const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoWeeksAgo.toString(16);
        const url = `https://scontent.fbcdn.net/v/t1.0-9/12345678_123456789_123456789_o.jpg?_nc_cat=1&ccb=1-7&_nc_sid=730e14&_nc_ohc=abc123&_nc_ht=scontent.fbcdn.net&oh=00_ABC123&oe=${oeHex}`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(true);
      });

      it('should handle typical Instagram photo URL', () => {
        const oneMonthAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = oneMonthAgo.toString(16);
        const url = `https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/12345678_123456789_n.jpg?stp=dst-jpg_e35&_nc_ht=scontent-lax3-1.cdninstagram.com&_nc_cat=1&_nc_ohc=abc123&edm=AP_V10EBAAAA&ccb=7-5&oh=00_ABC123&oe=${oeHex}&_nc_sid=4f375e`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(true);
      });

      it('should not expire valid future-dated Facebook URLs', () => {
        const twoMonthsFuture = Math.floor((Date.now() + 60 * 24 * 60 * 60 * 1000) / 1000);
        const oeHex = twoMonthsFuture.toString(16);
        const url = `https://scontent.fbcdn.net/v/t1.0-9/12345.jpg?_nc_cat=1&oe=${oeHex}&_nc_ht=scontent.fbcdn.net`;
        expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should correctly identify expired CDN scenario with all checks', () => {
      const twoWeeksAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
      const oeHex = twoWeeksAgo.toString(16);
      const url = `https://scontent.fbcdn.net/v/t1.0-9/12345.jpg?oe=${oeHex}`;
      const error = { status: 403 };

      expect(CdnExpiryDetector.isEphemeralCdn(url)).toBe(true);
      expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(true);
      expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
    });

    it('should correctly identify stable CDN scenario', () => {
      const url = 'https://cdn.bsky.app/img/feed.jpg';
      const error = { status: 403 };

      expect(CdnExpiryDetector.isEphemeralCdn(url)).toBe(false);
      expect(CdnExpiryDetector.isFacebookOeExpired(url)).toBe(false);
      expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(false);
    });

    it('should detect ephemeral CDN with network error', () => {
      const url = 'https://pbs.twimg.com/media/abc123.jpg';
      const error = new Error('Request failed with status code 403');

      expect(CdnExpiryDetector.isEphemeralCdn(url)).toBe(true);
      expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
    });

    it('should handle TikTok CDN with 404 error', () => {
      const url = 'https://v16-web.tiktokcdn.com/video/tos/abc.mp4';
      const error = { status: 404, message: 'Not found' };

      expect(CdnExpiryDetector.isEphemeralCdn(url)).toBe(true);
      expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
    });

    it('should handle LinkedIn CDN with access denied error', () => {
      const url = 'https://media.licdn.com/dms/image/D4E22AQH123/feedshare-shrink_800/0/';
      const error = new Error('Access denied');

      expect(CdnExpiryDetector.isEphemeralCdn(url)).toBe(true);
      expect(CdnExpiryDetector.isCdnExpiryError(url, error)).toBe(true);
    });
  });
});
