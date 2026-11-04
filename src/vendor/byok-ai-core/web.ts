/**
 * Web access the user asked for, explicitly, on one request: a chat question,
 * a question about a selection, a custom AI comment. Research and fact checks
 * always search; everything else only when the user turned web access on for
 * that request. The request then carries `webSearch: true` (each provider's
 * own search and fetch tools) and this note on the user turn (the system
 * prompt stays the same, so it stays cacheable), and the answer gets the
 * sources the provider reports.
 */
import type { ByokCitation } from './client';

export const WEB_ACCESS_REQUEST =
  'Web access is on for this request because the user asked for it: search the web or open the pages ' +
  'it needs, prefer primary and reputable sources, and link the sources you rely on.';

/** `text` (a user turn) with the web-access note after it. */
export function withWebAccessRequest(text: string): string {
  return `${text.trimEnd()}\n\n${WEB_ACCESS_REQUEST}`;
}

/**
 * `text` with the provider's citations it does not already link, as a
 * markdown `#### Sources` list (h4: AI comment content never carries h1–h3).
 */
export function withSourceLinks(text: string, citations: readonly ByokCitation[] | undefined): string {
  const listed = new Set<string>();
  const sources = (citations ?? []).flatMap((citation) => {
    const url = citation.url.trim();
    if (!/^https?:\/\//i.test(url) || listed.has(url) || text.includes(url)) return [];
    listed.add(url);
    const title = citation.title?.replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim() || url;
    // Parentheses and spaces would end the markdown link early (encodeURIComponent keeps parentheses).
    const href = url.replace(/[()\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
    return [`- [${title}](${href})`];
  });
  return sources.length > 0 ? `${text}\n\n#### Sources\n${sources.join('\n')}` : text;
}
