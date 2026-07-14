import { Modal, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import {
  ArchivePlacePickerModal,
  dedupeExistingPlaceArchives,
  getArchivePlacePickerError,
  type ArchivePlacePickerApi,
} from '@/components/timeline/modals/ArchivePlacePickerModal';
import type {
  ProviderPlaceSelectionResponse,
  ProviderSearchResponse,
  UserArchive,
} from '@/services/WorkersAPIClient';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
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

function selectionResponse(): ProviderPlaceSelectionResponse {
  return {
    sourceArchiveId: 'source-1',
    targetArchiveId: 'place-1',
    enrichment: 'queued',
    place: {
      provider: 'kakaomap',
      externalId: '101',
      name: '희작',
      category: '카페',
      address: '서울 종로구 백석동길 155',
      latitude: 37.1,
      longitude: 126.9,
      phone: '',
      canonicalUrl: 'https://place.map.kakao.com/101',
    },
  };
}

function makeApi(overrides: Partial<ArchivePlacePickerApi> = {}): ArchivePlacePickerApi {
  return {
    getUserArchives: vi.fn(async () => ({
      archives: [], total: 0, limit: 100, offset: 0, hasMore: false, serverTime: '',
    })),
    setArchivePlace: vi.fn(async () => undefined),
    searchProviderPlaces: vi.fn(async (query) => searchResponse(query, '101')),
    selectProviderPlace: vi.fn(async () => selectionResponse()),
    ...overrides,
  };
}

function openModal(api: ArchivePlacePickerApi, currentLocation: string | null = null): ArchivePlacePickerModal {
  const modal = new ArchivePlacePickerModal({} as App, {
    archiveId: 'source-1',
    currentLocation,
    api,
    onChanged: vi.fn(async () => undefined),
  });
  modal.open();
  return modal;
}

describe('ArchivePlacePickerModal', () => {
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
    await vi.waitFor(() => expect(modal.contentEl.querySelectorAll('.sa-place-picker-result')).toHaveLength(2));

    // Then: each row carries provider/category/address metadata, not only its name.
    const text = modal.contentEl.textContent ?? '';
    expect(text).toContain('Kakao Map');
    expect(text).toContain('카페');
    expect(text).toContain('서울 종로구 백석동길 155');
    expect(text).toContain('한식');
    expect(text).toContain('서울 마포구 연남동');
  });

  it('suppresses stale search responses and preserves Kakao attribution', async () => {
    // Given: an older search that resolves after a newer search.
    vi.useFakeTimers();
    const first = deferred<ProviderSearchResponse>();
    const second = deferred<ProviderSearchResponse>();
    const api = makeApi({
      searchProviderPlaces: vi.fn((query) => query === 'old' ? first.promise : second.promise),
    });
    const modal = openModal(api);
    modal.contentEl.querySelector<HTMLButtonElement>('[data-view="search"]')?.click();
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');

    // When: the second query completes before the first.
    if (input) {
      input.value = 'old';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(320);
      input.value = 'new';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(320);
    }
    second.resolve(searchResponse('new', '202'));
    await vi.advanceTimersByTimeAsync(0);
    first.resolve(searchResponse('old', '101'));
    await vi.advanceTimersByTimeAsync(0);

    // Then: only the newest response is visible, with provider attribution.
    expect(modal.contentEl.textContent).toContain('new 장소');
    expect(modal.contentEl.textContent).not.toContain('old 장소');
    expect(modal.contentEl.textContent).toContain('Search results provided by Kakao');
    vi.useRealTimers();
  });

  it('cancels pending search work before reloading the Existing view', async () => {
    // Given: a debounced query and a delayed Existing reload.
    vi.useFakeTimers();
    const reload = deferred<Awaited<ReturnType<ArchivePlacePickerApi['getUserArchives']>>>();
    const getUserArchives = vi.fn()
      .mockResolvedValueOnce({ archives: [], total: 0, limit: 100, offset: 0, hasMore: false, serverTime: '' })
      .mockReturnValueOnce(reload.promise);
    const api = makeApi({ getUserArchives });
    const modal = openModal(api);
    await vi.advanceTimersByTimeAsync(0);
    modal.contentEl.querySelector<HTMLButtonElement>('[data-view="search"]')?.click();
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
    if (input) {
      input.value = '희작';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // When: the user returns to Existing before the debounce expires.
    modal.contentEl.querySelector<HTMLButtonElement>('[data-view="existing"]')?.click();
    await vi.advanceTimersByTimeAsync(320);
    reload.resolve({ archives: [makeArchive({})], total: 1, limit: 100, offset: 0, hasMore: false, serverTime: '' });
    await vi.advanceTimersByTimeAsync(0);

    // Then: the reload completes and the abandoned query never invalidates it.
    expect(api.searchProviderPlaces).not.toHaveBeenCalled();
    expect(modal.contentEl.textContent).toContain('희작');
    expect(modal.contentEl.textContent).not.toContain('Loading saved places…');
    vi.useRealTimers();
  });

  it('supports the complete keyboard tab and tabpanel relationship', async () => {
    // Given: the Existing tab is active.
    const modal = openModal(makeApi());
    const existing = modal.contentEl.querySelector<HTMLButtonElement>('[data-view="existing"]');
    const search = modal.contentEl.querySelector<HTMLButtonElement>('[data-view="search"]');

    // When: ArrowRight moves to Search Kakao.
    existing?.focus();
    existing?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    // Then: focus, roving tabindex, and the controlled panel all identify Search Kakao.
    expect(document.activeElement).toBe(search);
    expect(existing?.tabIndex).toBe(-1);
    expect(search?.tabIndex).toBe(0);
    expect(search?.getAttribute('aria-selected')).toBe('true');
    expect(search?.getAttribute('aria-controls')).toBe('sa-place-picker-panel');
    const panel = modal.contentEl.querySelector('[role="tabpanel"]');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('sa-place-picker-tab-search');
  });

  it('submits the selection token, closes immediately, and reports queued enrichment', async () => {
    // Given: a visible signed search result.
    const selectProviderPlace = vi.fn(async () => selectionResponse());
    const onChanged = vi.fn(async () => undefined);
    const api = makeApi({ selectProviderPlace });
    const modal = new ArchivePlacePickerModal({} as App, {
      archiveId: 'source-1', currentLocation: null, api, onChanged,
    });
    modal.open();
    modal.contentEl.querySelector<HTMLButtonElement>('[data-view="search"]')?.click();
    const input = modal.contentEl.querySelector<HTMLInputElement>('.sa-place-picker-search-input');
    if (input) input.value = '희작';

    // When: Enter searches and the result is selected.
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-result')).toBeTruthy());
    modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-result')?.click();
    await vi.waitFor(() => expect(selectProviderPlace).toHaveBeenCalled());

    // Then: the signed token is submitted and the modal closes without enrichment polling.
    expect(selectProviderPlace.mock.calls[0]?.[0]).toBe('source-1');
    expect(selectProviderPlace.mock.calls[0]?.[1]).toBe('token-101');
    await vi.waitFor(() => expect(document.body.contains(modal.modalEl)).toBe(false));
    expect(onChanged).toHaveBeenCalledWith({ targetArchiveId: 'place-1', enrichment: 'queued' });
  });

  it('retains detach and exposes keyboard/focus semantics', async () => {
    // Given: an archive with a linked place.
    const setArchivePlace = vi.fn(async () => undefined);
    const api = makeApi({ setArchivePlace });
    const modal = openModal(api, '희작');
    await vi.waitFor(() => expect(modal.contentEl.querySelector('.sa-place-picker-detach')).toBeTruthy());

    // When: a keyboard user activates detach.
    const detach = modal.contentEl.querySelector<HTMLButtonElement>('.sa-place-picker-detach');
    detach?.focus();
    detach?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    detach?.click();
    await vi.waitFor(() => expect(setArchivePlace).toHaveBeenCalledWith('source-1', null));

    // Then: native tab/button semantics and named tabs are present.
    expect(detach?.tagName).toBe('BUTTON');
    expect(modal.contentEl.querySelector('[role="tablist"]')).toBeTruthy();
    expect(modal.contentEl.querySelector('[role="tab"][aria-selected="true"]')).toBeTruthy();
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
});
