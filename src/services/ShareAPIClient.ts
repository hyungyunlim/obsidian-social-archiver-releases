/**
 * ShareAPIClient - Client service for communicating with Workers share API
 *
 * Features:
 * - POST /api/share endpoint integration
 * - Authentication with license keys
 * - Rate limiting detection and handling
 * - Exponential backoff retry logic
 * - Password protection and custom expiry support
 */

import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse, type AxiosError } from 'axios';
import { Platform, type Vault } from 'obsidian';
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
 * ShareAPIClient service for Workers API integration
 */
export class ShareAPIClient implements IService {
  name = 'ShareAPIClient';
  private client: AxiosInstance;
  private config: Required<Omit<ShareAPIConfig, 'apiKey' | 'vault'>> & Pick<ShareAPIConfig, 'apiKey' | 'vault'>;
  private retryConfig: RetryConfig;
  private vault?: Vault;

  // Request queue for serializing updateShare calls per shareId
  // This prevents race conditions when multiple updates happen simultaneously
  private static updateQueues: Map<string, Promise<ShareAPIResponse>> = new Map();

  constructor(config: ShareAPIConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.vault = config.vault;
    this.retryConfig = DEFAULT_RETRY_CONFIG;

    // Create axios instance
    this.client = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-Client': 'obsidian-plugin',
        'X-Client-Version': this.config.pluginVersion || '0.0.0',
        'X-Platform': this.getPlatformIdentifier()
      }
    });

    // Setup interceptors
    this.setupInterceptors();
  }

  /**
   * Get platform identifier for X-Platform header
   */
  private getPlatformIdentifier(): string {
    if (Platform.isDesktop) {
      if (Platform.isMacOS) return 'macos';
      if (Platform.isWin) return 'windows';
      return 'linux';
    }
    return Platform.isIosApp ? 'ios' : 'android';
  }

  /**
   * Setup axios interceptors for request/response handling
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Add authentication if API key is provided
        if (this.config.apiKey) {
          config.headers['Authorization'] = `Bearer ${this.config.apiKey}`;
          config.headers['X-License-Key'] = this.config.apiKey;
        }

        // Add request ID for tracing
        config.headers['X-Request-Id'] = this.generateRequestId();

        // Log request if debug mode
        if (this.config.debug) {
          console.debug('[ShareAPIClient] Request:', {
            method: config.method,
            url: config.url,
            headers: config.headers,
            data: config.data
          });
        }

        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        // Log response if debug mode
        if (this.config.debug) {
          console.debug('[ShareAPIClient] Response:', {
            status: response.status,
            data: response.data,
            headers: response.headers
          });
        }

        return response;
      },
      (error) => {
        // Transform to standardized error
        const httpError = this.transformError(error);

        // Log error if debug mode
        if (this.config.debug) {
          console.error('[ShareAPIClient] Error:', httpError);
        }

        return Promise.reject(httpError);
      }
    );
  }

  /**
   * Create a share link for a post
   */
  async createShare(request: ShareAPIRequest): Promise<ShareAPIResponse> {
    return this.executeWithRetry(async () => {
      const response = await this.client.post<{ success: boolean; data: ShareAPIResponse }>('/api/share', request);
      // Workers API returns { success: true, data: ShareAPIResponse }
      return response.data.data;
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
        const response = await this.client.post<{ success: boolean; data: ShareAPIResponse }>('/api/share', updateRequest);
        return response.data.data;
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
      await this.client.delete(`/api/share/${shareId}`);
    });
  }

  /**
   * Get share status/info
   */
  async getShareInfo(shareId: string): Promise<ShareAPIResponse> {
    return this.executeWithRetry(async () => {
      const response = await this.client.get<{ success: boolean; data: any }>(`/api/share/${shareId}`);
      // Workers API returns { success: true, data: shareData }
      // Extract shareId and shareUrl from data
      return {
        shareId: response.data.data.shareId,
        shareUrl: response.data.data.shareUrl || '',
        passwordProtected: !!response.data.data.options?.password
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
        const response = await this.client.get(`/api/share/${shareId}`);
        return response.data?.data;
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
          const uploadResponse = await this.client.post('/api/upload-share-media', {
            shareId,
            filename,
            contentType,
            data: base64
          });

          if (uploadResponse.data?.success && uploadResponse.data?.data?.url) {
            const uploadedItem = {
              ...mediaItem,
              url: uploadResponse.data.data.url,
              thumbnail: uploadResponse.data.data.url
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
          await this.client.delete(`/api/upload-share-media/${shareId}/${filename}`);
        } catch (err: any) {
          // Ignore 404 errors (file already deleted or never existed)
          if (err?.response?.status !== 404) {
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
            await this.client.delete(`/api/upload-share-media/${shareId}/${filename}`);
          } catch (rollbackErr) {
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
   * Transform axios error to standardized HttpError
   */
  private transformError(error: unknown): HttpError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<any>;

      // Network errors
      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        return new TimeoutError(
          axiosError.message || 'Request timeout',
          this.createRequestConfig(axiosError.config)
        );
      }

      if (!axiosError.response) {
        return new NetworkError(
          axiosError.message || 'Network error',
          this.createRequestConfig(axiosError.config),
          axiosError
        );
      }

      const status = axiosError.response.status;
      const data = axiosError.response.data;
      const headers = axiosError.response.headers as Record<string, string>;

      // Rate limiting
      if (status === 429) {
        const retryAfter = headers['retry-after'] ? parseInt(headers['retry-after'], 10) : undefined;
        return new RateLimitError(
          data?.message || 'Rate limit exceeded',
          {
            statusCode: status,
            request: this.createRequestConfig(axiosError.config),
            response: this.createResponse(axiosError.response),
            retryAfter,
            limit: headers['x-ratelimit-limit'] ? parseInt(headers['x-ratelimit-limit'], 10) : undefined,
            remaining: headers['x-ratelimit-remaining'] ? parseInt(headers['x-ratelimit-remaining'], 10) : undefined
          }
        );
      }

      // Authentication errors
      if (status === 401 || status === 403) {
        return new AuthenticationError(
          data?.message || 'Authentication failed',
          status,
          this.createRequestConfig(axiosError.config),
          this.createResponse(axiosError.response)
        );
      }

      // Invalid request errors
      if (status === 400 || status === 422) {
        return new InvalidRequestError(
          data?.message || 'Invalid request',
          status,
          {
            request: this.createRequestConfig(axiosError.config),
            response: this.createResponse(axiosError.response),
            validationErrors: data?.errors
          }
        );
      }

      // Server errors
      if (status >= 500) {
        return new ServerError(
          data?.message || 'Server error',
          status,
          this.createRequestConfig(axiosError.config),
          this.createResponse(axiosError.response)
        );
      }

      // Generic HTTP error
      return new HttpError(
        data?.message || axiosError.message || 'HTTP error',
        status.toString(),
        {
          statusCode: status,
          request: this.createRequestConfig(axiosError.config),
          response: this.createResponse(axiosError.response)
        }
      );
    }

    // Non-axios error
    if (error instanceof Error) {
      return new HttpError(error.message, '0', { statusCode: 0 });
    }

    return new HttpError('Unknown error', '0', { statusCode: 0 });
  }

  /**
   * Create request config from axios config
   */
  private createRequestConfig(config?: AxiosRequestConfig): any {
    if (!config) return undefined;

    return {
      method: config.method?.toUpperCase() || 'GET',
      url: config.url || '',
      headers: config.headers as Record<string, string>,
      params: config.params,
      data: config.data,
      timeout: config.timeout
    };
  }

  /**
   * Create response from axios response
   */
  private createResponse(response?: AxiosResponse): any {
    if (!response) return undefined;

    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers as Record<string, string>,
      config: this.createRequestConfig(response.config),
      duration: 0
    };
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