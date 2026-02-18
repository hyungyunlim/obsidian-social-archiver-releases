/**
 * NaverCafeLocalService - Local Naver Cafe Fetcher
 *
 * Fetches Naver cafe posts directly from the plugin using Obsidian's requestUrl.
 * This bypasses the Worker to properly support cookie authentication.
 *
 * Based on obsidian-naver-blog-importer's implementation.
 */

import { requestUrl } from 'obsidian';
import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element, AnyNode } from 'domhandler';

/** Naver API article response shape */
interface NaverArticleApiResponse {
  result?: {
    article?: Record<string, unknown>;
    cafe?: Record<string, unknown>;
    comments?: Record<string, unknown> | Record<string, unknown>[];
    commentList?: Record<string, unknown>[];
  };
}

/** Raw comment object shape from Naver API responses */
interface NaverCafeRawComment {
  writer?: { nick?: string; nickname?: string; id?: string; memberKey?: string };
  image?: { url?: string; src?: string; imageUrl?: string };
  content?: string;
  isDeleted?: boolean;
  updateDate?: string | number;
  writeDate?: string | number;
  createDate?: string | number;
  id?: string | number;
  commentId?: string | number;
  refId?: string | number;
  isRef?: boolean;
  sympathyCount?: number;
  likeCount?: number;
  isArticleWriter?: boolean;
  articleWriter?: boolean;
  replyList?: NaverCafeRawComment[];
}

const CAFE_BASE_URL = 'https://cafe.naver.com';
const CAFE_ARTICLE_API = 'https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes';
const CAFE_MEMBER_PROFILE_API = 'https://apis.naver.com/cafe-web/cafe-cafeinfo-api/v3.0/cafes';
const CAFE_MEMBER_ARTICLES_API = 'https://apis.naver.com/cafe-web/cafe-mobile/CafeMemberNetworkArticleListV3';
const NAVER_VIDEO_API = 'https://apis.naver.com/rmcnmv/rmcnmv/vod/play/v2.0';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const DEFAULT_PER_PAGE = 15;

export interface NaverVideoMetadata {
  vid: string;
  inkey: string;
  thumbnail?: string;
  title?: string;
}

export interface NaverVideoQuality {
  name: string;
  width: number;
  height: number;
  source: string;  // MP4 URL
}

export interface NaverCafeComment {
  commentId: string;
  content: string;
  writerNickname: string;
  writerId?: string;
  writeDate: string;
  isReply: boolean;
  parentCommentId?: string;
  likeCount?: number;
  isWriter?: boolean;
  attachmentImageUrl?: string;
}

/**
 * Options for fetching member posts
 */
export interface FetchMemberPostsOptions {
  /** Last article ID seen - only fetch newer articles */
  cursor?: string;
  /** Maximum number of posts to fetch (default: 20) */
  limit?: number;
  /** For first run, how many days back to look (default: 7) */
  backfillDays?: number;
}

/**
 * Result of fetchMemberPosts
 */
export interface NaverCafeMemberPostsResult {
  /** Fetched posts with full content */
  posts: NaverCafePostData[];
  /** Next cursor (most recent article ID) for incremental fetching */
  nextCursor: string | null;
  /** Whether there are more posts available */
  hasMore: boolean;
  /** Total count from API (if available) */
  totalCount?: number;
}

/**
 * Article from member list API (summary only)
 */
interface MemberArticleListItem {
  articleid: number;
  clubid: number;
  menuid?: number;
  subject: string;
  writeDateTimestamp: number;
  writernickname: string;
  writerMemberKey?: string;
  readcount: number;
  commentcount: number;
  representImage?: string;
}

/**
 * Custom error for Naver Cafe auth failures
 */
export class NaverCafeAuthError extends Error {
  constructor(
    message: string,
    public readonly expired: boolean = false
  ) {
    super(message);
    this.name = 'NaverCafeAuthError';
  }
}

/**
 * Member profile metadata from cafe member profile API
 */
export interface NaverCafeMemberProfile {
  nickname?: string;        // Member's display name
  avatar?: string;
  grade?: string;           // e.g., "매니저" - used as authorBio
  cafeName?: string;        // Cafe name for display
  cafeImageUrl?: string;    // Cafe representative image
  stats?: {
    visitCount: number;
    articleCount: number;
    commentCount: number;
    subscriberCount: number;
  };
  tradeReview?: {
    bestCount: number;
    goodCount: number;
    sorryCount: number;
  };
}

export interface NaverCafePostData {
  platform: 'naver';
  id: string;
  url: string;
  title: string;
  author: {
    id: string;
    name: string;
    url: string;
    memberKey?: string;
    avatar?: string;
    grade?: string;           // Cafe member grade/level name - used as authorBio
    stats?: {
      visitCount: number;
      articleCount: number;
      commentCount: number;
      subscriberCount: number;
    };
    tradeReview?: {
      bestCount: number;
      goodCount: number;
      sorryCount: number;
    };
  };
  text: string;
  timestamp: Date;
  likes: number;
  commentCount: number;
  viewCount: number;
  media: Array<{
    type: 'photo' | 'video';
    url: string;
    thumbnailUrl?: string;
  }>;
  // Cafe metadata
  cafeId: string;
  cafeName: string;
  cafeUrl: string;
  menuId?: number;
  menuName?: string;
  // Comments
  comments?: NaverCafeComment[];
}

export class NaverCafeLocalService {
  private cookie: string;
  private cafeIdCache: Map<string, string> = new Map();

  constructor(cookie: string) {
    // Clean cookie: remove newlines, carriage returns, and normalize spaces
    this.cookie = cookie
      .replace(/[\r\n\t]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Check if a URL is a Naver cafe URL
   */
  static isCafeUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      return hostname === 'cafe.naver.com' || hostname === 'm.cafe.naver.com';
    } catch {
      return false;
    }
  }

  /**
   * Parse cafe URL to extract cafeUrl and articleId
   */
  private parseUrl(url: string): { cafeUrl: string; articleId: string } | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Pattern 1: /ca-fe/cafes/{cafeId}/articles/{articleId} (new format)
      const cafeIdMatch = pathname.match(/^\/ca-fe\/cafes\/(\d+)\/articles\/(\d+)/);
      if (cafeIdMatch && cafeIdMatch[1] && cafeIdMatch[2]) {
        return {
          cafeUrl: cafeIdMatch[1], // This is already the numeric cafeId
          articleId: cafeIdMatch[2],
        };
      }

      // Pattern 2: /cafename/articleId (legacy format)
      const pathMatch = pathname.match(/^\/([^/]+)\/(\d+)/);
      if (pathMatch && pathMatch[1] && pathMatch[2]) {
        return {
          cafeUrl: pathMatch[1],
          articleId: pathMatch[2],
        };
      }

      // Pattern 3: Query string - /ArticleRead.nhn?clubid=xxx&articleid=xxx
      const clubId = urlObj.searchParams.get('clubid');
      const articleId = urlObj.searchParams.get('articleid');
      if (clubId && articleId) {
        return {
          cafeUrl: clubId,
          articleId: articleId,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve cafe URL (string name) to numeric cafeId
   * Fetches the cafe page and extracts g_sClubId from the HTML
   */
  private async resolveCafeId(cafeUrl: string): Promise<string> {
    // Check cache first
    const cached = this.cafeIdCache.get(cafeUrl);
    if (cached) {
      return cached;
    }

    // If cafeUrl is already numeric, return it
    if (/^\d+$/.test(cafeUrl)) {
      return cafeUrl;
    }

    // Fetch cafe page to get clubId (same approach as naver-blog-importer)
    const targetUrl = `${CAFE_BASE_URL}/${cafeUrl}`;

    try {
      const response = await requestUrl({
        url: targetUrl,
        method: 'GET',
        headers: this.buildHeaders(),
      });

      if (response.status === 200) {
        // Extract g_sClubId from script in HTML
        const match = response.text.match(/g_sClubId\s*=\s*["']?(\d+)["']?/);
        if (match && match[1]) {
          const cafeId = match[1];
          // Cache the result
          this.cafeIdCache.set(cafeUrl, cafeId);
          return cafeId;
        }
      }
    } catch {
      // Fall through to error
    }

    throw new Error(`Could not resolve cafeId for ${cafeUrl}`);
  }

  /**
   * Fetch a Naver cafe post
   */
  async fetchPost(url: string): Promise<NaverCafePostData> {
    const urlInfo = this.parseUrl(url);
    if (!urlInfo) {
      throw new Error(`Invalid Naver cafe URL: ${url}`);
    }

    // Resolve cafeId
    const cafeId = await this.resolveCafeId(urlInfo.cafeUrl);

    // Fetch article from API
    const apiUrl = `${CAFE_ARTICLE_API}/${cafeId}/articles/${urlInfo.articleId}`;

    const response = await requestUrl({
      url: apiUrl,
      method: 'GET',
      headers: this.buildApiHeaders(),
      throw: false,
    });

    // Check for authentication errors
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication required for private cafe. Please check your Naver cookies in settings.');
    }

    if (response.status !== 200) {
      throw new Error(`Failed to fetch cafe post: ${response.status}`);
    }

    const data = response.json as NaverArticleApiResponse;

    // Check for error in response body
    const result = data?.result;
    if ((result as Record<string, unknown>)?.['errorCode'] === 'UNAUTHORIZED' || (result as Record<string, unknown>)?.['errorCode'] === 'NOT_LOGGED_IN') {
      throw new Error('Authentication required for private cafe. Please check your Naver cookies in settings.');
    }

    // Parse the article
    const postData = this.parseArticle(data, url, urlInfo.cafeUrl, urlInfo.articleId, cafeId);

    // Fetch member profile for extended author metadata
    if (postData.author.memberKey) {
      try {
        const memberProfile = await this.fetchMemberProfile(cafeId, postData.author.memberKey);
        if (memberProfile) {
          // Merge member profile data into author
          postData.author.avatar = memberProfile.avatar || postData.author.avatar;
          postData.author.grade = memberProfile.grade || postData.author.grade;
          postData.author.stats = memberProfile.stats;
          postData.author.tradeReview = memberProfile.tradeReview;
        }
      } catch {
        // Failed to fetch member profile - continue with basic author info
      }
    }

    // Fetch comments if there are any
    if (postData.commentCount > 0) {
      try {
        postData.comments = await this.fetchComments(cafeId, urlInfo.articleId);
      } catch {
        postData.comments = [];
      }
    }

    return postData;
  }

  /**
   * Parse article from API response
   */
  private parseArticle(
    data: NaverArticleApiResponse,
    originalUrl: string,
    cafeUrl: string,
    articleId: string,
    cafeId: string
  ): NaverCafePostData {
    const result = data?.result;
    const article = result?.article;
    if (!article) {
      throw new Error('Invalid article response structure');
    }

    // Extract cafe info from result.cafe
    const cafe = result?.cafe || {};
    const menu = (article.menu || {}) as Record<string, unknown>;

    // Handle scraped content (blog posts shared to cafe)
    const scrap = article.scrap as Record<string, unknown> | undefined;
    const scrapContentHtml = (scrap?.contentHtml || '') as string;
    const userContentHtml = (article.contentHtml || article.content || '') as string;

    // Process contentElements - build image map for placeholders
    // Naver API uses [[[CONTENT-ELEMENT-N]]] placeholders in contentHtml
    const contentElements = ((scrap?.contentElements || []) as Array<Record<string, unknown>>);
    const extractedImages: string[] = [];
    const placeholderMap = new Map<string, string>();

    if (contentElements.length > 0) {
      contentElements.forEach((element, index) => {
        const placeholder = `[[[CONTENT-ELEMENT-${index}]]]`;
        const elementType = element.type as string;
        const elementJson = element.json as Record<string, unknown> | undefined;

        if (elementType === 'IMAGE' && elementJson?.image) {
          const imageData = elementJson.image as Record<string, unknown>;
          let imageUrl = imageData.url as string;
          if (imageUrl) {
            // Convert dthumb proxy URL to direct image URL
            imageUrl = this.enhanceImageUrl(imageUrl);
            extractedImages.push(imageUrl);
            placeholderMap.set(placeholder, `![Image](${imageUrl})`);
          }
        }
      });
    }

    // Build full content: user comment + scraped content
    let fullContent = '';

    // Add user's comment/note ONLY if this is a scrap post and user added a comment
    // For regular posts (non-scrap), userContentHtml IS the main content, not a comment
    if (scrap && userContentHtml && userContentHtml.trim()) {
      const userComment = this.convertHtmlToMarkdown(userContentHtml);
      if (userComment.trim()) {
        fullContent += `> ${userComment.trim().replace(/\n/g, '\n> ')}\n\n`;
      }
    }

    // Add scrap source info if exists
    if (scrap) {
      const sourceUrl = (scrap.linkHtml as string || '').match(/href=['"]([^'"]+)['"]/)?.[1] || '';
      const sourceTitle = (scrap.titleHtml as string || '').replace(/<[^>]+>/g, '').trim();
      if (sourceUrl) {
        fullContent += `**출처**: [${sourceTitle || sourceUrl}](${sourceUrl})\n\n---\n\n`;
      }
    }

    // Add main content (scraped or original)
    const mainContentHtml = scrapContentHtml || userContentHtml;
    let mainContent = this.convertHtmlToMarkdown(mainContentHtml);

    // Replace placeholders with actual images AFTER markdown conversion
    // The placeholders survive as text through the HTML-to-markdown conversion
    let placeholdersReplaced = 0;
    Array.from(placeholderMap.entries()).forEach(([placeholder, imgMarkdown]) => {
      if (mainContent.includes(placeholder)) {
        mainContent = mainContent.replace(placeholder, `\n\n${imgMarkdown}\n\n`);
        placeholdersReplaced++;
      }
    });
    // Clean up any remaining placeholders
    mainContent = mainContent.replace(/\[\[\[CONTENT-ELEMENT-\d+\]\]\]/g, '');

    // Only append contentElements images if:
    // 1. No placeholders were replaced AND
    // 2. convertHtmlToMarkdown didn't extract any images (check for ![ pattern)
    // This prevents duplicate images and preserves DOM order
    const hasImagesInContent = mainContent.includes('![');
    if (placeholdersReplaced === 0 && extractedImages.length > 0 && !hasImagesInContent) {
      mainContent += '\n\n';
      for (const imageUrl of extractedImages) {
        mainContent += `![Image](${imageUrl})\n\n`;
      }
    }

    fullContent += mainContent;
    const textContent = fullContent.trim();

    // Extract media
    const media: NaverCafePostData['media'] = [];

    // First, use images extracted from contentElements (scrap posts)
    // Note: extractedImages already have enhanceImageUrl applied
    if (extractedImages.length > 0) {
      for (const imageUrl of extractedImages) {
        media.push({
          type: 'photo',
          url: imageUrl,
        });
      }
    }

    // If no extractedImages, try article.imageList
    if (media.length === 0 && article.imageList && Array.isArray(article.imageList)) {
      for (const imgRaw of article.imageList) {
        const img = imgRaw as Record<string, unknown>;
        const imgUrl = (typeof img.url === 'string' ? img.url : null) || (typeof img.imageUrl === 'string' ? img.imageUrl : null);
        if (imgUrl) {
          media.push({
            type: 'photo',
            url: this.enhanceImageUrl(imgUrl),
            thumbnailUrl: typeof img.thumbnailUrl === 'string' ? img.thumbnailUrl : undefined,
          });
        }
      }
    }

    // Extract from HTML if still no images
    if (media.length === 0) {
      const imgMatches = Array.from(mainContentHtml.matchAll(/<img[^>]+src=["']([^"']+)["']/gi));
      for (const match of imgMatches) {
        if (match[1] && !match[1].includes('cafe_default')) {
          media.push({
            type: 'photo',
            url: this.enhanceImageUrl(match[1]),
          });
        }
      }
    }

    // Parse author
    const writer = (article.writer || {}) as Record<string, unknown>;

    // Parse timestamp
    let timestamp: Date;
    if (article.writeDate) {
      timestamp = new Date(article.writeDate as string | number);
    } else if (article.writeDateTimestamp) {
      timestamp = new Date(article.writeDateTimestamp as string | number);
    } else {
      timestamp = new Date();
    }

    // Get cafe name - prefer pcCafeName for full name, fallback to name
    const rawCafeName = (cafe.pcCafeName || cafe.name || cafeUrl) as string;
    const cafeName = this.decodeHtmlEntities(rawCafeName);

    // Extract author avatar (from article.profileImageUrl or writer fields)
    const authorAvatar = (article.profileImageUrl
      || writer.image
      || writer.imageUrl
      || writer.profileImageUrl
      || undefined) as string | undefined;

    // Extract author grade/level if available
    const authorGrade = (article.memberGrade
      || article.memberLevel
      || writer.grade
      || writer.level
      || writer.memberLevelName
      || undefined) as string | undefined;

    return {
      platform: 'naver',
      id: articleId,
      url: originalUrl,
      title: (article.subject || 'Untitled') as string,
      author: {
        id: (writer.memberId || writer.id || 'unknown') as string,
        name: (writer.nick || writer.nickName || writer.memberNickName || 'Unknown') as string,
        // Member profile URL format: cafe.naver.com/f-e/cafes/{cafeId}/members/{memberKey}
        url: writer.memberKey
          ? `https://cafe.naver.com/f-e/cafes/${cafeId}/members/${writer.memberKey as string}`
          : `https://cafe.naver.com/${cafeUrl}`,
        memberKey: (writer.memberKey || article.memberKey) as string | undefined,
        avatar: authorAvatar,
        grade: authorGrade,
      },
      text: textContent,
      timestamp,
      likes: ((article.likeItCount || article.sympathyCount || 0) as number),
      commentCount: (article.commentCount || 0) as number,
      viewCount: (article.readCount || 0) as number,
      media,
      // Cafe metadata
      cafeId,
      cafeName,
      cafeUrl: `https://cafe.naver.com/${cafeUrl}`,
      menuId: menu.id ? Number(menu.id) : undefined,
      menuName: menu.name ? this.decodeHtmlEntities(menu.name as string) : undefined,
    };
  }

  /**
   * Fetch comments for an article
   */
  async fetchComments(cafeId: string, articleId: string): Promise<NaverCafeComment[]> {
    const CAFE_COMMENT_API = 'https://apis.naver.com/cafe-web/cafe-articleapi/v2/cafes';
    const allComments: NaverCafeComment[] = [];
    let page = 1;
    let hasMore = true;
    const maxPages = 10; // Safety limit

    while (hasMore && page <= maxPages) {
      try {
        const url = `${CAFE_COMMENT_API}/${cafeId}/articles/${articleId}/comments?page=${page}&perPage=100`;

        const response = await requestUrl({
          url,
          method: 'GET',
          headers: this.buildApiHeaders(),
          throw: false,
        });

        if (response.status !== 200) {
          break;
        }

        const data = response.json as NaverArticleApiResponse;
        const comments = this.parseCommentsFromApiJson(data);

        if (comments.length === 0) {
          hasMore = false;
        } else {
          allComments.push(...comments);
          page++;
        }

        // Check if there are more pages
        const result = data?.result as (typeof data.result & { hasNext?: boolean }) | undefined;
        if (result?.hasNext === false) {
          hasMore = false;
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch {
        break;
      }
    }

    return allComments;
  }

  /**
   * Parse comments from API JSON response
   */
  private parseCommentsFromApiJson(data: NaverArticleApiResponse): NaverCafeComment[] {
    const comments: NaverCafeComment[] = [];
    const result = data?.result;

    if (!result) return comments;

    // Try different response structures
    let commentList: NaverCafeRawComment[] | undefined;

    const commentsObj = result?.comments;
    if (commentsObj) {
      if (Array.isArray(commentsObj)) {
        commentList = commentsObj as unknown as NaverCafeRawComment[];
      } else if (typeof commentsObj === 'object' && commentsObj !== null && 'items' in commentsObj) {
        const items = (commentsObj as { items: unknown }).items;
        if (Array.isArray(items)) {
          commentList = items as unknown as NaverCafeRawComment[];
        }
      }
    }

    if (!commentList) {
      const directList = result?.commentList;
      if (directList && Array.isArray(directList)) {
        commentList = directList as NaverCafeRawComment[];
      }
    }

    if (!commentList || !Array.isArray(commentList)) return comments;

    for (const comment of commentList) {
      // Parse main comment
      const parsedComment = this.parseSingleComment(comment, false);
      if (parsedComment) {
        comments.push(parsedComment);
      }

      // Parse replies (nested in replyList)
      const replyList = comment.replyList;
      if (replyList && Array.isArray(replyList)) {
        for (const reply of replyList) {
          const parentId = String(comment.id ?? comment.commentId ?? '');
          const parsedReply = this.parseSingleComment(reply, true, parentId);
          if (parsedReply) {
            comments.push(parsedReply);
          }
        }
      }
    }

    return comments;
  }

  /**
   * Parse a single comment object
   */
  private parseSingleComment(
    comment: NaverCafeRawComment,
    isReply: boolean,
    parentCommentId?: string
  ): NaverCafeComment | null {
    const writer = comment.writer || {};
    const image = comment.image;

    // Get content
    const content = comment.content || '';

    // Skip deleted comments
    if (comment.isDeleted === true) return null;
    if (!content.trim() && !image) return null;

    // Parse timestamp
    const writeTimestamp = comment.updateDate || comment.writeDate || comment.createDate;
    const writeDate = writeTimestamp
      ? this.formatCommentDate(new Date(writeTimestamp))
      : '';

    // Determine if reply
    const numericId = comment.id;
    const refId = comment.refId;
    const actualIsReply = isReply ||
      (comment.isRef === true) ||
      (refId !== undefined && numericId !== undefined && refId !== numericId);
    const actualParentId = parentCommentId ||
      (actualIsReply && refId ? String(refId) : undefined);

    // Get attachment image URL
    let attachmentImageUrl: string | undefined;
    if (image) {
      attachmentImageUrl = image.url || image.src || image.imageUrl;
    }

    const commentId = String(comment.id ?? comment.commentId ?? '');

    return {
      commentId,
      content: content.trim(),
      writerNickname: (writer.nick || writer.nickname || 'Unknown').trim(),
      writerId: writer.id || writer.memberKey,
      writeDate,
      isReply: actualIsReply,
      parentCommentId: actualParentId,
      likeCount: comment.sympathyCount || comment.likeCount,
      isWriter: comment.isArticleWriter || comment.articleWriter,
      attachmentImageUrl,
    };
  }

  /**
   * Format comment date to readable string
   */
  private formatCommentDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day}. ${hours}:${minutes}`;
  }

  /**
   * Convert HTML to Markdown using cheerio (same as naver-blog-importer)
   * Handles Naver Smart Editor HTML structure
   */
  private convertHtmlToMarkdown(html: string): string {
    if (!html || !html.trim()) {
      return '';
    }

    const $ = cheerio.load(html);
    let content = '';

    // Find .se-main-container first, then .se-component
    const mainContainer = $('.se-main-container');
    let components: Element[];

    if (mainContainer.length > 0) {
      components = mainContainer.find('.se-component').toArray();
      if (components.length === 0) {
        components = mainContainer.find('.se-section').toArray();
      }
    } else {
      components = $('.se-component').toArray();
      if (components.length === 0) {
        components = $('.se-section').toArray();
      }
    }

    // Check if this is a scrap/quoted blog post (has se-component-content with text)
    // Scrap posts have a different structure that needs special handling
    const isScrapContent = $('.se-component-content').length > 0 &&
                           $('.se-component-content').find('p').length > 0 &&
                           !$('.se-main-container').length;

    if (components.length > 0 && !isScrapContent) {
      for (const component of components) {
        const $component = $(component);
        content += this.processSeComponent($component, $);
      }
    }

    // Handle scrap/quoted blog posts - process wrapper divs in DOM order
    // Each wrapper div contains either text (p tags) or image (se-section-image)
    // Processing in DOM order preserves the original content sequence
    if (isScrapContent || !content.trim()) {
      $('div[style*="margin"]').each((_, wrapper) => {
        const $wrapper = $(wrapper);
        const $componentContent = $wrapper.find('.se-component-content');

        if ($componentContent.length > 0) {
          // Check if this is an image section
          const $imageSection = $componentContent.find('.se-section-image');
          if ($imageSection.length > 0) {
            // This is an image placeholder - will be replaced later
            // Look for [[[CONTENT-ELEMENT-N]]] placeholder
            const placeholderMatch = $componentContent.text().match(/\[\[\[CONTENT-ELEMENT-\d+\]\]\]/);
            if (placeholderMatch) {
              content += placeholderMatch[0] + '\n\n';
            }
            return;
          }

          // Check for hr
          if ($wrapper.find('hr').length > 0) {
            content += '---\n\n';
            return;
          }

          // Extract text from p tags
          $componentContent.find('p').each((_, p) => {
            const text = $(p).text().trim();
            // Skip empty paragraphs and zero-width spaces
            if (text && text !== '\u200B' && text !== '​') {
              content += text + '\n\n';
            }
          });
        } else {
          // Fallback for non-component-content wrappers
          // Check for image
          const img = $wrapper.find('img').first();
          if (img.length > 0) {
            const src = img.attr('src');
            if (src && this.isContentImage(src)) {
              content += `![Image](${this.enhanceImageUrl(src)})\n\n`;
            }
            return;
          }

          // Check for hr
          if ($wrapper.find('hr').length > 0) {
            content += '---\n\n';
            return;
          }

          // Extract text from p tags
          $wrapper.find('p').each((_, p) => {
            const text = $(p).text().trim();
            if (text && text !== '\u200B') {
              content += text + '\n\n';
            }
          });
        }
      });
    }

    // If still empty, extract all p tags
    if (!content.trim()) {
      $('p').each((_, p) => {
        const text = $(p).text().trim();
        if (text && text !== '\u200B') {
          content += text + '\n\n';
        }
      });
    }

    return this.cleanContent(content);
  }

  /**
   * Process a single se-component (from naver-blog-importer)
   */
  private processSeComponent($component: Cheerio<AnyNode>, $: CheerioAPI): string {
    let content = '';

    // Text component
    if ($component.hasClass('se-text') || $component.hasClass('se-section-text')) {
      const textModule = $component.find('.se-module-text');
      if (textModule.length > 0) {
        // Process all direct children in DOM order
        textModule.children().each((_, child) => {
          const $child = $(child);
          const tagName = child.tagName?.toLowerCase();

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

        // Fallback
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
      // Try to extract video metadata from data-module-v2
      const scriptEl = $component.find('script.__se_module_data');
      if (scriptEl.length > 0) {
        const moduleData = scriptEl.attr('data-module-v2');
        if (moduleData) {
          try {
            const data = JSON.parse(moduleData) as Record<string, unknown>;
            const dataData = data.data as Record<string, unknown> | undefined;
            if (data.type === 'v2_video' && dataData?.vid && dataData?.inkey) {
              // Use placeholder with vid and inkey for later video download
              content += `<!--VIDEO:${dataData.vid as string | number}:${dataData.inkey as string | number}-->\n\n`;
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
      /emoticon/i, /sticker/i, /1x1/, /spacer/i
    ];
    for (const pattern of skipPatterns) {
      if (pattern.test(src)) return false;
    }
    return src.startsWith('http') || src.startsWith('//');
  }

  /**
   * Enhance image URL to get higher quality
   * Also converts old postfiles*.naver.net URLs to postfiles.pstatic.net
   * to avoid SSL certificate errors (ERR_CERT_COMMON_NAME_INVALID)
   */
  private enhanceImageUrl(src: string): string {
    let url = src;

    // Handle dthumb proxy URLs
    if (url.includes('dthumb-phinf.pstatic.net')) {
      try {
        const urlObj = new URL(url);
        const srcParam = urlObj.searchParams.get('src');
        if (srcParam) {
          url = srcParam.replace(/^["']|["']$/g, '');
        }
      } catch { /* ignore */ }
    }

    // Convert http to https
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://');
    }

    // Convert postfiles*.naver.net to postfiles.pstatic.net to avoid SSL cert errors
    // Old domains like postfiles8.naver.net have certificate issues
    if (url.match(/postfiles\d*\.naver\.net/)) {
      url = url.replace(/postfiles\d*\.naver\.net/, 'postfiles.pstatic.net');
    }

    // For postfiles URLs, use full size
    if (url.includes('postfiles')) {
      if (url.includes('type=')) {
        url = url.replace(/type=w\d+/gi, 'type=w2000');
        url = url.replace(/type=cafe_wa\d+/gi, 'type=w2000');
      } else {
        url += (url.includes('?') ? '&' : '?') + 'type=w2000';
      }
    }

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
   * Decode HTML entities (e.g., &#9776; → ☰)
   */
  private decodeHtmlEntities(text: string): string {
    if (!text) return text;

    // Decode numeric HTML entities (&#xxx; and &#xHHH;)
    return text
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
      // Common named entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }

  /**
   * Build headers for general requests (HTML pages)
   * Matches naver-blog-importer's getHeaders()
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
   * Build headers for API requests
   * Matches naver-blog-importer's makeRequest headers
   */
  private buildApiHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://cafe.naver.com/',
      'Origin': 'https://cafe.naver.com',
      'User-Agent': USER_AGENT,
    };

    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    return headers;
  }

  /**
   * Extract video metadata from content text
   * Finds all <!--VIDEO:vid:inkey--> placeholders
   */
  extractVideoMetadata(content: string): NaverVideoMetadata[] {
    const videos: NaverVideoMetadata[] = [];
    const pattern = /<!--VIDEO:([^:]+):([^-]+)-->/g;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      if (match[1] && match[2]) {
        videos.push({
          vid: match[1],
          inkey: match[2],
        });
      }
    }

    return videos;
  }

  /**
   * Fetch video URL from Naver Video API
   */
  async fetchVideoUrl(vid: string, inkey: string): Promise<NaverVideoQuality | null> {
    try {
      const apiUrl = `${NAVER_VIDEO_API}/${vid}?key=${inkey}&sid=5`;

      const response = await requestUrl({
        url: apiUrl,
        method: 'GET',
        headers: {
          'Accept': '*/*',
          'User-Agent': USER_AGENT,
        },
      });

      if (response.status !== 200) {
        return null;
      }

      const data = response.json as Record<string, unknown>;
      const qualities: NaverVideoQuality[] = [];

      // Extract video list from response
      const videos = data.videos as Record<string, unknown> | undefined;
      if (videos?.list && Array.isArray(videos.list)) {
        for (const videoRaw of videos.list) {
          const video = videoRaw as Record<string, unknown>;
          const enc = video.encodingOption as Record<string, unknown> | undefined;
          qualities.push({
            name: typeof enc?.name === 'string' ? enc.name : 'unknown',
            width: typeof enc?.width === 'number' ? enc.width : 0,
            height: typeof enc?.height === 'number' ? enc.height : 0,
            source: typeof video.source === 'string' ? video.source : '',
          });
        }
      }

      // Sort by resolution (highest first) and return best quality
      // Prefer 1080p for reasonable file size
      qualities.sort((a, b) => {
        if (a.height === 1080 && b.height !== 1080) return -1;
        if (b.height === 1080 && a.height !== 1080) return 1;
        return b.height - a.height;
      });

      const bestQuality = qualities[0];
      if (bestQuality) {
        return bestQuality;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch member profile data from cafe member profile API
   * API: GET https://apis.naver.com/cafe-web/cafe-cafeinfo-api/v3.0/cafes/{cafeId}/members/{memberKey}/profiles
   *
   * @param cafeId - Numeric cafe ID
   * @param memberKey - Member's unique key (e.g., "u_MzRnJDmSw1KN6P2rjn4NjAl2D1wwi8ADsXCCvCnMI")
   * @returns Member profile metadata or null if fetch fails
   */
  async fetchMemberProfile(cafeId: string, memberKey: string): Promise<NaverCafeMemberProfile | null> {
    if (!memberKey) {
      return null;
    }

    const apiUrl = `${CAFE_MEMBER_PROFILE_API}/${cafeId}/members/${memberKey}/profiles`;

    try {
      const response = await requestUrl({
        url: apiUrl,
        method: 'GET',
        headers: {
          ...this.buildApiHeaders(),
          'X-Cafe-Product': 'pc',
        },
        throw: false,
      });

      if (response.status !== 200) {
        return null;
      }

      const data = response.json as Record<string, unknown>;
      const result = data?.result as Record<string, unknown> | undefined;

      if (!result) {
        return null;
      }

      // Extract profile data
      // Try various possible field names for nickname
      const nickname = (typeof result.nickname === 'string' ? result.nickname : null)
        || (typeof result.memberNickname === 'string' ? result.memberNickname : null)
        || (typeof result.memberNick === 'string' ? result.memberNick : null)
        || (typeof result.nick === 'string' ? result.nick : null)
        || (typeof result.displayName === 'string' ? result.displayName : null)
        || undefined;

      // Prefer pcCafeName for full cafe name (may include subtitle in parentheses)
      // Fall back to cafeName if pcCafeName is not available
      const cafe = result.cafe as Record<string, unknown> | undefined;
      const rawCafeName = (typeof result.pcCafeName === 'string' ? result.pcCafeName : null)
        || (typeof cafe?.pcCafeName === 'string' ? cafe.pcCafeName : null)
        || (typeof result.cafeName === 'string' ? result.cafeName : null)
        || (typeof cafe?.name === 'string' ? cafe.name : null)
        || undefined;
      const cafeName = rawCafeName ? this.decodeHtmlEntities(rawCafeName) : undefined;

      const memberLevel = result.memberLevel as Record<string, unknown> | undefined;
      const profile: NaverCafeMemberProfile = {
        nickname,
        avatar: typeof result.profileImageUrl === 'string' ? result.profileImageUrl : undefined,
        grade: typeof memberLevel?.levelName === 'string' ? memberLevel.levelName : undefined,
        cafeName,
      };

      // Extract cafe image if available (might be nested)
      if (cafe) {
        profile.cafeImageUrl = (typeof cafe.cafeImageUrl === 'string' ? cafe.cafeImageUrl : null) || (typeof cafe.imageUrl === 'string' ? cafe.imageUrl : undefined);
      }

      // Extract member stats if available
      const memberStat = result.memberStat as Record<string, unknown> | undefined;
      if (memberStat) {
        profile.stats = {
          visitCount: typeof memberStat.visitCount === 'number' ? memberStat.visitCount : 0,
          articleCount: typeof memberStat.articleCount === 'number' ? memberStat.articleCount : 0,
          commentCount: typeof memberStat.commentCount === 'number' ? memberStat.commentCount : 0,
          subscriberCount: typeof memberStat.subscriberCount === 'number' ? memberStat.subscriberCount : 0,
        };
      }

      // Extract trade review if available
      const tradeReview = result.tradeReview as Record<string, unknown> | undefined;
      if (tradeReview) {
        profile.tradeReview = {
          bestCount: typeof tradeReview.bestCount === 'number' ? tradeReview.bestCount : 0,
          goodCount: typeof tradeReview.goodCount === 'number' ? tradeReview.goodCount : 0,
          sorryCount: typeof tradeReview.sorryCount === 'number' ? tradeReview.sorryCount : 0,
        };
      }

      return profile;
    } catch {
      return null;
    }
  }

  /**
   * Fetch member's article list for subscription polling
   *
   * This method fetches new posts from a cafe member using the cafe-mobile API.
   * Uses cursor-based pagination to only fetch posts newer than the last seen post.
   *
   * @param cafeId - Numeric cafe ID
   * @param memberKey - Member's unique key (from profile URL)
   * @param options - Pagination and filtering options
   * @returns Posts with full content, next cursor, and pagination info
   */
  async fetchMemberPosts(
    cafeId: string,
    memberKey: string,
    options?: FetchMemberPostsOptions
  ): Promise<NaverCafeMemberPostsResult> {
    const limit = options?.limit || 20;
    const backfillDays = options?.backfillDays || 7;
    const cursor = options?.cursor;

    const posts: NaverCafePostData[] = [];
    let page = 1;
    let hasMore = true;
    let totalCount: number | undefined;
    const maxPages = 10; // Safety limit

    // Calculate cutoff date for backfill (first run only)
    const cutoffDate = cursor ? null : new Date();
    if (cutoffDate) {
      cutoffDate.setDate(cutoffDate.getDate() - backfillDays);
    }

    while (posts.length < limit && hasMore && page <= maxPages) {
      // Fetch article list from cafe-mobile API
      const params = new URLSearchParams({
        'search.cafeId': cafeId,
        'search.memberKey': memberKey,
        'search.perPage': String(DEFAULT_PER_PAGE),
        'search.page': String(page),
        'requestFrom': 'A',
      });

      const response = await requestUrl({
        url: `${CAFE_MEMBER_ARTICLES_API}?${params.toString()}`,
        method: 'GET',
        headers: this.buildMemberApiHeaders(),
        throw: false,
      });

      // Check for authentication errors
      if (response.status === 401 || response.status === 403) {
        throw new NaverCafeAuthError(
          'Naver cookie expired. Please update in settings.',
          true
        );
      }

      if (response.status !== 200) {
        throw new Error(`Member API error: ${response.status}`);
      }

      const data = response.json as Record<string, unknown>;
      const message = data?.message as Record<string, unknown> | undefined;
      const result = message?.result as Record<string, unknown> | undefined;

      // Check API-level auth errors
      if (message?.status !== '200') {
        const errorObj = message?.error as Record<string, unknown> | undefined;
        const errorCode = errorObj?.code;
        if (errorCode === 'UNAUTHORIZED' || errorCode === 'NOT_LOGGED_IN') {
          throw new NaverCafeAuthError(
            'Naver session expired. Please re-login and update cookie.',
            true
          );
        }
        throw new Error(typeof errorObj?.msg === 'string' ? errorObj.msg : 'Unknown API error');
      }

      const articleList: MemberArticleListItem[] = Array.isArray(result?.articleList) ? (result.articleList as MemberArticleListItem[]) : [];

      if (articleList.length === 0) {
        hasMore = false;
        break;
      }

      // Save total count from first page
      const pageNavFirst = result?.pageNavigation as Record<string, unknown> | undefined;
      if (page === 1 && typeof pageNavFirst?.totalCount === 'number') {
        totalCount = pageNavFirst.totalCount;
      }

      // Process each article
      for (const article of articleList) {
        const articleId = String(article.articleid);

        // Stop if we've reached the cursor (already seen)
        if (cursor && articleId === cursor) {
          hasMore = false;
          break;
        }

        // For first run (no cursor), apply backfill filter
        if (cutoffDate) {
          const articleDate = new Date(article.writeDateTimestamp);
          if (articleDate < cutoffDate) {
            hasMore = false;
            break;
          }
        }

        // Fetch full post data
        try {
          const articleUrl = `https://cafe.naver.com/ca-fe/cafes/${cafeId}/articles/${articleId}`;
          const postData = await this.fetchPost(articleUrl);
          posts.push(postData);

          if (posts.length >= limit) break;

          // Rate limit: small delay between fetches (300ms)
          await new Promise(r => setTimeout(r, 300));
        } catch {
          // Continue with next article instead of failing completely
        }
      }

      // Check pagination
      const pageNav = result?.pageNavigation as Record<string, unknown> | undefined;
      if (pageNav) {
        const currentPage = typeof pageNav.currentPage === 'number' ? pageNav.currentPage : 0;
        const countPerPage = typeof pageNav.countPerPage === 'number' ? pageNav.countPerPage : 0;
        const totalCount2 = typeof pageNav.totalCount === 'number' ? pageNav.totalCount : 0;
        hasMore = hasMore && (currentPage * countPerPage < totalCount2);
      } else {
        hasMore = hasMore && articleList.length >= DEFAULT_PER_PAGE;
      }

      page++;

      // Small delay between page fetches
      if (hasMore && posts.length < limit) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Next cursor is the most recent article ID (first in list)
    const firstPost = posts[0];
    const nextCursor = firstPost ? firstPost.id : cursor || null;

    return {
      posts,
      nextCursor,
      hasMore,
      totalCount,
    };
  }

  /**
   * Build headers for member articles API
   */
  private buildMemberApiHeaders(): Record<string, string> {
    // Use same headers as buildApiHeaders() - the simple Referer works!
    // Specific member path in Referer causes ERR_BLOCKED_BY_CLIENT in Electron
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Origin': 'https://cafe.naver.com',
      'Referer': 'https://cafe.naver.com/',
      'User-Agent': USER_AGENT,
    };

    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    return headers;
  }
}
