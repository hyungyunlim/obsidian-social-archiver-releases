/**
 * ProfileCliService — thin adapter between Obsidian CLI flag bags and
 * {@link ProfileCrawlService}.
 *
 * Responsibilities (SRP):
 *   - Map `CliData` flags → `ProfileCrawlOptionsInput` / `ProfileSubscribeOptionsInput`.
 *   - Decode the `naverCookie=<base64>` payload before handing it to the
 *     service. The raw cookie is **never** echoed back in the response —
 *     handlers expose only `{ naverCookieApplied: true }` on success.
 *   - Map flag enum values (`hot|new|top|rising`) to the internal
 *     title-case RedditSortBy contract.
 *   - Surface `range='custom'` validation as `INVALID_ARGUMENT`.
 *
 * Does NOT register CLI handlers — that wiring lives in `CliRegistry`.
 */

import {
  CliValidationError,
  parseBool,
  parseEnum,
  parseNumber,
  parseString,
  type CliParams,
} from './CliParams';
import type {
  ProfileCrawlNaverInput,
  ProfileCrawlOptionsInput,
  ProfileCrawlRedditInput,
  ProfileCrawlResult,
  ProfileCrawlService,
  ProfileSubscribeOptionsInput,
  ProfileSubscribeResult,
  CrawlRangePreset,
} from '../services/ProfileCrawlService';
import type { RedditSortBy, RedditSortByTime } from '@/types/profile-crawl';

// ============================================================================
// Public types
// ============================================================================

/** CLI response payload for `profile-crawl`. */
export interface ProfileCrawlCliResult extends ProfileCrawlResult {
  /** Reflects whether a naverCookie was passed (never echoes the value). */
  naverCookieApplied: boolean;
}

/** CLI response payload for `subscribe`. */
export interface ProfileSubscribeCliResult extends ProfileSubscribeResult {
  naverCookieApplied: boolean;
}

// ============================================================================
// Adapter
// ============================================================================

const REDDIT_SORT_BY_MAP: Readonly<Record<'hot' | 'new' | 'top' | 'rising', RedditSortBy>> = {
  hot: 'Hot',
  new: 'New',
  top: 'Top',
  rising: 'Rising',
};

const REDDIT_TIME_MAP: Readonly<
  Record<'now' | 'today' | 'week' | 'month' | 'year' | 'all', RedditSortByTime>
> = {
  now: 'Now',
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
  all: 'All Time',
};

const RANGE_VALUES = ['all', '7d', '30d', '90d', 'custom'] as const;

export class ProfileCliService {
  constructor(private readonly service: ProfileCrawlService) {}

  /** Drive the `social-archiver:profile-crawl` command. */
  async crawl(params: CliParams): Promise<ProfileCrawlCliResult> {
    const input = this.buildCrawlInput(params);
    const result = await this.service.crawlNow(input);
    return {
      ...result,
      naverCookieApplied: Boolean(input.naver?.cookie),
    };
  }

  /** Drive the `social-archiver:subscribe` command. */
  async subscribe(params: CliParams): Promise<ProfileSubscribeCliResult> {
    const input = this.buildSubscribeInput(params);
    const result = await this.service.subscribe(input);
    return {
      ...result,
      naverCookieApplied: Boolean(input.naver?.cookie),
    };
  }

  // -------------------------------------------------------------------------
  // Builders (internal — exported indirectly via methods above)
  // -------------------------------------------------------------------------

  buildCrawlInput(params: CliParams): ProfileCrawlOptionsInput {
    const url = parseString(params, 'url', { required: true });
    const count = parseNumber(params, 'count', {
      integer: true,
      min: 1,
      max: 100,
    });
    const range = parseEnum(params, 'range', RANGE_VALUES) as CrawlRangePreset | undefined;
    const start = parseString(params, 'start');
    const end = parseString(params, 'end');
    if (range === 'custom' && (!start || !end)) {
      throw new CliValidationError('range', "range='custom' requires both 'start' and 'end' (YYYY-MM-DD).");
    }

    const subscribe = parseBool(params, 'subscribe');
    const hour = parseNumber(params, 'hour', { integer: true, min: 0, max: 23 });
    const folder = parseString(params, 'folder');
    const forceRss = parseBool(params, 'rss');

    return {
      url,
      count,
      range,
      start,
      end,
      subscribe,
      hour,
      folder,
      forceRss,
      reddit: this.buildRedditInput(params),
      naver: this.buildNaverInput(params),
    };
  }

  buildSubscribeInput(params: CliParams): ProfileSubscribeOptionsInput {
    const url = parseString(params, 'url', { required: true });
    const hour = parseNumber(params, 'hour', { integer: true, min: 0, max: 23 });
    const folder = parseString(params, 'folder');
    return {
      url,
      hour,
      folder,
      naver: this.buildNaverInput(params),
    };
  }

  private buildRedditInput(params: CliParams): ProfileCrawlRedditInput | undefined {
    const sortRaw = parseEnum(params, 'redditSort', [
      'hot',
      'new',
      'top',
      'rising',
    ] as const);
    const timeRaw = parseEnum(params, 'redditTime', [
      'now',
      'today',
      'week',
      'month',
      'year',
      'all',
    ] as const);
    const keyword = parseString(params, 'keyword');

    if (!sortRaw && !timeRaw && !keyword) return undefined;
    return {
      sortBy: sortRaw ? REDDIT_SORT_BY_MAP[sortRaw] : undefined,
      sortByTime: timeRaw ? REDDIT_TIME_MAP[timeRaw] : undefined,
      keyword,
    };
  }

  private buildNaverInput(params: CliParams): ProfileCrawlNaverInput | undefined {
    const cookieB64 = parseString(params, 'naverCookie');
    const subscriptionType = parseEnum(params, 'naverSubscriptionType', [
      'blog',
      'cafe-member',
    ] as const);
    if (!cookieB64 && !subscriptionType) return undefined;
    const cookie = cookieB64 ? decodeNaverCookie(cookieB64) : undefined;
    return {
      cookie,
      subscriptionType: subscriptionType ?? undefined,
    };
  }
}

/**
 * Decode the base64-encoded naverCookie payload supplied via the CLI.
 * Throws a typed validation error if the payload is not valid base64.
 */
function decodeNaverCookie(b64: string): string {
  try {
    if (typeof activeWindow !== 'undefined' && typeof activeWindow.atob === 'function') {
      return activeWindow.atob(b64);
    }
    throw new Error('No base64 decoder available in this environment.');
  } catch (e) {
    throw new CliValidationError(
      'naverCookie',
      `Failed to decode naverCookie as base64: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
