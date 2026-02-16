import { z } from 'zod';

// Platform type - re-exported from shared (Single Source of Truth)
export type { Platform } from '@shared/platforms/types';
import type { Platform } from '@shared/platforms/types';
import { PLATFORMS } from '@shared/platforms/types';

/**
 * Zod-compatible platform enum derived from centralized PLATFORMS constant
 * Cast to tuple type for z.enum() compatibility
 */
const platformEnum = z.enum(PLATFORMS as unknown as [Platform, ...Platform[]]);

// Media types
export interface Media {
  type: 'image' | 'video' | 'audio' | 'document';
  url: string;
  cdnUrl?: string; // CDN URL for proxy-based downloads (TikTok)
  r2Url?: string; // Permanent R2 URL for subscription media pre-cache
  thumbnail?: string; // Use 'thumbnail' to match workers
  r2ThumbnailUrl?: string; // Permanent R2 thumbnail URL for subscription media pre-cache
  thumbnailUrl?: string; // Keep for backward compatibility
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  mimeType?: string;
  altText?: string; // Use 'altText' to match workers
  alt?: string; // Keep for backward compatibility
}

// Author information
export interface Author {
  name: string;
  url: string;
  avatar?: string; // External URL (e.g., from platform API)
  handle?: string; // @username format (e.g., @johndoe) - from workers
  username?: string; // Plain username (backward compatibility)
  verified?: boolean;
  bio?: string; // TikTok Fast API profile_biography
  followers?: number; // TikTok Fast API profile_followers
  // Author Profile Management fields
  localAvatar?: string; // Vault-relative path to locally stored avatar
  postsCount?: number; // Total posts count from platform API
  lastMetadataUpdate?: Date; // Timestamp of last metadata update
}

// Post metadata
export interface PostMetadata {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  bookmarks?: number; // TikTok collect_count
  timestamp: Date | string; // Support both Date objects and ISO strings
  editedAt?: Date | string;
  location?: string;
  latitude?: number; // Google Maps place latitude
  longitude?: number; // Google Maps place longitude
  music?: {
    title: string;
    author: string;
    url: string;
    cover?: string;
    isOriginal?: boolean;
  }; // TikTok music info
  originalSound?: string; // TikTok original sound text
  taggedUsers?: Array<{
    handle: string;
    name: string;
    id: string;
    url: string;
  }>; // TikTok Fast API tagged_user
  externalLink?: string; // Threads external_link_title / Substack links
  externalLinkTitle?: string;
  externalLinkDescription?: string;
  externalLinkImage?: string;
  downloadTime?: number; // Time taken to archive in seconds
  duration?: number; // YouTube video duration in seconds
  // Podcast-specific fields
  episode?: number; // Podcast episode number
  season?: number; // Podcast season number
  subtitle?: string; // Podcast episode subtitle (itunes:subtitle)
  hosts?: string[]; // Podcast hosts (podcast:person role="host")
  guests?: string[]; // Podcast guests (podcast:person role="guest")
  explicit?: boolean; // Explicit content flag (itunes:explicit)
  // Webtoon-specific fields
  commentCount?: number; // Webtoon episode comment count
}

/**
 * Series information for Brunch brunchbook, Naver Webtoon, etc.
 * Used for SeriesGroupingService compatibility
 */
export interface SeriesInfo {
  id: string; // Series ID (e.g., webtoon titleId, brunchbook id)
  title: string; // Series title
  url?: string; // Series URL
  episode?: number; // Current episode number
  season?: number; // Season number (if applicable)
  totalEpisodes?: number; // Total episodes count
  // Webtoon-specific fields
  starScore?: number; // Webtoon episode rating (0-10)
  genre?: string[]; // Webtoon genres (e.g., ["판타지", "액션"])
  ageRating?: string; // Age rating (e.g., "15세 이용가")
  finished?: boolean; // Is the series completed
  publishDay?: string; // Publish day (e.g., "토요웹툰")
  commentCount?: number; // Episode comment count (for display in timeline)
}

// Comment types
export interface Comment {
  id: string;
  author: Author;
  content: string;
  timestamp?: string; // Optional - some platforms don't provide comment timestamps
  likes?: number;
  replies?: Comment[];
}

// Link preview metadata
export interface LinkPreview {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  error?: LinkPreviewError;
}

// Link preview error types
export interface LinkPreviewError {
  type: 'not_found' | 'forbidden' | 'timeout' | 'server_error' | 'network_error' | 'invalid_content';
  message: string;
  retryable: boolean; // Whether the error is temporary and can be retried
}

// AI analysis results
export interface FactCheckResult {
  claim: string;
  verdict: 'true' | 'false' | 'misleading' | 'unverifiable';
  evidence: string;
  confidence: number;
}

export interface AIAnalysis {
  summary: string;
  factCheck: FactCheckResult[];
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  topics: string[];
  language: string;
  readingTime: number;
}

/**
 * Main PostData interface
 *
 * Supports both archived social media posts and user-created posts.
 *
 * For platform: 'post' (user-created posts):
 * - id: Auto-generated UUID or timestamp
 * - url: Vault file path (e.g., "Social Archives/Post/2024/03/2024-03-15-143052.md")
 * - author: Populated from Obsidian user settings (username, userAvatar)
 * - content: User-written markdown content
 * - media: User-attached images/videos
 * - metadata.timestamp: Post creation time
 */

/**
 * YouTube transcript entry (from BrightData API)
 */
export interface TranscriptEntry {
  start_time: number;    // seconds (BrightData returns seconds, not milliseconds)
  end_time: number;      // seconds
  duration: number;      // seconds
  text: string;
}

/**
 * YouTube transcript data
 */
export interface Transcript {
  raw?: string;                      // Full transcript text
  formatted?: TranscriptEntry[];     // Timestamp segments
}

/**
 * Multi-language transcript data
 * Groups transcript segments by language code for language tab switching
 */
export interface MultiLangTranscript {
  /** Default/original language ISO code (e.g., 'en', 'ko') */
  defaultLanguage: string;
  /** Transcript segments grouped by language ISO code */
  byLanguage: Record<string, Array<{ id: number; start: number; end: number; text: string }>>;
}

/**
 * Document type to distinguish different content types
 * - 'post': Regular social media post (default, undefined means 'post')
 * - 'profile': Profile-only document (when posts couldn't be loaded)
 */
export type DocumentType = 'post' | 'profile';

export interface PostData {
  schemaVersion?: '1.0.0'; // Schema version for validation
  /**
   * Document type - determines how the card is rendered
   * - undefined or 'post': Normal post card
   * - 'profile': Profile-only card (compact profile info)
   */
  type?: DocumentType;
  platform: Platform;
  id: string;
  url: string;
  author: Author;
  content: {
    text: string;
    html?: string;
    markdown?: string;
    /**
     * Raw markdown content with inline images preserved (for blog posts)
     * Used by PostCardRenderer to render images inline instead of gallery
     */
    rawMarkdown?: string;
    hashtags?: string[]; // TikTok/X hashtags
    community?: {        // Reddit subreddit info
      name: string;
      url: string;
    };
  };
  media: Media[];
  metadata: PostMetadata;
  comments?: Comment[]; // Optional comments array
  transcript?: Transcript;  // YouTube transcript data
  videoId?: string;         // YouTube video ID
  title?: string;           // YouTube video title
  thumbnail?: string;       // YouTube video thumbnail URL
  filePath?: string;        // File path in vault (for Timeline View)
  tags?: string[];           // User-defined tags from YAML frontmatter
  comment?: string;         // User's personal note/comment
  like?: boolean;           // User's personal like (for sorting/filtering)
  archive?: boolean;        // Whether post is archived (hidden by default)
  shareUrl?: string;        // Public share URL (if published)
  shareMode?: 'full' | 'preview'; // How to display shared post ('preview' for copyright-safe mode)
  publishedDate?: Date;     // Original post publication date
  archivedDate?: Date;      // Date when post was archived
  mediaSourceUrls?: string[]; // Original media URLs (before proxy download)
  linkPreviews?: string[]; // Extracted URLs for link preview generation
  ai?: AIAnalysis;
  /**
   * AI-generated comments (for sharing)
   * Parsed from markdown content when preparing for share
   */
  aiComments?: Array<{
    meta: {
      id: string;
      cli: 'claude' | 'gemini' | 'codex';
      type: 'summary' | 'factcheck' | 'critique' | 'keypoints' | 'sentiment' | 'connections' | 'translation' | 'translate-transcript' | 'glossary' | 'reformat' | 'custom';
      generatedAt: string;
    };
    content: string;
  }>;
  raw?: unknown; // Original API response
  archiveStatus?: 'archiving' | 'completed' | 'failed'; // Archive status for loading states
  originalUrl?: string;     // Original URL (for preliminary documents with loading state)
  downloadedUrls?: string[]; // Downloaded URLs (for YouTube local video tracking)
  processedUrls?: string[]; // URLs that have been processed/archived (for background job tracking)

  /**
   * Subscription-related fields
   * When a post is automatically crawled via subscription, these fields are set
   */
  subscribed?: boolean;       // true if post was auto-archived via subscription
  subscriptionId?: string;    // ID of the subscription that triggered this archive

  /**
   * Podcast channel/show title
   * For podcasts, this is the show name (from RSS channel title)
   * The episode author (if different) is stored in author.handle
   */
  channelTitle?: string;

  /**
   * Podcast audio fields
   * Parsed from frontmatter for podcast episodes
   */
  audioUrl?: string;          // Podcast episode audio URL
  audioSize?: number;         // Audio file size in bytes
  audioType?: string;         // Audio MIME type (e.g., audio/mpeg)
  audioLocalPath?: string;    // Local vault path after download

  /**
   * Whisper transcription data (for podcasts)
   * Parsed from markdown content for podcast episodes with transcription
   */
  whisperTranscript?: {
    segments: Array<{
      id: number;
      start: number;  // seconds
      end: number;
      text: string;
    }>;
    language: string;
  };

  /**
   * Multi-language transcript data (parsed from markdown)
   * Built when multiple ## Transcript / ## Transcript (Language) sections exist
   */
  multilangTranscript?: MultiLangTranscript;

  /**
   * Transcription tracking (same pattern as downloadedUrls)
   * Format: 'transcribed:path' or 'declined:path'
   */
  transcribedUrls?: string[];

  /**
   * Video transcription workflow state
   */
  videoTranscribed?: boolean;
  videoTranscriptionRequestedAt?: string;
  videoTranscriptionError?: string;
  videoTranscribedAt?: string;

  /**
   * Profile-specific fields (only used when type === 'profile')
   * These fields store profile metadata when posts couldn't be loaded
   */
  profileMetadata?: {
    displayName?: string;
    handle?: string;
    bio?: string;
    followers?: number;
    following?: number;
    postsCount?: number;
    verified?: boolean;
    location?: string;
    profileUrl?: string;
    crawledAt?: Date;
  };

  /**
   * Series information for Brunch brunchbook, Naver Webtoon, etc.
   * Used for SeriesGroupingService compatibility
   */
  series?: SeriesInfo;

  /**
   * Quoted/Shared/Reblogged post
   *
   * When a post quotes, shares, or reblogs another post, the original post data is stored here.
   * This is a single-level relationship - quotedPost cannot have another quotedPost.
   *
   * Platforms:
   * - Facebook: Shared posts with original_post
   * - X (Twitter): Quoted tweets
   * - Threads: Quoted threads
   * - Mastodon: Reblogged (boosted) posts
   * - Bluesky: Reposted posts
   */
  quotedPost?: Omit<PostData, 'quotedPost' | 'embeddedArchives'>; // Prevent infinite nesting

  /**
   * Indicates if this is a reblog/repost (vs quote/share with commentary)
   *
   * When true:
   * - The author is the person who reblogged/reposted
   * - The quotedPost contains the original post content
   * - UI should show "Reblogged Post" instead of "Shared Post"
   *
   * Platforms:
   * - Mastodon: Boost (reblog field in API)
   * - Bluesky: Repost (reason.$type === 'app.bsky.feed.defs#reasonRepost')
   */
  isReblog?: boolean;

  /**
   * Embedded archived social media posts
   *
   * When a user includes social media links in their post and archives them,
   * the full archived post data is stored here for inline display.
   *
   * Use case: User writes commentary about a tweet and pastes the tweet URL.
   * The tweet is automatically archived and embedded inline with full content.
   *
   * Limitations:
   * - Maximum 5 embedded archives per post
   * - Only applies to user-created posts (platform: 'post')
   * - Each embed consumes 1 archive credit
   */
  embeddedArchives?: PostData[];
}

// Zod schema for validation with version
// Use lazy() for recursive embeddedArchives field
export const PostDataSchema: z.ZodType<PostData> = z.lazy(() => z.object({
  schemaVersion: z.literal('1.0.0').optional(),
  platform: platformEnum,
  id: z.string(),
  url: z.string(),
  author: z.object({
    name: z.string(),
    url: z.string(),
    avatar: z.string().nullish(),
    handle: z.string().nullish(),
    username: z.string().nullish(),
    verified: z.boolean().nullish(),
    bio: z.string().nullish(),
    followers: z.number().nullish(),
    localAvatar: z.string().nullish(),
    postsCount: z.number().nullish(),
    lastMetadataUpdate: z.date().nullish()
  }),
  content: z.object({
    text: z.string(),
    html: z.string().nullish(),
    markdown: z.string().nullish(),
    rawMarkdown: z.string().nullish(), // Blog posts: raw content with inline images
    hashtags: z.array(z.string()).nullish(),
    community: z.object({
      name: z.string(),
      url: z.string()
    }).nullish()  // Reddit subreddit info
  }),
  media: z.array(z.object({
    type: z.enum(['image', 'video', 'audio', 'document']),
    url: z.string(),
    thumbnail: z.string().nullish(),
    thumbnailUrl: z.string().nullish(),
    width: z.number().nullish(),
    height: z.number().nullish(),
    duration: z.number().nullish(),
    size: z.number().nullish(),
    mimeType: z.string().nullish(),
    altText: z.string().nullish(),
    alt: z.string().nullish()
  })),
  metadata: z.object({
    likes: z.number().nullish(),
    comments: z.number().nullish(),
    shares: z.number().nullish(),
    views: z.number().nullish(),
    bookmarks: z.number().nullish(),
    timestamp: z.union([z.date(), z.string()]),
    editedAt: z.union([z.date(), z.string()]).nullish(),
    location: z.string().nullish(),
    music: z.object({
      title: z.string(),
      author: z.string(),
      url: z.string(),
      cover: z.string().nullish(),
      isOriginal: z.boolean().nullish()
    }).nullish(),
    originalSound: z.string().nullish(),
    taggedUsers: z.array(z.object({
      handle: z.string(),
      name: z.string(),
      id: z.string(),
      url: z.string()
    })).nullish(),
    externalLink: z.string().nullish(),
    externalLinkTitle: z.string().nullish(),
    externalLinkDescription: z.string().nullish(),
    externalLinkImage: z.string().nullish(),
    downloadTime: z.number().nullish(),
    duration: z.number().nullish()
  }),
  comments: z.array(z.object({
    id: z.string(),
    author: z.object({
      name: z.string(),
      url: z.string(),
      avatar: z.string().nullish(),
      handle: z.string().nullish(),
      username: z.string().nullish(),
      verified: z.boolean().nullish(),
      bio: z.string().nullish(),
      followers: z.number().nullish(),
      localAvatar: z.string().nullish(),
      postsCount: z.number().nullish(),
      lastMetadataUpdate: z.date().nullish()
    }),
    content: z.string(),
    timestamp: z.string().nullish(),
    likes: z.number().nullish(),
    replies: z.array(z.any()).nullish()
  })).nullish(),
  transcript: z.object({
    raw: z.string().nullish(),
    formatted: z.array(z.object({
      start_time: z.number(),
      end_time: z.number(),
      duration: z.number(),
      text: z.string()
    })).nullish()
  }).nullish(),
  videoId: z.string().nullish(),
  title: z.string().nullish(),
  thumbnail: z.string().nullish(),
  filePath: z.string().nullish(),
  comment: z.string().nullish(),
  like: z.boolean().nullish(),
  archive: z.boolean().nullish(),
  shareUrl: z.string().nullish(),
  shareMode: z.enum(['full', 'preview']).nullish(),
  publishedDate: z.date().nullish(),
  archivedDate: z.date().nullish(),
  mediaSourceUrls: z.array(z.string()).nullish(),
  linkPreviews: z.array(z.string()).nullish(),
  ai: z.object({
    summary: z.string(),
    factCheck: z.array(z.object({
      claim: z.string(),
      verdict: z.enum(['true', 'false', 'misleading', 'unverifiable']),
      evidence: z.string(),
      confidence: z.number().min(0).max(1)
    })),
    sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']),
    topics: z.array(z.string()),
    language: z.string(),
    readingTime: z.number()
  }).nullish(),
  raw: z.unknown().nullish(),

  // Podcast audio fields
  audioUrl: z.string().nullish(),
  audioSize: z.number().nullish(),
  audioType: z.string().nullish(),
  audioLocalPath: z.string().nullish(),

  // Whisper transcription data (for podcasts)
  whisperTranscript: z.object({
    segments: z.array(z.object({
      id: z.number(),
      start: z.number(),
      end: z.number(),
      text: z.string()
    })),
    language: z.string()
  }).nullish(),

  // Transcription tracking (same pattern as downloadedUrls)
  transcribedUrls: z.array(z.string()).nullish(),

  // Video transcription workflow fields
  videoTranscribed: z.boolean().nullish(),
  videoTranscriptionRequestedAt: z.string().nullish(),
  videoTranscriptionError: z.string().nullish(),
  videoTranscribedAt: z.string().nullish(),

  // Series info (Brunch brunchbook, Naver Webtoon, etc.)
  series: z.object({
    id: z.string(),
    title: z.string(),
    url: z.string().nullish(),
    episode: z.number().nullish(),
    season: z.number().nullish(),
    totalEpisodes: z.number().nullish(),
    // Webtoon-specific fields
    starScore: z.number().nullish(),
    genre: z.array(z.string()).nullish(),
    ageRating: z.string().nullish(),
    finished: z.boolean().nullish(),
    publishDay: z.string().nullish(),
    commentCount: z.number().nullish()
  }).nullish(),

  /**
   * Quoted/Shared post (single-level only)
   * quotedPost cannot have quotedPost or embeddedArchives
   * Note: We can't use .omit() on lazy schemas, so validation is done at runtime
   */
  quotedPost: z.lazy(() => z.object({
    platform: platformEnum,
    id: z.string(),
    url: z.string(),
    author: z.object({
      name: z.string(),
      url: z.string(),
      avatar: z.string().nullish(),
      handle: z.string().nullish(),
      username: z.string().nullish(),
      verified: z.boolean().nullish(),
      bio: z.string().nullish(),
      followers: z.number().nullish(),
      localAvatar: z.string().nullish(),
      postsCount: z.number().nullish(),
      lastMetadataUpdate: z.date().nullish()
    }),
    content: z.object({
      text: z.string(),
      html: z.string().nullish(),
      markdown: z.string().nullish(),
      rawMarkdown: z.string().nullish(), // Blog posts: raw content with inline images
      hashtags: z.array(z.string()).nullish(),
      community: z.object({
        name: z.string(),
        url: z.string()
      }).nullish()  // Reddit subreddit info
    }),
    media: z.array(z.object({
      type: z.enum(['image', 'video', 'audio', 'document']),
      url: z.string(),
      thumbnail: z.string().nullish(),
      thumbnailUrl: z.string().nullish(),
      width: z.number().nullish(),
      height: z.number().nullish(),
      duration: z.number().nullish(),
      size: z.number().nullish(),
      mimeType: z.string().nullish(),
      altText: z.string().nullish(),
      alt: z.string().nullish()
    })),
    metadata: z.object({
      likes: z.number().nullish(),
      comments: z.number().nullish(),
      shares: z.number().nullish(),
      views: z.number().nullish(),
      bookmarks: z.number().nullish(),
      timestamp: z.union([z.date(), z.string()]),
      editedAt: z.union([z.date(), z.string()]).nullish(),
      location: z.string().nullish(),
      music: z.object({
        title: z.string(),
        author: z.string(),
        url: z.string(),
        cover: z.string().nullish(),
        isOriginal: z.boolean().nullish()
      }).nullish(),
      originalSound: z.string().nullish(),
      taggedUsers: z.array(z.object({
        handle: z.string(),
        name: z.string(),
        id: z.string(),
        url: z.string()
      })).nullish(),
      externalLink: z.string().nullish(),
      externalLinkTitle: z.string().nullish(),
      externalLinkDescription: z.string().nullish(),
      externalLinkImage: z.string().nullish(),
      downloadTime: z.number().nullish(),
      duration: z.number().nullish()
    }),
    comments: z.array(z.any()).nullish(),
    raw: z.unknown().nullish()
  })).nullish(),

  /**
   * Indicates if this is a reblog/repost (vs quote/share with commentary)
   */
  isReblog: z.boolean().nullish(),

  /**
   * Recursive embeddedArchives field
   * Maximum 5 embedded archives per post
   */
  embeddedArchives: z.array(PostDataSchema).max(5, 'Maximum 5 embedded archives per post').nullish()
}) as z.ZodType<PostData>);

export type ValidatedPostData = z.infer<typeof PostDataSchema>;
