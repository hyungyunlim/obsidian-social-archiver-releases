/**
 * Give Defuddle's schema.org fallback body real paragraphs.
 *
 * When the page holds far fewer words than its JSON-LD `articleBody`, Defuddle
 * looks for the element holding that text, and when there is none it returns
 * the `articleBody` string itself as `content`: escaped plain text, paragraphs
 * split by bare newlines, no `<p>` anywhere. Rendered as Markdown, or turned
 * from HTML into Markdown, the newlines collapse and the whole article reads
 * as one paragraph.
 *
 * Seen on The New Yorker (2026-11-05): its paywall script removes the article
 * from the live DOM after load, so the extension's Reader and Clip get the
 * JSON-LD body, single `\n` between paragraphs. defuddle 0.19.5.
 *
 * Content holding any element is Defuddle's normal HTML and is returned as is.
 */
export function plainTextToParagraphHtml(content: string): string {
  // Defuddle serializes the text, so a literal `<` arrives as `&lt;`: any `<`
  // followed by a letter is a real tag.
  if (!content.trim() || /<[a-z]/i.test(content)) return content;
  return content
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<p>${line}</p>`)
    .join('');
}
