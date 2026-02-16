/**
 * Webtoon Comment Types
 *
 * Types for Naver Webtoon comment data from the comment API.
 * Used for displaying and storing best comments in archived episodes.
 */

/**
 * A single webtoon comment (best comment)
 *
 * Maps to the comment API response structure:
 * - id: Unique comment identifier
 * - body: Comment text content
 * - createdAt: Unix timestamp in milliseconds
 * - createdBy: Author info with isCreator flag
 * - reactions: Like count from emotions array
 * - childPostCount: Number of replies
 */
export interface WebtoonComment {
  /** Unique comment identifier from API */
  id: string;
  /** Comment text content */
  body: string;
  /** Creation timestamp (Unix ms) */
  createdAt: number;
  /** Comment author information */
  author: {
    /** Author display name */
    name: string;
    /** Whether the author is the webtoon creator/artist */
    isCreator: boolean;
  };
  /** Number of likes (from reactions.emotions[].count where emotionId='like') */
  likes: number;
  /** Number of replies (childPostCount from API) */
  replyCount: number;
}

/**
 * Comment statistics for an episode
 *
 * From the activity/count API endpoint:
 * - totalComments: activeRootPostCount (top-level comments only)
 * - totalLikes: activeReactionCount (total reactions/likes)
 */
export interface WebtoonCommentStats {
  /** Total number of top-level comments (activeRootPostCount) */
  totalComments: number;
  /** Total number of likes/reactions (activeReactionCount) */
  totalLikes: number;
}

/**
 * Raw API response types for type-safe parsing
 */

/** Raw comment author from API */
export interface RawCommentAuthor {
  name?: string;
  isCreator?: boolean;
}

/** Raw emotion/reaction from API */
export interface RawEmotion {
  emotionId: string;
  count: number;
}

/** Raw reaction wrapper from API */
export interface RawReaction {
  emotions?: RawEmotion[];
}

/** Raw comment from top-recent-posts API */
export interface RawTopComment {
  id: string;
  body: string;
  createdAt: number;
  createdBy?: RawCommentAuthor;
  reactions?: RawReaction[];
  childPostCount?: number;
}

/** Raw activity count item from API */
export interface RawActivityCount {
  pageId: string;
  totalRootPostCount: number;
  totalPostCount: number;
  totalReactionCount: number;
  activeRootPostCount: number;
  activePostCount: number;
  activeReactionCount: number;
}

/** Parse raw API comment to WebtoonComment */
export function parseWebtoonComment(raw: RawTopComment): WebtoonComment {
  const likeEmotion = raw.reactions?.[0]?.emotions?.find(
    (e) => e.emotionId === 'like'
  );

  return {
    id: raw.id,
    body: raw.body,
    createdAt: raw.createdAt,
    author: {
      name: raw.createdBy?.name || 'Anonymous',
      isCreator: raw.createdBy?.isCreator || false,
    },
    likes: likeEmotion?.count || 0,
    replyCount: raw.childPostCount || 0,
  };
}

/** Parse raw activity count to stats */
export function parseCommentStats(raw: RawActivityCount): WebtoonCommentStats {
  return {
    totalComments: raw.activeRootPostCount,
    totalLikes: raw.activeReactionCount,
  };
}
