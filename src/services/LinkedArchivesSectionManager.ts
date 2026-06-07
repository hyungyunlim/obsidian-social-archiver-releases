/**
 * LinkedArchivesSectionManager
 *
 * Single Responsibility: Insert, replace, or remove the managed
 * "Linked archives" block in an Obsidian note's markdown string.
 *
 * The block is delimited by HTML comment markers:
 *   <!-- social-archiver:linked-archives:start -->
 *   <!-- social-archiver:linked-archives:end -->
 *
 * All content outside these markers is preserved exactly as-is. This is a
 * structural clone of {@link AnnotationSectionManager} with a different marker
 * pair — kept as a separate class so each block has its own marker namespace
 * and the two section managers can coexist in the same file (the linked-archives
 * block is appended AFTER the annotations block at EOF).
 *
 * Pure utility — no Obsidian API dependency, no network calls.
 */

// ─── Constants ───────────────────────────────────────────

const START_MARKER = '<!-- social-archiver:linked-archives:start -->';
const END_MARKER = '<!-- social-archiver:linked-archives:end -->';

// ─── Manager ─────────────────────────────────────────────

export class LinkedArchivesSectionManager {
  /**
   * Upsert the managed linked-archives block in a document string.
   *
   * Behaviour:
   * - **Insert**: No markers present → append the block at the end.
   * - **Replace**: Both markers found → replace everything between them
   *   (inclusive) with the new block.
   * - **Remove**: `block` is empty string and markers exist → remove the
   *   markers and all content between them.
   * - **Malformed** (only start marker, no end marker): Treat as no markers
   *   present and append. This avoids silent partial-block corruption.
   *
   * @param document  The full current content of the markdown file.
   * @param block     The new block string (from LinkedArchivesRenderer.render()).
   *                  Pass empty string to remove the block.
   * @returns The updated document string.
   */
  upsert(document: string, block: string): string {
    const startIdx = document.indexOf(START_MARKER);
    const endIdx = document.indexOf(END_MARKER);

    const hasStart = startIdx !== -1;
    const hasEnd = endIdx !== -1;

    const hasValidBlock = hasStart && hasEnd && startIdx < endIdx;
    const hasMalformed = hasStart && !hasEnd;

    if (!hasValidBlock || hasMalformed) {
      // No managed block found (or malformed → ignore it and append fresh)
      if (block === '') {
        return document;
      }
      const trimmed = document.trimEnd();
      return trimmed + '\n\n' + block;
    }

    // ── Valid markers found ──

    const before = document.slice(0, startIdx).trimEnd();
    const afterMarkerEnd = endIdx + END_MARKER.length;
    const after = document.slice(afterMarkerEnd);

    if (block === '') {
      const afterTrimmed = after.replace(/^\n+/, '');
      if (afterTrimmed.length > 0) {
        return before + '\n\n' + afterTrimmed;
      }
      return before;
    }

    const afterTrimmed = after.replace(/^\n+/, '');
    if (afterTrimmed.length > 0) {
      return before + '\n\n' + block + '\n\n' + afterTrimmed;
    }
    return before + '\n\n' + block;
  }
}
