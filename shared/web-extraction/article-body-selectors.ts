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
 * Community boards fail the same scoring the other way: a post whose body is
 * only images — the norm on theqoo, inven, dcinside — scores near zero on
 * text, so the board's own post-list table or the site footer wins and the
 * archive becomes a list of unrelated thread titles with none of the post's
 * images. Naming the container is only half the fix there: Defuddle's public
 * `parse()` retries whenever a result has under 50 words and one of those
 * retries substitutes its own selector, so the Worker also deletes everything
 * outside this container before parsing (`narrowBodyToContent`).
 *
 * Measured 2026-08-20, auto → selector, one live post per board: theqoo
 * 0 → 20 post images (was the 27-row board list), inven footer → the post,
 * bobaedream/dcinside/todayhumor/pann sitewide navigation → the post. fmkorea,
 * clien and ruliweb already extract correctly and are deliberately absent.
 *
 * To add an outlet: open one of its articles, find the element wrapping only
 * the story text, and add `'<registrable host>': '<selector>'`.
 */
const ARTICLE_BODY_SELECTORS: Record<string, string> = {
  // ── News outlets ────────────────────────────────────────────────────────
  'donga.com': 'section.news_view',
  // Daum News view — the translation-widget language list and the bottom
  // article rail live outside the article container.
  'v.daum.net': '.article_view',
  'edaily.co.kr': '.news_body',
  'hani.co.kr': '.article-text',
  'hankyung.com': '#articletxt',
  'joongang.co.kr': '#article_body',
  'khan.co.kr': '#articleBody',
  'mk.co.kr': '.news_cnt_detail_wrap',
  'yna.co.kr': '.story-news',
  'ytn.co.kr': '#CmAdContent',

  // Measured 2026-08-20, auto → selector, one live article each. The junk cut
  // is the "관련기사"/"많이 본" link rails — effectively ads — plus reporter
  // profiles and ranking lists: thelec 1,002 → 673 words, kmib 1,625 → 723,
  // newsis 3,402 → ~400 (the rail dwarfed the article), asiae 1,411 → 872,
  // segye 1,382 → 385. heraldcorp already extracts correctly and
  // chosun/news1 render client-side (Tier 2 territory), so none are listed.
  'asiae.co.kr': '#txt_area',
  'etnews.com': '#articleBody',
  'gqkorea.co.kr': '.contt',
  'kmib.co.kr': '#articleBody',
  'mediatoday.co.kr': '#article-view-content-div',
  'newsis.com': '.viewer',
  // Three templates on one brand: the 2025 desktop article, the photo pages
  // (whose FIRST .at_contents is a header wrapper — hence the parent-scoped
  // selectors), and the star.ohmynews.com vertical.
  'ohmynews.com': '.atc_view2025 .at_contents, .article_view .at_contents, .atc-text',
  'sedaily.com': '#article-body',
  'segye.com': '#article_txt',
  'thelec.kr': '#article-view-content-div',
  'zdnet.co.kr': '#articleBody',

  // ── Community boards (measured 2026-08-20, one live post each) ──────────
  // arca.live sits behind a Cloudflare challenge, so the Worker only ever
  // reaches it through a Tier 2 render; the selector serves that and the
  // extension's clip.
  'arca.live': '.article-content',
  'bobaedream.co.kr': '.bodyCont',
  // Two halves, one entry: the first pins the synthetic page the Worker
  // rebuilds from __data.json (the real HTML 403s behind Cloudflare); the
  // second is the live DOM's one stable id — named "economy" on every board,
  // it is a fixed component id, not the board slug (verified on free and
  // economy posts, 2026-08-24) — which gives the extension's reader/clip a
  // body the SvelteKit class soup otherwise denies it.
  'damoang.net': 'article[itemprop="articleBody"], #economy-post-content',
  // Korean Blind only. The US site at the same host is a different app
  // whose auto-detection is already clean, and it has no #contentArea —
  // a selector that matches nothing costs nothing.
  'teamblind.com': '#contentArea',
  'inven.co.kr': '#powerbbsContent',
  'pann.nate.com': '#contentArea',
  'dcinside.com': '.write_div',
  // Image-only posts again: the "오늘의 HIT 30" rail outscores the post.
  'etoland.co.kr': '.view-content',
  'theqoo.net': 'article[itemprop="articleBody"]',
  'todayhumor.co.kr': '.viewContent',
};

/**
 * Clutter that lives INSIDE the article container, where the body selector
 * cannot cut it: mediatoday nests its "관련기사" block in the content div
 * (thelec, on the same CMS, keeps it outside), and zdnet drops a related-news
 * box mid-body. Deleted before Defuddle parses; a heading whose entire text is
 * "관련기사" is dropped with it, because zdnet's sits outside the box it
 * labels.
 */
const ARTICLE_STRIP_SELECTORS: Record<string, string> = {
  // GQ nests its 관련기사 block inside the article container.
  'gqkorea.co.kr': '.relate_group',
  'mediatoday.co.kr': 'article.relation',
  // The star vertical nests its donation box + tag row inside the body.
  'ohmynews.com': '.arc-bottom-wrap',
  'zdnet.co.kr': '.news_box',
};

/** Selector of in-body clutter to delete for `hostname`, or undefined. */
export function articleStripSelectorForHost(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  for (const [site, selector] of Object.entries(ARTICLE_STRIP_SELECTORS)) {
    if (host === site || host.endsWith(`.${site}`)) return selector;
  }
  return undefined;
}

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

interface RemovableNode {
  parentNode: { insertBefore(node: unknown, before: unknown): unknown } | null;
  nextSibling: unknown;
  remove(): void;
}

/**
 * Remove this host's strip matches (in-body 관련기사 blocks) from a document
 * and return a function that puts every node back exactly where it was.
 *
 * For the extension, which runs Defuddle against the LIVE page: a clone has no
 * `defaultView`, so parsing a stripped clone would change Defuddle's
 * hidden-element handling for every page. Removing before the synchronous
 * `parse()` and restoring right after mutates nothing the user can see — the
 * browser never paints mid-task. Restoration runs in reverse so an adjacent
 * removed sibling's anchor is already back in the tree.
 */
export function removeArticleClutterInPlace(
  document: { querySelectorAll(selector: string): Iterable<RemovableNode> },
  hostname: string
): () => void {
  const selector = articleStripSelectorForHost(hostname);
  if (!selector) return () => {};

  const removed: Array<{ node: RemovableNode; parent: NonNullable<RemovableNode['parentNode']>; next: unknown }> = [];
  for (const node of document.querySelectorAll(selector)) {
    if (!node.parentNode) continue;
    removed.push({ node, parent: node.parentNode, next: node.nextSibling });
    node.remove();
  }
  return () => {
    for (let i = removed.length - 1; i >= 0; i--) {
      const entry = removed[i]!;
      entry.parent.insertBefore(entry.node, entry.next);
    }
  };
}
