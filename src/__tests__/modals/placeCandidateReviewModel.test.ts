import { describe, expect, it } from 'vitest';
import type { PlaceCandidate } from '@/services/WorkersAPIClient';
import {
  countNonHintPending,
  isWeakHintCandidate,
  placeCandidateRoleLabel,
  PLACE_EXTRACT_PENDING_CAP,
} from '@/modals/placeCandidateReviewModel';

function candidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    id: 'cand-1',
    archiveId: 'archive-1',
    name: 'Place',
    addressText: 'Seoul',
    cityHint: null,
    evidenceType: 'jsonld',
    evidenceText: 'evidence',
    confidenceBucket: 'high',
    score: 0.8,
    latitude: null,
    longitude: null,
    externalSource: null,
    externalPlaceId: null,
    state: 'pending',
    ordinal: 0,
    resolvedLocationId: null,
    createdAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('isWeakHintCandidate', () => {
  it('is a hint only when it has no name, address, or place id', () => {
    expect(isWeakHintCandidate(
      candidate({ name: null, addressText: null, externalPlaceId: null }),
    )).toBe(true);
  });

  it('is not a hint when any identity signal is present', () => {
    expect(isWeakHintCandidate(candidate({ name: 'A', addressText: null }))).toBe(false);
    expect(isWeakHintCandidate(candidate({ name: null, addressText: 'X' }))).toBe(false);
    expect(isWeakHintCandidate(
      candidate({ name: null, addressText: null, externalPlaceId: 'p1' }),
    )).toBe(false);
  });
});

describe('countNonHintPending', () => {
  it('counts only non-hint candidates', () => {
    const rows = [
      candidate({ id: 'a' }),
      candidate({ id: 'b' }),
      candidate({ id: 'h', name: null, addressText: null, externalPlaceId: null }),
    ];
    expect(countNonHintPending(rows)).toBe(2);
  });

  it('caps the CTA at eight non-hint pending', () => {
    const rows = Array.from({ length: PLACE_EXTRACT_PENDING_CAP }, (_, i) =>
      candidate({ id: `n-${i}` }));
    expect(countNonHintPending(rows)).toBe(PLACE_EXTRACT_PENDING_CAP);
  });
});

describe('placeCandidateRoleLabel', () => {
  it('maps known roles to English labels', () => {
    expect(placeCandidateRoleLabel('visited')).toBe('Visited');
    expect(placeCandidateRoleLabel('recommended')).toBe('Recommended');
    expect(placeCandidateRoleLabel('venue')).toBe('Venue');
    expect(placeCandidateRoleLabel('route_stop')).toBe('Stop');
    expect(placeCandidateRoleLabel('mentioned')).toBe('Mentioned');
    expect(placeCandidateRoleLabel('sponsor')).toBe('Sponsored');
  });

  it('returns null for other/null/undefined/unknown', () => {
    expect(placeCandidateRoleLabel('other')).toBeNull();
    expect(placeCandidateRoleLabel(null)).toBeNull();
    expect(placeCandidateRoleLabel(undefined)).toBeNull();
    expect(placeCandidateRoleLabel('future_role')).toBeNull();
  });
});
