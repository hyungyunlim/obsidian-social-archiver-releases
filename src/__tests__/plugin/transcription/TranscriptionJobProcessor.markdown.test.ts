import { describe, expect, it } from 'vitest';
import { upsertDownloadedVideoEmbed } from '../../../plugin/transcription/TranscriptionJobProcessor';

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
});
