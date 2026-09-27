import { describe, it, expect, vi } from 'vitest';
import { CompactPostCardRenderer } from '@/components/timeline/renderers/CompactPostCardRenderer';

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  class Component {}
  return { ...actual, Component };
});

type PreviewTextAccess = { extractPlainTextFromMarkdown(text: string): string };

describe('CompactPostCardRenderer preview text', () => {
  it('shows the escapes a note carries as the text they stand for', () => {
    const renderer = new CompactPostCardRenderer() as unknown as PreviewTextAccess;

    expect(
      renderer.extractPlainTextFromMarkdown('1\\. step &lt;inputs> \\<x> \\# tag [link](https://x.com)'),
    ).toBe('1. step <inputs> <x> # tag link');
  });
});
