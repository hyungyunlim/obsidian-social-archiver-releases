/**
 * AuthorVaultScanner Service
 *
 * Efficiently scans the vault using MetadataCache to extract author
 * information from archived posts for the Author Catalog feature.
 *
 * Single Responsibility: Extract author data from vault files
 */

import { type App, TFile, TFolder, type MetadataCache } from 'obsidian';
import type { Platform } from '../types/post';
import type {
  RawAuthorData,
  VaultScanResult,
  VaultScanError
} from '../types/author-catalog';
import { PostDataParser } from '../components/timeline/parsers/PostDataParser';
import { PLATFORMS } from '@/shared/platforms/types';

// ============================================================================
// Constants
// ============================================================================

/** Batch size for parallel file processing */
const DEFAULT_BATCH_SIZE = 50;

/**
 * Valid platforms for author extraction
 * Derived from centralized PLATFORMS constant, excluding 'post' (user-created)
 */
const VALID_PLATFORMS: readonly Platform[] = PLATFORMS.filter(p => p !== 'post') as Platform[];

// ============================================================================
// AuthorVaultScanner Class
// ============================================================================

/**
 * Scanner configuration
 */
export interface AuthorVaultScannerConfig {
  app: App;
  archivePath?: string;
  /**
   * When true, also extracts authors from embedded archives within user posts (platform: 'post')
   * @default false
   */
  includeEmbeddedArchives?: boolean;
  /**
   * Batch size for scanning (smaller = more responsive, larger = faster).
   * @default 50
   */
  batchSize?: number;
  /**
   * When true, yields to the UI between batches to keep Obsidian responsive.
   * IMPORTANT: Defaults to false to avoid timers in unit tests.
   * @default false
   */
  yieldToUi?: boolean;
}

/**
 * AuthorVaultScanner
 *
 * Scans vault for archived posts and extracts author information
 * using MetadataCache for efficient frontmatter access.
 */
export class AuthorVaultScanner {
  private readonly app: App;
  private readonly metadataCache: MetadataCache;
  private readonly archivePath: string;
  private readonly includeEmbeddedArchives: boolean;
  private readonly batchSize: number;
  private readonly yieldToUi: boolean;

  constructor(config: AuthorVaultScannerConfig) {
    this.app = config.app;
    this.metadataCache = config.app.metadataCache;
    this.archivePath = config.archivePath || 'Social Archives';
    this.includeEmbeddedArchives = config.includeEmbeddedArchives ?? false;
    this.batchSize = Math.max(1, Math.floor(config.batchSize ?? DEFAULT_BATCH_SIZE));
    this.yieldToUi = config.yieldToUi ?? false;
  }

  // --------------------------------------------------------------------------
  // Public Methods
  // --------------------------------------------------------------------------

  /**
   * Scan vault for authors from archived posts
   *
   * @returns VaultScanResult with extracted authors and stats
   */
  async scanVault(): Promise<VaultScanResult> {
    const startTime = Date.now();
    const errors: VaultScanError[] = [];
    const authors: RawAuthorData[] = [];
    let filesSkipped = 0;

    // Get all markdown files in archive folder
    const files = this.getArchiveFiles();
    const totalFilesScanned = files.length;

    // Process files in batches for better performance
    for (let i = 0; i < files.length; i += this.batchSize) {
      const batch = files.slice(i, i + this.batchSize);

      const batchResults = await Promise.all(
        batch.map(async (file) => {
          try {
            return await this.extractAuthorFromFile(file);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            errors.push({
              filePath: file.path,
              message,
              type: 'parse_error'
            });
            return null;
          }
        })
      );

      // Filter and flatten results (handles both single RawAuthorData and RawAuthorData[])
      for (const result of batchResults) {
        if (result === null) {
          filesSkipped++;
        } else if ('error' in result && !Array.isArray(result)) {
          errors.push((result as { error: VaultScanError }).error);
          filesSkipped++;
        } else if (Array.isArray(result)) {
          // Embedded archives: multiple authors from one file
          authors.push(...result);
        } else {
          // Direct archive: single author
          authors.push(result);
        }
      }

      // Prevent microtask starvation when many files resolve immediately (frontmatter-only path).
      // This keeps the spinner animating and avoids "UI freeze" during large scans.
      await this.yieldBetweenBatches();
    }

    return {
      authors,
      totalFilesScanned,
      filesSkipped,
      errors,
      durationMs: Date.now() - startTime
    };
  }

  /**
   * Scan a single file for author data
   * Note: For embedded archives, returns the first author only. Use scanVault() for complete extraction.
   *
   * @param file TFile to scan
   * @returns RawAuthorData or null if not valid
   */
  async scanFile(file: TFile): Promise<RawAuthorData | null> {
    const result = await this.extractAuthorFromFile(file);
    if (result === null) {
      return null;
    }
    if ('error' in result && !Array.isArray(result)) {
      return null;
    }
    if (Array.isArray(result)) {
      // For embedded archives, return first author (use scanVault for all)
      return result.length > 0 ? (result[0] as RawAuthorData) : null;
    }
    return result;
  }

  /**
   * Check if a file is in the archive folder
   */
  isArchiveFile(file: TFile): boolean {
    return file.path.startsWith(this.archivePath + '/') &&
           file.extension === 'md';
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Get all markdown files in the archive folder
   */
  private getArchiveFiles(): TFile[] {
    const archiveFolder = this.app.vault.getFolderByPath(this.archivePath);
    if (!archiveFolder) {
      return [];
    }

    const files: TFile[] = [];
    this.collectMarkdownFiles(archiveFolder, files);
    return files;
  }

  /**
   * Recursively collect markdown files from a folder
   */
  private collectMarkdownFiles(folder: TFolder, files: TFile[]): void {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, files);
        continue;
      }

      if (child instanceof TFile && child.extension === 'md') {
        files.push(child);
      }
    }
  }

  /**
   * Extract author data from a single file
   * Returns single RawAuthorData for direct archives, or RawAuthorData[] for embedded archives
   */
  private async extractAuthorFromFile(
    file: TFile
  ): Promise<RawAuthorData | RawAuthorData[] | { error: VaultScanError } | null> {
    // Try to get frontmatter from MetadataCache first (faster)
    const cache = this.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    // Skip files without frontmatter
    if (!frontmatter) {
      return {
        error: {
          filePath: file.path,
          message: 'No frontmatter found',
          type: 'missing_frontmatter'
        }
      };
    }

    const platform = frontmatter.platform as string;

    // Handle user-created posts (platform: 'post')
    if (platform === 'post') {
      // Extract authors from embedded archives if enabled
      if (this.includeEmbeddedArchives) {
        return await this.extractFromEmbeddedArchives(file);
      }
      return null; // Skip user posts when option disabled
    }

    // Skip files without platform
    if (!platform) {
      return null;
    }

    // Validate platform
    if (!this.isValidPlatform(platform)) {
      return {
        error: {
          filePath: file.path,
          message: `Invalid platform: ${platform}`,
          type: 'invalid_platform'
        }
      };
    }

    // Extract author info
    const authorName = this.extractAuthorName(frontmatter);
    const authorUrl = this.extractAuthorUrl(frontmatter);

    if (!authorName && !authorUrl) {
      return {
        error: {
          filePath: file.path,
          message: 'Missing author_name and author_url',
          type: 'missing_author'
        }
      };
    }

    // Reclassify platform based on author URL if needed
    // This handles cases where RSS feeds from known platforms are saved as 'blog'
    const effectivePlatform = this.reclassifyPlatformByUrl(platform, authorUrl);

    // Extract optional fields
    const avatar = this.extractAvatar(frontmatter);
    const handle = this.extractHandle(frontmatter);
    const archivedAt = this.extractArchivedAt(frontmatter, file);
    const timelineArchived = this.extractTimelineArchived(frontmatter);

    // Extract extended metadata fields
    const localAvatar = this.extractLocalAvatarPath(frontmatter);
    const followers = this.extractFollowers(frontmatter);
    const postsCount = this.extractPostsCount(frontmatter);
    const bio = this.extractBio(frontmatter);
    const verified = this.extractVerified(frontmatter);
    const lastMetadataUpdate = this.extractLastMetadataUpdate(frontmatter);
    const community = this.extractCommunity(frontmatter);

    // Extract webtoon-specific info for webtoon platforms (Naver and Global)
    const webtoonInfo = (effectivePlatform === 'naver-webtoon' || effectivePlatform === 'webtoons')
      ? this.extractWebtoonInfo(frontmatter)
      : undefined;

    const authorData: RawAuthorData = {
      filePath: file.path,
      authorName: authorName || handle || 'Unknown',
      authorUrl: authorUrl || '',
      platform: effectivePlatform,
      avatar,
      handle,
      archivedAt,
      timelineArchived,
      sourceType: 'direct',
      // Extended metadata (only include if present)
      ...(localAvatar && { localAvatar }),
      ...(followers !== null && { followers }),
      ...(postsCount !== null && { postsCount }),
      ...(bio && { bio }),
      ...(verified && { verified }),
      ...(lastMetadataUpdate && { lastMetadataUpdate }),
      ...(community && { community }),
      // Webtoon-specific info
      ...(webtoonInfo && { webtoonInfo }),
    };

    // For Reddit posts, also extract subreddit as a separate author entry
    if (platform === 'reddit') {
      const community = frontmatter.community as string | undefined;
      const communityUrl = frontmatter.communityUrl as string | undefined;

      if (community && communityUrl) {
        const subredditAuthor: RawAuthorData = {
          filePath: file.path,
          authorName: `r/${community}`, // Display name with r/ prefix for UI
          authorUrl: communityUrl,
          platform: 'reddit',
          handle: community, // Pure subreddit name for API calls
          avatar: null, // Subreddits don't have avatar in frontmatter
          archivedAt,
          timelineArchived,
          sourceType: 'direct',
        };

        // Return both the post author and subreddit
        return [authorData, subredditAuthor];
      }
    }

    return authorData;
  }

  /**
   * Check if platform is valid for author extraction
   */
  private isValidPlatform(platform: string): platform is Platform {
    return VALID_PLATFORMS.includes(platform as Platform);
  }

  /**
   * Reclassify platform based on author URL
   * Handles cases where RSS feeds from known platforms (Medium, Velog) are saved as 'blog'
   */
  private reclassifyPlatformByUrl(platform: string, authorUrl: string | null): Platform {
    // Only reclassify 'blog' platform posts
    if (platform !== 'blog' || !authorUrl) {
      return platform as Platform;
    }

    try {
      const url = new URL(authorUrl);
      const hostname = url.hostname.toLowerCase();

      // Medium: medium.com/@user or user.medium.com
      if (hostname === 'medium.com' || hostname === 'www.medium.com' || hostname.endsWith('.medium.com')) {
        return 'medium';
      }

      // Velog: velog.io/@user
      if (hostname === 'velog.io' || hostname === 'www.velog.io' || hostname.endsWith('.velog.io')) {
        return 'velog';
      }

      // Substack: user.substack.com
      if (hostname.endsWith('.substack.com')) {
        return 'substack';
      }

      // Tumblr: user.tumblr.com
      if (hostname.endsWith('.tumblr.com')) {
        return 'tumblr';
      }
    } catch {
      // Invalid URL, keep original platform
    }

    return platform as Platform;
  }

  /**
   * Extract author name from frontmatter
   * Tries multiple field names for compatibility
   */
  private extractAuthorName(frontmatter: Record<string, unknown>): string | null {
    // Try different field names
    const candidates = [
      frontmatter.author_name,
      frontmatter.authorName,
      frontmatter.author,
      (frontmatter.author as Record<string, unknown>)?.name
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return null;
  }

  /**
   * Extract author URL from frontmatter
   */
  private extractAuthorUrl(frontmatter: Record<string, unknown>): string | null {
    // Try different field names
    const candidates = [
      frontmatter.author_url,
      frontmatter.authorUrl,
      frontmatter.profile_url,
      frontmatter.profileUrl,
      (frontmatter.author as Record<string, unknown>)?.url
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return null;
  }

  /**
   * Extract author avatar from frontmatter
   */
  private extractAvatar(frontmatter: Record<string, unknown>): string | null {
    const candidates = [
      frontmatter.author_avatar,
      frontmatter.authorAvatar,
      frontmatter.avatar,
      (frontmatter.author as Record<string, unknown>)?.avatar
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return null;
  }

  /**
   * Extract author handle from frontmatter
   */
  private extractHandle(frontmatter: Record<string, unknown>): string | null {
    const candidates = [
      frontmatter.author_handle,
      frontmatter.authorHandle,
      frontmatter.handle,
      frontmatter.username,
      (frontmatter.author as Record<string, unknown>)?.handle,
      (frontmatter.author as Record<string, unknown>)?.username
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeHandleValue(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  /**
   * Normalize handle value by trimming, removing parentheses, and ensuring @ prefix
   */
  private normalizeHandleValue(handle: unknown): string | null {
    if (typeof handle !== 'string') {
      return null;
    }
    let trimmed = handle.trim();
    if (!trimmed) {
      return null;
    }
    // Remove surrounding parentheses: (@handle) -> @handle
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      trimmed = trimmed.slice(1, -1).trim();
    }
    if (!trimmed) {
      return null;
    }
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  }

  /**
   * Clean author name by removing trailing handle in parentheses
   * e.g., "Flight Sim Vlogs (@flightsimvlogs)" -> "Flight Sim Vlogs"
   */
  private cleanAuthorName(name: string): string {
    if (!name) return name;
    // Remove trailing (@handle) or (handle) pattern
    return name.replace(/\s*\(@?[\w.-]+\)\s*$/, '').trim();
  }

  /**
   * Extract archived timestamp from frontmatter or file stats
   */
  private extractArchivedAt(frontmatter: Record<string, unknown>, file: TFile): Date {
    // Try frontmatter archived date
    const archived = frontmatter.archived || frontmatter.archivedAt || frontmatter.archived_at;
    if (archived) {
      const date = new Date(archived as string);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // Try published date as fallback
    const published = frontmatter.published || frontmatter.publishedAt || frontmatter.timestamp;
    if (published) {
      const date = new Date(published as string);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // Fall back to file modification time
    return new Date(file.stat.mtime);
  }

  /**
   * Extract timeline archive flag (frontmatter: archive: true).
   * This is different from "archivedAt" (when the note was created).
   */
  private extractTimelineArchived(frontmatter: Record<string, unknown>): boolean {
    const v = (frontmatter)['archive'];
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  // --------------------------------------------------------------------------
  // Extended Metadata Extraction Methods
  // --------------------------------------------------------------------------

  /**
   * Extract local avatar path from frontmatter
   * Handles multiple formats:
   * - Plain path: "attachments/path.jpg" -> "attachments/path.jpg"
   * - Wikilink string: "[[path]]" -> "path"
   * - Array (YAML parsed [[path]] as nested array): [["path"]] -> "path"
   *
   * Note: External URLs (http/https) are NOT local paths and should return null.
   * External URLs are handled by extractAvatar() instead.
   */
  private extractLocalAvatarPath(frontmatter: Record<string, unknown>): string | null {
    let authorAvatar = frontmatter.authorAvatar;

    // Handle array format (YAML interprets [[path]] as nested array)
    if (Array.isArray(authorAvatar)) {
      // [[path]] becomes [["path"]] in YAML, flatten it
      // Safety: max 5 iterations to prevent infinite loop on malformed data
      let depth = 0;
      while (Array.isArray(authorAvatar) && authorAvatar.length > 0 && depth < 5) {
        authorAvatar = authorAvatar[0];
        depth++;
      }
    }

    if (typeof authorAvatar !== 'string' || !authorAvatar.trim()) {
      return null;
    }

    const trimmed = authorAvatar.trim();

    // External URLs are NOT local paths - they should be handled by extractAvatar()
    // This is important for podcast avatars which are external image URLs
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return null;
    }

    // Check if it's a wikilink format (for backward compatibility)
    if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
      // Remove brackets: [[path]] -> path or [[path|alias]] -> path
      const inner = trimmed.slice(2, -2);
      // Handle alias: [[path|alias]] -> path
      const pipeIndex = inner.indexOf('|');
      return pipeIndex > 0 ? inner.slice(0, pipeIndex) : inner;
    }

    // Return as-is (plain path - new format)
    return trimmed;
  }

  /**
   * Extract follower count from frontmatter
   */
  private extractFollowers(frontmatter: Record<string, unknown>): number | null {
    const followers = frontmatter.authorFollowers ?? frontmatter.followers;
    if (typeof followers === 'number' && !isNaN(followers)) {
      return followers;
    }
    if (typeof followers === 'string') {
      const parsed = parseInt(followers, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  /**
   * Extract posts count from frontmatter
   */
  private extractPostsCount(frontmatter: Record<string, unknown>): number | null {
    const postsCount = frontmatter.authorPostsCount ?? frontmatter.postsCount;
    if (typeof postsCount === 'number' && !isNaN(postsCount)) {
      return postsCount;
    }
    if (typeof postsCount === 'string') {
      const parsed = parseInt(postsCount, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  /**
   * Extract author bio from frontmatter
   * For webtoons, uses synopsis field as bio
   */
  private extractBio(frontmatter: Record<string, unknown>): string | null {
    // Check standard bio fields first
    const bio = frontmatter.authorBio ?? frontmatter.bio ?? frontmatter.synopsis;
    if (typeof bio === 'string' && bio.trim()) {
      const trimmed = bio.trim();
      // Guard against unexpectedly large strings (can freeze the UI when rendered in lists).
      const MAX_BIO_CHARS = 2000;
      return trimmed.length > MAX_BIO_CHARS ? trimmed.slice(0, MAX_BIO_CHARS) : trimmed;
    }
    return null;
  }

  /**
   * Extract verified status from frontmatter
   */
  private extractVerified(frontmatter: Record<string, unknown>): boolean {
    const verified = frontmatter.authorVerified ?? frontmatter.verified;
    return verified === true;
  }

  /**
   * Extract last metadata update timestamp from frontmatter
   */
  private extractLastMetadataUpdate(frontmatter: Record<string, unknown>): Date | null {
    const timestamp = frontmatter.lastMetadataUpdate ?? frontmatter.metadataUpdated;
    if (!timestamp) {
      return null;
    }

    const date = new Date(timestamp as string);
    if (!isNaN(date.getTime())) {
      return date;
    }
    return null;
  }

  /**
   * Extract webtoon-specific info from frontmatter (naver-webtoon platform)
   */
  private extractWebtoonInfo(frontmatter: Record<string, unknown>): {
    titleId?: string;
    titleName: string;
    publishDay?: string;
    finished?: boolean;
    genre?: string[];
  } | null {
    // titleName is required - try multiple field names
    const titleName = frontmatter.titleName as string
      || frontmatter.title_name as string
      || frontmatter.seriesTitle as string
      || frontmatter.series as string;

    if (!titleName) {
      return null;
    }

    // Extract optional fields
    const titleId = (frontmatter.titleId || frontmatter.title_id || frontmatter.seriesId) as string | undefined;
    const publishDay = frontmatter.publishDay as string | undefined;
    const finished = frontmatter.finished as boolean | undefined;

    // Genre can be string or array
    let genre: string[] | undefined;
    const rawGenre = frontmatter.genre;
    if (Array.isArray(rawGenre)) {
      genre = rawGenre.filter((g): g is string => typeof g === 'string');
    } else if (typeof rawGenre === 'string') {
      genre = [rawGenre];
    }

    return {
      ...(titleId && { titleId }),
      titleName,
      ...(publishDay && { publishDay }),
      ...(finished !== undefined && { finished }),
      ...(genre && genre.length > 0 && { genre }),
    };
  }

  /**
   * Extract community info from frontmatter (Reddit subreddit or Naver cafe)
   */
  private extractCommunity(frontmatter: Record<string, unknown>): { name: string; url: string } | null {
    // Reddit: community + communityUrl
    const community = frontmatter.community as string | undefined;
    const communityUrl = frontmatter.communityUrl as string | undefined;
    if (community && communityUrl) {
      return { name: community, url: communityUrl };
    }

    // Naver Cafe: cafeName + cafeUrl
    const cafeName = frontmatter.cafeName as string | undefined;
    const cafeUrl = frontmatter.cafeUrl as string | undefined;
    if (cafeName && cafeUrl) {
      return { name: cafeName, url: cafeUrl };
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Embedded Archives Extraction
  // --------------------------------------------------------------------------

  /** Marker for embedded archives section in markdown */
  private static readonly EMBEDDED_SECTION_MARKERS = [
    '## 📦 Referenced Social Media Posts',
    '## Referenced Social Media Posts',
    '## Embedded Archives'
  ];

  /**
   * Extract authors from embedded archives within a user post
   * Performance optimization: Quick content check before parsing
   */
  private async extractFromEmbeddedArchives(file: TFile): Promise<RawAuthorData[]> {
    // Quick content check - skip if no embedded section
    const content = await this.app.vault.cachedRead(file);
    const hasEmbeddedSection = AuthorVaultScanner.EMBEDDED_SECTION_MARKERS.some(
      marker => content.includes(marker)
    );

    if (!hasEmbeddedSection) {
      return [];
    }

    // Parse file to get embedded archives
    const parser = new PostDataParser(this.app.vault, this.app);
    const postData = await parser.parseFile(file);

    if (!postData?.embeddedArchives?.length) {
      return [];
    }

    // Get parent post's archived date as fallback
    const parentArchivedAt = postData.archivedDate || new Date(file.stat.mtime);
    const parentTimelineArchived = postData?.archive === true;

    // Extract authors from each embedded archive
    return postData.embeddedArchives
      .filter(embedded =>
        embedded.author?.url &&
        embedded.platform !== 'post' &&
        this.isValidPlatform(embedded.platform)
      )
      .map(embedded => {
        const handle = this.normalizeHandleValue(
          embedded.author.handle || embedded.author.username || null
        );
        const archivedAt = embedded.archivedDate
          ? new Date(embedded.archivedDate)
          : parentArchivedAt;

        // Extract extended metadata from embedded archive author
        const author = embedded.author;

        // Clean author name: remove trailing (@handle) if present
        const rawName = author.name || handle || author.url || 'Unknown';
        const cleanedName = this.cleanAuthorName(rawName);

        return {
          filePath: file.path,
          authorName: cleanedName,
          authorUrl: author.url,
          platform: embedded.platform,
          avatar: author.avatar || null,
          handle,
          archivedAt,
          timelineArchived: parentTimelineArchived,
          // Embedded archive source tracking
          sourceType: 'embedded' as const,
          sourceFilePath: file.path,
          embeddedOriginalUrl: embedded.url || embedded.originalUrl,
          // Extended metadata from embedded archive (if available)
          ...(author.localAvatar && { localAvatar: author.localAvatar }),
          ...(author.followers !== undefined && author.followers !== null && { followers: author.followers }),
          ...(author.postsCount !== undefined && author.postsCount !== null && { postsCount: author.postsCount }),
          ...(author.bio && { bio: author.bio }),
          ...(author.verified && { verified: author.verified }),
          ...(author.lastMetadataUpdate && { lastMetadataUpdate: author.lastMetadataUpdate }),
        };
      });
  }

  /**
   * Yield to the browser between batches to keep UI responsive.
   * No-op by default (tests / non-UI callers).
   */
  private async yieldBetweenBatches(): Promise<void> {
    if (!this.yieldToUi) return;

    await new Promise<void>((resolve) => {
      // rAF can be paused in some Electron/Obsidian states (e.g. hidden/minimized panes),
      // which would deadlock any code awaiting it. Use a small timeout as a guaranteed fallback.
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      const timeoutId = setTimeout(finish, 50);

      // Prefer rAF in Obsidian to yield to the next frame.
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          clearTimeout(timeoutId);
          finish();
        });
        return;
      }

      // Node / non-browser
      if (typeof setImmediate === 'function') {
        setImmediate(() => {
          clearTimeout(timeoutId);
          finish();
        });
        return;
      }

      // setTimeout fallback already scheduled
    });
  }
}
