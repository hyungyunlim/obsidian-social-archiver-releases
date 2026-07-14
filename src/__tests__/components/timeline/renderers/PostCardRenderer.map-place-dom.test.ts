import { describe, expect, it, vi } from 'vitest';
import { Modal, type App, type Vault } from 'obsidian';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { PostCardRenderer } from '@/components/timeline/renderers/PostCardRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';

const menuCapture = vi.hoisted(() => ({
  items: [] as Array<{ title: string; icon: string; warning: boolean; onClick?: () => void }>,
  separators: 0,
}));

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

  class Scope {
    register(): void {}
  }

  class Menu {
    addItem(configure: (item: {
      setIcon(icon: string): unknown;
      setTitle(title: string): unknown;
      setWarning(warning: boolean): unknown;
      onClick(handler: () => void): unknown;
    }) => void): this {
      const captured = { title: '', icon: '', warning: false, onClick: undefined as (() => void) | undefined };
      const item = {
        setIcon(icon: string) { captured.icon = icon; return item; },
        setTitle(title: string) { captured.title = title; return item; },
        setWarning(warning: boolean) { captured.warning = warning; return item; },
        onClick(handler: () => void) { captured.onClick = handler; return item; },
      };
      configure(item);
      menuCapture.items.push(captured);
      return this;
    }

    addSeparator(): this {
      menuCapture.separators += 1;
      return this;
    }

    showAtPosition(): this {
      return this;
    }
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

function createRenderer(): { app: App; renderer: PostCardRenderer } {
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
    manifest: { version: '4.1.9-test' },
    settings: {
      username: 'hyungyunlim',
      workerUrl: 'https://social-archiver-api.social-archive.org',
      transcription: { enabled: false, preferredModel: 'tiny', preferredVariant: 'auto' },
    },
    tagStore: {
      getDisplayTagsForPost: vi.fn(() => []),
      getTagDefinitions: vi.fn(() => []),
    },
  } as SocialArchiverPlugin;

  return {
    app,
    renderer: new PostCardRenderer(
      vault,
      app,
      plugin,
      new MediaGalleryRenderer((path) => path),
      new CommentRenderer(),
      new YouTubeEmbedRenderer(),
      new LinkPreviewRenderer(),
      new Map(),
    ),
  };
}

function makePost(platform: 'googlemaps' | 'navermap' | 'kakaomap', externalId: string): PostData {
  return {
    platform,
    id: externalId,
    sourceArchiveId: 'archive-map-place-1',
    filePath: `Social Archives/${platform}/${externalId}.md`,
    url: 'https://invalid.example/original',
    author: { name: '성수 카페', url: 'https://invalid.example/original' },
    content: { text: '카테고리: 카페\n📍 서울 성동구 아차산로 7\n⭐ 4.6/5 (321개 리뷰)' },
    media: [],
    metadata: {
      timestamp: new Date('2026-07-11T00:00:00.000Z'),
      location: '성수 카페',
      latitude: 37.5446,
      longitude: 127.0559,
      locationSource: platform,
      locationExternalId: externalId,
      likes: 92,
    },
  };
}

describe('PostCardRenderer map-place provider DOM', () => {
	it('keeps every archive capability reachable while hiding provider rating from social likes', async () => {
		// Given: a verified map archive whose mapper encoded 4.6 as 92 likes.
		const { app, renderer } = createRenderer();
		const container = new Modal(app).contentEl;
		document.body.appendChild(container);

		// When: the production desktop plugin card renders.
		await renderer.render(container, makePost('kakaomap', '9876543210'));

		// Then: rating encoding is not rendered as a social metric and all six archive actions exist.
		expect(container.querySelector('.pcr-action-count')?.textContent).not.toBe('92');
		for (const title of [
			'Add to favorites',
        'Share this place',
        'Manage tags',
        'Archive this post',
        'Open note in Obsidian',
        'Delete this post',
		]) {
			const action = container.querySelector<HTMLButtonElement>(`[title="${title}"]`);
			expect(action?.tagName, title).toBe('BUTTON');
			expect(action?.type, title).toBe('button');
			expect(action?.getAttribute('aria-label'), title).toBe(title);
		}
	});

  it.each([
    {
      state: 'unshared',
      shareUrl: undefined,
      archiveItems: ['Create share link'],
    },
    {
      state: 'shared',
      shareUrl: 'https://social-archive.org/share/map-place-1',
      archiveItems: ['Copy share link', 'Unshare'],
    },
  ])('keeps $state archive sharing beside canonical provider actions', async ({ shareUrl, archiveItems }) => {
    const { app, renderer } = createRenderer();
    const container = new Modal(app).contentEl;
    document.body.appendChild(container);
    menuCapture.items = [];
    menuCapture.separators = 0;
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn() });

    await renderer.render(container, { ...makePost('kakaomap', '9876543210'), shareUrl });
    container.querySelector<HTMLElement>('[title="Share this place"]')?.click();

    const titles = menuCapture.items.map((item) => item.title);
    expect(titles).toEqual([
      ...archiveItems,
      'Copy Kakao Map link',
      'Open on Kakao Map',
      'Share Kakao Map place',
    ]);
    expect(menuCapture.separators).toBe(1);
  });

  it('places a native location action in the established archive action row', async () => {
    const { app, renderer } = createRenderer();
    const container = new Modal(app).contentEl;
    document.body.appendChild(container);

    await renderer.render(container, makePost('kakaomap', '9876543210'));
    const action = container.querySelector<HTMLButtonElement>(
      '.pcr-interactions .pcr-action-btn[aria-label="Change linked place"]',
    );

    expect(action?.tagName).toBe('BUTTON');
    expect(action?.type).toBe('button');
    expect(action?.querySelector('.pcr-action-icon')?.getAttribute('data-icon')).toBe('map-pin-plus');
  });

  it.each([
    ['googlemaps', 'ChIJ123', 'https://www.google.com/maps/search/?api=1&query=37.5446,127.0559&query_place_id=ChIJ123'],
    ['navermap', '1234567890', 'https://map.naver.com/p/entry/place/1234567890'],
    ['kakaomap', '9876543210', 'https://place.map.kakao.com/9876543210'],
  ] as const)('renders a semantic, nonblank exact %s provider action', async (platform, externalId, href) => {
    // Given: a persisted place archive rendered through the production Obsidian renderer.
    const { app, renderer } = createRenderer();
    const container = new Modal(app).contentEl;
    document.body.appendChild(container);

    // When: its full place card DOM is rendered.
    await renderer.render(container, makePost(platform, externalId));
    const action = container.querySelector<HTMLAnchorElement>('.pcr-gmaps-provider-link');

    // Then: the right-side action is an accessible exact outlink with a real SVG path.
    expect(action).toBeTruthy();
    expect(action?.href).toBe(href);
    expect(action?.target).toBe('_blank');
    expect(action?.rel).toBe('noopener noreferrer');
    expect(action?.getAttribute('aria-label')).toContain('성수 카페');
    expect(action?.querySelectorAll('svg path')).toHaveLength(1);
    expect(action?.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(20);
    expect(action?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(action?.querySelector('svg')?.getAttribute('focusable')).toBe('false');
    expect(action?.closest('.pcr-gmaps-right-section')).toBeTruthy();

    const parentClick = vi.fn();
    container.addEventListener('click', parentClick);
    action?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('cancels Space scrolling before activating the real map chooser control', async () => {
    // Given: the production keyboard-enabled map chooser control.
    const { app, renderer } = createRenderer();
    const container = new Modal(app).contentEl;
    document.body.appendChild(container);
    await renderer.render(container, makePost('navermap', '1234567890'));
    const chooser = container.querySelector<HTMLElement>('.pcr-gmaps-action-btn[role="button"]');
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });

    // When: a keyboard user presses Space.
    const dispatchResult = chooser?.dispatchEvent(event);

    // Then: the default page-scroll behavior is cancelled and activation is handled.
    expect(chooser).toBeTruthy();
    expect(event.defaultPrevented).toBe(true);
    expect(dispatchResult).toBe(false);
  });
});
