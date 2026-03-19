/**
 * AnnotationSectionManager
 *
 * Single Responsibility: Insert, replace, or remove the managed
 * "Mobile Annotations" block in an Obsidian note's markdown string.
 *
 * The block is delimited by HTML comment markers:
 *   <!-- social-archiver:annotations:start -->
 *   <!-- social-archiver:annotations:end -->
 *
 * All content outside these markers is preserved exactly as-is.
 *
 * This is a pure utility — no Obsidian API dependency, no network calls.
 */

// ─── Constants ───────────────────────────────────────────

const START_MARKER = '<!-- social-archiver:annotations:start -->';
const END_MARKER = '<!-- social-archiver:annotations:end -->';

// ─── Manager ─────────────────────────────────────────────

export class AnnotationSectionManager {
  /**
   * Upsert the managed annotation block in a document string.
   *
   * Behaviour:
   * - **Insert**: No markers present → append the block at the end.
   * - **Replace**: Both markers found → replace everything between them
   *   (inclusive) with the new block.
   * - **Remove**: `annotationBlock` is empty string and markers exist →
   *   remove the markers and all content between them.
   * - **Malformed** (only start marker, no end marker): Treat as no markers
   *   present and append. This avoids silent partial-block corruption.
   *
   * @param document      The full current content of the markdown file.
   * @param annotationBlock  The new block string (from AnnotationRenderer.render()).
   *                         Pass empty string to remove the block.
   * @returns The updated document string.
   */
  upsert(document: string, annotationBlock: string): string {
    const startIdx = document.indexOf(START_MARKER);
    const endIdx = document.indexOf(END_MARKER);

    const hasStart = startIdx !== -1;
    const hasEnd = endIdx !== -1;

    // ── Malformed: only start, no end → treat as no markers ──
    const hasValidBlock = hasStart && hasEnd && startIdx < endIdx;
    const hasMalformed = hasStart && !hasEnd;

    if (!hasValidBlock || hasMalformed) {
      // No managed block found (or malformed → ignore it and append fresh)
      if (annotationBlock === '') {
        // Nothing to insert
        return document;
      }
      // Append: ensure a single newline separator before the block
      const trimmed = document.trimEnd();
      return trimmed + '\n\n' + annotationBlock;
    }

    // ── Valid markers found ──

    // Everything before the start marker (trimmed of trailing whitespace)
    const before = document.slice(0, startIdx).trimEnd();
    // Everything after the end marker
    const afterMarkerEnd = endIdx + END_MARKER.length;
    const after = document.slice(afterMarkerEnd);

    if (annotationBlock === '') {
      // Remove: drop the entire managed block section
      // Preserve the content that follows (strip leading newlines from `after`
      // so we don't leave double blank lines but keep any content after)
      const afterTrimmed = after.replace(/^\n+/, '');
      if (afterTrimmed.length > 0) {
        return before + '\n\n' + afterTrimmed;
      }
      return before;
    }

    // Replace: stitch before + new block + after
    const afterTrimmed = after.replace(/^\n+/, '');
    if (afterTrimmed.length > 0) {
      return before + '\n\n' + annotationBlock + '\n\n' + afterTrimmed;
    }
    return before + '\n\n' + annotationBlock;
  }
}
