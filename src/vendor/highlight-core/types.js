/**
 * types.ts — Canonical highlight type definitions (PRD §4.3).
 *
 * All coordinate offsets in this module are UTF-16 code units relative to
 * `fullText` (the canonical, normalized text the renderer produces). Clients
 * that still operate in visible-text space (share-web DOM, legacy plugin)
 * MUST convert via {@link offsetVisibleToFull} / {@link offsetFullToVisible}
 * at the edge before interacting with these types.
 *
 * Reference: .taskmaster/docs/prd-highlight-sync-unification.md §4.3, §4.4, §5.2
 *
 * Invariants (see PRD §4.4):
 *   - `startOffset <= endOffset`
 *   - `endOffset <= fullText.length`
 *   - `fullText.slice(startOffset, endOffset) === text` in the "exact" tier
 *   - `contextBefore` / `contextAfter` are trimmed grapheme-aware so that
 *     combining marks are never split in the middle.
 *
 * Constraints for this package:
 *   - No DOM / no React Native imports.
 *   - No runtime dependencies beyond the TS stdlib (Int32Array, Intl.Segmenter ok).
 *   - Structural shape so consumers can extend via intersection.
 */
export {};
//# sourceMappingURL=types.js.map