/**
 * Note Mention Tokens — plugin mirror of the FROZEN mobile contract
 * (`mobile-app/src/utils/note-mentions.ts`).
 *
 * Mobile stores mention tokens INSIDE `UserNote.content` as plain-text markdown
 * links. When those notes sync into the vault as the managed "Mobile
 * Annotations" block, the tokens arrive verbatim — e.g.
 *
 *   archive mention: [<post title>](socialarchiver://archive/<archiveId>)
 *   author mention:  [@<displayName>](socialarchiver://author?platform=<p>&name=<enc>&handle=<enc?>&url=<enc?>)
 *
 * These utilities are PURE — they only build and parse strings. The plugin
 * needs only the PARSE side of the contract (mobile owns serialization), plus a
 * vault-specific `convertInternalMentions` helper that rewrites the dead tokens
 * into Obsidian `[[wikilinks]]` (or plain text when the target cannot be
 * resolved) for the rendered annotation block.
 *
 * Grammar parity is load-bearing for round-trip safety: the token formats here
 * are byte-identical to the mobile serializers so that anything mobile writes is
 * parsed identically here. See `note-mentions.test.ts` for the pinned fixtures.
 */

import type { Platform } from '@shared/platforms/types';

/** App-internal deep-link scheme (registered in mobile app.json). */
export const INTERNAL_LINK_SCHEME = 'socialarchiver';

/**
 * Maximum code points for a mention's display text (mobile contract). Mirrored
 * here only for parity documentation — the plugin never serializes new tokens,
 * so the cap is applied by mobile before the token reaches the vault.
 */
export const MENTION_DISPLAY_MAX_LENGTH = 24;

/** A resolved archive mention extracted from note content. */
export interface ArchiveMentionTarget {
  kind: 'archive';
  archiveId: string;
}

/** A resolved author mention extracted from note content. */
export interface AuthorMentionTarget {
  kind: 'author';
  platform: Platform;
  name: string;
  handle?: string;
  /** Author profile URL (http/https) when one was carried in the token. */
  profileUrl?: string;
  /** The anchor text shown for the mention (without the leading `@`). */
  displayName: string;
}

/** The author-token components parsed out of a `socialarchiver://author?...` URL. */
export type AuthorMentionUrlParts = Omit<AuthorMentionTarget, 'kind' | 'displayName'>;

// ---------------------------------------------------------------------------
// Parsing (mobile contract — keep byte-identical to mobile serializers)
// ---------------------------------------------------------------------------

/**
 * Matches a markdown link whose URL uses the internal scheme. The anchor text
 * group allows escaped brackets (`\]`); the URL group is everything up to the
 * closing paren. We re-validate the URL with the scheme parsers below.
 *
 * Module-scoped + global → callers MUST reset `lastIndex` before iterating.
 */
const INTERNAL_MENTION_REGEX = new RegExp(
  String.raw`\[((?:\\.|[^\]\\])*?)\]\((` + INTERNAL_LINK_SCHEME + String.raw`:\/\/[^)]+)\)`,
  'g',
);

/** Strip the markdown anchor escaping applied by mobile `escapeAnchorText`. */
export function unescapeAnchorText(text: string): string {
  return text.replace(/\\([[\]])/g, '$1');
}

/**
 * Parse an internal archive URL → archiveId, or null if it is not an archive
 * link. Accepts `socialarchiver://archive/<id>` (id is percent-decoded).
 */
export function parseArchiveMentionUrl(url: string): string | null {
  const prefix = `${INTERNAL_LINK_SCHEME}://archive/`;
  if (!url.startsWith(prefix)) return null;
  const raw = url.slice(prefix.length).split(/[?#]/)[0] ?? '';
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.length > 0 ? decoded : null;
  } catch {
    // Malformed percent-encoding — fall back to the raw segment.
    return raw;
  }
}

/**
 * Parse an internal author URL → its components, or null if it is not an author
 * link or is missing the required `platform`/`name`.
 */
export function parseAuthorMentionUrl(url: string): AuthorMentionUrlParts | null {
  const prefix = `${INTERNAL_LINK_SCHEME}://author`;
  if (!url.startsWith(prefix)) return null;
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return null;
  const query = url.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  const platform = params.get('platform')?.trim();
  const name = params.get('name')?.trim();
  if (!platform || !name) return null;
  const handle = params.get('handle')?.trim() || undefined;
  const profileUrl = params.get('url')?.trim() || undefined;
  return {
    platform: platform as Platform,
    name,
    ...(handle ? { handle } : {}),
    ...(profileUrl ? { profileUrl } : {}),
  };
}

/**
 * Display split for a saved note: archive mentions render as ATTACHED compact
 * cards below the note, so archive-mention tokens sitting at the END of the
 * content are stripped from the displayed text — exactly like a trailing URL
 * hidden behind a link preview. Mid-sentence archive mentions stay inline
 * (sentence integrity); author mentions are never stripped.
 *
 * Ported from the mobile contract so the plugin's timeline display matches
 * mobile when (in a later phase) it renders attached archive cards. Today the
 * plugin only needs the display string; `attachedArchiveIds` is provided for
 * parity / future use.
 */
export function splitNoteDisplayContent(content: string): {
  displayContent: string;
  attachedArchiveIds: string[];
} {
  const archiveIds = collectArchiveIds(content);
  if (archiveIds.length === 0) {
    return { displayContent: content, attachedArchiveIds: [] };
  }

  // Repeatedly strip a trailing archive-mention token (plus surrounding
  // whitespace). Author tokens or plain text stop the loop.
  let display = content.trimEnd();
  const trailingToken = new RegExp(
    String.raw`\[(?:\\.|[^\]\\])*?\]\(` + INTERNAL_LINK_SCHEME + String.raw`:\/\/archive\/[^)]+\)\s*$`,
  );
  for (;;) {
    const next = display.replace(trailingToken, '').trimEnd();
    if (next === display) break;
    display = next;
  }

  return { displayContent: display, attachedArchiveIds: archiveIds };
}

/**
 * Extract the de-duped list of archive ids referenced by a note's content
 * (first-seen order). Author mentions are ignored. Internal helper shared by
 * {@link splitNoteDisplayContent}.
 */
function collectArchiveIds(content: string): string[] {
  const archiveIds: string[] = [];
  const seen = new Set<string>();
  if (!content) return archiveIds;

  INTERNAL_MENTION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INTERNAL_MENTION_REGEX.exec(content)) !== null) {
    const url = match[2] ?? '';
    const archiveId = parseArchiveMentionUrl(url);
    if (archiveId && !seen.has(archiveId)) {
      seen.add(archiveId);
      archiveIds.push(archiveId);
    }
  }
  return archiveIds;
}

// ---------------------------------------------------------------------------
// Token → wikilink conversion (plugin-only, vault display fix)
// ---------------------------------------------------------------------------

/**
 * Resolvers that turn a parsed mention target into a COMPLETE markdown/wiki
 * link string (e.g. `[[2026-06-06 - Author - Title (abc123)|label…]]`), or
 * `null` when the target cannot be resolved locally.
 *
 * Returning a complete string keeps {@link convertInternalMentions} pure and
 * Obsidian-free: alias sanitization is applied to the anchor text BEFORE it is
 * handed to the resolver, so resolvers are responsible only for the link
 * shape, not for escaping.
 */
export interface MentionResolvers {
  /**
   * Resolve an archive mention to a link string, or null when not in vault.
   *
   * @param sourcePath - path of the note being written, so a resolver backed by
   *   `app.fileManager.generateMarkdownLink` can honour shortest-unique-path +
   *   the user's link-format preferences. Empty string when unknown.
   */
  resolveArchiveLink(archiveId: string, alias: string, sourcePath: string): string | null;
  /** Resolve an author mention to a link string, or null when no author note. */
  resolveAuthorLink(params: {
    platform: Platform;
    name: string;
    handle?: string;
    url?: string;
    /** Sanitized anchor label (without a forced leading `@`). */
    alias: string;
    /** Path of the note being written (see {@link resolveArchiveLink}). */
    sourcePath: string;
  }): string | null;
}

/**
 * Sanitize anchor text for safe use as a wikilink alias. Replaces `|` (which
 * would otherwise split `[[path|alias]]`) with `-`, removes the `[[` / `]]`
 * sequences that could break out of the wikilink, and strips `#` / `^` which
 * Obsidian treats as heading / block subpath delimiters inside a link.
 *
 * Exported for the test pin — this is the one piece of escaping behaviour the
 * conversion path adds on top of the mobile contract.
 */
export function sanitizeWikilinkAlias(text: string): string {
  return text
    .replace(/\|/g, '-')
    .replace(/\[\[/g, '')
    .replace(/\]\]/g, '')
    .replace(/[#^]/g, '')
    .trim();
}

/**
 * Rewrite the internal `socialarchiver://` mention tokens inside a note's text
 * into resolved Obsidian links, leaving everything else untouched.
 *
 * Rules (Phase A2, fallback revised after device testing):
 *   - `[label](socialarchiver://archive/<id>)`
 *       → `resolveArchiveLink(id, alias)` when resolvable,
 *       → otherwise the ORIGINAL token, kept verbatim.
 *   - `[@name](socialarchiver://author?...)`
 *       → `resolveAuthorLink({...})` when resolvable,
 *       → otherwise the ORIGINAL token, kept verbatim.
 *   - Non-internal markdown links and any other text pass through verbatim.
 *
 * Why unresolved tokens are KEPT (not stripped to plain text): the token
 * carries the identity the TIMELINE resolves at render time — an author
 * mention opens the Author Detail view from the token params, and an archive
 * mention auto-upgrades the moment its target syncs into the vault. Stripping
 * to plain text destroyed that permanently (the vault copy is the timeline's
 * only data source). In Obsidian reading mode an unresolved token is a dead
 * anchor — cosmetic, and recoverable, unlike the information loss.
 *
 * Deterministic + idempotent for the SAME resolver outputs: given unchanged
 * input and unchanged vault state, the output is byte-identical, so the
 * `updatedContent !== content` write-gate in AnnotationSyncService does not
 * churn. (A wikilink produced here uses the `[[...]]` form which is NOT matched
 * by {@link INTERNAL_MENTION_REGEX}, so a second pass is a no-op.)
 */
export function convertInternalMentions(
  text: string,
  resolvers: MentionResolvers,
  sourcePath = '',
): string {
  if (!text) return text;

  INTERNAL_MENTION_REGEX.lastIndex = 0;
  return text.replace(INTERNAL_MENTION_REGEX, (full, rawAnchor: string, url: string) => {
    const anchor = unescapeAnchorText(rawAnchor ?? '');

    // Archive mention?
    const archiveId = parseArchiveMentionUrl(url);
    if (archiveId) {
      const alias = sanitizeWikilinkAlias(anchor);
      const link = resolvers.resolveArchiveLink(archiveId, alias, sourcePath);
      return link ?? full;
    }

    // Author mention?
    const authorParts = parseAuthorMentionUrl(url);
    if (authorParts) {
      // Anchor text typically carries the leading `@`; strip it for the alias.
      const bareName = anchor.replace(/^@+/, '');
      const alias = sanitizeWikilinkAlias(bareName) || authorParts.name;
      const link = resolvers.resolveAuthorLink({
        platform: authorParts.platform,
        name: authorParts.name,
        ...(authorParts.handle ? { handle: authorParts.handle } : {}),
        ...(authorParts.profileUrl ? { url: authorParts.profileUrl } : {}),
        alias,
        sourcePath,
      });
      return link ?? full;
    }

    // Not a recognised internal token — leave the original link verbatim.
    return full;
  });
}
