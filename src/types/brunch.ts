/**
 * Brunch Platform TypeScript Interfaces
 *
 * Type definitions for Brunch (brunch.co.kr) content
 * including posts, authors, videos, comments, and subscriptions.
 */

/**
 * Brunch post data structure
 */
export interface BrunchPostData {
  /** Platform identifier */
  platform: 'brunch';
  /** Post ID (numeric string) */
  id: string;
  /** Full URL of the post */
  url: string;
  /** Post title */
  title: string;
  /** Post subtitle (optional) */
  subtitle?: string;
  /** Author information */
  author: BrunchAuthor;
  /** Post content in Markdown */
  text: string;
  /** Original HTML content */
  contentHtml: string;
  /** Publication timestamp */
  timestamp: Date;
  /** Like count */
  likes?: number;
  /** Comment count */
  commentCount?: number;
  /** View count */
  viewCount?: number;
  /** Media attachments */
  media: BrunchMedia[];
  /** Tags/keywords */
  tags: string[];
  /** Series/book information */
  series?: BrunchSeries;
  /** Embedded videos */
  videos?: BrunchVideo[];
  /** Comments (if fetched) */
  comments?: BrunchComment[];
}

/**
 * Brunch author information
 */
export interface BrunchAuthor {
  /** Public username (without @) */
  id: string;
  /** Internal user ID for API (e.g., 'eHom') */
  userId?: string;
  /** Display name */
  name: string;
  /** Author profile URL */
  url: string;
  /** Avatar image URL */
  avatar?: string;
  /** Author bio/description */
  bio?: string;
  /** Subscriber count */
  subscriberCount?: number;
  /** Job title / profession */
  job?: string;
  /** Cover image URL */
  coverImage?: string;
}

/**
 * Brunch author profile (full details)
 */
export interface BrunchAuthorProfile extends BrunchAuthor {
  /** Total post count */
  postCount?: number;
  /** Author's introduction */
  introduction?: string;
  /** Social links */
  socialLinks?: {
    twitter?: string;
    facebook?: string;
    instagram?: string;
    website?: string;
  };
  /** Featured posts */
  featuredPosts?: Array<{
    id: string;
    title: string;
    url: string;
  }>;
  /** Brunch books (series) authored */
  books?: BrunchBook[];
}

/**
 * Brunch media attachment
 */
export interface BrunchMedia {
  /** Media type */
  type: 'photo' | 'video';
  /** Media URL */
  url: string;
  /** Optional caption */
  caption?: string;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Alternative text */
  alt?: string;
}

/**
 * Brunch video information
 */
export interface BrunchVideo {
  /** Video URL (player page) */
  url: string;
  /** Video platform type */
  type: 'kakaoTV' | 'youtube' | 'other';
  /** Video ID on the platform */
  videoId?: string;
  /** Direct MP4 URL (if available) */
  mp4Url?: string;
  /** Thumbnail image URL */
  thumbnail?: string;
  /** Duration in seconds */
  duration?: number;
  /** Video quality profile (e.g., '1080p') */
  profile?: string;
  /** Video title */
  title?: string;
}

/**
 * Brunch series/book information
 */
export interface BrunchSeries {
  /** Series title */
  title: string;
  /** Series URL */
  url: string;
  /** Episode number in series */
  episode?: number;
  /** Total episodes in series */
  totalEpisodes?: number;
  /** Series ID */
  id?: string;
}

/**
 * Brunch book (published series)
 */
export interface BrunchBook {
  /** Book ID */
  id: string;
  /** Book title */
  title: string;
  /** Book URL */
  url: string;
  /** Cover image URL */
  coverImage?: string;
  /** Publication status */
  status?: 'ongoing' | 'completed';
  /** Post count in book */
  postCount?: number;
  /** Book description */
  description?: string;
}

/**
 * Brunch comment
 */
export interface BrunchComment {
  /** Comment ID */
  id: string;
  /** Author name */
  author: string;
  /** Author profile URL */
  authorUrl?: string;
  /** Author avatar URL */
  authorAvatar?: string;
  /** Comment content */
  content: string;
  /** Comment timestamp */
  timestamp: Date;
  /** Is this author a top creator */
  isTopCreator?: boolean;
  /** Is this author verified */
  isVerified?: boolean;
  /** Like count */
  likes?: number;
  /** Nested replies */
  replies?: BrunchComment[];
}

/**
 * Brunch RSS feed result
 */
export interface BrunchRSSResult {
  /** Author information */
  author: BrunchAuthor;
  /** Posts from RSS feed */
  posts: BrunchRSSItem[];
  /** Last build date */
  lastBuildDate?: Date;
  /** ETag for conditional requests */
  etag?: string;
  /** Last-Modified header */
  lastModified?: string;
}

/**
 * Brunch RSS item (minimal post info)
 */
export interface BrunchRSSItem {
  /** Post ID */
  id: string;
  /** Post title */
  title: string;
  /** Post URL */
  url: string;
  /** Publication date */
  pubDate: Date;
  /** Description/excerpt */
  description?: string;
  /** Author name */
  author?: string;
  /** Categories/tags */
  categories?: string[];
}

/**
 * Brunch subscription options
 */
export interface BrunchSubscriptionOptions {
  /** Subscription type identifier */
  subscriptionType: 'brunch';
  /** Public username (e.g., 'eveningdriver') */
  username: string;
  /** Internal user ID for RSS API (e.g., 'eHom') */
  userId?: string;
  /** Always true - Brunch requires local fetching */
  localFetchRequired: true;
  /** Optional keyword filter */
  keyword?: string;
  /** Author display name */
  displayName?: string;
  /** Author avatar URL */
  avatar?: string;
  /** Include comments when archiving */
  includeComments?: boolean;
  /** Download media attachments */
  downloadMedia?: boolean;
}

/**
 * Brunch subscription poll result
 */
export interface BrunchPollResult {
  /** Subscription ID */
  subscriptionId: string;
  /** Whether poll was successful */
  success: boolean;
  /** New posts found */
  newPostCount: number;
  /** Posts that were archived */
  archivedPosts: Array<{
    id: string;
    title: string;
    url: string;
  }>;
  /** Error message if failed */
  error?: string;
  /** Timestamp of poll */
  timestamp: Date;
}

/**
 * Type guard for BrunchPostData
 */
export function isBrunchPostData(data: unknown): data is BrunchPostData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'platform' in data &&
    (data as BrunchPostData).platform === 'brunch' &&
    'id' in data &&
    'url' in data &&
    'title' in data &&
    'author' in data
  );
}

/**
 * Type guard for BrunchSubscriptionOptions
 */
export function isBrunchSubscriptionOptions(data: unknown): data is BrunchSubscriptionOptions {
  return (
    typeof data === 'object' &&
    data !== null &&
    'subscriptionType' in data &&
    (data as BrunchSubscriptionOptions).subscriptionType === 'brunch' &&
    'username' in data
  );
}
