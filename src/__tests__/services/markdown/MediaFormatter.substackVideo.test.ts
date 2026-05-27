import { describe, it, expect, beforeEach } from 'vitest';
import { MediaFormatter } from '@/services/markdown/formatters/MediaFormatter';
import { DateNumberFormatter } from '@/services/markdown/formatters/DateNumberFormatter';
import type { PostData } from '@/types/post';

/**
 * PRD §22.4: When a Substack note HLS video is NOT downloaded (skipped because
 * HLS cannot be client-downloaded), the rendered markdown must keep the
 * streamable resolver link `[🎥 Video](resolver)` — not a broken local embed.
 */
describe('MediaFormatter — Substack note HLS video link retention (PRD §22.4)', () => {
  let formatter: MediaFormatter;

  const RESOLVER_URL =
    'https://substack.com/api/v1/video/upload/abc-123/src?type=hls';
  const POST_URL = 'https://substack.com/@h/note/c-1';

  beforeEach(() => {
    formatter = new MediaFormatter(new DateNumberFormatter());
  });

  it('retains the resolver link when the HLS video has no downloaded media', () => {
    const media: PostData['media'] = [
      { type: 'video', url: RESOLVER_URL, duration: 6 },
    ];

    // No mediaResults → mirrors the post-skip state (item not downloaded).
    const out = formatter.formatMedia(media, 'substack', POST_URL, []);

    expect(out).toContain('🎥 Video');
    // The streamable resolver URL must be the link target.
    expect(out).toContain(RESOLVER_URL);
    // It must NOT be embedded as a local file (no ![[...]] / no .mp4 local path).
    expect(out).not.toContain('![[');
  });

  it('renders the resolver link even alongside a localized image', () => {
    const media: PostData['media'] = [
      { type: 'image', url: 'https://substack-post-media.s3.amazonaws.com/x.png' },
      { type: 'video', url: RESOLVER_URL },
    ];

    const out = formatter.formatMedia(media, 'substack', POST_URL, [
      {
        originalUrl: 'https://substack-post-media.s3.amazonaws.com/x.png',
        localPath: 'attachments/social-archives/substack/c-1/img-1.webp',
        type: 'image',
        size: 1,
        // minimal TFile-ish stub; MediaFormatter only reads localPath
        file: { path: 'attachments/social-archives/substack/c-1/img-1.webp' } as never,
        sourceIndex: 0,
        fallbackKind: 'none',
      },
    ]);

    expect(out).toContain('img-1.webp');
    expect(out).toContain(RESOLVER_URL);
  });
});
