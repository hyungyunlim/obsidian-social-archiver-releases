/**
 * LinkedArchivesRenderer
 *
 * Single Responsibility: turn a list of {@link RelationWithSummary} into the
 * managed `## Linked archives` markdown block (marker-delimited), powering
 * Obsidian graph view from the server's archive_link_relations model.
 *
 * This is a PURE utility — no Obsidian API, no network. Vault-specific link
 * resolution (target archive id → `[[wikilink]]`) is delegated to injected
 * {@link LinkRelationResolvers}, exactly like {@link AnnotationRenderer}.
 *
 * The block is INBOUND-ONLY: it is rendered from server relations and is never
 * parsed back. Idempotency is load-bearing — given the same relations + the
 * same resolver outputs, `render()` returns a byte-identical string so the
 * `vault.modify` change-gate in LinkRelationSyncService never churns.
 */

import type { RelationWithSummary, LinkRelationType } from '@/types/link-relations';
import { sanitizeWikilinkAlias } from '@/utils/note-mentions';

// ─── Constants ───────────────────────────────────────────

export const LINKED_ARCHIVES_START_MARKER = '<!-- social-archiver:linked-archives:start -->';
export const LINKED_ARCHIVES_END_MARKER = '<!-- social-archiver:linked-archives:end -->';

const SECTION_TITLE = '## Linked archives';
const LINKS_TO_HEADING = '**Links to**';
const LINKED_FROM_HEADING = '**Linked from**';

/**
 * Relation types excluded from the OUTGOING ("Links to") group — note mentions
 * are already visible via the note itself (Mobile Annotations block), so we do
 * not duplicate them as outgoing links. This mirrors the mobile relation-section
 * parity rule. Incoming ("Linked from") still INCLUDES `note_mention`.
 */
const OUTGOING_EXCLUDED_TYPES: ReadonlySet<LinkRelationType> = new Set([
  'note_mention',
  'note_author_mention',
]);

// ─── Resolvers ───────────────────────────────────────────

/**
 * Vault-aware resolver used to rewrite a target archive id into a COMPLETE
 * Obsidian link string (e.g. `[[2026-06-06 - Author - Title (abc)|title…]]`),
 * or `null` when the target archive has no resolvable vault note.
 *
 * Keeping the resolver Obsidian-free at this boundary (it returns a string)
 * lets the renderer stay a pure utility — alias sanitization is applied by the
 * renderer BEFORE calling the resolver, so the resolver owns only link shape.
 */
export interface LinkRelationResolvers {
  /**
   * Resolve a target archive id to a wikilink string, or null when not in vault.
   *
   * @param archiveId  the OTHER side's archive id.
   * @param alias      sanitized display alias (already passed through
   *                   {@link sanitizeWikilinkAlias}).
   * @param sourcePath path of the note being written, so a resolver backed by
   *                   `app.fileManager.generateMarkdownLink` can honour the
   *                   user's link-format prefs + shortest-unique-path.
   */
  resolveArchiveLink(archiveId: string, alias: string, sourcePath: string): string | null;
}

// ─── Internal row model ──────────────────────────────────

interface RenderRow {
  /** Stable sort key — relation.updatedAt then relation.id. */
  updatedAt: string;
  id: string;
  /** Dedup key: target archive id when known, else normalized URL. */
  dedupKey: string;
  /** Fully formatted `- ...` line (without trailing newline). */
  line: string;
}

// ─── Renderer ────────────────────────────────────────────

export class LinkedArchivesRenderer {
  private readonly resolvers: LinkRelationResolvers;

  constructor(resolvers: LinkRelationResolvers) {
    this.resolvers = resolvers;
  }

  /**
   * Render the managed `## Linked archives` block.
   *
   * @param input.relations      relations for the self archive (source OR
   *                              target side), each with the other-side summary.
   * @param input.selfArchiveId  the archive whose note is being rendered — used
   *                              to classify each relation as outgoing/incoming.
   * @param sourcePath           path of the target note (for resolver link-format).
   * @returns the marker-wrapped block string, or `''` when nothing renders
   *          (caller removes the managed block in that case).
   */
  render(
    input: { relations: RelationWithSummary[]; selfArchiveId: string },
    sourcePath = '',
  ): string {
    const { relations, selfArchiveId } = input;

    const outgoing: RenderRow[] = [];
    const incoming: RenderRow[] = [];

    for (const entry of relations) {
      const { relation } = entry;

      // Only fully-connected relations render. Pending/failed are skipped so
      // the section never shows half-resolved links.
      if (relation.status !== 'connected') continue;

      const isOutgoing = relation.sourceArchiveId === selfArchiveId;
      const isIncoming = relation.targetArchiveId === selfArchiveId;

      if (isOutgoing) {
        if (OUTGOING_EXCLUDED_TYPES.has(relation.relationType)) continue;
        outgoing.push(this.buildRow(entry, selfArchiveId, sourcePath));
      } else if (isIncoming) {
        // Incoming includes note_mention (a note elsewhere links to this archive).
        incoming.push(this.buildRow(entry, selfArchiveId, sourcePath));
      }
      // Relations that reference neither side (shouldn't happen for a per-archive
      // fetch) are ignored.
    }

    const outgoingLines = this.dedupAndSort(outgoing);
    const incomingLines = this.dedupAndSort(incoming);

    if (outgoingLines.length === 0 && incomingLines.length === 0) {
      return '';
    }

    const groups: string[] = [];
    if (outgoingLines.length > 0) {
      groups.push([LINKS_TO_HEADING, '', ...outgoingLines].join('\n'));
    }
    if (incomingLines.length > 0) {
      groups.push([LINKED_FROM_HEADING, '', ...incomingLines].join('\n'));
    }

    return [
      LINKED_ARCHIVES_START_MARKER,
      '',
      '---',
      '',
      SECTION_TITLE,
      '',
      groups.join('\n\n'),
      '',
      LINKED_ARCHIVES_END_MARKER,
    ].join('\n');
  }

  // ── Row construction ──

  /**
   * Build a single rendered row for a relation.
   *
   * Row format precedence:
   *   1. resolved target note → `- [[<link>|<title>]]`
   *   2. unresolved but otherArchive present → `- [<title>](<originalUrl>)`
   *   3. otherArchive null / no URL → `- <anchorText | targetUrl>` plain text
   *
   * Title fallback: otherArchive.title → relation.anchorText → normalizedTargetUrl.
   */
  private buildRow(
    entry: RelationWithSummary,
    selfArchiveId: string,
    sourcePath: string,
  ): RenderRow {
    const { relation, otherArchive } = entry;

    // The other side's archive id: the non-self end of the relation. For
    // outgoing relations that's targetArchiveId; for incoming it's
    // sourceArchiveId. author-mention rows have no targetArchiveId.
    const otherArchiveId =
      relation.sourceArchiveId === selfArchiveId
        ? relation.targetArchiveId ?? null
        : relation.sourceArchiveId;

    const title = this.pickTitle(entry);
    const alias = sanitizeWikilinkAlias(title) || title;

    const dedupKey = otherArchiveId ?? relation.normalizedTargetUrl;

    let line: string;
    const resolved = otherArchiveId
      ? this.resolvers.resolveArchiveLink(otherArchiveId, alias, sourcePath)
      : null;

    if (resolved) {
      line = `- ${resolved}`;
    } else {
      const url = otherArchive?.originalUrl ?? relation.targetUrl ?? '';
      if (url) {
        line = `- [${escapeMarkdownLinkText(alias)}](${url})`;
      } else {
        line = `- ${alias}`;
      }
    }

    return {
      updatedAt: relation.updatedAt,
      id: relation.id,
      dedupKey,
      line,
    };
  }

  /**
   * Title fallback chain: other archive title → relation anchor → normalized URL.
   */
  private pickTitle(entry: RelationWithSummary): string {
    const { relation, otherArchive } = entry;
    const title = otherArchive?.title?.trim();
    if (title) return title;
    const anchor = relation.anchorText?.trim();
    if (anchor) return anchor;
    return relation.normalizedTargetUrl;
  }

  /**
   * Dedup rows by target archive id / normalized URL (first occurrence wins,
   * after sorting), then return their formatted lines in deterministic order:
   * updatedAt DESC, then id ASC as a stable tiebreak.
   */
  private dedupAndSort(rows: RenderRow[]): string[] {
    const sorted = [...rows].sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        // updatedAt DESC (newest first)
        return a.updatedAt < b.updatedAt ? 1 : -1;
      }
      // id ASC for stable tiebreak
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const seen = new Set<string>();
    const lines: string[] = [];
    for (const row of sorted) {
      if (seen.has(row.dedupKey)) continue;
      seen.add(row.dedupKey);
      lines.push(row.line);
    }
    return lines;
  }
}

/**
 * Escape characters that would break a markdown link's anchor text — only `]`
 * (closes the anchor) and `[` (could open a nested one). Used for the external
 * `[title](url)` fallback row. Wikilink aliases are sanitized separately via
 * {@link sanitizeWikilinkAlias}.
 */
function escapeMarkdownLinkText(text: string): string {
  return text.replace(/([[\]])/g, '\\$1');
}
