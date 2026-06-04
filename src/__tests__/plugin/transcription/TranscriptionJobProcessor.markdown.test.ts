import { describe, expect, it } from 'vitest';
import {
  upsertDownloadedAudioEmbed,
  upsertDownloadedVideoEmbed,
} from '../../../plugin/transcription/TranscriptionJobProcessor';

describe('upsertDownloadedVideoEmbed', () => {
  it('inserts a downloaded video embed below the YouTube title', () => {
    const content = `---
platform: youtube
originalUrl: https://www.youtube.com/watch?v=abc123
---

# Example Video

## Description

Example description.
`;

    expect(upsertDownloadedVideoEmbed(content, 'attachments/social-archives/youtube/video.mp4')).toBe(`---
platform: youtube
originalUrl: https://www.youtube.com/watch?v=abc123
---

# Example Video

![[attachments/social-archives/youtube/video.mp4]]

## Description

Example description.
`);
  });

  it('does not duplicate an existing downloaded video embed', () => {
    const content = `---
platform: youtube
---

# Example Video

![[attachments/social-archives/youtube/video.mp4]]

Body.
`;

    expect(upsertDownloadedVideoEmbed(content, 'attachments/social-archives/youtube/video.mp4')).toBe(content);
  });

  it('inserts a video embed even when the path already exists in frontmatter metadata', () => {
    const content = `---
platform: youtube
videoDownloaded: true
localVideoPath: attachments/social-archives/youtube/video.mp4
media:
  - video:attachments/social-archives/youtube/video.mp4
---

# Example Video

## Transcript

Existing transcript.
`;

    expect(upsertDownloadedVideoEmbed(content, 'attachments/social-archives/youtube/video.mp4')).toBe(`---
platform: youtube
videoDownloaded: true
localVideoPath: attachments/social-archives/youtube/video.mp4
media:
  - video:attachments/social-archives/youtube/video.mp4
---

# Example Video

![[attachments/social-archives/youtube/video.mp4]]

## Transcript

Existing transcript.
`);
  });

  it('handles CRLF frontmatter delimiters without inserting into frontmatter', () => {
    const content = [
      '---',
      'platform: youtube',
      'localVideoPath: attachments/social-archives/youtube/video.mp4',
      '---',
      '',
      '# Example Video',
      '',
      'Body.',
      '',
    ].join('\r\n');

    expect(upsertDownloadedVideoEmbed(content, 'attachments/social-archives/youtube/video.mp4')).toBe([
      '---',
      'platform: youtube',
      'localVideoPath: attachments/social-archives/youtube/video.mp4',
      '---',
      '',
      '# Example Video',
      '',
      '![[attachments/social-archives/youtube/video.mp4]]',
      '',
      'Body.',
      '',
    ].join('\r\n'));
  });
});

describe('upsertDownloadedAudioEmbed', () => {
  it('replaces a remote audio tag with a local vault embed', () => {
    const content = `---
platform: podcast
---

# Podcast Episode

<audio controls src="https://rss.art19.com/episodes/example.mp3"></audio>

Show notes.
`;

    expect(upsertDownloadedAudioEmbed(content, 'attachments/social-archives/podcast/episode.mp3')).toBe(`---
platform: podcast
---

# Podcast Episode

![[attachments/social-archives/podcast/episode.mp3]]

Show notes.
`);
  });

  it('does not duplicate an existing downloaded audio embed', () => {
    const content = `---
platform: podcast
audioLocalPath: attachments/social-archives/podcast/episode.mp3
---

# Podcast Episode

![[attachments/social-archives/podcast/episode.mp3]]

Show notes.
`;

    expect(upsertDownloadedAudioEmbed(content, 'attachments/social-archives/podcast/episode.mp3')).toBe(content);
  });

  it('inserts an audio embed below the title when no audio tag exists', () => {
    const content = `---
platform: podcast
audioLocalPath: attachments/social-archives/podcast/episode.mp3
---

# Podcast Episode

Show notes.
`;

    expect(upsertDownloadedAudioEmbed(content, 'attachments/social-archives/podcast/episode.mp3')).toBe(`---
platform: podcast
audioLocalPath: attachments/social-archives/podcast/episode.mp3
---

# Podcast Episode

![[attachments/social-archives/podcast/episode.mp3]]

Show notes.
`);
  });
});
