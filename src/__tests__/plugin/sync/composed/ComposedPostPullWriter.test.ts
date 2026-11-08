import { describe, expect, it } from 'vitest';
import { pullFileIndex, r2IndexFromUrl } from '@/plugin/sync/composed/ComposedPostPullWriter';

const url = (n: number): string => `https://api.example.com/media/archives/alice/post_1/${n}.jpg`;

describe('pullFileIndex', () => {
  it('names a pulled attachment by its R2 index, above every Tier-3 array position', () => {
    expect(r2IndexFromUrl(url(3))).toBe(3);
    // A Tier-3 save names files by array position (0..24), so a pull of R2
    // index 0 must never land on a Tier-3 file holding another photo.
    expect(pullFileIndex(url(0), 2)).toBe(100);
    expect(pullFileIndex(url(24), 0)).toBe(124);
  });

  it('falls back to the position for a URL with no R2 index', () => {
    expect(pullFileIndex('https://cdn.example.com/a.jpg', 4)).toBe(1004);
  });
});
