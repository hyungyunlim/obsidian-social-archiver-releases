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
}

export const PUBLISHER_SESSIONS: readonly PublisherSession[] = [
  {
    slug: 'nytimes',
    domain: 'nytimes.com',
    loginUrl: 'https://myaccount.nytimes.com/auth/login',
    sessionCookie: 'NYT-S',
    gatewaySelector: '#gateway-content',
    contentSelector: 'section[name="articleBody"]',
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
