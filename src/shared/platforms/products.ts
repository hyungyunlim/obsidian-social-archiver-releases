/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/products.ts
 * Generated: 2026-08-04T06:00:35.915Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

/**
 * Commerce product helpers shared across clients.
 *
 * Grade A commerce (PRD prd-product-mvp.md §2.4.3) is identified by *markup*,
 * not by a domain list: Shopify headless stores use custom domains and their
 * `/products/{handle}.js` endpoint 404s, so any hardcoded platform list would
 * miss most real stores. Measured platform emission differs wildly
 * (Cafe24 11/11 with price, Shopify high, WooCommerce 2/4, Wix has the node
 * but no price), which is exactly why the list approach is unmaintainable.
 *
 * `productSource` therefore stores the *normalized host* — "gymshark.com",
 * "m.ohora.kr" — not a platform enum. Shopping groups by store, which is also
 * more useful to the user than grouping by platform.
 */

export const PRODUCT_SNAPSHOT_VERSION = 'jsonld-v1';

/** Where a snapshot's data came from. Separate axis from confidence. */
export type ProductSnapshotSource =
  | 'server-jsonld'
  | 'server-render'
  | 'naver-api'
  | 'client-share'
  | 'client-webview'
  /**
   * Read off the rendered DOM because the page declares no structured data.
   * amazon.com and mujikorea.co.kr ship zero ld+json, zero microdata and no
   * og:type — a clip can still see the price and title, a server fetch cannot.
   */
  | 'dom-heuristic';

/** How sure we are the snapshot describes the archived URL. */
export type ProductSnapshotConfidence = 'confirmed' | 'guessed' | 'user';

export interface ProductRating {
  readonly value: number;
  readonly count?: number;
}

/**
 * Normalized product snapshot, frozen at extraction time.
 *
 * Every field except `name`/`source`/`confidence`/`extractorVersion` is
 * optional on purpose: measured sources disagree on what they expose, and a
 * snapshot with no price is a valid, renderable state (PRD §3.2). Wix emits a
 * Product node with no price at all; WooCommerce may expose price only via
 * OpenGraph.
 */
export interface ProductSnapshot {
  name: string;

  // ── price ────────────────────────────────────────────────────────────
  price?: number;
  /** True when `price` is the lowest of several variants → render "25.00~". */
  priceIsFrom?: boolean;
  /** ISO 4217. Absent currency means the price is unusable — see parse rules. */
  currency?: string;
  /** List/compare-at price when the source exposes one. */
  listPrice?: number;
  /** Some sources give only the percentage (Amazon "61% off"), so keep both. */
  discountPercent?: number;
  priceValidUntil?: string;

  // ── availability ─────────────────────────────────────────────────────
  /** schema.org ItemAvailability tail: 'InStock' | 'OutOfStock' | 'PreOrder'. */
  availability?: string;
  shippingFee?: number;
  shippingIsFree?: boolean;

  // ── trust signals ────────────────────────────────────────────────────
  rating?: ProductRating;
  purchaseCount?: number;

  // ── identity ─────────────────────────────────────────────────────────
  brand?: string;
  maker?: string;
  seller?: string;
  sku?: string;
  /**
   * Short product description from the source.
   *
   * PRD §7.3 originally excluded this on the grounds that it "is already in the
   * body". Measured on real stores that is false: Defuddle returns accordion
   * labels ("+ ADD AN ARM", "27 reviews") and drops the actual copy, so on a
   * product page this is often the ONLY prose we get.
   */
  description?: string;
  image?: string;
  /**
   * Every image the page DECLARES for this product, in source order, with
   * `image` as the first entry.
   *
   * Declared, not scraped: schema.org `image` is frequently an array, and
   * taking it verbatim keeps this site-agnostic. A store that lists one image
   * yields one — the gallery thumbnails a theme renders client-side are a
   * different problem and would need per-site heuristics.
   */
  images?: string[];
  category?: string[];
  /** Provider catalog id (e.g. Naver nvMid). NOT the URL-matching key. */
  providerId?: string;
  /** URL-matching key parsed from a provider link. */
  channelProductId?: string;
  /** Option axes only (`['size']`) — individual variants are not stored. */
  variesBy?: string[];

  // ── provenance ───────────────────────────────────────────────────────
  source: ProductSnapshotSource;
  confidence: ProductSnapshotConfidence;
  extractorVersion: string;
  /** ISO 8601. Only meaningful once a price exists. */
  observedAt?: string;
}

const MAX_HOST_LENGTH = 253;

/**
 * Normalized host for grouping, or null when the URL is unusable.
 * Keeps the `m.` / `www.` distinction out of the key so mobile and desktop
 * variants of the same store group together (`m.ohora.kr` → `ohora.kr`).
 */
export function normalizeProductHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
  if (!host || host.length > MAX_HOST_LENGTH || !host.includes('.')) return null;

  // On a marketplace the host is the MARKETPLACE, not the store — every
  // SmartStore seller would otherwise collapse into one "smartstore.naver.com"
  // row in the Shopping view. The first path segment is the seller's handle,
  // which is the same reasoning that made us store 'gymshark.com' rather than
  // 'Shopify'.
  const storePath = MARKETPLACE_STORE_HOSTS.has(host)
    ? parsed.pathname.split('/').filter(Boolean)[0]
    : undefined;
  if (storePath && !NON_STORE_PATH_SEGMENTS.has(storePath.toLowerCase())
      && /^[a-z0-9_-]{2,40}$/i.test(storePath)) {
    return `${host}/${storePath.toLowerCase()}`;
  }

  return host;
}

/**
 * Hosts where one domain fronts many independent sellers, so the store
 * identity lives in the path. Deliberately tiny: only marketplaces we have
 * actually measured, since a wrong entry silently splits one store into many.
 */
const MARKETPLACE_STORE_HOSTS = new Set([
  'smartstore.naver.com',
  'brand.naver.com',
]);

/**
 * Path segments that look like a store handle but are not one.
 *
 * The Naver Shopping API returns catalog links as
 * `smartstore.naver.com/main/products/{id}` (§7.1 measured), so `main` would
 * otherwise become a fake storefront that every catalog hit groups under.
 */
const NON_STORE_PATH_SEGMENTS = new Set(['main', 'products', 'product', 'category', 'search']);

/**
 * A snapshot renders as a product card even with no price (PRD §3.2) — the
 * only hard requirement is a name.
 */
export function isRenderableProductSnapshot(
  snapshot: ProductSnapshot | null | undefined,
): snapshot is ProductSnapshot {
  return Boolean(snapshot && typeof snapshot.name === 'string' && snapshot.name.trim().length > 0);
}

/**
 * Card variant selector. Keyed on the presence of extracted data, NOT on
 * `platform`: commerce archives keep `platform: 'web'` so that no new platform
 * has to be registered across six clients (and silently dropped by whichever
 * hardcoded registry gets missed).
 */
export function isProductCardEligible(
  archive: { productSource?: string | null; product?: ProductSnapshot | null },
): boolean {
  return Boolean(archive.productSource) || isRenderableProductSnapshot(archive.product);
}

/**
 * Format a price in its OWN currency. Never converts.
 *
 * Seven currencies were observed across measured stores
 * (USD/KRW/AUD/GBP/INR/CAD/EUR). Converting would contradict the rule that we
 * preserve the value the user actually saw — a Korean user who saved a £25
 * item saw £25. `locale` only drives digit grouping.
 *
 * Returns null when the snapshot has no usable price; callers must render the
 * card without one (Wix exposes a Product node with no price at all).
 */
export function formatProductPrice(
  snapshot: ProductSnapshot | null | undefined,
  locale = 'en',
): string | null {
  if (!snapshot || typeof snapshot.price !== 'number' || !Number.isFinite(snapshot.price)) return null;
  if (!snapshot.currency) return null;

  let text: string;
  try {
    text = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: snapshot.currency,
      maximumFractionDigits: Number.isInteger(snapshot.price) ? 0 : 2,
    }).format(snapshot.price);
  } catch {
    // Unknown/invalid ISO code — show the raw pair rather than nothing.
    text = `${snapshot.price} ${snapshot.currency}`;
  }
  return snapshot.priceIsFrom ? `${text}~` : text;
}

/** Discount percentage against `listPrice`, when the pair supports one. */
export function productDiscountPercent(snapshot: ProductSnapshot | null | undefined): number | null {
  if (!snapshot) return null;
  if (typeof snapshot.discountPercent === 'number' && Number.isFinite(snapshot.discountPercent)) {
    return Math.round(snapshot.discountPercent);
  }
  const { price, listPrice } = snapshot;
  if (typeof price !== 'number' || typeof listPrice !== 'number') return null;
  if (!(listPrice > price) || listPrice <= 0) return null;
  return Math.round(((listPrice - price) / listPrice) * 100);
}

/** 'InStock' | 'OutOfStock' | 'PreOrder' | null — normalized, schema tail only. */
export function productAvailability(snapshot: ProductSnapshot | null | undefined): string | null {
  const raw = snapshot?.availability;
  if (!raw) return null;
  return raw.split('/').pop() ?? null;
}

/**
 * A path segment that is nothing but a render size — `LB_750x1000`,
 * `RB_100x133`, `300x300`. Resizing CDNs put the size in the path rather than
 * the query, so it survives upgradeImageVariant.
 */
const SIZE_PATH_SEGMENT = /^[A-Za-z]{0,4}_?(\d{2,5})x(\d{2,5})(?:[A-Za-z]{1,4})?$/;

/** Below this on either side it is an icon, not a photograph. */
const MIN_PHOTO_SIDE = 200;

/** Target for the long edge when we can ask a resizing CDN for more. */
const UPGRADE_LONG_EDGE = 2000;

/**
 * Sizes appended AFTER the extension, which is where AliExpress puts them:
 * `Sead0f2….png_220x220.png_.avif`, `….jpg_960x960q75.jpg_.avif`.
 *
 * Truncating back to the first extension returns the original — measured
 * 220x220 -> 1000x1000, which also beats asking for 960 explicitly. It has the
 * side effect that a thumbnail and its full-size twin become the same string,
 * so the two renditions of one photo stop being archived as two pictures.
 */
function dropTrailingSizeSuffix(pathname: string): string {
  const segments = pathname.split('/');
  const file = segments[segments.length - 1] ?? '';
  const base = /^(.+?\.(?:jpe?g|png|webp|gif|avif|bmp))_\d{2,5}x\d{2,5}/i.exec(file)?.[1];
  if (!base) return pathname;
  segments[segments.length - 1] = base;
  return segments.join('/');
}

/** `f_auto,q_auto:eco,c_scale,w_300` — Cloudinary's comma-joined transform list. */
const CLOUDINARY_TRANSFORM_LIST = /^[a-z]{1,3}_[^,/]+(?:,[a-z]{1,3}_[^,/]+)+$/i;
/** `t_web_pdp_936_v2` — a NAMED Cloudinary transformation. */
const CLOUDINARY_NAMED_TRANSFORM = /^t_[A-Za-z0-9_]+$/;

/**
 * Strip Cloudinary renditions so one photo is one photo.
 *
 * Nike serves the same shoe as `t_default` (320x400), `t_web_pdp_535_v2`,
 * `t_web_pdp_936_v2` (1872x2340) and `t_PDP_1728_v1` — four archived images,
 * two actual photographs, with the asset id identical across three of them.
 * Removing the transform returns the original: measured 2880x3600.
 *
 * The named `t_*` form is only stripped when the path ALSO carries a
 * comma-joined transform list, which nothing but Cloudinary produces.
 * Otherwise a shop with a `/t_shirts/` directory would lose its images.
 */
function dropCloudinaryTransforms(pathname: string): string {
  const segments = pathname.split('/');
  if (!segments.some((segment) => CLOUDINARY_TRANSFORM_LIST.test(segment))) return pathname;
  return segments
    .filter((segment) => !CLOUDINARY_TRANSFORM_LIST.test(segment) && !CLOUDINARY_NAMED_TRANSFORM.test(segment))
    .join('/');
}

/**
 * Adobe Scene7 inverts every other rule here: asking for nothing gets you the
 * SMALL default, not the original.
 *
 * Macy's declares its photos in JSON-LD with no query at all, and those URLs
 * return 328x400. Adding a width returns 2000x2160 — measured on the same
 * asset. So this is the one CDN we have to ask, and `/is/image/` is Scene7's
 * own path signature rather than anything Macy's-specific.
 *
 * Only the width is set: giving both dimensions makes Scene7 fit the image
 * into that box, which squares off a 328x400 photo.
 */
function requestSceneSevenSize(parsed: URL, hadQuery: boolean): void {
  if (!/\/is\/image\//i.test(parsed.pathname)) return;

  const declaredWidth = Number(parsed.searchParams.get('wid') ?? '0');
  if (declaredWidth > 0) {
    // The page asked for a specific width; raise it if it was small.
    if (declaredWidth < UPGRADE_LONG_EDGE) parsed.searchParams.set('wid', String(UPGRADE_LONG_EDGE));
    return;
  }

  // Only a URL that arrived with NO query gets one invented for it. Samsung is
  // Scene7 too, and its `$Q90_776_776_F_JPG$` form is already handled by
  // dropping the directive — measured 1920x1280. Appending a width there would
  // both override a verified result and re-encode any surviving `$PRESET$`
  // into `%24PRESET%24=`, which the CDN does not recognise.
  if (hadQuery) return;
  parsed.searchParams.set('wid', String(UPGRADE_LONG_EDGE));
}

/**
 * Sizes expressed as a NAMED tier, which is how DJI ships them:
 * `<hash>@ultra.webp` is 1280x1280 and `<hash>@small.webp` 240x240 — same
 * photo, no number anywhere to raise. Dropping the tier returns the true
 * original, measured at 2560x2560, and collapses the two into one entry.
 *
 * `@2x` is deliberately NOT matched: that is the retina convention, where the
 * suffixed file is the LARGER one and stripping it would shrink the image.
 */
function dropNamedSizeTier(pathname: string): string {
  return pathname.replace(/@[a-z]{2,10}(?=\.[a-z0-9]{2,5}$)/i, '');
}

/**
 * Ask a path-based resizer for a bigger rendition.
 *
 * Coupang addresses every gallery photo through `/thumbnails/remote/492x492ex/`
 * and DELETING the segment 404s — unlike a query param, the proxy requires it.
 * Raising it works: measured 492x492 -> 2000x2000, and ssfshop's
 * `/cmd/LB_750x1000/` -> 1500x2000.
 *
 * The ratio is preserved rather than squared off, because these resizers honour
 * exactly what is asked: requesting 2000x2000 of a 3:4 photo returns a squared
 * 2000x2000, i.e. a distorted or cropped picture.
 */
function raiseSizePathSegments(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      const match = SIZE_PATH_SEGMENT.exec(segment);
      if (!match) return segment;
      const width = Number(match[1]);
      const height = Number(match[2]);
      const longEdge = Math.max(width, height);
      if (longEdge >= UPGRADE_LONG_EDGE) return segment;
      const scale = UPGRADE_LONG_EDGE / longEdge;
      const raised = `${Math.round(width * scale)}x${Math.round(height * scale)}`;
      return segment.replace(`${width}x${height}`, raised);
    })
    .join('/');
}

/**
 * Identity of a product photo, ignoring the size it was rendered at.
 *
 * ssfshop declares the SAME ten photos twice — once under `/cmd/LB_750x1000/`
 * and once under `/cmd/RB_100x133/` — so an exact-string dedupe kept both and
 * the grid carried 100x133 thumbnails next to their own full-size originals.
 */
export function productImageIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/');
    const last = segments.length - 1;
    // Walgreens names the rendition and NOTHING else: the same shirt is
    // `/prodimg/696171/450.jpg` and `/prodimg/696171/900.jpg`, so both were
    // archived and the card showed one photo twice.
    if (numericFilenameWidth(segments[last] ?? '') !== null) segments[last] = '';
    const path = segments
      .filter((segment) => !SIZE_PATH_SEGMENT.test(segment))
      .join('/');
    return `${parsed.host}${path}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * A filename that is only a number, when that number is a plausible pixel
 * width.
 *
 * The floor is what keeps this from merging genuinely different photos: a shop
 * numbering its shots `1.jpg`, `2.jpg` is common, `450.jpg` and `900.jpg` as
 * separate PHOTOS is not. Anything under 100 or over 5000 is treated as an id.
 */
function numericFilenameWidth(file: string): number | null {
  const match = /^(\d{3,4})\.[a-z0-9]{2,5}$/i.exec(file);
  if (!match) return null;
  const width = Number(match[1]);
  return width >= 100 && width <= 5000 ? width : null;
}

/** Width the URL itself declares, for choosing between two renders of one photo. */
export function declaredImageWidth(url: string): number {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/');
    const numeric = numericFilenameWidth(segments[segments.length - 1] ?? '');
    if (numeric !== null) return numeric;
    for (const segment of segments) {
      const match = SIZE_PATH_SEGMENT.exec(segment);
      if (match) return Number(match[1]);
    }
  } catch {
    // fall through
  }
  // No stated size means nothing shrank it — treat as the original.
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Page furniture that a store declared as a product image.
 *
 * walmart lists `interactive-video.svg` — a play-button icon — in its Product
 * node's `image` array. Vector art is UI on a commerce page; product photos
 * are raster.
 */
export function isNonPhotoImage(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    if (path.toLowerCase().endsWith('.svg')) return true;

    const segments = path.split('/');
    // coupang lists `/image/brandLogo/brandLogo_<uuid>.jpg` among the product's
    // images. A path that names itself a logo is branding, not the product.
    // camelCase gets a boundary first, or `brandLogo` reads as one word.
    const words = (segment: string): string => segment.replace(/([a-z])([A-Z])/g, '$1 $2');
    if (segments.some((segment) => /(^|[^a-z])logos?([^a-z]|$)/i.test(words(segment)))) return true;

    // An address that renders at 48x48 is an icon slot: coupang serves option
    // swatches from `/48x48ex/` next to its `/492x492ex/` gallery. Unlike a
    // `?width=` hint — which andar uses to render a REAL 1334px photo small in
    // its rail — the size here is part of how the page addresses the asset.
    for (const segment of segments) {
      const match = SIZE_PATH_SEGMENT.exec(segment);
      if (!match) continue;
      if (Number(match[1]) < MIN_PHOTO_SIDE || Number(match[2]) < MIN_PHOTO_SIDE) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * The shop line at the top of a product card.
 *
 * Cards used to put `brand` here, which reads as the store because it is the
 * topmost label — and brand is frequently not the store. Measured: tackform's
 * Nissan bracket declares brand "Nissan", so the card announced NISSAN as the
 * shop; gymshark declares "Gymshark | We Do Gym".
 *
 * `seller` is the field that means the shop, so it wins. Brand stays as the
 * fallback because an archive captured before seller was persisted has nothing
 * else, and a rough label beats an empty slot.
 */
export function productShopLabel(snapshot: ProductSnapshot | null | undefined): string | null {
  const shop = snapshot?.seller?.trim() || snapshot?.brand?.trim();
  return shop || null;
}

/**
 * The brand chip, shown only when it says something the shop line does not.
 *
 * Returns null when brand IS the shop line (either identical, or the fallback
 * above already promoted it), so the same string never prints twice.
 */
export function productBrandLabel(snapshot: ProductSnapshot | null | undefined): string | null {
  const brand = snapshot?.brand?.trim();
  if (!brand) return null;
  return brand === productShopLabel(snapshot) ? null : brand;
}

/**
 * Ask an image CDN for the original instead of the size the page happened to
 * render.
 *
 * A product archive PRESERVES its photos into R2, so whatever URL we store is
 * the copy that outlives the store. Harvesting from the DOM meant storing
 * whatever the theme asked for — measured on andar-global, the gallery rail
 * requests `?width=130`, and the archive kept ten 130x195 thumbnails (4 KB
 * each) forever while the originals were 1334x2000.
 *
 * Both knobs are the same convention across Shopify-style CDNs: a `width` /
 * `height` query pair, or a `_<W>x<H>` filename suffix. Removing them returns
 * the original — verified against every archived store: andar 130 -> 1334,
 * tackform 1600 -> 2000, gymshark and fashionnova and ohora unchanged.
 *
 * The suffix needs THREE digits. Uniqlo ships `krgoods_482204_sub3_3x4.jpg`,
 * where `_3x4` is an aspect ratio baked into the real filename — stripping it
 * 404s the image. Pixel widths are always three digits or more (`_1600x`,
 * `_1024x1024`, `_100x100`) and aspect ratios never are (`_3x4`, `_16x9`), so
 * the digit count separates them cleanly.
 *
 * A URL that carries neither is returned untouched, so this is a no-op on
 * hosts that do not use the convention.
 */
export function upgradeImageVariant(url: string): string {
  try {
    const parsed = new URL(url);
    const hadQuery = parsed.search.length > 0;
    // Matched by suffix rather than by an exact name: walmart declares its own
    // gallery at `?odnWidth=160&odnHeight=160`, and dropping those returns the
    // 3710x5565 original. Every resize param measured so far ends in one of
    // these two words, and a param ending in "width" that is not a size is
    // hard to construct.
    for (const key of [...parsed.searchParams.keys()]) {
      const name = key.toLowerCase();
      if (name.endsWith('width') || name.endsWith('height')) parsed.searchParams.delete(key);
      // These only mean something RELATIVE to a target size, so leaving one
      // behind after removing the size produces a request the CDN rejects.
      // Costco serves `?width=500&fit=contain`; dropping only `width` left
      // `?fit=contain`, which returns 400 — five of six photos disappeared
      // from the card while the one image that had no query survived.
      if (name === 'fit' || name === 'crop' || name === 'dpr') parsed.searchParams.delete(key);
      // Samsung's scaler takes a bare `$Q90_776_776_F_JPG$` directive with no
      // parameter name at all. Dropping it returns the full rendition —
      // measured 776x776 -> 1920x1280.
      if (/^\$[a-z0-9_]*\d{2,5}_\d{2,5}[a-z0-9_]*\$$/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.pathname = parsed.pathname.replace(/_\d{3,}x\d*(?=\.[A-Za-z0-9]+$)/, '');
    parsed.pathname = dropTrailingSizeSuffix(parsed.pathname);
    parsed.pathname = dropNamedSizeTier(parsed.pathname);
    parsed.pathname = dropCloudinaryTransforms(parsed.pathname);
    parsed.pathname = raiseSizePathSegments(parsed.pathname);
    requestSceneSevenSize(parsed, hadQuery);
    return parsed.toString();
  } catch {
    // Not an absolute URL — callers resolve first, so this is already a
    // degraded input. Leave it exactly as-is.
    return url;
  }
}

/** Parse the stored `product_json` column. Never throws. */
export function parseProductSnapshot(json: string | null | undefined): ProductSnapshot | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as ProductSnapshot;
    return isRenderableProductSnapshot(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
