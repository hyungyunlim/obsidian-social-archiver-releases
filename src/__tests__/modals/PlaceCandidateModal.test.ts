import { type App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlaceCandidateModal,
  type CandidatePlacePickerRequest,
  type PlaceCandidateModalOptions,
} from '@/modals/PlaceCandidateModal';
import { showConfirmModal } from '@/utils/confirm-modal';
import type {
  ArchiveLocation,
  PlaceCandidate,
  PlaceCandidateAttachmentResult,
} from '@/services/WorkersAPIClient';

const confirmState = vi.hoisted(() => ({ confirmed: true }));

vi.mock('@/utils/confirm-modal', () => ({
  showConfirmModal: vi.fn(async () => confirmState.confirmed),
}));

function candidate(
  id: string,
  ordinal: number,
  overrides: Partial<PlaceCandidate> = {},
): PlaceCandidate {
  return {
    id,
    archiveId: 'archive-1',
    name: `Place ${id}`,
    addressText: `Address ${id}`,
    cityHint: null,
    evidenceType: 'jsonld',
    evidenceText: `Evidence for ${id}`,
    confidenceBucket: 'high',
    score: 0.9,
    latitude: null,
    longitude: null,
    externalSource: null,
    externalPlaceId: null,
    state: 'pending',
    ordinal,
    resolvedLocationId: null,
    createdAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

function location(overrides: Partial<ArchiveLocation> = {}): ArchiveLocation {
  return {
    id: 'location-1', archiveId: 'archive-1', placeKey: 'metadata:place',
    name: 'Existing primary', address: 'Seoul', latitude: null, longitude: null,
    source: null, externalId: null, url: null, category: null, isPrimary: true,
    sortOrder: 0, placeArchiveId: null, promotionStatus: 'metadata_only',
    createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

function result(
  resolved: readonly PlaceCandidate[],
  remaining: readonly PlaceCandidate[],
  operation: PlaceCandidateAttachmentResult['request']['operation'] = 'attach_batch',
): PlaceCandidateAttachmentResult {
  const attached = location({ id: 'location-secondary', isPrimary: false, sortOrder: 1 });
  return {
    replayed: false,
    archiveId: 'archive-1',
    request: {
      idempotencyKey: 'idempotency-key',
      requestDigest: `sha256:${'a'.repeat(64)}`,
      operation,
    },
    outcomes: resolved.map((item) => ({
      candidateId: item.id,
      ordinal: item.ordinal,
      outcome: 'attached',
      locationId: attached.id,
      canonicalLocation: attached,
      candidateStatus: 'confirmed',
    })),
    activeLocations: [location(), attached],
    primaryLocationId: 'location-1',
    remainingPendingCandidates: remaining,
    remainingPendingCount: remaining.length,
    globalPendingCount: remaining.length,
  };
}

function openModal(overrides: Partial<PlaceCandidateModalOptions> = {}): {
  readonly modal: PlaceCandidateModal;
  readonly options: PlaceCandidateModalOptions;
} {
  const rows = [candidate('candidate-3', 2), candidate('candidate-1', 0), candidate('candidate-2', 1)];
  const options: PlaceCandidateModalOptions = {
    candidates: rows,
    currentLocations: [location()],
    attachBatch: vi.fn(async (body) => result(
      rows.filter((item) => body.candidates.some((selected) => selected.candidateId === item.id)),
      rows.filter((item) => !body.candidates.some((selected) => selected.candidateId === item.id)),
    )),
    rejectCandidate: vi.fn(async () => undefined),
    refetchCandidates: vi.fn(async () => rows),
    openPlacePicker: vi.fn(),
    onReconciled: vi.fn(async () => undefined),
    onCandidatesChanged: vi.fn(async () => undefined),
    ...overrides,
  };
  const modal = new PlaceCandidateModal({} as App, options);
  modal.open();
  return { modal, options };
}

function rowIds(modal: PlaceCandidateModal): string[] {
  return [...modal.contentEl.querySelectorAll<HTMLElement>('[data-candidate-id]')]
    .map((row) => row.dataset.candidateId ?? '');
}

function click(modal: PlaceCandidateModal, selector: string): void {
  const button = modal.contentEl.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new TypeError(`Missing button ${selector}`);
  button.click();
}

describe('PlaceCandidateModal independent multi-review', () => {
  beforeEach(() => {
    confirmState.confirmed = true;
    vi.mocked(showConfirmModal).mockClear();
  });

  it('submits selected direct rows in ordinal order and keeps pending siblings open', async () => {
    // Given: transport order 3,1,2 and the user selects 3 before 1.
    const { modal, options } = openModal();
    expect(rowIds(modal)).toEqual(['candidate-1', 'candidate-2', 'candidate-3']);
    click(modal, '[data-select-candidate="candidate-3"]');
    click(modal, '[data-select-candidate="candidate-1"]');

    // When: the atomic batch is added.
    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(options.attachBatch).toHaveBeenCalledTimes(1));

    // Then: the payload is ordinal, only returned rows leave, and the modal stays mounted.
    const body = vi.mocked(options.attachBatch).mock.calls[0]?.[0];
    expect(body?.candidates).toEqual([
      { candidateId: 'candidate-1' },
      { candidateId: 'candidate-3' },
    ]);
    await vi.waitFor(() => expect(rowIds(modal)).toEqual(['candidate-2']));
    expect(document.body.contains(modal.modalEl)).toBe(true);
    expect(modal.contentEl.textContent).toContain('1 place remains');
    expect(options.onReconciled).toHaveBeenCalledTimes(1);
  });

  it('uses an associated label as the direct-selection touch target', () => {
    const { modal } = openModal({ candidates: [candidate('candidate-1', 0)] });
    const checkbox = modal.contentEl.querySelector<HTMLInputElement>(
      '[data-select-candidate="candidate-1"]',
    );
    const label = checkbox?.closest<HTMLLabelElement>('.sa-place-candidate-select');
    expect(label).not.toBeNull();
    expect(checkbox?.labels).toContain(label);
  });

  it('keeps manual corrections scoped to their candidate', async () => {
    // Given: one address-less deterministic row beside a fully eligible sibling.
    const incomplete = candidate('candidate-1', 0, { addressText: null, name: 'Original name' });
    const sibling = candidate('candidate-2', 1);
    const attachBatch = vi.fn(async () => result([incomplete], [sibling]));
    const { modal } = openModal({ candidates: [incomplete, sibling], attachBatch });
    click(modal, '[data-edit-candidate="candidate-1"]');
    const name = modal.contentEl.querySelector<HTMLInputElement>('[data-correction-name="candidate-1"]');
    const address = modal.contentEl.querySelector<HTMLInputElement>('[data-correction-address="candidate-1"]');
    if (!name || !address) throw new TypeError('Missing correction fields');
    name.value = 'Corrected place';
    address.value = 'Corrected address';

    // When: only candidate 1 is saved, selected, and submitted.
    click(modal, '[data-save-candidate="candidate-1"]');
    click(modal, '[data-select-candidate="candidate-1"]');
    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(attachBatch).toHaveBeenCalledTimes(1));

    // Then: candidate 1 owns both overrides and candidate 2 is absent from the payload.
    expect(attachBatch.mock.calls[0]?.[0].candidates).toEqual([{
      candidateId: 'candidate-1', name: 'Corrected place', addressText: 'Corrected address',
    }]);
  });

  it('returns provider focus after the nested modal applies its late close fallback', async () => {
    // Given: two ambiguous map rows.
    const first = candidate('candidate-1', 0, { evidenceType: 'maps_url' });
    const second = candidate('candidate-2', 1, { evidenceType: 'maps_url' });
    const openPlacePicker = vi.fn<(request: CandidatePlacePickerRequest) => void>();
    const { modal } = openModal({ candidates: [first, second], openPlacePicker });

    // When: candidate 2 opens provider search and the nested picker closes without a selection.
    click(modal, '[data-provider-candidate="candidate-2"]');
    const providerRequest = openPlacePicker.mock.calls[0]?.[0];
    providerRequest?.onClosed();
    const closeFallback = document.createElement('button');
    document.body.append(closeFallback);
    closeFallback.focus();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    // Then: the request and settled focus remain candidate 2 scoped.
    expect(providerRequest?.candidate.id).toBe('candidate-2');
    expect(providerRequest?.initialView).toBe('search');
    expect(document.activeElement?.getAttribute('data-provider-candidate')).toBe('candidate-2');
    closeFallback.remove();
  });

  it('returns existing-place focus after the nested modal applies its late close fallback', async () => {
    // Given: an ambiguous row opens its Existing picker.
    const first = candidate('candidate-1', 0, { evidenceType: 'maps_url' });
    const openPlacePicker = vi.fn<(request: CandidatePlacePickerRequest) => void>();
    const { modal } = openModal({ candidates: [first], openPlacePicker });

    // When: the nested picker closes and Obsidian applies its own focus fallback afterward.
    click(modal, '[data-existing-candidate="candidate-1"]');
    const existingRequest = openPlacePicker.mock.calls[0]?.[0];
    existingRequest?.onClosed();
    const closeFallback = document.createElement('button');
    document.body.append(closeFallback);
    closeFallback.focus();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    // Then: settled focus returns to the originating existing-place action.
    expect(existingRequest).toMatchObject({
      candidate: { id: 'candidate-1' }, initialView: 'existing',
    });
    expect(document.activeElement?.getAttribute('data-existing-candidate')).toBe('candidate-1');
    closeFallback.remove();
  });

  it('reuses one direct-batch key when a lost response is replayed', async () => {
    // Given: the first response is lost after the server commits the selected candidate.
    const selected = candidate('candidate-1', 0);
    const attachBatch = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockImplementationOnce(async (body) => ({
        ...result([selected], []),
        replayed: true,
        request: { ...result([selected], []).request, idempotencyKey: body.idempotencyKey },
      }));
    const { modal } = openModal({ candidates: [selected], attachBatch });
    click(modal, '[data-select-candidate="candidate-1"]');

    // When: the user retries the unchanged logical intent.
    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(attachBatch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(
      modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-candidate-add-selected')?.disabled,
    ).toBe(false));
    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(attachBatch).toHaveBeenCalledTimes(2));

    // Then: replay reaches the server with the original idempotency identity.
    expect(attachBatch.mock.calls[1]?.[0].idempotencyKey)
      .toBe(attachBatch.mock.calls[0]?.[0].idempotencyKey);
  });

  it('rotates the direct-batch key when the selected logical intent changes', async () => {
    // Given: candidate 1 fails recoverably while candidate 2 remains available.
    const first = candidate('candidate-1', 0);
    const second = candidate('candidate-2', 1);
    const attachBatch = vi.fn(async (): Promise<PlaceCandidateAttachmentResult> => {
      throw new Error('retryable');
    });
    const { modal } = openModal({ candidates: [first, second], attachBatch });
    click(modal, '[data-select-candidate="candidate-1"]');
    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(attachBatch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(
      modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-candidate-add-selected')?.disabled,
    ).toBe(false));

    // When: selection changes before the next attempt.
    click(modal, '[data-select-candidate="candidate-1"]');
    click(modal, '[data-select-candidate="candidate-2"]');
    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(attachBatch).toHaveBeenCalledTimes(2));

    // Then: the distinct intent receives a distinct mutation identity.
    expect(attachBatch.mock.calls[1]?.[0].idempotencyKey)
      .not.toBe(attachBatch.mock.calls[0]?.[0].idempotencyKey);
  });

  it('rotates the direct-batch key for a new action after success', async () => {
    // Given: two candidates that are attached in separate successful actions.
    const first = candidate('candidate-1', 0);
    const second = candidate('candidate-2', 1);
    const attachBatch = vi.fn(async (body: Parameters<PlaceCandidateModalOptions['attachBatch']>[0]) => {
      const selectedId = body.candidates[0]?.candidateId;
      return result(
        selectedId === first.id ? [first] : [second],
        selectedId === first.id ? [second] : [],
      );
    });
    const { modal } = openModal({ candidates: [first, second], attachBatch });

    // When: candidate 1 succeeds, then candidate 2 starts a new action.
    click(modal, '[data-select-candidate="candidate-1"]');
    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(rowIds(modal)).toEqual(['candidate-2']));
    click(modal, '[data-select-candidate="candidate-2"]');
    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(attachBatch).toHaveBeenCalledTimes(2));

    // Then: completing the first intent releases its mutation identity.
    expect(attachBatch.mock.calls[1]?.[0].idempotencyKey)
      .not.toBe(attachBatch.mock.calls[0]?.[0].idempotencyKey);
  });

  it('refetches canonical rows on a stale batch without optimistic loss', async () => {
    // Given: a 409 stale response and newer server truth.
    const stale = Object.assign(new Error('stale'), { code: 'STALE_CANDIDATE', status: 409 });
    const attachBatch = vi.fn(async (): Promise<PlaceCandidateAttachmentResult> => { throw stale; });
    const current = candidate('candidate-4', 3);
    const refetchCandidates = vi.fn(async () => [current]);
    const { modal } = openModal({
      candidates: [candidate('candidate-1', 0)], attachBatch, refetchCandidates,
    });
    click(modal, '[data-select-candidate="candidate-1"]');

    // When: Add selected encounters the stale conflict.
    click(modal, '.sa-place-candidate-add-selected');

    // Then: server truth replaces the review rows and stale recovery is announced.
    await vi.waitFor(() => expect(refetchCandidates).toHaveBeenCalledTimes(1));
    expect(rowIds(modal)).toEqual(['candidate-4']);
    expect(modal.contentEl.querySelector('[aria-live="polite"]')?.textContent).toContain('changed');
  });

  it('dismisses one row independently and keeps the remaining review open', async () => {
    // Given: two pending rows.
    const rejectCandidate = vi.fn(async () => undefined);
    const { modal } = openModal({
      candidates: [candidate('candidate-1', 0), candidate('candidate-2', 1)], rejectCandidate,
    });

    // When: candidate 1 is dismissed.
    click(modal, '[data-dismiss-candidate="candidate-1"]');

    // Then: only candidate 1 is rejected and candidate 2 remains visible.
    await vi.waitFor(() => {
      expect(rejectCandidate).toHaveBeenCalledWith('candidate-1');
      expect(rowIds(modal)).toEqual(['candidate-2']);
    });
    expect(document.body.contains(modal.modalEl)).toBe(true);
  });

  it('requires confirmation before dismissing every remaining row', async () => {
    // Given: two pending rows and a declined confirmation.
    confirmState.confirmed = false;
    const rejectCandidate = vi.fn(async () => undefined);
    const { modal } = openModal({
      candidates: [candidate('candidate-1', 0), candidate('candidate-2', 1)], rejectCandidate,
    });

    // When: Dismiss all is declined, then accepted.
    click(modal, '.sa-place-candidate-dismiss-all');
    await vi.waitFor(() => expect(showConfirmModal).toHaveBeenCalledTimes(1));
    expect(rejectCandidate).not.toHaveBeenCalled();
    confirmState.confirmed = true;
    click(modal, '.sa-place-candidate-dismiss-all');

    // Then: both independent rejection mutations run only after consent.
    await vi.waitFor(() => expect(rejectCandidate).toHaveBeenCalledTimes(2));
    expect(rowIds(modal)).toEqual([]);
    expect(modal.contentEl.textContent).toContain('All place candidates are reviewed');
  });
});

// ---------------------------------------------------------------------------
// Places P3b — "Find places with AI" CTA + role chip
// ---------------------------------------------------------------------------

/** A weak anchor hint carries no name/address/place id. */
function hint(id: string, ordinal: number): PlaceCandidate {
  return candidate(id, ordinal, {
    name: null, addressText: null, externalPlaceId: null, evidenceType: 'anchor',
  });
}

function extractButton(modal: PlaceCandidateModal): HTMLButtonElement | null {
  return modal.contentEl.querySelector<HTMLButtonElement>('[data-extract-cta]');
}

describe('PlaceCandidateModal — AI place extraction CTA', () => {
  beforeEach(() => {
    confirmState.confirmed = true;
    vi.mocked(showConfirmModal).mockClear();
  });

  it('hides the CTA when no extractor is wired', () => {
    const { modal } = openModal();
    expect(extractButton(modal)).toBeNull();
  });

  it('renders the footer CTA when an extractor is wired', () => {
    const { modal } = openModal({ onExtract: vi.fn() });
    const button = extractButton(modal);
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe('Find more places with AI');
    expect(button!.disabled).toBe(false);
  });

  it('renders the empty-state CTA when there are no candidates', () => {
    const { modal } = openModal({ candidates: [], onExtract: vi.fn() });
    const button = extractButton(modal);
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe('Find places with AI');
    expect(modal.contentEl.textContent).toContain('No place suggestions yet');
  });

  it('disables the CTA at capacity (>= 8 non-hint pending) with a hint', () => {
    const rows = Array.from({ length: 8 }, (_, i) => candidate(`c-${i}`, i));
    const { modal } = openModal({ candidates: rows, onExtract: vi.fn() });
    const button = extractButton(modal)!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Review pending suggestions first');
  });

  it('excludes weak hints from the capacity count', () => {
    const rows = Array.from({ length: 8 }, (_, i) => hint(`h-${i}`, i));
    const { modal } = openModal({ candidates: rows, onExtract: vi.fn() });
    expect(extractButton(modal)!.disabled).toBe(false);
  });

  it('shows a spinner label and folds in the extracted candidates', async () => {
    const fresh = [candidate('new-1', 0, { evidenceType: 'caption_llm' })];
    let capturedSignal: unknown;
    const onExtract = vi.fn(async (signal: AbortSignal) => {
      capturedSignal = signal;
      return { candidates: fresh, message: 'Analysis complete.' };
    });
    const { modal } = openModal({ candidates: [], onExtract });

    extractButton(modal)!.click();

    // Spinner label appears while the extractor promise is pending.
    await vi.waitFor(() =>
      expect(modal.contentEl.textContent).toContain('Analyzing for places…'));
    expect(onExtract).toHaveBeenCalledTimes(1);
    // The AbortSignal is passed so the caller can stop polling on close.
    expect(capturedSignal).toBeInstanceOf(AbortSignal);

    await vi.waitFor(() => expect(rowIds(modal)).toEqual(['new-1']));
  });

  it('injects out-of-band (WS) refreshed candidates via applyExtractionResult', () => {
    const { modal } = openModal({ candidates: [], onExtract: vi.fn() });
    modal.applyExtractionResult([candidate('ws-1', 0, { evidenceType: 'caption_llm' })]);
    expect(rowIds(modal)).toEqual(['ws-1']);
  });

  it('renders a role chip for a known role and omits it for other/null', () => {
    const { modal } = openModal({
      candidates: [
        candidate('with-role', 0, { role: 'recommended' }),
        candidate('other-role', 1, { role: 'other' }),
        candidate('no-role', 2, { role: null }),
      ],
      onExtract: vi.fn(),
    });
    const chips = [...modal.contentEl.querySelectorAll('.sa-place-candidate-role')]
      .map((chip) => chip.textContent);
    expect(chips).toEqual(['Recommended']);
  });
});
