/**
 * Shared type contract for the Instagram Saved Posts import flow (Phase 2, Obsidian plugin).
 *
 * These types are consumed by:
 *   - `src/services/import/*` (engine — this module)
 *   - `src/ui/import/*`       (modal/view, owned by the UI agent)
 *   - `src/main.ts`           (command palette + ribbon wiring)
 *
 * See PRD `.taskmaster/docs/prd-instagram-saved-import.md` §5.3, §6, §7, §10 for semantics.
 */

import type { PostData, Platform } from './post';

// ============================================================================
// Manifest / export package types (match chrome-extension ZIP contract, PRD §7)
// ============================================================================

/**
 * Collection scope recorded in manifest.json (PRD §7.3).
 * - `named` — real Instagram collection the user created
 * - `all_saved_posts` — synthetic scope used when no collections exist or
 *   collection discovery failed (PRD §6.7.1)
 */
export type ImportCollectionScope = {
  id: string;
  name: string;
  scope: 'named' | 'all_saved_posts';
};

/**
 * Per-part counts block from manifest.json (PRD §7.3).
 * Every field is required — the exporter always stamps them.
 */
export type ImportManifestCounts = {
  postsInPart: number;
  postsInExport: number;
  readyToImport: number;
  partialMedia: number;
  failedPosts: number;
  mediaDownloaded: number;
  mediaFailed: number;
};

/**
 * Parsed manifest.json for one ZIP part (schema v2).
 *
 * The validator (`ImportManifestValidator`) asserts:
 *   - schemaVersion === 2
 *   - exportId is a non-empty string
 *   - partNumber >= 1, totalParts >= partNumber
 *   - platform === 'instagram', source === 'saved-posts'
 *   - counts object is fully populated with non-negative integers
 */
export type ImportManifest = {
  $schema: string;
  schemaVersion: 2;
  exportId: string;
  partNumber: number;
  totalParts: number;
  exportedAt: string;
  platform: 'instagram';
  source: 'saved-posts';
  instagramUserId: string;
  instagramUsername: string;
  collection: ImportCollectionScope;
  app: { name: string; version: string };
  filters: {
    collectionIds: string[];
    dateFrom: string | null;
    dateTo: string | null;
  };
  counts: ImportManifestCounts;
  integrity: {
    algorithm: 'sha256';
    checksumsFile: string;
  };
};

/**
 * Summary of a single ZIP part exposed to the UI (PRD §5.3 pre-flight).
 * Produced by {@link ImportOrchestrator.preflight}.
 */
export type ImportPartSummary = {
  /** Original .zip filename (for display + user warnings about moving files). */
  filename: string;
  exportId: string;
  partNumber: number;
  totalParts: number;
  collection: ImportCollectionScope;
  counts: {
    postsInPart: number;
    postsInExport: number;
    readyToImport: number;
    partialMedia: number;
    failedPosts: number;
  };
  /**
   * True when `_checksums.txt` matched every computed sha256 for this part.
   * False values are advisory — the UI should warn but not block the import.
   */
  integrityOk: boolean;
  /** Any validator/checksum warnings the UI may surface. */
  warnings: string[];
  /**
   * Per-post preview payload — populated only when the gallery is
   * requested (via `orchestrator.loadGallery()`), not on plain preflight.
   *
   * PRD: prd-instagram-import-gallery.md §8.4
   */
  posts?: ImportPostPreview[];
};

/**
 * Aggregated pre-flight result for the user's entire file selection.
 * Returned by {@link ImportOrchestrator.preflight}.
 */
export type ImportPreflightResult = {
  parts: ImportPartSummary[];
  totalPostsInSelection: number;
  /** Count returned by server-side `POST /api/import/preflight`. */
  duplicateCount: number;
  /** Flat set of duplicate post IDs (for UI diff display). */
  duplicatePostIds: Set<string>;
  readyToImport: number;
  partialMedia: number;
  failedPosts: number;
  /** Per-part validator errors that could not be resolved (fatal to that part). */
  errors: Array<{ filename: string; message: string }>;
};

// ============================================================================
// Job + item state (durable — must survive Obsidian restart, PRD §5.3.1)
// ============================================================================

export type ImportJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Per-item outcome surfaced to the UI (PRD §6.3 partial-failure policy).
 */
export type ImportItemOutcome =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'skipped_duplicate'
  | 'imported_with_warnings'
  | 'failed';

/** Persisted reference to a source ZIP part. */
export type ImportJobSourceFile = {
  /** Original filename (as picked by the user). */
  filename: string;
  /** Best-effort vault-relative path — may be undefined if the user picked via File API. */
  vaultPath?: string;
  /** Bytes, for display. */
  size: number;
  /** Parsed manifest identity for this file. */
  exportId: string;
  partNumber: number;
  totalParts: number;
};

/**
 * Where imported posts should land in the user's timeline.
 * - `inbox`   — visible in the default "Inbox" tab (frontmatter `archive: false`)
 * - `archive` — hidden from Inbox, surfaced only in "Archive"/"All" tabs
 *               (frontmatter `archive: true`)
 *
 * Applied uniformly to every item in a single import job.
 */
export type ImportDestination = 'inbox' | 'archive';

export const DEFAULT_IMPORT_DESTINATION: ImportDestination = 'inbox';

export type ImportJobState = {
  jobId: string;
  status: ImportJobStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  sourceFiles: ImportJobSourceFile[];
  totalItems: number;
  completedItems: number;
  failedItems: number;
  partialMediaItems: number;
  skippedDuplicates: number;
  /** User-adjustable upload pace (items/sec). Default 1. */
  rateLimitPerSec: number;
  /**
   * Job-wide import destination. Persisted so a resumed job keeps the
   * user's original choice when the modal re-attaches after restart.
   */
  destination: ImportDestination;
  /**
   * Job-wide extra YAML tags merged into every imported post's frontmatter.
   * Normalized by the orchestrator (trim, strip leading `#`, de-duplicated
   * case-insensitive).
   */
  tags: string[];
  lastError?: string;
  /** Registered sync client ID for echo suppression (PRD §9.4.1). */
  sourceClientId?: string;
  /**
   * Persisted review-gallery selection for this job. Survives modal close
   * + Obsidian restart while the job is resumable. Dropped immediately on
   * job completion (success or failure) — see PRD F3.6.
   *
   * Absent on jobs created via the `Skip review` path or before the gallery
   * feature shipped (legacy jobs).
   *
   * PRD: prd-instagram-import-gallery.md §9.4, F3.6
   */
  gallerySelection?: GallerySelection;
};

export type ImportItem = {
  jobId: string;
  /** Instagram media.pk (== PostData.id). */
  postId: string;
  /** Instagram shortcode from posts.jsonl. */
  shortcode: string;
  /** Collection this item came from. */
  collectionId: string;
  /** ZIP filename this post's media lives in. */
  partFilename: string;
  status: ImportItemOutcome;
  /** Set once the server returns an archiveId. */
  archiveId?: string;
  /** Number of retries attempted so far. */
  retryCount: number;
  /** Last error message (user-readable). */
  errorMessage?: string;
  /** Unix ms when the item's upload completed. */
  uploadedAt?: number;
  /**
   * Cached relative media paths discovered at pre-flight. The worker streams
   * these from the source ZIP when uploading media.
   */
  mediaPaths?: string[];
};

// ============================================================================
// Events (progress bus contract)
// ============================================================================

export type ImportProgressEvent =
  | { type: 'job.started'; jobId: string }
  | {
      type: 'job.progress';
      jobId: string;
      completedItems: number;
      totalItems: number;
      partialMediaItems: number;
      skippedDuplicates: number;
      failedItems: number;
    }
  | { type: 'job.paused'; jobId: string }
  | { type: 'job.resumed'; jobId: string }
  | { type: 'job.cancelled'; jobId: string }
  | {
      type: 'job.completed';
      jobId: string;
      summary: {
        imported: number;
        importedWithWarnings: number;
        skippedDuplicates: number;
        failed: number;
      };
    }
  | { type: 'job.failed'; jobId: string; error: string }
  | {
      type: 'item.progress';
      jobId: string;
      postId: string;
      status: ImportItemOutcome;
      archiveId?: string;
      errorMessage?: string;
    };

export type ImportProgressSubscriber = (evt: ImportProgressEvent) => void;

// ============================================================================
// Orchestrator façade — consumed by UI + main.ts
// ============================================================================

export type StartImportFile = {
  /** Original filename including `.zip` suffix. */
  name: string;
  /** Source blob; survives the picker call. Must be kept alive by the caller during the import. */
  blob: Blob;
  /** Optional vault-relative path, if the user picked a file already inside the vault. */
  vaultPath?: string;
};

export type StartImportOptions = {
  files: StartImportFile[];
  /** Items/sec budget. Clamped to [0.1, 10]. Default 1. */
  rateLimitPerSec?: number;
  /** Optional sync-client id (echo suppression). */
  sourceClientId?: string;
  /**
   * Where to place imported posts in the timeline.
   * Defaults to {@link DEFAULT_IMPORT_DESTINATION} (`'inbox'`).
   */
  destination?: ImportDestination;
  /**
   * Extra YAML tags to apply to every imported post. Raw user input —
   * the orchestrator normalizes (trim, strip leading `#`, de-dupe).
   */
  tags?: string[];
  /**
   * Subset of posts to actually import. When present, the orchestrator
   * filters per-item seeds before creating any ImportItem. When absent,
   * all ready posts are imported (legacy behavior, preserved for the
   * `Skip review` path).
   *
   * See {@link GallerySelection} for encoding semantics.
   * PRD: prd-instagram-import-gallery.md §9.4
   */
  selection?: GallerySelection;
};

// ============================================================================
// Review Gallery types (PRD: prd-instagram-import-gallery.md §8.4, §9.4)
// ============================================================================

/**
 * Per-post preview payload exposed to the review gallery.
 *
 * Produced by `ZipPostDataAdapter.loadGallery()` once per file selection.
 * `postData.media[].url`, `media[].thumbnail`, and `author.avatar` are
 * lazily rewritten to `blob:` URLs at render time via `MediaPreviewService`
 * — eager rewriting is forbidden because it would defeat lazy loading.
 *
 * PRD: §7.3, §8.4
 */
export type ImportPostPreview = {
  /** Stable post identity (Instagram media.pk == PostData.id). */
  postId: string;
  /** Instagram shortcode (used for display + folder paths). */
  shortcode: string;
  /** Collection scope this post belongs to (for collection filter). */
  collectionId: string;
  /** Source ZIP filename — needed to route media-extract requests. */
  partFilename: string;
  /** Raw PostData parsed from posts.jsonl. URLs may still be ZIP-relative. */
  postData: PostData;
  /** True if server preflight reported this post is already archived. */
  isDuplicate: boolean;
};

/**
 * Persisted gallery selection state. Dual-mode encoding so a 500-post
 * package with 5 deselections does not store 495 ids.
 *
 * - `'all-except'`: every ready post is selected EXCEPT those in `ids`.
 *                    The default state (user opens gallery, hasn't toggled
 *                    anything yet) is `{ mode: 'all-except', ids: new Set() }`.
 * - `'only'`:        only the posts in `ids` are selected. Used after the
 *                    user has explicitly deselected the majority.
 *
 * The store flips mode automatically based on which encoding is smaller.
 * Duplicates are always excluded regardless of mode (filtered at materialize
 * time, not stored in either set).
 *
 * PRD: §9.4
 */
export type GallerySelection = {
  mode: 'all-except' | 'only';
  ids: Set<string>;
};

/**
 * Default-state factory — every ready post is selected (opt-out model).
 * PRD: §5.4
 */
export function createDefaultGallerySelection(): GallerySelection {
  return { mode: 'all-except', ids: new Set() };
}

export interface ImportOrchestrator {
  /** Read + validate ZIP parts, call server preflight, return a summary for the UI. */
  preflight(files: Array<{ name: string; blob: Blob }>): Promise<ImportPreflightResult>;

  /**
   * Extended preflight that ALSO populates per-post previews for the
   * review gallery. Call instead of `preflight()` when the user enters
   * the Review pane. Internally re-uses the same ZIP scan + server
   * dedup join, then attaches `parts[].posts: ImportPostPreview[]`.
   *
   * Does NOT create archives, notes, or any persistent state.
   *
   * PRD: prd-instagram-import-gallery.md §9.6, F1.1, F1.2
   */
  loadGallery(files: Array<{ name: string; blob: Blob }>): Promise<ImportPreflightResult>;

  /** Create the job and start the worker. Resolves as soon as state is persisted. */
  startImport(opts: StartImportOptions): Promise<{ jobId: string }>;

  pause(jobId: string): Promise<void>;
  resume(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<void>;

  getJob(jobId: string): Promise<ImportJobState | null>;
  getItems(jobId: string): Promise<ImportItem[]>;
  listActiveJobs(): Promise<ImportJobState[]>;

  /** Subscribe to progress events. Returns an unsubscribe handle. */
  onEvent(cb: ImportProgressSubscriber): () => void;
}

// ============================================================================
// API client contract (what the import core needs from Workers)
// ============================================================================

/**
 * Client-facing wrapper for the new import endpoints defined by Agent D in PRD §10.
 * Kept narrow so the core can be unit-tested against a fake.
 */
export interface ImportAPIClient {
  /** `POST /api/import/preflight` (PRD §10.2). Max 1000 items per call — caller batches. */
  preflight(
    items: Array<{ platform: Platform; postId: string }>,
  ): Promise<{ duplicates: string[]; accepted: number }>;

  /**
   * `POST /api/archive` with `clientPostData` + `importContext` (PRD §10.1).
   * Returns the final archiveId synchronously (import path skips upstream fetching).
   */
  createArchiveFromImport(args: {
    url: string;
    clientPostData: PostData;
    importContext: {
      source: 'instagram-saved-import';
      jobId: string;
      exportId: string;
      partNumber: number;
    };
    sourceClientId?: string;
  }): Promise<{ archiveId: string; skippedDuplicate: boolean }>;

  /**
   * `POST /api/archive/:archiveId/media` (PRD §10.3). Multipart upload of
   * media files streamed from the local ZIP. Batches are caller-chosen.
   */
  uploadArchiveMedia(args: {
    archiveId: string;
    files: Array<{
      filename: string;
      relativePath: string;
      contentType: string;
      data: ArrayBuffer;
    }>;
  }): Promise<{ uploaded: number; failed: Array<{ relativePath: string; reason: string }> }>;

  /**
   * `POST /api/import/jobs/:jobId/finalize` (PRD §10.4). Tells the server the
   * batch is complete so it can emit a single coalesced sync event. The
   * optional `sourceClientId` is forwarded to the batch broadcast so the
   * originating client is excluded from its own echo (PRD §11.1).
   */
  finalizeImportJob(args: {
    jobId: string;
    archiveIds: string[];
    totalCount: number;
    partialMediaCount: number;
    failedCount: number;
    sourceClientId?: string;
  }): Promise<void>;
}

// ============================================================================
// Logger contract (matches what the existing plugin's Logger provides)
// ============================================================================

export interface ImportLogger {
  info: (m: string, extra?: unknown) => void;
  warn: (m: string, extra?: unknown) => void;
  error: (m: string, e?: unknown) => void;
}

// ============================================================================
// Constants shared across modules
// ============================================================================

/** Schema version this importer accepts (PRD §7.3). */
export const SUPPORTED_MANIFEST_SCHEMA_VERSION = 2 as const;

/** Default upload rate (items/sec) if the UI does not override. */
export const DEFAULT_IMPORT_RATE_PER_SEC = 1;

/** Max retries per item before it flips to `failed` (PRD §6.2). */
export const MAX_ITEM_RETRIES = 3;

/** Max items per single `/api/import/preflight` batch (PRD §10.2). */
export const PREFLIGHT_BATCH_SIZE = 1000;

/** Max files per single `/api/archive/:archiveId/media` request (keeps batches ≤ ~50MB). */
export const MEDIA_UPLOAD_BATCH_SIZE = 20;

/** Cap each media upload batch at this byte total. */
export const MEDIA_UPLOAD_BATCH_BYTE_CAP = 50 * 1024 * 1024;

/** Retention (days) for completed jobs in the local job store. */
export const COMPLETED_JOB_RETENTION_DAYS = 30;

/** Retention (days) for failed jobs in the local job store. */
export const FAILED_JOB_RETENTION_DAYS = 90;
