/**
 * Publishers whose full article the app can capture through the user's own
 * signed-in session (.taskmaster/docs/prd-paywalled-publisher-session-archive.md §8).
 *
 * Every `slug` must also be in the server's PAYWALLED_PUBLISHER_SLUGS
 * (workers/src/utils/paywalled-publishers.ts). That is what makes a session
 * capture upsert the `pub-<slug>-…` row the outlink created instead of adding
 * a second archive. workers/src/__tests__/utils/paywalled-publishers.test.ts
 * fails when the two drift.
 *
 * Import-free, so every sync target compiles it unchanged. Consumers import the
 * file directly; it is deliberately not in the platforms barrel.
 */

export interface PublisherSession {
  /** publisher-lookup slug. UI name and icon come from `getPublisherBySlug`. */
  readonly slug: string;
  /** Registrable domain. A host matches when it equals it or is a dot-bounded subdomain. */
  readonly domain: string;
  /** Page the login sheet opens. */
  readonly loginUrl: string;
  /** Cookie whose presence means signed in. Only presence is checked; the value is never read. */
  readonly sessionCookie?: string;
  /** Present when the page cut the article off behind a subscribe wall. May render late (NYT), so callers wait. */
  readonly gatewaySelector?: string;
  /** Article body container: Defuddle's `contentSelector`, and the "this page is an article" check. */
  readonly contentSelector?: string;
  /** Query parameters that turn a URL into a gift link (full article without a session). */
  readonly giftLinkParams?: readonly string[];
  /**
   * App languages whose Settings list this publisher (`['ko']` for a Korean
   * outlet). Absent: every language. Only the Settings row is gated; capture
   * and the sign-in sheet work in every language.
   */
  readonly locales?: readonly string[];
}

export const PUBLISHER_SESSIONS: readonly PublisherSession[] = [
  // The second selector of each pair is The Athletic (www.nytimes.com/athletic/…),
  // measured 2026-11-03 (.taskmaster/docs/paywalled-publisher-athletic-notes.md).
  // Its body is the element the page's JSON-LD marks as the paywalled part.
  // Its wall is an onsite-messaging unit drawn by script, like NYT's, so it
  // gets the same wait; read from the page's code, not seen on a signed-out page.
  {
    slug: 'nytimes',
    domain: 'nytimes.com',
    loginUrl: 'https://myaccount.nytimes.com/auth/login',
    sessionCookie: 'NYT-S',
    gatewaySelector: '#gateway-content, #athletic-gateway-container',
    contentSelector: 'section[name="articleBody"], .article-content-container',
    giftLinkParams: ['unlocked_article_code'],
  },
  // Measured 2026-11-02 (.taskmaster/docs/paywalled-publisher-ft-notes.md).
  // The barrier is server-rendered and replaces the article outright, so the
  // gateway check needs no wait. Gift links not measured yet, so none listed.
  // ponytail: the "Recommended" aside inside #article-body still lands in the
  // markdown (1 of 2 measured articles); add a clutter selector field if it bites.
  {
    slug: 'ft',
    domain: 'ft.com',
    // accounts.ft.com is where www.ft.com/login lands. Using it directly also
    // puts that host in the per-site cookie clear on disconnect (Android only
    // expires cookies visible to the hosts it is given).
    loginUrl: 'https://accounts.ft.com/login',
    sessionCookie: 'FTSession_s',
    gatewaySelector: '#barrier-page',
    contentSelector: '#article-body',
  },
  // Measured 2026-11-03 (.taskmaster/docs/paywalled-publisher-wsj-notes.md).
  // A signed-out page holds the first two paragraphs and the server says so in
  // a meta tag (`full` on a subscriber's page), so the gateway check needs no
  // wait. DataDome guards the site. Gift links exist but making one spends
  // one, so none listed yet.
  {
    slug: 'wsj',
    domain: 'wsj.com',
    // The site's own sign-in link; it hands off to sso.accounts.dowjones.com
    // and comes back with the session cookies on .wsj.com.
    loginUrl: 'https://www.wsj.com/client/login?target=https%3A%2F%2Fwww.wsj.com%2F',
    // A signed-in ID token, visible to page scripts; the site's cookie budget
    // keeps it with its sign-in cookies.
    // ponytail: not checked in a signed-out browser (the owner was signed in).
    // It lives two days, so a reader who has not opened WSJ in the app for two
    // days reads as signed out until the next sign-in. Its httpOnly refresh
    // token `ca_rt` should outlive it; switch once a device confirms it.
    sessionCookie: 'ca_id',
    gatewaySelector: 'meta[name="article.template"][content="preview"]',
    // The page's only section. The preview paragraphs sit in it directly and
    // the rest inside its `.paywall` child, so `.paywall` alone drops the first two.
    contentSelector: 'section:has(p[data-type="paragraph"])',
  },
  // Measured 2026-11-03 (.taskmaster/docs/paywalled-publisher-bloomberg-notes.md).
  // A signed-out page holds the first two paragraphs, and a script fills the
  // wall root in after load (it sits empty on a subscriber's page), so the
  // gateway check relies on the extractor's wait, as for NYT. Bloomberg's bot
  // check (PerimeterX "Press & Hold") showed on a signed-out sign-in attempt.
  {
    slug: 'bloomberg',
    domain: 'bloomberg.com',
    // The sign-in page the site's own scripts link to.
    loginUrl: 'https://www.bloomberg.com/account/signin',
    // Signed in only, one year. session_key, session_id and _user-data are set
    // for anonymous readers too; _user-role is a browser-session cookie.
    sessionCookie: '_breg-uid',
    gatewaySelector: '#fortress-container-root > *',
    // The first one is the story's; the infinite scroll appends the next
    // story's below it.
    contentSelector: '.body-content',
    // The site's gift-link reader takes it from the query (a JWT).
    giftLinkParams: ['accessToken'],
  },
  // Measured 2026-11-03 (.taskmaster/docs/paywalled-publisher-economist-notes.md).
  // The wall is a custom element the article page draws after hydration, so the
  // gateway check relies on the extractor's wait, as for NYT. Gift links exist
  // (5 a month) but making one spends one, so none listed yet.
  {
    slug: 'theeconomist',
    domain: 'economist.com',
    // Hands off to myaccount.economist.com and comes back; the session cookies
    // are set on www.economist.com.
    loginUrl: 'https://www.economist.com/api/auth/login',
    // httpOnly, three months. Its fcx_access_token sibling lives one day.
    sessionCookie: 'fcx_refresh_token',
    gatewaySelector: 'teg-page-wall, teg-inline-wall',
    // The body section has no id and only hashed classes; its paragraphs are
    // the only `data-component="paragraph"` on the page. Header and hero
    // caption are sibling sections.
    contentSelector: 'section:has(p[data-component="paragraph"])',
    // No giftLinkParams: a gift link (`?giftId=…`) opened signed out shows two
    // paragraphs and "You've been gifted this story, create a free account"
    // (2026-11-03), so it needs a session like any other article.
  },
  // Measured 2026-11-03 (.taskmaster/docs/paywalled-publisher-longblack-notes.md).
  // A signed-out page holds the note's first ~10% and the server draws a fade
  // and a sign-up block under it, so the gateway check needs no wait.
  {
    slug: 'longblack',
    domain: 'longblack.co',
    loginUrl: 'https://longblack.co/login',
    // Set at sign-in, one year, readable by page scripts: the site's own
    // "signed in" hint. lb_remember_token (httpOnly) lives as long, but its
    // name suggests it needs "remember me".
    sessionCookie: 'lb_auth_hint',
    gatewaySelector: '#note-page > div > [class*="bg-gradient-to-b"]',
    // The page's JSON-LD marks `.article` as the paywalled part. The reader
    // comments (#coffeechat) sit outside it.
    contentSelector: 'article.article',
    // A member's "24시간 무료 링크": the full note for anyone, for a day.
    giftLinkParams: ['ticket'],
    locales: ['ko'],
  },
];

/**
 * The entry for an https article URL on a registered publisher. Null for other
 * sites, for plain http, and for a front page (empty path or `/`).
 */
export function getPublisherSession(url: string): PublisherSession | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  // Same rule as the server's paywalledArticlePostId: a front page has no article id.
  if (parsed.pathname.replace(/\/+$/, '') === '') return null;
  const host = parsed.hostname.toLowerCase();
  return PUBLISHER_SESSIONS.find((entry) => host === entry.domain || host.endsWith(`.${entry.domain}`)) ?? null;
}

/** True when `url` carries one of the entry's gift parameters with a value. */
export function isPublisherGiftLink(url: string, entry: PublisherSession): boolean {
  if (!entry.giftLinkParams?.length) return false;
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return false;
  }
  return entry.giftLinkParams.some((name) => (params.get(name) ?? '') !== '');
}
