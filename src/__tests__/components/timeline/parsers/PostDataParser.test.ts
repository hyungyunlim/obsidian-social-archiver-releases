import type { Vault } from 'obsidian';
import { PostDataParser } from '@/components/timeline/parsers/PostDataParser';

describe('PostDataParser transcript handling', () => {
  const parser = new PostDataParser({} as Vault);

  const MARKDOWN_WITH_EMOJI_TRANSCRIPT = `---
platform: youtube
title: "Sample Video"
---

# 📺 Sample Video

## 📝 Description

This is the visible description.

---

## 📄 Transcript

**Full Transcript:**

Very long transcript text that should not appear in the card content.

---

[00:00](https://www.youtube.com/watch?v=abc123&t=0s) First line

[00:02](https://www.youtube.com/watch?v=abc123&t=2s) Second line

---

**Platform:** youtube
`;

  it('removes transcript section from extracted card content', () => {
    const content = parser.extractContentText(MARKDOWN_WITH_EMOJI_TRANSCRIPT);

    expect(content).toContain('This is the visible description.');
    expect(content).not.toContain('Full Transcript');
    expect(content).not.toContain('[00:00]');
    expect(content).not.toContain('First line');
  });

  it('treats a gallery with media fallback lines as media-only (no inline duplication)', () => {
    // Mirrors a clipped Instagram story note: image embeds plus a
    // "[🎥 Video](url)" link fallback for a skipped video. One non-`![`
    // line must not make the whole gallery leak into the card body.
    const markdown = `---
platform: instagram
title: "Instagram story by @user"
---

Instagram story by [@user](https://instagram.com/user)

---

![image 1](attachments/social-archives/clips/instagram-story_x/00-image.jpg)

![image 2](attachments/social-archives/clips/instagram-story_x/01-image.jpg)

[🎥 Video (0:20)](https://www.instagram.com/stories/user/)

---

**Platform:** Instagram | **Author:** [@user](https://instagram.com/user)
`;

    const content = parser.extractContentText(markdown);

    expect(content).toContain('Instagram story by');
    expect(content).not.toContain('![image 1]');
    expect(content).not.toContain('🎥 Video');
  });

  it('parses transcript segments from emoji transcript header', () => {
    const transcript = (parser as unknown as {
      parseWhisperTranscript: (content: string, language?: string) => { language: string; segments: Array<{ start: number; end: number; text: string }> } | undefined;
    }).parseWhisperTranscript(MARKDOWN_WITH_EMOJI_TRANSCRIPT, 'en');

    expect(transcript).toBeDefined();
    expect(transcript?.language).toBe('en');
    expect(transcript?.segments).toHaveLength(2);
    expect(transcript?.segments[0]).toMatchObject({ start: 0, end: 2, text: 'First line' });
    expect(transcript?.segments[1]).toMatchObject({ start: 2, text: 'Second line' });
  });
});
