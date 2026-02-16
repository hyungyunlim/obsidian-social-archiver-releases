/**
 * NaverBlogLocalService - Local Naver Blog Fetcher
 *
 * Fetches Naver blog posts directly from the plugin using Obsidian's requestUrl.
 * This bypasses the Worker to reduce latency and BrightData credit usage.
 *
 * Based on obsidian-naver-blog-importer's implementation.
 */

import { requestUrl } from 'obsidian';
import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element, AnyNode } from 'domhandler';

const BLOG_BASE_URL = 'https://blog.naver.com';
const RSS_BASE_URL = 'https://rss.blog.naver.com';

/**
 * Component data structure for JSON-based content extraction
 */
interface BlogComponent {
  componentType?: string;
  data?: {
    text?: string;
    quote?: string;
    cite?: string;
    src?: string;
    url?: string;
    imageUrl?: string;
    imageInfo?: {
      src?: string;
      url?: string;
      alt?: string;
    };
    caption?: string;
    alt?: string;
    title?: string;
    code?: string;
    link?: string;
    type?: string;
    vid?: string;
    inputUrl?: string;
    [key: string]: unknown;
  };
}
const NAVER_VIDEO_API = 'https://apis.naver.com/rmcnmv/rmcnmv/vod/play/v2.0';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface NaverVideoMetadata {
  vid: string;
  inkey?: string;
  thumbnail?: string;
  title?: string;
}

export interface NaverVideoQuality {
  name: string;
  width: number;
  height: number;
  source: string;  // MP4 URL
}

export interface NaverBlogPostData {
  platform: 'naver';
  id: string;           // logNo
  url: string;
  title: string;
  author: {
    id: string;         // blogId
    name: string;       // nickname
    url: string;        // blog URL
    avatar?: string;    // profile image URL
    bio?: string;       // blog description
  };
  text: string;         // Markdown converted content
  contentHtml: string;  // Original HTML (for video extraction)
  timestamp: Date;
  likes: number;        // sympathyCount
  commentCount: number;
  viewCount: number;
  media: Array<{
    type: 'photo' | 'video';
    url: string;
    thumbnailUrl?: string;
  }>;
  // Blog metadata
  blogId: string;
  blogName?: string;
  categoryName?: string;
  tags: string[];
}

// ============================================================================
// RSS Types for Subscription Support
// ============================================================================

/**
 * RSS feed item from Naver Blog
 */
export interface NaverBlogRSSItem {
  /** Post ID (logNo) */
  logNo: string;
  /** Post URL */
  url: string;
  /** Post title */
  title: string;
  /** Publication date */
  pubDate: Date;
  /** Author name */
  author?: string;
  /** Categories/tags */
  categories: string[];
}

/**
 * Result of RSS feed fetch
 */
export interface NaverBlogRSSResult {
  /** Blog ID */
  blogId: string;
  /** Blog title from RSS channel */
  blogTitle: string;
  /** Blog description */
  blogDescription?: string;
  /** RSS items (post list) */
  items: NaverBlogRSSItem[];
  /** ETag for caching */
  etag?: string;
  /** Last-Modified header for caching */
  lastModified?: string;
  /** True if feed hasn't changed (304 response - simulated) */
  notModified: boolean;
}

/**
 * Options for RSS fetch
 */
export interface NaverRSSFetchOptions {
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
export interface FetchMemberPostsOptions {
  /** Cursor (lastLogNo) for pagination */
  cursor?: string;
  /** Maximum posts to fetch */
  limit?: number;
  /** Days to backfill on first run */
  backfillDays?: number;
}

/**
 * Result of fetchMemberPosts
 */
export interface NaverBlogMemberPostsResult {
  /** Fetched posts with full content */
  posts: NaverBlogPostData[];
  /** Next cursor (most recent logNo) */
  nextCursor: string | null;
  /** Whether there are more posts */
  hasMore: boolean;
}

/**
 * Error thrown by RSS operations
 */
export class NaverBlogRSSError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_URL' | 'FETCH_FAILED' | 'PARSE_ERROR' | 'EMPTY_FEED' | 'BLOG_NOT_FOUND',
    public readonly blogId?: string,
    public readonly retryable: boolean = false,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'NaverBlogRSSError';
  }
}

export class NaverBlogLocalService {
  private cookie: string;

  constructor(cookie?: string) {
    // Clean cookie: remove newlines, carriage returns, and normalize spaces
    this.cookie = (cookie || '')
      .replace(/[\r\n\t]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if a URL is a Naver blog URL
   */
  static isBlogUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      return hostname === 'blog.naver.com' || hostname === 'm.blog.naver.com';
    } catch {
      return false;
    }
  }

  /**
   * Parse blog URL to extract blogId and logNo
   */
  private parseUrl(url: string): { blogId: string; logNo: string } | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Pattern 1: /blogId/logNo (simple URL)
      const simpleMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)\/(\d+)$/);
      if (simpleMatch && simpleMatch[1] && simpleMatch[2]) {
        return {
          blogId: simpleMatch[1],
          logNo: simpleMatch[2],
        };
      }

      // Pattern 2: /PostView.naver?blogId=xxx&logNo=xxx
      if (pathname.includes('PostView')) {
        const blogId = urlObj.searchParams.get('blogId');
        const logNo = urlObj.searchParams.get('logNo');
        if (blogId && logNo) {
          return { blogId, logNo };
        }
      }

      // Pattern 3: /PostView.nhn (old format)
      if (pathname.includes('PostView.nhn')) {
        const blogId = urlObj.searchParams.get('blogId');
        const logNo = urlObj.searchParams.get('logNo');
        if (blogId && logNo) {
          return { blogId, logNo };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch a Naver blog post
   */
  async fetchPost(url: string): Promise<NaverBlogPostData> {
    const urlInfo = this.parseUrl(url);
    if (!urlInfo) {
      throw new Error(`Invalid Naver blog URL: ${url}`);
    }

    const { blogId, logNo } = urlInfo;

    // Try different URL formats for fetching
    // IMPORTANT: PostView.naver with widgetTypeCall=true must be first!
    // The simple URL (blog.naver.com/blogId/logNo) returns a frameset page without actual content
    const urlFormats = [
      `${BLOG_BASE_URL}/PostView.naver?blogId=${blogId}&logNo=${logNo}&redirect=Dlog&widgetTypeCall=true`,
      `${BLOG_BASE_URL}/PostView.naver?blogId=${blogId}&logNo=${logNo}`,
      `${BLOG_BASE_URL}/${blogId}/${logNo}`,
    ];

    let html: string | null = null;
    let fetchedUrl = '';

    for (const fetchUrl of urlFormats) {
      try {
        const response = await requestUrl({
          url: fetchUrl,
          method: 'GET',
          headers: this.buildHeaders(),
        });

        if (response.status === 200 && response.text) {
          // Check if we got actual content (not just a frameset)
          if (response.text.includes('se-main-container') || response.text.includes('se-component')) {
            html = response.text;
            fetchedUrl = fetchUrl;
            break;
          } else {
          }
        }
      } catch (error) {
        console.warn('[NaverBlogLocalService] Failed to fetch:', fetchUrl, error);
        continue;
      }
    }

    if (!html) {
      throw new Error(`Failed to fetch blog post: ${url}`);
    }

    // Parse the HTML
    const postData = this.parsePostHtml(html, url, blogId, logNo);

    // Fetch tags from API (more reliable than HTML parsing)
    try {
      const tags = await this.fetchTagsFromAPI(blogId, logNo);
      if (tags.length > 0) {
        postData.tags = tags;
      }
    } catch {
      // Keep HTML-parsed tags as fallback
    }

    // Fetch profile info from WidgetListAsync API (avatar, bio)
    // PostView.naver does NOT include profile widget
    try {
      const profileInfo = await this.fetchProfileInfo(blogId);
      if (profileInfo.avatar) {
        postData.author.avatar = profileInfo.avatar;
      }
      if (profileInfo.bio) {
        postData.author.bio = profileInfo.bio;
      }
      if (profileInfo.name && !postData.author.name) {
        postData.author.name = profileInfo.name;
      }
    } catch {
      // Profile info is optional, continue without it
    }

    return postData;
  }

  /**
   * Parse blog post HTML
   */
  private parsePostHtml(
    html: string,
    originalUrl: string,
    blogId: string,
    logNo: string
  ): NaverBlogPostData {
    const $ = cheerio.load(html);

    // Extract title
    const title = this.extractTitle($);

    // Extract date
    const timestamp = this.extractDate($);

    // Extract content - convert HTML to Markdown (pass raw HTML for script fallback)
    const textContent = this.convertHtmlToMarkdown($, html);

    // Extract media from HTML
    const media = this.extractMedia($);

    // Extract blog/author info
    const nickname = this.extractNickname($, blogId);

    // Extract stats (may not always be available)
    const stats = this.extractStats($);

    // Extract tags from HTML
    const tags = this.extractTagsFromHtml($);

    // Extract category
    const categoryName = this.extractCategory($);

    return {
      platform: 'naver',
      id: logNo,
      url: originalUrl,
      title,
      author: {
        id: blogId,
        name: nickname,
        url: `${BLOG_BASE_URL}/${blogId}`,
      },
      text: textContent,
      contentHtml: html,
      timestamp,
      likes: stats.likes,
      commentCount: stats.commentCount,
      viewCount: stats.viewCount,
      media,
      blogId,
      categoryName,
      tags,
    };
  }

  /**
   * Extract title from HTML
   */
  private extractTitle($: CheerioAPI): string {
    const titleSelectors = [
      '.se-title-text',
      '.se_title',
      '.se-title .se-text',
      '.se-module-text h1',
      '.se-module-text h2',
      'meta[property="og:title"]',
      'meta[name="title"]',
      '.blog-title',
      '.post-title',
      '.title_text',
      'h1.title',
      'h2.title',
      'h1',
      'h2',
      'title',
    ];

    for (const selector of titleSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        let title: string;
        if (selector.startsWith('meta')) {
          title = element.attr('content')?.trim() || '';
        } else {
          title = element.text().trim();
        }

        if (title) {
          // Clean up title - remove Naver blog suffix patterns
          title = title.replace(/\s*:\s*네이버\s*블로그\s*$/, '');
          title = title.replace(/\s*\|\s*네이버\s*블로그\s*$/, '');
          title = title.replace(/\s*-\s*네이버\s*블로그\s*$/, '');

          if (title && title !== 'Untitled') {
            return title;
          }
        }
      }
    }

    return 'Untitled';
  }

  /**
   * Extract date from HTML
   */
  private extractDate($: CheerioAPI): Date {
    // Try meta tags first
    const metaSelectors = [
      'meta[property="article:published_time"]',
      'meta[property="article:modified_time"]',
      'meta[name="pubDate"]',
      'meta[name="date"]',
      'meta[property="og:published_time"]',
    ];

    for (const selector of metaSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const content = element.attr('content');
        if (content) {
          const parsed = this.parseDate(content);
          if (parsed) return parsed;
        }
      }
    }

    // Try visible date elements
    const dateSelectors = [
      '.se_publishDate',
      '.se-publishDate',
      '.blog_author .date',
      '.post_date',
      '.date',
      '.se-date',
      'time',
    ];

    for (const selector of dateSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        const dateText = element.text().trim();
        const dateAttr = element.attr('datetime') || element.attr('data-date');

        if (dateAttr) {
          const parsed = this.parseDate(dateAttr);
          if (parsed) return parsed;
        }

        if (dateText) {
          const parsed = this.parseDate(dateText);
          if (parsed) return parsed;
        }
      }
    }

    // Try to extract from script tags
    let scriptDate: Date | null = null;
    const scripts = $('script').toArray();
    for (const script of scripts) {
      if (scriptDate) break;
      const content = $(script).html();
      if (content) {
        const patterns = [
          /"publishDate":\s*"([^"]+)"/,
          /"pubDate":\s*"([^"]+)"/,
          /"addDate":\s*"([^"]+)"/,
          /"writeDate":\s*"([^"]+)"/,
        ];

        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match && match[1]) {
            const parsed = this.parseDate(match[1]);
            if (parsed) {
              scriptDate = parsed;
              break;
            }
          }
        }
      }
    }

    if (scriptDate) return scriptDate;

    return new Date();
  }

  /**
   * Parse date string to Date object
   */
  private parseDate(dateText: string): Date | null {
    try {
      const cleanText = dateText.trim().replace(/\s+/g, ' ');

      // Korean date formats
      const patterns = [
        /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*\d{1,2}:\d{2}/,  // 2024. 05. 22. 14:30
        /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/,  // 2024.01.01
        /(\d{4})-(\d{1,2})-(\d{1,2})/,   // 2024-01-01
        /(\d{4})\/(\d{1,2})\/(\d{1,2})/,  // 2024/01/01
        /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/, // 2024년 01월 01일
        /(\d{4})(\d{2})(\d{2})/,         // 20240101
      ];

      for (const pattern of patterns) {
        const match = cleanText.match(pattern);
        if (match && match[1] && match[2] && match[3]) {
          const year = parseInt(match[1]);
          const month = parseInt(match[2]) - 1;
          const day = parseInt(match[3]);

          const date = new Date(year, month, day);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }

      // Try ISO format
      const isoDate = new Date(cleanText);
      if (!isNaN(isoDate.getTime()) && isoDate.getFullYear() > 1900) {
        return isoDate;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract nickname from HTML
   */
  private extractNickname($: CheerioAPI, fallback: string): string {
    const selectors = [
      '#nickNameArea',
      '.nick',
      '.blog_author .name',
      '.nick_name',
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        let name = element.text().trim();
        if (name) {
          // Fix duplicated nickname issue (e.g., "아다미아다미" -> "아다미")
          // This can happen when nested elements contain the same text
          name = this.deduplicateNickname(name);
          return name;
        }
      }
    }

    return fallback;
  }

  /**
   * Fix duplicated nickname (e.g., "아다미아다미" -> "아다미")
   * This happens when Cheerio's .text() concatenates text from nested elements
   */
  private deduplicateNickname(name: string): string {
    // Check if the string is a simple duplication (name repeated twice)
    const len = name.length;
    if (len >= 2 && len % 2 === 0) {
      const half = len / 2;
      const firstHalf = name.substring(0, half);
      const secondHalf = name.substring(half);
      if (firstHalf === secondHalf) {
        return firstHalf;
      }
    }
    return name;
  }

  /**
   * Fetch profile info from WidgetListAsync API
   *
   * PostView.naver does NOT include profile widget (avatar, bio).
   * Profile info is loaded separately via WidgetListAsync.naver API.
   *
   * API: https://blog.naver.com/mylog/WidgetListAsync.naver?blogId={blogId}&enableWidgetKeys=profile
   *
   * Response contains profile widget HTML with:
   * - Avatar: <p class="image"><img src="..."></p>
   * - Nickname: <strong id="nickNameArea">...</strong>
   * - Bio: <p class="caption align"><span class="itemfont col">...</span></p>
   */
  private async fetchProfileInfo(blogId: string): Promise<{ avatar?: string; bio?: string; name?: string }> {
    try {
      const profileApiUrl = `https://blog.naver.com/mylog/WidgetListAsync.naver?blogId=${blogId}&enableWidgetKeys=profile`;


      // Must include Referer header or API returns 204 No Content
      const response = await requestUrl({
        url: profileApiUrl,
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'User-Agent': USER_AGENT,
          'Referer': `https://blog.naver.com/${blogId}`,
        },
      });

      if (response.status !== 200) {
        console.warn('[NaverBlogLocalService] Profile API request failed', { status: response.status });
        return {};
      }

      // Response is JavaScript object notation (not valid JSON - keys are unquoted)
      // Example: { buddy : { isOpen : false }, profile : { content : '...' } }
      // We need to extract profile.content using regex instead of JSON.parse()
      const responseText = response.text;

      // Extract profile content using regex
      // Pattern: profile : { content : '...' }
      const profileMatch = responseText.match(/profile\s*:\s*\{\s*content\s*:\s*'([\s\S]*?)'\s*\}/);
      if (!profileMatch || !profileMatch[1]) {
        return {};
      }

      // Unescape the HTML content (it's single-quote escaped)
      const html = profileMatch[1]
        .replace(/\\'/g, "'")
        .replace(/\\n/g, '\n')
        .replace(/\\\\/g, '\\');

      let avatar: string | undefined;
      let bio: string | undefined;
      let name: string | undefined;

      // Extract avatar from profile image
      // Pattern: <p class="image">...<img src="..."></p>
      const avatarMatch = html.match(/<p[^>]*class="[^"]*image[^"]*"[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>/i) ||
                          html.match(/<img[^>]+class="[^"]*(?:thumb|profile)[^"]*"[^>]+src=["']([^"']+)["']/i);
      if (avatarMatch && avatarMatch[1]) {
        const avatarUrl = avatarMatch[1].startsWith('//') ? `https:${avatarMatch[1]}` : avatarMatch[1];
        // Skip default/placeholder avatars (login_basic.gif is Naver's default)
        if (!avatarUrl.includes('/nblog/comment/login_basic.gif') &&
            !avatarUrl.includes('/default_avatar') &&
            !avatarUrl.includes('blogimgs.pstatic.net')) {
          avatar = avatarUrl;
        }
      }

      // Extract bio from caption
      // Pattern: <p class="caption align"><span class="itemfont col">bio...</span></p>
      const bioMatch = html.match(/<p[^>]*class="[^"]*caption[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*itemfont[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      if (bioMatch && bioMatch[1]) {
        bio = this.stripHtml(bioMatch[1])
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!bio) {
          bio = undefined;
        }
      }

      // Extract nickname from nickNameArea
      const nickNameMatch = html.match(/<strong[^>]*id="nickNameArea"[^>]*>([\s\S]*?)<\/strong>/i);
      if (nickNameMatch && nickNameMatch[1]) {
        name = this.stripHtml(nickNameMatch[1]).trim();
        // Fix duplicated nickname issue
        name = this.deduplicateNickname(name);
      }

      return { avatar, bio, name };
    } catch (error) {
      console.warn('[NaverBlogLocalService] Failed to fetch profile from API', error);
      return {};
    }
  }

  /**
   * Strip HTML tags from string
   */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }

  /**
   * Extract stats from HTML
   */
  private extractStats($: CheerioAPI): { likes: number; commentCount: number; viewCount: number } {
    // These are often not available in the HTML
    return {
      likes: 0,
      commentCount: 0,
      viewCount: 0,
    };
  }

  /**
   * Extract tags from HTML
   */
  private extractTagsFromHtml($: CheerioAPI): string[] {
    const tags: string[] = [];
    const selectors = [
      'div[id^="tagList_"] a span.ell',
      '.wrap_tag a.item span.ell',
      '.post_tag a span',
      '.tag_area a',
      '.se-tag a',
    ];

    for (const selector of selectors) {
      $(selector).each((_, el) => {
        let tagText = $(el).text().trim();
        if (tagText.startsWith('#')) {
          tagText = tagText.substring(1);
        }
        if (tagText && !tags.includes(tagText)) {
          tags.push(tagText);
        }
      });
      if (tags.length > 0) break;
    }

    return tags;
  }

  /**
   * Extract category from HTML
   */
  private extractCategory($: CheerioAPI): string | undefined {
    const selectors = [
      '.category',
      '.blog_category',
      '.cate_wrap',
    ];

    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const category = element.text().trim();
        if (category) return category;
      }
    }

    return undefined;
  }

  /**
   * Extract media from HTML
   */
  private extractMedia($: CheerioAPI): NaverBlogPostData['media'] {
    const media: NaverBlogPostData['media'] = [];

    // Find all images
    $('.se-image img, .se-imageGroup-item img').each((_, img) => {
      const $img = $(img);
      let src = $img.attr('data-lazy-src') ||
                $img.attr('src') ||
                $img.attr('data-src');

      if (src && this.isContentImage(src)) {
        src = this.enhanceImageUrl(src);
        media.push({
          type: 'photo',
          url: src,
        });
      }
    });

    return media;
  }

  /**
   * Convert HTML to Markdown using cheerio
   */
  private convertHtmlToMarkdown($: CheerioAPI, rawHtml?: string): string {
    let content = '';

    // Try different container selectors (matching naver-blog-importer approach)
    const contentSelectors = [
      '.se-main-container',
      '.post-content',
      '.blog-content',
      '#post-content',
      '.post_ct',
      '.post-view',
      '.post_area',
      '.blog_content',
      'body',  // fallback to parse all se-components in document order
    ];

    // Find SE components from various containers
    let components: Element[] = [];

    for (const selector of contentSelectors) {
      const container = $(selector);
      if (container.length > 0) {
        components = container.find('.se-component').toArray() as Element[];
        if (components.length > 0) {
          break;
        }
        // Also try .se-section
        components = container.find('.se-section').toArray() as Element[];
        if (components.length > 0) {
          break;
        }
      }
    }

    // Process SE components if found
    if (components.length > 0) {
      for (const component of components) {
        const $component = $(component);
        content += this.processSeComponent($component, $);
      }
    }

    // Fallback 1: Try paragraph elements if no SE components found
    if (!content.trim()) {
      $('p').each((_, p) => {
        const text = $(p).text().trim();
        if (text && text !== '\u200B' && text.length > 5) {
          content += text + '\n\n';
        }
      });
    }

    // Fallback 2: Try to extract from script tags (for newer blogs with JSON data)
    if (!content.trim() && rawHtml) {
      content = this.extractContentFromScripts(rawHtml);
    }

    return this.cleanContent(content);
  }

  /**
   * Extract content from script tags (fallback for newer Naver blogs)
   * Naver sometimes embeds post content as JSON in script tags
   * Based on naver-blog-importer's extractContentFromScripts method
   */
  private extractContentFromScripts(html: string): string {
    try {
      // Use regex to find script tags (matching naver-blog-importer approach)
      const scriptRegex = /<script[^>]*>(.*?)<\/script>/gis;
      let match;

      while ((match = scriptRegex.exec(html)) !== null) {
        const scriptContent = match[1];
        if (!scriptContent) continue;

        // Look for post content in various formats
        if (scriptContent.includes('postContent') ||
            scriptContent.includes('components') ||
            scriptContent.includes('__PRELOADED_STATE__') ||
            scriptContent.includes('blogData')) {
          try {
            // Try to extract JSON data with components
            const jsonMatch = scriptContent.match(/\{.*"components".*\}/s);
            if (jsonMatch) {
              const data = JSON.parse(jsonMatch[0]);
              const components = data.components || [];
              if (Array.isArray(components) && components.length > 0) {
                return this.extractContentFromComponents(components);
              }
            }
          } catch {
            // Continue to next script
            continue;
          }
        }
      }

      return '';
    } catch {
      return '';
    }
  }

  /**
   * Extract content from JSON component data
   */
  private extractContentFromComponents(components: BlogComponent[]): string {
    let content = '';

    for (const component of components) {
      const type = component.componentType;
      const data = component.data || {};

      switch (type) {
        case 'se-text':
          if (data.text) {
            // Handle HTML in JSON text data
            const textContent = data.text.replace(/<[^>]*>/g, '').trim();
            if (textContent && !textContent.startsWith('#')) {
              // Split into paragraphs if it's a long text
              const paragraphs = textContent.split(/\n\s*\n/);
              for (const paragraph of paragraphs) {
                const trimmed = paragraph.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                  content += trimmed + '\n';
                }
              }
            }
          }
          break;

        case 'se-sectionTitle':
          if (data.text) {
            content += `## ${data.text}\n\n`;
          }
          break;

        case 'se-quotation':
          if (data.quote) {
            content += `\n> ${data.quote}\n`;
            const cite = data.cite || '';
            if (cite) {
              content += `\n출처: ${cite}\n\n`;
            } else {
              content += '\n';
            }
          }
          break;

        case 'se-image': {
          const imageUrl = data.src || data.url || data.imageUrl || data.imageInfo?.url;
          if (imageUrl) {
            const enhancedUrl = this.enhanceImageUrl(imageUrl);
            const altText = data.caption || data.alt || data.title || 'Blog Image';
            content += `![${altText}](${enhancedUrl})\n`;
            if (data.caption) {
              content += `*${data.caption}*\n`;
            }
          } else if (data.imageInfo && data.imageInfo.src) {
            const enhancedUrl = this.enhanceImageUrl(data.imageInfo.src);
            const altText = data.caption || data.imageInfo.alt || 'Blog Image';
            content += `![${altText}](${enhancedUrl})\n`;
            if (data.caption) {
              content += `*${data.caption}*\n`;
            }
          }
          break;
        }

        case 'se-code':
          if (data.code) {
            let cleanCode = data.code;
            if (cleanCode.startsWith('\n')) {
              cleanCode = cleanCode.substring(1);
            }
            if (cleanCode.endsWith('\n')) {
              cleanCode = cleanCode.slice(0, -1);
            }
            content += '```\n' + cleanCode.trim() + '\n```\n\n';
          }
          break;

        case 'se-horizontalLine':
          content += '---\n\n';
          break;

        case 'se-video':
          if (data.vid) {
            content += `\n\n<!--VIDEO:${data.vid}-->\n\n`;
          } else {
            content += '[비디오]\n\n';
          }
          break;

        case 'se-oembed': {
          const oembedUrl = data.inputUrl || data.url || '';
          const oembedTitle = data.title || '';

          if (oembedUrl) {
            if (oembedUrl.includes('youtube.com') || oembedUrl.includes('youtu.be')) {
              content += `![${oembedTitle || 'YouTube'}](${oembedUrl})\n\n`;
            } else {
              content += `[${oembedTitle || '임베드 콘텐츠'}](${oembedUrl})\n\n`;
            }
          }
          break;
        }

        case 'se-oglink': {
          const linkUrl = data.url || data.link || '';
          const title = data.title || '';
          if (linkUrl && title) {
            content += `[${title}](${linkUrl})\n\n`;
          } else if (linkUrl) {
            content += `${linkUrl}\n\n`;
          }
          break;
        }

        case 'se-table':
          content += '[표]\n\n';
          break;

        default:
          // For unknown components, try to extract any text
          if (data.text) {
            const cleanText = data.text.replace(/<[^>]*>/g, '').trim();
            if (cleanText && cleanText.length > 5) {
              content += cleanText + '\n\n';
            }
          }
          break;
      }
    }

    return content;
  }

  /**
   * Process a single se-component
   */
  private processSeComponent($component: Cheerio<AnyNode>, $: CheerioAPI): string {
    let content = '';

    // Text component
    if ($component.hasClass('se-text') || $component.hasClass('se-section-text')) {
      const textModule = $component.find('.se-module-text');
      if (textModule.length > 0) {
        textModule.children().each((_, child) => {
          const $child = $(child);
          const tagName = (child as Element).tagName?.toLowerCase();

          if (tagName === 'p') {
            const paragraphText = $child.text().trim();
            if (paragraphText && !paragraphText.startsWith('#')) {
              content += paragraphText + '\n';
            }
          } else if (tagName === 'ul' || tagName === 'ol') {
            const isOrdered = tagName === 'ol';
            $child.find('li').each((index, li) => {
              const listItemText = $(li).text().trim();
              if (listItemText && !listItemText.startsWith('#')) {
                if (isOrdered) {
                  content += `${index + 1}. ${listItemText}\n`;
                } else {
                  content += `- ${listItemText}\n`;
                }
              }
            });
            content += '\n';
          }
        });

        if (textModule.children().length === 0) {
          textModule.find('p').each((_, p) => {
            const paragraphText = $(p).text().trim();
            if (paragraphText && !paragraphText.startsWith('#')) {
              content += paragraphText + '\n';
            }
          });
        }
      } else {
        $component.find('p').each((_, p) => {
          const text = $(p).text().trim();
          if (text && text !== '\u200B') {
            content += text + '\n';
          }
        });
      }
      content += '\n';
    }
    // Image component
    else if ($component.hasClass('se-image') || $component.hasClass('se-section-image')) {
      const imgElement = $component.find('img');
      const caption = $component.find('.se-caption').text().trim();

      if (imgElement.length > 0) {
        let imgSrc = imgElement.attr('data-lazy-src') ||
                     imgElement.attr('src') ||
                     imgElement.attr('data-src');

        if (imgSrc && this.isContentImage(imgSrc)) {
          imgSrc = this.enhanceImageUrl(imgSrc);
          const altText = caption || imgElement.attr('alt') || 'Image';
          content += `![${altText}](${imgSrc})\n`;
          if (caption) content += `*${caption}*\n`;
        }
      }
      content += '\n';
    }
    // Image Group (carousel/slideshow)
    else if ($component.hasClass('se-imageGroup')) {
      const imageItems = $component.find('.se-imageGroup-item');
      const groupCaption = $component.find('.se-caption').text().trim();

      imageItems.each((_, item) => {
        const $item = $(item);
        const imgElement = $item.find('img');

        if (imgElement.length > 0) {
          let imgSrc = imgElement.attr('data-lazy-src') ||
                       imgElement.attr('src') ||
                       imgElement.attr('data-src');

          if (imgSrc && this.isContentImage(imgSrc)) {
            imgSrc = this.enhanceImageUrl(imgSrc);
            const altText = imgElement.attr('alt') || 'Image';
            content += `![${altText}](${imgSrc})\n`;
          }
        }
      });

      if (groupCaption) {
        content += `*${groupCaption}*\n`;
      }
      content += '\n';
    }
    // Quotation
    else if ($component.hasClass('se-quotation')) {
      const quoteElements = $component.find('.se-quote');
      if (quoteElements.length > 0) {
        quoteElements.each((_, quote) => {
          const quoteText = $(quote).text().trim();
          if (quoteText) {
            content += `> ${quoteText}\n`;
          }
        });
        content += '\n';
      }
    }
    // Horizontal line
    else if ($component.hasClass('se-horizontalLine')) {
      content += '---\n\n';
    }
    // OG Link
    else if ($component.hasClass('se-oglink')) {
      const linkEl = $component.find('a.se-oglink-info, a.se-oglink-thumbnail').first();
      const linkUrl = linkEl.attr('href') || $component.find('a').attr('href') || '';
      const title = $component.find('.se-oglink-title').text().trim();

      if (linkUrl && title) {
        content += `[${title}](${linkUrl})\n\n`;
      } else if (linkUrl) {
        content += `${linkUrl}\n\n`;
      }
    }
    // Code
    else if ($component.hasClass('se-code')) {
      const codeElements = $component.find('.se-code-source');
      if (codeElements.length > 0) {
        codeElements.each((_, code) => {
          let codeContent = $(code).text();
          if (codeContent.startsWith('\n')) codeContent = codeContent.substring(1);
          if (codeContent.endsWith('\n')) codeContent = codeContent.slice(0, -1);
          if (codeContent.trim()) {
            content += '```\n' + codeContent.trim() + '\n```\n\n';
          }
        });
      }
    }
    // Video
    else if ($component.hasClass('se-video')) {
      const scriptEl = $component.find('script.__se_module_data, script[data-module-v2]');
      if (scriptEl.length > 0) {
        const moduleData = scriptEl.attr('data-module-v2') || scriptEl.attr('data-module');
        if (moduleData) {
          try {
            const data = JSON.parse(moduleData);
            if (data.type === 'v2_video' && data.data?.vid && data.data?.inkey) {
              // Use placeholder with vid:inkey for video download
              content += `<!--VIDEO:${data.data.vid}:${data.data.inkey}-->\n\n`;
            } else if (data.data?.vid) {
              // Just vid, will need to fetch inkey separately
              content += `<!--VIDEO:${data.data.vid}-->\n\n`;
            } else {
              content += '[비디오]\n\n';
            }
          } catch {
            content += '[비디오]\n\n';
          }
        } else {
          content += '[비디오]\n\n';
        }
      } else {
        content += '[비디오]\n\n';
      }
    }
    // OEmbed (YouTube, etc.)
    else if ($component.hasClass('se-oembed')) {
      const scriptEl = $component.find('script.__se_module_data, script[data-module]');
      if (scriptEl.length > 0) {
        const moduleData = scriptEl.attr('data-module-v2') || scriptEl.attr('data-module');
        if (moduleData) {
          try {
            const data = JSON.parse(moduleData);
            const oembedData = data.data;
            if (oembedData) {
              const url = oembedData.inputUrl || oembedData.url || '';
              const title = oembedData.title || '';
              if (url) {
                if (url.includes('youtube.com') || url.includes('youtu.be')) {
                  content += `![${title || 'YouTube'}](${url})\n\n`;
                } else {
                  content += `[${title || '임베드 콘텐츠'}](${url})\n\n`;
                }
              }
            }
          } catch {
            // Fall through
          }
        }
      }
      // Fallback: iframe
      const iframe = $component.find('iframe');
      if (iframe.length > 0) {
        const src = iframe.attr('src') || '';
        if (src.includes('youtube.com/embed/')) {
          const videoId = src.match(/embed\/([^?&]+)/)?.[1];
          if (videoId) {
            const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
            content += `![YouTube](${watchUrl})\n\n`;
          }
        } else if (src) {
          content += `[임베드 콘텐츠](${src})\n\n`;
        }
      }
    }
    // Table
    else if ($component.hasClass('se-table')) {
      $component.find('tr').each((rowIdx, row) => {
        const cells: string[] = [];
        $(row).find('td, th').each((_, cell) => {
          cells.push($(cell).text().trim());
        });
        if (cells.length > 0) {
          content += '| ' + cells.join(' | ') + ' |\n';
          if (rowIdx === 0) {
            content += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
          }
        }
      });
      content += '\n';
    }
    // Section Title
    else if ($component.hasClass('se-sectionTitle')) {
      const titleContent = $component.find('.se-module-text').text().trim();
      if (titleContent) {
        content += `## ${titleContent}\n\n`;
      }
    }
    // Places Map (Naver Map)
    else if ($component.hasClass('se-placesMap')) {
      const placeName = $component.find('.se-place-name, .se-places-name').text().trim();
      const placeAddress = $component.find('.se-place-address, .se-places-address').text().trim();

      if (placeName || placeAddress) {
        content += '\n📍 ';
        if (placeName) {
          content += `**${placeName}**`;
        }
        if (placeAddress) {
          content += placeName ? `\n${placeAddress}` : placeAddress;
        }
        content += '\n\n';
      }
      // Don't add fallback text for maps - they contain garbage characters
    }
    // Sticker (skip - no meaningful content)
    else if ($component.hasClass('se-sticker')) {
      // Skip stickers - they're just decorative
    }
    // File attachment
    else if ($component.hasClass('se-file') || $component.hasClass('se-section-file')) {
      const fileName = $component.find('.se-file-name').text().trim();
      const fileExt = $component.find('.se-file-extension').text().trim();
      const downloadLink = $component.find('a.se-file-save-button').attr('href');

      if (fileName && downloadLink) {
        const fullFileName = fileName + fileExt;
        content += `📎 [${fullFileName}](${downloadLink})\n\n`;
      } else if (fileName) {
        content += `📎 ${fileName}${fileExt} (다운로드 링크 없음)\n\n`;
      }
    }
    // Fallback
    else {
      const textContent = $component.text().trim();
      if (textContent && textContent.length > 10 && !textContent.startsWith('#')) {
        content += textContent + '\n\n';
      }
    }

    return content;
  }

  /**
   * Check if URL is a content image (not UI element)
   */
  private isContentImage(src: string): boolean {
    const skipPatterns = [
      /icon/i, /logo/i, /button/i, /profile/i,
      /emoticon/i, /sticker/i, /1x1/, /spacer/i,
      /se-sticker/i, /se-emoticon/i, /editor/i,
      /thumb/i, /loading/i, /spinner/i, /defaultimg/i,
    ];
    for (const pattern of skipPatterns) {
      if (pattern.test(src)) return false;
    }
    return src.startsWith('http') || src.startsWith('//');
  }

  /**
   * Enhance image URL to get higher quality
   * Uses the same logic as naver_blog_md library
   */
  private enhanceImageUrl(src: string): string {
    let url = src;

    // Step 1: Remove all query parameters
    const urlParts = url.split('?');
    url = urlParts[0] ?? url;

    // Step 2: Replace postfiles with blogfiles for original images
    url = url.replace('postfiles', 'blogfiles');

    // Step 3: Replace various CDN domains with blogfiles
    url = url
      .replace('https://mblogvideo-phinf.pstatic.net/', 'https://blogfiles.pstatic.net/')
      .replace('https://mblogthumb-phinf.pstatic.net/', 'https://blogfiles.pstatic.net/')
      .replace('https://postfiles.pstatic.net/', 'https://blogfiles.pstatic.net/')
      .replace('https://blogpfthumb-phinf.pstatic.net/', 'https://blogfiles.pstatic.net/');

    return url;
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
      .replace(/\uFFFD/g, '')
      .trim();
  }

  /**
   * Build headers for requests
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': USER_AGENT,
    };

    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    return headers;
  }

  /**
   * Fetch tags from Naver Blog Tag API
   */
  private async fetchTagsFromAPI(blogId: string, logNo: string): Promise<string[]> {
    try {
      const apiUrl = `${BLOG_BASE_URL}/BlogTagListInfo.naver?blogId=${blogId}&logNoList=${logNo}&logType=mylog`;

      const response = await requestUrl({
        url: apiUrl,
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          'User-Agent': USER_AGENT,
        },
      });

      if (response.status === 200 && response.text) {
        const data = JSON.parse(response.text);

        if (data.taglist && Array.isArray(data.taglist)) {
          for (const tagInfo of data.taglist) {
            if (tagInfo.logno === logNo && tagInfo.tagName) {
              const decodedTags = decodeURIComponent(tagInfo.tagName);
              return decodedTags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
            }
          }
        }
      }
    } catch {
      // Tag API failed
    }

    return [];
  }

  /**
   * Extract video metadata from content text
   * Finds all <!--VIDEO:vid--> or <!--VIDEO:vid:inkey--> placeholders
   */
  extractVideoMetadata(content: string): NaverVideoMetadata[] {
    const videos: NaverVideoMetadata[] = [];
    const seenVids = new Set<string>();

    // Pattern 1: <!--VIDEO:vid:inkey--> (with inkey - preferred)
    const pattern1 = /<!--VIDEO:([^:]+):([^-]+)-->/g;
    let match;
    while ((match = pattern1.exec(content)) !== null) {
      if (match[1] && match[2] && !seenVids.has(match[1])) {
        seenVids.add(match[1]);
        videos.push({
          vid: match[1],
          inkey: match[2],
        });
      }
    }

    // Pattern 2: <!--VIDEO:vid--> (without inkey - will need to fetch)
    const pattern2 = /<!--VIDEO:([a-zA-Z0-9]+)-->/g;
    while ((match = pattern2.exec(content)) !== null) {
      if (match[1] && !seenVids.has(match[1])) {
        seenVids.add(match[1]);
        videos.push({
          vid: match[1],
        });
      }
    }

    return videos;
  }

  /**
   * Fetch video metadata (inkey) from Naver Play API
   * This is needed for blog videos that don't have inkey in the placeholder
   */
  async fetchVideoInkey(vid: string): Promise<string | null> {
    try {
      // Naver blog uses a different API to get video inkey
      const apiUrl = `https://play.naver.com/api/videoInfo?vid=${vid}`;

      const response = await requestUrl({
        url: apiUrl,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
        },
      });

      if (response.status === 200) {
        const data = response.json;
        if (data.inkey) {
          return data.inkey;
        }
      }
    } catch {
      // Failed to fetch inkey
    }

    return null;
  }

  /**
   * Fetch video URL from Naver Video API
   */
  async fetchVideoUrl(vid: string, inkey?: string): Promise<NaverVideoQuality | null> {
    try {
      // If no inkey provided, try to fetch it
      let videoInkey: string | undefined = inkey;
      if (!videoInkey) {
        const fetchedInkey = await this.fetchVideoInkey(vid);
        videoInkey = fetchedInkey ?? undefined;
      }

      if (!videoInkey) {
        console.warn('[NaverBlogLocalService] Could not get inkey for video:', vid);
        return null;
      }

      const apiUrl = `${NAVER_VIDEO_API}/${vid}?key=${videoInkey}&sid=5`;

      const response = await requestUrl({
        url: apiUrl,
        method: 'GET',
        headers: {
          'Accept': '*/*',
          'User-Agent': USER_AGENT,
        },
      });

      if (response.status !== 200) {
        console.warn(`[NaverBlogLocalService] Video API returned status ${response.status}`);
        return null;
      }

      const data = response.json;
      const qualities: NaverVideoQuality[] = [];

      // Extract video list from response
      if (data.videos?.list) {
        for (const video of data.videos.list) {
          qualities.push({
            name: video.encodingOption?.name || 'unknown',
            width: video.encodingOption?.width || 0,
            height: video.encodingOption?.height || 0,
            source: video.source,
          });
        }
      }

      // Sort by resolution (highest first) and return best quality
      // Prefer 1080p if available
      qualities.sort((a, b) => {
        // Prefer 1080p over higher resolutions for reasonable file size
        if (a.height === 1080 && b.height !== 1080) return -1;
        if (b.height === 1080 && a.height !== 1080) return 1;
        return b.height - a.height;
      });

      const bestQuality = qualities[0];
      if (bestQuality) {
        return bestQuality;
      }

      return null;
    } catch (error) {
      console.error('[NaverBlogLocalService] Failed to fetch video URL:', error);
      return null;
    }
  }

  // ==========================================================================
  // RSS Feed Methods (for Subscription Support)
  // ==========================================================================

  /**
   * Fetch RSS feed from Naver blog
   *
   * Uses Obsidian's requestUrl (bypasses CORS).
   * Supports ETag/Last-Modified caching headers.
   *
   * @param blogIdOrUrl - Blog ID or full blog/RSS URL
   * @param options - Caching and filtering options
   * @returns RSS result with items and caching headers
   */
  async fetchRSS(
    blogIdOrUrl: string,
    options: NaverRSSFetchOptions = {}
  ): Promise<NaverBlogRSSResult> {
    // Extract blog ID from URL if needed
    const blogId = this.extractBlogId(blogIdOrUrl) || blogIdOrUrl;

    if (!blogId || blogId.length === 0) {
      throw new NaverBlogRSSError('Invalid blog ID or URL', 'INVALID_URL', blogIdOrUrl);
    }

    const rssUrl = `${RSS_BASE_URL}/${blogId}`;

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': USER_AGENT,
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      };

      // Add conditional headers for caching (If-None-Match / If-Modified-Since)
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

      // Handle 304 Not Modified - RSS hasn't changed
      if (response.status === 304) {
        return {
          blogId,
          blogTitle: '',
          items: [],
          etag: options.etag,
          lastModified: options.lastModified,
          notModified: true,
        };
      }

      // Handle errors
      if (response.status === 404) {
        throw new NaverBlogRSSError(
          `Blog not found: ${blogId}`,
          'BLOG_NOT_FOUND',
          blogId,
          false,
          404
        );
      }

      if (response.status >= 400) {
        throw new NaverBlogRSSError(
          `RSS fetch failed: HTTP ${response.status}`,
          'FETCH_FAILED',
          blogId,
          response.status >= 500,
          response.status
        );
      }

      // Get caching headers from response
      const etag = response.headers?.['etag'] || response.headers?.['ETag'];
      const lastModified = response.headers?.['last-modified'] || response.headers?.['Last-Modified'];

      // Parse RSS
      const xml = response.text;
      const result = this.parseRssFeed(xml, blogId, options);

      return {
        ...result,
        etag,
        lastModified,
        notModified: false,
      };
    } catch (error) {
      if (error instanceof NaverBlogRSSError) {
        throw error;
      }

      console.error('[NaverBlogLocalService] RSS fetch failed:', { blogId, error });
      throw new NaverBlogRSSError(
        `RSS fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'FETCH_FAILED',
        blogId,
        true
      );
    }
  }

  /**
   * Fetch member posts for subscription polling
   *
   * Uses RSS to discover new posts, then fetches full content for each.
   * Supports cursor-based pagination and backfill.
   *
   * @param blogId - Blog ID
   * @param options - Pagination and filtering options
   * @returns Posts with full content and next cursor
   */
  async fetchMemberPosts(
    blogId: string,
    options: FetchMemberPostsOptions = {}
  ): Promise<NaverBlogMemberPostsResult> {
    const limit = options.limit || 20;
    const backfillDays = options.backfillDays || 7;
    const cursor = options.cursor;

    // Step 1: Fetch RSS to get post list
    const rssResult = await this.fetchRSS(blogId, {
      maxResults: limit * 2, // Fetch extra in case some are filtered
    });

    if (rssResult.items.length === 0) {
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
    const posts: NaverBlogPostData[] = [];
    let hasMore = true;
    let stoppedByCursor = false;

    for (const item of rssResult.items) {
      // Stop if we've reached the limit
      if (posts.length >= limit) {
        break;
      }

      // Stop if we've reached the cursor (already seen)
      if (cursor && item.logNo === cursor) {
        stoppedByCursor = true;
        hasMore = false;
        break;
      }

      // For first run (no cursor), apply backfill date filter
      if (cutoffDate && item.pubDate < cutoffDate) {
        hasMore = false;
        break;
      }

      // Fetch full post content
      try {
        const postUrl = `${BLOG_BASE_URL}/${blogId}/${item.logNo}`;
        const postData = await this.fetchPost(postUrl);
        posts.push(postData);

        // Rate limit: 300ms delay between fetches
        if (posts.length < limit) {
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (error) {
        console.warn(`[NaverBlogLocalService] Failed to fetch post ${item.logNo}:`, error);
        // Continue with next post instead of failing completely
      }
    }

    // Next cursor is the most recent logNo (first post)
    const firstPost = posts[0];
    const nextCursor = firstPost ? firstPost.id : cursor || null;

    // Determine if there are more posts
    // hasMore is false if we hit the cursor or cutoff date
    if (!stoppedByCursor && posts.length >= limit) {
      hasMore = rssResult.items.length > posts.length;
    }

    return {
      posts,
      nextCursor,
      hasMore,
    };
  }

  // ==========================================================================
  // RSS Parsing Helpers
  // ==========================================================================

  /**
   * Extract blogId from various URL formats
   */
  private extractBlogId(urlOrId: string): string | null {
    // If it's not a URL, treat as direct blogId
    if (!urlOrId.includes('://') && !urlOrId.includes('.')) {
      return urlOrId.replace(/^@/, '');
    }

    try {
      const url = new URL(urlOrId);
      const hostname = url.hostname.toLowerCase();
      const pathname = url.pathname;

      // RSS URL: rss.blog.naver.com/{blogId} or rss.blog.naver.com/{blogId}.xml
      if (hostname === 'rss.blog.naver.com') {
        const match = pathname.match(/^\/([A-Za-z0-9_-]+)(?:\.xml)?$/);
        return match?.[1] || null;
      }

      // Blog URL: blog.naver.com/{blogId} or blog.naver.com/{blogId}/{logNo}
      if (hostname === 'blog.naver.com' || hostname === 'm.blog.naver.com') {
        const match = pathname.match(/^\/([A-Za-z0-9_-]+)/);
        return match?.[1] || null;
      }

      return null;
    } catch {
      // Not a valid URL, might be just blogId
      const cleanId = urlOrId.replace(/^@/, '');
      if (/^[A-Za-z0-9_-]+$/.test(cleanId)) {
        return cleanId;
      }
      return null;
    }
  }

  /**
   * Parse RSS XML and extract items
   */
  private parseRssFeed(
    xml: string,
    blogId: string,
    options: NaverRSSFetchOptions
  ): Omit<NaverBlogRSSResult, 'etag' | 'lastModified' | 'notModified'> {
    // Extract channel info
    const blogTitle = this.extractRssTagContent(xml, 'title') || blogId;
    const blogDescription = this.extractRssTagContent(xml, 'description');

    // Extract items
    const items: NaverBlogRSSItem[] = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);

    for (const match of itemMatches) {
      const itemXml = match[1];
      if (!itemXml) continue;

      // Extract item data
      const link = this.extractRssTagContent(itemXml, 'link');
      if (!link) continue;

      const logNo = this.extractLogNoFromUrl(link);
      if (!logNo) continue;

      const title = this.extractRssTagContent(itemXml, 'title') || 'Untitled';
      const pubDateStr = this.extractRssTagContent(itemXml, 'pubDate');
      const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();

      // Extract author
      const author = this.extractRssTagContent(itemXml, 'author') ||
                     this.extractRssTagContent(itemXml, 'dc:creator');

      // Extract categories
      const categories: string[] = [];
      const categoryMatches = itemXml.matchAll(/<category>([^<]+)<\/category>/gi);
      for (const catMatch of categoryMatches) {
        if (catMatch[1]) {
          categories.push(this.decodeHtmlEntities(catMatch[1].trim()));
        }
      }

      // Apply date filter
      if (options.publishedAfter && pubDate < options.publishedAfter) {
        continue;
      }

      items.push({
        logNo,
        url: link,
        title: this.decodeHtmlEntities(title),
        pubDate,
        author: author ? this.decodeHtmlEntities(author) : undefined,
        categories,
      });

      // Apply max results limit
      if (options.maxResults && items.length >= options.maxResults) {
        break;
      }
    }

    return {
      blogId,
      blogTitle: this.decodeHtmlEntities(blogTitle),
      blogDescription: blogDescription ? this.decodeHtmlEntities(blogDescription) : undefined,
      items,
    };
  }

  /**
   * Extract logNo from post URL
   */
  private extractLogNoFromUrl(postUrl: string): string | null {
    try {
      const url = new URL(postUrl);
      const match = url.pathname.match(/\/[A-Za-z0-9_-]+\/(\d+)$/);
      return match?.[1] || null;
    } catch {
      // Try regex on raw string
      const match = postUrl.match(/\/(\d+)(?:\?|#|$)/);
      return match?.[1] || null;
    }
  }

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
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}
