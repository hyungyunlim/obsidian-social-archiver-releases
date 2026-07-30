import { describe, it, expect, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import {
  ProductFrontmatterSyncService,
  sameProductSnapshot,
  productFrontmatterNeedsWrite,
  applyProductFrontmatter,
  type RemoteArchiveProductSource,
} from '@/plugin/sync/ProductFrontmatterSyncService';
import { ProductBodyBlock } from '@/services/markdown/ProductBodyBlock';
import type { ProductSnapshot } from '@/shared/platforms/products';

const SNAPSHOT: ProductSnapshot = {
  name: 'Oversized T-Shirt',
  price: 64,
  currency: 'USD',
  seller: 'Gymshark',
  source: 'server-jsonld',
  confidence: 'confirmed',
  extractorVersion: 'jsonld-v1',
};

const FILE = { path: 'Social Archives/tee.md' } as TFile;

interface Harness {
  app: App;
  cachedRead: ReturnType<typeof vi.fn>;
  process: ReturnType<typeof vi.fn>;
  processFrontMatter: ReturnType<typeof vi.fn>;
  frontmatter: Record<string, unknown>;
  body: { current: string };
}

function harness(frontmatter: Record<string, unknown>, body: string): Harness {
  const state = { current: body };
  const cachedRead = vi.fn(async () => state.current);
  const process = vi.fn(async (_file: TFile, fn: (c: string) => string) => {
    state.current = fn(state.current);
    return state.current;
  });
  const processFrontMatter = vi.fn(
    async (_file: TFile, fn: (fm: Record<string, unknown>) => void) => { fn(frontmatter); },
  );

  const app = {
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    vault: { cachedRead, process },
    fileManager: { processFrontMatter },
  } as unknown as App;

  return { app, cachedRead, process, processFrontMatter, frontmatter, body: state };
}

function serviceFor(h: Harness): ProductFrontmatterSyncService {
  return new ProductFrontmatterSyncService({
    app: h.app,
    apiClient: () => undefined,
    findBySourceArchiveId: () => FILE,
  });
}

function archive(overrides: Partial<RemoteArchiveProductSource> = {}): RemoteArchiveProductSource {
  return { id: 'arc_1', ...overrides };
}

describe('ProductFrontmatterSyncService', () => {
  it('writes both halves onto a note that has neither', async () => {
    const h = harness({}, 'Body text.');
    await serviceFor(h).reconcileFromLibrarySync(
      FILE,
      archive({ product: SNAPSHOT, productSource: 'gymshark.com' }),
    );

    expect(h.frontmatter['productSource']).toBe('gymshark.com');
    expect(ProductBodyBlock.parse(h.body.current)?.name).toBe('Oversized T-Shirt');
  });

  it('is a strict no-op when the note already matches', async () => {
    // The whole back-catalogue sweep runs this per archive. Rewriting an
    // already-correct note would churn mtimes across the entire vault and
    // retrigger the timeline's own change handling for every one of them.
    const h = harness(
      { productSource: 'gymshark.com' },
      ProductBodyBlock.upsert('Body text.', SNAPSHOT),
    );

    await serviceFor(h).reconcileFromLibrarySync(
      FILE,
      archive({ product: SNAPSHOT, productSource: 'gymshark.com' }),
    );

    expect(h.processFrontMatter).not.toHaveBeenCalled();
    expect(h.process).not.toHaveBeenCalled();
  });

  it('does not read the body of an ordinary non-commerce note', async () => {
    // A sweep reconciles thousands of ordinary posts; a per-file read for each
    // is the expensive part of the pass.
    const h = harness({}, 'Just a post.');
    await serviceFor(h).reconcileFromLibrarySync(FILE, archive());

    expect(h.cachedRead).not.toHaveBeenCalled();
    expect(h.process).not.toHaveBeenCalled();
  });

  it('fills in a price that arrived after the note was written', async () => {
    // Grade B/C: the note landed with a store host and no snapshot, and a
    // client enriched the price later.
    const h = harness({ productSource: 'coupang.com' }, 'Body text.');

    await serviceFor(h).reconcileFromLibrarySync(
      FILE,
      archive({ product: SNAPSHOT, productSource: 'coupang.com' }),
    );

    expect(ProductBodyBlock.parse(h.body.current)?.price).toBe(64);
    // The store host never changed, so frontmatter must not be rewritten.
    expect(h.processFrontMatter).not.toHaveBeenCalled();
  });

  it('replaces a stale snapshot when the price changes', async () => {
    const h = harness(
      { productSource: 'gymshark.com' },
      ProductBodyBlock.upsert('Body text.', { ...SNAPSHOT, price: 80 }),
    );

    await serviceFor(h).reconcileFromLibrarySync(
      FILE,
      archive({ product: SNAPSHOT, productSource: 'gymshark.com' }),
    );

    expect(ProductBodyBlock.parse(h.body.current)?.price).toBe(64);
    expect(h.body.current.match(/sa:product/g)).toHaveLength(1);
  });

  it('clears both halves when the server no longer has a product', async () => {
    const h = harness(
      { productSource: 'gymshark.com' },
      ProductBodyBlock.upsert('Body text.', SNAPSHOT),
    );

    await serviceFor(h).reconcileFromLibrarySync(FILE, archive());

    expect(h.frontmatter['productSource']).toBeUndefined();
    expect(ProductBodyBlock.parse(h.body.current)).toBeNull();
    expect(h.body.current.trim()).toBe('Body text.');
  });

  it('leaves unrelated frontmatter alone', async () => {
    const h = harness({ tags: ['keep'], comment: 'my note', like: true }, 'Body text.');

    await serviceFor(h).reconcileFromLibrarySync(
      FILE,
      archive({ product: SNAPSHOT, productSource: 'gymshark.com' }),
    );

    expect(h.frontmatter['tags']).toEqual(['keep']);
    expect(h.frontmatter['comment']).toBe('my note');
    expect(h.frontmatter['like']).toBe(true);
  });

  it('does not disturb an existing locations block sharing the body', async () => {
    const withLocations = 'Body text.\n\n%% sa:locations\n{"v":1,"locations":[]}\n%%\n';
    const h = harness({}, withLocations);

    await serviceFor(h).reconcileFromLibrarySync(
      FILE,
      archive({ product: SNAPSHOT, productSource: 'gymshark.com' }),
    );

    expect(h.body.current).toContain('sa:locations');
    expect(h.body.current).toContain('sa:product');
  });

  it('stops writing once disposed', async () => {
    const h = harness({}, 'Body text.');
    const service = serviceFor(h);
    service.dispose();

    const result = await service.reconcileArchiveIds(['arc_1']);

    expect(result.failedArchiveIds).toEqual(['arc_1']);
    expect(h.process).not.toHaveBeenCalled();
  });
});

describe('ProductFrontmatterSyncService helpers', () => {
  it('sameProductSnapshot ignores key order', () => {
    const reordered = JSON.parse(
      JSON.stringify(SNAPSHOT, Object.keys(SNAPSHOT).reverse()),
    ) as ProductSnapshot;
    expect(sameProductSnapshot(SNAPSHOT, reordered)).toBe(true);
  });

  it('sameProductSnapshot treats null as its own value', () => {
    expect(sameProductSnapshot(null, null)).toBe(true);
    expect(sameProductSnapshot(SNAPSHOT, null)).toBe(false);
  });

  it('productFrontmatterNeedsWrite detects both directions', () => {
    expect(productFrontmatterNeedsWrite({}, { productSource: 'a.com' })).toBe(true);
    expect(productFrontmatterNeedsWrite({ productSource: 'a.com' }, {})).toBe(true);
    expect(productFrontmatterNeedsWrite({ productSource: 'a.com' }, { productSource: 'a.com' })).toBe(false);
  });

  it('applyProductFrontmatter deletes managed keys before assigning', () => {
    const fm: Record<string, unknown> = { productSource: 'old.com', tags: ['keep'] };
    applyProductFrontmatter(fm, {});
    expect(fm['productSource']).toBeUndefined();
    expect(fm['tags']).toEqual(['keep']);
  });
});
