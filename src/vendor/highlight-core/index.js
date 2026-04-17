/**
 * @social-archiver/highlight-core — Public API barrel
 *
 * Reference: .taskmaster/docs/prd-highlight-sync-unification.md §4.2
 *
 * Agent task split (see PRD §4.15):
 *   - Agent A → types.ts, render-profile.ts, text-normalize.ts
 *   - Agent B → markdown-visible-text.ts, offset-converter.ts
 *   - Agent C → highlight-utils.ts, context-window.ts
 *   - Phase 3 → dual-read.ts
 *
 * Keep the exports grouped by owning agent so parallel edits don't conflict.
 */
// ===========================================================================
// Agent A — types + render profile + text normalization
// ===========================================================================
// Render profile (value + type)
export { RenderProfile, RENDER_PROFILE_CONFIG, getRenderProfileForArchive } from './render-profile';
// Text normalization helpers (PRD §4.2 public name is `normalizeText`)
export { normalizeText, normalizeForCanonical, normalizeToNfc, toNFC, normalizeLineEndings, crlfToLf, stripBom, stripBOM, graphemeLength, graphemeSegmenter, splitAtCodeUnit, } from './text-normalize';
// ===========================================================================
// Agent B — markdown visible-text + offset converters
// ===========================================================================
export { ARTICLE_TITLE_BODY_SEPARATOR, MEDIA_PLACEHOLDER, alignVisibleTextToFullText, buildVisibleToFullTextMap, computeFullText, extractVisibleText, referenceRenderToVisible, } from './markdown-visible-text';
export { offsetFullToVisible, offsetVisibleToFull, resolveVisibleEnd, resolveVisibleStart, } from './offset-converter';
// ===========================================================================
// Agent C — highlight resolution + context window
// ===========================================================================
// CONTEXT_WINDOW is co-located with highlight-utils.ts per PRD §4.2 memo
// ("If you prefer to co-locate it with `types.ts`, update the export line
// accordingly — but keep the public specifier stable."). Co-located next
// to resolveHighlightRange because the resolver is the sole constant consumer.
export { CONTEXT_WINDOW, buildHighlightContext, collectMatchIndices, resolveHighlightRange, scoreHighlightCandidate, } from './highlight-utils';
// ===========================================================================
// Phase 3 — Dual-read + coordinate-version detection (see src/dual-read.ts)
// ===========================================================================
export { buildPreAnchoredHighlights, detectCoordinateVersion, isWriteBackEligible, loadHighlightsForRender, } from './dual-read';
//# sourceMappingURL=index.js.map