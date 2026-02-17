/**
 * ProfileValidationPoller - Plugin-side Polling for Profile Validation
 *
 * Polls the Workers API to check validation job status with:
 * - 2 second polling interval
 * - 30 second total timeout
 * - Progress callbacks for UI updates
 * - Network error retry logic
 *
 * Single Responsibility: Poll validation status until completion/failure
 */

import { requestUrl } from 'obsidian';

// ============================================================================
// Types
// ============================================================================

/**
 * Validation job status from Workers API
 */
export type ValidationJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Profile metadata from validation
 */
export interface ProfileMetadata {
  displayName: string;
  handle: string;
  avatar: string | null;
  bio?: string;
  followersCount: number;
  postsCount: number;
  isPrivate: boolean;
  isVerified: boolean;
}

/**
 * Summary of initial posts found
 */
export interface PostSummary {
  id: string;
  timestamp: string;
  type: 'image' | 'video' | 'carousel' | 'text';
  hasMedia: boolean;
  previewText?: string;
}

/**
 * Validation error from Workers API
 */
export interface ValidationError {
  code: string;
  message: string;
}

/**
 * Successful validation result
 */
export interface ValidationResult {
  snapshotId: string;
  profileMetadata: ProfileMetadata;
  initialPosts: PostSummary[];
  latestPostId: string | null;
}

/**
 * API response structure
 */
interface ValidationStatusResponse {
  success: boolean;
  data?: {
    snapshotId: string;
    status: ValidationJobStatus;
    result?: {
      profileMetadata: ProfileMetadata;
      initialPosts: PostSummary[];
      latestPostId: string | null;
    };
    error?: ValidationError;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Progress callback for UI updates
 */
export type ProgressCallback = (status: ValidationJobStatus, elapsed: number) => void;

/**
 * Poller configuration
 */
export interface PollerConfig {
  apiBaseUrl: string;
  authToken: string;
  pollingInterval?: number; // ms, default 2000
  timeout?: number; // ms, default 30000
  maxRetries?: number; // default 3
  onProgress?: ProgressCallback;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_POLLING_INTERVAL = 2000; // 2 seconds
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_RETRIES = 3;

// ============================================================================
// ProfileValidationPoller Class
// ============================================================================

export class ProfileValidationPoller {
  private readonly apiBaseUrl: string;
  private readonly authToken: string;
  private readonly pollingInterval: number;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly onProgress?: ProgressCallback;

  private abortController: AbortController | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: PollerConfig) {
    this.apiBaseUrl = config.apiBaseUrl;
    this.authToken = config.authToken;
    this.pollingInterval = config.pollingInterval ?? DEFAULT_POLLING_INTERVAL;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.onProgress = config.onProgress;
  }

  // --------------------------------------------------------------------------
  // Public Methods
  // --------------------------------------------------------------------------

  /**
   * Poll for validation completion
   *
   * @param snapshotId BrightData snapshot ID from validate-profile response
   * @returns Resolved with result on success, rejected on failure/timeout
   */
  async poll(snapshotId: string): Promise<ValidationResult> {
    return new Promise((resolve, reject) => {
      this.abortController = new AbortController();
      const startTime = Date.now();
      let lastStatus: ValidationJobStatus = 'pending';

      // Set up timeout (tracked for cleanup)
      this.timeoutId = setTimeout(() => {
        this.timeoutId = null;
        this.cleanup();
        reject(new ProfileValidationError(
          'VALIDATION_TIMEOUT',
          'Profile validation timed out. Please try again.'
        ));
      }, this.timeout);

      // Start polling
      this.intervalId = setInterval(async () => {
        try {
          const elapsed = Date.now() - startTime;
          const response = await this.fetchStatus(snapshotId);

          if (!response.success || !response.data) {
            // API error
            this.cleanup();
            reject(new ProfileValidationError(
              response.error?.code ?? 'UNKNOWN_ERROR',
              response.error?.message ?? 'Unknown error occurred'
            ));
            return;
          }

          const { status, result, error } = response.data;
          lastStatus = status;

          // Report progress
          this.onProgress?.(status, elapsed);

          switch (status) {
            case 'completed':
              this.cleanup();
              if (result) {
                resolve({
                  snapshotId,
                  profileMetadata: result.profileMetadata,
                  initialPosts: result.initialPosts,
                  latestPostId: result.latestPostId,
                });
              } else {
                reject(new ProfileValidationError(
                  'INVALID_RESPONSE',
                  'Validation completed but no result data'
                ));
              }
              break;

            case 'failed':
              this.cleanup();
              reject(new ProfileValidationError(
                error?.code ?? 'VALIDATION_FAILED',
                error?.message ?? 'Profile validation failed'
              ));
              break;

            case 'pending':
            case 'processing':
              // Continue polling
              break;
          }
        } catch (err) {
          // Network error - continue polling if within retry limit
          console.error('[ProfileValidationPoller] Polling error:', err);
          // Don't reject immediately, let timeout handle it
        }
      }, this.pollingInterval);
    });
  }

  /**
   * Abort the polling operation
   */
  abort(): void {
    this.abortController?.abort();
    this.cleanup();
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Fetch validation status from API
   */
  private async fetchStatus(snapshotId: string): Promise<ValidationStatusResponse> {
    const url = `${this.apiBaseUrl}/api/subscriptions/validate-profile/${snapshotId}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await requestUrl({
          url,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.authToken}`,
            'Content-Type': 'application/json',
          },
          throw: false
        });

        if (response.status !== 200) {
          const errorData = response.json || {};
          return {
            success: false,
            error: {
              code: errorData.error?.code ?? 'HTTP_ERROR',
              message: errorData.error?.message ?? `HTTP ${response.status}`,
            },
          };
        }

        return response.json;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if aborted
        if (this.abortController?.signal.aborted) {
          throw lastError;
        }

        // Wait before retry
        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error('Failed to fetch validation status');
  }

  /**
   * Cleanup polling resources
   */
  private cleanup(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.abortController = null;
  }
}

// ============================================================================
// Custom Error Class
// ============================================================================

export class ProfileValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProfileValidationError';
    this.code = code;
  }

  /**
   * Check if error is retryable
   */
  get isRetryable(): boolean {
    return ['NETWORK_ERROR', 'VALIDATION_TIMEOUT', 'RATE_LIMITED'].includes(this.code);
  }
}
