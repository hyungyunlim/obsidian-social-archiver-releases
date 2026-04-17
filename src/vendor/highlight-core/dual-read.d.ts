/**
 * dual-read.ts — Phase 3 dual-read + coordinate-version detection.
 *
 * Implements the "3-tier coordinate heuristic + re-anchor on read" strategy
 * described in `.taskmaster/docs/prd-highlight-sync-unification.md`:
 *
 *   - §5.3  — 3-tier coordinate version detection (exposed) backed by the
 *             4-state runtime model (`canonical-trusted`,
 *             `soft-canonical-missing-version`, `wrong-canonical-v2`,
 *             `legacy-visible-v0`).
 *   - §5.4  — `loadHighlightsForRender` dual-read pipeline.
 *   - §5.4.1 — `buildPreAnchoredHighlights` render-variant pre-anchor used by
 *             timeline cards / truncated previews.
 *   - §5.5  — `isWriteBackEligible` gating rule.
 *   - §5.12 — wrong-canonical v2 (task #21) is the highest-priority detection
 *             target: a `coordinateVersion: 'fulltext-v1'` row whose slice no
 *             longer equals `text` must NOT be silently trusted.
 *
 * Constraints:
 *   - Pure TypeScript. No DOM, no React Native, no Obsidian imports.
 *   - No mutation of caller-provided highlight objects.
 *   - No side-effects (write-back scheduling is the caller's job; this module
 *     only tells them *which* highlights are eligible).
 *   - Clients (mobile / share-web / desktop / plugin) wire this module in a
 *     follow-up task. This file exposes the primitives; it does not schedule
 *     the network write itself.
 */
import type { CoordinateVersionDetection, DualReadArchiveInput, RangeResolveResult, RenderedHighlight, TextHighlight } from './types';
/**
 * Classify a stored highlight's coordinate version by probing `fullText`.
 *
 * This is the PRD §5.3 3-tier public surface. Implementation internally uses
 * the 4-state model; the `soft-canonical-missing-version` state is exposed
 * as `'fulltext-v1'` because renderers paint both classes with the stored
 * offsets.
 *
 * Call this when you want to report telemetry or decide how to display a
 * migration badge. For the full pipeline (re-anchor + write-back gating)
 * prefer {@link loadHighlightsForRender}.
 *
 * @example
 *   const version = detectCoordinateVersion(h, fullText);
 *   if (version === 'wrong-canonical-v2') log.warn('needs-reanchor', h.id);
 */
export declare function detectCoordinateVersion(highlight: TextHighlight, fullText: string): CoordinateVersionDetection;
/**
 * Determine whether a highlight's re-anchor result is safe to write-back to
 * the canonical `{ schemaVersion: 2, coordinateVersion: 'fulltext-v1' }` shape.
 *
 * Rules (PRD §5.5):
 *   - `exact` tier → always eligible (the stored slice matched already; the
 *     write-back is the persistence of the version tag).
 *   - `strong` tier → eligible iff `confidence >= 0.95` AND
 *     `candidateCount === 1` (unique high-confidence anchor).
 *   - `weak` / `fail` → never eligible. False positives here are
 *     misplacements, which the PRD's "silent손상 제로" rule prohibits.
 *
 * The `detection` argument is accepted as an advisory input — the PRD states
 * wrong-canonical v2 is *always* a write-back candidate **when re-resolve
 * succeeds**. "Succeeds" here maps onto the same exact / strong+unique bar,
 * so the rule shape is identical regardless of detection. Callers may pass
 * the detection for logging but the gate is derived from `resolved` alone.
 */
export declare function isWriteBackEligible(resolved: RangeResolveResult, 
/** Advisory; kept for call-site clarity + telemetry. Unused by the gate. */
_detection?: CoordinateVersionDetection): boolean;
/**
 * Options accepted by {@link loadHighlightsForRender}. Split out so that
 * callers can extend this with logger hooks / telemetry injection in the
 * future without breaking the positional signature.
 */
export interface LoadHighlightsForRenderOptions {
    /** Canonical body-only fullText (see §5.4 preamble). */
    fullText: string;
    /** Archive input wrapping the highlights collection. */
    archive: DualReadArchiveInput;
}
/**
 * Result of the dual-read pipeline. `rendered` is the list the client
 * renderer consumes (preserves input order for deterministic layouts);
 * `writeBackCandidates` is the subset the client should persist back as
 * canonical `{schemaVersion: 2, coordinateVersion: 'fulltext-v1'}` records
 * (subject to per-client write-back policy — see §5.5 matrix).
 */
export interface LoadHighlightsForRenderResult {
    rendered: RenderedHighlight[];
    writeBackCandidates: TextHighlight[];
}
/**
 * Dual-read entry point (PRD §5.4).
 *
 * Pipeline:
 *   1. Classify every stored highlight via the 4-state runtime heuristic.
 *   2. `canonical-trusted` rows render with stored offsets, no resolver call.
 *   3. Any other state triggers {@link resolveHighlightRange}. Successful
 *      re-anchors (`exact` OR strong+unique+confident) render with the
 *      resolved offsets AND become write-back candidates.
 *   4. Anything below the write-back bar renders as `unresolved-migration`
 *      (the renderer skips inline mark but preserves the raw record).
 *
 * The caller is responsible for the actual batched + debounced + offline-safe
 * write-back transport (§5.5). This function only identifies candidates.
 */
export declare function loadHighlightsForRender(options: LoadHighlightsForRenderOptions): LoadHighlightsForRenderResult;
/**
 * Pre-anchored highlight used by render-variant UIs (PRD §5.4.1):
 *   - timeline cards
 *   - archive list snippets
 *   - search result previews
 *
 * The canonical fullText offsets can't be sliced into the truncated preview
 * string directly — the preview is a different coordinate frame. Instead we
 * re-anchor against `viewText` and only paint matches that are safe to show
 * (exact OR strong+unique). Weak / fail results are skipped entirely because
 * false positives are especially loud on short previews.
 *
 * Returned highlights contain `startOffset` / `endOffset` relative to
 * `viewText` so the caller can feed them straight into the existing
 * `splitTextByHighlights` helper on each client.
 */
export declare function buildPreAnchoredHighlights(highlights: readonly TextHighlight[], viewText: string): TextHighlight[];
//# sourceMappingURL=dual-read.d.ts.map