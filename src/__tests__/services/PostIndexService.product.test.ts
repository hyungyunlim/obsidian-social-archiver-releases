import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { PostIndexService } from '@/services/PostIndexService';

/**
 * Shopping renders off the index, not off PostData, so a `productSource` that
 * fails to reach the index makes the whole view come up empty with no error
 * anywhere — the exact failure mode Product PRD §5.9 documents five times over.
 */

function fileNamed(path: string): TFile {
  const file = new (TFile as unknown as new (path: string) => TFile)(path);
  file.stat = { ctime: 0, mtime: 0, size: 0 } as TFile['stat'];
  return file;
}

const METADATA = {
  authorName: 'gymshark.com',
  url: 'https://www.gymshark.com/products/tee',
  tags: [],
  hashtags: [],
  like: false,
  archive: false,
  isLocalOnly: false,
  subscribed: false,
  mediaCount: 0,
  commentCount: 0,
  metadataTimestamp: new Date('2026-07-27T14:56:22.790Z'),
};

describe('PostIndexService.buildEntry — commerce', () => {
  it('projects productSource onto the index entry', () => {
    const entry = PostIndexService.buildEntry(
      fileNamed('Social Archives/tee.md'),
      { productSource: 'gymshark.com' },
      'body',
      'web',
      METADATA,
    );

    expect(entry.productSource).toBe('gymshark.com');
  });

  it('leaves productSource undefined for a non-commerce note', () => {
    const entry = PostIndexService.buildEntry(
      fileNamed('Social Archives/post.md'),
      {},
      'body',
      'web',
      METADATA,
    );

    expect(entry.productSource).toBeUndefined();
  });

  it('treats an empty store host as absent rather than as a store named ""', () => {
    const entry = PostIndexService.buildEntry(
      fileNamed('Social Archives/blank.md'),
      { productSource: '' },
      'body',
      'web',
      METADATA,
    );

    expect(entry.productSource).toBeUndefined();
  });
});

/**
 * `hasPlace` is what makes "archives with a place" filterable without parsing
 * every note. It projects from the frontmatter the index already reads.
 */
describe('PostIndexService.buildEntry — places', () => {
  it('projects hasPlace when the caller found one', () => {
    const entry = PostIndexService.buildEntry(
      fileNamed('Social Archives/threads/post.md'),
      { location: '서울 성수동' },
      'body',
      'threads',
      { ...METADATA, hasPlace: true },
    );

    expect(entry.hasPlace).toBe(true);
  });

  it('leaves hasPlace undefined rather than false for the ordinary case', () => {
    // Absent beats `false` — the index is persisted per note, and this is the
    // overwhelming majority of them.
    const entry = PostIndexService.buildEntry(
      fileNamed('Social Archives/threads/post.md'),
      {},
      'body',
      'threads',
      METADATA,
    );

    expect(entry.hasPlace).toBeUndefined();
    expect('hasPlace' in entry).toBe(false);
  });
});
