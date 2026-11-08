/**
 * Ad-slot labels a publisher leaves inside the article body.
 *
 * News pages interleave ad slots with the story's paragraphs, and each slot
 * carries a visible label. Defuddle keeps the label because it sits inside the
 * article container. Measured on nytimes.com (2026-11-02): up to 26 lines per
 * article, alternating `Advertisement` and `[SKIP ADVERTISEMENT](#after-story-ad-N)`.
 * A body that stays HTML inside the markdown keeps it as an element instead:
 * `<p>ADVERTISEMENT</p>` mid-line on joongang.co.kr (2026-11-06).
 *
 * Only whole lines, or whole elements, that are nothing but the label are
 * removed. A sentence that mentions advertising is prose and stays.
 */

const AD_MARKER_LINE = /^[ \t]*\[?[ \t]*(?:skip[ \t]+)?advertisement[ \t]*(?:\]\([^)\n]*\))?[ \t]*$/gim;
const AD_MARKER_ELEMENT = /<(p|span|div|strong|em)\b[^>]*>\s*(?:skip\s+)?advertisement\s*<\/\1>/gi;

export function stripAdMarkerLines(markdown: string): string {
  if (!/advertisement/i.test(markdown)) return markdown;
  // ponytail: the blank-line collapse is document-wide, so a fenced code block
  // with 3+ blank lines in an article that also has ad labels loses some. Scope
  // the collapse to the removed lines if that ever matters.
  return markdown.replace(AD_MARKER_ELEMENT, '').replace(AD_MARKER_LINE, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * The Athletic's "Daily Pick'em" game card, embedded mid-article: a heading,
 * two final scores with team codes, pick percentages and a vote count.
 * Defuddle flattens it into a column of one-word lines (2026-11-03). Removed
 * from the heading through the vote count, and only when every line between
 * is short, so prose that mentions the game stays.
 */
const PICKEM_HEADING = /^daily pick['’]em$/i;
const PICKEM_END = /^[\d,]+ votes?$/i;
const PICKEM_MAX_LINES = 40;
const PICKEM_LINE_MAX = 30;

export function stripPickemWidgets(markdown: string): string {
  if (!/pick['’]em/i.test(markdown)) return markdown;
  const lines = markdown.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (PICKEM_HEADING.test(lines[i]!.trim())) {
      let end = -1;
      for (let j = i + 1; j < Math.min(lines.length, i + PICKEM_MAX_LINES); j++) {
        const line = lines[j]!.trim();
        if (PICKEM_END.test(line)) {
          end = j;
          break;
        }
        if (line.length > PICKEM_LINE_MAX) break;
      }
      if (end !== -1) {
        i = end;
        if (lines[i + 1]?.trim() === '') i++;
        continue;
      }
    }
    kept.push(lines[i]!);
  }
  return kept.join('\n');
}

/**
 * A photo caption and its credit, run together: The Athletic sets them in
 * sibling spans, so the text reads "…three seasons.Brandon Dill / Associated
 * Press" (2026-11-03). Only the line right after an image, and only a
 * "Name / Agency" credit glued to the caption's last sentence.
 */
const IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)$/;
const RUN_TOGETHER_CREDIT = /^(.*\S[.!?"”’])([A-Z][^/\n]{1,60} \/ [^/\n]{2,60})$/;

export function separateCaptionCredits(markdown: string): string {
  if (!markdown.includes(' / ')) return markdown;
  const lines = markdown.split('\n');
  let previous = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (IMAGE_LINE.test(previous)) {
      const match = lines[i]!.match(RUN_TOGETHER_CREDIT);
      if (match) lines[i] = `${match[1]} ${match[2]}`;
    }
    previous = line;
  }
  return lines.join('\n');
}
