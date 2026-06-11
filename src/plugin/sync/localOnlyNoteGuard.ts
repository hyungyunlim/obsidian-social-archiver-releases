/**
 * localOnlyNoteGuard
 *
 * Sync-exclusion contract for local-only notes (PRD S5.1,
 * prd-plugin-anonymous-local-mode.md).
 *
 * A local-only note (frontmatter `social_archiver_import_mode: 'local-only'`,
 * e.g. an anonymous browser clip) has never been uploaded to the server and
 * must be invisible to every sync service: it must never be read from, written
 * to, matched by URL, or have `sourceArchiveId` backfilled by ambient sync.
 * Backfilling identity into such a note is only allowed inside the explicit
 * import flow (LocalArchiveImportService), which flips the marker to
 * `'imported'`.
 *
 * Matching is an exact `'local-only'` check — never key presence — so notes
 * marked `'imported'` participate in sync normally (Resolved Decisions, PRD).
 *
 * A present `sourceArchiveId` wins over the mode marker: a note with a server
 * identity is server-backed no matter what the marker says (e.g. a manual
 * edit or a partial backfill). Otherwise the marker would skip outbound sync
 * while inbound by-id sync keeps writing — one-way divergence. Such notes
 * also self-heal: the next import run resolves them as server duplicates and
 * flips the marker to `'imported'`.
 *
 * Single Responsibility: decide whether a vault note is local-only.
 */

import type { App, TFile } from 'obsidian';
import {
  IMPORT_MODE_FRONTMATTER_KEY,
  IMPORT_MODE_LOCAL_ONLY,
} from '../../services/import/local/LocalArchiveScanner';

/** Exact-match check on the raw import-mode value. */
export function isLocalOnlyImportMode(value: unknown): boolean {
  return value === IMPORT_MODE_LOCAL_ONLY;
}

/** Exact-match check on a (cached) frontmatter record; sourceArchiveId wins. */
export function isLocalOnlyFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): boolean {
  const sourceArchiveId = frontmatter?.['sourceArchiveId'];
  if (typeof sourceArchiveId === 'string' && sourceArchiveId.length > 0) return false;
  return isLocalOnlyImportMode(frontmatter?.[IMPORT_MODE_FRONTMATTER_KEY]);
}

/**
 * MetadataCache-based check for services holding an `App` reference.
 * Synchronous and O(1).
 */
export function isLocalOnlyNote(app: App, file: TFile): boolean {
  return isLocalOnlyFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter);
}

/**
 * Raw-content check for dependency-injected services that have a `TFile` but
 * no `App` reference (ArchiveLibrarySyncService, RemoteArchiveIngestService).
 *
 * Reads via `file.vault.cachedRead` and inspects only the leading frontmatter
 * block, tolerating optional YAML quoting of the value (same parsing approach
 * as `readSourceArchiveIdState` in ArchiveLookupService).
 */
export async function isLocalOnlyNoteByContent(file: TFile): Promise<boolean> {
  const content = await file.vault.cachedRead(file);
  const frontmatterBlock = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!frontmatterBlock) return false;

  // sourceArchiveId wins (see module header): a bound note is server-backed.
  const sourceArchiveId = frontmatterBlock
    .match(/^sourceArchiveId:\s*(.*?)\s*$/m)?.[1]
    ?.replace(/^['"]|['"]$/g, '');
  if (sourceArchiveId) return false;

  const line = frontmatterBlock.match(
    new RegExp(`^${IMPORT_MODE_FRONTMATTER_KEY}:\\s*(.*?)\\s*$`, 'm'),
  )?.[1];
  if (!line) return false;

  return isLocalOnlyImportMode(line.replace(/^['"]|['"]$/g, ''));
}
