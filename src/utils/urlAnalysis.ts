import type { Platform } from '@/types/post';
import { PlatformDetector } from '@/services/PlatformDetector';
import { isPodcastFeedUrl } from '@/shared/platforms';

/**
 * URL Analysis Result
 * Distinguishes between post URLs, profile URLs, and RSS feed URLs across all supported platforms
 */
export interface UrlAnalysisResult {
  type: 'post' | 'profile' | 'rss' | 'unknown';
  platform: Platform | null;
  handle?: string;           // Profile only - extracted username/handle
  postId?: string;           // Post only - extracted post ID
  feedUrl?: string;          // RSS only - the feed URL
  originalUrl: string;
  normalizedUrl: string;
}

/**
 * Profile URL pattern definition per platform
 */
interface ProfilePattern {
  platform: Platform;
  patterns: RegExp[];
  handleExtractor: (url: URL) => string | null;
}

/**
 * Reserved paths that should NOT be treated as profile URLs
 * These are platform-specific pages (explore, settings, etc.)
 */
const RESERVED_PATHS: Record<string, string[]> = {
  instagram: [
    'explore', 'reels', 'stories', 'direct', 'accounts', 'directory',
    'about', 'legal', 'terms', 'privacy', 'help', 'download', 'developer',
    'p', 'reel', 'tv', 's'
  ],
  naver: [
    // Naver Blog reserved paths
    'PostList.naver', 'PostView.naver', 'BlogHome.naver',
    // Naver Cafe reserved paths (article URLs, not profiles)
    'ArticleRead.nhn', 'ArticleList.nhn',
    // Common reserved paths
    'search', 'help', 'terms', 'privacy', 'about'
  ],
  x: [
    'i', 'explore', 'search', 'notifications', 'messages', 'settings',
    'home', 'compose', 'tos', 'privacy', 'rules', 'login', 'logout',
    'signup', 'account', 'intent', 'widgets', 'help', 'about', 'hashtag'
  ],
  tiktok: [
    'explore', 'following', 'foryou', 'discover', 'upload', 'live',
    'login', 'signup', 'about', 'legal', 'privacy', 'community-guidelines',
    'music', 'tag', 'effect', 'search', 'download', 'video'
  ],
  facebook: [
    'watch', 'marketplace', 'groups', 'gaming', 'events', 'pages',
    'settings', 'help', 'privacy', 'policies', 'login', 'recover',
    'business', 'ads', 'developers', 'stories', 'reels', 'sharer', 'sharer.php',
    // Note: 'share' is NOT reserved - share URLs can be profile share links from mobile app
    'photo.php', 'photo', 'permalink.php', 'story.php'
  ],
  linkedin: [
    'feed', 'mynetwork', 'jobs', 'messaging', 'notifications', 'pulse',
    'learning', 'sales', 'premium', 'help', 'legal', 'posts', 'newsletters',
    'events', 'company', 'school', 'groups', 'showcase'
  ],
  youtube: [
    // Note: 'channel', 'c', 'user' are profile paths, not reserved
    'feed', 'results', 'watch', 'playlist', 'shorts', 'live',
    'gaming', 'music', 'premium', 'upload', 'account', 'settings', 't',
    'about', 'yt', 'howyoutubeworks', 'embed'
  ],
  threads: [
    'login', 'signup', 'about', 'help', 'privacy', 'terms', 'search',
    't', 'activity', 'settings'
  ],
  reddit: [
    // Note: 'r', 'user' and 'u' are profile paths, not reserved
    // 'r' is subreddit profile path (reddit.com/r/subredditname)
    'submit', 'message', 'chat', 'notifications',
    'settings', 'premium', 'coins', 'help', 'about', 'policies',
    'comments', 'subreddits', 'search', 'login', 'register', 'mod',
    'all', 'popular', 'random', 'randnsfw', 'friends'
  ],
  bluesky: [
    // Note: 'profile' is a profile path, not reserved
    'search', 'notifications', 'settings', 'moderation',
    'feeds', 'lists', 'about', 'support', 'home', 'post'
  ],
  pinterest: [
    'pin', 'search', 'today', 'watch', 'shop', 'ideas', 'settings',
    'business', 'about', 'help', 'terms', 'privacy', 'create',
    'topics', 'news_hub', '_'
  ],
  substack: [
    'publish', 'home', 'inbox', 'activity', 'settings', 'upgrade',
    'account', 'about', 'help', 'tos', 'privacy', 'p', 'note', 'post'
  ],
  tumblr: [
    'dashboard', 'explore', 'inbox', 'blog', 'settings', 'help', 'about',
    'policy', 'register', 'login', 'search', 'tagged', 'post'
  ],
  mastodon: [
    'about', 'explore', 'local', 'federated', 'notifications', 'settings',
    'tags', 'lists', 'search', 'directory', 'public', 'relationships',
    'auth', 'oauth', 'filters', 'blocks', 'mutes'
  ],
  brunch: [
    // Brunch reserved paths that are not profiles
    // Note: 'brunchbook' is now handled as a crawlable profile-like URL
    'now', 'keyword', 'apply', 'search', 'help', 'about',
    'magazine', 'rss', 'ready', 'complete'
  ]
};

/**
 * Profile URL patterns per platform
 * Each pattern matches profile URLs and extracts the handle
 */
const PROFILE_PATTERNS: ProfilePattern[] = [
  {
    platform: 'instagram',
    patterns: [
      // instagram.com/username or instagram.com/@username (with optional query params and hash)
      /^https?:\/\/(?:www\.)?instagram\.com\/@?([a-zA-Z0-9._]{1,30})\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const pathname = url.pathname.replace(/^\//, '').replace(/\/$/, '');
      if (!pathname || pathname.includes('/')) return null;
      const handle = pathname.replace(/^@/, '');
      return handle || null;
    }
  },
  {
    platform: 'x',
    patterns: [
      // x.com/username or twitter.com/username (with optional query params and hash)
      /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|mobile\.x\.com|mobile\.twitter\.com)\/([a-zA-Z0-9_]{1,15})\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const pathname = url.pathname.replace(/^\//, '').replace(/\/$/, '');
      if (!pathname || pathname.includes('/')) return null;
      return pathname || null;
    }
  },
  {
    platform: 'tiktok',
    patterns: [
      // tiktok.com/@username (with optional query params and hash)
      /^https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const match = url.pathname.match(/^\/@([a-zA-Z0-9._]+)\/?$/);
      return match?.[1] ?? null;
    }
  },
  {
    platform: 'facebook',
    patterns: [
      // facebook.com/username (with optional query params and hash)
      /^https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com|m\.facebook\.com)\/([a-zA-Z0-9.]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
      /^https?:\/\/(?:www\.)?(?:facebook\.com|m\.facebook\.com)\/profile\.php\?id=\d+/i,
    ],
    handleExtractor: (url: URL): string | null => {
      // Handle profile.php?id=123 format
      const profileId = url.searchParams.get('id');
      if (url.pathname.includes('profile.php') && profileId) {
        return profileId;
      }
      const pathname = url.pathname.replace(/^\//, '').replace(/\/$/, '');
      if (!pathname || pathname.includes('/')) return null;
      return pathname || null;
    }
  },
  {
    platform: 'linkedin',
    patterns: [
      // linkedin.com/in/username (with optional query params and hash)
      /^https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const match = url.pathname.match(/^\/in\/([a-zA-Z0-9\-]+)\/?$/);
      return match?.[1] ?? null;
    }
  },
  {
    platform: 'youtube',
    patterns: [
      // youtube.com/@username or youtube.com/c/channelname or youtube.com/channel/ID (with optional query params and hash)
      /^https?:\/\/(?:www\.)?youtube\.com\/@([a-zA-Z0-9._\-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
      /^https?:\/\/(?:www\.)?youtube\.com\/c\/([a-zA-Z0-9._\-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
      /^https?:\/\/(?:www\.)?youtube\.com\/channel\/([a-zA-Z0-9_\-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
      /^https?:\/\/(?:www\.)?youtube\.com\/user\/([a-zA-Z0-9._\-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      // @handle format
      const handleMatch = url.pathname.match(/^\/@([a-zA-Z0-9._\-]+)\/?$/);
      if (handleMatch) return handleMatch[1] ?? null;

      // /c/channelname format
      const channelNameMatch = url.pathname.match(/^\/c\/([a-zA-Z0-9._\-]+)\/?$/);
      if (channelNameMatch) return channelNameMatch[1] ?? null;

      // /channel/ID format
      const channelIdMatch = url.pathname.match(/^\/channel\/([a-zA-Z0-9_\-]+)\/?$/);
      if (channelIdMatch) return channelIdMatch[1] ?? null;

      // /user/username format
      const userMatch = url.pathname.match(/^\/user\/([a-zA-Z0-9._\-]+)\/?$/);
      if (userMatch) return userMatch[1] ?? null;

      return null;
    }
  },
  {
    platform: 'threads',
    patterns: [
      // threads.net/@username (with optional query params and hash)
      /^https?:\/\/(?:www\.)?threads\.net\/@([a-zA-Z0-9._]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const match = url.pathname.match(/^\/@([a-zA-Z0-9._]+)\/?$/);
      return match?.[1] ?? null;
    }
  },
  {
    platform: 'reddit',
    patterns: [
      // reddit.com/r/subredditname (subreddit profile crawling) (with optional query params and hash)
      /^https?:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\/([a-zA-Z0-9_]{2,21})\/?(?:\?[^#]*)?(?:#.*)?$/i,
      // reddit.com/user/username or reddit.com/u/username (user profiles - not supported yet) (with optional query params and hash)
      /^https?:\/\/(?:www\.|old\.|new\.)?reddit\.com\/(?:user|u)\/([a-zA-Z0-9_\-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      // Subreddit format: /r/subredditname
      const subredditMatch = url.pathname.match(/^\/r\/([a-zA-Z0-9_]{2,21})\/?$/);
      if (subredditMatch) {
        return subredditMatch[1] ?? null;
      }
      // User format: /user/username or /u/username
      const userMatch = url.pathname.match(/^\/(?:user|u)\/([a-zA-Z0-9_\-]+)\/?$/);
      return userMatch?.[1] ?? null;
    }
  },
  {
    platform: 'bluesky',
    patterns: [
      // bsky.app/profile/handle.bsky.social or bsky.app/profile/did:plc:xxx (with optional query params and hash)
      /^https?:\/\/bsky\.app\/profile\/([a-zA-Z0-9._\-]+(?:\.[a-zA-Z0-9._\-]+)*)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const match = url.pathname.match(/^\/profile\/([a-zA-Z0-9._\-]+(?:\.[a-zA-Z0-9._\-]+)*)\/?$/);
      return match?.[1] ?? null;
    }
  },
  {
    platform: 'pinterest',
    patterns: [
      // pinterest.com/username (supports country subdomains like fr.pinterest.com) (with optional query params and hash)
      /^https?:\/\/(?:www\.|[a-z]{2}\.)?pinterest\.com\/([a-zA-Z0-9_]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const pathname = url.pathname.replace(/^\//, '').replace(/\/$/, '');
      if (!pathname || pathname.includes('/')) return null;
      return pathname || null;
    }
  },
  {
    platform: 'substack',
    patterns: [
      // username.substack.com or substack.com/@username (with optional query params and hash)
      /^https?:\/\/([a-zA-Z0-9\-]+)\.substack\.com\/?(?:\?[^#]*)?(?:#.*)?$/i,
      /^https?:\/\/(?:www\.)?substack\.com\/@([a-zA-Z0-9_\-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      // subdomain format: username.substack.com
      const subdomainMatch = url.hostname.match(/^([a-zA-Z0-9\-]+)\.substack\.com$/);
      if (subdomainMatch && subdomainMatch[1] !== 'www') {
        return subdomainMatch[1] ?? null;
      }

      // @username format on main domain
      const pathMatch = url.pathname.match(/^\/@([a-zA-Z0-9_\-]+)\/?$/);
      return pathMatch?.[1] ?? null;
    }
  },
  {
    platform: 'tumblr',
    patterns: [
      // username.tumblr.com or tumblr.com/username (new format) (with optional query params and hash)
      /^https?:\/\/([a-zA-Z0-9\-]+)\.tumblr\.com\/?(?:\?[^#]*)?(?:#.*)?$/i,
      /^https?:\/\/(?:www\.)?tumblr\.com\/([a-zA-Z0-9\-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      // subdomain format: username.tumblr.com
      const subdomainMatch = url.hostname.match(/^([a-zA-Z0-9\-]+)\.tumblr\.com$/);
      if (subdomainMatch && subdomainMatch[1] !== 'www') {
        return subdomainMatch[1] ?? null;
      }

      // new format: tumblr.com/username
      const pathname = url.pathname.replace(/^\//, '').replace(/\/$/, '');
      if (pathname && !pathname.includes('/')) {
        return pathname;
      }

      return null;
    }
  },
  {
    platform: 'medium',
    patterns: [
      // medium.com/@username (with optional query params and hash)
      /^https?:\/\/(?:www\.)?medium\.com\/@([a-zA-Z0-9._-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const match = url.pathname.match(/^\/@([a-zA-Z0-9._-]+)\/?$/);
      return match?.[1] ?? null;
    }
  },
  {
    platform: 'velog',
    patterns: [
      // velog.io/@username (with optional query params and hash)
      /^https?:\/\/velog\.io\/@([a-zA-Z0-9._-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const match = url.pathname.match(/^\/@([a-zA-Z0-9._-]+)\/?$/);
      return match?.[1] ?? null;
    }
  },
  {
    platform: 'mastodon',
    patterns: [
      // mastodon.social/@username (and other instances) (with optional query params and hash)
      /^https?:\/\/[^/]+\/@([a-zA-Z0-9_]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const match = url.pathname.match(/^\/@([a-zA-Z0-9_]+)\/?$/);
      return match?.[1] ?? null;
    }
  },
  {
    platform: 'naver',
    patterns: [
      // Naver Blog: blog.naver.com/{blogId} (with optional query params and hash)
      /^https?:\/\/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
      // Naver Cafe member profile: cafe.naver.com/f-e/cafes/{cafeId}/members/{memberKey}
      /^https?:\/\/cafe\.naver\.com\/f-e\/cafes\/(\d+)\/members\/([a-zA-Z0-9_-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
      // Naver Cafe member profile (ca-fe variant): cafe.naver.com/ca-fe/cafes/{cafeId}/members/{memberKey}
      /^https?:\/\/cafe\.naver\.com\/ca-fe\/cafes\/(\d+)\/members\/([a-zA-Z0-9_-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      const pathname = url.pathname;

      // Naver Blog: blog.naver.com/{blogId}
      if (url.hostname === 'blog.naver.com') {
        const blogMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)\/?$/);
        return blogMatch?.[1] ?? null;
      }

      // Naver Cafe member: cafe.naver.com/f-e/cafes/{cafeId}/members/{memberKey}
      // or: cafe.naver.com/ca-fe/cafes/{cafeId}/members/{memberKey}
      if (url.hostname === 'cafe.naver.com') {
        const cafeMemberMatch = pathname.match(/^\/(?:f-e|ca-fe)\/cafes\/(\d+)\/members\/([a-zA-Z0-9_-]+)\/?$/);
        if (cafeMemberMatch) {
          // Return format: "cafe:{cafeId}:{memberKey}" for cafe member subscriptions
          return `cafe:${cafeMemberMatch[1]}:${cafeMemberMatch[2]}`;
        }
      }

      return null;
    }
  },
  {
    platform: 'brunch',
    patterns: [
      // Brunch author profile: brunch.co.kr/@username (with optional query params and hash)
      /^https?:\/\/brunch\.co\.kr\/@([A-Za-z0-9_-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
      // Brunchbook (series): brunch.co.kr/brunchbook/{bookId} (with optional query params and hash)
      /^https?:\/\/brunch\.co\.kr\/brunchbook\/([A-Za-z0-9_-]+)\/?(?:\?[^#]*)?(?:#.*)?$/i,
    ],
    handleExtractor: (url: URL): string | null => {
      // Pattern: /@username (author profile)
      const authorMatch = url.pathname.match(/^\/@([A-Za-z0-9_-]+)\/?$/);
      if (authorMatch?.[1]) {
        return authorMatch[1];
      }
      // Pattern: /brunchbook/{bookId} (brunchbook series)
      const bookMatch = url.pathname.match(/^\/brunchbook\/([A-Za-z0-9_-]+)\/?$/);
      if (bookMatch?.[1]) {
        // Return with prefix to distinguish from author profile
        return `book:${bookMatch[1]}`;
      }
      return null;
    }
  },
];

// Singleton PlatformDetector instance
const detector = new PlatformDetector();

/**
 * Check if URL is likely an RSS/Atom/JSON feed URL
 */
function isLikelyRSSUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // Explicitly exclude known non-RSS feed paths
  // LinkedIn's /feed/ is a newsfeed, not an RSS feed
  if (lowerUrl.includes('linkedin.com/feed/')) {
    return false;
  }

  // Check for podcast feed hosting domains first (using shared definition)
  if (isPodcastFeedUrl(url)) {
    return true;
  }

  const patterns = [
    /\/feed\/?$/i,          // /feed or /feed/ at end of URL only
    /\/feed\/podcast\//i,   // /feed/podcast/ (WordPress podcast feeds)
    /\/podcast\//i,         // /podcast/ path (e.g., minicast.imbc.com/PodCast/)
    /\/rss\/?$/i,           // /rss or /rss/
    /\/atom\/?$/i,          // /atom or /atom/
    /\.xml$/i,              // *.xml files
    /\.rss$/i,              // *.rss files
    /\.atom$/i,             // *.atom files
    /\/feed\.xml/i,         // /feed.xml
    /\/rss\.xml/i,          // /rss.xml
    /\/atom\.xml/i,         // /atom.xml
    /\/index\.xml/i,        // /index.xml (common for static site generators)
    /\/feed\.json/i,        // JSON Feed
    // Removed: /\/feeds?\//i - too broad, matches LinkedIn /feed/update/
    /\/feeds\//i,           // /feeds/ only (plural, less ambiguous)
    /feedburner\.com/i,     // Feedburner
    /\/rss2/i,              // RSS 2.0 feeds
    /feeds\.feedburner/i,   // feedburner feeds
    /v2\.velog\.io\/rss/i,  // Velog RSS feed (v2.velog.io/rss/@username)
    /\/audio\/podcast\//i,  // /audio/podcast/ (JTBC-style podcast feeds)
    /\/v\d+\/.*podcast\//i, // /v1/podcast/, /v2/audio/podcast/ (API-style podcast feeds)
    /rss\.blog\.naver\.com/i, // Naver Blog RSS feed (rss.blog.naver.com/{blogId}.xml)
  ];
  return patterns.some(pattern => pattern.test(lowerUrl));
}

/**
 * RSS platforms that support profile URL to RSS feed URL derivation
 * Note: 'naver' only applies to Naver Blog, not Cafe member profiles
 */
const RSS_PROFILE_PLATFORMS = ['medium', 'tumblr', 'velog', 'substack', 'naver'] as const;
type RSSProfilePlatform = typeof RSS_PROFILE_PLATFORMS[number];

/**
 * Check if platform supports RSS profile URL derivation
 */
function isRSSProfilePlatform(platform: Platform | null): platform is RSSProfilePlatform {
  return platform !== null && RSS_PROFILE_PLATFORMS.includes(platform as RSSProfilePlatform);
}

/**
 * Derive RSS feed URL from profile URL for RSS-based platforms
 *
 * @param platform - Detected platform
 * @param profileUrl - Normalized profile URL
 * @param handle - Extracted handle
 * @returns RSS feed URL if derivable, null otherwise
 *
 * Feed URL patterns:
 * - Medium: https://medium.com/feed/@username
 * - Tumblr (subdomain): https://username.tumblr.com/rss
 * - Tumblr (new format): https://www.tumblr.com/username/rss -> https://username.tumblr.com/rss
 * - Velog: https://v2.velog.io/rss/@username
 * - Substack: https://username.substack.com/feed
 */
function deriveRSSFeedUrl(platform: Platform, profileUrl: string, handle: string): string | null {
  try {
    const urlObj = new URL(profileUrl);

    switch (platform) {
      case 'medium':
        // Medium: https://medium.com/feed/@username
        return `https://medium.com/feed/@${handle}`;

      case 'tumblr': {
        // Check if already subdomain format (username.tumblr.com)
        const subdomainMatch = urlObj.hostname.match(/^([a-zA-Z0-9-]+)\.tumblr\.com$/i);
        if (subdomainMatch && subdomainMatch[1] !== 'www') {
          return `https://${subdomainMatch[1]}.tumblr.com/rss`;
        }
        // New format (tumblr.com/username) -> convert to subdomain RSS
        return `https://${handle}.tumblr.com/rss`;
      }

      case 'velog':
        // Velog: https://v2.velog.io/rss/@username
        return `https://v2.velog.io/rss/@${handle}`;

      case 'substack': {
        // Check if already subdomain format (username.substack.com)
        const substackMatch = urlObj.hostname.match(/^([a-zA-Z0-9-]+)\.substack\.com$/i);
        if (substackMatch && substackMatch[1] !== 'www') {
          return `https://${substackMatch[1]}.substack.com/feed`;
        }
        // Main domain format (substack.com/@username) -> convert to subdomain feed
        return `https://${handle}.substack.com/feed`;
      }

      case 'naver': {
        // Only Naver Blog supports RSS (not Cafe member profiles)
        // Cafe member profiles have format "cafe:{cafeId}:{memberKey}"
        if (handle.startsWith('cafe:')) {
          return null; // Cafe member profiles don't use RSS
        }
        // Naver Blog: blog.naver.com/{blogId} -> rss.blog.naver.com/{blogId}.xml
        return `https://rss.blog.naver.com/${handle}.xml`;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Detect platform from RSS feed URL
 */
function detectPlatformFromRSSUrl(url: string): Platform {
  const lowerUrl = url.toLowerCase();

  // Podcast feed hosting domains -> return 'podcast' (using shared definition)
  if (isPodcastFeedUrl(url)) {
    return 'podcast';
  }

  // WordPress-style podcast feeds: /feed/podcast/
  if (lowerUrl.includes('/feed/podcast/')) {
    return 'podcast';
  }

  // URL paths containing /podcast/ or /audio/podcast/ (e.g., JTBC, broadcaster feeds)
  if (lowerUrl.includes('/audio/podcast/') || /\/v\d+\/.*podcast\//.test(lowerUrl)) {
    return 'podcast';
  }

  // Known platform patterns
  if (lowerUrl.includes('substack.com')) return 'substack';
  if (lowerUrl.includes('tumblr.com')) return 'tumblr';
  if (lowerUrl.includes('reddit.com') || lowerUrl.includes('redd.it')) return 'reddit';
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  if (lowerUrl.includes('velog.io') || lowerUrl.includes('v2.velog.io')) return 'velog';
  if (lowerUrl.includes('medium.com')) return 'medium';
  if (lowerUrl.includes('rss.blog.naver.com') || lowerUrl.includes('blog.naver.com')) return 'naver';

  // Nitter instances (X/Twitter RSS proxies)
  if (lowerUrl.includes('xcancel.com') ||
      lowerUrl.includes('twiiit.com') ||
      lowerUrl.includes('nitter.net') ||
      lowerUrl.includes('nitter.privacydev.net') ||
      lowerUrl.includes('nitter.poast.org')) {
    return 'x';
  }

  // Blog platforms -> return 'blog'
  if (lowerUrl.includes('ghost.io') || lowerUrl.includes('ghost.org') ||
      lowerUrl.includes('wordpress.com') || lowerUrl.includes('wordpress.org') ||
      lowerUrl.includes('blogger.com') || lowerUrl.includes('blogspot.com') ||
      lowerUrl.includes('beehiiv.com') ||
      lowerUrl.includes('buttondown.email') ||
      lowerUrl.includes('revue.email') ||
      lowerUrl.includes('dev.to') ||
      lowerUrl.includes('hashnode.dev') ||
      lowerUrl.includes('hackernoon.com')) {
    return 'blog';
  }

  // Default to blog for unknown RSS feeds
  return 'blog';
}

/**
 * Normalize URL for analysis
 */
function normalizeUrl(url: string): string {
  let normalized = url.trim();

  // Add protocol if missing
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = `https://${normalized}`;
  }

  // Remove whitespace and ensure single protocol
  normalized = normalized
    .replace(/\s+/g, '')
    .replace(/^(https?:\/\/)+/i, 'https://');

  return normalized;
}

/**
 * Check if path is a reserved path for the given platform
 */
function isReservedPath(platform: Platform, pathname: string): boolean {
  const reservedPaths = RESERVED_PATHS[platform];
  if (!reservedPaths) return false;

  // Get the first path segment
  const firstSegment = pathname.replace(/^\//, '').split('/')[0]?.toLowerCase();
  if (!firstSegment) return false;

  return reservedPaths.includes(firstSegment);
}

/**
 * Check if URL contains post-identifying segments
 * These segments indicate a post URL rather than a profile URL
 */
function hasPostSegments(pathname: string): boolean {
  const postSegments = [
    '/p/',           // Instagram posts
    '/reel/',        // Instagram reels
    '/reels/',       // Instagram reels (alternate)
    '/tv/',          // IGTV
    '/stories/',     // Stories
    '/status/',      // X/Twitter tweets
    '/video/',       // TikTok videos
    '/videos/',      // Facebook videos
    '/photo/',       // TikTok/X photos
    '/posts/',       // Facebook/LinkedIn posts
    '/watch',        // Facebook watch
    '/permalink',    // Facebook permalinks
    // Note: '/share/' is NOT included - Facebook share URLs can be profile share links from mobile app
    '/sharer/',      // Facebook sharer (different from share)
    '/comments/',    // Reddit comments
    '/post/',        // Threads/Bluesky posts
    '/t/',           // Threads short format
    '/pin/',         // Pinterest pins
    '/shorts/',      // YouTube shorts
    '/embed/',       // Embeds
    '/live/',        // Live videos
    '/pulse/',       // LinkedIn pulse
    '/feed/update/', // LinkedIn feed
    '/note/',        // Substack notes
  ];

  const lowerPathname = pathname.toLowerCase();
  return postSegments.some(segment => lowerPathname.includes(segment));
}

/**
 * Analyze URL to determine if it's a post URL or profile URL
 *
 * @param url - URL to analyze
 * @returns Analysis result with type, platform, and extracted data
 */
export function analyzeUrl(url: string): UrlAnalysisResult {
  const originalUrl = url;

  try {
    const normalizedUrl = normalizeUrl(url);
    const urlObj = new URL(normalizedUrl);

    // Check for RSS/Atom/JSON feed URLs FIRST (before platform detection)
    if (isLikelyRSSUrl(normalizedUrl)) {
      const rssPlatform = detectPlatformFromRSSUrl(normalizedUrl);
      return {
        type: 'rss',
        platform: rssPlatform,
        feedUrl: normalizedUrl,
        originalUrl,
        normalizedUrl
      };
    }

    // First, detect the platform using existing PlatformDetector
    let platform = detector.detectPlatform(normalizedUrl);

    // Special handling for Mastodon profile URLs
    // PlatformDetector only matches Mastodon posts (/@user/123), not profiles (/@user)
    // Check if URL matches Mastodon profile pattern: any domain with /@username or /@username@instance
    // Federated handles: /@user@remote.instance (e.g., /@dazeemdas@uri.life)
    if (!platform) {
      const mastodonProfilePattern = /^https?:\/\/[^/]+\/@([a-zA-Z0-9_]+(?:@[a-zA-Z0-9._-]+)?)\/?$/i;
      if (mastodonProfilePattern.test(normalizedUrl)) {
        const match = urlObj.pathname.match(/^\/@([a-zA-Z0-9_]+(?:@[a-zA-Z0-9._-]+)?)\/?$/);
        if (match) {
          return {
            type: 'profile',
            platform: 'mastodon',
            handle: match[1],
            originalUrl,
            normalizedUrl
          };
        }
      }
    }

    if (!platform) {
      return {
        type: 'unknown',
        platform: null,
        originalUrl,
        normalizedUrl
      };
    }

    // Special handling for Facebook share URLs (mobile app share links)
    // Format: facebook.com/share/p/xxxx = POST share link (explicit post)
    // Format: facebook.com/share/v/xxxx = VIDEO share link (explicit video)
    // Format: facebook.com/share/xxxx = POST share link (bare format from newer mobile app)
    if (platform === 'facebook' && urlObj.pathname.startsWith('/share/')) {
      // Check if it's an explicit typed share link (/share/p/xxxx or /share/v/xxxx)
      const typedShareMatch = urlObj.pathname.match(/^\/share\/[pv]\/([a-zA-Z0-9]+)/);
      if (typedShareMatch && typedShareMatch[1]) {
        return {
          type: 'post',
          platform: 'facebook',
          postId: `share:${typedShareMatch[1]}`, // Special marker for share URLs
          originalUrl,
          normalizedUrl
        };
      }

      // Bare share link (/share/xxxx without /p/ or /v/)
      // Facebook mobile app generates these for post sharing
      const bareShareMatch = urlObj.pathname.match(/^\/share\/([a-zA-Z0-9]+)/);
      if (bareShareMatch && bareShareMatch[1]) {
        return {
          type: 'post',
          platform: 'facebook',
          postId: `share:${bareShareMatch[1]}`, // Special marker for share URLs
          originalUrl,
          normalizedUrl
        };
      }
    }

    // Check if URL has post-identifying segments (indicates post URL)
    if (hasPostSegments(urlObj.pathname)) {
      const postId = detector.extractPostId(normalizedUrl);
      return {
        type: 'post',
        platform,
        postId: postId ?? undefined,
        originalUrl,
        normalizedUrl
      };
    }

    // Try to match profile patterns BEFORE checking reserved paths
    // This ensures URLs like /channel/ID, /user/username, /profile/handle are matched correctly
    const profilePattern = PROFILE_PATTERNS.find(p => p.platform === platform);

    if (profilePattern) {
      // Check if any profile pattern matches
      const isProfileMatch = profilePattern.patterns.some(pattern => pattern.test(normalizedUrl));

      if (isProfileMatch) {
        const handle = profilePattern.handleExtractor(urlObj);

        // Validate handle is not a reserved path (but allow profile-specific paths)
        if (handle && !isReservedPath(platform, `/${handle}`)) {
          // For RSS-based platforms (Medium, Tumblr, Velog, Substack),
          // convert profile URL to RSS type with derived feed URL
          if (isRSSProfilePlatform(platform)) {
            const feedUrl = deriveRSSFeedUrl(platform, normalizedUrl, handle);
            if (feedUrl) {
              return {
                type: 'rss',
                platform,
                handle,
                feedUrl,
                originalUrl,
                normalizedUrl
              };
            }
          }

          return {
            type: 'profile',
            platform,
            handle,
            originalUrl,
            normalizedUrl
          };
        }
      }
    }

    // Check if path is a reserved platform path (not a profile)
    if (isReservedPath(platform, urlObj.pathname)) {
      // Could be a post URL or other platform page
      const postId = detector.extractPostId(normalizedUrl);
      if (postId) {
        return {
          type: 'post',
          platform,
          postId,
          originalUrl,
          normalizedUrl
        };
      }

      return {
        type: 'unknown',
        platform,
        originalUrl,
        normalizedUrl
      };
    }

    // If no profile match, try to extract post ID
    const postId = detector.extractPostId(normalizedUrl);
    if (postId) {
      return {
        type: 'post',
        platform,
        postId,
        originalUrl,
        normalizedUrl
      };
    }

    // Platform detected but can't determine type
    return {
      type: 'unknown',
      platform,
      originalUrl,
      normalizedUrl
    };

  } catch {
    return {
      type: 'unknown',
      platform: null,
      originalUrl,
      normalizedUrl: originalUrl
    };
  }
}

/**
 * Quick check if URL is a profile URL
 *
 * @param url - URL to check
 * @returns true if URL is a profile URL, false otherwise
 */
export function isProfileUrl(url: string): boolean {
  const result = analyzeUrl(url);
  return result.type === 'profile';
}

/**
 * Quick check if URL is a post URL
 *
 * @param url - URL to check
 * @returns true if URL is a post URL, false otherwise
 */
export function isPostUrl(url: string): boolean {
  const result = analyzeUrl(url);
  return result.type === 'post';
}

/**
 * Extract handle from profile URL
 *
 * @param url - Profile URL
 * @returns Handle/username if URL is a profile URL, null otherwise
 */
export function extractHandle(url: string): string | null {
  const result = analyzeUrl(url);
  return result.type === 'profile' ? (result.handle ?? null) : null;
}

// ============================================================================
// Instagram URL Parsing (Legacy Compatibility)
// ============================================================================

/**
 * Instagram URL parsing result
 */
export interface ParseInstagramUrlResult {
  valid: boolean;
  username: string | null;
  error?: string;
}

/**
 * Validate Instagram URL and extract username
 *
 * This function provides specific validation for Instagram profile URLs
 * with detailed error messages for different failure cases.
 *
 * @param url - URL string to parse
 * @returns Parsing result with validity, username, and optional error message
 *
 * @example
 * ```typescript
 * const result = parseInstagramUrl('https://instagram.com/username');
 * if (result.valid) {
 *   console.debug(result.username); // 'username'
 * }
 * ```
 */
export function parseInstagramUrl(url: string): ParseInstagramUrlResult {
  const trimmed = url.trim();

  if (!trimmed) {
    return { valid: false, username: null, error: 'URL is required' };
  }

  // Check if it's an Instagram URL (with optional query params and hash)
  const instagramPattern = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/@?([a-zA-Z0-9._]{1,30})\/?(?:\?[^#]*)?(?:#.*)?$/i;
  const match = trimmed.match(instagramPattern);

  if (!match) {
    // Check if it's a different platform
    if (trimmed.includes('twitter.com') || trimmed.includes('x.com')) {
      return { valid: false, username: null, error: 'This is an X/Twitter URL. Use parseXUrl() for X profiles.' };
    }
    if (trimmed.includes('tiktok.com')) {
      return { valid: false, username: null, error: 'TikTok is not supported yet. Only Instagram and X profiles are available.' };
    }
    if (trimmed.includes('facebook.com')) {
      return { valid: false, username: null, error: 'Facebook is not supported yet. Only Instagram and X profiles are available.' };
    }

    return { valid: false, username: null, error: 'Invalid Instagram URL. Example: https://instagram.com/username' };
  }

  const username = match[1]?.toLowerCase();

  // Check for reserved paths
  const reserved = ['about', 'accounts', 'api', 'developer', 'download', 'explore', 'help', 'legal', 'p', 'reel', 'reels', 'stories', 'direct', 'tv', 'live'];
  if (reserved.includes(username || '')) {
    return { valid: false, username: null, error: 'This appears to be a post URL, not a profile URL.' };
  }

  // Check for post/reel URLs
  if (trimmed.includes('/p/') || trimmed.includes('/reel/') || trimmed.includes('/stories/')) {
    return { valid: false, username: null, error: 'This is a post URL. Please enter a profile URL like instagram.com/username' };
  }

  return { valid: true, username: username || null };
}

// ============================================================================
// X (Twitter) URL Parsing
// ============================================================================

/**
 * X URL parsing result
 */
export interface ParseXUrlResult {
  valid: boolean;
  username: string | null;
  error?: string;
}

/**
 * Validate X (Twitter) URL and extract username
 *
 * This function provides specific validation for X profile URLs
 * with detailed error messages for different failure cases.
 *
 * @param url - URL string to parse
 * @returns Parsing result with validity, username, and optional error message
 *
 * @example
 * ```typescript
 * const result = parseXUrl('https://x.com/username');
 * if (result.valid) {
 *   console.debug(result.username); // 'username'
 * }
 * ```
 */
export function parseXUrl(url: string): ParseXUrlResult {
  const trimmed = url.trim();

  if (!trimmed) {
    return { valid: false, username: null, error: 'URL is required' };
  }

  // Check if it's an X/Twitter URL (with optional query params and hash)
  const xPattern = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/@?([a-zA-Z0-9_]{1,15})\/?(?:\?[^#]*)?(?:#.*)?$/i;
  const match = trimmed.match(xPattern);

  if (!match) {
    // Check if it's a different platform
    if (trimmed.includes('instagram.com')) {
      return { valid: false, username: null, error: 'This is an Instagram URL. Use parseInstagramUrl() for Instagram profiles.' };
    }
    if (trimmed.includes('tiktok.com')) {
      return { valid: false, username: null, error: 'TikTok is not supported yet. Only Instagram and X profiles are available.' };
    }
    if (trimmed.includes('facebook.com')) {
      return { valid: false, username: null, error: 'Facebook is not supported yet. Only Instagram and X profiles are available.' };
    }

    return { valid: false, username: null, error: 'Invalid X URL. Example: https://x.com/username' };
  }

  const username = match[1]?.toLowerCase();

  // Check for reserved paths
  const reserved = ['about', 'account', 'api', 'compose', 'download', 'explore', 'help', 'home', 'i', 'intent', 'lists', 'login', 'logout', 'messages', 'moments', 'notifications', 'search', 'settings', 'signup', 'tos', 'privacy', 'hashtag', 'topics', 'who_to_follow'];
  if (reserved.includes(username || '')) {
    return { valid: false, username: null, error: 'This appears to be a system page, not a profile URL.' };
  }

  // Check for tweet/status URLs
  if (trimmed.includes('/status/') || trimmed.includes('/i/')) {
    return { valid: false, username: null, error: 'This is a tweet URL. Please enter a profile URL like x.com/username' };
  }

  return { valid: true, username: username || null };
}

/**
 * Parse profile URL for subscription - supports both Instagram and X
 *
 * @param url - URL string to parse
 * @returns Parsing result with validity, username, platform, and optional error message
 */
export interface ParseProfileUrlResult {
  valid: boolean;
  username: string | null;
  platform: 'instagram' | 'x' | 'facebook' | null;
  error?: string;
}

/**
 * Parse Facebook URL and extract username
 */
export interface ParseFacebookUrlResult {
  valid: boolean;
  username: string | null;
  error?: string;
}

export function parseFacebookUrl(url: string): ParseFacebookUrlResult {
  const trimmed = url.trim();

  if (!trimmed) {
    return { valid: false, username: null, error: 'URL is required' };
  }

  // Check for Facebook share URLs
  // Format: facebook.com/share/p/xxxx = POST share link (reject - this is for profile parsing)
  // Format: facebook.com/share/xxxx = PROFILE share link (valid)
  // IMPORTANT: Only match if /share/ is in the pathname, not in query params
  try {
    const urlObj = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (urlObj.pathname.startsWith('/share/')) {
      // Check if it's a post share link (/share/p/xxxx)
      if (urlObj.pathname.match(/^\/share\/p\//)) {
        return { valid: false, username: null, error: 'This is a post URL. Please enter a profile URL like facebook.com/username' };
      }

      // Profile share link (/share/xxxx without /p/)
      const shareMatch = urlObj.pathname.match(/^\/share\/([a-zA-Z0-9]+)/);
      if (shareMatch && shareMatch[1]) {
        // Return the share ID as a temporary username - server will expand to real profile
        return { valid: true, username: `share:${shareMatch[1]}` };
      }
    }
  } catch {
    // Invalid URL, continue with normal parsing
  }

  // Reserved paths that are not profiles
  const reserved = ['about', 'ads', 'advertising', 'business', 'developers', 'download',
    'events', 'gaming', 'groups', 'help', 'legal', 'login', 'marketplace',
    'messages', 'pages', 'payments', 'photos', 'policies', 'posts', 'privacy',
    'recover', 'settings', 'sharer', 'stories', 'reels', 'watch',
    'video', 'videos', 'permalink', 'photo', 'story', 'profile'];

  // Check for post URLs (but NOT share URLs - they're handled above)
  if (trimmed.includes('/posts/') || trimmed.includes('/videos/') || trimmed.includes('/photos/') ||
      trimmed.includes('/watch/') || trimmed.includes('/sharer') || trimmed.includes('/groups/') ||
      trimmed.includes('/events/') || trimmed.includes('/permalink')) {
    return { valid: false, username: null, error: 'This is a post URL. Please enter a profile URL like facebook.com/username' };
  }

  // Check for profile.php?id= format
  const profileIdMatch = trimmed.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
  if (profileIdMatch && profileIdMatch[1]) {
    return { valid: true, username: profileIdMatch[1] };
  }

  // Check standard profile URL format
  const profileMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook\.com|fb\.com)\/([a-zA-Z0-9.]+)\/?(?:\?[^#]*)?(?:#.*)?$/i);
  if (!profileMatch) {
    return { valid: false, username: null, error: 'Invalid Facebook URL. Example: https://facebook.com/username' };
  }

  const username = profileMatch[1]?.toLowerCase();
  if (reserved.includes(username || '')) {
    return { valid: false, username: null, error: 'This appears to be a system page, not a profile URL.' };
  }

  return { valid: true, username: username || null };
}

export function parseProfileUrl(url: string): ParseProfileUrlResult {
  const trimmed = url.trim().toLowerCase();

  // Detect platform and route to appropriate parser
  if (trimmed.includes('instagram.com')) {
    const result = parseInstagramUrl(url);
    return {
      valid: result.valid,
      username: result.username,
      platform: result.valid ? 'instagram' : null,
      error: result.error,
    };
  }

  // Facebook profile crawling
  if (trimmed.includes('facebook.com') || trimmed.includes('fb.com')) {
    const result = parseFacebookUrl(url);
    return {
      valid: result.valid,
      username: result.username,
      platform: result.valid ? 'facebook' : null,
      error: result.error,
    };
  }

  // X (Twitter) profile crawling is disabled - BrightData returns non-chronological posts when not logged in
  if (trimmed.includes('twitter.com') || trimmed.includes('x.com')) {
    return {
      valid: false,
      username: null,
      platform: 'x',
      error: 'X (Twitter) profile crawling is temporarily disabled. Only Instagram and Facebook profiles are supported.',
    };
  }

  // Unsupported platform
  if (trimmed.includes('tiktok.com')) {
    return { valid: false, username: null, platform: null, error: 'TikTok is not supported yet. Only Instagram and Facebook profiles are available.' };
  }

  return { valid: false, username: null, platform: null, error: 'Invalid profile URL. Supported: instagram.com/username or facebook.com/username' };
}

// ============================================================================
// YouTube URL Parsing
// ============================================================================

/**
 * YouTube URL parsing result
 */
export interface ParseYouTubeProfileUrlResult {
  valid: boolean;
  handle: string | null;
  urlType: 'handle' | 'channel' | 'c' | 'user' | null;
  error?: string;
}

/**
 * Quick check if URL is a YouTube profile URL
 *
 * @param url - URL to check
 * @returns true if URL is a YouTube profile URL, false otherwise
 */
export function isYouTubeProfileUrl(url: string): boolean {
  const result = analyzeUrl(url);
  return result.type === 'profile' && result.platform === 'youtube';
}

/**
 * Validate YouTube URL and extract handle with URL type information
 *
 * This function provides specific validation for YouTube profile URLs
 * with detailed error messages for different failure cases.
 *
 * @param url - URL string to parse
 * @returns Parsing result with validity, handle, urlType, and optional error message
 *
 * @example
 * ```typescript
 * const result = parseYouTubeProfileUrl('https://youtube.com/@MrBeast');
 * if (result.valid) {
 *   console.debug(result.handle);  // 'MrBeast'
 *   console.debug(result.urlType); // 'handle'
 * }
 * ```
 */
export function parseYouTubeProfileUrl(url: string): ParseYouTubeProfileUrlResult {
  const trimmed = url.trim();

  if (!trimmed) {
    return { valid: false, handle: null, urlType: null, error: 'URL is required' };
  }

  let normalizedUrl: string;
  let urlObj: URL;

  try {
    normalizedUrl = normalizeUrl(trimmed);
    urlObj = new URL(normalizedUrl);
  } catch {
    return { valid: false, handle: null, urlType: null, error: 'Invalid URL format' };
  }

  // Check if it's a YouTube URL
  if (!urlObj.hostname.includes('youtube.com')) {
    return { valid: false, handle: null, urlType: null, error: 'Not a YouTube URL. Example: https://youtube.com/@username' };
  }

  const pathname = urlObj.pathname;

  // Check for content URLs (not profile URLs)
  if (pathname.includes('/watch') || urlObj.search.includes('v=')) {
    return { valid: false, handle: null, urlType: null, error: 'This is a video URL. Please enter a channel URL like youtube.com/@channelname' };
  }
  if (pathname.includes('/shorts/')) {
    return { valid: false, handle: null, urlType: null, error: 'This is a Shorts URL. Please enter a channel URL like youtube.com/@channelname' };
  }
  if (pathname.includes('/live/')) {
    return { valid: false, handle: null, urlType: null, error: 'This is a live stream URL. Please enter a channel URL like youtube.com/@channelname' };
  }
  if (pathname.includes('/playlist') || urlObj.search.includes('list=')) {
    return { valid: false, handle: null, urlType: null, error: 'This is a playlist URL. Please enter a channel URL like youtube.com/@channelname' };
  }

  // Check for reserved paths
  const firstSegment = pathname.replace(/^\//, '').split('/')[0]?.toLowerCase();
  const reservedPaths = RESERVED_PATHS['youtube'] || [];
  if (firstSegment && reservedPaths.includes(firstSegment)) {
    return { valid: false, handle: null, urlType: null, error: 'This is not a channel URL. Please enter a channel URL like youtube.com/@channelname' };
  }

  // Try to match profile patterns and determine URL type
  // Note: pathname doesn't include query params or hash, so no changes needed here
  // @handle format: youtube.com/@username
  const handleMatch = pathname.match(/^\/@([a-zA-Z0-9._\-]+)\/?$/);
  if (handleMatch && handleMatch[1]) {
    return { valid: true, handle: handleMatch[1], urlType: 'handle' };
  }

  // /channel/ID format: youtube.com/channel/UCxxxxxxxx
  const channelMatch = pathname.match(/^\/channel\/([a-zA-Z0-9_\-]+)\/?$/);
  if (channelMatch && channelMatch[1]) {
    // Validate channel ID format (should start with UC)
    if (!channelMatch[1].startsWith('UC')) {
      return { valid: false, handle: null, urlType: null, error: 'Invalid channel ID format. Channel IDs should start with UC.' };
    }
    return { valid: true, handle: channelMatch[1], urlType: 'channel' };
  }

  // /c/customname format: youtube.com/c/channelname
  const customMatch = pathname.match(/^\/c\/([a-zA-Z0-9._\-]+)\/?$/);
  if (customMatch && customMatch[1]) {
    return { valid: true, handle: customMatch[1], urlType: 'c' };
  }

  // /user/username format: youtube.com/user/username
  const userMatch = pathname.match(/^\/user\/([a-zA-Z0-9._\-]+)\/?$/);
  if (userMatch && userMatch[1]) {
    return { valid: true, handle: userMatch[1], urlType: 'user' };
  }

  return { valid: false, handle: null, urlType: null, error: 'Invalid YouTube channel URL. Examples: youtube.com/@channelname, youtube.com/channel/UCxxxx' };
}

// ============================================================================
// Reddit Profile Type Detection
// ============================================================================

/**
 * Determine Reddit profile type from URL
 *
 * @param url - Reddit URL to analyze
 * @returns 'subreddit' for /r/ URLs, 'user' for /user/ or /u/ URLs, null if neither
 *
 * @example
 * ```typescript
 * getRedditProfileTypeFromUrl('https://reddit.com/r/ObsidianMD'); // 'subreddit'
 * getRedditProfileTypeFromUrl('https://reddit.com/user/Jun_imgibble'); // 'user'
 * getRedditProfileTypeFromUrl('https://reddit.com/u/test_user'); // 'user'
 * getRedditProfileTypeFromUrl('https://reddit.com/comments/xxx'); // null
 * ```
 */
export function getRedditProfileTypeFromUrl(url: string): 'subreddit' | 'user' | null {
  try {
    const normalizedUrl = normalizeUrl(url);

    // Check for subreddit URL pattern: /r/subredditname
    if (/\/r\/[a-zA-Z0-9_]+/.test(normalizedUrl)) {
      return 'subreddit';
    }

    // Check for user profile URL pattern: /user/username or /u/username
    if (/\/(?:user|u)\/[a-zA-Z0-9_\-]+/.test(normalizedUrl)) {
      return 'user';
    }

    return null;
  } catch {
    return null;
  }
}
