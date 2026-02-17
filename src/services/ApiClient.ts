import { requestUrl } from 'obsidian';
import type { IService } from './base/IService';
import type {
  ApiResponse,
  ApiError,
  ArchiveRequest,
  ArchiveResponse,
  JobStatusResponse,
  LicenseValidationRequest,
  LicenseValidationResponse,
} from '@/types/api';
import type { PostData } from '@/types/post';

/**
 * HTTP client configuration
 */
export interface HttpClientConfig {
  baseUrl: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  headers?: Record<string, string>;
}

/**
 * Retry configuration
 */
interface RetryConfig {
  attempts: number;
  delay: number;
  backoffMultiplier: number;
  maxDelay: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  attempts: 3,
  delay: 1000,
  backoffMultiplier: 2,
  maxDelay: 10000,
};

/**
 * ApiClient for communicating with Cloudflare Workers backend
 * Handles HTTP requests, retries, and response transformation
 */
export class ApiClient implements IService {
  private config: HttpClientConfig;
  private retryConfig: RetryConfig;
  private abortController?: AbortController;

  constructor(config: HttpClientConfig) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config,
    };

    this.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      attempts: this.config.retryAttempts || DEFAULT_RETRY_CONFIG.attempts,
      delay: this.config.retryDelay || DEFAULT_RETRY_CONFIG.delay,
    };
  }

  async initialize(): Promise<void> {
    // Verify backend connectivity
    await this.healthCheck();
  }

  async dispose(): Promise<void> {
    // Cancel any pending requests
    this.abortController?.abort();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.healthCheck();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Health check endpoint
   */
  private async healthCheck(): Promise<void> {
    await this.request<{ status: string }>('/health', {
      method: 'GET',
    });
  }

  /**
   * Archive a post
   */
  async archivePost(request: ArchiveRequest): Promise<ArchiveResponse> {
    // Build optional headers
    const headers: Record<string, string> = {};

    // Add Naver cookie header if provided (for private cafe access)
    if (request.naverCookie) {
      headers['X-Naver-Cookie'] = request.naverCookie;
    }

    const response = await this.request<ArchiveResponse>('/api/archive', {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.success || !response.data) {
      throw this.createError(response.error || {
        code: 'ARCHIVE_FAILED',
        message: 'Failed to archive post',
      });
    }

    return response.data;
  }

  /**
   * Poll job status
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const response = await this.request<JobStatusResponse>(
      `/api/jobs/${jobId}`,
      {
        method: 'GET',
      }
    );

    if (!response.success || !response.data) {
      throw this.createError(response.error || {
        code: 'JOB_STATUS_FAILED',
        message: 'Failed to get job status',
      });
    }

    return response.data;
  }

  /**
   * Wait for job completion with polling
   */
  async waitForJob(
    jobId: string,
    onProgress?: (progress: number) => void
  ): Promise<PostData> {
    const pollInterval = 2000;
    const maxAttempts = 60; // 2 minutes max

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.getJobStatus(jobId);

      if (status.status === 'completed' && status.result) {
        return status.result as PostData;
      }

      if (status.status === 'failed') {
        throw this.createError(status.error || {
          code: 'JOB_FAILED',
          message: 'Job processing failed',
        });
      }

      // Report progress
      if (onProgress && status.progress !== undefined) {
        onProgress(status.progress);
      }

      // Wait before next poll
      await this.sleep(pollInterval);
    }

    throw this.createError({
      code: 'JOB_TIMEOUT',
      message: 'Job processing timeout',
    });
  }

  /**
   * Validate license key
   */
  async validateLicense(
    request: LicenseValidationRequest
  ): Promise<LicenseValidationResponse> {
    const response = await this.request<LicenseValidationResponse>(
      '/api/license/validate',
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );

    if (!response.success || !response.data) {
      throw this.createError(response.error || {
        code: 'LICENSE_VALIDATION_FAILED',
        message: 'Failed to validate license',
      });
    }

    return response.data;
  }

  /**
   * Submit anonymous download time statistics
   * Fire-and-forget - does not throw errors
   */
  async submitStats(platform: string, downloadTime: number): Promise<void> {
    // Don't block or throw errors - this is optional telemetry
    try {
      await this.request<void>('/api/stats/download-time', {
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
   * Core HTTP request with retry logic
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit
  ): Promise<ApiResponse<T>> {
    return this.retryRequest(async () => {
      this.abortController = new AbortController();

      const url = `${this.config.baseUrl}${endpoint}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.config.headers,
        ...(options.headers as Record<string, string>),
      };

      const timeoutId = setTimeout(() => {
        this.abortController?.abort();
      }, this.config.timeout);

      try {
        const response = await requestUrl({
          url,
          method: options.method || 'GET',
          headers,
          body: options.body as string,
          throw: false
        });

        clearTimeout(timeoutId);

        // Parse response
        const data = response.json;

        if (response.status !== 200) {
          return {
            success: false,
            error: this.parseErrorResponse(data, response.status),
          };
        }

        return {
          success: true,
          data: data as T,
        };
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            return {
              success: false,
              error: {
                code: 'TIMEOUT',
                message: 'Request timeout',
              },
            };
          }

          return {
            success: false,
            error: {
              code: 'NETWORK_ERROR',
              message: error.message,
            },
          };
        }

        return {
          success: false,
          error: {
            code: 'UNKNOWN_ERROR',
            message: 'An unknown error occurred',
          },
        };
      }
    });
  }

  /**
   * Retry wrapper with exponential backoff
   */
  private async retryRequest<T>(
    fn: () => Promise<ApiResponse<T>>
  ): Promise<ApiResponse<T>> {
    let lastError: ApiResponse<T> | null = null;

    for (let attempt = 0; attempt < this.retryConfig.attempts; attempt++) {
      try {
        const result = await fn();

        // Don't retry on success or client errors
        if (result.success || !this.isRetryableError(result.error)) {
          return result;
        }

        lastError = result;

        // Wait with exponential backoff
        if (attempt < this.retryConfig.attempts - 1) {
          const delay = this.calculateBackoff(attempt);
          await this.sleep(delay);
        }
      } catch (error) {
        // Network errors might be retryable
        if (attempt === this.retryConfig.attempts - 1) {
          throw error;
        }

        const delay = this.calculateBackoff(attempt);
        await this.sleep(delay);
      }
    }

    return lastError || {
      success: false,
      error: {
        code: 'MAX_RETRIES_EXCEEDED',
        message: 'Maximum retry attempts exceeded',
      },
    };
  }

  /**
   * Calculate backoff delay
   */
  private calculateBackoff(attempt: number): number {
    const delay =
      this.retryConfig.delay *
      Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error?: ApiError): boolean {
    if (!error) return false;

    const retryableCodes = ['TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMIT'];
    return retryableCodes.includes(error.code);
  }

  /**
   * Parse error response from API
   */
  private parseErrorResponse(data: unknown, status: number): ApiError {
    if (
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof data.error === 'object' &&
      data.error !== null
    ) {
      const error = data.error as Record<string, unknown>;
      return {
        code: typeof error.code === 'string' ? error.code : 'API_ERROR',
        message: typeof error.message === 'string' ? error.message : 'API error',
        retryAfter: typeof error.retryAfter === 'number' ? error.retryAfter : undefined,
        details: error.details as Record<string, unknown>,
      };
    }

    return {
      code: `HTTP_${status}`,
      message: `HTTP error ${status}`,
    };
  }

  /**
   * Create error from ApiError
   */
  private createError(apiError: ApiError): Error {
    const error = new Error(apiError.message);
    error.name = apiError.code;
    return Object.assign(error, { apiError });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
