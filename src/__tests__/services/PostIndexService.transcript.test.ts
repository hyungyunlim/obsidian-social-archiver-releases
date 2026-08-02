import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { PostIndexService } from '@/services/PostIndexService';

/**
 * `hasTranscript` / `hasVideo` (index v8) are what make the Transcribed quick
 * filter run on the index without parsing every note. Both project through
 * `buildEntry` the same way `hasPlace` does: present-as-true or absent.
 */

function fileNamed(path: string): TFile {
  const file = new (TFile as unknown as new (path: string) => TFile)(path);
  file.stat = { ctime: 0, mtime: 0, size: 0 } as TFile['stat'];
  return file;
}

const METADATA = {
  authorName: 'Some Channel',
  url: 'https://www.youtube.com/watch?v=abc',
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

describe('PostIndexService.buildEntry — transcript/video (v8)', () => {
  it('projects hasTranscript and hasVideo when the caller found them', () => {
    const entry = PostIndexService.buildEntry(
      fileNamed('Social Archives/youtube/video.md'),
      {},
      'body',
      'youtube',
      { ...METADATA, hasTranscript: true, hasVideo: true },
    );

    expect(entry.hasTranscript).toBe(true);
    expect(entry.hasVideo).toBe(true);
  });

  it('leaves both absent rather than false for the ordinary case', () => {
    // Absent beats `false` — the index is persisted per note, and most notes
    // are neither videos nor transcribed.
    const entry = PostIndexService.buildEntry(
      fileNamed('Social Archives/threads/post.md'),
      {},
      'body',
      'threads',
      METADATA,
    );

    expect(entry.hasTranscript).toBeUndefined();
    expect('hasTranscript' in entry).toBe(false);
    expect(entry.hasVideo).toBeUndefined();
    expect('hasVideo' in entry).toBe(false);
  });

  it('projects hasVideo alone for an untranscribed video', () => {
    const entry = PostIndexService.buildEntry(
      fileNamed('Social Archives/instagram/reel.md'),
      {},
      'body',
      'instagram',
      { ...METADATA, hasVideo: true },
    );

    expect(entry.hasVideo).toBe(true);
    expect('hasTranscript' in entry).toBe(false);
  });
});
