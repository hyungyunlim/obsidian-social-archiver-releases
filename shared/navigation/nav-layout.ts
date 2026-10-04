/**
 * Navigation layout - Single Source of Truth
 *
 * One account-level sidebar layout (which items are hidden, and in what order
 * the rest appear) shared by the mobile drawer, the desktop sidebar and the
 * share-web owner sidebar. The worker stores the document as-is; every client
 * renders it through these pure helpers, so one layout means the same thing
 * everywhere. PRD: .taskmaster/docs/prd-sidebar-customization.md
 *
 * Compatibility rules:
 * - `hidden` is a deny-list, so an item added in a later release shows up by
 *   default instead of being silently missing for everyone who customized.
 * - `order` is a relative order. Empty means "client default". A key the client
 *   renders but the order lacks slots in right after its nearest default-order
 *   predecessor.
 * - Keys a client does not render (another client's item, a newer release's
 *   item) ride along through every edit untouched.
 *
 * This file is copied to client targets at build time.
 * To modify, edit this source file and run: npm run sync:shared
 */

/** Canonical item keys. Each client maps them onto its own nav entries. */
export const NAV_ITEM_KEYS = [
  'all',
  'inbox',
  'shorts',
  'subscriptions',
  'archive',
  'starred',
  'shared',
  'notes',
  'tags',
  'collections',
  'authors',
  'places',
  'shopping',
  'review',
  'stats',
  'local',
] as const;

export type NavItemKey = (typeof NAV_ITEM_KEYS)[number];

/** Cap per list. There are 15 items today; this only bounds hostile input. */
export const NAV_LAYOUT_MAX_KEYS = 64;

/**
 * Shape of a storable key. Validation checks the shape, not NAV_ITEM_KEYS, so
 * a client release that adds an item never waits on a server deploy.
 */
export const NAV_ITEM_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export interface NavLayout {
  /** User-chosen relative order; may hold keys this client does not render. */
  readonly order: readonly string[];
  /** Deny-list; may hold keys this client does not render. */
  readonly hidden: readonly string[];
}

export const DEFAULT_NAV_LAYOUT: NavLayout = Object.freeze({ order: [], hidden: [] });

const NAV_ITEM_KEY_SET: ReadonlySet<string> = new Set<string>(NAV_ITEM_KEYS);

export function isNavItemKey(value: unknown): value is NavItemKey {
  return typeof value === 'string' && NAV_ITEM_KEY_SET.has(value);
}

function normalizeKeyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const values: readonly unknown[] = raw;
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !NAV_ITEM_KEY_PATTERN.test(value) || seen.has(value)) continue;
    seen.add(value);
    keys.push(value);
    if (keys.length === NAV_LAYOUT_MAX_KEYS) break;
  }
  return keys;
}

/**
 * Tolerant parser for anything read from storage or the network: a non-object
 * becomes the default layout, malformed keys are dropped, duplicates keep their
 * first occurrence, and each list is capped at NAV_LAYOUT_MAX_KEYS.
 */
export function normalizeNavLayout(raw: unknown): NavLayout {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_NAV_LAYOUT;
  return {
    order: 'order' in raw ? normalizeKeyList(raw.order) : [],
    hidden: 'hidden' in raw ? normalizeKeyList(raw.hidden) : [],
  };
}

export function isDefaultNavLayout(layout: NavLayout): boolean {
  return layout.order.length === 0 && layout.hidden.length === 0;
}

/** `order` compares positionally; `hidden` is a set, so its order is ignored. */
export function areNavLayoutsEqual(a: NavLayout, b: NavLayout): boolean {
  if (a.order.length !== b.order.length || a.hidden.length !== b.hidden.length) return false;
  if (a.order.some((key, index) => b.order[index] !== key)) return false;
  const hidden = new Set(b.hidden);
  return a.hidden.every((key) => hidden.has(key));
}

/**
 * Every key of `defaultOrder`, hidden ones included, in the user's order. Keys
 * the stored order lacks are slotted in after their default-order predecessor
 * (or first, when they lead the default order). Unknown keys are ignored.
 */
export function orderNavItems<K extends string>(
  defaultOrder: readonly K[],
  layout: NavLayout | null | undefined,
): K[] {
  const byKey = new Map<string, K>(defaultOrder.map((key) => [key, key]));
  const ordered: K[] = [];
  const placed = new Set<K>();

  for (const raw of layout?.order ?? []) {
    const key = byKey.get(raw);
    if (key === undefined || placed.has(key)) continue;
    ordered.push(key);
    placed.add(key);
  }

  let predecessor: K | null = null;
  for (const key of defaultOrder) {
    if (!placed.has(key)) {
      const insertAt = predecessor === null ? 0 : ordered.indexOf(predecessor) + 1;
      ordered.splice(insertAt, 0, key);
      placed.add(key);
    }
    predecessor = key;
  }

  return ordered;
}

/**
 * The keys to render, in order. `pinned` keys (the item a client opens to by
 * default) render even when hidden, because another device may have hidden
 * them; editors show them locked instead of offering to hide them.
 */
export function resolveVisibleNavItems<K extends string>(
  defaultOrder: readonly K[],
  layout: NavLayout | null | undefined,
  options: { readonly pinned?: readonly K[] } = {},
): K[] {
  const hidden = new Set<string>(layout?.hidden ?? []);
  const pinned = new Set<string>(options.pinned ?? []);
  return orderNavItems(defaultOrder, layout).filter((key) => pinned.has(key) || !hidden.has(key));
}

/**
 * Position of each key in the user's order, for surfaces that keep their own
 * groups (header dropdowns) and only sort within each group.
 */
export function navRankMap<K extends string>(
  defaultOrder: readonly K[],
  layout: NavLayout | null | undefined,
): ReadonlyMap<K, number> {
  return new Map(orderNavItems(defaultOrder, layout).map((key, index): [K, number] => [key, index]));
}

export function withNavItemHidden(layout: NavLayout, key: string, hidden: boolean): NavLayout {
  const rest = layout.hidden.filter((existing) => existing !== key);
  return normalizeNavLayout({ order: layout.order, hidden: hidden ? [...rest, key] : rest });
}

/**
 * Store a new order for the keys a client just rearranged. Every other key in
 * the stored order (unknown to this client, or not listed in its editor) stays
 * right behind the rearranged key it followed before, so an older or narrower
 * client never scrambles or drops what it cannot see.
 */
export function withNavOrder(layout: NavLayout, orderedKeys: readonly string[]): NavLayout {
  const moving = new Set(orderedKeys);
  const head: string[] = [];
  const trailing = new Map<string, string[]>();
  let anchor: string | null = null;

  for (const key of layout.order) {
    if (moving.has(key)) {
      anchor = key;
    } else if (anchor === null) {
      head.push(key);
    } else {
      const bucket = trailing.get(anchor);
      if (bucket) bucket.push(key);
      else trailing.set(anchor, [key]);
    }
  }

  const order = [...head];
  for (const key of orderedKeys) order.push(key, ...(trailing.get(key) ?? []));
  return normalizeNavLayout({ order, hidden: layout.hidden });
}
