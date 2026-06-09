/**
 * CommentStateSyncService
 *
 * Single Responsibility: handle inbound `action_updated` events carrying
 * `changes.hasCommentUpdate` and re-project the server-authoritative platform
 * `comments` tree into the local vault note's managed `## 💬 Comments` section.
 *
 * Flow (PRD R10 — `docs/specs/platform-comment-delete-and-pin-sync-prd.md`):
 *   ws:action_updated (hasCommentUpdate)
 *     → echo-suppress own / recently-written events
 *     → fetch latest archive from server (apiClient.getUserArchive)
 *     → resolve local file by sourceArchiveId, then originalUrl fallback
 *       (skip on ambiguous match)
 *     → recursively convert archive.comments → PostData.comments (pin fields +
 *       deep replies preserved)
 *     → sort pinned root threads (shared helper)
 *     → format via CommentFormatter → CommentSectionManager.replace / remove
 *     → vault.read → swap section → vault.modify
 *
 * Constraints:
 *   - Read-only for comments in MVP — never parses the markdown back into an
 *     upload (PRD Non-Goal #4).
 *   - The body write MUST be gated behind `enableMobileAnnotationSync` and run
 *     under `withArchiveWriteLocks` (the caller in `RealtimeEventBridge` owns the
 *     lock; this service's body write is invoked inside it).
 *   - If the comments section cannot be safely isolated (no `## 💬 Comments`
 *     heading AND comments exist to render), this still operates via
 *     `replaceCommentsSection`'s footer-anchored insertion. But if there is no
 *     safe anchor at all (no footer, no heading) the manager appends at EOF;
 *     when even that is unsafe the service ABORTS and logs rather than rewriting
 *     the body. There is no managed-block-preserving full-note refresh.
 *
 * Echo suppression mirrors `ShareStateSyncService`: a `sourceClientId` matching
 * our own `syncClientId` is skipped, and a short-lived suppression map guards
 * against re-entrancy from our own writes.
 */

import type { App, TFile } from 'obsidian';
import type { ActionUpdatedEventData } from '@/types/websocket';
import type { SocialArchiverSettings } from '@/types/settings';
import type { Comment, Platform } from '@/types/post';
import type { WorkersAPIClient, UserArchive } from '../../services/WorkersAPIClient';
import type { ArchiveLookupService } from '../../services/ArchiveLookupService';
import { mapUserArchiveComment } from '../mobile/UserArchiveConverter';
import { sortPinnedCommentRoots } from '../../utils/comments';
import { CommentFormatter } from '../../services/markdown/formatters/CommentFormatter';
import { DateNumberFormatter } from '../../services/markdown/formatters/DateNumberFormatter';
import { TextFormatter } from '../../services/markdown/formatters/TextFormatter';
import {
  replaceCommentsSection,
  removeCommentsSection,
  findCommentsSection,
} from '../../services/markdown/CommentSectionManager';

const SUPPRESSION_TTL_MS = 10_000;
const LOG_PREFIX = '[Social Archiver] [CommentStateSyncService]';

export class CommentStateSyncService {
  /** Set by wiring in main.ts so a paired outbound service can suppress echoes. */
  onBeforeInboundWrite?: (archiveId: string) => void;
  onAfterInboundWrite?: () => void;

  private readonly suppressionMap = new Map<string, number>();
  private readonly commentFormatter: CommentFormatter;

  constructor(
    private readonly app: App,
    private readonly apiClient: WorkersAPIClient,
    private readonly archiveLookup: ArchiveLookupService,
    private readonly getSettings: () => SocialArchiverSettings,
    commentFormatter?: CommentFormatter,
  ) {
    this.commentFormatter =
      commentFormatter ?? new CommentFormatter(new DateNumberFormatter(), new TextFormatter());
  }

  addSuppression(archiveId: string): void {
    this.suppressionMap.set(archiveId, Date.now());
  }

  isSuppressed(archiveId: string): boolean {
    const ts = this.suppressionMap.get(archiveId);
    if (ts === undefined) return false;
    if (Date.now() - ts > SUPPRESSION_TTL_MS) {
      this.suppressionMap.delete(archiveId);
      return false;
    }
    return true;
  }

  /**
   * Handle an inbound `action_updated` event. No-ops unless
   * `changes.hasCommentUpdate === true` and the mobile-annotation-sync setting
   * is enabled. Never throws — failures are logged and swallowed.
   */
  async handleRemoteCommentState(eventData: ActionUpdatedEventData): Promise<void> {
    if (eventData.changes.hasCommentUpdate !== true) return;

    const settings = this.getSettings();
    if (!settings.enableMobileAnnotationSync) {
      console.debug(
        `${LOG_PREFIX} Comment update received but Mobile Annotation Sync is disabled. Enable it in Settings → Mobile sync.`,
      );
      return;
    }

    const { archiveId, sourceClientId } = eventData;

    // Echo suppression: skip our own change + anything we just wrote.
    if (sourceClientId && sourceClientId === settings.syncClientId) {
      console.debug(`${LOG_PREFIX} Skipping own comment update echo for:`, archiveId);
      return;
    }
    if (this.isSuppressed(archiveId)) {
      console.debug(`${LOG_PREFIX} Skipping suppressed comment update for:`, archiveId);
      return;
    }

    // Fetch latest server-authoritative archive.
    let archive: UserArchive;
    try {
      const response = await this.apiClient.getUserArchive(archiveId);
      archive = response.archive;
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} Failed to fetch archive for comment sync:`,
        archiveId,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    // Resolve local vault file (sourceArchiveId → originalUrl fallback).
    const file = this.resolveFile(archiveId, archive.originalUrl);
    if (!file) {
      console.debug(`${LOG_PREFIX} No matching vault file for comment update:`, archiveId);
      return;
    }

    await this.applyCommentState(file, archive);
  }

  /**
   * Reconcile the managed comments section during library/delta catch-up.
   * Wired to {@link ArchiveLibrarySyncService} in main.ts so a comment mutation
   * whose live `hasCommentUpdate` WS event was MISSED (suspended socket /
   * backgrounded app) is recovered on the next focus/resume sweep — without it,
   * comment pin/delete only converges via the live event (the bug where mobile
   * & web reflected an unpin but the plugin did not).
   *
   * The library/delta archive is lightweight and typically omits the full
   * comment tree, so re-fetch the authoritative single archive before applying:
   * passing a comments-less archive to {@link applyCommentState} would mistake
   * "not loaded" for "empty" and wipe the section. Never throws; idempotent
   * (applyCommentState no-ops when the section is already up to date).
   */
  async reconcileFromLibrarySync(file: TFile, archive: UserArchive): Promise<void> {
    if (!this.getSettings().enableMobileAnnotationSync) return;
    try {
      // Delta archive already carries the full tree → apply directly.
      if (Array.isArray(archive.comments)) {
        await this.applyCommentState(file, archive);
        return;
      }
      // Otherwise re-fetch the authoritative archive (comments guaranteed).
      const response = await this.apiClient.getUserArchive(archive.id);
      await this.applyCommentState(file, response.archive);
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} reconcileFromLibrarySync failed:`,
        file.path,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Apply the server comment tree to a specific vault file's managed
   * `## 💬 Comments` section. Exposed for reconcilers / library sync reuse.
   *
   * Never throws.
   */
  async applyCommentState(file: TFile, archive: UserArchive): Promise<void> {
    const archiveId = archive.id;
    const platform = archive.platform as Platform;

    // Recursive conversion preserves pin metadata + deep replies (PRD R10).
    const serverComments = archive.comments ?? [];
    const mapped: Comment[] = serverComments.map((c) => mapUserArchiveComment(c, platform));

    // Pinned root threads first (normative shared sort).
    const sorted = mapped.length > 0 ? sortPinnedCommentRoots(mapped) : mapped;

    // Build the managed section body via the same formatter the writer uses.
    const formattedBody =
      sorted.length > 0 ? this.commentFormatter.formatComments(sorted, platform) : '';

    let content: string;
    try {
      content = await this.app.vault.read(file);
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to read note body:`,
        file.path,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    // Safety gate (PRD R10, hardened 2026-06): never rewrite the body unless the
    // managed comments section can be UNAMBIGUOUSLY isolated.
    const section = findCommentsSection(content);
    const hasManagedSection = section !== null;

    if (sorted.length === 0 && !hasManagedSection) {
      // Nothing to remove and nothing to render — no-op.
      console.debug(`${LOG_PREFIX} No managed comments section and no comments to render:`, file.path);
      return;
    }

    // If a managed section exists but its END boundary cannot be confidently
    // determined — no sentinel markers (not yet emitted), and the heading-based
    // detection fell through to an EOF boundary that still has an unrecognised
    // `## ` heading after it (foreign/unknown managed section, or a malformed
    // note) — ABORT and leave the body untouched. Rewriting in this state risks
    // truncating the section at a fake boundary and re-appending stale content
    // below the new section (the vault-corruption bug this guard prevents).
    if (hasManagedSection && section && !section.endIsConfident) {
      console.warn(
        `${LOG_PREFIX} Comments section boundary is ambiguous (no markers, unrecognised trailing heading); aborting to avoid corrupting the note:`,
        file.path,
      );
      return;
    }

    let updatedContent: string;
    try {
      updatedContent =
        sorted.length === 0
          ? removeCommentsSection(content)
          : replaceCommentsSection(content, formattedBody);
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to compute comments section update (aborting, body untouched):`,
        file.path,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    if (updatedContent === content) {
      console.debug(`${LOG_PREFIX} Comments section already up to date:`, file.path);
      return;
    }

    // Notify outbound suppression + guard our own re-entrancy before writing.
    this.onBeforeInboundWrite?.(archiveId);
    this.addSuppression(archiveId);

    try {
      await this.app.vault.modify(file, updatedContent);
      this.onAfterInboundWrite?.();
      console.debug(`${LOG_PREFIX} Comment sync complete:`, file.path, {
        commentCount: sorted.length,
        removed: sorted.length === 0,
      });
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to write comments section:`,
        file.path,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Resolve the vault file for a given archiveId and originalUrl.
   * Priority: sourceArchiveId (stable, O(1)) → originalUrl fallback.
   * Ambiguous originalUrl matches return null (no auto-update).
   */
  private resolveFile(archiveId: string, originalUrl: string): TFile | null {
    const byId = this.archiveLookup.findBySourceArchiveId(archiveId);
    if (byId) return byId;

    const byUrl = this.archiveLookup.findByOriginalUrl(originalUrl);
    if (byUrl.length === 0) return null;

    if (byUrl.length > 1) {
      console.warn(
        `${LOG_PREFIX} Ambiguous originalUrl match — skipping comment update.`,
        { archiveId, originalUrl, matchCount: byUrl.length, paths: byUrl.map((f) => f.path) },
      );
      return null;
    }

    return byUrl[0] ?? null;
  }
}
