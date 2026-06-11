import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaPathGenerator, sanitizeMediaFilename } from '@/services/MediaHandler';

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

describe('MediaPathGenerator.generateFilename', () => {
  beforeEach(() => {
    (window as unknown as { moment: () => { format: (f: string) => string } }).moment = () => ({
      format: () => '20260611',
    });
  });

  afterEach(() => {
    delete (window as unknown as { moment?: unknown }).moment;
  });

  it('keeps the index suffix when author+postId exceed the 80-char cap', () => {
    // Regression: Naver Cafe member keys are 43-char opaque ids — before the
    // base cap, the generic end-truncation sheared the `-1`/`-2` index off,
    // collapsing every media file of the post onto one overwritten path.
    const generator = new MediaPathGenerator();
    const memberKey = 'VVb00nwrFd4ZqZFwqVL-5FQ1qs0D25AVSwub0yQ59eE';
    const postId = 'cafe-koreassistant-23542';

    const first = generator.generateFilename('https://cdn.example/a.png', 0, postId, memberKey, 'webp');
    const second = generator.generateFilename('https://cdn.example/b.png', 1, postId, memberKey, 'webp');

    expect(first.length).toBeLessThanOrEqual(80);
    expect(first).toMatch(/-1\.webp$/);
    expect(second).toMatch(/-2\.webp$/);
    expect(first).not.toBe(second);
    // The generic sanitizer must not truncate it any further (same name in,
    // same name out) — otherwise generatePath would undo the uniqueness.
    expect(sanitizeMediaFilename(first)).toBe(first);
  });

  it('keeps the plain format for ordinary lengths', () => {
    const generator = new MediaPathGenerator();
    const filename = generator.generateFilename('https://cdn.example/a.jpg', 2, 'post123', 'alice', null);
    expect(filename).toBe('20260611-alice-post123-3.jpg');
  });
});
