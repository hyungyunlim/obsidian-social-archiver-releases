/**
 * WebtoonsLocalService - Local WEBTOON (Global) Fetcher
 *
 * Fetches webtoons.com episodes directly from the plugin using Obsidian's requestUrl.
 * This bypasses the Worker to reduce latency for faster archiving.
 *
 * Key differences from Naver Webtoon:
 * - Multi-language support (en, es, fr, de, th, id, zh-hant)
 * - RSS feeds for episode lists
 * - Different URL structure (/{lang}/{genre}/{slug}/list?title_no=xxx)
 * - Uses likes instead of star ratings
 *
 * Single Responsibility: WEBTOON (Global) URL parsing, RSS fetching, and series info
 */

import { requestUrl } from 'obsidian';

// ============================================================================
// Types
// ============================================================================

export interface WebtoonsUrlInfo {
  platform: 'webtoons';
  /** Language code (e.g., 'en', 'es', 'fr', 'id') */
  language: string;
  /** Genre or category (e.g., 'romance', 'fantasy', 'canvas') */
  genre: string;
  /** URL slug for the series (e.g., 'love-bites') */
  seriesSlug: string;
  /** Series title number from URL (title_no parameter) */
  titleNo: string;
  /** Episode number (only for viewer URLs) */
  episodeNo?: number;
  /** URL type: series list or episode viewer */
  urlType: 'series' | 'episode';
  /** Whether this is a Canvas (user-created) series */
  isCanvas: boolean;
}

export interface WebtoonsEpisode {
  /** Episode number */
  episodeNo: number;
  /** Episode title */
  title: string;
  /** Full episode viewer URL */
  url: string;
  /** Thumbnail image URLs */
  thumbnailUrls: string[];
  /** Publication date */
  pubDate: Date;
  /** Author name(s) */
  author: string;
  /** Episode description/teaser */
  description?: string;
}

export interface WebtoonsSeriesInfo {
  /** Series title number */
  titleNo: string;
  /** Series title */
  title: string;
  /** Series description/synopsis */
  description: string;
  /** Series thumbnail URL */
  thumbnailUrl: string;
  /** Language code */
  language: string;
  /** Genre (e.g., 'romance', 'fantasy') */
  genre: string;
  /** Update day (e.g., 'SATURDAY', 'MONDAY') */
  updateDay?: string;
  /** Whether the series is completed */
  isCompleted: boolean;
  /** Whether this is a Canvas series */
  isCanvas: boolean;
  /** Author name(s) */
  authorNames?: string;
  /** Age rating (if available) */
  ageRating?: string;
  /** RSS feed URL */
  rssUrl: string;
}

export interface WebtoonsRssFeed {
  /** Series title */
  title: string;
  /** Series description */
  description: string;
  /** Series URL (list page) */
  link: string;
  /** Series thumbnail */
  thumbnailUrl: string;
  /** List of episodes */
  items: WebtoonsEpisode[];
}

export interface WebtoonsSearchResult {
  titleNo: string;
  title: string;
  genre: string;
  language: string;
  thumbnailUrl: string;
  updateDay?: string;
  isCanvas: boolean;
  authorNames: string;
  seriesSlug: string;
}

export interface WebtoonsEpisodeListResponse {
  /** Total number of episodes */
  totalCount: number;
  /** Current page number */
  currentPage: number;
  /** Total pages */
  totalPages: number;
  /** Episodes on this page */
  episodes: WebtoonsEpisode[];
}

/**
 * Best comment from WEBTOON community
 */
export interface WebtoonsBestComment {
  /** Comment ID */
  id: string;
  /** Comment body text */
  body: string;
  /** Author name */
  authorName: string;
  /** Author profile ID */
  authorId: string;
  /** Like count */
  likeCount: number;
  /** Dislike count */
  dislikeCount: number;
  /** Reply count */
  replyCount: number;
  /** Created timestamp */
  createdAt: Date;
}

export interface WebtoonsEpisodeDetail {
  /** Series title number */
  titleNo: string;
  /** Episode number */
  episodeNo: number;
  /** Episode title */
  title: string;
  /** Episode subtitle (if any) */
  subtitle?: string;
  /** Full episode images (CDN URLs) */
  imageUrls: string[];
  /** Episode thumbnail */
  thumbnailUrl?: string;
  /** Publication date */
  publishDate?: Date;
  /** Like count */
  likeCount?: number;
  /** Creator's note (if any) */
  authorNote?: string;
  /** Whether this is a paid/locked episode */
  isPaid?: boolean;
  /** Best comments from community */
  bestComments?: WebtoonsBestComment[];
}

export interface WebtoonsLocalPostData {
  platform: 'webtoons';
  id: string;
  url: string;
  title: string;
  author: {
    name: string;
    url: string;
    avatar?: string;
  };
  media: Array<{
    type: 'image';
    url: string;
  }>;
  timestamp: Date;
  series: {
    id: string;
    title: string;
    url: string;
    episode: number;
    genre?: string[];
    publishDay?: string;
  };
  likes?: number;
  authorComment?: string;
  language: string;
}

// ============================================================================
// Constants
// ============================================================================

const API_BASE = 'https://www.webtoons.com';

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

/**
 * Supported WEBTOON languages with their display names
 */
export const WEBTOONS_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'th', label: 'ไทย' },
  { code: 'id', label: 'Indonesia' },
  { code: 'zh-hant', label: '中文 (繁體)' },
];

// ============================================================================
// Service Class
// ============================================================================

export class WebtoonsLocalService {
  /**
   * Check if URL is a WEBTOON (Global) URL
   */
  static isWebtoonsUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase().replace('www.', '');
      return hostname === 'webtoons.com';
    } catch {
      return false;
    }
  }

  /**
   * Parse a WEBTOON URL into structured info
   *
   * Supported formats:
   * - Series: https://www.webtoons.com/en/romance/love-bites/list?title_no=7679
   * - Episode: https://www.webtoons.com/en/romance/love-bites/episode-43/viewer?title_no=7679&episode_no=43
   * - Canvas: https://www.webtoons.com/en/canvas/my-series/list?title_no=12345
   */
  parseUrl(url: string): WebtoonsUrlInfo | null {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase().replace('www.', '');

      if (hostname !== 'webtoons.com') {
        return null;
      }

      // Parse path: /{lang}/{genre}/{slug}/...
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      const language = pathParts[0];
      const genre = pathParts[1];
      const seriesSlug = pathParts[2];

      // Validate required path parts exist
      if (!language || !genre || !seriesSlug) {
        return null;
      }

      // Validate language (2 letters or zh-hant)
      if (!/^[a-z]{2}$/.test(language) && language !== 'zh-hant') {
        return null;
      }

      // Get title_no from query params
      const titleNo = parsedUrl.searchParams.get('title_no');
      if (!titleNo) {
        return null;
      }

      const isCanvas = genre === 'canvas' || genre === 'challenge';

      // Check if episode or series
      if (parsedUrl.pathname.includes('/viewer')) {
        const episodeNoStr = parsedUrl.searchParams.get('episode_no');
        const episodeNo = episodeNoStr ? parseInt(episodeNoStr, 10) : undefined;

        return {
          platform: 'webtoons',
          language,
          genre,
          seriesSlug,
          titleNo,
          episodeNo,
          urlType: 'episode',
          isCanvas,
        };
      }

      if (parsedUrl.pathname.includes('/list')) {
        return {
          platform: 'webtoons',
          language,
          genre,
          seriesSlug,
          titleNo,
          urlType: 'series',
          isCanvas,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Build RSS feed URL for a series
   */
  buildRssUrl(urlInfo: WebtoonsUrlInfo): string {
    // Canvas series use 'challenge' in RSS URL
    const rssGenre = urlInfo.isCanvas ? 'challenge' : urlInfo.genre;
    return `${API_BASE}/${urlInfo.language}/${rssGenre}/${urlInfo.seriesSlug}/rss?title_no=${urlInfo.titleNo}`;
  }

  /**
   * Build series list URL
   */
  buildSeriesUrl(urlInfo: WebtoonsUrlInfo): string {
    return `${API_BASE}/${urlInfo.language}/${urlInfo.genre}/${urlInfo.seriesSlug}/list?title_no=${urlInfo.titleNo}`;
  }

  /**
   * Build episode viewer URL
   */
  buildEpisodeUrl(urlInfo: WebtoonsUrlInfo, episodeNo: number): string {
    return `${API_BASE}/${urlInfo.language}/${urlInfo.genre}/${urlInfo.seriesSlug}/episode-${episodeNo}/viewer?title_no=${urlInfo.titleNo}&episode_no=${episodeNo}`;
  }

  /**
   * Fetch and parse RSS feed for a series
   */
  async fetchRssFeed(urlInfo: WebtoonsUrlInfo): Promise<WebtoonsRssFeed> {
    const rssUrl = this.buildRssUrl(urlInfo);
    console.debug('[WebtoonsLocal] Fetching RSS feed:', rssUrl);

    const response = await requestUrl({
      url: rssUrl,
      headers: COMMON_HEADERS,
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch RSS feed: ${response.status}`);
    }

    return this.parseRssFeed(response.text, urlInfo);
  }

  /**
   * Parse RSS XML into structured feed data
   */
  private parseRssFeed(xmlText: string, urlInfo: WebtoonsUrlInfo): WebtoonsRssFeed {
    const getTagContent = (text: string, tag: string): string | null => {
      const match = text.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([^\\]]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
      return match ? (match[1] || match[2] || '').trim() : null;
    };

    const title = getTagContent(xmlText, 'title') ?? 'Unknown Series';
    const description = getTagContent(xmlText, 'description') ?? '';
    const link = getTagContent(xmlText, 'link') ?? this.buildSeriesUrl(urlInfo);

    // Extract thumbnail from channel image
    const imageMatch = xmlText.match(/<image>[\s\S]*?<url>([^<]+)<\/url>[\s\S]*?<\/image>/i);
    const thumbnailUrl = imageMatch?.[1]?.trim() ?? '';

    // Extract items
    const items: WebtoonsEpisode[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let itemMatch;

    while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
      const itemContent = itemMatch[1] ?? '';
      const itemTitle = getTagContent(itemContent, 'title') ?? '';
      const itemLink = getTagContent(itemContent, 'link') ?? '';
      const pubDateStr = getTagContent(itemContent, 'pubDate') ?? '';
      const author = getTagContent(itemContent, 'dc:creator') ?? getTagContent(itemContent, 'author') ?? '';
      const itemDescription = getTagContent(itemContent, 'description') ?? '';

      // Extract episode number from URL
      const episodeNoMatch = itemLink.match(/episode_no=(\d+)/);
      const episodeNo = episodeNoMatch?.[1] ? parseInt(episodeNoMatch[1], 10) : 0;

      // Extract thumbnail from description or enclosure
      const thumbnails: string[] = [];
      const enclosureMatch = itemContent.match(/<enclosure[^>]+url="([^"]+)"/i);
      if (enclosureMatch?.[1]) {
        thumbnails.push(enclosureMatch[1]);
      }

      if (episodeNo > 0) {
        items.push({
          episodeNo,
          title: itemTitle,
          url: itemLink,
          thumbnailUrls: thumbnails,
          pubDate: new Date(pubDateStr),
          author,
          description: itemDescription.replace(/<[^>]+>/g, '').trim(),
        });
      }
    }

    // Sort by episode number (newest first)
    items.sort((a, b) => b.episodeNo - a.episodeNo);

    return {
      title,
      description,
      link,
      thumbnailUrl,
      items,
    };
  }

  /**
   * Fetch series info by parsing the series list page
   */
  async fetchSeriesInfo(urlInfo: WebtoonsUrlInfo): Promise<WebtoonsSeriesInfo> {
    const seriesUrl = this.buildSeriesUrl(urlInfo);
    console.debug('[WebtoonsLocal] Fetching series info:', seriesUrl);

    const response = await requestUrl({
      url: seriesUrl,
      headers: COMMON_HEADERS,
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch series page: ${response.status}`);
    }

    return this.parseSeriesPage(response.text, urlInfo);
  }

  /**
   * Sanitize text by removing UI artifacts and HTML remnants
   */
  private sanitizeText(text: string): string {
    return text
      // Remove common UI element text (various patterns for "layer close" and similar)
      .replace(/layer\s*close/gi, '')
      .replace(/\blayer\b\s*\bclose\b/gi, '')
      .replace(/\[layer\s*close\]\s*\(#\)/gi, '')
      .replace(/close\s*button/gi, '')
      .replace(/\bauthor\s*info\b/gi, '')
      .replace(/\bcreated\s*by\b/gi, '')
      // Remove HTML entities and tags
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/&#\d+;/g, ' ')
      // Clean up whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Parse series list page HTML for metadata
   */
  private parseSeriesPage(html: string, urlInfo: WebtoonsUrlInfo): WebtoonsSeriesInfo {
    // Extract title - handles both Originals (h1) and Canvas (h3 with _challengeTitle)
    // Canvas titles may have text on a separate line
    let title = 'Unknown';
    const h1Match = html.match(/<h1[^>]*class="[^"]*subj[^"]*"[^>]*>([^<]+)</i);
    if (h1Match?.[1]) {
      title = this.sanitizeText(h1Match[1]);
    } else {
      // Try Canvas pattern: <h3 class="subj _challengeTitle">\n  Title\n</h3>
      const h3Match = html.match(/<h3[^>]*class="[^"]*_challengeTitle[^"]*"[^>]*>\s*([^<]+?)\s*<\/h3>/i);
      if (h3Match?.[1]) {
        title = this.sanitizeText(h3Match[1].trim());
      }
    }

    // Extract description
    const descMatch = html.match(/<p[^>]*class="[^"]*summary[^"]*"[^>]*>([^<]+)</i);
    const description = this.sanitizeText(descMatch?.[1] ?? '');

    // Extract thumbnail
    const thumbMatch = html.match(/<img[^>]*class="[^"]*_coverImage[^"]*"[^>]*src="([^"]+)"/i);
    const thumbnailUrl = thumbMatch?.[1] ?? '';

    // Extract update day (e.g., "EVERY SATURDAY")
    const updateDayMatch = html.match(/(?:UP\s*)?EVERY\s+(\w+DAY)/i);
    const updateDay = updateDayMatch?.[1]?.toUpperCase();

    // Check if completed
    const isCompleted = /\bcompleted?\b/i.test(html);

    // Extract author names from various HTML patterns
    // 1. Try <p class="author">AuthorName</p> pattern (most reliable)
    // 2. Or look in div.author_area for the author name
    // 3. Or extract from ly_creator section with "Created by" heading
    let authorNames: string | undefined;

    // Pattern 1: <p class="author">
    const pAuthorMatch = html.match(/<p[^>]*class="[^"]*\bauthor\b[^"]*"[^>]*>([^<]+)</gi);
    if (pAuthorMatch && pAuthorMatch.length > 0) {
      const names = pAuthorMatch
        .map(m => {
          const match = m.match(/>([^<]+)$/);
          return match?.[1] ? this.sanitizeText(match[1]) : '';
        })
        .filter(name => name.length > 0 && !name.toLowerCase().includes('close'));
      if (names.length > 0) {
        authorNames = names[0]; // Use the first valid author name
      }
    }

    // Pattern 2: div.author_area (fallback)
    if (!authorNames) {
      const authorAreaMatch = html.match(/<div[^>]*class="[^"]*author_area[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (authorAreaMatch?.[1]) {
        // Extract text content, removing buttons and other elements
        const areaText = authorAreaMatch[1]
          .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '') // Remove buttons
          .replace(/<[^>]+>/g, '') // Remove remaining tags
          .trim();
        const cleanName = this.sanitizeText(areaText);
        if (cleanName && !cleanName.toLowerCase().includes('info')) {
          authorNames = cleanName;
        }
      }
    }

    // Pattern 3: ly_creator section with h3.title
    if (!authorNames) {
      const creatorMatch = html.match(/<div[^>]*class="[^"]*ly_creator[^"]*"[^>]*>[\s\S]*?<h3[^>]*class="[^"]*title[^"]*"[^>]*>\s*([^<]+)\s*<\/h3>/i);
      if (creatorMatch?.[1]) {
        authorNames = this.sanitizeText(creatorMatch[1]);
      }
    }

    // Extract age rating
    const ageMatch = html.match(/data-rating="([^"]+)"/i);
    const ageRating = ageMatch?.[1];

    return {
      titleNo: urlInfo.titleNo,
      title,
      description,
      thumbnailUrl,
      language: urlInfo.language,
      genre: urlInfo.genre,
      updateDay,
      isCompleted,
      isCanvas: urlInfo.isCanvas,
      authorNames,
      ageRating,
      rssUrl: this.buildRssUrl(urlInfo),
    };
  }

  /**
   * Get new episodes since a given episode number
   */
  async getNewEpisodes(urlInfo: WebtoonsUrlInfo, sinceEpisodeNo: number): Promise<WebtoonsEpisode[]> {
    const feed = await this.fetchRssFeed(urlInfo);
    return feed.items.filter(ep => ep.episodeNo > sinceEpisodeNo);
  }

  /**
   * Get the latest episode number for a series
   */
  async getLatestEpisodeNo(urlInfo: WebtoonsUrlInfo): Promise<number> {
    const feed = await this.fetchRssFeed(urlInfo);
    if (feed.items.length === 0) {
      return 0;
    }
    return Math.max(...feed.items.map(ep => ep.episodeNo));
  }

  /**
   * Get supported languages for UI dropdown
   */
  getSupportedLanguages(): Array<{ code: string; label: string }> {
    return WEBTOONS_LANGUAGES;
  }

  /**
   * Resolve a language-specific WEBTOON series URL by searching in the target locale.
   * This is needed because title_no differs between locales (e.g., EN vs FR).
   */
  async findLocalizedSeries(
    current: WebtoonsUrlInfo,
    targetLanguage: string,
    expectedTitle?: string,
  ): Promise<WebtoonsUrlInfo | null> {
    const query = expectedTitle?.trim() || current.seriesSlug.replace(/-/g, ' ');
    const searchUrl = `${API_BASE}/${targetLanguage}/search?keyword=${encodeURIComponent(query)}`;

    const response = await requestUrl({
      url: searchUrl,
      headers: COMMON_HEADERS,
    });

    if (response.status !== 200) {
      throw new Error(`Failed to search WEBTOON ${targetLanguage} catalog: ${response.status}`);
    }

    const html = response.text;
    const candidates: Array<{ genre: string; slug: string; titleNo: string; title?: string }> = [];

    // Primary pattern: list link + title text inside search result card
    const cardRegex = new RegExp(
      `<a\\s+href="https?://www\\.webtoons\\.com/${targetLanguage}/([^/]+)/([^/]+)/list\\?title_no=(\\d+)"[^>]*>[\\s\\S]*?<p[^>]*class="[^"]*subj[^"]*"[^>]*>([^<]+)<\\/p>`,
      'gi',
    );

    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const [, genre, slug, titleNo, title] = match;
      if (genre && slug && titleNo) {
        candidates.push({ genre, slug, titleNo, title: title ? this.sanitizeText(title) : undefined });
      }
    }

    // Fallback: any list links in the search page
    if (candidates.length === 0) {
      const linkRegex = new RegExp(
        `https?://www\\.webtoons\\.com/${targetLanguage}/([^/]+)/([^/]+)/list\\?title_no=(\\d+)`,
        'gi',
      );

      let linkMatch;
      while ((linkMatch = linkRegex.exec(html)) !== null) {
        const [, genre, slug, titleNo] = linkMatch;
        if (genre && slug && titleNo) {
          candidates.push({ genre, slug, titleNo });
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    const normalizedSlug = current.seriesSlug.toLowerCase();
    const normalizedSlugSpaced = normalizedSlug.replace(/-/g, ' ');
    const normalizedTitle = expectedTitle?.toLowerCase().replace(/\s+/g, ' ').trim();

    // Choose best candidate by slug/title/genre similarity
    const scored = candidates
      .map(candidate => {
        let score = 0;
        const candidateSlug = candidate.slug.toLowerCase();
        const candidateTitle = candidate.title?.toLowerCase().replace(/\s+/g, ' ').trim();
        const slugMatches = candidateSlug === normalizedSlug;
        const slugRelaxed = candidateSlug.replace(/-/g, ' ') === normalizedSlugSpaced;

        if (slugMatches) score += 3;
        if (slugRelaxed) score += 1;
        if (candidate.genre.toLowerCase() === current.genre.toLowerCase()) score += 1;
        if (normalizedTitle && candidateTitle) {
          if (candidateTitle === normalizedTitle) {
            score += 2;
          } else if (candidateTitle.includes(normalizedTitle) || normalizedTitle.includes(candidateTitle)) {
            score += 1;
          }
        }

        return { ...candidate, score, slugMatches, slugRelaxed, candidateTitle };
      })
      .sort((a, b) => b.score - a.score);

    // Require a solid match to avoid wrong series: exact slug or strong title match
    const best = scored.find(c => c.slugMatches || (normalizedTitle && c.candidateTitle === normalizedTitle));
    if (!best) return null;

    return {
      platform: 'webtoons',
      language: targetLanguage,
      genre: best.genre,
      seriesSlug: best.slug,
      titleNo: best.titleNo,
      urlType: 'series',
      isCanvas: best.genre === 'canvas' || best.genre === 'challenge',
    };
  }

  // ============================================================================
  // Episode List Page Fetching (for full episode list, not just RSS)
  // ============================================================================

  /**
   * Fetch episode list from HTML page (supports pagination)
   * @param urlInfo - URL info object
   * @param page - Page number (1-based)
   */
  async fetchEpisodeList(urlInfo: WebtoonsUrlInfo, page: number = 1): Promise<WebtoonsEpisodeListResponse> {
    const baseUrl = this.buildSeriesUrl(urlInfo);
    const pageUrl = page > 1 ? `${baseUrl}&page=${page}` : baseUrl;

    console.debug('[WebtoonsLocal] Fetching episode list page:', pageUrl);

    const response = await requestUrl({
      url: pageUrl,
      headers: COMMON_HEADERS,
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch episode list: ${response.status}`);
    }

    return this.parseEpisodeListPage(response.text, urlInfo, page);
  }

  /**
   * Parse episode list HTML page
   */
  private parseEpisodeListPage(html: string, urlInfo: WebtoonsUrlInfo, currentPage: number): WebtoonsEpisodeListResponse {
    const episodes: WebtoonsEpisode[] = [];

    // Extract total page count - WEBTOON pagination only shows 10 pages at a time
    // So we need to estimate from the highest episode number on page 1
    let maxPage = 1;
    let highestEpisodeNo = 0;

    // First, find the highest episode number from data-episode-no attributes
    const episodeNoMatches = html.matchAll(/data-episode-no="(\d+)"/g);
    for (const match of episodeNoMatches) {
      const epNo = parseInt(match[1] ?? '0', 10);
      if (epNo > highestEpisodeNo) highestEpisodeNo = epNo;
    }

    // Calculate total pages from highest episode number (10 episodes per page)
    if (highestEpisodeNo > 0 && currentPage === 1) {
      // If on page 1 and we have episode 315, there are ~32 pages
      maxPage = Math.ceil(highestEpisodeNo / 10);
    } else {
      // Fallback: use pagination links
      const pageMatches = html.matchAll(/[?&]page=(\d+)/g);
      for (const match of pageMatches) {
        const pageStr = match[1];
        if (pageStr) {
          const pageNum = parseInt(pageStr, 10);
          if (pageNum > maxPage) maxPage = pageNum;
        }
      }
    }

    // Extract episodes from list
    // Pattern: Each episode is a link with episode info
    // <a href="...viewer?title_no=XXX&episode_no=YY">
    //   <img src="thumbnail">
    //   Episode title
    //   Date
    //   like count
    // </a>
    let match;
    const seenEpisodes = new Set<number>();

    // Extract episodes from _episodeItem elements only (excludes "First episode" link)
    // Pattern: <li class="_episodeItem" ... data-episode-no="N"> ... </li>
    const episodeItemRegex = /<li[^>]*class="[^"]*_episodeItem[^"]*"[^>]*data-episode-no="(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;

    while ((match = episodeItemRegex.exec(html)) !== null) {
      const episodeNo = parseInt(match[1] ?? '0', 10);
      const itemHtml = match[2] ?? '';

      if (episodeNo === 0 || seenEpisodes.has(episodeNo)) continue;
      seenEpisodes.add(episodeNo);

      // Extract URL from the link inside this item
      const urlMatch = itemHtml.match(/href="([^"]*episode_no=\d+[^"]*)"/i);
      const url = urlMatch?.[1] ?? `${API_BASE}/${urlInfo.language}/${urlInfo.genre}/${urlInfo.seriesSlug}/episode-${episodeNo}/viewer?title_no=${urlInfo.titleNo}&episode_no=${episodeNo}`;

      // Extract thumbnail
      const thumbMatch = itemHtml.match(/<img[^>]*src="([^"]+)"/i);
      const thumbnailUrl = thumbMatch?.[1] ?? '';

      // Extract title from <span class="subj">
      const titleMatch = itemHtml.match(/<span[^>]*class="[^"]*subj[^"]*"[^>]*>(?:<span>)?([^<]+)/i);
      const title = titleMatch?.[1]?.trim() ?? `Episode ${episodeNo}`;

      // Extract date
      const dateMatch = itemHtml.match(/<span[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)/i);
      const dateStr = dateMatch?.[1]?.trim() ?? '';

      episodes.push({
        episodeNo,
        title,
        url,
        thumbnailUrls: thumbnailUrl ? [thumbnailUrl] : [],
        pubDate: dateStr ? new Date(dateStr) : new Date(),
        author: '',
        description: '',
      });
    }

    // Sort by episode number (newest first)
    episodes.sort((a, b) => b.episodeNo - a.episodeNo);

    // Use highest episode number for total count when available (more accurate)
    // Otherwise estimate from page count (10 episodes per page)
    const totalCount = highestEpisodeNo > 0 ? highestEpisodeNo : maxPage * 10;

    return {
      totalCount,
      currentPage,
      totalPages: maxPage,
      episodes,
    };
  }

  /**
   * Fetch all episodes across all pages
   * Note: WEBTOON pagination only shows 10 page links at a time (e.g., 1-10, then 11-20).
   * We must continue fetching until we get an empty page to get all episodes.
   * @param urlInfo - URL info object
   */
  async fetchAllEpisodes(urlInfo: WebtoonsUrlInfo): Promise<WebtoonsEpisode[]> {
    console.debug('[WebtoonsLocal] Fetching all episodes for:', urlInfo.titleNo);

    const allEpisodes: WebtoonsEpisode[] = [];
    const seenEpisodes = new Set<number>();
    let currentPage = 1;
    const BATCH_SIZE = 3;
    const MAX_PAGES = 100; // Safety limit to prevent infinite loops

    // Fetch pages until we get an empty page or hit the safety limit
    while (currentPage <= MAX_PAGES) {
      // Fetch a batch of pages in parallel
      const pagePromises: Promise<WebtoonsEpisodeListResponse>[] = [];
      const batchEndPage = Math.min(currentPage + BATCH_SIZE - 1, MAX_PAGES);

      for (let page = currentPage; page <= batchEndPage; page++) {
        pagePromises.push(this.fetchEpisodeList(urlInfo, page));
      }

      const pageResults = await Promise.all(pagePromises);

      // Check if we got any new episodes
      let foundNewEpisodes = false;
      for (const result of pageResults) {
        for (const ep of result.episodes) {
          if (!seenEpisodes.has(ep.episodeNo)) {
            seenEpisodes.add(ep.episodeNo);
            allEpisodes.push(ep);
            foundNewEpisodes = true;
          }
        }
      }

      // If no new episodes were found in this batch, we've reached the end
      if (!foundNewEpisodes) {
        break;
      }

      currentPage = batchEndPage + 1;
    }

    // Sort by episode number (newest first)
    allEpisodes.sort((a, b) => b.episodeNo - a.episodeNo);

    console.debug('[WebtoonsLocal] Fetched total episodes:', allEpisodes.length);
    return allEpisodes;
  }

  // ============================================================================
  // Episode Detail Fetching (for download/streaming)
  // ============================================================================

  /**
   * Fetch episode detail including image URLs for download/streaming
   * @param urlInfo - URL info object
   * @param episodeNo - Episode number to fetch
   */
  async fetchEpisodeDetail(
    urlInfo: WebtoonsUrlInfo,
    episodeNo: number
  ): Promise<WebtoonsEpisodeDetail> {
    const viewerUrl = this.buildEpisodeUrl(urlInfo, episodeNo);
    console.debug('[WebtoonsLocal] Fetching episode detail:', viewerUrl);

    const response = await requestUrl({
      url: viewerUrl,
      headers: COMMON_HEADERS,
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch episode detail: ${response.status}`);
    }

    const html = response.text;

    // Check for age verification redirect
    if (html.includes('age-gate') || html.includes('age-verification') || html.includes('mature content')) {
      throw new Error('This episode contains mature content. Age verification required.');
    }

    // Check for Daily Pass requirement
    if (html.includes('daily pass') || html.includes('unlock this episode') || html.includes('Wait or Buy')) {
      throw new Error('This episode requires Daily Pass. Only free episodes can be archived.');
    }

    return this.parseEpisodeDetailPage(html, urlInfo, episodeNo);
  }

  /**
   * Parse episode viewer HTML to extract image URLs and metadata
   */
  private parseEpisodeDetailPage(
    html: string,
    urlInfo: WebtoonsUrlInfo,
    episodeNo: number
  ): WebtoonsEpisodeDetail {
    const imageUrls: string[] = [];

    // Pattern 1: data-url attribute on img tags (most common for WEBTOON Global)
    // <img data-url="https://webtoon-phinf.pstatic.net/..." class="_images">
    const dataUrlMatches = html.matchAll(/data-url="(https:\/\/[^"]+(?:webtoon|swebtoon)-phinf\.pstatic\.net[^"]+)"/gi);
    for (const match of dataUrlMatches) {
      if (match[1] && !imageUrls.includes(match[1])) {
        imageUrls.push(match[1]);
      }
    }

    // Pattern 2: img with class _images (alternative)
    if (imageUrls.length === 0) {
      const imgClassMatches = html.matchAll(/<img[^>]*class="[^"]*_images[^"]*"[^>]*(?:data-url|src)="([^"]+)"/gi);
      for (const match of imgClassMatches) {
        if (match[1] && !imageUrls.includes(match[1])) {
          imageUrls.push(match[1]);
        }
      }
    }

    // Pattern 3: src attribute with webtoon CDN domain (fallback)
    if (imageUrls.length === 0) {
      const srcMatches = html.matchAll(/src="(https:\/\/(?:webtoon|swebtoon)-phinf\.pstatic\.net[^"]+)"/gi);
      for (const match of srcMatches) {
        // Filter out thumbnails and icons (usually contain 'thumb' or small dimensions)
        if (match[1] && !match[1].includes('thumb') && !imageUrls.includes(match[1])) {
          imageUrls.push(match[1]);
        }
      }
    }

    // Pattern 4: viewer_img container (some series use this structure)
    if (imageUrls.length === 0) {
      const viewerImgMatch = html.match(/<div[^>]*class="[^"]*viewer_img[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (viewerImgMatch?.[1]) {
        const containerHtml = viewerImgMatch[1];
        const containerMatches = containerHtml.matchAll(/(?:data-url|src)="(https:\/\/[^"]+pstatic\.net[^"]+)"/gi);
        for (const match of containerMatches) {
          if (match[1] && !imageUrls.includes(match[1])) {
            imageUrls.push(match[1]);
          }
        }
      }
    }

    // Extract title from og:title or page title
    let title = `Episode ${episodeNo}`;
    const ogTitleMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    if (ogTitleMatch?.[1]) {
      title = this.sanitizeText(ogTitleMatch[1]);
    } else {
      const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleTagMatch?.[1]) {
        title = this.sanitizeText(titleTagMatch[1]);
      }
    }

    // Extract subtitle from episode header if present
    let subtitle: string | undefined;
    const subtitleMatch = html.match(/<h1[^>]*class="[^"]*subj_episode[^"]*"[^>]*>([^<]+)</i);
    if (subtitleMatch?.[1]) {
      subtitle = this.sanitizeText(subtitleMatch[1]);
    }

    // Extract thumbnail URL
    let thumbnailUrl: string | undefined;
    const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (ogImageMatch?.[1]) {
      thumbnailUrl = ogImageMatch[1];
    }

    // Extract like count
    let likeCount: number | undefined;
    const likeMatch = html.match(/(?:like|좋아요)[^<]*?(\d[\d,]*)/i);
    if (likeMatch?.[1]) {
      likeCount = parseInt(likeMatch[1].replace(/,/g, ''), 10);
    }

    // Extract author note if present
    let authorNote: string | undefined;
    const authorNoteMatch = html.match(/<div[^>]*class="[^"]*(?:creator_note|author_note|creatorNote)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (authorNoteMatch?.[1]) {
      authorNote = this.sanitizeText(authorNoteMatch[1].replace(/<[^>]+>/g, ''));
    }

    // Extract publication date from episode info
    let publishDate: Date | undefined;
    const dateMatch = html.match(/(\w{3}\s+\d{1,2},\s+\d{4})/i);
    if (dateMatch?.[1]) {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed.getTime())) {
        publishDate = parsed;
      }
    }

    console.debug(`[WebtoonsLocal] Parsed episode ${episodeNo}: ${imageUrls.length} images found`);

    return {
      titleNo: urlInfo.titleNo,
      episodeNo,
      title,
      subtitle,
      imageUrls,
      thumbnailUrl,
      publishDate,
      likeCount,
      authorNote,
      isPaid: false,
    };
  }

  /**
   * Fetch only image URLs for an episode (convenience method)
   * @param urlInfo - URL info object
   * @param episodeNo - Episode number
   */
  async fetchEpisodeImages(urlInfo: WebtoonsUrlInfo, episodeNo: number): Promise<string[]> {
    const detail = await this.fetchEpisodeDetail(urlInfo, episodeNo);
    return detail.imageUrls;
  }

  // ============================================================================
  // Best Comments API
  // ============================================================================

  /**
   * Fetch best comments for an episode
   * Combines pinned "tops" comments with highest-liked regular "posts"
   * @param titleNo - Series title number
   * @param episodeNo - Episode number
   * @param language - Language code (default: 'en')
   * @param limit - Maximum number of comments to fetch (default: 20)
   * @returns Object with comments array and total comment count
   */
  async fetchBestComments(
    titleNo: string,
    episodeNo: number,
    language: string = 'en',
    limit: number = 20,
    isCanvas: boolean = false
  ): Promise<{ comments: WebtoonsBestComment[]; totalCount: number }> {
    // Canvas uses 'c_' prefix, Originals use 'w_' prefix
    const pageIdPrefix = isCanvas ? 'c' : 'w';
    const pageId = `${pageIdPrefix}_${titleNo}_${episodeNo}`;
    // Request more posts to fill up to limit after combining with tops
    const apiUrl = `${API_BASE}/p/api/community/v1/page/${pageId}/posts/search?categoryId=&pinRepresentation=distinct&displayBlindCommentAsService=false&prevSize=0&nextSize=${limit}`;

    console.debug('[WebtoonsLocal] Fetching best comments:', apiUrl);

    try {
      const response = await requestUrl({
        url: apiUrl,
        headers: {
          ...COMMON_HEADERS,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'language': language.toUpperCase() === 'EN' ? 'ENGLISH' : language.toUpperCase(),
          'service-ticket-id': 'epicom',
          'platform': 'WEB_PC',
          'Referer': `${API_BASE}/${language}/`,
        },
      });

      if (response.status !== 200) {
        console.warn('[WebtoonsLocal] Failed to fetch comments:', response.status);
        return { comments: [], totalCount: 0 };
      }

      const data = response.json as Record<string, unknown>;
      if (data?.status !== 'success' || !data?.result) {
        return { comments: [], totalCount: 0 };
      }

      const result = data.result as Record<string, unknown>;

      // Get total comment count
      const totalCount = (typeof result.activeRootPostCount === 'number' ? result.activeRootPostCount : 0)
        || (typeof result.rootPostCount === 'number' ? result.rootPostCount : 0)
        || 0;

      // Parse pinned "tops" comments (usually 3 best comments)
      const topsRaw = Array.isArray(result.tops) ? result.tops : [];
      const topsComments: WebtoonsBestComment[] = (topsRaw as Record<string, unknown>[])
        .map((comment) => this.parseComment(comment))
        .filter((c): c is WebtoonsBestComment => c !== null);

      // Parse regular "posts" comments
      const postsRaw = Array.isArray(result.posts) ? result.posts : [];
      const postsComments: WebtoonsBestComment[] = (postsRaw as Record<string, unknown>[])
        .map((comment) => this.parseComment(comment))
        .filter((c): c is WebtoonsBestComment => c !== null);

      // Get IDs of tops to avoid duplicates
      const topsIds = new Set(topsComments.map(c => c.id));

      // Filter out duplicates from posts and sort by likes
      const uniquePosts = postsComments
        .filter(c => !topsIds.has(c.id))
        .sort((a, b) => b.likeCount - a.likeCount);

      // Combine: tops first, then fill remaining slots with highest-liked posts
      const remaining = limit - topsComments.length;
      const bestComments = [
        ...topsComments,
        ...uniquePosts.slice(0, remaining)
      ];

      console.debug(`[WebtoonsLocal] Fetched ${bestComments.length} comments (${topsComments.length} tops + ${Math.min(remaining, uniquePosts.length)} posts), total: ${totalCount}`);
      return { comments: bestComments, totalCount };
    } catch (error) {
      console.warn('[WebtoonsLocal] Error fetching comments:', error);
      return { comments: [], totalCount: 0 };
    }
  }

  /**
   * Parse a comment object from the API response
   */
  private parseComment(comment: Record<string, unknown>): WebtoonsBestComment | null {
    try {
      const reactionsArr = comment.reactions;
      const firstReaction = Array.isArray(reactionsArr) ? (reactionsArr[0] as Record<string, unknown> | undefined) : undefined;
      const emotions = Array.isArray(firstReaction?.emotions) ? (firstReaction.emotions as Record<string, unknown>[]) : [];
      const likeEmotion = emotions.find((e) => e.emotionId === 'like');
      const dislikeEmotion = emotions.find((e) => e.emotionId === 'dislike');

      const createdBy = comment.createdBy as Record<string, unknown> | undefined;

      return {
        id: typeof comment.id === 'string' ? comment.id : '',
        body: typeof comment.body === 'string' ? comment.body : '',
        authorName: typeof createdBy?.name === 'string' ? createdBy.name : 'Anonymous',
        authorId: typeof createdBy?.id === 'string' ? createdBy.id : '',
        likeCount: typeof likeEmotion?.count === 'number' ? likeEmotion.count : 0,
        dislikeCount: typeof dislikeEmotion?.count === 'number' ? dislikeEmotion.count : 0,
        replyCount: (typeof comment.activeChildPostCount === 'number' ? comment.activeChildPostCount : 0)
          || (typeof comment.childPostCount === 'number' ? comment.childPostCount : 0)
          || 0,
        createdAt: new Date(typeof comment.createdAt === 'string' || typeof comment.createdAt === 'number' ? comment.createdAt : Date.now()),
      };
    } catch {
      return null;
    }
  }
}
