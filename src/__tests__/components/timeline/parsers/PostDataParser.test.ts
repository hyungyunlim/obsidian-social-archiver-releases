import type { Vault } from 'obsidian';
import { PostDataParser } from '@/components/timeline/parsers/PostDataParser';
import { parseTranscriptSections, resolveNoteTranscriptLanguages, type TranscriptSection } from '@/services/markdown/TranscriptSectionManager';
import type { MultiLangTranscript, PostData } from '@/types/post';

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
      parseWhisperTranscript: (content: string, sections: TranscriptSection[], fallback?: string) => { language: string; segments: Array<{ start: number; end: number; text: string }> } | undefined;
    }).parseWhisperTranscript(MARKDOWN_WITH_EMOJI_TRANSCRIPT, parseTranscriptSections(MARKDOWN_WITH_EMOJI_TRANSCRIPT, 'en'), 'en');

    expect(transcript).toBeDefined();
    expect(transcript?.language).toBe('en');
    expect(transcript?.segments).toHaveLength(2);
    expect(transcript?.segments[0]).toMatchObject({ start: 0, end: 2, text: 'First line' });
    expect(transcript?.segments[1]).toMatchObject({ start: 2, text: 'Second line' });
  });
});

describe('PostDataParser transcript languages (T10/T12)', () => {
  const parser = new PostDataParser({} as Vault);
  const raw = parser as unknown as {
    parseWhisperTranscript: (content: string, sections: TranscriptSection[], fallback?: string) => PostData['whisperTranscript'];
    parseMultiLangTranscripts: (sections: TranscriptSection[], preferredDefault?: unknown) => MultiLangTranscript | undefined;
  };
  type Languages = { original?: string; whisper?: string };
  const internals = {
    parseWhisperTranscript: (md: string, languages?: Languages) =>
      raw.parseWhisperTranscript(md, parseTranscriptSections(md, languages)),
    parseMultiLangTranscripts: (md: string, languages?: Languages, preferredDefault?: unknown) =>
      raw.parseMultiLangTranscripts(parseTranscriptSections(md, languages), preferredDefault),
  };

  const note = (...sections: string[]) => `---\nplatform: youtube\n---\n\nDescription\n\n---\n\n${sections.join('\n\n')}\n`;
  const ORIGINAL_KO = '## Transcript\n\n[00:00](https://www.youtube.com/watch?v=abc&t=0s) 안녕하세요 여러분\n\n[00:04](https://www.youtube.com/watch?v=abc&t=4s) 오늘은 자막 이야기';
  const WHISPER_KO = '<!-- social-archiver-transcript:start resultMarkerId=tr_1 -->\n## Transcript\n\n[00:00] 위스퍼 안녕하세요\n<!-- social-archiver-transcript:end resultMarkerId=tr_1 -->';
  const CAPTION_EN = '<!-- social-archiver-caption:start language=en kind=manual -->\n## Transcript (English)\n\n[00:00] Hello everyone\n<!-- social-archiver-caption:end language=en -->';
  const AI_KO = '## Transcript (Korean)\n\n[00:00] AI 번역';

  it('labels a Korean-script note without frontmatter as ko, not en', () => {
    const md = note(ORIGINAL_KO);
    const languages = resolveNoteTranscriptLanguages({}, md);

    expect(internals.parseWhisperTranscript(md, languages)).toMatchObject({ language: 'ko', source: 'original' });
  });

  it('keeps an original and a Whisper section of the same language as two tabs', () => {
    const md = note(ORIGINAL_KO, WHISPER_KO);
    const multi = internals.parseMultiLangTranscripts(md, resolveNoteTranscriptLanguages({ transcriptionLanguage: 'ko' }, md));

    expect(Object.keys(multi!.byLanguage)).toEqual(['ko', 'ko:whisper']);
    expect(multi!.sources).toEqual({ ko: 'original', 'ko:whisper': 'whisper' });
    expect(multi!.defaultLanguage).toBe('ko:whisper');
    expect(internals.parseWhisperTranscript(md, { original: 'ko', whisper: 'ko' })?.segments[0]?.text).toBe('위스퍼 안녕하세요');
  });

  it('ranks original/caption before Whisper before AI for the bare key', () => {
    const md = note(ORIGINAL_KO, AI_KO, CAPTION_EN, WHISPER_KO);
    const multi = internals.parseMultiLangTranscripts(md, { original: 'ko', whisper: 'ko' });

    expect(Object.keys(multi!.byLanguage)).toEqual(['ko', 'en', 'ko:whisper', 'ko:ai']);
    expect(multi!.sources).toMatchObject({ ko: 'original', en: 'caption', 'ko:whisper': 'whisper', 'ko:ai': 'ai' });
  });

  it('opens transcriptDefaultLanguage first when it names a caption/original tab', () => {
    const md = note(ORIGINAL_KO, CAPTION_EN, WHISPER_KO);
    const languages = { original: 'ko', whisper: 'ko' };

    expect(internals.parseMultiLangTranscripts(md, languages, 'en')?.defaultLanguage).toBe('en');
    expect(internals.parseMultiLangTranscripts(md, languages)?.defaultLanguage).toBe('ko:whisper');
    expect(internals.parseMultiLangTranscripts(note(ORIGINAL_KO, CAPTION_EN), languages)?.defaultLanguage).toBe('ko');
  });

  it('dedupes region codes regardless of case', () => {
    const md = note(
      ORIGINAL_KO,
      '<!-- social-archiver-caption:start language=pt-BR kind=manual -->\n## Transcript (Brazilian Portuguese)\n\n[00:00] Olá\n<!-- social-archiver-caption:end language=pt-BR -->'
    );
    const multi = internals.parseMultiLangTranscripts(md, { original: 'ko' }, 'PT-br');

    expect(Object.keys(multi!.byLanguage)).toEqual(['ko', 'pt-br']);
    expect(multi!.defaultLanguage).toBe('pt-br');
  });
});
