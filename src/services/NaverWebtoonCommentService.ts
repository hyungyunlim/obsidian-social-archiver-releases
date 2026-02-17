/**
 * NaverWebtoonCommentService - Naver Webtoon Comment API Layer
 *
 * Fetches comment data from Naver Webtoon's comment API:
 * - Batch comment counts for episode lists
 * - Best/top comments for individual episodes
 *
 * API Base: https://apis.naver.com/commentBox/cbox5
 *
 * Required Headers:
 * - service-ticket-id: comic_webtoon
 * - service-type: KW
 * - language: KOREAN
 */

import { requestUrl } from 'obsidian';
import {
  type WebtoonComment,
  type WebtoonCommentStats,
  type RawTopComment,
  type RawActivityCount,
  parseWebtoonComment,
  parseCommentStats,
} from '../types/webtoon';

// ============================================================================
// Constants
// ============================================================================

const COMMENT_API_BASE = 'https://comic.naver.com/comment/api/community';

/** Required headers for Naver Webtoon comment API */
const COMMENT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'service-ticket-id': 'comic_webtoon',
  'service-type': 'KW',
  language: 'KOREAN',
  Referer: 'https://comic.naver.com/',
  Origin: 'https://comic.naver.com',
};

/** Maximum episodes per batch request (to avoid URL length limits) */
const MAX_BATCH_SIZE = 50;

// ============================================================================
// Types
// ============================================================================

/** API response for activity count */
interface ActivityCountResponse {
  status: string;
  result?: {
    countList: RawActivityCount[];
  };
  error?: {
    code: string;
    message: string;
  };
}

/** API response for top comments */
interface TopCommentsResponse {
  status: string;
  result?: {
    tops: RawTopComment[];
  };
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// Service Class
// ============================================================================

export class NaverWebtoonCommentService {
  private debug: boolean;

  constructor(options?: { debug?: boolean }) {
    this.debug = options?.debug ?? false;
  }

  /**
   * Fetch comment counts for multiple episodes in a single batch
   *
   * @param titleId - Webtoon series ID
   * @param episodeNos - Array of episode numbers
   * @returns Map of episode number to comment count
   *
   * @example
   * const counts = await service.fetchCommentCounts('812354', [1, 2, 3]);
   * // Map { 1 => 5940, 2 => 4231, 3 => 7149 }
   */
  async fetchCommentCounts(
    titleId: string,
    episodeNos: number[]
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();

    if (episodeNos.length === 0) {
      return result;
    }

    // Split into batches to avoid URL length limits
    const batches = this.chunkArray(episodeNos, MAX_BATCH_SIZE);

    for (const batch of batches) {
      try {
        const batchResult = await this.fetchCommentCountsBatch(titleId, batch);
        for (const [no, count] of batchResult) {
          result.set(no, count);
        }
      } catch (error) {
        this.log('warn', `Failed to fetch comment counts for batch:`, error);
        // Continue with other batches, don't fail entire operation
      }
    }

    return result;
  }

  /**
   * Fetch comment counts for a single batch of episodes
   */
  private async fetchCommentCountsBatch(
    titleId: string,
    episodeNos: number[]
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();

    const pageIds = episodeNos
      .map((no) => `webtoon_${titleId}_${no}`)
      .join(',');

    const url = `${COMMENT_API_BASE}/v1/pages/activity/count?pageIds=${pageIds}`;

    this.log('debug', `Fetching comment counts: ${url}`);

    const response = await requestUrl({
      url,
      method: 'GET',
      headers: COMMENT_HEADERS,
    });

    if (response.status !== 200) {
      throw new Error(`Comment API returned status ${response.status}`);
    }

    const data = response.json as ActivityCountResponse;

    if (data.status !== 'success' || !data.result?.countList) {
      this.log('warn', 'Comment count API returned non-success:', data);
      return result;
    }

    // Parse results and extract episode numbers from pageIds
    for (const item of data.result.countList) {
      // pageId format: webtoon_{titleId}_{episodeNo}
      const match = item.pageId.match(/webtoon_\d+_(\d+)/);
      if (match && match[1]) {
        const episodeNo = parseInt(match[1], 10);
        const stats = parseCommentStats(item);
        result.set(episodeNo, stats.totalComments);
      }
    }

    return result;
  }

  /**
   * Fetch top/best comments for a specific episode
   *
   * @param titleId - Webtoon series ID
   * @param episodeNo - Episode number
   * @param count - Number of top comments to fetch (default: 10, max: 20)
   * @returns Array of WebtoonComment objects
   *
   * @example
   * const comments = await service.fetchTopComments('812354', 3, 10);
   * // [{ id, body, author, likes, replyCount }, ...]
   */
  async fetchTopComments(
    titleId: string,
    episodeNo: number,
    count: number = 10
  ): Promise<WebtoonComment[]> {
    const pageId = `webtoon_${titleId}_${episodeNo}`;
    const url = `${COMMENT_API_BASE}/v1/page/${pageId}/top-recent-posts?topCount=${count}&recentTopCount=0&pinRepresentation=distinct`;

    this.log('debug', `Fetching top comments: ${url}`);

    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: COMMENT_HEADERS,
      });

      if (response.status !== 200) {
        throw new Error(`Comment API returned status ${response.status}`);
      }

      const data = response.json as TopCommentsResponse;

      if (data.status !== 'success' || !data.result?.tops) {
        this.log('warn', 'Top comments API returned non-success:', data);
        return [];
      }

      return data.result.tops.map(parseWebtoonComment);
    } catch (error) {
      this.log('error', `Failed to fetch top comments for episode ${episodeNo}:`, error);
      return [];
    }
  }

  /**
   * Fetch comment stats for a single episode
   *
   * @param titleId - Webtoon series ID
   * @param episodeNo - Episode number
   * @returns Comment stats or null if failed
   */
  async fetchCommentStats(
    titleId: string,
    episodeNo: number
  ): Promise<WebtoonCommentStats | null> {
    const counts = await this.fetchCommentCounts(titleId, [episodeNo]);
    const count = counts.get(episodeNo);

    if (count === undefined) {
      return null;
    }

    // For full stats, we need to make another request
    // But for now, we only have totalComments from the batch API
    return {
      totalComments: count,
      totalLikes: 0, // Would need separate API call
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Split array into chunks of specified size
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Logging helper
   */
  private log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    ...args: unknown[]
  ): void {
    const prefix = '[NaverWebtoonCommentService]';

    if (level === 'debug' && !this.debug) {
      return;
    }

    switch (level) {
      case 'debug':
      case 'info':
        console.debug(prefix, message, ...args);
        break;
      case 'warn':
        console.warn(prefix, message, ...args);
        break;
      case 'error':
        console.error(prefix, message, ...args);
        break;
    }
  }
}

// ============================================================================
// Singleton Instance (optional)
// ============================================================================

let instance: NaverWebtoonCommentService | null = null;

/**
 * Get singleton instance of NaverWebtoonCommentService
 */
export function getNaverWebtoonCommentService(
  options?: { debug?: boolean }
): NaverWebtoonCommentService {
  if (!instance) {
    instance = new NaverWebtoonCommentService(options);
  }
  return instance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetNaverWebtoonCommentService(): void {
  instance = null;
}
