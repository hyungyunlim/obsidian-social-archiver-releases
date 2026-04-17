/**
 * types.ts — Canonical highlight type definitions (PRD §4.3).
 *
 * All coordinate offsets in this module are UTF-16 code units relative to
 * `fullText` (the canonical, normalized text the renderer produces). Clients
 * that still operate in visible-text space (share-web DOM, legacy plugin)
 * MUST convert via {@link offsetVisibleToFull} / {@link offsetFullToVisible}
 * at the edge before interacting with these types.
 *
 * Reference: .taskmaster/docs/prd-highlight-sync-unification.md §4.3, §4.4, §5.2
 *
 * Invariants (see PRD §4.4):
 *   - `startOffset <= endOffset`
 *   - `endOffset <= fullText.length`
 *   - `fullText.slice(startOffset, endOffset) === text` in the "exact" tier
 *   - `contextBefore` / `contextAfter` are trimmed grapheme-aware so that
 *     combining marks are never split in the middle.
 *
 * Constraints for this package:
 *   - No DOM / no React Native imports.
 *   - No runtime dependencies beyond the TS stdlib (Int32Array, Intl.Segmenter ok).
 *   - Structural shape so consumers can extend via intersection.
 */
import type { RenderProfile } from './render-profile';
/**
 * Coordinate schema tag stored on each {@link TextHighlight}.
 *
 * - `'legacy-visible-v0'` — pre-Phase-2 highlights whose offsets are
 *   relative to the DOM visible-text (share-web) or mobile legacy
 *   visible-text. Requires re-anchoring + dual-read on read.
 * - `'fulltext-v1'` — Phase 2+ canonical offsets relative to `fullText`.
 *   Always written by new highlights.
 */
export type CoordinateVersion = 'legacy-visible-v0' | 'fulltext-v1';
/**
 * Slim context capture used during range resolution / write-back.
 * 30-char window (see `CONTEXT_WINDOW`) on either side of the selection.
 */
export interface HighlightContext {
    /** Up to 30 chars preceding the selection (fullText, grapheme-trimmed). */
    before: string;
    /** Up to 30 chars following the selection (fullText, grapheme-trimmed). */
    after: string;
    /** Selection body text (must equal the match slice for exact tier). */
    text: string;
}
/**
 * Canonical highlight record (PRD §4.3, §5.2).
 *
 * All offset fields are UTF-16 code units into `fullText`. Context fields are
 * optional for legacy rows that were written before Phase 1 context-window
 * enforcement.
 */
export interface TextHighlight {
    /** Stable client-generated UUID (opaque to server). */
    id: string;
    /** Selection text as originally captured. */
    text: string;
    /** fullText UTF-16 offset, inclusive start. */
    startOffset: number;
    /** fullText UTF-16 offset, exclusive end. */
    endOffset: number;
    /** Context preceding the selection (window = 30 graphemes). */
    contextBefore?: string;
    /** Context following the selection (window = 30 graphemes). */
    contextAfter?: string;
    /** Optional color label (client-defined palette). */
    color?: string;
    /** Optional user annotation tied to the highlight. */
    note?: string;
    /**
     * Render profile in effect when the highlight was created. Used by Phase 3
     * dual-read to reproduce the exact fullText for re-anchoring.
     */
    createdProfile?: RenderProfile;
    /**
     * Storage schema version. `2` from Phase 2 onward; `1` denotes legacy
     * visible-text rows that may need migration.
     */
    schemaVersion?: 1 | 2;
    /**
     * Coordinate space tag. Phase 2+ writes MUST record `'fulltext-v1'`; older
     * rows may be missing or explicitly `'legacy-visible-v0'`.
     */
    coordinateVersion?: CoordinateVersion;
    /** ISO 8601 timestamp of creation. */
    createdAt: string;
    /** ISO 8601 timestamp of last update. */
    updatedAt: string;
}
/**
 * Tier outcome classification for {@link RangeResolveResult}.
 *
 * - `exact`  — tier 1: `fullText.slice(start,end) === text` at the stored offsets.
 * - `strong` — tier 2: `contextBefore + text + contextAfter` exact match elsewhere.
 * - `weak`   — tier 3: text-only fuzzy match with proximity + context scoring.
 * - `fail`   — tier 0: no viable anchor found.
 */
export type RangeResolveStatus = 'exact' | 'strong' | 'weak' | 'fail';
/**
 * Result of re-anchoring a highlight onto (possibly edited) fullText.
 * (PRD §4.5, §5.3)
 */
export interface RangeResolveResult {
    /** Tier outcome classification. */
    status: RangeResolveStatus;
    /** Resolved fullText offsets after re-anchoring (inclusive start). */
    startOffset: number;
    /** Resolved fullText offsets after re-anchoring (exclusive end). */
    endOffset: number;
    /** Distance moved from original `highlight.startOffset` (for telemetry). */
    shift: number;
    /**
     * Tier that produced this result. `0` denotes fail, otherwise 1/2/3
     * maps to exact / strong / weak respectively.
     */
    tier: 0 | 1 | 2 | 3;
    /**
     * Conservative confidence score in the `[0, 1]` range. Consumers use this
     * to gate write-back (see `isWriteBackEligible` in dual-read).
     */
    confidence: number;
    /** Viable candidate count at the winning tier (used for write-back gating). */
    candidateCount: number;
}
/**
 * Bidirectional mapping between visible (plain) text and fullText for a
 * given markdown + title + profile combination. (PRD §4.3, §4.4)
 *
 * Invariants:
 *   - `visibleText.length === visibleToFull.length`
 *   - `fullText.length === fullToVisible.length`
 *   - `visibleToFull[i] ∈ [0, fullText.length)`
 *   - `fullToVisible[j] ∈ [0, visibleText.length) ∪ {-1}`
 *     (`-1` means the full-text char is a non-visible markdown syntax char.)
 */
export interface VisibleFullTextMap {
    /** Rendered plain text with media replaced by a placeholder token. */
    visibleText: string;
    /** Title-prefixed raw markdown body after normalization. */
    fullText: string;
    /** `visibleIdx → fullIdx` lookup (same length as `visibleText`). */
    visibleToFull: Int32Array;
    /** `fullIdx → visibleIdx` lookup (same length as `fullText`). */
    fullToVisible: Int32Array;
}
/**
 * Dual-read rendered highlight (Phase 3, §5.4).
 *
 * Extends a stored {@link TextHighlight} with the post-resolution coordinates
 * the renderer should paint. Callers decide whether to display unresolved
 * legacy highlights with a warning badge vs hide them entirely.
 */
export interface RenderedHighlight extends TextHighlight {
    /** Final start offset after re-anchoring (undefined if `renderState === 'unresolved-migration'`). */
    rangeStart?: number;
    /** Final end offset after re-anchoring. */
    rangeEnd?: number;
    /**
     * - `'resolved'`             — render normally using `rangeStart` / `rangeEnd`.
     * - `'unresolved-migration'` — legacy / wrong-canonical row whose range
     *                              could not be recovered with enough
     *                              confidence; caller should skip inline mark
     *                              or show a migration warning chip. Preserves
     *                              the original record for a later retry.
     */
    renderState: 'resolved' | 'unresolved-migration';
    /**
     * Runtime coordinate-state tag that drove the render decision. Exposed for
     * telemetry / debugging; clients normally only need `renderState`.
     */
    coordinateState?: CoordinateVersionDetection;
    /**
     * Resolve result attached when re-anchoring was invoked (i.e. any state
     * other than `canonical-trusted`). Useful for UI badges / logging.
     */
    resolve?: RangeResolveResult;
}
/**
 * 3-tier coordinate-version detection outcome (PRD §5.3, §5.12).
 *
 * The PRD describes a 4-state runtime model
 * (`canonical-trusted` / `soft-canonical-missing-version` /
 *  `wrong-canonical-v2` / `legacy-visible-v0`) but the public surface collapses
 * the first two into `'fulltext-v1'` because both are render-safe with the
 * stored offsets and both — when the row was previously missing metadata —
 * graduate to `schemaVersion: 2` + `coordinateVersion: 'fulltext-v1'` on
 * write-back.
 *
 * - `'fulltext-v1'`          — stored slice is self-consistent (canonical OR
 *                              undefined-but-probe-matches with schemaVersion
 *                              === 2 / context evidence). Render using stored
 *                              offsets.
 * - `'wrong-canonical-v2'`   — `coordinateVersion === 'fulltext-v1'` BUT
 *                              `fullText.slice(start, end) !== text`. The row
 *                              was written under title-prefix-true and MUST
 *                              be re-resolved before rendering.
 * - `'legacy-visible-v0'`    — pre-Phase-2 visible-text coordinates OR
 *                              undefined rows without canonical evidence.
 */
export type CoordinateVersionDetection = 'fulltext-v1' | 'wrong-canonical-v2' | 'legacy-visible-v0';
/**
 * Minimal archive shape consumed by {@link loadHighlightsForRender}.
 *
 * The core package does not own the full Archive type (client DBs each model
 * their own row shape). We only require the two fields the dual-read loop
 * reads — `id` for write-back scheduling telemetry and `highlights` for the
 * iteration payload.
 */
export interface DualReadArchiveInput {
    /** Stable archive identifier (opaque to core). */
    id: string;
    /** Highlights to render for this archive. */
    highlights: readonly TextHighlight[];
}
//# sourceMappingURL=types.d.ts.map