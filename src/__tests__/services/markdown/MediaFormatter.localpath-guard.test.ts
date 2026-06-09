import { describe, it, expect, beforeEach } from 'vitest';
import { MediaFormatter } from '@/services/markdown/formatters/MediaFormatter';
import { DateNumberFormatter } from '@/services/markdown/formatters/DateNumberFormatter';
import type { PostData } from '@/types/post';
import type { MediaResult } from '@/services/MediaHandler';

/**
 * Ship 3, item 4: MediaFormatter must never emit a `![](localpath:...)` /
 * `./media/...` embed. A local-sentinel media item with no resolved download is
 * rendered as an Unavailable callout instead.
 */
describe('MediaFormatter — local-sentinel guard', () => {
  let formatter: MediaFormatter;
  const POST_URL = 'https://instagram.com/p/abc';

  beforeEach(() => {
    formatter = new MediaFormatter(new DateNumberFormatter());
  });

  it('renders an Unavailable callout for a localpath: image (no download)', () => {
    const media: PostData['media'] = [
      { type: 'image', url: 'localpath:./media/2024-01-01/00-image.jpg' },
    ];
    const out = formatter.formatMedia(media, 'instagram', POST_URL, []);

    expect(out).toContain('> [!note] Media Unavailable');
    expect(out).not.toContain('localpath:');
    expect(out).not.toContain('![](');
  });

  it('renders an Unavailable callout for a bare relative media/ video', () => {
    const media: PostData['media'] = [{ type: 'video', url: 'media/clip.mp4' }];
    const out = formatter.formatMedia(media, 'instagram', POST_URL, []);

    expect(out).toContain('> [!note] Media Unavailable');
    expect(out).toContain('> Kind: video');
    expect(out).not.toContain('media/clip.mp4');
  });

  it('renders a real https image normally', () => {
    const media: PostData['media'] = [
      { type: 'image', url: 'https://cdn.example.com/a.jpg', altText: 'A' },
    ];
    const out = formatter.formatMedia(media, 'instagram', POST_URL, []);

    expect(out).toContain('https://cdn.example.com/a.jpg');
    expect(out).not.toContain('[!note] Media Unavailable');
  });

  it('prefers a resolved local download over the unavailable callout', () => {
    const media: PostData['media'] = [
      { type: 'image', url: 'localpath:media/x.jpg' },
    ];
    const mediaResults: MediaResult[] = [
      {
        originalUrl: 'localpath:media/x.jpg',
        localPath: 'attachments/social-archives/instagram/abc/img-0.webp',
        type: 'image',
        size: 1,
        file: { path: 'attachments/social-archives/instagram/abc/img-0.webp' } as never,
        sourceIndex: 0,
        fallbackKind: 'none',
      },
    ];
    const out = formatter.formatMedia(media, 'instagram', POST_URL, mediaResults);

    expect(out).toContain('img-0.webp');
    expect(out).not.toContain('[!note] Media Unavailable');
    expect(out).not.toContain('localpath:');
  });

  it('mixes a real image and a sentinel, never leaking the sentinel URL', () => {
    const media: PostData['media'] = [
      { type: 'image', url: 'https://cdn.example.com/ok.jpg' },
      { type: 'image', url: 'localpath:media/bad.jpg' },
    ];
    const out = formatter.formatMedia(media, 'instagram', POST_URL, []);

    expect(out).toContain('https://cdn.example.com/ok.jpg');
    expect(out).toContain('> [!note] Media Unavailable');
    expect(out).not.toContain('localpath:');
  });
});
