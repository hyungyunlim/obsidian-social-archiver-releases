import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PlaceSummary } from '@/utils/placeAggregation';

/**
 * Leaflet is mocked rather than run. Real Leaflet needs layout jsdom does not
 * provide, and the logic worth pinning is mine, not the library's: which places
 * get a marker, single-place view versus fitBounds, the selected marker, HTML
 * escaping of place names, and the null return that lets the caller fall back to
 * the list.
 */

const marker = { addTo: vi.fn().mockReturnThis(), on: vi.fn() };
const map = {
  remove: vi.fn(),
  setView: vi.fn(),
  fitBounds: vi.fn(),
  invalidateSize: vi.fn(),
  on: vi.fn(),
  getZoom: vi.fn(() => 12),
};

const L = {
  map: vi.fn(() => map),
  tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
  marker: vi.fn(() => marker),
  divIcon: vi.fn((opts: { className: string; html: string }) => opts),
  latLngBounds: vi.fn((coords: unknown) => coords),
  Browser: { mobile: false },
};

vi.mock('leaflet', () => ({ ...L, default: L }));

/**
 * jsdom ships no ResizeObserver, and the renderer's re-measure now hangs off one.
 * This stub records what was observed and lets a test drive a size change, since
 * a real observer would never fire without layout.
 */
let observed: HTMLElement[] = [];
let disconnected = false;
let fireResize: (() => void) | null = null;

vi.stubGlobal('ResizeObserver', class {
  constructor(private readonly callback: () => void) {
    fireResize = () => this.callback();
  }
  observe(element: HTMLElement): void {
    observed.push(element);
  }
  disconnect(): void {
    disconnected = true;
  }
  unobserve(): void {}
});

/** Give the observed container a size and let the observer report it. */
function resize(width: number, height: number): void {
  for (const element of observed) {
    Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
  }
  fireResize?.();
}

const { PlaceMapRenderer } = await import('@/components/timeline/places/PlaceMapRenderer');

function place(overrides: Partial<PlaceSummary> = {}): PlaceSummary {
  return {
    placeKey: 'kakaomap:1',
    name: '개나리',
    archiveCount: 1,
    relatedPostCount: 1,
    hasCoords: true,
    latitude: 37.54,
    longitude: 127.05,
    placeArchiveState: 'metadata_only',
    lastReferencedAt: 0,
    filePaths: ['a.md'],
    ...overrides,
  } as PlaceSummary;
}

function mount(places: PlaceSummary[], selectedKey: string | null = null): {
  root: HTMLElement | null;
  onSelect: ReturnType<typeof vi.fn>;
  renderer: InstanceType<typeof PlaceMapRenderer>;
} {
  const onSelect = vi.fn();
  const renderer = new PlaceMapRenderer({ onSelect });
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return { root: renderer.render(parent, places, selectedKey), onSelect, renderer };
}

beforeEach(() => {
  vi.clearAllMocks();
  observed = [];
  disconnected = false;
  fireResize = null;
  L.map.mockReturnValue(map);
  L.marker.mockReturnValue(marker);
  L.tileLayer.mockReturnValue({ addTo: vi.fn() });
  L.divIcon.mockImplementation((opts: { className: string; html: string }) => opts);
});

describe('PlaceMapRenderer', () => {
  it('renders one marker per place with coordinates', () => {
    mount([place(), place({ placeKey: 'k:2', name: 'Other', latitude: 37.6, longitude: 127.1 })]);

    expect(L.marker).toHaveBeenCalledTimes(2);
  });

  it('skips places with no coordinates', () => {
    mount([
      place(),
      place({ placeKey: 'k:2', hasCoords: false, latitude: undefined, longitude: undefined }),
    ]);

    expect(L.marker).toHaveBeenCalledTimes(1);
  });

  it('sets center and zoom up front, before any layer is added', () => {
    // Leaflet throws "Set map center and zoom first." when a layer is added to a
    // map with no view. This shipped without it, and the catch below turned the
    // throw into a silent fallback — the toggle simply did nothing. The mock
    // could always have caught it; it just was never asked.
    mount([place()]);

    expect(L.map).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ center: [37.54, 127.05], zoom: 14 }),
    );
    const mapCallOrder = L.map.mock.invocationCallOrder[0]!;
    const tileCallOrder = L.tileLayer.mock.invocationCallOrder[0]!;
    expect(mapCallOrder).toBeLessThan(tileCallOrder);
  });

  it('explains itself when no place has coordinates, instead of vanishing', () => {
    const { root } = mount([place({ hasCoords: false, latitude: undefined, longitude: undefined })]);

    expect(root).not.toBeNull();
    expect(root?.textContent).toContain('coordinates');
    expect(L.map).not.toHaveBeenCalled();
  });

  it('explains itself for an empty list too', () => {
    expect(mount([]).root?.textContent).toContain('coordinates');
  });

  it('centres on a single place instead of fitting bounds to a point', () => {
    mount([place()]);

    expect(map.setView).toHaveBeenCalledWith([37.54, 127.05], 14);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('fits bounds for several nearby places, capped so a tight cluster does not zoom to street level', () => {
    mount([place(), place({ placeKey: 'k:2', latitude: 37.6, longitude: 127.1 })]);

    expect(map.setView).not.toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledWith(
      [[37.54, 127.05], [37.6, 127.1]],
      { padding: [24, 24], maxZoom: 15 },
    );
  });

  it('does not let one distant place frame the whole planet', () => {
    // Forty places in Korea plus one in England made fitBounds span the globe,
    // which stacked every marker into a single column. The outlier stays on the
    // map; it just does not decide the opening view.
    mount([
      place({ lastReferencedAt: 2 }),
      place({ placeKey: 'k:2', latitude: 37.6, longitude: 127.1, lastReferencedAt: 1 }),
      place({ placeKey: 'k:3', name: 'Stonehenge', latitude: 51.1789, longitude: -1.8262, lastReferencedAt: 0 }),
    ]);

    // All three still get markers.
    expect(L.marker).toHaveBeenCalledTimes(3);
    // But the fit covers only the two Korean ones.
    expect(map.fitBounds).toHaveBeenCalledWith(
      [[37.54, 127.05], [37.6, 127.1]],
      { padding: [24, 24], maxZoom: 15 },
    );
  });

  it('anchors on the most recently referenced place', () => {
    // That is the one the user just touched, so it is the useful thing to frame.
    mount([
      place({ name: 'Old', latitude: 37.54, longitude: 127.05, lastReferencedAt: 0 }),
      place({ placeKey: 'k:2', name: 'Fresh', latitude: 51.1789, longitude: -1.8262, lastReferencedAt: 99 }),
    ]);

    expect(map.setView).toHaveBeenCalledWith([51.1789, -1.8262], 14);
  });

  it('hides labels until the zoom is close enough', () => {
    // Progressive disclosure, as mobile and desktop do. Permanent labels are what
    // made the zoomed-out map unreadable.
    map.getZoom.mockReturnValue(5);
    const { root } = mount([place()]);
    expect(root?.classList.contains('sa-place-map-labels')).toBe(false);

    map.getZoom.mockReturnValue(12);
    const zoomEnd = map.on.mock.calls.find((call) => call[0] === 'zoomend')?.[1] as () => void;
    zoomEnd();

    expect(root?.classList.contains('sa-place-map-labels')).toBe(true);
  });

  it('marks the selected place', () => {
    mount([place(), place({ placeKey: 'k:2', latitude: 37.6, longitude: 127.1 })], 'k:2');

    const classNames = L.divIcon.mock.calls.map((call) => (call[0] as { className: string }).className);
    expect(classNames).toEqual(['sa-place-marker', 'sa-place-marker is-selected']);
  });

  it('reports the place when its marker is clicked', () => {
    const { onSelect } = mount([place()]);

    const handler = marker.on.mock.calls.find((call) => call[0] === 'click')?.[1] as () => void;
    handler();

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ placeKey: 'kakaomap:1' }));
  });

  it('escapes the place name — Leaflet takes raw HTML', () => {
    // Names come from provider APIs and user edits, and `html` is a raw sink.
    mount([place({ name: '<img src=x onerror=alert(1)>' })]);

    const html = (L.divIcon.mock.calls[0]?.[0] as { html: string }).html;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('enables wheel zoom, which Leaflet centres on the pointer', () => {
    mount([place()]);

    expect(L.map).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scrollWheelZoom: true }),
    );
  });

  it('re-frames after re-measuring, not just invalidating size', () => {
    // Marker pixel positions come from the container size measured at init. In a
    // timeline still laying out that is stale, so every marker sits offset by the
    // difference — tens of kilometres at country zoom — until some later zoom
    // makes Leaflet recompute. invalidateSize alone fixes the tiles and keeps the
    // wrong view, so the view has to be applied again.
    mount([place(), place({ placeKey: 'k:2', latitude: 37.6, longitude: 127.1 })]);
    const fitsBefore = map.fitBounds.mock.calls.length;

    resize(400, 300);

    expect(map.invalidateSize).toHaveBeenCalled();
    expect(map.fitBounds.mock.calls.length).toBeGreaterThan(fitsBefore);
  });

  it('watches the container rather than betting on one frame', () => {
    // The previous fix was a single requestAnimationFrame, which assumes layout
    // has settled by the next frame. It has not whenever something sizes later —
    // a banner appearing above the map, a font finishing loading, the pane moving
    // between sidebar and main area — and Leaflet never re-measures on its own.
    mount([place()]);
    expect(observed).toHaveLength(1);

    resize(400, 300);
    const afterFirst = map.invalidateSize.mock.calls.length;
    resize(900, 700);

    expect(map.invalidateSize.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('frames the opening view once, so a later resize cannot yank the camera', () => {
    // Re-fitting on every resize would drag the user back to the opening view
    // each time a banner appeared above the map.
    mount([place(), place({ placeKey: 'k:2', latitude: 37.6, longitude: 127.1 })]);

    resize(400, 300);
    const fitsAfterFraming = map.fitBounds.mock.calls.length;
    resize(900, 700);

    expect(map.fitBounds.mock.calls.length).toBe(fitsAfterFraming);
  });

  it('ignores a zero-sized container instead of re-framing on it', () => {
    // Place detail hides the map with display:none rather than destroying it, so
    // the camera survives. Treating that 0x0 as a real size would frame the map
    // on nothing and throw away where the user had panned to.
    mount([place(), place({ placeKey: 'k:2', latitude: 37.6, longitude: 127.1 })]);
    const fitsBefore = map.fitBounds.mock.calls.length;

    resize(0, 0);

    expect(map.invalidateSize).not.toHaveBeenCalled();
    expect(map.fitBounds.mock.calls.length).toBe(fitsBefore);
  });

  it('disconnects the observer on destroy', () => {
    const { renderer } = mount([place()]);
    renderer.destroy();
    expect(disconnected).toBe(true);
  });

  it('removes the map on destroy, not just the element', () => {
    // Leaflet holds window listeners; dropping the element alone leaks them.
    const { renderer, root } = mount([place()]);
    renderer.destroy();

    expect(map.remove).toHaveBeenCalled();
    expect(root?.isConnected).toBe(false);
  });

  it('tears down the previous map before drawing again', () => {
    const { renderer } = mount([place()]);
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    renderer.render(parent, [place()]);

    expect(map.remove).toHaveBeenCalledTimes(1);
  });

  it('shows a message when Leaflet throws, rather than disappearing', () => {
    L.map.mockImplementationOnce(() => { throw new Error('no layout'); });

    const { root } = mount([place()]);

    expect(root).not.toBeNull();
    expect(root?.textContent).toContain('could not be loaded');
  });
});
