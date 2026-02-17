/**
 * PendingJobsManager - localStorage-based service for tracking pending archive jobs
 *
 * Features:
 * - CRUD operations for pending jobs (add, get, update, remove)
 * - localStorage persistence across app restarts
 * - Quota exceeded error handling with automatic cleanup
 * - Job schema validation and duplicate prevention
 * - IService interface compliance
 *
 * Storage:
 * - Individual job records: `pending-job-{jobId}`
 * - Job index: `pending-jobs-index` (array of job IDs for efficient listing)
 * - Auto-cleanup of jobs older than 7 days
 */

import type { App } from 'obsidian';
import { IService } from './base/IService';
import type { Platform } from '../types/post';

/**
 * Job status for pending archive operations
 */
export type JobStatus =
  | 'pending'    // Waiting to start
  | 'processing' // Currently being processed
  | 'completed'  // Successfully completed
  | 'failed'     // Failed with error
  | 'cancelled'; // User cancelled

/**
 * Schema version for migration support
 */
export const PENDING_JOB_SCHEMA_VERSION = 1;

/**
 * Pending job data structure stored in localStorage
 */
export interface PendingJob {
  /** Schema version for migration support (default: 1) */
  schemaVersion?: number;

  /** Unique job identifier (generated from URL + timestamp) */
  id: string;

  /** Original URL to archive */
  url: string;

  /** Detected or specified platform */
  platform: Platform;

  /** Current job status */
  status: JobStatus;

  /** Job creation timestamp */
  timestamp: number;

  /** Number of retry attempts */
  retryCount: number;

  /** Optional metadata for the job */
  metadata?: {
    /** User-provided notes */
    notes?: string;

    /** Estimated credits required */
    estimatedCredits?: number;

    /** Last error message if failed */
    lastError?: string;

    /** Processing start time */
    startedAt?: number;

    /** Processing completion time */
    completedAt?: number;

    /** Processing failure time */
    failedAt?: number;

    /** BrightData collection ID */
    collectionId?: string;

    /** BrightData snapshot ID */
    snapshotId?: string;

    /** Worker job ID */
    workerJobId?: string;

    /** Download media mode */
    downloadMedia?: string;

    /** Include transcript (YouTube only) */
    includeTranscript?: boolean;

    /** Include formatted transcript (YouTube only) */
    includeFormattedTranscript?: boolean;

    /** File path for preliminary document */
    filePath?: string;

    /** Embedded archive mode (for archive suggestion banner) */
    embeddedArchive?: boolean;

    /** Parent file path (for embedded archive mode) */
    parentFilePath?: string;

    /** Pinterest board flag */
    isPinterestBoard?: boolean;

    /** Timestamp when Workers API last reported missing status */
    statusUnavailableSince?: number;

    /** Job type for distinguishing different flows (e.g., 'profile-crawl', 'post-archive', 'batch-archive') */
    type?: 'profile-crawl' | 'post-archive' | 'batch-archive';

    /** Profile handle for crawl jobs (e.g., '@username') */
    handle?: string;

    /** Estimated number of posts to crawl */
    estimatedPosts?: number;

    /** Batch archive: original URLs to archive */
    batchUrls?: string[];

    /** Batch archive: batch job ID from Worker */
    batchJobId?: string;

    /** Batch archive: number of completed URLs */
    batchCompletedCount?: number;

    /** Batch archive: number of failed URLs */
    batchFailedCount?: number;

    /** Source note path for wiki link reference (batch archive) */
    sourceNotePath?: string;

    /** Include platform comments in archived note */
    includeComments?: boolean;
  };
}

/**
 * Job update options (partial update)
 */
export type JobUpdate = Partial<Omit<PendingJob, 'id' | 'timestamp'>>;

/**
 * Validation error types
 */
export enum ValidationErrorType {
  INVALID_SCHEMA = 'invalid_schema',
  MISSING_REQUIRED_FIELD = 'missing_required_field',
  INVALID_FIELD_TYPE = 'invalid_field_type',
  INVALID_FIELD_VALUE = 'invalid_field_value',
}

/**
 * Custom validation error
 */
export class JobValidationError extends Error {
  constructor(
    public type: ValidationErrorType,
    message: string,
    public field?: string
  ) {
    super(message);
    this.name = 'JobValidationError';
  }
}

/**
 * Storage quota error
 */
export class StorageQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

/**
 * Storage information
 */
export interface StorageInfo {
  used: number;
  available: number;
  percentage: number;
  isNearLimit: boolean;
}

/**
 * PendingJobsManager configuration
 */
export interface PendingJobsManagerConfig {
  /** Maximum job age in milliseconds (default: 7 days) */
  maxJobAge?: number;

  /** Storage warning threshold (default: 0.8 = 80%) */
  storageWarningThreshold?: number;

  /** Maximum retry count (default: 3) */
  maxRetryCount?: number;
}

/**
 * PendingJobsManager - Manages pending archive jobs with localStorage persistence
 */
export class PendingJobsManager implements IService {
  public readonly name = 'PendingJobsManager';
  private app: App;
  private isInitialized = false;

  // Storage configuration
  private readonly STORAGE_KEY_PREFIX = 'pending-job';
  private readonly INDEX_KEY = 'pending-jobs-index';
  private readonly MAX_JOB_AGE: number;
  private readonly STORAGE_WARNING_THRESHOLD: number;
  private readonly MAX_RETRY_COUNT: number;

  // In-memory cache for performance
  private jobsCache: Map<string, PendingJob> = new Map();
  private indexCache: string[] = [];

  constructor(app: App, config: PendingJobsManagerConfig = {}) {
    this.app = app;
    this.MAX_JOB_AGE = config.maxJobAge ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    this.STORAGE_WARNING_THRESHOLD = config.storageWarningThreshold ?? 0.8;
    this.MAX_RETRY_COUNT = config.maxRetryCount ?? 3;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load job index from localStorage
      this.loadIndex();

      // Load all jobs into cache
      this.loadAllJobs();

      // Mark as initialized before cleanup (clearOldJobs uses ensureInitialized)
      this.isInitialized = true;

      // Clean up old jobs
      await this.clearOldJobs();
    } catch (error) {
      this.isInitialized = false; // Reset on error
      console.error('[PendingJobsManager] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Dispose of the service and clean up resources
   */
  dispose(): void {
    if (!this.isInitialized) {
      return;
    }

    // Clear in-memory caches
    this.jobsCache.clear();
    this.indexCache = [];

    this.isInitialized = false;
  }

  /**
   * Health check for the service
   */
  isHealthy(): boolean {
    return this.isInitialized && this.isLocalStorageAvailable();
  }

  /**
   * Add a new pending job
   * @throws {JobValidationError} If job validation fails
   * @throws {StorageQuotaError} If storage quota exceeded
   */
  async addJob(job: PendingJob): Promise<void> {
    this.ensureInitialized();

    // Ensure schema version is set
    if (!job.schemaVersion) {
      job.schemaVersion = PENDING_JOB_SCHEMA_VERSION;
    }

    // Validate job schema
    this.validateJob(job);

    // Check for duplicate (same URL + platform)
    const duplicate = this.findDuplicate(job);
    if (duplicate) {
      // Use conflict resolution to determine which job to keep
      const winner = this.resolveConflict(duplicate, job);

      if (winner.id === duplicate.id) {
        // Existing job wins, reject the new job
        throw new Error(
          `Duplicate job already exists for URL: ${job.url} (${job.platform}). ` +
          `Existing job ${duplicate.id} has higher priority (status: ${duplicate.status}).`
        );
      } else {
        // New job wins, remove the old one
        console.warn(`[PendingJobsManager] New job ${job.id} replaces existing job ${duplicate.id}`, {
          newStatus: job.status,
          oldStatus: duplicate.status,
          url: job.url,
          platform: job.platform,
        });

        await this.removeJob(duplicate.id);
        // Continue to add the new job below
      }
    }

    try {
      // Save to localStorage
      this.saveJob(job);

      // Update cache
      this.jobsCache.set(job.id, job);

      // Update index
      if (!this.indexCache.includes(job.id)) {
        this.indexCache.push(job.id);
        this.saveIndex();
      }
    } catch (error) {
      if (this.isQuotaError(error)) {
        // Try to free up space by cleaning old jobs first
        const removedCount = await this.clearOldJobs();

        // If no old jobs were removed, try aggressive cleanup
        if (removedCount === 0) {
          await this.clearOldestJobs(5);
        }

        // Retry save
        try {
          this.saveJob(job);
          this.jobsCache.set(job.id, job);
          if (!this.indexCache.includes(job.id)) {
            this.indexCache.push(job.id);
            this.saveIndex();
          }
        } catch (retryError) {
          // Last resort: try aggressive cleanup and retry one more time
          if (this.isQuotaError(retryError)) {
            await this.clearOldestJobs(10);

            try {
              this.saveJob(job);
              this.jobsCache.set(job.id, job);
              if (!this.indexCache.includes(job.id)) {
                this.indexCache.push(job.id);
                this.saveIndex();
              }
            } catch {
              throw new StorageQuotaError(
                'Storage quota exceeded even after aggressive cleanup. Please manually free up space or clear old jobs.'
              );
            }
          } else {
            throw retryError;
          }
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Get all pending jobs
   * @param filter Optional status filter
   */
  getJobs(filter?: { status?: JobStatus }): Promise<PendingJob[]> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const jobs = Array.from(this.jobsCache.values());

    if (filter?.status) {
      return Promise.resolve(jobs.filter((job) => job.status === filter.status));
    }

    return Promise.resolve(jobs);
  }

  /**
   * Get a specific job by ID
   */
  getJob(id: string): Promise<PendingJob | null> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    return Promise.resolve(this.jobsCache.get(id) ?? null);
  }

  /**
   * Get a job by worker job ID
   */
  getJobByWorkerJobId(workerJobId: string): Promise<PendingJob | null> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    // Search through all jobs for matching workerJobId in metadata
    for (const job of this.jobsCache.values()) {
      if (job.metadata?.workerJobId === workerJobId) {
        return Promise.resolve(job);
      }
    }

    return Promise.resolve(null);
  }

  /**
   * Update an existing job
   * @throws {Error} If job not found
   */
  updateJob(id: string, updates: JobUpdate): Promise<void> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const existingJob = this.jobsCache.get(id);
    if (!existingJob) {
      return Promise.reject(new Error(`Job not found: ${id}`));
    }

    // Merge updates
    const updatedJob: PendingJob = {
      ...existingJob,
      ...updates,
      id: existingJob.id, // Preserve ID
      timestamp: existingJob.timestamp, // Preserve creation timestamp
    };

    // Validate updated job
    this.validateJob(updatedJob);

    // Save to localStorage
    this.saveJob(updatedJob);

    // Update cache
    this.jobsCache.set(id, updatedJob);
    return Promise.resolve();
  }

  /**
   * Remove a job
   */
  removeJob(id: string): Promise<void> {
    try {
      this.ensureInitialized();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    // Remove from localStorage
    const key = this.getJobKey(id);
    this.app.saveLocalStorage(key, null);

    // Remove from cache
    this.jobsCache.delete(id);

    // Update index
    const indexBefore = this.indexCache.length;
    this.indexCache = this.indexCache.filter((jobId) => jobId !== id);

    if (this.indexCache.length !== indexBefore) {
      this.saveIndex();
    }
    return Promise.resolve();
  }

  /**
   * Clear old jobs (older than MAX_JOB_AGE)
   * Also clears completed/failed jobs older than 1 day
   * Removes oldest jobs first when cleaning up
   */
  async clearOldJobs(): Promise<number> {
    this.ensureInitialized();

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    let removedCount = 0;

    const jobsToRemove: Array<{ id: string; timestamp: number }> = [];

    for (const [id, job] of this.jobsCache.entries()) {
      const age = now - job.timestamp;

      // Remove if too old
      if (age > this.MAX_JOB_AGE) {
        jobsToRemove.push({ id, timestamp: job.timestamp });
        continue;
      }

      // Remove completed/failed jobs older than 1 day
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        job.timestamp < oneDayAgo
      ) {
        jobsToRemove.push({ id, timestamp: job.timestamp });
      }
    }

    // Sort by timestamp (oldest first) to ensure consistent cleanup order
    jobsToRemove.sort((a, b) => a.timestamp - b.timestamp);

    // Remove jobs in order (oldest first)
    for (const { id } of jobsToRemove) {
      await this.removeJob(id);
      removedCount++;
    }

    return removedCount;
  }

  /**
   * Aggressive cleanup for quota exceeded scenarios
   * Removes oldest jobs until specified amount of space is freed
   * @param targetCount Target number of jobs to remove (default: 5)
   */
  private async clearOldestJobs(targetCount: number = 5): Promise<number> {
    this.ensureInitialized();

    // Get all jobs sorted by timestamp (oldest first)
    const allJobs = Array.from(this.jobsCache.entries())
      .map(([id, job]) => ({ id, timestamp: job.timestamp, status: job.status }))
      .sort((a, b) => a.timestamp - b.timestamp);

    let removedCount = 0;

    // Prioritize completed/failed/cancelled jobs first
    const completedJobs = allJobs.filter(
      (job) => job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled'
    );

    // Remove completed/failed/cancelled jobs first (oldest first)
    for (const { id } of completedJobs) {
      if (removedCount >= targetCount) break;
      await this.removeJob(id);
      removedCount++;
    }

    // If still need to remove more, remove any oldest jobs
    if (removedCount < targetCount) {
      for (const { id, status } of allJobs) {
        if (removedCount >= targetCount) break;

        // Skip if already removed
        if (!this.jobsCache.has(id)) continue;

        // Remove
        await this.removeJob(id);
        removedCount++;
      }
    }

    return removedCount;
  }

  /**
   * Get storage information
   */
  getStorageInfo(): StorageInfo {
    // Estimate storage usage
    const indexSize = JSON.stringify(this.indexCache).length;
    const jobsSize = Array.from(this.jobsCache.values())
      .map((job) => JSON.stringify(job).length)
      .reduce((sum, size) => sum + size, 0);

    const used = indexSize + jobsSize;

    // Typical localStorage limit is 5-10MB, use 5MB as conservative estimate
    const available = 5 * 1024 * 1024;
    const percentage = used / available;

    return {
      used,
      available,
      percentage,
      isNearLimit: percentage >= this.STORAGE_WARNING_THRESHOLD,
    };
  }

  // ========== Private Helper Methods ==========

  /**
   * Load job index from localStorage
   */
  private loadIndex(): void {
    try {
      const indexData = this.app.loadLocalStorage(this.INDEX_KEY);
      if (indexData) {
        this.indexCache = JSON.parse(indexData) as string[];
      } else {
        this.indexCache = [];
      }
    } catch (error) {
      console.warn('[PendingJobsManager] Failed to load index, starting fresh:', error);
      this.indexCache = [];
    }
  }

  /**
   * Save job index to localStorage
   */
  private saveIndex(): void {
    const indexData = JSON.stringify(this.indexCache);
    this.app.saveLocalStorage(this.INDEX_KEY, indexData);
  }

  /**
   * Load all jobs from localStorage into cache
   * Handles corrupted data gracefully by removing invalid jobs
   * Applies schema migration and sanitization
   */
  private loadAllJobs(): void {
    this.jobsCache.clear();

    for (const id of this.indexCache) {
      try {
        const jobData = this.app.loadLocalStorage(this.getJobKey(id));
        if (jobData) {
          // Parse JSON with error recovery
          let rawJob: any;
          try {
            rawJob = JSON.parse(jobData);
          } catch (parseError) {
            console.warn(`[PendingJobsManager] Corrupted job data for ${id}, removing:`, parseError);
            this.app.saveLocalStorage(this.getJobKey(id), null);
            continue;
          }

          // Sanitize and migrate job to current schema
          let job: PendingJob;
          try {
            job = this.sanitizeJob(rawJob);
          } catch (sanitizeError) {
            console.warn(`[PendingJobsManager] Failed to sanitize job ${id}, removing:`, sanitizeError);
            this.app.saveLocalStorage(this.getJobKey(id), null);
            continue;
          }

          // Validate job schema after sanitization
          try {
            this.validateJob(job);

            // Check for duplicates and resolve conflicts
            const duplicate = this.findDuplicate(job);
            if (duplicate) {
              const winner = this.resolveConflict(duplicate, job);
              const loser = winner.id === job.id ? duplicate : job;

              console.warn(`[PendingJobsManager] Duplicate job detected during load`, {
                kept: winner.id,
                removed: loser.id,
                url: job.url,
                platform: job.platform,
              });

              // Keep the winner, remove the loser
              this.jobsCache.set(winner.id, winner);

              // Remove loser from storage
              this.app.saveLocalStorage(this.getJobKey(loser.id), null);
            } else {
              this.jobsCache.set(id, job);
            }
          } catch (validationError) {
            console.warn(`[PendingJobsManager] Invalid job schema ${id}, removing:`, validationError);
            // Remove invalid job from localStorage
            this.app.saveLocalStorage(this.getJobKey(id), null);
          }
        }
      } catch (error) {
        console.warn(`[PendingJobsManager] Failed to load job ${id}:`, error);
        // Continue loading other jobs even if one fails
      }
    }

    // Update index to remove invalid/corrupted/duplicate jobs
    this.indexCache = Array.from(this.jobsCache.keys());
    this.saveIndex();
  }

  /**
   * Save a job to localStorage
   *
   * Note: Compression is not needed for PendingJob data as it's typically small (< 1KB).
   * Jobs only store metadata (URL, platform, status, timestamps), not actual post content.
   *
   * @throws {Error} If localStorage save fails (including quota exceeded)
   */
  private saveJob(job: PendingJob): void {
    const key = this.getJobKey(job.id);
    const jobData = JSON.stringify(job);

    // Obsidian's saveLocalStorage handles browser compatibility and private browsing mode
    // Don't wrap errors to preserve quota error detection
    this.app.saveLocalStorage(key, jobData);
  }

  /**
   * Get storage key for a job
   */
  private getJobKey(id: string): string {
    return `${this.STORAGE_KEY_PREFIX}-${id}`;
  }

  /**
   * Validate job schema
   * @throws {JobValidationError} If validation fails
   */
  private validateJob(job: PendingJob): void {
    // Check required fields
    if (!job.id) {
      throw new JobValidationError(
        ValidationErrorType.MISSING_REQUIRED_FIELD,
        'Job ID is required',
        'id'
      );
    }

    if (!job.url) {
      throw new JobValidationError(
        ValidationErrorType.MISSING_REQUIRED_FIELD,
        'Job URL is required',
        'url'
      );
    }

    if (!job.platform) {
      throw new JobValidationError(
        ValidationErrorType.MISSING_REQUIRED_FIELD,
        'Job platform is required',
        'platform'
      );
    }

    if (!job.status) {
      throw new JobValidationError(
        ValidationErrorType.MISSING_REQUIRED_FIELD,
        'Job status is required',
        'status'
      );
    }

    if (typeof job.timestamp !== 'number') {
      throw new JobValidationError(
        ValidationErrorType.INVALID_FIELD_TYPE,
        'Job timestamp must be a number',
        'timestamp'
      );
    }

    if (typeof job.retryCount !== 'number') {
      throw new JobValidationError(
        ValidationErrorType.INVALID_FIELD_TYPE,
        'Job retryCount must be a number',
        'retryCount'
      );
    }

    // Validate status
    const validStatuses: JobStatus[] = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
    if (!validStatuses.includes(job.status)) {
      throw new JobValidationError(
        ValidationErrorType.INVALID_FIELD_VALUE,
        `Invalid job status: ${job.status}`,
        'status'
      );
    }

    // Validate retry count
    if (job.retryCount < 0 || job.retryCount > this.MAX_RETRY_COUNT) {
      throw new JobValidationError(
        ValidationErrorType.INVALID_FIELD_VALUE,
        `Retry count must be between 0 and ${this.MAX_RETRY_COUNT}`,
        'retryCount'
      );
    }
  }

  /**
   * Sanitize and migrate job data to current schema version
   * Handles schema migrations and missing/invalid fields
   */
  private sanitizeJob(job: any): PendingJob {
    const sanitized: PendingJob = {
      // Set schema version if missing
      schemaVersion: job.schemaVersion ?? PENDING_JOB_SCHEMA_VERSION,

      // Required fields (kept as-is, validation will catch issues)
      id: job.id,
      url: job.url,
      platform: job.platform,
      status: job.status,
      timestamp: job.timestamp,
      retryCount: job.retryCount ?? 0, // Default to 0 if missing

      // Optional metadata (preserve if exists)
      metadata: job.metadata,
    };

    // Schema migration logic (for future versions)
    // Example: if (sanitized.schemaVersion === 0) { /* migrate from v0 to v1 */ }

    return sanitized;
  }

  /**
   * Check if a job is duplicate (same URL + platform)
   * Returns the existing job if duplicate found, null otherwise
   */
  private findDuplicate(job: PendingJob): PendingJob | null {
    for (const existingJob of this.jobsCache.values()) {
      if (
        this.isSameJob(existingJob, job) &&
        existingJob.id !== job.id && // Allow updating same job
        existingJob.status !== 'completed' && // Completed jobs don't count
        existingJob.status !== 'failed' && // Failed jobs don't count
        existingJob.status !== 'cancelled' // Cancelled jobs don't count
      ) {
        return existingJob;
      }
    }

    return null;
  }

  /**
   * Check if a job is duplicate (same URL + platform)
   */
  private isDuplicate(job: PendingJob): boolean {
    return this.findDuplicate(job) !== null;
  }

  /**
   * Check if two jobs represent the same archive operation
   * (same URL + platform, ignoring ID and status)
   */
  private isSameJob(job1: PendingJob, job2: PendingJob): boolean {
    // Normalize URLs for comparison (remove trailing slashes, fragments)
    const normalizeUrl = (url: string): string => {
      try {
        const urlObj = new URL(url);
        // Remove hash and trailing slash
        return urlObj.origin + urlObj.pathname.replace(/\/$/, '') + urlObj.search;
      } catch {
        // If URL parsing fails, compare as-is
        return url.replace(/\/$/, '');
      }
    };

    return (
      normalizeUrl(job1.url) === normalizeUrl(job2.url) &&
      job1.platform === job2.platform
    );
  }

  /**
   * Compare two jobs and determine which one to keep
   * Used for conflict resolution when duplicates are found
   * Returns the job that should be kept
   */
  private resolveConflict(existing: PendingJob, incoming: PendingJob): PendingJob {
    // Priority order for status:
    // 1. processing (actively being worked on)
    // 2. pending (waiting to be processed)
    // 3. completed/failed/cancelled (terminal states)

    const statusPriority: Record<JobStatus, number> = {
      'processing': 3,
      'pending': 2,
      'completed': 1,
      'failed': 0,
      'cancelled': 0,
    };

    const existingPriority = statusPriority[existing.status];
    const incomingPriority = statusPriority[incoming.status];

    // Keep job with higher status priority
    if (existingPriority > incomingPriority) {
      return existing;
    } else if (incomingPriority > existingPriority) {
      return incoming;
    }

    // If same status priority, keep existing job to preserve idempotency.
    // Newer duplicate jobs should not replace already-queued work.
    return existing;
  }

  /**
   * Compare two jobs and return detailed differences
   * Useful for debugging and logging
   */
  private compareJobs(job1: PendingJob, job2: PendingJob): {
    isSame: boolean;
    differences: string[];
  } {
    const differences: string[] = [];

    if (job1.id !== job2.id) {
      differences.push(`id: ${job1.id} vs ${job2.id}`);
    }

    if (job1.url !== job2.url) {
      differences.push(`url: ${job1.url} vs ${job2.url}`);
    }

    if (job1.platform !== job2.platform) {
      differences.push(`platform: ${job1.platform} vs ${job2.platform}`);
    }

    if (job1.status !== job2.status) {
      differences.push(`status: ${job1.status} vs ${job2.status}`);
    }

    if (job1.timestamp !== job2.timestamp) {
      differences.push(`timestamp: ${job1.timestamp} vs ${job2.timestamp}`);
    }

    if (job1.retryCount !== job2.retryCount) {
      differences.push(`retryCount: ${job1.retryCount} vs ${job2.retryCount}`);
    }

    return {
      isSame: differences.length === 0,
      differences,
    };
  }

  /**
   * Check if localStorage is available
   */
  private isLocalStorageAvailable(): boolean {
    try {
      const test = '__storage_test__';
      this.app.saveLocalStorage(test, test);
      this.app.saveLocalStorage(test, null);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if error is a quota exceeded error
   */
  private isQuotaError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.name === 'QuotaExceededError' ||
        error.message.includes('quota') ||
        error.message.includes('storage')
      );
    }
    return false;
  }

  /**
   * Ensure service is initialized
   * @throws {Error} If service is not initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('PendingJobsManager is not initialized. Call initialize() first.');
    }
  }
}
