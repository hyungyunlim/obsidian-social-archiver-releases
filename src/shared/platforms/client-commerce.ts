/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/client-commerce.ts
 * Generated: 2026-08-09T01:16:17.430Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

import type { ProductSnapshot } from './products';

export const CLIENT_PRODUCT_SCHEMA_VERSION = 1 as const;
export const CLIENT_PRODUCT_EXTRACTOR_VERSION = 'commerce-dom-v1';
export const MAX_CLIENT_PRODUCT_IMAGES = 12;

export type ClientProductCaptureSurface =
  | 'chrome-clip'
  | 'ios-safari-extension'
  | 'ios-share-preprocessor'
  | 'mobile-webview'
  | 'desktop-webview';

/**
 * Surfaces where the page was loaded by a background session the user is not
 * looking at, rather than clipped from a tab they opened themselves. They earn
 * strictly less trust — see the URL rule in `validateClientProductEnvelope`.
 */
const BACKGROUND_SESSION_SURFACES: ReadonlySet<ClientProductCaptureSurface> =
  new Set(['mobile-webview', 'desktop-webview']);

export function isBackgroundSessionCaptureSurface(
  surface: ClientProductCaptureSurface,
): boolean {
  return BACKGROUND_SESSION_SURFACES.has(surface);
}

export type CommerceCandidateReason =
  | 'structured-product'
  | 'verified-site-adapter'
  | 'verified-client-only-url'
  | 'generic-product-evidence';

export interface CommerceCandidateDecision {
  readonly qualified: boolean;
  readonly reason?: CommerceCandidateReason;
}

export interface ClientProductEnvelopeV1 {
  readonly schemaVersion: typeof CLIENT_PRODUCT_SCHEMA_VERSION;
  readonly pageUrl: string;
  readonly captureSurface: ClientProductCaptureSurface;
  readonly qualificationReason: CommerceCandidateReason;
  readonly snapshot: ProductSnapshot;
}

export type ProviderProductIdentity = {
  readonly provider:
    | 'amazon'
    | 'coupang'
    | 'gmarket'
    | 'naver-store'
    | 'oliveyoung'
    | 'ohou'
    | 'walmart'
    | 'etsy'
    | 'homedepot'
    | 'zalando'
    | 'trendyol'
    | 'noon'
    | 'uniqlo'
    | '29cm'
    | 'musinsa';
  readonly id: string;
};

const AMAZON_HOST = /(^|\.)amazon\.(com|co\.uk|co\.jp|de|fr|it|es|ca|com\.au|com\.mx|in|nl|se|pl|sg|ae)$/i;
const AMAZON_PATH = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;
const AMAZON_SHORT_HOSTS = new Set(['a.co', 'amzn.to', 'amzn.eu', 'amzn.asia']);
const AMAZON_SHORT_D_PATH = /^\/d\/[A-Za-z0-9_-]+\/?$/;
const AMAZON_SHORT_ROOT_PATH = /^\/[A-Za-z0-9_-]+\/?$/;
const COUPANG_HOST = /(^|\.)coupang\.com$/i;
const COUPANG_PATH = /^\/vp\/products\/(\d+)(?:[/?]|$)/i;
const COUPANG_SHORT_HOST = 'link.coupang.com';
const COUPANG_SHORT_PATH = /^\/a\/[A-Za-z0-9_-]+\/?$/;
const GMARKET_HOST = /(^|\.)gmarket\.co\.kr$/i;
const NAVER_STORE_HOST = /^(?:smartstore|brand)\.naver\.com$/i;
const OLIVEYOUNG_HOST = /(^|\.)oliveyoung\.co\.kr$/i;
const OHOU_HOST = /(^|\.)ohou\.se$/i;
const WALMART_HOST = /(^|\.)walmart\.com$/i;
const ETSY_HOST = /(^|\.)etsy\.com$/i;
const HOME_DEPOT_HOST = /(^|\.)homedepot\.com$/i;
const ZALANDO_HOST = /(^|\.)zalando\.[a-z.]+$/i;
const TRENDYOL_HOST = /(^|\.)trendyol\.com$/i;
const NOON_HOST = /(^|\.)noon\.com$/i;
const UNIQLO_HOST = /(^|\.)uniqlo\.com$/i;
// /kr/ko/products/E469292-000/00 — every region uses the same E-code shape.
// The `-000` suffix and trailing pld segment are display codes, so identity
// normalizes to the E-code core.
const UNIQLO_PATH = /\/products\/(E\d{6})(?:-\d{3})?(?:[/?]|$)/i;
// Both ship full Product JSON-LD in the browser but only intermittently in
// server-visible HTML (measured 07-27 vs 07-29), so the WebView backfill
// needs a stable identity for them. App shares arrive as *.onelink.me and
// expand server-side to these canonical shapes.
const TWENTYNINE_CM_HOST = /(^|\.)29cm\.co\.kr$/i;
const MUSINSA_HOST = /(^|\.)musinsa\.com$/i;

const NON_PRODUCT_PATH = /\/(?:search|s|category|categories|collections|cart|basket|checkout|login|signin|account|consent|challenge)(?:\/|$)/i;
const PRODUCT_SHAPED_PATH = /\/(?:products?|items?|goods?|listing|productions?|dp|p)(?:\/|[-_])/i;
const PRODUCT_QUERY_KEYS = [
  'goodsCode',
  'goodscode',
  'itemId',
  'itemNo',
  'productId',
  'product_id',
  'goodsNo',
  'sku',
] as const;

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
}

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function queryValue(url: URL, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = url.searchParams.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Stable provider identity for client-only stores measured in the Chrome work.
 *
 * A hostname alone never qualifies. Every provider must expose a stable
 * product id in the path or a documented query field, keeping home/search/
 * category pages out of the background WebView queue.
 */
export function readClientOnlyProductIdentity(value: string): ProviderProductIdentity | null {
  const url = safeUrl(value);
  if (!url) return null;
  const host = normalizedHost(url.hostname);

  if (AMAZON_HOST.test(host)) {
    const asin = AMAZON_PATH.exec(url.pathname)?.[1]?.toUpperCase();
    return asin ? { provider: 'amazon', id: asin } : null;
  }
  if (COUPANG_HOST.test(host)) {
    const productId = COUPANG_PATH.exec(url.pathname)?.[1];
    return productId ? { provider: 'coupang', id: productId } : null;
  }
  if (GMARKET_HOST.test(host) && /^\/item(?:\/|$)/i.test(url.pathname)) {
    const goodsCode = queryValue(url, 'goodscode', 'goodsCode');
    return goodsCode ? { provider: 'gmarket', id: goodsCode.toLowerCase() } : null;
  }
  if (NAVER_STORE_HOST.test(host)) {
    const productId = /^\/[^/]+\/products\/(\d+)(?:\/|$)/i.exec(url.pathname)?.[1];
    return productId ? { provider: 'naver-store', id: productId } : null;
  }
  if (OLIVEYOUNG_HOST.test(host) && /\/store\/goods\/getGoodsDetail\.do$/i.test(url.pathname)) {
    const goodsNo = queryValue(url, 'goodsNo');
    return goodsNo ? { provider: 'oliveyoung', id: goodsNo } : null;
  }
  if (OHOU_HOST.test(host)) {
    // Legacy /productions/{id}/selling (app deeplinks, ozip.me fallback) and
    // the current web PDP store.ohou.se/goods/{id} share one numeric id
    // namespace — the productions URL 302s straight to the goods page.
    const productId = /^\/productions\/(\d+)(?:\/selling)?\/?$/i.exec(url.pathname)?.[1]
      ?? /^\/goods\/(\d+)\/?$/i.exec(url.pathname)?.[1];
    return productId ? { provider: 'ohou', id: productId } : null;
  }
  if (WALMART_HOST.test(host)) {
    const productId = /\/ip\/(?:[^/]+\/)?(\d+)(?:\/|$)/i.exec(url.pathname)?.[1];
    return productId ? { provider: 'walmart', id: productId } : null;
  }
  if (ETSY_HOST.test(host)) {
    const listingId = /\/listing\/(\d+)(?:\/|$)/i.exec(url.pathname)?.[1];
    return listingId ? { provider: 'etsy', id: listingId } : null;
  }
  if (HOME_DEPOT_HOST.test(host)) {
    const productId = /\/p\/(?:[^/]+\/)?(\d{6,})(?:\/|$)/i.exec(url.pathname)?.[1];
    return productId ? { provider: 'homedepot', id: productId } : null;
  }
  if (ZALANDO_HOST.test(host)) {
    const productId = /\/([a-z0-9-]{6,})\.html$/i.exec(url.pathname)?.[1];
    return productId ? { provider: 'zalando', id: productId.toLowerCase() } : null;
  }
  if (TRENDYOL_HOST.test(host)) {
    const productId = /-p-(\d+)(?:\/|$)/i.exec(url.pathname)?.[1];
    return productId ? { provider: 'trendyol', id: productId } : null;
  }
  if (NOON_HOST.test(host)) {
    const productId = /\/(?:p\/)?([a-z0-9_-]{6,})\/?$/i.exec(url.pathname)?.[1];
    return productId ? { provider: 'noon', id: productId.toLowerCase() } : null;
  }
  if (UNIQLO_HOST.test(host)) {
    const productCode = UNIQLO_PATH.exec(url.pathname)?.[1]?.toUpperCase();
    return productCode ? { provider: 'uniqlo', id: productCode } : null;
  }
  if (TWENTYNINE_CM_HOST.test(host)) {
    const productId = /^\/products\/(\d+)\/?$/i.exec(url.pathname)?.[1];
    return productId ? { provider: '29cm', id: productId } : null;
  }
  if (MUSINSA_HOST.test(host)) {
    const productId = /^\/products\/(\d+)\/?$/i.exec(url.pathname)?.[1];
    return productId ? { provider: 'musinsa', id: productId } : null;
  }
  return null;
}

export function isClientOnlyProductUrl(value: string): boolean {
  return readClientOnlyProductIdentity(value) !== null;
}

/**
 * A Coupang native-app share starts as an affiliate redirect without a product
 * id in the URL. It is not itself a product identity, but Coupang controls the
 * HTTPS redirect and the commerce WebView may use it as a tightly scoped entry
 * point before locking to the first canonical Coupang product identity.
 */
export function isCoupangShortProductShareUrl(value: string): boolean {
  const url = safeUrl(value);
  return Boolean(
    url
    && url.protocol === 'https:'
    && url.hostname.toLowerCase() === COUPANG_SHORT_HOST
    && COUPANG_SHORT_PATH.test(url.pathname),
  );
}

/**
 * Amazon native apps share provider-owned short links instead of the stable
 * `/dp/{ASIN}` page. They may start a hidden session, but they do not
 * themselves establish product identity: navigation must lock to the first
 * canonical Amazon product before any extracted envelope is accepted.
 */
export function isAmazonShortProductShareUrl(value: string): boolean {
  const url = safeUrl(value);
  if (!url || url.protocol !== 'https:') return false;
  const host = normalizedHost(url.hostname);
  if (!AMAZON_SHORT_HOSTS.has(host)) return false;
  if (host === 'amzn.to') {
    return AMAZON_SHORT_D_PATH.test(url.pathname)
      || AMAZON_SHORT_ROOT_PATH.test(url.pathname);
  }
  return AMAZON_SHORT_D_PATH.test(url.pathname);
}

/**
 * Provider-owned share shortlinks from Korean commerce apps. Each maps to the
 * ONE provider its redirect chain must land on, which scopes the hidden
 * session's navigation the same way the Coupang/Amazon short entries do.
 * Unknown OneLink brands stay out — a session needs a known provider PDP to
 * lock onto, so unrecognized links keep the server-first two-phase flow.
 */
const ONELINK_SHORT_SHARE_HOSTS: Record<string, ProviderProductIdentity['provider']> = {
  'musinsa.onelink.me': 'musinsa',
  '29cm.onelink.me': '29cm',
};
const ONELINK_SHORT_SHARE_PATH = /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/;
const OZIP_SHORT_SHARE_PATH = /^\/[A-Za-z0-9_-]+\/?$/;

export function readCommerceShortShareProvider(
  value: string,
): ProviderProductIdentity['provider'] | null {
  const url = safeUrl(value);
  if (!url || url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const onelinkProvider = ONELINK_SHORT_SHARE_HOSTS[host];
  if (onelinkProvider && ONELINK_SHORT_SHARE_PATH.test(url.pathname)) {
    return onelinkProvider;
  }
  if (host === 'ozip.me' && OZIP_SHORT_SHARE_PATH.test(url.pathname)) {
    return 'ohou';
  }
  return null;
}

/**
 * ozip.me chains through the link.ohou.se Airbridge tracker before reaching
 * the store.ohou.se PDP — that hop carries no product identity and must be
 * allowed explicitly, but only for a session that started from an ohou link.
 */
export function isCommerceShortShareTrackerHop(
  provider: ProviderProductIdentity['provider'],
  value: string,
): boolean {
  if (provider !== 'ohou') return false;
  const url = safeUrl(value);
  return Boolean(
    url
    && url.protocol === 'https:'
    && url.hostname.toLowerCase() === 'link.ohou.se',
  );
}

/**
 * URLs allowed to start a commerce session. Stable product URLs qualify
 * directly; provider-owned short links must resolve to the matching stable
 * product identity before extraction.
 */
export function isCommerceSessionEntryUrl(value: string): boolean {
  return isClientOnlyProductUrl(value)
    || isCoupangShortProductShareUrl(value)
    || isAmazonShortProductShareUrl(value)
    || readCommerceShortShareProvider(value) !== null;
}

/**
 * A weak path signal used only as one part of the generic DOM gate.
 * It never qualifies a page by itself.
 */
export function isProductShapedUrl(value: string): boolean {
  const url = safeUrl(value);
  if (!url || NON_PRODUCT_PATH.test(url.pathname)) return false;
  if (readClientOnlyProductIdentity(value)) return true;
  if (PRODUCT_SHAPED_PATH.test(url.pathname)) return true;
  return PRODUCT_QUERY_KEYS.some((key) => Boolean(url.searchParams.get(key)));
}

function normalizedPath(pathname: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();
  const collapsed = decoded.replace(/\/+/g, '/').replace(/\/$/, '');
  return collapsed || '/';
}

/** Match an envelope page to its archive without accepting "same host". */
export function isSameCommerceProductUrl(leftValue: string, rightValue: string): boolean {
  const left = safeUrl(leftValue);
  const right = safeUrl(rightValue);
  if (!left || !right) return false;

  const leftIdentity = readClientOnlyProductIdentity(leftValue);
  const rightIdentity = readClientOnlyProductIdentity(rightValue);
  if (leftIdentity || rightIdentity) {
    return Boolean(
      leftIdentity
      && rightIdentity
      && leftIdentity.provider === rightIdentity.provider
      && leftIdentity.id === rightIdentity.id,
    );
  }

  if (normalizedHost(left.hostname) !== normalizedHost(right.hostname)) return false;
  if (normalizedPath(left.pathname) !== normalizedPath(right.pathname)) return false;

  for (const key of PRODUCT_QUERY_KEYS) {
    const leftQueryValue = left.searchParams.get(key);
    const rightQueryValue = right.searchParams.get(key);
    if ((leftQueryValue || rightQueryValue) && leftQueryValue !== rightQueryValue) return false;
  }
  return true;
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  if (first === undefined || second === undefined) return true;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function isPublicClientProductUrl(value: string): boolean {
  const url = safeUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host === '::1'
    || host.startsWith('fc')
    || host.startsWith('fd')
    || host.startsWith('fe80:')
    || isPrivateIpv4(host)
  ) {
    return false;
  }
  return host.includes('.') || host.includes(':');
}

export type ClientProductValidationCode =
  | 'INVALID_PAGE_URL'
  | 'PRODUCT_URL_MISMATCH'
  | 'INVALID_SNAPSHOT'
  | 'NOT_COMMERCE_CANDIDATE';

export type ClientProductValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly code: ClientProductValidationCode };

/**
 * URL/snapshot layer shared by create and upsert.
 *
 * The server deliberately does not pretend to reproduce the DOM gate. It only
 * verifies immutable envelope invariants and reason-specific URL evidence.
 */
export function validateClientProductEnvelope(
  envelope: ClientProductEnvelopeV1,
  archiveUrl: string,
): ClientProductValidationResult {
  if (!isPublicClientProductUrl(envelope.pageUrl)) {
    return { valid: false, code: 'INVALID_PAGE_URL' };
  }
  if (!isSameCommerceProductUrl(envelope.pageUrl, archiveUrl)) {
    return { valid: false, code: 'PRODUCT_URL_MISMATCH' };
  }

  const snapshot = envelope.snapshot;
  if (!snapshot?.name?.trim()) return { valid: false, code: 'INVALID_SNAPSHOT' };
  if (
    snapshot.price !== undefined
    && (!snapshot.currency || !snapshot.observedAt || !Number.isFinite(snapshot.price))
  ) {
    return { valid: false, code: 'INVALID_SNAPSHOT' };
  }
  const images = snapshot.images ?? (snapshot.image ? [snapshot.image] : []);
  if (
    images.length > MAX_CLIENT_PRODUCT_IMAGES
    || images.some((url) => !isPublicClientProductUrl(url))
    || (snapshot.image !== undefined && !isPublicClientProductUrl(snapshot.image))
  ) {
    return { valid: false, code: 'INVALID_SNAPSHOT' };
  }

  // A background session is intentionally narrower than interactive browser
  // capture. It is never allowed to turn an arbitrary DOM page into a product:
  // the URL itself must carry a provider-specific stable product ID, even when
  // the page also exposes Product JSON-LD. The desktop hidden webview has the
  // same threat model as the mobile one, so it earns the same rule.
  if (
    isBackgroundSessionCaptureSurface(envelope.captureSurface)
    && !isClientOnlyProductUrl(envelope.pageUrl)
  ) {
    return { valid: false, code: 'NOT_COMMERCE_CANDIDATE' };
  }

  if (envelope.qualificationReason === 'verified-client-only-url') {
    return isClientOnlyProductUrl(envelope.pageUrl)
      ? { valid: true }
      : { valid: false, code: 'NOT_COMMERCE_CANDIDATE' };
  }
  if (envelope.qualificationReason === 'generic-product-evidence') {
    return isProductShapedUrl(envelope.pageUrl) && snapshot.price !== undefined
      ? { valid: true }
      : { valid: false, code: 'NOT_COMMERCE_CANDIDATE' };
  }
  return { valid: true };
}
