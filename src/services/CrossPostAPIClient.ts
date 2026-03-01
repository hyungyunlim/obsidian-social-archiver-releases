/**
 * Cross-Post API Client
 *
 * Client for communicating with the Workers cross-posting and Threads OAuth endpoints.
 *
 * Single Responsibility: Cross-post API HTTP communication
 */

import { requestUrl, Platform } from 'obsidian';
import type { IService } from './base/IService';
import {
  HttpError,
  NetworkError,
  TimeoutError,
  RateLimitError,
  AuthenticationError,
  InvalidRequestError,
  ServerError,
} from '@/types/errors/http-errors';
import type {
  ThreadsConnectionStatus,
  CrossPostRequest,
  CrossPostResponse,
  ThreadsOAuthInitResponse,
} from '../types/crosspost';

// ============================================================================
// Configuration
// ============================================================================

export interface CrossPostAPIConfig {
  endpoint: string;
  authToken?: string;
  pluginVersion?: string;
}

// ============================================================================
// Retry configuration
// ============================================================================

interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  shouldRetry: (error: HttpError) => boolean;
}

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
  },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Transform HTTP status + response body into a standardized HttpError
 */
function transformHttpError(
  status: number,
  headers: Record<string, string>,
  data: unknown,
  _url: string
): HttpError {
  const message =
    (data as Record<string, unknown>)?.['message'] as string || `HTTP ${status} error`;

  if (status === 429) {
    const retryAfter = headers['retry-after']
      ? parseInt(headers['retry-after'], 10)
      : undefined;
    const limit = headers['x-ratelimit-limit']
      ? parseInt(headers['x-ratelimit-limit'], 10)
      : undefined;
    const remaining = headers['x-ratelimit-remaining']
      ? parseInt(headers['x-ratelimit-remaining'], 10)
      : undefined;
    return new RateLimitError(message || 'Rate limit exceeded', {
      statusCode: status,
      retryAfter,
      limit,
      remaining,
    });
  }

  if (status === 401 || status === 403) {
    return new AuthenticationError(message || 'Authentication failed', status);
  }

  if (status === 400 || status === 422) {
    return new InvalidRequestError(message || 'Invalid request', status, {
      validationErrors: (data as Record<string, unknown>)?.['errors'] as
        | string[]
        | undefined,
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

// ============================================================================
// CrossPostAPIClient
// ============================================================================

/**
 * Cross-Post API Client
 *
 * Handles all HTTP communication with the Workers cross-posting endpoints:
 * - Threads OAuth flow (init, status, disconnect, refresh)
 * - Cross-posting (create, read, history, delete platform post)
 */
export class CrossPostAPIClient implements IService {
  private config: CrossPostAPIConfig;
  private retryConfig: RetryConfig;
  private initialized = false;

  // Base headers applied to every request
  private readonly baseHeaders: Record<string, string>;

  constructor(config: CrossPostAPIConfig) {
    this.config = { ...config };
    this.retryConfig = DEFAULT_RETRY_CONFIG;

    this.baseHeaders = {
      'Content-Type': 'application/json',
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': this.config.pluginVersion || '0.0.0',
      'X-Platform': getPlatformIdentifier(),
    };
  }

  // ============================================================================
  // IService lifecycle
  // ============================================================================

  initialize(): void {
    if (this.initialized) {
      return;
    }

    // Validate endpoint URL
    try {
      new URL(this.config.endpoint);
    } catch {
      throw new Error(`Invalid CrossPost API endpoint: ${this.config.endpoint}`);
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
        throw: false,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Auth token management
  // ============================================================================

  /**
   * Update the auth token used for subsequent requests
   */
  setAuthToken(token: string): void {
    this.config.authToken = token;
  }

  // ============================================================================
  // Threads OAuth endpoints
  // ============================================================================

  /**
   * Initiate Threads OAuth flow
   * POST /api/threads/oauth/init
   */
  async initOAuth(returnUrl?: string): Promise<ThreadsOAuthInitResponse> {
    this.ensureInitialized();

    const body = returnUrl ? { returnUrl } : undefined;

    return this.executeWithRetry(() =>
      this.request<ThreadsOAuthInitResponse>('POST', '/api/threads/oauth/init', body)
    );
  }

  /**
   * Get current Threads connection status
   * GET /api/threads/oauth/status
   */
  async getConnectionStatus(): Promise<ThreadsConnectionStatus> {
    this.ensureInitialized();

    return this.executeWithRetry(() =>
      this.request<ThreadsConnectionStatus>('GET', '/api/threads/oauth/status')
    );
  }

  /**
   * Disconnect the Threads account
   * POST /api/threads/oauth/disconnect
   */
  async disconnect(): Promise<void> {
    this.ensureInitialized();

    return this.executeWithRetry(() =>
      this.request<void>('POST', '/api/threads/oauth/disconnect')
    );
  }

  /**
   * Refresh the Threads long-lived token
   * POST /api/threads/oauth/refresh
   */
  async refreshToken(): Promise<{ tokenExpiresAt: number }> {
    this.ensureInitialized();

    return this.executeWithRetry(() =>
      this.request<{ tokenExpiresAt: number }>('POST', '/api/threads/oauth/refresh')
    );
  }

  // ============================================================================
  // Cross-post endpoints
  // ============================================================================

  /**
   * Create a cross-post
   * POST /api/crosspost
   */
  async crossPost(request: CrossPostRequest): Promise<CrossPostResponse> {
    this.ensureInitialized();

    return this.executeWithRetry(() =>
      this.request<CrossPostResponse>('POST', '/api/crosspost', request)
    );
  }

  /**
   * Get a specific cross-post record by ID
   * GET /api/crosspost/:id
   */
  async getCrossPost(id: string): Promise<unknown> {
    this.ensureInitialized();

    return this.executeWithRetry(() =>
      this.request<unknown>('GET', `/api/crosspost/${id}`)
    );
  }

  /**
   * Get cross-post history for the current user
   * GET /api/crosspost?limit=&offset=
   */
  async getCrossPostHistory(limit = 20, offset = 0): Promise<unknown> {
    this.ensureInitialized();

    const query = `?limit=${limit}&offset=${offset}`;
    return this.executeWithRetry(() =>
      this.request<unknown>('GET', `/api/crosspost${query}`)
    );
  }

  /**
   * Delete a specific platform post within a cross-post record
   * DELETE /api/crosspost/:crossPostId/:platform
   */
  async deletePlatformPost(
    crossPostId: string,
    platform: string
  ): Promise<{ deletedAt: string }> {
    this.ensureInitialized();

    return this.executeWithRetry(() =>
      this.request<{ deletedAt: string }>(
        'DELETE',
        `/api/crosspost/${crossPostId}/${platform}`
      )
    );
  }

  /**
   * Upload a media file for cross-posting
   * POST /api/crosspost/media
   */
  async uploadMedia(file: File): Promise<{ r2Key: string }> {
    this.ensureInitialized();

    // Convert File to base64
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const base64Data = btoa(binary);

    const body = {
      filename: file.name,
      contentType: file.type,
      data: base64Data,
    };

    return this.executeWithRetry(() =>
      this.request<{ r2Key: string }>('POST', '/api/crosspost/media', body)
    );
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Core HTTP method using Obsidian's requestUrl
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.endpoint}${path}`;

    const headers: Record<string, string> = { ...this.baseHeaders };

    // Add Bearer token if available
    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
    }

    let serializedBody: string | undefined;
    if (body !== undefined && body !== null) {
      serializedBody =
        typeof body === 'string' ? body : JSON.stringify(body);
    }

    try {
      const response = await requestUrl({
        url,
        method,
        headers,
        body: serializedBody,
        throw: false,
      });

      // Handle error responses
      if (response.status >= 400) {
        let data: unknown;
        try {
          data = response.json;
        } catch {
          data = { message: response.text };
        }
        throw transformHttpError(response.status, response.headers, data, url);
      }

      // Parse successful response
      try {
        return response.json as T;
      } catch {
        return response.text as unknown as T;
      }
    } catch (error) {
      // Re-throw HttpErrors as-is; wrap unexpected errors
      if (error instanceof HttpError) {
        throw error;
      }

      console.error('[CrossPostAPIClient] Request failed:', {
        url,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new NetworkError(
        `Network request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute an operation with exponential-backoff retry + jitter
   * (mirrors ShareAPIClient.executeWithRetry)
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    attempt = 0
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const httpError = error as HttpError;

      // No more retries
      if (attempt >= this.retryConfig.maxAttempts - 1) {
        throw httpError;
      }

      if (!this.retryConfig.shouldRetry(httpError)) {
        throw httpError;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = this.calculateRetryDelay(attempt, httpError);
      await this.sleep(delay);

      return this.executeWithRetry(operation, attempt + 1);
    }
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number, error: HttpError): number {
    // Use retry-after header if available (rate limiting)
    if (error instanceof RateLimitError && error.retryAfter) {
      return error.retryAfter * 1000;
    }

    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay =
      this.retryConfig.baseDelay * Math.pow(2, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(
      exponentialDelay,
      this.retryConfig.maxDelay
    );

    // Add ±25% jitter to prevent thundering herd
    const jitter = cappedDelay * 0.25;
    const jitteredDelay = cappedDelay + (Math.random() * 2 - 1) * jitter;

    return Math.round(Math.max(jitteredDelay, 0));
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Guard: ensure initialize() was called before making requests
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'CrossPostAPIClient not initialized. Call initialize() first.'
      );
    }
  }
}
