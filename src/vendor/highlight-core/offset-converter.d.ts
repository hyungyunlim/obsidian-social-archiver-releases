/**
 * offset-converter.ts — visible ↔ full offset conversion
 *
 * PRD reference: `.taskmaster/docs/prd-highlight-sync-unification.md` §4.7.
 *
 * Lookup contract
 * ---------------
 *   map.visibleToFull[i] = fullIdx that anchors visible char i (always ≥ 0).
 *   map.fullToVisible[j] = visibleIdx that consumed full char j (−1 if none).
 *
 * Both calls are O(1) for "on-glyph" offsets — `offsetFullToVisible` may scan
 * linearly for a nearest visible neighbor when the offset lands on markdown
 * syntax.  That scan is bounded by the width of the widest syntactic island
 * (typically a handful of characters) and is the same strategy the mobile
 * `article-block-annotator.resolveVisibleStart / resolveVisibleEnd` helpers
 * use today.
 *
 * Endpoint semantics
 * ------------------
 * DOM `Range.endOffset` is *exclusive*.  To keep parity with selection APIs
 * the converters accept the sentinel `offset === length` and return the
 * corresponding end sentinel on the opposite side.
 */
import type { VisibleFullTextMap } from './types';
/**
 * visibleOffset → fullOffset.
 *
 * @param map           Map produced by `buildVisibleToFullTextMap`.
 * @param visibleOffset Must be in [0, visibleText.length].
 * @throws RangeError   When visibleOffset is out of range.
 */
export declare function offsetVisibleToFull(map: VisibleFullTextMap, visibleOffset: number): number;
/**
 * fullOffset → visibleOffset.
 *
 * When `fullOffset` points at a non-visible syntax char (fullToVisible = −1),
 * return the nearest visible offset according to `direction`:
 *   - 'floor' (default): largest visible index ≤ fullOffset (falls back to 0
 *                        if no visible char precedes the offset).
 *   - 'ceil':            smallest visible index ≥ fullOffset (falls back to
 *                        visibleText.length if no visible char follows).
 *
 * @throws RangeError when `fullOffset` is out of [0, fullText.length].
 */
export declare function offsetFullToVisible(map: VisibleFullTextMap, fullOffset: number, direction?: 'floor' | 'ceil'): number;
/**
 * Resolve the forward-visible offset at or after `fullOffset`.  Mirrors the
 * mobile helper in `article-block-annotator.ts` — used when a highlight start
 * lands on markdown syntax and we need to project it into visible coordinates
 * without overshooting the highlight's end.
 *
 * @param fullOffset   Full-text offset (inclusive start).
 * @param fullToVisible Lookup array from the map.
 * @param fullEndBound Upper bound (exclusive) — caller's end offset.
 * @returns visible index or −1 if no forward mapping exists within bound.
 */
export declare function resolveVisibleStart(fullOffset: number, fullToVisible: Int32Array, fullEndBound: number): number;
/**
 * Resolve the backward-visible offset at or before `fullOffset` (for a range
 * end).  Searches forward first, then backward — matches mobile behavior.
 *
 * @param fullOffset     Full-text offset (exclusive end).
 * @param fullToVisible  Lookup array from the map.
 * @param fullStartBound Lower bound (inclusive) — caller's start offset.
 * @returns visible index or −1 if no neighbor exists within the bound.
 */
export declare function resolveVisibleEnd(fullOffset: number, fullToVisible: Int32Array, fullStartBound: number): number;
//# sourceMappingURL=offset-converter.d.ts.map