/**
 * Group vault archives by place.
 *
 * The plugin has no SQL, so this is the shape share-web uses — a reduce over
 * already-parsed posts — rather than mobile/desktop's `GROUP BY place_key`.
 * `PostDataParser` already parses `locations` for every note, so the vault is
 * the read model and no index or table is needed.
 *
 * Three things are load-bearing and deliberately match the other clients:
 *
 * 1. **Eligibility is the place DATA, never `platform`.** Measured on a real
 *    vault, 12 of 14 place-bearing notes sat on threads/facebook/kidsnote. A
 *    platform gate — which is what the timeline's platform chips are — reaches
 *    almost none of them.
 * 2. **`placeKey` folds ASCII-only.** SQLite ships no ICU, so its `LOWER()`
 *    leaves `É` alone while JS `toLowerCase()` folds it. A full fold here would
 *    mint keys that never match the server/mobile/desktop grouping.
 * 3. **Map-provider archives are not related posts.** For a place, the provider
 *    card IS the place; counting it would inflate every count against the other
 *    clients. It contributes the `+1` via `placeArchiveId` instead.
 */

import { isMapPlaceCardEligible } from '@/shared/platforms/map-places';
import type { PlaceKind } from '@/shared/platforms/place-kinds';
import type { ArchiveLocation, PlaceArchiveState } from '@/types/archive-location';
import type { PostData } from '@/types/post';

export interface PlaceSummary {
  placeKey: string;
  name: string;
  address?: string;
  /** relatedPostCount + 1 when the place has its own archive. */
  archiveCount: number;
  /** Archives that merely reference the place — provider cards excluded. */
  relatedPostCount: number;
  locationSource?: string;
  locationExternalId?: string;
  locationUrl?: string;
  category?: string;
  placeKind?: PlaceKind;
  latitude?: number;
  longitude?: number;
  hasCoords: boolean;
  placeArchiveId?: string;
  placeArchiveState: PlaceArchiveState;
  /** Epoch ms of the freshest reference; drives "recent" ordering. */
  lastReferencedAt: number;
  /** Vault paths of every archive referencing this place, provider card included. */
  filePaths: string[];
}

/** ASCII-only lowercase. See rule 2 in the module docblock. */
function foldAscii(value: string): string {
  return value.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Rebuild a place key from the flat frontmatter fields, for notes written before
 * the `locations` array existed. Mirrors `buildPlaceKey` in the mobile app.
 */
function legacyPlaceKey(metadata: PostData['metadata']): string | null {
  if (metadata.locationSource && metadata.locationExternalId) {
    return `${metadata.locationSource}:${metadata.locationExternalId}`;
  }
  const name = typeof metadata.location === 'string' ? metadata.location.trim() : '';
  return name ? `name:${foldAscii(name)}` : null;
}

/** Synthesize a single location from the flat primary fields. */
function legacyLocation(post: PostData): ArchiveLocation | null {
  const metadata = post.metadata;
  const name = typeof metadata.location === 'string' ? metadata.location.trim() : '';
  if (!name) return null;
  const placeKey = legacyPlaceKey(metadata);
  if (!placeKey) return null;

  const archiveId = post.sourceArchiveId ?? post.id ?? post.filePath ?? '';
  const timestamp = metadata.timestamp instanceof Date
    ? metadata.timestamp.toISOString()
    : new Date(0).toISOString();

  return {
    id: `legacy:${archiveId}`,
    archiveId,
    placeKey,
    name,
    address: typeof metadata.locationAddress === 'string' ? metadata.locationAddress : null,
    latitude: typeof metadata.latitude === 'number' ? metadata.latitude : null,
    longitude: typeof metadata.longitude === 'number' ? metadata.longitude : null,
    source: typeof metadata.locationSource === 'string' ? metadata.locationSource : null,
    externalId: typeof metadata.locationExternalId === 'string' ? metadata.locationExternalId : null,
    url: typeof metadata.locationUrl === 'string' ? metadata.locationUrl : null,
    category: typeof metadata.locationCategory === 'string' ? metadata.locationCategory : null,
    placeKind: metadata.locationPlaceKind ?? null,
    isPrimary: true,
    sortOrder: 0,
    placeArchiveId: null,
    promotionStatus: 'metadata_only',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Every place attached to a post. The structured array wins when present; the
 * flat fields are the fallback for notes that predate it.
 */
export function locationsForPost(post: PostData): readonly ArchiveLocation[] {
  const structured = (post.metadata.locations ?? []).filter(
    (location) => Boolean(location?.name?.trim()) && Boolean(location?.placeKey),
  );
  if (structured.length > 0) return structured;
  const fallback = legacyLocation(post);
  return fallback ? [fallback] : [];
}

/** Whether this archive has any place at all — the browse predicate. */
export function hasPlace(post: PostData): boolean {
  return locationsForPost(post).length > 0;
}

function referencedAtOf(location: ArchiveLocation, post: PostData): number {
  const fromLocation = location.updatedAt ? Date.parse(location.updatedAt) : Number.NaN;
  if (!Number.isNaN(fromLocation)) return fromLocation;
  return post.metadata.timestamp instanceof Date ? post.metadata.timestamp.getTime() : 0;
}

export type PlaceSort = 'recent' | 'name' | 'count';

/**
 * Group posts by place, freshest metadata winning per field.
 *
 * Sorted by post count then name, matching share-web, so the plugin's default
 * ordering agrees with the other clients out of the box.
 */
export function aggregatePlaces(posts: readonly PostData[]): PlaceSummary[] {
  const summaries = new Map<string, PlaceSummary>();
  // Per-place high-water marks, so a stale reference cannot overwrite a fresh
  // field just because it was visited later.
  const metadataAt = new Map<string, number>();
  const coordinatesAt = new Map<string, number>();

  for (const post of posts) {
    const isProviderCard = isMapPlaceCardEligible(post.platform);
    const countedInThisPost = new Set<string>();

    for (const location of locationsForPost(post)) {
      const referencedAt = referencedAtOf(location, post);
      let summary = summaries.get(location.placeKey);
      if (!summary) {
        summary = {
          placeKey: location.placeKey,
          name: location.name,
          archiveCount: 0,
          relatedPostCount: 0,
          hasCoords: false,
          placeArchiveState: location.promotionStatus,
          lastReferencedAt: referencedAt,
          filePaths: [],
        };
        summaries.set(location.placeKey, summary);
      }

      // Rule 3: the provider card is the place, not a post about it — so it is
      // not counted. Its path IS collected: selecting a place should surface the
      // place's own archive alongside the posts, matching desktop's filter.
      if (!countedInThisPost.has(location.placeKey)) {
        if (!isProviderCard) summary.relatedPostCount += 1;
        countedInThisPost.add(location.placeKey);
        if (post.filePath) summary.filePaths.push(post.filePath);
      }

      if (location.placeArchiveId && location.promotionStatus === 'archived') {
        summary.placeArchiveId = location.placeArchiveId;
      } else if (isProviderCard) {
        // This note IS the place, so it is the place's archive whether or not a
        // promotion ever said so. Promotion is only ONE way a place archive gets
        // created — a pasted map URL, the share sheet and "add a place" all mint
        // one directly, and those file as metadata_only with no placeArchiveId.
        // Without this the place's own card showed on its page while the list
        // counted it as zero. `??=` so an explicit promotion still wins.
        summary.placeArchiveId ??= post.sourceArchiveId ?? post.id ?? undefined;
      }
      // 'archived' is terminal; otherwise let a more advanced state win over
      // metadata_only so an in-flight promotion is visible.
      if (isProviderCard) {
        // The note exists, so the place is archived — the same conclusion the
        // other clients reach from `map_archive_identity`.
        summary.placeArchiveState = 'archived';
      } else if (location.promotionStatus === 'archived'
        || summary.placeArchiveState === 'metadata_only'
        || summary.placeArchiveState === 'archive_failed') {
        summary.placeArchiveState = location.promotionStatus;
      }

      if (location.latitude !== null && location.longitude !== null) {
        const previous = coordinatesAt.get(location.placeKey);
        if (previous === undefined || referencedAt > previous) {
          summary.latitude = location.latitude;
          summary.longitude = location.longitude;
          summary.hasCoords = true;
          coordinatesAt.set(location.placeKey, referencedAt);
        }
      }

      const previousMetadata = metadataAt.get(location.placeKey);
      if (previousMetadata === undefined || referencedAt > previousMetadata) {
        summary.name = location.name;
        summary.lastReferencedAt = referencedAt;
        if (location.address) summary.address = location.address;
        if (location.source) summary.locationSource = location.source;
        if (location.externalId) summary.locationExternalId = location.externalId;
        if (location.url) summary.locationUrl = location.url;
        if (location.category) summary.category = location.category;
        if (location.placeKind) summary.placeKind = location.placeKind;
        metadataAt.set(location.placeKey, referencedAt);
      }
    }
  }

  for (const summary of summaries.values()) {
    // The place's own archive counts as one item, matching PlaceRepository.
    summary.archiveCount = summary.relatedPostCount + (summary.placeArchiveId ? 1 : 0);
  }

  return [...summaries.values()].sort(
    (a, b) => b.relatedPostCount - a.relatedPostCount || a.name.localeCompare(b.name),
  );
}

/** Case-insensitive match over name and address, like mobile and desktop. */
export function filterPlacesBySearch(places: readonly PlaceSummary[], query: string): PlaceSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...places];
  return places.filter(
    (place) => place.name.toLowerCase().includes(needle)
      || (place.address ?? '').toLowerCase().includes(needle),
  );
}

/** `null` in the set matches places with no kind, which is the majority. */
export function filterPlacesByKinds(
  places: readonly PlaceSummary[],
  kinds: ReadonlySet<PlaceKind | null>,
): PlaceSummary[] {
  if (kinds.size === 0) return [...places];
  return places.filter((place) => kinds.has(place.placeKind ?? null));
}

export function filterPlacesByProvider(
  places: readonly PlaceSummary[],
  provider: string | null,
): PlaceSummary[] {
  if (!provider) return [...places];
  return places.filter((place) => place.locationSource === provider);
}

export function sortPlaces(places: readonly PlaceSummary[], sort: PlaceSort): PlaceSummary[] {
  const sorted = [...places];
  switch (sort) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'count':
      return sorted.sort((a, b) => b.archiveCount - a.archiveCount || a.name.localeCompare(b.name));
    case 'recent':
    default:
      return sorted.sort(
        (a, b) => b.lastReferencedAt - a.lastReferencedAt || a.name.localeCompare(b.name),
      );
  }
}

/** Kinds actually present, so the chip bar never offers an empty filter. */
export function availablePlaceKinds(places: readonly PlaceSummary[]): (PlaceKind | null)[] {
  const seen = new Set<PlaceKind | null>();
  for (const place of places) seen.add(place.placeKind ?? null);
  return [...seen];
}

/** Providers actually present, same reasoning. */
export function availablePlaceProviders(places: readonly PlaceSummary[]): string[] {
  const seen = new Set<string>();
  for (const place of places) if (place.locationSource) seen.add(place.locationSource);
  return [...seen];
}
