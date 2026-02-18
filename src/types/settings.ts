import { Platform } from 'obsidian';
import { TIMELINE_PLATFORM_IDS } from '../constants/timelinePlatforms';
import type { AICommentSettings } from './ai-comment';
import { DEFAULT_AI_COMMENT_SETTINGS } from './ai-comment';
import type { SeriesCurrentEpisodeState } from './series';
import type { TagDefinition } from './tag';
import type { BatchMode } from './batch-transcription';

// API endpoint - automatically switches based on build mode and platform
// Development (Desktop): http://localhost:8787
// Production (or Mobile): https://social-archiver-api.social-archive.org
// Note: Always use production URL in builds to avoid localhost connection issues
const BASE_API_ENDPOINT = 'https://social-archiver-api.social-archive.org';
const PRODUCTION_API = 'https://social-archiver-api.social-archive.org';

/**
 * Get the appropriate API endpoint based on platform
 * Mobile devices always use production API (localhost not accessible)
 */
export function getAPIEndpoint(): string {
  if (Platform.isMobile) {
    return PRODUCTION_API;
  }
  return BASE_API_ENDPOINT;
}

// Legacy export for compatibility
// Use BASE_API_ENDPOINT directly to avoid Platform initialization issues at build time
export const API_ENDPOINT = BASE_API_ENDPOINT;

// Share Web URL - automatically switches based on build mode
// Development: http://localhost:5173
// Production: https://social-archive.org
export const SHARE_WEB_URL = import.meta.env.VITE_SHARE_WEB_URL || 'https://social-archive.org';

// Media download modes
export type MediaDownloadMode = 'text-only' | 'images-only' | 'images-and-videos';

// Archive folder organization
export type ArchiveOrganizationMode = 'platform-year-month' | 'platform-only' | 'flat';

export function isArchiveOrganizationMode(value: unknown): value is ArchiveOrganizationMode {
  return value === 'platform-year-month' || value === 'platform-only' || value === 'flat';
}

export function getVaultOrganizationStrategy(mode?: ArchiveOrganizationMode): 'platform' | 'platform-only' | 'flat' {
  switch (mode) {
    case 'platform-only':
      return 'platform-only';
    case 'flat':
      return 'flat';
    case 'platform-year-month':
    default:
      return 'platform';
  }
}

// Share mode types
export type ShareMode = 'full' | 'preview';

// User tier types
export type UserTier = 'beta-free' | 'free' | 'pro' | 'admin';

// Tier-specific limits and capabilities
export const TIER_LIMITS = {
  'beta-free': { videoUpload: false, shareExpiry: null }, // Beta: no expiry
  'free': { videoUpload: false, shareExpiry: 30 }, // 30 days
  'pro': { videoUpload: false, shareExpiry: 365 }, // 1 year
  'admin': { videoUpload: true, shareExpiry: null }, // No expiry, video allowed
} as const;

/**
 * Platform timing statistics
 * Tracks performance metrics for each social media platform
 */
export interface PlatformTiming {
  total: number;          // Total time in ms across all requests
  count: number;          // Number of requests
  success: number;        // Successful requests
  failed: number;         // Failed requests
  avg: number;            // Average time in ms
  min: number;            // Minimum time in ms
  max: number;            // Maximum time in ms
  avgSuccessRate: number; // Average success rate (%)
}

// Whisper model types
export type WhisperModelType = 'tiny' | 'base' | 'small' | 'medium' | 'large';

// Whisper variant types (CLI implementations)
export type WhisperVariantType = 'auto' | 'faster-whisper' | 'openai-whisper' | 'whisper.cpp';

/**
 * Transcription settings for Whisper-based audio transcription
 */
export interface TranscriptionSettings {
  enabled: boolean;                    // Feature toggle
  preferredVariant: WhisperVariantType; // Whisper variant to use ('auto' = auto-detect)
  preferredModel: WhisperModelType;    // Whisper model to use
  language: string;                    // 'auto' or ISO language code
  customWhisperPath?: string;          // Custom binary path
  forceEnableCustomPath?: boolean;     // Skip validation for custom path (ARM64/edge cases)
  batchMode?: BatchMode;              // Batch transcription mode ('transcribe-only' | 'download-and-transcribe')
}

/**
 * Webtoon streaming settings for controlling episode loading behavior
 */
export interface WebtoonStreamingSettings {
  /** View mode: 'stream-first' loads immediately via proxy, 'download-first' waits for vault download */
  viewMode: 'stream-first' | 'download-first';
  /** Download episodes to vault in background while streaming */
  backgroundDownload: boolean;
  /** Prefetch next episode URLs when reaching end of current episode */
  prefetchNextEpisode: boolean;
  /** Load lower quality images to reduce data usage on mobile networks (mobile-only) */
  mobileDataSaver: boolean;
}

export interface TimelineFilterPreferences {
  platforms: string[];
  likedOnly: boolean;
  commentedOnly: boolean;
  sharedOnly: boolean;
  includeArchived: boolean;
  searchQuery: string;
  dateRange: {
    start: string | null;
    end: string | null;
  };
}

export function createDefaultTimelineFilters(): TimelineFilterPreferences {
  return {
    platforms: [...TIMELINE_PLATFORM_IDS],
    likedOnly: false,
    commentedOnly: false,
    sharedOnly: false,
    includeArchived: false,
    searchQuery: '',
    dateRange: {
      start: null,
      end: null
    }
  };
}

export interface FrontmatterFieldVisibility {
  authorDetails: boolean;
  engagement: boolean;
  aiAnalysis: boolean;
  externalLinks: boolean;
  location: boolean;
  subscription: boolean;
  seriesInfo: boolean;
  podcastInfo: boolean;
  reblogInfo: boolean;
  mediaMetadata: boolean;
  workflow: boolean;
}

export type FrontmatterPropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'date-time' | 'list';

export interface CustomFrontmatterProperty {
  id: string;
  key: string;
  type?: FrontmatterPropertyType;
  value: string; // text/number/list value (list uses newline-separated values)
  template?: string; // optional override template for checkbox/date/date-time
  checked?: boolean; // checkbox default when template is empty
  dateValue?: string; // YYYY-MM-DD
  dateTimeValue?: string; // YYYY-MM-DDTHH:mm
  enabled: boolean;
}

export const FRONTMATTER_CORE_LOCKED_FIELDS = [
  'platform',
  'author',
  'authorUrl',
  'published',
  'archived',
  'lastModified',
  'tags',
] as const;

const FRONTMATTER_CORE_LOCKED_FIELD_SET = new Set<string>(FRONTMATTER_CORE_LOCKED_FIELDS);
const FRONTMATTER_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export const DEFAULT_FRONTMATTER_PROPERTY_ORDER: string[] = [
  'share',
  'platform',
  'author',
  'authorUrl',
  'authorHandle',
  'authorAvatar',
  'authorFollowers',
  'authorPostsCount',
  'authorBio',
  'authorVerified',
  'published',
  'archived',
  'lastModified',
  'archive',
  'tags',
  'originalUrl',
  'title',
  'hasTranscript',
  'hasFormattedTranscript',
  'videoId',
  'duration',
  'likes',
  'comments',
  'shares',
  'views',
  'linkPreviews',
  'processedUrls',
  'ai_summary',
  'sentiment',
  'topics',
  'subscribed',
  'subscriptionId',
  'community',
  'communityUrl',
  'isReblog',
  'originalAuthor',
  'originalAuthorHandle',
  'originalAuthorUrl',
  'originalPostUrl',
  'originalAuthorAvatar',
  'externalLink',
  'externalLinkTitle',
  'externalLinkDescription',
  'externalLinkImage',
  'latitude',
  'longitude',
  'location',
  'coordinates',
  'channelTitle',
  'audioUrl',
  'audioSize',
  'audioType',
  'episode',
  'season',
  'subtitle',
  'hosts',
  'guests',
  'explicit',
  'series',
  'seriesUrl',
  'seriesId',
  'totalEpisodes',
  'starScore',
  'genre',
  'ageRating',
  'finished',
  'publishDay',
  'commentCount',
  'media_expired',
  'media_expired_urls',
  'videoDownloaded',
  'videoDownloadFailed',
  'videoDownloadFailedCount',
  'videoDownloadFailedUrls',
  'videoTranscribed',
  'videoTranscriptionRequestedAt',
  'videoTranscriptionError',
  'videoTranscribedAt',
  'download_time',
  'comment',
  'archiveStatus',
  'errorMessage',
];

export function normalizeFrontmatterPropertyOrder(
  propertyOrder: string[] | undefined,
  customProperties: CustomFrontmatterProperty[] | undefined
): string[] {
  const normalizeKeys = (keys: string[]): string[] => {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const key of keys) {
      const trimmed = String(key || '').trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      normalized.push(trimmed);
    }

    return normalized;
  };

  const customKeys = Array.isArray(customProperties)
    ? customProperties.map((property) => String(property.key || '').trim()).filter(Boolean)
    : [];
  const customKeySet = new Set(customKeys);
  const defaultKeySet = new Set(DEFAULT_FRONTMATTER_PROPERTY_ORDER);
  const configured = Array.isArray(propertyOrder)
    ? propertyOrder.filter((key) => {
        const trimmed = String(key || '').trim();
        return defaultKeySet.has(trimmed) || customKeySet.has(trimmed);
      })
    : [];

  return normalizeKeys([
    ...configured,
    ...DEFAULT_FRONTMATTER_PROPERTY_ORDER,
    ...customKeys,
  ]);
}

export function normalizeFrontmatterFieldAliases(
  fieldAliases: Record<string, unknown> | undefined
): Record<string, string> {
  if (!fieldAliases || typeof fieldAliases !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  const defaultKeySet = new Set(DEFAULT_FRONTMATTER_PROPERTY_ORDER);

  for (const [rawSource, rawTarget] of Object.entries(fieldAliases)) {
    const source = String(rawSource || '').trim();
    const target = typeof rawTarget === 'string' ? rawTarget.trim() : '';

    if (!source || !target) continue;
    if (!defaultKeySet.has(source)) continue;
    if (FRONTMATTER_CORE_LOCKED_FIELD_SET.has(source)) continue;
    if (source === target) continue;
    if (FRONTMATTER_CORE_LOCKED_FIELD_SET.has(target)) continue;
    if (!FRONTMATTER_KEY_PATTERN.test(target)) continue;

    normalized[source] = target;
  }

  return normalized;
}

export interface FrontmatterCustomizationSettings {
  enabled: boolean;
  fieldVisibility: FrontmatterFieldVisibility;
  customProperties: CustomFrontmatterProperty[];
  fieldAliases?: Record<string, string>;
  propertyOrder?: string[];
  tagRoot?: string;
  tagOrganization?: ArchiveOrganizationMode;
}

export const DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS: FrontmatterCustomizationSettings = {
  enabled: true,
  fieldVisibility: {
    authorDetails: true,
    engagement: true,
    aiAnalysis: true,
    externalLinks: true,
    location: true,
    subscription: true,
    seriesInfo: true,
    podcastInfo: true,
    reblogInfo: true,
    mediaMetadata: true,
    workflow: true,
  },
  customProperties: [],
  fieldAliases: {},
  propertyOrder: [...DEFAULT_FRONTMATTER_PROPERTY_ORDER],
  tagRoot: '',
  tagOrganization: 'flat',
};

export interface SocialArchiverSettings {
  // API Configuration
  workerUrl: string; // Cloudflare Worker URL for API

  // Authentication (Magic Link)
  authToken: string; // JWT auth token from magic link verification
  username: string; // Reserved username from signup
  email: string; // Verified email address
  isVerified: boolean; // Whether email/username is verified
  deviceId: string; // Unique device identifier for multi-device support
  userAvatar: string; // Avatar URL for user-created posts (optional)

  // Storage Settings
  archivePath: string;
  mediaPath: string;
  fileNameFormat: string;
  archiveOrganization: ArchiveOrganizationMode;

  // Feature Toggles
  autoArchive: boolean;
  downloadMedia: MediaDownloadMode;
  includeComments: boolean; // Include platform comments in archived notes (default: true)
  frontmatter: FrontmatterCustomizationSettings; // Frontmatter customization (field visibility + custom properties)

  // Privacy Settings
  anonymizeAuthors: boolean;

  // Author Profile Management Settings
  downloadAuthorAvatars: boolean; // Save author profile images locally (default: true)
  updateAuthorMetadata: boolean; // Track followers, posts count, bio on each archive (default: true)
  overwriteAuthorAvatar: boolean; // Replace local avatar if new URL is provided (default: false)

  // Tag Management
  tagDefinitions: TagDefinition[]; // User-defined tag definitions (name, color, sortOrder)

  // Sharing Settings
  shareMode: ShareMode; // 'full' or 'preview' mode for shared posts
  sharePreviewLength: number; // Character limit for preview mode (default: 280)

  // Advanced Settings
  requestTimeout: number;
  maxRetries: number;
  jobCheckInterval: number; // Background job check interval in milliseconds (default: 5 minutes)

  // Usage Tracking (synced from server)
  tier: UserTier; // User's subscription tier
  creditsUsed: number; // Credits consumed this month
  creditResetDate: string; // ISO date when credits will reset (first day of next month)
  byPlatform: Record<string, number>; // Credits by platform
  byCountry: Record<string, number>; // Credits by country
  timingByPlatform: Record<string, PlatformTiming>; // Performance metrics by platform
  lastUsed: string; // Last archive timestamp

  // Timeline View Settings
  timelineSortBy: 'published' | 'archived';
  timelineSortOrder: 'newest' | 'oldest';
  timelineViewMode: 'timeline' | 'gallery';
  timelineFilters: TimelineFilterPreferences;
  enableLazyLoad: boolean; // Enable IntersectionObserver lazy loading (default: true)
  seriesCurrentEpisode: SeriesCurrentEpisodeState; // Track current episode per series (seriesId -> episode number)
  webtoonEpisodeSortOrder: 'asc' | 'desc'; // Episode list sort order: 'asc' (oldest first) or 'desc' (newest first)

  // Transcription Settings (Whisper)
  transcription: TranscriptionSettings;

  // AI Comment Settings
  aiComment: AICommentSettings;

  // Multi-Device Sync Settings
  enableServerPendingJobs: boolean; // Enable server-side pending job sync for cross-device recovery (default: true)
  syncClientId: string; // Registered sync client ID for multi-client sync

  // Release Notes Settings
  lastSeenVersion: string; // Last version user has seen release notes for
  showReleaseNotes: boolean; // Show release notes modal after updates (default: true)
  debugAlwaysShowReleaseNotes: boolean; // DEV: Always show release notes on load (default: false)

  // Naver Settings
  naverCookie: string; // Built from nidAut + nidSes (legacy, kept for API compatibility)
  nidAut: string; // NID_AUT cookie value
  nidSes: string; // NID_SES cookie value

  // Webtoon Streaming Settings
  webtoonStreaming: WebtoonStreamingSettings;
  webtoonStreamingNoticeShown: boolean; // Track if first-time streaming mode notice was shown

  // Reddit Sync Settings
  redditConnected: boolean; // Whether Reddit account is connected via OAuth
  redditUsername: string; // Connected Reddit username (e.g., "spez")
  redditSyncEnabled: boolean; // Whether automatic sync is enabled
  redditSyncFolder: string; // Folder for synced Reddit saved posts

  // Legacy fields (deprecated but kept for migration)
  /** @deprecated Use authToken instead */
  apiKey?: string;
  /** @deprecated No longer used */
  licenseKey?: string;
  /** @deprecated Use creditsUsed with tier limits instead */
  creditsRemaining?: number;
}

export const DEFAULT_SETTINGS: SocialArchiverSettings = {
  // API Configuration
  workerUrl: API_ENDPOINT,

  // Authentication (Magic Link)
  authToken: '',
  username: '',
  email: '',
  isVerified: false,
  deviceId: '', // Will be generated on first run
  userAvatar: '', // No avatar by default

  // Storage Settings
  archivePath: 'Social Archives',
  mediaPath: 'attachments/social-archives',
  fileNameFormat: '[YYYY-MM-DD] {platform}-{slug}-{shortId}',
  archiveOrganization: 'platform-year-month',

  // Feature Toggles
  autoArchive: false,
  downloadMedia: 'images-and-videos',
  includeComments: true, // Include platform comments by default
  frontmatter: DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS,

  // Privacy Settings
  anonymizeAuthors: false,

  // Author Profile Management Settings
  downloadAuthorAvatars: true, // Enabled by default for offline access
  updateAuthorMetadata: true, // Enabled by default for author statistics
  overwriteAuthorAvatar: false, // Keep existing avatars by default

  // Tag Management
  tagDefinitions: [], // No tags by default

  // Sharing Settings
  shareMode: 'preview', // Default to preview mode for copyright safety
  sharePreviewLength: 280, // Twitter-like character limit (always includes platform link in preview)

  // Advanced Settings
  requestTimeout: 30000,
  maxRetries: 3,
  jobCheckInterval: 300000, // 5 minutes (5 * 60 * 1000ms)

  // Usage Tracking (synced from server)
  tier: 'free',
  creditsUsed: 0,
  creditResetDate: new Date().toISOString(),
  byPlatform: {},
  byCountry: {},
  timingByPlatform: {},
  lastUsed: new Date().toISOString(),

  // Timeline View Settings
  timelineSortBy: 'published',
  timelineSortOrder: 'newest',
  timelineViewMode: 'timeline',
  timelineFilters: createDefaultTimelineFilters(),
  enableLazyLoad: true, // Lazy loading enabled by default for performance
  seriesCurrentEpisode: {}, // Empty by default, populated as user navigates series
  webtoonEpisodeSortOrder: 'asc', // Default: oldest first (ascending episode numbers)

  // Transcription Settings (Whisper)
  transcription: {
    enabled: true,
    preferredVariant: 'auto',
    preferredModel: 'small',
    language: 'auto',
    customWhisperPath: undefined,
    batchMode: 'transcribe-only'
  },

  // AI Comment Settings
  aiComment: DEFAULT_AI_COMMENT_SETTINGS,

  // Multi-Device Sync Settings
  enableServerPendingJobs: true, // Enabled by default for cross-device recovery
  syncClientId: '', // Empty until registered

  // Release Notes Settings
  lastSeenVersion: '', // Empty for first-time users (will be set on first load)
  showReleaseNotes: true, // Show release notes by default
  debugAlwaysShowReleaseNotes: false, // DEV: Always show release notes on load

  // Naver Settings
  naverCookie: '', // Built from nidAut + nidSes
  nidAut: '', // Empty by default
  nidSes: '', // Empty by default

  // Webtoon Streaming Settings
  webtoonStreaming: {
    viewMode: 'stream-first', // Immediate loading via proxy (faster UX)
    backgroundDownload: true, // Save to vault for offline access
    prefetchNextEpisode: true, // Pre-load next episode for seamless transitions
    mobileDataSaver: false // Disabled by default, mobile-only feature
  },
  webtoonStreamingNoticeShown: false, // First-time notice not yet shown

  // Reddit Sync Settings
  redditConnected: false, // Not connected by default
  redditUsername: '', // Empty until connected
  redditSyncEnabled: false, // Sync disabled until user enables
  redditSyncFolder: 'Social Archives/Reddit Saved', // Default folder for Reddit saved posts

  // Legacy fields (for migration compatibility)
  apiKey: '',
  licenseKey: '',
  creditsRemaining: 10
};

/**
 * Migrate legacy settings to new authentication structure
 * Handles backward compatibility for existing users
 *
 * @param settings - Current settings (may be legacy format)
 * @returns Migrated settings with all required fields
 */
export function migrateSettings(settings: Partial<SocialArchiverSettings>): SocialArchiverSettings {
  const migrated = { ...DEFAULT_SETTINGS, ...settings };
  // Record cast for accessing legacy/deprecated fields during migration without lint warnings
  const legacy = migrated as unknown as Record<string, unknown>;

  // Migrate legacy apiKey to authToken if authToken is empty
  if (!migrated.authToken && legacy['apiKey']) {
    migrated.authToken = legacy['apiKey'] as string;
  }

  // Ensure deviceId exists (generate if needed)
  if (!migrated.deviceId) {
    migrated.deviceId = generateDeviceId();
  }

  // Migrate legacy credit tracking
  if (typeof legacy['creditsRemaining'] === 'number' && migrated.creditsUsed === 0) {
    // Convert creditsRemaining to creditsUsed (inverse logic)
    const freeLimit = 10;
    migrated.creditsUsed = Math.max(0, freeLimit - legacy['creditsRemaining']);
  }

  // Initialize empty tracking objects if missing
  if (!migrated.byPlatform) migrated.byPlatform = {};
  if (!migrated.byCountry) migrated.byCountry = {};
  if (!migrated.timingByPlatform) migrated.timingByPlatform = {};

  // Set default tier if missing
  if (!migrated.tier) migrated.tier = 'free';

  // Ensure lastUsed timestamp exists
  if (!migrated.lastUsed) migrated.lastUsed = new Date().toISOString();

  if (!migrated.timelineViewMode) {
    migrated.timelineViewMode = 'timeline';
  }

  if (!migrated.timelineFilters) {
    migrated.timelineFilters = createDefaultTimelineFilters();
  } else {
    const defaults = createDefaultTimelineFilters();
    const persistedPlatforms = Array.isArray(migrated.timelineFilters.platforms)
      ? migrated.timelineFilters.platforms.filter((platform): platform is typeof TIMELINE_PLATFORM_IDS[number] =>
          TIMELINE_PLATFORM_IDS.includes(platform as typeof TIMELINE_PLATFORM_IDS[number])
        )
      : [];
    const mergedPlatforms = Array.from(new Set([...persistedPlatforms, ...TIMELINE_PLATFORM_IDS]));

    migrated.timelineFilters = {
      ...defaults,
      ...migrated.timelineFilters,
      platforms: mergedPlatforms,
      dateRange: {
        start: migrated.timelineFilters.dateRange?.start ?? defaults.dateRange.start,
        end: migrated.timelineFilters.dateRange?.end ?? defaults.dateRange.end
      }
    };
  }

  // Initialize transcription settings if missing (migration)
  if (!migrated.transcription) {
    migrated.transcription = DEFAULT_SETTINGS.transcription;
  } else {
    // Ensure all transcription fields exist with defaults
    migrated.transcription = {
      ...DEFAULT_SETTINGS.transcription,
      ...migrated.transcription
    };
  }

  // Initialize AI comment settings if missing (migration)
  if (!migrated.aiComment) {
    migrated.aiComment = DEFAULT_AI_COMMENT_SETTINGS;
  } else {
    // Merge with defaults to ensure all fields exist
    migrated.aiComment = {
      ...DEFAULT_AI_COMMENT_SETTINGS,
      ...migrated.aiComment,
      // Deep merge nested objects
      platformVisibility: {
        ...DEFAULT_AI_COMMENT_SETTINGS.platformVisibility,
        ...(migrated.aiComment.platformVisibility || {}),
      },
      vaultContext: {
        ...DEFAULT_AI_COMMENT_SETTINGS.vaultContext,
        ...(migrated.aiComment.vaultContext || {}),
      },
    };
  }

  // Initialize release notes settings if missing (migration)
  if (migrated.lastSeenVersion === undefined) {
    migrated.lastSeenVersion = '';
  }
  if (migrated.showReleaseNotes === undefined) {
    migrated.showReleaseNotes = true;
  }
  if (migrated.debugAlwaysShowReleaseNotes === undefined) {
    migrated.debugAlwaysShowReleaseNotes = false;
  }

  // Initialize series current episode state if missing (migration)
  if (!migrated.seriesCurrentEpisode) {
    migrated.seriesCurrentEpisode = {};
  }

  // Initialize Naver settings if missing (migration)
  if (migrated.naverCookie === undefined) {
    migrated.naverCookie = '';
  }
  if (migrated.nidAut === undefined) {
    migrated.nidAut = '';
  }
  if (migrated.nidSes === undefined) {
    migrated.nidSes = '';
  }

  // Migrate from old naverCookie format to separate fields
  if (migrated.naverCookie && (!migrated.nidAut || !migrated.nidSes)) {
    const nidAutMatch = migrated.naverCookie.match(/NID_AUT\s*=\s*([^;]+)/i);
    const nidSesMatch = migrated.naverCookie.match(/NID_SES\s*=\s*([^;]+)/i);
    if (nidAutMatch?.[1] && !migrated.nidAut) {
      migrated.nidAut = nidAutMatch[1].trim();
    }
    if (nidSesMatch?.[1] && !migrated.nidSes) {
      migrated.nidSes = nidSesMatch[1].trim();
    }
  }

  // Initialize webtoon streaming settings if missing (migration)
  if (!migrated.webtoonStreaming) {
    migrated.webtoonStreaming = DEFAULT_SETTINGS.webtoonStreaming;
  } else {
    // Merge with defaults to ensure all fields exist
    migrated.webtoonStreaming = {
      ...DEFAULT_SETTINGS.webtoonStreaming,
      ...migrated.webtoonStreaming
    };
  }

  // Initialize webtoon streaming notice shown flag if missing
  if (migrated.webtoonStreamingNoticeShown === undefined) {
    migrated.webtoonStreamingNoticeShown = false;
  }

  // Initialize Reddit sync settings if missing (migration)
  if (migrated.redditConnected === undefined) {
    migrated.redditConnected = false;
  }
  if (migrated.redditUsername === undefined) {
    migrated.redditUsername = '';
  }
  if (migrated.redditSyncEnabled === undefined) {
    migrated.redditSyncEnabled = false;
  }
  if (migrated.redditSyncFolder === undefined) {
    migrated.redditSyncFolder = DEFAULT_SETTINGS.redditSyncFolder;
  }

  // Initialize includeComments if missing (migration)
  if (migrated.includeComments === undefined) {
    migrated.includeComments = true;
  }

  // Initialize archive organization mode if missing/invalid (migration)
  if (!isArchiveOrganizationMode(migrated.archiveOrganization)) {
    migrated.archiveOrganization = DEFAULT_SETTINGS.archiveOrganization;
  }

  // Initialize frontmatter customization settings if missing (migration)
  if (!migrated.frontmatter) {
    migrated.frontmatter = {
      ...DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS,
      fieldVisibility: { ...DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.fieldVisibility },
      customProperties: [],
      fieldAliases: {},
      propertyOrder: [...DEFAULT_FRONTMATTER_PROPERTY_ORDER],
      tagRoot: '',
      tagOrganization: DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.tagOrganization,
    };
  } else {
    const normalizedCustomProperties = Array.isArray(migrated.frontmatter.customProperties)
      ? migrated.frontmatter.customProperties.map((property) => ({
          ...property,
          type: property.type || 'text',
          value: typeof property.value === 'string' ? property.value : '',
          template: typeof property.template === 'string' ? property.template : '',
          checked: property.checked === true,
          dateValue: typeof property.dateValue === 'string' ? property.dateValue : '',
          dateTimeValue: typeof property.dateTimeValue === 'string' ? property.dateTimeValue : '',
          enabled: property.enabled !== false,
        }))
      : [];

    migrated.frontmatter = {
      ...DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS,
      ...migrated.frontmatter,
      fieldVisibility: {
        ...DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.fieldVisibility,
        ...(migrated.frontmatter.fieldVisibility || {}),
      },
      customProperties: normalizedCustomProperties,
      fieldAliases: normalizeFrontmatterFieldAliases(migrated.frontmatter.fieldAliases),
      propertyOrder: normalizeFrontmatterPropertyOrder(
        migrated.frontmatter.propertyOrder,
        normalizedCustomProperties
      ),
      tagRoot: typeof migrated.frontmatter.tagRoot === 'string'
        ? migrated.frontmatter.tagRoot
        : DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.tagRoot,
      tagOrganization: isArchiveOrganizationMode(migrated.frontmatter.tagOrganization)
        ? migrated.frontmatter.tagOrganization
        : DEFAULT_FRONTMATTER_CUSTOMIZATION_SETTINGS.tagOrganization,
    };
  }

  // Initialize multi-client sync settings if missing (migration)
  if (migrated.syncClientId === undefined) {
    migrated.syncClientId = '';
  }

  return migrated;
}

/**
 * Generate a unique device ID for this installation
 * Uses crypto.randomUUID() if available, otherwise fallback to timestamp-based ID
 */
function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: timestamp + random string
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `device-${timestamp}-${random}`;
}

/**
 * Check if settings need migration
 *
 * @param settings - Settings to check
 * @returns true if migration is needed
 */
export function needsMigration(settings: Partial<SocialArchiverSettings>): boolean {
  // Check for missing new fields
  if (!settings.deviceId) return true;
  if (settings.tier === undefined) return true;
  if (settings.authToken === undefined && (settings as unknown as Record<string, unknown>)['apiKey']) return true;
  if (!settings.byPlatform) return true;
  if (!settings.byCountry) return true;
  if (!settings.timingByPlatform) return true;
  if (!settings.archiveOrganization) return true;
  if (!settings.frontmatter) return true;

  return false;
}
