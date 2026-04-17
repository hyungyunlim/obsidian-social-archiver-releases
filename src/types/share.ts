/**
 * Share-specific types for archive-backed media reuse.
 *
 * These types mirror the workers-side contract defined in
 * `workers/src/handlers/share.ts` / `workers/src/utils/share-media-enrichment.ts`.
 *
 * See `.taskmaster/docs/prd-share-link-media-reuse.md` §6.2 for the full API contract.
 */

import type { Media } from './post';

/**
 * Provenance of a media item attached to a share.
 *
 * - `archive`: reusing an R2 object that lives under `archives/{userId}/{archiveId}/media/*`.
 *              share delete MUST NOT touch these objects.
 * - `share`:   uploaded to `shares/{shareId}/media/*` specifically for this share.
 * - `external`: references an external URL (no R2 storage owned by us).
 */
export type ShareMediaOrigin = 'archive' | 'share' | 'external';

/**
 * Media variant — top-level `primary` blob vs `thumbnail` (e.g. for videos).
 * Matches `workers/src/utils/share-media-enrichment.ts`.
 */
export type ShareMediaVariant = 'primary' | 'thumbnail';

/**
 * Hint describing a single top-level media item for which the plugin
 * would like to check if a preserved R2 object already exists.
 *
 * All fields are optional but at least one of `originalUrl` or
 * `sourceIndex` must be provided for the server to resolve the item.
 */
export interface ResolveShareMediaHint {
  /** Original CDN URL recorded in frontmatter `mediaSourceUrls[i]`. Primary matcher. */
  originalUrl?: string;
  /** Zero-based position within the archive's top-level media array. Secondary matcher. */
  sourceIndex?: number;
  /** Variant (defaults to `'primary'` server-side when omitted). */
  variant?: ShareMediaVariant;
  /** Media kind hint; server uses this for content-type disambiguation. */
  mediaType?: 'image' | 'video' | 'audio' | 'document';
}

/**
 * Request payload for `POST /api/share/resolve-media`.
 */
export interface ResolveShareMediaRequest {
  /** Archive whose preserved media we're consulting. */
  archiveId: string;
  /** Ordered list of hints; response.resolved preserves this order. */
  items: ResolveShareMediaHint[];
}

/**
 * A single successfully-resolved archive media object.
 *
 * This shape matches `workers/src/utils/share-r2-media.ts` archive entries.
 */
export interface ResolvedShareMediaItem {
  /** Echoes hint.sourceIndex when provided. */
  sourceIndex?: number;
  /** Always concrete (server fills in `'primary'` when hint omitted it). */
  variant: ShareMediaVariant;
  /** Full archive R2 URL suitable for share payload `media[i].url`. */
  url: string;
  /** R2 key — always `archives/…` for archive origin. */
  r2Key: string;
  /** MIME type recorded by the preservation pipeline. */
  contentType: string;
  /** Byte size if known. */
  size?: number;
}

/**
 * Preservation status summary from the resolver.
 *
 * See PRD §6.2 for semantics. Plugin treats everything except `completed`
 * or `partial` as "no reuse" and falls back to legacy upload for everything.
 */
export type SharePreservationStatus =
  | 'completed'
  | 'partial'
  | 'pending'
  | 'failed'
  | 'not_found';

/**
 * Response for `POST /api/share/resolve-media`.
 *
 * `resolved` is index-aligned with the request `items` array. `null` entries
 * mean "not preserved yet" — the plugin must upload those normally.
 */
export interface ResolveShareMediaResponse {
  archiveId: string;
  preservationStatus: SharePreservationStatus;
  /** Parallel to request.items; `null` for unresolved entries. */
  resolved: Array<ResolvedShareMediaItem | null>;
  resolvedCount: number;
  totalCount: number;
}

/**
 * Share payload media item: the base `Media` shape plus the share-specific
 * provenance / cleanup metadata that the plugin stamps on each entry before
 * sending `/api/share` updates.
 *
 * Keep field names aligned with `workers/src/types/share.ts`'s `ShareMediaRef`
 * and PRD §6.7 — they are part of the wire contract the worker persists so
 * that delete cleanup can distinguish archive-owned vs share-owned objects.
 */
export interface ShareMediaPayloadItem extends Media {
  /** `archive` = reused R2 object; `share` = uploaded for this share; `external` = URL only. */
  mediaOrigin?: ShareMediaOrigin;
  /** Full R2 key. `archives/…` for archive origin, `shares/…` for share origin. */
  r2Key?: string;
  /** Back-reference to the archive whose preserved media is being reused. */
  sourceArchiveId?: string;
  /** Index into the source archive's top-level media array. */
  sourceIndex?: number;
  /** `primary` vs `thumbnail` (mirrors the archive-side variant label). */
  variant?: ShareMediaVariant;
}
