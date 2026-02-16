import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { isPinterestShortLink, resolvePinterestUrl } from '@/utils/pinterest';

vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
}));

describe('pinterest utils', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.unstubAllGlobals();
    (requestUrl as unknown as vi.Mock).mockReset();
    if (originalFetch) {
      // Restore original fetch for other tests
      // @ts-expect-error - fetch is a global that we stub in tests
      global.fetch = originalFetch;
    }
  });

  it('detects pin.it short links', () => {
    expect(isPinterestShortLink('https://pin.it/abc123')).toBe(true);
    expect(isPinterestShortLink('https://www.pinterest.com/pin/428545720815525504/')).toBe(false);
  });

  it('expands pin.it links and detects boards', async () => {
    const targetBoard = 'https://www.pinterest.com/sampleuser/sample-board/';

    // Obsidian requestUrl mock - simulates auto-follow redirect behavior
    // HEAD returns 200 (redirect followed), GET returns HTML with canonical URL
    (requestUrl as unknown as vi.Mock)
      .mockResolvedValueOnce({
        // HEAD request - returns 200 (redirect auto-followed)
        status: 200,
        headers: {},
        text: '',
      })
      .mockResolvedValueOnce({
        // GET request - returns HTML with canonical URL
        status: 200,
        headers: {},
        text: `<html><head><link rel="canonical" href="${targetBoard}"></head></html>`,
      });

    // Fallback fetch mock (should not be needed, but keep for safety)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: {
          Location: targetBoard,
        },
      })
    ));

    const result = await resolvePinterestUrl('https://pin.it/AbC123');

    expect(result.resolvedUrl).toBe(targetBoard);
    expect(result.isBoard).toBe(true);
    expect(result.expanded).toBe(true);
  });

  it('returns board detection for regular pinterest URLs without expansion', async () => {
    const boardUrl = 'https://www.pinterest.com/acmeagency/brand-refresh/';
    const result = await resolvePinterestUrl(boardUrl);

    expect(result.resolvedUrl).toBe(boardUrl);
    expect(result.isBoard).toBe(true);
    expect(result.expanded).toBe(false);
  });
});
