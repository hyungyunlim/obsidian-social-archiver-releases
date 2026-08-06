import { describe, expect, it, vi } from 'vitest';
import { Menu } from 'obsidian';
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

  it('opens the place on click, and opening the open one again re-opens it', () => {
    // A row navigates, it does not toggle a filter — same gesture and same
    // destination as a map marker. Clicking the already-open place used to clear
    // the selection, which from a place page reads as the row going dead.
    const { root, onSelect } = mount([place()]);
    (root.querySelector('.sa-place-row') as HTMLElement).click();
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ placeKey: 'kakaomap:1' }));

    const second = mount([place()], 'kakaomap:1');
    (second.root.querySelector('.sa-place-row') as HTMLElement).click();
    expect(second.onSelect)
      .toHaveBeenLastCalledWith(expect.objectContaining({ placeKey: 'kakaomap:1' }));
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

  /** Open the dropdown and pick a mode, the way the user does. */
  function mode(root: HTMLElement, label: string): void {
    (root.querySelector('.sa-place-mode-trigger') as HTMLElement)
      .dispatchEvent(new MouseEvent('click'));
    const menu = Menu.last;
    if (!menu) throw new Error('the switch opened no menu');
    if (!menu.select(label)) throw new Error(`the menu offered no "${label}"`);
  }

  it('offers no switch when no map renderer is supplied', () => {
    const { root } = mount([place()]);
    expect(root.querySelector('.sa-place-mode-trigger')).toBeNull();
  });

  it('offers all three modes and checks the one showing', () => {
    const { root } = mountWithMap([place()]);
    (root.querySelector('.sa-place-mode-trigger') as HTMLElement)
      .dispatchEvent(new MouseEvent('click'));

    expect(Menu.last?.items.map((item) => item.title)).toEqual(['List', 'Map', 'Posts']);
    expect(Menu.last?.items.filter((item) => item.checked).map((item) => item.title))
      .toEqual(['List']);
  });

  it('names the mode showing on the trigger itself', () => {
    const { root } = mountWithMap([place()]);
    expect(root.querySelector('.sa-place-mode-label')?.textContent).toBe('List');

    mode(root, 'Map');

    expect(root.querySelector('.sa-place-mode-label')?.textContent).toBe('Map');
  });

  it('starts as a list and switches to the map on demand', () => {
    const { root, renderMap } = mountWithMap([place()]);

    expect(renderMap).not.toHaveBeenCalled();
    expect(names(root)).toEqual(['개나리']);

    mode(root, 'Map');

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
    mode(root, 'Map');

    expect(renderMap.mock.calls[0]?.[1]).toHaveLength(1);
  });

  it('leaves the map surface to explain itself rather than reverting', () => {
    // Reverting silently is what made the switch look dead: the user pressed it
    // and the list simply stayed. The map surface always renders something now,
    // and List is right there to go back.
    const { root, renderMap } = mountWithMap([place({ hasCoords: false })], false);

    mode(root, 'Map');

    expect(renderMap).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.sa-place-rows')).toBeNull();
    expect(Menu.last?.items.map((item) => item.title)).toContain('List');
  });

  it('switches back to the list', () => {
    const { root } = mountWithMap([place()]);

    mode(root, 'Map');
    mode(root, 'List');

    expect(names(root)).toEqual(['개나리']);
  });

  it('strips the search box and chips in map mode', () => {
    // Mobile parity: the map tab hides the search field, the chip row and the
    // controls row. Every strip left above the map is pane the map does not get,
    // which is what made a full-width map still read as a thumbnail.
    const { root } = mountWithMap([
      place({ placeKind: 'restaurant' }),
      place({ placeKey: 'k:2', name: 'Cafe One', placeKind: 'cafe' }),
    ]);
    expect(root.querySelector('.sa-place-search-input')).not.toBeNull();
    expect(root.querySelector('.sa-place-chip-bar')).not.toBeNull();

    mode(root, 'Map');

    expect(root.querySelector('.sa-place-search-input')).toBeNull();
    expect(root.querySelector('.sa-place-chip-bar')).toBeNull();
    expect(root.classList.contains('is-map')).toBe(true);
  });

  it('renders only the switch in posts mode, and reports the change', () => {
    // Posts is the flat feed, which the timeline owns — the list contributes
    // nothing but the way back.
    const onPresentationChange = vi.fn();
    const renderMap = vi.fn(() => true);
    const renderer = new PlaceListRenderer({
      onSelect: vi.fn(),
      renderMap,
      onPresentationChange,
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const root = renderer.render(parent, [place()]);

    mode(root, 'Posts');

    expect(onPresentationChange).toHaveBeenLastCalledWith('posts');
    expect(renderer.getPresentation()).toBe('posts');
    expect(root.querySelector('.sa-place-rows')).toBeNull();
    expect(renderMap).not.toHaveBeenCalled();
    expect(root.querySelector('.sa-place-mode-trigger')).not.toBeNull();
    expect(root.classList.contains('is-posts')).toBe(true);
  });

  it('does not re-announce the mode already showing', () => {
    const onPresentationChange = vi.fn();
    const renderer = new PlaceListRenderer({
      onSelect: vi.fn(),
      renderMap: vi.fn(() => true),
      onPresentationChange,
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const root = renderer.render(parent, [place()]);

    mode(root, 'List');

    expect(onPresentationChange).not.toHaveBeenCalled();
  });
});

/**
 * The row icon doubles as the place-type picker, the way the place bubble does
 * on mobile and desktop.
 */
describe('PlaceListRenderer — place kind', () => {
  function mountEditable(places: PlaceSummary[]): {
    root: HTMLElement;
    onKindChange: ReturnType<typeof vi.fn>;
    onSelect: ReturnType<typeof vi.fn>;
  } {
    const onKindChange = vi.fn();
    const onSelect = vi.fn();
    const renderer = new PlaceListRenderer({ onSelect, onKindChange });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return { root: renderer.render(parent, places), onKindChange, onSelect };
  }

  const icon = (root: HTMLElement): HTMLElement =>
    root.querySelector('.sa-place-row-icon') as HTMLElement;

  it('leaves the icon inert when there is nowhere to write the change', () => {
    const { root } = mount([place()]);
    expect(icon(root).classList.contains('is-editable')).toBe(false);
    expect(icon(root).tagName).toBe('DIV');
  });

  it('offers Unclassified plus every kind, checking the current one', () => {
    const { root } = mountEditable([place({ placeKind: 'cafe' })]);
    icon(root).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const titles = Menu.last?.items.map((item) => item.title) ?? [];
    expect(titles[0]).toBe('Unclassified');
    expect(titles).toContain('Restaurant');
    expect(titles).toContain('Cafe');
    expect(Menu.last?.items.filter((item) => item.checked).map((item) => item.title))
      .toEqual(['Cafe']);
  });

  it('reports the chosen kind', () => {
    const { root, onKindChange } = mountEditable([place({ placeKind: 'cafe' })]);
    icon(root).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    Menu.last?.select('Bakery');

    expect(onKindChange).toHaveBeenCalledWith(
      expect.objectContaining({ placeKey: 'kakaomap:1' }),
      'bakery',
    );
  });

  it('clears the kind through the Unclassified entry', () => {
    const { root, onKindChange } = mountEditable([place({ placeKind: 'cafe' })]);
    icon(root).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    Menu.last?.select('Unclassified');

    expect(onKindChange).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('does not report the kind already set', () => {
    const { root, onKindChange } = mountEditable([place({ placeKind: 'cafe' })]);
    icon(root).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    Menu.last?.select('Cafe');

    expect(onKindChange).not.toHaveBeenCalled();
  });

  it('does not open the place when the icon is used', () => {
    // The icon sits inside the row, which is itself a button-role target — so
    // the click has to stop there or picking a type would also navigate away.
    const { root, onSelect } = mountEditable([place()]);
    icon(root).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens the place from the keyboard, since the row is not a button element', () => {
    const { root, onSelect } = mountEditable([place()]);
    const row = root.querySelector('.sa-place-row') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

/**
 * Creating a place with no host archive — the only route to a place that is not
 * a property of some post.
 */
describe('PlaceListRenderer — add a place', () => {
  function mountWithAdd(): { root: HTMLElement; onAddPlace: ReturnType<typeof vi.fn> } {
    const onAddPlace = vi.fn();
    const renderer = new PlaceListRenderer({
      onSelect: vi.fn(),
      renderMap: vi.fn(() => true),
      onAddPlace,
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return { root: renderer.render(parent, [place()]), onAddPlace };
  }

  const addButton = (root: HTMLElement): HTMLElement | null =>
    root.querySelector('.sa-place-add');

  it('offers nothing when there is no way to create a place', () => {
    const { root } = mount([place()]);
    expect(addButton(root)).toBeNull();
  });

  it('reports the request', () => {
    const { root, onAddPlace } = mountWithAdd();
    (addButton(root) as HTMLElement).click();
    expect(onAddPlace).toHaveBeenCalledTimes(1);
  });

  it('stays reachable from the map and posts surfaces', () => {
    // Saving a place is not a list-mode action: the thought most often arrives
    // while looking at the map.
    const { root } = mountWithAdd();
    for (const surface of ['Map', 'Posts', 'List']) {
      (root.querySelector('.sa-place-mode-trigger') as HTMLElement)
        .dispatchEvent(new MouseEvent('click'));
      Menu.last?.select(surface);
      expect(addButton(root)).not.toBeNull();
    }
  });
});
