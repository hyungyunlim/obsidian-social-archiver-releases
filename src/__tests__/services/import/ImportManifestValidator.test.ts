/**
 * Unit tests for the manifest + checksum validator.
 */

import { describe, it, expect } from 'vitest';
import { validateManifest, parseChecksumFile } from '@/services/import/ImportManifestValidator';

function goodManifest() {
  return {
    $schema: 'social-archiver/instagram-saved-export-v2',
    schemaVersion: 2,
    exportId: 'abc-123',
    partNumber: 1,
    totalParts: 2,
    exportedAt: '2026-04-18T00:00:00.000Z',
    platform: 'instagram',
    source: 'saved-posts',
    instagramUserId: '42',
    instagramUsername: 'me',
    collection: { id: 'c1', name: 'Design', scope: 'named' as const },
    app: { name: 'chrome-ext', version: '1.0.0' },
    filters: { collectionIds: [], dateFrom: null, dateTo: null },
    counts: {
      postsInPart: 10,
      postsInExport: 20,
      readyToImport: 9,
      partialMedia: 1,
      failedPosts: 0,
      mediaDownloaded: 25,
      mediaFailed: 0,
    },
    integrity: { algorithm: 'sha256', checksumsFile: '_checksums.txt' },
  };
}

describe('validateManifest', () => {
  it('accepts a schema-v2 manifest', () => {
    const result = validateManifest(goodManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.exportId).toBe('abc-123');
      expect(result.warnings).toEqual([]);
    }
  });

  it('rejects unsupported schemaVersion', () => {
    const bad = goodManifest();
    (bad as unknown as { schemaVersion: number }).schemaVersion = 1;
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    }
  });

  it('rejects missing required top-level fields', () => {
    const bad = goodManifest();
    (bad as unknown as { exportId?: string }).exportId = '';
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects bad collection.scope', () => {
    const bad = goodManifest();
    (bad.collection as unknown as { scope: string }).scope = 'other';
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects non-integer count fields', () => {
    const bad = goodManifest();
    (bad.counts as unknown as { postsInPart: number }).postsInPart = -1;
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
  });

  it('warns on readyToImport > postsInPart but does not fail', () => {
    const suspicious = goodManifest();
    suspicious.counts.readyToImport = 999;
    const result = validateManifest(suspicious);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it('rejects non-object input', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest('string').ok).toBe(false);
    expect(validateManifest(123).ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
  });

  it('rejects partNumber > totalParts', () => {
    const bad = goodManifest();
    bad.partNumber = 5;
    bad.totalParts = 2;
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('partNumber'))).toBe(true);
    }
  });
});

describe('parseChecksumFile', () => {
  it('parses hex<two-spaces>path lines', () => {
    const content = [
      '0000000000000000000000000000000000000000000000000000000000000001  posts.jsonl',
      '0000000000000000000000000000000000000000000000000000000000000002  media/ABC/00-image.jpg',
      '',
      '  ', // whitespace-only line tolerated
    ].join('\n');
    const map = parseChecksumFile(content);
    expect(map.size).toBe(2);
    expect(map.get('posts.jsonl')).toMatch(/^0+1$/);
    expect(map.get('media/ABC/00-image.jpg')).toMatch(/^0+2$/);
  });

  it('ignores malformed lines', () => {
    const map = parseChecksumFile('not a checksum line\nabc def\n');
    expect(map.size).toBe(0);
  });

  it('normalizes backslashes to forward slashes', () => {
    const content =
      '0000000000000000000000000000000000000000000000000000000000000003  media\\ABC\\00.jpg';
    const map = parseChecksumFile(content);
    expect(map.has('media/ABC/00.jpg')).toBe(true);
  });
});
