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
/**
 * Context window size for re-anchoring. This constant is **load-bearing** —
 * plugin Phase 1 (`HighlightBodyMarker`) and the mobile reader both assume 30.
 * See PRD §4.6.
 */
export const CONTEXT_WINDOW = 30;
/** Proximity search radius (chars) for STRONG/WEAK candidate preference. */
const PROXIMITY_WINDOW = 2000;
/**
 * Collect every offset at which `needle` occurs in `haystack` (non-overlapping
 * scan from left to right). Returns `[]` for empty needle or no matches.
 *
 * Pure helper exposed for tests and tie-breakers.
 */
export function collectMatchIndices(haystack, needle) {
    if (!needle)
        return [];
    const indices = [];
    let from = 0;
    while (from <= haystack.length) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1)
            break;
        indices.push(idx);
        from = idx + 1; // allow overlapping starts; `+1` is sufficient because we
        // only use indices to seed downstream scoring — the resolver itself
        // re-verifies the slice at the chosen start.
    }
    return indices;
}
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
export function scoreHighlightCandidate(fullText, highlight, candidateStart) {
    const originalStart = Math.max(0, highlight.startOffset | 0);
    const proximity = Math.abs(candidateStart - originalStart);
    const before = highlight.contextBefore ?? '';
    const after = highlight.contextAfter ?? '';
    let beforeScore = 0;
    if (before.length > 0 && candidateStart > 0) {
        // Compare suffix of `before` against prefix of `fullText` ending at
        // candidateStart. We walk backwards and count matches.
        const maxCompare = Math.min(before.length, candidateStart);
        for (let k = 1; k <= maxCompare; k += 1) {
            if (before[before.length - k] === fullText[candidateStart - k]) {
                beforeScore += 1;
            }
            else {
                break;
            }
        }
    }
    let afterScore = 0;
    const candidateEnd = candidateStart + highlight.text.length;
    if (after.length > 0 && candidateEnd < fullText.length) {
        const maxCompare = Math.min(after.length, fullText.length - candidateEnd);
        for (let k = 0; k < maxCompare; k += 1) {
            if (after[k] === fullText[candidateEnd + k]) {
                afterScore += 1;
            }
            else {
                break;
            }
        }
    }
    return proximity - 1000 * (beforeScore + afterScore);
}
/** Returns true if `idx` lies between a high and low surrogate. */
function isSurrogateSeam(s, idx) {
    if (idx <= 0 || idx >= s.length)
        return false;
    const hi = s.charCodeAt(idx - 1);
    const lo = s.charCodeAt(idx);
    return hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
}
/**
 * Walk `idx` outward until it no longer splits a surrogate pair. `direction`
 * is +1 (move end forward) or −1 (move start backward). Clamped to
 * [0, s.length]. This is a **minimal** grapheme-safe adjustment — combining
 * marks and ZWJ sequences are *not* specially handled because the resolver
 * operates on stored slices verbatim, so any in-grapheme split that existed at
 * write time will be preserved on read. The only case that truly breaks is a
 * split surrogate pair (invalid UTF-16), which we correct here.
 */
function clampToCodePointBoundary(s, idx, direction) {
    let i = Math.max(0, Math.min(s.length, idx));
    while (isSurrogateSeam(s, i)) {
        i += direction;
        if (i <= 0 || i >= s.length)
            break;
    }
    return Math.max(0, Math.min(s.length, i));
}
/**
 * Build context strings around a highlight range for re-anchoring.
 * Returns `{before, after, text}` per PRD §4.3. Slices are clamped to the
 * document edges and adjusted to valid UTF-16 code-point boundaries.
 */
export function buildHighlightContext(fullText, startOffset, endOffset) {
    const start = Math.max(0, Math.min(fullText.length, startOffset | 0));
    const end = Math.max(start, Math.min(fullText.length, endOffset | 0));
    const rawBeforeStart = start - CONTEXT_WINDOW;
    const rawAfterEnd = end + CONTEXT_WINDOW;
    const beforeStart = clampToCodePointBoundary(fullText, Math.max(0, rawBeforeStart), 1);
    const afterEnd = clampToCodePointBoundary(fullText, Math.min(fullText.length, rawAfterEnd), -1);
    return {
        before: fullText.slice(beforeStart, start),
        after: fullText.slice(end, afterEnd),
        text: fullText.slice(start, end),
    };
}
/** Result of the internal exact-slice check. */
function exactSliceMatches(highlight, fullText) {
    const { startOffset, endOffset, text } = highlight;
    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset))
        return false;
    if (startOffset < 0 || endOffset > fullText.length)
        return false;
    if (startOffset >= endOffset)
        return false;
    return fullText.slice(startOffset, endOffset) === text;
}
/** Confidence score for STRONG tier when candidate is unique. */
function strongUniqueConfidence(contextSignal) {
    // contextSignal = beforeScore + afterScore (matching chars on either side).
    //
    // Map:
    //   both sides full match (≥ 2 * CONTEXT_WINDOW − 4)   → 0.99
    //   both sides non-empty match (≥ 4)                   → 0.98
    //   any positive context match                         → 0.95
    //   no context chars matched (shouldn't reach here)    → 0.9
    if (contextSignal >= CONTEXT_WINDOW * 2 - 4)
        return 0.99;
    if (contextSignal >= 4)
        return 0.98;
    if (contextSignal >= 1)
        return 0.95;
    return 0.9;
}
/**
 * Compute the context signal (beforeScore + afterScore) for a candidate.
 * Shares the trailing/leading-match logic with `scoreHighlightCandidate` so
 * the two stay in sync.
 */
function computeContextSignal(fullText, highlight, candidateStart) {
    const before = highlight.contextBefore ?? '';
    const after = highlight.contextAfter ?? '';
    let beforeScore = 0;
    if (before.length > 0 && candidateStart > 0) {
        const maxCompare = Math.min(before.length, candidateStart);
        for (let k = 1; k <= maxCompare; k += 1) {
            if (before[before.length - k] === fullText[candidateStart - k])
                beforeScore += 1;
            else
                break;
        }
    }
    let afterScore = 0;
    const candidateEnd = candidateStart + highlight.text.length;
    if (after.length > 0 && candidateEnd < fullText.length) {
        const maxCompare = Math.min(after.length, fullText.length - candidateEnd);
        for (let k = 0; k < maxCompare; k += 1) {
            if (after[k] === fullText[candidateEnd + k])
                afterScore += 1;
            else
                break;
        }
    }
    return beforeScore + afterScore;
}
/**
 * Re-anchor a stored highlight onto the current `fullText`. See file header.
 */
export function resolveHighlightRange(highlight, fullText) {
    const textLen = highlight.text.length;
    const originalStart = Math.max(0, highlight.startOffset | 0);
    // ────────────────────────────────────────────────────────────────────────
    // Tier 1 — EXACT: the stored offsets still slice to the stored text.
    // ────────────────────────────────────────────────────────────────────────
    if (exactSliceMatches(highlight, fullText)) {
        return {
            status: 'exact',
            startOffset: highlight.startOffset,
            endOffset: highlight.endOffset,
            shift: 0,
            tier: 1,
            confidence: 1.0,
            candidateCount: 1,
        };
    }
    // If the stored text is empty we cannot anchor at all.
    if (!textLen) {
        return {
            status: 'fail',
            startOffset: highlight.startOffset,
            endOffset: highlight.endOffset,
            shift: 0,
            tier: 0,
            confidence: 0,
            candidateCount: 0,
        };
    }
    // ────────────────────────────────────────────────────────────────────────
    // Tier 2 — STRONG: contextBefore + text + contextAfter exact match.
    //
    // We iterate over *partial* anchors to stay robust when either side of the
    // context window was truncated at write time (document edges). The longest
    // anchor that still finds ≥1 match wins; among winners we rank by
    // `scoreHighlightCandidate` (proximity + context overlap).
    // ────────────────────────────────────────────────────────────────────────
    const before = highlight.contextBefore ?? '';
    const after = highlight.contextAfter ?? '';
    const strong = resolveStrong(fullText, highlight, before, after);
    if (strong)
        return strong;
    // ────────────────────────────────────────────────────────────────────────
    // Tier 3 — WEAK: text-only search, ranked by proximity + context overlap.
    // ────────────────────────────────────────────────────────────────────────
    const weakCandidates = collectMatchIndices(fullText, highlight.text);
    if (weakCandidates.length > 0) {
        const { bestStart } = pickBestCandidate(weakCandidates, fullText, highlight, originalStart);
        // Cap proximity: candidates farther than PROXIMITY_WINDOW + huge context
        // mismatch degrade confidence significantly.
        const proximity = Math.abs(bestStart - originalStart);
        const contextSignal = computeContextSignal(fullText, highlight, bestStart);
        // Confidence heuristic:
        //   single candidate + inside proximity window                 → 0.5
        //   single candidate outside proximity window                  → 0.35
        //   multiple candidates but unique via context (score < rest)  → 0.4
        //   multiple candidates, weak context signal                   → 0.2
        let confidence;
        if (weakCandidates.length === 1) {
            confidence = proximity <= PROXIMITY_WINDOW ? 0.5 : 0.35;
        }
        else if (contextSignal >= 1) {
            confidence = proximity <= PROXIMITY_WINDOW ? 0.45 : 0.3;
        }
        else {
            confidence = 0.2;
        }
        return {
            status: 'weak',
            startOffset: bestStart,
            endOffset: bestStart + textLen,
            shift: proximity,
            tier: 3,
            confidence,
            candidateCount: weakCandidates.length,
        };
    }
    // ────────────────────────────────────────────────────────────────────────
    // Tier 0 — FAIL: nothing found.
    // ────────────────────────────────────────────────────────────────────────
    return {
        status: 'fail',
        startOffset: highlight.startOffset,
        endOffset: highlight.endOffset,
        shift: 0,
        tier: 0,
        confidence: 0,
        candidateCount: 0,
    };
}
/**
 * STRONG-tier resolver. Tries the fullest anchor first, then drops the less
 * informative side when the fullest anchor produces zero matches. Returns
 * `null` if no STRONG tier anchor produces at least one match.
 */
function resolveStrong(fullText, highlight, before, after) {
    const textLen = highlight.text.length;
    const originalStart = Math.max(0, highlight.startOffset | 0);
    // Anchor candidates ordered by specificity (most specific first).
    const anchors = [];
    if (before && after) {
        anchors.push({ pattern: before + highlight.text + after, beforeLen: before.length, afterLen: after.length });
    }
    if (before) {
        anchors.push({ pattern: before + highlight.text, beforeLen: before.length, afterLen: 0 });
    }
    if (after) {
        anchors.push({ pattern: highlight.text + after, beforeLen: 0, afterLen: after.length });
    }
    for (const anchor of anchors) {
        const raw = collectMatchIndices(fullText, anchor.pattern);
        if (raw.length === 0)
            continue;
        // Translate anchor matches → candidate starts of the highlight text.
        const candidates = raw.map((i) => i + anchor.beforeLen);
        const { bestStart } = pickBestCandidate(candidates, fullText, highlight, originalStart);
        const proximity = Math.abs(bestStart - originalStart);
        const candidateCount = candidates.length;
        let confidence;
        if (candidateCount === 1) {
            const contextSignal = computeContextSignal(fullText, highlight, bestStart);
            confidence = strongUniqueConfidence(contextSignal);
        }
        else {
            // Multiple anchor matches → write-back MUST be gated off. PRD §5.4:
            // `isWriteBackEligible` needs confidence ≥ 0.95 AND candidateCount === 1.
            confidence = 0.6;
        }
        return {
            status: 'strong',
            startOffset: bestStart,
            endOffset: bestStart + textLen,
            shift: proximity,
            tier: 2,
            confidence,
            candidateCount,
        };
    }
    return null;
}
/**
 * Pick the best candidate start among `candidates` using
 * `scoreHighlightCandidate`. Tie-break: smaller candidate index (left-most).
 */
function pickBestCandidate(candidates, fullText, highlight, _originalStart) {
    let bestStart = candidates[0];
    let bestScore = scoreHighlightCandidate(fullText, highlight, bestStart);
    for (let i = 1; i < candidates.length; i += 1) {
        const c = candidates[i];
        const s = scoreHighlightCandidate(fullText, highlight, c);
        if (s < bestScore || (s === bestScore && c < bestStart)) {
            bestStart = c;
            bestScore = s;
        }
    }
    return { bestStart, bestScore };
}
//# sourceMappingURL=highlight-utils.js.map