/**
 * Workers API Client
 *
 * Client for communicating with Cloudflare Workers backend
 *
 * Single Responsibility: Workers API HTTP communication
 */

import { requestUrl, RequestUrlParam, Platform } from 'obsidian';
import type { IService } from './base/IService';
import type { ProfileArchiveRequest, ProfileCrawlResponse } from '../types/profile-crawl';
import type { Platform as PlatformType } from '@/shared/platforms/types';
import type {
  CreatePendingJobRequest,
  CreatePendingJobResponse,
  GetPendingJobsParams,
  GetPendingJobsResponse,
  DeletePendingJobResponse,
  CancelPendingJobResponse,
} from '@/types/pending-job';

// ============================================================================
// Multi-Client Sync Types
// ============================================================================

export type SyncClientType = 'obsidian' | 'self-hosted' | 'webhook' | 'notion' | 'apple-notes';

export interface RegisterSyncClientRequest {
  clientType: SyncClientType;
  clientName: string;
  settings?: Record<string, unknown>;
}

export interface RegisterSyncClientResponse {
  clientId: string;
  clientType: SyncClientType;
  clientName: string;
}

export interface SyncClient {
  id: string;
  userId: string;
  clientType: SyncClientType;
  clientName: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  lastSyncAt: number | null;
  lastSyncError?: string;
}

export interface GetSyncClientsResponse {
  clients: SyncClient[];
}

export interface UpdateSyncClientRequest {
  clientName?: string;
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

export interface SyncQueueItem {
  queueId: string;
  archiveId: string;
  userId: string;
  clientId: string;
  clientType: SyncClientType;
  status: 'pending' | 'synced' | 'failed';
  retryCount: number;
  error?: string;
  createdAt: number;
  syncedAt?: number;
}

export interface GetSyncQueueResponse {
  items: SyncQueueItem[];
}

/**
 * User archive data returned from server
 */
export interface UserArchive {
  id: string;
  userId: string;
  platform: string;
  postId: string;
  originalUrl: string;
  title: string | null;
  authorName: string | null;
  authorUrl: string | null;
  authorHandle?: string | null;
  authorAvatarUrl: string | null;
  authorBio?: string | null;
  previewText: string | null;
  fullContent: string | null;
  thumbnailUrl: string | null;
  thumbnailUrls: string[] | null;
  media: Array<{
    type: 'image' | 'video' | 'audio' | 'gif';
    url: string;
    thumbnail?: string;
    thumbnailUrl?: string;
    alt?: string;
  }> | null;
  mediaPreserved?: Array<{
    originalUrl: string;
    r2Url: string;
    r2Key: string;
    type: 'image' | 'video';
    size: number;
    contentType: string;
    preservedAt: string;
    width?: number;
    height?: number;
  }> | null;
  mediaPreservationStatus?: 'pending' | 'processing' | 'completed' | 'partial' | 'failed' | 'skipped';
  postedAt: string | null;
  archivedAt: string;
  likesCount: number | null;
  commentCount: number | null;
  sharesCount: number | null;
  viewsCount: number | null;
  externalLink?: string | null;
  externalLinkTitle?: string | null;
  externalLinkImage?: string | null;
  quotedPost?: {
    platform: string;
    id: string;
    url: string;
    author: {
      name: string;
      handle?: string;
      avatarUrl?: string;
    };
    content: string;
    media?: Array<{
      url: string;
      type: 'image' | 'video';
      thumbnail?: string;
    }>;
    metadata?: {
      likes?: number;
      comments?: number;
      shares?: number;
      timestamp?: string;
      externalLink?: string;
      externalLinkTitle?: string;
      externalLinkImage?: string;
    };
  };
  comments?: Array<{
    id: string;
    author: {
      name: string;
      handle?: string;
      avatarUrl?: string;
      url?: string;
    };
    content: string;
    timestamp?: string;
    likes?: number;
    replies?: Array<{
      id: string;
      author: {
        name: string;
        handle?: string;
        avatarUrl?: string;
        url?: string;
      };
      content: string;
      timestamp?: string;
      likes?: number;
    }>;
  }>;
  isReblog?: boolean;
  metadata: Record<string, unknown> | null;
  isLiked: boolean;
  isArchived: boolean;
  isShared: boolean;
}

export interface GetUserArchiveResponse {
  archive: UserArchive;
}

export interface WorkersAPIConfig {
  endpoint: string;
  licenseKey?: string;
  authToken?: string;
  timeout?: number;
  pluginVersion?: string;
}

export interface ArchiveRequest {
  url: string;
  options: {
    enableAI?: boolean;
    deepResearch?: boolean;
    downloadMedia?: boolean;
    pinterestBoard?: boolean;
    // YouTube-specific options
    includeTranscript?: boolean;
    includeFormattedTranscript?: boolean;
    // Comment control
    includeComments?: boolean;
  };
  licenseKey?: string;
  // Naver-specific options
  naverCookie?: string;
  // Sync client that initiated the archive (for dedup — server skips dispatching sync back to this client)
  sourceClientId?: string;
}

export interface ArchiveResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'series_selection_required';
  estimatedTime?: number;
  creditsRequired?: number;
  // Synchronous completion result (Fediverse, Podcast, Naver, Naver Webtoon episode)
  result?: {
    postData: unknown;
    creditsUsed: number;
  };
  // Naver Webtoon series selection response fields
  type?: 'series_selection_required';
  series?: {
    titleId: string;
    titleName: string;
    thumbnailUrl: string;
    author: string;
    synopsis: string;
    publishDay: string;
    finished: boolean;
    favoriteCount: number;
    age: number;
  };
  episodes?: Array<{
    no: number;
    subtitle: string;
    thumbnailUrl: string;
    starScore: number;
    serviceDateDescription: string;
    charge: boolean;
  }>;
  totalFreeEpisodes?: number;
}

export interface JobStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: ArchiveResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ArchiveResult {
  postData: unknown;
  creditsUsed: number;
  processingTime: number;
  cached: boolean;
}

export interface BatchJobStatusRequest {
  jobIds: string[];
}

export interface BatchJobStatusResult {
  jobId: string;
  status: JobStatusResponse['status'] | null;
  data?: JobStatusResponse;
  error?: string;
}

export interface BatchJobStatusResponse {
  success: boolean;
  results: BatchJobStatusResult[];
  errors?: string[];
}

// Batch Archive types (Google Maps batch)
export interface BatchArchiveTriggerRequest {
  urls: string[];
  platform: 'googlemaps';
  options?: {
    enableAI?: boolean;
    deepResearch?: boolean;
    downloadMedia?: boolean;
  };
}

export interface BatchArchiveTriggerResponse {
  batchJobId: string;
  snapshotId: string;
  status: 'pending' | 'processing';
  urlCount: number;
  creditsRequired: number;
  estimatedTime: number;
}

export interface BatchArchiveResult {
  url: string;
  status: 'completed' | 'failed';
  postData?: unknown;
  error?: string;
}

export interface BatchArchiveJobStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  batchMetadata?: {
    urlCount: number;
    urls: string[];
    completedCount: number;
    failedCount: number;
  };
  results?: BatchArchiveResult[];
  result?: {
    creditsUsed: number;
    processingTime: number;
    totalResults: number;
    completedCount: number;
    failedCount: number;
  };
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface FeedDetectionData {
  platform: PlatformType;
  feedTitle?: string;
  feedDescription?: string;
  feedImage?: string;
  author?: string;
  episodeCount?: number;
}

/**
 * Workers API Client
 */
export class WorkersAPIClient implements IService {
  private config: WorkersAPIConfig;
  private initialized = false;

  constructor(config: WorkersAPIConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }

    // Validate endpoint
    try {
      new URL(this.config.endpoint);
    } catch {
      throw new Error(`Invalid Workers API endpoint: ${this.config.endpoint}`);
    }

    this.initialized = true;
  }

  dispose(): void {
    this.initialized = false;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await requestUrl({
        url: `${this.config.endpoint}/health`,
        method: 'GET',
        throw: false
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Submit archive request
   */
  async submitArchive(request: ArchiveRequest): Promise<ArchiveResponse> {
    this.ensureInitialized();

    // Build optional headers
    const headers: Record<string, string> = {};

    // Add Naver cookie header if provided (for private cafe access)
    if (request.naverCookie) {
      headers['X-Naver-Cookie'] = request.naverCookie;
    }

    const response = await this.request<ArchiveResponse>('/api/archive', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: request.url,
        options: request.options,
        licenseKey: request.licenseKey || this.config.licenseKey,
        sourceClientId: request.sourceClientId,
      }),
    });

    return response;
  }

  /**
   * Alias for submitArchive to match ApiClient interface
   */
  async archivePost(request: ArchiveRequest): Promise<ArchiveResponse> {
    return this.submitArchive(request);
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    this.ensureInitialized();

    const response = await this.request<JobStatusResponse>(`/api/archive/${jobId}`, {
      method: 'GET',
    });

    return response;
  }

  /**
   * Get multiple job statuses in parallel
   */
  async batchGetJobStatus(jobIds: string[]): Promise<BatchJobStatusResponse> {
    this.ensureInitialized();

    if (jobIds.length === 0) {
      return {
        success: true,
        results: []
      };
    }

    if (jobIds.length > 50) {
      throw new Error('Maximum 50 job IDs allowed per batch request');
    }

    const response = await this.request<BatchJobStatusResponse>('/api/archive/batch', {
      method: 'POST',
      body: JSON.stringify({ jobIds }),
    });

    return response;
  }

  /**
   * Poll job until completed
   * Returns PostData to match ApiClient interface
   */
  async waitForJob(
    jobId: string,
    onProgress?: (progress: number) => void
  ): Promise<unknown> {
    const timeout = 300000; // 5 minutes (TikTok can take up to 4 minutes)
    const pollInterval = 2000; // 2 seconds default
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.getJobStatus(jobId);

      // Notify progress
      if (onProgress && status.progress !== undefined) {
        onProgress(status.progress);
      }

      // Check if completed
      if (status.status === 'completed') {
        if (!status.result) {
          throw new Error('Job completed but no result available');
        }
        // Extract postData from ArchiveResult
        const result: ArchiveResult = status.result;
        return result.postData;
      }

      // Check if failed
      if (status.status === 'failed') {
        throw new Error(`Archive failed: ${status.error || 'Unknown error'}`);
      }

      // Wait before next poll
      await this.delay(pollInterval);
    }

    throw new Error('Archive timeout (5 minutes): Some platforms like TikTok may take longer to process. Please try again later.');
  }

  /**
   * Validate license
   */
  async validateLicense(licenseKey: string): Promise<unknown> {
    this.ensureInitialized();

    const response = await this.request('/api/license/validate', {
      method: 'POST',
      body: JSON.stringify({ licenseKey }),
    });

    return response;
  }

  /**
   * Submit a profile crawl request
   * @param request Profile archive request with crawl options
   * @returns ProfileCrawlResponse with job ID and metadata
   */
  async crawlProfile(request: ProfileArchiveRequest): Promise<ProfileCrawlResponse> {
    this.ensureInitialized();

    const response = await this.request<ProfileCrawlResponse>('/api/profiles/crawl', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return response;
  }

  /**
   * Trigger batch archive for multiple URLs (Google Maps only)
   */
  async triggerBatchArchive(
    request: BatchArchiveTriggerRequest
  ): Promise<BatchArchiveTriggerResponse> {
    this.ensureInitialized();

    const response = await this.request<BatchArchiveTriggerResponse>(
      '/api/archive/batch-trigger',
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );

    return response;
  }

  /**
   * Get batch archive job status
   */
  async getBatchJobStatus(batchJobId: string): Promise<BatchArchiveJobStatusResponse> {
    this.ensureInitialized();

    const response = await this.request<BatchArchiveJobStatusResponse>(
      `/api/archive/${batchJobId}`,
      {
        method: 'GET',
      }
    );

    return response;
  }

  /**
   * Wait for batch archive job completion with polling
   */
  async waitForBatchJob(
    batchJobId: string,
    onProgress?: (completed: number, total: number) => void
  ): Promise<BatchArchiveJobStatusResponse> {
    const pollInterval = 3000; // 3 seconds for batch jobs
    const maxAttempts = 60; // 3 minutes max

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getBatchJobStatus(batchJobId);

      if (status.status === 'completed') {
        return status;
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'Batch job processing failed');
      }

      // Report progress
      if (onProgress && status.batchMetadata) {
        onProgress(
          status.batchMetadata.completedCount,
          status.batchMetadata.urlCount
        );
      }

      // Wait before next poll
      await this.delay(pollInterval);
    }

    throw new Error('Batch job processing timeout (3 minutes)');
  }

  /**
   * Update license key
   */
  setLicenseKey(licenseKey: string): void {
    this.config.licenseKey = licenseKey;
  }

  /**
   * Update auth token
   */
  setAuthToken(authToken: string): void {
    this.config.authToken = authToken;
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
   * Make HTTP request
   */
  private async request<T>(
    path: string,
    options: Partial<RequestUrlParam> = {}
  ): Promise<T> {
    const url = `${this.config.endpoint}${path}`;

    // Build headers with optional Authorization
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': this.config.pluginVersion || '0.0.0',
      'X-Platform': this.getPlatformIdentifier(),
      ...options.headers,
    };

    // Add Bearer token if available
    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
    }

    try {
      const response = await requestUrl({
        url,
        method: options.method || 'GET',
        headers,
        body: options.body,
        throw: false,
      });

      // Parse response
      const data = response.json as APIResponse<T>;

      // Handle errors
      if (!data.success) {
        const error = new Error(data.error?.message || 'Unknown API error');
        const extError = error as Error & { code?: string; details?: unknown; status?: number };
        extError.code = data.error?.code;
        extError.details = data.error?.details;
        extError.status = response.status;
        throw extError;
      }

      return data.data as T;

    } catch (error) {
      console.error('[WorkersAPIClient] Request failed:', {
        url,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Proxy media download to bypass CORS
   */
  async proxyMedia(mediaUrl: string): Promise<ArrayBuffer> {
    this.ensureInitialized();

    const urlString = String(mediaUrl);

    // If URL already points to our Workers API (e.g., R2-cached subscription media),
    // fetch directly — no need to proxy our own server through itself
    if (urlString.startsWith(this.config.endpoint)) {
      try {
        const response = await requestUrl({
          url: urlString,
          method: 'GET',
          throw: false,
        });
        if (response.status !== 200) {
          throw new Error(`Direct fetch failed: ${response.status}`);
        }
        return response.arrayBuffer;
      } catch (error) {
        console.error('[WorkersAPIClient] Direct media fetch failed:', {
          url: urlString.length > 100 ? urlString.substring(0, 100) + '...' : urlString,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `Failed to fetch media: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const encodedUrl = encodeURIComponent(urlString);
    const path = `/api/proxy-media?url=${encodedUrl}`;
    const url = `${this.config.endpoint}${path}`;

    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        throw: false,
      });

      if (response.status !== 200) {
        throw new Error(`Proxy returned ${response.status}: ${response.text}`);
      }

      // Return binary data
      return response.arrayBuffer;

    } catch (error) {
      console.error('[WorkersAPIClient] Media proxy failed:', {
        url: urlString.length > 100 ? urlString.substring(0, 100) + '...' : urlString,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to proxy media: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Submit anonymous download time statistics
   * Fire-and-forget - does not throw errors
   */
  async submitStats(platform: string, downloadTime: number): Promise<void> {
    // Don't block or throw errors - this is optional telemetry
    try {
      this.ensureInitialized();

      await this.request('/api/stats/download-time', {
        method: 'POST',
        body: JSON.stringify({
          platform,
          downloadTime,
          timestamp: Date.now(),
        }),
      });
    } catch (error) {
      // Silently fail - stats collection is not critical
    }
  }

  /**
   * Detect feed type (podcast vs blog) from RSS/Atom feed URL
   * Uses Workers API to fetch and analyze feed content
   *
   * @param feedUrl - The RSS/Atom feed URL to analyze
   * @returns FeedDetectionData with platform and metadata, or null if detection failed
   */
  async detectFeed(feedUrl: string): Promise<FeedDetectionData | null> {
    try {
      this.ensureInitialized();

      const encodedUrl = encodeURIComponent(feedUrl);
      const response = await this.request<FeedDetectionData>(
        `/api/detect-feed?url=${encodedUrl}`,
        { method: 'GET' }
      );

      return response;
    } catch (error) {
      console.warn('[WorkersAPIClient] Feed detection failed:', error);
      return null;
    }
  }

  // ============================================================================
  // Pending Jobs API (Multi-Device Sync)
  // ============================================================================

  /**
   * Register a pending job on the server for cross-device sync
   *
   * @param request - Pending job details
   * @returns Response with success status and jobId
   */
  async createPendingJob(request: CreatePendingJobRequest): Promise<CreatePendingJobResponse> {
    this.ensureInitialized();

    return await this.request<CreatePendingJobResponse>('/api/pending-jobs', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Get all pending jobs for the current user
   *
   * @param params - Optional filters (status)
   * @returns Response with list of pending jobs
   */
  async getPendingJobs(params?: GetPendingJobsParams): Promise<GetPendingJobsResponse> {
    this.ensureInitialized();

    const query = params?.status ? `?status=${params.status}` : '';
    return await this.request<GetPendingJobsResponse>(`/api/pending-jobs${query}`, {
      method: 'GET',
    });
  }

  /**
   * Delete a pending job from the server (after processing)
   *
   * @param jobId - The job ID to delete
   * @returns Response with success status
   */
  async deletePendingJob(jobId: string): Promise<DeletePendingJobResponse> {
    this.ensureInitialized();

    return await this.request<DeletePendingJobResponse>(`/api/pending-jobs/${jobId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Cancel a pending job (prevents webhook from saving to user_archives)
   *
   * @param jobId - The job ID to cancel
   * @returns Response with success status
   */
  async cancelPendingJob(jobId: string): Promise<CancelPendingJobResponse> {
    this.ensureInitialized();

    return await this.request<CancelPendingJobResponse>(`/api/pending-jobs/${jobId}/cancel`, {
      method: 'POST',
    });
  }

  // ============================================================================
  // Multi-Client Sync API
  // ============================================================================

  /**
   * Register a new sync client
   *
   * @param request - Client registration details
   * @returns Response with clientId
   */
  async registerSyncClient(request: RegisterSyncClientRequest): Promise<RegisterSyncClientResponse> {
    this.ensureInitialized();

    return await this.request<RegisterSyncClientResponse>('/api/sync/clients', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Get all registered sync clients for the current user
   *
   * @returns Response with list of clients
   */
  async getSyncClients(): Promise<GetSyncClientsResponse> {
    this.ensureInitialized();

    return await this.request<GetSyncClientsResponse>('/api/sync/clients', {
      method: 'GET',
    });
  }

  /**
   * Get a specific sync client by ID
   *
   * @param clientId - The client ID
   * @returns The sync client details
   */
  async getSyncClient(clientId: string): Promise<SyncClient> {
    this.ensureInitialized();

    return await this.request<SyncClient>(`/api/sync/clients/${clientId}`, {
      method: 'GET',
    });
  }

  /**
   * Update a sync client
   *
   * @param clientId - The client ID
   * @param update - Fields to update
   * @returns Updated sync client
   */
  async updateSyncClient(clientId: string, update: UpdateSyncClientRequest): Promise<SyncClient> {
    this.ensureInitialized();

    return await this.request<SyncClient>(`/api/sync/clients/${clientId}`, {
      method: 'PUT',
      body: JSON.stringify(update),
    });
  }

  /**
   * Delete a sync client
   *
   * @param clientId - The client ID to delete
   */
  async deleteSyncClient(clientId: string): Promise<void> {
    this.ensureInitialized();

    await this.request<undefined>(`/api/sync/clients/${clientId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Get pending sync queue items for a client
   *
   * @param clientId - The client ID
   * @returns Response with list of pending items
   */
  async getSyncQueue(clientId: string): Promise<GetSyncQueueResponse> {
    this.ensureInitialized();

    return await this.request<GetSyncQueueResponse>(`/api/sync/queue?clientId=${clientId}`, {
      method: 'GET',
    });
  }

  /**
   * Acknowledge sync completion for a queue item
   *
   * @param queueId - The queue item ID
   * @param clientId - The client ID
   */
  async ackSyncItem(queueId: string, clientId: string): Promise<void> {
    this.ensureInitialized();

    await this.request<undefined>('/api/sync/queue/ack', {
      method: 'POST',
      body: JSON.stringify({ queueId, clientId }),
    });
  }

  /**
   * Report sync failure for a queue item
   *
   * @param queueId - The queue item ID
   * @param clientId - The client ID
   * @param error - Error message
   */
  async failSyncItem(queueId: string, clientId: string, error?: string): Promise<void> {
    this.ensureInitialized();

    await this.request<undefined>('/api/sync/queue/fail', {
      method: 'POST',
      body: JSON.stringify({ queueId, clientId, error }),
    });
  }

  // ============================================================================
  // User Archives API
  // ============================================================================

  /**
   * Get a specific archive by ID
   *
   * @param archiveId - The archive ID
   * @returns The archive data
   */
  async getUserArchive(archiveId: string): Promise<GetUserArchiveResponse> {
    this.ensureInitialized();

    return await this.request<GetUserArchiveResponse>(`/api/user/archives/${archiveId}`, {
      method: 'GET',
    });
  }

  /**
   * Ensure initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('WorkersAPIClient not initialized. Call initialize() first.');
    }
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
