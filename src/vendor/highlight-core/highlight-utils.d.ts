/**
 * highlight-utils.ts — 4-tier highlight resolver + context builder.
 *
 * Ported from `mobile-app/src/utils/highlight-utils.ts` with the following
 * upgrades required by PRD §4.3 / §4.5:
 *
 *   1. `resolveHighlightRange` now returns a full `RangeResolveResult`
 *      (status, startOffset, endOffset, shift, tier, confidence, candidateCount)
 *      so that callers can make write-back decisions without re-inspecting the
 *      match themselves. Previously it returned `{start,end} | null`.
 *
 *   2. A 4-tier strategy is made explicit:
 *        Tier 1 — EXACT       (confidence 1.0)
 *        Tier 2 — STRONG      (contextBefore + text + contextAfter anchor)
 *                             confidence ≥ 0.95 when unique, ≤ 0.6 if ambiguous
 *        Tier 3 — WEAK        (text-only; disambiguated by proximity + context
 *                              similarity, NOT Levenshtein)
 *        Tier 0 — FAIL
 *
 *   3. Proximity search: `candidateStart − originalStart` is used both to
 *      prefer the nearer candidate and to rank STRONG candidates deterministic-
 *      ally when multiple anchor matches exist (see PRD §4.5 memo).
 *
 *   4. `buildHighlightContext` returns a `HighlightContext` object ({before,
 *      after, text}) rather than the legacy `{contextBefore, contextAfter}`
 *      shape. The legacy field names still describe what the slices contain;
 *      the rename is purely to align with the canonical type in PRD §4.3.
 *
 * Constraints preserved from the mobile source:
 *   - pure function, no DOM / RN
 *   - grapheme-safe trimming at context window edges (never split a surrogate
 *     pair or combining sequence)
 *   - exact-tier failure treats stored offsets as *proximity hints only*, so
 *     Phase 3 legacy migration can rely on `shift` + `confidence`
 */
import type { HighlightContext, RangeResolveResult, TextHighlight } from './types';
/**
 * Context window size for re-anchoring. This constant is **load-bearing** —
 * plugin Phase 1 (`HighlightBodyMarker`) and the mobile reader both assume 30.
 * See PRD §4.6.
 */
export declare const CONTEXT_WINDOW = 30;
/**
 * Collect every offset at which `needle` occurs in `haystack` (non-overlapping
 * scan from left to right). Returns `[]` for empty needle or no matches.
 *
 * Pure helper exposed for tests and tie-breakers.
 */
export declare function collectMatchIndices(haystack: string, needle: string): number[];
/**
 * Score a STRONG/WEAK candidate by how well it aligns with the stored context
 * surrounding the ORIGINAL offset. **Lower is better.**
 *
 * Signals (weighted):
 *   a) proximity           — Manhattan distance between candidateStart and
 *                            the stored startOffset.
 *   b) contextBefore match — count of trailing chars of contextBefore that
 *                            match immediately before the candidate.
 *   c) contextAfter match  — count of leading chars of contextAfter that
 *                            match immediately after the candidate end.
 *
 * We return `proximity − 1000 × (beforeScore + afterScore)` so that one
 * additional matching context char always outweighs 1000 chars of distance.
 * Ties are broken by the smaller candidateStart (scan order).
 */
export declare function scoreHighlightCandidate(fullText: string, highlight: TextHighlight, candidateStart: number): number;
/**
 * Build context strings around a highlight range for re-anchoring.
 * Returns `{before, after, text}` per PRD §4.3. Slices are clamped to the
 * document edges and adjusted to valid UTF-16 code-point boundaries.
 */
export declare function buildHighlightContext(fullText: string, startOffset: number, endOffset: number): HighlightContext;
/**
 * Re-anchor a stored highlight onto the current `fullText`. See file header.
 */
export declare function resolveHighlightRange(highlight: TextHighlight, fullText: string): RangeResolveResult;
//# sourceMappingURL=highlight-utils.d.ts.map