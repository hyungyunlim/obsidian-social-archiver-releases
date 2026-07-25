import type {
  DirectCandidateAttachment,
  PlaceCandidate,
  ProviderSearchCandidate,
} from '../services/WorkersAPIClient';
import type { MapSearchProvider } from '../shared/platforms/map-search-provider';
import {
  inferPlaceKindFromProvider,
  inferPlaceKindFromText,
  type PlaceKind,
  type PlaceKindIntent,
} from '../shared/platforms/place-kinds';

export type CandidateCorrection = {
  readonly name: string;
  readonly addressText: string;
};

export type StagedDirectCandidate = {
  readonly kind: 'direct';
  readonly displayName: string;
  readonly displayAddress: string;
  readonly placeKindIntent?: PlaceKindIntent;
};

export type StagedProviderCandidate = {
  readonly kind: 'provider';
  readonly provider: MapSearchProvider;
  readonly externalId: string;
  readonly selectionToken: string;
  readonly query: string;
  readonly matchedAt: number;
  readonly displayName: string;
  readonly displayAddress: string;
  readonly placeKindIntent?: PlaceKindIntent;
};

export type StagedCandidateMatch = StagedDirectCandidate | StagedProviderCandidate;

export type CandidateInlineSearch = {
  readonly provider: MapSearchProvider;
  readonly query: string;
  readonly status: 'idle' | 'loading' | 'results' | 'empty' | 'error' | 'rate-limited';
  readonly results: readonly ProviderSearchCandidate[];
  readonly errorMessage?: string;
};

const PROVIDER_ONLY_EVIDENCE = new Set(['maps_url', 'caption_llm']);

/**
 * Max non-hint pending candidates before the "Find more places with AI" CTA is
 * disabled (§7.1). Weak anchor hints are excluded — they're superseded when a
 * run completes, so they don't occupy review capacity.
 */
export const PLACE_EXTRACT_PENDING_CAP = 20;

/**
 * A weak anchor hint carries no name/address/place id — it only signals "worth
 * looking here". Matches the banner's per-candidate hint test in PostCardRenderer.
 */
export function isWeakHintCandidate(candidate: PlaceCandidate): boolean {
  return !candidate.name && !candidate.addressText && !candidate.externalPlaceId;
}

/** Pending candidates that actually occupy review capacity (weak hints excluded). */
export function countNonHintPending(candidates: readonly PlaceCandidate[]): number {
  return candidates.reduce(
    (total, candidate) => (isWeakHintCandidate(candidate) ? total : total + 1),
    0,
  );
}

/**
 * English display label for a known candidate role (§7.3). Unknown values,
 * `null`, and `'other'` get no chip.
 */
export function placeCandidateRoleLabel(role: string | null | undefined): string | null {
  switch (role) {
    case 'visited': return 'Visited';
    case 'recommended': return 'Recommended';
    case 'venue': return 'Venue';
    case 'route_stop': return 'Stop';
    case 'mentioned': return 'Mentioned';
    case 'sponsor': return 'Sponsored';
    default: return null;
  }
}

export function orderPlaceCandidates(
  candidates: readonly PlaceCandidate[],
): readonly PlaceCandidate[] {
  return [...candidates]
    .filter((candidate) => candidate.state === 'pending')
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
}

export function canAttachCandidateDirectly(
  candidate: PlaceCandidate,
  correction?: CandidateCorrection,
): boolean {
  if (PROVIDER_ONLY_EVIDENCE.has(candidate.evidenceType)) return false;
  return (correction?.addressText ?? candidate.addressText ?? '').trim().length > 0;
}

export function buildDirectCandidateAttachment(
  candidate: PlaceCandidate,
  correction?: CandidateCorrection,
): DirectCandidateAttachment {
  if (!correction) return { candidateId: candidate.id };
  return {
    candidateId: candidate.id,
    ...(correction.name ? { name: correction.name } : {}),
    addressText: correction.addressText,
  };
}

export function candidateSearchQuery(candidate: PlaceCandidate): string {
  const nameAndCity = [candidate.name, candidate.cityHint].filter(Boolean).join(' ').trim();
  return nameAndCity || (candidate.addressText ?? '').trim();
}

export function providerCandidateName(candidate: ProviderSearchCandidate): string {
  return candidate.provider === 'googlemaps' ? candidate.displayName : candidate.name;
}

export function providerCandidateAddress(candidate: ProviderSearchCandidate): string {
  return candidate.provider === 'googlemaps'
    ? candidate.formattedAddress
    : candidate.roadAddress || candidate.address;
}

export function candidateDefaultPlaceKind(candidate: PlaceCandidate): PlaceKind | null {
  return candidate.suggestedPlaceKind
    ?? inferPlaceKindFromText([
      candidate.name,
      candidate.evidenceText,
      candidate.contextText,
    ].filter(Boolean).join(' '))?.placeKind
    ?? null;
}

export function stageDirectCandidate(
  candidate: PlaceCandidate,
  correction?: CandidateCorrection,
): StagedDirectCandidate {
  const placeKind = candidateDefaultPlaceKind(candidate);
  return {
    kind: 'direct',
    displayName: correction?.name || candidate.name || candidate.addressText || 'Detected place',
    displayAddress: correction?.addressText || candidate.addressText || '',
    ...(placeKind ? { placeKindIntent: { placeKind, mode: 'suggest' } } : {}),
  };
}

export function stageProviderCandidate(
  result: ProviderSearchCandidate,
  candidate: PlaceCandidate,
  query: string,
  matchedAt = Date.now(),
): StagedProviderCandidate {
  const providerKind = inferPlaceKindFromProvider(result.provider === 'googlemaps'
    ? {
      provider: result.provider,
      name: result.displayName,
      primaryType: result.primaryType,
    }
    : {
      provider: result.provider,
      name: result.name,
      categoryName: result.categoryName,
      categoryGroupCode: result.categoryGroupCode,
      categoryGroupName: result.categoryGroupName,
    })?.placeKind ?? null;
  const placeKind = providerKind ?? candidateDefaultPlaceKind(candidate);
  return {
    kind: 'provider',
    provider: result.provider,
    externalId: result.externalId,
    selectionToken: result.selectionToken,
    query,
    matchedAt,
    displayName: providerCandidateName(result),
    displayAddress: providerCandidateAddress(result),
    ...(placeKind ? { placeKindIntent: { placeKind, mode: 'suggest' } } : {}),
  };
}

export type PlaceSearchStopReason = 'rate' | 'credit';

export function placeSearchStopReason(error: unknown): PlaceSearchStopReason | null {
  const code = error instanceof Error
    ? (error as Error & { readonly code?: string }).code
    : undefined;
  if (code === 'RATE_LIMITED' || code === 'KAKAO_SEARCH_RATE_LIMITED') return 'rate';
  if (
    code === 'INSUFFICIENT_CLOUD_CREDITS'
    || code === 'INSUFFICIENT_CREDITS'
    || code === 'PAYWALL_REQUIRED'
    || code === 'GOOGLE_DAILY_LIMIT'
    || code === 'GOOGLE_MONTHLY_LIMIT'
    || code === 'GOOGLE_BURST_LIMIT'
    || code === 'GOOGLE_PROJECT_MONTHLY_LIMIT'
  ) return 'credit';
  return null;
}

export function isStaleCandidateError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { readonly code?: string }).code;
  return code === 'STALE_CANDIDATE' || code === 'CANDIDATE_NOT_PENDING';
}
