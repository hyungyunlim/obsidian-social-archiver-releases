import { describe, it, expect, beforeEach, vi } from 'vitest';
import { URLExpander } from '@/services/URLExpander';

// Mock fetch globally
global.fetch = vi.fn();

describe('URLExpander', () => {
  let expander: URLExpander;

  beforeEach(() => {
    expander = new URLExpander();
    vi.clearAllMocks();
  });

  describe('Shortener detection', () => {
    it('should detect known shortener domains', () => {
      const shorteners = [
        'https://t.co/abc123',
        'https://bit.ly/xyz789',
        'https://tinyurl.com/test',
        'https://ow.ly/abc',
        'https://buff.ly/xyz',
        'https://short.link/test',
        'https://vm.tiktok.com/ABC',
        'https://lnkd.in/abc',
        'https://youtu.be/abc123',
      ];

      shorteners.forEach(url => {
        expect(expander.isShortener(url)).toBe(true);
      });
    });

    it('should not detect regular URLs as shorteners', () => {
      const regularUrls = [
        'https://facebook.com/post/123',
        'https://twitter.com/user/status/123',
        'https://example.com/page',
      ];

      regularUrls.forEach(url => {
        expect(expander.isShortener(url)).toBe(false);
      });
    });

    it('should handle URLs without protocol', () => {
      expect(expander.isShortener('bit.ly/test')).toBe(true);
      expect(expander.isShortener('example.com/test')).toBe(false);
    });
  });

  describe('URL expansion', () => {
    it('should return original URL for non-shorteners', async () => {
      const url = 'https://facebook.com/post/123';
      const expanded = await expander.expandUrl(url);
      expect(expanded).toBe(url);
    });

    it('should expand shortener with single redirect', async () => {
      const shortUrl = 'https://bit.ly/test';
      const finalUrl = 'https://example.com/final';

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: finalUrl }),
      } as Response);

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(finalUrl);
    });

    it('should follow multiple redirects', async () => {
      const shortUrl = 'https://bit.ly/test';
      const redirect1 = 'https://t.co/abc';
      const finalUrl = 'https://example.com/final';

      // First redirect
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: redirect1 }),
      } as Response);

      // Second redirect (not a shortener domain, so stops)
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: finalUrl }),
      } as Response);

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(redirect1);
    });

    it('should respect max hops limit', async () => {
      const expander = new URLExpander({ maxHops: 2 });
      const shortUrl = 'https://bit.ly/test';

      // Mock infinite redirect loop
      vi.mocked(fetch).mockResolvedValue({
        status: 301,
        headers: new Headers({ location: shortUrl }),
      } as Response);

      const expanded = await expander.expandUrl(shortUrl);
      // Should stop after max hops
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle relative redirects', async () => {
      const shortUrl = 'https://bit.ly/test';
      const relativeRedirect = '/final-page';
      const expectedUrl = 'https://bit.ly/final-page';

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: relativeRedirect }),
      } as Response);

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(expectedUrl);
    });

    it('should return original URL on expansion failure', async () => {
      const shortUrl = 'https://bit.ly/test';

      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(shortUrl);
    });
  });

  describe('Redirect status codes', () => {
    const redirectCodes = [301, 302, 303, 307, 308];

    redirectCodes.forEach(code => {
      it(`should handle ${code} redirect`, async () => {
        const shortUrl = 'https://bit.ly/test';
        const finalUrl = 'https://example.com/final';

        vi.mocked(fetch).mockResolvedValueOnce({
          status: code,
          headers: new Headers({ location: finalUrl }),
        } as Response);

        const expanded = await expander.expandUrl(shortUrl);
        expect(expanded).toBe(finalUrl);
      });
    });

    it('should not follow non-redirect status codes', async () => {
      const shortUrl = 'https://bit.ly/test';

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => '<html></html>',
      } as Response);

      const expanded = await expander.expandUrl(shortUrl);
      // Should return original if no redirect found
      expect(expanded).toBe(shortUrl);
    });
  });

  describe('Meta refresh handling', () => {
    it('should detect meta refresh redirect', async () => {
      const shortUrl = 'https://bit.ly/test';
      const finalUrl = 'https://example.com/final';
      const html = `
        <html>
          <head>
            <meta http-equiv="refresh" content="0;url=${finalUrl}">
          </head>
        </html>
      `;

      // First call (HEAD)
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
      } as Response);

      // Second call (GET for meta refresh)
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => html,
      } as Response);

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(finalUrl);
    });

    it('should handle alternative meta refresh format', async () => {
      const shortUrl = 'https://bit.ly/test';
      const finalUrl = 'https://example.com/final';
      const html = `
        <html>
          <head>
            <meta content="0; url=${finalUrl}" http-equiv="refresh">
          </head>
        </html>
      `;

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => html,
      } as Response);

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(finalUrl);
    });

    it('should skip meta refresh if disabled', async () => {
      const expander = new URLExpander({ followMetaRefresh: false });
      const shortUrl = 'https://bit.ly/test';

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
      } as Response);

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(shortUrl);
    });
  });

  describe('Caching', () => {
    it('should cache expanded URLs', async () => {
      const shortUrl = 'https://bit.ly/test';
      const finalUrl = 'https://example.com/final';

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: finalUrl }),
      } as Response);

      // First call
      const expanded1 = await expander.expandUrl(shortUrl);
      expect(expanded1).toBe(finalUrl);
      expect(fetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const expanded2 = await expander.expandUrl(shortUrl);
      expect(expanded2).toBe(finalUrl);
      expect(fetch).toHaveBeenCalledTimes(1); // No additional calls
    });

    it('should return cached result with details', async () => {
      const shortUrl = 'https://bit.ly/test';
      const finalUrl = 'https://example.com/final';

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: finalUrl }),
      } as Response);

      // First call to populate cache
      await expander.expandUrl(shortUrl);

      // Second call with details
      const result = await expander.expandWithDetails(shortUrl);
      expect(result.cached).toBe(true);
      expect(result.expandedUrl).toBe(finalUrl);
      expect(result.hops).toBe(0); // Cached, so no hops
    });

    it('should clear cache', async () => {
      const shortUrl = 'https://bit.ly/test';
      const finalUrl = 'https://example.com/final';

      vi.mocked(fetch).mockResolvedValue({
        status: 301,
        headers: new Headers({ location: finalUrl }),
      } as Response);

      await expander.expandUrl(shortUrl);
      expect(expander.getCacheSize()).toBe(1);

      expander.clearCache();
      expect(expander.getCacheSize()).toBe(0);

      // Should fetch again after cache clear
      await expander.expandUrl(shortUrl);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should provide cache statistics', async () => {
      const shortUrl1 = 'https://bit.ly/test1';
      const shortUrl2 = 'https://bit.ly/test2';
      const finalUrl = 'https://example.com/final';

      vi.mocked(fetch).mockResolvedValue({
        status: 301,
        headers: new Headers({ location: finalUrl }),
      } as Response);

      await expander.expandUrl(shortUrl1);
      await expander.expandUrl(shortUrl2);

      const stats = expander.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.urls).toContain(shortUrl1);
      expect(stats.urls).toContain(shortUrl2);
      expect(stats.oldestEntry).toBeInstanceOf(Date);
      expect(stats.newestEntry).toBeInstanceOf(Date);
    });
  });

  describe('Detailed expansion', () => {
    it('should return expansion details', async () => {
      const shortUrl = 'https://bit.ly/test';
      const redirect1 = 'https://t.co/abc';
      const finalUrl = 'https://example.com/final';

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: redirect1 }),
      } as Response);

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: finalUrl }),
      } as Response);

      const result = await expander.expandWithDetails(shortUrl);
      expect(result.originalUrl).toBe(shortUrl);
      expect(result.expandedUrl).toBe(redirect1);
      expect(result.hops).toBeGreaterThan(0);
      expect(result.cached).toBe(false);
    });

    it('should return zero hops for non-shorteners', async () => {
      const url = 'https://example.com/page';
      const result = await expander.expandWithDetails(url);

      expect(result.originalUrl).toBe(url);
      expect(result.expandedUrl).toBe(url);
      expect(result.hops).toBe(0);
      expect(result.cached).toBe(false);
    });
  });

  describe('Timeout handling', () => {
    it('should timeout on slow redirects', async () => {
      const expander = new URLExpander({ timeout: 100 });
      const shortUrl = 'https://bit.ly/test';

      vi.mocked(fetch).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(shortUrl); // Should return original on timeout
    });
  });

  describe('Utility methods', () => {
    it('should return list of supported shorteners', () => {
      const shorteners = expander.getSupportedShorteners();
      expect(shorteners).toContain('t.co');
      expect(shorteners).toContain('bit.ly');
      expect(shorteners).toContain('tinyurl.com');
      expect(shorteners.length).toBeGreaterThan(10);
    });
  });

  describe('Error handling', () => {
    it('should handle malformed URLs', async () => {
      const malformedUrl = 'not-a-url';
      const expanded = await expander.expandUrl(malformedUrl);
      expect(expanded).toBe(malformedUrl);
    });

    it('should handle network errors gracefully', async () => {
      const shortUrl = 'https://bit.ly/test';

      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network failure'));

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(shortUrl);
    });

    it('should handle missing location header', async () => {
      const shortUrl = 'https://bit.ly/test';

      vi.mocked(fetch).mockResolvedValueOnce({
        status: 301,
        headers: new Headers(), // No location header
      } as Response);

      const expanded = await expander.expandUrl(shortUrl);
      expect(expanded).toBe(shortUrl);
    });

    it('should handle circular redirects', async () => {
      const shortUrl = 'https://bit.ly/test';

      let callCount = 0;
      vi.mocked(fetch).mockImplementation(async () => {
        callCount++;
        return {
          status: 301,
          headers: new Headers({ location: shortUrl }), // Redirects to itself
        } as Response;
      });

      const expanded = await expander.expandUrl(shortUrl);
      expect(callCount).toBeLessThanOrEqual(3); // Should stop at max hops
    });
  });
});
