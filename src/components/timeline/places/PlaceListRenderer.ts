import { Menu, setIcon } from 'obsidian';
import { PLACE_KINDS, type PlaceKind } from '@/shared/platforms/place-kinds';
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

const PRESENTATIONS = ['list', 'map', 'posts'] as const;

const PRESENTATION_ICON: Record<PlacePresentation, string> = {
  list: 'list',
  map: 'map',
  posts: 'newspaper',
};

const PRESENTATION_LABEL: Record<PlacePresentation, string> = {
  list: 'List',
  map: 'Map',
  posts: 'Posts',
};

/** Sentence-case label for a kind chip; null is the unclassified bucket. */
function kindLabel(kind: PlaceKind | null): string {
  if (kind === null) return 'Unclassified';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * The three Places surfaces, matching the mobile places tab exactly
 * (`['places', 'map', 'posts']`): the grouped list, the map alone, or the flat
 * feed of every place-bearing archive. Desktop adds a fourth `split`; the
 * plugin's pane is too narrow for a side-by-side to earn its keep.
 */
export type PlacePresentation = 'list' | 'map' | 'posts';

export interface PlaceListCallbacks {
  /** A place row or marker was activated — open it. */
  onSelect: (place: PlaceSummary) => void;
  /**
   * Draw the map into this container and report whether anything was drawn.
   * Injected rather than imported so the list does not depend on Leaflet — the
   * map module is only reached when the user asks for it.
   */
  renderMap?: (container: HTMLElement, places: PlaceSummary[], selectedKey: string | null) => boolean;
  onPresentationChange?: (presentation: PlacePresentation) => void;
  /**
   * Reclassify a place. Omitted when there is nowhere to write the change, in
   * which case the row icon stays a plain icon rather than offering a menu
   * that cannot do anything.
   */
  onKindChange?: (place: PlaceSummary, placeKind: PlaceKind | null) => void;
  /** Create a place archive from scratch. Omitted when there is no way to. */
  onAddPlace?: () => void;
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

  /** Which surface is showing, so the caller knows whether to draw the feed. */
  getPresentation(): PlacePresentation {
    return this.presentation;
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
    // Map and posts hand the pane to something the reading column should not
    // cap — the map itself, and the timeline's own feed — so the switch above
    // them lines up with the header icons rather than floating mid-pane.
    root.toggleClass('is-map', this.presentation === 'map');
    root.toggleClass('is-posts', this.presentation === 'posts');

    // Map mode is the map and nothing else — the same call the mobile tab makes,
    // where the search field, the chips and the controls row are all gated on
    // `viewMode === 'places'`. Every strip left above the map is a strip of pane
    // the map does not get, which is what made it read as a thumbnail.
    const toolbar = root.createDiv({ cls: 'sa-place-toolbar' });
    if (this.presentation === 'list') this.renderSearch(toolbar);
    this.renderAddPlace(toolbar);
    if (this.callbacks.renderMap) this.renderPresentationToggle(toolbar);

    if (this.presentation === 'map') {
      // The map surface always renders something — a map, or a line explaining
      // why not. It never silently reverts to the list, which made the toggle
      // look dead when Leaflet failed to initialise.
      this.callbacks.renderMap?.(root, this.visiblePlaces(), this.selectedKey);
      return;
    }

    // Posts mode shows the flat feed, which the timeline owns; the list renders
    // only its switch so there is a way back.
    if (this.presentation === 'posts') return;

    this.renderChips(root);

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

  /**
   * Create a place with no host archive.
   *
   * Every other route to a place attaches one to a post, so this is the only way
   * to save a place for its own sake. It sits beside the view switch because
   * that is where the eye already is when the answer to "where is that place I
   * saved" turns out to be "I never saved it".
   */
  private renderAddPlace(parent: HTMLElement): void {
    const onAddPlace = this.callbacks.onAddPlace;
    if (!onAddPlace) return;

    const btn = parent.createEl('button', { cls: 'sa-place-add' });
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Add a place');
    btn.setAttribute('title', 'Add a place');
    setIcon(btn.createDiv({ cls: 'sa-icon-16' }), 'map-pin-plus');
    btn.addEventListener('click', () => onAddPlace());
  }

  /**
   * A dropdown, matching desktop's view-mode button. A segmented control put
   * three targets in a toolbar that already carries the timeline's own icon row
   * right above it, and the two rows of buttons read as one crowded strip.
   *
   * Obsidian's own `Menu` rather than a hand-rolled popup: it brings the
   * positioning, the outside-click dismiss, keyboard navigation and the check
   * mark, none of which is worth reimplementing for three items.
   */
  private renderPresentationToggle(parent: HTMLElement): void {
    const btn = parent.createEl('button', { cls: 'sa-place-mode-trigger' });
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-label', `Places view: ${PRESENTATION_LABEL[this.presentation]}`);
    btn.setAttribute('title', 'Change places view');

    setIcon(btn.createDiv({ cls: 'sa-icon-16' }), PRESENTATION_ICON[this.presentation]);
    btn.createSpan({ cls: 'sa-place-mode-label', text: PRESENTATION_LABEL[this.presentation] });
    setIcon(btn.createDiv({ cls: 'sa-icon-16 sa-place-mode-caret' }), 'chevron-down');

    btn.addEventListener('click', (event) => {
      const menu = new Menu();
      for (const mode of PRESENTATIONS) {
        menu.addItem((item) => {
          item
            .setTitle(PRESENTATION_LABEL[mode])
            .setIcon(PRESENTATION_ICON[mode])
            .setChecked(this.presentation === mode)
            .onClick(() => {
              if (this.presentation === mode) return;
              this.presentation = mode;
              this.callbacks.onPresentationChange?.(mode);
              this.renderBody();
            });
        });
      }
      menu.showAtMouseEvent(event);
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

  /**
   * The place-type picker, on the row's icon — mobile and desktop both put it
   * there, on the place bubble.
   *
   * Obsidian's `Menu` again, so fifteen kinds get scrolling, keyboard navigation
   * and a check mark for free. "Unclassified" is an entry rather than a separate
   * clear button, because clearing IS choosing a kind here.
   */
  private openKindMenu(event: MouseEvent, place: PlaceSummary): void {
    const onKindChange = this.callbacks.onKindChange;
    if (!onKindChange) return;

    const menu = new Menu();
    const choose = (kind: PlaceKind | null): void => {
      if (place.placeKind === kind || (!place.placeKind && kind === null)) return;
      onKindChange(place, kind);
    };

    menu.addItem((item) => {
      item
        .setTitle(kindLabel(null))
        .setIcon('map-pin')
        .setChecked(!place.placeKind)
        .onClick(() => choose(null));
    });
    for (const kind of PLACE_KINDS) {
      menu.addItem((item) => {
        item
          .setTitle(kindLabel(kind))
          .setIcon(KIND_ICON[kind] ?? 'map-pin')
          .setChecked(place.placeKind === kind)
          .onClick(() => choose(kind));
      });
    }
    menu.showAtMouseEvent(event);
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
    // A div with a button role, not a <button>, so the kind picker inside it is
    // a real button rather than illegal nested interactive content. Desktop's
    // place row is built the same way, and it sidesteps the inherited fill that
    // Obsidian gives bare buttons.
    const row = parent.createDiv({ cls: 'sa-place-row' });
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    // `is-selected` marks the last place opened so returning from its detail
    // shows where you were. Not aria-pressed — the row opens, it does not toggle.
    if (selected) row.addClass('is-selected');
    row.setAttribute('aria-label', place.name);

    // The icon opens the kind picker, matching mobile and desktop where the
    // place bubble is its own control. Only a button when there is something to
    // pick — a plain div otherwise, so nothing offers a menu that cannot open.
    const editable = Boolean(this.callbacks.onKindChange);
    const icon = editable
      ? row.createEl('button', { cls: 'sa-place-row-icon is-editable' })
      : row.createDiv({ cls: 'sa-place-row-icon' });
    setIcon(icon, (place.placeKind && KIND_ICON[place.placeKind]) || 'map-pin');

    if (editable && icon instanceof HTMLButtonElement) {
      icon.type = 'button';
      icon.setAttribute('aria-haspopup', 'menu');
      icon.setAttribute('aria-label', `Change place type for ${place.name}`);
      icon.setAttribute('title', 'Change place type');
      icon.addEventListener('click', (event) => {
        // The row opens the place; the icon must not also do that.
        event.stopPropagation();
        this.openKindMenu(event, place);
      });
    }

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

    // Opens the place, it does not toggle a filter. A row and a marker are the
    // same gesture with the same destination, which is what the mobile tab does
    // — both routes land on the place screen.
    const open = (): void => {
      this.selectedKey = place.placeKey;
      this.callbacks.onSelect(place);
    };
    row.addEventListener('click', open);
    // A div with a button role has to bring its own keyboard activation.
    row.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  }
}
