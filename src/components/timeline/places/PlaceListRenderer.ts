import { setIcon } from 'obsidian';
import type { PlaceKind } from '@/shared/platforms/place-kinds';
import {
  availablePlaceKinds,
  availablePlaceProviders,
  filterPlacesByKinds,
  filterPlacesByProvider,
  filterPlacesBySearch,
  sortPlaces,
  type PlaceSort,
  type PlaceSummary,
} from '@/utils/placeAggregation';

/**
 * The grouped place list — one row per place, the primary Places surface on
 * mobile, desktop and share-web alike.
 *
 * A LIST rather than a chip bar, unlike Shopping. Measured on a real vault the
 * cardinality is inverted: 14 place-bearing notes yielded 45 distinct places
 * with only 2 appearing more than once, so a chip per place would mean 45 chips
 * for 14 notes. Stores repeat; places mostly do not. `placeKind` is the axis
 * that does group — 48 references collapsed to 4 kinds — so that is what the
 * chips filter on.
 *
 * Single Responsibility: render the place list and report selection. It receives
 * an already-aggregated list and owns no data loading.
 */

const KIND_ICON: Partial<Record<PlaceKind, string>> = {
  restaurant: 'utensils',
  cafe: 'coffee',
  bakery: 'croissant',
  bar: 'wine',
  hospital: 'cross',
  pharmacy: 'pill',
  fitness: 'dumbbell',
  kids: 'baby',
  hotel: 'bed',
  culture: 'landmark',
  outdoor: 'trees',
  shopping: 'shopping-bag',
  transit: 'train-front',
  education: 'graduation-cap',
  public: 'building-2',
};

/** Sentence-case label for a kind chip; null is the unclassified bucket. */
function kindLabel(kind: PlaceKind | null): string {
  if (kind === null) return 'Unclassified';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export type PlacePresentation = 'list' | 'map';

export interface PlaceListCallbacks {
  /** A place row was activated. Null clears the selection. */
  onSelect: (place: PlaceSummary | null) => void;
  /**
   * Draw the map into this container and report whether anything was drawn.
   * Injected rather than imported so the list does not depend on Leaflet — the
   * map module is only reached when the user asks for it.
   */
  renderMap?: (container: HTMLElement, places: PlaceSummary[], selectedKey: string | null) => boolean;
  onPresentationChange?: (presentation: PlacePresentation) => void;
}

export class PlaceListRenderer {
  private containerEl: HTMLElement | null = null;
  private places: PlaceSummary[] = [];

  private search = '';
  private kinds = new Set<PlaceKind | null>();
  private provider: string | null = null;
  private sort: PlaceSort = 'recent';
  private selectedKey: string | null = null;
  private presentation: PlacePresentation = 'list';

  constructor(private readonly callbacks: PlaceListCallbacks) {}

  /** Current selection, so the caller can reconcile after the data changes. */
  getSelectedKey(): string | null {
    return this.selectedKey;
  }

  destroy(): void {
    this.containerEl?.remove();
    this.containerEl = null;
  }

  render(parent: HTMLElement, places: PlaceSummary[], selectedKey: string | null = null): HTMLElement {
    this.destroy();
    this.places = places;
    this.selectedKey = selectedKey;

    // Drop filter selections the new data no longer offers, so a stale chip
    // cannot pin the list to an empty result with nothing visible to unset.
    const kinds = new Set(availablePlaceKinds(places));
    for (const kind of [...this.kinds]) if (!kinds.has(kind)) this.kinds.delete(kind);
    if (this.provider && !availablePlaceProviders(places).includes(this.provider)) this.provider = null;

    this.containerEl = parent.createDiv({ cls: 'sa-place-list' });
    this.renderBody();
    return this.containerEl;
  }

  private visiblePlaces(): PlaceSummary[] {
    return sortPlaces(
      filterPlacesByProvider(
        filterPlacesByKinds(filterPlacesBySearch(this.places, this.search), this.kinds),
        this.provider,
      ),
      this.sort,
    );
  }

  private renderBody(): void {
    const root = this.containerEl;
    if (!root) return;
    root.empty();

    const toolbar = root.createDiv({ cls: 'sa-place-toolbar' });
    this.renderSearch(toolbar);
    if (this.callbacks.renderMap) this.renderPresentationToggle(toolbar);
    this.renderChips(root);

    if (this.presentation === 'map') {
      // The map surface always renders something — a map, or a line explaining
      // why not. It never silently reverts to the list, which made the toggle
      // look dead when Leaflet failed to initialise.
      this.callbacks.renderMap?.(root, this.visiblePlaces(), this.selectedKey);
      return;
    }

    const visible = this.visiblePlaces();
    if (visible.length === 0) {
      root.createDiv({
        cls: 'sa-place-list-empty',
        text: this.places.length === 0
          ? 'No places yet. Attach a place to an archive and it appears here.'
          : 'No places match the current filters.',
      });
      return;
    }

    const list = root.createDiv({ cls: 'sa-place-rows' });
    for (const place of visible) this.renderRow(list, place);
  }

  private renderPresentationToggle(parent: HTMLElement): void {
    const btn = parent.createDiv({ cls: 'sa-action-btn sa-bg-transparent sa-place-toggle' });
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    const wantsMap = this.presentation === 'list';
    btn.setAttribute('title', wantsMap ? 'Show on map' : 'Show as list');
    btn.setAttribute('aria-pressed', String(this.presentation === 'map'));

    const icon = btn.createDiv({ cls: 'sa-icon-16 sa-text-muted sa-transition-color' });
    setIcon(icon, wantsMap ? 'map' : 'list');
    btn.createSpan({ cls: 'sa-place-toggle-label', text: wantsMap ? 'Map' : 'List' });

    const toggle = (): void => {
      this.presentation = wantsMap ? 'map' : 'list';
      this.callbacks.onPresentationChange?.(this.presentation);
      this.renderBody();
    };
    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  }

  private renderSearch(root: HTMLElement): void {
    const wrap = root.createDiv({ cls: 'sa-place-search' });
    const input = wrap.createEl('input', {
      cls: 'sa-place-search-input',
      attr: { type: 'text', placeholder: 'Search places', 'aria-label': 'Search places' },
    });
    input.value = this.search;
    input.addEventListener('input', () => {
      this.search = input.value;
      // Re-render only the rows, so typing does not steal focus from the box.
      this.renderRowsOnly();
    });
  }

  /** Repaint the result region, leaving the search box and chips mounted. */
  private renderRowsOnly(): void {
    const root = this.containerEl;
    if (!root) return;
    root.querySelector('.sa-place-rows')?.remove();
    root.querySelector('.sa-place-list-empty')?.remove();

    const visible = this.visiblePlaces();
    if (visible.length === 0) {
      root.createDiv({
        cls: 'sa-place-list-empty',
        text: this.places.length === 0
          ? 'No places yet. Attach a place to an archive and it appears here.'
          : 'No places match the current filters.',
      });
      return;
    }
    const list = root.createDiv({ cls: 'sa-place-rows' });
    for (const place of visible) this.renderRow(list, place);
  }

  private renderChips(root: HTMLElement): void {
    const kinds = availablePlaceKinds(this.places);
    const providers = availablePlaceProviders(this.places);
    // Nothing to narrow when there is only one bucket on both axes.
    if (kinds.length <= 1 && providers.length <= 1) return;

    const bar = root.createDiv({ cls: 'sa-place-chip-bar tag-chip-bar tcb-container' });

    if (kinds.length > 1) {
      for (const kind of kinds) {
        const selected = this.kinds.has(kind);
        this.renderChip(bar, kindLabel(kind), selected, () => {
          if (selected) this.kinds.delete(kind);
          else this.kinds.add(kind);
          this.renderBody();
        });
      }
    }

    if (providers.length > 1) {
      for (const provider of providers) {
        const selected = this.provider === provider;
        this.renderChip(bar, provider, selected, () => {
          this.provider = selected ? null : provider;
          this.renderBody();
        });
      }
    }
  }

  private renderChip(parent: HTMLElement, label: string, selected: boolean, onClick: () => void): void {
    const chip = parent.createDiv({ cls: 'tag-chip tcb-chip' });
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-pressed', String(selected));
    chip.setCssProps({
      '--tcb-bg': selected ? 'var(--interactive-accent)' : 'var(--background-secondary)',
      '--tcb-border': 'transparent',
      '--tcb-color': selected ? 'var(--text-on-accent)' : 'var(--text-muted)',
      '--tcb-font-weight': selected ? '600' : '500',
      '--tcb-hover-bg': selected ? 'var(--interactive-accent)' : 'var(--background-modifier-hover)',
    });
    chip.createSpan({ text: label });
    chip.addEventListener('click', onClick);
    chip.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    });
  }

  private renderRow(parent: HTMLElement, place: PlaceSummary): void {
    const selected = this.selectedKey === place.placeKey;
    const row = parent.createEl('button', { cls: 'sa-place-row' });
    row.type = 'button';
    if (selected) row.addClass('is-selected');
    row.setAttribute('aria-pressed', String(selected));
    row.setAttribute('aria-label', place.name);

    const icon = row.createDiv({ cls: 'sa-place-row-icon' });
    setIcon(icon, (place.placeKind && KIND_ICON[place.placeKind]) || 'map-pin');

    const body = row.createDiv({ cls: 'sa-place-row-body' });
    body.createDiv({ cls: 'sa-place-row-name', text: place.name, attr: { dir: 'auto' } });

    // Address when known, category as the fallback — a place with neither still
    // gets a row rather than a blank line.
    const subtitle = place.address ?? place.category;
    if (subtitle) {
      body.createDiv({ cls: 'sa-place-row-sub', text: subtitle, attr: { dir: 'auto' } });
    }

    const meta = row.createDiv({ cls: 'sa-place-row-meta' });
    if (place.placeArchiveId) {
      const badge = meta.createSpan({ cls: 'sa-place-row-badge' });
      setIcon(badge, 'bookmark-check');
      badge.setAttribute('title', 'This place has its own archive');
    }
    meta.createSpan({ cls: 'sa-place-row-count', text: String(place.archiveCount) });

    row.addEventListener('click', () => {
      // Clicking the selected place clears it, so the row is its own toggle.
      const next = selected ? null : place;
      this.selectedKey = next?.placeKey ?? null;
      this.callbacks.onSelect(next);
    });
  }
}
