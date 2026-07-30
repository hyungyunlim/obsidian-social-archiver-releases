import { describe, it, expect } from 'vitest';
import { TFile, type Vault } from 'obsidian';
import { MarkdownConverter } from '@/services/MarkdownConverter';
import { PostDataParser } from '@/components/timeline/parsers/PostDataParser';
import type { PostData, Platform } from '@/types/post';
import type { ProductSnapshot } from '@/shared/platforms/products';

/**
 * The commerce round-trip through the vault.
 *
 * This is the gap that made the plugin's product card unreachable: the server
 * sent `product`/`productSource` on every commerce archive, the note was
 * written without them, and the timeline re-read that note. Both halves are
 * asserted end to end here — writing the block is worthless if the parser does
 * not read it, and reading is worthless if it also leaks into the card body.
 */

const PRODUCT: ProductSnapshot = {
  name: 'Legacy Lifting Club Oversized T-Shirt',
  price: 64,
  currency: 'USD',
  priceIsFrom: true,
  listPrice: 80,
  availability: 'https://schema.org/InStock',
  seller: 'Gymshark',
  image: 'https://cdn.shopify.com/s/files/1/0098/shirt.jpg',
  source: 'server-jsonld',
  confidence: 'confirmed',
  extractorVersion: 'jsonld-v1',
  observedAt: '2026-07-27T14:56:22.790Z',
};

function makeCommercePost(overrides: Partial<PostData['metadata']> = {}): PostData {
  return {
    platform: 'web' as Platform,
    id: 'gymshark-tee',
    url: 'https://www.gymshark.com/products/legacy-lifting-club-oversized-t-shirt',
    author: {
      name: 'gymshark.com',
      url: 'https://www.gymshark.com',
    },
    content: {
      text: 'Accordion labels and shipping copy that must not become the card body.',
    },
    media: [],
    metadata: {
      timestamp: new Date('2026-07-27T14:56:22.790Z'),
      product: PRODUCT,
      productSource: 'gymshark.com',
      ...overrides,
    },
  } as PostData;
}

/** Minimal vault: parseFile only needs cachedRead. */
function vaultReturning(document: string): Vault {
  return { cachedRead: async () => document } as unknown as Vault;
}

function fileNamed(path: string): TFile {
  const file = new (TFile as unknown as new (path: string) => TFile)(path);
  file.stat = { ctime: 0, mtime: 0, size: 0 } as TFile['stat'];
  return file;
}

describe('MarkdownConverter → PostDataParser commerce round-trip', () => {
  it('writes productSource to frontmatter and the snapshot to a hidden block', () => {
    const result = new MarkdownConverter().convert(makeCommercePost());

    expect(result.frontmatter.productSource).toBe('gymshark.com');
    expect(result.fullDocument).toContain('%% sa:product');
    expect(result.fullDocument).toContain('Legacy Lifting Club Oversized T-Shirt');
  });

  it('restores both halves when the note is read back', async () => {
    const document = new MarkdownConverter().convert(makeCommercePost()).fullDocument;
    const parser = new PostDataParser(vaultReturning(document));

    const parsed = await parser.parseFile(fileNamed('Social Archives/gymshark-tee.md'));

    expect(parsed?.metadata.productSource).toBe('gymshark.com');
    expect(parsed?.metadata.product?.name).toBe('Legacy Lifting Club Oversized T-Shirt');
    expect(parsed?.metadata.product?.price).toBe(64);
    expect(parsed?.metadata.product?.currency).toBe('USD');
    expect(parsed?.metadata.product?.priceIsFrom).toBe(true);
    expect(parsed?.metadata.product?.listPrice).toBe(80);
  });

  it('keeps the hidden block out of the rendered body', async () => {
    const document = new MarkdownConverter().convert(makeCommercePost()).fullDocument;
    const parser = new PostDataParser(vaultReturning(document));

    const parsed = await parser.parseFile(fileNamed('Social Archives/gymshark-tee.md'));

    expect(parsed?.content.text ?? '').not.toContain('sa:product');
    expect(parsed?.content.text ?? '').not.toContain('extractorVersion');
  });

  it('writes no block for a non-commerce archive', () => {
    const post = makeCommercePost();
    delete post.metadata.product;
    delete post.metadata.productSource;

    const result = new MarkdownConverter().convert(post);

    expect(result.fullDocument).not.toContain('sa:product');
    expect(result.frontmatter.productSource).toBeUndefined();
  });

  it('carries productSource alone when the server sent no snapshot', async () => {
    // Grade B/C commerce (Naver, Coupang, Amazon) fills the store host but not
    // the snapshot. That still has to reach Shopping and still renders a card.
    const post = makeCommercePost();
    delete post.metadata.product;

    const document = new MarkdownConverter().convert(post).fullDocument;
    const parsed = await new PostDataParser(vaultReturning(document))
      .parseFile(fileNamed('Social Archives/naver-item.md'));

    expect(parsed?.metadata.productSource).toBe('gymshark.com');
    expect(parsed?.metadata.product).toBeUndefined();
  });
});
