/**
 * AuthorDeduplicator Service
 *
 * Deduplicates raw author data from vault scans into unique
 * AuthorCatalogEntry records with aggregated statistics.
 *
 * Single Responsibility: Author deduplication and aggregation
 */

import type { Platform } from '../types/post';
import type {
  RawAuthorData,
  AuthorCatalogEntry,
  AuthorSubscriptionStatus,
  DeduplicationResult,
  NormalizedAuthorUrl
} from '../types/author-catalog';

// ============================================================================
// URL Normalization Helpers
// ============================================================================

/**
 * Platform-specific URL patterns for normalization
 */
const PLATFORM_URL_PATTERNS: Record<string, RegExp[]> = {
  x: [
    /^https?:\/\/(www\.)?(twitter|x)\.com\/(@)?([^/?#]+)/i,
    /^https?:\/\/mobile\.(twitter|x)\.com\/(@)?([^/?#]+)/i
  ],
  instagram: [
    /^https?:\/\/(www\.)?instagram\.com\/([^/?#]+)/i,
    /^https?:\/\/instagr\.am\/([^/?#]+)/i
  ],
  facebook: [
    /^https?:\/\/(www\.)?(facebook|fb)\.com\/([^/?#]+)/i,
    /^https?:\/\/m\.facebook\.com\/([^/?#]+)/i
  ],
  linkedin: [
    /^https?:\/\/([a-z]{2}\.)?linkedin\.com\/in\/([^/?#]+)/i,  // Personal: /in/username (with optional country subdomain)
    /^https?:\/\/([a-z]{2}\.)?linkedin\.com\/company\/([^/?#]+)/i,  // Company: /company/name
    /^https?:\/\/www\.linkedin\.com\/in\/([^/?#]+)/i,  // www variant
    /^https?:\/\/www\.linkedin\.com\/company\/([^/?#]+)/i  // www company variant
  ],
  tiktok: [
    /^https?:\/\/(www\.)?tiktok\.com\/@([^/?#]+)/i,
    /^https?:\/\/vm\.tiktok\.com\/([^/?#]+)/i
  ],
  threads: [
    /^https?:\/\/(www\.)?threads\.net\/@?([^/?#]+)/i
  ],
  youtube: [
    /^https?:\/\/(www\.)?youtube\.com\/(c\/|channel\/|@)?([^/?#]+)/i,
    /^https?:\/\/youtu\.be\/([^/?#]+)/i
  ],
  reddit: [
    /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/r\/([^/?#]+)/i,  // Subreddit: /r/subredditname
    /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\/(u|user)\/([^/?#]+)/i  // User: /u/username
  ],
  pinterest: [
    /^https?:\/\/(www\.|[a-z]{2}\.)?pinterest\.com\/([^/?#]+)/i
  ],
  substack: [
    /^https?:\/\/([^.]+)\.substack\.com/i
  ],
  tumblr: [
    /^https?:\/\/([^.]+)\.tumblr\.com/i
  ],
  mastodon: [
    /^https?:\/\/([^/]+)\/@([^/?#]+)/i
  ],
  bluesky: [
    /^https?:\/\/(www\.)?bsky\.app\/profile\/([^/?#]+)/i
  ],
  // Naver Webtoon patterns - titleId in query param is the handle
  'naver-webtoon': [
    /^https?:\/\/comic\.naver\.com\/webtoon\/list\?titleId=(\d+)/i,
    /^https?:\/\/comic\.naver\.com\/webtoon\/detail\?titleId=(\d+)/i
  ],
  // Medium patterns - detected as 'blog' platform but need special handling
  medium: [
    /^https?:\/\/(www\.)?medium\.com\/@([^/?#]+)/i,  // medium.com/@username
    /^https?:\/\/([^.]+)\.medium\.com/i  // username.medium.com
  ],
  // GitHub Pages / Jekyll blogs - detected as 'blog' platform but need special handling
  // Format: username.github.io or username.github.io/repo-name
  githubPages: [
    /^https?:\/\/([^.]+)\.github\.io(?:\/([^/?#]+))?/i
  ],
  // Velog - Korean developer blog platform
  // Format: velog.io/@username or velog.io/@username/post-slug
  velog: [
    /^https?:\/\/(www\.)?velog\.io\/@([^/?#]+)/i,
    /^https?:\/\/v2\.velog\.io\/rss\/@?([^/?#]+)/i  // RSS feed URL
  ]
};

/**
 * Normalize an author URL for deduplication
 *
 * @param url Raw URL to normalize
 * @param platform Optional known platform
 * @returns NormalizedAuthorUrl with canonical URL and extracted info
 */
export function normalizeAuthorUrl(url: string, platform?: Platform): NormalizedAuthorUrl {
  if (!url || !url.trim()) {
    return { url: '', platform: platform || null, handle: null };
  }

  let normalizedUrl = url.trim().toLowerCase();

  // Remove trailing slashes
  normalizedUrl = normalizedUrl.replace(/\/+$/, '');

  // Remove query parameters
  normalizedUrl = (normalizedUrl.split('?')[0]) || '';

  // Remove hash/fragment
  normalizedUrl = (normalizedUrl.split('#')[0]) || '';

  // Ensure https
  if (normalizedUrl.startsWith('http://')) {
    normalizedUrl = normalizedUrl.replace('http://', 'https://');
  }

  // Detect platform from URL if not provided
  let detectedPlatform: Platform | null = platform || null;
  let handle: string | null = null;

  // Try to extract handle and platform from URL
  for (const [platformKey, patterns] of Object.entries(PLATFORM_URL_PATTERNS)) {
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        detectedPlatform = platformKey as Platform;
        // Handle is usually in capture group 2 or 3
        handle = match[match.length - 1] || null;
        break;
      }
    }
    if (detectedPlatform && handle) break;
  }

  // Platform-specific normalizations
  if (detectedPlatform === 'x') {
    // Normalize twitter.com to x.com
    normalizedUrl = normalizedUrl.replace(/twitter\.com/i, 'x.com');
    normalizedUrl = normalizedUrl.replace(/mobile\.x\.com/i, 'x.com');
  }

  if (detectedPlatform === 'facebook') {
    // Normalize fb.com to facebook.com
    normalizedUrl = normalizedUrl.replace(/\/\/fb\.com/i, '//facebook.com');
    normalizedUrl = normalizedUrl.replace(/m\.facebook\.com/i, 'facebook.com');
  }

  if (detectedPlatform === 'pinterest') {
    // Normalize country code subdomains (fr.pinterest.com) to www.pinterest.com
    normalizedUrl = normalizedUrl.replace(/\/\/[a-z]{2}\.pinterest\.com/i, '//www.pinterest.com');
    // Normalize bare domain (pinterest.com) to www.pinterest.com
    normalizedUrl = normalizedUrl.replace(/\/\/pinterest\.com/i, '//www.pinterest.com');
  }

  if (detectedPlatform === 'linkedin') {
    // Normalize country code subdomains (kr.linkedin.com, de.linkedin.com) to www.linkedin.com
    normalizedUrl = normalizedUrl.replace(/\/\/[a-z]{2}\.linkedin\.com/i, '//www.linkedin.com');
    // Normalize bare domain (linkedin.com) to www.linkedin.com
    normalizedUrl = normalizedUrl.replace(/\/\/linkedin\.com/i, '//www.linkedin.com');
    // Ensure consistent /in/ format with trailing info removed (handle already extracted)
    if (handle) {
      normalizedUrl = `https://www.linkedin.com/in/${handle.toLowerCase()}`;
    }
  }

  if (detectedPlatform === 'youtube') {
    // Normalize YouTube URLs to consistent format for deduplication:
    // - Channel IDs (starting with UC, 24 chars) → /channel/UCxxxxx
    // - Custom handles → /@handle
    if (handle) {
      const normalizedHandle = handle.toLowerCase();
      // YouTube channel IDs start with 'uc' and are 24 characters total
      if (normalizedHandle.startsWith('uc') && normalizedHandle.length === 24) {
        // This is a channel ID - normalize to /channel/ format
        normalizedUrl = `https://www.youtube.com/channel/${normalizedHandle}`;
      } else {
        // This is a custom handle - normalize to /@ format
        normalizedUrl = `https://www.youtube.com/@${normalizedHandle}`;
      }
    }
  }

  // Normalize Substack URLs to base profile URL (strip /p/post-slug paths)
  // Pattern: xxx.substack.com/p/... → xxx.substack.com
  if (detectedPlatform === 'substack' && handle) {
    normalizedUrl = `https://${handle.toLowerCase()}.substack.com`;
  }

  // Normalize Tumblr URLs to base profile URL (strip post paths)
  // Pattern: xxx.tumblr.com/post/... → xxx.tumblr.com
  if (detectedPlatform === 'tumblr' && handle) {
    normalizedUrl = `https://${handle.toLowerCase()}.tumblr.com`;
  }

  // Normalize Naver Webtoon URLs - preserve titleId as part of URL
  // Pattern: comic.naver.com/webtoon/list?titleId=650305 → comic.naver.com/webtoon/list?titleId=650305
  // Pattern: comic.naver.com/webtoon/detail?titleId=650305&no=4 → comic.naver.com/webtoon/list?titleId=650305
  // The handle is the titleId extracted from query param
  if (detectedPlatform === 'naver-webtoon' && handle) {
    normalizedUrl = `https://comic.naver.com/webtoon/list?titleid=${handle.toLowerCase()}`;
  }

  // Normalize Velog URLs to base profile URL (strip post paths)
  // Pattern: velog.io/@username/post-slug → velog.io/@username
  // Pattern: v2.velog.io/rss/@username → velog.io/@username
  if (detectedPlatform === 'velog' && handle) {
    // Remove @ prefix if present in handle
    const cleanHandle = handle.startsWith('@') ? handle.substring(1) : handle;
    normalizedUrl = `https://velog.io/@${cleanHandle.toLowerCase()}`;
  }

  // Normalize Medium URLs to base profile URL (strip post paths)
  // Medium is often detected as 'blog' platform, so check URL directly
  // Pattern: medium.com/@username/post-slug → medium.com/@username
  // Pattern: username.medium.com/post → username.medium.com
  try {
    const parsedUrl = new URL(normalizedUrl);
    const isMedium = parsedUrl.hostname === 'medium.com' ||
                     parsedUrl.hostname === 'www.medium.com' ||
                     parsedUrl.hostname.endsWith('.medium.com');

    if (isMedium) {
      if (parsedUrl.hostname === 'medium.com' || parsedUrl.hostname === 'www.medium.com') {
        // Extract @username from path
        const pathParts = parsedUrl.pathname.split('/').filter(p => p);
        const userPart = pathParts.find(p => p.startsWith('@'));
        if (userPart) {
          // Normalize to canonical format: medium.com/@username
          normalizedUrl = `https://medium.com/${userPart.toLowerCase()}`;
          handle = userPart.substring(1).toLowerCase(); // Remove @ for handle
        }
      } else if (parsedUrl.hostname.endsWith('.medium.com') && parsedUrl.hostname !== 'www.medium.com') {
        // Custom subdomain (e.g., startupgrind.medium.com)
        // Normalize to canonical format: medium.com/@subdomain
        const parts = parsedUrl.hostname.split('.');
        if (parts.length >= 3 && parts[0]) {
          handle = parts[0].toLowerCase();
          normalizedUrl = `https://medium.com/@${handle}`;
        }
      }
    }

    // Normalize custom domain blog URLs with date-based paths to base URL
    // Pattern: www.thestartupbible.com/2025/12/post-title.html → www.thestartupbible.com
    // Pattern: blog.example.com/2024/01/01/post-title → blog.example.com
    const dateBasedBlogPattern = /^\/\d{4}\/\d{2}\/(?:\d{2}\/)?[a-z0-9-]+/i;
    if (detectedPlatform === 'blog' && dateBasedBlogPattern.test(parsedUrl.pathname)) {
      // Extract domain name as handle (without www/blog prefixes)
      const hostParts = parsedUrl.hostname.split('.');
      const cleanParts = hostParts.filter(p => !['www', 'blog', 'feeds'].includes(p));
      if (cleanParts.length >= 2 && cleanParts[0]) {
        handle = cleanParts[0];
      }
      // Normalize to base URL (origin only)
      normalizedUrl = parsedUrl.origin.toLowerCase();
    }

    // Normalize GitHub Pages / Jekyll blog URLs to base profile URL
    // Pattern: username.github.io/2024/01/01/post-title → username.github.io
    // Pattern: username.github.io/repo-name/2024/... → username.github.io/repo-name (if repo-name is first path segment)
    const isGitHubPages = parsedUrl.hostname.endsWith('.github.io');
    if (isGitHubPages) {
      const parts = parsedUrl.hostname.split('.');
      handle = parts[0] ?? null; // username

      // Check if there's a repo name (project site vs user site)
      // User site: username.github.io → no repo path needed
      // Project site: username.github.io/repo-name → keep /repo-name
      const pathParts = parsedUrl.pathname.split('/').filter(p => p);

      // Detect if first path segment is a repo name vs date/post path
      // Jekyll date-based URLs typically start with year (4 digits) or YYYY-MM-DD format
      // Also exclude common Jekyll paths like /feed.xml, /assets, /posts, etc.
      const firstPathPart = pathParts[0] || '';
      // Match various Jekyll date formats: /2025/..., /2025-07-15/...
      const isDatePath = /^\d{4}$/.test(firstPathPart) || /^\d{4}-\d{2}-\d{2}/.test(firstPathPart);
      const isCommonPath = ['feed.xml', 'feed', 'rss', 'assets', 'posts', 'tags', 'categories', 'about', 'contact', 'archive', 'archives', 'page', 'blog'].includes(firstPathPart.toLowerCase());

      if (pathParts.length > 0 && !isDatePath && !isCommonPath && firstPathPart.length > 0) {
        // Likely a project site with repo name
        normalizedUrl = `https://${parsedUrl.hostname}/${firstPathPart}`.toLowerCase();
      } else {
        // User site or no repo name
        normalizedUrl = parsedUrl.origin.toLowerCase();
      }
    }
  } catch {
    // Keep as-is if URL parsing fails
  }

  return {
    url: normalizedUrl,
    platform: detectedPlatform,
    handle
  };
}

/**
 * Normalize author name for comparison
 *
 * @param name Raw author name
 * @returns Normalized name for comparison
 */
export function normalizeAuthorName(name: string): string {
  if (!name || !name.trim()) {
    return '';
  }

  return name
    .trim()
    .toLowerCase()
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    // Remove common suffixes/prefixes
    .replace(/^@/, '')
    .replace(/\s*\(.*?\)\s*$/, '') // Remove parenthetical notes
    .trim();
}

function normalizeBio(bio: string | null | undefined): string | null {
  if (!bio) return null;
  const trimmed = bio.trim();
  if (!trimmed) return null;
  // Guard against unexpectedly large strings (can freeze the UI when rendered in lists).
  const MAX_BIO_CHARS = 2000;
  return trimmed.length > MAX_BIO_CHARS ? trimmed.slice(0, MAX_BIO_CHARS) : trimmed;
}

/**
 * Generate a unique key for author deduplication
 *
 * Primary key: normalized author URL + platform
 * Fallback: normalized name + platform (when URL unavailable)
 */
export function generateAuthorKey(
  authorUrl: string,
  authorName: string,
  platform: Platform
): string {
  const normalizedUrl = normalizeAuthorUrl(authorUrl, platform);

  if (normalizedUrl.url) {
    return `${platform}:${normalizedUrl.url}`;
  }

  // Fallback to name-based key
  const normalizedName = normalizeAuthorName(authorName);
  return `${platform}:name:${normalizedName}`;
}

// ============================================================================
// AuthorDeduplicator Class
// ============================================================================

/**
 * Map of subscription IDs by author key
 */
export type SubscriptionMap = Map<string, {
  subscriptionId: string;
  status: AuthorSubscriptionStatus;
  lastRunAt?: Date | null;
  schedule?: string | null;
  maxPostsPerRun?: number;
  redditOptions?: {
    sortBy: 'Best' | 'Hot' | 'New' | 'Top' | 'Rising';
    sortByTime: 'Now' | 'Today' | 'This Week' | 'This Month' | 'This Year' | 'All Time' | '';
    keyword?: string;
  };
  // Naver Cafe subscription options (for cafe member subscriptions)
  naverCafeOptions?: {
    maxPostsPerRun: number;
    backfillDays: number;
    keyword?: string;
  };
  // Fetch mode indicator (Task 339)
  // - 'local': Plugin polls locally (Naver)
  // - 'cloud': Worker polls via cloud
  // - 'hybrid': Worker detects via RSS, Plugin fetches content (Brunch)
  fetchMode?: 'local' | 'cloud' | 'hybrid';
  // Config warning message (Task 339)
  configWarning?: string;
  // Additional author info for subscription-only entries
  authorName?: string;
  authorUrl?: string;
  authorAvatar?: string;
  handle?: string;
  platform?: Platform;
  // Author bio (from xMetadata for X subscriptions)
  bio?: string;
  // Local avatar path for subscription-only entries (orphaned avatar recovery)
  localAvatarPath?: string | null;
}>;

/**
 * Options for async deduplication (UI-friendly).
 */
export interface DeduplicateAsyncOptions {
  /**
   * How many raw records to process per chunk before yielding.
   * @default 2000
   */
  chunkSize?: number;
  /**
   * When true, yields to the UI between chunks to keep Obsidian responsive.
   * @default false
   */
  yieldToUi?: boolean;
  /**
   * Optional progress callback (processed raw records / total).
   */
  onProgress?: (processed: number, total: number) => void;
  /**
   * Optional stage callback for UI messaging.
   */
  onStage?: (stage: 'accumulate' | 'finalize' | 'subscriptions' | 'merge' | 'sort') => void;
  /**
   * Skip final sort by lastSeenAt (AuthorCatalog UI sorts anyway).
   * @default true
   */
  skipFinalSort?: boolean;
}

/**
 * AuthorDeduplicator
 *
 * Deduplicates raw author data into unique AuthorCatalogEntry records
 */
export class AuthorDeduplicator {
  // --------------------------------------------------------------------------
  // Public Methods
  // --------------------------------------------------------------------------

  /**
   * Deduplicate raw author data into unique entries with aggregated stats
   *
   * @param rawData Array of RawAuthorData from vault scan
   * @param subscriptionMap Optional map of subscription info by author key
   * @returns DeduplicationResult with unique author entries
   */
  deduplicate(
    rawData: RawAuthorData[],
    subscriptionMap?: SubscriptionMap
  ): DeduplicationResult {
    const startTime = Date.now();

    // Map to accumulate authors by key
    const authorMap = new Map<string, AuthorAccumulator>();

    // Process each raw record
    for (const raw of rawData) {
      const key = generateAuthorKey(raw.authorUrl, raw.authorName, raw.platform);

      if (authorMap.has(key)) {
        // Update existing accumulator
        const acc = authorMap.get(key);
        if (acc) this.updateAccumulator(acc, raw);
      } else {
        // Create new accumulator
        authorMap.set(key, this.createAccumulator(raw));
      }
    }

    // Convert accumulators to AuthorCatalogEntry
    // Track subscription IDs that are already matched to vault authors
    const matchedSubscriptionIds = new Set<string>();
    const authors: AuthorCatalogEntry[] = [];
    authorMap.forEach((acc, key) => {
      const entry = this.accumulatorToEntry(acc, key, subscriptionMap);
      authors.push(entry);
      // Track if this vault author matched a subscription
      if (entry.subscriptionId) {
        matchedSubscriptionIds.add(entry.subscriptionId);
      }
    });

    // Add subscription-only authors (subscriptions without any posts in vault)
    if (subscriptionMap) {
      const addedSubscriptionIds = new Set<string>(); // Track added subscription IDs to prevent duplicates
      subscriptionMap.forEach((subInfo, key) => {
        // Skip if this subscription was already matched to a vault author
        if (matchedSubscriptionIds.has(subInfo.subscriptionId)) {
          return;
        }
        // Skip if this subscription was already added as subscription-only (prevents duplicates from multiple keys)
        if (addedSubscriptionIds.has(subInfo.subscriptionId)) {
          return;
        }
        // This subscription has no posts in vault - create a placeholder entry
        const subscriptionOnlyEntry = this.createSubscriptionOnlyEntry(key, subInfo);
        if (subscriptionOnlyEntry) {
          authors.push(subscriptionOnlyEntry);
          addedSubscriptionIds.add(subInfo.subscriptionId);
        }
      });
    }

    // Merge name-based entries with URL-based entries for same author
    const mergedAuthors = this.mergeNameBasedWithUrlBased(authors);

    // Sort by lastSeenAt descending (most recent first)
    // Use safe getTime with NaN fallback to prevent unstable sort
    mergedAuthors.sort((a, b) => {
      const aTime = a.lastSeenAt instanceof Date ? a.lastSeenAt.getTime() : 0;
      const bTime = b.lastSeenAt instanceof Date ? b.lastSeenAt.getTime() : 0;
      return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
    });

    return {
      authors: mergedAuthors,
      totalProcessed: rawData.length,
      duplicatesMerged: rawData.length - mergedAuthors.length,
      durationMs: Date.now() - startTime
    };
  }

  /**
   * Async variant of deduplicate() that can cooperatively yield to keep the UI responsive.
   *
   * This is important for large vaults where processing tens of thousands of archived posts
   * can otherwise block the main thread long enough to look like an "app freeze".
   */
  async deduplicateAsync(
    rawData: RawAuthorData[],
    subscriptionMap?: SubscriptionMap,
    options?: DeduplicateAsyncOptions
  ): Promise<DeduplicationResult> {
    const startTime = Date.now();

    const chunkSize = Math.max(1, Math.floor(options?.chunkSize ?? 2000));
    const yieldToUi = options?.yieldToUi ?? false;
    const skipFinalSort = options?.skipFinalSort ?? true;

    const authorMap = new Map<string, AuthorAccumulator>();

    options?.onStage?.('accumulate');
    for (let i = 0; i < rawData.length; i++) {
      const raw = rawData[i];
      if (!raw) continue;
      const key = generateAuthorKey(raw.authorUrl, raw.authorName, raw.platform);

      const existing = authorMap.get(key);
      if (existing) {
        this.updateAccumulator(existing, raw);
      } else {
        authorMap.set(key, this.createAccumulator(raw));
      }

      if (yieldToUi && (i + 1) % chunkSize === 0) {
        options?.onProgress?.(i + 1, rawData.length);
        await yieldBetweenChunks();
      }
    }

    options?.onProgress?.(rawData.length, rawData.length);

    // Convert accumulators to AuthorCatalogEntry
    const matchedSubscriptionIds = new Set<string>();
    const authors: AuthorCatalogEntry[] = [];

    options?.onStage?.('finalize');
    let accIndex = 0;
    const accChunkSize = Math.max(1, Math.floor(chunkSize / 4));
    for (const [key, acc] of authorMap.entries()) {
      const entry = this.accumulatorToEntry(acc, key, subscriptionMap);
      authors.push(entry);
      if (entry.subscriptionId) {
        matchedSubscriptionIds.add(entry.subscriptionId);
      }

      accIndex++;
      if (yieldToUi && accIndex % accChunkSize === 0) {
        await yieldBetweenChunks();
      }
    }

    // Add subscription-only authors (subscriptions without any posts in vault)
    if (subscriptionMap) {
      options?.onStage?.('subscriptions');
      const addedSubscriptionIds = new Set<string>();
      let subIndex = 0;
      for (const [key, subInfo] of subscriptionMap.entries()) {
        if (matchedSubscriptionIds.has(subInfo.subscriptionId)) {
          subIndex++;
          continue;
        }
        if (addedSubscriptionIds.has(subInfo.subscriptionId)) {
          subIndex++;
          continue;
        }

        const subscriptionOnlyEntry = this.createSubscriptionOnlyEntry(key, subInfo);
        if (subscriptionOnlyEntry) {
          authors.push(subscriptionOnlyEntry);
          addedSubscriptionIds.add(subInfo.subscriptionId);
        }

        subIndex++;
        if (yieldToUi && subIndex % chunkSize === 0) {
          await yieldBetweenChunks();
        }
      }
    }

    if (yieldToUi) {
      await yieldBetweenChunks();
    }

    options?.onStage?.('merge');
    const mergedAuthors = this.mergeNameBasedWithUrlBased(authors);

    if (!skipFinalSort) {
      options?.onStage?.('sort');
      // Sort by lastSeenAt descending (most recent first)
      mergedAuthors.sort((a, b) => {
        const aTime = a.lastSeenAt instanceof Date ? a.lastSeenAt.getTime() : 0;
        const bTime = b.lastSeenAt instanceof Date ? b.lastSeenAt.getTime() : 0;
        return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
      });
    }

    return {
      authors: mergedAuthors,
      totalProcessed: rawData.length,
      duplicatesMerged: rawData.length - mergedAuthors.length,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Merge new raw data with existing entries
   *
   * @param existing Existing author entries
   * @param newData New raw data to merge
   * @param subscriptionMap Optional subscription map
   * @returns Updated author entries
   */
  merge(
    existing: AuthorCatalogEntry[],
    newData: RawAuthorData[],
    subscriptionMap?: SubscriptionMap
  ): AuthorCatalogEntry[] {
    // Convert existing entries back to accumulators
    const authorMap = new Map<string, AuthorAccumulator>();

    for (const entry of existing) {
      const key = generateAuthorKey(entry.authorUrl, entry.authorName, entry.platform);
      authorMap.set(key, this.entryToAccumulator(entry));
    }

    // Merge new data
    for (const raw of newData) {
      const key = generateAuthorKey(raw.authorUrl, raw.authorName, raw.platform);

      if (authorMap.has(key)) {
        const acc = authorMap.get(key);
        if (acc) this.updateAccumulator(acc, raw);
      } else {
        authorMap.set(key, this.createAccumulator(raw));
      }
    }

    // Convert back to entries
    const authors: AuthorCatalogEntry[] = [];
    authorMap.forEach((acc, key) => {
      const entry = this.accumulatorToEntry(acc, key, subscriptionMap);
      authors.push(entry);
    });

    // Merge name-based entries with URL-based entries for same author
    const mergedAuthors = this.mergeNameBasedWithUrlBased(authors);

    // Sort by lastSeenAt descending (safe NaN handling)
    mergedAuthors.sort((a, b) => {
      const aTime = a.lastSeenAt instanceof Date ? a.lastSeenAt.getTime() : 0;
      const bTime = b.lastSeenAt instanceof Date ? b.lastSeenAt.getTime() : 0;
      return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
    });

    return mergedAuthors;
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Create a new accumulator from raw data
   */
      private createAccumulator(raw: RawAuthorData): AuthorAccumulator {
        return {
      authorNames: [{ name: raw.authorName, count: 1 }],
      authorUrl: raw.authorUrl,
      platform: raw.platform,
      avatars: raw.avatar ? [{ avatar: raw.avatar, timestamp: raw.archivedAt }] : [],
      localAvatars: raw.localAvatar ? [{ path: raw.localAvatar, timestamp: raw.archivedAt }] : [],
      handles: raw.handle ? [raw.handle] : [],
      latestTimestamp: raw.archivedAt,
      filePaths: [raw.filePath],
      archiveCount: 1,
      unarchivedCount: raw.timelineArchived === true ? 0 : 1,
              // Extended metadata (track most recent values)
              followers: raw.followers ?? null,
              postsCount: raw.postsCount ?? null,
              bio: normalizeBio(raw.bio),
          lastMetadataUpdate: raw.lastMetadataUpdate ?? null,
          community: raw.community ?? null,
          // Webtoon-specific info
          webtoonInfo: raw.webtoonInfo ?? null
        };
      }

  /**
   * Update accumulator with new raw data
   */
  private updateAccumulator(acc: AuthorAccumulator, raw: RawAuthorData): void {
    // Update archive count
    acc.archiveCount++;
    if (raw.timelineArchived !== true) {
      acc.unarchivedCount++;
    }

    // Track file path
    if (!acc.filePaths.includes(raw.filePath)) {
      acc.filePaths.push(raw.filePath);
    }

    // Update name counts
    const existingName = acc.authorNames.find(
      n => normalizeAuthorName(n.name) === normalizeAuthorName(raw.authorName)
    );
    if (existingName) {
      existingName.count++;
    } else if (raw.authorName) {
      acc.authorNames.push({ name: raw.authorName, count: 1 });
    }

    // Update latest timestamp
    if (raw.archivedAt > acc.latestTimestamp) {
      acc.latestTimestamp = raw.archivedAt;
    }

    // Track avatars with timestamps (prefer most recent)
    if (raw.avatar) {
      acc.avatars.push({ avatar: raw.avatar, timestamp: raw.archivedAt });
    }

    // Track local avatars with timestamps (prefer most recent)
    if (raw.localAvatar) {
      acc.localAvatars.push({ path: raw.localAvatar, timestamp: raw.archivedAt });
    }

    // Track handles
    if (raw.handle && !acc.handles.includes(raw.handle)) {
      acc.handles.push(raw.handle);
    }

    // Use URL if we don't have one
    if (!acc.authorUrl && raw.authorUrl) {
      acc.authorUrl = raw.authorUrl;
    }

    // Update extended metadata if newer (prefer most recent with data)
    const rawMetadataTime = raw.lastMetadataUpdate?.getTime() ?? raw.archivedAt.getTime();
    const accMetadataTime = acc.lastMetadataUpdate?.getTime() ?? 0;

        if (rawMetadataTime >= accMetadataTime) {
      if (raw.followers !== null && raw.followers !== undefined) {
        acc.followers = raw.followers;
      }
      if (raw.postsCount !== null && raw.postsCount !== undefined) {
        acc.postsCount = raw.postsCount;
      }
          if (raw.bio) {
            const normalized = normalizeBio(raw.bio);
            if (normalized) {
              acc.bio = normalized;
            }
          }
      if (raw.community) {
        acc.community = raw.community;
      }
      if (raw.lastMetadataUpdate) {
        acc.lastMetadataUpdate = raw.lastMetadataUpdate;
      }
      // Update webtoonInfo if more complete
      if (raw.webtoonInfo && (!acc.webtoonInfo || raw.webtoonInfo.titleName)) {
        acc.webtoonInfo = raw.webtoonInfo;
      }
    }
  }

  /**
   * Convert accumulator to AuthorCatalogEntry
   */
  private accumulatorToEntry(
    acc: AuthorAccumulator,
    key: string,
    subscriptionMap?: SubscriptionMap
  ): AuthorCatalogEntry {
    // Select best author name (most common, or most recent if tie)
    const bestName = this.selectBestName(acc.authorNames);

    // Select best avatar (most recent non-null)
    const bestAvatar = this.selectBestAvatar(acc.avatars);

    // Select best local avatar (most recent non-null)
    const bestLocalAvatar = this.selectBestLocalAvatar(acc.localAvatars);

    // Look up subscription info
    const subInfo = subscriptionMap?.get(key);

        return {
      authorName: bestName,
      authorUrl: acc.authorUrl,
      platform: acc.platform,
      avatar: bestAvatar || subInfo?.authorAvatar || null,
      localAvatar: bestLocalAvatar,
      lastSeenAt: acc.latestTimestamp,
      lastRunAt: subInfo?.lastRunAt || null,
      schedule: subInfo?.schedule || null,
      archiveCount: acc.archiveCount,
      unarchivedCount: acc.unarchivedCount,
      subscriptionId: subInfo?.subscriptionId || null,
      status: subInfo?.status || 'not_subscribed',
      handle: acc.handles[0] || undefined,
      filePaths: acc.filePaths,
      // Extended metadata (fallback to subscription data if not in posts)
      followers: acc.followers,
      postsCount: acc.postsCount,
          bio: normalizeBio(acc.bio) || normalizeBio(subInfo?.bio) || null,
          lastMetadataUpdate: acc.lastMetadataUpdate,
          community: acc.community,
      // Subscription options
      maxPostsPerRun: subInfo?.maxPostsPerRun,
      redditOptions: subInfo?.redditOptions,
      naverCafeOptions: subInfo?.naverCafeOptions,
      fetchMode: subInfo?.fetchMode,
      configWarning: subInfo?.configWarning,
      // Webtoon-specific info (from vault frontmatter)
      isWebtoon: acc.platform === 'naver-webtoon' || acc.platform === 'webtoons' || !!acc.webtoonInfo,
      webtoonInfo: acc.webtoonInfo ? {
        titleId: acc.webtoonInfo.titleId || '',
        titleName: acc.webtoonInfo.titleName,
        publishDay: acc.webtoonInfo.publishDay || '',
        finished: acc.webtoonInfo.finished || false,
        genre: acc.webtoonInfo.genre,
      } : undefined
    };
  }

  /**
   * Create an AuthorCatalogEntry for a subscription-only author (no posts in vault)
   */
      private createSubscriptionOnlyEntry(
    key: string,
    subInfo: SubscriptionMap extends Map<string, infer V> ? V : never
  ): AuthorCatalogEntry | null {
    // Prefer author info from subInfo if available (set by buildSubscriptionMapFromApi)
    if (subInfo.platform && (subInfo.authorName || subInfo.handle)) {
          return {
        authorName: subInfo.authorName || subInfo.handle || 'Unknown',
        authorUrl: subInfo.authorUrl || '',
        platform: subInfo.platform,
        avatar: subInfo.authorAvatar || null, // Use avatar from subscription (e.g., Naver cafe member)
        localAvatar: subInfo.localAvatarPath || null, // Use orphaned avatar if found
        lastSeenAt: new Date(), // No posts, use current time
            lastRunAt: subInfo.lastRunAt || null,
            schedule: subInfo.schedule || null,
            archiveCount: 0, // No posts in vault
            unarchivedCount: 0,
            subscriptionId: subInfo.subscriptionId,
            status: subInfo.status,
            handle: subInfo.handle,
            filePaths: [],
        // No extended metadata for subscription-only (except bio from xMetadata)
        followers: null,
        postsCount: null,
            bio: normalizeBio(subInfo.bio) || null,
            lastMetadataUpdate: null,
        // Subscription options
        maxPostsPerRun: subInfo.maxPostsPerRun,
        redditOptions: subInfo.redditOptions,
        naverCafeOptions: subInfo.naverCafeOptions,
        fetchMode: subInfo.fetchMode,
        configWarning: subInfo.configWarning
      };
    }

    // Fallback: Parse key to extract platform and URL/name
    // Key format: "platform:url" or "platform:name:normalizedName"
    const parts = key.split(':');
    if (parts.length < 2) return null;

    const platform = parts[0] as Platform;
    const isNameBased = parts[1] === 'name';

    let authorUrl = '';
    let authorName = '';
    let handle: string | undefined;

    if (isNameBased) {
      // Name-based key: "platform:name:normalizedName"
      authorName = parts.slice(2).join(':') || 'Unknown';
    } else {
      // URL-based key: "platform:https://..."
      authorUrl = parts.slice(1).join(':');
      // Extract handle from URL
      const normalized = normalizeAuthorUrl(authorUrl, platform);
      handle = normalized.handle || undefined;
      authorName = handle || 'Unknown';
    }

    return {
      authorName,
      authorUrl,
      platform,
      avatar: null,
      localAvatar: subInfo.localAvatarPath || null, // Use orphaned avatar if found
      lastSeenAt: new Date(), // No posts, use current time
      lastRunAt: subInfo.lastRunAt || null,
      schedule: subInfo.schedule || null,
      archiveCount: 0, // No posts in vault
      unarchivedCount: 0,
      subscriptionId: subInfo.subscriptionId,
      status: subInfo.status,
      handle,
      filePaths: [],
      // No extended metadata for subscription-only
      followers: null,
      postsCount: null,
      bio: null,
      lastMetadataUpdate: null,
      // Subscription options
      maxPostsPerRun: subInfo.maxPostsPerRun,
      redditOptions: subInfo.redditOptions
    };
  }

  /**
   * Convert entry back to accumulator for merging
   */
      private entryToAccumulator(entry: AuthorCatalogEntry): AuthorAccumulator {
        return {
      authorNames: [{ name: entry.authorName, count: entry.archiveCount }],
      authorUrl: entry.authorUrl,
      platform: entry.platform,
      avatars: entry.avatar ? [{ avatar: entry.avatar, timestamp: entry.lastSeenAt }] : [],
      localAvatars: entry.localAvatar ? [{ path: entry.localAvatar, timestamp: entry.lastSeenAt }] : [],
      handles: entry.handle ? [entry.handle] : [],
      latestTimestamp: entry.lastSeenAt,
      filePaths: entry.filePaths || [],
      archiveCount: entry.archiveCount,
      unarchivedCount: entry.unarchivedCount ?? entry.archiveCount,
      // Extended metadata
      followers: entry.followers ?? null,
      postsCount: entry.postsCount ?? null,
              bio: normalizeBio(entry.bio),
          lastMetadataUpdate: entry.lastMetadataUpdate ?? null,
          community: entry.community ?? null,
      // Webtoon info
      webtoonInfo: entry.webtoonInfo ?? null
    };
  }

  /**
   * Select the best author name from variants
   */
  private selectBestName(names: Array<{ name: string; count: number }>): string {
    if (names.length === 0) return 'Unknown';
    if (names.length === 1) return names[0]?.name ?? 'Unknown';

    // Sort by count descending
    const sorted = [...names].sort((a, b) => b.count - a.count);

    // Return most common name
    const top = sorted[0];
    return top ? top.name : 'Unknown';
  }

  /**
   * Select the best avatar (most recent non-null)
   */
  private selectBestAvatar(avatars: Array<{ avatar: string; timestamp: Date }>): string | null {
    if (avatars.length === 0) return null;

    // Sort by timestamp descending
    const sorted = [...avatars].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return sorted[0]?.avatar ?? null;
  }

  /**
   * Select the best local avatar (most recent non-null)
   */
  private selectBestLocalAvatar(localAvatars: Array<{ path: string; timestamp: Date }>): string | null {
    if (localAvatars.length === 0) return null;

    // Sort by timestamp descending
    const sorted = [...localAvatars].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return sorted[0]?.path ?? null;
  }

  /**
   * Merge name-based entries with URL-based entries for the same author
   *
   * This handles the case where older archives have no author_url (name-based key)
   * but newer archives have author_url (URL-based key). These should be merged
   * into a single entry with the URL-based key taking precedence.
   *
   * @param authors Array of AuthorCatalogEntry to process
   * @returns Merged array with duplicates combined
   */
  private mergeNameBasedWithUrlBased(authors: AuthorCatalogEntry[]): AuthorCatalogEntry[] {
    // Separate entries by key type
    const urlBasedEntries: AuthorCatalogEntry[] = [];
    const nameBasedEntries: AuthorCatalogEntry[] = [];

    for (const author of authors) {
      const key = generateAuthorKey(author.authorUrl, author.authorName, author.platform);
      if (key.includes(':name:')) {
        nameBasedEntries.push(author);
      } else {
        urlBasedEntries.push(author);
      }
    }

    // If no name-based entries, nothing to merge
    if (nameBasedEntries.length === 0) {
      return authors;
    }

    // Build a lookup map for URL-based entries by platform + normalized name
    const urlBasedByPlatformAndName = new Map<string, AuthorCatalogEntry>();
    for (const entry of urlBasedEntries) {
      const normalizedName = normalizeAuthorName(entry.authorName);
      const lookupKey = `${entry.platform}:${normalizedName}`;

      // If multiple URL-based entries have same name, keep the one with more data
      const existing = urlBasedByPlatformAndName.get(lookupKey);
      if (!existing || this.hasMoreData(entry, existing)) {
        urlBasedByPlatformAndName.set(lookupKey, entry);
      }
    }

    // Track which name-based entries were merged
    const mergedNameBasedIndices = new Set<number>();

    // Try to merge each name-based entry with a URL-based entry
    for (let i = 0; i < nameBasedEntries.length; i++) {
      const nameBasedEntry = nameBasedEntries[i];
      if (!nameBasedEntry) continue;

      const normalizedName = normalizeAuthorName(nameBasedEntry.authorName);
      const lookupKey = `${nameBasedEntry.platform}:${normalizedName}`;

      const urlBasedEntry = urlBasedByPlatformAndName.get(lookupKey);
      if (urlBasedEntry) {
        // Merge name-based entry into URL-based entry
        this.mergeEntries(urlBasedEntry, nameBasedEntry);
        mergedNameBasedIndices.add(i);
      }
    }

    // Return URL-based entries + unmerged name-based entries
    const result = [...urlBasedEntries];
    for (let i = 0; i < nameBasedEntries.length; i++) {
      if (!mergedNameBasedIndices.has(i)) {
        const entry = nameBasedEntries[i];
        if (entry) {
          result.push(entry);
        }
      }
    }

    return result;
  }

  /**
   * Check if entry A has more data than entry B
   */
  private hasMoreData(a: AuthorCatalogEntry, b: AuthorCatalogEntry): boolean {
    let scoreA = 0;
    let scoreB = 0;

    if (a.avatar) scoreA++;
    if (b.avatar) scoreB++;
    if (a.localAvatar) scoreA++;
    if (b.localAvatar) scoreB++;
    if (a.followers !== null && a.followers !== undefined) scoreA++;
    if (b.followers !== null && b.followers !== undefined) scoreB++;
    if (a.bio) scoreA++;
    if (b.bio) scoreB++;
    if (a.handle) scoreA++;
    if (b.handle) scoreB++;

    return scoreA > scoreB;
  }

  /**
   * Merge source entry into target entry (mutates target)
   */
  private mergeEntries(target: AuthorCatalogEntry, source: AuthorCatalogEntry): void {
    // Aggregate counts
    const targetUnarchived = target.unarchivedCount ?? target.archiveCount;
    const sourceUnarchived = source.unarchivedCount ?? source.archiveCount;
    target.archiveCount += source.archiveCount;
    target.unarchivedCount = targetUnarchived + sourceUnarchived;

    // Merge file paths
    const sourceFilePaths = source.filePaths || [];
    const targetFilePaths = target.filePaths || [];
    target.filePaths = [...new Set([...targetFilePaths, ...sourceFilePaths])];

    // Use most recent lastSeenAt
    if (source.lastSeenAt > target.lastSeenAt) {
      target.lastSeenAt = source.lastSeenAt;
    }

    // Fill in missing metadata from source (target takes precedence if both have data)
    if (!target.avatar && source.avatar) {
      target.avatar = source.avatar;
    }
    if (!target.localAvatar && source.localAvatar) {
      target.localAvatar = source.localAvatar;
    }
    if ((target.followers === null || target.followers === undefined) && source.followers !== null && source.followers !== undefined) {
      target.followers = source.followers;
    }
    if ((target.postsCount === null || target.postsCount === undefined) && source.postsCount !== null && source.postsCount !== undefined) {
      target.postsCount = source.postsCount;
    }
    if (!target.bio && source.bio) {
      target.bio = source.bio;
    }
    if (!target.handle && source.handle) {
      target.handle = source.handle;
    }

    // Preserve subscription info from either entry
    if (!target.subscriptionId && source.subscriptionId) {
      target.subscriptionId = source.subscriptionId;
      target.status = source.status;
    }
  }
}

async function yieldBetweenChunks(): Promise<void> {
  await new Promise<void>((resolve) => {
    // rAF can be paused in some Electron/Obsidian states (e.g. hidden/minimized panes),
    // which would deadlock any code awaiting it. Use a small timeout as a guaranteed fallback.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const timeoutId = setTimeout(finish, 50);

    // Prefer rAF in Obsidian to yield to the next frame.
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        clearTimeout(timeoutId);
        finish();
      });
      return;
    }

    // Node / non-browser
    if (typeof setImmediate === 'function') {
      setImmediate(() => {
        clearTimeout(timeoutId);
        finish();
      });
      return;
    }

    // setTimeout fallback already scheduled
  });
}

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Internal accumulator for deduplication
 */
interface AuthorAccumulator {
  authorNames: Array<{ name: string; count: number }>;
  authorUrl: string;
  platform: Platform;
  avatars: Array<{ avatar: string; timestamp: Date }>;
  localAvatars: Array<{ path: string; timestamp: Date }>;
  handles: string[];
  latestTimestamp: Date;
  filePaths: string[];
  archiveCount: number;
  unarchivedCount: number;
  // Extended metadata (aggregated from most recent)
  followers: number | null;
  postsCount: number | null;
  bio: string | null;
  lastMetadataUpdate: Date | null;
  community: { name: string; url: string } | null;
  // Webtoon-specific info (naver-webtoon platform)
  webtoonInfo: {
    titleId?: string;
    titleName: string;
    publishDay?: string;
    finished?: boolean;
    genre?: string[];
  } | null;
}
