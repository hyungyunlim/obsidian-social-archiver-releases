/**
 * ProfileCrawlService — headless profile/RSS/subscribe request builder +
 * executor for the Obsidian CLI surface.
 *
 * Responsibilities (Single Responsibility):
 *   - Classify a URL into post/profile/rss + extract the handle/feed url.
 *   - Translate caller-supplied options (post count, time range, Reddit
 *     options, Naver options) into a `ProfileArchiveRequest`.
 *   - Submit the request to the Worker via `WorkersAPIClient.crawlProfile`.
 *   - Surface a typed result so the CLI registry can echo it back to the
 *     agent without re-parsing.
 *
 * What it does NOT do:
 *   - Open modals, show Notices, or touch the DOM. Those remain in
 *     `ArchiveModal` for the interactive path.
 *   - Drive the per-platform local-fetch paths (Naver Blog, Naver Cafe,
 *     Brunch). Those continue to live in `ArchiveModal` because they
 *     write directly to the vault and depend on settings UI bindings.
 *     The CLI submits the corresponding subscription with
 *     `localFetchRequired: true`, and the existing pollers
 *     (`NaverSubscriptionPoller`, `BrunchSubscriptionPoller`) handle the
 *     scheduled local fetch.
 */

import type { Platform } from '@/types/post';
import type { WorkersAPIClient } from '@/services/WorkersAPIClient';
import {
  analyzeUrl,
  type UrlAnalysisResult,
} from '@/utils/urlAnalysis';
import {
  NEW_SUBSCRIPTION_PLATFORMS,
  PROFILE_CRAWL_SUPPORTED_PLATFORMS,
  isRssPlatformWithOwnId,
} from '@/constants/rssPlatforms';
import {
  CRAWL_LIMITS,
  validateCrawlOptions,
  type CrawlMode,
  type NaverCrawlOptions,
  type ProfileArchiveRequest,
  type ProfileCrawlOptions,
  type ProfileCrawlResponse,
  type RedditCrawlOptions,
  type RedditSortBy,
  type RedditSortByTime,
  type RSSMetadata,
} from '@/types/profile-crawl';
import { detectUserTimezone } from '@/utils/date';

// ============================================================================
// Public types
// ============================================================================

/** Predefined date-range buckets accepted by the CLI. */
export type CrawlRangePreset = 'all' | '7d' | '30d' | '90d' | 'custom';

/**
 * Result of classifying a URL. Mirrors {@link UrlAnalysisResult} with a
 * narrower contract: `kind` is always present and `platform` is normalized
 * to a string for serialization (`'unknown'` when null).
 */
export interface ClassifyResult {
  kind: 'post' | 'profile' | 'rss' | 'unknown';
  platform: string;
  handle?: string;
  feedUrl?: string;
  /**
   * Flows the caller can request next given this kind/platform. Useful
   * for agent decision-making (`['post-archive']` vs `['profile-crawl',
   * 'subscribe']`). Order is stable — most relevant first.
   */
  supportedFlows: string[];
}

/** Per-Reddit options accepted by the CLI. */
export interface ProfileCrawlRedditInput {
  /** PRD wire format is lowercase; internal type is title-case. */
  sortBy?: RedditSortBy;
  sortByTime?: RedditSortByTime;
  keyword?: string;
}

/** Per-Naver options accepted by the CLI. */
export interface ProfileCrawlNaverInput {
  /** Already-decoded session cookie. CLI is responsible for base64 decoding. */
  cookie?: string;
  /** Override the inferred subscriptionType (defaults to `blog`). */
  subscriptionType?: 'blog' | 'cafe-member';
}

/**
 * Input shape for {@link ProfileCrawlService.crawlNow}. Mirrors the modal
 * state struct, but typed for headless callers.
 */
export interface ProfileCrawlOptionsInput {
  url: string;
  /** Optional override: forces RSS interpretation even when the URL also resolves to a profile. */
  forceRss?: boolean;
  /** Number of posts to crawl (1..MAX_POST_COUNT). */
  count?: number;
  /** Predefined preset or `custom` with explicit `start`/`end`. */
  range?: CrawlRangePreset;
  /** ISO date (YYYY-MM-DD) — required when `range === 'custom'`. */
  start?: string;
  /** ISO date (YYYY-MM-DD) — required when `range === 'custom'`. */
  end?: string;
  /** When true, also create a subscription after the initial crawl. */
  subscribe?: boolean;
  /** Hour-of-day for scheduled subscription (0..23). Defaults to the current local hour. */
  hour?: number;
  /** Folder override; falls back to `settings.archivePath`. */
  folder?: string;
  reddit?: ProfileCrawlRedditInput;
  naver?: ProfileCrawlNaverInput;
}

/** Input for {@link ProfileCrawlService.subscribe}. */
export interface ProfileSubscribeOptionsInput {
  url: string;
  hour?: number;
  folder?: string;
  naver?: ProfileCrawlNaverInput;
}

/**
 * Concrete result returned by {@link ProfileCrawlService.crawlNow}. Only
 * fields suitable for an agent response are included — no PostData,
 * no token round-trip.
 */
export interface ProfileCrawlResult {
  jobId: string;
  subscriptionId?: string;
  platform: string;
  handle: string;
  feedUrl?: string;
  estimatedPosts: number;
  /** True when the Worker recognized this request as already in-flight. */
  cached: boolean;
  /** True when the request was sent with `subscribeOptions`. */
  subscribed: boolean;
}

export interface ProfileSubscribeResult {
  subscriptionId: string;
  platform: string;
  handle: string;
  feedUrl?: string;
}

/** Plugin-level dependency surface — keeps the service unit-testable. */
export interface ProfileCrawlDeps {
  workersApiClient: () => WorkersAPIClient | undefined;
  /** Vault default destination folder (typically `settings.archivePath`). */
  defaultFolder: () => string;
}

// ============================================================================
// Service
// ============================================================================

/**
 * Maps `range` preset → start/end Date pair. `custom` requires explicit
 * `start`/`end` (validated upstream). Returns null when the preset means
 * "no date filter" (i.e. `all`).
 */
function presetToRange(
  preset: CrawlRangePreset,
  start?: string,
  end?: string,
): { startDate?: Date; endDate?: Date } | null {
  if (preset === 'all') return null;
  if (preset === 'custom') {
    if (!start || !end) {
      throw new Error("range='custom' requires both 'start' and 'end' (YYYY-MM-DD).");
    }
    const startDate = parseIsoDate(start);
    const endDate = parseIsoDate(end);
    if (!startDate || !endDate) {
      throw new Error("Invalid 'start'/'end' value — expected YYYY-MM-DD.");
    }
    return { startDate, endDate };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
  return { startDate, endDate };
}

function parseIsoDate(input: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  const d = new Date(`${input}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function lowerReddit(input?: ProfileCrawlRedditInput): RedditCrawlOptions | undefined {
  if (!input) return undefined;
  if (!input.sortBy && !input.sortByTime && !input.keyword) return undefined;
  return {
    sortBy: input.sortBy ?? 'Hot',
    sortByTime: input.sortByTime ?? '',
    keyword: input.keyword,
  };
}

function isProfileCrawlSupportedPlatform(
  platform: Platform,
): platform is typeof PROFILE_CRAWL_SUPPORTED_PLATFORMS[number] {
  return PROFILE_CRAWL_SUPPORTED_PLATFORMS.includes(
    platform as typeof PROFILE_CRAWL_SUPPORTED_PLATFORMS[number],
  );
}

function isNewSubscriptionPlatform(
  platform: Platform,
): platform is typeof NEW_SUBSCRIPTION_PLATFORMS[number] {
  return NEW_SUBSCRIPTION_PLATFORMS.includes(platform as typeof NEW_SUBSCRIPTION_PLATFORMS[number]);
}

function buildNaverCrawlOptions(
  handle: string,
  naver?: ProfileCrawlNaverInput,
): NaverCrawlOptions | undefined {
  if (!naver?.cookie && !naver?.subscriptionType) return undefined;
  if (handle.startsWith('cafe:')) {
    const [, cafeId, memberKey] = handle.split(':');
    return {
      cookie: naver?.cookie,
      authMode: 'obsidian-local-cookie',
      subscriptionType: 'cafe-member',
      cafeId,
      memberKey,
      localFetchRequired: true,
    };
  }
  return {
    cookie: naver?.cookie,
    authMode: 'obsidian-local-cookie',
    subscriptionType: naver?.subscriptionType ?? 'blog',
    blogId: handle,
    localFetchRequired: true,
  };
}

export class ProfileCrawlService {
  constructor(private readonly deps: ProfileCrawlDeps) {}

  /**
   * Pure classification helper. Wraps `analyzeUrl` and normalizes the
   * result for the CLI envelope.
   */
  classify(url: string): ClassifyResult {
    const analysis = analyzeUrl(url);
    return {
      kind: analysis.type,
      platform: analysis.platform ?? 'unknown',
      handle: analysis.handle,
      feedUrl: analysis.feedUrl,
      supportedFlows: this.flowsForAnalysis(analysis),
    };
  }

  /**
   * Kick off an immediate profile/RSS crawl. Returns the Worker job id
   * (and optional subscription id) so the caller can poll or surface
   * status without owning Worker bookkeeping.
   */
  async crawlNow(input: ProfileCrawlOptionsInput): Promise<ProfileCrawlResult> {
    const client = this.assertClient();
    const analysis = analyzeUrl(input.url);
    const isRss = input.forceRss ? true : analysis.type === 'rss';

    if (analysis.platform == null) {
      throw new Error('Could not detect a supported platform for this URL.');
    }
    if (!isRss && analysis.type === 'post') {
      throw new Error('URL points to a single post — use the `archive` command instead.');
    }
    if (analysis.type === 'unknown') {
      throw new Error('URL is not recognized as a profile or RSS feed.');
    }

    const detectedPlatform = analysis.platform;
    if (!isRss && !isProfileCrawlSupportedPlatform(detectedPlatform)) {
      throw new Error(`Profile crawl is not supported for platform '${detectedPlatform}'.`);
    }

    const handle = this.resolveHandle(analysis, isRss);
    if (!handle) {
      throw new Error('Could not extract a profile handle or feed identifier from the URL.');
    }

    const timezone = detectUserTimezone();
    const dateRange = presetToRange(
      input.range ?? (isRss ? 'all' : 'all'),
      input.start,
      input.end,
    );

    const mode: CrawlMode = detectedPlatform === 'reddit'
      ? 'post_count'
      : dateRange
        ? 'date_range'
        : 'post_count';

    const postCount = input.count ?? CRAWL_LIMITS.DEFAULT_POST_COUNT;
    const crawlOptions: ProfileCrawlOptions = {
      mode,
      postCount,
      startDate: detectedPlatform === 'reddit' ? undefined : dateRange?.startDate,
      endDate: detectedPlatform === 'reddit' ? undefined : dateRange?.endDate,
      timezone,
      maxPosts: CRAWL_LIMITS.MAX_POST_COUNT,
      reddit: lowerReddit(input.reddit),
    };

    const validation = validateCrawlOptions(crawlOptions);
    if (!validation.valid) {
      throw new Error(validation.errors[0] ?? 'Invalid crawl options.');
    }

    const apiPlatform: Platform = isRss && !isRssPlatformWithOwnId(detectedPlatform)
      ? ('blog' as Platform)
      : detectedPlatform;

    const folder = input.folder ?? this.deps.defaultFolder();
    const hour = clampHour(input.hour ?? new Date().getHours());
    const subscribeOpts = input.subscribe
      ? {
          enabled: true,
          hour,
          timezone,
          destinationFolder: folder,
        }
      : undefined;

    const rssMetadata: RSSMetadata | undefined = isRss
      ? {
          feedUrl: analysis.feedUrl ?? analysis.normalizedUrl,
          feedType: 'rss',
          siteTitle: handle,
        }
      : undefined;

    const naverOpts = detectedPlatform === 'naver'
      ? buildNaverCrawlOptions(handle, input.naver)
      : undefined;

    const request: ProfileArchiveRequest = {
      profileUrl: isRss ? (analysis.feedUrl ?? analysis.normalizedUrl) : analysis.normalizedUrl,
      platform: apiPlatform,
      handle,
      crawlOptions,
      destination: { folder },
      ...(subscribeOpts ? { subscribeOptions: subscribeOpts } : {}),
      ...(rssMetadata ? { rssMetadata } : {}),
      ...(naverOpts ? { naverOptions: naverOpts } : {}),
    };

    const response: ProfileCrawlResponse = await client.crawlProfile(request);
    return {
      jobId: response.jobId,
      subscriptionId: response.subscriptionId,
      platform: apiPlatform,
      handle,
      feedUrl: rssMetadata?.feedUrl,
      estimatedPosts: response.estimatedPosts,
      cached: Boolean(response.cached),
      subscribed: Boolean(subscribeOpts),
    };
  }

  /**
   * Create a subscription without performing an immediate crawl. Used by
   * the `social-archiver:subscribe` CLI command.
   */
  async subscribe(input: ProfileSubscribeOptionsInput): Promise<ProfileSubscribeResult> {
    const client = this.assertClient();
    const analysis = analyzeUrl(input.url);
    const isRss = analysis.type === 'rss';

    if (analysis.platform == null) {
      throw new Error('Could not detect a supported platform for this URL.');
    }
    if (analysis.type !== 'profile' && analysis.type !== 'rss') {
      throw new Error('URL is not a profile or RSS feed — cannot subscribe.');
    }

    const detectedPlatform = analysis.platform;
    if (!isNewSubscriptionPlatform(detectedPlatform)) {
      throw new Error(`Subscriptions are not supported for platform '${detectedPlatform}'.`);
    }

    const handle = this.resolveHandle(analysis, isRss);
    if (!handle) {
      throw new Error('Could not extract a profile handle or feed identifier from the URL.');
    }

    const timezone = detectUserTimezone();
    const folder = input.folder ?? this.deps.defaultFolder();
    const hour = clampHour(input.hour ?? new Date().getHours());

    const apiPlatform: Platform = isRss && !isRssPlatformWithOwnId(detectedPlatform)
      ? ('blog' as Platform)
      : detectedPlatform;

    const crawlOptions: ProfileCrawlOptions = {
      mode: 'post_count',
      postCount: CRAWL_LIMITS.DEFAULT_POST_COUNT,
      timezone,
      maxPosts: CRAWL_LIMITS.MAX_POST_COUNT,
    };

    const naverOpts = detectedPlatform === 'naver'
      ? buildNaverCrawlOptions(handle, input.naver)
      : undefined;

    const rssMetadata: RSSMetadata | undefined = isRss
      ? {
          feedUrl: analysis.feedUrl ?? analysis.normalizedUrl,
          feedType: 'rss',
          siteTitle: handle,
        }
      : undefined;

    const request: ProfileArchiveRequest = {
      profileUrl: isRss ? (analysis.feedUrl ?? analysis.normalizedUrl) : analysis.normalizedUrl,
      platform: apiPlatform,
      handle,
      crawlOptions,
      destination: { folder },
      subscribeOptions: {
        enabled: true,
        hour,
        timezone,
        destinationFolder: folder,
        subscribeOnly: true,
      },
      ...(rssMetadata ? { rssMetadata } : {}),
      ...(naverOpts ? { naverOptions: naverOpts } : {}),
    };

    const response: ProfileCrawlResponse = await client.crawlProfile(request);
    if (!response.subscriptionId) {
      throw new Error('Worker accepted the request but did not return a subscriptionId.');
    }

    return {
      subscriptionId: response.subscriptionId,
      platform: apiPlatform,
      handle,
      feedUrl: rssMetadata?.feedUrl,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private assertClient(): WorkersAPIClient {
    const client = this.deps.workersApiClient();
    if (!client) {
      throw new Error('Workers API client is not initialized.');
    }
    return client;
  }

  private resolveHandle(analysis: UrlAnalysisResult, isRss: boolean): string | undefined {
    if (analysis.handle) return analysis.handle;
    if (!isRss) return undefined;
    const target = analysis.feedUrl ?? analysis.normalizedUrl;
    return extractSiteNameFromUrl(target);
  }

  private flowsForAnalysis(analysis: UrlAnalysisResult): string[] {
    const platform = analysis.platform ?? 'unknown';
    if (analysis.type === 'post') return ['archive'];
    if (analysis.type === 'profile') {
      const flows: string[] = [];
      if (
        PROFILE_CRAWL_SUPPORTED_PLATFORMS.includes(
          platform as typeof PROFILE_CRAWL_SUPPORTED_PLATFORMS[number],
        )
      ) {
        flows.push('profile-crawl');
      }
      if (
        NEW_SUBSCRIPTION_PLATFORMS.includes(
          platform as typeof NEW_SUBSCRIPTION_PLATFORMS[number],
        )
      ) {
        flows.push('subscribe');
      }
      return flows.length > 0 ? flows : ['archive'];
    }
    if (analysis.type === 'rss') {
      return ['profile-crawl', 'subscribe'];
    }
    return [];
  }
}

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return Math.max(0, Math.min(23, Math.floor(h)));
}

/**
 * Standalone helper extracted from the modal's `extractSiteNameFromUrl`
 * private method — needed for the RSS path where `urlAnalysis.handle`
 * is empty (the feed itself does not carry a username).
 */
function extractSiteNameFromUrl(url: string): string | undefined {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (hostname === 'v2.velog.io' && urlObj.pathname.startsWith('/rss/')) {
      const rssPath = urlObj.pathname.replace('/rss/', '');
      const username = rssPath.startsWith('@') ? rssPath.substring(1) : rssPath;
      return username.split('/')[0] || 'velog';
    }

    if (hostname.includes('feedburner.com')) {
      const segments = urlObj.pathname.split('/').filter(Boolean);
      return segments[0] ?? 'feedburner';
    }

    const platformPatterns: RegExp[] = [
      /^([^.]+)\.substack\.com$/i,
      /^([^.]+)\.tumblr\.com$/i,
      /^([^.]+)\.ghost\.io$/i,
      /^([^.]+)\.wordpress\.com$/i,
      /^([^.]+)\.blogspot\.com$/i,
      /^([^.]+)\.medium\.com$/i,
    ];
    for (const pattern of platformPatterns) {
      const match = hostname.match(pattern);
      if (match && match[1] && match[1] !== 'www') return match[1];
    }

    const parts = hostname.split('.');
    const cleanParts = parts.filter(
      (p) => !['www', 'blog', 'feeds', 'rss', 'feed'].includes(p),
    );
    if (cleanParts.length >= 1 && cleanParts[0]) return cleanParts[0];
    const first = parts[0];
    const second = parts[1];
    return first === 'www' && second ? second : first;
  } catch {
    return undefined;
  }
}
