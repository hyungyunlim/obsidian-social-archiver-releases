import type { App } from 'obsidian';
import { buildExactMapPlaceUrl, getMapPlaceProvider } from '@/shared/platforms';
import { showConfirmModal } from '@/utils/confirm-modal';
import {
  buildCanonicalMapSearchProviderUrl,
  type MapSearchProvider,
  type MapSearchProviderPreference,
} from '@/shared/platforms/map-search-provider';
import type {
  ArchivePreferences,
  BillingUsageResponse,
  GetUserArchivesParams,
  GetUserArchivesResponse,
  ArchiveLocation,
  AttachPlaceCandidateExistingBody,
  AttachPlaceCandidateProviderBody,
  LocationAttachmentResult,
  LocationPromotionResult,
  PlaceCandidateAttachmentResult,
  ProviderSearchCandidate,
  ProviderSearchCandidateContext,
  ProviderSearchRequest,
  ProviderSearchResponse,
  UserArchive,
} from '@/services/WorkersAPIClient';

export interface ArchivePlacePickerApi {
  getUserArchives(params?: GetUserArchivesParams): Promise<GetUserArchivesResponse>;
  getArchivePreferences(): Promise<ArchivePreferences | {
    readonly mapSearchProvider: MapSearchProviderPreference;
    readonly mapSearchProviderAvailability: Readonly<Record<MapSearchProvider, boolean>>;
  }>;
  getUserUsage(): Promise<BillingUsageResponse>;
  searchProviderPlaces(request: ProviderSearchRequest): Promise<ProviderSearchResponse>;
  getArchiveLocations(archiveId: string): Promise<readonly ArchiveLocation[]>;
  attachProviderLocation(
    archiveId: string,
    selectionToken: string,
    idempotencyKey: string,
  ): Promise<LocationAttachmentResult>;
  attachExistingLocation(
    archiveId: string,
    representativeArchiveId: string,
    placeKey: string,
    idempotencyKey: string,
  ): Promise<LocationAttachmentResult>;
  attachPlaceCandidateFromProvider(
    candidateId: string,
    body: AttachPlaceCandidateProviderBody,
  ): Promise<PlaceCandidateAttachmentResult>;
  attachPlaceCandidateFromExisting(
    candidateId: string,
    body: AttachPlaceCandidateExistingBody,
  ): Promise<PlaceCandidateAttachmentResult>;
  patchArchiveLocation(
    archiveId: string,
    locationId: string,
    patch: { readonly isPrimary?: boolean; readonly sortOrder?: number },
  ): Promise<ArchiveLocation>;
  replaceProviderLocation(
    archiveId: string,
    locationId: string,
    selectionToken: string,
    idempotencyKey: string,
  ): Promise<ArchiveLocation>;
  deleteArchiveLocation(archiveId: string, locationId: string): Promise<void>;
  promoteArchiveLocation(
    archiveId: string,
    locationId: string,
    idempotencyKey: string,
  ): Promise<LocationPromotionResult>;
}

export type ArchivePlacePickerChange =
  | { readonly location: ArchiveLocation; readonly enrichment: 'not_requested' }
  | { readonly locationId: string; readonly enrichment: 'removed' }
  | { readonly location: ArchiveLocation; readonly targetArchiveId: string; readonly enrichment: 'queued' | 'completed' };

type ArchivePlacePickerBaseOptions = {
  readonly archiveId: string;
  readonly api: ArchivePlacePickerApi;
  readonly hostLocale: string;
};

export type ArchiveLocationPickerOptions = ArchivePlacePickerBaseOptions & {
  readonly candidateContext?: never;
  readonly currentLocation?: string | null;
  readonly archiveMapsUrl: (url: string) => void;
  readonly onChanged: (change: ArchivePlacePickerChange) => void | Promise<void>;
};

export type CandidatePlacePickerOptions = ArchivePlacePickerBaseOptions & {
  readonly candidateContext: ProviderSearchCandidateContext;
  readonly initialView: 'search' | 'existing';
  readonly onCandidateAttached: (
    result: PlaceCandidateAttachmentResult,
  ) => void | Promise<void>;
  readonly onClosed: () => void;
};

export type ArchivePlacePickerOptions = ArchiveLocationPickerOptions | CandidatePlacePickerOptions;

export function isCandidatePlacePicker(
  options: ArchivePlacePickerOptions,
): options is CandidatePlacePickerOptions {
  return options.candidateContext !== undefined;
}

export type ExistingPlaceOption = {
  readonly archiveId: string;
  readonly placeKey: string;
  readonly identity: string;
  readonly name: string;
  readonly provider: string;
  readonly category: string;
  readonly address: string;
};

export function getProviderCandidateName(candidate: ProviderSearchCandidate): string {
  return candidate.provider === 'googlemaps' ? candidate.displayName : candidate.name;
}

export function getProviderCandidateMetadata(candidate: ProviderSearchCandidate): string {
  return candidate.provider === 'googlemaps'
    ? [candidate.primaryType, candidate.formattedAddress].filter(Boolean).join(' · ')
    : [candidate.categoryGroupName || candidate.categoryName, candidate.roadAddress || candidate.address]
      .filter(Boolean).join(' · ');
}

const GOOGLE_MAPS_QUERY_KEYS = new Set([
  'api',
  'cid',
  'daddr',
  'destination',
  'll',
  'origin',
  'place_id',
  'q',
  'query',
  'query_place_id',
  'saddr',
]);

function hasGoogleMapsQuery(url: URL): boolean {
  return [...url.searchParams.keys()].some(key => GOOGLE_MAPS_QUERY_KEYS.has(key.toLowerCase()));
}

function hasGoogleMapsPath(pathname: string, mapsHost: boolean): boolean {
  const path = pathname.toLowerCase();
  const prefixes = [
    '/maps/place/',
    '/maps/search/',
    '/maps/dir/',
    '/maps/d/',
    '/maps/preview/',
    '/maps/@',
  ];
  if (prefixes.some(prefix => path.startsWith(prefix))) return true;
  if (!mapsHost) return false;
  return ['/place/', '/search/', '/dir/', '/d/', '/preview/', '/@']
    .some(prefix => path.startsWith(prefix));
}

export function resolveManualMapInput(provider: MapSearchProvider, value: string): string | null {
  const input = value.trim();
  const canonical = buildCanonicalMapSearchProviderUrl(provider, input);
  if (canonical) return canonical;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (provider === 'kakaomap') {
      return ['place.map.kakao.com', 'map.kakao.com', 'kko.kakao.com'].includes(host) ? url.href : null;
    }
    if (host === 'maps.app.goo.gl') return url.pathname !== '/' ? url.href : null;
    if (host === 'maps.google.com' || host === 'google.com') {
      const mapsHost = host === 'maps.google.com';
      const isQueryRoute = (url.pathname === '/' && mapsHost)
        || url.pathname === '/maps'
        || url.pathname === '/maps/';
      return hasGoogleMapsPath(url.pathname, mapsHost)
        || (isQueryRoute && hasGoogleMapsQuery(url))
        ? url.href
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

function metadataText(metadata: Record<string, unknown> | null, keys: readonly string[]): string {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function toExistingPlaceOption(archive: UserArchive): ExistingPlaceOption | null {
  const provider = getMapPlaceProvider(archive.locationSource)
    ?? getMapPlaceProvider(archive.platform);
  if (!provider) return null;

  const platformProvider = getMapPlaceProvider(archive.platform);
  const externalId = archive.locationExternalId?.trim()
    || (platformProvider?.source === provider.source ? archive.postId.trim() : '');
  const name = archive.location?.trim()
    || archive.title?.trim()
    || archive.authorName?.trim()
    || '';
  if (!externalId || !name) return null;
  if (!buildExactMapPlaceUrl({
    name,
    locationSource: provider.source,
    locationExternalId: externalId,
    latitude: archive.latitude,
    longitude: archive.longitude,
  })) return null;

  return {
    archiveId: archive.id,
    placeKey: `${provider.source}:${externalId}`,
    identity: `${provider.source}:${externalId}`,
    name,
    provider: provider.displayLabel,
    category: metadataText(archive.metadata, ['categoryName', 'category', 'categoryGroupName']),
    address: metadataText(archive.metadata, ['roadAddress', 'address', 'addressText']),
  };
}

export function dedupeExistingPlaceArchives(
  archives: readonly UserArchive[],
): readonly ExistingPlaceOption[] {
  const keyed = new Map<string, ExistingPlaceOption>();
  for (const archive of archives) {
    const option = toExistingPlaceOption(archive);
    if (option && !keyed.has(option.identity)) keyed.set(option.identity, option);
  }
  return [...keyed.values()];
}

export function getArchivePlacePickerError(
  error: unknown,
  operation: 'load' | 'search' | 'selection' | 'detach',
): string {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
  const status = error instanceof Error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
  if (code === 'INSUFFICIENT_CREDITS') return 'Not enough Cloud credits. Use a map URL or try again after reset.';
  if (code === 'GOOGLE_DAILY_LIMIT' || code === 'GOOGLE_MONTHLY_LIMIT') {
    return 'Your Google Maps search limit is reached. Use a map URL or try again after reset.';
  }
  if (code === 'GOOGLE_PROJECT_MONTHLY_LIMIT') {
    return 'Google Maps project limit is reached. Use a map URL or try again later.';
  }
  if (code === 'GOOGLE_PLACES_SEARCH_DISABLED') {
    return 'Google Maps search is unavailable. Choose Kakao or use a map URL.';
  }
  if (code === 'GOOGLE_BURST_LIMIT') return 'Google Maps search is busy. Wait a moment and retry.';
  if (status === 401) return 'Sign in again to search for places.';
  if (status === 429) return 'Too many place searches. Please wait and try again.';
  if (status === 503) return 'Place search is temporarily unavailable.';
  if (status === undefined) return 'You appear to be offline. Check your connection and try again.';
  if (operation === 'load') return 'Could not load your saved places.';
  if (operation === 'detach') return 'Could not remove this place. Please try again.';
  return 'Could not link this place. Please try again.';
}

/**
 * "Get details" mints a separate place archive (a new library entry) — a
 * non-obvious side effect for a button that reads like "show details". Confirm
 * before running so the cost/behavior is explicit. Shared by both promote paths.
 */
export function confirmGetPlaceDetails(app: App): Promise<boolean> {
  return showConfirmModal(app, {
    title: 'Get place details',
    message:
      'Find details for this place (photos, reviews, hours) and save it as a '
      + "separate place. If it's already saved, we'll link to it.",
    confirmText: 'Save',
  });
}
