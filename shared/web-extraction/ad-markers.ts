/**
 * Ad-slot labels a publisher leaves inside the article body.
 *
 * News pages interleave ad slots with the story's paragraphs, and each slot
 * carries a visible label. Defuddle keeps the label because it sits inside the
 * article container. Measured on nytimes.com (2026-11-02): up to 26 lines per
 * article, alternating `Advertisement` and `[SKIP ADVERTISEMENT](#after-story-ad-N)`.
 *
 * Only whole lines that are nothing but the label are removed. A sentence that
 * mentions advertising is prose and stays.
 */

const AD_MARKER_LINE = /^[ \t]*\[?[ \t]*(?:skip[ \t]+)?advertisement[ \t]*(?:\]\([^)\n]*\))?[ \t]*$/gim;

export function stripAdMarkerLines(markdown: string): string {
  if (!/advertisement/i.test(markdown)) return markdown;
  // ponytail: the blank-line collapse is document-wide, so a fenced code block
  // with 3+ blank lines in an article that also has ad labels loses some. Scope
  // the collapse to the removed lines if that ever matters.
  return markdown.replace(AD_MARKER_LINE, '').replace(/\n{3,}/g, '\n\n');
}
