import type { IService } from './base/IService';
import { requestUrl } from 'obsidian';
type RequestUrlFunction = typeof requestUrl;

/**
 * URL expansion result
 */
export interface ExpansionResult {
  originalUrl: string;
  expandedUrl: string;
  hops: number;
  cached: boolean;
}

/**
 * URL expansion options
 */
export interface ExpansionOptions {
  maxHops?: number;
  timeout?: number;
  followMetaRefresh?: boolean;
  /** Obsidian's requestUrl function for CORS-free requests */
  requestUrl?: RequestUrlFunction;
}

/**
 * Cache entry for expanded URLs
 */
interface CacheEntry {
  expandedUrl: string;
  timestamp: Date;
}

/**
 * Known URL shortener domains
 */
const SHORTENER_DOMAINS = new Set([
  't.co',
  'bit.ly',
  'bitly.com',
  'tinyurl.com',
  'ow.ly',
  'buff.ly',
  'short.link',
  'rebrand.ly',
  'is.gd',
  'v.gd',
  'goo.gl',
  'x.co',
  'vm.tiktok.com',
  'vt.tiktok.com',
  'lnkd.in',
  'fb.me',
  'youtu.be',
  'pin.it',
]);

/**
 * URLExpander - Expands shortened URLs by following redirects
 *
 * Single Responsibility: URL expansion and redirect following
 */
export class URLExpander implements IService {
  private cache: Map<string, CacheEntry>;
  private maxHops: number;
  private timeout: number;
  private cacheTTL: number;
  private followMetaRefresh: boolean;
  private requestUrlFn?: RequestUrlFunction | null;

  constructor(options: ExpansionOptions = {}) {
    this.cache = new Map();
    this.maxHops = options.maxHops ?? 3;
    this.timeout = options.timeout ?? 5000;
    this.followMetaRefresh = options.followMetaRefresh ?? true;
    this.cacheTTL = 24 * 60 * 60 * 1000; // 24 hours
    // Store injected requestUrl (avoids dynamic import issues in bundled plugins)
    this.requestUrlFn = options.requestUrl ?? undefined;
  }

  initialize(): void {
    // No async initialization needed
  }

  dispose(): void {
    // Clear cache
    this.cache.clear();
  }

  /**
   * Expand a shortened URL
   * Returns the original URL if expansion fails
   */
  async expandUrl(url: string): Promise<string> {
    try {
      // Normalize URL
      const normalizedUrl = this.normalizeUrl(url);

      // Check if URL is from a known shortener
      if (!this.isShortener(normalizedUrl)) {
        return normalizedUrl;
      }

      // Check cache
      const cached = this.getCached(normalizedUrl);
      if (cached) {
        return cached;
      }

      // Expand URL
      const expanded = await this.followRedirects(normalizedUrl);

      // Cache result
      this.setCached(normalizedUrl, expanded);

      return expanded;
    } catch {
      // If expansion fails, return original URL
      return url;
    }
  }

  /**
   * Expand URL with detailed result
   */
  async expandWithDetails(url: string): Promise<ExpansionResult> {
    const originalUrl = url;
    const normalizedUrl = this.normalizeUrl(url);

    // Check cache first
    const cached = this.getCached(normalizedUrl);
    if (cached) {
      return {
        originalUrl,
        expandedUrl: cached,
        hops: 0,
        cached: true,
      };
    }

    // Check if shortener
    if (!this.isShortener(normalizedUrl)) {
      return {
        originalUrl,
        expandedUrl: normalizedUrl,
        hops: 0,
        cached: false,
      };
    }

    // Expand
    try {
      let hops = 0;
      const expanded = await this.followRedirects(normalizedUrl, (hop) => {
        hops = hop;
      });

      this.setCached(normalizedUrl, expanded);

      return {
        originalUrl,
        expandedUrl: expanded,
        hops,
        cached: false,
      };
    } catch {
      return {
        originalUrl,
        expandedUrl: normalizedUrl,
        hops: 0,
        cached: false,
      };
    }
  }

  /**
   * Check if URL is from a known shortener
   */
  isShortener(url: string): boolean {
    try {
      const urlObj = new URL(this.normalizeUrl(url));
      const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
      return SHORTENER_DOMAINS.has(hostname);
    } catch {
      return false;
    }
  }

  /**
   * Follow redirects up to max hops
   */
  private async followRedirects(
    url: string,
    onHop?: (hop: number) => void
  ): Promise<string> {
    let currentUrl = url;
    let hops = 0;

    while (hops < this.maxHops) {
      const nextUrl = await this.fetchRedirect(currentUrl);

      if (!nextUrl || nextUrl === currentUrl) {
        // No more redirects
        break;
      }

      currentUrl = nextUrl;
      hops++;
      onHop?.(hops);

      // Check if we've reached a non-shortener URL
      if (!this.isShortener(currentUrl)) {
        break;
      }
    }

    return currentUrl;
  }

  /**
   * Fetch a single redirect using Obsidian's requestUrl (CORS-safe).
   * requestUrl auto-follows redirects; we detect the final URL via Location headers
   * or canonical URL extraction from HTML.
   */
  private async fetchRedirect(url: string): Promise<string | null> {
    // Try HEAD with requestUrl first
    const headResult = await this.tryRequestUrlRedirect(url, 'HEAD');
    if (headResult !== undefined) {
      // Got a redirect URL or null (no redirect)
      return headResult;
    }

    // HEAD returned undefined - try GET with requestUrl (for canonical URL extraction)
    const getResult = await this.tryRequestUrlRedirect(url, 'GET');
    if (getResult !== undefined) {
      return getResult;
    }

    // If meta refresh following is enabled, try that as a last resort
    if (this.followMetaRefresh) {
      return this.checkMetaRefresh(url);
    }

    return null;
  }

  /**
   * Fetch redirect using GET method via requestUrl
   */
  private async fetchRedirectWithGet(url: string): Promise<string | null> {
    const requestUrlResult = await this.tryRequestUrlRedirect(url, 'GET');
    if (requestUrlResult !== undefined) {
      return requestUrlResult;
    }

    // Check for meta refresh if enabled
    if (this.followMetaRefresh) {
      return this.checkMetaRefresh(url);
    }

    return null;
  }

  /**
   * Check for meta refresh redirect in HTML using requestUrl
   */
  private async checkMetaRefresh(url: string): Promise<string | null> {
    try {
      const requestUrlResult = await this.tryRequestUrlMetaRefresh(url);
      return requestUrlResult ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Extract meta refresh URL from HTML
   */
  private extractMetaRefresh(html: string, baseUrl: string): string | null {
    // Match: <meta http-equiv="refresh" content="0;url=http://example.com">
    const metaRefreshPattern = /<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'](\d+);?\s*url=([^"']+)["'][^>]*>/i;
    const match = html.match(metaRefreshPattern);

    if (match && match[2]) {
      return this.resolveUrl(baseUrl, match[2]);
    }

    // Alternative pattern: content comes before http-equiv
    const altPattern = /<meta[^>]*content=["'](\d+);?\s*url=([^"']+)["'][^>]*http-equiv=["']refresh["'][^>]*>/i;
    const altMatch = html.match(altPattern);

    if (altMatch && altMatch[2]) {
      return this.resolveUrl(baseUrl, altMatch[2]);
    }

    return null;
  }

  /**
   * Check if status code is a redirect
   */
  private isRedirectStatus(status: number): boolean {
    return [301, 302, 303, 307, 308].includes(status);
  }

  /**
   * Resolve relative URL to absolute
   */
  private resolveUrl(baseUrl: string, relativeUrl: string): string {
    try {
      // If relative URL is already absolute, return it
      if (relativeUrl.match(/^https?:\/\//i)) {
        return relativeUrl;
      }

      // Resolve relative to base
      const base = new URL(baseUrl);
      const resolved = new URL(relativeUrl, base);
      return resolved.href;
    } catch {
      // If resolution fails, try to return relative URL as-is
      return relativeUrl;
    }
  }

  /**
   * Normalize URL
   */
  private normalizeUrl(url: string): string {
    let normalized = url.trim();

    // Add protocol if missing
    if (!normalized.match(/^https?:\/\//i)) {
      normalized = `https://${normalized}`;
    }

    return normalized;
  }

  /**
   * Get cached expanded URL
   */
  private getCached(url: string): string | null {
    const entry = this.cache.get(url);

    if (!entry) {
      return null;
    }

    // Check if cache is still valid
    const age = Date.now() - entry.timestamp.getTime();
    if (age > this.cacheTTL) {
      this.cache.delete(url);
      return null;
    }

    return entry.expandedUrl;
  }

  /**
   * Cache expanded URL
   */
  private setCached(url: string, expandedUrl: string): void {
    this.cache.set(url, {
      expandedUrl,
      timestamp: new Date(),
    });
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    urls: string[];
    oldestEntry?: Date;
    newestEntry?: Date;
  } {
    const entries = Array.from(this.cache.entries());

    return {
      size: entries.length,
      urls: entries.map(([url]) => url),
      oldestEntry: entries.length > 0
        ? new Date(entries.reduce((oldest, [, entry]) =>
            entry.timestamp < oldest ? entry.timestamp : oldest,
            entries[0]?.[1].timestamp ?? 0
          ))
        : undefined,
      newestEntry: entries.length > 0
        ? new Date(entries.reduce((newest, [, entry]) =>
            entry.timestamp > newest ? entry.timestamp : newest,
            entries[0]?.[1].timestamp ?? 0
          ))
        : undefined,
    };
  }

  /**
   * Get list of supported shortener domains
   */
  getSupportedShorteners(): string[] {
    return Array.from(SHORTENER_DOMAINS);
  }

  /**
   * Try to fetch redirect using Obsidian's requestUrl to avoid CORS
   * Note: requestUrl automatically follows redirects, so we extract final URL from HTML
   * Returns: string (redirect URL), null (no redirect), undefined (try GET or fallback)
   */
  private async tryRequestUrlRedirect(url: string, method: 'HEAD' | 'GET'): Promise<string | null | undefined> {
    const requestUrlFn = this.getRequestUrlFn();
    if (!requestUrlFn) return undefined;

    try {
      const response = await requestUrlFn({
        url,
        method,
        throw: false,
      });

      // Check for redirect status (in case requestUrl doesn't auto-follow)
      if (this.isRedirectStatus(response.status)) {
        const location = this.getHeader(response.headers, 'location');
        if (location) {
          return this.resolveUrl(url, location);
        }
      }

      // For HEAD requests with 200: redirects were auto-followed but we can't get body
      // Return undefined to signal "try GET with requestUrl"
      if (response.status === 200 && method === 'HEAD') {
        return undefined;
      }

      // For GET requests with 200: extract canonical URL from HTML
      if (response.status === 200 && method === 'GET') {
        const canonicalUrl = this.extractCanonicalUrl(response.text, url);
        if (canonicalUrl && canonicalUrl !== url) {
          return canonicalUrl;
        }
        // Also check meta refresh as fallback
        if (this.followMetaRefresh) {
          const metaRefresh = this.extractMetaRefresh(response.text, url);
          if (metaRefresh) {
            return metaRefresh;
          }
        }

        // Could not derive a target URL from this response
        return undefined;
      }

      return null;
    } catch {
      return undefined;
    }
  }

  /**
   * Try to detect meta refresh using requestUrl (no CORS)
   */
  private async tryRequestUrlMetaRefresh(url: string): Promise<string | null | undefined> {
    const requestUrlFn = this.getRequestUrlFn();
    if (!requestUrlFn) return undefined;

    try {
      const response = await requestUrlFn({
        url,
        method: 'GET',
        throw: false,
      });

      if (response.status === 200) {
        const metaRefresh = this.extractMetaRefresh(response.text, url);
        if (metaRefresh) {
          return metaRefresh;
        }
        return undefined;
      }

      return null;
    } catch {
      return undefined;
    }
  }

  /**
   * Get the requestUrl function (injected via constructor)
   */
  private getRequestUrlFn(): RequestUrlFunction | null {
    return this.requestUrlFn ?? null;
  }

  /**
   * Retrieve a header value case-insensitively
   */
  private getHeader(headers: Record<string, string>, key: string): string | undefined {
    const lowerKey = key.toLowerCase();
    for (const headerKey of Object.keys(headers)) {
      if (headerKey.toLowerCase() === lowerKey) {
        return headers[headerKey];
      }
    }
    return undefined;
  }

  /**
   * Extract canonical URL from HTML (link rel="canonical" or og:url)
   */
  private extractCanonicalUrl(html: string, baseUrl: string): string | null {
    // Try <link rel="canonical" href="...">
    const canonicalPattern = /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i;
    const canonicalMatch = html.match(canonicalPattern);
    if (canonicalMatch?.[1]) {
      return this.resolveUrl(baseUrl, canonicalMatch[1]);
    }

    // Alternative: href before rel
    const canonicalAltPattern = /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i;
    const canonicalAltMatch = html.match(canonicalAltPattern);
    if (canonicalAltMatch?.[1]) {
      return this.resolveUrl(baseUrl, canonicalAltMatch[1]);
    }

    // Try <meta property="og:url" content="...">
    const ogUrlPattern = /<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["'][^>]*>/i;
    const ogUrlMatch = html.match(ogUrlPattern);
    if (ogUrlMatch?.[1]) {
      return this.resolveUrl(baseUrl, ogUrlMatch[1]);
    }

    // Alternative: content before property
    const ogUrlAltPattern = /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:url["'][^>]*>/i;
    const ogUrlAltMatch = html.match(ogUrlAltPattern);
    if (ogUrlAltMatch?.[1]) {
      return this.resolveUrl(baseUrl, ogUrlAltMatch[1]);
    }

    return null;
  }
}
