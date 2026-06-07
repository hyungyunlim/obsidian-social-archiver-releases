/**
 * LinkedArchivesBlockParser
 *
 * Single Responsibility: reverse-parse the managed `## Linked archives` block
 * (written by LinkedArchivesRenderer between its HTML-comment markers) into
 * grouped row strings, so the TIMELINE can render relation connections on the
 * card. The block lives AFTER the metadata footer where the body parser stops
 * — exactly like the Mobile Annotations block, it must be read from the RAW
 * file content.
 *
 * Pure string parsing — no Obsidian API. Rows keep their markdown form
 * (`[[note|title]]` / `[title](url)` / plain text); the card renderer feeds
 * them through `renderMarkdownLinks`, which already handles all three.
 */

const START_MARKER = '<!-- social-archiver:linked-archives:start -->';
const END_MARKER = '<!-- social-archiver:linked-archives:end -->';
const LINKS_TO_HEADING = '**Links to**';
const LINKED_FROM_HEADING = '**Linked from**';

export interface ParsedLinkedArchives {
  /** Outgoing rows (this archive links to…), markdown preserved. */
  linksTo: string[];
  /** Incoming rows (…link to this archive), markdown preserved. */
  linkedFrom: string[];
}

/**
 * Parse the linked-archives block out of a full markdown document. Returns
 * null when the document has no (valid) block or the block has no rows.
 */
export function parseLinkedArchivesBlock(markdown: string): ParsedLinkedArchives | null {
  const startIdx = markdown.indexOf(START_MARKER);
  if (startIdx === -1) return null;
  const endIdx = markdown.indexOf(END_MARKER, startIdx);
  if (endIdx === -1) return null;

  const block = markdown.slice(startIdx + START_MARKER.length, endIdx);

  const linksTo: string[] = [];
  const linkedFrom: string[] = [];
  let current: string[] | null = null;

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (line === LINKS_TO_HEADING) {
      current = linksTo;
      continue;
    }
    if (line === LINKED_FROM_HEADING) {
      current = linkedFrom;
      continue;
    }
    if (current && line.startsWith('- ')) {
      const row = line.slice(2).trim();
      if (row) current.push(row);
    }
  }

  if (linksTo.length === 0 && linkedFrom.length === 0) return null;
  return { linksTo, linkedFrom };
}
