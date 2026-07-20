import { ArchiveLocationSchema, type ArchiveLocation } from '../../types/archive-location';

/**
 * Hidden note-body block for attached place `locations`.
 *
 * Obsidian's Properties editor cannot display an array-of-objects frontmatter
 * value (it flags it as an invalid property), so the full `locations` list is
 * stored in the note BODY wrapped in an Obsidian `%%` comment — invisible in
 * Reading/Live-Preview — instead of in the frontmatter. The flat primary-place
 * fields (`location`, `latitude`, …) stay in frontmatter where Obsidian renders
 * them cleanly.
 *
 * ```markdown
 * %% sa:locations
 * {"v":1,"locations":[{…}]}
 * %%
 * ```
 *
 * Read-side parsers strip the block from `content.text` so it never renders on
 * a card and never leaks into shared/synced note content.
 *
 * Single Responsibility: (de)serialize and locate the plugin-owned locations
 * body block. Backward-compatible: readers fall back to the legacy frontmatter
 * `locations` array until a note is rewritten to the block format.
 */

const MARKER = 'sa:locations';

/** Matches the full block (marker → JSON → closing `%%`). Non-global. */
const BLOCK_RE = /%%[ \t]*sa:locations\b[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*%%/;

/** Global variant that also swallows the newlines padding the block. */
const BLOCK_STRIP_RE = /\n*%%[ \t]*sa:locations\b[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*%%[ \t]*(?:\r?\n)?/g;

export class LocationBodyBlock {
  /**
   * Project a location onto exactly the {@link ArchiveLocationSchema} fields in a
   * fixed key order. Guarantees what we write round-trips through the strict
   * read-side schema (extra server fields would otherwise be rejected and cause
   * an endless "drift" rewrite loop).
   */
  static normalize(locations: readonly ArchiveLocation[]): ArchiveLocation[] {
    return locations.map((l) => ({
      id: l.id,
      archiveId: l.archiveId,
      placeKey: l.placeKey,
      name: l.name,
      address: l.address,
      latitude: l.latitude,
      longitude: l.longitude,
      source: l.source,
      externalId: l.externalId,
      url: l.url,
      category: l.category,
      isPrimary: l.isPrimary,
      sortOrder: l.sortOrder,
      placeArchiveId: l.placeArchiveId,
      promotionStatus: l.promotionStatus,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));
  }

  /** Serialize a locations list into the `%%`-wrapped block (no surrounding blank lines). */
  static serialize(locations: readonly ArchiveLocation[]): string {
    return `%% ${MARKER}\n${JSON.stringify({ v: 1, locations: this.normalize(locations) })}\n%%`;
  }

  /**
   * Parse the locations block out of note `content`. Each entry is validated
   * against {@link ArchiveLocationSchema}; malformed JSON or entries are dropped.
   * Returns `null` when no valid block is present (caller may fall back to the
   * legacy frontmatter array).
   */
  static parse(content: string): ArchiveLocation[] | null {
    const match = content.match(BLOCK_RE);
    if (!match) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(match[1]!.trim());
    } catch {
      return null;
    }
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { locations?: unknown })?.locations)
        ? (raw as { locations: unknown[] }).locations
        : null;
    if (!list) return null;
    const valid = list
      .map((item) => ArchiveLocationSchema.safeParse(item))
      .filter((r): r is { success: true; data: ArchiveLocation } => r.success)
      .map((r) => r.data);
    return valid.length > 0 ? valid : null;
  }

  /** Whether `content` contains a locations block. */
  static has(content: string): boolean {
    return BLOCK_RE.test(content);
  }

  /** Remove the locations block (and its padding newlines) from `content`. */
  static strip(content: string): string {
    return content.replace(BLOCK_STRIP_RE, '\n');
  }

  /**
   * Insert or replace the locations block at the END of `content`. An empty
   * list removes any existing block. Existing trailing whitespace is normalized
   * to a single blank-line separator.
   */
  static upsert(content: string, locations: readonly ArchiveLocation[]): string {
    const base = this.strip(content).replace(/\s+$/, '');
    if (!locations || locations.length === 0) {
      return base.length > 0 ? `${base}\n` : '';
    }
    return `${base}\n\n${this.serialize(locations)}\n`;
  }
}
