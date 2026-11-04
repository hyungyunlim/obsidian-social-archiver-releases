import type { AICommentEngineId, AICommentMeta, AICommentType, AIOutputLanguage } from './ai-comment';

export type AICommentJobStatus =
  | 'queued'
  | 'dispatched'
  | 'claimed'
  | 'preparing'
  | 'running'
  | 'uploading'
  | 'retry_scheduled'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type AICommentPublicJobErrorCode =
  | 'SETTINGS_DISABLED'
  | 'PROVIDER_MISSING'
  | 'PROVIDER_AUTH_REQUIRED'
  | 'CONTENT_EMPTY'
  | 'CONTENT_TOO_LONG'
  | 'VAULT_FILE_MISSING'
  | 'ARCHIVE_MATERIALIZATION_FAILED'
  | 'CLIENT_OFFLINE'
  | 'PROCESS_TIMEOUT'
  | 'PROCESS_CANCELLED'
  | 'UPLOAD_FAILED'
  | 'STALE_CONTENT_HASH'
  // BYOK provider failures (byok-ai-core byokErrorToJobErrorCode)
  | 'PROVIDER_QUOTA_EXCEEDED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_REFUSED'
  | 'PROVIDER_UNAVAILABLE'
  | 'AI_COMMENTS_TOO_LARGE'
  | 'UNKNOWN';

export interface LocalAICommentPendingUpload {
  jobId: string;
  archiveId: string;
  resultCommentId?: string;
  meta: AICommentMeta;
  content: string;
  provider: AICommentEngineId;
  model?: string | null;
  type: AICommentType;
  outputLanguage: AIOutputLanguage;
  createdAt: string;
  updatedAt: string;
}
