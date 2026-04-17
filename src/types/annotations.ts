/**
 * Annotation Types for Mobile Highlight & Notes Sync
 *
 * Shared type definitions for TextHighlight and UserNote objects
 * that are synced from the mobile app to Obsidian vault notes.
 *
 * These match the server-side types stored in user_archives.userHighlights
 * and user_archives.userNotes.
 */

// ============================================================================
// Highlight Color
// ============================================================================

/**
 * Supported highlight colors in the mobile app
 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';

// ============================================================================
// Coordinate / Schema Metadata
// ============================================================================

/**
 * Coordinate schema tag stored on each {@link TextHighlight}.
 *
 * - `'legacy-visible-v0'` — pre-Phase-2 highlights whose offsets are
 *   relative to the DOM visible-text (share-web) or mobile legacy
 *   visible-text. Requires re-anchoring + dual-read on read.
 * - `'fulltext-v1'` — Phase 2+ canonical offsets relative to `fullText`.
 *   Always written by new highlights.
 *
 * Mirrors `CoordinateVersion` in `src/vendor/highlight-core/types.ts` so that
 * the plugin's local `TextHighlight` is structurally compatible with the
 * canonical highlight-core interface.
 */
export type CoordinateVersion = 'legacy-visible-v0' | 'fulltext-v1';

/**
 * Render profile string (see `RenderProfile` in highlight-core). Duplicated as
 * a literal union here to avoid leaking a vendor import into the public type
 * module; values must stay in sync with `src/vendor/highlight-core/render-profile.ts`.
 */
export type HighlightRenderProfile =
  | 'social-plain'
  | 'structured-md'
  | 'web-article'
  | 'timeline-md';

// ============================================================================
// Text Highlight
// ============================================================================

/**
 * A text highlight applied to an archived post in the mobile app.
 *
 * startOffset / endOffset are character offsets into the post's plain-text
 * content. They are used for re-anchoring when inline body highlights are
 * supported (Phase 2). In MVP, the text and color are rendered in the
 * managed annotation block at the bottom of the note.
 */
export interface TextHighlight {
  /** Stable unique identifier for this highlight */
  id: string;
  /** The highlighted text fragment */
  text: string;
  /** Character offset of the highlight start in the source text */
  startOffset: number;
  /** Character offset of the highlight end in the source text */
  endOffset: number;
  /** Display color for the highlight */
  color: HighlightColor;
  /** Optional inline note attached to this specific highlight */
  note?: string;
  /** A few characters of context preceding the highlighted text (for re-anchoring) */
  contextBefore?: string;
  /** A few characters of context following the highlighted text (for re-anchoring) */
  contextAfter?: string;
  /**
   * Storage schema version (Phase 2.5).
   *
   * - `1` (or unset) — legacy row written before canonical offsets were
   *   enforced. Offsets may be relative to visible text with `==..==` marks.
   * - `2` — Phase 2+ row. Offsets and `contextBefore` / `contextAfter` are
   *   canonical (measured against text with `==..==` stripped).
   */
  schemaVersion?: 1 | 2;
  /**
   * Coordinate space tag. Phase 2+ writes MUST record `'fulltext-v1'`; older
   * rows may be missing or explicitly `'legacy-visible-v0'`.
   */
  coordinateVersion?: CoordinateVersion;
  /**
   * Render profile in effect when the highlight was created. Used by Phase 3
   * dual-read to reproduce the exact fullText for re-anchoring.
   */
  createdProfile?: HighlightRenderProfile;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-updated timestamp */
  updatedAt: string;
}

// ============================================================================
// User Note
// ============================================================================

/**
 * A free-form note the user attached to an archived post in the mobile app.
 *
 * UserNotes are distinct from TextHighlight.note — they are standalone
 * notes about the entire archived post, not anchored to a specific passage.
 */
export interface UserNote {
  /** Stable unique identifier for this note */
  id: string;
  /** Free-form note content (may be multiline) */
  content: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-updated timestamp */
  updatedAt: string;
}
