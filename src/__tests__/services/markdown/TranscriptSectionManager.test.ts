import {
  parseTranscriptSections,
  hasTranscriptLanguage,
  insertTranscriptSection,
  removeTranscriptSection,
  extractTranscriptLanguages,
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
