import { describe, it, expect } from 'vitest';
import { UnavailableMediaBlockGenerator } from '@/services/markdown/UnavailableMediaBlockGenerator';

/**
 * Ship 3, item 2: the unavailable-media block is an Obsidian `[!note]` callout
 * (distinct from MediaPlaceholderGenerator's `[!warning]` expired-media block).
 */
describe('UnavailableMediaBlockGenerator', () => {
  it('renders a [!note] callout with the header line', () => {
    const out = UnavailableMediaBlockGenerator.generate({ reason: 'Gone.' });
    expect(out.startsWith('> [!note] Media Unavailable')).toBe(true);
  });

  it('uses the [!note] callout type, NOT the expired-media [!warning]', () => {
    const out = UnavailableMediaBlockGenerator.generate({ reason: 'Gone.' });
    expect(out).toContain('[!note]');
    expect(out).not.toContain('[!warning]');
  });

  it('emits the reason line', () => {
    const out = UnavailableMediaBlockGenerator.generate({
      reason: 'This media is stored only on the original device.',
    });
    expect(out).toContain('> This media is stored only on the original device.');
  });

  it('emits a Kind line when kind is provided', () => {
    const out = UnavailableMediaBlockGenerator.generate({ reason: 'r', kind: 'video' });
    expect(out).toContain('> Kind: video');
  });

  it('omits the Kind line when kind is absent', () => {
    const out = UnavailableMediaBlockGenerator.generate({ reason: 'r' });
    expect(out).not.toContain('Kind:');
  });

  it('emits a File line when filename is provided', () => {
    const out = UnavailableMediaBlockGenerator.generate({
      reason: 'r',
      filename: 'media/2024-01-01/00-image.jpg',
    });
    expect(out).toContain('> File: media/2024-01-01/00-image.jpg');
  });

  it('omits the File line when filename is absent', () => {
    const out = UnavailableMediaBlockGenerator.generate({ reason: 'r' });
    expect(out).not.toContain('File:');
  });

  it('falls back to a default reason when reason is blank', () => {
    const out = UnavailableMediaBlockGenerator.generate({ reason: '   ' });
    expect(out).toContain('> This media is stored only on the original device.');
  });

  it('every line is a callout line (starts with "> ")', () => {
    const out = UnavailableMediaBlockGenerator.generate({
      reason: 'r',
      kind: 'image',
      filename: 'media/x.jpg',
    });
    for (const line of out.split('\n')) {
      expect(line.startsWith('> ')).toBe(true);
    }
  });
});
