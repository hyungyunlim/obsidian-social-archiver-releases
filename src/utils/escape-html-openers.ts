/**
 * Keeps the `<` of plain post text written into a note as text.
 *
 * A post line like `<inputs>` opens HTML in markdown. In Live Preview every
 * line after it (images, headings, the author line) shows as raw markdown; the
 * reading view hides the tag. Each `<` outside code becomes `\<`: Obsidian shows
 * it as `<` in both views, and the timeline's own escaper leaves it alone.
 * `&lt;` (written by 4.7.11 to 4.11) also becomes `\<`: Live Preview shows
 * `&lt;` as typed.
 *
 * Code keeps its `<` (fenced blocks, which synced bodies carry, and one-line
 * code spans show text verbatim). An existing `\<` stays, so a second pass
 * changes nothing.
 *
 * The server's copy (`workers/src/utils/escape-html-openers.ts`) still writes
 * `&lt;`: other clients render server text, and some show `\<` as typed. A note
 * body sent to the server goes back through `noteTextForServer`.
 */

// Any indent, so a fence nested under a list item counts too. A backtick fence
// has no backtick after its run.
const FENCE = /^[ \t]*(`{3,}(?=[^`]*$)|~{3,})/;

/** `fn` applied to each line outside fenced code. */
function mapOutsideFences(markdown: string, fn: (line: string) => string): string {
  let fence = '';
  return markdown
    .split('\n')
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (fence) {
        // A bare run of the same character, at least as long, closes it.
        if (marker?.startsWith(fence) && line.trim() === marker) fence = '';
        return line;
      }
      if (marker) {
        fence = marker;
        return line;
      }
      return fn(line);
    })
    .join('\n');
}

export function escapeHtmlOpeners(markdown: string): string {
  return mapOutsideFences(markdown, (line) =>
    line.replace(/(`+)[^`]*\1|\\<|&lt;|</g, (match) => (match === '<' || match === '&lt;' ? '\\<' : match)));
}

// CommonMark autolinks: `<scheme:…>` and `<name@host>` are links, not HTML.
const AUTOLINK = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)>/;

/**
 * The repair of a body an older writer left: only a `<` that opens a tag or a
 * closing tag, and `&lt;`, become `\<`. A `<3` or an autolink was fine and
 * stays, so a note with nothing to fix comes back unchanged. So does an HTML
 * comment: the plugin writes its own markers (`<!-- sa:media:start -->`) as
 * comments, some templates inside the post text.
 */
export function repairHtmlOpeners(markdown: string): string {
  return mapOutsideFences(markdown, (line) =>
    line.replace(/(`+)[^`]*\1|\\<|&lt;|<(?=[A-Za-z/?])/g, (match, _ticks: string | undefined, offset: number, whole: string) => {
      if (match === '&lt;') return '\\<';
      return match === '<' && !AUTOLINK.test(whole.slice(offset)) ? '\\<' : match;
    }));
}

/** A note body's escaped `<` as the server keeps it (`&lt;`, see above). */
export function noteTextForServer(text: string): string {
  return mapOutsideFences(text, (line) =>
    line.replace(/(`+)[^`]*\1|\\</g, (match) => (match === '\\<' ? '&lt;' : match)));
}
