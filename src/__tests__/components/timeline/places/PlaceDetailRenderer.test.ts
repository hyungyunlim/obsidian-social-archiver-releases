import { describe, expect, it, vi } from 'vitest';
import { orderForPlace, PlaceDetailRenderer } from '@/components/timeline/places/PlaceDetailRenderer';
import type { PlaceSummary } from '@/utils/placeAggregation';
import type { PostData } from '@/types/post';

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  return {
    ...actual,
    setIcon(element: HTMLElement, icon: string): void {
      element.dataset.icon = icon;
    },
  };
});

/**
 * One place's page. The load-bearing part is the pin: the place's own provider
 * card lives in `filePaths` like any other archive, so the timeline sort drops
 * it wherever its archive date lands — and a place page whose third card is the
 * place reads as a bug.
 */

function place(overrides: Partial<PlaceSummary> = {}): PlaceSummary {
  return {
    placeKey: 'kakaomap:1',
    name: '개나리',
    address: '서울 성동구',
    archiveCount: 2,
    relatedPostCount: 1,
    locationSource: 'kakaomap',
    locationExternalId: '1',
    placeKind: 'restaurant',
    hasCoords: true,
    latitude: 37.5,
    longitude: 127.0,
    placeArchiveState: 'metadata_only',
    lastReferencedAt: Date.parse('2026-07-20T00:00:00.000Z'),
    filePaths: ['post.md', 'place.md'],
    ...overrides,
  } as PlaceSummary;
}

function post(filePath: string, overrides: Partial<PostData> = {}): PostData {
  return { filePath, platform: 'threads', ...overrides } as PostData;
}

describe('orderForPlace', () => {
  it('keeps only the archives referencing the place', () => {
    const ordered = orderForPlace(place(), [
      post('post.md'),
      post('unrelated.md'),
      post('place.md'),
    ]);

    expect(ordered.map((entry) => entry.filePath)).toEqual(['post.md', 'place.md']);
  });

  it('pins the place own archive first', () => {
    const ordered = orderForPlace(
      place({ placeArchiveId: 'arc-place' }),
      [post('post.md'), post('place.md', { sourceArchiveId: 'arc-place' })],
    );

    expect(ordered.map((entry) => entry.filePath)).toEqual(['place.md', 'post.md']);
  });

  it('matches the place archive on id when sourceArchiveId is absent', () => {
    const ordered = orderForPlace(
      place({ placeArchiveId: 'arc-place' }),
      [post('post.md'), post('place.md', { id: 'arc-place' })],
    );

    expect(ordered[0]?.filePath).toBe('place.md');
  });

  it('leaves the caller order alone when the place has no archive of its own', () => {
    const ordered = orderForPlace(place(), [post('post.md'), post('place.md')]);
    expect(ordered.map((entry) => entry.filePath)).toEqual(['post.md', 'place.md']);
  });

  it('does not reorder when the place archive is not among the posts', () => {
    // The note can be filtered out by the timeline's own filters; pinning
    // nothing is correct, dropping the rest would not be.
    const ordered = orderForPlace(
      place({ placeArchiveId: 'arc-missing' }),
      [post('post.md'), post('place.md')],
    );

    expect(ordered.map((entry) => entry.filePath)).toEqual(['post.md', 'place.md']);
  });
});

describe('PlaceDetailRenderer', () => {
  function mount(places: PlaceSummary, posts: PostData[]): {
    root: HTMLElement;
    onBack: ReturnType<typeof vi.fn>;
    renderCard: ReturnType<typeof vi.fn>;
    onOpenUrl: ReturnType<typeof vi.fn>;
    renderer: PlaceDetailRenderer;
  } {
    const onBack = vi.fn();
    const onOpenUrl = vi.fn();
    const renderCard = vi.fn(async (parent: HTMLElement, entry: PostData) => {
      parent.createDiv({ cls: 'card', text: entry.filePath ?? '' });
    });
    const renderer = new PlaceDetailRenderer({ onBack, renderCard, onOpenUrl });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return { root: renderer.render(parent, places, posts), onBack, renderCard, onOpenUrl, renderer };
  }

  it('heads the page with the place, its subtitle and its count', () => {
    const { root } = mount(place(), [post('post.md')]);

    expect(root.querySelector('.sa-place-detail-name')?.textContent).toBe('개나리');
    expect(root.querySelector('.sa-place-detail-sub')?.textContent).toBe('서울 성동구');
    expect(root.querySelector('.sa-place-detail-count')?.textContent).toBe('2 archives');
  });

  it('singularises a lone archive', () => {
    const { root } = mount(place({ archiveCount: 1 }), [post('post.md')]);
    expect(root.querySelector('.sa-place-detail-count')?.textContent).toBe('1 archive');
  });

  it('reports Back', () => {
    const { root, onBack } = mount(place(), [post('post.md')]);
    (root.querySelector('.sa-place-detail-back') as HTMLElement).click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('draws a card per referencing archive', async () => {
    const { root, renderCard } = mount(place(), [
      post('post.md'),
      post('unrelated.md'),
      post('place.md'),
    ]);
    await vi.waitFor(() => expect(renderCard).toHaveBeenCalledTimes(2));

    expect([...root.querySelectorAll('.card')].map((el) => el.textContent))
      .toEqual(['post.md', 'place.md']);
  });

  it('says so rather than showing an empty page', () => {
    const { root, renderCard } = mount(place({ filePaths: [] }), [post('post.md')]);

    expect(root.querySelector('.sa-place-list-empty')).not.toBeNull();
    expect(renderCard).not.toHaveBeenCalled();
  });

  it('offers the provider links and hands their url over', () => {
    const { root, onOpenUrl } = mount(place(), [post('post.md')]);
    const links = [...root.querySelectorAll('.sa-place-detail-link')] as HTMLElement[];
    expect(links.length).toBeGreaterThan(0);

    links[0]?.click();
    expect(onOpenUrl).toHaveBeenCalledWith(expect.stringMatching(/^https?:\/\//));
  });

  it('abandons an in-flight card loop when the place changes', async () => {
    // Without the generation guard the first loop keeps appending into a
    // detached feed, which lands the previous place cards under the new header.
    let release: (() => void) | null = null;
    const renderCard = vi.fn(async (parent: HTMLElement, entry: PostData) => {
      if (entry.filePath === 'post.md') {
        await new Promise<void>((resolve) => { release = resolve; });
      }
      parent.createDiv({ cls: 'card', text: entry.filePath ?? '' });
    });
    const renderer = new PlaceDetailRenderer({
      onBack: vi.fn(),
      renderCard,
      onOpenUrl: vi.fn(),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    renderer.render(parent, place(), [post('post.md'), post('place.md')]);
    await vi.waitFor(() => expect(release).not.toBeNull());

    const second = renderer.render(parent, place({ placeKey: 'k:2', name: 'Other' }), []);
    release?.();
    await Promise.resolve();

    expect(second.querySelectorAll('.card')).toHaveLength(0);
    expect(renderCard).toHaveBeenCalledTimes(1);
  });
});
