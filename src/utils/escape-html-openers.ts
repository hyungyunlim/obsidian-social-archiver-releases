/**
 * Keeps the `<` of plain post text written into a note as text.
 *
 * A post line like `<inputs>` opens an HTML block in markdown: the reading view
 * hides the tag and joins the lines inside it. Each `<` outside code becomes
 * `&lt;`, not `\<`, because the timeline reads the note back and its plain-text
 * path escapes `<` itself: it leaves `&lt;` alone.
 *
 * Code keeps its `<` (fenced blocks, which synced bodies carry, and one-line
 * code spans show text verbatim). An existing `\<` stays as is, so a second
 * pass changes nothing.
 *
 * Kept in lockstep with `workers/src/utils/escape-html-openers.ts`.
 */

// Any indent, so a fence nested under a list item counts too. A backtick fence
// has no backtick after its run.
const FENCE = /^[ \t]*(`{3,}(?=[^`]*$)|~{3,})/;

export function escapeHtmlOpeners(markdown: string): string {
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
      return line.replace(/(`+)[^`]*\1|\\<|</g, (match) => (match === '<' ? '&lt;' : match));
    })
    .join('\n');
}
