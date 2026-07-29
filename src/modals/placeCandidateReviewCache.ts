import type { ProviderSearchCandidate } from '../services/WorkersAPIClient';
import {
  isPlaceKind,
  type PlaceKindIntent,
} from '../shared/platforms/place-kinds';
import type { MapSearchProvider } from '../shared/platforms/map-search-provider';
import type {
  CandidateInlineSearch,
  StagedCandidateMatch,
} from './placeCandidateReviewModel';
import type { ExtractPlaceCandidatesExecutionPreference } from '../types/place-candidate-attachment';

const CACHE_PREFIX = 'social-archiver:place-candidate-review:v1:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type PlaceCandidateReviewCache = {
  readonly version: 1;
  readonly archiveId: string;
  readonly savedAt: number;
  readonly provider: MapSearchProvider;
  readonly staged: Readonly<Record<string, StagedCandidateMatch>>;
  readonly searches: Readonly<Record<string, CandidateInlineSearch>>;
  readonly noteIntents: Readonly<Record<string, boolean>>;
  readonly kindIntents: Readonly<Record<string, PlaceKindIntent>>;
  readonly suppressedAutoIds: readonly string[];
  readonly includeOcr: boolean;
  readonly includeComments: boolean;
  readonly executionPreference: ExtractPlaceCandidatesExecutionPreference;
};

function key(archiveId: string): string {
  return `${CACHE_PREFIX}${archiveId}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function string(value: unknown, maximum = 8192): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

function provider(value: unknown): value is MapSearchProvider {
  return value === 'kakaomap' || value === 'googlemaps';
}

function executionPreference(
  value: unknown,
): value is ExtractPlaceCandidatesExecutionPreference {
  return value === 'auto' || value === 'server' || value === 'local';
}

function kindIntent(value: unknown): PlaceKindIntent | null {
  if (!record(value)) return null;
  if (value.mode !== 'suggest' && value.mode !== 'override') return null;
  if (!(value.placeKind === null || isPlaceKind(value.placeKind))) return null;
  if (value.mode === 'suggest' && value.placeKind === null) return null;
  return { mode: value.mode, placeKind: value.placeKind };
}

function providerResult(value: unknown): ProviderSearchCandidate | null {
  if (!record(value) || !provider(value.provider) || !string(value.externalId, 255)
    || !string(value.selectionToken)) return null;
  if (value.provider === 'googlemaps') {
    if (!string(value.displayName, 300) || !string(value.formattedAddress, 500)
      || typeof value.latitude !== 'number' || typeof value.longitude !== 'number') return null;
    return {
      provider: 'googlemaps',
      externalId: value.externalId,
      displayName: value.displayName,
      formattedAddress: value.formattedAddress,
      latitude: value.latitude,
      longitude: value.longitude,
      ...(string(value.primaryType, 100) && value.primaryType
        ? { primaryType: value.primaryType }
        : {}),
      selectionToken: value.selectionToken,
    };
  }
  if (!string(value.name, 300) || !string(value.categoryName, 500)
    || !string(value.categoryGroupCode, 20) || !string(value.categoryGroupName, 100)
    || !string(value.address, 500) || !string(value.roadAddress, 500)
    || typeof value.latitude !== 'number' || typeof value.longitude !== 'number'
    || !string(value.phone, 100) || !string(value.placeUrl, 500)) return null;
  return {
    provider: 'kakaomap',
    externalId: value.externalId,
    name: value.name,
    categoryName: value.categoryName,
    categoryGroupCode: value.categoryGroupCode,
    categoryGroupName: value.categoryGroupName,
    address: value.address,
    roadAddress: value.roadAddress,
    latitude: value.latitude,
    longitude: value.longitude,
    phone: value.phone,
    placeUrl: value.placeUrl,
    selectionToken: value.selectionToken,
  };
}

function stagedMatch(value: unknown): StagedCandidateMatch | null {
  if (!record(value) || !string(value.displayName, 300) || !string(value.displayAddress, 500)) {
    return null;
  }
  const parsedKind = kindIntent(value.placeKindIntent);
  if (value.kind === 'direct') {
    return {
      kind: 'direct',
      displayName: value.displayName,
      displayAddress: value.displayAddress,
      ...(parsedKind ? { placeKindIntent: parsedKind } : {}),
    };
  }
  if (value.kind !== 'provider' || !provider(value.provider)
    || !string(value.externalId, 255) || !string(value.selectionToken)
    || !string(value.query, 100) || !Number.isSafeInteger(value.matchedAt)) return null;
  return {
    kind: 'provider',
    provider: value.provider,
    externalId: value.externalId,
    selectionToken: value.selectionToken,
    query: value.query,
    matchedAt: value.matchedAt as number,
    displayName: value.displayName,
    displayAddress: value.displayAddress,
    ...(parsedKind ? { placeKindIntent: parsedKind } : {}),
  };
}

function inlineSearch(value: unknown): CandidateInlineSearch | null {
  if (!record(value) || !provider(value.provider) || !string(value.query, 100)
    || !Array.isArray(value.results)
    || !['idle', 'loading', 'results', 'empty', 'error', 'rate-limited']
      .includes(String(value.status))) return null;
  const results = value.results.flatMap((item): ProviderSearchCandidate[] => {
    const parsed = providerResult(item);
    return parsed ? [parsed] : [];
  });
  return {
    provider: value.provider,
    query: value.query,
    status: value.status === 'loading'
      ? 'idle'
      : value.status as CandidateInlineSearch['status'],
    results,
    ...(string(value.errorMessage, 500) ? { errorMessage: value.errorMessage } : {}),
  };
}

export function loadPlaceCandidateReviewCache(
  archiveId: string,
  pendingIds: readonly string[],
  now = Date.now(),
): PlaceCandidateReviewCache | null {
  try {
    const raw = window.localStorage?.getItem(key(archiveId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || value.archiveId !== archiveId
      || !Number.isSafeInteger(value.savedAt)
      || now - (value.savedAt as number) > CACHE_TTL_MS
      || (value.savedAt as number) > now + 60_000
      || !provider(value.provider) || !record(value.staged) || !record(value.searches)) {
      window.localStorage?.removeItem(key(archiveId));
      return null;
    }
    const allowed = new Set(pendingIds);
    const staged: Record<string, StagedCandidateMatch> = {};
    for (const [candidateId, item] of Object.entries(value.staged)) {
      const parsed = stagedMatch(item);
      if (allowed.has(candidateId) && parsed) staged[candidateId] = parsed;
    }
    const searches: Record<string, CandidateInlineSearch> = {};
    for (const [candidateId, item] of Object.entries(value.searches)) {
      const parsed = inlineSearch(item);
      if (allowed.has(candidateId) && parsed) searches[candidateId] = parsed;
    }
    const noteIntents: Record<string, boolean> = {};
    if (record(value.noteIntents)) {
      for (const [candidateId, enabled] of Object.entries(value.noteIntents)) {
        if (allowed.has(candidateId) && typeof enabled === 'boolean') {
          noteIntents[candidateId] = enabled;
        }
      }
    }
    const kindIntents: Record<string, PlaceKindIntent> = {};
    if (record(value.kindIntents)) {
      for (const [candidateId, item] of Object.entries(value.kindIntents)) {
        const parsed = kindIntent(item);
        if (allowed.has(candidateId) && parsed) kindIntents[candidateId] = parsed;
      }
    }
    return {
      version: 1,
      archiveId,
      savedAt: value.savedAt as number,
      provider: value.provider,
      staged,
      searches,
      noteIntents,
      kindIntents,
      suppressedAutoIds: Array.isArray(value.suppressedAutoIds)
        ? value.suppressedAutoIds.filter(
          (candidateId): candidateId is string =>
            typeof candidateId === 'string' && allowed.has(candidateId),
        )
        : [],
      includeOcr: typeof value.includeOcr === 'boolean' ? value.includeOcr : false,
      includeComments: typeof value.includeComments === 'boolean' ? value.includeComments : false,
      executionPreference: executionPreference(value.executionPreference)
        ? value.executionPreference
        : 'auto',
    };
  } catch {
    return null;
  }
}

export function savePlaceCandidateReviewCache(
  cache: Omit<PlaceCandidateReviewCache, 'version' | 'savedAt'>,
  now = Date.now(),
): void {
  try {
    window.localStorage?.setItem(key(cache.archiveId), JSON.stringify({
      ...cache,
      version: 1,
      savedAt: now,
    }));
  } catch {
    // Best-effort only; review remains usable without persistence.
  }
}

export function clearPlaceCandidateReviewCache(archiveId: string): void {
  try {
    window.localStorage?.removeItem(key(archiveId));
  } catch {
    // Best-effort cleanup only.
  }
}
