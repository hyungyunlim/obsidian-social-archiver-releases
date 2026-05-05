/**
 * AUTO-GENERATED FILE - DO NOT EDIT DIRECTLY
 *
 * Source: shared/icons/publisher-lookup.ts
 * Generated: 2026-05-05T23:57:49.383Z
 *
 * To modify, edit the source file in shared/icons/ and run:
 *   npm run sync:shared
 */

/**
 * Publisher Lookup - Single Source of Truth
 *
 * Hand-written registry of recognized web publishers. The registry is the
 * source of truth for both:
 *
 * 1. Runtime lookups (`getPublisherFromUrl`, `getPublisherBySlug`,
 *    `getPublisherLabel`) used across plugin / share-web / mobile / desktop /
 *    admin / worker surfaces.
 * 2. The build-time generator (`scripts/gen-publisher-icons.mjs`) which reads
 *    the `PUBLISHER_REGISTRY` and emits `publisher-icons.ts` with inline SVG
 *    path data for `simple-icons` source publishers.
 *
 * Three icon source kinds are supported:
 * - `simple-icons`: imported from the `simple-icons` devDependency at build
 *   time; SVG path is inlined into `publisher-icons.ts`.
 * - `custom`: inline `path` + `hex` + `title` declared directly here; survives
 *   without external file dependencies.
 * - `google-cdn`: no SVG; the URL `https://www.google.com/s2/favicons?domain=X&sz=64`
 *   is computed at lookup time.
 *
 * Renderers consume only `PublisherEntry.icon` (a `PublisherIcon` discriminated
 * union). The `source` field on the registry entry is metadata for the
 * generator and must not be relied on at runtime.
 *
 * To modify, edit this source file and run:
 *   npm run gen:publisher-icons   # regenerate publisher-icons.ts
 *   npm run sync:shared           # propagate to consumer surfaces
 */

import type { PlatformIcon } from './platform-icons';
import * as PublisherIcons from './publisher-icons';

// ============================================================================
// Public types
// ============================================================================

/**
 * Resolved icon for rendering.
 *
 * - `svg`: carries a {@link PlatformIcon} (title + hex + path) and an optional
 *   `viewBox` (defaults to `"0 0 24 24"` when omitted). Surfaces render as a
 *   single `<path d=...>` inside an `<svg viewBox=...>`.
 * - `image`: carries an absolute URL (e.g. Google's favicon CDN). Surfaces
 *   render via an `<img>` element.
 */
export type PublisherIcon =
  | { type: 'svg'; data: PlatformIcon; viewBox?: string }
  | { type: 'image'; url: string };

/**
 * One registry entry per recognized publisher.
 *
 * `domain` is the canonical domain (used for display + Google CDN URL).
 * `domains` lists additional domains that should resolve to the same entry.
 * Both are matched case-insensitively after stripping a leading `www.`, with
 * dot-boundary suffix matching (so `magazine.newyorker.com` resolves to
 * `newyorker` but `fakenewyorker.com` does not).
 */
export interface PublisherEntry {
  slug: string;
  name: string;
  domain: string;
  domains?: string[];
  icon: PublisherIcon;
}

/**
 * Source declaration consumed by the generator + this registry.
 *
 * NOT part of the public renderer contract. Surfaces should only read
 * `PublisherEntry.icon`.
 */
export type PublisherSource =
  | { kind: 'simple-icons'; siExport: string }
  | { kind: 'google-cdn' }
  | { kind: 'custom'; title: string; hex: string; path: string; viewBox?: string };

interface RegistryEntry {
  slug: string;
  name: string;
  domain: string;
  domains?: string[];
  source: PublisherSource;
}

// ============================================================================
// Helpers
// ============================================================================

const GOOGLE_FAVICON_BASE = 'https://www.google.com/s2/favicons';
const GOOGLE_FAVICON_SIZE = 64;

function googleFaviconUrl(domain: string): string {
  return `${GOOGLE_FAVICON_BASE}?domain=${encodeURIComponent(domain)}&sz=${GOOGLE_FAVICON_SIZE}`;
}

function resolveIcon(entry: RegistryEntry): PublisherIcon {
  const { source, slug, name, domain } = entry;

  if (source.kind === 'simple-icons') {
    const exported = (PublisherIcons as Record<string, unknown>)[source.siExport];
    if (exported && typeof exported === 'object' && 'path' in (exported as Record<string, unknown>)) {
      return { type: 'svg', data: exported as PlatformIcon };
    }
    // simple-icons miss — fall back to Google CDN so the publisher still gets
    // attribution rather than throwing or returning the generic web icon.
    return { type: 'image', url: googleFaviconUrl(domain) };
  }

  if (source.kind === 'custom') {
    const data: PlatformIcon = {
      title: source.title,
      hex: source.hex,
      path: source.path,
    };
    return source.viewBox
      ? { type: 'svg', data, viewBox: source.viewBox }
      : { type: 'svg', data };
  }

  // google-cdn
  void slug;
  void name;
  return { type: 'image', url: googleFaviconUrl(domain) };
}

// ============================================================================
// Registry — starter set v1 (34 publishers)
// ============================================================================

/**
 * Hand-curated publisher registry.
 *
 * Adding a new publisher:
 * 1. Append a {@link RegistryEntry} below.
 * 2. If `source.kind === 'simple-icons'`, run `npm run gen:publisher-icons`
 *    to refresh `publisher-icons.ts`.
 * 3. Run `npm run sync:shared` to copy both files to consumer surfaces.
 */
const PUBLISHER_REGISTRY_RAW: RegistryEntry[] = [
  // --- simple-icons (8 shipped) ---
  {
    slug: 'theguardian',
    name: 'The Guardian',
    domain: 'theguardian.com',
    source: { kind: 'simple-icons', siExport: 'siTheguardian' },
  },
  {
    slug: 'techcrunch',
    name: 'TechCrunch',
    domain: 'techcrunch.com',
    source: { kind: 'simple-icons', siExport: 'siTechcrunch' },
  },
  {
    slug: 'medium',
    name: 'Medium',
    domain: 'medium.com',
    source: { kind: 'simple-icons', siExport: 'siMedium' },
  },
  {
    slug: 'substack',
    name: 'Substack',
    domain: 'substack.com',
    source: { kind: 'simple-icons', siExport: 'siSubstack' },
  },
  {
    slug: 'derspiegel',
    name: 'Der Spiegel',
    domain: 'spiegel.de',
    source: { kind: 'simple-icons', siExport: 'siDerspiegel' },
  },
  {
    slug: 'arstechnica',
    name: 'Ars Technica',
    domain: 'arstechnica.com',
    source: { kind: 'simple-icons', siExport: 'siArstechnica' },
  },
  {
    slug: 'axios',
    name: 'Axios',
    domain: 'axios.com',
    source: { kind: 'simple-icons', siExport: 'siAxios' },
  },
  {
    slug: 'vox',
    name: 'VOX',
    domain: 'vox.com',
    source: { kind: 'simple-icons', siExport: 'siVox' },
  },

  // --- custom (inlined SVG path data) ---
  // Source: experiments/publisher-icon-crawl/icons/bbc__mask-icon.svg
  // Three uniform squares (BBC blocks logo). Combined path; brand red used
  // as accent hex while surfaces typically fill via currentColor.
  {
    slug: 'bbc',
    name: 'BBC',
    domain: 'bbc.com',
    domains: ['bbc.co.uk'],
    source: {
      kind: 'custom',
      title: 'BBC',
      hex: '000000',
      // Original SVG used pt units with a translate(0,512)+scale(0.1,-0.1)
      // transform. Coordinates are kept in original (untransformed) space and
      // we expose the matching viewBox so surfaces can render unmodified.
      // viewBox 0 0 512 512 represents a flat layout: three rows of 3 blocks
      // sized 105 wide, 105 tall, at y=180 with 192-px x-spacing.
      path: 'M72 256h105v-105h-105zM204 256h104v-105h-104zM335 256h105v-105h-105z',
      viewBox: '0 0 512 256',
    },
  },
  // Source: experiments/publisher-icon-crawl/icons/newsweek__icon.svg
  // Two paths sharing brand red (#E91D0C). Combined into single `d`.
  {
    slug: 'newsweek',
    name: 'Newsweek',
    domain: 'newsweek.com',
    source: {
      kind: 'custom',
      title: 'Newsweek',
      hex: 'E91D0C',
      path:
        'M19.1328 12.3264V28.2856H22.9368V34.1368H9.088V28.2856H12.6476V5.8056H9.088V0.1804H9.084V0H0V40H40V34.1368H34.5424L19.1328 12.3264Z ' +
        'M18.6432 0L33.518 21.0884V5.8056H29.7636V0H18.6432Z',
      viewBox: '0 0 40 40',
    },
  },
  // Source: experiments/publisher-icon-crawl/icons/slate__icon.svg
  // Original used a white background rect and a single dark "S" glyph. We
  // drop the background and keep only the glyph so surfaces can tint via
  // currentColor while the brand hex is preserved.
  {
    slug: 'slate',
    name: 'Slate',
    domain: 'slate.com',
    source: {
      kind: 'custom',
      title: 'Slate',
      hex: '2C0022',
      path:
        'M0 0v100h31.15a54.42 54.42 0 01-12.64-6.61L28 75.53a38.6 38.6 0 009.84 6.55 23.5 23.5 0 009.61 2.15c3.61 0 6.31-.83 8.08-2.49a7.56 7.56 0 002.66-5.65 7.72 7.72 0 00-.68-3.34 7.34 7.34 0 00-2.26-2.6A18.29 18.29 0 0051.13 68c-1.69-.68-3.75-1.43-6.16-2.26-2.87-.91-5.67-1.9-8.42-3a26.16 26.16 0 01-7.35-4.35A20.11 20.11 0 0124 51.5 24.18 24.18 0 0122 41a30 30 0 012.09-11.47A25.29 25.29 0 0130 20.75 26 26 0 0139.26 15a34.93 34.93 0 0112.27-2 54 54 0 0113.22 1.75A58.46 58.46 0 0178 19.9l-8.84 17.3a27.58 27.58 0 00-7.23-4.36 19.29 19.29 0 00-7-1.41 11.35 11.35 0 00-7 2 6.31 6.31 0 00-2.71 5.31 5.3 5.3 0 001.35 3.73 12 12 0 003.56 2.55 31.24 31.24 0 005 1.86c1.84.53 3.67 1.09 5.48 1.7q10.86 3.62 15.89 9.66t5 15.78a30.69 30.69 0 01-2.21 11.87A24.78 24.78 0 0172.84 95a28.52 28.52 0 01-8 5H100V0z',
      viewBox: '0 0 100 100',
    },
  },

  // --- google-cdn (23 publishers) ---
  // washingtonpost + theverge moved here from the original favicon-svg plan
  // because their favicons rely on clipPath / nested groups that do not fit
  // the single-`path` PlatformIcon shape.
  { slug: 'washingtonpost', name: 'The Washington Post', domain: 'washingtonpost.com', source: { kind: 'google-cdn' } },
  { slug: 'theverge', name: 'The Verge', domain: 'theverge.com', source: { kind: 'google-cdn' } },
  { slug: 'nytimes', name: 'The New York Times', domain: 'nytimes.com', source: { kind: 'google-cdn' } },
  { slug: 'latimes', name: 'Los Angeles Times', domain: 'latimes.com', source: { kind: 'google-cdn' } },
  { slug: 'usatoday', name: 'USA TODAY', domain: 'usatoday.com', source: { kind: 'google-cdn' } },
  { slug: 'reuters', name: 'Reuters', domain: 'reuters.com', source: { kind: 'google-cdn' } },
  { slug: 'newyorker', name: 'The New Yorker', domain: 'newyorker.com', source: { kind: 'google-cdn' } },
  { slug: 'theatlantic', name: 'The Atlantic', domain: 'theatlantic.com', source: { kind: 'google-cdn' } },
  { slug: 'time', name: 'TIME', domain: 'time.com', source: { kind: 'google-cdn' } },
  { slug: 'wsj', name: 'The Wall Street Journal', domain: 'wsj.com', source: { kind: 'google-cdn' } },
  { slug: 'bloomberg', name: 'Bloomberg', domain: 'bloomberg.com', source: { kind: 'google-cdn' } },
  { slug: 'forbes', name: 'Forbes', domain: 'forbes.com', source: { kind: 'google-cdn' } },
  { slug: 'fortune', name: 'Fortune', domain: 'fortune.com', source: { kind: 'google-cdn' } },
  { slug: 'hbr', name: 'Harvard Business Review', domain: 'hbr.org', source: { kind: 'google-cdn' } },
  { slug: 'ft', name: 'Financial Times', domain: 'ft.com', source: { kind: 'google-cdn' } },
  { slug: 'theeconomist', name: 'The Economist', domain: 'economist.com', source: { kind: 'google-cdn' } },
  { slug: 'wired', name: 'WIRED', domain: 'wired.com', source: { kind: 'google-cdn' } },
  { slug: 'vogue', name: 'Vogue', domain: 'vogue.com', source: { kind: 'google-cdn' } },
  { slug: 'gq', name: 'GQ', domain: 'gq.com', source: { kind: 'google-cdn' } },
  { slug: 'vanityfair', name: 'Vanity Fair', domain: 'vanityfair.com', source: { kind: 'google-cdn' } },
  { slug: 'rollingstone', name: 'Rolling Stone', domain: 'rollingstone.com', source: { kind: 'google-cdn' } },
  { slug: 'variety', name: 'Variety', domain: 'variety.com', source: { kind: 'google-cdn' } },
  { slug: 'politico', name: 'Politico', domain: 'politico.com', source: { kind: 'google-cdn' } },
];

// ============================================================================
// Public registry + indexes (built once at module load)
// ============================================================================

/**
 * Frozen array of resolved publisher entries. Order matches
 * `PUBLISHER_REGISTRY_RAW`; the first matching entry wins on ambiguity.
 */
export const PUBLISHER_REGISTRY: ReadonlyArray<PublisherEntry> = Object.freeze(
  PUBLISHER_REGISTRY_RAW.map((raw) => {
    const entry: PublisherEntry = {
      slug: raw.slug,
      name: raw.name,
      domain: raw.domain,
      ...(raw.domains ? { domains: [...raw.domains] } : {}),
      icon: resolveIcon(raw),
    };
    return Object.freeze(entry);
  }) as PublisherEntry[]
);

const SLUG_INDEX: ReadonlyMap<string, PublisherEntry> = (() => {
  const map = new Map<string, PublisherEntry>();
  for (const entry of PUBLISHER_REGISTRY) {
    if (!map.has(entry.slug)) map.set(entry.slug, entry);
  }
  return map;
})();

/**
 * Exact-domain lookup map. Lowercased, www-stripped keys.
 */
const DOMAIN_INDEX: ReadonlyMap<string, PublisherEntry> = (() => {
  const map = new Map<string, PublisherEntry>();
  for (const entry of PUBLISHER_REGISTRY) {
    const allDomains = [entry.domain, ...(entry.domains ?? [])];
    for (const d of allDomains) {
      const key = d.toLowerCase().replace(/^www\./, '');
      if (!map.has(key)) map.set(key, entry);
    }
  }
  return map;
})();

/**
 * Suffix list for dot-boundary matching. Sorted longest-first so e.g.
 * `news.bbc.co.uk` matches `bbc.co.uk` rather than another `.uk` entry.
 */
const SUFFIX_LIST: ReadonlyArray<{ suffix: string; entry: PublisherEntry }> = (() => {
  const list: Array<{ suffix: string; entry: PublisherEntry }> = [];
  for (const entry of PUBLISHER_REGISTRY) {
    const allDomains = [entry.domain, ...(entry.domains ?? [])];
    for (const d of allDomains) {
      list.push({ suffix: d.toLowerCase().replace(/^www\./, ''), entry });
    }
  }
  list.sort((a, b) => b.suffix.length - a.suffix.length);
  return list;
})();

// ============================================================================
// Public lookup API
// ============================================================================

/**
 * Resolve a publisher entry from a URL.
 *
 * Returns `null` for missing/invalid input — never throws. Lowercases the
 * hostname, strips a leading `www.`, and matches against `domain` / `domains`
 * with dot-boundary suffix semantics (so `magazine.newyorker.com` matches
 * `newyorker.com` but `fakenewyorker.com` does not).
 */
export function getPublisherFromUrl(
  url: string | undefined | null
): PublisherEntry | null {
  if (!url || typeof url !== 'string') return null;

  let hostname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  if (!hostname) return null;

  // 1) Exact domain hit.
  const direct = DOMAIN_INDEX.get(hostname);
  if (direct) return direct;

  // 2) Dot-boundary suffix scan (longest-first preserves specificity).
  for (const { suffix, entry } of SUFFIX_LIST) {
    if (hostname === suffix) return entry;
    if (hostname.endsWith('.' + suffix)) return entry;
  }

  return null;
}

/**
 * Resolve a publisher entry from a stored slug. Returns `null` for unknown or
 * empty slugs.
 */
export function getPublisherBySlug(
  slug: string | undefined | null
): PublisherEntry | null {
  if (!slug || typeof slug !== 'string') return null;
  return SLUG_INDEX.get(slug) ?? null;
}

/**
 * Resolve a human-readable publisher label, preferring the persisted slug
 * over a URL fallback. Returns `null` if neither resolves.
 */
export function getPublisherLabel(
  slug: string | undefined | null,
  fallbackUrl?: string
): string | null {
  const bySlug = getPublisherBySlug(slug);
  if (bySlug) return bySlug.name;

  if (fallbackUrl) {
    const byUrl = getPublisherFromUrl(fallbackUrl);
    if (byUrl) return byUrl.name;
  }

  return null;
}
