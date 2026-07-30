import { describe, expect, it, vi } from 'vitest';
import { PlaceListRenderer } from '@/components/timeline/places/PlaceListRenderer';
import type { PlaceSummary } from '@/utils/placeAggregation';
import type { PlaceKind } from '@/shared/platforms/place-kinds';

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
 * The grouped place list. A list rather than a chip bar because the cardinality
 * is inverted from Shopping: measured on a real vault, 14 place-bearing notes
 * yielded 45 distinct places with only 2 repeating. `placeKind` is the axis that
 * groups, so that is what the chips filter.
 */

function place(overrides: Partial<PlaceSummary> = {}): PlaceSummary {
  return {
    placeKey: 'kakaomap:1',
    name: '개나리',
    address: '서울 성동구',
    archiveCount: 3,
    relatedPostCount: 3,
    locationSource: 'kakaomap',
    placeKind: 'restaurant',
    hasCoords: true,
    placeArchiveState: 'metadata_only',
    lastReferencedAt: Date.parse('2026-07-20T00:00:00.000Z'),
    filePaths: ['a.md'],
    ...overrides,
  } as PlaceSummary;
}

function mount(places: PlaceSummary[], selectedKey: string | null = null): {
  root: HTMLElement;
  onSelect: ReturnType<typeof vi.fn>;
  renderer: PlaceListRenderer;
} {
  const onSelect = vi.fn();
  const renderer = new PlaceListRenderer({ onSelect });
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const root = renderer.render(parent, places, selectedKey);
  return { root, onSelect, renderer };
}

const names = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.sa-place-row-name')].map((el) => el.textContent ?? '');

const chipLabels = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.tcb-chip span')].map((el) => el.textContent ?? '');

describe('PlaceListRenderer', () => {
  it('renders a row per place with its count', () => {
    const { root } = mount([
      place(),
      place({ placeKey: 'k:2', name: '오뎅촌', archiveCount: 2, relatedPostCount: 2 }),
    ]);

    expect(names(root)).toEqual(['개나리', '오뎅촌']);
    expect([...root.querySelectorAll('.sa-place-row-count')].map((e) => e.textContent))
      .toEqual(['3', '2']);
  });

  it('falls back to the category when there is no address', () => {
    const { root } = mount([place({ address: undefined, category: '음식점' })]);
    expect(root.querySelector('.sa-place-row-sub')?.textContent).toBe('음식점');
  });

  it('renders a row even with neither address nor category', () => {
    const { root } = mount([place({ address: undefined, category: undefined })]);
    expect(names(root)).toEqual(['개나리']);
    expect(root.querySelector('.sa-place-row-sub')).toBeNull();
  });

  it('badges a place that has its own archive', () => {
    const { root } = mount([place({ placeArchiveId: 'p1', placeArchiveState: 'archived' })]);
    expect(root.querySelector('.sa-place-row-badge')).not.toBeNull();
  });

  it('reports the place on click, and clears it when clicked again', () => {
    const { root, onSelect } = mount([place()]);
    const row = root.querySelector('.sa-place-row') as HTMLElement;

    row.click();
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ placeKey: 'kakaomap:1' }));

    // Re-render reflecting the selection, then click the same row.
    const second = mount([place()], 'kakaomap:1');
    (second.root.querySelector('.sa-place-row') as HTMLElement).click();
    expect(second.onSelect).toHaveBeenLastCalledWith(null);
  });

  it('marks the selected row', () => {
    const { root } = mount([place(), place({ placeKey: 'k:2', name: 'Other' })], 'k:2');
    const selected = root.querySelectorAll('.sa-place-row.is-selected');

    expect(selected).toHaveLength(1);
    expect(selected[0]?.querySelector('.sa-place-row-name')?.textContent).toBe('Other');
  });

  it('searches name and address', () => {
    const { root } = mount([
      place(),
      place({ placeKey: 'k:2', name: 'Blue Bottle', address: 'Jung-gu' }),
    ]);
    const input = root.querySelector('.sa-place-search-input') as HTMLInputElement;

    input.value = 'jung';
    input.dispatchEvent(new Event('input'));

    expect(names(root)).toEqual(['Blue Bottle']);
  });

  it('keeps the search box mounted while typing', () => {
    // Re-rendering the whole panel per keystroke would drop focus mid-word.
    const { root } = mount([place(), place({ placeKey: 'k:2', name: 'Other' })]);
    const input = root.querySelector('.sa-place-search-input') as HTMLInputElement;

    input.value = 'other';
    input.dispatchEvent(new Event('input'));

    expect(root.querySelector('.sa-place-search-input')).toBe(input);
  });

  it('offers a chip per kind present and filters on it', () => {
    const { root } = mount([
      place({ placeKind: 'restaurant' }),
      place({ placeKey: 'k:2', name: 'Cafe One', placeKind: 'cafe' }),
    ]);

    expect(chipLabels(root)).toEqual(['Restaurant', 'Cafe']);

    const cafeChip = [...root.querySelectorAll('.tcb-chip')]
      .find((el) => el.textContent === 'Cafe') as HTMLElement;
    cafeChip.click();

    expect(names(root)).toEqual(['Cafe One']);
  });

  it('offers an Unclassified bucket, since a third of places have no kind', () => {
    const { root } = mount([
      place({ placeKind: 'restaurant' }),
      place({ placeKey: 'k:2', name: 'Nameless kind', placeKind: undefined }),
    ]);

    expect(chipLabels(root)).toContain('Unclassified');

    const chip = [...root.querySelectorAll('.tcb-chip')]
      .find((el) => el.textContent === 'Unclassified') as HTMLElement;
    chip.click();

    expect(names(root)).toEqual(['Nameless kind']);
  });

  it('renders no chip bar when there is nothing to narrow', () => {
    const { root } = mount([place(), place({ placeKey: 'k:2', name: 'Same kind' })]);
    expect(root.querySelector('.sa-place-chip-bar')).toBeNull();
  });

  it('distinguishes "no places" from "filters hide them"', () => {
    const { root: empty } = mount([]);
    expect(empty.querySelector('.sa-place-list-empty')?.textContent).toContain('No places yet');

    const { root } = mount([place()]);
    const input = root.querySelector('.sa-place-search-input') as HTMLInputElement;
    input.value = 'nothing matches this';
    input.dispatchEvent(new Event('input'));

    expect(root.querySelector('.sa-place-list-empty')?.textContent).toContain('match the current filters');
  });

  it('drops a kind selection the new data no longer offers', () => {
    // Otherwise a stale chip pins the list to an empty result with no visible
    // control to unset it.
    const onSelect = vi.fn();
    const renderer = new PlaceListRenderer({ onSelect });
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const first = renderer.render(parent, [
      place({ placeKind: 'restaurant' }),
      place({ placeKey: 'k:2', name: 'Cafe One', placeKind: 'cafe' }),
    ]);
    ([...first.querySelectorAll('.tcb-chip')]
      .find((el) => el.textContent === 'Cafe') as HTMLElement).click();

    const second = renderer.render(parent, [place({ placeKind: 'restaurant' })]);

    expect(names(second)).toEqual(['개나리']);
  });

  it('uses a kind-specific icon, and a pin when unclassified', () => {
    const { root: cafe } = mount([place({ placeKind: 'cafe' as PlaceKind })]);
    expect((cafe.querySelector('.sa-place-row-icon') as HTMLElement).dataset.icon).toBe('coffee');

    const { root: none } = mount([place({ placeKind: undefined })]);
    expect((none.querySelector('.sa-place-row-icon') as HTMLElement).dataset.icon).toBe('map-pin');
  });
});

/**
 * The map is injected rather than imported, so the list never pulls Leaflet in
 * unless the user asks for it.
 */
describe('PlaceListRenderer — map presentation', () => {
  function mountWithMap(places: PlaceSummary[], drawn = true): {
    root: HTMLElement;
    renderMap: ReturnType<typeof vi.fn>;
  } {
    const renderMap = vi.fn(() => drawn);
    const renderer = new PlaceListRenderer({ onSelect: vi.fn(), renderMap });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return { root: renderer.render(parent, places), renderMap };
  }

  const toggle = (root: HTMLElement): HTMLElement =>
    root.querySelector('.sa-place-toolbar .sa-action-btn') as HTMLElement;

  it('offers no toggle when no map renderer is supplied', () => {
    const { root } = mount([place()]);
    expect(root.querySelector('.sa-place-toolbar .sa-action-btn')).toBeNull();
  });

  it('starts as a list and switches to the map on demand', () => {
    const { root, renderMap } = mountWithMap([place()]);

    expect(renderMap).not.toHaveBeenCalled();
    expect(names(root)).toEqual(['개나리']);

    toggle(root).click();

    expect(renderMap).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.sa-place-rows')).toBeNull();
  });

  it('hands the map only the places passing the current filters', () => {
    const { root, renderMap } = mountWithMap([
      place({ placeKind: 'restaurant' }),
      place({ placeKey: 'k:2', name: 'Cafe One', placeKind: 'cafe' }),
    ]);

    ([...root.querySelectorAll('.tcb-chip')]
      .find((el) => el.textContent === 'Cafe') as HTMLElement).click();
    toggle(root).click();

    expect(renderMap.mock.calls[0]?.[1]).toHaveLength(1);
  });

  it('leaves the map surface to explain itself rather than reverting', () => {
    // Reverting silently is what made the toggle look dead: the user pressed it
    // and the list simply stayed. The map surface always renders something now,
    // and the List button is right there to go back.
    const { root, renderMap } = mountWithMap([place({ hasCoords: false })], false);

    toggle(root).click();

    expect(renderMap).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.sa-place-rows')).toBeNull();
    expect(toggle(root).textContent).toContain('List');
  });

  it('switches back to the list', () => {
    const { root } = mountWithMap([place()]);

    toggle(root).click();
    toggle(root).click();

    expect(names(root)).toEqual(['개나리']);
  });
});
