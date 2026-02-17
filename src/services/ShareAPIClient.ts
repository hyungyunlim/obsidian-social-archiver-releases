/**
 * ShareAPIClient - Client service for communicating with Workers share API
 *
 * Features:
 * - POST /api/share endpoint integration
 * - Authentication with license keys
 * - Rate limiting detection and handling
 * - Exponential backoff retry logic
 * - Password protection and custom expiry support
 *
 * Uses Obsidian's requestUrl for all network requests (required for Obsidian plugin compliance)
 */

import { requestUrl, Platform, type Vault } from 'obsidian';
import type { PostData } from '@/types/post';
import type { IService } from './base/IService';
import type { UserTier } from '@/types/settings';
import {
  HttpError,
  NetworkError,
  TimeoutError,
  RateLimitError,
  AuthenticationError,
  InvalidRequestError,
  ServerError
} from '@/types/errors/http-errors';

/**
 * Share API request interface
 */
export interface ShareAPIRequest {
  postData?: PostData;
  // Legacy format (for backwards compatibility)
  content?: string;
  metadata?: {
    title: string;
    platform: string;
    author: string;
    originalUrl: string;
    tags?: string[];
    thumbnail?: string;
  };
  options?: {
    expiry?: number; // Unix timestamp
    password?: string;
    username?: string;
    shareId?: string; // For updates
    tier?: UserTier; // User tier for video upload permissions
  };
}

/**
 * Share API response interface
 */
export interface ShareAPIResponse {
  shareId: string;
  shareUrl: string;
  passwordProtected: boolean;
  expiresAt?: number;
}

/**
 * Share API client configuration
 */
export interface ShareAPIConfig {
  baseURL: string;
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  debug?: boolean;
  vault?: Vault; // Optional vault for media file operations
  pluginVersion?: string;
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  shouldRetry: (error: HttpError) => boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<ShareAPIConfig, 'apiKey' | 'vault'>> = {
  baseURL: 'https://api.social-archiver.junlim.org',
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 1000, // 1 second base delay
  debug: false,
  pluginVersion: '0.0.0'
};

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 32000, // 32 seconds
  shouldRetry: (error: HttpError) => {
    // Retry on network errors
    if (error instanceof NetworkError || error instanceof TimeoutError) {
      return true;
    }

    // Retry on rate limiting
    if (error instanceof RateLimitError) {
      return true;
    }

    // Retry on server errors (5xx)
    if (error instanceof ServerError) {
      return true;
    }

    // Don't retry on client errors (4xx)
    if (error instanceof AuthenticationError || error instanceof InvalidRequestError) {
      return false;
    }

    return false;
  }
};

/**
 * Transform HTTP status + body into a standardized HttpError
 */
function transformHttpError(
  status: number,
  headers: Record<string, string>,
  data: unknown,
  url: string
): HttpError {
  const message = (data as any)?.message || `HTTP ${status} error`;

  if (status === 429) {
    const retryAfter = headers['retry-after'] ? parseInt(headers['retry-after'], 10) : undefined;
    const limit = headers['x-ratelimit-limit'] ? parseInt(headers['x-ratelimit-limit'], 10) : undefined;
    const remaining = headers['x-ratelimit-remaining'] ? parseInt(headers['x-ratelimit-remaining'], 10) : undefined;
    return new RateLimitError(
      message || 'Rate limit exceeded',
      { statusCode: status, retryAfter, limit, remaining }
    );
  }

  if (status === 401 || status === 403) {
    return new AuthenticationError(message || 'Authentication failed', status);
  }

  if (status === 400 || status === 422) {
    return new InvalidRequestError(message || 'Invalid request', status, {
      validationErrors: (data as any)?.errors
    });
  }

  if (status >= 500) {
    return new ServerError(message || 'Server error', status);
  }

  return new HttpError(message, String(status), { statusCode: status });
}

/**
 * Get platform identifier for X-Platform header
 */
function getPlatformIdentifier(): string {
  if (Platform.isDesktop) {
    if (Platform.isMacOS) return 'macos';
    if (Platform.isWin) return 'windows';
    return 'linux';
  }
  return Platform.isIosApp ? 'ios' : 'android';
}

/**
 * ShareAPIClient service for Workers API integration
 * Uses Obsidian's requestUrl API instead of axios for plugin compliance.
 */
export class ShareAPIClient implements IService {
  name = 'ShareAPIClient';
  private config: Required<Omit<ShareAPIConfig, 'apiKey' | 'vault'>> & Pick<ShareAPIConfig, 'apiKey' | 'vault'>;
  private retryConfig: RetryConfig;
  private vault?: Vault;

  // Base headers applied to every request
  private baseHeaders: Record<string, string>;

  // Request queue for serializing updateShare calls per shareId
  // This prevents race conditions when multiple updates happen simultaneously
  private static updateQueues: Map<string, Promise<ShareAPIResponse>> = new Map();

  constructor(config: ShareAPIConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.vault = config.vault;
    this.retryConfig = DEFAULT_RETRY_CONFIG;

    this.baseHeaders = {
      'Content-Type': 'application/json',
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': this.config.pluginVersion || '0.0.0',
      'X-Platform': getPlatformIdentifier(),
    };
  }

  /**
   * Build per-request headers (base + auth + request ID)
   */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.baseHeaders,
      'X-Request-Id': this.generateRequestId(),
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      headers['X-License-Key'] = this.config.apiKey;
    }

    if (extra) {
      Object.assign(headers, extra);
    }

    return headers;
  }

  /**
   * Core HTTP method using Obsidian's requestUrl
   */
  private async httpRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.config.baseURL}${path}`;
    const headers = this.buildHeaders(extraHeaders);

    let serializedBody: string | undefined;
    if (body !== undefined && body !== null) {
      serializedBody = typeof body === 'string' ? body : JSON.stringify(body);
    }

    if (this.config.debug) {
      console.debug('[ShareAPIClient] Request:', { method, url, headers, body });
    }

    const response = await requestUrl({
      url,
      method,
      headers,
      body: serializedBody,
      throw: false,
    });

    if (this.config.debug) {
      console.debug('[ShareAPIClient] Response:', {
        status: response.status,
        headers: response.headers,
      });
    }

    // Handle error responses
    if (response.status >= 400) {
      let data: unknown;
      try {
        data = response.json;
      } catch {
        data = { message: response.text };
      }
      const httpError = transformHttpError(response.status, response.headers, data, url);
      if (this.config.debug) {
        console.error('[ShareAPIClient] Error:', httpError);
      }
      throw httpError;
    }

    // Parse successful response
    try {
      return response.json as T;
    } catch {
      return response.text as unknown as T;
    }
  }

  /**
   * Create a share link for a post
   */
  async createShare(request: ShareAPIRequest): Promise<ShareAPIResponse> {
    return this.executeWithRetry(async () => {
      const result = await this.httpRequest<{ success: boolean; data: ShareAPIResponse } | ShareAPIResponse>(
        'POST',
        '/api/share',
        request
      );
      // Workers API returns { success: true, data: ShareAPIResponse }
      // Handle both wrapped and unwrapped formats
      if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
        return (result as { success: boolean; data: ShareAPIResponse }).data;
      }
      return result as ShareAPIResponse;
    });
  }

  /**
   * Update an existing share
   * Uses request queue to serialize concurrent updates for the same shareId
   */
  async updateShare(shareId: string, request: ShareAPIRequest): Promise<ShareAPIResponse> {
    // Add shareId to options for update
    const updateRequest: ShareAPIRequest = {
      ...request,
      options: {
        ...request.options,
        shareId
      }
    };

    // Serialize requests for the same shareId to prevent race conditions
    const existingQueue = ShareAPIClient.updateQueues.get(shareId) || Promise.resolve({} as ShareAPIResponse);

    const newRequest = existingQueue.then(async () => {
      return this.executeWithRetry(async () => {
        const result = await this.httpRequest<{ success: boolean; data: ShareAPIResponse } | ShareAPIResponse>(
          'POST',
          '/api/share',
          updateRequest
        );
        if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
          return (result as { success: boolean; data: ShareAPIResponse }).data;
        }
        return result as ShareAPIResponse;
      });
    }).finally(() => {
      // Clean up queue entry after completion
      if (ShareAPIClient.updateQueues.get(shareId) === newRequest) {
        ShareAPIClient.updateQueues.delete(shareId);
      }
    });

    ShareAPIClient.updateQueues.set(shareId, newRequest);
    return newRequest;
  }

  /**
   * Delete a share link
   */
  async deleteShare(shareId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      await this.httpRequest('DELETE', `/api/share/${shareId}`);
    });
  }

  /**
   * Get share status/info
   */
  async getShareInfo(shareId: string): Promise<ShareAPIResponse> {
    return this.executeWithRetry(async () => {
      const result = await this.httpRequest<{ success: boolean; data: any } | any>(
        'GET',
        `/api/share/${shareId}`
      );
      // Workers API returns { success: true, data: shareData }
      if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
        const data = result.data;
        return {
          shareId: data.shareId,
          shareUrl: data.shareUrl || '',
          passwordProtected: !!data.options?.password
        };
      }
      // Unwrapped format (tests return response directly)
      return {
        shareId: result.shareId,
        shareUrl: result.shareUrl || '',
        passwordProtected: !!result.options?.password,
        expiresAt: result.expiresAt,
      };
    });
  }

  /**
   * Update share with media handling - uploads new media, deletes removed media, converts markdown paths
   *
   * @param shareId - Share ID to update
   * @param postData - New post data with local media paths
   * @param options - Share options (username, password, expiry)
   * @param onProgress - Optional progress callback (current, total)
   * @returns Updated share response
   */
  async updateShareWithMedia(
    shareId: string,
    postData: PostData,
    options?: ShareAPIRequest['options'],
    onProgress?: (current: number, total: number) => void
  ): Promise<ShareAPIResponse> {
    if (!this.vault) {
      throw new Error('Vault is required for media operations. Please provide vault in ShareAPIClient config.');
    }

    const uploadedMedia: any[] = [];

    try {
      // STEP 1: Fetch existing share data to detect changes
      const existingShareData = await this.executeWithRetry(async () => {
        const result = await this.httpRequest<{ success: boolean; data: any } | any>(
          'GET',
          `/api/share/${shareId}`
        );
        if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
          return result.data;
        }
        return result;
      });

      // STEP 2: Build filename maps
      // Map: filename -> existing R2 media object
      const existingMediaByFilename = new Map<string, any>();
      (existingShareData?.media || []).forEach((m: any) => {
        const filename = m?.url?.split('/').pop();
        if (filename) {
          existingMediaByFilename.set(filename, m);
        }
      });

      // Map: filename -> new local media object
      // Include media from main post AND embedded archives
      const newMediaByFilename = new Map<string, any>();

      // Add main post media
      postData.media.forEach(m => {
        const filename = m.url.split('/').pop();
        if (filename) {
          newMediaByFilename.set(filename, m);
        }
      });

      // Add embedded archives media (for User Posts with embedded archives)
      if (postData.embeddedArchives) {
        postData.embeddedArchives.forEach(archive => {
          (archive.media || []).forEach(m => {
            const filename = m.url.split('/').pop();
            if (filename) {
              newMediaByFilename.set(filename, m);
            }
          });
        });
      }

      // Determine what to upload and what to keep
      const mediaToUpload: typeof postData.media = [];
      const mediaToKeep: any[] = [];

      for (const [filename, localMedia] of newMediaByFilename.entries()) {
        if (existingMediaByFilename.has(filename)) {
          // File already exists in R2, keep the R2 version (but skip videos and podcast audio)
          if (localMedia.type !== 'video' && !(postData.platform === 'podcast' && localMedia.type === 'audio')) {
            mediaToKeep.push(existingMediaByFilename.get(filename));
          }
        } else {
          // Videos are expensive for R2 - only admin tier can upload
          // Other tiers should use embed/original URL on supported platforms
          if (localMedia.type === 'video') {
            // Only admin tier can upload videos
            if (options?.tier !== 'admin') {
              // Skip video upload for non-admin tiers
              continue;
            }
            // Admin tier: proceed with video upload
          }
          // NEVER upload audio for podcasts - use streaming URL from downloadedUrls instead
          if (postData.platform === 'podcast' && localMedia.type === 'audio') {
            // Skip podcast audio upload - will use downloadedUrls for streaming
            continue;
          }
          // New image file, needs upload
          mediaToUpload.push(localMedia);
        }
      }

      // Determine what to delete (files in R2 but not in new postData)
      const mediaToDelete: string[] = [];
      for (const [filename, existingMedia] of existingMediaByFilename.entries()) {
        if (!newMediaByFilename.has(filename)) {
          // File exists in R2 but not in new postData, delete it
          const url = existingMedia?.url;
          if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            mediaToDelete.push(url);
          }
        }
      }

      if (this.config.debug) {
        console.debug('[ShareAPIClient] Media sync analysis:', {
          toUpload: mediaToUpload.length,
          toDelete: mediaToDelete.length,
          toKeep: mediaToKeep.length
        });
      }

      // STEP 3: Upload new media files to R2
      const remoteMedia: any[] = [...mediaToKeep];

      for (let i = 0; i < mediaToUpload.length; i++) {
        const mediaItem = mediaToUpload[i];
        if (!mediaItem) continue;

        try {
          // Convert relative path to vault path
          // If path starts with '../', it's a relative path from markdown file
          let vaultPath = mediaItem.url;
          if (vaultPath.includes('../')) {
            // Remove all '../' and keep just the actual path
            vaultPath = vaultPath.replace(/^(\.\.\/)+/, '');
          }

          const mediaFile = this.vault.getAbstractFileByPath(vaultPath);
          if (!mediaFile || !('extension' in mediaFile)) {
            console.warn('[ShareAPIClient] Media file not found in vault:', {
              url: mediaItem.url,
              mediaFile: mediaFile
            });
            remoteMedia.push(mediaItem);
            continue;
          }

          // Read media as binary
          const mediaBuffer = await this.vault.readBinary(mediaFile as any);

          // Convert to base64
          const base64 = this.arrayBufferToBase64(mediaBuffer);

          // Extract filename
          const filename = mediaItem.url.split('/').pop() || 'media';

          // Determine content type
          const ext = filename.split('.').pop()?.toLowerCase();
          const contentType =
            ext === 'png' ? 'image/png' :
            ext === 'gif' ? 'image/gif' :
            ext === 'webp' ? 'image/webp' :
            ext === 'mp4' ? 'video/mp4' :
            ext === 'webm' ? 'video/webm' :
            ext === 'mov' ? 'video/quicktime' : 'image/jpeg';

          // Upload to R2
          const uploadResponse = await this.httpRequest<{ success: boolean; data?: { url: string } }>(
            'POST',
            '/api/upload-share-media',
            { shareId, filename, contentType, data: base64 }
          );

          if (uploadResponse?.success && uploadResponse?.data?.url) {
            const uploadedItem = {
              ...mediaItem,
              url: uploadResponse.data.url,
              thumbnail: uploadResponse.data.url
            };
            remoteMedia.push(uploadedItem);
            uploadedMedia.push(uploadedItem);

            // Report progress
            if (onProgress) {
              onProgress(i + 1, mediaToUpload.length);
            }
          } else {
            if (mediaItem) {
              remoteMedia.push(mediaItem);
            }
          }
        } catch (err) {
          if (mediaItem) {
            remoteMedia.push(mediaItem);
          }
        }
      }

      // STEP 4: Delete removed media files from R2
      for (const mediaUrl of mediaToDelete) {
        // Extract filename from URL: https://domain/media/shareId/filename.ext
        const urlParts = mediaUrl.split('/');
        const filename = urlParts[urlParts.length - 1];

        try {
          await this.httpRequest('DELETE', `/api/upload-share-media/${shareId}/${filename}`);
        } catch (err: any) {
          // Ignore 404 errors (file already deleted or never existed)
          if (err?.statusCode !== 404) {
            console.error(`[ShareAPIClient] Failed to delete media ${filename}:`, err);
          }
          // Continue with other deletions even if one fails
        }
      }

      // STEP 5: Build path mapping for markdown conversion
      const pathMapping = new Map<string, string>();

      // Map all postData.media items (which have local paths) to their R2 URLs
      for (const localMedia of postData.media) {
        const remoteItem = remoteMedia.find(r => {
          // Find by matching filename
          const localFilename = localMedia.url.split('/').pop();
          const remoteFilename = r.url.split('/').pop();
          return localFilename === remoteFilename;
        });

        if (remoteItem && remoteItem.url !== localMedia.url) {
          pathMapping.set(localMedia.url, remoteItem.url);
        }
      }

      // Map embedded archives media (for User Posts)
      if (postData.embeddedArchives) {
        postData.embeddedArchives.forEach(archive => {
          (archive.media || []).forEach(localMedia => {
            const remoteItem = remoteMedia.find(r => {
              const localFilename = localMedia.url.split('/').pop();
              const remoteFilename = r.url.split('/').pop();
              return localFilename === remoteFilename;
            });

            if (remoteItem && remoteItem.url !== localMedia.url) {
              pathMapping.set(localMedia.url, remoteItem.url);
            }
          });
        });
      }

      // STEP 6: Replace markdown paths with R2 URLs
      let updatedText = postData.content.text;
      let updatedHtml = postData.content.html;

      pathMapping.forEach((remoteUrl, localPath) => {
        // Escape special regex characters in local path
        const escapedPath = localPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Replace in markdown: ![alt](localPath) -> ![alt](remoteUrl)
        const markdownRegex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedPath}\\)`, 'g');
        updatedText = updatedText.replace(markdownRegex, `![$1](${remoteUrl})`);

        // Replace in HTML if present
        if (updatedHtml) {
          const htmlRegex = new RegExp(escapedPath, 'g');
          updatedHtml = updatedHtml.replace(htmlRegex, remoteUrl);
        }
      });

      // STEP 7: Prepare updated PostData
      // Update embedded archives media URLs
      // If embeddedArchives is empty array [], keep it as [] (important for deletion)
      // If embeddedArchives is undefined, keep it as undefined (no change)
      const updatedEmbeddedArchives = postData.embeddedArchives !== undefined
        ? postData.embeddedArchives.map(archive => ({
            ...archive,
            media: archive.media?.map(m => {
              const remoteUrl = pathMapping.get(m.url);
              if (this.config.debug) {
                console.debug('[ShareAPIClient] Media path mapping:', {
                  localPath: m.url,
                  remoteUrl: remoteUrl || 'not found',
                  mapped: !!remoteUrl
                });
              }
              return remoteUrl ? { ...m, url: remoteUrl } : m;
            })
          }))
        : undefined;

      const updatedPostData: PostData = {
        ...postData,
        content: {
          text: updatedText,
          html: updatedHtml,
          hashtags: postData.content.hashtags,
          community: postData.content.community  // Reddit subreddit info
        },
        media: remoteMedia,
        embeddedArchives: updatedEmbeddedArchives,
        metadata: {
          ...postData.metadata,
          timestamp: typeof postData.metadata.timestamp === 'string'
            ? postData.metadata.timestamp
            : (postData.metadata.timestamp as Date).toISOString()
        },
        // CRITICAL: Don't include aiComments in media updates
        // Setting to undefined tells the Worker to preserve existing aiComments
        // (vs [] which means explicitly delete all comments)
        aiComments: undefined
      };

      // STEP 8: Update share
      const updateRequest: ShareAPIRequest = {
        postData: updatedPostData,
        options: {
          ...options,
          shareId
        }
      };

      if (this.config.debug) {
        console.debug('[ShareAPIClient] Update request prepared:', {
          shareId,
          embeddedArchivesCount: updatedPostData.embeddedArchives?.length ?? 'undefined',
          embeddedArchivesValue: updatedPostData.embeddedArchives,
          mediaCount: updatedPostData.media?.length ?? 0
        });
      }

      return await this.updateShare(shareId, updateRequest);

    } catch (error) {
      // ROLLBACK: Delete newly uploaded media on failure
      if (uploadedMedia.length > 0) {
        for (const media of uploadedMedia) {
          try {
            const urlParts = media.url.split('/');
            const filename = urlParts[urlParts.length - 1];
            await this.httpRequest('DELETE', `/api/upload-share-media/${shareId}/${filename}`);
          } catch {
          }
        }
      }

      throw error;
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte !== undefined) {
        binary += String.fromCharCode(byte);
      }
    }
    return btoa(binary);
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    attempt: number = 0
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const httpError = error as HttpError;

      // Check if we should retry
      if (attempt >= this.retryConfig.maxAttempts - 1) {
        throw httpError;
      }

      if (!this.retryConfig.shouldRetry(httpError)) {
        throw httpError;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = this.calculateRetryDelay(attempt, httpError);

      // Wait before retry
      await this.sleep(delay);

      // Retry the operation
      return this.executeWithRetry(operation, attempt + 1);
    }
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number, error: HttpError): number {
    // Use retry-after header if available (for rate limiting)
    if (error instanceof RateLimitError && error.retryAfter) {
      return error.retryAfter * 1000; // Convert to milliseconds
    }

    // Exponential backoff: delay = base * 2^attempt
    const exponentialDelay = this.retryConfig.baseDelay * Math.pow(2, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelay);

    // Add jitter (±25% randomization) to prevent thundering herd
    const jitter = cappedDelay * 0.25;
    const jitteredDelay = cappedDelay + (Math.random() * 2 - 1) * jitter;

    return Math.round(Math.max(jitteredDelay, 0));
  }

  /**
   * Sleep helper for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate unique request ID for tracing
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Helper method to add password protection to a share request
   */
  static addPasswordProtection(
    request: ShareAPIRequest,
    password: string
  ): ShareAPIRequest {
    return {
      ...request,
      options: {
        ...request.options,
        password
      }
    };
  }

  /**
   * Helper method to set custom expiry date
   */
  static setExpiryDate(
    request: ShareAPIRequest,
    expiryDate: Date,
    tier: 'free' | 'pro' = 'free'
  ): ShareAPIRequest {
    // Validate expiry based on tier
    const now = new Date();
    const maxFreeExpiry = new Date();
    maxFreeExpiry.setDate(maxFreeExpiry.getDate() + 30);

    if (tier === 'free' && expiryDate > maxFreeExpiry) {
      throw new Error('Free tier: Maximum expiry is 30 days');
    }

    if (expiryDate <= now) {
      throw new Error('Expiry date must be in the future');
    }

    return {
      ...request,
      options: {
        ...request.options,
        expiry: Math.floor(expiryDate.getTime() / 1000) // Convert to Unix timestamp
      }
    };
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return true;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    // No initialization needed
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // No cleanup needed
  }
}
