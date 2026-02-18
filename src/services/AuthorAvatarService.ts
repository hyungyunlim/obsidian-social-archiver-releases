import type { App, Vault } from 'obsidian';
import { normalizePath, requestUrl } from 'obsidian';
import type { Platform } from '@/types/post';
import type { SocialArchiverSettings } from '@/types/settings';

/**
 * Configuration for AuthorAvatarService
 */
export interface AuthorAvatarServiceConfig {
  vault: Vault;
  app?: App;
  settings: SocialArchiverSettings;
  timeout?: number; // Download timeout in ms (default: 30000)
  workerApiUrl?: string; // Worker API URL for media proxy
}

/**
 * Result of avatar download operation
 */
export interface AvatarDownloadResult {
  success: boolean;
  localPath: string | null;
  originalUrl: string;
  error?: string;
}

/**
 * Maximum avatar file size in bytes (10MB)
 */
const MAX_AVATAR_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Maximum filename length for sanitized usernames
 */
const MAX_FILENAME_LENGTH = 50;

/**
 * Default download timeout in milliseconds
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Subfolder name for author avatars within media path
 */
const AUTHORS_SUBFOLDER = 'authors';

/**
 * AuthorAvatarService - Downloads and stores author profile images locally
 *
 * Single Responsibility: Author avatar file management
 *
 * Features:
 * - Downloads avatar images from URLs
 * - Saves to {settings.mediaPath}/authors/ directory
 * - Generates sanitized filenames: {platform}-{username}.{ext}
 * - Handles duplicate detection (skip if exists by default)
 * - Supports overwrite mode via parameter
 * - Validates file size (skip if >10MB)
 * - Infers MIME types for extensionless/data URLs
 */
/**
 * CDN domains that require proxy due to CORS restrictions
 * Note: In Obsidian plugin environment, we use requestUrl which bypasses CORS,
 * but this list is kept for reference and future proxy needs.
 */
const CORS_BLOCKED_DOMAINS = [
  'cdninstagram.com',
  'fbcdn.net',
  'twimg.com',
  'tiktok.com',
  'tiktokcdn.com',
  'licdn.com',
  'threads.com',
  'bsky.app',         // Bluesky CDN (cdn.bsky.app)
  'mastodon.social',  // Mastodon instances
  'fosstodon.org',
  'mas.to',
  'hachyderm.io',
  'pstatic.net',      // Naver CDN (blogpfthumb-phinf.pstatic.net, blogimgs.pstatic.net)
  'redditmedia.com',  // Reddit CDN (styles.redditmedia.com)
  'daumcdn.net',      // Kakao/Brunch CDN (t1.daumcdn.net)
];

/**
 * Default/placeholder avatar URLs that should be skipped (not worth downloading)
 */
const DEFAULT_AVATAR_PATTERNS = [
  '/nblog/comment/login_basic.gif',  // Naver default avatar
  '/default_avatar',
  '/default_profile',
];

export class AuthorAvatarService {
  private vault: Vault;
  private app: App | undefined;
  private settings: SocialArchiverSettings;
  private timeout: number;
  private workerApiUrl: string | null;

  constructor(config: AuthorAvatarServiceConfig) {
    this.vault = config.vault;
    this.app = config.app;
    this.settings = config.settings;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.workerApiUrl = config.workerApiUrl ?? null;
  }

  /**
   * Update Worker API URL (for runtime changes)
   */
  updateWorkerApiUrl(url: string | null): void {
    this.workerApiUrl = url;
  }

  /**
   * Update settings reference (for runtime settings changes)
   */
  updateSettings(settings: SocialArchiverSettings): void {
    this.settings = settings;
  }

  /**
   * Download and save an author's avatar image to the vault
   *
   * @param avatarUrl - URL of the avatar image
   * @param platform - Social media platform
   * @param username - Author's username (will be sanitized)
   * @param overwrite - If true, replace existing file; if false, skip if exists
   * @returns Local vault path or null on failure
   */
  async downloadAndSaveAvatar(
    avatarUrl: string,
    platform: Platform,
    username: string,
    overwrite = false
  ): Promise<string | null> {
    try {
      // Validate inputs
      if (!avatarUrl || !username) {
        console.warn('[AuthorAvatarService] Missing avatarUrl or username');
        return null;
      }

      // Skip default/placeholder avatars (not worth downloading)
      if (this.isDefaultAvatar(avatarUrl)) {
        console.debug('[AuthorAvatarService] Skipping default avatar:', avatarUrl);
        return null;
      }

      // Generate sanitized filename
      const sanitizedUsername = this.sanitizeFilename(username);
      const basePath = this.getAvatarsBasePath();

      // Check if file already exists (with any extension)
      const existingPath = await this.findExistingAvatar(platform, sanitizedUsername);
      if (existingPath && !overwrite) {
        return existingPath;
      }

      // Fetch the image
      const response = await this.fetchWithTimeout(avatarUrl);
      if (!response.ok) {
        console.warn(`[AuthorAvatarService] Failed to fetch avatar: HTTP ${response.status}`);
        return null;
      }

      // Validate size before downloading full content
      const isValidSize = this.validateImageSize(response);
      if (!isValidSize) {
        console.warn(`[AuthorAvatarService] Avatar too large (>10MB), skipping: ${avatarUrl}`);
        return null;
      }

      // Get the data
      const data = await response.arrayBuffer();
      if (data.byteLength === 0) {
        console.warn('[AuthorAvatarService] Empty avatar data received');
        return null;
      }

      // Double-check actual size
      if (data.byteLength > MAX_AVATAR_SIZE) {
        console.warn(`[AuthorAvatarService] Avatar too large (${data.byteLength} bytes), skipping`);
        return null;
      }

      // Infer extension from Content-Type or binary data
      const contentType = response.headers.get('content-type');
      const extension = this.inferExtension(avatarUrl, contentType, data);
      if (!extension) {
        console.warn('[AuthorAvatarService] Could not determine image extension');
        return null;
      }

      // Validate it's actually an image type
      if (!this.isValidImageMimeType(contentType)) {
        console.warn(`[AuthorAvatarService] Invalid MIME type: ${contentType}`);
        return null;
      }

      // Build final path
      const filename = `${platform}-${sanitizedUsername}.${extension}`;
      const fullPath = normalizePath(`${basePath}/${filename}`);

      // Delete existing file if overwrite mode
      if (existingPath && overwrite) {
        try {
          const existingFile = this.vault.getAbstractFileByPath(existingPath);
          if (existingFile && this.app) {
            await this.app.fileManager.trashFile(existingFile as import('obsidian').TFile);
          }
        } catch {
          // Ignore deletion errors
        }
      }

      // Ensure parent folder exists
      await this.ensureFolderExists(basePath);

      // Save to vault
      await this.vault.createBinary(fullPath, data);

      return fullPath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle race condition: if file already exists, return the existing path
      if (errorMessage.includes('already exists') || errorMessage.includes('File exists')) {
        // Re-check for existing file and return its path
        const existingPath = await this.findExistingAvatar(platform, this.sanitizeFilename(username));
        if (existingPath) {
          return existingPath;
        }
      }

      console.warn(`[AuthorAvatarService] Failed to download avatar: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Get the base path for avatars from settings
   * Format: {settings.mediaPath}/authors
   */
  private getAvatarsBasePath(): string {
    const mediaPath = this.settings.mediaPath || 'attachments/social-archives';
    return normalizePath(`${mediaPath}/${AUTHORS_SUBFOLDER}`);
  }

  /**
   * Find existing avatar file for a platform/username combination
   * Checks for any image extension
   */
  private async findExistingAvatar(
    platform: Platform,
    sanitizedUsername: string
  ): Promise<string | null> {
    const basePath = this.getAvatarsBasePath();
    const extensions = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic'];

    for (const ext of extensions) {
      const path = normalizePath(`${basePath}/${platform}-${sanitizedUsername}.${ext}`);
      const exists = await this.vault.adapter.exists(path);
      if (exists) {
        return path;
      }
    }

    return null;
  }

  /**
   * Sanitize filename to remove invalid filesystem characters
   * - Removes/replaces: \ / : * ? " < > |
   * - Replaces whitespace with underscore
   * - Limits to MAX_FILENAME_LENGTH characters
   */
  private sanitizeFilename(username: string): string {
    return username
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '_')
      .trim()
      .slice(0, MAX_FILENAME_LENGTH);
  }

  /**
   * Check if URL is a default/placeholder avatar that should be skipped
   */
  private isDefaultAvatar(url: string): boolean {
    return DEFAULT_AVATAR_PATTERNS.some(pattern => url.includes(pattern));
  }

  /**
   * Check if URL requires proxy due to CORS restrictions
   */
  private requiresProxy(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return CORS_BLOCKED_DOMAINS.some(domain => hostname.includes(domain));
    } catch {
      return false;
    }
  }

  /**
   * Fetch URL with timeout using Obsidian's requestUrl (bypasses CORS)
   *
   * Uses Obsidian's native requestUrl which doesn't have CORS restrictions,
   * making it suitable for fetching images from any CDN domain.
   *
   * Falls back to proxy for domains that may still have issues.
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    try {
      // For CORS-blocked domains with proxy available, use proxy
      if (this.requiresProxy(url) && this.workerApiUrl) {
        const proxyUrl = `${this.workerApiUrl}/api/proxy-media?url=${encodeURIComponent(url)}`;
        const response = await requestUrl({
          url: proxyUrl,
          method: 'GET',
          throw: false,
        });

        // Convert Obsidian's response to a Response-like object
        return this.createResponseFromObsidian(response);
      }

      // Use Obsidian's requestUrl directly (bypasses CORS)
      const response = await requestUrl({
        url,
        method: 'GET',
        throw: false,
      });

      return this.createResponseFromObsidian(response);
    } catch (error) {
      // If Obsidian's requestUrl fails, create a failed response
      console.warn('[AuthorAvatarService] requestUrl failed:', error);
      return new Response(null, { status: 0, statusText: 'Network Error' });
    }
  }

  /**
   * Convert Obsidian's RequestUrlResponse to a Response-like object
   */
  private createResponseFromObsidian(obsidianResponse: {
    status: number;
    headers: Record<string, string>;
    arrayBuffer: ArrayBuffer;
  }): Response {
    return {
      ok: obsidianResponse.status >= 200 && obsidianResponse.status < 300,
      status: obsidianResponse.status,
      headers: {
        get: (name: string) => obsidianResponse.headers[name.toLowerCase()] || null,
      },
      arrayBuffer: () => Promise.resolve(obsidianResponse.arrayBuffer),
    } as unknown as Response;
  }

  /**
   * Validate image size from Content-Length header
   * Returns true if size is valid or unknown
   */
  private validateImageSize(response: Response): boolean {
    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      // Size unknown, proceed with download and check later
      return true;
    }
    return parseInt(contentLength, 10) <= MAX_AVATAR_SIZE;
  }

  /**
   * Check if MIME type is a valid image type
   */
  private isValidImageMimeType(mimeType: string | null): boolean {
    if (!mimeType) return true; // Allow if unknown
    return mimeType.startsWith('image/');
  }

  /**
   * Infer file extension from URL, Content-Type, or binary data
   */
  private inferExtension(
    url: string,
    contentType: string | null,
    data: ArrayBuffer
  ): string | null {
    // Try Content-Type first
    if (contentType) {
      const ext = this.getExtensionFromMimeType(contentType);
      if (ext) return ext;
    }

    // Try URL extension
    const urlExt = this.getExtensionFromUrl(url);
    if (urlExt) return urlExt;

    // Try binary magic numbers
    const magicExt = this.detectImageExtension(data);
    if (magicExt) return magicExt;

    // Default fallback
    return 'jpg';
  }

  /**
   * Get extension from MIME type
   */
  private getExtensionFromMimeType(mimeType: string): string | null {
    const mimeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/avif': 'avif',
      'image/heic': 'heic',
      'image/heif': 'heic',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/x-icon': 'ico',
    };

    // Extract main type (ignore charset etc)
    const mainType = mimeType.split(';')[0]?.trim().toLowerCase();
    return mainType ? mimeMap[mainType] ?? null : null;
  }

  /**
   * Get extension from URL path
   */
  private getExtensionFromUrl(url: string): string | null {
    try {
      const pathname = new URL(url).pathname;
      const parts = pathname.split('.');
      if (parts.length > 1) {
        let ext = (parts[parts.length - 1] ?? '').toLowerCase();
        // Remove query parameters
        ext = ext.split('?')[0] || ext;
        // Validate it's a known image extension
        const validExtensions = new Set([
          'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif'
        ]);
        if (validExtensions.has(ext)) {
          return ext === 'jpeg' ? 'jpg' : ext;
        }
      }
    } catch {
      // Invalid URL
    }
    return null;
  }

  /**
   * Detect image format from binary data (magic numbers)
   * Based on MediaHandler.detectImageExtension pattern
   */
  private detectImageExtension(data: ArrayBuffer): string | null {
    const bytes = new Uint8Array(data);
    if (bytes.length < 12) {
      return null;
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'png';
    }

    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'jpg';
    }

    // GIF: GIF87a or GIF89a
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'gif';
    }

    // WebP: "RIFF" .... "WEBP" at bytes 8-11
    if (
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return 'webp';
    }

    // BMP: BM
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return 'bmp';
    }

    // HEIC/HEIF/AVIF: "ftyp" + brand
    if (bytes.length >= 12) {
      const brand = String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0).toLowerCase();
      if (brand === 'ftyp') {
        const brandName = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0).toLowerCase();
        if (brandName.startsWith('heic') || brandName.startsWith('heif')) {
          return 'heic';
        }
        if (brandName.startsWith('avif')) {
          return 'avif';
        }
      }
    }

    return null;
  }

  /**
   * Ensure folder exists in vault (recursive)
   */
  private async ensureFolderExists(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);

    // Check if folder already exists
    const existing = this.vault.getFolderByPath(normalizedPath);
    if (existing) {
      return;
    }

    // Create parent folders recursively
    const parentPath = this.getParentPath(normalizedPath);
    if (parentPath && parentPath !== '.') {
      await this.ensureFolderExists(parentPath);
    }

    // Create this folder
    try {
      await this.vault.createFolder(normalizedPath);
    } catch {
      // Folder might have been created by another operation
      const folder = this.vault.getFolderByPath(normalizedPath);
      if (!folder) {
        throw new Error(`Failed to create folder: ${normalizedPath}`);
      }
    }
  }

  /**
   * Get parent path from a path string
   */
  private getParentPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 1) {
      return '.';
    }
    return parts.slice(0, -1).join('/');
  }

  /**
   * Check if an avatar exists for the given platform and username
   */
  async avatarExists(platform: Platform, username: string): Promise<boolean> {
    const sanitizedUsername = this.sanitizeFilename(username);
    const existingPath = await this.findExistingAvatar(platform, sanitizedUsername);
    return existingPath !== null;
  }

  /**
   * Get the local path for an avatar if it exists
   */
  async getAvatarPath(platform: Platform, username: string): Promise<string | null> {
    const sanitizedUsername = this.sanitizeFilename(username);
    return this.findExistingAvatar(platform, sanitizedUsername);
  }

  /**
   * Delete an avatar file
   */
  async deleteAvatar(platform: Platform, username: string): Promise<boolean> {
    try {
      const sanitizedUsername = this.sanitizeFilename(username);
      const existingPath = await this.findExistingAvatar(platform, sanitizedUsername);

      if (!existingPath) {
        return false;
      }

      const file = this.vault.getAbstractFileByPath(existingPath);
      if (file && this.app) {
        await this.app.fileManager.trashFile(file as import('obsidian').TFile);
        return true;
      }
      return false;
    } catch (error) {
      console.warn('[AuthorAvatarService] Failed to delete avatar:', error);
      return false;
    }
  }
}
