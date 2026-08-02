import { describe, it, expect } from 'vitest';
import { FilterSortManager } from '@/components/timeline/filters/FilterSortManager';
import type { PostData } from '@/types/post';
import type { PostIndexEntry } from '@/services/PostIndexService';

/**
 * Tri-state transcribed filter (feedback #91 parity with mobile):
 * - null: off — matches everything
 * - true: only posts that have a transcript
 * - false: only VIDEO posts without a transcript (text posts never match)
 *
 * Both filter paths (PostData and index) must agree — a card that appears in
 * one and not the other reads as data loss.
 */

function makePost(overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'x',
    filePath: `test/${Math.random()}.md`,
    title: 'Test Post',
    authorName: 'Test Author',
    authorUrl: 'https://example.com',
    publishedDate: new Date(),
    archivedDate: new Date(),
    metadata: { timestamp: new Date() },
    ...overrides,
  } as PostData;
}

function makeEntry(id: string, overrides: Partial<PostIndexEntry> = {}): PostIndexEntry {
  return {
    id,
    platform: 'x',
    filePath: `${id}.md`,
    fileModifiedTime: 0,
    authorName: 'Author',
    publishedDate: 0,
    archivedDate: 0,
    tags: [],
    hashtags: [],
    like: false,
    archive: false,
    isLocalOnly: false,
    subscribed: false,
    searchText: '',
    url: `https://example.com/${id}`,
    mediaCount: 0,
    commentCount: 0,
    metadataTimestamp: 0,
    ...overrides,
  };
}

describe('FilterSortManager — transcribed filter (PostData path)', () => {
  const whisperPost = makePost({
    filePath: 'whisper.md',
    platform: 'podcast',
    whisperTranscript: {
      segments: [{ id: 0, start: 0, end: 1, text: 'hello' }],
      language: 'en',
    },
  });
  const youtubeTranscriptPost = makePost({
    filePath: 'yt-transcribed.md',
    platform: 'youtube',
    transcript: { raw: 'full transcript text' },
  });
  const youtubeFormattedPost = makePost({
    filePath: 'yt-formatted.md',
    platform: 'youtube',
    transcript: { formatted: [{ start_time: 0, end_time: 1, duration: 1, text: 'hi' }] },
  });
  const untranscribedVideoPost = makePost({
    filePath: 'video-plain.md',
    media: [{ type: 'video', url: 'https://example.com/v.mp4' }],
  });
  const untranscribedYoutubePost = makePost({
    filePath: 'yt-plain.md',
    platform: 'youtube',
  });
  const textPost = makePost({ filePath: 'text.md' });

  const posts = [
    whisperPost,
    youtubeTranscriptPost,
    youtubeFormattedPost,
    untranscribedVideoPost,
    untranscribedYoutubePost,
    textPost,
  ];

  it('true matches posts with whisper segments or youtube transcript', () => {
    const manager = new FilterSortManager({ transcribed: true });
    const result = manager.applyFiltersAndSort(posts).map(p => p.filePath);
    expect(result).toHaveLength(3);
    expect(result).toEqual(
      expect.arrayContaining(['whisper.md', 'yt-transcribed.md', 'yt-formatted.md'])
    );
  });

  it('false matches videos without transcript but never text posts', () => {
    const manager = new FilterSortManager({ transcribed: false });
    const result = manager.applyFiltersAndSort(posts).map(p => p.filePath);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining(['video-plain.md', 'yt-plain.md']));
    expect(result).not.toContain('text.md');
  });

  it('null matches everything', () => {
    const manager = new FilterSortManager({ transcribed: null });
    expect(manager.applyFiltersAndSort(posts)).toHaveLength(posts.length);
  });

  it('defaults to null (off)', () => {
    const manager = new FilterSortManager();
    expect(manager.getFilterState().transcribed).toBeNull();
    expect(manager.applyFiltersAndSort(posts)).toHaveLength(posts.length);
  });
});

describe('FilterSortManager — transcribed filter (index path)', () => {
  const transcribedVideo = makeEntry('transcribed-video', { hasTranscript: true, hasVideo: true });
  const transcribedAudio = makeEntry('transcribed-audio', { hasTranscript: true });
  const plainVideo = makeEntry('plain-video', { hasVideo: true });
  const textEntry = makeEntry('text');
  const entries = [transcribedVideo, transcribedAudio, plainVideo, textEntry];

  it('true matches only entries with hasTranscript', () => {
    const manager = new FilterSortManager({ transcribed: true });
    const result = manager.applyFiltersAndSortIndex(entries).map(e => e.id);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining(['transcribed-video', 'transcribed-audio']));
  });

  it('false matches only videos without transcript', () => {
    const manager = new FilterSortManager({ transcribed: false });
    const result = manager.applyFiltersAndSortIndex(entries).map(e => e.id);
    expect(result).toEqual(['plain-video']);
  });

  it('entries missing both v8 fields match neither direction', () => {
    // Pre-v8 shape (undefined fields) — the INDEX_VERSION bump rebuilds these,
    // but until then they must read as "not transcribed, not video".
    const legacy = makeEntry('legacy');
    expect(
      new FilterSortManager({ transcribed: true }).applyFiltersAndSortIndex([legacy])
    ).toHaveLength(0);
    expect(
      new FilterSortManager({ transcribed: false }).applyFiltersAndSortIndex([legacy])
    ).toHaveLength(0);
  });

  it('null matches everything', () => {
    const manager = new FilterSortManager({ transcribed: null });
    expect(manager.applyFiltersAndSortIndex(entries)).toHaveLength(entries.length);
  });
});

describe('FilterSortManager — transcribed hasActiveFilters', () => {
  it('counts transcribed !== null as an active filter', () => {
    expect(new FilterSortManager({ transcribed: true }).hasActiveFilters()).toBe(true);
    expect(new FilterSortManager({ transcribed: false }).hasActiveFilters()).toBe(true);
    expect(new FilterSortManager({ transcribed: null }).hasActiveFilters()).toBe(false);
  });

  it('resets to null with resetFilters', () => {
    const manager = new FilterSortManager({ transcribed: true });
    manager.resetFilters();
    expect(manager.getFilterState().transcribed).toBeNull();
    expect(manager.hasActiveFilters()).toBe(false);
  });
});
