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
