/**
 * BrunchLocalService - Local Brunch Fetcher
 *
 * Fetches Brunch (brunch.co.kr) posts directly from the plugin using Obsidian's requestUrl.
 * This bypasses the Worker to reduce latency and BrightData credit usage.
 *
 * Brunch is a Kakao-owned blogging platform focused on quality writing.
 */

import { requestUrl } from 'obsidian';
import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type {
  BrunchPostData,
  BrunchAuthor,
  BrunchMedia,
  BrunchVideo,
  BrunchSeries,
  BrunchComment,
  BrunchRSSResult,
  BrunchRSSItem,
} from '@/types/brunch';
import type { Comment } from '@/types/post';

const BRUNCH_BASE_URL = 'https://brunch.co.kr';
const BRUNCH_API_URL = 'https://api.brunch.co.kr';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Kakao TV API endpoints
const KAKAO_KAMP_VOD_URL = (videoId: string) =>
  `https://kamp.kakao.com/vod/v1/src/${videoId}`;

// Kakao TV video ID pattern (from iframe src or data-app)
const KAKAO_VIDEO_ID_PATTERN = /cliplink\/([a-z0-9]+)@my/i;

/**
 * Author profile data from Brunch Profile API
 */
export interface BrunchAuthorProfile {
  username: string;
  authorName: string;
  authorTitle?: string;
  authorDescription?: string;
  profileImageUrl?: string;
  subscriberCount?: number;
}

/**
 * Options for RSS fetch
 */
export interface BrunchRSSFetchOptions {
  /** ETag from previous fetch (for caching) */
  etag?: string;
  /** Last-Modified from previous fetch */
  lastModified?: string;
  /** Only include posts after this date */
  publishedAfter?: Date;
  /** Maximum number of items to return */
  maxResults?: number;
}

/**
 * Options for fetching member posts (subscription polling)
 */
export interface BrunchFetchMemberPostsOptions {
  /** Cursor (last post ID) for pagination */
  cursor?: string;
  /** Maximum posts to fetch */
  limit?: number;
  /** Days to backfill on first run */
  backfillDays?: number;
}

/**
 * Result of fetchMemberPosts
 */
export interface BrunchMemberPostsResult {
  /** Fetched posts with full content */
  posts: BrunchPostData[];
  /** Next cursor (most recent post ID) */
  nextCursor: string | null;
  /** Whether there are more posts */
  hasMore: boolean;
}

/**
 * Error thrown by Brunch operations
 */
export class BrunchError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_URL' | 'FETCH_FAILED' | 'PARSE_ERROR' | 'NOT_FOUND' | 'RATE_LIMITED',
    public readonly url?: string,
    public readonly retryable: boolean = false,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'BrunchError';
  }
}

export class BrunchLocalService {
  /**
   * Check if a URL is a Brunch URL
   */
  static isBrunchUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase() === 'brunch.co.kr';
    } catch {
      return false;
    }
  }

  /**
   * Parse Brunch URL to extract username and postId
   */
  private parsePostUrl(url: string): { username: string; postId: string } | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Pattern: /@username/postId
      const match = pathname.match(/^\/@([A-Za-z0-9_-]+)\/(\d+)$/);
      if (match && match[1] && match[2]) {
        return {
          username: match[1],
          postId: match[2],
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse Brunch profile URL to extract username
   */
  private parseProfileUrl(url: string): { username: string } | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Pattern: /@username
      const match = pathname.match(/^\/@([A-Za-z0-9_-]+)\/?$/);
      if (match && match[1]) {
        return { username: match[1] };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch author profile from Brunch Profile API
   *
   * API endpoint: https://api.brunch.co.kr/v1/profile/@{profileId}
   * Returns complete profile data including avatar, bio, and subscriber count.
   *
   * @param username - The author's username (without @ prefix)
   * @returns Author profile data
   */
  async fetchAuthorProfile(username: string): Promise<BrunchAuthorProfile> {
    const cleanUsername = username.replace(/^@/, '');
    const apiUrl = `${BRUNCH_API_URL}/v1/profile/@${cleanUsername}`;

    try {
      const response = await requestUrl({
        url: apiUrl,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
        },
        throw: false,
      });

      if (response.status === 200) {
        const data = response.json as {
          code?: number;
          data?: {
            userName?: string;
            userImage?: string;
            profileImage?: string;
            followerCount?: number;
            profileCategoryList?: Array<{
              category: string;
              keywordList?: Array<{ keyword: string }>;
            }>;
            topCreator?: {
              displayName?: string;
            };
          };
        };

        if (data.code === 200 && data.data) {
          const profile = data.data;

          // Extract job/title from profileCategoryList
          let authorTitle: string | undefined;
          if (profile.profileCategoryList) {
            const jobCategory = profile.profileCategoryList.find(
              (cat) => cat.category === 'job'
            );
            if (jobCategory?.keywordList?.[0]?.keyword) {
              authorTitle = jobCategory.keywordList[0].keyword;
            }
          }

          // Extract creator description from topCreator (bio)
          const authorDescription = profile.topCreator?.displayName || undefined;

          // Build profile image URL
          let profileImageUrl = profile.userImage || profile.profileImage;
          if (profileImageUrl && !profileImageUrl.startsWith('http')) {
            profileImageUrl = 'https:' + profileImageUrl;
          }

          return {
            username: cleanUsername,
            authorName: profile.userName || cleanUsername,
            authorTitle,
            authorDescription,
            profileImageUrl,
            subscriberCount: profile.followerCount,
          };
        }
      }

      // Fallback to HTML parsing if API fails
      return this.fetchAuthorProfileFromHtml(cleanUsername);
    } catch (error) {
      console.warn('[BrunchLocalService] Profile API failed, falling back to HTML:', error);
      return this.fetchAuthorProfileFromHtml(cleanUsername);
    }
  }

  /**
   * Fallback: Fetch author profile from HTML page
   */
  private async fetchAuthorProfileFromHtml(username: string): Promise<BrunchAuthorProfile> {
    const profileUrl = `${BRUNCH_BASE_URL}/@${username}`;

    try {
      const response = await requestUrl({
        url: profileUrl,
        method: 'GET',
        headers: this.buildHeaders(),
        throw: false,
      });

      if (response.status !== 200) {
        return { username, authorName: username };
      }

      const $ = cheerio.load(response.text);

      // Author name: .tit_blogger or og:title
      let authorName: string = $('.tit_blogger').first().text().trim() || username;
      if (authorName === username) {
        const ogTitle = $('meta[property="og:title"]').attr('content') || '';
        if (ogTitle) {
          authorName = ogTitle
            .replace(/의\s*브런치스토리.*$/i, '')
            .replace(/\s*-\s*brunch.*$/i, '')
            .trim() || username;
        }
      }

      // Profile image
      let profileImageUrl: string | undefined;
      const avatarSelectors = [
        '.thumb_blogger img',
        '.info_user .thumb img',
        '.profile_img img',
      ];
      for (const selector of avatarSelectors) {
        const img = $(selector);
        if (img.length > 0) {
          let src = img.attr('src') || img.attr('data-src');
          if (src) {
            if (src.startsWith('//')) {
              src = 'https:' + src;
            }
            profileImageUrl = src;
            break;
          }
        }
      }

      // Author bio/description
      const authorDescription = $('.desc_blogger').first().text().trim() || undefined;

      // Author job/title
      const authorTitle = $('.job_blogger').first().text().trim() || undefined;

      return {
        username,
        authorName,
        authorTitle,
        authorDescription,
        profileImageUrl,
      };
    } catch (error) {
      console.warn('[BrunchLocalService] HTML profile fetch failed:', error);
      return { username, authorName: username };
    }
  }

  /**
   * Fetch a Brunch post
   *
   * This method:
   * 1. Fetches and parses the post HTML
   * 2. Calls the Profile API to get complete author info (avatar, bio, etc.)
   * 3. Merges the profile data into the author fields
   */
  async fetchPost(url: string): Promise<BrunchPostData> {
    const urlInfo = this.parsePostUrl(url);
    if (!urlInfo) {
      throw new BrunchError(`Invalid Brunch post URL: ${url}`, 'INVALID_URL', url);
    }

    const { username, postId } = urlInfo;

    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: this.buildHeaders(),
      });

      if (response.status === 404) {
        throw new BrunchError(`Post not found: ${url}`, 'NOT_FOUND', url, false, 404);
      }

      if (response.status === 429) {
        throw new BrunchError(`Rate limited by Brunch`, 'RATE_LIMITED', url, true, 429);
      }

      if (response.status !== 200) {
        throw new BrunchError(
          `Failed to fetch post: HTTP ${response.status}`,
          'FETCH_FAILED',
          url,
          response.status >= 500,
          response.status
        );
      }

      // Parse the post HTML
      const postData = this.parsePostHtml(response.text, url, username, postId);

      // Fetch complete author profile from API
      try {
        const profile = await this.fetchAuthorProfile(username);

        // Merge profile data into author
        // Use profile data as primary source, fall back to HTML-extracted data
        postData.author = {
          ...postData.author,
          name: profile.authorName || postData.author.name,
          avatar: profile.profileImageUrl || postData.author.avatar,
          bio: profile.authorDescription || postData.author.bio,
          job: profile.authorTitle || postData.author.job,
          subscriberCount: profile.subscriberCount || postData.author.subscriberCount,
        };
      } catch (profileError) {
        // Profile fetch failed, continue with HTML-extracted author data
        console.warn('[BrunchLocalService] Profile fetch failed, using HTML data:', profileError);
      }

      return postData;
    } catch (error) {
      if (error instanceof BrunchError) {
        throw error;
      }

      console.error('[BrunchLocalService] Fetch error:', error);
      throw new BrunchError(
        `Failed to fetch post: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'FETCH_FAILED',
        url,
        true
      );
    }
  }

  /**
   * Parse post HTML and extract data
   */
  private parsePostHtml(
    html: string,
    originalUrl: string,
    username: string,
    postId: string
  ): BrunchPostData {
    const $ = cheerio.load(html);

    // Extract title
    const title = this.extractTitle($);

    // Extract subtitle
    const subtitle = this.extractSubtitle($);

    // Extract date
    const timestamp = this.extractDate($);

    // Extract author info
    const author = this.extractAuthor($, username);

    // Extract content - convert HTML to Markdown
    // videoIds are collected for later API calls to get MP4 URLs
    const { text, media, videos } = this.extractContent($);

    // Extract tags
    const tags = this.extractTags($);

    // Extract series info
    const series = this.extractSeries($);

    // Extract engagement stats
    const { likes, commentCount, viewCount } = this.extractStats($);

    return {
      platform: 'brunch',
      id: postId,
      url: originalUrl,
      title,
      subtitle,
      author,
      text,
      contentHtml: html,
      timestamp,
      likes,
      commentCount,
      viewCount,
      media,
      tags,
      series,
      videos,
    };
  }

  /**
   * Extract title from HTML
   */
  private extractTitle($: CheerioAPI): string {
    const selectors = [
      'h1.cover_title',
      '.wrap_title h1',
      'meta[property="og:title"]',
      'meta[name="title"]',
      '.article_title',
      'h1',
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        let title: string;
        if (selector.startsWith('meta')) {
          title = element.attr('content')?.trim() || '';
        } else {
          title = element.text().trim();
        }

        if (title) {
          // Clean up Brunch suffix if present
          title = title.replace(/\s*-\s*brunch\s*$/i, '');
          return title;
        }
      }
    }

    return 'Untitled';
  }

  /**
   * Extract subtitle from HTML
   */
  private extractSubtitle($: CheerioAPI): string | undefined {
    const selectors = [
      'h2.cover_sub_title',
      '.wrap_title h2',
      '.article_subtitle',
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const subtitle = element.text().trim();
        if (subtitle) {
          return subtitle;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract date from HTML
   */
  private extractDate($: CheerioAPI): Date {
    // Try meta tags first
    const metaSelectors = [
      'meta[property="article:published_time"]',
      'meta[property="article:modified_time"]',
    ];

    for (const selector of metaSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const content = element.attr('content');
        if (content) {
          const parsed = new Date(content);
          if (!isNaN(parsed.getTime())) {
            return parsed;
          }
        }
      }
    }

    // Try visible date elements
    const dateSelectors = [
      '.wrap_info .date',
      '.article_date',
      'time',
      '.date',
    ];

    for (const selector of dateSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const dateAttr = element.attr('datetime');
        if (dateAttr) {
          const parsed = new Date(dateAttr);
          if (!isNaN(parsed.getTime())) {
            return parsed;
          }
        }

        const dateText = element.text().trim();
        const parsed = this.parseKoreanDate(dateText);
        if (parsed) {
          return parsed;
        }
      }
    }

    return new Date();
  }

  /**
   * Parse Korean date format
   */
  private parseKoreanDate(dateText: string): Date | null {
    try {
      // Korean formats: 2024.01.01, 2024년 1월 1일, Jan 1, 2024
      const patterns = [
        /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
        /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
        /(\d{4})-(\d{1,2})-(\d{1,2})/,
      ];

      for (const pattern of patterns) {
        const match = dateText.match(pattern);
        if (match && match[1] && match[2] && match[3]) {
          const date = new Date(
            parseInt(match[1]),
            parseInt(match[2]) - 1,
            parseInt(match[3])
          );
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }

      // Try ISO format
      const isoDate = new Date(dateText);
      if (!isNaN(isoDate.getTime()) && isoDate.getFullYear() > 1900) {
        return isoDate;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract author info from HTML
   *
   * Priority:
   * 1. og:article:author meta tag (most reliable for author name)
   * 2. HTML selectors for other info (avatar, job)
   */
  private extractAuthor($: CheerioAPI, username: string): BrunchAuthor {
    const author: BrunchAuthor = {
      id: username,
      name: username,
      url: `${BRUNCH_BASE_URL}/@${username}`,
    };

    // Try to find author name from meta tag first (most reliable)
    // The actual meta tag is og:article:author, not article:author
    const ogAuthor = $('meta[property="og:article:author"]').attr('content')?.trim();
    if (ogAuthor) {
      author.name = ogAuthor;
    } else {
      // Fallback to HTML selectors
      const nameSelectors = [
        '.wrap_info .author_name',
        '.info_user .name',
        '.article_author .name',
        '.wrap_author .author_name',
        '.author_area .name',
      ];

      for (const selector of nameSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          const name = element.text().trim();
          if (name) {
            author.name = name;
            break;
          }
        }
      }
    }

    // Try to find avatar
    const avatarSelectors = [
      '.wrap_info .thumb_g img',
      '.info_user .thumb img',
      '.article_author img',
      '.wrap_author .thumb img',
      '.author_area .thumb img',
    ];

    for (const selector of avatarSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        let src = element.attr('src') || element.attr('data-src');
        if (src) {
          if (src.startsWith('//')) {
            src = 'https:' + src;
          }
          author.avatar = src;
          break;
        }
      }
    }

    // Try to extract userId (for RSS and Comments API)
    // Method 1: data-tiara-author_id attribute (most reliable, matches naver-blog-importer)
    const html = $.html();
    const tiaraMatch = html.match(/data-tiara-author_id="@@([^"]+)"/);
    if (tiaraMatch && tiaraMatch[1]) {
      author.userId = tiaraMatch[1];
    }

    // Method 2: Extract from RSS link (https://brunch.co.kr/rss/@@userId)
    if (!author.userId) {
      const rssLink = $('link[type="application/rss+xml"]').attr('href');
      if (rssLink) {
        const rssMatch = rssLink.match(/@@(\w+)/);
        if (rssMatch && rssMatch[1]) {
          author.userId = rssMatch[1];
        }
      }
    }

    // Method 3: user_id pattern in scripts (fallback)
    if (!author.userId) {
      const userIdMatch = html.match(/user_id\s*[:=]\s*["'](\w+)["']/i);
      if (userIdMatch && userIdMatch[1]) {
        author.userId = userIdMatch[1];
      }
    }

    // Try to find job/profession
    const jobSelectors = [
      '.wrap_info .job',
      '.info_user .job',
      '.article_author .job',
      '.wrap_author .job',
      '.author_area .job',
    ];

    for (const selector of jobSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const job = element.text().trim();
        if (job) {
          author.job = job;
          break;
        }
      }
    }

    return author;
  }

  /**
   * Extract content, media, and videos from HTML
   *
   * Uses Brunch's structured content format (wrap_item classes):
   * - item_type_text: Text paragraphs
   * - item_type_img: Single images
   * - item_type_gridGallery: Image galleries
   * - item_type_video: KakaoTV/YouTube videos (with data-app JSON)
   * - item_type_quotation: Blockquotes
   * - item_type_hr: Horizontal rules
   * - item_type_opengraph: Link previews
   */
  private extractContent($: CheerioAPI): {
    text: string;
    media: BrunchMedia[];
    videos: BrunchVideo[];
    videoIds: string[];
  } {
    const media: BrunchMedia[] = [];
    const videos: BrunchVideo[] = [];
    const videoIds: string[] = [];
    const lines: string[] = [];
    let currentParagraph: string[] = [];

    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        lines.push(currentParagraph.join('\n'));
        lines.push('');
        currentParagraph = [];
      }
    };

    // Find the main content container
    const $wrapBody = $('.wrap_body');
    if ($wrapBody.length === 0) {
      // Fallback to legacy extraction
      return this.extractContentLegacy($);
    }

    // Process each wrap_item
    $wrapBody.find('.wrap_item').each((_, item) => {
      const $item = $(item);
      const classList = (item).attribs?.class?.split(' ') || [];

      if (classList.includes('item_type_text')) {
        const tagName = (item).tagName?.toLowerCase();

        // Replace <br> tags with newlines before extracting text
        $item.find('br').replaceWith('\n');
        const text = $item.text();

        if (!text.trim()) {
          // Empty text item = paragraph break
          flushParagraph();
        } else if (tagName === 'h2') {
          flushParagraph();
          lines.push(`## ${text.trim()}`);
          lines.push('');
        } else if (tagName === 'h3') {
          flushParagraph();
          lines.push(`### ${text.trim()}`);
          lines.push('');
        } else {
          // Preserve line breaks from <br> tags
          const segments = text.split('\n');
          for (const segment of segments) {
            const trimmed = segment.trim();
            if (trimmed) {
              currentParagraph.push(trimmed);
            } else if (currentParagraph.length > 0) {
              flushParagraph();
            }
          }
        }
      } else if (classList.includes('item_type_img')) {
        flushParagraph();

        const img = $item.find('img');
        const caption = $item.find('.txt_caption, .img_caption').text().trim();

        if (img.length > 0) {
          let src = img.attr('data-src') || img.attr('src') || '';
          src = this.normalizeImageUrl(src);

          if (src && this.isContentImage(src)) {
            lines.push(`![${caption || ''}](${src})`);
            if (caption) {
              lines.push(`*${caption}*`);
            }
            lines.push('');

            media.push({
              type: 'photo',
              url: src,
              caption: caption || undefined,
            });
          }
        }
      } else if (classList.includes('item_type_gridGallery')) {
        flushParagraph();

        // Parse grid gallery images from data-app attribute
        const dataApp = $item.attr('data-app');
        if (dataApp) {
          try {
            const data = JSON.parse(dataApp) as { images?: Array<{ url?: string }> };
            if (data.images && Array.isArray(data.images)) {
              for (const image of data.images) {
                if (image.url) {
                  const src = this.normalizeImageUrl(image.url);
                  if (src) {
                    lines.push(`![](${src})`);
                    media.push({ type: 'photo', url: src });
                  }
                }
              }
              lines.push('');
            }
          } catch {
            // Fallback: extract from img tags
            $item.find('img').each((_, imgEl) => {
              let src = $(imgEl).attr('data-src') || $(imgEl).attr('src') || '';
              src = this.normalizeImageUrl(src);
              if (src && this.isContentImage(src)) {
                lines.push(`![](${src})`);
                media.push({ type: 'photo', url: src });
              }
            });
            lines.push('');
          }
        } else {
          // No data-app, extract from img tags
          $item.find('img').each((_, imgEl) => {
            let src = $(imgEl).attr('data-src') || $(imgEl).attr('src') || '';
            src = this.normalizeImageUrl(src);
            if (src && this.isContentImage(src)) {
              lines.push(`![](${src})`);
              media.push({ type: 'photo', url: src });
            }
          });
          lines.push('');
        }

        const caption = $item.find('.txt_caption, .img_caption').text().trim();
        if (caption) {
          lines.push(`*${caption}*`);
          lines.push('');
        }
      } else if (classList.includes('item_type_hr')) {
        flushParagraph();
        lines.push('---');
        lines.push('');
      } else if (classList.includes('item_type_quotation')) {
        flushParagraph();

        const quoteText = $item.text().trim();
        if (quoteText) {
          const quotedLines = quoteText.split('\n').map(line => `> ${line.trim()}`);
          lines.push(quotedLines.join('\n'));
          lines.push('');
        }
      } else if (classList.includes('item_type_video')) {
        flushParagraph();

        let videoUrl: string | undefined;
        let videoId: string | null = null;

        // Try to extract video URL from data-app attribute (primary method)
        const dataApp = $item.attr('data-app');
        if (dataApp) {
          try {
            const data = JSON.parse(dataApp) as { url?: string; id?: string };
            if (data.url) {
              videoUrl = data.url;
            }
            // Prefer direct id from data-app, fallback to extracting from URL
            if (data.id) {
              videoId = data.id;
            } else if (videoUrl) {
              videoId = this.extractKakaoVideoId(videoUrl);
            }
          } catch {
            // Ignore parse errors
          }
        }

        // Try to find iframe if no data-app
        if (!videoUrl) {
          const iframe = $item.find('iframe');
          const iframeSrc = iframe.attr('src');
          if (iframeSrc) {
            videoUrl = iframeSrc;
            videoId = this.extractKakaoVideoId(iframeSrc);
          }
        }

        // Check for YouTube
        if (videoUrl && (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be'))) {
          const ytId = this.extractYouTubeId(videoUrl);
          if (ytId) {
            videos.push({
              url: `https://www.youtube.com/watch?v=${ytId}`,
              type: 'youtube',
              videoId: ytId,
            });
            lines.push(`![YouTube](https://www.youtube.com/watch?v=${ytId})`);
            lines.push('');
          }
        } else {
          // KakaoTV video
          // Collect video ID for later API call
          if (videoId && !videoIds.includes(videoId)) {
            videoIds.push(videoId);
          }

          // Add placeholder with video ID for later replacement
          if (videoId) {
            lines.push(`<!--KAKAOTV:${videoId}-->`);
            videos.push({
              url: videoUrl || `https://play-tv.kakao.com/embed/player/cliplink/${videoId}@my`,
              type: 'kakaoTV',
              videoId,
            });
          } else if (videoUrl) {
            lines.push(`[Video](${videoUrl})`);
          }
          lines.push('');
        }
      } else if (classList.includes('item_type_opengraph')) {
        flushParagraph();

        // Parse opengraph data from data-app attribute (most reliable)
        const dataApp = $item.attr('data-app');
        if (dataApp) {
          try {
            const data = JSON.parse(dataApp) as {
              type?: string;
              title?: string;
              description?: string;
              link?: string;
              imageUrl?: string;
              displayLink?: string;
            };

            if (data.link) {
              const title = data.title?.trim() || 'Link';
              const description = data.description?.trim();

              // Render as a styled link preview block
              lines.push(`> **[${title}](${data.link})**`);
              if (description) {
                // Truncate long descriptions
                const truncatedDesc = description.length > 150
                  ? description.slice(0, 150) + '...'
                  : description;
                lines.push(`> ${truncatedDesc}`);
              }
              lines.push('');
            }
          } catch {
            // Fallback to basic link extraction
            const link = $item.find('a').first().attr('href');
            const title = $item.find('.title').first().text().trim() ||
                          $item.find('strong').first().text().trim() || 'Link';

            if (link) {
              lines.push(`[${title}](${link})`);
              lines.push('');
            }
          }
        } else {
          // No data-app, try to extract from HTML structure
          const link = $item.find('a').first().attr('href');
          const title = $item.find('.title').first().text().trim() ||
                        $item.find('strong').first().text().trim() || 'Link';
          const description = $item.find('.desc').first().text().trim();

          if (link) {
            lines.push(`> **[${title}](${link})**`);
            if (description) {
              const truncatedDesc = description.length > 150
                ? description.slice(0, 150) + '...'
                : description;
              lines.push(`> ${truncatedDesc}`);
            }
            lines.push('');
          }
        }
      }
    });

    // Flush any remaining paragraph
    flushParagraph();

    // Clean up excessive blank lines
    const markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    return {
      text: markdown,
      media,
      videos,
      videoIds,
    };
  }

  /**
   * Legacy content extraction for older Brunch pages without wrap_item structure
   */
  private extractContentLegacy($: CheerioAPI): {
    text: string;
    media: BrunchMedia[];
    videos: BrunchVideo[];
    videoIds: string[];
  } {
    let text = '';
    const media: BrunchMedia[] = [];
    const videos: BrunchVideo[] = [];
    const videoIds: string[] = [];

    // Find the main content container
    const contentSelectors = [
      '.article_content',
      '.wrap_article_body',
      '#content',
      'body',
    ];

    let $content: Cheerio<AnyNode> | null = null;
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        $content = element;
        break;
      }
    }

    if (!$content) {
      return { text: '', media: [], videos: [], videoIds: [] };
    }

    // Process paragraphs
    $content.find('p').each((_, p) => {
      const $p = $(p);
      const pText = $p.text().trim();

      const img = $p.find('img');
      if (img.length > 0) {
        let src = img.attr('data-src') || img.attr('src');
        if (src && this.isContentImage(src)) {
          src = this.normalizeImageUrl(src);
          const alt = img.attr('alt') || 'Image';
          text += `![${alt}](${src})\n\n`;
          media.push({
            type: 'photo',
            url: src,
            caption: img.attr('alt'),
          });
        }
      } else if (pText) {
        text += pText + '\n\n';
      }
    });

    // Process blockquotes
    $content.find('blockquote').each((_, quote) => {
      const $quote = $(quote);
      const quoteText = $quote.text().trim();
      if (quoteText) {
        text += `> ${quoteText.replace(/\n/g, '\n> ')}\n\n`;
      }
    });

    // Process headers
    $content.find('h2, h3, h4').each((_, heading) => {
      const $heading = $(heading);
      const level = parseInt(heading.tagName.replace('h', ''));
      const headingText = $heading.text().trim();
      if (headingText) {
        text += `${'#'.repeat(level)} ${headingText}\n\n`;
      }
    });

    // Process videos (KakaoTV, YouTube)
    $content.find('iframe, .video_wrap, .embed_video').each((_, video) => {
      const $video = $(video);
      const src = $video.attr('src') || $video.attr('data-src') || '';

      if (src.includes('youtube.com') || src.includes('youtu.be')) {
        const ytId = this.extractYouTubeId(src);
        if (ytId) {
          videos.push({
            url: `https://www.youtube.com/watch?v=${ytId}`,
            type: 'youtube',
            videoId: ytId,
          });
          text += `![YouTube](https://www.youtube.com/watch?v=${ytId})\n\n`;
        }
      } else if (src.includes('tv.kakao.com') || src.includes('kakaotv')) {
        const vId = this.extractKakaoVideoId(src);
        if (vId) {
          videoIds.push(vId);
          videos.push({
            url: src,
            type: 'kakaoTV',
            videoId: vId,
          });
          text += `<!--KAKAOTV:${vId}-->\n\n`;
        } else {
          videos.push({ url: src, type: 'kakaoTV' });
          text += `[KakaoTV Video](${src})\n\n`;
        }
      }
    });

    return {
      text: this.cleanContent(text),
      media,
      videos,
      videoIds,
    };
  }

  /**
   * Normalize image URL (handle protocol-relative URLs)
   */
  private normalizeImageUrl(url: string): string {
    if (!url) return '';

    // Handle protocol-relative URLs
    if (url.startsWith('//')) {
      return `https:${url}`;
    }

    return url;
  }

  /**
   * Extract Kakao TV video ID from embed URL
   */
  private extractKakaoVideoId(url: string): string | null {
    const match = url.match(KAKAO_VIDEO_ID_PATTERN);
    return match ? match[1] ?? null : null;
  }

  /**
   * Extract YouTube video ID from URL
   */
  private extractYouTubeId(url: string): string | null {
    const patterns = [
      /youtube\.com\/embed\/([^?&]+)/,
      /youtube\.com\/watch\?v=([^&]+)/,
      /youtu\.be\/([^?]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract tags/keywords from HTML
   *
   * Uses the keyword link selector which is the most reliable way
   * to extract tags from Brunch posts.
   */
  private extractTags($: CheerioAPI): string[] {
    const tags: string[] = [];

    // Primary selector: keyword links (most reliable)
    // This matches links like: <a href="/keyword/태그명">태그명</a>
    $('a[href*="/keyword/"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text && !tags.includes(text)) {
        tags.push(text);
      }
    });

    // If no keywords found, try fallback selectors
    if (tags.length === 0) {
      const fallbackSelectors = [
        '.wrap_tag .link_tag',
        '.keyword_area .keyword',
        '.article_tag a',
        'meta[property="article:tag"]',
      ];

      for (const selector of fallbackSelectors) {
        if (selector.startsWith('meta')) {
          $(selector).each((_, el) => {
            const tag = $(el).attr('content')?.trim();
            if (tag && !tags.includes(tag)) {
              tags.push(tag);
            }
          });
        } else {
          $(selector).each((_, el) => {
            let tag = $(el).text().trim();
            if (tag.startsWith('#')) {
              tag = tag.slice(1);
            }
            if (tag && !tags.includes(tag)) {
              tags.push(tag);
            }
          });
        }

        if (tags.length > 0) break;
      }
    }

    return tags;
  }

  /**
   * Extract series/book info from HTML
   *
   * Brunch series structure (from actual HTML):
   * <div class="wrap_cover_type">
   *   <span class="serial">연재 중</span>
   *   <a class="link_type" href="/brunchbook/prettyflower01">
   *     <span class="tit_type">강을 건너, 도시를 걷다</span>
   *     <span class="txt_episode">09화</span>
   *   </a>
   * </div>
   */
  private extractSeries($: CheerioAPI): BrunchSeries | undefined {
    // Primary method: Use the brunchbook link selector (most reliable)
    // This matches the approach used in naver-blog-importer
    const seriesLink = $('a[href*="/brunchbook/"]').first();

    if (seriesLink.length > 0) {
      const href = seriesLink.attr('href');

      // Extract title from .tit_type span inside the link
      let title = seriesLink.find('.tit_type').text().trim();

      // Extract episode from .txt_episode span (e.g., "09화" → 9)
      let episode: number | undefined;
      const episodeText = seriesLink.find('.txt_episode').text().trim();
      if (episodeText) {
        const episodeMatch = episodeText.match(/(\d+)\s*화/);
        if (episodeMatch && episodeMatch[1]) {
          episode = parseInt(episodeMatch[1]);
        }
      }

      // Fallback: if no .tit_type, use link text and extract episode from it
      if (!title) {
        const fullText = seriesLink.text().trim();
        // Try to extract episode from full text
        const episodeMatch = fullText.match(/(\d+)\s*화/);
        if (episodeMatch && episodeMatch[1]) {
          episode = parseInt(episodeMatch[1]);
          // Remove episode from title
          title = fullText.replace(/\d+\s*화\s*/, '').trim();
        } else {
          title = fullText;
        }
      }

      if (href || title) {
        const series: BrunchSeries = {
          title: title || 'Unknown Series',
          url: ''
        };

        if (href) {
          series.url = href.startsWith('/') ? BRUNCH_BASE_URL + href : href;

          // Extract series ID from URL (e.g., /brunchbook/prettyflower01 → prettyflower01)
          const bookIdMatch = href.match(/\/brunchbook\/([a-zA-Z0-9_-]+)/);
          if (bookIdMatch && bookIdMatch[1]) {
            series.id = `book-${bookIdMatch[1]}`;
          }
        }

        if (episode) {
          series.episode = episode;
        }

        return series;
      }
    }

    // Fallback: Try alternative selectors for older page structures
    const fallbackSelectors = [
      '.wrap_cover_type .link_type',
      '.wrap_info_magazine',
      '.link_magazine',
      '.book_info',
    ];

    for (const selector of fallbackSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        // Get title from .tit_type or direct text
        let title = element.find('.tit_type').text().trim();
        if (!title) {
          title = element.find('.name, .title').first().text().trim();
        }
        if (!title) {
          // Get first line of text only
          const fullText = element.text().trim();
          const firstLine = fullText.split('\n')[0]?.trim() || '';
          // Remove episode pattern from title
          title = firstLine.replace(/\d+\s*화\s*/, '').trim();
        }

        // Get episode from .txt_episode or text pattern
        let episode: number | undefined;
        const episodeText = element.find('.txt_episode').text().trim();
        if (episodeText) {
          const match = episodeText.match(/(\d+)\s*화/);
          if (match && match[1]) {
            episode = parseInt(match[1]);
          }
        }
        if (!episode) {
          const fullText = element.text();
          const match = fullText.match(/(\d+)\s*화/);
          if (match && match[1]) {
            episode = parseInt(match[1]);
          }
        }

        const url = element.attr('href') || element.find('a').first().attr('href');

        if (title || url) {
          const series: BrunchSeries = {
            title: title || 'Unknown Series',
            url: ''
          };

          if (url) {
            series.url = url.startsWith('/') ? BRUNCH_BASE_URL + url : url;

            // Extract series ID from URL
            const bookIdMatch = url.match(/\/brunchbook\/([a-zA-Z0-9_-]+)/);
            if (bookIdMatch && bookIdMatch[1]) {
              series.id = `book-${bookIdMatch[1]}`;
            }
          }

          if (episode) {
            series.episode = episode;
          }

          return series;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract engagement stats from HTML
   *
   * Brunch engagement structure (from actual HTML):
   * <button class="wrap_icon">
   *   <span class="ico_view_cover ico_likeit_like">라이킷</span>
   *   <span class="text_cnt">217</span>
   * </button>
   */
  private extractStats($: CheerioAPI): {
    likes: number;
    commentCount: number;
    viewCount: number;
  } {
    let likes = 0;
    let commentCount = 0;
    const viewCount = 0;

    // Method 1: Find buttons with engagement data (matches naver-blog-importer approach)
    // Look for "라이킷 N" or "N 라이킷" patterns in button text
    $('button').each((_, el) => {
      const text = $(el).text();

      // Match "라이킷" with number - either before or after
      // Pattern 1: "라이킷 N" (라이킷 followed by number)
      // Pattern 2: "N 라이킷" (number followed by 라이킷)
      const likeMatch = text.match(/라이킷[\s\n]*(\d+)/) || text.match(/(\d+)[\s\n]*라이킷/);
      if (likeMatch && likeMatch[1]) {
        likes = parseInt(likeMatch[1]);
      }

      // Match "댓글" with number - either before or after
      const commentMatch = text.match(/댓글[\s\n]*(\d+)/) || text.match(/(\d+)[\s\n]*댓글/);
      if (commentMatch && commentMatch[1]) {
        commentCount = parseInt(commentMatch[1]);
      }
    });

    // Method 2: If method 1 didn't work, try finding .text_cnt near icons
    if (likes === 0) {
      // Find the like button container and get the count
      const likeButton = $('.ico_likeit_like, .ico_like').closest('button, .wrap_icon');
      if (likeButton.length > 0) {
        const countEl = likeButton.find('.text_cnt, .num, .count');
        if (countEl.length > 0) {
          const text = countEl.text().trim().replace(/,/g, '');
          const num = parseInt(text);
          if (!isNaN(num)) {
            likes = num;
          }
        }
      }
    }

    // Method 2 for comments: Find .text_cnt near comment icon
    if (commentCount === 0) {
      const commentButton = $('.ico_comment, .ico_reply, .ico_likeit_comment').closest('button, .wrap_icon');
      if (commentButton.length > 0) {
        const countEl = commentButton.find('.text_cnt, .num, .count');
        if (countEl.length > 0) {
          const text = countEl.text().trim().replace(/,/g, '');
          const num = parseInt(text);
          if (!isNaN(num)) {
            commentCount = num;
          }
        }
      }
    }

    // Method 3: Try direct selectors as fallback
    if (likes === 0) {
      const likeSelectors = [
        '.num_like',  // Direct like count span
        '.wrap_recommend .num',
        '.like_cnt .num',
        '.article_like .count',
        '.wrap_btn_recommend .text_cnt',
        '.btn_like .num_like',
      ];

      for (const selector of likeSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          const text = element.text().trim().replace(/,/g, '');
          const num = parseInt(text);
          if (!isNaN(num) && num > 0) {
            likes = num;
            break;
          }
        }
      }
    }

    // Comments fallback (Method 3)
    if (commentCount === 0) {
      const commentSelectors = [
        '.num_comment',  // Direct comment count span
        '.wrap_comment .num',
        '.comment_cnt .num',
        '.article_comment .count',
        '.wrap_btn_comment .text_cnt',
        '.btn_comment .num_comment',
      ];

      for (const selector of commentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          const text = element.text().trim().replace(/,/g, '');
          const num = parseInt(text);
          if (!isNaN(num) && num > 0) {
            commentCount = num;
            break;
          }
        }
      }
    }
    return { likes, commentCount, viewCount };
  }

  /**
   * Check if URL is a content image (not UI element)
   */
  private isContentImage(src: string): boolean {
    const skipPatterns = [
      /icon/i, /logo/i, /button/i,
      /emoticon/i, /sticker/i, /1x1/,
      /spacer/i, /loading/i, /spinner/i,
      /blank/i, /transparent/i,
    ];

    for (const pattern of skipPatterns) {
      if (pattern.test(src)) return false;
    }

    return src.startsWith('http') || src.startsWith('//');
  }

  /**
   * Clean up content
   */
  private cleanContent(content: string): string {
    return content
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '')
      .trim();
  }

  /**
   * Build headers for requests
   *
   * CRITICAL: The 'Cookie: b_s_a_l=1' header is required to skip Brunch's
   * auto-login redirect. Without it, requests result in ERR_TOO_MANY_REDIRECTS.
   */
  private buildHeaders(): Record<string, string> {
    return {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': USER_AGENT,
      'Referer': 'https://brunch.co.kr/',
      'Cookie': 'b_s_a_l=1',  // Skip auto-login redirect - REQUIRED
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
    };
  }

  // ==========================================================================
  // RSS Feed Methods (for Subscription Support)
  // ==========================================================================

  /**
   * Fetch RSS feed from Brunch
   *
   * Note: Brunch RSS uses internal userId (e.g., 'eHom'), not public username.
   * You need to discover userId from a post page or profile page first.
   *
   * @param userId - Internal user ID (from post/profile page)
   * @param options - Caching and filtering options
   * @returns RSS result with items
   */
  async fetchRSS(
    userId: string,
    options: BrunchRSSFetchOptions = {}
  ): Promise<BrunchRSSResult> {
    if (!userId) {
      throw new BrunchError('userId is required for RSS', 'INVALID_URL');
    }

    const rssUrl = `${BRUNCH_BASE_URL}/rss/@@${userId}`;

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': USER_AGENT,
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://brunch.co.kr/',
        'Cookie': 'b_s_a_l=1',  // Skip auto-login redirect - REQUIRED
      };

      if (options.etag) {
        headers['If-None-Match'] = options.etag;
      }
      if (options.lastModified) {
        headers['If-Modified-Since'] = options.lastModified;
      }

      const response = await requestUrl({
        url: rssUrl,
        method: 'GET',
        headers,
        throw: false,
      });

      // Handle 304 Not Modified
      if (response.status === 304) {
        return {
          author: { id: userId, name: userId, url: '' },
          posts: [],
          etag: options.etag,
          lastModified: options.lastModified,
        };
      }

      if (response.status === 404) {
        throw new BrunchError(`RSS feed not found for user: ${userId}`, 'NOT_FOUND', rssUrl, false, 404);
      }

      if (response.status >= 400) {
        throw new BrunchError(
          `RSS fetch failed: HTTP ${response.status}`,
          'FETCH_FAILED',
          rssUrl,
          response.status >= 500,
          response.status
        );
      }

      const etag = response.headers?.['etag'] || response.headers?.['ETag'];
      const lastModified = response.headers?.['last-modified'] || response.headers?.['Last-Modified'];

      const result = this.parseRssFeed(response.text, options);

      return {
        ...result,
        etag,
        lastModified,
      };
    } catch (error) {
      if (error instanceof BrunchError) {
        throw error;
      }

      throw new BrunchError(
        `RSS fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'FETCH_FAILED',
        rssUrl,
        true
      );
    }
  }

  /**
   * Parse RSS XML and extract items
   */
  private parseRssFeed(
    xml: string,
    options: BrunchRSSFetchOptions
  ): Omit<BrunchRSSResult, 'etag' | 'lastModified'> {
    const items: BrunchRSSItem[] = [];

    // Extract channel info
    const authorName = this.extractRssTagContent(xml, 'title') || 'Unknown';
    const authorUrl = this.extractRssTagContent(xml, 'link') || '';

    // Create author from channel
    const author: BrunchAuthor = {
      id: '',
      name: authorName,
      url: authorUrl,
    };

    // Extract username from channel link
    const usernameMatch = authorUrl.match(/\/@([A-Za-z0-9_-]+)/);
    if (usernameMatch && usernameMatch[1]) {
      author.id = usernameMatch[1];
    }

    // Extract items
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);

    for (const match of itemMatches) {
      const itemXml = match[1];
      if (!itemXml) continue;

      const link = this.extractRssTagContent(itemXml, 'link');
      if (!link) continue;

      const postIdMatch = link.match(/\/@[^/]+\/(\d+)/);
      if (!postIdMatch || !postIdMatch[1]) continue;

      const title = this.extractRssTagContent(itemXml, 'title') || 'Untitled';
      const pubDateStr = this.extractRssTagContent(itemXml, 'pubDate');
      const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();

      // Apply date filter
      if (options.publishedAfter && pubDate < options.publishedAfter) {
        continue;
      }

      // Extract description
      const description = this.extractRssTagContent(itemXml, 'description');

      // Extract categories
      const categories: string[] = [];
      const categoryMatches = itemXml.matchAll(/<category>([^<]+)<\/category>/gi);
      for (const catMatch of categoryMatches) {
        if (catMatch[1]) {
          categories.push(this.decodeHtmlEntities(catMatch[1].trim()));
        }
      }

      items.push({
        id: postIdMatch[1],
        title: this.decodeHtmlEntities(title),
        url: link,
        pubDate,
        description: description ? this.decodeHtmlEntities(description) : undefined,
        author: authorName,
        categories,
      });

      if (options.maxResults && items.length >= options.maxResults) {
        break;
      }
    }

    return { author, posts: items };
  }

  /**
   * Fetch member posts for subscription polling
   */
  async fetchMemberPosts(
    userId: string,
    username: string,
    options: BrunchFetchMemberPostsOptions = {}
  ): Promise<BrunchMemberPostsResult> {
    const limit = options.limit || 20;
    const backfillDays = options.backfillDays || 7;
    const cursor = options.cursor;

    // Step 1: Fetch RSS to get post list
    const rssResult = await this.fetchRSS(userId, {
      maxResults: limit * 2,
    });

    if (rssResult.posts.length === 0) {
      return {
        posts: [],
        nextCursor: cursor || null,
        hasMore: false,
      };
    }

    // Calculate cutoff date for backfill (first run only)
    const cutoffDate = cursor ? null : new Date();
    if (cutoffDate) {
      cutoffDate.setDate(cutoffDate.getDate() - backfillDays);
    }

    // Step 2: Filter and fetch full content for each post
    const posts: BrunchPostData[] = [];
    let hasMore = true;
    let stoppedByCursor = false;

    for (const item of rssResult.posts) {
      if (posts.length >= limit) {
        break;
      }

      if (cursor && item.id === cursor) {
        stoppedByCursor = true;
        hasMore = false;
        break;
      }

      if (cutoffDate && item.pubDate < cutoffDate) {
        hasMore = false;
        break;
      }

      try {
        const postUrl = `${BRUNCH_BASE_URL}/@${username}/${item.id}`;
        const postData = await this.fetchPost(postUrl);
        posts.push(postData);

        // Rate limit: 500ms delay between fetches
        if (posts.length < limit) {
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (error) {
        console.warn(`[BrunchLocalService] Failed to fetch post ${item.id}:`, error);
      }
    }

    const firstPost = posts[0];
    const nextCursor = firstPost ? firstPost.id : cursor || null;

    if (!stoppedByCursor && posts.length >= limit) {
      hasMore = rssResult.posts.length > posts.length;
    }

    return {
      posts,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Discover userId from username (profile page)
   *
   * Brunch RSS requires internal userId (e.g., 'eHom'), not public username.
   * This method fetches the profile page to discover the userId.
   */
  async discoverUserId(username: string): Promise<string | null> {
    try {
      const profileUrl = `${BRUNCH_BASE_URL}/@${username}`;
      const response = await requestUrl({
        url: profileUrl,
        method: 'GET',
        headers: this.buildHeaders(),
      });

      if (response.status !== 200) {
        return null;
      }

      // Look for userId in various places
      const html = response.text;

      // Pattern 1: JSON data
      const jsonMatch = html.match(/user_id\s*[:=]\s*["'](\w+)["']/i);
      if (jsonMatch && jsonMatch[1]) {
        return jsonMatch[1];
      }

      // Pattern 2: RSS link
      const rssMatch = html.match(/\/rss\/@@(\w+)/);
      if (rssMatch && rssMatch[1]) {
        return rssMatch[1];
      }

      // Pattern 3: API endpoint
      const apiMatch = html.match(/userId['":\s]+(\w+)/);
      if (apiMatch && apiMatch[1]) {
        return apiMatch[1];
      }

      return null;
    } catch (error) {
      console.error('[BrunchLocalService] Failed to discover userId:', error);
      return null;
    }
  }

  // ==========================================================================
  // Brunchbook (Series) Fetching
  // ==========================================================================

  /**
   * Fetch posts from a brunchbook (series)
   *
   * Brunchbooks are collections of posts organized as a series/magazine.
   * Uses the magazine API to get the article list.
   */
  async fetchBrunchBookPosts(
    bookId: string,
    options: BrunchFetchMemberPostsOptions = {}
  ): Promise<BrunchMemberPostsResult> {
    const limit = options.limit || 50;

    try {
      // Step 1: Fetch book page to get magazineId and authorProfileId
      const bookUrl = `${BRUNCH_BASE_URL}/brunchbook/${bookId}`;
      const response = await requestUrl({
        url: bookUrl,
        method: 'GET',
        headers: this.buildHeaders(),
      });

      if (response.status !== 200) {
        throw new BrunchError(
          `Failed to fetch brunchbook page: HTTP ${response.status}`,
          'FETCH_FAILED',
          bookUrl,
          response.status >= 500,
          response.status
        );
      }

      const html = response.text;

      // Extract magazineId from data-tiara-id attribute
      const magazineIdMatch = html.match(/data-tiara-id="(\d+)"/);
      const magazineId = magazineIdMatch?.[1];

      if (!magazineId) {
        throw new BrunchError(
          'Could not find magazineId in brunchbook page',
          'PARSE_ERROR',
          bookUrl
        );
      }

      // Extract profileId from data-tiara-category_id attribute
      let authorProfileId: string | null = null;
      const tiaraCategoryMatch = html.match(/data-tiara-category_id="@([^"]+)"/);
      if (tiaraCategoryMatch && tiaraCategoryMatch[1]) {
        authorProfileId = tiaraCategoryMatch[1];
      }

      // Fallback - look for /@profileId links in the page
      if (!authorProfileId) {
        const profileLinkMatch = html.match(/href="\/@([a-zA-Z0-9_]+)"/);
        if (profileLinkMatch && profileLinkMatch[1] && profileLinkMatch[1] !== 'brunch') {
          authorProfileId = profileLinkMatch[1];
        }
      }

      if (!authorProfileId) {
        throw new BrunchError(
          'Could not find author profileId in brunchbook page',
          'PARSE_ERROR',
          bookUrl
        );
      }

      // Step 2: Fetch article list from magazine API
      const apiUrl = `${BRUNCH_API_URL}/v1/magazine/${magazineId}/articles`;
      const apiResponse = await requestUrl({
        url: apiUrl,
        method: 'GET',
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Cookie': 'b_s_a_l=1',
        },
      });

      if (apiResponse.status !== 200) {
        throw new BrunchError(
          `Magazine API failed: HTTP ${apiResponse.status}`,
          'FETCH_FAILED',
          apiUrl,
          apiResponse.status >= 500,
          apiResponse.status
        );
      }

      const apiData = JSON.parse(apiResponse.text) as Record<string, unknown>;
      const apiDataData = apiData.data as Record<string, unknown> | undefined;

      if (apiData.code !== 200 || !Array.isArray(apiDataData?.list)) {
        throw new BrunchError(
          'Invalid magazine API response',
          'PARSE_ERROR',
          apiUrl
        );
      }

      // Extract book title from page
      const $ = cheerio.load(html);
      let bookTitle = $('meta[property="og:title"]').attr('content') || bookId;
      bookTitle = bookTitle.replace(/^\[.*?\]\s*/, '').trim();
      // bookUrl is already defined above

      // Step 3: Fetch each post's full content
      const articleList = apiDataData.list as Record<string, unknown>[];
      const posts: BrunchPostData[] = [];
      const totalEpisodes = articleList.length;

      for (let i = 0; i < Math.min(articleList.length, limit); i++) {
        const articleItem = articleList[i] as Record<string, unknown> | undefined;
        const article = articleItem?.article as Record<string, unknown> | undefined;
        if (!article || !article.no) continue;

        try {
          const postUrl = `${BRUNCH_BASE_URL}/@${authorProfileId}/${article.no as string | number}`;
          const postData = await this.fetchPost(postUrl);

          // Override series info with brunchbook context
          postData.series = {
            id: `book-${bookId}`,
            title: bookTitle,
            url: bookUrl,
            episode: i + 1, // 1-based episode number
            totalEpisodes,
          };

          posts.push(postData);

          // Rate limit: 500ms delay between fetches
          if (i < Math.min(articleList.length, limit) - 1) {
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (error) {
          console.warn(`[BrunchLocalService] Failed to fetch brunchbook post ${article.no as string | number}:`, error);
        }
      }

      return {
        posts,
        nextCursor: null, // Brunchbooks don't support cursor pagination
        hasMore: articleList.length > limit,
      };
    } catch (error) {
      if (error instanceof BrunchError) {
        throw error;
      }
      throw new BrunchError(
        `Failed to fetch brunchbook: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'FETCH_FAILED',
        `${BRUNCH_BASE_URL}/brunchbook/${bookId}`,
        true
      );
    }
  }

  /**
   * Get brunchbook info (title, author, post count)
   */
  async getBrunchBookInfo(bookId: string): Promise<{
    title: string;
    authorProfileId: string;
    authorName?: string;
    postCount: number;
  }> {
    const bookUrl = `${BRUNCH_BASE_URL}/brunchbook/${bookId}`;
    const response = await requestUrl({
      url: bookUrl,
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (response.status !== 200) {
      throw new BrunchError(
        `Failed to fetch brunchbook page: HTTP ${response.status}`,
        'FETCH_FAILED',
        bookUrl,
        response.status >= 500,
        response.status
      );
    }

    const html = response.text;
    const $ = cheerio.load(html);

    // Extract book title from og:title
    let bookTitle = $('meta[property="og:title"]').attr('content') || bookId;
    bookTitle = bookTitle.replace(/^\[.*?\]\s*/, '').trim();

    // Extract magazineId
    const magazineIdMatch = html.match(/data-tiara-id="(\d+)"/);
    const magazineId = magazineIdMatch?.[1];

    // Extract profileId
    let authorProfileId: string | null = null;
    const tiaraCategoryMatch = html.match(/data-tiara-category_id="@([^"]+)"/);
    if (tiaraCategoryMatch && tiaraCategoryMatch[1]) {
      authorProfileId = tiaraCategoryMatch[1];
    }

    if (!authorProfileId) {
      const profileLinkMatch = html.match(/href="\/@([a-zA-Z0-9_]+)"/);
      if (profileLinkMatch && profileLinkMatch[1] && profileLinkMatch[1] !== 'brunch') {
        authorProfileId = profileLinkMatch[1];
      }
    }

    if (!authorProfileId || !magazineId) {
      throw new BrunchError(
        'Could not extract brunchbook info',
        'PARSE_ERROR',
        bookUrl
      );
    }

    // Get post count from API
    const apiUrl = `${BRUNCH_API_URL}/v1/magazine/${magazineId}/articles`;
    const apiResponse = await requestUrl({
      url: apiUrl,
      method: 'GET',
      headers: {
        'Accept': '*/*',
        'User-Agent': 'Mozilla/5.0',
        'Cookie': 'b_s_a_l=1',
      },
    });

    let postCount = 0;
    if (apiResponse.status === 200) {
      const apiData = JSON.parse(apiResponse.text) as Record<string, unknown>;
      const apiDataData = apiData.data as Record<string, unknown> | undefined;
      const apiList = Array.isArray(apiDataData?.list) ? apiDataData.list : [];
      postCount = apiList.length;
    }

    return {
      title: bookTitle,
      authorProfileId,
      postCount,
    };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Extract content from XML tag (RSS parsing)
   */
  private extractRssTagContent(xml: string, tagName: string): string | null {
    // Handle CDATA
    const cdataPattern = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tagName}>`, 'i');
    const cdataMatch = xml.match(cdataPattern);
    if (cdataMatch && cdataMatch[1]) {
      return cdataMatch[1].trim();
    }

    // Handle regular content
    const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
    const match = xml.match(pattern);
    return match?.[1]?.trim() || null;
  }

  /**
   * Decode HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, num: string) => String.fromCharCode(parseInt(num, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  }

  // ==========================================================================
  // Comment Fetching
  // ==========================================================================

  /**
   * Fetch comments for a post
   *
   * Uses Brunch API to fetch comments including nested replies.
   * Note: Requires internal userId, not public username.
   */
  async fetchComments(
    userId: string,
    postId: string
  ): Promise<BrunchComment[]> {
    try {
      const url = `https://api.brunch.co.kr/v2/@@${userId}/${postId}/comments`;

      const response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          'Accept': '*/*',
          'User-Agent': USER_AGENT,
          'Cookie': 'b_s_a_l=1',  // Required to prevent redirect
        },
        throw: false,
      });

      if (response.status !== 200) {
        console.warn('[BrunchLocalService] Comments fetch failed:', response.status);
        return [];
      }

      // Parse JSON from text to handle both response.json and response.text
      let data: unknown;
      try {
        data = typeof response.json === 'object' ? (response.json as unknown) : (JSON.parse(response.text) as unknown);
      } catch {
        console.warn('[BrunchLocalService] Failed to parse comments JSON');
        return [];
      }

      return this.parseCommentsResponse(data);
    } catch (error) {
      console.warn('[BrunchLocalService] Failed to fetch comments:', error);
      return [];
    }
  }

  /**
   * Parse comments from API response
   *
   * API Response structure (from naver-blog-importer BrunchApiComment):
   * {
   *   "code": 200,
   *   "data": {
   *     "list": [{
   *       "no": 123,
   *       "commentUserId": "xxx",
   *       "commentUserName": "name",
   *       "userMembershipActive": false,
   *       "message": "comment text",
   *       "createTime": 1699999999999,  // Unix timestamp in milliseconds
   *       "parentNo": null,
   *       "children": { "list": [...] }
   *     }]
   *   }
   * }
   */
  private parseCommentsResponse(data: unknown): BrunchComment[] {
    if (!data || typeof data !== 'object') {
      return [];
    }

    // Check for successful response code
    const response = data as {
      code?: number;
      data?: {
        list?: Array<{
          no?: number;
          commentUserId?: string;
          commentUserName?: string;
          userMembershipActive?: boolean;
          message?: string;
          createTime?: number;  // Unix timestamp in milliseconds
          parentNo?: number;
          children?: {
            list?: Array<unknown>;
          };
        }>;
      };
    };

    // API returns code 200 on success
    if (response.code !== 200 || !response.data?.list) {
      console.warn('[BrunchLocalService] Comments API returned non-200 or no list:', response.code);
      return [];
    }

    const comments = response.data.list;

    return comments.map((c): BrunchComment => ({
      id: String(c.no || ''),
      author: c.commentUserName || 'Unknown',
      authorUrl: c.commentUserId
        ? `https://brunch.co.kr/@${c.commentUserId}`
        : undefined,
      content: c.message || '',
      timestamp: c.createTime ? new Date(c.createTime) : new Date(),
      isTopCreator: c.userMembershipActive,
      replies: c.children?.list && c.children.list.length > 0
        ? this.parseChildComments(c.children.list)
        : undefined,
    }));
  }

  /**
   * Parse nested child comments
   */
  private parseChildComments(children: Array<unknown>): BrunchComment[] {
    // Re-wrap children as API response format for recursive parsing
    return this.parseCommentsResponse({ code: 200, data: { list: children } });
  }

  /**
   * Convert BrunchComment to standard Comment type for timeline rendering
   *
   * This allows Brunch comments to work with the shared CommentFormatter
   * and CommentRenderer used by other platforms.
   */
  convertToStandardComments(brunchComments: BrunchComment[]): Comment[] {
    return brunchComments.map((bc): Comment => ({
      id: bc.id,
      author: {
        name: bc.author,
        url: bc.authorUrl || '',
        avatar: bc.authorAvatar,
        // isTopCreator can be used to show verified badge in future
      },
      content: bc.content,
      timestamp: bc.timestamp.toISOString(),
      likes: bc.likes,
      replies: bc.replies
        ? this.convertToStandardComments(bc.replies)
        : undefined,
    }));
  }

  /**
   * Fetch and convert comments to standard format
   *
   * Convenience method that fetches comments and converts them
   * to the standard Comment type for timeline rendering.
   */
  async fetchAndConvertComments(
    userId: string,
    postId: string
  ): Promise<Comment[]> {
    const brunchComments = await this.fetchComments(userId, postId);
    return this.convertToStandardComments(brunchComments);
  }

  // ==========================================================================
  // KakaoTV Video Info
  // ==========================================================================

  /**
   * Get detailed KakaoTV video info including MP4 URL
   *
   * Uses ReadyNplay and KAMP APIs to extract video streaming URLs.
   * Returns null if video is DRM-protected or API fails.
   *
   * API flow (matches naver-blog-importer):
   * 1. Call readyNplay to get auth token
   * 2. Call KAMP VOD API with auth token to get stream URLs
   * 3. Find best MP4 stream (prefer HIGH quality)
   */
  async getKakaoVideoInfo(
    videoId: string,
    refererUrl: string
  ): Promise<BrunchVideo | null> {
    try {
      // Step 1: Get auth token from readyNplay API
      const baseUrl = `https://play-tv.kakao.com/katz/v4/ft/cliplink/${videoId}`;
      const readyPlayUrl = `${baseUrl}@my/readyNplay` +
        `?player=monet_html5&referer=${encodeURIComponent(refererUrl)}` +
        `&profile=HIGH&service=daum_brunch&section=article` +
        `&fields=seekUrl,abrVideoLocationList&playerVersion=3.47.1&appVersion=143.0.0.0` +
        `&startPosition=0&dteType=PC&continuousPlay=false&autoPlay=false&drmType=widevine`;

      const readyResponse = await requestUrl({
        url: readyPlayUrl,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': '*/*',
          'Referer': 'https://play-tv.kakao.com/',
        },
        throw: false,
      });

      if (readyResponse.status !== 200) {
        console.warn('[BrunchLocalService] KakaoTV readyNplay failed:', readyResponse.status);
        return null;
      }

      const readyData = readyResponse.json as {
        tid?: string;
        meta?: {
          contentId?: string;
          title?: string;
          image?: string;
          duration?: number;
        };
        kampLocation?: {
          url?: string;
          token?: string;
        };
      };

      const token = readyData.kampLocation?.token;
      if (!token) {
        console.warn('[BrunchLocalService] KakaoTV: No auth token received');
        return null;
      }

      // Step 2: Get video streams from KAMP API
      const kampUrl = KAKAO_KAMP_VOD_URL(videoId) +
        `?tid=${readyData.tid || ''}&param_auth=true&${Date.now()}`;

      const kampResponse = await requestUrl({
        url: kampUrl,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': '*/*',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://play-tv.kakao.com/',
          'Origin': 'https://play-tv.kakao.com',
          'x-kamp-player': 'monet_html5',
          'x-kamp-auth': `Bearer ${token}`,
          'x-kamp-version': '3.47.1',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
        },
        throw: false,
      });

      if (kampResponse.status !== 200) {
        console.warn('[BrunchLocalService] KakaoTV KAMP API failed:', kampResponse.status);
        return null;
      }

      const kampData = kampResponse.json as {
        is_drm?: boolean;
        thumbnail?: string;
        duration?: number;
        streams?: Array<{
          protocol?: string;
          url?: string;
          profile?: string;
        }>;
        profiles?: Array<{
          name?: string;
          duration?: number;
        }>;
      };

      // Check if DRM protected
      if (kampData.is_drm) {
        return {
          url: `https://play-tv.kakao.com/embed/player/cliplink/${videoId}@my`,
          type: 'kakaoTV',
          videoId,
          thumbnail: kampData.thumbnail,
        };
      }

      // Find best MP4 stream (prefer HIGH quality)
      const streams = kampData.streams || [];
      let mp4Stream = streams.find(
        (s) => s.protocol === 'mp4' && s.profile === 'HIGH'
      );

      // Fallback to any MP4
      if (!mp4Stream) {
        mp4Stream = streams.find((s) => s.protocol === 'mp4');
      }

      // Find profile info for duration
      const profiles = kampData.profiles || [];
      const highProfile = profiles.find((p) => p.name === 'HIGH');
      const duration = highProfile?.duration || kampData.duration;

      return {
        url: `https://play-tv.kakao.com/embed/player/cliplink/${videoId}@my`,
        type: 'kakaoTV',
        videoId,
        mp4Url: mp4Stream?.url,
        thumbnail: kampData.thumbnail,
        duration,
        profile: mp4Stream?.profile || 'HIGH',
      };
    } catch (error) {
      console.warn('[BrunchLocalService] Failed to get KakaoTV video info:', error);
      return null;
    }
  }

  // ============================================================
  // Internal ID to Author Resolution
  // ============================================================

  /** Cache for internal ID to author mapping (LRU-bounded) */
  private static authorCache: Map<string, string> = new Map();
  private static readonly AUTHOR_CACHE_MAX_SIZE = 500;

  /** Set author cache with LRU eviction when exceeding max size */
  private static setAuthorCache(key: string, value: string): void {
    // Delete and re-insert for LRU ordering (Map preserves insertion order)
    BrunchLocalService.authorCache.delete(key);
    BrunchLocalService.authorCache.set(key, value);

    // Evict oldest entries if over limit
    if (BrunchLocalService.authorCache.size > BrunchLocalService.AUTHOR_CACHE_MAX_SIZE) {
      const firstKey = BrunchLocalService.authorCache.keys().next().value;
      if (firstKey !== undefined) {
        BrunchLocalService.authorCache.delete(firstKey);
      }
    }
  }

  /**
   * Check if a user ID is an internal ID (needs resolution)
   * Internal IDs: 4-8 chars, alphanumeric only, mixed case (e.g., "bK5p", "bfbK")
   * Public usernames: longer hex strings or contain hyphens (e.g., "0afe4f4ba5ef4a2", "designer-name")
   */
  static isInternalId(userId: string): boolean {
    return /^[a-zA-Z0-9]{4,8}$/.test(userId) &&
           /[a-z]/.test(userId) &&
           /[A-Z]/.test(userId);
  }

  /**
   * Resolve an internal Brunch user ID to the real author username
   * Fetches RSS at https://brunch.co.kr/rss/@@{internalId} and extracts author
   *
   * @param internalId - Internal user ID (e.g., "bK5p")
   * @param retryCount - Current retry attempt (internal use)
   * @returns Real author username (e.g., "sweetlittlekitty") or null if resolution fails
   */
  async resolveInternalId(internalId: string, retryCount = 0): Promise<string | null> {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 1000; // 1 second delay on retry

    // Check cache first
    const cached = BrunchLocalService.authorCache.get(internalId);
    if (cached) {
      return cached;
    }

    try {
      const rssUrl = `${BRUNCH_BASE_URL}/rss/@@${internalId}`;
      const response = await requestUrl({
        url: rssUrl,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/rss+xml, application/xml, text/xml',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://brunch.co.kr/',
          'Cookie': 'b_s_a_l=1',  // Skip auto-login redirect - REQUIRED
        },
      });

      if (response.status === 429 && retryCount < MAX_RETRIES) {
        // Rate limited - wait and retry
        console.warn(`[BrunchLocalService] Rate limited for ${internalId}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
        return this.resolveInternalId(internalId, retryCount + 1);
      }

      if (response.status !== 200) {
        console.warn(`[BrunchLocalService] Failed to fetch RSS for ${internalId}: ${response.status}`);
        return null;
      }

      const xml = response.text;

      // Extract author from RSS <link> tag
      // Format: <link>https://brunch.co.kr/@{authorUsername}</link>
      const linkMatch = xml.match(/<link>https:\/\/brunch\.co\.kr\/@([^<]+)<\/link>/);
      if (linkMatch && linkMatch[1]) {
        const author = linkMatch[1].trim();
        // Cache the result
        BrunchLocalService.setAuthorCache(internalId, author);
        return author;
      }

      // Fallback: try to extract from channel link
      const channelLinkMatch = xml.match(/<channel>[\s\S]*?<link>https:\/\/brunch\.co\.kr\/@([^<]+)<\/link>/);
      if (channelLinkMatch && channelLinkMatch[1]) {
        const author = channelLinkMatch[1].trim();
        BrunchLocalService.setAuthorCache(internalId, author);
        return author;
      }

      console.warn(`[BrunchLocalService] Could not extract author from RSS for ${internalId}`);
      return null;
    } catch (error: unknown) {
      // Handle 429 from exception (Obsidian requestUrl throws on non-2xx)
      if (error instanceof Error && error.message?.includes('429') && retryCount < MAX_RETRIES) {
        console.warn(`[BrunchLocalService] Rate limited for ${internalId}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
        return this.resolveInternalId(internalId, retryCount + 1);
      }
      console.warn(`[BrunchLocalService] Error resolving internal ID ${internalId}:`, error);
      return null;
    }
  }

  /**
   * Resolve multiple internal IDs sequentially (with deduplication and rate limiting)
   * Returns a map of internalId -> authorUsername
   */
  async resolveInternalIds(internalIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const uniqueIds = [...new Set(internalIds)];

    // Filter out already cached IDs
    const uncachedIds = uniqueIds.filter(id => !BrunchLocalService.authorCache.has(id));

    // Add cached results immediately
    for (const id of uniqueIds) {
      const cached = BrunchLocalService.authorCache.get(id);
      if (cached) {
        result.set(id, cached);
      }
    }

    // Process uncached IDs sequentially with delay to avoid rate limiting
    const DELAY_MS = 300; // 300ms delay between requests
    for (let i = 0; i < uncachedIds.length; i++) {
      const id = uncachedIds[i];
      if (!id) continue; // Safety check for array access

      // Add delay between requests (not before the first one)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }

      const author = await this.resolveInternalId(id);
      if (author) {
        result.set(id, author);
      }
    }

    return result;
  }

  /**
   * Extract all internal IDs from mention format in text
   * Looks for @[userId:name] patterns where userId is an internal ID
   */
  static extractInternalIds(text: string): string[] {
    const mentions = text.matchAll(/@\[([^\]:]+):([^\]]+)\]/g);
    const internalIds: string[] = [];

    for (const match of mentions) {
      const userId = match[1];
      if (userId && BrunchLocalService.isInternalId(userId)) {
        internalIds.push(userId);
      }
    }

    return internalIds;
  }

  /**
   * Convert mentions in text using resolved author mappings
   * @param text - Text containing @[userId:name] mentions
   * @param authorMap - Map of internalId -> realAuthor
   * @returns Text with mentions converted to [@name](https://brunch.co.kr/@author)
   */
  static convertMentions(text: string, authorMap: Map<string, string>): string {
    return text.replace(
      /@\[([^\]:]+):([^\]]+)\]/g,
      (match, userId: string, name: string) => {
        // Check if it's an internal ID that was resolved
        if (BrunchLocalService.isInternalId(userId)) {
          const resolvedAuthor = authorMap.get(userId);
          if (resolvedAuthor) {
            return `[@${name}](https://brunch.co.kr/@${resolvedAuthor})`;
          }
          // Fallback to @@ format if resolution failed
          return `[@${name}](https://brunch.co.kr/@@${userId})`;
        }
        // Regular username - use @ format
        return `[@${name}](https://brunch.co.kr/@${userId})`;
      }
    );
  }
}
