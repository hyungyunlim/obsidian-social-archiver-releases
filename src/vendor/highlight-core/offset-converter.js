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
/**
 * visibleOffset → fullOffset.
 *
 * @param map           Map produced by `buildVisibleToFullTextMap`.
 * @param visibleOffset Must be in [0, visibleText.length].
 * @throws RangeError   When visibleOffset is out of range.
 */
export function offsetVisibleToFull(map, visibleOffset) {
    const len = map.visibleText.length;
    if (!Number.isInteger(visibleOffset) || visibleOffset < 0 || visibleOffset > len) {
        throw new RangeError(`[offsetVisibleToFull] visibleOffset=${visibleOffset} out of [0, ${len}]`);
    }
    if (visibleOffset === len)
        return map.fullText.length;
    return map.visibleToFull[visibleOffset];
}
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
export function offsetFullToVisible(map, fullOffset, direction = 'floor') {
    const len = map.fullText.length;
    if (!Number.isInteger(fullOffset) || fullOffset < 0 || fullOffset > len) {
        throw new RangeError(`[offsetFullToVisible] fullOffset=${fullOffset} out of [0, ${len}]`);
    }
    if (fullOffset === len) {
        // Sentinel — return the visible-text end sentinel.
        return map.visibleText.length;
    }
    const direct = map.fullToVisible[fullOffset];
    if (direct >= 0)
        return direct;
    if (direction === 'ceil') {
        for (let j = fullOffset + 1; j < len; j++) {
            const v = map.fullToVisible[j];
            if (v >= 0)
                return v;
        }
        return map.visibleText.length;
    }
    // floor
    for (let j = fullOffset - 1; j >= 0; j--) {
        const v = map.fullToVisible[j];
        if (v >= 0)
            return v + 1; // +1 → position *after* the last visible char
    }
    return 0;
}
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
export function resolveVisibleStart(fullOffset, fullToVisible, fullEndBound) {
    if (fullOffset < 0 || fullOffset >= fullToVisible.length)
        return -1;
    const direct = fullToVisible[fullOffset];
    if (direct >= 0)
        return direct;
    const limit = Math.min(fullEndBound, fullToVisible.length);
    for (let i = fullOffset + 1; i < limit; i++) {
        const v = fullToVisible[i];
        if (v >= 0)
            return v;
    }
    return -1;
}
/**
 * Resolve the backward-visible offset at or before `fullOffset` (for a range
 * end).  Searches forward first, then backward — matches mobile behavior.
 *
 * @param fullOffset     Full-text offset (exclusive end).
 * @param fullToVisible  Lookup array from the map.
 * @param fullStartBound Lower bound (inclusive) — caller's start offset.
 * @returns visible index or −1 if no neighbor exists within the bound.
 */
export function resolveVisibleEnd(fullOffset, fullToVisible, fullStartBound) {
    if (fullOffset < 0)
        return -1;
    if (fullOffset >= fullToVisible.length) {
        // Past the end → use the last visible position + 1.
        for (let i = fullToVisible.length - 1; i >= fullStartBound && i >= 0; i--) {
            const v = fullToVisible[i];
            if (v >= 0)
                return v + 1;
        }
        return -1;
    }
    const direct = fullToVisible[fullOffset];
    if (direct >= 0)
        return direct;
    for (let i = fullOffset + 1; i < fullToVisible.length; i++) {
        const v = fullToVisible[i];
        if (v >= 0)
            return v;
    }
    for (let i = fullOffset - 1; i >= Math.max(0, fullStartBound); i--) {
        const v = fullToVisible[i];
        if (v >= 0)
            return v + 1;
    }
    return -1;
}
//# sourceMappingURL=offset-converter.js.map