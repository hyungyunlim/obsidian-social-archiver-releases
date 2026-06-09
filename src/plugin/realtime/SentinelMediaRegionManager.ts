/**
 * Sentinel media region manager.
 *
 * The plugin wraps the rendered media section of an embedded/archived post in
 * an HTML-comment-delimited region keyed by the archive id:
 *
 * ```markdown
 * <!-- sa:media:start id=ARCHIVEID -->
 * ![](attachments/...)
 * <!-- sa:media:end -->
 * ```
 *
 * Repair flows (e.g. `media_preserved` with status `repairable`) replace ONLY
 * the body inside the region for a given archive id, so hand-edits elsewhere in
 * the note are never clobbered. The note is re-scanned on every call because
 * users can freely edit notes between events.
 *
 * One region per embedded post archive id. If a region is not found,
 * {@link findRegion} / {@link replaceRegion} return `null` and the caller is
 * expected to append a non-destructive "review needed" callout rather than
 * performing a structural rewrite.
 *
 * Single Responsibility: locate and rewrite the plugin-owned media region.
 */

export interface SentinelMediaRegion {
  /** Index of the first char of the region (the start marker). */
  readonly start: number;
  /** Index just past the end marker. */
  readonly end: number;
  /** The full region text (start marker + body + end marker). */
  readonly full: string;
  /** The body between the markers (without surrounding newlines). */
  readonly body: string;
}

const START_PREFIX = '<!-- sa:media:start id=';
const START_SUFFIX = ' -->';
const END_MARKER = '<!-- sa:media:end -->';

/** Escape a string for safe embedding in a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class SentinelMediaRegionManager {
  /** The start marker for a given archive id. */
  static startMarker(archiveId: string): string {
    return `${START_PREFIX}${archiveId}${START_SUFFIX}`;
  }

  /** The shared end marker (not keyed by id). */
  static endMarker(): string {
    return END_MARKER;
  }

  /**
   * Wrap a media body in a sentinel region for `archiveId`. The body is placed
   * on its own line(s) between the markers. An empty body yields a region with
   * no body line.
   */
  static wrap(archiveId: string, body: string): string {
    const start = this.startMarker(archiveId);
    const trimmed = body.replace(/^\n+/, '').replace(/\n+$/, '');
    if (trimmed.length === 0) {
      return `${start}\n${END_MARKER}`;
    }
    return `${start}\n${trimmed}\n${END_MARKER}`;
  }

  /**
   * Locate the media region for `archiveId` within `content`. Re-scans the
   * full content each call (notes may be hand-edited between events). Returns
   * `null` when no region for that id exists.
   */
  static findRegion(content: string, archiveId: string): SentinelMediaRegion | null {
    const startMarker = this.startMarker(archiveId);
    const startIdx = content.indexOf(startMarker);
    if (startIdx === -1) return null;

    const bodyStart = startIdx + startMarker.length;
    const endIdx = content.indexOf(END_MARKER, bodyStart);
    if (endIdx === -1) return null;

    const end = endIdx + END_MARKER.length;
    const full = content.slice(startIdx, end);
    // Body = between markers, trimmed of the immediate surrounding newlines.
    const body = content.slice(bodyStart, endIdx).replace(/^\n+/, '').replace(/\n+$/, '');

    return { start: startIdx, end, full, body };
  }

  /**
   * Replace ONLY the body inside the `archiveId` region with `newBody`,
   * preserving the markers and everything outside the region. Returns the
   * updated content, or `null` when the region is not found (caller should
   * fall back to a non-destructive append).
   */
  static replaceRegion(content: string, archiveId: string, newBody: string): string | null {
    const region = this.findRegion(content, archiveId);
    if (!region) return null;

    const replacement = this.wrap(archiveId, newBody);
    return content.slice(0, region.start) + replacement + content.slice(region.end);
  }

  /**
   * Whether `content` already contains a media region for `archiveId`.
   */
  static hasRegion(content: string, archiveId: string): boolean {
    return this.findRegion(content, archiveId) !== null;
  }

  /**
   * A regex matching ANY sentinel media region (any id). Useful for diagnostics
   * / migrations. Returns a fresh regex per call (global flag is stateful).
   */
  static anyRegionPattern(): RegExp {
    return new RegExp(
      `${escapeRegExp(START_PREFIX)}([^\\s]+)${escapeRegExp(START_SUFFIX)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`,
      'g',
    );
  }
}
