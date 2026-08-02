import { describe, it, expect } from 'vitest';
import {
  pickMosaicThumbnail,
  mosaicTextExcerpt,
  type MosaicThumbnailSource,
} from '../../../components/timeline/renderers/MosaicViewRenderer';
import type { Media } from '../../../types/post';

const media = (overrides: Partial<Media>): Media => ({
  type: 'image',
  url: 'attachments/social-archives/img.jpg',
  ...overrides,
});

const source = (overrides: Partial<MosaicThumbnailSource> = {}): MosaicThumbnailSource => ({
  media: [],
  ...overrides,
});

describe('pickMosaicThumbnail', () => {
  it('picks the first image media', () => {
    const post = source({
      media: [
        media({ type: 'video', url: 'vid.mp4', thumbnail: 'vid-thumb.jpg' }),
        media({ type: 'image', url: 'first.jpg' }),
        media({ type: 'image', url: 'second.jpg' }),
      ],
    });
    // Priority is "first IMAGE media", not "first media": the video at
    // index 0 is skipped in the image pass even though it has a poster.
    expect(pickMosaicThumbnail(post)).toEqual({ url: 'first.jpg', type: 'image' });
  });

  it('falls back to post.thumbnail (YouTube) when there is no image media', () => {
    const post = source({ thumbnail: 'https://i.ytimg.com/vi/x/hq.jpg' });
    expect(pickMosaicThumbnail(post)).toEqual({
      url: 'https://i.ytimg.com/vi/x/hq.jpg',
      type: 'image',
    });
  });

  it('uses the first video poster (thumbnail > r2ThumbnailUrl > thumbnailUrl) as an image', () => {
    const post = source({
      media: [media({ type: 'video', url: 'vid.mp4', r2ThumbnailUrl: 'r2-thumb.jpg' })],
    });
    expect(pickMosaicThumbnail(post)).toEqual({ url: 'r2-thumb.jpg', type: 'image' });
  });

  it('returns the video itself when it has no poster', () => {
    const post = source({ media: [media({ type: 'video', url: 'vid.mp4' })] });
    expect(pickMosaicThumbnail(post)).toEqual({ url: 'vid.mp4', type: 'video' });
  });

  it('falls back to metadata.externalLinkImage', () => {
    const post = source({ metadata: { externalLinkImage: 'https://example.com/og.png' } });
    expect(pickMosaicThumbnail(post)).toEqual({
      url: 'https://example.com/og.png',
      type: 'image',
    });
  });

  it('ignores audio/document media and empty urls', () => {
    const post = source({
      media: [
        media({ type: 'audio', url: 'pod.mp3' }),
        media({ type: 'document', url: 'doc.pdf' }),
        media({ type: 'image', url: '' }),
      ],
    });
    expect(pickMosaicThumbnail(post)).toBeNull();
  });

  it('returns null for a text-only post (text tile)', () => {
    expect(pickMosaicThumbnail(source())).toBeNull();
    expect(pickMosaicThumbnail(source({ media: undefined as unknown as Media[] }))).toBeNull();
  });
});

describe('mosaicTextExcerpt', () => {
  it('returns short text unchanged (trimmed)', () => {
    expect(mosaicTextExcerpt('  hello world  ')).toBe('hello world');
  });

  it('collapses internal whitespace and newlines', () => {
    expect(mosaicTextExcerpt('line one\n\nline   two\ttabbed')).toBe('line one line two tabbed');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(mosaicTextExcerpt('')).toBe('');
    expect(mosaicTextExcerpt('   \n  ')).toBe('');
  });

  it('truncates long text on a word boundary with an ellipsis', () => {
    const text = 'word '.repeat(100); // 500 chars
    const excerpt = mosaicTextExcerpt(text, 200);
    expect(excerpt.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toMatch(/wor…$/); // no mid-word cut
  });

  it('hard-cuts when there is no usable word boundary', () => {
    const text = 'a'.repeat(300);
    const excerpt = mosaicTextExcerpt(text, 200);
    expect(excerpt).toBe(`${'a'.repeat(200)}…`);
  });

  it('respects a custom max length', () => {
    const excerpt = mosaicTextExcerpt('one two three four five six', 10);
    expect(excerpt).toBe('one two…');
  });
});
