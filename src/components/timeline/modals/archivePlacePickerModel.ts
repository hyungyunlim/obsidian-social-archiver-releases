import { buildExactMapPlaceUrl, getMapPlaceProvider } from '@/shared/platforms';
import type {
  GetUserArchivesParams,
  GetUserArchivesResponse,
  ProviderPlaceSelectionResponse,
  ProviderSearchResponse,
  UserArchive,
} from '@/services/WorkersAPIClient';

export interface ArchivePlacePickerApi {
  getUserArchives(params?: GetUserArchivesParams): Promise<GetUserArchivesResponse>;
  setArchivePlace(archiveId: string, targetArchiveId: string | null): Promise<void>;
  searchProviderPlaces(query: string): Promise<ProviderSearchResponse>;
  selectProviderPlace(
    archiveId: string,
    selectionToken: string,
    idempotencyKey: string,
  ): Promise<ProviderPlaceSelectionResponse>;
}

export type ArchivePlacePickerChange =
  | { readonly targetArchiveId: string; readonly enrichment: 'existing' | 'queued' }
  | { readonly targetArchiveId: null; readonly enrichment: 'not-applicable' };

export type ArchivePlacePickerOptions = {
  readonly archiveId: string;
  readonly currentLocation: string | null;
  readonly api: ArchivePlacePickerApi;
  readonly onChanged: (change: ArchivePlacePickerChange) => void | Promise<void>;
};

export type ExistingPlaceOption = {
  readonly archiveId: string;
  readonly identity: string;
  readonly name: string;
  readonly provider: string;
  readonly category: string;
  readonly address: string;
};

type RequestFailure = Error & {
  readonly status?: number;
};

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
  const failure = error instanceof Error ? error as RequestFailure : null;
  if (failure?.status === 401) return 'Sign in again to search for places.';
  if (failure?.status === 429) return 'Too many place searches. Please wait and try again.';
  if (failure?.status === 503) return 'Place search is temporarily unavailable.';
  if (failure?.status === undefined) return 'You appear to be offline. Check your connection and try again.';
  if (operation === 'load') return 'Could not load your saved places.';
  if (operation === 'detach') return 'Could not remove this place. Please try again.';
  return 'Could not link this place. Please try again.';
}
