import type { PostData, Platform } from '@/types/post';
import type { YamlFrontmatter } from '@/types/archive';
import type {
  FrontmatterCustomizationSettings,
  FrontmatterFieldVisibility,
  CustomFrontmatterProperty,
  FrontmatterPropertyType,
} from '@/types/settings';
import {
  FRONTMATTER_CORE_LOCKED_FIELDS,
  isArchiveOrganizationMode,
  normalizeFrontmatterFieldAliases,
  normalizeFrontmatterPropertyOrder
} from '@/types/settings';
import { DateNumberFormatter } from '../formatters/DateNumberFormatter';
import { TextFormatter } from '../formatters/TextFormatter';
import { TemplateEngine } from '../template/TemplateEngine';
import { uniqueStrings } from '@/utils/array';
import { normalizeUrlForDedup } from '@/utils/url';

/**
 * Normalize author URL for consistent storage
 * Handles Medium, Velog, and other platform-specific URL formats
 */
function normalizeAuthorUrl(url: string | undefined, platform: Platform): string | undefined {
  if (!url) return url;

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    // Medium: Normalize to medium.com/@username format
    // Handles: medium.com/@user, user.medium.com, and query params (?source=...)
    const isMedium = hostname === 'medium.com' || hostname === 'www.medium.com' || hostname.endsWith('.medium.com');
    if (isMedium) {
      // Remove query params
      let cleanUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}`;
      cleanUrl = cleanUrl.replace(/\/+$/, ''); // Remove trailing slashes

      if (hostname === 'medium.com' || hostname === 'www.medium.com') {
        // Extract @username from path
        const pathParts = parsedUrl.pathname.split('/').filter(p => p);
        const userPart = pathParts.find(p => p.startsWith('@'));
        if (userPart) {
          return `https://medium.com/${userPart.toLowerCase()}`;
        }
      } else if (hostname.endsWith('.medium.com')) {
        // Custom subdomain (e.g., startupgrind.medium.com) -> medium.com/@subdomain
        const parts = hostname.split('.');
        if (parts.length >= 3 && parts[0]) {
          return `https://medium.com/@${parts[0].toLowerCase()}`;
        }
      }
    }

    // Velog: Remove query params
    if (hostname === 'velog.io' || hostname === 'www.velog.io') {
      const cleanPath = parsedUrl.pathname.replace(/\/+$/, '');
      return `https://velog.io${cleanPath}`;
    }

    // Generic: Remove query params for RSS-based platforms
    if (platform === 'blog' || platform === 'substack' || platform === 'tumblr') {
      const cleanPath = parsedUrl.pathname.replace(/\/+$/, '');
      return `${parsedUrl.protocol}//${parsedUrl.hostname}${cleanPath}`;
    }

    return url;
  } catch {
    return url;
  }
}

/**
 * Options for frontmatter generation
 */
export interface FrontmatterOptions {
  customization?: FrontmatterCustomizationSettings;
}

const CORE_LOCKED_FRONTMATTER_FIELDS = new Set<string>(FRONTMATTER_CORE_LOCKED_FIELDS);

const CUSTOM_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const CATEGORY_FIELDS: Record<keyof FrontmatterFieldVisibility, string[]> = {
  authorDetails: ['authorHandle', 'authorAvatar', 'authorFollowers', 'authorPostsCount', 'authorBio', 'authorVerified'],
  engagement: ['likes', 'comments', 'shares', 'views'],
  aiAnalysis: ['ai_summary', 'sentiment', 'topics'],
  externalLinks: [
    'externalLink',
    'externalLinkTitle',
    'externalLinkDescription',
    'externalLinkImage',
    'linkPreviews',
  ],
  location: ['latitude', 'longitude', 'coordinates', 'location'],
  subscription: ['subscribed', 'subscriptionId'],
  seriesInfo: ['series', 'seriesUrl', 'seriesId', 'episode', 'totalEpisodes', 'starScore', 'genre', 'ageRating', 'finished', 'publishDay'],
  podcastInfo: ['channelTitle', 'audioUrl', 'audioSize', 'audioType', 'season', 'subtitle', 'hosts', 'guests', 'explicit'],
  reblogInfo: ['isReblog', 'originalAuthor', 'originalAuthorHandle', 'originalAuthorUrl', 'originalPostUrl', 'originalAuthorAvatar'],
  mediaMetadata: ['media_expired', 'media_expired_urls', 'processedUrls'],
  workflow: [
    'share',
    'archive',
    'originalUrl',
    'title',
    'videoId',
    'duration',
    'hasTranscript',
    'hasFormattedTranscript',
    'community',
    'communityUrl',
    'videoDownloaded',
    'videoDownloadFailed',
    'videoDownloadFailedCount',
    'videoDownloadFailedUrls',
    'videoTranscribed',
    'videoTranscriptionRequestedAt',
    'videoTranscriptionError',
    'videoTranscribedAt',
    'download_time',
    'archiveStatus',
    'errorMessage',
  ],
};

/**
 * FrontmatterGenerator - Generate YAML frontmatter for markdown files
 * Single Responsibility: YAML frontmatter generation and formatting
 */
export class FrontmatterGenerator {
  private dateNumberFormatter: DateNumberFormatter;
  private textFormatter: TextFormatter;

  constructor(dateNumberFormatter: DateNumberFormatter, textFormatter: TextFormatter) {
    this.dateNumberFormatter = dateNumberFormatter;
    this.textFormatter = textFormatter;
  }

  /**
   * Generate YAML frontmatter
   * @param postData - Post data to generate frontmatter for
   * @param options - Optional settings for frontmatter generation
   */
  generateFrontmatter(postData: PostData, options?: FrontmatterOptions): YamlFrontmatter {
    // Current timestamp in YYYY-MM-DD HH:mm format (consistent with published)
    const now = new Date();
    const archived = this.dateNumberFormatter.formatDate(now);
    const lastModified = this.dateNumberFormatter.formatDate(now);

    // Format original post date (YYYY-MM-DD HH:mm in local timezone)
    const published = this.dateNumberFormatter.formatDate(postData.metadata.timestamp);

    // Normalize author URL for consistent storage (removes query params, normalizes Medium subdomains)
    // For podcasts: keep the feed URL as-is (Workers already sets author.url to feed URL for subscriptions)
    const normalizedAuthorUrl = postData.platform === 'podcast'
      ? postData.author.url
      : normalizeAuthorUrl(postData.author.url, postData.platform);

    // Build frontmatter object, only including defined values
    const frontmatter: any = {
      share: false,
      platform: postData.platform,
      author: postData.author.name,
      authorUrl: normalizedAuthorUrl,
      // Extended author metadata (conditional inclusion)
      ...(postData.author.handle && { authorHandle: postData.author.handle }),
      // Store author avatar: prefer local path (as wikilink), fallback to external URL
      ...((postData.author.localAvatar || postData.author.avatar) && {
        authorAvatar: postData.author.localAvatar
          ? `[[${postData.author.localAvatar}]]` // Wrap local path in wikilink
          : postData.author.avatar, // Keep external URL as-is
      }),
      ...(postData.author.followers !== null &&
        postData.author.followers !== undefined && {
          authorFollowers: postData.author.followers,
        }),
      ...(postData.author.postsCount !== null &&
        postData.author.postsCount !== undefined && {
          authorPostsCount: postData.author.postsCount,
        }),
      ...(postData.author.bio && { authorBio: this.sanitizeBio(postData.author.bio, postData.platform === 'podcast') }),
      ...(postData.author.verified === true && { authorVerified: true }),
      published: published, // Original post date (YYYY-MM-DD HH:mm)
      archived: archived, // Archive timestamp (YYYY-MM-DD HH:mm)
      lastModified: lastModified, // Last modified timestamp (YYYY-MM-DD HH:mm)
      archive: false, // Default: not archived (visible in timeline)
      tags: [],
    };

    // Only add originalUrl if it exists (User posts don't have external URLs)
    if (postData.url) {
      frontmatter.originalUrl = postData.url;
    }

    // Only add optional fields if they have values
    if (postData.title) frontmatter.title = postData.title;
    if (postData.transcript?.raw) frontmatter.hasTranscript = true;
    if (postData.transcript?.formatted && postData.transcript.formatted.length > 0) frontmatter.hasFormattedTranscript = true;
    if (postData.videoId !== undefined) frontmatter.videoId = postData.videoId;
    if (postData.metadata.duration !== undefined) frontmatter.duration = postData.metadata.duration;
    if (postData.metadata.likes !== undefined) frontmatter.likes = postData.metadata.likes;
    if (postData.metadata.comments !== undefined) frontmatter.comments = postData.metadata.comments;
    if (postData.metadata.shares !== undefined) frontmatter.shares = postData.metadata.shares;
    if (postData.metadata.views !== undefined) frontmatter.views = postData.metadata.views;
    const uniqueLinkPreviews = uniqueStrings(postData.linkPreviews, normalizeUrlForDedup);
    if (uniqueLinkPreviews.length > 0) frontmatter.linkPreviews = uniqueLinkPreviews;
    // @ts-ignore - processedUrls is custom field for user posts
    const uniqueProcessedUrls = uniqueStrings(postData.processedUrls as string[] | undefined, normalizeUrlForDedup);
    if (uniqueProcessedUrls.length > 0) frontmatter.processedUrls = uniqueProcessedUrls;
    if (postData.ai?.summary) frontmatter.ai_summary = postData.ai.summary;
    if (postData.ai?.sentiment) frontmatter.sentiment = postData.ai.sentiment;
    if (postData.ai?.topics) frontmatter.topics = postData.ai.topics;

    // Subscription-related fields
    if (postData.subscribed) frontmatter.subscribed = true;
    if (postData.subscriptionId) frontmatter.subscriptionId = postData.subscriptionId;

    // Reddit community/subreddit info
    if (postData.content.community) {
      frontmatter.community = postData.content.community.name;
      frontmatter.communityUrl = postData.content.community.url;
    }

    // Reblog/repost info (Mastodon boost, Bluesky repost, X retweet)
    if (postData.isReblog && postData.quotedPost) {
      frontmatter.isReblog = true;
      frontmatter.originalAuthor = postData.quotedPost.author.name;
      frontmatter.originalAuthorHandle = postData.quotedPost.author.handle || postData.quotedPost.author.username;
      frontmatter.originalAuthorUrl = postData.quotedPost.author.url;
      frontmatter.originalPostUrl = postData.quotedPost.url;
      // Save original author's avatar if available (fetched from profile API for X retweets)
      if (postData.quotedPost.author.avatar) {
        frontmatter.originalAuthorAvatar = postData.quotedPost.author.avatar;
      }
    }

    // External link metadata (Facebook, X, etc.)
    if (postData.metadata.externalLink) frontmatter.externalLink = postData.metadata.externalLink;
    if (postData.metadata.externalLinkTitle) frontmatter.externalLinkTitle = postData.metadata.externalLinkTitle;
    if (postData.metadata.externalLinkDescription) frontmatter.externalLinkDescription = postData.metadata.externalLinkDescription;
    if (postData.metadata.externalLinkImage) frontmatter.externalLinkImage = postData.metadata.externalLinkImage;

    // Google Maps location coordinates
    if (postData.metadata.latitude !== undefined) frontmatter.latitude = postData.metadata.latitude;
    if (postData.metadata.longitude !== undefined) frontmatter.longitude = postData.metadata.longitude;
    if (postData.metadata.location) frontmatter.location = postData.metadata.location;

    // Bases Map View compatible coordinates format: "lat, lng"
    if (postData.metadata.latitude !== undefined && postData.metadata.longitude !== undefined) {
      frontmatter.coordinates = `${postData.metadata.latitude}, ${postData.metadata.longitude}`;
    }

    // Podcast-specific fields
    if (postData.platform === 'podcast') {
      // Channel title (podcast show name) - author.name is show name, channelTitle is backup
      if (postData.channelTitle) frontmatter.channelTitle = postData.channelTitle;

      // Extract audio info from media array
      const audioMedia = postData.media?.find(m => m.type === 'audio');
      if (audioMedia) {
        frontmatter.audioUrl = audioMedia.url;
        if (audioMedia.size) frontmatter.audioSize = audioMedia.size;
        if (audioMedia.mimeType) frontmatter.audioType = audioMedia.mimeType;
      }

      // Podcast episode metadata
      if (postData.metadata.episode !== undefined) frontmatter.episode = postData.metadata.episode;
      if (postData.metadata.season !== undefined) frontmatter.season = postData.metadata.season;
      if (postData.metadata.subtitle) frontmatter.subtitle = postData.metadata.subtitle;
      if (postData.metadata.hosts && postData.metadata.hosts.length > 0) frontmatter.hosts = postData.metadata.hosts;
      if (postData.metadata.guests && postData.metadata.guests.length > 0) frontmatter.guests = postData.metadata.guests;
      if (postData.metadata.explicit !== undefined) frontmatter.explicit = postData.metadata.explicit;
    }

    // Series info (Brunch brunchbook, Naver Webtoon, etc.)
    const series = postData.series;
    if (series) {
      if (series.title) frontmatter.series = series.title;
      if (series.url) frontmatter.seriesUrl = series.url;
      if (series.episode !== undefined) frontmatter.episode = series.episode;
      if (series.id) frontmatter.seriesId = series.id;
      if (series.totalEpisodes !== undefined) frontmatter.totalEpisodes = series.totalEpisodes;
      // Webtoon-specific fields
      if (series.starScore !== undefined) frontmatter.starScore = series.starScore;
      if (series.genre && series.genre.length > 0) frontmatter.genre = series.genre;
      if (series.ageRating) frontmatter.ageRating = series.ageRating;
      if (series.finished !== undefined) frontmatter.finished = series.finished;
      if (series.publishDay) frontmatter.publishDay = series.publishDay;
    }

    // Expired media metadata (CDN URLs that couldn't be downloaded)
    const expiredMedia = (postData as any)?._expiredMedia as Array<{ originalUrl: string }> | undefined;
    if (expiredMedia && expiredMedia.length > 0) {
      frontmatter.media_expired = expiredMedia.length;
      frontmatter.media_expired_urls = expiredMedia.map(e => e.originalUrl);
    }

    const customization = options?.customization;

    if (!customization?.enabled) {
      return frontmatter;
    }

    const visibilityApplied = customization.fieldVisibility
      ? this.applyFieldVisibility(frontmatter, customization.fieldVisibility)
      : { ...frontmatter };

    const customApplied = this.applyCustomProperties(
      visibilityApplied,
      postData,
      Array.isArray(customization.customProperties) ? customization.customProperties : []
    );

    const tagsApplied = this.applyArchiveTags(customApplied, postData, customization);
    const aliasApplied = this.applyFieldAliases(tagsApplied, customization);
    return this.applyPropertyOrder(aliasApplied, customization);
  }

  /**
   * Generate full markdown document with frontmatter
   */
  generateFullDocument(frontmatter: YamlFrontmatter, content: string): string {
    const yamlLines = Object.entries(frontmatter)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          if (value.length === 0) return null;
          return `${key}:\n${value.map(v => `  - ${this.formatYamlValue(v)}`).join('\n')}`;
        }
        return `${key}: ${this.formatYamlValue(value)}`;
      })
      .filter(Boolean)
      .join('\n');

    return `---
${yamlLines}
---

${content}`;
  }

  /**
   * Format value for YAML
   */
  private formatYamlValue(value: any): string {
    if (value instanceof Date) {
      return value.toISOString();
    }

    // Quote strings that contain YAML special characters or start with @
    // @ is used for YAML anchors/aliases and must be quoted
    // [] and {} are YAML collection delimiters and must be quoted if at start
    // Also quote strings that look like numbers (e.g., "1", "2023") to prevent YAML type coercion
    if (typeof value === 'string') {
      // Date format strings (YYYY-MM-DD HH:mm) are safe without quotes
      // The colon in time (HH:mm) is not ambiguous in YAML value position
      const isDateFormat = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value);

      const needsQuoting =
        !isDateFormat && value.includes(':') ||
        value.includes('#') ||
        value.includes("'") || // Single quotes are YAML string delimiters
        value.includes('"') || // Double quotes are YAML string delimiters
        value.startsWith('@') ||
        value.startsWith('!') || // YAML tag indicator
        value.startsWith('&') || // YAML anchor
        value.startsWith('*') || // YAML alias
        value.startsWith('|') || // YAML literal block scalar
        value.startsWith('>') || // YAML folded block scalar
        value.startsWith('%') || // YAML directive
        value.startsWith('[') || // YAML array start
        value.startsWith('{') || // YAML object start
        value.includes('\n') || // Newlines need quoting
        /^\d+$/.test(value); // Numeric-only strings need quoting
      if (needsQuoting) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
    }

    return String(value);
  }

  /**
   * Sanitize bio text for YAML frontmatter
   * - Strip HTML tags (e.g., <p>, <br>, <a>)
   * - Truncate to 280 characters (Twitter-style limit) unless skipTruncation is true
   * - Remove newlines (YAML multi-line requires special handling)
   * - Escape YAML special characters
   *
   * @param bio - The bio text to sanitize
   * @param skipTruncation - If true, skip the 280 character truncation (e.g., for podcasts)
   */
  private sanitizeBio(bio: string, skipTruncation: boolean = false): string {
    // Strip HTML tags (common in RSS feeds)
    let sanitized = bio
      .replace(/<br\s*\/?>/gi, ' ') // Convert <br> to space
      .replace(/<\/p>/gi, ' ') // Convert </p> to space (paragraph break)
      .replace(/<[^>]+>/g, '') // Remove all remaining HTML tags
      .replace(/&nbsp;/gi, ' ') // Replace &nbsp; with space
      .replace(/&amp;/gi, '&') // Decode common entities
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");

    // Remove newlines and normalize whitespace
    sanitized = sanitized.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Truncate to 280 characters with ellipsis if needed (skip for podcasts)
    if (!skipTruncation && sanitized.length > 280) {
      sanitized = sanitized.substring(0, 277) + '...';
    }

    return sanitized;
  }

  private applyFieldVisibility(
    frontmatter: YamlFrontmatter,
    visibility: FrontmatterFieldVisibility
  ): YamlFrontmatter {
    const result: YamlFrontmatter = { ...frontmatter };

    for (const [category, enabled] of Object.entries(visibility) as Array<[keyof FrontmatterFieldVisibility, boolean]>) {
      if (enabled) continue;

      const fields = CATEGORY_FIELDS[category];
      for (const field of fields) {
        if (CORE_LOCKED_FRONTMATTER_FIELDS.has(field)) continue;
        delete result[field];
      }
    }

    return result;
  }

  private applyCustomProperties(
    frontmatter: YamlFrontmatter,
    postData: PostData,
    customProperties: CustomFrontmatterProperty[]
  ): YamlFrontmatter {
    if (!Array.isArray(customProperties) || customProperties.length === 0) {
      return frontmatter;
    }

    const result: YamlFrontmatter = { ...frontmatter };
    const context = {
      platform: postData.platform,
      author: {
        name: postData.author.name || '',
        handle: postData.author.handle || '',
        username: postData.author.username || '',
        url: postData.author.url || '',
      },
      post: {
        id: postData.id || '',
        url: postData.url || '',
      },
      dates: {
        published: result.published,
        archived: result.archived,
        lastModified: result.lastModified,
      },
    };

    for (const customProperty of customProperties) {
      if (!customProperty?.enabled) continue;

      const rawKey = String(customProperty.key || '').trim();
      if (!rawKey) continue;

      if (!CUSTOM_KEY_PATTERN.test(rawKey)) {
        console.warn('[FrontmatterGenerator] Skipping invalid custom frontmatter key:', rawKey);
        continue;
      }

      if (CORE_LOCKED_FRONTMATTER_FIELDS.has(rawKey)) {
        console.warn('[FrontmatterGenerator] Skipping reserved custom frontmatter key:', rawKey);
        continue;
      }

      const resolvedValue = this.resolveCustomPropertyValue(customProperty, context);
      if (resolvedValue === undefined) continue;
      result[rawKey] = resolvedValue;
    }

    return result;
  }

  private applyArchiveTags(
    frontmatter: YamlFrontmatter,
    postData: PostData,
    customization: FrontmatterCustomizationSettings
  ): YamlFrontmatter {
    const baseTag = this.normalizeTagPath(customization.tagRoot);
    if (!baseTag) {
      return frontmatter;
    }

    const tagOrganization = isArchiveOrganizationMode(customization.tagOrganization)
      ? customization.tagOrganization
      : 'flat';
    const platformSegment = this.normalizeTagSegment(postData.platform || 'unknown') || 'unknown';
    const tags: string[] = [baseTag];

    if (tagOrganization === 'platform-only' || tagOrganization === 'platform-year-month') {
      tags.push(platformSegment);
    }

    if (tagOrganization === 'platform-year-month') {
      const timestamp = postData.metadata.timestamp instanceof Date
        ? postData.metadata.timestamp
        : new Date(postData.metadata.timestamp);
      if (!Number.isNaN(timestamp.getTime())) {
        tags.push(String(timestamp.getFullYear()));
        tags.push(String(timestamp.getMonth() + 1).padStart(2, '0'));
      }
    }

    const archiveTag = tags.join('/');
    if (!archiveTag) {
      return frontmatter;
    }

    const existingTags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
      : [];

    const mergedTags: string[] = [];
    const seen = new Set<string>();
    for (const tag of [...existingTags, archiveTag]) {
      const normalized = tag.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      mergedTags.push(tag);
    }

    return {
      ...frontmatter,
      tags: mergedTags,
    };
  }

  private applyFieldAliases(
    frontmatter: YamlFrontmatter,
    customization: FrontmatterCustomizationSettings
  ): YamlFrontmatter {
    const aliases = normalizeFrontmatterFieldAliases(customization.fieldAliases);
    const aliasEntries = Object.entries(aliases);
    if (aliasEntries.length === 0) {
      return frontmatter;
    }

    const result: YamlFrontmatter = { ...frontmatter };
    for (const [sourceKey, targetKey] of aliasEntries) {
      if (!Object.prototype.hasOwnProperty.call(result, sourceKey)) continue;
      if (sourceKey === targetKey) continue;

      const sourceValue = result[sourceKey];
      if (!Object.prototype.hasOwnProperty.call(result, targetKey)) {
        result[targetKey] = sourceValue;
      } else if (Array.isArray(result[targetKey]) && Array.isArray(sourceValue)) {
        const merged = uniqueStrings([
          ...(result[targetKey] as string[]),
          ...(sourceValue as string[]),
        ]);
        result[targetKey] = merged;
      }

      delete result[sourceKey];
    }

    return result;
  }

  private applyPropertyOrder(
    frontmatter: YamlFrontmatter,
    customization: FrontmatterCustomizationSettings
  ): YamlFrontmatter {
    const aliases = normalizeFrontmatterFieldAliases(customization.fieldAliases);
    const orderedKeys = normalizeFrontmatterPropertyOrder(
      customization.propertyOrder,
      customization.customProperties
    );
    if (orderedKeys.length === 0) {
      return frontmatter;
    }

    const result: YamlFrontmatter = {};

    for (const key of orderedKeys) {
      const aliasedKey = aliases[key] || key;
      if (!Object.prototype.hasOwnProperty.call(frontmatter, aliasedKey)) continue;
      if (Object.prototype.hasOwnProperty.call(result, aliasedKey)) continue;
      result[aliasedKey] = frontmatter[aliasedKey];
    }

    for (const [key, value] of Object.entries(frontmatter)) {
      if (Object.prototype.hasOwnProperty.call(result, key)) continue;
      result[key] = value;
    }

    return result;
  }

  private normalizeTagPath(rawPath: string | undefined): string {
    if (!rawPath) return '';
    const segments = rawPath
      .split('/')
      .map((segment) => this.normalizeTagSegment(segment))
      .filter(Boolean);

    return segments.join('/');
  }

  private normalizeTagSegment(segment: string): string {
    return String(segment || '')
      .trim()
      .replace(/^#+/, '')
      .replace(/[\\/]+/g, '-')
      .replace(/\s+/g, '-');
  }

  private resolveCustomPropertyValue(
    customProperty: CustomFrontmatterProperty,
    context: Record<string, any>
  ): unknown {
    const type = (customProperty.type || 'text') as FrontmatterPropertyType;
    const template = String(customProperty.template ?? '').trim();

    const supportsTemplateOverride = type === 'checkbox' || type === 'date' || type === 'date-time';
    if (supportsTemplateOverride && template) {
      const resolvedTemplate = TemplateEngine.process(template, context).trim();
      return this.coerceByType(type, resolvedTemplate);
    }

    if (type === 'checkbox') {
      return customProperty.checked === true;
    }

    if (type === 'date') {
      const dateValue = String(customProperty.dateValue ?? '').trim();
      return dateValue || undefined;
    }

    if (type === 'date-time') {
      const dateTimeValue = String(customProperty.dateTimeValue ?? '').trim();
      return dateTimeValue || undefined;
    }

    const rawValue = String(customProperty.value ?? '');

    if (type === 'list') {
      const lines = rawValue
        .split(/\r?\n/)
        .map((line) => TemplateEngine.process(line, context).trim())
        .filter(Boolean);

      return lines.length > 0 ? lines : undefined;
    }

    const resolvedValue = TemplateEngine.process(rawValue, context).trim();
    return this.coerceByType(type, resolvedValue);
  }

  private coerceByType(type: FrontmatterPropertyType, value: string): unknown {
    if (type === 'checkbox') {
      const normalized = value.toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
      if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
      return value;
    }

    if (type === 'number') {
      if (value === '') return '';
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }

    return value;
  }
}
