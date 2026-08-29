/**
 * Comment selectors for Korean community boards.
 *
 * Defuddle returns the post body and nothing else — every board renders its
 * comments outside the article container, so a board archive used to land
 * without the discussion, which on these sites is usually the half people
 * wanted.
 *
 * Shared because the two surfaces see different pages. The Worker fetches HTML
 * and gets whatever the server rendered; the extension reads the live DOM and
 * gets everything, including the boards that load comments over XHR (arca,
 * dcinside, inven). Same table, different reach: an entry that finds nothing
 * server-side still pays off in the clip lane.
 *
 * Host-keyed for the same reason `article-body-selectors.ts` is: `.comment`
 * and `.reply` are common enough that a global probe would scrape navigation
 * on unrelated sites. A selector that stops matching yields zero comments and
 * the archive is exactly what it is today — never a failure.
 *
 * theqoo appears in both places: the Worker calls its Rhymix JSON endpoint
 * (see BoardCommentService, which prefers the fetcher), while the extension
 * reads the markup that endpoint already painted into the page.
 *
 * To add a board: open a post, find the element repeated once per comment, and
 * add an entry. Comment text only — images posted inside a comment are not
 * collected yet, and neither is reply nesting (every board flattens here).
 */

/** Hard cap per archive: threads run to thousands and D1 rows stop at 2MB. */
export const MAX_BOARD_COMMENTS = 300;

export interface BoardCommentSelectors {
  /** Element repeated once per comment. */
  item: string;
  /** Comment text, relative to `item`. */
  content: string;
  author?: string;
  timestamp?: string;
  likes?: string;
  /**
   * Matched against the item itself: a match is a reply to the nearest
   * preceding top-level comment. For boards that mark replies on the row
   * (ruliweb's `.child`) or wrap them in a replies-only container placed
   * after the parent (Korean Blind's `.wrap-reply`).
   */
  reply?: string;
  /**
   * Container holding one parent and its replies together (US Blind's
   * `#comment-group-<id>`): the first item found inside a given container is
   * the parent, every later item in the same container is a reply.
   */
  group?: string;
  /**
   * Badge text rendered INSIDE the content node (etoland's "베플로 선정된
   * 댓글입니다." span): each match's text is removed from the comment before
   * it is stored, so the badge neither pollutes the text nor defeats the
   * author+text dedup against the board's pinned copy.
   */
  contentStrip?: string;
}

const BOARD_COMMENT_SELECTORS: Record<string, BoardCommentSelectors> = {
  // Comments the server already renders — these work on both surfaces.
  'bobaedream.co.kr': {
    item: '#cmt_list li',
    content: 'dd[id^="small_cmt_"]',
    author: '.author',
    timestamp: '.date',
  },
  'clien.net': {
    item: '.comment_row[data-comment-sn]',
    content: '.comment_view',
    author: '.contact_name .nickname',
    timestamp: '.comment_time',
    likes: '.comment_symph',
  },
  'fmkorea.com': {
    item: 'li.fdb_itm[id^="comment_"]',
    content: '.comment-content',
    author: '.meta .member_plate',
    timestamp: '.meta .date',
    likes: '.voted_count',
  },
  'instiz.net': {
    item: 'tr.cmt_view',
    // The sibling `.minitext` holds a relative time ("4시간 전") and the
    // absolute one only inside an onmouseover handler, so instiz comments keep
    // no timestamp rather than an invented one.
    content: '.comment_line span[id^="n"]',
    author: 'td.comment_memo .href',
  },
  'pann.nate.com': {
    item: 'dl.cmt_item',
    content: '.usertxt',
    author: '.nameui',
    timestamp: 'dt i',
    likes: '.n_good',
  },
  'ruliweb.com': {
    item: 'tr.comment_element[id^="ct_"]',
    content: '.text_wrapper .text',
    author: '.nick strong',
    timestamp: '.time',
    likes: '.btn_like .num',
    reply: 'tr.comment_element.child',
  },

  // Comments loaded over XHR: empty in the Worker's HTML, present in the
  // extension's DOM. Listed so the clip lane gets them.
  'arca.live': {
    item: '.comment-item[id^="c_"]',
    content: '.message',
    author: '.user-info a',
    timestamp: 'time',
  },
  'etoland.co.kr': {
    // The modern app renders the pinned 베댓 widget AND the real rows as
    // `.comment-item`; only real rows carry an `ml-*` depth class, and their
    // pinned duplicates differ only by the badge contentStrip removes — so the
    // dedup collapses them. `ml-4`+ marks a reply. Dates come bare
    // ("2026-08-24"), which the parser reads as midnight KST.
    item: '#comment-list .comment-item[class*=" ml-"]',
    content: '.body-m-reading',
    author: '.nickname',
    timestamp: '.caption-m',
    likes: '.good-count',
    reply: '.comment-item[class*=" ml-"]:not(.ml-0)',
    contentStrip: '.label-m',
  },
  'damoang.net': {
    // Extension lane only: the Worker archives damoang through its comments
    // API (DamoangDirectService) and its HTML fetch 403s anyway. The live DOM
    // keeps two semantic hooks amid the compiled Tailwind: the `c_{id}` item
    // ids and `.comment-body`. Timestamps show a bare "08.20" (no time), which
    // the parser rejects rather than inventing midnight — so no timestamp.
    item: 'li[id^="c_"].comment-item',
    content: '.comment-body',
    author: 'p.text-foreground.font-medium',
    // No likes: the count renders in a bare `span.font-semibold`, which a
    // bolded number inside a comment body would false-match. The Worker's
    // API lane carries the real count.
    // Depth is drawn with an inline margin — 0rem for top-level, 1rem+ for
    // replies. Style-based, but it is the only depth signal in the markup.
    reply: 'li[id^="c_"]:not([style*="margin-left: 0"])',
  },
  'teamblind.com': {
    // Two apps, one host: the Korean site (Nuxt, `.wrap-comment`) and the US
    // one (React, `#comment-<id>`). Selector lists cover both; only one half
    // ever matches inside a given comment.
    //
    // `[id]` on the Korean half drops the sponsored row Blind renders inline
    // with the comments — it is the one node in the list without an id.
    item: '.wrap-comment.comment_area[id], [id^="comment-"]:not([id^="comment-group-"])',
    content: '.cmt-txt, p.whitespace-pre-wrap',
    // US: the company anchor in the header. The avatar above it links to the
    // same place with no text, and `a.font-semibold` is the one that carries
    // the name. Blind identity is the company; the handle beside it is random
    // per thread and its only container also holds a relative "2d" that would
    // be wrong the day after archiving.
    author: '.name, a.font-semibold',
    // US comments show "2d"; the absolute date lives in a title attribute this
    // reads no attributes of, so they keep no timestamp.
    timestamp: '.wrap-info .date',
    // KR puts ONLY the replies in `.wrap-reply`, as a sibling after their
    // parent; the US app wraps parent and replies together in a group whose
    // id repeats the parent's.
    reply: '.wrap-reply .wrap-comment',
    group: '[id^="comment-group-"]',
  },
  'theqoo.net': {
    // Rhymix paints these from its own XHR on load; the Worker asks the same
    // endpoint directly instead. Author reads "302. 무명의 더쿠" — the number
    // is how commenters reference each other ("@302"), so keep it.
    item: '#cmtPosition li[id^="comment_"]',
    content: '.xe_content',
    author: '.meta a',
    timestamp: '.meta .date',
  },
  'dcinside.com': {
    item: '.cmt_list li[id^="comment_li_"]',
    content: 'p.usertxt',
    author: '.gall_writer .nickname',
    // "08.19 19:06:16" — dcinside drops the year on recent comments.
    timestamp: '.date_time',
  },
  'inven.co.kr': {
    // Two lists: BEST (`#pwbbsbestCmt_*`) repeats rows from the main one
    // (`#pwbbsCmt_*`); `li.row` takes both and the dedup collapses them.
    item: '.commentList1 li.row',
    content: '.cmtContentOne',
    author: '.nickname',
    timestamp: '.date',
    likes: '.bttn_good span',
  },
};

/** Selectors for `hostname`, matching the host and any subdomain of it. */
export function boardCommentSelectorsForHost(hostname: string): BoardCommentSelectors | undefined {
  const host = hostname.toLowerCase();
  for (const [site, selectors] of Object.entries(BOARD_COMMENT_SELECTORS)) {
    if (host === site || host.endsWith(`.${site}`)) return selectors;
  }
  return undefined;
}

/** Assignable to both the Worker's `Comment` and the clip payload's shape. */
export interface BoardComment {
  id: string;
  author: { name: string; url: string };
  content: string;
  timestamp?: string;
  likes?: number;
  replies?: BoardComment[];
}

/** The slice of the DOM this needs — satisfied by a browser or LinkedOM node. */
interface QueryScope {
  querySelector(selector: string): QueryScope | null;
  querySelectorAll?(selector: string): Iterable<{ textContent?: string | null }>;
  matches?(selector: string): boolean;
  closest?(selector: string): unknown;
  textContent?: string | null;
}
interface QueryableDocument {
  querySelectorAll(selector: string): Iterable<QueryScope>;
}

/**
 * Comments for `url`, or an empty array for a host with no entry.
 *
 * Pure DOM: give it the live document in the extension, or a parsed one in the
 * Worker. Never throws — a redesigned board costs the archive its comments,
 * not the archive.
 */
export function extractBoardCommentsFromDocument(
  document: QueryableDocument,
  url: string,
  now: Date = new Date()
): BoardComment[] {
  let selectors: BoardCommentSelectors | undefined;
  try {
    selectors = boardCommentSelectorsForHost(new URL(url).hostname);
  } catch {
    return [];
  }
  if (!selectors) return [];

  const comments: BoardComment[] = [];
  // BEST/베플 comments are rendered twice — pinned at the top and again in
  // sequence. Author+text is a stabler key than the per-site element id.
  const seen = new Set<string>();
  let total = 0;
  // Reply threading works on document order: a reply attaches to the last
  // top-level comment seen, which is its parent on every board here because
  // replies render directly under their parent.
  let lastTop: BoardComment | undefined;
  let lastGroup: unknown;

  for (const item of document.querySelectorAll(selectors.item)) {
    let content = textOf(item, selectors.content);
    if (!content) continue;
    if (selectors.contentStrip) {
      const node = item.querySelector(selectors.content);
      for (const badge of node?.querySelectorAll?.(selectors.contentStrip) ?? []) {
        const text = badge.textContent?.replace(/\s+/g, ' ').trim();
        if (text) content = content.replace(text, '').replace(/\s+/g, ' ').trim();
      }
      if (!content) continue;
    }

    const author = (selectors.author && textOf(item, selectors.author)) || '익명';
    const key = `${author} ${content}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const timestamp = selectors.timestamp
      ? parseBoardTimestamp(textOf(item, selectors.timestamp), now)
      : undefined;
    const likes = selectors.likes ? parseCount(textOf(item, selectors.likes)) : undefined;

    let isReply = false;
    if (selectors.reply && typeof item.matches === 'function') {
      try {
        isReply = item.matches(selectors.reply);
      } catch {
        // A selector the engine rejects downgrades threading, not extraction.
      }
    }
    if (!isReply && selectors.group && typeof item.closest === 'function') {
      const group = item.closest(selectors.group);
      if (group) {
        isReply = group === lastGroup;
        lastGroup = group;
      } else {
        lastGroup = undefined;
      }
    }

    total += 1;
    const comment: BoardComment = {
      id: `${url}#c${total}`,
      author: { name: author, url },
      content,
      ...(timestamp ? { timestamp } : {}),
      ...(likes !== undefined ? { likes } : {}),
    };

    if (isReply && lastTop) {
      (lastTop.replies ??= []).push(comment);
    } else {
      comments.push(comment);
      lastTop = comment;
    }

    if (total >= MAX_BOARD_COMMENTS) break;
  }

  return comments;
}

function textOf(scope: QueryScope, selector: string): string | null {
  const el = scope.querySelector(selector);
  if (!el) return null;
  const text = el.textContent?.replace(/\s+/g, ' ').trim();
  return text ? text : null;
}

function parseCount(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
}

/**
 * Board timestamps, all of them Korea time and none of them agreeing on a
 * format: `20260820103018` (theqoo), `2026-08-20 13:22:27` (clien),
 * `2026.08.19 19:58` (pann, fmkorea), `26.08.19 10:21` (ruliweb, bobaedream),
 * `08.19 19:06:16` (dcinside — no year at all), `2025.01.17.` (Blind — no
 * time at all).
 *
 * `now` is only read for the year-less form, and only to pick between this
 * year and last; a comment dated in the future is a comment from December
 * read in January.
 */
export function parseBoardTimestamp(
  raw: string | null | undefined,
  now: Date = new Date()
): string | undefined {
  if (!raw) return undefined;

  const compact = raw.match(/\b(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\b/);
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact;
    return toKstIso(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s));
  }

  const dated = raw.match(/(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})\D{1,4}(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dated) {
    const [, rawYear, mo, d, h, mi, s] = dated;
    const year = rawYear!.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    return toKstIso(year, Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0));
  }

  // Blind stamps a date and no time at all ("작성일2025.01.17.").
  const dateOnly = raw.match(/\b(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return toKstIso(Number(y), Number(mo), Number(d), 0, 0, 0);
  }

  const yearless = raw.match(/\b(\d{1,2})[.\-/](\d{1,2})\D{1,4}(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!yearless) return undefined;

  const [, mo, d, h, mi, s] = yearless;
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const guess = toKstIso(
    kstNow.getUTCFullYear(),
    Number(mo),
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0)
  );
  if (!guess) return undefined;
  // A day of slack absorbs clock skew; anything beyond that is last year.
  if (Date.parse(guess) - now.getTime() <= 24 * 60 * 60 * 1000) return guess;
  return toKstIso(
    kstNow.getUTCFullYear() - 1,
    Number(mo),
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0)
  );
}

function toKstIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return undefined;
  const utc = Date.UTC(year, month - 1, day, hour - 9, minute, second);
  if (Number.isNaN(utc)) return undefined;
  return new Date(utc).toISOString();
}
