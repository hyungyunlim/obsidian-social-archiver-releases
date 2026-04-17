/**
 * text-normalize.ts — Unicode / line-ending / BOM normalization helpers
 *
 * Canonical text entering the highlight pipeline must be NFC-normalized,
 * LF-terminated, and BOM-free so that UTF-16 offsets are reproducible across
 * clients. These helpers are the single source of truth for that contract.
 *
 * Reference: .taskmaster/docs/prd-highlight-sync-unification.md §4.14, §4.15 (task 4)
 *
 * All helpers are:
 *   - idempotent: `fn(fn(x)) === fn(x)`
 *   - pure: no global state, no DOM, no RN
 *   - null-safe: empty string in → empty string out (no null check required)
 */
// ---------------------------------------------------------------------------
// Primitive normalizers
// ---------------------------------------------------------------------------
/**
 * Normalize the input to Unicode NFC (Canonical Composition).
 *
 * NFC is the canonical form the highlight coordinate system standardizes on
 * so that precomposed (`é` U+00E9) and decomposed (`e` + U+0301) forms produce
 * identical offsets. Idempotent.
 */
export function normalizeToNfc(input) {
    if (input.length === 0)
        return input;
    return input.normalize('NFC');
}
/** Alias for {@link normalizeToNfc} kept for PRD §4.15 API parity. */
export const toNFC = normalizeToNfc;
/**
 * Convert CRLF (`\r\n`) and lone CR (`\r`) to LF (`\n`).
 *
 * Done in two passes (`\r\n` → `\n`, then `\r` → `\n`) so a solitary CR at
 * end-of-file is still collapsed. Idempotent.
 */
export function normalizeLineEndings(input) {
    if (input.length === 0)
        return input;
    return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
/** Alias for {@link normalizeLineEndings} kept for PRD §4.15 API parity. */
export const crlfToLf = normalizeLineEndings;
/**
 * Strip a leading UTF-8 BOM (U+FEFF) if present. Does not touch interior
 * occurrences because U+FEFF as a ZERO WIDTH NO-BREAK SPACE can be
 * meaningful mid-string. Idempotent.
 */
export function stripBom(input) {
    if (input.length === 0)
        return input;
    return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}
/** Alias for {@link stripBom} kept for PRD §4.15 API parity. */
export const stripBOM = stripBom;
// ---------------------------------------------------------------------------
// Composite entry point
// ---------------------------------------------------------------------------
/**
 * Canonical normalization pipeline applied before any fullText is stored or
 * fed into `buildVisibleToFullTextMap`:
 *
 *   1. strip leading UTF-8 BOM
 *   2. CRLF → LF, lone CR → LF
 *   3. NFC compose
 *
 * Idempotent: `normalizeForCanonical(normalizeForCanonical(x)) === normalizeForCanonical(x)`.
 */
export function normalizeForCanonical(input) {
    if (input.length === 0)
        return input;
    return normalizeToNfc(normalizeLineEndings(stripBom(input)));
}
/**
 * Alias exported under the PRD §4.2 public API name. Consumers should import
 * `normalizeText` from the package barrel; this file-level name is kept for
 * the explicit "canonical" spelling used in internal call sites.
 */
export const normalizeText = normalizeForCanonical;
let cachedGraphemeSegmenter;
/**
 * Lazily construct (and cache) an `Intl.Segmenter` with `granularity:
 * 'grapheme'`. Returns `null` on engines that lack the API (older Node,
 * some RN runtimes) so callers can fall back gracefully.
 */
export function graphemeSegmenter() {
    if (cachedGraphemeSegmenter !== undefined) {
        return cachedGraphemeSegmenter;
    }
    // Intl.Segmenter may be absent at compile time (lib: ES2020) so probe at runtime.
    const IntlRef = globalThis.Intl;
    const Segmenter = IntlRef?.Segmenter;
    if (typeof Segmenter === 'function') {
        try {
            const Ctor = Segmenter;
            cachedGraphemeSegmenter = new Ctor(undefined, { granularity: 'grapheme' });
        }
        catch {
            cachedGraphemeSegmenter = null;
        }
    }
    else {
        cachedGraphemeSegmenter = null;
    }
    return cachedGraphemeSegmenter;
}
/**
 * Best-effort grapheme count. Uses `Intl.Segmenter` when available, falls
 * back to a naive code-point iterator (`Array.from(s).length`) otherwise.
 *
 * NOTE: This is a *convenience* helper for trimming context windows — true
 * grapheme-aware offset math is the responsibility of `highlight-utils.ts`
 * which consumes this alongside NFC strings.
 */
export function graphemeLength(input) {
    if (input.length === 0)
        return 0;
    const segmenter = graphemeSegmenter();
    if (segmenter !== null) {
        let count = 0;
        // Iterator yields { segment, index, ... } — we only need the count.
        for (const _ of segmenter.segment(input)) {
            void _;
            count++;
        }
        return count;
    }
    return Array.from(input).length;
}
/**
 * Split a string at a UTF-16 code-unit boundary. Does NOT attempt to respect
 * surrogate pairs — callers that require grapheme-aware splitting should use
 * `Intl.Segmenter` themselves. Exists as an explicit, documented helper so
 * that code-unit splits in the codebase are never ambiguous about their
 * semantics.
 *
 * WARNING: If `offset` lands inside a UTF-16 surrogate pair the resulting
 * halves will contain an unpaired surrogate. This matches the canonical
 * UTF-16 offset semantics used throughout the highlight pipeline (which is
 * itself UTF-16-addressed) and is intentional.
 */
export function splitAtCodeUnit(input, offset) {
    if (offset <= 0)
        return ['', input];
    if (offset >= input.length)
        return [input, ''];
    return [input.slice(0, offset), input.slice(offset)];
}
/**
 * Test-only hook: reset the cached `Intl.Segmenter` instance. Exported so
 * unit tests can exercise the fallback branch without polluting the module
 * cache for subsequent tests.
 *
 * @internal
 */
export function __resetGraphemeSegmenterCache() {
    cachedGraphemeSegmenter = undefined;
}
//# sourceMappingURL=text-normalize.js.map