/**
 * CDN Expiry Detector
 *
 * Detects whether a media download failure is caused by an expired CDN URL.
 * Ephemeral CDN platforms (Facebook, Instagram, TikTok, etc.) rotate their
 * media URLs with short-lived tokens (24-72h). This utility identifies such
 * failures so the plugin can generate graceful placeholders instead of broken links.
 */

/**
 * Domains known to use ephemeral (time-limited) CDN URLs.
 * Media from these domains expires within 24-72 hours.
 */
const EPHEMERAL_CDN_DOMAINS = [
  'cdninstagram.com',
  'fbcdn.net',
  'twimg.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktok.com',
  'licdn.com',
] as const;

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class CdnExpiryDetector {
  /**
   * Check if a URL belongs to an ephemeral CDN that uses time-limited URLs.
   */
  static isEphemeralCdn(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return EPHEMERAL_CDN_DOMAINS.some(domain => hostname.endsWith(domain));
    } catch {
      return false;
    }
  }

  /**
   * Determine if a download error is likely caused by CDN URL expiry.
   *
   * Detection heuristics:
   * - HTTP 403/404/410 from an ephemeral CDN domain → CDN expiry
   * - HTML response body instead of media binary → CDN expiry (redirect to error page)
   * - Facebook `oe` URL parameter (hex timestamp) expired → CDN expiry
   */
  static isCdnExpiryError(url: string, error: Error | { status?: number; message?: string }): boolean {
    if (!CdnExpiryDetector.isEphemeralCdn(url)) {
      return false;
    }

    // Check HTTP status codes typical of expired CDN URLs
    const status = (error as Record<string, unknown>)?.['status'] as number ?? 0;
    if (status === 403 || status === 404 || status === 410) {
      return true;
    }

    // Check error message for common CDN expiry patterns
    const message = error instanceof Error ? error.message : (error as Record<string, unknown>)?.['message'] as string ?? '';
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('403') ||
      lowerMessage.includes('404') ||
      lowerMessage.includes('forbidden') ||
      lowerMessage.includes('not found') ||
      lowerMessage.includes('gone') ||
      lowerMessage.includes('access denied')
    ) {
      return true;
    }

    // Check Facebook-specific expired `oe` parameter (hex-encoded Unix timestamp)
    if (CdnExpiryDetector.isFacebookOeExpired(url)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a Facebook CDN URL has an expired `oe` (output expiry) parameter.
   * The `oe` param is a hex-encoded Unix timestamp indicating when the URL expires.
   */
  static isFacebookOeExpired(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      // Only applies to Facebook/Instagram CDN domains
      if (!hostname.endsWith('fbcdn.net') && !hostname.endsWith('cdninstagram.com')) {
        return false;
      }

      const oe = parsed.searchParams.get('oe');
      if (!oe) return false;

      const expiryTimestamp = parseInt(oe, 16);
      if (isNaN(expiryTimestamp)) return false;

      const nowSeconds = Math.floor(Date.now() / 1000);
      return expiryTimestamp < nowSeconds;
    } catch {
      return false;
    }
  }
}
