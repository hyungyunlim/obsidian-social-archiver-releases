/**
 * Archive Link Relation types — plugin mirror of the server contracts.
 *
 * Source of truth: `workers/src/types/archive-link-relations.ts` (C1, C2, C6,
 * C9) and `workers/src/types/user-archives.ts` (EmbeddedArchiveSummary). Field
 * names, optionality, and string-literal unions are LOAD-BEARING — they must
 * stay byte-compatible with the server so JSON parsed from the API/WS maps onto
 * these shapes without re-keying.
 *
 * The plugin consumes relations INBOUND-ONLY: it renders a managed
 * `## Linked archives` section from them and NEVER serializes/POSTs/DELETEs a
 * relation back. There is intentionally no row/raw-D1 shape, no preflight, and
 * no manual-connect body here — those are server/mobile concerns.
 */

import type { Platform } from '@shared/platforms/types';

/**
 * C1 — relation_type discriminator (mirrors `LinkCandidateSource`).
 *
 * `reader_block` is reserved for forward-compat; both sides MUST accept it on
 * read. `note_mention` / `note_author_mention` are the note-sourced types
 * (the latter has a null `targetArchiveId` and carries `targetAuthorKey`).
 */
export type LinkRelationType =
  | 'external_preview'
  | 'inline_markdown'
  | 'plain_url'
  | 'reader_block'
  | 'note_mention'
  | 'note_author_mention';

/** C2 — relation lifecycle status. Only `connected` rows are rendered. */
export type ArchiveLinkRelationStatus = 'pending' | 'connected' | 'failed';

/**
 * C2 — the canonical relation object used for GET/pull-sync/WS payloads.
 *
 * `deletedAt` is present only on soft-deleted rows in pull-sync responses and
 * WS event payloads (D6); it is absent/null elsewhere.
 */
export interface ArchiveLinkRelation {
  id: string;
  sourceArchiveId: string;
  targetArchiveId?: string | null;
  /** Canonical authorKey for `note_author_mention` rows; NULL otherwise. */
  targetAuthorKey?: string | null;
  targetUrl: string;
  normalizedTargetUrl: string;
  relationType: LinkRelationType;
  anchorText?: string | null;
  contextSnippet?: string | null;
  status: ArchiveLinkRelationStatus;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  deletedAt?: string | null; // pull-sync + WS payloads only (D6)
}

/**
 * Mirror of `workers/src/types/user-archives.ts:EmbeddedArchiveSummary` — the
 * "other side" summary attached to a relation by the per-archive GET endpoint.
 */
export interface EmbeddedArchiveSummary {
  id: string;
  platform: Platform;
  originalUrl: string | null;
  title: string | null;
  authorName: string | null;
  authorHandle: string | null;
  contentText: string | null;
  thumbnailUrl?: string | null;
  thumbnailUrls?: string[];
}

/**
 * C9 — relation + the NON-SELF side summary. `otherArchive` is null when the
 * other side is soft-deleted, unresolved, or an author-mention.
 *
 * Returned by `GET /api/user/archives/:archiveId/link-relations` (active rows
 * only).
 */
export interface RelationWithSummary {
  relation: ArchiveLinkRelation;
  otherArchive: EmbeddedArchiveSummary | null;
}

/**
 * C6 — pull-sync response payload (the `data` envelope of
 * `GET /api/user/archive-link-relations`). `relations` INCLUDES soft-deleted
 * rows so the client can drop them on re-render; `serverTime` is the next
 * cursor (delta-sync convention).
 */
export interface RelationPullResponse {
  relations: ArchiveLinkRelation[];
  serverTime: string;
}
