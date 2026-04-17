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
import { resolveHighlightRange } from './highlight-utils';
/**
 * Write-back confidence floor for the STRONG tier. Must match
 * `isWriteBackEligible`. Kept as a module-local constant so the rule is
 * documented in one place.
 */
const STRONG_WRITE_BACK_MIN_CONFIDENCE = 0.95;
/**
 * Internal helper: mirror the PRD §5.4 `detectCoordinateState` pseudocode but
 * surface the 4-state model. {@link detectCoordinateVersion} is a thin wrapper
 * that collapses `soft-canonical-missing-version` → `'fulltext-v1'`.
 */
function detectRuntimeState(h, fullText) {
    // Guard: malformed offsets always collapse to legacy. The resolver treats
    // these as "proximity hints only" so the caller still gets a re-anchor pass.
    const { startOffset, endOffset } = h;
    const offsetsWellFormed = Number.isFinite(startOffset) &&
        Number.isFinite(endOffset) &&
        startOffset >= 0 &&
        endOffset >= startOffset &&
        endOffset <= fullText.length;
    if (h.coordinateVersion === 'fulltext-v1') {
        if (!offsetsWellFormed)
            return 'wrong-canonical-v2';
        return fullText.slice(startOffset, endOffset) === h.text
            ? 'canonical-trusted'
            : 'wrong-canonical-v2';
    }
    if (h.coordinateVersion === 'legacy-visible-v0') {
        return 'legacy-visible-v0';
    }
    // coordinateVersion is undefined → soft-canonical heuristic.
    if (!offsetsWellFormed)
        return 'legacy-visible-v0';
    const probe = fullText.slice(startOffset, endOffset);
    const hasContext = Boolean(h.contextBefore || h.contextAfter);
    const beforeOk = !h.contextBefore ||
        fullText.slice(Math.max(0, startOffset - h.contextBefore.length), startOffset) === h.contextBefore;
    const afterOk = !h.contextAfter ||
        fullText.slice(endOffset, endOffset + h.contextAfter.length) ===
            h.contextAfter;
    if (probe === h.text &&
        (h.schemaVersion === 2 || hasContext) &&
        (beforeOk || afterOk)) {
        return 'soft-canonical-missing-version';
    }
    return 'legacy-visible-v0';
}
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
export function detectCoordinateVersion(highlight, fullText) {
    const state = detectRuntimeState(highlight, fullText);
    if (state === 'canonical-trusted' || state === 'soft-canonical-missing-version') {
        return 'fulltext-v1';
    }
    if (state === 'wrong-canonical-v2')
        return 'wrong-canonical-v2';
    return 'legacy-visible-v0';
}
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
export function isWriteBackEligible(resolved, 
/** Advisory; kept for call-site clarity + telemetry. Unused by the gate. */
_detection) {
    if (resolved.status === 'exact')
        return true;
    if (resolved.status === 'strong') {
        return (resolved.confidence >= STRONG_WRITE_BACK_MIN_CONFIDENCE &&
            resolved.candidateCount === 1);
    }
    return false;
}
/**
 * Clone a highlight with post-resolution render coordinates applied. Returns
 * a *new* object — callers may mutate the clone safely.
 */
function projectResolved(highlight, rangeStart, rangeEnd, state, resolve) {
    return {
        ...highlight,
        rangeStart,
        rangeEnd,
        renderState: 'resolved',
        coordinateState: collapseRuntimeState(state),
        ...(resolve !== undefined ? { resolve } : {}),
    };
}
function projectUnresolved(highlight, state, resolve) {
    return {
        ...highlight,
        renderState: 'unresolved-migration',
        coordinateState: collapseRuntimeState(state),
        ...(resolve !== undefined ? { resolve } : {}),
    };
}
function collapseRuntimeState(state) {
    if (state === 'canonical-trusted' || state === 'soft-canonical-missing-version') {
        return 'fulltext-v1';
    }
    if (state === 'wrong-canonical-v2')
        return 'wrong-canonical-v2';
    return 'legacy-visible-v0';
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
export function loadHighlightsForRender(options) {
    const { archive, fullText } = options;
    const rendered = [];
    const writeBackCandidates = [];
    for (const raw of archive.highlights) {
        const state = detectRuntimeState(raw, fullText);
        // Fast path: stored offsets are already self-consistent canonical.
        if (state === 'canonical-trusted') {
            rendered.push(projectResolved(raw, raw.startOffset, raw.endOffset, state));
            continue;
        }
        // Every other state enters re-anchor territory.
        const resolved = resolveHighlightRange(raw, fullText);
        // soft-canonical-missing-version: PRD §5.4 special-cases this — when the
        // probe already matched AND the resolver confirms exact, we graduate the
        // record to canonical on write-back, but otherwise still fall back to the
        // generic eligibility rule.
        if (state === 'soft-canonical-missing-version' && resolved.status === 'exact') {
            rendered.push(projectResolved(raw, resolved.startOffset, resolved.endOffset, state, resolved));
            writeBackCandidates.push(buildCanonicalWriteBack(raw, resolved.startOffset, resolved.endOffset));
            continue;
        }
        if (isWriteBackEligible(resolved)) {
            rendered.push(projectResolved(raw, resolved.startOffset, resolved.endOffset, state, resolved));
            writeBackCandidates.push(buildCanonicalWriteBack(raw, resolved.startOffset, resolved.endOffset));
            continue;
        }
        // Below the bar → preserve as unresolved. Record lives on so a later
        // render (new fullText, new app version) can retry (§5.3).
        rendered.push(projectUnresolved(raw, state, resolved));
    }
    return { rendered, writeBackCandidates };
}
/**
 * Create the canonical form of a highlight for write-back (PRD §5.5).
 * Everything except the offsets, version tags, and `updatedAt` is carried
 * forward verbatim from the stored record.
 */
function buildCanonicalWriteBack(highlight, startOffset, endOffset) {
    return {
        ...highlight,
        startOffset,
        endOffset,
        schemaVersion: 2,
        coordinateVersion: 'fulltext-v1',
        updatedAt: new Date().toISOString(),
    };
}
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
export function buildPreAnchoredHighlights(highlights, viewText) {
    const out = [];
    for (const highlight of highlights) {
        if (!highlight.text)
            continue;
        const resolved = resolveHighlightRange(highlight, viewText);
        const eligible = resolved.status === 'exact' ||
            (resolved.status === 'strong' && resolved.candidateCount === 1);
        if (!eligible)
            continue;
        out.push({
            ...highlight,
            startOffset: resolved.startOffset,
            endOffset: resolved.endOffset,
        });
    }
    return out;
}
//# sourceMappingURL=dual-read.js.map