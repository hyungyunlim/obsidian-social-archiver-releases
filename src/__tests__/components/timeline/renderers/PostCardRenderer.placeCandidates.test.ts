import { describe, expect, it } from 'vitest';
import {
  applyPrimaryCandidateLocationFrontmatter,
  getNewlyAttachedPrimaryLocation,
} from '@/components/timeline/renderers/placeCandidateFrontmatterProjection';
import type {
  ArchiveLocation,
  PlaceCandidateAttachmentResult,
} from '@/services/WorkersAPIClient';

function location(overrides: Partial<ArchiveLocation> = {}): ArchiveLocation {
  return {
    id: 'primary-1', archiveId: 'archive-1', placeKey: 'kakaomap:101', name: 'Primary place',
    address: 'Seoul', latitude: 37.1, longitude: 126.9, source: 'kakaomap',
    externalId: '101', url: 'https://place.map.kakao.com/101', category: 'Cafe',
    isPrimary: true, sortOrder: 0, placeArchiveId: null, promotionStatus: 'metadata_only',
    createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

function result(
  outcomeLocation: ArchiveLocation,
  primary: ArchiveLocation,
): PlaceCandidateAttachmentResult {
  return {
    replayed: false,
    archiveId: 'archive-1',
    request: {
      idempotencyKey: 'candidate-attachment-key',
      requestDigest: `sha256:${'a'.repeat(64)}`,
      operation: 'attach_batch',
    },
    outcomes: [{
      candidateId: 'candidate-1', ordinal: 0, outcome: 'attached',
      locationId: outcomeLocation.id, canonicalLocation: outcomeLocation,
      candidateStatus: 'confirmed',
    }],
    activeLocations: outcomeLocation.id === primary.id
      ? [primary]
      : [primary, outcomeLocation],
    primaryLocationId: primary.id,
    remainingPendingCandidates: [],
    remainingPendingCount: 0,
    globalPendingCount: 0,
  };
}

describe('PostCardRenderer place-candidate frontmatter projection', () => {
  it('writes only a newly attached primary location and clears stale location projections', () => {
    // Given: the attachment outcome itself became the authoritative primary.
    const primary = location();
    const attachment = result(primary, primary);
    const frontmatter: Record<string, unknown> = {
      title: 'Keep me',
      location: 'Old place',
      locations: [{ id: 'old-secondary' }],
      locationCount: 2,
    };

    // When: PostCardRenderer projects the attachment into this note.
    const newlyAttachedPrimary = getNewlyAttachedPrimaryLocation(attachment);
    expect(newlyAttachedPrimary).toEqual(primary);
    if (newlyAttachedPrimary) {
      applyPrimaryCandidateLocationFrontmatter(frontmatter, newlyAttachedPrimary);
    }

    // Then: only primary scalar fields are stored; unrelated frontmatter survives.
    expect(frontmatter).toEqual({
      title: 'Keep me', location: 'Primary place', latitude: 37.1, longitude: 126.9,
      coordinates: '37.1, 126.9', locationSource: 'kakaomap', locationExternalId: '101',
      locationAddress: 'Seoul', locationUrl: 'https://place.map.kakao.com/101',
      locationCategory: 'Cafe',
    });
  });

  it('does not project when the candidate attached only as a secondary location', () => {
    // Given: another location remains primary after the candidate attachment.
    const primary = location();
    const secondary = location({
      id: 'secondary-1', placeKey: 'metadata:secondary', name: 'Secondary place',
      source: null, externalId: null, isPrimary: false, sortOrder: 1,
    });
    const frontmatter = { location: 'Primary place', marker: 'untouched' };

    // When/Then: the projection returns no write target and the note stays byte-logically unchanged.
    expect(getNewlyAttachedPrimaryLocation(result(secondary, primary))).toBeNull();
    expect(frontmatter).toEqual({ location: 'Primary place', marker: 'untouched' });
  });

  it('removes stale optional primary metadata when the new primary has no provider or coordinates', () => {
    const primary = location({
      placeKey: 'metadata:manual', name: 'Manual place', address: null,
      latitude: null, longitude: null, source: null, externalId: null, url: null, category: null,
    });
    const frontmatter: Record<string, unknown> = {
      latitude: 1, longitude: 2, coordinates: '1, 2', locationSource: 'old',
      locationExternalId: 'old-id', locationAddress: 'old address', locationUrl: 'old-url',
      locationCategory: 'old category',
    };

    applyPrimaryCandidateLocationFrontmatter(frontmatter, primary);

    expect(frontmatter).toEqual({ location: 'Manual place' });
  });
});
