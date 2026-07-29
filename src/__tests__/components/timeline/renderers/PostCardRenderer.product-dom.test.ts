import { describe, expect, it, vi } from 'vitest';
import { Modal, type App, type Vault } from 'obsidian';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { PostCardRenderer } from '@/components/timeline/renderers/PostCardRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';
import type { ProductSnapshot } from '@/shared/platforms/products';

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
    manifest: { version: '4.4.0-test' },
    settings: {
      username: 'hyungyunlim',
      workerUrl: 'https://social-archiver-api.social-archive.org',
      transcription: { enabled: false, preferredModel: 'tiny', preferredVariant: 'auto' },
    },
    tagStore: {
      getDisplayTagsForPost: vi.fn(() => []),
      getTagDefinitions: vi.fn(() => []),
    },
    // The renderer subscribes to the ai-action status stream on construction.
    events: { on: vi.fn(() => ({})), off: vi.fn() },
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

const BASE_PRODUCT: ProductSnapshot = {
  name: 'Item',
  source: 'server-jsonld',
  confidence: 'confirmed',
  extractorVersion: 'jsonld-v1',
};

function makePost(
  product: ProductSnapshot | undefined,
  productSource: string | undefined = 'shop.example.com',
): PostData {
  return {
    // Commerce archives keep platform 'web' — the card is selected by extracted
    // data, not by a new platform registration.
    platform: 'web',
    id: 'product-1',
    sourceArchiveId: 'archive-product-1',
    filePath: 'Social Archives/Web/product-1.md',
    url: 'https://shop.example.com/products/x',
    author: { name: 'shop.example.com', url: 'https://shop.example.com' },
    content: { text: 'raw page text that must not become the card body' },
    media: [],
    metadata: {
      timestamp: new Date('2026-07-26T00:00:00.000Z'),
      ...(product ? { product } : {}),
      ...(productSource ? { productSource } : {}),
    },
  };
}

async function renderCard(post: PostData): Promise<HTMLElement> {
  const { app, renderer } = createRenderer();
  const container = new Modal(app).contentEl;
  document.body.appendChild(container);
  await renderer.render(container, post);
  return container;
}

describe('PostCardRenderer commerce product DOM', () => {
  it('renders name, price and store, and replaces the generic body', async () => {
    const el = await renderCard(
      makePost({ ...BASE_PRODUCT, name: 'Clear Case', price: 65, currency: 'USD' }),
    );

    expect(el.querySelector('.pcr-product-name')?.textContent).toBe('Clear Case');
    expect(el.querySelector('.pcr-product-price')?.textContent).toContain('65');
    expect(el.querySelector('.pcr-product-store')?.textContent).toBe('shop.example.com');
    // The product card stands in for the generic author header + content.
    expect(el.textContent).not.toContain('raw page text');
  });

  it('omits the price row entirely when the store exposes no price (Wix shape)', async () => {
    const el = await renderCard(makePost({ ...BASE_PRODUCT, name: 'Parade Flags' }));

    expect(el.querySelector('.pcr-product-name')?.textContent).toBe('Parade Flags');
    // No placeholder, no zero, no dash — the price simply is not shown.
    expect(el.querySelector('.pcr-product-price-row')).toBeNull();
  });

  it('keeps each currency in its own units and never converts', async () => {
    const el = await renderCard(
      makePost({ ...BASE_PRODUCT, name: '젤네일팁', price: 18900, currency: 'KRW' }),
    );

    expect(el.querySelector('.pcr-product-price')?.textContent).toContain('18,900');
  });

  it('marks a variant floor rather than claiming an exact price', async () => {
    const el = await renderCard(
      makePost({ ...BASE_PRODUCT, name: 'Leggings', price: 64, currency: 'USD', priceIsFrom: true }),
    );

    expect(el.querySelector('.pcr-product-price')?.textContent?.trim().endsWith('~')).toBe(true);
  });

  it('shows a discount against the list price', async () => {
    const el = await renderCard(
      makePost({ ...BASE_PRODUCT, name: 'Case', price: 27921, listPrice: 71556, currency: 'KRW' }),
    );

    expect(el.querySelector('.pcr-product-discount')?.textContent).toBe('-61%');
    expect(el.querySelector('.pcr-product-list-price')?.textContent).toContain('71,556');
  });

  it('labels stock state from the schema.org tail and strikes a sold-out price', async () => {
    const inStock = await renderCard(
      makePost({ ...BASE_PRODUCT, name: 'A', availability: 'https://schema.org/InStock' }),
    );
    expect(inStock.querySelector('.pcr-product-badge')?.textContent).toBe('In stock');

    const soldOut = await renderCard(
      makePost({ ...BASE_PRODUCT, name: 'B', price: 10, currency: 'USD', availability: 'OutOfStock' }),
    );
    expect(soldOut.querySelector('.pcr-product-badge')?.textContent).toBe('Sold out');
    expect(soldOut.querySelector('.pcr-product-price.is-sold-out')).not.toBeNull();
  });

  it('shows a rating when the store supplies one (Cafe24)', async () => {
    const el = await renderCard(
      makePost({ ...BASE_PRODUCT, name: 'B', rating: { value: 5, count: 4 } }),
    );

    expect(el.querySelector('.pcr-product-rating')?.textContent).toContain('5 (4)');
  });

  it('opens the store in a new tab without leaking the referrer', async () => {
    const el = await renderCard(makePost({ ...BASE_PRODUCT, name: 'Clear Case' }));

    for (const link of el.querySelectorAll<HTMLAnchorElement>('.pcr-product-name, .pcr-product-store')) {
      expect(link.getAttribute('href')).toBe('https://shop.example.com/products/x');
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
    }
  });

  it('lets the host resolve direction so RTL names lay out correctly', async () => {
    const el = await renderCard(makePost({ ...BASE_PRODUCT, name: 'سماعات لاسلكية' }));

    expect(el.querySelector('.pcr-product-name')?.getAttribute('dir')).toBe('auto');
  });

  it('falls back to the ordinary card when the archive carries no product', async () => {
    const el = await renderCard(makePost(undefined, undefined));

    expect(el.querySelector('.pcr-product-card')).toBeNull();
    // The generic author header is what the product card displaces, so its
    // presence is the signal that the branch fell through.
    expect(el.textContent).toContain('saved this post');
  });
});
