/**
 * EmbeddedArchiveBlocks
 *
 * Single Responsibility: divide a note's "Referenced Social Media Posts"
 * section into its archives. PostDataParser reads archives out of these blocks
 * and VaultStorageService replaces them. Both go through here: a block one
 * reads as an archive the other must replace as one, or text is dropped or
 * written twice.
 */

// Saves from 4532fddeb (2.6.0) until c0caacab2 (embedded archives added, and
// PostComposer edits until 1aec2c16e) kept the note's section and wrote the
// regenerated one below it, heading and all, its first archive's header right
// after. The parser read on across that heading, joining the blocks either
// side into one archive, which the next save wrote back with the heading in
// its text and comments. There the header after it is escaped (`&lt;!--`) and
// the heading is no split point: the archive around it is a later section's
// copy, and splitting it would make archives of the ends of its text and
// comments. A web article keeps its markup unescaped; its pieces are copies of
// archives read earlier.
const REPEATED_HEADING = /\n---\n\n## (?:📦 )?Referenced Social Media Posts\n\n(?=<!--\s*Embedded:|### )/i;

/**
 * The blocks of `section`, the text after the section's (first) heading. It
 * comes apart at each repeated heading, then wherever the next archive's
 * header follows a rule: the hidden one, which every archive of a note written
 * since carries, or in older notes the visible "### Platform - handle". A web
 * article's own rule and ### heading look like the latter, so it counts only
 * where no hidden header exists.
 */
export function splitEmbeddedArchiveBlocks(section: string): string[] {
  const nextArchive = /<!--\s*Embedded:/i.test(section) ? /\n---\n\n(?=<!--\s*Embedded:)/i : /\n---\n\n(?=### )/;
  return section.split(REPEATED_HEADING).flatMap((part) => part.split(nextArchive));
}

/**
 * The first archive of each URL. A repeated section wrote every archive again
 * from what was read back, the first of them from the joined blocks, so the
 * later ones are copies. Archives without a URL all stay.
 */
export function firstArchivePerUrl<T extends { url: string }>(archives: T[]): T[] {
  return archives.filter((archive, index) => !archive.url || archives.findIndex((other) => other.url === archive.url) === index);
}
