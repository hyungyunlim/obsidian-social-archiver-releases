import * as L from 'leaflet';
import type { PlaceSummary } from '@/utils/placeAggregation';
import {
  addBasemap,
  basemapTileUrl,
  currentBasemapTheme,
  observeMapSize,
  renderBasemapAttribution,
} from './basemap';

/**
 * The places map — one marker per place that has coordinates.
 *
 * Leaflet, not MapLibre — and now for a measured reason rather than a budgetary
 * one. MapLibre cannot run in Obsidian at all: it needs a Web Worker and the app
 * offers a plugin no way to construct one. See `basemap.ts` for the probe
 * results and what they rule out.
 *
 * ponytail: no clustering. Measured on a real vault the whole corpus is 45
 * places, which reads fine as plain markers. Revisit if a vault ever shows
 * enough places to overlap illegibly — that is the signal, not a guess.
 *
 * Single Responsibility: draw places on a map and report marker clicks. It owns
 * no data loading and no filter state.
 */

/** Zoom used when a single place is all there is to show. */
const SINGLE_PLACE_ZOOM = 14;
/** Keeps a tight cluster of places from zooming to street level. */
const MAX_FIT_ZOOM = 15;
/**
 * Below this, labels are hidden and only dots remain.
 *
 * Progressive disclosure, which is what mobile and desktop do. Permanent labels
 * were the actual reason the zoomed-out map was unreadable: 44 dots over Korea
 * is legible, 44 name plates on top of each other is not.
 */
const LABEL_MIN_ZOOM = 10;
/**
 * Places further than this from the anchor are left out of the initial fit.
 *
 * One archive in England alongside forty in Korea made `fitBounds` frame the
 * whole planet, which is how every marker ended up stacked in one column. The
 * outlier stays on the map — zooming out still reaches it — it just does not get
 * to decide the opening view.
 */
const FIT_RADIUS_KM = 300;

export interface PlaceMapCallbacks {
  onSelect: (place: PlaceSummary) => void;
}

export class PlaceMapRenderer {
  private containerEl: HTMLElement | null = null;
  private map: L.Map | null = null;
  private basemap: L.TileLayer | null = null;
  private stopObservingSize: (() => void) | null = null;

  constructor(private readonly callbacks: PlaceMapCallbacks) {}

  /**
   * Follow Obsidian's theme. Swaps the tile URL on the existing layer rather
   * than re-rendering, so the camera survives — a theme toggle should not throw
   * away wherever the user had panned to.
   */
  syncTheme(): void {
    this.basemap?.setUrl(basemapTileUrl(currentBasemapTheme()));
  }

  /**
   * Tear the map down. Leaflet holds listeners on window and on its own panes,
   * so `remove()` has to run before the element goes — dropping the element
   * alone leaks the map.
   */
  destroy(): void {
    this.stopObservingSize?.();
    this.stopObservingSize = null;
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.basemap = null;
    this.containerEl?.remove();
    this.containerEl = null;
  }

  /**
   * Render markers for every place with coordinates.
   *
   * Always returns a container — the map, or a line explaining why not. Never
   * null: a caller that silently falls back to the list makes the toggle look
   * broken, which is how the missing center/zoom presented.
   */
  render(
    parent: HTMLElement,
    places: readonly PlaceSummary[],
    selectedKey: string | null = null,
  ): HTMLElement | null {
    this.destroy();

    // Narrowed into a local shape so the coordinates are typed from here on,
    // rather than asserted non-null at every use.
    const mappable: { place: PlaceSummary; position: L.LatLngTuple }[] = [];
    for (const place of places) {
      if (!place.hasCoords) continue;
      if (typeof place.latitude !== 'number' || typeof place.longitude !== 'number') continue;
      mappable.push({ place, position: [place.latitude, place.longitude] });
    }
    // Nothing to map is a real state, not a failure — but it has to be visible.
    // Returning null here is what made the toggle look dead.
    if (mappable.length === 0) {
      this.containerEl = parent.createDiv({
        cls: 'sa-place-map-error',
        text: 'None of these places have coordinates yet.',
      });
      return this.containerEl;
    }

    this.containerEl = parent.createDiv({ cls: 'sa-place-map' });

    try {
      const first = mappable[0];
      this.map = L.map(this.containerEl, {
        // Required BEFORE any layer is added: Leaflet throws "Set map center
        // and zoom first." otherwise, and this method's catch turned that throw
        // into a silent fallback to the list — a toggle that looked dead.
        // fitBounds below overrides this when there is more than one place.
        center: first ? first.position : [0, 0],
        zoom: SINGLE_PLACE_ZOOM,
        zoomControl: !L.Browser.mobile,
        attributionControl: false,
        // Unlike the card's static preview this map IS the control. Wheel zoom
        // included, and Leaflet zooms toward the pointer rather than the centre,
        // so the spot under the cursor is what you close in on. The cost is that
        // a wheel gesture over the map zooms instead of scrolling the timeline —
        // deliberate, since the map is the thing you came to this panel for.
        scrollWheelZoom: true,
      });

      this.basemap = addBasemap(this.map);
      renderBasemapAttribution(this.containerEl, 'sa-place-map-attr');

      const bounds: L.LatLngTuple[] = [];
      for (const { place, position } of mappable) {
        bounds.push(position);

        const marker = L.marker(position, {
          icon: this.markerIcon(place, place.placeKey === selectedKey),
          title: place.name,
          alt: place.name,
        }).addTo(this.map);

        marker.on('click', () => this.callbacks.onSelect(place));
      }

      this.applyInitialView(mappable);

      // Labels are a zoom-dependent class on the container, not per-marker
      // state, so panning and zooming never re-create a marker.
      const syncLabelVisibility = (): void => {
        const zoom = this.map?.getZoom() ?? 0;
        this.containerEl?.toggleClass('sa-place-map-labels', zoom >= LABEL_MIN_ZOOM);
      };
      this.map.on('zoomend', syncLabelVisibility);
      syncLabelVisibility();

      // The opening view is framed on the first real measurement, not now:
      // the container is still laying out, and framing on a short size is
      // what displaced every marker until a zoom made Leaflet recompute.
      this.stopObservingSize = observeMapSize(
        this.map,
        this.containerEl,
        () => this.applyInitialView(mappable),
      );
    } catch (error) {
      // Say so rather than vanishing. Silently reverting is exactly how the
      // missing center/zoom presented: the button appeared to do nothing.
      console.warn('[Social Archiver] Places map failed to initialise:', error);
      if (this.map) {
        this.map.remove();
        this.map = null;
      }
      this.basemap = null;
      this.containerEl?.empty();
      this.containerEl?.createDiv({
        cls: 'sa-place-map-error',
        text: 'The map could not be loaded. Switch back to the list to see your places.',
      });
      return this.containerEl;
    }

    return this.containerEl;
  }

  /**
   * Frame the densest neighbourhood rather than every last outlier.
   *
   * Anchored on the most recently referenced place because that is the one the
   * user just touched, so it is the most useful thing to be looking at.
   */
  private applyInitialView(mappable: { place: PlaceSummary; position: L.LatLngTuple }[]): void {
    if (!this.map || mappable.length === 0) return;

    const anchor = mappable.reduce((newest, candidate) =>
      candidate.place.lastReferencedAt > newest.place.lastReferencedAt ? candidate : newest);

    const near = mappable.filter(
      (entry) => haversineKm(anchor.position, entry.position) <= FIT_RADIUS_KM,
    );

    if (near.length <= 1) {
      this.map.setView(anchor.position, SINGLE_PLACE_ZOOM);
      return;
    }
    this.map.fitBounds(L.latLngBounds(near.map((entry) => entry.position)), {
      padding: [24, 24],
      maxZoom: MAX_FIT_ZOOM,
    });
  }

  private markerIcon(place: PlaceSummary, selected: boolean): L.DivIcon {
    // A div icon rather than an image, so no asset ships and no request is made.
    return L.divIcon({
      className: `sa-place-marker${selected ? ' is-selected' : ''}`,
      html: `<span class="sa-place-marker-dot"></span><span class="sa-place-marker-label">${escapeHtml(place.name)}</span>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  }
}

/** Great-circle distance in km. Only used to decide what the opening view frames. */
function haversineKm(a: L.LatLngTuple, b: L.LatLngTuple): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const EARTH_KM = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Place names come from provider APIs and user edits, and Leaflet's `html`
 * option takes a raw string — so this is the one spot in the plugin where a
 * place name reaches an HTML sink.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
