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
export { RenderProfile, RENDER_PROFILE_CONFIG, getRenderProfileForArchive } from './render-profile';
export type { ProfileConfig, RenderProfileArchiveInput } from './render-profile';
export type { CoordinateVersion, CoordinateVersionDetection, DualReadArchiveInput, HighlightContext, TextHighlight, RangeResolveStatus, RangeResolveResult, VisibleFullTextMap, RenderedHighlight, } from './types';
export { normalizeText, normalizeForCanonical, normalizeToNfc, toNFC, normalizeLineEndings, crlfToLf, stripBom, stripBOM, graphemeLength, graphemeSegmenter, splitAtCodeUnit, } from './text-normalize';
export { ARTICLE_TITLE_BODY_SEPARATOR, MEDIA_PLACEHOLDER, alignVisibleTextToFullText, buildVisibleToFullTextMap, computeFullText, extractVisibleText, referenceRenderToVisible, } from './markdown-visible-text';
export type { VisibleFullTextAlignment } from './markdown-visible-text';
export { offsetFullToVisible, offsetVisibleToFull, resolveVisibleEnd, resolveVisibleStart, } from './offset-converter';
export { CONTEXT_WINDOW, buildHighlightContext, collectMatchIndices, resolveHighlightRange, scoreHighlightCandidate, } from './highlight-utils';
export { buildPreAnchoredHighlights, detectCoordinateVersion, isWriteBackEligible, loadHighlightsForRender, } from './dual-read';
export type { LoadHighlightsForRenderOptions, LoadHighlightsForRenderResult, } from './dual-read';
//# sourceMappingURL=index.d.ts.map