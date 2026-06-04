import { describe, expect, it } from 'vitest';
import { sanitizeMediaFilename } from '@/services/MediaHandler';

describe('sanitizeMediaFilename', () => {
  it('preserves the final extension when truncating long podcast audio names', () => {
    const filename = [
      '20260604',
      'Guy_Raz_-_Wondery',
      'gid-art19-episode-locator-V0-b9ee3mY6tjy1CEQBdTB5wenwgY3OrdtIfo2-IF3E0AY',
      '1.mp3',
    ].join('-');

    const sanitized = sanitizeMediaFilename(filename);

    expect(sanitized.length).toBeLessThanOrEqual(80);
    expect(sanitized).toMatch(/\.mp3$/);
  });
});
