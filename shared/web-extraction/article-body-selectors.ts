/**
 * Article-body selectors for sites Defuddle's auto-detection over-reaches on.
 *
 * Used by every surface that runs Defuddle: the extension's in-page clip/reader
 * extraction and the Worker's server-side web archive.
 *
 * Defuddle picks the main content element by scoring known entry points
 * (`article`, `main`, `.post-content`, …). Korean news outlets wrap the story
 * in a container none of those match, so scoring settles on `<main>` or
 * `<body>` and the ranking rails ("많이 본 뉴스"), tag rows, series lists and
 * footer link lists come along — the junk that renders under the article in
 * reader mode. Naming the real container short-circuits scoring entirely.
 *
 * Measured 2026-08-03 (markdown length, auto → selector; every one ends on the
 * article's real last sentence): edaily 17.6k → 0.9k, mk 13.6k → 0.7k,
 * donga 6.5k → 1.2k, khan 1.3k → 0.5k, ytn 1.8k → 1.0k, yna 2.7k → 2.3k,
 * hani 3.2k → 2.1k. joongang/hankyung already extracted correctly and are
 * listed only to pin them against a redesign.
 *
 * Host-keyed rather than a blind selector probe on purpose: class names like
 * `.news_body` and `.article-text` are common enough elsewhere that probing
 * them globally could truncate an unrelated site's article. A selector that
 * stops matching costs nothing — Defuddle falls back to auto-detection when
 * `contentSelector` finds no element.
 *
 * To add an outlet: open one of its articles, find the element wrapping only
 * the story text, and add `'<registrable host>': '<selector>'`.
 */
const ARTICLE_BODY_SELECTORS: Record<string, string> = {
  'donga.com': 'section.news_view',
  'edaily.co.kr': '.news_body',
  'hani.co.kr': '.article-text',
  'hankyung.com': '#articletxt',
  'joongang.co.kr': '#article_body',
  'khan.co.kr': '#articleBody',
  'mk.co.kr': '.news_cnt_detail_wrap',
  'yna.co.kr': '.story-news',
  'ytn.co.kr': '#CmAdContent',
};

/**
 * Selector to hand Defuddle as `contentSelector`, or undefined to let it
 * auto-detect. Matches the host and any subdomain of it (`www.`, `m.`, `n.`).
 */
export function articleBodySelectorForHost(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  for (const [site, selector] of Object.entries(ARTICLE_BODY_SELECTORS)) {
    if (host === site || host.endsWith(`.${site}`)) return selector;
  }
  return undefined;
}
