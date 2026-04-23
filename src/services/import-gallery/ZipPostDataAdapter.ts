/**
 * ZipPostDataAdapter — pure ZIP → review-gallery preview adapter.
 *
 * Layer-2 of the Instagram Import Review Gallery (PRD §9.3).
 *
 * Responsibilities (verbatim from PRD §9.3):
 *   - Parse posts.jsonl (already streamed by preflight; cache the result
 *     instead of discarding).
 *   - Join with the existing duplicate-preflight result to set
 *     {@link ImportPostPreview.isDuplicate}.
 *   - Lazily rewrite postData.media[].url, media[].thumbnail, author.avatar
 *     strings to blob: URLs at render time via MediaPreviewService.acquire.
 *     Eager rewriting is forbidden — it would defeat lazy loading.
 *
 * Design contract (PRD §0):
 *   - Pure function module, no global state, no caching across calls.
 *   - Platform-agnostic infrastructure — the fact that today every PostData
 *     carries `platform: 'instagram'` is incidental. Future X bookmarks
 *     ZIPs follow the same contract.
 *   - Returned previews still hold ZIP-relative paths (e.g.
 *     `./media/{shortcode}/00-image.jpg`). The UI is responsible for
 *     calling MediaPreviewService.acquire on render and substituting the
 *     resulting blob URL into the rendered DOM.
 *   - This adapter does NOT touch MediaPreviewService directly — it only
 *     emits the data the UI needs to drive that service later.
 *   - This adapter does NOT call ImportOrchestrator. The scan logic is
 *     copied from `ImportOrchestrator.scanPart` so the gallery can run
 *     standalone (e.g. from a "Review only" entry point).
 *
 * Orchestrator integration (Layer-1):
 *   The orchestrator runs the server-side preflight FIRST (to obtain the
 *   `duplicatePostIds: Set<string>`), then invokes {@link loadGallery}
 *   with that set. The adapter does NOT make any network calls — it only
 *   reads ZIP bytes and joins them with the set the caller provides.
 */

import type { PostData } from '@/types/post';
import type {
  ImportCollectionScope,
  ImportPostPreview,
} from '@/types/import';
import { ImportZipReader } from '@/services/import/ImportZipReader';

/**
 * Per-part scan output, mirrors the shape consumed by the gallery UI.
 *
 * `counts` is sourced from the manifest (authoritative for what the
 * exporter wrote) — NOT from the parsed posts.jsonl line count, so a
 * truncated jsonl still surfaces as an integrity warning rather than a
 * silently-shrunk total.
 */
export type GalleryPart = {
  /** Original `.zip` filename (display + media-route key). */
  filename: string;
  exportId: string;
  partNumber: number;
  totalParts: number;
  collection: ImportCollectionScope;
  /**
   * True when `_checksums.txt` matched every computed sha256 we sampled.
   * Advisory only — the UI should warn but not block import.
   */
  integrityOk: boolean;
  /** Validator/checksum/parse warnings the UI may surface. */
  warnings: string[];
  counts: {
    postsInPart: number;
    postsInExport: number;
    readyToImport: number;
    partialMedia: number;
    failedPosts: number;
  };
  /** Per-post previews — see {@link ImportPostPreview}. */
  posts: ImportPostPreview[];
};

export type LoadGalleryInput = {
  /** Source files (caller keeps blobs alive for the gallery's lifetime). */
  files: Array<{ name: string; blob: Blob }>;
  /**
   * Server-preflight duplicate set. The orchestrator MUST populate this
   * before calling {@link loadGallery} — otherwise every preview will be
   * marked `isDuplicate: false` regardless of server state.
   */
  duplicatePostIds: Set<string>;
};

export type LoadGalleryResult = {
  parts: GalleryPart[];
  /**
   * Aggregate count of selectable previews across all parts, EXCLUDING
   * duplicates. Drives the `Import N` button label.
   */
  totalReady: number;
  /** Per-part fatal errors (manifest invalid, posts.jsonl missing, etc.). */
  errors: Array<{ filename: string; message: string }>;
};

/**
 * Read every selected ZIP part, join with the supplied duplicate set, and
 * return per-post previews suitable for the review gallery.
 *
 * Pure function: does not mutate `input.files`, does not retain references
 * to the source blobs after returning, and does not perform any I/O outside
 * of the synchronous read of the supplied blobs.
 */
export async function loadGallery(input: LoadGalleryInput): Promise<LoadGalleryResult> {
  const parts: GalleryPart[] = [];
  const errors: Array<{ filename: string; message: string }> = [];
  let totalReady = 0;

  for (const file of input.files) {
    try {
      const part = await scanPart(file.name, file.blob, input.duplicatePostIds);
      parts.push(part);
      for (const preview of part.posts) {
        if (!preview.isDuplicate) totalReady++;
      }
    } catch (err) {
      errors.push({
        filename: file.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { parts, totalReady, errors };
}

/**
 * Extract media bytes for a single relative path from a part.
 *
 * Used by the UI's IntersectionObserver callback to feed
 * `MediaPreviewService.acquire`. The caller already knows which `blob`
 * (zip part) the post lives in, because {@link ImportPostPreview} carries
 * `partFilename` and the orchestrator keeps a name → blob map alive while
 * the gallery is open.
 *
 * Thin wrapper around {@link ImportZipReader.extractMediaFile}; instantiates
 * a fresh reader per call. If the UI extracts many files from the same
 * blob the orchestrator may want to cache one reader per blob — but that
 * caching belongs to the orchestrator, not this adapter (keeps it pure).
 *
 * @returns the file bytes, or `null` when the entry is absent (which is
 *   normal for "imported_with_warnings" posts whose media download failed
 *   during Phase 1 export).
 */
export async function extractMediaBytes(
  blob: Blob,
  relativePath: string,
): Promise<ArrayBuffer | null> {
  const reader = new ImportZipReader(blob);
  return reader.extractMediaFile(relativePath);
}

// ---------------------------------------------------------------------------
// Internals — copied (not imported) from ImportOrchestrator.scanPart so the
// adapter stays standalone. Differences vs the orchestrator:
//   - Emits ImportPostPreview (one per post line) instead of an internal
//     {postData, mediaPaths} tuple keyed for the upload worker.
//   - Joins the supplied duplicate set into each preview.
//   - Surfaces parse-warnings on the part (no per-line silent drop) but
//     does NOT include un-parseable lines in the preview list.
// ---------------------------------------------------------------------------

async function scanPart(
  filename: string,
  blob: Blob,
  duplicatePostIds: Set<string>,
): Promise<GalleryPart> {
  const reader = new ImportZipReader(blob);

  const manifestResult = await reader.readManifest();
  if (!manifestResult.ok) {
    throw new Error(`manifest invalid: ${manifestResult.errors.join('; ')}`);
  }
  const warnings: string[] = [...manifestResult.warnings];
  const manifest = manifestResult.manifest;

  // Stream posts.jsonl → ImportPostPreview[]. We trust the line ordering
  // for stable rendering but do not depend on it for identity.
  const posts: ImportPostPreview[] = [];
  await reader.readPostsJsonl((rec) => {
    if (rec.error) {
      warnings.push(`posts.jsonl line ${rec.lineIndex} parse error: ${rec.error}`);
      return;
    }
    if (!rec.value || typeof rec.value !== 'object') {
      warnings.push(`posts.jsonl line ${rec.lineIndex} is not an object`);
      return;
    }
    const postData = rec.value as PostData;
    if (!postData.id || !Array.isArray(postData.media)) {
      warnings.push(`posts.jsonl line ${rec.lineIndex} missing id/media`);
      return;
    }

    // shortcode resolution mirrors ImportOrchestrator.startImport: the
    // chrome-extension exporter stamps the Instagram `code` into
    // postData.raw.code; fall back to id when raw is opaque.
    const shortcode =
      (postData.raw as { code?: string } | undefined)?.code ?? postData.id;

    posts.push({
      postId: postData.id,
      shortcode,
      collectionId: manifest.collection.id,
      partFilename: filename,
      // IMPORTANT: postData is forwarded as-is. media[].url / .thumbnail
      // and author.avatar still hold ZIP-relative paths. The UI must NOT
      // assume they are blob: URLs — see PRD §9.3 lazy-rewrite contract.
      postData,
      isDuplicate: duplicatePostIds.has(postData.id),
    });
  });

  // Sample-based integrity pass — we verify the small text files because
  // they are cheap and they're the highest-signal failures (a corrupted
  // posts.jsonl invalidates everything downstream). Full media verify is
  // deferred to a follow-up "verify all" UI affordance.
  let integrityOk = true;
  try {
    const checksums = await reader.readChecksums();
    if (checksums.size > 0) {
      const postsChecksum = await reader.computeEntryChecksum('posts.jsonl');
      const expected = checksums.get('posts.jsonl');
      if (postsChecksum && expected && postsChecksum !== expected) {
        integrityOk = false;
        warnings.push('posts.jsonl checksum mismatch');
      }
    }
  } catch (err) {
    warnings.push(
      `checksum verification skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    filename,
    exportId: manifest.exportId,
    partNumber: manifest.partNumber,
    totalParts: manifest.totalParts,
    collection: manifest.collection,
    integrityOk,
    warnings,
    counts: {
      postsInPart: manifest.counts.postsInPart,
      postsInExport: manifest.counts.postsInExport,
      readyToImport: manifest.counts.readyToImport,
      partialMedia: manifest.counts.partialMedia,
      failedPosts: manifest.counts.failedPosts,
    },
    posts,
  };
}
