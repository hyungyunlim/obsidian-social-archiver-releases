/**
 * AnnotationRenderer
 *
 * Single Responsibility: Convert UserNote[] and TextHighlight[] arrays into
 * a markdown string wrapped in HTML comment markers for the managed
 * "Mobile Annotations" block at the bottom of archived notes.
 *
 * This is a pure utility — no Obsidian API dependency, no network calls.
 * Vault-specific link resolution (mention token → wikilink) is delegated to
 * injected {@link MentionResolvers}; the renderer itself imports no Obsidian
 * API, so the resolvers carry the only vault coupling (wired in main.ts).
 */

import type { UserNote, TextHighlight } from '@/types/annotations';
import { convertInternalMentions, type MentionResolvers } from '@/utils/note-mentions';

// ─── Constants ───────────────────────────────────────────

const ANNOTATIONS_START_MARKER = '<!-- social-archiver:annotations:start -->';
const ANNOTATIONS_END_MARKER = '<!-- social-archiver:annotations:end -->';

/**
 * Pass-through resolvers — used when the renderer is constructed without vault
 * resolvers (e.g. unit tests). With these, internal mention tokens degrade to
 * their plain anchor text rather than becoming wikilinks. Conversion stays a
 * deterministic, no-Obsidian-import pre-pass either way.
 */
const NO_OP_RESOLVERS: MentionResolvers = {
  resolveArchiveLink: (): string | null => null,
  resolveAuthorLink: (): string | null => null,
};

// ─── Helpers ─────────────────────────────────────────────

/**
 * Format an ISO 8601 timestamp as local time `YYYY-MM-DD HH:mm`.
 *
 * Uses `Date` directly without any library dependency. The formatting
 * intentionally matches the project's existing date patterns (e.g.,
 * `archived` / `lastModified` in YamlFrontmatter).
 */
function formatLocalTimestamp(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString; // Gracefully degrade for invalid input

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Escape user-supplied text so it is safe inside an Obsidian callout block.
 *
 * Rules:
 * - Each line must be prefixed with `> ` to remain inside the blockquote.
 * - A leading `>` in raw content would create an unwanted nested blockquote;
 *   escape it with a zero-width space (U+200B) so the visual is preserved
 *   without breaking the callout structure.
 * - A line that is exactly `---` would be parsed as a horizontal rule;
 *   prefix it with a backslash to prevent that.
 *
 * The function does NOT strip or sanitise content further — the goal is
 * readability preservation.
 */
function escapeCalloutContent(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Escape leading `>` to avoid nested blockquote mis-parse
      let escaped = line.startsWith('>') ? `\u200B${line}` : line;
      // Escape bare horizontal rule on its own line
      if (/^-{3,}$/.test(escaped.trim())) {
        escaped = `\\${escaped}`;
      }
      return `> ${escaped}`;
    })
    .join('\n');
}

// ─── Renderer ────────────────────────────────────────────

export class AnnotationRenderer {
  /**
   * Vault-aware resolvers used to rewrite `socialarchiver://` mention tokens
   * into Obsidian `[[wikilinks]]`. Injected so the renderer itself stays a pure
   * utility with NO Obsidian import — the resolvers (wired in main.ts) own all
   * vault/file lookups. Defaults to {@link NO_OP_RESOLVERS} so existing callers
   * and unit tests keep working (tokens degrade to plain text).
   */
  private readonly resolvers: MentionResolvers;

  constructor(resolvers: MentionResolvers = NO_OP_RESOLVERS) {
    this.resolvers = resolvers;
  }

  /**
   * Render notes and highlights into the managed annotation block string.
   *
   * Returns an empty string when both arrays are empty — the caller
   * (AnnotationSectionManager) will remove the managed block in that case.
   *
   * Mention tokens (`socialarchiver://archive/...`, `socialarchiver://author?...`)
   * embedded in note/highlight text are converted to wikilinks (or plain text
   * when unresolved) BEFORE callout escaping — see {@link convertInternalMentions}.
   * The conversion is confined to the rendered body block; the round-trip
   * `fm.comment` value (written by AnnotationSyncService) is NEVER converted.
   */
  render(params: { notes: UserNote[]; highlights: TextHighlight[]; sourcePath?: string }): string {
    const { notes, highlights } = params;
    const sourcePath = params.sourcePath ?? '';

    if (notes.length === 0 && highlights.length === 0) {
      return '';
    }

    const sections: string[] = [];

    // ── Highlights ──
    if (highlights.length > 0) {
      const sortedHighlights = [...highlights].sort((a, b) => {
        if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
        return a.createdAt.localeCompare(b.createdAt);
      });

      const highlightLines: string[] = [`### Highlights (${sortedHighlights.length})`, ''];

      sortedHighlights.forEach((h, idx) => {
        const number = idx + 1;
        const calloutLines: string[] = [
          `> [!quote]+ Highlight ${number} · ${h.color}`,
          escapeCalloutContent(convertInternalMentions(h.text, this.resolvers, sourcePath)),
        ];

        if (h.note && h.note.trim().length > 0) {
          calloutLines.push(`>`);
          calloutLines.push(`> Note: ${convertInternalMentions(h.note.trim(), this.resolvers, sourcePath)}`);
        }

        calloutLines.push(`> Updated: ${formatLocalTimestamp(h.updatedAt)}`);

        highlightLines.push(calloutLines.join('\n'));
        highlightLines.push('');
      });

      // Remove trailing blank line added by last highlight
      if (highlightLines[highlightLines.length - 1] === '') {
        highlightLines.pop();
      }

      sections.push(highlightLines.join('\n'));
    }

    // ── Notes ──
    if (notes.length > 0) {
      const sortedNotes = [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      const noteLines: string[] = [`### Notes (${sortedNotes.length})`, ''];

      sortedNotes.forEach((n) => {
        const timestamp = formatLocalTimestamp(n.createdAt);
        const calloutLines: string[] = [
          `> [!note]+ ${timestamp}`,
          escapeCalloutContent(convertInternalMentions(n.content, this.resolvers, sourcePath)),
        ];
        noteLines.push(calloutLines.join('\n'));
        noteLines.push('');
      });

      // Remove trailing blank line
      if (noteLines[noteLines.length - 1] === '') {
        noteLines.pop();
      }

      sections.push(noteLines.join('\n'));
    }

    // ── Assemble ──
    const body = [
      ANNOTATIONS_START_MARKER,
      '',
      '---',
      '',
      '## Mobile Annotations',
      '',
      sections.join('\n\n'),
      '',
      ANNOTATIONS_END_MARKER,
    ].join('\n');

    return body;
  }
}
