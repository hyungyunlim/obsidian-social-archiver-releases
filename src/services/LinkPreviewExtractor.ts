import type { IService } from './base/IService';
import type { Platform } from '@/types/post';
import { PLATFORM_DEFINITIONS } from '@/shared/platforms/definitions';

/**
 * URL extraction options
 */
export interface ExtractionOptions {
  maxLinks?: number;
  excludeImages?: boolean;
  excludePlatformUrls?: boolean;
}

/**
 * URL extraction result with metadata
 */
export interface ExtractedLink {
  url: string;
}

export interface ExtractionResult {
  links: ExtractedLink[];
  totalFound: number;
  excluded: number;
}

/**
 * Platform-specific URL patterns to exclude
 * Derived from centralized PLATFORM_DEFINITIONS
 */
const PLATFORM_DOMAINS = new Set([
  // Flatten all domains from platform definitions
  ...Object.values(PLATFORM_DEFINITIONS).flatMap(def => def.domains),
  // Legacy aliases not in definitions
  'twitter.com',
  't.co',
  'instagr.am',
  'lnkd.in',
  'redd.it',
  'pin.it',
  // Additional Mastodon instances (allowCustomDomains = true means many possible)
  'mastodon.online',
  'mastodon.world',
  'mastodon.cloud',
  'mstdn.social',
  'fosstodon.org',
]);

/**
 * Image and video file extensions to exclude
 */
const MEDIA_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'm4v',
]);

/**
 * LinkPreviewExtractor - Extracts URLs from post content for link preview generation
 *
 * Single Responsibility: URL extraction and filtering
 */
export class LinkPreviewExtractor implements IService {
  private maxLinks: number;
  private excludeImages: boolean;
  private excludePlatformUrls: boolean;

  // URL extraction regex pattern
  // Matches: http(s):// followed by any characters except whitespace and angle brackets
  // Negative lookahead excludes common media file extensions
  private readonly urlPattern = /https?:\/\/[^\s<>]+/gi;

  constructor(options: ExtractionOptions = {}) {
    this.maxLinks = options.maxLinks ?? 3;
    this.excludeImages = options.excludeImages ?? true;
    this.excludePlatformUrls = options.excludePlatformUrls ?? true;
  }

  initialize(): void {
    // No async initialization needed
  }

  dispose(): void {
    // No cleanup needed
  }

  isHealthy(): boolean {
    return true;
  }

  /**
   * Extract URLs from content text
   * Returns array of URL strings (up to maxLinks)
   */
  extractUrls(content: string, platform?: Platform): ExtractedLink[] {
    const result = this.extractUrlsWithDetails(content, platform);
    return result.links;
  }

  /**
   * Extract URLs with detailed extraction statistics
   */
  extractUrlsWithDetails(content: string, _platform?: Platform): ExtractionResult {
    if (!content || typeof content !== 'string') {
      return {
        links: [],
        totalFound: 0,
        excluded: 0,
      };
    }

    // STEP 1: Extract URLs from markdown links [text](url)
    const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    const markdownMatches = Array.from(content.matchAll(markdownLinkPattern));

    // Clean up trailing punctuation and brackets from markdown URLs
    const cleanedMarkdownUrls = markdownMatches.map(match => {
      let url = match[2] || '';
      // Remove trailing punctuation and brackets
      url = url.replace(/[.,;:!?\]"]+$/, '');
      return url;
    }).filter(url => url.length > 0);

    // STEP 2: Remove markdown links from content to avoid double-matching
    // Also remove trailing punctuation/brackets after markdown links
    const contentWithoutMarkdown = content.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)[)\].,;:!?]*/g, '');

    // STEP 3: Extract plain URLs from remaining content
    const plainMatches = Array.from(contentWithoutMarkdown.matchAll(this.urlPattern));

    // Clean up trailing punctuation from plain URLs
    const cleanedPlainUrls = plainMatches.map(match => {
      let url = match[0];
      url = url.replace(/[.,;:!?\]"]+$/, '');
      return url;
    });

    // STEP 4: Combine both lists (markdown links first, then plain URLs)
    const allUrls = [...cleanedMarkdownUrls, ...cleanedPlainUrls];
    const totalFound = allUrls.length;

    if (allUrls.length === 0) {
      return {
        links: [],
        totalFound: 0,
        excluded: 0,
      };
    }

    // Filter and collect unique URLs
    const uniqueUrls = new Set<string>();
    const links: ExtractedLink[] = [];
    let excluded = 0;
    const excludedDetails: Array<{url: string, reason: string}> = [];

    for (const url of allUrls) {

      // Check if we've reached max links
      if (this.maxLinks > 0 && links.length >= this.maxLinks) {
        excluded += allUrls.length - (links.length + excluded);
        excludedDetails.push({ url, reason: 'maxLinks reached' });
        break;
      }

      // Skip duplicates
      if (uniqueUrls.has(url)) {
        excluded++;
        excludedDetails.push({ url, reason: 'duplicate' });
        continue;
      }

      // Apply filters
      if (this.shouldExcludeUrl(url)) {
        excluded++;
        const isPlatform = this.isPlatformUrl(new URL(url));
        const isMedia = this.isMediaUrl(new URL(url));
        excludedDetails.push({
          url,
          reason: isPlatform ? 'platform URL' : isMedia ? 'media URL' : 'invalid URL'
        });
        continue;
      }

      // Add to result
      uniqueUrls.add(url);
      links.push({ url });
    }

    return {
      links,
      totalFound,
      excluded,
    };
  }

  /**
   * Check if URL should be excluded based on filters
   */
  private shouldExcludeUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);

      // Check if it's an image/video URL
      if (this.excludeImages && this.isMediaUrl(urlObj)) {
        return true;
      }

      // Check if it's a platform-specific URL
      if (this.excludePlatformUrls && this.isPlatformUrl(urlObj)) {
        return true;
      }

      return false;
    } catch {
      // Invalid URL, exclude it
      return true;
    }
  }

  /**
   * Check if URL points to a media file
   */
  private isMediaUrl(urlObj: URL): boolean {
    const pathname = urlObj.pathname.toLowerCase();
    const extension = pathname.split('.').pop();

    if (!extension) {
      return false;
    }

    return MEDIA_EXTENSIONS.has(extension);
  }

  /**
   * Check if URL is from a social media platform
   */
  private isPlatformUrl(urlObj: URL): boolean {
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');

    // Check exact match
    if (PLATFORM_DOMAINS.has(hostname)) {
      return true;
    }

    // Check if it's a subdomain of a platform
    for (const domain of PLATFORM_DOMAINS) {
      if (hostname.endsWith(`.${domain}`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Update extraction options
   */
  setOptions(options: Partial<ExtractionOptions>): void {
    if (options.maxLinks !== undefined) {
      this.maxLinks = options.maxLinks;
    }
    if (options.excludeImages !== undefined) {
      this.excludeImages = options.excludeImages;
    }
    if (options.excludePlatformUrls !== undefined) {
      this.excludePlatformUrls = options.excludePlatformUrls;
    }
  }

  /**
   * Get current options
   */
  getOptions(): ExtractionOptions {
    return {
      maxLinks: this.maxLinks,
      excludeImages: this.excludeImages,
      excludePlatformUrls: this.excludePlatformUrls,
    };
  }

  /**
   * Get supported media extensions
   */
  getSupportedMediaExtensions(): string[] {
    return Array.from(MEDIA_EXTENSIONS);
  }

  /**
   * Get platform domains list
   */
  getPlatformDomains(): string[] {
    return Array.from(PLATFORM_DOMAINS);
  }
}
