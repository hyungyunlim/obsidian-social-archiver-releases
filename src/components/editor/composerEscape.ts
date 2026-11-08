/**
 * The composer's inline Markdown escape, ported from share-web
 * (`share-web/src/lib/features/composer/composerEscape.ts`) so a post written
 * in Obsidian is stored the same way mobile, desktop and the web store it.
 */

/**
 * Backslash-escapes only what would re-parse as inline syntax. The stock escape
 * hits every `_`, `*`, `[` and `]`, which mangles snake_case, "5 * 2" and
 * [[wikilinks]] in every client that shows the raw text. Same rules as mobile.
 *
 * ponytail: inline only. A paragraph that starts with "2025. " or "- " (typed after
 * undoing the editor's list input rule) is not escaped and re-parses as a list.
 */
export function escapeComposerText(text: string): string {
  return text
    .split(/(\[\[[^\]]+\]\])/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/([\\`~])/g, '\\$1')
            // Lookarounds, not a consumed neighbour: in `__init__` every underscore is escaped, not every other one.
            .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')
            .replace(/\*(?! )|(?<! )\*/g, '\\*')
            .replace(/\[(?!\[)|(?<!\])\]/g, (match) => `\\${match}`),
    )
    .join('');
}
