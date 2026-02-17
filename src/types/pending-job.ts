/**
 * Client-side Pending Job types for multi-device synchronization
 *
 * These types define the API request/response interfaces for
 * communicating with the server-side pending jobs endpoints.
 */

import type { Platform } from '@/shared/platforms/types';
import type { PostData } from './post';

/**
 * Archive options stored with pending job
 */
export interface PendingJobArchiveOptions {
  destinationFolder?: string;
  includeAI?: boolean;
  downloadMedia?: string; // 'all' | 'images' | 'none'
  includeTranscript?: boolean;
  includeFormattedTranscript?: boolean;
  comment?: string;
}

/**
 * Result data from completed job
 */
export interface PendingJobResult {
  postData: PostData;
  creditsUsed: number;
  processingTime: number;
}

/**
 * Error data from failed job
 */
export interface PendingJobError {
  code: string;
  message: string;
}

/**
 * Server pending job (matches server-side ServerPendingJob)
 */
export interface ServerPendingJob {
  /** Worker job ID */
  jobId: string;

  /** User identifier */
  userId: string;

  /** Original archive URL */
  url: string;

  /** Detected platform */
  platform: Platform;

  /** Job status */
  status: 'processing' | 'completed' | 'failed' | 'cancelled';

  /** Preliminary doc path in vault (relative to vault root). Optional since Phase C (single-write). */
  filePath?: string;

  /** Archive options */
  archiveOptions?: PendingJobArchiveOptions;

  /** Job creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;

  /** Result data (on completion) */
  result?: PendingJobResult;

  /** Error data (on failure) */
  error?: PendingJobError;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request body for POST /api/pending-jobs
 */
export interface CreatePendingJobRequest {
  /** Worker job ID from archive submission response */
  jobId: string;

  /** Original URL being archived */
  url: string;

  /** Detected platform */
  platform: Platform;

  /** Path to preliminary doc (relative to vault root). Optional since Phase C (single-write). */
  filePath?: string;

  /** Archive options for recovery */
  archiveOptions?: PendingJobArchiveOptions;
}

/**
 * Response from POST /api/pending-jobs
 */
export interface CreatePendingJobResponse {
  success: boolean;
  jobId?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Query params for GET /api/pending-jobs
 */
export interface GetPendingJobsParams {
  /** Filter by status */
  status?: 'processing' | 'completed' | 'failed';
}

/**
 * Response from GET /api/pending-jobs
 */
export interface GetPendingJobsResponse {
  success: boolean;
  jobs?: ServerPendingJob[];
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Response from DELETE /api/pending-jobs/:jobId
 */
export interface DeletePendingJobResponse {
  success: boolean;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Response from POST /api/pending-jobs/:jobId/cancel
 */
export interface CancelPendingJobResponse {
  success: boolean;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Enhanced WebSocket job_completed message with metadata
 */
export interface JobCompletedMessage {
  type: 'job_completed';
  jobId: string;
  status: 'completed';
  result: PendingJobResult;
  /** Metadata for cross-device processing */
  metadata?: {
    filePath?: string;
    url: string;
    platform: Platform;
    archiveOptions?: PendingJobArchiveOptions;
  };
}

/**
 * Type guard for ServerPendingJob
 */
export function isServerPendingJob(obj: unknown): obj is ServerPendingJob {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const job = obj as Record<string, unknown>;

  return (
    typeof job.jobId === 'string' &&
    typeof job.userId === 'string' &&
    typeof job.url === 'string' &&
    typeof job.platform === 'string' &&
    typeof job.status === 'string' &&
    ['processing', 'completed', 'failed', 'cancelled'].includes(job.status) &&
    (job.filePath === undefined || typeof job.filePath === 'string') &&
    typeof job.createdAt === 'number' &&
    typeof job.updatedAt === 'number'
  );
}
