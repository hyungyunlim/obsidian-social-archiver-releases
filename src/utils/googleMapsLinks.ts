/**
 * googleMapsLinks — pure helpers for extracting Google Maps URLs from
 * arbitrary text content. Extracted from `BatchGoogleMapsArchiver` so the
 * CLI can call it without dragging in the modal/Notice/Vault dependencies.
 *
 * Single Responsibility: regex extraction + light normalization. No I/O,
 * no Obsidian imports, no batch orchestration.
 */

/**
 * Patterns that recognize Google Maps URLs in user-pasted content.
 *
 * Order matters slightly — we keep the more specific patterns first so the
 * final de-dup pass preserves the highest-fidelity match.
 */
const GOOGLE_MAPS_PATTERNS: RegExp[] = [
  /https?:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]+(\?[^\s)"\]<>]*)?/gi,
  /https?:\/\/goo\.gl\/maps\/[A-Za-z0-9]+/gi,
  /https?:\/\/(www\.)?google\.[a-z.]+\/maps\/place\/[^\s)"\]<>]+/gi,
  /https?:\/\/maps\.google\.[a-z.]+\/[^\s)"\]<>]+/gi,
];

export interface ExtractGoogleMapsLinksOptions {
  /** Hard cap on returned links. When unset, every match is returned. */
  max?: number;
}

/**
 * Extract a unique, ordered list of Google Maps URLs from a free-text blob.
 *
 * - De-duplicates exact matches preserving first-seen order.
 * - Strips common trailing punctuation that markdown link parsers would
 *   normally leave attached: `)`, `"`, `]`, `<`, `>`.
 * - When `max` is supplied, returns at most `max` links — the rest are
 *   discarded silently. Callers that need to know how many were dropped
 *   should call without `max` and slice on the result themselves.
 *
 * Returns an empty array for any input that contains no recognizable
 * Google Maps URL. Never throws.
 */
export function extractGoogleMapsLinks(
  content: string,
  opts: ExtractGoogleMapsLinksOptions = {},
): string[] {
  if (typeof content !== 'string' || content.length === 0) return [];

  const links: string[] = [];
  for (const pattern of GOOGLE_MAPS_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      links.push(...matches);
    }
  }

  // Deduplicate preserving order, strip trailing punctuation.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of links) {
    const cleaned = raw.replace(/[)"\]<>]+$/, '');
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (opts.max !== undefined && out.length >= opts.max) break;
  }
  return out;
}
