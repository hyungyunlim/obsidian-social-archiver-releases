import {
  isRenderableProductSnapshot,
  type ProductSnapshot,
} from '../../shared/platforms/products';

/**
 * Hidden note-body block for the commerce {@link ProductSnapshot}.
 *
 * Same reasoning as {@link LocationBodyBlock}: Obsidian's Properties editor
 * cannot display a nested object, so the snapshot lives in the note BODY inside
 * an Obsidian `%%` comment — invisible in Reading/Live-Preview — while the flat
 * `productSource` (the normalized store host) stays in frontmatter where
 * Obsidian renders it cleanly and users can query it from Bases/Dataview.
 *
 * ```markdown
 * %% sa:product
 * {"v":1,"product":{…}}
 * %%
 * ```
 *
 * The whole snapshot is stored VERBATIM rather than projected onto a field
 * list. `ProductSnapshot` grows (PRD §5.9 records five separate silent
 * field-loss bugs in one session, every one of them a hand-written field list
 * that type-checked), and a verbatim blob costs nothing when a field is added.
 * Unknown keys therefore survive a round-trip through an older plugin build.
 *
 * Single Responsibility: (de)serialize and locate the plugin-owned product
 * body block.
 */

const MARKER = 'sa:product';

/** Matches the full block (marker → JSON → closing `%%`). Non-global. */
const BLOCK_RE = /%%[ \t]*sa:product\b[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*%%/;

/** Global variant that also swallows the newlines padding the block. */
const BLOCK_STRIP_RE = /\n*%%[ \t]*sa:product\b[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*%%[ \t]*(?:\r?\n)?/g;

export class ProductBodyBlock {
  /** Serialize a snapshot into the `%%`-wrapped block (no surrounding blank lines). */
  static serialize(product: ProductSnapshot): string {
    return `%% ${MARKER}\n${JSON.stringify({ v: 1, product })}\n%%`;
  }

  /**
   * Parse the product block out of note `content`. Returns `null` when the
   * block is absent, malformed, or describes a snapshot with no name — a
   * nameless snapshot cannot render a card (shared `isRenderableProductSnapshot`).
   */
  static parse(content: string): ProductSnapshot | null {
    const payload = content.match(BLOCK_RE)?.[1];
    if (payload === undefined) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(payload.trim());
    } catch {
      return null;
    }
    const candidate = (raw as { product?: unknown })?.product ?? raw;
    return isRenderableProductSnapshot(candidate as ProductSnapshot)
      ? (candidate as ProductSnapshot)
      : null;
  }

  /** Whether `content` contains a product block. */
  static has(content: string): boolean {
    return BLOCK_RE.test(content);
  }

  /** Remove the product block (and its padding newlines) from `content`. */
  static strip(content: string): string {
    return content.replace(BLOCK_STRIP_RE, '\n');
  }

  /**
   * Insert or replace the product block at the END of `content`. A null
   * snapshot removes any existing block.
   */
  static upsert(content: string, product: ProductSnapshot | null | undefined): string {
    const base = this.strip(content).replace(/\s+$/, '');
    if (!isRenderableProductSnapshot(product)) {
      return base.length > 0 ? `${base}\n` : '';
    }
    return `${base}\n\n${this.serialize(product)}\n`;
  }
}
