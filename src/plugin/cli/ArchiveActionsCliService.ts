/**
 * ArchiveActionsCliService — thin adapter between Obsidian CLI flag bags and
 * the Workers bulk archive-action endpoint.
 *
 * The desktop CLI has had `bookmark` (the "Archive" state that moves posts in
 * and out of the Inbox) since it shipped; the Obsidian CLI could archive posts
 * but never triage them, so an agent working a vault had to hand the user back
 * to the UI to clear an Inbox.
 *
 * Responsibilities (SRP):
 *   - Map `ids` + `off` → bulk action payloads.
 *   - Enforce the server's 200-per-request ceiling by chunking, so a caller
 *     with a long id list gets one result instead of a rejected call.
 *   - Report per-archive failures as data, not as a whole-call error.
 *
 * Does NOT register CLI handlers — that wiring lives in `CliRegistry`.
 */

import { CliValidationError, parseBool, parseCsv, type CliParams } from './CliParams';

/** The slice of WorkersAPIClient this service needs. */
export interface ArchiveActionsCliClient {
  bulkUpdateArchiveActions(
    actions: Array<{ archiveId: string; isLiked?: boolean; isBookmarked?: boolean }>,
  ): Promise<{
    updatedIds: string[];
    failed: Array<{ archiveId: string; code: string; message: string }>;
  }>;
}

/** The server rejects a larger batch outright, so chunk rather than fail. */
const MAX_IDS_PER_REQUEST = 200;

export interface BookmarkCliResult {
  bookmarked: boolean;
  requested: number;
  updatedIds: string[];
  failed: Array<{ archiveId: string; code: string; message: string }>;
}

export class ArchiveActionsCliService {
  constructor(private readonly client: ArchiveActionsCliClient) {}

  /** Drive the `social-archiver:bookmark` command. */
  async bookmark(params: CliParams): Promise<BookmarkCliResult> {
    const ids = parseCsv(params, 'ids');
    if (ids.length === 0) {
      throw new CliValidationError('ids', "'ids' requires at least one archive id (comma-separated).");
    }
    const isBookmarked = !parseBool(params, 'off');

    const updatedIds: string[] = [];
    const failed: BookmarkCliResult['failed'] = [];
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
      const result = await this.client.bulkUpdateArchiveActions(
        chunk.map((archiveId) => ({ archiveId, isBookmarked })),
      );
      updatedIds.push(...result.updatedIds);
      failed.push(...result.failed);
    }

    return { bookmarked: isBookmarked, requested: ids.length, updatedIds, failed };
  }
}
