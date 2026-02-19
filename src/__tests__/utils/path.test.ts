import { describe, it, expect } from 'vitest';
import { toRelativeMediaPath } from '@/utils/path';

describe('toRelativeMediaPath', () => {
  const media = 'attachments/social-archives/facebook/2026-02-19_post.jpg';

  it('should produce ../../../../ for default 4-level platform path', () => {
    const output = 'Social Archives/Facebook/2026/02/file.md';
    expect(toRelativeMediaPath(media, output)).toBe(
      `../../../../${media}`,
    );
  });

  it('should produce ../../../../../ for 5-level subscription path', () => {
    const output = 'Social Archives/Subscriptions/Facebook/2026/02/file.md';
    expect(toRelativeMediaPath(media, output)).toBe(
      `../../../../../${media}`,
    );
  });

  it('should produce ../ for flat 1-level path', () => {
    const output = 'Social Archives/file.md';
    expect(toRelativeMediaPath(media, output)).toBe(
      `../${media}`,
    );
  });

  it('should produce ../../ for 2-level platform-only path', () => {
    const output = 'Social Archives/Facebook/file.md';
    expect(toRelativeMediaPath(media, output)).toBe(
      `../../${media}`,
    );
  });

  it('should produce ../../../../ fallback when outputFilePath is omitted', () => {
    expect(toRelativeMediaPath(media)).toBe(
      `../../../../${media}`,
    );
  });

  it('should return external URLs unchanged', () => {
    const url = 'https://example.com/image.jpg';
    expect(toRelativeMediaPath(url, 'Social Archives/Facebook/2026/02/file.md')).toBe(url);
  });

  it('should return non-attachment paths unchanged', () => {
    const localPath = 'images/photo.png';
    expect(toRelativeMediaPath(localPath, 'Social Archives/Facebook/2026/02/file.md')).toBe(localPath);
  });

  it('should handle root-level file (0 depth)', () => {
    const output = 'file.md';
    expect(toRelativeMediaPath(media, output)).toBe(media);
  });
});
