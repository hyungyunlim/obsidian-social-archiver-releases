import { describe, expect, it, vi } from 'vitest';
import { Modal, type App, type Vault } from 'obsidian';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { PostCardRenderer } from '@/components/timeline/renderers/PostCardRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';
import type { ArchiveLocation } from '@/types/archive-location';

/**
 * `renderLocationStrip` is the ONLY path that shows a place on an ordinary
 * social post, and measured on a real vault that is the majority case: of the
 * notes carrying place data, most sat on threads/facebook/kidsnote rather than
 * on a map platform. The full map-place card is gated on `platform` and never
 * reaches them.
 *
 * It had no tests. The 8-chip cap, the `+N` expander, the `name && placeKey`
 * filter, and the url-less static branch were all unverified.
 */

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  const ActualModal = actual.Modal as typeof Modal;
  ActualModal.prototype.setTitle = vi.fn();
  ActualModal.prototype.open = vi.fn();

  class Component {
    register(): void {}
    registerEvent(): void {}
    addChild(): void {}
    load(): void {}
    unload(): void {}
  }
  class Scope { register(): void {} }
  class Menu {
    addItem(): this { return this; }
    addSeparator(): this { return this; }
    showAtPosition(): this { return this; }
  }

  return {
    ...actual,
    Modal: ActualModal,
    Component,
    Scope,
    Menu,
    MarkdownRenderer: {
      render: async (_app: unknown, source: string, element: HTMLElement): Promise<void> => {
        element.textContent = source;
      },
    },
    setIcon(element: HTMLElement, icon: string): void {
      element.dataset.icon = icon;
    },
  };
});

function createRenderer(): PostCardRenderer {
  const vault = {
    adapter: { exists: vi.fn(async () => false) },
    getFileByPath: vi.fn(() => null),
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ''),
    modify: vi.fn(async () => undefined),
  } as Vault;
  const app = {
    vault,
    metadataCache: { getFileCache: vi.fn(() => null) },
    workspace: {},
    fileManager: {},
  } as App;
  const plugin = {
    app,
    manifest: { version: '4.5.0-test' },
    settings: {
      username: 'hyungyunlim',
      workerUrl: 'https://social-archiver-api.social-archive.org',
      transcription: { enabled: false, preferredModel: 'tiny', preferredVariant: 'auto' },
    },
    tagStore: {
      getDisplayTagsForPost: vi.fn(() => []),
      getTagDefinitions: vi.fn(() => []),
    },
    events: { on: vi.fn(() => ({})), off: vi.fn() },
  } as SocialArchiverPlugin;

  return new PostCardRenderer(
    vault,
    app,
    plugin,
    new MediaGalleryRenderer((path) => path),
    new CommentRenderer(),
    new YouTubeEmbedRenderer(),
    new LinkPreviewRenderer(),
    new Map(),
  );
}

function loc(overrides: Partial<ArchiveLocation> = {}): ArchiveLocation {
  return {
    id: 'loc-1',
    archiveId: 'arc-1',
    placeKey: 'kakaomap:18857457',
    name: '모녀가리비',
    address: '강원특별자치도 속초시 대포항희망길 53',
    latitude: 38.17,
    longitude: 128.6,
    source: 'kakaomap',
    externalId: '18857457',
    url: 'https://place.map.kakao.com/18857457',
    category: '음식점',
    placeKind: 'restaurant',
    isPrimary: true,
    sortOrder: 0,
    placeArchiveId: null,
    promotionStatus: 'metadata_only',
    createdAt: '2026-07-20T04:13:31.296Z',
    updatedAt: '2026-07-20T04:13:31.296Z',
    ...overrides,
  } as ArchiveLocation;
}

function makePost(locations: ArchiveLocation[], platform = 'threads'): PostData {
  return {
    platform,
    id: 'p1',
    url: 'https://www.threads.com/@someone/post/abc',
    filePath: 'Social Archives/Threads/p1.md',
    author: { name: 'Someone', url: 'https://www.threads.com/@someone' },
    content: { text: 'A post that happens to mention places.' },
    media: [],
    comments: [],
    metadata: { timestamp: new Date('2026-07-20T04:00:00.000Z'), locations },
  } as PostData;
}

/** Render a card and hand back the strip, if one was produced. */
function renderStrip(post: PostData): HTMLElement | null {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private by design; this is the only path onto it
  (createRenderer() as any).renderLocationStrip(container, post);
  return container.querySelector('.pcr-place-strip');
}

function chipNames(strip: HTMLElement): string[] {
  return [...strip.querySelectorAll('.pcr-place-chip-name')].map((el) => el.textContent ?? '');
}

describe('PostCardRenderer.renderLocationStrip', () => {
  it('renders a chip per attached place on a non-map post', () => {
    const strip = renderStrip(makePost([
      loc(),
      loc({ id: 'loc-2', placeKey: 'kakaomap:909684968', name: '남경막국수', isPrimary: false }),
    ]));

    expect(strip).not.toBeNull();
    expect(chipNames(strip!)).toEqual(['모녀가리비', '남경막국수']);
  });

  it('renders nothing for a map-place archive — the archive IS the place', () => {
    // Those get the full map card instead; a chip row would duplicate it.
    expect(renderStrip(makePost([loc()], 'kakaomap'))).toBeNull();
  });

  it('renders nothing when there are no attached places', () => {
    expect(renderStrip(makePost([]))).toBeNull();
  });

  it('skips entries with no name or no placeKey', () => {
    // A nameless chip is an unlabelled button, and without a placeKey it cannot
    // be grouped or navigated to.
    const strip = renderStrip(makePost([
      loc(),
      loc({ id: 'loc-2', name: '   ' }),
      loc({ id: 'loc-3', name: 'No key', placeKey: '' as never }),
    ]));

    expect(chipNames(strip!)).toEqual(['모녀가리비']);
  });

  it('caps at 8 chips and offers the rest behind a +N control', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      loc({ id: `loc-${i}`, placeKey: `kakaomap:${i}`, name: `Place ${i}` }),
    );
    const strip = renderStrip(makePost(many));

    expect(chipNames(strip!)).toHaveLength(8);
    const more = strip!.querySelector('.pcr-place-chip-more');
    expect(more?.textContent).toBe('+4');
    expect(more?.getAttribute('aria-label')).toContain('4');
  });

  it('reveals every chip once +N is clicked, and drops the control', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      loc({ id: `loc-${i}`, placeKey: `kakaomap:${i}`, name: `Place ${i}` }),
    );
    const strip = renderStrip(makePost(many));

    (strip!.querySelector('.pcr-place-chip-more') as HTMLElement).click();

    expect(chipNames(strip!)).toHaveLength(12);
    expect(strip!.querySelector('.pcr-place-chip-more')).toBeNull();
  });

  it('does not show +N when the count is exactly at the cap', () => {
    const eight = Array.from({ length: 8 }, (_, i) =>
      loc({ id: `loc-${i}`, placeKey: `kakaomap:${i}`, name: `Place ${i}` }),
    );
    const strip = renderStrip(makePost(eight));

    expect(chipNames(strip!)).toHaveLength(8);
    expect(strip!.querySelector('.pcr-place-chip-more')).toBeNull();
  });

  it('marks a place with no provider URL as static rather than clickable', () => {
    const strip = renderStrip(makePost([loc({ url: null })]));

    expect(strip!.querySelector('.pcr-place-chip-static')).not.toBeNull();
  });

  it('opens the provider page in a new tab with noopener', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const strip = renderStrip(makePost([loc()]));

    (strip!.querySelector('.pcr-place-chip') as HTMLElement).click();

    expect(open).toHaveBeenCalledWith(
      'https://place.map.kakao.com/18857457',
      '_blank',
      'noopener,noreferrer',
    );
    open.mockRestore();
  });

  it('labels each chip for assistive tech', () => {
    const strip = renderStrip(makePost([loc()]));
    const chip = strip!.querySelector('.pcr-place-chip') as HTMLElement;

    expect(chip.getAttribute('aria-label')).toBe('모녀가리비');
    expect(chip.getAttribute('title')).toBe('모녀가리비');
  });
});
