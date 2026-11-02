/**
 * Raw `<video>` / `<audio>` HTML that Defuddle leaves in its markdown.
 *
 * An inline news video comes through as the page's own markup. NYT's is a
 * ~2 KB `<video controls><source type="video/mp4; codecs=…" src="…">`,
 * measured 2026-11-02. It usually keeps the page's indentation, so markdown
 * renders it as a code block and the reader sees the tags. Each block becomes
 * one link line to the source; a block with no https source is dropped.
 */

const MEDIA_BLOCK = /[ \t]*<(video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi;
const SRC_ATTRIBUTE = /\bsrc=["']([^"']+)["']/i;

export function replaceRawMediaHtml(markdown: string): string {
  if (!/<(?:video|audio)\b/i.test(markdown)) return markdown;
  return markdown.replace(MEDIA_BLOCK, (block, tag: string) => {
    const src = SRC_ATTRIBUTE.exec(block)?.[1]?.replace(/&amp;/g, '&');
    const label = tag.toLowerCase() === 'audio' ? 'Audio' : 'Video';
    return src && /^https:\/\//i.test(src) ? `[▶ ${label}](${src})` : '';
  });
}
