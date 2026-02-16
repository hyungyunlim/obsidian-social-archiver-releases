/**
 * NaverWebtoonLocalService - Local Naver Webtoon Fetcher
 *
 * Fetches Naver Webtoon episodes directly from the plugin using Obsidian's requestUrl.
 * This bypasses the Worker to reduce latency for faster archiving.
 *
 * Key differences from Worker approach:
 * - Uses requestUrl instead of fetch (bypasses CORS, uses native HTTP)
 * - Downloads images directly without proxy
 * - No BrightData credit usage
 */

import { requestUrl, type RequestUrlParam } from 'obsidian';
import type { WebtoonComment } from '../types/webtoon';

// ============================================================================
// Types (exported for use in modals and other services)
// ============================================================================

export interface NaverWebtoonLocalPostData {
  platform: 'naver-webtoon';
  id: string;
  url: string;
  title: string;
  subtitle: string;
  author: {
    name: string;
    url: string;
  };
  media: Array<{
    type: 'image';
    url: string;
    altText?: string;
  }>;
  timestamp: Date;
  series: {
    id: string;
    title: string;
    url: string;
    episode: number;
    starScore?: number;
    finished: boolean;
    publishDay: string;
  };
  authorComment?: string;
  synopsis?: string;
}

export interface WebtoonAPIInfo {
  titleId: number;
  titleName: string;
  thumbnailUrl: string;
  synopsis: string;
  finished: boolean;
  publishDescription: string;
  favoriteCount: number;
  curationTagList: Array<{ tagName: string }>;
  communityArtists: Array<{ name: string }>;
  age: { description: string };
}

export interface WebtoonEpisode {
  no: number;
  subtitle: string;
  thumbnailUrl: string;
  starScore?: number;
  serviceDateDescription: string;
  charge: boolean;
  /** Comment count for this episode (from batch API) */
  commentCount?: number;
  /** Best comments for this episode (lazy loaded, max 10) */
  topComments?: WebtoonComment[];
}

export interface WebtoonPageInfo {
  totalRows: number;
  pageSize: number;
  totalPages: number;
  page: number;
}

export interface WebtoonListResponse {
  titleId: number;
  totalCount: number;
  articleList: WebtoonEpisode[];
  pageInfo: WebtoonPageInfo;
  /** Preview episodes (paid/charged episodes from chargeFolderArticleList) */
  previewEpisodes: WebtoonEpisode[];
}

export interface EpisodeDetail {
  titleId: number;
  no: number;
  subtitle: string;
  imageUrls: string[];
  thumbnailUrl?: string;
  authorComment?: string;
  prevEpisodeNo?: number;
  nextEpisodeNo?: number;
  // Episode metadata (from episode list API)
  starScore?: number;
  serviceDateDescription?: string;
  commentCount?: number;
}

/**
 * URL parsing result with deep link support
 */
export interface WebtoonUrlInfo {
  titleId: string;
  episodeNo?: number;
  urlType: 'series' | 'episode';
}

/**
 * Search result from Naver Webtoon API
 */
export interface WebtoonSearchResult {
  titleId: number;
  titleName: string;
  thumbnailUrl: string;
  displayAuthor: string;
  synopsis: string;
  articleTotalCount: number;
  finished: boolean;
}

/**
 * Progress callback for batch operations
 */
export type ProgressCallback = (loaded: number, total: number) => void;

// ============================================================================
// Constants
// ============================================================================

const API_BASE = 'https://comic.naver.com';
const MOBILE_API_BASE = 'https://m.comic.naver.com';

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*;q=0.9',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://comic.naver.com/',
};

// Retry configuration
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// ============================================================================
// Service Class
// ============================================================================

export class NaverWebtoonLocalService {
  private cookie: string | undefined;

  /**
   * @param cookie - Optional Naver login cookie for adult content access
   */
  constructor(cookie?: string) {
    this.cookie = cookie;
  }

  /**
   * Get headers with optional cookie for authenticated requests
   */
  private getHeaders(): Record<string, string> {
    const headers = { ...COMMON_HEADERS };
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }
    return headers;
  }

  /**
   * Check if URL is a Naver Webtoon URL
   */
  static isWebtoonUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase();
      return (hostname === 'comic.naver.com' || hostname === 'm.comic.naver.com') &&
             parsedUrl.pathname.includes('/webtoon/');
    } catch {
      return false;
    }
  }

  /**
   * Parse URL to extract titleId and episodeNo
   */
  parseUrl(url: string): { titleId: string; episodeNo?: number; urlType: 'series' | 'episode' } | null {
    try {
      const parsedUrl = new URL(url);
      const titleId = parsedUrl.searchParams.get('titleId');

      if (!titleId) return null;

      if (parsedUrl.pathname.includes('/webtoon/detail')) {
        const episodeNo = parsedUrl.searchParams.get('no');
        return {
          titleId,
          episodeNo: episodeNo ? parseInt(episodeNo, 10) : undefined,
          urlType: episodeNo ? 'episode' : 'series',
        };
      }

      if (parsedUrl.pathname.includes('/webtoon/list')) {
        return { titleId, urlType: 'series' };
      }

      return null;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // Search Methods
  // ==========================================================================

  /**
   * Search webtoons by keyword
   * @param keyword - Search keyword (webtoon title, author, etc.)
   * @returns Array of matching webtoons
   */
  async searchWebtoons(keyword: string): Promise<WebtoonSearchResult[]> {
    const searchUrl = `${API_BASE}/api/search/all?keyword=${encodeURIComponent(keyword)}`;

    console.log('[NaverWebtoonLocal] Searching webtoons:', searchUrl);

    try {
      const response = await requestUrl({
        url: searchUrl,
        headers: this.getHeaders(),
      });

      if (response.status !== 200) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = response.json as {
        searchWebtoonResult?: {
          searchViewList?: WebtoonSearchResult[];
        };
      };

      return data.searchWebtoonResult?.searchViewList ?? [];
    } catch (error) {
      console.error('[NaverWebtoonLocal] Search error:', error);
      throw new Error('Failed to search webtoons');
    }
  }

  // ==========================================================================
  // Batch Episode Fetching Methods
  // ==========================================================================

  /**
   * Fetch all episodes across all pages
   * @param titleId - Webtoon title ID
   * @param maxPages - Optional limit on pages to fetch (default: all)
   * @param onProgress - Optional callback for progress updates
   */
  async fetchAllEpisodes(
    titleId: string,
    maxPages?: number,
    onProgress?: ProgressCallback
  ): Promise<{
    episodes: WebtoonEpisode[];
    pageInfo: WebtoonPageInfo;
    totalCount: number;
  }> {
    // Fetch first page to get total info
    const firstPage = await this.fetchEpisodeList(titleId, 1);
    const allEpisodes: WebtoonEpisode[] = [...firstPage.articleList];
    const totalPages = firstPage.pageInfo.totalPages;

    onProgress?.(1, totalPages);

    // Determine how many pages to fetch
    const pagesToFetch = maxPages ? Math.min(maxPages, totalPages) : totalPages;

    // Fetch remaining pages
    for (let page = 2; page <= pagesToFetch; page++) {
      // Small delay between requests to avoid rate limiting
      await this.delay(100);

      try {
        const pageData = await this.fetchEpisodeList(titleId, page);
        allEpisodes.push(...pageData.articleList);
        onProgress?.(page, totalPages);
      } catch (error) {
        console.warn(`[NaverWebtoonLocal] Failed to fetch page ${page}:`, error);
        // Continue with other pages
      }
    }

    return {
      episodes: allEpisodes,
      pageInfo: {
        ...firstPage.pageInfo,
        totalRows: allEpisodes.length,
      },
      totalCount: firstPage.totalCount,
    };
  }

  /**
   * Filter free episodes from list
   */
  filterFreeEpisodes(episodes: WebtoonEpisode[]): WebtoonEpisode[] {
    return episodes.filter(ep => !ep.charge);
  }

  /**
   * Get episodes that will become free soon (with days until free)
   */
  getPendingFreeEpisodes(episodes: WebtoonEpisode[]): Array<WebtoonEpisode & { daysUntilFree: number }> {
    return episodes
      .filter(ep => ep.charge && ep.serviceDateDescription.includes('일 후 무료'))
      .map(ep => {
        const match = ep.serviceDateDescription.match(/(\d+)일 후 무료/);
        const daysUntilFree = match?.[1] ? parseInt(match[1], 10) : 999;
        return { ...ep, daysUntilFree };
      })
      .sort((a, b) => a.daysUntilFree - b.daysUntilFree);
  }

  /**
   * Fetch webtoon info and first page of episodes together
   * Useful for initial modal display
   */
  async fetchWebtoonOverview(titleId: string): Promise<{
    info: WebtoonAPIInfo;
    episodes: WebtoonEpisode[];
    pageInfo: WebtoonPageInfo;
    totalCount: number;
    freeCount: number;
    paidCount: number;
  }> {
    const [info, episodeList] = await Promise.all([
      this.fetchWebtoonInfo(titleId),
      this.fetchEpisodeList(titleId, 1),
    ]);

    const freeEpisodes = this.filterFreeEpisodes(episodeList.articleList);

    return {
      info,
      episodes: episodeList.articleList,
      pageInfo: episodeList.pageInfo,
      totalCount: episodeList.totalCount,
      freeCount: freeEpisodes.length + (episodeList.pageInfo.totalPages > 1 ?
        (episodeList.totalCount - episodeList.articleList.length) : 0), // Estimate
      paidCount: episodeList.articleList.filter(ep => ep.charge).length,
    };
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch webtoon series info
   */
  async fetchWebtoonInfo(titleId: string): Promise<WebtoonAPIInfo> {
    const apiUrl = `${API_BASE}/api/article/list/info?titleId=${titleId}`;

    console.log('[NaverWebtoonLocal] Fetching webtoon info:', apiUrl);

    const response = await requestUrl({
      url: apiUrl,
      headers: this.getHeaders(),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch webtoon info: ${response.status}`);
    }

    const data = response.json;

    // Handle wrapped or unwrapped response
    const result = data.result || data;

    if (!result.titleId) {
      throw new Error('Invalid webtoon info response');
    }

    return result as WebtoonAPIInfo;
  }

  /**
   * Fetch episode list (for starScore and date)
   */
  async fetchEpisodeList(titleId: string, page: number = 1, sortAsc: boolean = false): Promise<WebtoonListResponse> {
    const sortParam = sortAsc ? '&sort=ASC' : '';
    const apiUrl = `${API_BASE}/api/article/list?titleId=${titleId}&page=${page}${sortParam}`;

    console.log('[NaverWebtoonLocal] Fetching episode list:', apiUrl);

    const response = await requestUrl({
      url: apiUrl,
      headers: this.getHeaders(),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch episode list: ${response.status}`);
    }

    const data = response.json;
    const result = data.result || data;

    return {
      titleId: result.titleId,
      totalCount: result.totalCount,
      articleList: result.articleList || [],
      pageInfo: result.pageInfo,
      previewEpisodes: result.chargeFolderArticleList || [],
    };
  }

  /**
   * Fetch episode detail with images (HTML parsing)
   */
  async fetchEpisodeDetail(titleId: string, episodeNo: number): Promise<EpisodeDetail> {
    const detailUrl = `${MOBILE_API_BASE}/webtoon/detail?titleId=${titleId}&no=${episodeNo}`;

    console.log('[NaverWebtoonLocal] Fetching episode detail:', detailUrl);

    const headers = this.getHeaders();
    // Use mobile User-Agent for episode detail
    headers['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';

    const response = await requestUrl({
      url: detailUrl,
      headers,
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch episode detail: ${response.status}`);
    }

    const html = response.text;

    // Check if redirected to login page (adult content requires authentication)
    if (html.includes('nidlogin.login') || html.includes('연령 확인이 필요합니다') || html.includes('네이버 로그인')) {
      throw new Error('This webtoon requires adult verification. Please set your Naver cookie in plugin settings (Settings → Social Archiver → Naver Cookie)');
    }

    // Check if this is a paid episode
    if (html.includes('유료 회차입니다') || html.includes('미리보기가 종료된') || html.includes('구매하기')) {
      throw new Error('This episode requires payment (paid content)');
    }

    return this.parseEpisodeHtml(html, titleId, episodeNo);
  }

  /**
   * Fetch episode detail with metadata (starScore, date, commentCount)
   * Used for streaming mode to show episode info in UI
   */
  async fetchEpisodeDetailWithMeta(titleId: string, episodeNo: number): Promise<EpisodeDetail> {
    // Fetch detail and episode list in parallel for performance
    const [detail, episodeListResult] = await Promise.all([
      this.fetchEpisodeDetail(titleId, episodeNo),
      this.fetchEpisodeList(titleId, 1).catch(() => null),
    ]);

    // Try to find episode metadata from list
    let episodeMeta: WebtoonEpisode | undefined;
    if (episodeListResult) {
      episodeMeta = episodeListResult.articleList.find(ep => ep.no === episodeNo);

      // If not found in first page and there are more pages, try to find correct page
      if (!episodeMeta && episodeListResult.pageInfo.totalPages > 1) {
        const totalEpisodes = episodeListResult.totalCount;
        const pageSize = episodeListResult.pageInfo.pageSize || 20;
        const episodesFromEnd = totalEpisodes - episodeNo + 1;
        const estimatedPage = Math.ceil(episodesFromEnd / pageSize);

        if (estimatedPage > 1 && estimatedPage <= episodeListResult.pageInfo.totalPages) {
          try {
            const targetPage = await this.fetchEpisodeList(titleId, estimatedPage);
            episodeMeta = targetPage.articleList.find(ep => ep.no === episodeNo);
          } catch {
            // Silent fail - metadata is optional
          }
        }
      }
    }

    // Merge metadata into detail
    // Use episode list subtitle as fallback if HTML parsing didn't find one
    return {
      ...detail,
      subtitle: detail.subtitle || episodeMeta?.subtitle || `${episodeNo}화`,
      thumbnailUrl: detail.thumbnailUrl || episodeMeta?.thumbnailUrl,
      starScore: episodeMeta?.starScore,
      serviceDateDescription: episodeMeta?.serviceDateDescription,
      commentCount: episodeMeta?.commentCount,
    };
  }

  /**
   * Parse episode HTML to extract image URLs
   */
  private parseEpisodeHtml(html: string, titleId: string, episodeNo: number): EpisodeDetail {
    const imageUrls: string[] = [];

    // Primary pattern: data-src with mobilewebimg
    const mobilewebimgMatches = html.matchAll(
      /data-src="(https:\/\/image-comic\.pstatic\.net\/mobilewebimg\/[^"]+)"/gi
    );
    for (const match of mobilewebimgMatches) {
      if (match[1]) {
        const imgUrl = this.normalizeImageUrl(match[1]);
        if (imgUrl && !imageUrls.includes(imgUrl)) {
          imageUrls.push(imgUrl);
        }
      }
    }

    // Fallback patterns...
    if (imageUrls.length === 0) {
      const dataSrcMatches = html.matchAll(
        /data-src="(https:\/\/[^"]+pstatic\.net[^"]+)"/gi
      );
      for (const match of dataSrcMatches) {
        if (match[1] && match[1].includes('image-comic')) {
          const imgUrl = this.normalizeImageUrl(match[1]);
          if (imgUrl && !imageUrls.includes(imgUrl)) {
            imageUrls.push(imgUrl);
          }
        }
      }
    }

    // Extract subtitle
    const subtitle = this.extractSubtitle(html, episodeNo);

    // Extract thumbnail
    const thumbnail = this.extractThumbnail(html);

    // Extract author comment
    const authorComment = this.extractAuthorComment(html);

    console.log(`[NaverWebtoonLocal] Parsed episode: ${imageUrls.length} images found`);

    return {
      titleId: parseInt(titleId, 10),
      no: episodeNo,
      subtitle: subtitle || `${episodeNo}화`,
      imageUrls,
      thumbnailUrl: thumbnail || '',
      authorComment,
    };
  }

  /**
   * Fetch complete episode data
   */
  async fetchEpisode(url: string): Promise<NaverWebtoonLocalPostData> {
    const urlInfo = this.parseUrl(url);
    if (!urlInfo || urlInfo.urlType !== 'episode' || !urlInfo.episodeNo) {
      throw new Error('Invalid episode URL. Please use a specific episode URL.');
    }

    const { titleId, episodeNo } = urlInfo;

    // Fetch in parallel
    const [info, detail, episodeList] = await Promise.all([
      this.fetchWebtoonInfo(titleId),
      this.fetchEpisodeDetail(titleId, episodeNo),
      this.fetchEpisodeList(titleId, 1),
    ]);

    // Find episode metadata from list
    let episodeMeta = episodeList.articleList.find(ep => ep.no === episodeNo);

    // If not found in first page, try to find correct page
    if (!episodeMeta && episodeList.pageInfo.totalPages > 1) {
      const totalEpisodes = episodeList.totalCount;
      const pageSize = episodeList.pageInfo.pageSize || 20;
      const episodesFromEnd = totalEpisodes - episodeNo + 1;
      const estimatedPage = Math.ceil(episodesFromEnd / pageSize);

      if (estimatedPage > 1 && estimatedPage <= episodeList.pageInfo.totalPages) {
        const targetPage = await this.fetchEpisodeList(titleId, estimatedPage);
        episodeMeta = targetPage.articleList.find(ep => ep.no === episodeNo);
      }
    }

    // Build author name
    const authorName = info.communityArtists.map(a => a.name).join(', ') || 'Unknown';

    // Parse episode date
    const timestamp = episodeMeta
      ? this.parseServiceDate(episodeMeta.serviceDateDescription)
      : new Date();

    return {
      platform: 'naver-webtoon',
      id: `webtoon-${info.titleId}-${detail.no}`,
      url,
      title: `${info.titleName} - ${detail.subtitle}`,
      subtitle: detail.subtitle,
      author: {
        name: authorName,
        url: `https://comic.naver.com/webtoon/list?titleId=${info.titleId}`,
      },
      media: detail.imageUrls.map((imgUrl, index) => ({
        type: 'image' as const,
        url: imgUrl,
        altText: `${detail.subtitle} - Image ${index + 1}`,
      })),
      timestamp,
      series: {
        id: String(info.titleId),
        title: info.titleName,
        url: `https://comic.naver.com/webtoon/list?titleId=${info.titleId}`,
        episode: detail.no,
        starScore: episodeMeta?.starScore,
        finished: info.finished,
        publishDay: info.publishDescription,
      },
      authorComment: detail.authorComment,
      synopsis: info.synopsis,
    };
  }

  /**
   * Download image directly using requestUrl
   * Returns ArrayBuffer for saving to vault
   */
  async downloadImage(imageUrl: string): Promise<ArrayBuffer> {
    console.log('[NaverWebtoonLocal] Downloading image:', imageUrl.substring(0, 80) + '...');

    const response = await requestUrl({
      url: imageUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        'Referer': 'https://m.comic.naver.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (response.status !== 200) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    return response.arrayBuffer;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private normalizeImageUrl(url: string): string {
    let normalized = url.trim();
    if (normalized.startsWith('//')) {
      normalized = `https:${normalized}`;
    }
    normalized = this.decodeHtmlEntities(normalized);
    if (normalized.startsWith('http://')) {
      normalized = normalized.replace('http://', 'https://');
    }
    return normalized;
  }

  private extractSubtitle(html: string, episodeNo: number): string | undefined {
    // Mobile title pattern
    const mobileTitleMatch = html.match(
      /<h2[^>]*class="[^"]*(?:tit|title|subject)[^"]*"[^>]*>([\s\S]*?)<\/h2>/i
    );
    if (mobileTitleMatch && mobileTitleMatch[1]) {
      const title = this.stripHtml(mobileTitleMatch[1]).trim();
      if (title && title !== `${episodeNo}화`) {
        return title;
      }
    }

    // og:title fallback
    const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    if (ogMatch && ogMatch[1]) {
      return this.decodeHtmlEntities(ogMatch[1]);
    }

    return undefined;
  }

  private extractThumbnail(html: string): string | undefined {
    const ogImageMatch = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    );
    if (ogImageMatch && ogImageMatch[1]) {
      return this.normalizeImageUrl(ogImageMatch[1]);
    }
    return undefined;
  }

  private extractAuthorComment(html: string): string | undefined {
    const commentMatch = html.match(
      /<div[^>]*class="[^"]*(?:author[_-]?comment|writer[_-]?comment)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (commentMatch && commentMatch[1]) {
      const comment = this.stripHtml(commentMatch[1]).trim();
      if (comment) return comment;
    }
    return undefined;
  }

  private parseServiceDate(dateStr: string): Date {
    if (!dateStr || dateStr.includes('일 후 무료')) {
      return new Date();
    }

    // Parse "YY.MM.DD" format
    const shortMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (shortMatch && shortMatch[1] && shortMatch[2] && shortMatch[3]) {
      const year = 2000 + parseInt(shortMatch[1], 10);
      const month = parseInt(shortMatch[2], 10) - 1;
      const day = parseInt(shortMatch[3], 10);
      return new Date(year, month, day, 12, 0, 0);
    }

    return new Date();
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }
}
