import { type App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlaceCandidateModal,
  type PlaceCandidateModalOptions,
} from '@/modals/PlaceCandidateModal';
import {
  clearPlaceCandidateReviewCache,
  savePlaceCandidateReviewCache,
} from '@/modals/placeCandidateReviewCache';
import { showConfirmModal } from '@/utils/confirm-modal';
import type {
  ArchiveLocation,
  PlaceCandidate,
  PlaceCandidateAttachmentResult,
  ProviderSearchCandidate,
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
    id: 'location-1',
    archiveId: 'archive-1',
    placeKey: 'metadata:place',
    name: 'Existing primary',
    address: 'Seoul',
    latitude: null,
    longitude: null,
    source: null,
    externalId: null,
    url: null,
    category: null,
    isPrimary: true,
    sortOrder: 0,
    placeArchiveId: null,
    promotionStatus: 'metadata_only',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

function kakaoResult(
  externalId: string,
  name = `Map ${externalId}`,
  address = `Road ${externalId}`,
): ProviderSearchCandidate {
  return {
    provider: 'kakaomap',
    externalId,
    name,
    categoryName: '음식점 > 한식',
    categoryGroupCode: 'FD6',
    categoryGroupName: '음식점',
    address,
    roadAddress: address,
    latitude: 37.5,
    longitude: 127,
    phone: '',
    placeUrl: `https://place.map.kakao.com/${externalId}`,
    selectionToken: `selection-${externalId}`,
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
    outcomes: resolved.map(item => ({
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
  const rows = overrides.candidates ?? [
    candidate('candidate-3', 2),
    candidate('candidate-1', 0),
    candidate('candidate-2', 1),
  ];
  const options: PlaceCandidateModalOptions = {
    archiveId: 'archive-1',
    hostLocale: 'ko',
    candidates: rows,
    currentLocations: [location()],
    attachBatch: vi.fn(async body => {
      const ids = new Set(body.candidates.map(item => item.candidateId));
      return result(rows.filter(item => ids.has(item.id)), rows.filter(item => !ids.has(item.id)));
    }),
    attachProvider: vi.fn(async candidateId => {
      const resolved = rows.filter(item => item.id === candidateId);
      return result(resolved, rows.filter(item => item.id !== candidateId), 'attach_provider');
    }),
    searchProvider: vi.fn(async request => ({
      provider: request.provider,
      query: request.query,
      results: [],
      nextCursor: null,
    })),
    loadProviderRuntime: vi.fn(async () => ({
      preference: 'auto',
      availability: { kakaomap: true, googlemaps: true },
    })),
    rejectCandidate: vi.fn(async () => undefined),
    refetchCandidates: vi.fn(async () => rows),
    openPlacePicker: vi.fn(),
    onReconciled: vi.fn(async () => undefined),
    onBackgroundCommitted: vi.fn(async () => []),
    onCandidatesChanged: vi.fn(async () => undefined),
    ...overrides,
  };
  const modal = new PlaceCandidateModal({} as App, options);
  modal.open();
  return { modal, options };
}

function rowIds(modal: PlaceCandidateModal): string[] {
  return [...modal.contentEl.querySelectorAll<HTMLElement>('[data-candidate-id]')]
    .map(row => row.dataset.candidateId ?? '');
}

function click(modal: PlaceCandidateModal, selector: string): void {
  const button = modal.contentEl.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new TypeError(`Missing button ${selector}`);
  button.click();
}

async function waitForReady(modal: PlaceCandidateModal, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(modal.contentEl.querySelectorAll('.sa-place-candidate-card.is-selected')).toHaveLength(count);
  });
}

describe('PlaceCandidateModal automatic place review', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    });
    confirmState.confirmed = true;
    vi.mocked(showConfirmModal).mockClear();
    clearPlaceCandidateReviewCache('archive-1');
  });

  it('auto-stages direct candidates and reveals note/type controls only for matched rows', async () => {
    const first = candidate('first', 0, {
      contextScope: 'candidate',
      contextText: 'Try the lunch menu before noon.',
      role: 'recommended',
      suggestedPlaceKind: 'restaurant',
    });
    const { modal, options } = openModal({ candidates: [first] });

    await waitForReady(modal, 1);
    expect(options.searchProvider).not.toHaveBeenCalled();
    expect(modal.contentEl.textContent).toContain('Try the lunch menu before noon.');
    expect(modal.contentEl.querySelector<HTMLSelectElement>(
      '.sa-place-candidate-kind select',
    )?.value).toBe('restaurant');
    expect(modal.contentEl.querySelector('.sa-place-candidate-add-selected')?.textContent)
      .toBe('Save 1 place and notes');

    click(modal, '.sa-place-candidate-cancel-match');
    expect(modal.contentEl.textContent).not.toContain('Save this as a place note');
    expect(modal.contentEl.querySelector('.sa-place-candidate-kind')).toBeNull();
    expect(modal.contentEl.querySelector('.sa-place-candidate-inline-search')).not.toBeNull();
  });

  it('searches ambiguous AI candidates and auto-selects the first provider result', async () => {
    const ambiguous = candidate('ambiguous', 0, {
      addressText: null,
      cityHint: '서울 중구',
      evidenceType: 'caption_llm',
    });
    const first = kakaoResult('100', 'First exact match');
    const second = kakaoResult('200', 'Second match');
    const searchProvider = vi.fn(async request => ({
      provider: request.provider,
      query: request.query,
      results: [first, second],
      nextCursor: null,
    }));
    const { modal } = openModal({ candidates: [ambiguous], searchProvider });

    await waitForReady(modal, 1);
    expect(searchProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'kakaomap',
      query: 'Place ambiguous 서울 중구',
      candidateContext: { archiveId: 'archive-1', candidateId: 'ambiguous' },
    }));
    expect(modal.contentEl.textContent).toContain('First exact match');
  });

  it('lets a cancelled auto-match be replaced through inline search', async () => {
    const ambiguous = candidate('ambiguous', 0, {
      addressText: null,
      evidenceType: 'caption_llm',
    });
    const automatic = kakaoResult('100', 'Automatic');
    const replacement = kakaoResult('200', 'Replacement');
    const searchProvider = vi.fn()
      .mockResolvedValueOnce({
        provider: 'kakaomap',
        query: 'Place ambiguous',
        results: [automatic],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        provider: 'kakaomap',
        query: 'replacement query',
        results: [replacement],
        nextCursor: null,
      });
    const { modal } = openModal({ candidates: [ambiguous], searchProvider });
    await waitForReady(modal, 1);

    click(modal, '.sa-place-candidate-cancel-match');
    const input = modal.contentEl.querySelector<HTMLInputElement>(
      '.sa-place-candidate-inline-search input',
    );
    if (!input) throw new TypeError('Missing inline search input');
    input.value = 'replacement query';
    input.closest('form')?.dispatchEvent(new Event('submit'));
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Replacement'));
    click(modal, '.sa-place-candidate-search-result');

    await waitForReady(modal, 1);
    expect(modal.contentEl.textContent).toContain('Replacement');
    expect(modal.contentEl.textContent).not.toContain('Automatic');
  });

  it('restores an explicit cancellation without repeating automatic search', async () => {
    const ambiguous = candidate('ambiguous', 0, {
      addressText: null,
      evidenceType: 'caption_llm',
    });
    const searchProvider = vi.fn(async request => ({
      provider: request.provider,
      query: request.query,
      results: [kakaoResult('100')],
      nextCursor: null,
    }));
    const first = openModal({ candidates: [ambiguous], searchProvider }).modal;
    await waitForReady(first, 1);
    click(first, '.sa-place-candidate-cancel-match');
    first.close();

    const second = openModal({ candidates: [ambiguous], searchProvider }).modal;
    await vi.waitFor(() => expect(second.contentEl.textContent).toContain('No exact matches yet'));
    expect(searchProvider).toHaveBeenCalledTimes(1);
    expect(second.contentEl.querySelectorAll('.sa-place-candidate-card.is-selected')).toHaveLength(0);
    expect(second.contentEl.querySelector('.sa-place-candidate-inline-search')).not.toBeNull();
  });

  it('auto-stages a corrected direct address without a second selection step', async () => {
    const incomplete = candidate('incomplete', 0, {
      name: 'Original',
      addressText: null,
      evidenceType: 'jsonld',
    });
    const { modal, options } = openModal({ candidates: [incomplete] });
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-candidate-inline-search')).not.toBeNull());
    click(modal, '[data-edit-candidate="incomplete"]');
    const name = modal.contentEl.querySelector<HTMLInputElement>('[data-correction-name="incomplete"]');
    const address = modal.contentEl.querySelector<HTMLInputElement>('[data-correction-address="incomplete"]');
    if (!name || !address) throw new TypeError('Missing correction fields');
    name.value = 'Corrected';
    address.value = 'Corrected address';
    click(modal, '[data-save-candidate="incomplete"]');
    await waitForReady(modal, 1);
    await vi.waitFor(() => expect(
      modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-candidate-add-selected')?.disabled,
    ).toBe(false));

    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(options.attachBatch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(options.attachBatch).mock.calls[0]?.[0].candidates).toEqual([{
      candidateId: 'incomplete',
      name: 'Corrected',
      addressText: 'Corrected address',
    }]);
  });

  it('chunks direct background writes by eight and closes immediately', async () => {
    const rows = Array.from({ length: 18 }, (_, index) => candidate(`c-${index}`, index));
    const attachBatch = vi.fn(async body => {
      const ids = new Set(body.candidates.map(item => item.candidateId));
      return result(rows.filter(item => ids.has(item.id)), rows.filter(item => !ids.has(item.id)));
    });
    const onBackgroundCommitted = vi.fn(async () => []);
    const { modal } = openModal({ candidates: rows, attachBatch, onBackgroundCommitted });
    await waitForReady(modal, 18);

    click(modal, '.sa-place-candidate-add-selected');
    expect(document.body.contains(modal.modalEl)).toBe(false);
    await vi.waitFor(() => expect(attachBatch).toHaveBeenCalledTimes(3));
    expect(attachBatch.mock.calls.map(call => call[0].candidates.length)).toEqual([8, 8, 2]);
    await vi.waitFor(() => expect(onBackgroundCommitted).toHaveBeenCalledTimes(1));
  });

  it('limits provider attachment concurrency to six', async () => {
    const rows = Array.from({ length: 13 }, (_, index) => candidate(`p-${index}`, index, {
      addressText: null,
      evidenceType: 'caption_llm',
    }));
    const searchProvider = vi.fn(async request => ({
      provider: request.provider,
      query: request.query,
      results: [kakaoResult(String(Number(request.candidateContext?.candidateId.split('-')[1]) + 100))],
      nextCursor: null,
    }));
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const attachProvider = vi.fn(async candidateId => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active -= 1;
      const resolved = rows.filter(item => item.id === candidateId);
      return result(resolved, rows.filter(item => item.id !== candidateId), 'attach_provider');
    });
    const { modal } = openModal({ candidates: rows, searchProvider, attachProvider });
    await waitForReady(modal, 13);

    click(modal, '.sa-place-candidate-add-selected');
    await vi.waitFor(() => expect(attachProvider).toHaveBeenCalledTimes(6));
    expect(maximum).toBe(6);
    while (releases.length > 0 || vi.mocked(attachProvider).mock.calls.length < 13) {
      releases.splice(0).forEach(release => release());
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    releases.splice(0).forEach(release => release());
    await vi.waitFor(() => expect(attachProvider).toHaveBeenCalledTimes(13));
  });

  it('refreshes an expired cached selection token before background attachment', async () => {
    const ambiguous = candidate('ambiguous', 0, {
      addressText: null,
      evidenceType: 'caption_llm',
    });
    savePlaceCandidateReviewCache({
      archiveId: 'archive-1',
      provider: 'kakaomap',
      staged: {
        ambiguous: {
          kind: 'provider',
          provider: 'kakaomap',
          externalId: '100',
          selectionToken: 'expired-token',
          query: 'Place ambiguous',
          matchedAt: 1,
          displayName: 'Cached match',
          displayAddress: 'Cached road',
        },
      },
      searches: {},
      noteIntents: {},
      kindIntents: {},
      suppressedAutoIds: [],
      includeOcr: false,
      includeComments: false,
      executionPreference: 'auto',
    }, Date.now());
    const refreshed = { ...kakaoResult('100'), selectionToken: 'fresh-token' };
    const searchProvider = vi.fn(async request => ({
      provider: request.provider,
      query: request.query,
      results: [refreshed],
      nextCursor: null,
    }));
    const attachProvider = vi.fn(async (_candidateId, body) => {
      expect(body.selectionToken).toBe('fresh-token');
      return result([ambiguous], [], 'attach_provider');
    });
    const { modal } = openModal({
      candidates: [ambiguous],
      searchProvider,
      attachProvider,
    });
    await waitForReady(modal, 1);

    click(modal, '.sa-place-candidate-add-selected');

    await vi.waitFor(() => expect(searchProvider).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(attachProvider).toHaveBeenCalledTimes(1));
  });

  it('forwards photo, comments, and local/cloud choices to extraction', async () => {
    const onExtract = vi.fn(async () => ({ candidates: [], message: 'Done.' }));
    const { modal } = openModal({
      candidates: [],
      onExtract,
      hasImages: true,
      hasComments: true,
    });
    await vi.waitFor(() => expect(modal.contentEl.querySelector('[data-extract-cta]')).not.toBeNull());
    const toggles = modal.contentEl.querySelectorAll<HTMLInputElement>(
      '.sa-place-candidate-source-toggle input',
    );
    expect(toggles[0]?.checked).toBe(true);
    toggles[0]?.click();
    modal.contentEl.querySelectorAll<HTMLInputElement>(
      '.sa-place-candidate-source-toggle input',
    )[1]?.click();
    const execution = modal.contentEl.querySelector<HTMLSelectElement>(
      '.sa-place-candidate-execution select',
    );
    if (!execution) throw new TypeError('Missing execution selector');
    execution.value = 'local';
    execution.dispatchEvent(new Event('change'));
    click(modal, '[data-extract-cta]');

    await vi.waitFor(() => expect(onExtract).toHaveBeenCalledTimes(1));
    expect(onExtract.mock.calls[0]?.[1]).toEqual({
      includeOcr: false,
      includeComments: true,
      executionPreference: 'local',
    });
  });

  it('reviews an existing confirmed place note without another attachment', async () => {
    const proposal = {
      candidateId: 'confirmed-1',
      locationId: 'location-1',
      locationName: '남경막국수 본점',
      contextText: '남경막국수-들깨막국수&곤드레막국수,국산재료',
      contextTags: ['menu', 'quality'],
      contextScope: 'candidate' as const,
      status: 'eligible' as const,
      noteId: null,
      defaultOn: false,
      recoveredFromEvidence: true,
    };
    const decideContextNote = vi.fn().mockResolvedValue({
      replayed: false,
      archiveId: 'archive-1',
      proposal: { ...proposal, status: 'applied', noteId: 'pcn-1' },
    });
    const { modal, options } = openModal({
      candidates: [],
      recoveryOnly: true,
      loadContextNoteProposals: vi.fn().mockResolvedValue([proposal]),
      decideContextNote,
    });
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain(proposal.contextText));
    modal.contentEl.querySelector<HTMLInputElement>(
      '.sa-place-context-recovery input[type="checkbox"]',
    )?.click();
    click(modal, '.sa-place-context-recovery button');

    await vi.waitFor(() => expect(decideContextNote).toHaveBeenCalledWith('confirmed-1', 'save'));
    expect(options.attachBatch).not.toHaveBeenCalled();
  });

  it('requires confirmation before dismissing every candidate', async () => {
    confirmState.confirmed = false;
    const rejectCandidate = vi.fn(async () => undefined);
    const { modal } = openModal({
      candidates: [candidate('one', 0), candidate('two', 1)],
      rejectCandidate,
    });
    await waitForReady(modal, 2);
    click(modal, '.sa-place-candidate-dismiss-all');
    await vi.waitFor(() => expect(showConfirmModal).toHaveBeenCalledTimes(1));
    expect(rejectCandidate).not.toHaveBeenCalled();

    confirmState.confirmed = true;
    click(modal, '.sa-place-candidate-dismiss-all');
    await vi.waitFor(() => expect(rejectCandidate).toHaveBeenCalledTimes(2));
    expect(document.body.contains(modal.modalEl)).toBe(false);
  });

  it('keeps the 20-candidate extraction capacity rule and known role chips', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => candidate(`c-${index}`, index, {
      role: index === 0 ? 'recommended' : null,
    }));
    const { modal } = openModal({ candidates: rows, onExtract: vi.fn() });
    await waitForReady(modal, 20);
    const button = modal.contentEl.querySelector<HTMLButtonElement>('[data-extract-cta]');
    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe('Review pending suggestions first');
    expect([...modal.contentEl.querySelectorAll('.sa-place-candidate-role')]
      .map(chip => chip.textContent)).toEqual(['Recommended']);
  });
});
