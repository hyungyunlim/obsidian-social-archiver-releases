/**
 * LocalArchiveImportService — graduate local-only vault notes into the
 * account via the import-jobs pipeline (prd-plugin-anonymous-local-mode.md
 * S4/S6, Phase B).
 *
 * Single Responsibility: orchestration of one import run — note → PostData
 * reconstruction, `localpath:` media sentinel rewrite, batched submission,
 * media upload from vault bytes, frontmatter backfill, finalize, and the
 * durable run summary. Scanning lives in LocalArchiveScanner; HTTP lives in
 * ImportAPIClientAdapter; the UI lives in ImportLocalArchivesModal.
 *
 * Flow per run (single path, server is authoritative for quota and dedup):
 *   prepare → start session → submit batches ≤ 100 → per created item:
 *   upload media ≤ 20 files/request → backfill frontmatter immediately
 *   (crash-safe resume, S4.6) → finalize → persist LocalImportLastResult.
 *   (No preflight round-trip: the items endpoint is the authoritative dedup
 *   and its `skippedDuplicates` carries the archiveId needed for backfill.)
 *
 * Stop conditions (S6):
 *   - per-item `PAYWALL_REQUIRED` → quota exhausted → stop submitting,
 *     finalize what succeeded, `stopReason: 'quota'`.
 *   - batch/session error after one retry → `stopReason: 'error'`.
 * Remaining notes stay `'local-only'`; a re-run is idempotent (the items
 * endpoint resolves them as duplicates and the backfill completes then).
 */

import type { App, TFile } from 'obsidian';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';
import type { LocalImportLastResult } from '@/types/settings';
import {
  IMPORT_INGEST_BATCH_SIZE,
  MEDIA_UPLOAD_BATCH_BYTE_CAP,
  MEDIA_UPLOAD_BATCH_SIZE,
  type ImportAPIClient,
  type ImportLogger,
} from '@/types/import';
import { createImportAPIClientAdapter } from '../ImportAPIClientAdapter';
import { PostDataParser } from '@/components/timeline/parsers/PostDataParser';
import { extractPostIdFromUrl } from '@/shared/platforms/detection';
import { isPlatform } from '@/shared/platforms/types';
import {
  IMPORT_MODE_FRONTMATTER_KEY,
  IMPORT_MODE_IMPORTED,
  type LocalOnlyNoteRef,
} from './LocalArchiveScanner';

/** Import source registered in the server allowlist for this flow (PRD S4.3). */
export const LOCAL_IMPORT_SOURCE = 'obsidian-local-import' as const;

/**
 * Frontmatter key mirroring the clip provenance marker written by
 * FrontmatterGenerator (`social_archiver_server_archive_id`). Backfill
 * overwrites its `'none'` placeholder with the real archive id (S4.6).
 */
export const SERVER_ARCHIVE_ID_FRONTMATTER_KEY = 'social_archiver_server_archive_id';

/** Server-side per-file multipart limit — larger files are skipped (S4.5). */
const MEDIA_UPLOAD_MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Server-side per-session daily cap — runs are capped to stay startable. */
const IMPORT_SESSION_MAX_ITEMS = 5000;

/** Server post-id contract for this source (import-finalize.ts). */
const SERVER_POST_ID_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/;

/**
 * PostData fields that exist only for the local client (user state, share
 * state, transcripts, sync bookkeeping). They must never be persisted into
 * the server archive row (D1 rows cap at 1 MiB and these ride into mobile
 * sync payloads).
 */
const CLIENT_LOCAL_POST_FIELDS = [
  'tags',
  'archiveTags',
  'comment',
  'userNotes',
  'linkedArchives',
  'like',
  'archive',
  'share',
  'shareId',
  'shareUrl',
  'shareMode',
  'crossPostId',
  'threadsPostId',
  'threadsPostUrl',
  'mediaSourceUrls',
  'mediaDetached',
  'mediaPromptSuppressed',
  'linkPreviews',
  'aiComments',
  'aiCommentDeclined',
  'raw',
  'transcript',
  'whisperTranscript',
  'multilangTranscript',
  'transcriptionLanguage',
  'transcriptionModel',
  'transcriptionUpdatedAt',
  'transcriptResultId',
  'transcriptionDuration',
  'transcriptionProcessingTime',
  'highlightCount',
  'subscribed',
  'subscriptionId',
  'downloadedUrls',
  'processedUrls',
  'archiveStatus',
  'errorMessage',
  'mediaPreservationStatus',
  'filePath',
  'sourceArchiveId',
] as const satisfies readonly (keyof PostData)[];

export interface LocalImportProgress {
  phase: 'preparing' | 'submitting' | 'uploading-media' | 'finalizing';
  /** Notes handled so far within the current run. */
  processed: number;
  /** Total notes in the run. */
  total: number;
}

export type LocalImportProgressCallback = (progress: LocalImportProgress) => void;

/**
 * API surface this service requires. The batch/session methods are optional
 * on `ImportAPIClient` for legacy fakes; this flow has no per-item fallback
 * path, so they are required here.
 */
export type LocalImportApi = Pick<ImportAPIClient, 'uploadArchiveMedia' | 'finalizeImportJob'> &
  Required<Pick<ImportAPIClient, 'createArchivesFromImportBatch' | 'startImportSession'>>;

/** Narrow parser contract (satisfied by PostDataParser.parseFile). */
export interface LocalImportNoteParser {
  parseFile(file: TFile): Promise<PostData | null>;
}

export interface LocalArchiveImportServiceDeps {
  app: App;
  api: LocalImportApi;
  parser: LocalImportNoteParser;
  logger: ImportLogger;
  /** Sync client id so the server suppresses self-replay of batch events. */
  sourceClientId?: string;
  /** Persist the durable run summary (settings.localImportLastResult). */
  persistResult: (result: LocalImportLastResult) => Promise<void>;
}

/** One note prepared for transport. */
interface PreparedNote {
  file: TFile;
  /** Deep clone with `localpath:` sentinels and local-only markers stripped. */
  clientPostData: PostData;
  /** Response-matching key — mirrors `clientPostData.id`. */
  postId: string;
  /** Vault files to upload, keyed by the unique sentinel filename. */
  uploadFiles: Array<{ filename: string; file: TFile }>;
  /** Media entries that cannot be uploaded (missing from vault / oversized). */
  unresolvedMediaCount: number;
  /** Oldest-archived-first ordering key (S6.2). */
  sortKey: number;
}

export class LocalArchiveImportService {
  // Run-scoped finalize metrics — reset at the top of every run().
  private serverApiCallCount = 0;
  private mediaFileCount = 0;
  private mediaByteCount = 0;

  constructor(private readonly deps: LocalArchiveImportServiceDeps) {}

  /**
   * Wire the service from the live plugin. Throws when the Workers client is
   * not initialized — callers open this flow only behind the auth gate.
   */
  static fromPlugin(plugin: SocialArchiverPlugin): LocalArchiveImportService {
    const adapter = createImportAPIClientAdapter(plugin.workersApiClient);
    if (!adapter.createArchivesFromImportBatch || !adapter.startImportSession) {
      throw new Error('Import API client does not support batch import sessions.');
    }

    const logger: ImportLogger = {
      info: (m, extra) => console.debug('[Social Archiver]', m, extra ?? ''),
      warn: (m, extra) => console.warn('[Social Archiver]', m, extra ?? ''),
      error: (m, e) => console.error('[Social Archiver]', m, e ?? ''),
    };

    return new LocalArchiveImportService({
      app: plugin.app,
      api: adapter as LocalImportApi,
      parser: new PostDataParser(plugin.app.vault, plugin.app),
      logger,
      sourceClientId: plugin.settings.syncClientId || undefined,
      persistResult: async (result) => {
        // Partial save: a full saveSettings() reinitializes every service
        // (api client, orchestrator, sync) — must not happen per run.
        await plugin.saveSettingsPartial(
          { localImportLastResult: result },
          { reinitialize: false, notify: true },
        );
      },
    });
  }

  /**
   * Run one import over the given local-only notes. Always resolves with a
   * LocalImportLastResult (persisted before return); expected failures are
   * encoded in `stopReason`, never thrown.
   */
  async run(
    notes: LocalOnlyNoteRef[],
    onProgress?: LocalImportProgressCallback,
  ): Promise<LocalImportLastResult> {
    this.serverApiCallCount = 0;
    this.mediaFileCount = 0;
    this.mediaByteCount = 0;

    const total = notes.length;
    let imported = 0;
    let duplicates = 0;
    let partialMedia = 0;
    let failed = 0;
    let stopReason: LocalImportLastResult['stopReason'] = 'completed';

    // Server sessions cap at 5000 items/day — keep the run startable; the
    // overflow stays `'local-only'` and lands in `remaining` (re-run later).
    const eligible = notes.slice(0, IMPORT_SESSION_MAX_ITEMS);
    if (eligible.length < notes.length) {
      this.deps.logger.warn(
        `[LocalArchiveImport] run capped at ${IMPORT_SESSION_MAX_ITEMS} of ${notes.length} notes (server session limit)`,
      );
    }

    // --- a. PREPARE: note → PostData → transport item, oldest first. ---
    const prepared: PreparedNote[] = [];
    for (const [i, note] of eligible.entries()) {
      onProgress?.({ phase: 'preparing', processed: i, total });
      const item = await this.prepareNote(note.file);
      if (item) {
        prepared.push(item);
      } else {
        failed += 1;
      }
    }
    prepared.sort(
      (a, b) => a.sortKey - b.sortKey || a.file.path.localeCompare(b.file.path),
    );

    if (prepared.length === 0) {
      return this.finishRun({ total, imported, duplicates, partialMedia, failed, stopReason });
    }

    // --- d. START session. ---
    // crypto.randomUUID is available in Obsidian's Electron renderer and
    // modern mobile webviews.
    const jobId = crypto.randomUUID();
    try {
      await this.withOneRetry(() => {
        this.serverApiCallCount += 1;
        return this.deps.api.startImportSession({
          jobId,
          source: LOCAL_IMPORT_SOURCE,
          sourceClientId: this.deps.sourceClientId,
          selectedCount: prepared.length,
        });
      });
    } catch (err) {
      this.deps.logger.error('[LocalArchiveImport] start session failed', err);
      stopReason = 'error';
      return this.finishRun({ total, imported, duplicates, partialMedia, failed, stopReason });
    }

    // --- e. SUBMIT batches ≤ 100 items. ---
    const archiveIds: string[] = [];
    let processed = 0;

    for (let offset = 0; offset < prepared.length; offset += IMPORT_INGEST_BATCH_SIZE) {
      const chunk = prepared.slice(offset, offset + IMPORT_INGEST_BATCH_SIZE);
      onProgress?.({ phase: 'submitting', processed, total });

      let response: Awaited<ReturnType<LocalImportApi['createArchivesFromImportBatch']>>;
      try {
        response = await this.withOneRetry(() => this.submitBatch(jobId, chunk));
      } catch (err) {
        this.deps.logger.error('[LocalArchiveImport] batch submission failed after retry', err);
        stopReason = 'error';
        break;
      }

      const createdByPostId = new Map(response.created.map((e) => [e.postId, e.archiveId]));
      const skippedByPostId = new Map(
        response.skippedDuplicates.map((e) => [e.postId, e.archiveId]),
      );
      const failedByPostId = new Map(response.failed.map((e) => [e.postId, e]));
      let quotaHit = false;

      for (const item of chunk) {
        processed += 1;

        const failure = failedByPostId.get(item.postId);
        if (failure) {
          if (failure.code === 'PAYWALL_REQUIRED') {
            // Quota exhausted — the note stays local-only and counts toward
            // `remaining`; a later run picks it up (S6.2).
            quotaHit = true;
            continue;
          }
          failed += 1;
          this.deps.logger.warn(
            `[LocalArchiveImport] item failed for ${item.file.path}: ${failure.code}: ${failure.message}`,
          );
          continue;
        }

        const duplicateArchiveId = skippedByPostId.get(item.postId);
        if (duplicateArchiveId) {
          // Already on the server (clipped on another device, S7) — backfill
          // only, no quota consumed.
          await this.backfillFrontmatter(item.file, duplicateArchiveId);
          duplicates += 1;
          continue;
        }

        const archiveId = createdByPostId.get(item.postId);
        if (!archiveId) {
          failed += 1;
          this.deps.logger.warn(
            `[LocalArchiveImport] batch response missing archive result for ${item.file.path}`,
          );
          continue;
        }

        archiveIds.push(archiveId);
        onProgress?.({ phase: 'uploading-media', processed, total });
        const uploadFailures = await this.uploadItemMedia(archiveId, item);
        if (uploadFailures + item.unresolvedMediaCount > 0) {
          // Media failure ≠ item failure — the archive exists with partial
          // media preservation (S6.4).
          partialMedia += 1;
        }
        await this.backfillFrontmatter(item.file, archiveId);
        imported += 1;
      }

      if (quotaHit) {
        stopReason = 'quota';
        break;
      }
    }

    // --- g. FINALIZE: coalesced batch_complete sync event to other clients.
    onProgress?.({ phase: 'finalizing', processed, total });
    try {
      this.serverApiCallCount += 1;
      await this.deps.api.finalizeImportJob({
        jobId,
        // Must match the session row's source — the server rejects a
        // mismatch with IMPORT_SESSION_SOURCE_MISMATCH.
        source: LOCAL_IMPORT_SOURCE,
        archiveIds,
        totalCount: prepared.length,
        partialMediaCount: partialMedia,
        failedCount: failed,
        uploadedItemCount: imported,
        duplicateCount: duplicates,
        mediaFileCount: this.mediaFileCount,
        mediaByteCount: this.mediaByteCount,
        serverApiCallCount: this.serverApiCallCount,
        sourceClientId: this.deps.sourceClientId,
      });
    } catch (err) {
      this.deps.logger.warn(
        '[LocalArchiveImport] finalize call failed (archives were still created)',
        err,
      );
    }

    return this.finishRun({ total, imported, duplicates, partialMedia, failed, stopReason });
  }

  // ---------------------------------------------------------------------------
  // Prepare
  // ---------------------------------------------------------------------------

  /**
   * Reconstruct PostData from the note and rewrite it for transport. Returns
   * null when the note cannot round-trip (parse failure / missing url) —
   * counted as `failed`, never fatal to the run.
   */
  private async prepareNote(file: TFile): Promise<PreparedNote | null> {
    let postData: PostData | null = null;
    try {
      postData = await this.deps.parser.parseFile(file);
    } catch (err) {
      this.deps.logger.warn(`[LocalArchiveImport] parse threw for ${file.path}`, err);
    }
    if (!postData || !postData.url) {
      this.deps.logger.warn(
        `[LocalArchiveImport] note is not importable (unparseable or missing url): ${file.path}`,
      );
      return null;
    }

    // The server validates items[].url with z.string().url() at the batch
    // level — one malformed URL would 400 the whole batch, so reject here.
    try {
      new URL(postData.url);
    } catch {
      this.deps.logger.warn(
        `[LocalArchiveImport] note has an invalid url (${postData.url}): ${file.path}`,
      );
      return null;
    }

    // Deep clone — the transport rewrite must not mutate the parsed PostData
    // (the timeline may hold the same object).
    const clone = structuredClone(postData);

    // Strip client-local fields: the server must never store local-only
    // provenance markers, vault paths, user state, or transcripts.
    delete clone.metadata.socialArchiverImportMode;
    delete clone.metadata.socialArchiverImportSource;
    delete clone.metadata.socialArchiverServerArchiveId;
    for (const key of CLIENT_LOCAL_POST_FIELDS) {
      delete clone[key];
    }

    const sortKey = this.sortKeyFor(file, postData);

    // metadata.timestamp must serialize to a string (an Invalid Date
    // stringifies to null and 400s the whole batch) — repair from the same
    // dates the ordering uses.
    const timestamp = clone.metadata.timestamp;
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
      clone.metadata.timestamp = new Date(sortKey);
    }

    // The transport id must be the platform post id: it is the server's
    // dedup key against URL-archived posts (S7) and must satisfy the server
    // pattern — the parser's `file.basename` id does neither.
    clone.id = deriveTransportPostId(clone.platform, clone.url);

    const { uploadFiles, unresolvedMediaCount } = this.rewriteMediaToSentinels(clone);

    return {
      file,
      clientPostData: clone,
      postId: clone.id,
      uploadFiles,
      unresolvedMediaCount,
      sortKey,
    };
  }

  /** Oldest archived first (S6.2); deterministic fallbacks for older notes. */
  private sortKeyFor(file: TFile, postData: PostData): number {
    const archived = postData.archivedDate?.getTime();
    if (archived !== undefined && Number.isFinite(archived)) return archived;
    const published = postData.publishedDate?.getTime();
    if (published !== undefined && Number.isFinite(published)) return published;
    return file.stat.ctime;
  }

  /**
   * Replace vault-relative media/avatar paths with `localpath:<filename>`
   * sentinels (matched server-side by trailing filename) and collect the
   * corresponding vault files for upload. http(s) URLs pass through.
   *
   * Filenames get a per-item `NN-` prefix so duplicate basenames inside one
   * post cannot collide in the server's sentinel match.
   */
  private rewriteMediaToSentinels(clone: PostData): {
    uploadFiles: Array<{ filename: string; file: TFile }>;
    unresolvedMediaCount: number;
  } {
    const uploadFiles: Array<{ filename: string; file: TFile }> = [];
    let unresolvedMediaCount = 0;
    let seq = 0;

    const toSentinel = (raw: string): string | null => {
      if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith('localpath:')) return null;
      seq += 1;
      const basename = raw.split('/').pop() ?? raw;
      const filename = `${String(seq).padStart(2, '0')}-${sanitizeFilename(basename)}`;
      const vaultFile = this.deps.app.vault.getFileByPath(raw);
      if (vaultFile && vaultFile.stat.size <= MEDIA_UPLOAD_MAX_FILE_BYTES) {
        uploadFiles.push({ filename, file: vaultFile });
      } else {
        // Missing from vault or over the per-file server limit — the
        // sentinel stays unmatched and the archive keeps partial media.
        unresolvedMediaCount += 1;
        this.deps.logger.warn(
          `[LocalArchiveImport] media not uploadable (${vaultFile ? 'file too large' : 'missing from vault'}): ${raw}`,
        );
      }
      return `localpath:${filename}`;
    };

    if (Array.isArray(clone.media)) {
      for (const media of clone.media) {
        const url = toSentinel(media.url);
        if (url) media.url = url;
        if (typeof media.thumbnail === 'string') {
          const thumbnail = toSentinel(media.thumbnail);
          if (thumbnail) media.thumbnail = thumbnail;
        }
      }
    }

    // Avatar rides the same pipeline (S4.5): PostDataParser puts local vault
    // paths in `localAvatar` and external URLs in `avatar`.
    if (clone.author.localAvatar) {
      const avatar = toSentinel(clone.author.localAvatar);
      if (avatar) clone.author.avatar = avatar;
      delete clone.author.localAvatar;
    }

    return { uploadFiles, unresolvedMediaCount };
  }

  // ---------------------------------------------------------------------------
  // Server calls
  // ---------------------------------------------------------------------------

  private submitBatch(
    jobId: string,
    chunk: PreparedNote[],
  ): ReturnType<LocalImportApi['createArchivesFromImportBatch']> {
    this.serverApiCallCount += 1;
    return this.deps.api.createArchivesFromImportBatch({
      jobId,
      source: LOCAL_IMPORT_SOURCE,
      sourceClientId: this.deps.sourceClientId,
      items: chunk.map((item) => ({
        url: item.clientPostData.url,
        clientPostData: item.clientPostData,
        importContext: {
          source: LOCAL_IMPORT_SOURCE,
          jobId,
          // Vault notes have no ZIP export parts; the server requires a
          // non-empty exportId, so the job id doubles as the export id.
          exportId: jobId,
          partNumber: 0,
        },
      })),
    });
  }

  /**
   * Upload one item's vault media in chunks of ≤ 20 files / ≤ 100 MiB per
   * request. Returns the failed-file count; upload failures degrade the item
   * to partial media, they never fail it (S6.4).
   */
  private async uploadItemMedia(archiveId: string, item: PreparedNote): Promise<number> {
    if (item.uploadFiles.length === 0) return 0;

    let failedCount = 0;
    let batch: Array<{
      filename: string;
      relativePath: string;
      contentType: string;
      data: ArrayBuffer;
    }> = [];
    let batchBytes = 0;

    const flushBatch = async (): Promise<void> => {
      if (batch.length === 0) return;
      try {
        this.serverApiCallCount += 1;
        const resp = await this.deps.api.uploadArchiveMedia({ archiveId, files: batch });
        failedCount += resp.failed.length;
      } catch (err) {
        failedCount += batch.length;
        this.deps.logger.warn(
          `[LocalArchiveImport] media upload batch failed for ${archiveId}`,
          err,
        );
      }
      batch = [];
      batchBytes = 0;
    };

    for (const upload of item.uploadFiles) {
      let data: ArrayBuffer;
      try {
        data = await this.deps.app.vault.readBinary(upload.file);
      } catch (err) {
        failedCount += 1;
        this.deps.logger.warn(
          `[LocalArchiveImport] vault read failed for ${upload.file.path}`,
          err,
        );
        continue;
      }

      if (
        batch.length >= MEDIA_UPLOAD_BATCH_SIZE ||
        batchBytes + data.byteLength > MEDIA_UPLOAD_BATCH_BYTE_CAP
      ) {
        await flushBatch();
      }
      batch.push({
        filename: upload.filename,
        relativePath: upload.file.path,
        contentType: contentTypeFor(upload.filename),
        data,
      });
      batchBytes += data.byteLength;
      this.mediaFileCount += 1;
      this.mediaByteCount += data.byteLength;
    }
    await flushBatch();

    return failedCount;
  }

  // ---------------------------------------------------------------------------
  // Frontmatter backfill + result
  // ---------------------------------------------------------------------------

  /**
   * Mark the note as imported immediately after its archive exists (S4.6).
   * Non-fatal on failure: the note stays `'local-only'`, so a re-run resolves
   * it as a server duplicate and retries this exact backfill.
   */
  private async backfillFrontmatter(file: TFile, archiveId: string): Promise<void> {
    try {
      await this.deps.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm['sourceArchiveId'] = archiveId;
        fm[SERVER_ARCHIVE_ID_FRONTMATTER_KEY] = archiveId;
        fm[IMPORT_MODE_FRONTMATTER_KEY] = IMPORT_MODE_IMPORTED;
      });
    } catch (err) {
      this.deps.logger.warn(
        `[LocalArchiveImport] frontmatter backfill failed for ${file.path}`,
        err,
      );
    }
  }

  /** Build, persist, and return the durable run summary (S4.8). */
  private async finishRun(counts: {
    total: number;
    imported: number;
    duplicates: number;
    partialMedia: number;
    failed: number;
    stopReason: LocalImportLastResult['stopReason'];
  }): Promise<LocalImportLastResult> {
    const result: LocalImportLastResult = {
      at: new Date().toISOString(),
      imported: counts.imported,
      duplicates: counts.duplicates,
      partialMedia: counts.partialMedia,
      failed: counts.failed,
      remaining: counts.total - counts.imported - counts.duplicates,
      stopReason: counts.stopReason,
    };
    try {
      await this.deps.persistResult(result);
    } catch (err) {
      this.deps.logger.warn('[LocalArchiveImport] failed to persist run summary', err);
    }
    return result;
  }

  /** Single immediate retry — the run-level stop policy handles persistence. */
  private async withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.deps.logger.warn('[LocalArchiveImport] request failed, retrying once', err);
      return await fn();
    }
  }
}

// ---------------------------------------------------------------------------
// Module helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename to the server's upload charset. The media-upload
 * handler reduces incoming filenames to `[A-Za-z0-9._-]` before matching
 * them against stored sentinels — the sentinel must be built from the SAME
 * sanitized form or files with spaces/Unicode silently never get patched.
 */
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : 'file';
}

/**
 * Transport post id (server dedup key, S7): the platform post id extracted
 * from the canonical URL — the same derivation the server and the URL
 * archive flow use — with a stable URL hash for URLs no extractor matches.
 * Exported for tests.
 */
export function deriveTransportPostId(platform: string, url: string): string {
  const extracted = isPlatform(platform) ? extractPostIdFromUrl(platform, url) : null;
  if (extracted && SERVER_POST_ID_PATTERN.test(extracted)) {
    return extracted;
  }
  return `url.${fnv1a(url)}`;
}

/** FNV-1a 32-bit hex hash — stable, dependency-free key for unmatched URLs. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Content type for uploaded vault media. Mirrors ImportWorker's mapping for
 * the canonical archive media extensions.
 */
function contentTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'm4a':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}
