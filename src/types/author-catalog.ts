/**
 * Author Catalog Types
 *
 * Types for the Author Catalog feature that allows users to discover
 * and subscribe to authors from their archived posts.
 */

import type { Platform } from './post';
import { DEFAULT_ARCHIVE_PATH } from '@/shared/constants';

// ============================================================================
// Core Types
// ============================================================================

/**
 * Subscription status for an author
 */
export type AuthorSubscriptionStatus =
  | 'not_subscribed'
  | 'subscribed'
  | 'error';

/**
 * Sort options for author catalog
 */
export type AuthorSortOption =
  | 'lastRun'       // Most recent run first
  | 'lastRunAsc'    // Oldest run first
  | 'lastSeen'      // Most recently seen first
  | 'lastSeenAsc'   // Oldest seen first
  | 'nameAsc'       // A → Z
  | 'nameDesc'      // Z → A
  | 'archiveCount'  // Most archives first
  | 'archiveCountAsc'; // Least archives first

/**
 * Subscription cadence (MVP: Daily only)
 */
export type SubscriptionCadence = 'daily';

// ============================================================================
// Main Interfaces
// ============================================================================

/**
 * Author Catalog Entry
 *
 * Represents a unique author discovered from archived posts.
 * Authors are deduplicated by (authorUrl, platform) combination.
 */
export interface AuthorCatalogEntry {
  /** Display name of the author */
  authorName: string;

  /** Profile URL (primary key for deduplication) */
  authorUrl: string;

  /** Platform the author is from */
  platform: Platform;

  /** Author's avatar URL (from most recent archive) */
  avatar: string | null;

  /** Timestamp of newest archive with this author */
  lastSeenAt: Date;

  /** Last time subscription was run (from subscription data) */
  lastRunAt?: Date | null;

  /** Subscription schedule (e.g., "daily at 9AM (KST)") */
  schedule?: string | null;

  /** Number of archived posts by this author */
  archiveCount: number;

  /**
   * Number of posts by this author that are NOT marked as archived/hidden in the timeline.
   * This corresponds to YAML frontmatter: `archive: true`.
   *
   * Optional for backward compatibility (older cached entries may not have it).
   */
  unarchivedCount?: number;

  /** Linked subscription ID if subscribed */
  subscriptionId: string | null;

  /** Current subscription status */
  status: AuthorSubscriptionStatus;

  /** Author handle (e.g., @johndoe) if available */
  handle?: string;

  /** File paths of archived posts by this author */
  filePaths?: string[];

  // ============================================================================
  // Author Profile Management fields (Task 165)
  // ============================================================================

  /** Vault-relative path to locally stored avatar (null if not downloaded) */
  localAvatar?: string | null;

  /** Follower count from most recent archive (null if not available) */
  followers?: number | null;

  /** Total posts count from most recent archive (null if not available) */
  postsCount?: number | null;

  /** Author bio/description from most recent archive (null if not available) */
  bio?: string | null;

  /** Timestamp of last metadata update (null if never updated) */
  lastMetadataUpdate?: Date | null;

  /** Community info (Reddit subreddit or Naver cafe) */
  community?: {
    name: string;
    url: string;
  } | null;

  // ============================================================================
  // Subscription Options (from server subscription data)
  // ============================================================================

  /** Maximum posts per subscription run */
  maxPostsPerRun?: number;

  /** Reddit-specific subscription options (only for Reddit subreddits) */
  redditOptions?: RedditSubscriptionOptions;

  /** Naver Cafe-specific subscription options (only for Naver Cafe members) */
  naverCafeOptions?: NaverCafeSubscriptionOptions;

  // ============================================================================
  // Fetch Mode Indicator (Task 339)
  // ============================================================================

  /**
   * Fetch mode for subscription polling:
   * - 'local': Plugin polls locally (faster, no credits)
   * - 'cloud': Worker polls via cloud (background, uses credits)
   * - 'hybrid': Worker detects via RSS, Plugin fetches content (Brunch)
   * - undefined: Not a subscription or legacy subscription
   */
  fetchMode?: 'local' | 'cloud' | 'hybrid';

  /**
   * Warning message for subscription configuration issues:
   * - e.g., "Cookie required for local fetch" for Naver Cafe without cookie
   * - undefined: No warning
   */
  configWarning?: string;

  // ============================================================================
  // Brunch Subscription Options
  // ============================================================================

  /** Brunch-specific subscription options */
  brunchOptions?: BrunchCatalogOptions;

  // ============================================================================
  // Webtoon-specific fields (naver-webtoon platform)
  // ============================================================================

  /**
   * Flag indicating this entry is a webtoon series (not an author)
   * When true, titleName should be emphasized over authorName
   */
  isWebtoon?: boolean;

  /**
   * Webtoon-specific information
   * Only populated when platform === 'naver-webtoon'
   */
  webtoonInfo?: {
    /** Naver Webtoon title ID */
    titleId: string;
    /** Series title (작품명) - should be displayed prominently */
    titleName: string;
    /** Publish day in Korean (e.g., '토요웹툰') */
    publishDay: string;
    /** Short publish day code (e.g., 'sat') */
    publishDayCode?: string;
    /** Whether the series is finished */
    finished: boolean;
    /** Thumbnail URL for the series */
    thumbnailUrl?: string;
    /** Genre tags */
    genre?: string[];
    /** Total episode count */
    totalEpisodes?: number;
    /** Number of episodes archived in vault */
    archivedEpisodes?: number;
  };
}

/**
 * Filter options for Author Catalog
 */
export interface AuthorCatalogFilter {
  /** Filter by platform ('all' shows all platforms) */
  platform: Platform | 'all';

  /** Search query for name/handle matching */
  searchQuery: string;

  /** Sort order */
  sortBy: AuthorSortOption;

  /** Filter by subscription status */
  statusFilter?: AuthorSubscriptionStatus | 'all';
}

/**
 * Default filter configuration
 */
export const DEFAULT_AUTHOR_FILTER: AuthorCatalogFilter = {
  platform: 'all',
  searchQuery: '',
  sortBy: 'lastSeen',
  statusFilter: 'all'
};

/**
 * Reddit-specific subscription options
 */
export interface RedditSubscriptionOptions {
  sortBy: 'Best' | 'Hot' | 'New' | 'Top' | 'Rising';
  sortByTime: 'Now' | 'Today' | 'This Week' | 'This Month' | 'This Year' | 'All Time' | '';
  keyword?: string;
  /** Distinguishes between subreddit and user profile subscriptions */
  profileType?: 'subreddit' | 'user';
}

/**
 * Naver subscription options (for both Blog and Cafe member)
 * Used for local polling (plugin-side) subscriptions
 */
export interface NaverCafeSubscriptionOptions {
  /** Type of Naver subscription: 'blog' or 'cafe-member' */
  subscriptionType?: 'blog' | 'cafe-member';
  /** Maximum posts to fetch per run (5-50, default 30) */
  maxPostsPerRun: number;
  /** Days to backfill on first run (default 14) */
  backfillDays: number;
  /** Optional keyword filter for post titles */
  keyword?: string;
}

/**
 * Brunch catalog display options
 * Used for displaying brunch author info in Author Catalog UI
 * (Different from BrunchSubscriptionOptions in brunch.ts which is for fetching)
 */
export interface BrunchCatalogOptions {
  /** Subscription type identifier: 'author' for Brunch authors, 'book' for Brunch books */
  subscriptionType?: 'author' | 'book';
  /** Brunch username */
  username?: string;
  /** Internal user ID for RSS API (needed for Worker's hybrid mode) */
  userId?: string;
  /** Whether local fetch is required */
  localFetchRequired?: boolean;
  /** Maximum posts to fetch per run */
  maxPostsPerRun: number;
  /** Days to backfill on first run */
  backfillDays: number;
  /** Optional keyword filter */
  keyword?: string;
  /** Whether to include comments */
  includeComments?: boolean;
}

/**
 * Options for subscribing to an author
 */
export interface AuthorSubscribeOptions {
  /** Subscription cadence (MVP: daily only) */
  cadence: SubscriptionCadence;

  /** Destination folder in vault */
  destinationPath: string;

  /** Template ID for note formatting */
  templateId: string | null;

  /** User's timezone (auto-detected) */
  timezone: string;

  /** Hour to run subscription (0-23) */
  startHour?: number;

  /** Maximum posts to archive per run */
  maxPostsPerRun?: number;

  /** Days to backfill on first run */
  backfillDays?: number;

  /** Reddit-specific options (only for Reddit subreddits) */
  redditOptions?: RedditSubscriptionOptions;

  /** Naver Cafe-specific options (only for Naver Cafe members) */
  naverCafeOptions?: NaverCafeSubscriptionOptions;

  /** Brunch-specific options */
  brunchOptions?: BrunchCatalogOptions;
}

/**
 * Default subscribe options
 */
export const DEFAULT_SUBSCRIBE_OPTIONS: AuthorSubscribeOptions = {
  cadence: 'daily',
  destinationPath: DEFAULT_ARCHIVE_PATH,
  templateId: null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  maxPostsPerRun: 20,
  backfillDays: 3
};

// ============================================================================
// Vault Scanner Types
// ============================================================================

/**
 * Source type for author data
 * - 'direct': Author from a directly archived post (e.g., platform: 'facebook')
 * - 'embedded': Author from an embedded archive within a user post (platform: 'post')
 */
export type AuthorSourceType = 'direct' | 'embedded';

/**
 * Raw author data extracted from vault frontmatter
 */
export interface RawAuthorData {
  /** Path to the archived note file */
  filePath: string;

  /** Author display name */
  authorName: string;

  /** Author profile URL */
  authorUrl: string;

  /** Source platform */
  platform: Platform;

  /** Author avatar URL */
  avatar: string | null;

  /** Author handle (e.g., @username) */
  handle: string | null;

  /** When the post was archived */
  archivedAt: Date;

  /**
   * Whether this post is marked as archived/hidden in the timeline.
   * This corresponds to YAML frontmatter: `archive: true`.
   */
  timelineArchived?: boolean;

  // === Extended Author Metadata (optional) ===

  /**
   * Local avatar path in vault (extracted from wikilink [[path]])
   */
  localAvatar?: string | null;

  /**
   * Follower count from platform API
   */
  followers?: number | null;

  /**
   * Total posts count from platform API
   */
  postsCount?: number | null;

  /**
   * Author bio/description
   */
  bio?: string | null;

  /**
   * Verified status on platform
   */
  verified?: boolean;

  /**
   * Timestamp of last metadata update (for conflict resolution)
   */
  lastMetadataUpdate?: Date | null;

  /**
   * Community info (Reddit subreddit or Naver cafe)
   */
  community?: {
    name: string;
    url: string;
  } | null;

  // === Embedded Archive Source Tracking (optional) ===

  /**
   * Source type: 'direct' for regular archives, 'embedded' for embedded archives
   * @default 'direct'
   */
  sourceType?: AuthorSourceType;

  /**
   * For embedded archives: path to the user post file containing this embedded archive
   */
  sourceFilePath?: string;

  /**
   * For embedded archives: original URL of the embedded archive
   */
  embeddedOriginalUrl?: string;

  // === Webtoon-specific fields (naver-webtoon platform) ===

  /**
   * Webtoon series information extracted from frontmatter
   * Only populated when platform === 'naver-webtoon'
   */
  webtoonInfo?: {
    /** Naver Webtoon title ID */
    titleId?: string;
    /** Series title (작품명) */
    titleName: string;
    /** Publish day in Korean (e.g., '토요웹툰') */
    publishDay?: string;
    /** Whether the series is finished */
    finished?: boolean;
    /** Genre tags */
    genre?: string[];
  };
}

/**
 * Result from vault scanning operation
 */
export interface VaultScanResult {
  /** Raw author data from all scanned files */
  authors: RawAuthorData[];

  /** Total files scanned */
  totalFilesScanned: number;

  /** Files skipped (invalid or malformed) */
  filesSkipped: number;

  /** Any errors encountered */
  errors: VaultScanError[];

  /** Scan duration in milliseconds */
  durationMs: number;
}

/**
 * Error during vault scanning
 */
export interface VaultScanError {
  /** File path where error occurred */
  filePath: string;

  /** Error message */
  message: string;

  /** Error type */
  type: 'missing_frontmatter' | 'invalid_platform' | 'missing_author' | 'parse_error';
}

// ============================================================================
// Deduplication Types
// ============================================================================

/**
 * Result from author deduplication
 */
export interface DeduplicationResult {
  /** Deduplicated author entries */
  authors: AuthorCatalogEntry[];

  /** Total raw records processed */
  totalProcessed: number;

  /** Number of duplicates merged */
  duplicatesMerged: number;

  /** Processing duration in milliseconds */
  durationMs: number;
}

/**
 * Normalization result for author URL
 */
export interface NormalizedAuthorUrl {
  /** Normalized URL */
  url: string;

  /** Detected platform from URL */
  platform: Platform | null;

  /** Extracted handle from URL */
  handle: string | null;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event emitted when catalog is updated
 */
export interface AuthorCatalogUpdateEvent {
  /** Type of update */
  type: 'scan_complete' | 'entry_added' | 'entry_updated' | 'subscription_changed';

  /** Affected author entries (if applicable) */
  entries?: AuthorCatalogEntry[];

  /** Timestamp of update */
  timestamp: Date;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Response from subscription creation
 */
export interface SubscribeResponse {
  success: boolean;
  subscriptionId?: string;
  error?: string;
  errorCode?: 'ALREADY_SUBSCRIBED' | 'LIMIT_REACHED' | 'INVALID_PLATFORM' | 'API_ERROR';
}

// ============================================================================
// Platform Counts
// ============================================================================

/**
 * Count of authors per platform
 */
export type PlatformAuthorCounts = Partial<Record<Platform, number>> & {
  all: number;
};
