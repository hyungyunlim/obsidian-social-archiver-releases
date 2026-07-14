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
import type { TextHighlight, UserNote } from '@/types/annotations';
import type { AuthorProfileSystemUpsertInput, AuthorProfileUpsertInput, UserAuthorProfile } from '@/types/author-profile';
import type { BillingEventApiPayload, BillingEventsResponse } from '@/types/billing-events';
import type { AICommentType } from '@/types/ai-comment';
import type { RelationWithSummary, RelationPullResponse } from '@/types/link-relations';
import type { ArchiveAttempt, ArchiveAttemptStatus } from '@/types/post';
import {
  InvalidPlaceApiResponseError,
  ProviderPlaceSelectionResponseSchema,
  ProviderSearchResponseSchema,
  type ProviderPlaceSelectionResponse,
  type ProviderSearchResponse,
} from '@/types/place-search';

export type {
  ProviderPlaceSelectionResponse,
  ProviderSearchCandidate,
  ProviderSearchResponse,
} from '@/types/place-search';

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

// ============================================================================
// AI Comment Job Types
// ============================================================================

export type AICommentProviderId = 'claude' | 'gemini' | 'codex';
export type AICommentSourceId = AICommentProviderId | 'workers-ai';
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

export interface AICommentExecutorJob {
  jobId: string;
  archiveId: string;
  targetClientId: string;
  status: AICommentJobStatus;
  progressPercentage?: number;
  progressMessage?: string;
  type: string;
  provider: AICommentProviderId;
  model?: string | null;
  outputLanguage: string;
  customPrompt?: string | null;
  archiveUpdatedAt?: string;
  archiveContentHash?: string;
  archiveSnapshot?: unknown;
  nextAttemptAt?: string;
  cancelRequestedAt?: string;
  updatedAt: string;
  createdAt: string;
}

export interface AICommentJobSummary {
  jobId: string;
  archiveId: string;
  targetClientId: string;
  status: AICommentJobStatus;
  uiStatus: 'waiting' | 'preparing' | 'running' | 'done' | 'needs_action';
  progressPercentage?: number;
  progressMessage?: string;
  nextAttemptAt?: string;
  lastHeartbeatAt?: string;
  errorCode?: string;
  errorMessagePublic?: string;
  updatedAt: string;
}

export interface AICommentClaimResponse {
  jobId: string;
  lockToken: string;
  lockTokenVersion: number;
  leaseExpiresAt: string;
  archiveId: string;
  archiveUpdatedAt?: string;
  archiveContentHash?: string;
  type: string;
  provider: AICommentProviderId;
  model?: string | null;
  outputLanguage: string;
}

export interface AICommentLeaseResponse {
  job: AICommentJobSummary;
  lockToken: string;
  lockTokenVersion: number;
  leaseExpiresAt: string;
}

export interface AICommentProviderCapability {
  id: AICommentProviderId;
  available: boolean;
  authenticated: boolean;
  version?: string;
  errorCode?: string;
  models?: AICommentModelOption[];
  defaultModel?: string;
}

export interface AICommentModelOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface AICommentExecutorCapabilityPayload {
  enabled: boolean;
  status: 'ready' | 'settings_disabled' | 'unsupported_runtime' | 'provider_missing' | 'provider_auth_required' | 'error';
  providers: AICommentProviderCapability[];
  defaultProvider?: AICommentProviderId;
  supportedTypes: string[];
  outputLanguage: string;
  platformVisibilityHash: string;
  pluginVersion: string;
  updatedAt: string;
}

export type AIActionType =
  | 'comment.summary'
  | 'comment.factcheck'
  | 'comment.glossary'
  | 'comment.reformat'
  | 'comment.custom'
  | 'tags.suggest_apply'
  | 'content.translate_variant'
  | 'content.reformat_variant';
export type AIActionTypeValue = AIActionType | (string & Record<never, never>);

export type AIActionResultKind = 'comment' | 'tag_patch' | 'content_variant';
export type AIActionJobStatus = AICommentJobStatus | 'billing_blocked';

export interface AIActionExecutorCapabilityPayload {
  enabled: boolean;
  capabilities: string[];
  pluginVersion?: string;
  updatedAt: string;
}

export interface AIActionExecutorJob {
  jobId: string;
  archiveId: string;
  targetClientId?: string | null;
  status: AIActionJobStatus;
  progress?: number;
  progressPercentage?: number;
  progressMessage?: string | null;
  actionType: AIActionTypeValue;
  resultKind?: AIActionResultKind | null;
  provider: AICommentProviderId;
  model?: string | null;
  outputLanguage?: string | null;
  customPrompt?: string | null;
  actionParams?: Record<string, unknown> | null;
  sourceContentHash?: string | null;
  archiveContentHash?: string | null;
  archiveSnapshot?: unknown;
  leaseExpiresAt?: string | null;
  cancelRequestedAt?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface AIActionClaimResponse {
  jobId: string;
  lockToken: string;
  lockTokenVersion: number;
  leaseExpiresAt: string;
  job: AIActionExecutorJob;
}

export interface AIActionLeaseResponse {
  job: AIActionJobSummary;
  lockToken: string;
  lockTokenVersion: number;
  leaseExpiresAt: string;
}

export interface AIActionJobSummary {
  jobId: string;
  archiveId: string;
  targetClientId?: string | null;
  actionType: AIActionTypeValue;
  resultKind?: AIActionResultKind | null;
  status: AIActionJobStatus;
  progress?: number;
  progressMessage?: string;
  updatedAt: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface AIActionAvailability {
  available: boolean;
  mode: 'queued' | 'unavailable';
  reason: null | 'active_job_exists' | 'no_capable_executor';
  actionType: AIActionType;
  resultKind: AIActionResultKind;
  capableClientIds: string[];
  activeJob: AIActionJobSummary | null;
}

export interface CreateAIActionJobRequest {
  archiveId: string;
  actionType: AIActionType;
  targetClientId?: string;
  provider?: AICommentProviderId;
  model?: string;
  outputLanguage?: string;
  targetLanguage?: string;
  sourceLanguage?: string;
  detectedLanguage?: string;
  customPrompt?: string;
  actionParams?: Record<string, unknown>;
  sourceClientId?: string;
}

export interface CreateAIActionJobResponse {
  jobId: string;
  archiveId: string;
  targetClientId?: string | null;
  actionType: AIActionType;
  resultKind: AIActionResultKind;
  status: AIActionJobStatus;
  delivery: 'websocket' | 'queued';
  createdAt: string;
  activeJob: AIActionJobSummary;
}

export interface ContentVariant {
  id: string;
  userId: string;
  archiveId: string;
  type: 'translation' | 'reformat';
  language?: string;
  title?: string;
  contentMarkdown?: string;
  contentText?: string;
  sourceContentHash: string;
  provider: string;
  model?: string;
  jobId?: string;
  createdAt: string;
  updatedAt: string;
  visibility: 'available' | 'hidden' | 'stale';
  bodyStorage: 'inline' | 'r2';
  bodyR2Key?: string;
  byteLength: number;
}

// ============================================================================
// Transcription Job Types
// ============================================================================

export type TranscriptionMediaKind = 'audio' | 'video';
export type TranscriptionJobMode = 'transcribe-existing-media' | 'download-and-transcribe' | 'download-only';
export type TranscriptionModel = 'tiny' | 'base' | 'small' | 'medium' | 'large';
export type TranscriptionModelWithEnglish =
  | TranscriptionModel
  | 'tiny.en'
  | 'base.en'
  | 'small.en'
  | 'medium.en';

export interface TranscriptionMediaRef {
  mediaId?: string;
  mediaIndex?: number;
  sourceUrlHash?: string;
  kind: TranscriptionMediaKind;
}

export type TranscriptionCapabilityStatus =
  | 'ready'
  | 'settings_disabled'
  | 'whisper_missing'
  | 'model_missing'
  | 'ffmpeg_missing'
  | 'yt_dlp_missing'
  | 'unsupported_runtime'
  | 'error';

export interface TranscriptionExecutorCapabilityPayload {
  enabled: boolean;
  runtime: 'desktop';
  status: TranscriptionCapabilityStatus;
  whisper: {
    available: boolean;
    variant: 'auto' | 'faster-whisper' | 'openai-whisper' | 'whisper.cpp' | null;
    pathKind: 'path' | 'custom' | null;
    version?: string;
    installedModels: TranscriptionModelWithEnglish[];
    preferredModel: TranscriptionModel;
    language: string;
  };
  ffmpeg: {
    available: boolean;
    version?: string;
  };
  ffprobe: {
    available: boolean;
    version?: string;
    optional: true;
  };
  ytDlp: {
    available: boolean;
    requiredOnlyForDownloadMode: true;
  };
  supportedMediaTypes: TranscriptionMediaKind[];
  supportedModes: TranscriptionJobMode[];
  maxConcurrentJobs: 1;
  updatedAt: string;
}

export interface TranscriptionExecutorCapability extends TranscriptionExecutorCapabilityPayload {
  capabilityHash: string;
}

export type TranscriptionJobStatus =
  | 'queued'
  | 'dispatched'
  | 'claiming'
  | 'claimed'
  | 'preparing_archive'
  | 'preparing_media'
  | 'running'
  | 'uploading'
  | 'merging'
  | 'retry_scheduled'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'expired';

export type TranscriptionPublicErrorCode =
  | 'WHISPER_NOT_INSTALLED'
  | 'WHISPER_AUTH_OR_MODEL_ERROR'
  | 'FFMPEG_MISSING'
  | 'FFMPEG_FAILED'
  | 'FFPROBE_UNAVAILABLE'
  | 'YT_DLP_MISSING'
  | 'MEDIA_FILE_MISSING'
  | 'MEDIA_MATERIALIZATION_FAILED'
  | 'ARCHIVE_MATERIALIZATION_FAILED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'TIMEOUT'
  | 'OUT_OF_MEMORY'
  | 'PROCESS_CANCELLED'
  | 'UPLOAD_FAILED'
  | 'STALE_LEASE'
  | 'CAPABILITY_DRIFT'
  | 'CAPABILITY_STALE'
  | 'RATE_LIMITED'
  | 'EXECUTOR_OFFLINE'
  | 'FEATURE_DISABLED'
  | 'OWNERSHIP_REVOKED'
  | 'AVAILABILITY_TOKEN_INVALID'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'ACTIVE_JOB_EXISTS'
  | 'RESULT_INTAKE_IN_PROGRESS'
  | 'TRANSCRIPT_TOO_LARGE'
  | 'UNKNOWN';

export interface TranscriptionActiveJobSummary {
  jobId: string;
  archiveId: string;
  mediaRefHash: string;
  status: TranscriptionJobStatus;
  uiStatus: 'queued' | 'preparing' | 'running' | 'done';
  progressPercentage?: number;
  progressCode?: string;
  nextAttemptAt?: string;
  errorCode?: string;
  errorMessagePublic?: string;
  terminalReason?: string;
  transcriptResultId?: string;
  localMediaPath?: string;
  updatedAt: string;
}

export interface TranscriptionExecutorJob extends TranscriptionActiveJobSummary {
  targetClientId: string;
  mediaRef: TranscriptionMediaRef;
  mode: TranscriptionJobMode;
  requestedModel?: string;
  language?: string;
}

export interface TranscriptionClaimResponse {
  job: TranscriptionExecutorJob;
  lockToken: string;
  lockTokenVersion: number;
  leaseExpiresAt: string;
}

export interface TranscriptionLeaseResponse {
  job: TranscriptionActiveJobSummary;
  lockToken: string;
  lockTokenVersion: number;
  leaseExpiresAt: string;
}

export interface TranscriptionAvailabilityEntry {
  archiveId: string;
  mediaRefHash: string;
  available: boolean;
  executor: {
    status:
      | TranscriptionCapabilityStatus
      | 'live_ready'
      | 'queued_ready'
      | 'no_executor';
  };
  activeJob?: TranscriptionActiveJobSummary;
  availabilityToken?: string;
}

export interface WhisperTranscriptProjection {
  source?: 'whisper';
  segments: Array<{
    id?: number;
    start: number;
    end?: number;
    text: string;
    speaker?: string;
  }>;
  text?: string;
  rawText?: string;
  language: string;
  model?: string;
  duration?: number;
  hasWordTimestamps?: boolean;
  transcriptResultId?: string;
  updatedAt?: string;
}

export interface CreateTranscriptionJobResponse {
  job: TranscriptionActiveJobSummary;
  delivery?: {
    liveDispatched?: boolean;
    queued?: boolean;
  };
}

export interface SyncClientCapabilityRefresh {
  aiCommentExecutor?: AICommentExecutorCapabilityPayload | null;
  aiActionExecutor?: AIActionExecutorCapabilityPayload | null;
  transcriptionExecutor?: TranscriptionExecutorCapabilityPayload | null;
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
/**
 * Server-side platform comment node (as returned by GET /api/user/archives/:id).
 *
 * Recursive: `replies` carry the same shape at any depth (the server `mapComment`
 * recurses). Pin/delete sync metadata (`pinnedAt`/`pinnedByClientId`/`updatedAt`)
 * is additive and optional — see PRD R1
 * (`docs/specs/platform-comment-delete-and-pin-sync-prd.md`).
 *
 * Note: comment-level `media` is intentionally absent here — the server drops it
 * on read (`mapComment`), an accepted documented MVP round-trip loss (R1).
 */
export interface UserArchiveComment {
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
  /** ISO 8601 datetime — present when this comment node is pinned (PRD R1). */
  pinnedAt?: string;
  /** Optional source client ID (diagnostic only). */
  pinnedByClientId?: string;
  /** Optional mutation time (diagnostic only). */
  updatedAt?: string;
  replies?: UserArchiveComment[];
}

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
    duration?: number;
  }> | null;
  mediaPreserved?: Array<{
    originalUrl: string;
    r2Url: string;
    r2Key: string;
    type: 'image' | 'video' | 'audio';
    size: number;
    contentType: string;
    preservedAt: string;
    width?: number;
    height?: number;
    sourceIndex?: number;
    variant?: 'primary' | 'thumbnail';
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
  // Structured location (workers migration 0123)
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationSource?: string | null;
  locationExternalId?: string | null;
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
  comments?: UserArchiveComment[];
  isReblog?: boolean;
  // Archive source (single, profile_crawl, subscription, composed)
  archiveSource?: string | null;
  // X article (long-form post) derived fields
  isArticle?: boolean;
  contentType?: 'post' | 'article' | 'meeting-note' | 'audio-note';
  articleMarkdown?: string | null;
  metadata: Record<string, unknown> | null;
  isLiked: boolean;
  isBookmarked: boolean;
  isArchived: boolean;
  isShared: boolean;
  // Share URL (set when archive has an active share link)
  shareUrl?: string | null;
  // Mobile annotation fields (populated by GET /api/user/archives/:archiveId)
  userNotes?: UserNote[];
  userNoteCount?: number;
  userHighlights?: TextHighlight[];
  userHighlightCount?: number;
  aiComments?: AICommentPayload[];
  whisperTranscript?: WhisperTranscriptProjection | null;
  transcriptionLanguage?: string | null;
  transcriptionModel?: string | null;
  transcriptionUpdatedAt?: string | null;
  transcriptResultId?: string | null;
  transcriptionDuration?: number | null;
  transcriptionProcessingTime?: number | null;
}

export interface AICommentPayload {
  meta: {
    id: string;
    cli: AICommentSourceId;
    model?: string;
    type: AICommentType;
    generatedAt: string;
    processingTime?: number;
    contentHash?: string;
    customPrompt?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
  };
  content: string;
}

export interface GetUserArchiveResponse {
  archive: UserArchive;
}

// ============================================================================
// Place Candidates types (Places P3 — server contract, mirrors mobile
// mapPlacesApi.ts)
// ============================================================================

/**
 * Place candidate row from the review queue
 * (`GET /api/user/place-candidates`). `evidenceType` is intentionally a
 * plain string — P3a ships 'maps_url' | 'jsonld' | 'anchor' and later phases
 * add more; unknown types must degrade to the text-confirm flow instead of
 * being silently dropped.
 */
export interface PlaceCandidate {
  id: string;
  archiveId: string;
  name: string | null;
  addressText: string | null;
  cityHint: string | null;
  evidenceType: string;
  evidenceText: string;
  confidenceBucket: string | null;
  score: number | null;
  latitude: number | null;
  longitude: number | null;
  externalSource: string | null;
  externalPlaceId: string | null;
  state: string;
  createdAt: string;
}

export interface PlaceCandidatesResponse {
  items: PlaceCandidate[];
  pendingCount: number;
}

export type PlaceCandidatesQuery =
  | { archiveIds: string[] }
  | { state: 'pending'; limit?: number };

export interface PlaceCandidateConfirmBody {
  targetArchiveId?: string;
  /** Manual override: place name written to the archive's `location`. */
  location?: string;
  /** Manual override: free-text address. */
  addressText?: string;
}

export interface PlaceCandidateConfirmResult {
  archiveId: string;
  place: {
    locationSource: string;
    locationExternalId: string | null;
    latitude: number | null;
    longitude: number | null;
    location: string | null;
  };
}

export interface GetUserArchivesParams {
  limit?: number;
  offset?: number;
  fields?: 'sync_metadata';
  platform?: string;
  platforms?: string[];
  archiveSource?: string;
  archived?: boolean;
  liked?: boolean;
  shared?: boolean;
  updatedAfter?: string;
  includeDeleted?: boolean;
  archivedBefore?: string;
  originalUrl?: string;
}

export interface GetUserArchivesResponse {
  archives: UserArchive[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  serverTime: string;
  deletedIds?: string[];
  deletedArchives?: DeletedArchiveRef[];
}

export interface DeletedArchiveRef {
  id: string;
  originalUrl: string | null;
  platform: string | null;
  postId: string | null;
  deletedAt: string;
}

export interface WorkersAPIConfig {
  endpoint: string;
  licenseKey?: string;
  authToken?: string;
  timeout?: number;
  pluginVersion?: string;
  /** Registered sync client ID, sent as X-Client-Id header for echo suppression */
  clientId?: string;
}

export type AutoArchiveInboxDays = 0 | 7 | 14 | 30 | 60 | 90;

export interface ArchivePreferences {
  autoArchiveInboxDays: AutoArchiveInboxDays;
  retainFailedArchiveAttempts: boolean;
  failedArchiveAttemptRetentionDays: 30 | 90 | 180 | 365;
  autoArchiveLastRunAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type ArchivePreferencesPatch = Partial<Pick<
  ArchivePreferences,
  'autoArchiveInboxDays' | 'retainFailedArchiveAttempts' | 'failedArchiveAttemptRetentionDays'
>>;

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

export interface ArchiveQuotaSummary {
  period: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
  unlimited?: boolean;
}

export interface AIActionQuotaSummary {
  period: string;
  used: number;
  reserved: number;
  limit: number;
  remaining: number;
  resetAt: string;
  unlimited?: boolean;
}

export interface BillingPolicySummary {
  betaFreeSunsetAt?: string | null;
  betaFreeSunsetActive?: boolean;
}

export interface BillingUsageResponse {
  plan: string;
  archiveQuota: ArchiveQuotaSummary;
  aiActionQuota?: AIActionQuotaSummary;
  billing?: {
    entitlementActive?: boolean;
    source?: string;
    entitlementId?: string | null;
    revenuecatCustomerId?: string | null;
    currentPeriodEnd?: string | null;
    willRenew?: boolean | null;
  };
  policy?: BillingPolicySummary;
}

export interface FeedDetectionData {
  platform: PlatformType;
  feedTitle?: string;
  feedDescription?: string;
  feedImage?: string;
  author?: string;
  episodeCount?: number;
}

// ============================================================================
// User Tags Types (matches server workers/src/types/user-tags.ts)
// ============================================================================

/** Single tag upsert input for POST /api/user/tags */
export interface TagUpsertInput {
  id: string;
  name: string;
  color?: string | null;
  sortOrder?: number;
}

/** Single archive-tag mapping for POST/DELETE /api/user/archive-tags */
export interface ArchiveTagMappingInput {
  archiveId: string;
  tagId: string;
}

/** A user-defined tag returned from GET /api/user/tags */
export interface UserTag {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Response from GET /api/user/tags */
export interface UserTagsResponse {
  tags: UserTag[];
  deletedIds: string[];
  serverTime: string;
}

/** A resolved tag entry returned from POST /api/user/tags */
export interface ResolvedTagEntry {
  /** The client-supplied ID that was sent */
  requestedId: string;
  /** The canonical (server-authoritative) tag */
  canonicalTag: {
    id: string;
    name: string;
    color: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
  };
}

/** Response from POST /api/user/tags */
export interface UpsertTagsResult {
  upserted: number;
  serverTime: string;
  /** Canonical tag mappings — present when server supports ID resolution */
  resolvedTags?: ResolvedTagEntry[];
}

/** Response from POST /api/user/archive-tags */
export interface UpsertArchiveTagsResult {
  upserted: number;
  serverTime: string;
}

// ============================================================================
// User Author Profiles Types
// ============================================================================

export interface UserAuthorProfilesResponse {
  profiles: UserAuthorProfile[];
  serverTime: string;
}

export interface UpsertAuthorProfilesResult {
  upserted: number;
  serverTime: string;
}

// ============================================================================
// Composed Post Types
// ============================================================================

export interface ComposedMediaUploadResult {
  mediaId: string;
  url: string;
}

export interface CreateComposedPostRequest {
  clientPostId: string;
  content: string;
  platform: 'post';
  title?: string | null;
  previewText?: string | null;
  fullContent?: string | null;
  publishedAt?: string;
  authorName?: string;
  authorUrl?: string;
}

export interface UpdateComposedPostRequest {
  clientPostId: string;
  content: string;
  platform: 'post';
  title?: string | null;
  previewText?: string | null;
  fullContent?: string | null;
  publishedAt?: string;
  authorName?: string;
  authorUrl?: string;
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
        throw: false,
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
        results: [],
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
   * Get current user's billing usage and archive quota summary.
   */
  async getUserUsage(): Promise<BillingUsageResponse> {
    this.ensureInitialized();

    return await this.request<BillingUsageResponse>('/api/user/usage', {
      method: 'GET',
    });
  }

  /**
   * Fetch active billing lifecycle events for the current user.
   *
   * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md`
   * §7.3, §8.6.
   *
   * Sends `X-Client-Capabilities: billing-v1,app-update-v1,external_billing_handoff-v1`
   * (NEVER `native_paywall`) so the server returns plugin-executable CTA
   * actions (`update_and_pay_in_mobile` / `dismiss`) instead of mobile-native
   * actions the plugin cannot execute.
   *
   * Fail-soft: returns `[]` on any of HTTP non-2xx, JSON parse failure,
   * unauthenticated state, or network error. Never throws — billing fetch
   * failure must never block plugin load, archive flow, or settings render.
   */
  async getActiveBillingEvents(): Promise<BillingEventApiPayload[]> {
    if (!this.config.endpoint) {
      return [];
    }
    if (!this.config.authToken) {
      return [];
    }

    const url = `${this.config.endpoint}/api/user/billing-events`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': this.config.pluginVersion || '0.0.0',
      'X-Platform': this.getPlatformIdentifier(),
      'X-Client-Capabilities': 'billing-v1,app-update-v1,external_billing_handoff-v1',
      Authorization: `Bearer ${this.config.authToken}`,
    };
    if (this.config.clientId) {
      headers['X-Client-Id'] = this.config.clientId;
    }

    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers,
        throw: false,
      });

      if (response.status < 200 || response.status >= 300) {
        return [];
      }

      const body = response.json as { success?: boolean; data?: Partial<BillingEventsResponse> } | undefined;
      if (!body || body.success !== true) {
        return [];
      }
      const events = body.data?.events;
      return Array.isArray(events) ? events : [];
    } catch (err) {
      console.warn('[WorkersAPIClient] getActiveBillingEvents failed:', err);
      return [];
    }
  }

  /**
   * Dismiss a billing lifecycle event.
   *
   * PRD: `.taskmaster/docs/prd-billing-lifecycle-notifications-plugin.md`
   * §6.3, §7.3.
   *
   * Returns `true` only when the response is 2xx AND the server confirms
   * `data.dismissed === true`. Returns `false` for normal no-op responses
   * (e.g. event already dismissed, non-dismissible row). Throws on
   * unexpected network/server errors so the store layer can roll back the
   * optimistic UI removal.
   */
  async dismissBillingEvent(eventId: string): Promise<boolean> {
    this.ensureInitialized();

    const encodedId = encodeURIComponent(eventId);
    const url = `${this.config.endpoint}/api/user/billing-events/${encodedId}/dismiss`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': this.config.pluginVersion || '0.0.0',
      'X-Platform': this.getPlatformIdentifier(),
      'X-Client-Capabilities': 'billing-v1,app-update-v1,external_billing_handoff-v1',
    };
    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
    }
    if (this.config.clientId) {
      headers['X-Client-Id'] = this.config.clientId;
    }

    const response = await requestUrl({
      url,
      method: 'POST',
      headers,
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      return false;
    }

    const body = response.json as { success?: boolean; data?: { dismissed?: boolean } } | undefined;
    if (!body || body.success !== true) {
      return false;
    }
    return body.data?.dismissed === true;
  }

  async getArchivePreferences(): Promise<ArchivePreferences> {
    this.ensureInitialized();
    if (!this.config.authToken) {
      throw new Error('Authentication required');
    }

    const response = await requestUrl({
      url: `${this.config.endpoint}/api/user/archive-preferences`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...this.getClientHeaders(),
        Authorization: `Bearer ${this.config.authToken}`,
      },
      throw: false,
    });

    const body = response.json as {
      success?: boolean;
      preferences?: ArchivePreferences;
      data?: { preferences?: ArchivePreferences };
      error?: { code?: string; message?: string; details?: unknown };
    } | undefined;
    const preferences = body?.preferences ?? body?.data?.preferences;
    if (response.status >= 200 && response.status < 300 && body?.success === true && preferences) {
      return preferences;
    }

    const error = new Error(body?.error?.message || 'Failed to load archive preferences') as Error & {
      code?: string;
      details?: unknown;
      status?: number;
    };
    error.code = body?.error?.code;
    error.details = body?.error?.details;
    error.status = response.status;
    throw error;
  }

  async updateArchivePreferences(patch: ArchivePreferencesPatch): Promise<ArchivePreferences> {
    this.ensureInitialized();
    if (!this.config.authToken) {
      throw new Error('Authentication required');
    }

    const response = await requestUrl({
      url: `${this.config.endpoint}/api/user/archive-preferences`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...this.getClientHeaders(),
        Authorization: `Bearer ${this.config.authToken}`,
      },
      body: JSON.stringify(patch),
      throw: false,
    });

    const body = response.json as {
      success?: boolean;
      preferences?: ArchivePreferences;
      data?: { preferences?: ArchivePreferences };
      error?: { code?: string; message?: string; details?: unknown };
    } | undefined;
    const preferences = body?.preferences ?? body?.data?.preferences;
    if (response.status >= 200 && response.status < 300 && body?.success === true && preferences) {
      return preferences;
    }

    const error = new Error(body?.error?.message || 'Failed to update archive preferences') as Error & {
      code?: string;
      details?: unknown;
      status?: number;
    };
    error.code = body?.error?.code;
    error.details = body?.error?.details;
    error.status = response.status;
    throw error;
  }

  async listArchiveAttempts(params: {
    status?: ArchiveAttemptStatus;
    includeDismissed?: boolean;
    limit?: number;
    cursor?: string | null;
  } = {}): Promise<{ attempts: ArchiveAttempt[]; nextCursor: string | null }> {
    this.ensureInitialized();
    if (!this.config.authToken) {
      throw new Error('Authentication required');
    }

    const searchParams = new URLSearchParams();
    if (params.status) searchParams.set('status', params.status);
    if (params.includeDismissed) searchParams.set('includeDismissed', 'true');
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.cursor) searchParams.set('cursor', params.cursor);

    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : '';
    const response = await requestUrl({
      url: `${this.config.endpoint}/api/user/archive-attempts${suffix}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...this.getClientHeaders(),
        Authorization: `Bearer ${this.config.authToken}`,
      },
      throw: false,
    });

    const body = response.json as {
      success?: boolean;
      attempts?: ArchiveAttempt[];
      nextCursor?: string | null;
      data?: { attempts?: ArchiveAttempt[]; nextCursor?: string | null };
      error?: { code?: string; message?: string; details?: unknown };
    } | undefined;
    if (response.status >= 200 && response.status < 300 && body?.success === true) {
      return {
        attempts: body.attempts ?? body.data?.attempts ?? [],
        nextCursor: body.nextCursor ?? body.data?.nextCursor ?? null,
      };
    }

    const error = new Error(body?.error?.message || 'Failed to load archive attempts') as Error & {
      code?: string;
      details?: unknown;
      status?: number;
    };
    error.code = body?.error?.code;
    error.details = body?.error?.details;
    error.status = response.status;
    throw error;
  }

  async dismissArchiveAttempt(attemptId: string): Promise<ArchiveAttempt> {
    this.ensureInitialized();
    if (!this.config.authToken) {
      throw new Error('Authentication required');
    }

    const response = await requestUrl({
      url: `${this.config.endpoint}/api/user/archive-attempts/${encodeURIComponent(attemptId)}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...this.getClientHeaders(),
        Authorization: `Bearer ${this.config.authToken}`,
      },
      body: JSON.stringify({ dismissed: true }),
      throw: false,
    });

    const body = response.json as {
      success?: boolean;
      attempt?: ArchiveAttempt;
      data?: { attempt?: ArchiveAttempt };
      error?: { code?: string; message?: string; details?: unknown };
    } | undefined;
    const attempt = body?.attempt ?? body?.data?.attempt;
    if (response.status >= 200 && response.status < 300 && body?.success === true && attempt) {
      return attempt;
    }

    const error = new Error(body?.error?.message || 'Failed to dismiss archive attempt') as Error & {
      code?: string;
      details?: unknown;
      status?: number;
    };
    error.code = body?.error?.code;
    error.details = body?.error?.details;
    error.status = response.status;
    throw error;
  }

  /**
   * Poll job until completed
   * Returns PostData to match ApiClient interface
   */
  async waitForJob(jobId: string, onProgress?: (progress: number) => void): Promise<unknown> {
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
  async triggerBatchArchive(request: BatchArchiveTriggerRequest): Promise<BatchArchiveTriggerResponse> {
    this.ensureInitialized();

    const response = await this.request<BatchArchiveTriggerResponse>('/api/archive/batch-trigger', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    return response;
  }

  /**
   * Get batch archive job status
   */
  async getBatchJobStatus(batchJobId: string): Promise<BatchArchiveJobStatusResponse> {
    this.ensureInitialized();

    const response = await this.request<BatchArchiveJobStatusResponse>(`/api/archive/${batchJobId}`, {
      method: 'GET',
    });

    return response;
  }

  /**
   * Wait for batch archive job completion with polling
   */
  async waitForBatchJob(
    batchJobId: string,
    onProgress?: (completed: number, total: number) => void,
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
        onProgress(status.batchMetadata.completedCount, status.batchMetadata.urlCount);
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
   * Set the sync client ID sent as X-Client-Id for echo suppression.
   * Call this after syncClientId is registered in settings.
   */
  setClientId(clientId: string): void {
    this.config.clientId = clientId;
  }

  // -------------------------------------------------------------------------
  // AdapterHttp surface (consumed by ImportAPIClientAdapter for the Phase 2
  // import feature). These are thin accessors over private config so the
  // adapter can build requests that match this client's conventions (base
  // URL, auth token, X-Client/X-Platform headers) without going through the
  // JSON-only `request<T>()` helper.
  // -------------------------------------------------------------------------

  /** API base URL from settings (readonly for callers). */
  getEndpoint(): string {
    return this.config.endpoint;
  }

  /** Current Bearer token; `null` when the user is not authenticated. */
  getAuthToken(): string | null {
    return this.config.authToken ?? null;
  }

  /** Plugin manifest version exposed for adapters that build their own
   * `X-Client-Version` header (e.g. `NoticesService`). Falls back to '0.0.0'
   * when not configured, matching `getClientHeaders()` semantics. */
  getPluginVersion(): string {
    return this.config.pluginVersion || '0.0.0';
  }

  /**
   * Standard client identity headers every request carries. Callers add
   * `Content-Type` and `Authorization` as needed. Exposed so we don't have
   * to duplicate the X-Client/X-Platform convention in each consumer.
   */
  getClientHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': this.config.pluginVersion || '0.0.0',
      'X-Platform': this.getPlatformIdentifier(),
    };
    if (this.config.clientId) {
      headers['X-Client-Id'] = this.config.clientId;
    }
    return headers;
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
  private async request<T>(path: string, options: Partial<RequestUrlParam> = {}): Promise<T> {
    const url = `${this.config.endpoint}${path}`;

    // Build headers with optional Authorization
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': this.config.pluginVersion || '0.0.0',
      'X-Platform': this.getPlatformIdentifier(),
      ...options.headers,
    };
    if (this.config.clientId && !headers['X-Client-Id']) {
      headers['X-Client-Id'] = this.config.clientId;
    }

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
        const extError = error as Error & {
          code?: string;
          details?: unknown;
          status?: number;
        };
        extError.code = data.error?.code;
        extError.details = data.error?.details;
        extError.status = response.status;
        throw extError;
      }

      return data.data as T;
    } catch (error) {
      const failure = {
        url,
        error: error instanceof Error ? error.message : String(error),
        code: error instanceof Error ? (error as Error & { code?: string }).code : undefined,
        details: error instanceof Error ? (error as Error & { details?: unknown }).details : undefined,
        status: error instanceof Error ? (error as Error & { status?: number }).status : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      };
      if (failure.code === 'ARCHIVE_NOT_FOUND' && failure.status === 404) {
        console.debug('[WorkersAPIClient] Request failed:', failure);
      } else {
        console.error('[WorkersAPIClient] Request failed:', failure);
      }
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
        throw new Error(`Failed to fetch media: ${error instanceof Error ? error.message : String(error)}`);
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
      throw new Error(`Failed to proxy media: ${error instanceof Error ? error.message : String(error)}`);
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
    } catch {
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
      const response = await this.request<FeedDetectionData>(`/api/detect-feed?url=${encodedUrl}`, { method: 'GET' });

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
  // Place Candidates API (Places P3)
  // ============================================================================

  /**
   * Fetch place candidates, either for a specific set of archive IDs (≤50,
   * banner batching) or the global pending review queue.
   */
  async getPlaceCandidates(query: PlaceCandidatesQuery): Promise<PlaceCandidatesResponse> {
    this.ensureInitialized();

    const params = new URLSearchParams();
    if ('archiveIds' in query) {
      if (query.archiveIds.length === 0) {
        return { items: [], pendingCount: 0 };
      }
      params.set('archiveIds', query.archiveIds.slice(0, 50).join(','));
    } else {
      params.set('state', query.state);
      if (typeof query.limit === 'number') {
        params.set('limit', String(query.limit));
      }
    }

    return await this.request<PlaceCandidatesResponse>(
      `/api/user/place-candidates?${params.toString()}`,
      { method: 'GET' },
    );
  }

  /**
   * Confirm a place candidate — applies it to its archive on the server.
   * Optional body carries manual overrides (`location`, `addressText`) or a
   * `targetArchiveId`. Throws with `code === 'CANDIDATE_NOT_PENDING'` (409)
   * when another device already reviewed the candidate.
   */
  async confirmPlaceCandidate(
    candidateId: string,
    body: PlaceCandidateConfirmBody = {},
  ): Promise<PlaceCandidateConfirmResult> {
    this.ensureInitialized();

    return await this.request<PlaceCandidateConfirmResult>(
      `/api/user/place-candidates/${encodeURIComponent(candidateId)}/confirm`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  /** Permanently reject (suppress) a place candidate. */
  async rejectPlaceCandidate(candidateId: string): Promise<{ ok: true }> {
    this.ensureInitialized();

    return await this.request<{ ok: true }>(
      `/api/user/place-candidates/${encodeURIComponent(candidateId)}/reject`,
      { method: 'POST', body: JSON.stringify({}) },
    );
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
   * Get all archives for the current user with optional pagination and filtering
   *
   * @param params - Optional query parameters for filtering/pagination
   * @returns Paginated list of user archives with server metadata
   */
  async getUserArchives(params: GetUserArchivesParams = {}): Promise<GetUserArchivesResponse> {
    this.ensureInitialized();

    // Build query string from params
    const queryParams = new URLSearchParams();
    if (params.limit !== undefined) queryParams.set('limit', String(params.limit));
    if (params.offset !== undefined) queryParams.set('offset', String(params.offset));
    if (params.fields !== undefined) queryParams.set('fields', params.fields);
    if (params.platform !== undefined) queryParams.set('platform', params.platform);
    if (params.platforms !== undefined) queryParams.set('platforms', params.platforms.join(','));
    if (params.archiveSource !== undefined) queryParams.set('archiveSource', params.archiveSource);
    if (params.archived !== undefined) queryParams.set('archived', String(params.archived));
    if (params.liked !== undefined) queryParams.set('liked', String(params.liked));
    if (params.shared !== undefined) queryParams.set('shared', String(params.shared));
    if (params.updatedAfter !== undefined) queryParams.set('updatedAfter', params.updatedAfter);
    if (params.includeDeleted !== undefined) queryParams.set('includeDeleted', String(params.includeDeleted));
    if (params.archivedBefore !== undefined) queryParams.set('archivedBefore', params.archivedBefore);
    if (params.originalUrl !== undefined) queryParams.set('originalUrl', params.originalUrl);

    const query = queryParams.toString();
    const path = query ? `/api/user/archives?${query}` : '/api/user/archives';

    return await this.request<GetUserArchivesResponse>(path, {
      method: 'GET',
    });
  }

  /**
   * List active link relations for a single archive (the archive is source OR
   * target), each paired with the NON-SELF side summary.
   *
   * `GET /api/user/archives/:archiveId/link-relations` → `{ relations }`.
   * Active rows only (no soft-deleted). `otherArchive` is null when the other
   * side is soft-deleted / unresolved / an author-mention.
   *
   * Throw-on-error (mirrors `getUserArchive`). The caller (LinkRelationSyncService)
   * wraps this in a try/catch and degrades to a no-op on failure, so a single
   * archive's relation fetch failing never blocks the broader sync loop.
   */
  async getArchiveLinkRelations(archiveId: string): Promise<RelationWithSummary[]> {
    this.ensureInitialized();

    const response = await this.request<{ relations: RelationWithSummary[] }>(
      `/api/user/archives/${encodeURIComponent(archiveId)}/link-relations`,
      { method: 'GET' },
    );

    return Array.isArray(response.relations) ? response.relations : [];
  }

  /**
   * Pull-sync delta of link relations updated after a cursor.
   *
   * `GET /api/user/archive-link-relations?updatedAfter=<ISO>&limit=<n>` →
   * `{ relations, serverTime }`. The response INCLUDES soft-deleted rows
   * (deletedAt set) so the client can drop their rendered rows; `serverTime`
   * is the next cursor (delta-sync convention). Server caps `limit` at 500.
   *
   * Fail-soft: returns `null` on any of HTTP non-2xx, JSON parse failure,
   * unauthenticated state, or network error. NEVER throws — pull-sync must not
   * block plugin load or the foreground catch-up chain. (Template:
   * `getActiveBillingEvents`.)
   */
  async getLinkRelationsUpdatedAfter(
    updatedAfter: string | null,
    limit = 200,
  ): Promise<RelationPullResponse | null> {
    if (!this.config.endpoint) {
      return null;
    }
    if (!this.config.authToken) {
      return null;
    }

    const queryParams = new URLSearchParams();
    if (updatedAfter) queryParams.set('updatedAfter', updatedAfter);
    queryParams.set('limit', String(limit));
    const query = queryParams.toString();
    const url = `${this.config.endpoint}/api/user/archive-link-relations${query ? `?${query}` : ''}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client': 'obsidian-plugin',
      'X-Client-Version': this.config.pluginVersion || '0.0.0',
      'X-Platform': this.getPlatformIdentifier(),
      Authorization: `Bearer ${this.config.authToken}`,
    };
    if (this.config.clientId) {
      headers['X-Client-Id'] = this.config.clientId;
    }

    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers,
        throw: false,
      });

      if (response.status < 200 || response.status >= 300) {
        return null;
      }

      const body = response.json as
        | { success?: boolean; data?: Partial<RelationPullResponse> }
        | undefined;
      if (!body || body.success !== true || !body.data) {
        return null;
      }

      const relations = Array.isArray(body.data.relations) ? body.data.relations : [];
      const serverTime = typeof body.data.serverTime === 'string' ? body.data.serverTime : '';
      return { relations, serverTime };
    } catch (err) {
      console.warn('[WorkersAPIClient] getLinkRelationsUpdatedAfter failed:', err);
      return null;
    }
  }

  /**
   * Update archive actions (highlights, notes, like, bookmark, etc.)
   *
   * PATCH /api/user/archives/:archiveId
   * Server broadcasts `action_updated` WebSocket event with `hasAnnotationUpdate: true`
   * when userHighlights or userNotes are modified, enabling mobile app sync.
   */
  async updateArchiveActions(
    archiveId: string,
    updates: {
      isLiked?: boolean;
      isBookmarked?: boolean;
      shareUrl?: string | null;
      aiComments?: AICommentPayload[];
      clearAIComments?: boolean;
      clearTranscription?: boolean;
      userNotes?: UserNote[];
      userHighlights?: TextHighlight[];
    },
  ): Promise<{ success: boolean }> {
    this.ensureInitialized();

    // Extra headers for annotation updates (echo suppression on server side)
    const extraHeaders: Record<string, string> = {};
    if (this.config.clientId) {
      extraHeaders['X-Client-Id'] = this.config.clientId;
    }

    await this.request<{ success: boolean }>(`/api/user/archives/${encodeURIComponent(archiveId)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      headers: extraHeaders,
    });

    return { success: true };
  }

  /**
   * Bulk update archive actions (isLiked / isBookmarked) for multiple archives.
   *
   * PATCH /api/user/archives/bulk-actions
   *
   * Uses the same X-Client-Id header as the single-item endpoint for echo
   * suppression. Server returns per-item success/failure results.
   *
   * @param actions - Array of archive action updates (max 200 per request)
   * @returns Updated IDs and per-item failures
   */
  async bulkUpdateArchiveActions(
    actions: Array<{
      archiveId: string;
      isLiked?: boolean;
      isBookmarked?: boolean;
    }>,
  ): Promise<{
    updatedIds: string[];
    failed: Array<{ archiveId: string; code: string; message: string }>;
  }> {
    this.ensureInitialized();

    const extraHeaders: Record<string, string> = {};
    if (this.config.clientId) {
      extraHeaders['X-Client-Id'] = this.config.clientId;
    }

    return await this.request<{
      updatedIds: string[];
      failed: Array<{ archiveId: string; code: string; message: string }>;
    }>('/api/user/archives/bulk-actions', {
      method: 'PATCH',
      body: JSON.stringify({ actions }),
      headers: extraHeaders,
    });
  }

  /**
   * Delete an archive by ID
   *
   * DELETE /api/user/archives/:archiveId
   *
   * @param archiveId - The archive ID to delete
   * @returns Success status
   */
  async deleteArchive(archiveId: string): Promise<{ success: boolean }> {
    this.ensureInitialized();

    const extraHeaders: Record<string, string> = {};
    if (this.config.clientId) {
      extraHeaders['X-Client-Id'] = this.config.clientId;
    }

    return this.request<{ success: boolean }>(`/api/user/archives/${archiveId}`, {
      method: 'DELETE',
      headers: extraHeaders,
    });
  }

  async setArchivePlace(archiveId: string, targetArchiveId: string | null): Promise<void> {
    this.ensureInitialized();
    const extraHeaders: Record<string, string> = {};
    if (this.config.clientId) extraHeaders['X-Client-Id'] = this.config.clientId;
    await this.request(`/api/user/archives/${encodeURIComponent(archiveId)}/place`, {
      method: 'PUT',
      headers: extraHeaders,
      body: JSON.stringify({ targetArchiveId }),
    });
  }

  async searchProviderPlaces(queryValue: string): Promise<ProviderSearchResponse> {
    this.ensureInitialized();
    const query = queryValue.trim();
    const response = await this.request<unknown>('/api/user/places/provider-search', {
      method: 'POST',
      body: JSON.stringify({ provider: 'kakaomap', query, page: 1, size: 15 }),
    });
    const parsed = ProviderSearchResponseSchema.safeParse(response);
    if (!parsed.success) throw new InvalidPlaceApiResponseError('search');
    return parsed.data;
  }

  async selectProviderPlace(
    archiveId: string,
    selectionToken: string,
    idempotencyKey: string,
  ): Promise<ProviderPlaceSelectionResponse> {
    this.ensureInitialized();
    const response = await this.request<unknown>(
      `/api/user/archives/${encodeURIComponent(archiveId)}/place-from-provider`,
      {
        method: 'POST',
        body: JSON.stringify({ selectionToken, idempotencyKey }),
      },
    );
    const parsed = ProviderPlaceSelectionResponseSchema.safeParse(response);
    if (!parsed.success) throw new InvalidPlaceApiResponseError('selection');
    return parsed.data;
  }

  /**
   * Get a one-time WebSocket ticket for private channel authentication.
   * The ticket is valid for 60 seconds and consumed on first WS connection.
   */
  async getWsTicket(): Promise<{ ticket: string; expiresAt: string }> {
    this.ensureInitialized();

    return await this.request<{ ticket: string; expiresAt: string }>('/api/user/ws-ticket', {
      method: 'POST',
      body: JSON.stringify({ clientId: this.config.clientId }),
    });
  }

  async refreshSyncClientCapability(
    clientId: string,
    capability: AICommentExecutorCapabilityPayload | null,
    runtime: 'desktop' | 'mobile' | 'unknown',
  ): Promise<{ client: SyncClient }> {
    return this.refreshSyncClientCapabilities(
      clientId,
      capability ? { aiCommentExecutor: capability } : {},
      runtime,
    );
  }

  async refreshSyncClientCapabilities(
    clientId: string,
    capabilities: SyncClientCapabilityRefresh,
    runtime: 'desktop' | 'mobile' | 'unknown',
  ): Promise<{ client: SyncClient }> {
    this.ensureInitialized();
    return this.request<{ client: SyncClient }>(`/api/sync/clients/${clientId}/capability/refresh`, {
      method: 'POST',
      body: JSON.stringify({
        runtime,
        capabilities,
      }),
    });
  }

  async getAvailableAICommentJobs(targetClientId: string): Promise<{ jobs: AICommentExecutorJob[] }> {
    this.ensureInitialized();
    return this.request<{ jobs: AICommentExecutorJob[] }>(
      `/api/ai-comments/jobs?targetClientId=${encodeURIComponent(targetClientId)}&state=available`,
      { method: 'GET' },
    );
  }

  async getAICommentJob(jobId: string): Promise<{ job: AICommentExecutorJob }> {
    this.ensureInitialized();
    return this.request<{ job: AICommentExecutorJob }>(`/api/ai-comments/jobs/${jobId}`, {
      method: 'GET',
    });
  }

  async claimAICommentJob(
    jobId: string,
    request: {
      clientId: string;
      capabilityStatus: string;
      provider: AICommentProviderId;
    },
  ): Promise<AICommentClaimResponse> {
    this.ensureInitialized();
    return this.request<AICommentClaimResponse>(`/api/ai-comments/jobs/${jobId}/claim`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async updateAICommentJobProgress(
    jobId: string,
    request: {
      clientId: string;
      lockToken: string;
      lockTokenVersion: number;
      status: AICommentJobStatus;
      progressPercentage?: number;
      progressMessage?: string;
    },
  ): Promise<AICommentLeaseResponse> {
    this.ensureInitialized();
    return this.request<AICommentLeaseResponse>(`/api/ai-comments/jobs/${jobId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });
  }

  async uploadAICommentJobResult(
    jobId: string,
    request: {
      clientId: string;
      lockToken: string;
      lockTokenVersion: number;
      comment: {
        meta: Record<string, unknown>;
        content: string;
      };
    },
  ): Promise<{ job: AICommentJobSummary; comment: unknown }> {
    this.ensureInitialized();
    return this.request<{ job: AICommentJobSummary; comment: unknown }>(`/api/ai-comments/jobs/${jobId}/result`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async failAICommentJob(
    jobId: string,
    request: {
      clientId: string;
      lockToken?: string;
      lockTokenVersion?: number;
      errorCode: string;
      retryable: boolean;
    },
  ): Promise<{ job: AICommentJobSummary }> {
    this.ensureInitialized();
    return this.request<{ job: AICommentJobSummary }>(`/api/ai-comments/jobs/${jobId}/fail`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async cancelAICommentJob(
    jobId: string,
    request: {
      clientId: string;
      reason?: string;
      confirm?: boolean;
      lockToken?: string;
      lockTokenVersion?: number;
    },
  ): Promise<{ job: AICommentJobSummary }> {
    this.ensureInitialized();
    return this.request<{ job: AICommentJobSummary }>(`/api/ai-comments/jobs/${jobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getAvailableAIActionJobs(targetClientId: string): Promise<{ jobs: AIActionExecutorJob[] }> {
    this.ensureInitialized();
    return this.request<{ jobs: AIActionExecutorJob[] }>(
      `/api/ai-actions/jobs?targetClientId=${encodeURIComponent(targetClientId)}&state=available`,
      {
        method: 'GET',
        headers: { 'X-Client-Capabilities': 'ai-actions-v1,tag-patch-v1,content-variants-v1,content-translate-v1' },
      },
    );
  }

  async getAIActionAvailability(archiveId: string, actionType: AIActionType): Promise<AIActionAvailability> {
    this.ensureInitialized();
    const params = new URLSearchParams({ archiveId, actionType });
    return this.request<AIActionAvailability>(`/api/ai-actions/jobs/availability?${params.toString()}`, {
      method: 'GET',
    });
  }

  async createAIActionJob(request: CreateAIActionJobRequest): Promise<CreateAIActionJobResponse> {
    this.ensureInitialized();
    const sourceClientId = request.sourceClientId ?? this.config.clientId;
    const idempotencyKey = `ai-action:${request.archiveId}:${request.actionType}:${sourceClientId ?? 'obsidian'}:${crypto.randomUUID()}`;
    return this.request<CreateAIActionJobResponse>('/api/ai-actions/jobs', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        ...(sourceClientId ? { 'X-Client-Id': sourceClientId } : {}),
      },
      body: JSON.stringify({
        ...request,
        ...(sourceClientId ? { sourceClientId } : {}),
      }),
    });
  }

  async getAIActionJob(jobId: string): Promise<{ job: AIActionJobSummary | AIActionExecutorJob }> {
    this.ensureInitialized();
    return this.request<{ job: AIActionJobSummary | AIActionExecutorJob }>(`/api/ai-actions/jobs/${jobId}`, {
      method: 'GET',
    });
  }

  async claimAIActionJob(
    jobId: string,
    request: {
      clientId: string;
    },
  ): Promise<AIActionClaimResponse> {
    this.ensureInitialized();
    return this.request<AIActionClaimResponse>(`/api/ai-actions/jobs/${jobId}/claim`, {
      method: 'POST',
      headers: { 'X-Client-Capabilities': 'ai-actions-v1,tag-patch-v1,content-variants-v1,content-translate-v1' },
      body: JSON.stringify(request),
    });
  }

  async updateAIActionJobProgress(
    jobId: string,
    request: {
      clientId: string;
      lockToken: string;
      lockTokenVersion: number;
      status: AICommentJobStatus;
      progress?: number;
      progressPercentage?: number;
      progressMessage?: string;
    },
  ): Promise<AIActionLeaseResponse> {
    this.ensureInitialized();
    return this.request<AIActionLeaseResponse>(`/api/ai-actions/jobs/${jobId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });
  }

  async uploadAIActionJobResult(
    jobId: string,
    request: {
      clientId: string;
      lockToken: string;
      lockTokenVersion: number;
      result: Record<string, unknown>;
    },
  ): Promise<{ job: AIActionJobSummary; resultRefId?: string; comment?: unknown }> {
    this.ensureInitialized();
    return this.request<{ job: AIActionJobSummary; resultRefId?: string; comment?: unknown }>(`/api/ai-actions/jobs/${jobId}/result`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async failAIActionJob(
    jobId: string,
    request: {
      clientId: string;
      lockToken?: string;
      lockTokenVersion?: number;
      errorCode: string;
      retryable: boolean;
    },
  ): Promise<{ job: AIActionJobSummary }> {
    this.ensureInitialized();
    return this.request<{ job: AIActionJobSummary }>(`/api/ai-actions/jobs/${jobId}/fail`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getArchiveContentVariants(archiveId: string): Promise<{ variants: ContentVariant[]; activeContentVariantId?: string | null }> {
    this.ensureInitialized();
    return this.request<{ variants: ContentVariant[]; activeContentVariantId?: string | null }>(
      `/api/user/archives/${encodeURIComponent(archiveId)}/content-variants`,
      { method: 'GET' },
    );
  }

  async patchArchiveContentVariant(
    archiveId: string,
    variantId: string,
    patch: { action?: 'set_default' | 'clear_default' | 'hide' | 'unhide' | 'mark_stale'; active?: boolean; visibility?: string },
  ): Promise<{ variant?: ContentVariant; activeContentVariantId?: string | null }> {
    this.ensureInitialized();
    return this.request<{ variant?: ContentVariant; activeContentVariantId?: string | null }>(
      `/api/user/archives/${encodeURIComponent(archiveId)}/content-variants/${encodeURIComponent(variantId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    );
  }

  async deleteArchiveContentVariant(
    archiveId: string,
    variantId: string,
  ): Promise<{ variantId: string; activeContentVariantId?: string | null; deletedAt?: string }> {
    this.ensureInitialized();
    return this.request<{ variantId: string; activeContentVariantId?: string | null; deletedAt?: string }>(
      `/api/user/archives/${encodeURIComponent(archiveId)}/content-variants/${encodeURIComponent(variantId)}`,
      { method: 'DELETE' },
    );
  }

  async getTranscriptionAvailabilityBatch(request: {
    refs: Array<{ archiveId: string; mediaRef: TranscriptionMediaRef }>;
    requestedModel?: string;
    language?: string;
    mode?: TranscriptionJobMode;
  }): Promise<{ entries: TranscriptionAvailabilityEntry[] }> {
    this.ensureInitialized();
    return this.request<{ entries: TranscriptionAvailabilityEntry[] }>('/api/transcription/availability/batch', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async createTranscriptionJob(request: {
    archiveId: string;
    mediaRef: TranscriptionMediaRef;
    mode: TranscriptionJobMode;
    requestedModel?: string;
    language?: string;
    idempotencyKey: string;
    availabilityToken?: string;
    sourceClientId?: string;
  }): Promise<CreateTranscriptionJobResponse> {
    this.ensureInitialized();
    return this.request<CreateTranscriptionJobResponse>('/api/transcription/jobs', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: {
        'Idempotency-Key': request.idempotencyKey,
      },
    });
  }

  async getAvailableTranscriptionJobs(): Promise<{ jobs: TranscriptionExecutorJob[] }> {
    this.ensureInitialized();
    return this.request<{ jobs: TranscriptionExecutorJob[] }>('/api/transcription/jobs?state=available', {
      method: 'GET',
    });
  }

  async getTranscriptionJob(jobId: string): Promise<{ job: TranscriptionExecutorJob | TranscriptionActiveJobSummary }> {
    this.ensureInitialized();
    return this.request<{ job: TranscriptionExecutorJob | TranscriptionActiveJobSummary }>(
      `/api/transcription/jobs/${encodeURIComponent(jobId)}`,
      { method: 'GET' },
    );
  }

  async claimTranscriptionJob(
    jobId: string,
    request: {
      clientId: string;
      capabilityHash?: string;
    },
  ): Promise<TranscriptionClaimResponse> {
    this.ensureInitialized();
    return this.request<TranscriptionClaimResponse>(`/api/transcription/jobs/${encodeURIComponent(jobId)}/claim`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async updateTranscriptionJobProgress(
    jobId: string,
    request: {
      clientId: string;
      lockToken: string;
      lockTokenVersion: number;
      status: TranscriptionJobStatus;
      progressPercentage?: number;
      progressCode?: string;
    },
  ): Promise<TranscriptionLeaseResponse> {
    this.ensureInitialized();
    return this.request<TranscriptionLeaseResponse>(`/api/transcription/jobs/${encodeURIComponent(jobId)}/progress`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async uploadTranscriptionJobResult(
    jobId: string,
    request: {
      clientId: string;
      lockToken: string;
      lockTokenVersion: number;
      transcript: {
        segments: Array<{ start: number; end?: number; text: string; speaker?: string }>;
        rawText: string;
        language: string;
        duration?: number;
        model: string;
        hasWordTimestamps?: boolean;
      };
      localWrite: {
        markdownUpdated: boolean;
        frontmatterUpdated: boolean;
        resultMarkerId: string;
      };
      processing: {
        startedAt: string;
        completedAt: string;
        processingTimeMs: number;
      };
    },
  ): Promise<{ job: TranscriptionActiveJobSummary; transcriptResultId: string }> {
    this.ensureInitialized();
    return this.request<{ job: TranscriptionActiveJobSummary; transcriptResultId: string }>(
      `/api/transcription/jobs/${encodeURIComponent(jobId)}/result`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
    );
  }

  async uploadTranscriptionDownloadResult(
    jobId: string,
    request: {
      clientId: string;
      lockToken: string;
      lockTokenVersion: number;
      localWrite: {
        markdownUpdated: boolean;
        frontmatterUpdated: boolean;
        localMediaPath?: string;
      };
      processing: {
        startedAt: string;
        completedAt: string;
        processingTimeMs: number;
      };
    },
  ): Promise<{ job: TranscriptionActiveJobSummary }> {
    this.ensureInitialized();
    return this.request<{ job: TranscriptionActiveJobSummary }>(
      `/api/transcription/jobs/${encodeURIComponent(jobId)}/download-result`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
    );
  }

  async failTranscriptionJob(
    jobId: string,
    request: {
      clientId: string;
      lockToken?: string;
      lockTokenVersion?: number;
      errorCode: TranscriptionPublicErrorCode;
      retryable: boolean;
    },
  ): Promise<{ job: TranscriptionActiveJobSummary }> {
    this.ensureInitialized();
    return this.request<{ job: TranscriptionActiveJobSummary }>(
      `/api/transcription/jobs/${encodeURIComponent(jobId)}/fail`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
    );
  }

  async cancelTranscriptionJob(
    jobId: string,
    request: {
      clientId: string;
      reason?: string;
    },
  ): Promise<{ job: TranscriptionActiveJobSummary }> {
    this.ensureInitialized();
    return this.request<{ job: TranscriptionActiveJobSummary }>(
      `/api/transcription/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
    );
  }

  async confirmTranscriptionJobCancel(
    jobId: string,
    request: {
      clientId: string;
      lockToken: string;
      lockTokenVersion: number;
    },
  ): Promise<{ job: TranscriptionActiveJobSummary }> {
    this.ensureInitialized();
    return this.request<{ job: TranscriptionActiveJobSummary }>(
      `/api/transcription/jobs/${encodeURIComponent(jobId)}/cancel/confirm`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
    );
  }

  // ============================================================================
  // User Tags API
  // ============================================================================

  /**
   * Get all user tags (with delta sync support)
   *
   * GET /api/user/tags
   *
   * @returns Tags list, deleted IDs, and server time
   */
  async getUserTags(): Promise<UserTagsResponse> {
    this.ensureInitialized();

    return await this.request<UserTagsResponse>('/api/user/tags', {
      method: 'GET',
    });
  }

  /**
   * Upsert tag entities on the server (create or update)
   *
   * POST /api/user/tags
   *
   * @param tags - Tag upsert inputs (id, name, color, sortOrder)
   * @param clientId - Source client ID for echo suppression (sent as X-Client-Id header)
   * @returns Upserted count and server time
   */
  async upsertTags(tags: TagUpsertInput[], clientId: string): Promise<UpsertTagsResult> {
    this.ensureInitialized();

    const extraHeaders: Record<string, string> = {};
    if (clientId) {
      extraHeaders['X-Client-Id'] = clientId;
    }

    return await this.request<UpsertTagsResult>('/api/user/tags', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ tags }),
    });
  }

  /**
   * Upsert archive-tag mappings on the server
   *
   * POST /api/user/archive-tags
   *
   * @param mappings - Archive-tag mapping inputs (archiveId, tagId)
   * @param clientId - Source client ID for echo suppression (sent as X-Client-Id header)
   * @returns Upserted count and server time
   */
  async upsertArchiveTags(mappings: ArchiveTagMappingInput[], clientId: string): Promise<UpsertArchiveTagsResult> {
    this.ensureInitialized();

    const extraHeaders: Record<string, string> = {};
    if (clientId) {
      extraHeaders['X-Client-Id'] = clientId;
    }

    return await this.request<UpsertArchiveTagsResult>('/api/user/archive-tags', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ mappings }),
    });
  }

  /**
   * Get editable author profiles stored on the server.
   */
  async getUserAuthorProfiles(
    params: {
      updatedAfter?: string;
      authorKey?: string;
    } = {},
  ): Promise<UserAuthorProfilesResponse> {
    this.ensureInitialized();

    const query = new URLSearchParams();
    if (params.updatedAfter) query.set('updatedAfter', params.updatedAfter);
    if (params.authorKey) query.set('authorKey', params.authorKey);

    const suffix = query.toString();
    return await this.request<UserAuthorProfilesResponse>(`/api/user/author-profiles${suffix ? `?${suffix}` : ''}`, { method: 'GET' });
  }

  /**
   * Upsert editable author profiles on the server.
   */
  async upsertUserAuthorProfiles(profiles: AuthorProfileUpsertInput[], clientId: string): Promise<UpsertAuthorProfilesResult> {
    this.ensureInitialized();

    const extraHeaders: Record<string, string> = {};
    if (clientId) {
      extraHeaders['X-Client-Id'] = clientId;
    }

    return await this.request<UpsertAuthorProfilesResult>('/api/user/author-profiles', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ profiles }),
    });
  }

  /**
   * Upsert system-fetched author profile metadata on the server.
   */
  async upsertUserAuthorProfilesSystem(profiles: AuthorProfileSystemUpsertInput[], clientId: string): Promise<UpsertAuthorProfilesResult> {
    this.ensureInitialized();

    const extraHeaders: Record<string, string> = {};
    if (clientId) {
      extraHeaders['X-Client-Id'] = clientId;
    }

    return await this.request<UpsertAuthorProfilesResult>('/api/user/author-profiles/system', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ profiles }),
    });
  }

  /**
   * Delete archive-tag mappings in bulk (soft delete)
   *
   * DELETE /api/user/archive-tags
   *
   * @param pairs - Archive-tag pairs to delete (archiveId, tagId)
   * @param clientId - Source client ID for echo suppression (sent as X-Client-Id header)
   * @returns Deleted count
   */
  async deleteArchiveTags(pairs: ArchiveTagMappingInput[], clientId: string): Promise<{ deleted: number }> {
    this.ensureInitialized();

    const extraHeaders: Record<string, string> = {};
    if (clientId) {
      extraHeaders['X-Client-Id'] = clientId;
    }

    return await this.request<{ deleted: number }>('/api/user/archive-tags', {
      method: 'DELETE',
      headers: extraHeaders,
      body: JSON.stringify({ pairs }),
    });
  }

  // ============================================================================
  // Composed Post API
  // ============================================================================

  /**
   * Upload a media file for a composed post.
   *
   * POST /api/user/posts/media
   */
  async uploadComposedMedia(
    clientPostId: string,
    file: ArrayBuffer,
    filename: string,
    contentType: string,
    index: number,
  ): Promise<ComposedMediaUploadResult> {
    this.ensureInitialized();

    const base64 = this.arrayBufferToBase64(file);
    const extraHeaders: Record<string, string> = {};
    if (this.config.clientId) {
      extraHeaders['X-Client-Id'] = this.config.clientId;
    }

    return await this.request<ComposedMediaUploadResult>('/api/user/posts/media', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({
        clientPostId,
        filename,
        contentType,
        index,
        data: base64,
      }),
    });
  }

  /**
   * Create a composed post on the server.
   *
   * POST /api/user/posts
   */
  async createComposedPost(request: CreateComposedPostRequest): Promise<{ archiveId: string; createdAt: string }> {
    this.ensureInitialized();

    const extraHeaders: Record<string, string> = {};
    if (this.config.clientId) {
      extraHeaders['X-Client-Id'] = this.config.clientId;
    }

    return await this.request<{ archiveId: string; createdAt: string }>('/api/user/posts', {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify(request),
    });
  }

  /**
   * Update a composed post on the server.
   *
   * PUT /api/user/posts/:archiveId
   */
  async updateComposedPost(archiveId: string, request: UpdateComposedPostRequest): Promise<{ success: boolean; updatedAt: string }> {
    this.ensureInitialized();

    const extraHeaders: Record<string, string> = {};
    if (this.config.clientId) {
      extraHeaders['X-Client-Id'] = this.config.clientId;
    }

    return await this.request<{ success: boolean; updatedAt: string }>(`/api/user/posts/${encodeURIComponent(archiveId)}`, {
      method: 'PUT',
      headers: extraHeaders,
      body: JSON.stringify(request),
    });
  }

  // ============================================================================
  // Media Re-preserve
  // ============================================================================

  /**
   * Request the server to re-preserve media for an archive.
   *
   * Fire-and-forget — callers should not depend on the result for the
   * main re-download flow.  The server will re-fetch & store media in R2.
   */
  async represerveMedia(archiveId: string, reason: string = 'client_redownload_command'): Promise<{ success: boolean; error?: string }> {
    try {
      this.ensureInitialized();

      return await this.request<{ success: boolean; error?: string }>(
        `/api/user/archives/${encodeURIComponent(archiveId)}/represerve-media`,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        },
      );
    } catch (error) {
      console.error(`[WorkersAPIClient] represerveMedia failed for ${archiveId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i] ?? 0);
    }
    return btoa(binary);
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
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}
