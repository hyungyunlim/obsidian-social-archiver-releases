import { describe, expect, it } from 'vitest';
import { ProductBodyBlock } from './ProductBodyBlock';
import type { ProductSnapshot } from '../../shared/platforms/products';

function product(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    name: 'Legacy Lifting Club Oversized T-Shirt',
    price: 64,
    currency: 'USD',
    priceIsFrom: true,
    availability: 'https://schema.org/InStock',
    seller: 'Gymshark',
    image: 'https://cdn.shopify.com/s/files/1/0098/shirt.jpg',
    source: 'server-jsonld',
    confidence: 'confirmed',
    extractorVersion: 'jsonld-v1',
    observedAt: '2026-07-27T14:56:22.790Z',
    ...overrides,
  };
}

describe('ProductBodyBlock', () => {
  it('round-trips a snapshot through serialize/parse', () => {
    const body = `Post body.\n\n${ProductBodyBlock.serialize(product())}\n`;
    const parsed = ProductBodyBlock.parse(body);
    expect(parsed?.name).toBe('Legacy Lifting Club Oversized T-Shirt');
    expect(parsed?.price).toBe(64);
    expect(parsed?.currency).toBe('USD');
    expect(parsed?.priceIsFrom).toBe(true);
  });

  it('is wrapped in an Obsidian %% comment so it stays hidden', () => {
    const block = ProductBodyBlock.serialize(product());
    expect(block.startsWith('%% sa:product')).toBe(true);
    expect(block.trimEnd().endsWith('%%')).toBe(true);
  });

  it('keeps fields this build does not know about', () => {
    // The whole point of storing the snapshot verbatim: a field added server
    // side must survive a round-trip through an older plugin.
    const withFuture = { ...product(), unreleasedField: 'keep me' } as ProductSnapshot;
    const parsed = ProductBodyBlock.parse(ProductBodyBlock.serialize(withFuture));
    expect((parsed as Record<string, unknown>)['unreleasedField']).toBe('keep me');
  });

  it('strip removes the block and its padding from the body', () => {
    const body = `Real body text.\n\n${ProductBodyBlock.serialize(product())}\n`;
    expect(ProductBodyBlock.strip(body).trim()).toBe('Real body text.');
  });

  it('has() reports a malformed block so callers still strip it', () => {
    const body = 'Body.\n\n%% sa:product\n{not json\n%%\n';
    expect(ProductBodyBlock.has(body)).toBe(true);
    expect(ProductBodyBlock.parse(body)).toBeNull();
    expect(ProductBodyBlock.strip(body)).not.toContain('sa:product');
  });

  it('rejects a snapshot with no name — it cannot render a card', () => {
    const body = `%% sa:product\n${JSON.stringify({ v: 1, product: { name: '   ' } })}\n%%`;
    expect(ProductBodyBlock.parse(body)).toBeNull();
  });

  it('returns null when there is no block at all', () => {
    expect(ProductBodyBlock.parse('Just a post.')).toBeNull();
    expect(ProductBodyBlock.has('Just a post.')).toBe(false);
  });

  it('upsert replaces rather than appends a second block', () => {
    const once = ProductBodyBlock.upsert('Body.', product());
    const twice = ProductBodyBlock.upsert(once, product({ name: 'Renamed' }));
    expect(twice.match(/sa:product/g)).toHaveLength(1);
    expect(ProductBodyBlock.parse(twice)?.name).toBe('Renamed');
  });

  it('upsert with no snapshot clears an existing block', () => {
    const withBlock = ProductBodyBlock.upsert('Body.', product());
    expect(ProductBodyBlock.upsert(withBlock, null).trim()).toBe('Body.');
  });
});
