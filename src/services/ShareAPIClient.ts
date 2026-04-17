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
import type { PostData, Media } from '@/types/post';
import type { IService } from './base/IService';
import type { UserTier } from '@/types/settings';
import type {
  ResolveShareMediaHint,
  ResolveShareMediaRequest,
  ResolveShareMediaResponse,
  ResolvedShareMediaItem,
  ShareMediaPayloadItem,
} from '@/types/share';
import { buildShareResolveHints } from '@/utils/shareResolveHints';
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
    archiveId?: string; // Server archive ID for composed posts (associates share with archive record)
    sourceArchiveId?: string; // Archive-backed local note — lets the worker reuse preserved R2 media (PRD §6.3)
    /**
     * Frontmatter `mediaSourceUrls` forwarded from the caller so
     * `updateShareWithMedia` can auto-build resolve hints without the caller
     * needing to pre-call `resolveShareMedia`. Not serialized to the server.
     */
    mediaSourceUrls?: string[];
  };
}

/**
 * Breakdown of what `updateShareWithMedia` did with each main-post media
 * item. Attached to the response so callers can show accurate notices
 * (e.g. distinguishing "uploaded" from "reused from archive").
 *
 * Counts refer to the top-level `postData.media` array observed by the
 * method, AFTER any filtering the caller did (e.g. video removal for
 * non-admin tier in PostCardRenderer).
 */
export interface ShareMediaStats {
  /** Total top-level media items considered. */
  totalCount: number;
  /** New media actually POSTed to `/api/upload-share-media`. */
  uploadedCount: number;
  /** Items reused from `archives/*` R2 (auto-resolve or caller-provided map). */
  reusedCount: number;
  /** Items kept because a `shares/*` object with the same filename already existed. */
  keptCount: number;
  /** Items skipped (non-admin video, podcast audio, vault file missing, upload failed). */
  skippedCount: number;
}

/**
 * Share API response interface
 */
export interface ShareAPIResponse {
  shareId: string;
  shareUrl: string;
  passwordProtected: boolean;
  expiresAt?: number;
  /**
   * Populated only by `updateShareWithMedia`. Other endpoints
   * (`createShare`, `getShareInfo`) leave this `undefined`.
   */
  mediaStats?: ShareMediaStats;
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
  _url: string
): HttpError {
  const message = (data as Record<string, unknown>)?.['message'] as string || `HTTP ${status} error`;

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
      validationErrors: (data as Record<string, unknown>)?.['errors'] as string[] | undefined
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

  // In-flight dedupe guard for updateShareWithMedia.
  // Multiple code paths can legitimately trigger a share update in response
  // to a single user action (e.g. PostCardRenderer.createShare fires a
  // fire-and-forget media upload AND processFrontMatter triggers a vault
  // 'modify' event that some listeners react to). Without this guard,
  // `updateShareWithMedia` ends up POSTing to `/api/share` and
  // `/api/share/resolve-media` twice for a single shareId.
  //
  // Keyed by shareId → the live promise. While an update is in-flight for
  // a given shareId, any concurrent caller reuses the same promise instead
  // of kicking off a duplicate request. The entry is removed once the
  // promise settles.
  private static inflightUpdateWithMedia: Map<string, Promise<ShareAPIResponse>> = new Map();

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
      return result;
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
        return result;
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
      const result = await this.httpRequest<{ success: boolean; data: Record<string, unknown> } | Record<string, unknown>>(
        'GET',
        `/api/share/${shareId}`
      );
      // Workers API returns { success: true, data: shareData }
      if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
        const data = result.data as Record<string, unknown>;
        return {
          shareId: data.shareId as string,
          shareUrl: (data.shareUrl || '') as string,
          passwordProtected: !!(data.options as Record<string, unknown> | undefined)?.password,
        };
      }
      // Unwrapped format (tests return response directly)
      const r = result;
      return {
        shareId: r.shareId as string,
        shareUrl: (r.shareUrl || '') as string,
        passwordProtected: !!(r.options as Record<string, unknown> | undefined)?.password,
        expiresAt: r.expiresAt != null ? Number(r.expiresAt) : undefined,
      };
    });
  }

  /**
   * Ask the worker which top-level media items are already preserved under
   * `archives/{userId}/{archiveId}/media/*` and can therefore be reused
   * without re-uploading.
   *
   * Fail-open contract (PRD §5.2):
   *   - Any network / HTTP error → returns `null` (caller must fall back
   *     to the legacy upload flow).
   *   - Server returns a malformed payload → returns `null`.
   *
   * The caller is responsible for deciding *whether* to call this
   * (preconditions are in PRD §9.3).
   */
  async resolveShareMedia(
    archiveId: string,
    items: ResolveShareMediaHint[]
  ): Promise<ResolveShareMediaResponse | null> {
    if (!archiveId || !Array.isArray(items) || items.length === 0) {
      return null;
    }

    const request: ResolveShareMediaRequest = { archiveId, items };

    try {
      const result = await this.httpRequest<
        | { success: boolean; data: ResolveShareMediaResponse }
        | ResolveShareMediaResponse
      >('POST', '/api/share/resolve-media', request);

      const payload = ShareAPIClient.unwrapApiResponse<ResolveShareMediaResponse>(result);
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      // Minimal shape validation — anything unexpected → fail-open.
      if (
        typeof payload.archiveId !== 'string' ||
        !Array.isArray(payload.resolved) ||
        typeof payload.resolvedCount !== 'number' ||
        typeof payload.totalCount !== 'number'
      ) {
        return null;
      }

      return payload;
    } catch (error) {
      if (this.config.debug) {
        console.warn('[ShareAPIClient] resolveShareMedia failed (falling back to legacy upload):', error);
      }
      return null;
    }
  }

  /**
   * Build resolve hints from `media` + `mediaSourceUrls` and invoke
   * `resolveShareMedia`, returning the index→item map used by
   * `updateShareWithMedia`. Fully fail-open: any null response or error
   * yields `undefined`, so the caller falls through to the legacy upload.
   *
   * See `utils/shareResolveHints.ts` for the shared hint-construction logic
   * that keeps this path in sync with `PostShareService.resolveArchiveMedia`.
   */
  private async autoResolveMedia(
    archiveId: string,
    media: Media[],
    sourceUrls: string[]
  ): Promise<Map<number, ResolvedShareMediaItem> | undefined> {
    try {
      const hints = buildShareResolveHints(media, sourceUrls);
      if (hints.length === 0) return undefined;

      const response = await this.resolveShareMedia(archiveId, hints);
      if (!response || response.resolvedCount <= 0) return undefined;

      const map = new Map<number, ResolvedShareMediaItem>();
      response.resolved.forEach((item, index) => {
        if (item && typeof item.url === 'string' && item.url.length > 0) {
          map.set(index, item);
        }
      });

      if (this.config.debug) {
        console.debug('[ShareAPIClient] auto-resolve:', {
          archiveId,
          hints: hints.length,
          resolvedFromServer: response.resolvedCount,
          mappedAfterFilter: map.size,
          preservationStatus: response.preservationStatus,
        });
      }

      return map.size > 0 ? map : undefined;
    } catch (error) {
      if (this.config.debug) {
        console.warn('[ShareAPIClient] auto-resolve threw (falling back to legacy upload):', error);
      }
      return undefined;
    }
  }

  /**
   * Helper: unwrap the worker's `{ success, data }` envelope when present.
   * Keeps handler code type-safe without duplicating the pattern.
   */
  private static unwrapApiResponse<T>(
    result: { success: boolean; data: T } | T | null | undefined
  ): T | null {
    if (result == null) return null;
    if (
      typeof result === 'object' &&
      'success' in (result as Record<string, unknown>) &&
      'data' in (result as Record<string, unknown>)
    ) {
      return (result as { success: boolean; data: T }).data;
    }
    return result as T;
  }

  /**
   * Update share with media handling - uploads new media, deletes removed media, converts markdown paths.
   *
   * When `resolvedMediaMap` is provided, each entry tells this method that
   * a given top-level `postData.media[index]` already exists as a preserved
   * archive R2 object. Those items are NOT re-uploaded; their URL is
   * swapped for `resolved.url` and `mediaOrigin` is set to `'archive'`.
   * Unresolved items go through the existing local-read + upload path with
   * `mediaOrigin = 'share'`.
   *
   * @param shareId - Share ID to update
   * @param postData - New post data with local media paths
   * @param options - Share options (username, password, expiry, sourceArchiveId)
   * @param onProgress - Optional progress callback (current, total). Total reflects *actual*
   *                     upload work, i.e. excludes resolved-and-reused items.
   * @param resolvedMediaMap - Optional map of `postData.media` index → preserved archive object
   * @returns Updated share response
   */
  async updateShareWithMedia(
    shareId: string,
    postData: PostData,
    options?: ShareAPIRequest['options'],
    onProgress?: (current: number, total: number) => void,
    resolvedMediaMap?: Map<number, ResolvedShareMediaItem>
  ): Promise<ShareAPIResponse> {
    // In-flight dedupe: reuse the live promise if another caller already
    // started an update for this shareId. Keyed per-shareId because that's
    // the R2 / KV unit of work. Cross-instance safe: uses static map so
    // separate `new ShareAPIClient(...)` calls in different code paths
    // still dedupe against each other.
    const existing = ShareAPIClient.inflightUpdateWithMedia.get(shareId);
    if (existing) {
      return existing;
    }

    const promise = this.doUpdateShareWithMedia(
      shareId,
      postData,
      options,
      onProgress,
      resolvedMediaMap
    );
    ShareAPIClient.inflightUpdateWithMedia.set(shareId, promise);
    try {
      return await promise;
    } finally {
      // Only clear if it's still us — avoids a racy delete overwriting a
      // newer in-flight entry created after we settle.
      if (ShareAPIClient.inflightUpdateWithMedia.get(shareId) === promise) {
        ShareAPIClient.inflightUpdateWithMedia.delete(shareId);
      }
    }
  }

  /**
   * Actual implementation of update-share-with-media.
   * Wrapped by `updateShareWithMedia` above which adds in-flight dedupe.
   */
  private async doUpdateShareWithMedia(
    shareId: string,
    postData: PostData,
    options?: ShareAPIRequest['options'],
    onProgress?: (current: number, total: number) => void,
    resolvedMediaMap?: Map<number, ResolvedShareMediaItem>
  ): Promise<ShareAPIResponse> {
    if (!this.vault) {
      throw new Error('Vault is required for media operations. Please provide vault in ShareAPIClient config.');
    }

    // Auto-resolve gate: if the caller didn't pre-resolve but passed enough
    // context to build hints, try resolve-first transparently. This covers
    // the many callers (TimelineContainer action bar, PostCardRenderer,
    // TimelineView inline editor) that historically called this method
    // without going through PostShareService's explicit resolve flow.
    //
    // Fail-open: any error / malformed response inside `autoResolveMedia`
    // returns null and we proceed with the legacy upload path.
    let effectiveResolvedMap = resolvedMediaMap;
    // Always-on diagnostic so the reuse path is visible in production without a debug flag.
    const gateArchiveId = options?.sourceArchiveId ?? postData.sourceArchiveId;
    if (!effectiveResolvedMap && postData.media && postData.media.length > 0 && gateArchiveId) {
      const sourceUrls = options?.mediaSourceUrls ?? postData.mediaSourceUrls ?? [];
      effectiveResolvedMap = await this.autoResolveMedia(gateArchiveId, postData.media, sourceUrls);
    }

    const uploadedMedia: ShareMediaPayloadItem[] = [];

    try {
      // STEP 1: Fetch existing share data to detect changes
      const existingShareData = await this.executeWithRetry(async () => {
        const result = await this.httpRequest<{ success: boolean; data: Record<string, unknown> } | Record<string, unknown>>(
          'GET',
          `/api/share/${shareId}`
        );
        if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
          return result.data;
        }
        return result;
      });

      // STEP 2: Build filename maps + identify resolved (archive-reused) main-post media
      // Map: filename -> existing R2 media object
      const existingMediaByFilename = new Map<string, Record<string, unknown>>();
      ((existingShareData as Record<string, unknown> | undefined)?.['media'] as Record<string, unknown>[] || []).forEach((m) => {
        const filename = (m?.['url'] as string | undefined)?.split('/').pop();
        if (filename) {
          existingMediaByFilename.set(filename, m);
        }
      });

      // Pre-compute the set of main-post media local paths that the caller
      // has already resolved against archive-preserved R2 objects. These are
      // excluded from the filename-based upload/keep classification below so
      // we do NOT touch local files for them.
      const resolvedLocalPaths = new Set<string>();
      if (effectiveResolvedMap && effectiveResolvedMap.size > 0) {
        for (const [index] of effectiveResolvedMap.entries()) {
          const localItem = postData.media[index];
          if (localItem?.url) {
            resolvedLocalPaths.add(localItem.url);
          }
        }
      }

      // Map: filename -> new local media object
      // Include media from main post AND embedded archives.
      // Resolved main-post items are skipped here because they'll be injected
      // directly as archive-origin entries in STEP 3.
      const newMediaByFilename = new Map<string, Media>();

      // Add main post media (skip resolved ones)
      postData.media.forEach(m => {
        if (resolvedLocalPaths.has(m.url)) return;
        const filename = m.url.split('/').pop();
        if (filename) {
          newMediaByFilename.set(filename, m);
        }
      });

      // Add embedded archives media (for User Posts with embedded archives)
      // NOTE: v1 scope is top-level media only (PRD §4) — embedded archive
      // media is never resolved via resolveShareMedia, always uploaded normally.
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
      const mediaToKeep: ShareMediaPayloadItem[] = [];
      // Explicit skip counter — any `continue` in the classifier below or
      // in the upload loop adds 1. We keep it separate from uploadedCount so
      // callers can show accurate "X skipped" messages in the Notice.
      let skippedCount = 0;

      for (const [filename, localMedia] of newMediaByFilename.entries()) {
        if (existingMediaByFilename.has(filename)) {
          // File already exists in R2, keep the R2 version (but skip videos and podcast audio)
          if (localMedia.type !== 'video' && !(postData.platform === 'podcast' && localMedia.type === 'audio')) {
            const existingMedia = existingMediaByFilename.get(filename);
            if (existingMedia) {
              // Merge the wire record with the local item's Media-required fields
              // (e.g. `type`) to satisfy ShareMediaPayloadItem without losing any
              // server-side metadata like `mediaOrigin` / `r2Key` (PRD §6.7).
              mediaToKeep.push({
                ...localMedia,
                ...(existingMedia as Partial<ShareMediaPayloadItem>),
                url: (existingMedia['url'] as string | undefined) ?? localMedia.url,
              });
            }
          } else {
            // Filename matched but skipped re-use (video / podcast audio) —
            // count as skipped so the summary reflects "not uploaded, not kept".
            skippedCount++;
          }
        } else {
          // Videos are expensive for R2 - only admin tier can upload
          // Other tiers should use embed/original URL on supported platforms
          if (localMedia.type === 'video') {
            // Only admin tier can upload videos
            if (options?.tier !== 'admin') {
              // Skip video upload for non-admin tiers
              skippedCount++;
              continue;
            }
            // Admin tier: proceed with video upload
          }
          // NEVER upload audio for podcasts - use streaming URL from downloadedUrls instead
          if (postData.platform === 'podcast' && localMedia.type === 'audio') {
            // Skip podcast audio upload - will use downloadedUrls for streaming
            skippedCount++;
            continue;
          }
          // New image file, needs upload
          mediaToUpload.push(localMedia);
        }
      }

      // Determine what to delete (files in R2 but not in new postData or resolved map)
      // Resolved items have archive R2 URLs — their filenames will not appear in
      // newMediaByFilename, so we additionally guard against deleting any R2
      // object whose key/URL clearly originates from the archives/ namespace.
      const resolvedFilenames = new Set<string>();
      if (effectiveResolvedMap) {
        for (const resolved of effectiveResolvedMap.values()) {
          const fn = resolved.url.split('/').pop();
          if (fn) resolvedFilenames.add(fn);
        }
      }

      const mediaToDelete: string[] = [];
      for (const [filename, existingMedia] of existingMediaByFilename.entries()) {
        if (newMediaByFilename.has(filename) || resolvedFilenames.has(filename)) {
          continue;
        }
        // File exists in R2 but not in new postData, delete it
        const url = existingMedia?.['url'] as string | undefined;
        const r2Key = existingMedia?.['r2Key'] as string | undefined;
        const origin = existingMedia?.['mediaOrigin'] as string | undefined;
        // Defense in depth (PRD §6.8): never delete archive-owned objects.
        if (origin === 'archive' || (r2Key && r2Key.startsWith('archives/'))) {
          continue;
        }
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          mediaToDelete.push(url);
        }
      }

      if (this.config.debug) {
        console.debug('[ShareAPIClient] Media sync analysis:', {
          toUpload: mediaToUpload.length,
          toDelete: mediaToDelete.length,
          toKeep: mediaToKeep.length,
          toReuseFromArchive: effectiveResolvedMap?.size ?? 0,
        });
      }

      // STEP 3: Upload new media files to R2
      // Start from kept items + inject resolved archive-origin entries.
      const remoteMedia: ShareMediaPayloadItem[] = [...mediaToKeep];

      if (effectiveResolvedMap && effectiveResolvedMap.size > 0) {
        for (const [index, resolved] of effectiveResolvedMap.entries()) {
          const localItem = postData.media[index];
          if (!localItem) continue;
          const archiveEntry: ShareMediaPayloadItem = {
            ...localItem,
            url: resolved.url,
            thumbnail: resolved.url,
            mediaOrigin: 'archive',
            r2Key: resolved.r2Key,
            sourceArchiveId: options?.sourceArchiveId ?? postData.sourceArchiveId,
            sourceIndex: resolved.sourceIndex ?? index,
            variant: resolved.variant,
          };
          remoteMedia.push(archiveEntry);
        }
      }

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
            skippedCount++;
            continue;
          }

          // Read media as binary
          const mediaBuffer = await this.vault.readBinary(mediaFile as import('obsidian').TFile);

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
            const uploadedItem: ShareMediaPayloadItem = {
              ...mediaItem,
              url: uploadResponse.data.url,
              thumbnail: uploadResponse.data.url,
              mediaOrigin: 'share',
            };
            remoteMedia.push(uploadedItem);
            uploadedMedia.push(uploadedItem);

            // Report progress — total reflects only actual upload work,
            // not reused archive items (PRD §6.4 / §7 UX note).
            if (onProgress) {
              onProgress(i + 1, mediaToUpload.length);
            }
          } else {
            if (mediaItem) {
              remoteMedia.push(mediaItem);
            }
            // Upload returned non-success; count as skipped so the summary
            // stays honest (we kept the local-path reference, not an R2 one).
            skippedCount++;
          }
        } catch {
          if (mediaItem) {
            remoteMedia.push(mediaItem);
          }
          skippedCount++;
        }
      }

      // STEP 4: Delete removed media files from R2
      for (const mediaUrl of mediaToDelete) {
        // Extract filename from URL: https://domain/media/shareId/filename.ext
        const urlParts = mediaUrl.split('/');
        const filename = urlParts[urlParts.length - 1];

        try {
          await this.httpRequest('DELETE', `/api/upload-share-media/${shareId}/${filename}`);
        } catch (err: unknown) {
          // Ignore 404 errors (file already deleted or never existed)
          if ((err as Record<string, unknown>)?.['statusCode'] !== 404) {
            console.error(`[ShareAPIClient] Failed to delete media ${filename}:`, err);
          }
          // Continue with other deletions even if one fails
        }
      }

      // STEP 5: Build path mapping for markdown conversion
      const pathMapping = new Map<string, string>();

      // Resolved archive-origin items have an explicit index → URL mapping.
      // Use that first so filename collisions (unlikely but possible) don't
      // mis-route a reused archive URL.
      if (effectiveResolvedMap && effectiveResolvedMap.size > 0) {
        for (const [index, resolved] of effectiveResolvedMap.entries()) {
          const localItem = postData.media[index];
          if (localItem && resolved.url && localItem.url !== resolved.url) {
            pathMapping.set(localItem.url, resolved.url);
          }
        }
      }

      // Map remaining postData.media items (which have local paths) to their R2 URLs
      for (const localMedia of postData.media) {
        if (pathMapping.has(localMedia.url)) continue;
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
        // ShareMediaPayloadItem extends Media, so this is structurally valid;
        // extra share-origin metadata (mediaOrigin/r2Key/etc.) is preserved on the wire.
        media: remoteMedia,
        embeddedArchives: updatedEmbeddedArchives,
        metadata: {
          ...postData.metadata,
          timestamp: typeof postData.metadata.timestamp === 'string'
            ? postData.metadata.timestamp
            : (postData.metadata.timestamp).toISOString()
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

      const response = await this.updateShare(shareId, updateRequest);

      // Compose media stats.
      // - reusedCount: archive-origin items injected from the resolve map
      //   (only main-post media is eligible — PRD §4)
      // - uploadedCount: successful `/api/upload-share-media` calls
      // - keptCount: items reused from the existing share payload (shares/*)
      // - skippedCount: accumulated above at every skip site
      // - totalCount: top-level main-post media count the method observed
      const mediaStats: ShareMediaStats = {
        totalCount: postData.media.length,
        uploadedCount: uploadedMedia.length,
        reusedCount: effectiveResolvedMap?.size ?? 0,
        keptCount: mediaToKeep.length,
        skippedCount,
      };

      if (this.config.debug) {
        console.debug('[ShareAPIClient] Media sync result:', {
          uploaded: mediaStats.uploadedCount,
          reused: mediaStats.reusedCount,
          kept: mediaStats.keptCount,
          skipped: mediaStats.skippedCount,
          total: mediaStats.totalCount,
        });
      }

      return { ...response, mediaStats };

    } catch (error) {
      // ROLLBACK: Delete newly uploaded media on failure.
      // Only share-origin items land in `uploadedMedia`; archive-origin reused
      // items are never added there, so this loop is safe by construction
      // (PRD §6.8 delete safety).
      if (uploadedMedia.length > 0) {
        for (const media of uploadedMedia) {
          try {
            const urlParts = media.url.split('/');
            const filename = urlParts[urlParts.length - 1];
            await this.httpRequest('DELETE', `/api/upload-share-media/${shareId}/${filename}`);
          } catch {
            // best-effort cleanup, ignore errors
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
    return new Promise(resolve => window.setTimeout(resolve, ms));
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
   * Import a share into D1 user_archives, creating an archive-backed identity
   * for legacy plugin shares that only exist in KV.
   *
   * Endpoint: POST /api/user/posts/import-share/:shareId
   * - Idempotent: returns existing archiveId if already imported
   * - archiveId === shareId invariant (public URL unchanged)
   *
   * @param shareId - The share ID to import
   * @returns archiveId and whether a new archive was created
   */
  async importShareArchive(shareId: string): Promise<{ archiveId: string; created: boolean }> {
    return this.executeWithRetry(async () => {
      const result = await this.httpRequest<{
        success: boolean;
        data: { archiveId: string; created: boolean };
      }>('POST', `/api/user/posts/import-share/${shareId}`);

      return result.data;
    });
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
  initialize(): void {
    // No initialization needed
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    // No cleanup needed
  }
}
