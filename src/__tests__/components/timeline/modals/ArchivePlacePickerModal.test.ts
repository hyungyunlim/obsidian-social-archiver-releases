import { Modal, type App } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArchivePlacePickerModal,
  dedupeExistingPlaceArchives,
  getArchivePlacePickerError,
  type ArchivePlacePickerApi,
} from '@/components/timeline/modals/ArchivePlacePickerModal';
import { resolveManualMapInput } from '@/components/timeline/modals/archivePlacePickerModel';
import { showConfirmModal } from '@/utils/confirm-modal';
import type {
  BillingUsageResponse,
  ArchiveLocation,
  LocationAttachmentResult,
  PlaceCandidateAttachmentResult,
  ProviderSearchRequest,
  ProviderSearchResponse,
  UserArchive,
} from '@/services/WorkersAPIClient';

const noticeMessages = vi.hoisted((): string[] => []);
// Confirm gate for "Get details" — driven per-test via confirmState.confirmed.
// Mocked directly because the real modal needs obsidian's Setting, which the
// obsidian test mock does not export.
const confirmState = vi.hoisted(() => ({ confirmed: true }));

vi.mock('@/utils/confirm-modal', () => ({
  showConfirmModal: vi.fn(async () => confirmState.confirmed),
}));

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  return {
    ...actual,
    Notice: class Notice {
      constructor(message: string | DocumentFragment) {
        noticeMessages.push(typeof message === 'string' ? message : message.textContent ?? '');
      }
    },
  };
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (error) => rejectPromise?.(error),
  };
}

function makeArchive(overrides: Partial<UserArchive>): UserArchive {
  return {
    id: 'place-1',
    userId: 'user-1',
    platform: 'kakaomap',
    postId: '101',
    originalUrl: 'https://place.map.kakao.com/101',
    title: null,
    authorName: null,
    authorUrl: null,
    authorAvatarUrl: null,
    previewText: null,
    fullContent: null,
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: null,
    postedAt: null,
    archivedAt: '2026-07-13T00:00:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    location: '희작',
    latitude: 37.1,
    longitude: 126.9,
    locationSource: 'kakaomap',
    locationExternalId: '101',
    metadata: { categoryName: '카페', roadAddress: '서울 종로구 백석동길 155' },
    isLiked: false,
    isBookmarked: false,
    isArchived: false,
    isShared: false,
    ...overrides,
  };
}

function searchResponse(query: string, externalId: string): ProviderSearchResponse {
  return {
    provider: 'kakaomap',
    query,
    page: 1,
    size: 15,
    isEnd: true,
    pageableCount: 1,
    totalCount: 1,
    attribution: {
      provider: 'Kakao',
      label: 'Search results provided by Kakao',
      url: 'https://developers.kakao.com/',
    },
    results: [{
      provider: 'kakaomap',
      externalId,
      name: `${query} 장소`,
      categoryName: '음식점 > 카페',
      categoryGroupCode: 'CE7',
      categoryGroupName: '카페',
      address: '서울 종로구 부암동',
      roadAddress: '서울 종로구 백석동길 155',
      latitude: 37.1,
      longitude: 126.9,
      phone: '',
      placeUrl: `https://place.map.kakao.com/${externalId}`,
      selectionToken: `token-${externalId}`,
    }],
  };
}

function archiveLocation(): ArchiveLocation {
  return {
    id: 'location-1', archiveId: 'source-1', placeKey: 'kakaomap:101', name: '희작',
    address: '서울 종로구 백석동길 155', latitude: 37.1, longitude: 126.9,
    source: 'kakaomap', externalId: '101', url: 'https://place.map.kakao.com/101',
    category: '카페', isPrimary: true, sortOrder: 0, placeArchiveId: null,
    promotionStatus: 'metadata_only', createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  };
}

function selectionResponse(): LocationAttachmentResult {
  const location = archiveLocation();
  return {
    sourceArchiveId: 'source-1', locationId: location.id, intent: 'attach_location',
    location, enrichment: 'not_requested',
  };
}

function candidateSelectionResponse(
  operation: PlaceCandidateAttachmentResult['request']['operation'],
): PlaceCandidateAttachmentResult {
  const location = archiveLocation();
  return {
    replayed: false,
    archiveId: 'source-1',
    request: {
      idempotencyKey: 'candidate-selection-key',
      requestDigest: `sha256:${'a'.repeat(64)}`,
      operation,
    },
    outcomes: [{
      candidateId: 'candidate-2', ordinal: 1, outcome: 'attached',
      locationId: location.id, canonicalLocation: location, candidateStatus: 'confirmed',
    }],
    activeLocations: [location],
    primaryLocationId: location.id,
    remainingPendingCandidates: [],
    remainingPendingCount: 0,
    globalPendingCount: 0,
  };
}

function googleSearchResponse(
  query: string,
  externalId: string,
  nextCursor?: string,
  remaining = 18,
  displayName = `${query} place`,
): ProviderSearchResponse {
  return {
    provider: 'googlemaps',
    query,
    size: 5,
    attribution: {
      provider: 'Google',
      label: 'Search results provided by Google',
      url: 'https://developers.google.com/maps',
    },
    pagination: { kind: 'cursor', ...(nextCursor ? { nextCursor } : {}) },
    cloudCredit: { remaining },
    results: [{
      provider: 'googlemaps',
      externalId,
      displayName,
      formattedAddress: '1 Ferry Building, San Francisco, CA',
      latitude: 37.7955,
      longitude: -122.3937,
      primaryType: 'cafe',
      selectionToken: `token-${externalId}`,
    }],
  };
}

const BILLING_USAGE = {
  plan: 'free',
  archiveQuota: {
    period: '2026-07', used: 0, limit: 10, remaining: 10,
    resetAt: '2026-08-01T00:00:00.000Z', unlimited: false,
  },
  cloudCreditQuota: {
    period: '2026-07', used: 4, reserved: 0, limit: 25, remaining: 21,
    resetAt: '2026-08-01T00:00:00.000Z', unlimited: false,
    breakdown: [],
  },
} satisfies BillingUsageResponse;

function makeApi(overrides: Partial<ArchivePlacePickerApi> = {}): ArchivePlacePickerApi {
  return {
    getUserArchives: vi.fn(async () => ({
      archives: [], total: 0, limit: 100, offset: 0, hasMore: false, serverTime: '',
    })),
    getArchiveLocations: vi.fn(async () => []),
    getArchivePreferences: vi.fn(async () => ({
      mapSearchProvider: 'kakaomap',
      mapSearchProviderAvailability: { kakaomap: true, googlemaps: true },
    })),
    getUserUsage: vi.fn(async () => BILLING_USAGE),
    searchProviderPlaces: vi.fn(async (request) => searchResponse(request.query, '101')),
    attachProviderLocation: vi.fn(async () => selectionResponse()),
    attachExistingLocation: vi.fn(async () => selectionResponse()),
    attachPlaceCandidateFromProvider: vi.fn(async () => candidateSelectionResponse('attach_provider')),
    attachPlaceCandidateFromExisting: vi.fn(async () => candidateSelectionResponse('attach_existing')),
    patchArchiveLocation: vi.fn(async () => archiveLocation()),
    replaceProviderLocation: vi.fn(async () => archiveLocation()),
    deleteArchiveLocation: vi.fn(async () => undefined),
    promoteArchiveLocation: vi.fn(async () => ({
      sourceArchiveId: 'source-1', location: { ...archiveLocation(), promotionStatus: 'archiving' },
      targetArchiveId: 'place-1', intent: 'archive_place', enrichment: 'queued',
    })),
    ...overrides,
  };
}

function openCandidateModal(
  api: ArchivePlacePickerApi,
  initialView: 'search' | 'existing' = 'search',
  candidateId = 'candidate-2',
): {
  readonly modal: ArchivePlacePickerModal;
  readonly onCandidateAttached: ReturnType<typeof vi.fn>;
  readonly onClosed: ReturnType<typeof vi.fn>;
} {
  const onCandidateAttached = vi.fn(async () => undefined);
  const onClosed = vi.fn();
  const modal = new ArchivePlacePickerModal({} as App, {
    archiveId: 'source-1',
    api,
    hostLocale: 'ko-KR',
    candidateContext: { archiveId: 'source-1', candidateId },
    initialView,
    onCandidateAttached,
    onClosed,
  });
  modal.open();
  return { modal, onCandidateAttached, onClosed };
}

function openModal(api: ArchivePlacePickerApi, currentLocation: string | null = null): ArchivePlacePickerModal {
  const modal = new ArchivePlacePickerModal({} as App, {
    archiveId: 'source-1',
    currentLocation,
    api,
    hostLocale: 'ko-KR',
    archiveMapsUrl: vi.fn(),
    onChanged: vi.fn(async () => undefined),
  });
  modal.open();
  return modal;
}

function providerSelect(modal: ArchivePlacePickerModal): HTMLSelectElement | null {
  return modal.contentEl.querySelector<HTMLSelectElement>('.sa-place-picker-provider-select');
}

async function waitForProvider(
  modal: ArchivePlacePickerModal,
  provider: 'kakaomap' | 'googlemaps',
): Promise<void> {
  await vi.waitFor(() => expect(providerSelect(modal)?.value).toBe(provider));
}

function chooseProvider(modal: ArchivePlacePickerModal, provider: 'kakaomap' | 'googlemaps'): void {
  const select = providerSelect(modal);
  if (!select) throw new TypeError('Missing map provider selector');
  select.value = provider;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ArchivePlacePickerModal', () => {
  beforeEach(() => {
    noticeMessages.length = 0;
    confirmState.confirmed = true;
    vi.mocked(showConfirmModal).mockClear();
  });

  it('deduplicates only by canonical provider identity and keeps duplicate display names', () => {
    // Given: same identity twice, same name with another identity, and an unkeyed location.
    const archives = [
      makeArchive({ id: 'a', locationExternalId: '101' }),
      makeArchive({ id: 'b', locationExternalId: '101' }),
      makeArchive({ id: 'c', locationExternalId: '202', postId: '202' }),
      makeArchive({ id: 'd', locationExternalId: null, postId: '', platform: 'post' }),
    ];

    // When: existing targets are normalized.
    const places = dedupeExistingPlaceArchives(archives);

    // Then: canonical duplicates collapse while same-named distinct places remain.
    expect(places.map((place) => place.archiveId)).toEqual(['a', 'c']);
    expect(places.map((place) => place.identity)).toEqual(['kakaomap:101', 'kakaomap:202']);
  });

  it('renders provider, category, and address so same-named places are distinguishable', async () => {
    // Given: two same-named Kakao places with different canonical IDs and addresses.
    const api = makeApi({
      getUserArchives: vi.fn(async () => ({
        archives: [
          makeArchive({ id: 'a', locationExternalId: '101' }),
          makeArchive({
            id: 'b',
            locationExternalId: '202',
            postId: '202',
            metadata: { categoryName: '한식', address: '서울 마포구 연남동' },
          }),
        ],
        total: 2, limit: 100, offset: 0, hasMore: false, serverTime: '',
      })),
    });

    // When: the Existing view finishes loading.
    const modal = openModal(api);
    await waitForProvider(modal, 'kakaomap');
    modal.contentEl.querySelector<HTMLButtonElement>('[data-view="existing"]')?.click();
    await vi.waitFor(() => expect(modal.contentEl.querySelectorAll('.sa-place-picker-result')).toHaveLength(2));

    // Then: each row carries provider/category/address metadata, not only its name.
    const text = modal.contentEl.textContent ?? '';
    expect(text).toContain('Kakao Map');
    expect(text).toContain('카페');
    expect(text).toContain('서울 종로구 백석동길 155');
    expect(text).toContain('한식');
    expect(text).toContain('서울 마포구 연남동');
  });

  it('does not call a provider while typing and searches only on explicit submit', async () => {
    // Given: the account default has opened the Kakao provider tab.
    const api = makeApi();
    const modal = openModal(api);
    await waitForProvider(modal, 'kakaomap');
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');

    // When: the user types without submitting.
    if (input) {
      input.value = '희작';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await Promise.resolve();

    // Then: no chargeable request occurs until the Search button is pressed.
    expect(api.searchProviderPlaces).not.toHaveBeenCalled();
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-search-row button')?.click();
    await vi.waitFor(() => expect(api.searchProviderPlaces).toHaveBeenCalledTimes(1));
  });

  it('keeps an explicit unavailable provider selected and allows an available session-only alternate', async () => {
    // Given: explicit Google preference on an English host where only Kakao search is available.
    const updateArchivePreferences = vi.fn();
    const searchProviderPlaces = vi.fn();
    const api = makeApi({
      getArchivePreferences: vi.fn(async () => ({
        mapSearchProvider: 'googlemaps',
        mapSearchProviderAvailability: { kakaomap: true, googlemaps: false },
      })),
      updateArchivePreferences,
      searchProviderPlaces,
    });
    const modal = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null, api, hostLocale: 'en-US',
      archiveMapsUrl: vi.fn(), onChanged: vi.fn(),
    });

    // When: the modal opens and the user temporarily switches to Kakao.
    modal.open();
    await waitForProvider(modal, 'googlemaps');
    expect(modal.contentEl.querySelector('.sa-place-picker-status.mod-error')?.textContent).toBe(
      'Google Maps search is unavailable. Choose another provider or use a map URL.',
    );
    expect(modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-search-row button')?.disabled).toBe(true);
    expect(modal.contentEl.querySelectorAll('.sa-place-picker-credit')).toHaveLength(0);
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-search-row button')?.click();
    expect(searchProviderPlaces).not.toHaveBeenCalled();
    chooseProvider(modal, 'kakaomap');

    // Then: the account setting is not PATCHed by a picker tab.
    expect(updateArchivePreferences).not.toHaveBeenCalled();
    expect(providerSelect(modal)?.value).toBe('kakaomap');

    modal.close();
    const reopened = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null, api, hostLocale: 'en-US',
      archiveMapsUrl: vi.fn(), onChanged: vi.fn(),
    });
    reopened.open();
    await waitForProvider(reopened, 'googlemaps');
  });

  it('fails both chargeable providers closed when archive preferences cannot load', async () => {
    // Given: runtime availability cannot be established and Google would be the locale default.
    const searchProviderPlaces = vi.fn();
    const modal = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null,
      api: makeApi({
        getArchivePreferences: vi.fn(async () => { throw new Error('offline'); }),
        searchProviderPlaces,
      }),
      hostLocale: 'en-US', archiveMapsUrl: vi.fn(), onChanged: vi.fn(),
    });

    // When: the picker resolves its initial provider after the load failure.
    modal.open();
    await waitForProvider(modal, 'googlemaps');

    // Then: both unverified providers stay disabled and no paid search can start.
    expect(modal.contentEl.querySelector('.sa-place-picker-status.mod-error')?.textContent).toBe(
      'Google Maps search is unavailable. Use a map URL or Place ID.',
    );
    expect(providerSelect(modal)?.querySelector<HTMLOptionElement>('option[value="googlemaps"]')?.disabled)
      .toBe(true);
    expect(providerSelect(modal)?.querySelector<HTMLOptionElement>('option[value="kakaomap"]')?.disabled)
      .toBe(true);
    const recoveryButtons = [...modal.contentEl.querySelectorAll<HTMLButtonElement>(
      '.sa-place-picker-recovery button',
    )];
    expect(recoveryButtons.map((button) => button.textContent)).toEqual(['Use URL or place ID']);
    expect(document.activeElement).toBe(recoveryButtons[0]);
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-search-row button')?.click();
    chooseProvider(modal, 'kakaomap');
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-search-row button')?.click();
    expect(searchProviderPlaces).not.toHaveBeenCalled();
  });

  it('shows Google page cost before search and appends an attributed cursor page', async () => {
    // Given: a Google default with one cursor page available.
    const searchProviderPlaces = vi.fn(async (request: ProviderSearchRequest) => (
      request.provider === 'googlemaps' && request.nextCursor
        ? googleSearchResponse(request.query, 'ChIJ-page-2', undefined, 16, 'Second page place')
        : googleSearchResponse(request.query, 'ChIJ-page-1', 'cursor-2', 17, 'First page place')
    ));
    const modal = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null,
      api: makeApi({
        getArchivePreferences: vi.fn(async () => ({
          mapSearchProvider: 'googlemaps',
          mapSearchProviderAvailability: { kakaomap: true, googlemaps: true },
        })),
        searchProviderPlaces,
      }),
      hostLocale: 'ko-KR', archiveMapsUrl: vi.fn(), onChanged: vi.fn(),
    });
    modal.open();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('1 Cloud credit per page · 21 remaining'));
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
    if (input) input.value = 'Blue Bottle';

    // When: the user explicitly searches and then loads the cursor page.
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-search-row button')?.click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('First page place'));
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-load-more')?.click();
    await vi.waitFor(() => expect(modal.contentEl.querySelectorAll('.sa-place-picker-result')).toHaveLength(2));

    // Then: cursor authority, attribution, remaining credits, and both pages are visible.
    expect(searchProviderPlaces.mock.calls[1]?.[0]).toMatchObject({ nextCursor: 'cursor-2' });
    expect(modal.contentEl.querySelectorAll('.sa-place-picker-result')).toHaveLength(2);
    expect(modal.contentEl.textContent).toContain('First page place');
    expect(modal.contentEl.textContent).toContain('Second page place');
    expect(modal.contentEl.textContent).toContain('Search results provided by Google');
    expect(modal.contentEl.querySelectorAll('.sa-place-picker-credit')).toHaveLength(1);
    expect(modal.contentEl.textContent).toContain('16 remaining');
    expect(modal.contentEl.textContent).not.toContain('21 remaining');
  });

  it('allows only one paid provider page request while a search or cursor page is in flight', async () => {
    // Given: Google search and its next cursor page both settle asynchronously.
    const firstPage = deferred<ProviderSearchResponse>();
    const secondPage = deferred<ProviderSearchResponse>();
    const searchProviderPlaces = vi.fn()
      .mockReturnValueOnce(firstPage.promise)
      .mockReturnValueOnce(secondPage.promise);
    const modal = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null,
      api: makeApi({
        getArchivePreferences: vi.fn(async () => ({
          mapSearchProvider: 'googlemaps',
          mapSearchProviderAvailability: { kakaomap: true, googlemaps: true },
        })),
        searchProviderPlaces,
      }),
      hostLocale: 'en-US', archiveMapsUrl: vi.fn(), onChanged: vi.fn(),
    });
    modal.open();
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-search-input')).toBeTruthy());
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
    const search = modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-search-row button');
    if (input) input.value = 'Blue Bottle';

    // When: click and Enter repeat before the first page, then Load more repeats before page two.
    search?.click();
    search?.click();
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Then: controls lock synchronously and only one initial paid page is requested.
    expect(searchProviderPlaces).toHaveBeenCalledTimes(1);
    expect(search?.disabled).toBe(true);
    expect(input?.disabled).toBe(true);
    firstPage.resolve(googleSearchResponse('Blue Bottle', 'ChIJ-page-1', 'cursor-2', 17));
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-load-more')).toBeTruthy());
    const loadMore = modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-load-more');
    loadMore?.click();
    loadMore?.click();
    expect(searchProviderPlaces).toHaveBeenCalledTimes(2);
    expect(loadMore?.disabled).toBe(true);
    secondPage.resolve(googleSearchResponse('Blue Bottle', 'ChIJ-page-2', undefined, 16));
    await vi.waitFor(() => expect(modal.contentEl.querySelectorAll('.sa-place-picker-result')).toHaveLength(2));
    expect(modal.contentEl.querySelectorAll('.sa-place-picker-credit')).toHaveLength(1);
    expect(modal.contentEl.textContent).toContain('16 remaining');
  });

  it('renders cap recovery without silently switching provider', async () => {
    // Given: Google returns a project cap error.
    const error = new Error('project cap') as Error & { code?: string; status?: number };
    error.code = 'GOOGLE_PROJECT_MONTHLY_LIMIT';
    error.status = 503;
    const api = makeApi({
      getArchivePreferences: vi.fn(async () => ({
        mapSearchProvider: 'googlemaps',
        mapSearchProviderAvailability: { kakaomap: true, googlemaps: true },
      })),
      searchProviderPlaces: vi.fn(async () => { throw error; }),
    });
    const modal = openModal(api);
    await waitForProvider(modal, 'googlemaps');
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
    if (input) input.value = 'Blue Bottle';

    // When: the explicit search fails.
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-search-row button')?.click();
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.mod-error')).toBeTruthy());

    // Then: the same Google tab remains active with retry/manual recovery.
    expect(modal.contentEl.textContent).toContain('Google Maps project limit');
    expect(modal.contentEl.textContent).toContain('Retry');
    expect(providerSelect(modal)?.value).toBe('googlemaps');
  });

  it('archives a manual provider Place ID without retaining candidate facts', async () => {
    // Given: only concrete Google Maps URL shapes or a Place ID are accepted.
    expect(resolveManualMapInput('googlemaps', 'https://google.com')).toBeNull();
    expect(resolveManualMapInput('googlemaps', 'https://www.google.com/search?q=coffee')).toBeNull();
    expect(resolveManualMapInput('googlemaps', 'https://maps.google.com/not-a-place')).toBeNull();
    expect(resolveManualMapInput('googlemaps', 'https://maps.google.com/')).toBeNull();
    expect(resolveManualMapInput('googlemaps', 'https://maps.google.com/?cid=123')).toBe(
      'https://maps.google.com/?cid=123',
    );
    expect(resolveManualMapInput('googlemaps', 'https://www.google.com/maps/place/Blue+Bottle')).toBe(
      'https://www.google.com/maps/place/Blue+Bottle',
    );
    const archiveMapsUrl = vi.fn();
    const api = makeApi({
      getArchivePreferences: vi.fn(async () => ({
        mapSearchProvider: 'googlemaps',
        mapSearchProviderAvailability: { kakaomap: true, googlemaps: true },
      })),
    });
    const modal = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null, api, hostLocale: 'en-US',
      archiveMapsUrl, onChanged: vi.fn(),
    });
    modal.open();
    await waitForProvider(modal, 'googlemaps');
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-manual-action')?.click();
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-manual-input');
    if (input) {
      input.value = 'invalid://place';
      modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-manual-submit')?.click();
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe('sa-place-picker-manual-status');
      expect(modal.contentEl.querySelector('label')?.htmlFor).toBe(input.id);
      expect(modal.contentEl.querySelector('#sa-place-picker-manual-status')?.getAttribute('aria-live')).toBe('polite');
      input.value = 'ChIJ_manual_place';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // When: the user continues through the normal URL archive flow.
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-manual-submit')?.click();

    // Then: only the canonical URL leaves the modal and no candidate/search write occurs.
    expect(archiveMapsUrl).toHaveBeenCalledWith(
      'https://www.google.com/maps/search/?api=1&query=place&query_place_id=ChIJ_manual_place',
    );
    expect(api.attachProviderLocation).not.toHaveBeenCalled();
    expect(api.searchProviderPlaces).not.toHaveBeenCalled();
  });

  it('cancels pending search work before reloading the Existing view', async () => {
    // Given: a debounced query and a delayed Existing reload.
    const getUserArchives = vi.fn(async () => ({
      archives: [makeArchive({})], total: 1, limit: 100, offset: 0, hasMore: false, serverTime: '',
    }));
    const api = makeApi({ getUserArchives });
    const modal = openModal(api);
    await waitForProvider(modal, 'kakaomap');
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
    if (input) {
      input.value = '희작';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // When: the user returns to Existing without submitting.
    modal.contentEl.querySelector<HTMLButtonElement>('[data-view="existing"]')?.click();
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('희작'));

    // Then: the reload completes and the abandoned query never invalidates it.
    expect(api.searchProviderPlaces).not.toHaveBeenCalled();
    expect(modal.contentEl.textContent).toContain('희작');
    expect(modal.contentEl.textContent).not.toContain('Loading saved places…');
  });

  it('supports the complete keyboard tab and tabpanel relationship', async () => {
    // Given: the Existing tab is active.
    const modal = openModal(makeApi());
    const existing = modal.contentEl.querySelector<HTMLButtonElement>('[data-view="existing"]');
    const search = modal.contentEl.querySelector<HTMLButtonElement>('[data-view="search"]');

    // When: ArrowRight moves to Search.
    existing?.focus();
    existing?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // Then: focus, roving tabindex, and the controlled panel all identify Search.
    expect(document.activeElement).toBe(search);
    expect(existing?.tabIndex).toBe(-1);
    expect(search?.tabIndex).toBe(0);
    expect(search?.getAttribute('aria-selected')).toBe('true');
    expect(search?.getAttribute('aria-controls')).toBe('sa-place-picker-panel');
    const panel = modal.contentEl.querySelector('[role="tabpanel"]');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('sa-place-picker-tab-search');
  });

  it('submits the selection token, closes immediately, and reports metadata-only attachment', async () => {
    // Given: a visible signed search result.
    const selection = deferred<LocationAttachmentResult>();
    const attachProviderLocation = vi.fn(() => selection.promise);
    const onChanged = vi.fn(async () => undefined);
    const api = makeApi({ attachProviderLocation });
    const modal = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null, api, hostLocale: 'ko-KR',
      archiveMapsUrl: vi.fn(), onChanged,
    });
    modal.open();
    await waitForProvider(modal, 'kakaomap');
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
    if (input) input.value = '희작';

    // When: Enter searches and the result is selected.
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result')?.click();
    await vi.waitFor(() => expect(attachProviderLocation).toHaveBeenCalled());

    // Then: the signed token is submitted and the modal closes before the server settles.
    expect(attachProviderLocation.mock.calls[0]?.slice(0, 2)).toEqual(['source-1', 'token-101']);
    expect(document.body.contains(modal.modalEl)).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
    selection.resolve(selectionResponse());
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalledWith({ location: archiveLocation(), enrichment: 'not_requested' });
  });

  it('reopens a failed optimistic selection and retries it with the same idempotency key', async () => {
    // Given: one delayed failure followed by a successful retry.
    const first = deferred<LocationAttachmentResult>();
    const baseResponse = searchResponse('희작', '101');
    const primaryResult = baseResponse.results[0];
    if (!primaryResult) throw new TypeError('Missing primary search result');
    const recoveryResponse: ProviderSearchResponse = {
      ...baseResponse,
      pageableCount: 2,
      totalCount: 2,
      results: [primaryResult, {
        ...primaryResult,
        externalId: '202',
        name: '희작 별관',
        selectionToken: 'token-202',
      }],
    };
    const attachProviderLocation = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(selectionResponse());
    const searchProviderPlaces = vi.fn(async () => recoveryResponse);
    const modal = openModal(makeApi({
      searchProviderPlaces,
      attachProviderLocation,
    }));
    await waitForProvider(modal, 'kakaomap');
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
    if (input) input.value = '희작';
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());

    // When: a double activation occurs, then the first request fails.
    const result = modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result');
    result?.click();
    result?.click();
    expect(attachProviderLocation).toHaveBeenCalledTimes(1);
    expect(document.body.contains(modal.modalEl)).toBe(false);
    const firstKey = attachProviderLocation.mock.calls[0]?.[2];
    first.reject(new Error('offline'));
    await vi.waitFor(() => expect(document.body.contains(modal.modalEl)).toBe(true));

    // Then: failure is visible and retry reuses the exact key.
    expect(modal.contentEl.textContent).toContain('You appear to be offline');
    expect(modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input')?.value).toBe('희작');
    expect(modal.contentEl.querySelectorAll('.sa-place-picker-result')).toHaveLength(2);
    expect(modal.contentEl.textContent).toContain('희작 별관');
    expect(modal.contentEl.textContent).toContain('Search results provided by Kakao');
    const retry = [...modal.contentEl.querySelectorAll<HTMLButtonElement>('.sa-place-picker-recovery button')]
      .find(button => button.textContent === 'Retry linking');
    retry?.click();
    await vi.waitFor(() => expect(attachProviderLocation).toHaveBeenCalledTimes(2));
    expect(attachProviderLocation.mock.calls[1]?.[2]).toBe(firstKey);
    expect(searchProviderPlaces).toHaveBeenCalledTimes(1);
  });

  it('ignores an older modal failure after a newer same-key selection succeeds', async () => {
    // Given: modal A has a pending selection for the same archive and provider place used by modal B.
    const first = deferred<LocationAttachmentResult>();
    const attachProviderLocation = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(selectionResponse());
    const api = makeApi({ attachProviderLocation });
    const onChangedA = vi.fn(async () => undefined);
    const onChangedB = vi.fn(async () => undefined);
    const modalA = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null, api, hostLocale: 'ko-KR', archiveMapsUrl: vi.fn(), onChanged: onChangedA,
    });
    const modalB = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null, api, hostLocale: 'ko-KR', archiveMapsUrl: vi.fn(), onChanged: onChangedB,
    });

    const searchAndSelect = async (modal: ArchivePlacePickerModal): Promise<void> => {
      modal.open();
      await waitForProvider(modal, 'kakaomap');
      const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
      if (input) input.value = '희작';
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());
      modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result')?.click();
    };

    // When: B completes first with A's shared key, then A rejects out of order.
    await searchAndSelect(modalA);
    await vi.waitFor(() => expect(attachProviderLocation).toHaveBeenCalledTimes(1));
    await searchAndSelect(modalB);
    await vi.waitFor(() => expect(onChangedB).toHaveBeenCalledTimes(1));
    expect(attachProviderLocation.mock.calls[1]?.[2])
      .toBe(attachProviderLocation.mock.calls[0]?.[2]);
    const noticesAfterSuccess = [...noticeMessages];
    expect(noticesAfterSuccess).toEqual(['Added 희작 as metadata only. Get details']);
    first.reject(new Error('offline'));
    await first.promise.catch(() => undefined);
    await Promise.resolve();

    // Then: A cannot reopen or publish a stale failure after B's authoritative success.
    expect(document.body.contains(modalA.modalEl)).toBe(false);
    expect(modalA.contentEl.textContent).toBe('');
    expect(noticeMessages).toEqual(noticesAfterSuccess);
    expect(onChangedA).not.toHaveBeenCalled();
    expect(onChangedB).toHaveBeenCalledTimes(1);
  });

  it('ignores an older same-key success while the newer generation is pending', async () => {
    // Given: two modal generations submit the same signed place and idempotency key.
    const first = deferred<LocationAttachmentResult>();
    const second = deferred<LocationAttachmentResult>();
    const attachProviderLocation = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const api = makeApi({ attachProviderLocation });
    const onChangedA = vi.fn(async () => undefined);
    const onChangedB = vi.fn(async () => undefined);
    const modalA = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null, api, hostLocale: 'ko-KR', archiveMapsUrl: vi.fn(), onChanged: onChangedA,
    });
    const modalB = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null, api, hostLocale: 'ko-KR', archiveMapsUrl: vi.fn(), onChanged: onChangedB,
    });

    const searchAndSelect = async (modal: ArchivePlacePickerModal): Promise<void> => {
      modal.open();
      await waitForProvider(modal, 'kakaomap');
      const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
      if (input) input.value = '희작';
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());
      modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result')?.click();
    };

    // When: the older request succeeds before the newer generation settles.
    await searchAndSelect(modalA);
    await searchAndSelect(modalB);
    first.resolve(selectionResponse());
    await first.promise;
    await Promise.resolve();

    // Then: only the current generation can publish completion and clear authority.
    expect(onChangedA).not.toHaveBeenCalled();
    second.resolve(selectionResponse());
    await vi.waitFor(() => expect(onChangedB).toHaveBeenCalledTimes(1));
    expect(attachProviderLocation.mock.calls[1]?.[2])
      .toBe(attachProviderLocation.mock.calls[0]?.[2]);
  });

  it('manages every attached location and exposes keyboard/focus semantics', async () => {
    // Given: an archive with one attached location.
    const deleteArchiveLocation = vi.fn(async () => undefined);
    const api = makeApi({
      getArchiveLocations: vi.fn(async () => [archiveLocation()]),
      deleteArchiveLocation,
    });
    const modal = openModal(api, '희작');
    await waitForProvider(modal, 'kakaomap');
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Current locations (1)'));

    // When: a keyboard user activates remove for the selected attachment.
    const remove = [...modal.contentEl.querySelectorAll<HTMLButtonElement>('.sa-place-picker-current-actions button')]
      .find((button) => button.textContent === 'Remove');
    remove?.focus();
    remove?.click();
    await vi.waitFor(() => expect(deleteArchiveLocation).toHaveBeenCalledWith('source-1', 'location-1'));

    // Then: native tab/button semantics and named tabs are present.
    expect(remove?.tagName).toBe('BUTTON');
    expect(modal.contentEl.querySelector('[role="tablist"]')).toBeTruthy();
    expect(modal.contentEl.querySelector('[role="tab"][aria-selected="true"]')).toBeTruthy();
  });

  it('marks an already-attached existing place as added and non-tappable', async () => {
    // Given: a saved place whose placeKey matches an attached location (kakaomap:101).
    const attachExistingLocation = vi.fn(async () => selectionResponse());
    const api = makeApi({
      getUserArchives: vi.fn(async () => ({
        archives: [makeArchive({ id: 'a', locationExternalId: '101' })],
        total: 1, limit: 100, offset: 0, hasMore: false, serverTime: '',
      })),
      getArchiveLocations: vi.fn(async () => [archiveLocation()]),
      attachExistingLocation,
    });
    const modal = openModal(api, '희작');
    await waitForProvider(modal, 'kakaomap');
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Current locations (1)'));

    // When: the Existing list finishes loading after the attachment set is known.
    modal.contentEl.querySelector<HTMLButtonElement>('[data-view="existing"]')?.click();
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());

    // Then: the row reads as added, is disabled, and cannot re-attach on click.
    const row = modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result');
    expect(row?.disabled).toBe(true);
    expect(row?.classList.contains('is-added')).toBe(true);
    expect(row?.textContent).toContain('added');
    row?.click();
    await Promise.resolve();
    expect(attachExistingLocation).not.toHaveBeenCalled();
  });

  it('confirms before getting place details and honours the choice', async () => {
    // Given: a metadata-only attachment exposing the "Get details" action.
    const promoteArchiveLocation = vi.fn(async () => ({
      sourceArchiveId: 'source-1', location: { ...archiveLocation(), promotionStatus: 'archiving' as const },
      targetArchiveId: 'place-1', intent: 'archive_place' as const, enrichment: 'queued' as const,
    }));
    const api = makeApi({
      getArchiveLocations: vi.fn(async () => [archiveLocation()]),
      promoteArchiveLocation,
    });
    const modal = openModal(api, '희작');
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Current locations (1)'));
    const getDetails = (): HTMLButtonElement | undefined =>
      [...modal.contentEl.querySelectorAll<HTMLButtonElement>('.sa-place-picker-current-actions button')]
        .find((button) => button.textContent === 'Get details');

    // When: the confirm is declined, nothing is promoted.
    confirmState.confirmed = false;
    getDetails()?.click();
    await vi.waitFor(() => expect(showConfirmModal).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(promoteArchiveLocation).not.toHaveBeenCalled();

    // Then: accepting the confirm runs the promote.
    confirmState.confirmed = true;
    getDetails()?.click();
    await vi.waitFor(() => expect(promoteArchiveLocation).toHaveBeenCalledTimes(1));
  });

  it('locks every current-location action while one mutation is pending', async () => {
    const removal = deferred<void>();
    const api = makeApi({
      getArchiveLocations: vi.fn(async () => [archiveLocation()]),
      deleteArchiveLocation: vi.fn(() => removal.promise),
    });
    const modal = openModal(api, '희작');
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Current locations (1)'));
    const actions = [...modal.contentEl.querySelectorAll<HTMLButtonElement>('.sa-place-picker-current-actions button')];
    actions.find((button) => button.textContent === 'Remove')?.click();

    expect(actions.length).toBeGreaterThan(1);
    expect(actions.every((button) => button.disabled)).toBe(true);
    removal.resolve();
    await removal.promise;
  });

  it('offers an in-place retry when current locations fail to load', async () => {
    const getArchiveLocations = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([archiveLocation()]);
    const modal = openModal(makeApi({ getArchiveLocations }));
    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Retry loading locations'));

    [...modal.contentEl.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Retry loading locations')
      ?.click();

    await vi.waitFor(() => expect(modal.contentEl.textContent).toContain('Current locations (1)'));
    expect(getArchiveLocations).toHaveBeenCalledTimes(2);
  });

  it('binds provider search and attachment to one place candidate without a manual archive path', async () => {
    // Given: candidate 2 opens a provider-bound picker.
    const attachPlaceCandidateFromProvider = vi.fn(async () => (
      candidateSelectionResponse('attach_provider')
    ));
    const api = makeApi({ attachPlaceCandidateFromProvider });
    const { modal, onCandidateAttached, onClosed } = openCandidateModal(api);
    await waitForProvider(modal, 'kakaomap');

    // When: it searches and selects the result.
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
    if (!input) throw new TypeError('Missing provider search input');
    input.value = '희작';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());
    expect(api.searchProviderPlaces).toHaveBeenCalledWith(expect.objectContaining({
      candidateContext: { archiveId: 'source-1', candidateId: 'candidate-2' },
    }));
    expect(modal.contentEl.textContent).not.toContain('map URL');
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result')?.click();

    // Then: only the candidate endpoint receives the bound token.
    await vi.waitFor(() => expect(attachPlaceCandidateFromProvider).toHaveBeenCalledTimes(1));
    expect(attachPlaceCandidateFromProvider.mock.calls[0]?.[0]).toBe('candidate-2');
    expect(attachPlaceCandidateFromProvider.mock.calls[0]?.[1]).toMatchObject({
      selectionToken: 'token-101',
    });
    expect(api.attachProviderLocation).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onCandidateAttached).toHaveBeenCalledWith(
      expect.objectContaining({ remainingPendingCount: 0 }),
    ));
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('does not reuse candidate A provider key when candidate B selects the same result', async () => {
    // Given: candidate A loses its committed response for one provider result.
    const attachPlaceCandidateFromProvider = vi.fn(async (): Promise<PlaceCandidateAttachmentResult> => {
      throw new Error('response lost');
    });
    const api = makeApi({ attachPlaceCandidateFromProvider });
    const candidateA = openCandidateModal(api, 'search', 'candidate-a').modal;
    await waitForProvider(candidateA, 'kakaomap');
    const candidateAInput = candidateA.contentEl.querySelector<HTMLInputElement>(
      '.sa-place-picker-search-input',
    );
    if (!candidateAInput) throw new TypeError('Missing candidate A search input');
    candidateAInput.value = '희작';
    candidateAInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(candidateA.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());
    candidateA.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result')?.click();
    await vi.waitFor(() => expect(attachPlaceCandidateFromProvider).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(
      candidateA.contentEl.querySelector('.sa-place-picker-status.mod-error'),
    ).not.toBeNull());
    candidateA.close();

    // When: candidate B selects the identical result in the same archive.
    const candidateB = openCandidateModal(api, 'search', 'candidate-b').modal;
    await waitForProvider(candidateB, 'kakaomap');
    const candidateBInput = candidateB.contentEl.querySelector<HTMLInputElement>(
      '.sa-place-picker-search-input',
    );
    if (!candidateBInput) throw new TypeError('Missing candidate B search input');
    candidateBInput.value = '희작';
    candidateBInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(candidateB.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());
    candidateB.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result')?.click();
    await vi.waitFor(() => expect(attachPlaceCandidateFromProvider).toHaveBeenCalledTimes(2));

    // Then: candidate B never replays candidate A's backend digest identity.
    expect(attachPlaceCandidateFromProvider.mock.calls[1]?.[1].idempotencyKey)
      .not.toBe(attachPlaceCandidateFromProvider.mock.calls[0]?.[1].idempotencyKey);
  });

  it('opens Existing directly and attaches the saved place to the bound candidate', async () => {
    // Given: candidate 2 opens its Existing action.
    const attachPlaceCandidateFromExisting = vi.fn(async () => (
      candidateSelectionResponse('attach_existing')
    ));
    const api = makeApi({
      getUserArchives: vi.fn(async () => ({
        archives: [makeArchive({ id: 'place-a', locationExternalId: '101' })],
        total: 1, limit: 100, offset: 0, hasMore: false, serverTime: '',
      })),
      attachPlaceCandidateFromExisting,
    });
    const { modal, onCandidateAttached } = openCandidateModal(api, 'existing');

    // When: the first saved place is chosen.
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());
    expect(modal.contentEl.querySelector('[role="tab"][aria-selected="true"]')?.textContent)
      .toContain('Existing');
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result')?.click();

    // Then: the existing candidate endpoint owns the mutation.
    await vi.waitFor(() => expect(attachPlaceCandidateFromExisting).toHaveBeenCalledTimes(1));
    expect(attachPlaceCandidateFromExisting.mock.calls[0]).toEqual([
      'candidate-2',
      expect.objectContaining({ representativeArchiveId: 'place-a', placeKey: 'kakaomap:101' }),
    ]);
    expect(api.attachExistingLocation).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onCandidateAttached).toHaveBeenCalledTimes(1));
  });

  it('reuses one candidate-existing key when a lost response is replayed', async () => {
    // Given: a saved place whose first committed response is lost in transit.
    const attachPlaceCandidateFromExisting = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ ...candidateSelectionResponse('attach_existing'), replayed: true });
    const api = makeApi({
      getUserArchives: vi.fn(async () => ({
        archives: [makeArchive({ id: 'place-a', locationExternalId: '101' })],
        total: 1, limit: 100, offset: 0, hasMore: false, serverTime: '',
      })),
      attachPlaceCandidateFromExisting,
    });
    const { modal } = openCandidateModal(api, 'existing');
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());

    // When: the same saved place is selected again after the recoverable failure.
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result')?.click();
    await vi.waitFor(() => expect(attachPlaceCandidateFromExisting).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(
      modal.contentEl.querySelector('.sa-place-picker-status.mod-error'),
    ).not.toBeNull());
    await vi.waitFor(() => expect(
      modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result'),
    ).not.toBeNull());
    const retry = modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result');
    if (!retry) throw new TypeError('Recoverable existing-place action disappeared');
    expect(retry.disabled).toBe(false);
    retry.click();
    await vi.waitFor(() => expect(attachPlaceCandidateFromExisting).toHaveBeenCalledTimes(2));

    // Then: the replay uses the first logical-intent key.
    expect(attachPlaceCandidateFromExisting.mock.calls[1]?.[1].idempotencyKey)
      .toBe(attachPlaceCandidateFromExisting.mock.calls[0]?.[1].idempotencyKey);
  });

  it('rotates the candidate-existing key when the selected saved place changes', async () => {
    // Given: two saved places and recoverable failures that keep both actions available.
    const attachPlaceCandidateFromExisting = vi.fn(async (): Promise<PlaceCandidateAttachmentResult> => {
      throw new Error('retryable');
    });
    const api = makeApi({
      getUserArchives: vi.fn(async () => ({
        archives: [
          makeArchive({ id: 'place-a', locationExternalId: '101' }),
          makeArchive({ id: 'place-b', postId: '202', locationExternalId: '202' }),
        ],
        total: 2, limit: 100, offset: 0, hasMore: false, serverTime: '',
      })),
      attachPlaceCandidateFromExisting,
    });
    const { modal } = openCandidateModal(api, 'existing');
    await vi.waitFor(() => expect(
      modal.contentEl.querySelectorAll('.sa-place-picker-result'),
    ).toHaveLength(2));
    const first = modal.contentEl.querySelectorAll<HTMLButtonElement>('.sa-place-picker-result')[0];
    if (!first) throw new TypeError('Missing first existing-place action');

    // When: the first place fails and the user chooses the distinct second place.
    first.click();
    await vi.waitFor(() => expect(attachPlaceCandidateFromExisting).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(
      modal.contentEl.querySelector('.sa-place-picker-status.mod-error'),
    ).not.toBeNull());
    const second = modal.contentEl.querySelectorAll<HTMLButtonElement>('.sa-place-picker-result')[1];
    if (!second) throw new TypeError('Missing second existing-place action');
    second.click();
    await vi.waitFor(() => expect(attachPlaceCandidateFromExisting).toHaveBeenCalledTimes(2));

    // Then: the changed place identity receives a fresh mutation identity.
    expect(attachPlaceCandidateFromExisting.mock.calls[1]?.[1].idempotencyKey)
      .not.toBe(attachPlaceCandidateFromExisting.mock.calls[0]?.[1].idempotencyKey);
  });

  it('reports candidate-picker cancellation exactly once', async () => {
    const { modal, onClosed } = openCandidateModal(makeApi());
    modal.close();
    modal.close();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'Sign in again to search for places.'],
    [429, 'Too many place searches. Please wait and try again.'],
    [503, 'Place search is temporarily unavailable.'],
    [undefined, 'You appear to be offline. Check your connection and try again.'],
  ])('maps %s search failures to actionable copy', (status, expected) => {
    // Given: a request failure at the search boundary.
    const error = new Error('request failed') as Error & { status?: number };
    if (status !== undefined) error.status = status;

    // When/Then: the picker provides a stable, user-actionable message.
    expect(getArchivePlacePickerError(error, 'search')).toBe(expected);
  });

  it.each([
    ['INSUFFICIENT_CREDITS', 'Not enough Cloud credits'],
    ['GOOGLE_DAILY_LIMIT', 'Google Maps search limit'],
    ['GOOGLE_PROJECT_MONTHLY_LIMIT', 'Google Maps project limit'],
    ['GOOGLE_BURST_LIMIT', 'Google Maps search is busy'],
    ['GOOGLE_PLACES_SEARCH_DISABLED', 'Google Maps search is unavailable'],
  ] as const)('maps provider gate %s without automatic fallback', (code, expected) => {
    // Given: a typed Worker provider-limit failure.
    const error = new Error('request failed') as Error & { code?: string; status?: number };
    error.code = code;
    error.status = 503;

    // When/Then: the same provider receives explicit recovery copy.
    expect(getArchivePlacePickerError(error, 'search')).toContain(expected);
  });
});
