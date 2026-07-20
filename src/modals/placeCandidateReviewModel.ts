import type {
  DirectCandidateAttachment,
  PlaceCandidate,
} from '../services/WorkersAPIClient';

export type CandidateCorrection = {
  readonly name: string;
  readonly addressText: string;
};

const PROVIDER_ONLY_EVIDENCE = new Set(['maps_url', 'caption_llm']);

/**
 * Max non-hint pending candidates before the "Find more places with AI" CTA is
 * disabled (§7.1). Weak anchor hints are excluded — they're superseded when a
 * run completes, so they don't occupy review capacity.
 */
export const PLACE_EXTRACT_PENDING_CAP = 8;

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

export function isStaleCandidateError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { readonly code?: string }).code;
  return code === 'STALE_CANDIDATE' || code === 'CANDIDATE_NOT_PENDING';
}
