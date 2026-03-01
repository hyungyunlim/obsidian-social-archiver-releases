/**
 * Cross-Post Types (Client-side)
 *
 * Client-side type definitions for the cross-posting feature.
 * NO Zod, NO D1 types — those are worker-only.
 *
 * Single Responsibility: Type contracts for cross-posting feature
 */

// Connection status from GET /api/threads/oauth/status
export interface ThreadsConnectionStatus {
  connected: boolean;
  platform?: 'threads';
  username?: string;
  status?: 'active' | 'disconnected' | 'revoked' | 'error';
  tokenStatus?: 'valid' | 'expiring_soon' | 'expired' | 'error';
  tokenExpiresAt?: number;
  failureCount?: number;
  lastError?: string;
  connectedAt?: string;
}

// Cross-post request (matches worker Zod schema)
export interface CrossPostRequest {
  content: {
    text: string;       // markdown original
    plainText: string;  // stripped plain text
    mediaR2Keys?: string[];
  };
  platforms: {
    threads?: {
      enabled: true;
      text?: string;    // platform-specific custom text
      replyControl?: ThreadsReplyControl;
      linkAttachment?: string;
    };
  };
  noteRef?: {
    vaultPath: string;
    postId?: string;
  };
}

export type ThreadsReplyControl =
  | 'everyone'
  | 'accounts_you_follow'
  | 'mentioned_only'
  | 'followers_only'
  | 'parent_post_author_only';

// Cross-post response from POST /api/crosspost
export interface CrossPostResponse {
  success: boolean;
  crossPostId: string;
  results: {
    threads?: CrossPostPlatformResult;
  };
}

export interface CrossPostPlatformResult {
  status: 'posted' | 'failed';
  postId?: string;
  postUrl?: string;
  error?: string;
}

// OAuth init response
export interface ThreadsOAuthInitResponse {
  success: boolean;
  authUrl: string;
  state: string;
}

// Platform state for UI
export interface PlatformState {
  platform: 'threads';
  enabled: boolean;
  connected: boolean;
  username?: string;
  tokenStatus?: 'valid' | 'expiring_soon' | 'expired' | 'error';
  characterCount: number;
  maxCharacters: number;
  customText?: string;
  isCustomized: boolean;
  replyControl: ThreadsReplyControl;
}

// Cross-post archive metadata for YAML frontmatter
export interface CrossPostMetadata {
  threads?: {
    posted: boolean;
    url?: string;
    postId?: string;
    postedAt?: string;
    deleted?: boolean;
    deletedAt?: string;
    originalUrl?: string;
    error?: string;
  };
}
