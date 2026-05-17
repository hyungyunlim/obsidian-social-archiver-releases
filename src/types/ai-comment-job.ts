import type { AICli, AICommentMeta, AICommentType, AIOutputLanguage } from './ai-comment';

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
  | 'UNKNOWN';

export interface LocalAICommentPendingUpload {
  jobId: string;
  archiveId: string;
  resultCommentId?: string;
  meta: AICommentMeta;
  content: string;
  provider: AICli;
  model?: string | null;
  type: AICommentType;
  outputLanguage: AIOutputLanguage;
  createdAt: string;
  updatedAt: string;
}
