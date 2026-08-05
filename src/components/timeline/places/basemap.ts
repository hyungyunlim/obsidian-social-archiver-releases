import * as L from 'leaflet';

/**
 * The basemap every Leaflet surface in the plugin draws on — the Places map and
 * the mini-maps on map-place cards.
 *
 * One module because the tile URL and its attribution used to be copy-pasted
 * across three renderers, so changing the basemap meant changing it three times
 * and a fourth caller would have inherited whichever one it was pasted from.
 *
 * ## Why CARTO raster and not our own vector tiles
 *
 * The other clients render `tiles.social-archive.org` (self-hosted Protomaps)
 * through MapLibre. MapLibre cannot run in Obsidian: it parses vector tiles in a
 * Web Worker and has no main-thread mode, and Obsidian gives a plugin no way to
 * construct one. Measured 2026-08-06 on Obsidian 1.12.7 / Electron 39:
 *
 * - a blob worker is constructed but never executes, and reports no error;
 * - a file worker is refused outright, because `getResourcePath` returns a
 *   per-vault `app://<hash>/` origin while the app runs on `app://obsidian.md`,
 *   and a worker script must be same-origin.
 *
 * MapLibre's `-csp` build does not rescue this. It replaces the inline worker
 * with an external one, which solves a strict CSP but not a cross-origin URL.
 *
 * Serving raster from our own tile server was the other candidate and is not
 * practical: `planet.pmtiles` is vector, and a raster planet archive is hundreds
 * of gigabytes that Protomaps does not publish.
 *
 * So a third-party raster provider it is. CARTO needs no API key, serves a
 * matched light/dark pair close to the Protomaps flavors the other clients use,
 * and — unlike `tile.openstreetmap.org`, which this replaces — its terms permit
 * application use. OSM's own tile policy asks apps not to point at it, so this
 * swap fixes that too.
 */

const TILE_URL: Record<'light' | 'dark', string> = {
  light: 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png',
};

/** Obsidian's theme, which is its own setting and not the OS colour scheme. */
export function currentBasemapTheme(doc: Document = document): 'light' | 'dark' {
  return doc.body.classList.contains('theme-dark') ? 'dark' : 'light';
}

export function basemapTileUrl(theme: 'light' | 'dark'): string {
  return TILE_URL[theme];
}

/**
 * Add the basemap to a map and return the layer, so a caller that follows the
 * theme can `setUrl` on it. Swapping the URL keeps the camera; re-creating the
 * map would throw away wherever the user had panned to.
 */
export function addBasemap(map: L.Map, doc: Document = document): L.TileLayer {
  const layer = L.tileLayer(basemapTileUrl(currentBasemapTheme(doc)), {
    maxZoom: 19,
    // CARTO serves @2x tiles; Leaflet fills {r} on retina and leaves it empty
    // otherwise, so one URL covers both.
    detectRetina: true,
  });
  layer.addTo(map);
  return layer;
}

/**
 * Attribution for the basemap. Required by both parties: OSM for the data, CARTO
 * for the rendering.
 */
export function renderBasemapAttribution(parent: HTMLElement, cls: string): HTMLElement {
  const attribution = parent.createDiv({ cls });
  attribution.textContent = '© ';
  appendLink(attribution, 'OSM', 'https://www.openstreetmap.org/copyright');
  // A raw text node rather than Obsidian's `appendText`: this runs inside the
  // map renderer's try/catch, so a helper the environment lacks does not read as
  // "the map failed to initialise".
  attribution.appendChild(attribution.ownerDocument.createTextNode(' · '));
  appendLink(attribution, 'CARTO', 'https://carto.com/attributions');
  return attribution;
}

function appendLink(parent: HTMLElement, text: string, href: string): void {
  const link = parent.createEl('a', { text });
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
}
