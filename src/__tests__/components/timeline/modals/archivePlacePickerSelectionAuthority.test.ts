import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginProviderSelection,
  completeProviderSelection,
} from '@/components/timeline/modals/archivePlacePickerSelectionAuthority';

describe('archive place picker selection authority', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps a maximum Google identity opaque and within the Worker idempotency limit', () => {
    // Given: the largest valid source archive, candidate, and Google Place IDs.
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const archiveId = 'a'.repeat(64);
    const candidateId = 'c'.repeat(128);
    const externalId = 'G'.repeat(255);

    // When: selection authority is created for that candidate.
    const authority = beginProviderSelection(archiveId, 'googlemaps', externalId, candidateId);

    // Then: the key is bounded and exposes no identity component.
    expect(authority.idempotencyKey).toBe('place-select:00000000-0000-4000-8000-000000000001');
    expect(authority.idempotencyKey.length).toBeLessThanOrEqual(200);
    expect(authority.idempotencyKey).not.toContain(archiveId);
    expect(authority.idempotencyKey).not.toContain(candidateId);
    expect(authority.idempotencyKey).not.toContain(externalId);
    expect(completeProviderSelection(archiveId, authority)).toBe(true);
  });

  it('preserves normal archive-place retry and success rotation semantics', () => {
    // Given: a normal archive-place selection with deterministic mutation identities.
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003');

    // When: the same result retries, succeeds, and is selected again.
    const first = beginProviderSelection('archive-normal', 'googlemaps', '123', null);
    const retry = beginProviderSelection('archive-normal', 'googlemaps', '123', null);
    const completed = completeProviderSelection('archive-normal', retry);
    const afterSuccess = beginProviderSelection('archive-normal', 'googlemaps', '123', null);

    // Then: normal-mode retry stability and post-success rotation remain unchanged.
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(completed).toBe(true);
    expect(afterSuccess.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(completeProviderSelection('archive-normal', afterSuccess)).toBe(true);
  });

  it('reuses candidate A authority after its response is lost', () => {
    // Given: candidate A selected one provider result before its response was lost.
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000004');
    const first = beginProviderSelection(
      'archive-candidate-a-retry', 'googlemaps', 'same-place', 'candidate-a',
    );

    // When: candidate A retries the identical provider result.
    const retry = beginProviderSelection(
      'archive-candidate-a-retry', 'googlemaps', 'same-place', 'candidate-a',
    );

    // Then: the lost-response replay keeps the original mutation identity.
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(completeProviderSelection('archive-candidate-a-retry', retry)).toBe(true);
  });

  it('isolates candidate B from abandoned candidate A on the same provider result', () => {
    // Given: candidate A selected a provider result and was then abandoned.
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000005')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000006');
    const candidateA = beginProviderSelection(
      'archive-candidate-switch', 'googlemaps', 'same-place', 'candidate-a',
    );

    // When: candidate B selects that same provider result in the same archive.
    const candidateB = beginProviderSelection(
      'archive-candidate-switch', 'googlemaps', 'same-place', 'candidate-b',
    );

    // Then: candidate B receives a distinct mutation identity instead of A's digest key.
    expect(candidateB.idempotencyKey).not.toBe(candidateA.idempotencyKey);
    expect(completeProviderSelection('archive-candidate-switch', candidateB)).toBe(true);
  });

  it('reuses candidate B authority for its own retry after candidate A is abandoned', () => {
    // Given: candidate B replaced candidate A as the active logical selection.
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000007')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000008');
    beginProviderSelection(
      'archive-candidate-b-retry', 'kakaomap', 'same-place', 'candidate-a',
    );
    const candidateB = beginProviderSelection(
      'archive-candidate-b-retry', 'kakaomap', 'same-place', 'candidate-b',
    );

    // When: candidate B retries the unchanged provider result.
    const candidateBRetry = beginProviderSelection(
      'archive-candidate-b-retry', 'kakaomap', 'same-place', 'candidate-b',
    );

    // Then: B reuses B's key, never A's key.
    expect(candidateBRetry.idempotencyKey).toBe(candidateB.idempotencyKey);
    expect(completeProviderSelection('archive-candidate-b-retry', candidateBRetry)).toBe(true);
  });

  it('rotates a candidate authority after successful completion', () => {
    // Given: candidate B successfully completed one provider selection.
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000009')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000010');
    const completed = beginProviderSelection(
      'archive-candidate-success', 'googlemaps', 'same-place', 'candidate-b',
    );
    expect(completeProviderSelection('archive-candidate-success', completed)).toBe(true);

    // When: candidate B begins a new action for the same provider result.
    const nextAction = beginProviderSelection(
      'archive-candidate-success', 'googlemaps', 'same-place', 'candidate-b',
    );

    // Then: success released the prior key.
    expect(nextAction.idempotencyKey).not.toBe(completed.idempotencyKey);
    expect(completeProviderSelection('archive-candidate-success', nextAction)).toBe(true);
  });
});
