import type { IService } from './base/IService';
import type { Platform } from '@/types/post';
import type { URLValidationResult } from '@/types/platform';
import { getPlatformConfig } from '@/types/platform';
import {
  detectPlatform as sharedDetectPlatform,
  getPlatformByDomain,
} from '@/shared/platforms/detection';
import { PLATFORM_DEFINITIONS } from '@/shared/platforms/definitions';

/**
 * URL pattern for platform detection
 */
interface URLPattern {
  platform: Platform;
  patterns: RegExp[];
  domains: string[];
  skipDomainCheck?: boolean;
}

/**
 * Platform detection result
 */
export interface PlatformDetectionResult {
  platform: Platform;
  confidence: number; // 0-1
  matchedPattern: string;
}

/**
 * Platform-specific URL patterns for POST detection and ID extraction
 *
 * NOTE: Platform detection now uses shared/platforms/detection.ts as the single source of truth.
 * These patterns are kept for:
 * 1. Post ID extraction (extractPostId method)
 * 2. Confidence scoring (detectWithConfidence method)
 * 3. Detailed URL pattern matching for specific post types
 *
 * Domain information is now sourced from PLATFORM_DEFINITIONS in shared/platforms/definitions.ts
 */
const PLATFORM_PATTERNS: URLPattern[] = [
  {
    platform: 'facebook',
    domains: ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com'],
    patterns: [
      // Post URLs
      /facebook\.com\/[^/]+\/posts\/\d+/i,
      /facebook\.com\/permalink\.php\?story_fbid=\d+/i,
      /facebook\.com\/photo\.php\?fbid=\d+/i,
      /facebook\.com\/photo\?fbid=\d+/i,

      // Watch/Video URLs
      /facebook\.com\/watch\/\?v=\d+/i,
      /facebook\.com\/[^/]+\/videos\/\d+/i,
      /fb\.watch\/[a-zA-Z0-9_-]+/i,

      // Share URLs
      /facebook\.com\/share\/[a-zA-Z0-9]+/i,
      /facebook\.com\/share\.php/i,

      // Story URLs
      /facebook\.com\/stories\/\d+/i,
      /facebook\.com\/story\.php\?story_fbid=\d+/i,

      // Reel URLs
      /facebook\.com\/reel\/\d+/i,

      // Group posts
      /facebook\.com\/groups\/[^/]+\/posts\/\d+/i,
      /facebook\.com\/groups\/[^/]+\/permalink\/\d+/i,

      // Mobile URLs
      /m\.facebook\.com\/story\.php\?story_fbid=\d+/i,
      /m\.facebook\.com\/photo\.php\?fbid=\d+/i,
    ],
  },
  {
    platform: 'linkedin',
    domains: ['linkedin.com', 'lnkd.in'],
    patterns: [
      // Post/Activity URLs
      /linkedin\.com\/posts\/[^/]+_[a-zA-Z0-9-]+/i,
      /linkedin\.com\/feed\/update\/urn:li:activity:\d+/i,
      /linkedin\.com\/feed\/update\/urn:li:share:\d+/i,

      // Pulse/Article URLs
      /linkedin\.com\/pulse\/[^/]+/i,

      // Video URLs
      /linkedin\.com\/video\/event\/[^/]+/i,
      /linkedin\.com\/events\/[^/]+/i,

      // Company/Page posts
      /linkedin\.com\/company\/[^/]+\/posts/i,

      // Newsletter
      /linkedin\.com\/newsletters\/[^/]+/i,
    ],
  },
  {
    platform: 'instagram',
    domains: ['instagram.com', 'instagr.am'],
    patterns: [
      // Post URLs
      /instagram\.com\/p\/[A-Za-z0-9_-]+/i,

      // Reel URLs
      /instagram\.com\/reel\/[A-Za-z0-9_-]+/i,
      /instagram\.com\/reels\/[A-Za-z0-9_-]+/i,

      // TV/IGTV URLs
      /instagram\.com\/tv\/[A-Za-z0-9_-]+/i,

      // Story URLs (ephemeral, but should be detected)
      /instagram\.com\/stories\/[^/]+\/\d+/i,

      // Shortened URLs
      /instagr\.am\/p\/[A-Za-z0-9_-]+/i,
    ],
  },
  {
    platform: 'tiktok',
    domains: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
    patterns: [
      // Standard video URLs
      /tiktok\.com\/@[^/]+\/video\/\d+/i,

      // Video URLs without username
      /tiktok\.com\/video\/\d+/i,

      // Shortened URLs
      /vm\.tiktok\.com\/[A-Za-z0-9]+/i,
      /vt\.tiktok\.com\/[A-Za-z0-9]+/i,

      // Live URLs
      /tiktok\.com\/@[^/]+\/live/i,

      // Photo mode posts
      /tiktok\.com\/@[^/]+\/photo\/\d+/i,
    ],
  },
  {
    platform: 'x',
    domains: ['x.com', 'twitter.com', 't.co', 'mobile.twitter.com', 'mobile.x.com'],
    patterns: [
      // Standard tweet URLs (x.com and twitter.com)
      /(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i,

      // Tweet with additional path
      /(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+\/photo\/\d+/i,
      /(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+\/video\/\d+/i,

      // Mobile URLs
      /mobile\.(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i,

      // Shortened URLs (will need expansion)
      /t\.co\/[A-Za-z0-9]+/i,

      // Moments
      /(?:x\.com|twitter\.com)\/i\/moments\/\d+/i,

      // Spaces (audio rooms)
      /(?:x\.com|twitter\.com)\/i\/spaces\/[A-Za-z0-9]+/i,
    ],
  },
  {
    platform: 'threads',
    domains: ['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'],
    patterns: [
      // Standard post URLs
      /threads\.(?:net|com)\/@[^/]+\/post\/[A-Za-z0-9_-]+/i,

      // Thread URLs (using /t/ path)
      /threads\.(?:net|com)\/t\/[A-Za-z0-9_-]+/i,

      // Direct post link format
      /threads\.(?:net|com)\/[A-Za-z0-9_-]+/i,
    ],
  },
  {
    platform: 'reddit',
    domains: ['reddit.com', 'old.reddit.com', 'new.reddit.com', 'www.reddit.com', 'redd.it'],
    patterns: [
      // Standard post URLs
      /reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+/i,

      // Old Reddit URLs
      /old\.reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+/i,

      // New Reddit URLs
      /new\.reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+/i,

      // Shortened URLs
      /redd\.it\/[a-z0-9]+/i,

      // User post URLs
      /reddit\.com\/user\/[^/]+\/comments\/[a-z0-9]+/i,
    ],
  },
  {
    platform: 'pinterest',
    domains: ['pinterest.com', 'www.pinterest.com', 'pin.it'],
    patterns: [
      /pinterest\.com\/pin\/[A-Za-z0-9_-]+/i,
      /pin\.it\/[A-Za-z0-9_-]+/i,
    ],
  },
  {
    platform: 'substack',
    domains: ['substack.com'],
    patterns: [
      /substack\.com\/@[^/]+\/(?:post|note)\/[A-Za-z0-9-]+/i,
      /substack\.com\/p\/[A-Za-z0-9-]+/i,
      /[A-Za-z0-9-]+\.substack\.com\/p\/[A-Za-z0-9-]+/i,
      /[A-Za-z0-9-]+\.substack\.com\/note\/[A-Za-z0-9-]+/i,
    ],
  },
  {
    platform: 'tumblr',
    domains: ['tumblr.com'],
    patterns: [
      /tumblr\.com\/[A-Za-z0-9_-]+\/\d+(?:\/[A-Za-z0-9_-]+)?/i,
      /[A-Za-z0-9-]+\.tumblr\.com\/post\/\d+(?:\/[A-Za-z0-9_-]+)?/i,
    ],
  },
  {
    platform: 'medium',
    domains: ['medium.com'],
    patterns: [
      // Post URLs
      /medium\.com\/@[^/]+\/[^/]+-[a-z0-9]+/i,
      /medium\.com\/[^/]+\/[^/]+-[a-z0-9]+/i,
    ],
  },
  {
    platform: 'velog',
    domains: ['velog.io'],
    patterns: [
      // Post URLs: velog.io/@username/post-title
      /velog\.io\/@[^/]+\/.+/i,
    ],
  },
  {
    platform: 'bluesky',
    domains: ['bsky.app'],
    patterns: [
      /bsky\.app\/profile\/[A-Za-z0-9._-]+\/post\/[A-Za-z0-9]+/i,
      /bsky\.app\/profile\/[A-Za-z0-9._-]+\/post\/[A-Za-z0-9]+\/reposted-by/i,
    ],
  },
  {
    platform: 'mastodon',
    domains: [],
    skipDomainCheck: true,
    patterns: [
      /https?:\/\/[^/]+\/@[^/]+\/\d+/i,
    ],
  },
  {
    platform: 'youtube',
    domains: ['youtube.com', 'youtu.be', 'm.youtube.com', 'www.youtube.com'],
    patterns: [
      // Standard video URLs
      /youtube\.com\/watch\?v=[A-Za-z0-9_-]+/i,

      // Shortened URLs
      /youtu\.be\/[A-Za-z0-9_-]+/i,

      // Mobile URLs
      /m\.youtube\.com\/watch\?v=[A-Za-z0-9_-]+/i,

      // Shorts URLs
      /youtube\.com\/shorts\/[A-Za-z0-9_-]+/i,

      // Embed URLs
      /youtube\.com\/embed\/[A-Za-z0-9_-]+/i,

      // Live URLs
      /youtube\.com\/live\/[A-Za-z0-9_-]+/i,
    ],
  },
  {
    platform: 'googlemaps',
    domains: ['google.com', 'maps.google.com', 'goo.gl', 'maps.app.goo.gl'],
    patterns: [
      // Place URLs with /maps/place/ path
      /google\.[a-z.]+\/maps\/place\/[^/]+/i,

      // Maps URLs with @coordinates
      /google\.[a-z.]+\/maps\/@-?\d+\.\d+,-?\d+\.\d+/i,

      // Google Maps with data parameter
      /google\.[a-z.]+\/maps\/.*[?&]data=/i,

      // Shortened goo.gl/maps/ URLs (legacy format)
      /goo\.gl\/maps\/[A-Za-z0-9]+/i,

      // Shortened maps.app.goo.gl URLs (new format)
      /maps\.app\.goo\.gl\/[A-Za-z0-9_-]+/i,

      // Maps search URLs
      /google\.[a-z.]+\/maps\/search\/[^/]+/i,

      // Country-specific domains (google.fr, google.de, etc.)
      /maps\.google\.[a-z.]+\/maps\/place\//i,
    ],
  },
];

/**
 * PlatformDetector - Detects social media platform from URL
 *
 * Single Responsibility: Platform detection and URL pattern matching
 */
export class PlatformDetector implements IService {
  private patterns: URLPattern[];

  constructor() {
    this.patterns = PLATFORM_PATTERNS;
  }

  initialize(): void {
    // No async initialization needed
  }

  dispose(): void {
    // No cleanup needed
  }

  /**
   * Detect platform from URL
   * Returns null if platform cannot be determined
   *
   * Uses shared/platforms/detection.ts as the single source of truth
   */
  detectPlatform(url: string): Platform | null {
    try {
      // Use shared detectPlatform as the primary detection method
      const platform = sharedDetectPlatform(url);

      // 'post' is the fallback for unknown URLs in shared detection
      if (platform === 'post') {
        return null;
      }

      return platform;
    } catch {
      // Invalid URL
      return null;
    }
  }

  /**
   * Detect platform with confidence score
   *
   * Uses shared detection for platform identification,
   * then provides confidence based on URL pattern matching
   */
  detectWithConfidence(url: string): PlatformDetectionResult | null {
    try {
      const platform = this.detectPlatform(url);

      if (!platform) {
        return null;
      }

      const normalizedUrl = this.normalizeUrl(url);
      const urlObj = new URL(normalizedUrl);
      const platformPattern = this.patterns.find(p => p.platform === platform);

      // If we have detailed patterns for this platform, check confidence
      if (platformPattern) {
        const fullUrl = urlObj.href;
        const pathname = urlObj.pathname;

        for (const pattern of platformPattern.patterns) {
          if (pattern.test(fullUrl)) {
            return {
              platform,
              confidence: 1.0,
              matchedPattern: pattern.source,
            };
          }

          if (pattern.test(pathname)) {
            return {
              platform,
              confidence: 0.9,
              matchedPattern: pattern.source,
            };
          }
        }
      }

      // Platform detected but no specific pattern matched
      // This means it was detected by domain/urlPattern from shared definitions
      return {
        platform,
        confidence: 0.8,
        matchedPattern: 'shared-definition',
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if URL is from a supported platform
   */
  isSupported(url: string): boolean {
    return this.detectPlatform(url) !== null;
  }

  /**
   * Get all supported platforms
   *
   * Uses shared PLATFORM_DEFINITIONS as the source of truth
   */
  getSupportedPlatforms(): Platform[] {
    return Object.keys(PLATFORM_DEFINITIONS).filter(
      (p) => p !== 'post'
    ) as Platform[];
  }

  /**
   * Get platform-specific domains
   *
   * Uses shared PLATFORM_DEFINITIONS as the source of truth
   */
  getPlatformDomains(platform: Platform): string[] {
    return PLATFORM_DEFINITIONS[platform]?.domains ?? [];
  }

  /**
   * Get platform from domain
   *
   * Uses shared getPlatformByDomain as the source of truth
   */
  detectPlatformFromDomain(domain: string): Platform | null {
    return getPlatformByDomain(domain);
  }

  /**
   * Check if hostname matches any of the platform domains
   */
  private matchesDomain(hostname: string, domains: string[]): boolean {
    const normalizedHostname = hostname.toLowerCase().replace(/^www\./, '');

    for (const domain of domains) {
      const normalizedDomain = domain.toLowerCase();

      // Exact match
      if (normalizedHostname === normalizedDomain) {
        return true;
      }

      // Subdomain match (e.g., m.facebook.com matches facebook.com)
      if (normalizedHostname.endsWith(`.${normalizedDomain}`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Normalize URL for consistent processing
   */
  private normalizeUrl(url: string): string {
    let normalized = url.trim();

    // Add protocol if missing
    if (!normalized.match(/^https?:\/\//i)) {
      normalized = `https://${normalized}`;
    }

    // Handle common URL issues
    normalized = normalized
      // Remove whitespace
      .replace(/\s+/g, '')
      // Ensure single protocol
      .replace(/^(https?:\/\/)+/i, 'https://');

    return normalized;
  }

  /**
   * Extract post ID from URL (basic implementation)
   * Platform-specific services will provide more robust extraction
   */
  extractPostId(url: string): string | null {
    try {
      const urlObj = new URL(this.normalizeUrl(url));
      const platform = this.detectPlatform(url);

      if (!platform) {
        return null;
      }

      switch (platform) {
        case 'facebook':
          return this.extractFacebookPostId(urlObj);
        case 'linkedin':
          return this.extractLinkedInPostId(urlObj);
        case 'instagram':
          return this.extractInstagramPostId(urlObj);
        case 'tiktok':
          return this.extractTikTokPostId(urlObj);
        case 'x':
          return this.extractXPostId(urlObj);
        case 'threads':
          return this.extractThreadsPostId(urlObj);
        case 'reddit':
          return this.extractRedditPostId(urlObj);
        case 'youtube':
          return this.extractYouTubePostId(urlObj);
        case 'pinterest':
          return this.extractPinterestPostId(urlObj);
        case 'substack':
          return this.extractSubstackPostId(urlObj);
        case 'tumblr':
          return this.extractTumblrPostId(urlObj);
        case 'mastodon':
          return this.extractMastodonPostId(urlObj);
        case 'bluesky':
          return this.extractBlueskyPostId(urlObj);
        case 'googlemaps':
          return this.extractGoogleMapsPlaceId(urlObj);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Platform-specific post ID extraction methods
   */
  private extractFacebookPostId(urlObj: URL): string | null {
    // posts/123456
    const postsMatch = urlObj.pathname.match(/\/posts\/(\d+)/);
    if (postsMatch) return postsMatch[1] || null;

    // story_fbid=123456
    const storyFbidMatch = urlObj.searchParams.get('story_fbid');
    if (storyFbidMatch) return storyFbidMatch;

    // fbid=123456
    const fbidMatch = urlObj.searchParams.get('fbid');
    if (fbidMatch) return fbidMatch;

    // v=123456 (video)
    const videoMatch = urlObj.searchParams.get('v');
    if (videoMatch) return videoMatch;

    return null;
  }

  private extractLinkedInPostId(urlObj: URL): string | null {
    // posts/username_activityId
    const postsMatch = urlObj.pathname.match(/\/posts\/[^_]+_([a-zA-Z0-9-]+)/);
    if (postsMatch) return postsMatch[1] || null;

    // urn:li:activity:1234567890
    const activityMatch = urlObj.pathname.match(/urn:li:activity:(\d+)/);
    if (activityMatch) return activityMatch[1] || null;

    return null;
  }

  private extractInstagramPostId(urlObj: URL): string | null {
    // /p/shortcode or /reel/shortcode
    const match = urlObj.pathname.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return match ? (match[1] || null) : null;
  }

  private extractTikTokPostId(urlObj: URL): string | null {
    // /video/1234567890
    const match = urlObj.pathname.match(/\/video\/(\d+)/);
    return match ? (match[1] || null) : null;
  }

  private extractXPostId(urlObj: URL): string | null {
    // /username/status/1234567890
    const match = urlObj.pathname.match(/\/status\/(\d+)/);
    return match ? (match[1] || null) : null;
  }

  private extractThreadsPostId(urlObj: URL): string | null {
    // /@username/post/postId or /t/postId
    const postMatch = urlObj.pathname.match(/\/post\/([A-Za-z0-9_-]+)/);
    if (postMatch) return postMatch[1] || null;

    const threadMatch = urlObj.pathname.match(/\/t\/([A-Za-z0-9_-]+)/);
    return threadMatch ? (threadMatch[1] || null) : null;
  }

  private extractRedditPostId(urlObj: URL): string | null {
    // Shortlink format redd.it/postId
    if (urlObj.hostname.replace(/^www\./, '') === 'redd.it') {
      const shortMatch = urlObj.pathname.match(/\/([a-z0-9]{6,7})/i);
      if (shortMatch) {
        return shortMatch[1] || null;
      }
    }

    // /r/subreddit/comments/postid or /user/username/comments/postid
    const match = urlObj.pathname.match(/\/comments\/([a-z0-9]+)/i);
    return match ? (match[1] || null) : null;
  }

  private extractYouTubePostId(urlObj: URL): string | null {
    // ?v=VIDEO_ID
    const videoId = urlObj.searchParams.get('v');
    if (videoId) return videoId;

    // /shorts/VIDEO_ID or /embed/VIDEO_ID or /live/VIDEO_ID
    const pathMatch = urlObj.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]+)/);
    if (pathMatch) return pathMatch[1] || null;

    // youtu.be/VIDEO_ID
    if (urlObj.hostname.includes('youtu.be')) {
      const match = urlObj.pathname.match(/\/([A-Za-z0-9_-]+)/);
      return match ? (match[1] || null) : null;
    }

    return null;
  }

  private extractPinterestPostId(urlObj: URL): string | null {
    if (urlObj.hostname.toLowerCase().includes('pin.it')) {
      const shortMatch = urlObj.pathname.match(/\/([A-Za-z0-9_-]+)/);
      return shortMatch ? (shortMatch[1] || null) : null;
    }

    const match = urlObj.pathname.match(/\/pin\/([A-Za-z0-9_-]+)/i);
    return match ? (match[1] || null) : null;
  }

  private extractSubstackPostId(urlObj: URL): string | null {
    const noteMatch = urlObj.pathname.match(/\/note\/([A-Za-z0-9-]+)/i);
    if (noteMatch) return noteMatch[1] || null;

    const postMatch = urlObj.pathname.match(/\/post\/([A-Za-z0-9-]+)/i);
    if (postMatch) return postMatch[1] || null;

    const slugMatch = urlObj.pathname.match(/\/p\/([^/?#]+)/i);
    if (slugMatch) return slugMatch[1] || null;

    return null;
  }

  private extractMastodonPostId(urlObj: URL): string | null {
    const match = urlObj.pathname.match(/\/(@[^/]+)\/(\d+)/);
    return match ? match[2] || null : null;
  }

  private extractTumblrPostId(urlObj: URL): string | null {
    // New Tumblr format: /username/123456789[/slug]
    const modernMatch = urlObj.pathname.match(/^\/[^/]+\/(\d+)/);
    if (modernMatch) return modernMatch[1] || null;

    // Classic subdomain format: /post/123456789[/slug]
    const legacyMatch = urlObj.pathname.match(/\/post\/(\d+)/i);
    return legacyMatch ? legacyMatch[1] || null : null;
  }

  private extractBlueskyPostId(urlObj: URL): string | null {
    const match = urlObj.pathname.match(/\/post\/([A-Za-z0-9]+)(?:\/|$)/);
    return match ? match[1] || null : null;
  }

  private extractGoogleMapsPlaceId(urlObj: URL): string | null {
    // Extract place name from /maps/place/PlaceName/
    const placeMatch = urlObj.pathname.match(/\/maps\/place\/([^/@]+)/);
    if (placeMatch && placeMatch[1]) {
      // Decode URL-encoded place name
      return decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    }

    // Try to extract from data parameter (contains place_id)
    const dataParam = urlObj.searchParams.get('data');
    if (dataParam) {
      // Look for place_id pattern like !1s0x... in the data parameter
      const placeIdMatch = dataParam.match(/!1s([^!]+)/);
      if (placeIdMatch && placeIdMatch[1]) {
        return placeIdMatch[1];
      }
    }

    // Extract coordinates as fallback identifier
    const coordMatch = urlObj.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coordMatch && coordMatch[1] && coordMatch[2]) {
      return `${coordMatch[1]},${coordMatch[2]}`;
    }

    return null;
  }

  /**
   * Canonicalize URL for deduplication and comparison
   * Removes tracking parameters and normalizes URL structure
   */
  canonicalizeUrl(url: string, platform?: Platform): string {
    try {
      const normalizedUrl = this.normalizeUrl(url);
      const urlObj = new URL(normalizedUrl);

      // Detect platform if not provided
      const detectedPlatform = platform || this.detectPlatform(url);

      if (!detectedPlatform) {
        // If platform cannot be detected, just return normalized URL
        return this.basicCanonicalization(urlObj);
      }

      // Apply platform-specific canonicalization
      switch (detectedPlatform) {
        case 'facebook':
          return this.canonicalizeFacebookUrl(urlObj);
        case 'linkedin':
          return this.canonicalizeLinkedInUrl(urlObj);
        case 'instagram':
          return this.canonicalizeInstagramUrl(urlObj);
        case 'tiktok':
          return this.canonicalizeTikTokUrl(urlObj);
        case 'x':
          return this.canonicalizeXUrl(urlObj);
        case 'threads':
          return this.canonicalizeThreadsUrl(urlObj);
        case 'reddit':
          return this.canonicalizeRedditUrl(urlObj);
        case 'youtube':
          return this.canonicalizeYouTubeUrl(urlObj);
        case 'pinterest':
          return this.canonicalizePinterestUrl(urlObj);
        case 'mastodon':
          return this.canonicalizeMastodonUrl(urlObj);
        case 'bluesky':
          return this.canonicalizeBlueskyUrl(urlObj);
        case 'tumblr':
          return this.canonicalizeTumblrUrl(urlObj);
        case 'googlemaps':
          return this.canonicalizeGoogleMapsUrl(urlObj);
        default:
          return this.basicCanonicalization(urlObj);
      }
    } catch {
      // If canonicalization fails, return original URL
      return url;
    }
  }

  /**
   * Basic canonicalization without platform-specific rules
   */
  private basicCanonicalization(urlObj: URL): string {
    // Remove common tracking parameters
    this.removeTrackingParams(urlObj);

    // Normalize domain (remove www, convert to lowercase)
    urlObj.hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Sort query parameters for consistency
    this.sortQueryParams(urlObj);

    // Remove hash/fragment
    urlObj.hash = '';

    return urlObj.href;
  }

  /**
   * Remove common tracking parameters
   */
  private removeTrackingParams(urlObj: URL): void {
    const trackingParams = [
      // UTM parameters
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'utm_id',

      // Click tracking
      'fbclid',
      'gclid',
      'msclkid',
      'dclid',
      '_ga',

      // Social media tracking
      'ref',
      'ref_src',
      'ref_url',
      'referrer',
      'source',
      'share',

      // Video tracking
      'feature',
      't',
      'time_continue',

      // General tracking
      'si',
      'trkid',
      'tracking',
      'track',
      'trk',
      'icid',
      'cid',
    ];

    trackingParams.forEach(param => {
      urlObj.searchParams.delete(param);
    });
  }

  /**
   * Sort query parameters alphabetically for consistency
   */
  private sortQueryParams(urlObj: URL): void {
    const params = Array.from(urlObj.searchParams.entries());
    urlObj.search = '';

    params
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([key, value]) => {
        urlObj.searchParams.append(key, value);
      });
  }

  /**
   * Facebook-specific canonicalization
   */
  private canonicalizeFacebookUrl(urlObj: URL): string {
    // Convert mobile URLs to desktop
    if (urlObj.hostname === 'm.facebook.com') {
      urlObj.hostname = 'facebook.com';
    }

    // Remove fb.com variations
    if (urlObj.hostname === 'fb.com') {
      urlObj.hostname = 'facebook.com';
    }

    // Remove www
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

    // Remove tracking parameters
    this.removeTrackingParams(urlObj);

    // Facebook-specific parameters to remove
    const fbTrackingParams = ['__cft__', '__tn__', 'comment_id', 'reply_comment_id', 'notif_id', 'notif_t', 'paipv'];
    fbTrackingParams.forEach(param => urlObj.searchParams.delete(param));

    // Keep essential parameters (story_fbid, fbid, v, id)
    const essentialParams = ['story_fbid', 'fbid', 'v', 'id'];
    const paramsToKeep = new Map<string, string>();

    essentialParams.forEach(param => {
      const value = urlObj.searchParams.get(param);
      if (value) {
        paramsToKeep.set(param, value);
      }
    });

    // Clear all params and add back essential ones
    urlObj.search = '';
    paramsToKeep.forEach((value, key) => {
      urlObj.searchParams.set(key, value);
    });

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove hash
    urlObj.hash = '';

    return urlObj.href;
  }

  /**
   * LinkedIn-specific canonicalization
   */
  private canonicalizeLinkedInUrl(urlObj: URL): string {
    // Remove www
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

    // Convert shortened URLs
    if (urlObj.hostname === 'lnkd.in') {
      // Keep shortened URL as-is (will be expanded by URLExpander)
      return urlObj.href;
    }

    // Remove tracking parameters
    this.removeTrackingParams(urlObj);

    // LinkedIn-specific parameters to remove
    const linkedInTrackingParams = ['trk', 'trkInfo', 'lipi', 'licu', 'trackingId', 'originalSubdomain'];
    linkedInTrackingParams.forEach(param => urlObj.searchParams.delete(param));

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove hash
    urlObj.hash = '';

    return urlObj.href;
  }

  /**
   * Instagram-specific canonicalization
   */
  private canonicalizeInstagramUrl(urlObj: URL): string {
    // Remove www
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

    // Convert shortened URLs
    if (urlObj.hostname === 'instagr.am') {
      urlObj.hostname = 'instagram.com';
    }

    // Remove ALL query parameters for Instagram (post ID is in path)
    urlObj.search = '';

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove hash
    urlObj.hash = '';

    return urlObj.href;
  }

  /**
   * TikTok-specific canonicalization
   */
  private canonicalizeTikTokUrl(urlObj: URL): string {
    // Remove www
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

    // Keep shortened URLs as-is (will be expanded by URLExpander)
    if (urlObj.hostname === 'vm.tiktok.com' || urlObj.hostname === 'vt.tiktok.com') {
      return urlObj.href;
    }

    // Remove tracking parameters
    this.removeTrackingParams(urlObj);

    // TikTok-specific parameters to remove
    const tiktokTrackingParams = ['_r', '_t', 'is_copy_url', 'is_from_webapp', 'sender_device', 'sender_web_id'];
    tiktokTrackingParams.forEach(param => urlObj.searchParams.delete(param));

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove hash
    urlObj.hash = '';

    return urlObj.href;
  }

  /**
   * X (Twitter) specific canonicalization
   */
  private canonicalizeXUrl(urlObj: URL): string {
    // Standardize to x.com domain
    if (urlObj.hostname.includes('twitter.com')) {
      urlObj.hostname = urlObj.hostname.replace('twitter.com', 'x.com');
    }

    // Convert mobile URLs to desktop
    if (urlObj.hostname === 'mobile.x.com' || urlObj.hostname === 'mobile.twitter.com') {
      urlObj.hostname = 'x.com';
    }

    // Remove www
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

    // Keep shortened URLs as-is (will be expanded by URLExpander)
    if (urlObj.hostname === 't.co') {
      return urlObj.href;
    }

    // Remove tracking parameters
    this.removeTrackingParams(urlObj);

    // X-specific parameters to remove
    const xTrackingParams = ['s', 'src', 'cn', 'cxt', 'twclid'];
    xTrackingParams.forEach(param => urlObj.searchParams.delete(param));

    // Remove photo/video suffixes from path (they're just UI views)
    urlObj.pathname = urlObj.pathname.replace(/\/(photo|video)\/\d+$/, '');

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove hash
    urlObj.hash = '';

    return urlObj.href;
  }

  /**
   * Threads-specific canonicalization
   */
  private canonicalizeThreadsUrl(urlObj: URL): string {
    // Normalize to threads.com (canonical domain since April 2025)
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '').replace('threads.net', 'threads.com');

    // Remove ALL query parameters (post ID is in path)
    urlObj.search = '';

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove hash
    urlObj.hash = '';

    return urlObj.href;
  }

  /**
   * Reddit-specific canonicalization
   */
  private canonicalizeRedditUrl(urlObj: URL): string {
    // Standardize to www.reddit.com
    if (urlObj.hostname === 'old.reddit.com' || urlObj.hostname === 'new.reddit.com') {
      urlObj.hostname = 'reddit.com';
    }

    // Remove www for consistency
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

    // Keep shortened URLs as-is (will be expanded by URLExpander)
    if (urlObj.hostname === 'redd.it') {
      return urlObj.href;
    }

    // Remove tracking parameters
    this.removeTrackingParams(urlObj);

    // Reddit-specific parameters to remove
    const redditTrackingParams = ['context', 'sort', 'ref', 'ref_source', 'ref_campaign', 'sh', 'st'];
    redditTrackingParams.forEach(param => urlObj.searchParams.delete(param));

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove hash
    urlObj.hash = '';

    return urlObj.href;
  }

  /**
   * Pinterest-specific canonicalization
   */
  private canonicalizePinterestUrl(urlObj: URL): string {
    urlObj.hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');

    if (urlObj.hostname === 'pin.it') {
      urlObj.search = '';
      urlObj.hash = '';
      return urlObj.href;
    }

    this.removeTrackingParams(urlObj);
    const pinterestTrackingParams = ['invite_code', 'invite_ticket', 'sender', 'nic_v1', 'nic_v2'];
    pinterestTrackingParams.forEach(param => urlObj.searchParams.delete(param));

    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    urlObj.hash = '';
    return urlObj.href;
  }

  private canonicalizeMastodonUrl(urlObj: URL): string {
    this.removeTrackingParams(urlObj);
    urlObj.hash = '';
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    return urlObj.href;
  }

  private canonicalizeTumblrUrl(urlObj: URL): string {
    urlObj.hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');

    this.removeTrackingParams(urlObj);
    // Tumblr share links often include source params that are non-essential
    urlObj.searchParams.delete('source');

    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    urlObj.hash = '';
    return urlObj.href;
  }

  private canonicalizeBlueskyUrl(urlObj: URL): string {
    urlObj.hostname = 'bsky.app';
    this.removeTrackingParams(urlObj);
    urlObj.hash = '';
    urlObj.pathname = urlObj.pathname.replace(/\/reposted-by\/?$/, '');
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    return urlObj.href;
  }

  /**
   * Google Maps-specific canonicalization
   */
  private canonicalizeGoogleMapsUrl(urlObj: URL): string {
    // Normalize to google.com
    urlObj.hostname = urlObj.hostname.replace(/^(www\.|maps\.)?/, '');
    if (urlObj.hostname.startsWith('google.')) {
      // Keep the country-specific domain but remove www/maps prefix
    }

    // Remove tracking parameters
    this.removeTrackingParams(urlObj);

    // Google Maps-specific tracking params
    const mapsTrackingParams = ['authuser', 'hl', 'entry', 'g_ep', 'ttu'];
    mapsTrackingParams.forEach(param => urlObj.searchParams.delete(param));

    // Remove hash
    urlObj.hash = '';

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    return urlObj.href;
  }

  /**
   * YouTube-specific canonicalization
   */
  private canonicalizeYouTubeUrl(urlObj: URL): string {
    // Standardize to youtube.com
    if (urlObj.hostname === 'm.youtube.com') {
      urlObj.hostname = 'youtube.com';
    }

    // Convert youtu.be to youtube.com
    if (urlObj.hostname === 'youtu.be') {
      const videoId = urlObj.pathname.substring(1); // Remove leading slash
      urlObj.hostname = 'youtube.com';
      urlObj.pathname = '/watch';
      urlObj.search = `?v=${videoId}`;
    }

    // Remove www
    urlObj.hostname = urlObj.hostname.replace(/^www\./, '');

    // Remove tracking parameters
    this.removeTrackingParams(urlObj);

    // YouTube-specific parameters to remove (keep only v parameter for /watch)
    const youtubeTrackingParams = ['feature', 'app', 'ab_channel'];
    youtubeTrackingParams.forEach(param => urlObj.searchParams.delete(param));

    // Keep only essential parameter for /watch URLs
    if (urlObj.pathname === '/watch') {
      const videoId = urlObj.searchParams.get('v');
      if (videoId) {
        urlObj.search = `?v=${videoId}`;
      }
    } else {
      // For /shorts, /embed, /live - remove all query params
      urlObj.search = '';
    }

    // Remove trailing slash
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // Remove hash
    urlObj.hash = '';

    return urlObj.href;
  }

  /**
   * Validate URL with detailed error reporting
   */
  validateUrl(url: string): URLValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Normalize and parse URL
      const normalizedUrl = this.normalizeUrl(url);
      const urlObj = new URL(normalizedUrl);

      // Detect platform
      const platform = this.detectPlatform(url);

      if (!platform) {
        errors.push('URL is not from a supported social media platform');
        return {
          valid: false,
          platform: 'facebook', // Default, not used when invalid
          postId: null,
          errors,
          warnings,
        };
      }

      // Extract post ID
      const postId = this.extractPostId(url);

      if (!postId) {
        errors.push('Could not extract post ID from URL');
        warnings.push('URL format may not be fully supported');
      }

      // Get platform config for additional validation
      const config = getPlatformConfig(platform);

      // Check domain
      const isValidDomain = config.domains.some(domain =>
        urlObj.hostname.toLowerCase().includes(domain.toLowerCase())
      );

      if (!isValidDomain && !config.allowCustomDomains) {
        warnings.push(`Unexpected domain for ${config.displayName}`);
      }

      return {
        valid: errors.length === 0,
        platform,
        postId,
        errors,
        warnings,
      };
    } catch (error) {
      errors.push(`Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);

      return {
        valid: false,
        platform: 'facebook', // Default, not used when invalid
        postId: null,
        errors,
        warnings,
      };
    }
  }

  /**
   * Get platform configuration
   */
  getPlatformConfig(platform: Platform) {
    return getPlatformConfig(platform);
  }
}
