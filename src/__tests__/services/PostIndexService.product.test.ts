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
