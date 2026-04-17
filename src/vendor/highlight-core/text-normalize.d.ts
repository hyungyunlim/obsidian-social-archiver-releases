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
/**
 * Normalize the input to Unicode NFC (Canonical Composition).
 *
 * NFC is the canonical form the highlight coordinate system standardizes on
 * so that precomposed (`é` U+00E9) and decomposed (`e` + U+0301) forms produce
 * identical offsets. Idempotent.
 */
export declare function normalizeToNfc(input: string): string;
/** Alias for {@link normalizeToNfc} kept for PRD §4.15 API parity. */
export declare const toNFC: typeof normalizeToNfc;
/**
 * Convert CRLF (`\r\n`) and lone CR (`\r`) to LF (`\n`).
 *
 * Done in two passes (`\r\n` → `\n`, then `\r` → `\n`) so a solitary CR at
 * end-of-file is still collapsed. Idempotent.
 */
export declare function normalizeLineEndings(input: string): string;
/** Alias for {@link normalizeLineEndings} kept for PRD §4.15 API parity. */
export declare const crlfToLf: typeof normalizeLineEndings;
/**
 * Strip a leading UTF-8 BOM (U+FEFF) if present. Does not touch interior
 * occurrences because U+FEFF as a ZERO WIDTH NO-BREAK SPACE can be
 * meaningful mid-string. Idempotent.
 */
export declare function stripBom(input: string): string;
/** Alias for {@link stripBom} kept for PRD §4.15 API parity. */
export declare const stripBOM: typeof stripBom;
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
export declare function normalizeForCanonical(input: string): string;
/**
 * Alias exported under the PRD §4.2 public API name. Consumers should import
 * `normalizeText` from the package barrel; this file-level name is kept for
 * the explicit "canonical" spelling used in internal call sites.
 */
export declare const normalizeText: typeof normalizeForCanonical;
/**
 * Minimal structural shape of `Intl.Segmenter` used here. We avoid the
 * lib.dom / lib.es2022.intl type dependency because this package targets
 * ES2020 to stay compatible with the Obsidian plugin vendor copy.
 */
interface GraphemeSegmenterLike {
    segment(s: string): Iterable<{
        segment: string;
        index: number;
    }>;
}
/**
 * Lazily construct (and cache) an `Intl.Segmenter` with `granularity:
 * 'grapheme'`. Returns `null` on engines that lack the API (older Node,
 * some RN runtimes) so callers can fall back gracefully.
 */
export declare function graphemeSegmenter(): GraphemeSegmenterLike | null;
/**
 * Best-effort grapheme count. Uses `Intl.Segmenter` when available, falls
 * back to a naive code-point iterator (`Array.from(s).length`) otherwise.
 *
 * NOTE: This is a *convenience* helper for trimming context windows — true
 * grapheme-aware offset math is the responsibility of `highlight-utils.ts`
 * which consumes this alongside NFC strings.
 */
export declare function graphemeLength(input: string): number;
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
export declare function splitAtCodeUnit(input: string, offset: number): [string, string];
/**
 * Test-only hook: reset the cached `Intl.Segmenter` instance. Exported so
 * unit tests can exercise the fallback branch without polluting the module
 * cache for subsequent tests.
 *
 * @internal
 */
export declare function __resetGraphemeSegmenterCache(): void;
export {};
//# sourceMappingURL=text-normalize.d.ts.map