/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/definitions.ts
 * Generated: 2026-02-16T13:18:35.551Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

/**
 * Platform Definitions - Single Source of Truth
 *
 * This file is copied to src/, workers/src/, and mobile-app/src/ at build time.
 * To modify, edit this source file and run: npm run sync:shared
 *
 * This file contains all platform configurations including:
 * - Display names and emojis
 * - Domain patterns and URL detection
 * - BrightData dataset IDs
 * - Rate limits and features
 *
 * To add a new platform:
 * 1. Add the platform ID to types.ts
 * 2. Add the platform definition here
 * 3. Run: npm run sync:shared
 */

import type { Platform } from './types';

/**
 * Platform feature flags
 */
export interface PlatformFeatures {
  stories: boolean;
  live: boolean;
  reels: boolean;
  threads: boolean;
}

/**
 * Platform rate limit configuration
 */
export interface PlatformRateLimit {
  requestsPerHour: number;
  requestsPerDay: number;
}

/**
 * Complete platform definition
 */
export interface PlatformDefinition {
  /** Platform identifier */
  id: Platform;
  /** Human-readable display name */
  displayName: string;
  /** Emoji icon for the platform */
  emoji: string;
  /** Known domains for this platform */
  domains: string[];
  /** RegExp pattern for URL detection */
  urlPattern: RegExp;
  /** BrightData dataset ID (if available) */
  brightDataDatasetId?: string;
  /** Whether the platform supports media content */
  supportsMedia: boolean;
  /** Whether AI analysis is supported */
  supportsAI: boolean;
  /** Whether custom domains are allowed (e.g., Mastodon instances) */
  allowCustomDomains?: boolean;
  /** Maximum media file size in bytes */
  maxMediaSize?: number;
  /** Rate limiting configuration */
  rateLimit?: PlatformRateLimit;
  /** Platform feature flags */
  features: PlatformFeatures;
}

/**
 * All platform definitions
 *
 * When adding a new platform, add its definition here.
 * The order doesn't matter for lookup, but affects iteration.
 */
export const PLATFORM_DEFINITIONS: Record<Platform, PlatformDefinition> = {
  facebook: {
    id: 'facebook',
    displayName: 'Facebook',
    emoji: '📘',
    domains: ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com'],
    urlPattern: /(?:facebook\.com|fb\.com|fb\.watch)/i,
    brightDataDatasetId: 'gd_l7q7dkf244hwgcqr2',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: true, live: true, reels: true, threads: false },
  },

  linkedin: {
    id: 'linkedin',
    displayName: 'LinkedIn',
    emoji: '💼',
    domains: ['linkedin.com', 'lnkd.in'],
    urlPattern: /linkedin\.com/i,
    brightDataDatasetId: 'gd_l0kp3kd4e92kx6tl1',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 50 * 1024 * 1024, // 50MB
    rateLimit: { requestsPerHour: 100, requestsPerDay: 1000 },
    features: { stories: false, live: true, reels: false, threads: false },
  },

  instagram: {
    id: 'instagram',
    displayName: 'Instagram',
    emoji: '📷',
    domains: ['instagram.com', 'instagr.am'],
    urlPattern: /(?:instagram\.com|instagr\.am)/i,
    brightDataDatasetId: 'gd_l1kj3kf244hwgcqq1',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: true, live: true, reels: true, threads: false },
  },

  tiktok: {
    id: 'tiktok',
    displayName: 'TikTok',
    emoji: '🎵',
    domains: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
    urlPattern: /tiktok\.com/i,
    brightDataDatasetId: 'gd_l1kp3kf244hwgcqm1',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 200 * 1024 * 1024, // 200MB (videos)
    rateLimit: { requestsPerHour: 100, requestsPerDay: 1000 },
    features: { stories: false, live: true, reels: false, threads: false },
  },

  x: {
    id: 'x',
    displayName: 'X',
    emoji: '🐦',
    domains: ['x.com', 'twitter.com', 't.co', 'mobile.x.com', 'mobile.twitter.com'],
    // Note: t.co must match exactly (word boundary) to avoid matching redd.it, pin.it, etc.
    urlPattern: /(?:x\.com|twitter\.com|(?:^|\/\/)t\.co(?:\/|$))/i,
    brightDataDatasetId: 'gd_l0kp3kd4e92kx6tm1',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 512 * 1024 * 1024, // 512MB (videos)
    rateLimit: { requestsPerHour: 300, requestsPerDay: 3000 },
    features: { stories: false, live: true, reels: false, threads: true },
  },

  threads: {
    id: 'threads',
    displayName: 'Threads',
    emoji: '🧵',
    domains: ['threads.net', 'threads.com'],
    urlPattern: /(?:threads\.net|threads\.com)/i,
    brightDataDatasetId: 'gd_l1kj3kf244hwgcqs1',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  youtube: {
    id: 'youtube',
    displayName: 'YouTube',
    emoji: '▶️',
    domains: ['youtube.com', 'youtu.be', 'm.youtube.com'],
    urlPattern: /(?:youtube\.com|youtu\.be)/i,
    brightDataDatasetId: 'gd_lvpz7zpnq2jwuph41',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 500 * 1024 * 1024, // 500MB
    rateLimit: { requestsPerHour: 150, requestsPerDay: 1500 },
    features: { stories: false, live: true, reels: true, threads: false },
  },

  reddit: {
    id: 'reddit',
    displayName: 'Reddit',
    emoji: '🔶',
    domains: ['reddit.com', 'old.reddit.com', 'new.reddit.com', 'redd.it'],
    urlPattern: /(?:reddit\.com|redd\.it)/i,
    brightDataDatasetId: 'gd_l1kj3kf244hwgcqp1',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  pinterest: {
    id: 'pinterest',
    displayName: 'Pinterest',
    emoji: '📌',
    domains: ['pinterest.com', 'www.pinterest.com', 'pin.it'],
    urlPattern: /(?:pinterest\.com|pin\.it)/i,
    brightDataDatasetId: 'gd_pinterest_posts_dataset',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: false },
  },

  substack: {
    id: 'substack',
    displayName: 'Substack',
    emoji: '📰',
    domains: ['substack.com'],
    urlPattern: /substack\.com/i,
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  tumblr: {
    id: 'tumblr',
    displayName: 'Tumblr',
    emoji: '📝',
    domains: ['tumblr.com'],
    urlPattern: /tumblr\.com/i,
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  mastodon: {
    id: 'mastodon',
    displayName: 'Mastodon',
    emoji: '🐘',
    domains: [
      'mastodon.social',
      'mastodon.online',
      'mastodon.world',
      'mastodon.cloud',
      'mstdn.social',
      'fosstodon.org',
    ],
    // Mastodon URL pattern: https://instance/@user/postid
    urlPattern: /https?:\/\/[^\s]+\/@[A-Za-z0-9_@.-]+\/\d+/i,
    allowCustomDomains: true,
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  bluesky: {
    id: 'bluesky',
    displayName: 'Bluesky',
    emoji: '🦋',
    domains: ['bsky.app'],
    urlPattern: /bsky\.app/i,
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  googlemaps: {
    id: 'googlemaps',
    displayName: 'Google Maps',
    emoji: '📍',
    domains: ['google.com', 'maps.google.com', 'goo.gl'],
    urlPattern: /(?:google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl)/i,
    brightDataDatasetId: 'gd_m8ebnr0q2qlklc02fz',
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: false },
  },

  velog: {
    id: 'velog',
    displayName: 'Velog',
    emoji: '📗',
    domains: ['velog.io', 'v2.velog.io'],
    // Matches: velog.io/@user, velog.io/@user/post-slug, v2.velog.io/rss/@user
    // Profile URLs (velog.io/@user) will be converted to RSS feed URLs
    urlPattern: /velog\.io\/@[A-Za-z0-9_-]+/i,
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  podcast: {
    id: 'podcast',
    displayName: 'Podcast',
    emoji: '🎙️',
    domains: [
      'anchor.fm',
      'podbean.com',
      'buzzsprout.com',
      'libsyn.com',
      'simplecast.com',
      'feeds.simplecast.com',
      'transistor.fm',
      'fireside.fm',
      'megaphone.fm',
      'spreaker.com',
      'omny.fm',
      'feeds.megaphone.fm',
      'feeds.transistor.fm',
      'rss.art19.com',
      'feeds.acast.com',
      'audioboom.com',
      'feeds.captivate.fm',
      'feeds.redcircle.com',
      'feeds.soundcloud.com',
      'pinecast.com',
      'feeds.feedburner.com',
      // Korean podcast platforms
      'minicast.imbc.com',
    ],
    // Match common podcast feed hosting domains and podcastfeeds.* subdomains (e.g., podcastfeeds.nbcnews.com)
    urlPattern: /(?:podcastfeeds\.[a-z0-9-]+\.[a-z]+|feeds\.simplecast\.com|feeds\.megaphone\.fm|feeds\.transistor\.fm|rss\.art19\.com|feeds\.acast\.com|feeds\.captivate\.fm|feeds\.redcircle\.com|feeds\.soundcloud\.com|anchor\.fm|podbean\.com|buzzsprout\.com|libsyn\.com|pinecast\.com|feeds\.feedburner\.com|minicast\.imbc\.com)/i,
    supportsMedia: true,
    supportsAI: true,
    allowCustomDomains: true, // Podcast feeds can be on any domain
    maxMediaSize: 200 * 1024 * 1024, // 200MB for audio files
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: false },
  },

  blog: {
    id: 'blog',
    displayName: 'Blog',
    emoji: '📝',
    domains: ['github.io'], // GitHub Pages / Jekyll blogs
    // Matches: *.github.io, RSS feed URLs (/feed.xml, /rss, /atom.xml, etc.), Feedburner, or date-based blog post paths
    urlPattern: /(?:\.github\.io|\/feed(?:\.xml|\.json)?$|\/rss(?:\.xml|2)?$|\/atom(?:\.xml)?$|\/index\.xml$|\/feeds?\/|feedburner\.com|\/\d{4}\/\d{2}\/(?:\d{2}\/)?[a-z0-9-]+|\/(?:posts?|blog|articles?)\/\d{4})/i,
    allowCustomDomains: true,
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  medium: {
    id: 'medium',
    displayName: 'Medium',
    emoji: '📖',
    domains: ['medium.com'],
    urlPattern: /medium\.com/i,
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  naver: {
    id: 'naver',
    displayName: 'Naver',
    emoji: '🇰🇷',
    domains: [
      'naver.com',
      'blog.naver.com',
      'm.blog.naver.com',
      'cafe.naver.com',
      'm.cafe.naver.com',
      'n.news.naver.com',
      'm.news.naver.com',
      'rss.blog.naver.com',
    ],
    // Matches blog, cafe, news, and RSS URLs
    urlPattern: /(?:blog\.naver\.com|m\.blog\.naver\.com|cafe\.naver\.com|m\.cafe\.naver\.com|n\.news\.naver\.com|m\.news\.naver\.com|rss\.blog\.naver\.com)/i,
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: false },
  },

  'naver-webtoon': {
    id: 'naver-webtoon',
    displayName: 'Naver Webtoon',
    emoji: '📖',
    domains: ['comic.naver.com'],
    // Matches webtoon list (series) and detail (episode) URLs
    // e.g., comic.naver.com/webtoon/list?titleId=650305
    // e.g., comic.naver.com/webtoon/detail?titleId=650305&no=1
    urlPattern: /comic\.naver\.com\/webtoon\/(?:list|detail)\?titleId=\d+/i,
    supportsMedia: true,
    supportsAI: false, // Webtoons are primarily visual content
    maxMediaSize: 200 * 1024 * 1024, // 200MB for image-heavy content
    rateLimit: { requestsPerHour: 60, requestsPerDay: 500 }, // Conservative for direct API
    features: { stories: false, live: false, reels: false, threads: false },
  },

  webtoons: {
    id: 'webtoons',
    displayName: 'WEBTOON',
    emoji: '📚',
    domains: ['webtoons.com', 'www.webtoons.com'],
    // Matches webtoons.com URLs with language code
    // Series list: webtoons.com/en/genre/series-name/list?title_no=123
    // Episode viewer: webtoons.com/en/genre/series-name/episode-title/viewer?title_no=123&episode_no=1
    // Canvas (user-created): webtoons.com/en/canvas/series-name/list?title_no=123
    urlPattern: /webtoons\.com\/[a-z]{2}\/(?:[^/]+|canvas)\/[^/]+\/(?:list|[^/]+\/viewer)\?title_no=\d+/i,
    supportsMedia: true,
    supportsAI: false, // Webtoons are primarily visual content
    maxMediaSize: 200 * 1024 * 1024, // 200MB for image-heavy content
    rateLimit: { requestsPerHour: 60, requestsPerDay: 500 }, // Conservative for direct API
    features: { stories: false, live: false, reels: false, threads: false },
  },

  brunch: {
    id: 'brunch',
    displayName: 'Brunch',
    emoji: '📝',
    domains: ['brunch.co.kr'],
    // Matches: brunch.co.kr/@username, brunch.co.kr/@username/123, brunch.co.kr/rss/@@userId
    urlPattern: /brunch\.co\.kr(?:\/@[A-Za-z0-9_-]+(?:\/\d+)?|\/rss\/@@\w+|\/brunchbook\/[^/]+|\/keyword\/[^/?]+)/i,
    supportsMedia: true,
    supportsAI: true,
    maxMediaSize: 100 * 1024 * 1024, // 100MB
    rateLimit: { requestsPerHour: 200, requestsPerDay: 2000 },
    features: { stories: false, live: false, reels: false, threads: true },
  },

  post: {
    id: 'post',
    displayName: 'User Post',
    emoji: '📝',
    domains: [],
    urlPattern: /^$/, // Never matches (fallback only)
    supportsMedia: true,
    supportsAI: false,
    maxMediaSize: 10 * 1024 * 1024, // 10MB
    rateLimit: { requestsPerHour: 10, requestsPerDay: 50 },
    features: { stories: false, live: false, reels: false, threads: false },
  },
};

/**
 * Get platform definition by ID
 */
export function getPlatformDefinition(platform: Platform): PlatformDefinition {
  return PLATFORM_DEFINITIONS[platform];
}

/**
 * Get all platform definitions as array
 */
export function getAllPlatformDefinitions(): PlatformDefinition[] {
  return Object.values(PLATFORM_DEFINITIONS);
}

/**
 * Check if hostname matches a podcast feed domain
 * Handles both exact matches (feeds.simplecast.com) and subdomain matches (*.podbean.com)
 *
 * @param hostname - Hostname to check (e.g., 'feeds.simplecast.com')
 * @returns true if hostname is a known podcast domain
 */
export function isPodcastDomain(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  return PLATFORM_DEFINITIONS.podcast.domains.some(domain => {
    const normalizedDomain = domain.toLowerCase();
    // Exact match or subdomain match
    return normalizedHost === normalizedDomain ||
           normalizedHost.endsWith(`.${normalizedDomain}`);
  });
}

/**
 * Check if URL is from a podcast feed domain
 * Convenience wrapper that extracts hostname from URL
 *
 * @param url - Full URL to check
 * @returns true if URL is from a known podcast domain
 */
export function isPodcastFeedUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return isPodcastDomain(urlObj.hostname);
  } catch {
    // If URL parsing fails, try simple string matching
    const lowerUrl = url.toLowerCase();
    return PLATFORM_DEFINITIONS.podcast.domains.some(domain =>
      lowerUrl.includes(domain.toLowerCase())
    );
  }
}

// ============================================================================
// AI Comment Platform Configuration
// ============================================================================

/**
 * AI Comment configuration for a platform
 */
export interface PlatformAICommentConfig {
  /** Whether to show AI comment banner for this platform */
  showBanner: boolean;
  /** Whether transcription is required before AI comments (for audio/video) */
  requiresTranscription: boolean;
  /** Whether AI comments are enabled by default for this platform */
  defaultEnabled: boolean;
  /** Preferred content source for AI analysis */
  contentSource: 'text' | 'rawMarkdown' | 'transcript' | 'description';
}

/**
 * AI Comment configuration per platform
 */
export const PLATFORM_AI_COMMENT_CONFIG: Record<Platform, PlatformAICommentConfig> = {
  facebook: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'text',
  },
  linkedin: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'text',
  },
  instagram: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'text',
  },
  tiktok: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'text',
  },
  x: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'text',
  },
  threads: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'text',
  },
  youtube: {
    showBanner: true,
    requiresTranscription: false, // Can use transcript if available, but not required
    defaultEnabled: true,
    contentSource: 'transcript', // Prefer transcript, fallback to description
  },
  reddit: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'rawMarkdown',
  },
  pinterest: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'text',
  },
  substack: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'rawMarkdown',
  },
  tumblr: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'rawMarkdown',
  },
  mastodon: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'text',
  },
  bluesky: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'text',
  },
  googlemaps: {
    showBanner: false, // Location reviews don't benefit much from AI analysis
    requiresTranscription: false,
    defaultEnabled: false,
    contentSource: 'text',
  },
  velog: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'rawMarkdown',
  },
  podcast: {
    showBanner: true,
    requiresTranscription: true, // Must have transcription for AI analysis
    defaultEnabled: true,
    contentSource: 'transcript',
  },
  blog: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'rawMarkdown',
  },
  medium: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'rawMarkdown',
  },
  naver: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'rawMarkdown',
  },
  'naver-webtoon': {
    showBanner: false, // Webtoons are primarily visual, AI analysis less useful
    requiresTranscription: false,
    defaultEnabled: false,
    contentSource: 'text',
  },
  webtoons: {
    showBanner: false, // Webtoons are primarily visual, AI analysis less useful
    requiresTranscription: false,
    defaultEnabled: false,
    contentSource: 'text',
  },
  brunch: {
    showBanner: true,
    requiresTranscription: false,
    defaultEnabled: true,
    contentSource: 'rawMarkdown',
  },
  post: {
    showBanner: false, // User-created posts don't need AI analysis banner
    requiresTranscription: false,
    defaultEnabled: false,
    contentSource: 'text',
  },
};

/**
 * Get AI comment configuration for a platform
 */
export function getPlatformAICommentConfig(platform: Platform): PlatformAICommentConfig {
  return PLATFORM_AI_COMMENT_CONFIG[platform];
}

// ============================================================================
// Naver Webtoon Cron Schedule Configuration
// ============================================================================

/**
 * Webtoon daily check cron (local KST time)
 *
 * Webtoons release new episodes on publish day, but they become free later.
 * The "X일 후 무료" (free in X days) episodes become free around 23:30 KST daily.
 * We check at 23:45 KST to catch episodes as soon as they become free.
 *
 * This is the recommended cron for all webtoon subscriptions.
 */
export const WEBTOON_DAILY_CRON_LOCAL = '45 23 * * *'; // Daily 23:45 KST

/**
 * @deprecated Use WEBTOON_DAILY_CRON_LOCAL instead.
 * Webtoons should check daily, not on publish day, because episodes become free
 * on a different schedule ("X일 후 무료").
 *
 * Mapping from publish day to cron schedule (LOCAL TIMEZONE - KST)
 *
 * IMPORTANT: These are LOCAL TIME (KST) schedules, NOT UTC!
 * The subscription handler will convert them to UTC using localCronToUtc().
 *
 * Webtoons are released at midnight KST (00:00 KST).
 * We check 30 minutes after release: 00:30 KST on the SAME day.
 *
 * Example: 토요웹툰 (Saturday webtoon) releases at Saturday 00:00 KST
 *          → Check Saturday 00:30 KST (30 min after release) → localCronToUtc converts to Friday 15:30 UTC
 */
export const PUBLISH_DAY_TO_CRON: Record<string, string> = {
  // 월요웹툰 (Monday): Check Monday 00:30 KST → converts to Sunday 15:30 UTC
  월요웹툰: '30 0 * * 1',
  mon: '30 0 * * 1',
  // 화요웹툰 (Tuesday): Check Tuesday 00:30 KST → converts to Monday 15:30 UTC
  화요웹툰: '30 0 * * 2',
  tue: '30 0 * * 2',
  // 수요웹툰 (Wednesday): Check Wednesday 00:30 KST → converts to Tuesday 15:30 UTC
  수요웹툰: '30 0 * * 3',
  wed: '30 0 * * 3',
  // 목요웹툰 (Thursday): Check Thursday 00:30 KST → converts to Wednesday 15:30 UTC
  목요웹툰: '30 0 * * 4',
  thu: '30 0 * * 4',
  // 금요웹툰 (Friday): Check Friday 00:30 KST → converts to Thursday 15:30 UTC
  금요웹툰: '30 0 * * 5',
  fri: '30 0 * * 5',
  // 토요웹툰 (Saturday): Check Saturday 00:30 KST → converts to Friday 15:30 UTC
  토요웹툰: '30 0 * * 6',
  sat: '30 0 * * 6',
  // 일요웹툰 (Sunday): Check Sunday 00:30 KST → converts to Saturday 15:30 UTC
  일요웹툰: '30 0 * * 0',
  sun: '30 0 * * 0',
};

// ============================================================================
// WEBTOON (Global) Cron Schedule Configuration
// ============================================================================

/**
 * WEBTOON (webtoons.com) daily check cron (UTC)
 *
 * WEBTOON Global (webtoons.com) updates at 9:00 PM EST/EDT.
 * To avoid DST complexity, we use a fixed UTC time:
 * - 9 PM EST = 02:00 UTC (next day)
 * - 9 PM EDT = 01:00 UTC (next day)
 *
 * We check at 02:30 UTC to catch all updates regardless of DST.
 * This is slightly late during EDT (01:30 after update) but ensures reliability.
 */
export const WEBTOONS_DAILY_CRON_UTC = '30 2 * * *'; // Daily 02:30 UTC

/**
 * Mapping from WEBTOON publish day to cron schedule (UTC)
 *
 * WEBTOON uses weekday-based publishing similar to Naver Webtoon.
 * Updates at 9 PM EST → we check at 02:30 UTC (next day in UTC terms)
 *
 * Example: "MONDAY" webtoon releases at Monday 9 PM EST
 *          → Check Tuesday 02:30 UTC
 */
export const WEBTOONS_PUBLISH_DAY_TO_CRON: Record<string, string> = {
  // Monday webtoon: Releases Monday 9 PM EST → Check Tuesday 02:30 UTC
  MONDAY: '30 2 * * 2',
  monday: '30 2 * * 2',
  mon: '30 2 * * 2',
  // Tuesday webtoon: Releases Tuesday 9 PM EST → Check Wednesday 02:30 UTC
  TUESDAY: '30 2 * * 3',
  tuesday: '30 2 * * 3',
  tue: '30 2 * * 3',
  // Wednesday webtoon: Releases Wednesday 9 PM EST → Check Thursday 02:30 UTC
  WEDNESDAY: '30 2 * * 4',
  wednesday: '30 2 * * 4',
  wed: '30 2 * * 4',
  // Thursday webtoon: Releases Thursday 9 PM EST → Check Friday 02:30 UTC
  THURSDAY: '30 2 * * 5',
  thursday: '30 2 * * 5',
  thu: '30 2 * * 5',
  // Friday webtoon: Releases Friday 9 PM EST → Check Saturday 02:30 UTC
  FRIDAY: '30 2 * * 6',
  friday: '30 2 * * 6',
  fri: '30 2 * * 6',
  // Saturday webtoon: Releases Saturday 9 PM EST → Check Sunday 02:30 UTC
  SATURDAY: '30 2 * * 0',
  saturday: '30 2 * * 0',
  sat: '30 2 * * 0',
  // Sunday webtoon: Releases Sunday 9 PM EST → Check Monday 02:30 UTC
  SUNDAY: '30 2 * * 1',
  sunday: '30 2 * * 1',
  sun: '30 2 * * 1',
};
