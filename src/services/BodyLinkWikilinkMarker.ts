/**
 * BodyLinkWikilinkMarker
 *
 * Single Responsibility: rewrite body links whose URL is a CONNECTED
 * link-relation target with a locally-resolved vault note into wikilinks, so
 * the article body itself joins the Obsidian graph:
 *
 *   - `[anchor](url)` → `[[note basename|anchor]]`   (visible text unchanged)
 *   - bare `https://…` → `[[note basename|https://…]]` (visible text unchanged)
 *
 * Idempotent and pure — no Obsidian API, no network. Mirrors the
 * {@link import('./HighlightBodyMarker').HighlightBodyMarker} reconcile model:
 * the body may be regenerated on re-archive, and the relation sync re-applies
 * the conversion on its next pass.
 *
 * Scope guards:
 *   - Frontmatter (between leading `---` fences) is preserved verbatim.
 *   - Managed blocks (Mobile Annotations / Linked archives markers) and
 *     everything after the FIRST marker are preserved verbatim — note-mention
 *     tokens there are handled by AnnotationRenderer, not here.
 *   - Fenced code blocks (```) and inline code spans (`…`) are untouched.
 *   - Image embeds `![alt](url)` are untouched (media, not navigation).
 *
 * Highlight-safety (the reason this is safe at all): the VISIBLE text of a
 * converted link never changes — `[anchor](url)` and `[[note|anchor]]` both
 * read "anchor" — so `==mark==` re-anchoring (HighlightBodyMarker → 4-tier
 * resolver) degrades at worst from EXACT/STRONG to WEAK (text-search), never
 * to data loss. Server-side highlight rows and the annotations callouts are
 * untouched either way.
 *
 * One-way by design: when a relation is later deleted, the body wikilink
 * stays (it is still a valid vault link; only the `## Linked archives` row is
 * removed). Reverting would require mutating body text with no anchor to the
 * original URL spelling — not worth the highlight-coordinate risk.
 */

const ANNOTATIONS_START_MARKER = '<!-- social-archiver:annotations:start -->';
const LINKED_ARCHIVES_START_MARKER = '<!-- social-archiver:linked-archives:start -->';

/** A relation target the body may link to, with its vault link text. */
export interface BodyWikilinkTarget {
  /** Candidate URL spellings (relation targetUrl + server-normalized form). */
  urls: string[];
  /** Vault link text (note basename) of the resolved target note. */
  linktext: string;
}

/**
 * Markdown inline link: optional image `!`, `[text](url)` with an optional
 * `"title"` part. URL capture stops at whitespace or `)`.
 */
const MARKDOWN_LINK_REGEX = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Bare URL in plain text. The single-char prefix guard keeps URLs inside
 * `](url)` (preceded by `(`) and `<url>` autolinks (preceded by `<`) out of
 * reach — only start-of-string or whitespace-preceded URLs match.
 */
const BARE_URL_REGEX = /(^|\s)(https?:\/\/[^\s<>")\]]+)/g;

/** Trailing punctuation that visually belongs to the sentence, not the URL. */
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?]+$/;

/**
 * Sanitize alias text for the `[[target|alias]]` position: `|` collides with
 * the alias delimiter and `]]` terminates the link; neither is escapable in
 * wikilink syntax. (Same policy as the mention converter's alias handling.)
 */
function sanitizeAlias(alias: string): string {
  return alias.replace(/\|/g, '-').replace(/\]\]/g, ']').replace(/\[\[/g, '[').trim();
}

/**
 * Conservative URL normalization for matching body links against relation
 * target URLs. Deliberately lossless-ish: lowercase scheme+host, drop the
 * fragment, drop a single trailing slash on the path. Query strings are kept
 * (they can be load-bearing). A failed parse falls back to trimmed input.
 */
export function normalizeUrlForMatch(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    const query = parsed.search ?? '';
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${query}`;
  } catch {
    return trimmed;
  }
}

export class BodyLinkWikilinkMarker {
  /**
   * Rewrite matching body links into wikilinks. Returns the input unchanged
   * (same reference) when there is nothing to do.
   */
  reconcile(content: string, targets: BodyWikilinkTarget[]): string {
    if (targets.length === 0) return content;

    const urlToLinktext = new Map<string, string>();
    for (const target of targets) {
      if (!target.linktext) continue;
      for (const url of target.urls) {
        if (!url) continue;
        urlToLinktext.set(url.trim(), target.linktext);
        urlToLinktext.set(normalizeUrlForMatch(url), target.linktext);
      }
    }
    if (urlToLinktext.size === 0) return content;

    const lookup = (url: string): string | undefined =>
      urlToLinktext.get(url.trim()) ?? urlToLinktext.get(normalizeUrlForMatch(url));

    // ── Split: frontmatter | transformable body | managed tail ──────────────
    let frontmatter = '';
    let rest = content;
    const fmMatch = content.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
    if (fmMatch) {
      frontmatter = fmMatch[0];
      rest = content.slice(fmMatch[0].length);
    }

    const markerIndices = [
      rest.indexOf(ANNOTATIONS_START_MARKER),
      rest.indexOf(LINKED_ARCHIVES_START_MARKER),
    ].filter((idx) => idx !== -1);
    const tailStart = markerIndices.length > 0 ? Math.min(...markerIndices) : rest.length;
    const body = rest.slice(0, tailStart);
    const tail = rest.slice(tailStart);

    const transformedBody = this.transformBody(body, lookup);
    if (transformedBody === body) return content;

    return frontmatter + transformedBody + tail;
  }

  /** Transform line-wise so fenced code blocks can be skipped statefully. */
  private transformBody(body: string, lookup: (url: string) => string | undefined): string {
    const lines = body.split('\n');
    let inFence = false;
    let changed = false;

    const out = lines.map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;

      const transformed = this.transformLine(line, lookup);
      if (transformed !== line) changed = true;
      return transformed;
    });

    return changed ? out.join('\n') : body;
  }

  /** Transform one line, leaving inline code spans untouched. */
  private transformLine(line: string, lookup: (url: string) => string | undefined): string {
    // Split out inline code spans; transform only the non-code segments.
    const segments = line.split(/(`[^`]*`)/);
    let changed = false;

    const out = segments.map((segment) => {
      if (segment.startsWith('`') && segment.endsWith('`') && segment.length >= 2) {
        return segment;
      }
      const transformed = this.transformSegment(segment, lookup);
      if (transformed !== segment) changed = true;
      return transformed;
    });

    return changed ? out.join('') : line;
  }

  private transformSegment(segment: string, lookup: (url: string) => string | undefined): string {
    // 1. Markdown inline links — `[anchor](url)` (images excluded).
    let result = segment.replace(
      MARKDOWN_LINK_REGEX,
      (match: string, bang: string, text: string, url: string): string => {
        if (bang === '!') return match;
        const linktext = lookup(url);
        if (!linktext) return match;
        const alias = sanitizeAlias(text) || linktext;
        return `[[${linktext}|${alias}]]`;
      },
    );

    // 2. Bare URLs in plain text (whitespace/SOL-preceded only).
    result = result.replace(
      BARE_URL_REGEX,
      (match: string, prefix: string, rawUrl: string): string => {
        const trailing = rawUrl.match(TRAILING_PUNCTUATION_REGEX)?.[0] ?? '';
        const url = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
        const linktext = lookup(url);
        if (!linktext) return match;
        const alias = sanitizeAlias(url);
        return `${prefix}[[${linktext}|${alias}]]${trailing}`;
      },
    );

    return result;
  }
}
