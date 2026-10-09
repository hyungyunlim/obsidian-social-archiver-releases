import {
  parseTranscriptSections,
  hasTranscriptLanguage,
  insertTranscriptSection,
  removeTranscriptSection,
  extractTranscriptLanguages,
  insertCaptionSection,
  removeCaptionSection,
  listCaptionSections,
  findUnmarkedSection,
  resolveNoteTranscriptLanguages,
} from '../../../services/markdown/TranscriptSectionManager';

// ─── Fixtures ───────────────────────────────────────────

const SINGLE_TRANSCRIPT = `---
platform: youtube
---

Some content

---

## Transcript

[0:00] Hello and welcome
[0:05] Today we discuss architecture

---

## AI Comments

### 🤖 Claude · Summary
Summary text`;

const MULTI_LANG_TRANSCRIPT = `---
platform: youtube
transcriptLanguages:
  - en
  - ko
---

Some content

---

## Transcript

[0:00] Hello and welcome
[0:05] Today we discuss architecture

## Transcript (Korean)

[0:00] 안녕하세요, 환영합니다
[0:05] 오늘은 아키텍처를 이야기합니다

---

## AI Comments

### 🤖 Claude · Summary
Summary text`;

const THREE_LANG_TRANSCRIPT = `---
platform: youtube
---

## Transcript

[0:00] Hello

## Transcript (Korean)

[0:00] 안녕하세요

## Transcript (Japanese)

[0:00] こんにちは`;

const EMOJI_TRANSCRIPT = `---
platform: youtube
---

## 📄 Transcript

[0:00] Hello with emoji header

## 📄 Transcript (Korean)

[0:00] 이모지 헤더 한국어
`;

const TRANSCRIPT_WITH_INTERNAL_DIVIDER = `---
platform: youtube
---

## 📄 Transcript

**Full Transcript:**

Long paragraph text.

---

[00:00] Segment one

[00:02] Segment two

---

**Platform:** youtube
`;

// ─── parseTranscriptSections ───────────────────────────

describe('parseTranscriptSections', () => {
  it('should parse single original transcript', () => {
    const sections = parseTranscriptSections(SINGLE_TRANSCRIPT, 'en');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.languageCode).toBe('en');
    expect(sections[0]!.languageName).toBe('');
    expect(sections[0]!.body).toContain('[0:00] Hello and welcome');
  });

  it('should parse multi-language transcripts', () => {
    const sections = parseTranscriptSections(MULTI_LANG_TRANSCRIPT, 'en');
    expect(sections).toHaveLength(2);
    expect(sections[0]!.languageCode).toBe('en');
    expect(sections[1]!.languageCode).toBe('ko');
    expect(sections[1]!.languageName).toBe('Korean');
    expect(sections[1]!.body).toContain('안녕하세요');
  });

  it('should parse three languages', () => {
    const sections = parseTranscriptSections(THREE_LANG_TRANSCRIPT, 'en');
    expect(sections).toHaveLength(3);
    expect(sections[0]!.languageCode).toBe('en');
    expect(sections[1]!.languageCode).toBe('ko');
    expect(sections[2]!.languageCode).toBe('ja');
  });

  it('should default to en when no defaultLanguageCode provided', () => {
    const sections = parseTranscriptSections(SINGLE_TRANSCRIPT);
    expect(sections[0]!.languageCode).toBe('en');
  });

  it('should parse emoji transcript headers', () => {
    const sections = parseTranscriptSections(EMOJI_TRANSCRIPT, 'en');
    expect(sections).toHaveLength(2);
    expect(sections[0]!.languageCode).toBe('en');
    expect(sections[1]!.languageCode).toBe('ko');
    expect(sections[1]!.body).toContain('이모지 헤더 한국어');
  });

  it('should keep transcript body after internal --- divider', () => {
    const sections = parseTranscriptSections(TRANSCRIPT_WITH_INTERNAL_DIVIDER, 'en');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.body).toContain('[00:00] Segment one');
    expect(sections[0]!.body).toContain('[00:02] Segment two');
    expect(sections[0]!.body).not.toContain('**Platform:**');
  });
});

// ─── hasTranscriptLanguage ─────────────────────────────

describe('hasTranscriptLanguage', () => {
  it('should detect existing language', () => {
    expect(hasTranscriptLanguage(MULTI_LANG_TRANSCRIPT, 'ko', 'en')).toBe(true);
    expect(hasTranscriptLanguage(MULTI_LANG_TRANSCRIPT, 'en', 'en')).toBe(true);
  });

  it('should return false for missing language', () => {
    expect(hasTranscriptLanguage(MULTI_LANG_TRANSCRIPT, 'ja', 'en')).toBe(false);
    expect(hasTranscriptLanguage(SINGLE_TRANSCRIPT, 'ko', 'en')).toBe(false);
  });
});

// ─── insertTranscriptSection ───────────────────────────

describe('insertTranscriptSection', () => {
  it('should insert after existing transcript section', () => {
    const result = insertTranscriptSection(
      SINGLE_TRANSCRIPT,
      'ko',
      '[0:00] 안녕하세요\n[0:05] 오늘은 아키텍처를 이야기합니다',
      'en'
    );
    expect(result).not.toBeNull();
    expect(result).toContain('## Transcript (Korean)');
    expect(result).toContain('안녕하세요');
    // Original transcript should still be there
    expect(result).toContain('## Transcript\n');
    expect(result).toContain('Hello and welcome');
    // Korean section should come before AI Comments
    const koIdx = result!.indexOf('## Transcript (Korean)');
    const aiIdx = result!.indexOf('## AI Comments');
    expect(koIdx).toBeLessThan(aiIdx);
  });

  it('should return null for duplicate language', () => {
    const result = insertTranscriptSection(
      MULTI_LANG_TRANSCRIPT,
      'ko',
      '[0:00] test',
      'en'
    );
    expect(result).toBeNull();
  });

  it('should insert after last transcript when multiple exist', () => {
    const result = insertTranscriptSection(
      MULTI_LANG_TRANSCRIPT,
      'ja',
      '[0:00] こんにちは',
      'en'
    );
    expect(result).not.toBeNull();
    expect(result).toContain('## Transcript (Japanese)');
    // Japanese should come after Korean
    const koIdx = result!.indexOf('## Transcript (Korean)');
    const jaIdx = result!.indexOf('## Transcript (Japanese)');
    expect(jaIdx).toBeGreaterThan(koIdx);
  });
});

// ─── removeTranscriptSection ───────────────────────────

describe('removeTranscriptSection', () => {
  it('should remove a translated transcript section', () => {
    const result = removeTranscriptSection(MULTI_LANG_TRANSCRIPT, 'ko', 'en');
    expect(result).not.toBeNull();
    expect(result).not.toContain('## Transcript (Korean)');
    expect(result).not.toContain('안녕하세요');
    // Original should remain
    expect(result).toContain('## Transcript\n');
    expect(result).toContain('Hello and welcome');
  });

  it('should not remove the original transcript', () => {
    const result = removeTranscriptSection(MULTI_LANG_TRANSCRIPT, 'en', 'en');
    expect(result).toBeNull(); // Original has languageName === ''
  });

  it('should return null for non-existent language', () => {
    const result = removeTranscriptSection(SINGLE_TRANSCRIPT, 'ja', 'en');
    expect(result).toBeNull();
  });
});

// ─── extractTranscriptLanguages ────────────────────────

describe('extractTranscriptLanguages', () => {
  it('should extract single language', () => {
    expect(extractTranscriptLanguages(SINGLE_TRANSCRIPT, 'en')).toEqual(['en']);
  });

  it('should extract multiple languages in order', () => {
    expect(extractTranscriptLanguages(MULTI_LANG_TRANSCRIPT, 'en')).toEqual(['en', 'ko']);
  });

  it('should extract three languages', () => {
    expect(extractTranscriptLanguages(THREE_LANG_TRANSCRIPT, 'en')).toEqual(['en', 'ko', 'ja']);
  });
});

// ─── Caption marker sections (T11) ──────────────────────

const KOREAN_CAPTION_LINES = '[00:00](https://www.youtube.com/watch?v=abc&t=0s) 안녕하세요\n\n[00:04](https://www.youtube.com/watch?v=abc&t=4s) 반갑습니다';

const YOUTUBE_NOTE = `---
platform: youtube
---

Description text

---

## Transcript

[00:00](https://www.youtube.com/watch?v=abc&t=0s) Hello and welcome

[00:04](https://www.youtube.com/watch?v=abc&t=4s) Nice to meet you

---

**Platform:** youtube
`;

describe('caption marker sections', () => {
  it('round-trips insert → parse → remove back to the original note', () => {
    const inserted = insertCaptionSection(YOUTUBE_NOTE, { language: 'ko', kind: 'asr', lines: KOREAN_CAPTION_LINES });

    expect(inserted).toContain('<!-- social-archiver-caption:start language=ko kind=asr -->\n## Transcript (Korean)\n\n[00:00]');
    expect(inserted).toContain('<!-- social-archiver-caption:end language=ko -->');
    expect(inserted.indexOf('caption:end')).toBeLessThan(inserted.indexOf('**Platform:**'));
    expect(listCaptionSections(inserted)).toEqual([{ language: 'ko', kind: 'asr' }]);

    const sections = parseTranscriptSections(inserted, 'en');
    expect(sections.map((s) => [s.source, s.languageCode])).toEqual([['original', 'en'], ['caption', 'ko']]);
    expect(sections[1]!.captionKind).toBe('asr');
    expect(sections[1]!.body).not.toContain('caption:end');
    expect(sections[0]!.body).not.toContain('caption:start');

    expect(removeCaptionSection(inserted, 'ko')).toBe(YOUTUBE_NOTE);
  });

  it('replaces a same-language block in place instead of duplicating it', () => {
    const first = insertCaptionSection(YOUTUBE_NOTE, { language: 'ko', kind: 'asr', lines: '[00:00] old' });
    const second = insertCaptionSection(first, { language: 'ko', kind: 'manual', lines: '[00:00] new' });

    expect(listCaptionSections(second)).toEqual([{ language: 'ko', kind: 'manual' }]);
    expect(second).toContain('[00:00] new');
    expect(second).not.toContain('[00:00] old');
  });

  it('treats region codes case-insensitively (pt-BR marker equals pt-br)', () => {
    const md = YOUTUBE_NOTE.replace(
      '\n---\n\n**Platform:**',
      '\n<!-- social-archiver-caption:start language=pt-BR kind=manual -->\n## Transcript (Brazilian Portuguese)\n\n[00:00] Olá\n<!-- social-archiver-caption:end language=pt-BR -->\n\n---\n\n**Platform:**'
    );

    expect(listCaptionSections(md)).toEqual([{ language: 'pt-br', kind: 'manual' }]);
    expect(parseTranscriptSections(md).find((s) => s.source === 'caption')?.languageCode).toBe('pt-br');
    expect(removeCaptionSection(md, 'pt-br')).not.toContain('Olá');
  });

  it('removal leaves an AI translation of the same language intact', () => {
    const withAi = insertTranscriptSection(YOUTUBE_NOTE, 'ko', '[00:00] AI 번역', 'en')!;
    expect(removeCaptionSection(withAi, 'ko')).toBeNull();

    const withBoth = insertCaptionSection(withAi, { language: 'ja', kind: 'manual', lines: '[00:00] こんにちは' });
    const removed = removeCaptionSection(withBoth, 'ja')!;
    expect(removed).toContain('## Transcript (Korean)');
    expect(removed).toContain('AI 번역');
    expect(removed).not.toContain('こんにちは');
  });

  it('flags AI and original sections as conflicts but not captions', () => {
    const withAi = insertTranscriptSection(YOUTUBE_NOTE, 'ko', '[00:00] AI 번역', 'en')!;
    const withCaption = insertCaptionSection(withAi, { language: 'ja', kind: 'manual', lines: '[00:00] こんにちは' });

    expect(findUnmarkedSection(withCaption, 'ko', 'en')?.source).toBe('ai');
    expect(findUnmarkedSection(withCaption, 'en', 'en')?.source).toBe('original');
    expect(findUnmarkedSection(withCaption, 'ja', 'en')).toBeUndefined();
  });

  it('parses a Whisper-marked section and an original in the same language as two sections', () => {
    const md = `${YOUTUBE_NOTE.trimEnd()}

---

<!-- social-archiver-transcript:start resultMarkerId=tr_1 -->
## Transcript

[00:00] Whisper says hello
<!-- social-archiver-transcript:end resultMarkerId=tr_1 -->
`;
    const sections = parseTranscriptSections(md, { original: 'en', whisper: 'en' });

    expect(sections.map((s) => [s.source, s.languageCode])).toEqual([['original', 'en'], ['whisper', 'en']]);
    expect(sections[1]!.body).toBe('[00:00] Whisper says hello');
    expect(sections[0]!.end).toBeLessThanOrEqual(sections[1]!.start);
    expect(extractTranscriptLanguages(md, { original: 'en', whisper: 'en' })).toEqual(['en']);
  });
});

describe('caption blocks with a lost end marker', () => {
  // ko lost its end marker; an AI translation and a complete ja block follow.
  const BROKEN = YOUTUBE_NOTE.replace(
    '\n---\n\n**Platform:**',
    [
      '',
      '<!-- social-archiver-caption:start language=ko kind=asr -->',
      '## Transcript (Korean)',
      '',
      '[00:00] 안녕하세요',
      '',
      '## Transcript (German)',
      '',
      '[00:00] AI Übersetzung',
      '',
      '<!-- social-archiver-caption:start language=ja kind=manual -->',
      '## Transcript (Japanese)',
      '',
      '[00:00] こんにちは',
      '<!-- social-archiver-caption:end language=ja -->',
      '',
      '---',
      '',
      '**Platform:**',
    ].join('\n')
  );

  it('removal of the unterminated block leaves the note unchanged', () => {
    expect(removeCaptionSection(BROKEN, 'ko')).toBeNull();
    expect(listCaptionSections(BROKEN)).toEqual([{ language: 'ja', kind: 'manual' }]);
  });

  it('an end marker of another language never closes a block', () => {
    const removed = removeCaptionSection(BROKEN, 'ja')!;
    expect(removed).toContain('AI Übersetzung');
    expect(removed).toContain('안녕하세요');
    expect(removed).not.toContain('こんにちは');

    const sections = parseTranscriptSections(BROKEN, 'en');
    expect(sections.map((s) => [s.source, s.languageCode])).toEqual([
      ['original', 'en'], ['caption', 'ko'], ['ai', 'de'], ['caption', 'ja'],
    ]);
    expect(sections[1]!.body).not.toContain('AI Übersetzung');
  });
});

describe('resolveNoteTranscriptLanguages (T10)', () => {
  const KOREAN_NOTE = YOUTUBE_NOTE
    .replace('Hello and welcome', '안녕하세요 여러분 반갑습니다')
    .replace('Nice to meet you', '오늘은 자막 이야기를 합니다');
  const WHISPER_BLOCK = `

<!-- social-archiver-transcript:start resultMarkerId=tr_1 -->
## Transcript

[00:00] 위스퍼
<!-- social-archiver-transcript:end resultMarkerId=tr_1 -->
`;

  it('prefers frontmatter transcriptLanguage', () => {
    expect(resolveNoteTranscriptLanguages({ transcriptLanguage: 'ja', transcriptionLanguage: 'ko' }, KOREAN_NOTE))
      .toEqual({ original: 'ja', whisper: 'ko' });
  });

  it('falls back to transcriptionLanguage when no Whisper-marked section exists', () => {
    expect(resolveNoteTranscriptLanguages({ transcriptionLanguage: 'de' }, YOUTUBE_NOTE))
      .toEqual({ original: 'de', whisper: 'de' });
  });

  it('detects the script of the original segments', () => {
    expect(resolveNoteTranscriptLanguages({}, KOREAN_NOTE)).toEqual({ original: 'ko', whisper: 'ko' });
  });

  it('defaults to en, and keeps transcriptionLanguage for a marked Whisper section only', () => {
    expect(resolveNoteTranscriptLanguages(null, YOUTUBE_NOTE)).toEqual({ original: 'en', whisper: 'en' });
    expect(resolveNoteTranscriptLanguages({ transcriptionLanguage: 'ko' }, YOUTUBE_NOTE + WHISPER_BLOCK))
      .toEqual({ original: 'en', whisper: 'ko' });
  });
});
