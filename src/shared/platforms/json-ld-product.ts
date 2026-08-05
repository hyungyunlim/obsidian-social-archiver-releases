/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/platforms/json-ld-product.ts
 * Generated: 2026-08-05T23:29:30.153Z
 *
 * To modify, edit the source file in shared/platforms/ and run:
 *   npm run sync:shared
 */

/**
 * JsonLdProductExtractor — schema.org Product/ProductGroup → ProductSnapshot.
 *
 * Every rule here comes from a measured failure (PRD prd-product-mvp.md §2.4.2,
 * §14.5, §14.6). Do not "simplify" one away without re-measuring:
 *
 * - `ProductGroup` + `hasVariant[]` is real. Headless Shopify (gymshark,
 *   fashionnova) has `offers: null` at the top level and the price inside each
 *   variant. A top-level-only parser silently misses those stores entirely —
 *   the first measurement pass did exactly that and reported "no price".
 * - Variants disagree: gymshark variant[0] is OutOfStock while variant[1] is
 *   InStock at the same price. Aggregate: lowest price + `priceIsFrom`,
 *   available if ANY variant is available.
 * - OpenGraph is a required fallback, not a nicety. nutribullet (WooCommerce)
 *   emits no JSON-LD Product but does emit `og:price:amount`.
 * - Cross-validate against `og:price`. A page can carry several Product nodes
 *   (related-product carousels, `@graph`); picking the wrong one produced a
 *   `123,200 USD` reading for a $79.98 item during measurement.
 * - Image URLs are dirty in the wild: ohora's JSON-LD `image` is
 *   `https:https://cafe24img...`. Prefer `og:image` and normalize.
 * - A price with no currency is unusable — drop it rather than guess (PRD
 *   §13.2-G7). Seven currencies were observed (USD/KRW/AUD/GBP/INR/CAD/EUR).
 *
 * Lives in shared/ rather than workers/ because the clip lane must parse this
 * on the CLIENT: clip reads the page in the browser and is expected to finish
 * there, and an anonymous/local clip never reaches a server at all. Shipping
 * the extractor instead of the raw markup keeps one implementation and sends
 * ~500 bytes instead of the whole ld+json payload.
 */

import type { ProductSnapshot } from './products';
import {
  PRODUCT_SNAPSHOT_VERSION,
  declaredImageWidth,
  isNonPhotoImage,
  productImageIdentity,
  upgradeImageVariant,
} from './products';

const JSONLD_BLOCK = /<script\b[^>]*type\s*=\s*['"][^'"]*application\/ld\+json[^'"]*['"][^>]*>([\s\S]*?)<\/script>/gi;
const MAX_JSONLD_BLOCKS = 30;
const MAX_GRAPH_DEPTH = 6;
const MAX_VARIANTS = 200;
const NAME_MAX = 300;

/** Relative difference above which a JSON-LD price is considered inconsistent with OG. */
const OG_CROSS_CHECK_TOLERANCE = 0.02;

type Json = Record<string, unknown>;

// ── primitives ─────────────────────────────────────────────────────────────

function decodeEntitiesOnce(value: string): string {
  return value
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Decode until stable, not once.
 *
 * Measured on gymshark.com: the JSON-LD ships `SIZE &amp;amp; FIT` — the store
 * encoded an already-encoded string. A single pass leaves a literal `&amp;`
 * in the card. Bounded to a few rounds so a crafted `&amp;amp;amp;…` chain
 * cannot spin.
 */
function decodeEntities(value: string): string {
  let current = value;
  for (let round = 0; round < 3; round += 1) {
    const next = decodeEntitiesOnce(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * `Number('')` is 0 — an empty-string price must not become a free product.
 * Same guard as the Places extractor's coordinate parser.
 */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Strip grouping separators and currency symbols, keep sign/decimal point.
  const cleaned = trimmed.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '');
  const parsed = Number(cleaned.replace(/,/g, '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Entities are decoded per field, never on the whole block before parsing:
 * a legitimate `&quot;` inside a JSON string value survives `JSON.parse` as
 * literal text and only needs decoding once it is a value.
 */
function toTrimmedString(value: unknown, max = NAME_MAX): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = decodeEntities(value).trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Real-world JSON-LD carries `https:https://cafe24img...` (ohora). Repair the
 * duplicated scheme, restore a scheme omitted from an absolute CDN host
 * (SSG), resolve protocol-relative and relative URLs, and accept https only —
 * a preserved image is fetched later, and http would break it.
 */
const SCHEMELESS_ABSOLUTE_HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]|$)/i;

/**
 * The URL out of an `ImageObject`, whichever spelling the store used.
 *
 * schema.org says `contentUrl`; etsy ships `contentURL`. Reading only `url`
 * cost 15 of that listing's 16 photos — and the ones it missed were
 * `il_fullxfull`, larger than the single one that did come through.
 */
function readImageEntryUrl(entry: Json): string | undefined {
  for (const key of ['url', 'contentUrl', 'contentURL', 'thumbnailUrl', '@id']) {
    const value = toTrimmedString(entry[key], 2048);
    if (value) return value;
  }
  return undefined;
}

export function normalizeImageUrl(raw: unknown, pageUrl?: string): string | undefined {
  const first: unknown = Array.isArray(raw) ? raw[0] : raw;
  const candidate = typeof first === 'object' && first !== null
    ? readImageEntryUrl(first as Json)
    : toTrimmedString(first, 2048);
  if (!candidate) return undefined;

  let value = candidate.replace(/^(https?:)+(?=https?:\/\/)/i, '');
  if (value.startsWith('//')) value = `https:${value}`;
  // SSG declares `sitem.ssgcdn.com/...` in Product.image. Resolving that as a
  // path produces `emart.ssg.com/item/sitem.ssgcdn.com/...`, which is a valid
  // URL syntactically but a guaranteed broken image. Only host-shaped values
  // take this branch; ordinary `/img/a.jpg` and `images/a.jpg` stay relative.
  else if (SCHEMELESS_ABSOLUTE_HOST.test(value)) value = `https://${value}`;

  try {
    const resolved = pageUrl ? new URL(value, pageUrl) : new URL(value);
    if (resolved.protocol !== 'https:') return undefined;
    // Judged BEFORE upgrading, because upgrading rewrites the very evidence:
    // coupang's `/48x48ex/` icon slot becomes `/2000x2000ex/` and would then
    // look like a photograph.
    if (isNonPhotoImage(resolved.toString())) return undefined;
    // Ask for the original: what we store here is what gets preserved to R2.
    return upgradeImageVariant(resolved.toString());
  } catch {
    return undefined;
  }
}

/**
 * Parse a JSON-LD block.
 *
 * Entity-decoding BEFORE parsing corrupts valid JSON — a legitimate `&quot;`
 * inside a string value becomes a bare quote and the whole document fails.
 * Gymshark's ProductGroup block is exactly this shape, and a decode-first
 * parser silently dropped the entire store. Parse raw first; only fall back to
 * a decoded parse for the (rarer) sites that HTML-escape their script body.
 */
function parseJsonLdBlock(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(decodeEntities(body));
    } catch {
      return null; // Malformed; other blocks and OpenGraph still apply.
    }
  }
}

function typesOf(node: Json): string[] {
  const raw = node['@type'];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((t): t is string => typeof t === 'string');
}

function isProductNode(node: unknown): node is Json {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  return typesOf(node as Json).some((t) => t === 'Product' || t === 'ProductGroup');
}

/** Flatten a parsed JSON-LD document, following `@graph` containers. */
function flatten(value: unknown, out: Json[], depth = 0): void {
  if (depth > MAX_GRAPH_DEPTH || value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out, depth + 1);
    return;
  }
  const node = value as Json;
  out.push(node);
  const graph = node['@graph'];
  if (graph) flatten(graph, out, depth + 1);
}

// ── offers ─────────────────────────────────────────────────────────────────

interface OfferReading {
  price?: number;
  currency?: string;
  availability?: string;
  priceValidUntil?: string;
}

function readOffer(raw: unknown): OfferReading | null {
  const node = (Array.isArray(raw) ? raw[0] : raw) as Json | undefined;
  if (!node || typeof node !== 'object') return null;
  // AggregateOffer exposes lowPrice instead of price.
  const price = toFiniteNumber(node['price']) ?? toFiniteNumber(node['lowPrice']);
  const availability = toTrimmedString(node['availability'], 120);
  return {
    ...(price !== undefined ? { price } : {}),
    ...(toTrimmedString(node['priceCurrency'], 8) ? { currency: toTrimmedString(node['priceCurrency'], 8) } : {}),
    ...(availability ? { availability: availability.split('/').pop() } : {}),
    ...(toTrimmedString(node['priceValidUntil'], 40) ? { priceValidUntil: toTrimmedString(node['priceValidUntil'], 40) } : {}),
  };
}

interface PriceAggregate {
  price?: number;
  currency?: string;
  priceIsFrom: boolean;
  availability?: string;
  priceValidUntil?: string;
}

/**
 * Collect the node's own offer plus every variant offer, then reduce.
 * Lowest price wins (marked `priceIsFrom` when variants disagree); a single
 * in-stock variant makes the product in-stock.
 */
function aggregatePrice(node: Json): PriceAggregate {
  const readings: OfferReading[] = [];
  const own = readOffer(node['offers']);
  if (own) readings.push(own);

  const variants = node['hasVariant'];
  if (Array.isArray(variants)) {
    for (const variant of variants.slice(0, MAX_VARIANTS)) {
      if (!variant || typeof variant !== 'object') continue;
      const reading = readOffer((variant as Json)['offers']);
      if (reading) readings.push(reading);
    }
  }

  const priced = readings.filter((r) => r.price !== undefined);
  const prices = priced.map((r) => r.price as number);
  const min = prices.length ? Math.min(...prices) : undefined;
  const max = prices.length ? Math.max(...prices) : undefined;
  const currency = priced.find((r) => r.currency)?.currency ?? readings.find((r) => r.currency)?.currency;
  const availability = readings.some((r) => r.availability === 'InStock')
    ? 'InStock'
    : readings.find((r) => r.availability)?.availability;

  return {
    ...(min !== undefined ? { price: min } : {}),
    ...(currency ? { currency } : {}),
    priceIsFrom: min !== undefined && max !== undefined && max > min,
    ...(availability ? { availability } : {}),
    ...(readings.find((r) => r.priceValidUntil)?.priceValidUntil
      ? { priceValidUntil: readings.find((r) => r.priceValidUntil)!.priceValidUntil }
      : {}),
  };
}

// ── OpenGraph ──────────────────────────────────────────────────────────────

function readMeta(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const forward = new RegExp(
      `<meta\\b[^>]*(?:property|name)\\s*=\\s*['"]${escaped}['"][^>]*content\\s*=\\s*['"]([^'"]*)['"]`, 'i');
    const reverse = new RegExp(
      `<meta\\b[^>]*content\\s*=\\s*['"]([^'"]*)['"][^>]*(?:property|name)\\s*=\\s*['"]${escaped}['"]`, 'i');
    const value = html.match(forward)?.[1] ?? html.match(reverse)?.[1];
    if (value) return decodeEntities(value).trim() || undefined;
  }
  return undefined;
}

interface OgProduct {
  siteName?: string;
  price?: number;
  currency?: string;
  image?: string;
  title?: string;
}

function readOpenGraph(html: string, pageUrl?: string): OgProduct {
  const price = toFiniteNumber(readMeta(html, ['og:price:amount', 'product:price:amount']));
  const currency = readMeta(html, ['og:price:currency', 'product:price:currency']);
  const siteName = toTrimmedString(readMeta(html, ['og:site_name']), 200);
  return {
    ...(siteName ? { siteName } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(currency ? { currency: currency.toUpperCase().slice(0, 8) } : {}),
    ...(normalizeImageUrl(readMeta(html, ['og:image']), pageUrl)
      ? { image: normalizeImageUrl(readMeta(html, ['og:image']), pageUrl) } : {}),
    ...(readMeta(html, ['og:title']) ? { title: readMeta(html, ['og:title']) } : {}),
  };
}

// ── node selection ─────────────────────────────────────────────────────────

/**
 * Several Product nodes can coexist (related-item carousels). Prefer the one
 * whose `url` matches the page's canonical/og:url; otherwise take the first.
 */
function pickProductNode(nodes: Json[], html: string, pageUrl?: string): Json | undefined {
  if (nodes.length <= 1) return nodes[0];
  const canonical = readMeta(html, ['og:url'])
    ?? html.match(/<link\b[^>]*rel\s*=\s*['"]canonical['"][^>]*href\s*=\s*['"]([^'"]*)['"]/i)?.[1]
    ?? pageUrl;
  if (!canonical) return nodes[0];

  let canonicalPath: string;
  try {
    canonicalPath = new URL(canonical).pathname.replace(/\/+$/, '');
  } catch {
    return nodes[0];
  }

  const matched = nodes.find((node) => {
    const url = toTrimmedString(node['url'], 2048);
    if (!url) return false;
    try {
      return new URL(url, canonical).pathname.replace(/\/+$/, '') === canonicalPath;
    } catch {
      return false;
    }
  });
  return matched ?? nodes[0];
}

/** `offers.seller` may be a string, an Organization node, or an array of either. */
/**
 * Keep the description's structure instead of flattening it to a wall.
 *
 * Stores write real line breaks (gymshark: "PHYSIQUE FIRST\nWhether you're…")
 * and then run their spec bullets together on one line
 * ("…fit top• Enhance your physique with…"). Both survive to here; the card
 * just needs them separated, and a bullet glued to the previous sentence needs
 * a break inserted.
 */
function readDescription(raw: unknown): string | undefined {
  const decoded = toTrimmedString(raw, 2_000);
  if (!decoded) return undefined;

  return decoded
    // A bullet immediately after text is a new item, not part of the sentence.
    .replace(/([^\n])\s*•\s*/g, '$1\n• ')
    .replace(/^\s*•\s*/gm, '• ')
    // Collapse the blank-line padding stores use for visual spacing.
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readSellerName(raw: unknown): string | undefined {
  for (const offer of Array.isArray(raw) ? raw : [raw]) {
    if (!offer || typeof offer !== 'object') continue;
    const seller = (offer as Json)['seller'];
    if (typeof seller === 'string') {
      const name = toTrimmedString(seller, 200);
      if (name) return name;
    } else if (seller && typeof seller === 'object') {
      const name = toTrimmedString((seller as Json)['name'], 200);
      if (name) return name;
    }
  }
  return undefined;
}

function readBrandName(raw: unknown): string | undefined {
  const node: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof node === 'string') return toTrimmedString(node, 120);
  if (node && typeof node === 'object') return toTrimmedString((node as Json)['name'], 120);
  return undefined;
}

function readRating(raw: unknown): ProductSnapshot['rating'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const node = raw as Json;
  const value = toFiniteNumber(node['ratingValue']);
  if (value === undefined) return undefined;
  const count = toFiniteNumber(node['reviewCount']) ?? toFiniteNumber(node['ratingCount']);
  // Stores publish the raw mean — fashionnova ships 3.9432178, which is
  // arithmetic noise rather than anything the user saw. Two decimals, not one:
  // rounding 4.96 to 5.0 would erase a distinction the store itself displays.
  return { value: Math.round(value * 100) / 100, ...(count !== undefined ? { count } : {}) };
}

/**
 * Rating from another Product node describing the same product.
 *
 * Matched on name rather than @id or url: the injected node usually has
 * neither. A name match is strict enough here because these nodes are all on
 * one product page.
 */
/**
 * The product's declared images, deduped, `primary` first.
 *
 * Only what the page declares — no DOM heuristics. A theme that renders extra
 * gallery thumbnails client-side is a separate problem, and guessing at it from
 * markup is how a per-site list gets born.
 */
function collectDeclaredImages(raw: unknown, primary: string | undefined, pageUrl?: string): string[] {
  // Keyed on identity-ignoring-size rather than on the exact string: ssfshop
  // declares the same ten photos at both 750x1000 and 100x133, and an exact
  // dedupe kept the thumbnails alongside their own originals. When one photo
  // arrives twice, the bigger render wins.
  const order: string[] = [];
  const best = new Map<string, string>();
  const push = (value: string | undefined): void => {
    if (!value || isNonPhotoImage(value)) return;
    const key = productImageIdentity(value);
    if (!best.has(key)) order.push(key);
    const current = best.get(key);
    if (!current || declaredImageWidth(value) > declaredImageWidth(current)) {
      best.set(key, value);
    }
  };

  push(primary);
  for (const entry of Array.isArray(raw) ? raw : [raw]) {
    // Entries go in whole: normalizeImageUrl knows every spelling an
    // ImageObject uses, and unwrapping `url` here missed etsy's contentURL.
    push(normalizeImageUrl(entry, pageUrl));
    if (order.length >= 12) break;
  }
  return order.map((key) => best.get(key)!);
}

function ratingFromSiblings(nodes: Json[], primary: Json): ProductSnapshot['rating'] {
  const primaryName = toTrimmedString(primary['name']);
  if (!primaryName) return undefined;

  for (const candidate of nodes) {
    if (candidate === primary) continue;
    if (toTrimmedString(candidate['name']) !== primaryName) continue;
    const rating = readRating(candidate['aggregateRating']);
    if (rating) return rating;
  }
  return undefined;
}

function readCategory(raw: unknown): string[] | undefined {
  const values = (Array.isArray(raw) ? raw : [raw])
    .map((v) => toTrimmedString(v, 120))
    .filter((v): v is string => Boolean(v));
  return values.length ? values.slice(0, 6) : undefined;
}

// ── entry point ────────────────────────────────────────────────────────────

/**
 * Extract a product snapshot from a page's HTML.
 *
 * Returns null when the page has neither a Product node nor OpenGraph product
 * pricing — that page stays an ordinary web clip. Never throws: a malformed
 * page must not fail the archive.
 */
export function collectJsonLdProduct(html: string, pageUrl?: string): ProductSnapshot | null {
  if (!html) return null;

  try {
    const nodes: Json[] = [];
    let blocks = 0;
    for (const match of html.matchAll(JSONLD_BLOCK)) {
      if (++blocks > MAX_JSONLD_BLOCKS) break;
      const body = (match[1] ?? '').trim();
      if (!body) continue;
      flatten(parseJsonLdBlock(body), nodes);
    }

    const og = readOpenGraph(html, pageUrl);
    const productNodes = nodes.filter(isProductNode);
    const node = pickProductNode(productNodes, html, pageUrl);

    if (!node) {
      // WooCommerce stores without an SEO plugin expose price only via OG.
      if (og.price === undefined || !og.currency || !og.title) return null;
      return {
        name: og.title,
        price: og.price,
        currency: og.currency,
        priceIsFrom: false,
        ...(og.image ? { image: og.image } : {}),
        ...(og.siteName ? { seller: og.siteName } : {}),
      source: 'server-jsonld',
        confidence: 'confirmed',
        extractorVersion: `og-${PRODUCT_SNAPSHOT_VERSION}`,
        observedAt: new Date().toISOString(),
      };
    }

    const name = toTrimmedString(node['name']) ?? og.title;
    if (!name) return null;

    const aggregate = aggregatePrice(node);
    let price = aggregate.price;
    let currency = aggregate.currency;
    let confidence: ProductSnapshot['confidence'] = 'confirmed';

    // OG cross-check: a mismatch means we probably picked a sibling node.
    if (price !== undefined && og.price !== undefined && og.price > 0) {
      const drift = Math.abs(price - og.price) / og.price;
      if (drift > OG_CROSS_CHECK_TOLERANCE) {
        price = og.price;
        currency = og.currency ?? currency;
        confidence = 'guessed';
      }
    } else if (price === undefined && og.price !== undefined) {
      price = og.price;
      currency = og.currency ?? currency;
    }

    // A number without a currency cannot be displayed — drop it (§13.2-G7).
    if (price !== undefined && !currency) price = undefined;

    // The Product node's own image wins over og:image. og:image is a PAGE
    // share card, and on a marketplace it is frequently a site-wide asset:
    // mercari serves u-web-assets.mercdn.net/ogp_image_1.png (a promo collage
    // of sneakers and a PS4) while the node declares the nine real photos, so
    // the archive led with a picture of someone else's inventory.
    //
    // Measured on every archived store that declares both — tackform, gymshark,
    // ohora, fashionnova, andar — the two are the SAME file, so this reorder
    // costs nothing there and only bites where og:image is generic. Falls back
    // to og:image for nodes that declare no image at all.
    const image = normalizeImageUrl(node['image'], pageUrl) ?? og.image;
    // schema.org `image` is commonly an array; keep the whole declared gallery
    // with `image` first so a card can show one and a viewer can page them.
    const images = collectDeclaredImages(node['image'], image, pageUrl);
    // Who is actually selling this. schema.org puts it on the offer; on a
    // marketplace the store's own og:site_name is the next best thing, and it
    // is what a card should show instead of the marketplace's hostname.
    //
    // Brand is deliberately NOT in this chain. Measured across the archived
    // stores it names the wrong thing often enough to be useless as a seller:
    // tackform declares brand "Nissan" (the vehicle the bracket fits) and
    // gymshark "Gymshark | We Do Gym" (a page title). og:site_name gives
    // "Tackform" and "Gymshark" on those same pages. A card that wants to fall
    // back to brand can still do it — see productShopLabel — but this field
    // means the shop, so it stays honest.
    const sellerName = readSellerName(node['offers']) ?? og.siteName;
    const variesBy = readCategory(node['variesBy'])?.map((v) => v.split('/').pop() as string);

    // Review apps (Judge.me, Okendo, …) inject a SECOND Product node carrying
    // only name + aggregateRating, and it is client-rendered — it exists in the
    // browser DOM but not in server-fetched HTML. Taking the rating from any
    // sibling node that names the same product is what makes a clip see a
    // rating the server structurally cannot.
    const mergedRating = readRating(node['aggregateRating'])
      ?? ratingFromSiblings(productNodes, node);

    return {
      name,
      ...(price !== undefined ? { price, priceIsFrom: aggregate.priceIsFrom } : {}),
      ...(price !== undefined && currency ? { currency: currency.toUpperCase().slice(0, 8) } : {}),
      ...(aggregate.priceValidUntil ? { priceValidUntil: aggregate.priceValidUntil } : {}),
      ...(aggregate.availability ? { availability: aggregate.availability } : {}),
      ...(mergedRating ? { rating: mergedRating } : {}),
      ...(sellerName ? { seller: sellerName } : {}),
      ...(readBrandName(node['brand']) ? { brand: readBrandName(node['brand']) } : {}),
      ...(toTrimmedString(node['sku'], 120) ? { sku: toTrimmedString(node['sku'], 120) } : {}),
      ...(readDescription(node['description'])
        ? { description: readDescription(node['description']) }
        : {}),
      ...(image ? { image } : {}),
      ...(images.length > 1 ? { images } : {}),
      ...(readCategory(node['category']) ? { category: readCategory(node['category']) } : {}),
      ...(variesBy?.length ? { variesBy } : {}),
      source: 'server-jsonld',
      confidence,
      extractorVersion: PRODUCT_SNAPSHOT_VERSION,
      observedAt: new Date().toISOString(),
    };
  } catch {
    // Extraction must never fail an archive.
    return null;
  }
}
