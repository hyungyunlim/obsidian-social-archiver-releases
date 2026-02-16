/**
 * Profile Crawl Configuration Types
 *
 * Defines TypeScript types for profile crawl configuration including:
 * - Crawl mode (post count vs date range)
 * - Crawl options with validation
 * - Subscribe options for recurring crawls
 *
 * Single Responsibility: Define profile crawl-related types and validation
 */

import type { Platform } from './post';

// ============================================================================
// Constants
// ============================================================================

/**
 * Validation limits for crawl options
 */
export const CRAWL_LIMITS = {
  /** Minimum number of posts to crawl */
  MIN_POST_COUNT: 1,
  /** Maximum number of posts to crawl (limited to prevent excessive API usage) */
  MAX_POST_COUNT: 20,
  /** Maximum posts for YouTube (RSS feed limit) */
  MAX_POST_COUNT_YOUTUBE: 15,
  /** Maximum posts for local fetch platforms (Naver, Brunch) - no BrightData costs */
  MAX_POST_COUNT_LOCAL: 100,
  /** Default number of posts to crawl */
  DEFAULT_POST_COUNT: 5,
  /** Maximum date range in days */
  MAX_DATE_RANGE_DAYS: 90,
} as const;

/**
 * Platforms that use local fetching (no BrightData API costs)
 * These platforms have higher post count limits
 */
export const LOCAL_FETCH_PLATFORMS = ['naver', 'brunch'] as const;

/**
 * Check if a platform uses local fetching
 */
export function isLocalFetchPlatform(platform: string): boolean {
  return LOCAL_FETCH_PLATFORMS.includes(platform as typeof LOCAL_FETCH_PLATFORMS[number]);
}

// ============================================================================
// Core Types
// ============================================================================

/**
 * Crawl mode determines how posts are selected
 * - post_count: Crawl a specific number of recent posts
 * - date_range: Crawl posts within a date range
 */
export type CrawlMode = 'post_count' | 'date_range';

/**
 * Time range presets for the UI dropdown
 * Maps to date range calculations
 */
export type TimeRangePreset =
  | 'all_time'
  | 'last_24h'
  | 'last_3_days'
  | 'last_week'
  | 'last_2_weeks'
  | 'last_month'
  | 'last_3_months';

/**
 * Time range preset labels for UI display
 */
export const TIME_RANGE_LABELS: Record<TimeRangePreset, string> = {
  all_time: 'All time',
  last_24h: 'Last 24 hours',
  last_3_days: 'Last 3 days',
  last_week: 'Last week',
  last_2_weeks: 'Last 2 weeks',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
};

/**
 * Convert a time range preset to start/end dates (UTC-based)
 * Returns null for 'all_time' (no date filtering)
 *
 * Uses UTC to ensure consistent behavior across timezones.
 * The dates are calculated based on current UTC time.
 */
export function timeRangePresetToDates(preset: TimeRangePreset): { startDate: Date; endDate: Date } | null {
  if (preset === 'all_time') {
    return null;
  }

  // Use UTC-based calculation for consistency
  const nowUtc = Date.now();
  const endDate = new Date(nowUtc);
  let startDate: Date;

  const DAY_MS = 24 * 60 * 60 * 1000;

  switch (preset) {
    case 'last_24h':
      startDate = new Date(nowUtc - DAY_MS);
      break;
    case 'last_3_days':
      startDate = new Date(nowUtc - 3 * DAY_MS);
      break;
    case 'last_week':
      startDate = new Date(nowUtc - 7 * DAY_MS);
      break;
    case 'last_2_weeks':
      startDate = new Date(nowUtc - 14 * DAY_MS);
      break;
    case 'last_month':
      startDate = new Date(nowUtc - 30 * DAY_MS);
      break;
    case 'last_3_months':
      startDate = new Date(nowUtc - 90 * DAY_MS);
      break;
    default:
      return null;
  }

  return { startDate, endDate };
}

/**
 * Convert a time range preset to backfill days for subscription initial sync
 */
export function timeRangePresetToBackfillDays(preset: TimeRangePreset): number {
  switch (preset) {
    case 'last_24h':
      return 1;
    case 'last_3_days':
      return 3;
    case 'last_week':
      return 7;
    case 'last_2_weeks':
      return 14;
    case 'last_month':
      return 30;
    case 'last_3_months':
      return 90;
    case 'all_time':
    default:
      return 30; // Default to 30 days for all_time
  }
}

/**
 * Reddit sort options for subreddit crawling
 */
export type RedditSortBy = 'Hot' | 'New' | 'Top' | 'Rising';
export type RedditSortByTime = 'Now' | 'Today' | 'This Week' | 'This Month' | 'This Year' | 'All Time' | '';

/**
 * Reddit-specific crawl options
 */
export interface RedditCrawlOptions {
  /** Sort method for posts */
  sortBy: RedditSortBy;
  /** Time range for sorting (only applicable for Top and Hot) */
  sortByTime: RedditSortByTime;
  /** Optional keyword filter */
  keyword?: string;
}

/**
 * Naver-specific subscription options
 * Used for Naver Cafe member subscriptions that require authentication
 */
export interface NaverCrawlOptions {
  /** NID_AUT + NID_SES cookies for private cafe access (NOT stored in Worker - Plugin only) */
  cookie?: string;
  /** Subscription type: 'blog' (RSS+Direct) or 'cafe-member' (JSON API+Direct) */
  subscriptionType?: 'blog' | 'cafe-member';
  /** Blog ID for blog subscriptions (extracted from URL) */
  blogId?: string;
  /** Cafe ID for cafe member subscriptions (extracted from URL) */
  cafeId?: string;
  /** Member key for cafe member subscriptions (extracted from URL) */
  memberKey?: string;
  /** Member nickname for display purposes */
  memberNickname?: string;
  /** When true, Plugin performs local fetch instead of Worker (required for cafe-member with cookies) */
  localFetchRequired?: boolean;
}

/**
 * Reddit sort by labels for UI display
 */
export const REDDIT_SORT_BY_OPTIONS: { value: RedditSortBy; label: string }[] = [
  { value: 'Hot', label: 'Hot' },
  { value: 'New', label: 'New' },
  { value: 'Top', label: 'Top' },
  { value: 'Rising', label: 'Rising' },
];

/**
 * Reddit sort by time labels for UI display
 */
export const REDDIT_SORT_BY_TIME_OPTIONS: { value: RedditSortByTime; label: string }[] = [
  { value: '', label: 'Default' },
  { value: 'Now', label: 'Now' },
  { value: 'Today', label: 'Today' },
  { value: 'This Week', label: 'This Week' },
  { value: 'This Month', label: 'This Month' },
  { value: 'This Year', label: 'This Year' },
  { value: 'All Time', label: 'All Time' },
];

/**
 * Profile crawl configuration options
 */
export interface ProfileCrawlOptions {
  /** How to select posts for crawling */
  mode: CrawlMode;
  /** Number of posts to crawl (10-100, default 20) - used when mode is 'post_count' */
  postCount?: number;
  /** Start date (UTC) - used when mode is 'date_range' */
  startDate?: Date;
  /** End date (UTC, default: now) - used when mode is 'date_range' */
  endDate?: Date;
  /** User's timezone for date display */
  timezone: string;
  /** Hard cap on posts (always 100) */
  maxPosts: number;
  /** Reddit-specific options (only used when platform is 'reddit') */
  reddit?: RedditCrawlOptions;
}

/**
 * Subscription schedule options
 * Note: hour and timezone are flat (not nested) to match Worker API schema
 */
export interface ProfileSubscribeOptions {
  /** Whether subscription is enabled */
  enabled: boolean;
  /** Hour of day to run (0-23, local time) */
  hour: number;
  /** User's timezone */
  timezone: string;
  /** Destination folder in vault for archived posts */
  destinationFolder: string;
  /** If true, skip immediate crawl and only create subscription */
  subscribeOnly?: boolean;
}

/**
 * RSS-specific metadata for blog platform
 */
export interface RSSMetadata {
  /** RSS/Atom/JSON feed URL */
  feedUrl: string;
  /** Detected feed format */
  feedType: 'rss2' | 'atom' | 'json' | 'rss' | 'unknown';
  /** Site title from feed */
  siteTitle?: string;
  /** Site homepage URL */
  siteUrl?: string;
}

/**
 * Complete profile archive request
 */
export interface ProfileArchiveRequest {
  /** Profile URL to archive */
  profileUrl: string;
  /** Detected platform */
  platform: Platform;
  /** Profile handle (username) */
  handle: string;
  /** Crawl configuration */
  crawlOptions: ProfileCrawlOptions;
  /** Destination folder for archived posts */
  destination: {
    folder: string;
  };
  /** Optional subscription settings */
  subscribeOptions?: ProfileSubscribeOptions;
  /** RSS-specific metadata (required when platform is 'blog') */
  rssMetadata?: RSSMetadata;
  /** Naver-specific options (for Naver Blog/Cafe subscriptions) */
  naverOptions?: NaverCrawlOptions;
}

/**
 * Response from profile crawl API
 */
export interface ProfileCrawlResponse {
  /** Unique job identifier for tracking */
  jobId: string;
  /** Subscription ID if subscription was created */
  subscriptionId?: string;
  /** Estimated number of posts to be crawled */
  estimatedPosts: number;
  /** Job status */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** Message for user display */
  message?: string;
  /** If true, this is a cached response from idempotency check (no new crawl triggered) */
  cached?: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for crawl operations
 * Used for programmatic error handling and user-friendly message mapping
 */
export type CrawlErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PLATFORM'
  | 'CRAWL_RANGE_EXCEEDED'
  | 'RATE_LIMITED'
  | 'BRIGHTDATA_ERROR'
  | 'NETWORK_ERROR'
  | 'AUTH_REQUIRED'
  | 'CREDITS_INSUFFICIENT'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_PRIVATE'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'NAVER_COOKIE_REQUIRED'
  | 'UNKNOWN_ERROR';

/**
 * User-friendly error messages for each error code
 */
export const CRAWL_ERROR_MESSAGES: Record<CrawlErrorCode, string> = {
  INVALID_URL: 'The URL format is not recognized. Please check and try again.',
  UNSUPPORTED_PLATFORM: 'This platform is not supported yet. Currently only Instagram profiles are available.',
  CRAWL_RANGE_EXCEEDED: `Date range exceeds ${CRAWL_LIMITS.MAX_DATE_RANGE_DAYS} days. Please select a shorter range.`,
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  BRIGHTDATA_ERROR: 'Our crawling service is temporarily unavailable. Please try again later.',
  NETWORK_ERROR: 'Network connection failed. Please check your connection and retry.',
  AUTH_REQUIRED: 'Authentication required. Please sign in to continue.',
  CREDITS_INSUFFICIENT: 'Insufficient credits. Please upgrade your plan or wait for monthly reset.',
  PROFILE_NOT_FOUND: 'Profile not found. Please check the URL is correct.',
  PROFILE_PRIVATE: 'This profile is private. Only public profiles can be archived.',
  SERVER_ERROR: 'Server error occurred. Please try again later.',
  TIMEOUT: 'Request timed out. Please try again.',
  NAVER_COOKIE_REQUIRED: 'Naver cookie is required for this operation. Please add your Naver cookie in settings.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
};

/**
 * Crawl error with code, message, and retry capability
 */
export interface CrawlError {
  /** Error code for programmatic handling */
  code: CrawlErrorCode;
  /** User-friendly error message */
  message: string;
  /** Whether this error is retryable */
  retryable: boolean;
  /** Original error details (for logging) */
  details?: string;
}

/**
 * Error codes that can be retried
 */
export const RETRYABLE_ERROR_CODES: CrawlErrorCode[] = [
  'RATE_LIMITED',
  'BRIGHTDATA_ERROR',
  'NETWORK_ERROR',
  'SERVER_ERROR',
  'TIMEOUT',
];

/**
 * Create a CrawlError from an error code
 */
export function createCrawlError(
  code: CrawlErrorCode,
  details?: string
): CrawlError {
  return {
    code,
    message: CRAWL_ERROR_MESSAGES[code],
    retryable: RETRYABLE_ERROR_CODES.includes(code),
    details,
  };
}

/**
 * Parse API error response to CrawlError
 * Maps HTTP status codes and error messages to appropriate CrawlErrorCode
 */
export function parseCrawlError(error: unknown): CrawlError {
  // Handle Error objects
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Map common error patterns to codes
    if (message.includes('rate limit') || message.includes('429')) {
      return createCrawlError('RATE_LIMITED', error.message);
    }
    if (message.includes('network') || message.includes('fetch') || message.includes('econnrefused')) {
      return createCrawlError('NETWORK_ERROR', error.message);
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return createCrawlError('TIMEOUT', error.message);
    }
    if (message.includes('auth') || message.includes('unauthorized') || message.includes('401')) {
      return createCrawlError('AUTH_REQUIRED', error.message);
    }
    if (message.includes('credit') || message.includes('insufficient') || message.includes('402')) {
      return createCrawlError('CREDITS_INSUFFICIENT', error.message);
    }
    if (message.includes('not found') || message.includes('404')) {
      return createCrawlError('PROFILE_NOT_FOUND', error.message);
    }
    if (message.includes('private') || message.includes('403')) {
      return createCrawlError('PROFILE_PRIVATE', error.message);
    }
    if (message.includes('brightdata') || message.includes('scraping')) {
      return createCrawlError('BRIGHTDATA_ERROR', error.message);
    }
    if (message.includes('500') || message.includes('server error')) {
      return createCrawlError('SERVER_ERROR', error.message);
    }

    return createCrawlError('UNKNOWN_ERROR', error.message);
  }

  // Handle API response objects
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;
    const code = errorObj['code'] as string | undefined;
    const message = errorObj['message'] as string | undefined;

    if (code && code in CRAWL_ERROR_MESSAGES) {
      return createCrawlError(code as CrawlErrorCode, message);
    }
  }

  return createCrawlError('UNKNOWN_ERROR', String(error));
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Result of validation operation
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error messages (empty if valid) */
  errors: string[];
  /** Warning messages (non-blocking issues) */
  warnings: string[];
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate profile crawl options
 *
 * @param options - Crawl options to validate
 * @returns Validation result with errors and warnings
 */
export function validateCrawlOptions(options: ProfileCrawlOptions): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate mode
  if (!options.mode || !['post_count', 'date_range'].includes(options.mode)) {
    errors.push('Invalid crawl mode. Must be "post_count" or "date_range"');
  }

  // Validate timezone
  if (!options.timezone) {
    errors.push('Timezone is required');
  } else {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: options.timezone });
    } catch {
      errors.push(`Invalid timezone: ${options.timezone}`);
    }
  }

  // Validate maxPosts
  if (options.maxPosts > CRAWL_LIMITS.MAX_POST_COUNT) {
    errors.push(`Maximum posts cannot exceed ${CRAWL_LIMITS.MAX_POST_COUNT}`);
  }

  // Mode-specific validation
  if (options.mode === 'post_count') {
    const postCount = options.postCount ?? CRAWL_LIMITS.DEFAULT_POST_COUNT;

    if (postCount < CRAWL_LIMITS.MIN_POST_COUNT) {
      errors.push(`Post count must be at least ${CRAWL_LIMITS.MIN_POST_COUNT}`);
    }

    if (postCount > CRAWL_LIMITS.MAX_POST_COUNT) {
      errors.push(`Post count cannot exceed ${CRAWL_LIMITS.MAX_POST_COUNT}`);
    }
  }

  if (options.mode === 'date_range') {
    if (!options.startDate) {
      errors.push('Start date is required for date_range mode');
    }

    const endDate = options.endDate ?? new Date();
    const startDate = options.startDate;

    if (startDate && endDate) {
      const dateValidation = validateDateRange(startDate, endDate);
      errors.push(...dateValidation.errors);
      warnings.push(...dateValidation.warnings);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate date range for crawling
 *
 * @param start - Start date
 * @param end - End date
 * @returns Validation result with errors and warnings
 */
export function validateDateRange(start: Date, end: Date): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const now = new Date();

  // Normalize dates to start of day for comparison
  const startDate = new Date(start);
  const endDate = new Date(end);

  // Check if end date is in the future (with 1 minute tolerance for clock skew)
  const futureThreshold = new Date(now.getTime() + 60 * 1000);
  if (endDate > futureThreshold) {
    errors.push('End date cannot be in the future');
  }

  // Check if start date is after end date
  if (startDate > endDate) {
    errors.push('Start date must be before end date');
  }

  // Check date range doesn't exceed maximum
  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff > CRAWL_LIMITS.MAX_DATE_RANGE_DAYS) {
    errors.push(`Date range cannot exceed ${CRAWL_LIMITS.MAX_DATE_RANGE_DAYS} days`);
  }

  // Warning for very short date range
  if (daysDiff < 1 && errors.length === 0) {
    warnings.push('Date range is less than 1 day');
  }

  // Warning for very old start date
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  if (startDate < yearAgo) {
    warnings.push('Start date is more than 1 year ago. Some posts may not be available.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Create default crawl options
 *
 * @param timezone - User's timezone (defaults to system timezone)
 * @returns Default ProfileCrawlOptions
 */
export function createDefaultCrawlOptions(timezone?: string): ProfileCrawlOptions {
  return {
    mode: 'post_count',
    postCount: CRAWL_LIMITS.DEFAULT_POST_COUNT,
    timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    maxPosts: CRAWL_LIMITS.MAX_POST_COUNT,
  };
}

/**
 * Create default subscribe options
 *
 * @param timezone - User's timezone
 * @param destinationFolder - Default destination folder
 * @returns Default ProfileSubscribeOptions
 */
export function createDefaultSubscribeOptions(
  timezone?: string,
  destinationFolder = 'Social Archives'
): ProfileSubscribeOptions {
  return {
    enabled: false,
    hour: 8, // Default to 8 AM
    timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    destinationFolder,
  };
}
