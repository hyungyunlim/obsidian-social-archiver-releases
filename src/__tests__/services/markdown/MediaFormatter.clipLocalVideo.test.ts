import { describe, it, expect, beforeEach } from 'vitest';
import { MediaFormatter } from '@/services/markdown/formatters/MediaFormatter';
import { DateNumberFormatter } from '@/services/markdown/formatters/DateNumberFormatter';
import type { PostData } from '@/types/post';
import type { MediaResult } from '@/services/MediaHandler';

/**
 * Browser-clip folder handoff (mediaDelivery='local'): the extension
 * downloads media into the vault and rewrites media[].url to vault paths
 * BEFORE the plugin runs — downloadMedia is off, so no MediaResult exists.
 * renderVideo must embed such a vault-path video instead of falling through
 * to the thumbnail→post-URL fallback (the Facebook reel clip regression).
 */
describe('MediaFormatter — clip-localized video (vault path in item.url)', () => {
  let formatter: MediaFormatter;
  const POST_URL = 'https://www.facebook.com/reel/1196469985881007';
  const VAULT_VIDEO = 'attachments/social-archives/clips/facebook-1196469985881007/00-video.mp4';
  const VAULT_THUMB = 'attachments/social-archives/clips/facebook-1196469985881007/00-video-thumb.jpg';

  beforeEach(() => {
    formatter = new MediaFormatter(new DateNumberFormatter());
  });

  it('embeds a vault-path video even when a local thumbnail is also present', () => {
    const media: PostData['media'] = [
      { type: 'video', url: VAULT_VIDEO, thumbnail: VAULT_THUMB, duration: 35 },
    ];
    const out = formatter.formatMedia(media, 'facebook', POST_URL, undefined);

    expect(out).toContain(`![🎥 Video (0:35)](${VAULT_VIDEO})`);
    // Must NOT be the clickable-thumbnail fallback linking back to the post.
    expect(out).not.toContain(`](${POST_URL})`);
  });

  it('embeds a vault-path video without a thumbnail', () => {
    const media: PostData['media'] = [{ type: 'video', url: VAULT_VIDEO }];
    const out = formatter.formatMedia(media, 'facebook', POST_URL, undefined);

    expect(out).toContain(`![🎥 Video](${VAULT_VIDEO})`);
  });

  it('still renders thumbnail→post-URL fallback for a remote video URL', () => {
    const media: PostData['media'] = [
      { type: 'video', url: 'https://video.fbcdn.net/o1/v/t2/f2/m367/stream.mp4', thumbnail: VAULT_THUMB },
    ];
    const out = formatter.formatMedia(media, 'facebook', POST_URL, undefined);

    expect(out).toContain(`[![🎥 Video](${VAULT_THUMB})](${POST_URL})`);
    expect(out).not.toContain('![🎥 Video](https://');
  });

  it('does not embed a local-sentinel url when the download fell back to thumbnail-only', () => {
    const media: PostData['media'] = [
      { type: 'video', url: 'localpath:media/clip.mp4', thumbnail: VAULT_THUMB },
    ];
    const mediaResults: MediaResult[] = [
      {
        originalUrl: 'localpath:media/clip.mp4',
        localPath: VAULT_THUMB,
        type: 'video',
        size: 1,
        file: { path: VAULT_THUMB } as never,
        sourceIndex: 0,
        fallbackKind: 'thumbnail',
      },
    ];
    const out = formatter.formatMedia(media, 'facebook', POST_URL, mediaResults);

    expect(out).not.toContain('localpath:');
    expect(out).toContain(`[![🎥 Video](${VAULT_THUMB})](${POST_URL})`);
  });
});
