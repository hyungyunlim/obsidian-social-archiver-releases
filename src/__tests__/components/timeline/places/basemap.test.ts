import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addBasemap,
  basemapTileUrl,
  currentBasemapTheme,
  observeMapSize,
  renderBasemapAttribution,
} from '@/components/timeline/places/basemap';

vi.mock('leaflet', () => ({
  tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock surface
const L = (await import('leaflet')) as any;

/**
 * The basemap shared by every Leaflet surface in the plugin. It exists because
 * the tile URL was pasted into three renderers; these tests pin the contract
 * those three now depend on.
 */

describe('basemap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.className = '';
  });

  it('follows Obsidian theme, not the OS colour scheme', () => {
    expect(currentBasemapTheme()).toBe('light');

    document.body.classList.add('theme-dark');
    expect(currentBasemapTheme()).toBe('dark');
  });

  it('serves a distinct tile URL per theme', () => {
    expect(basemapTileUrl('light')).not.toBe(basemapTileUrl('dark'));
    for (const theme of ['light', 'dark'] as const) {
      expect(basemapTileUrl(theme)).toMatch(/^https:\/\//);
      expect(basemapTileUrl(theme)).toContain('{z}/{x}/{y}');
    }
  });

  it('no longer points at the OSM tile server, whose policy forbids app use', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(basemapTileUrl(theme)).not.toContain('tile.openstreetmap.org');
    }
  });

  it('adds the layer for the theme in force and hands it back', () => {
    document.body.classList.add('theme-dark');
    const map = {} as never;
    const layer = addBasemap(map);

    expect(L.tileLayer).toHaveBeenCalledWith(basemapTileUrl('dark'), expect.anything());
    // Returned so the caller can setUrl on a theme change instead of
    // re-rendering, which would throw away the camera.
    expect(layer).toBeDefined();
  });

  it('credits both parties the tiles require', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const attribution = renderBasemapAttribution(parent, 'sa-place-map-attr');
    const links = [...attribution.querySelectorAll('a')];

    expect(attribution.classList.contains('sa-place-map-attr')).toBe(true);
    expect(links.map((a) => a.textContent)).toEqual(['OSM', 'CARTO']);
    // Opened outside the vault, so they must not be able to script back into it.
    for (const link of links) {
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
    }
  });

  it('builds the attribution in the parent document, for pop-out windows', () => {
    // The card mini-maps render into detached Obsidian windows; a helper that
    // reached for the global document would put the credit in the wrong window.
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    expect(renderBasemapAttribution(parent, 'x').ownerDocument).toBe(parent.ownerDocument);
  });
});

/**
 * The shared re-measure. Three maps depend on it — the Places map and the two
 * card mini-maps — and all three previously guessed at when layout settles.
 */
describe('observeMapSize', () => {
  let fire: (() => void) | null;
  let disconnects: number;

  function sized(width: number, height: number): HTMLElement {
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
    return element;
  }

  function resize(element: HTMLElement, width: number, height: number): void {
    Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
    fire?.();
  }

  beforeEach(() => {
    fire = null;
    disconnects = 0;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        fire = callback;
      }
      observe(): void {}
      disconnect(): void {
        disconnects += 1;
      }
      unobserve(): void {}
    });
  });

  it('re-measures the map every time the container changes size', () => {
    const map = { invalidateSize: vi.fn() };
    const container = sized(0, 0);
    observeMapSize(map, container);

    resize(container, 400, 300);
    resize(container, 900, 700);

    expect(map.invalidateSize).toHaveBeenCalledTimes(2);
  });

  it('runs the framing callback once, on the first real size', () => {
    // Re-framing on every resize would drag the user back to the opening view
    // each time something above the map appeared.
    const map = { invalidateSize: vi.fn() };
    const container = sized(0, 0);
    const onFirstSize = vi.fn();
    observeMapSize(map, container, onFirstSize);

    resize(container, 400, 300);
    resize(container, 900, 700);

    expect(onFirstSize).toHaveBeenCalledTimes(1);
  });

  it('ignores a zero-sized container', () => {
    // A map hidden with display:none measures 0x0. Acting on that would frame it
    // on nothing and lose wherever the user had panned to.
    const map = { invalidateSize: vi.fn() };
    const container = sized(0, 0);
    const onFirstSize = vi.fn();
    observeMapSize(map, container, onFirstSize);

    resize(container, 0, 0);

    expect(map.invalidateSize).not.toHaveBeenCalled();
    expect(onFirstSize).not.toHaveBeenCalled();
  });

  it('hands back a disconnect', () => {
    const stop = observeMapSize({ invalidateSize: vi.fn() }, sized(10, 10));
    stop();
    expect(disconnects).toBe(1);
  });

  it('is a no-op where ResizeObserver is missing, rather than throwing', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const map = { invalidateSize: vi.fn() };

    expect(() => observeMapSize(map, sized(10, 10))()).not.toThrow();
    expect(map.invalidateSize).not.toHaveBeenCalled();
  });
});
