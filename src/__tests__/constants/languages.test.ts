import { describe, expect, it } from 'vitest';
import {
  captionHeaderName,
  detectScriptLanguage,
  knownTranscriptLanguage,
  normalizeTranscriptLanguage,
  transcriptLanguageDisplayName,
} from '../../constants/languages';

describe('normalizeTranscriptLanguage (contract C0)', () => {
  it.each([
    ['pt-BR', 'pt-br'],
    ['es-419', 'es-419'],
    ['zh-Hant', 'zh-hant'],
    ['en_US', 'en-us'],
    [' KO ', 'ko'],
    ['und', 'und'],
    ['English', null],
    ['unknown', null],
    ['', null],
    ['  ', null],
    ['iw', 'iw'],
    ['zh-Hans-CN', 'zh-hans-cn'],
    ['ko-KR,ko;q=0.9', null],
  ])('%j → %j', (input, expected) => {
    expect(normalizeTranscriptLanguage(input)).toBe(expected);
  });

  it('rejects non-strings', () => {
    expect(normalizeTranscriptLanguage(null)).toBeNull();
    expect(normalizeTranscriptLanguage(undefined)).toBeNull();
  });

  it('knownTranscriptLanguage drops und and non-tags', () => {
    expect(knownTranscriptLanguage('pt-BR')).toBe('pt-br');
    expect(knownTranscriptLanguage('und')).toBeUndefined();
    expect(knownTranscriptLanguage('auto')).toBeUndefined();
    expect(knownTranscriptLanguage(42)).toBeUndefined();
  });
});

describe('transcriptLanguageDisplayName', () => {
  it('uses the known table, then Intl, then the upper-case code', () => {
    expect(transcriptLanguageDisplayName('ko')).toBe('Korean');
    expect(transcriptLanguageDisplayName('pt-BR')).toBe('Brazilian Portuguese');
    expect(transcriptLanguageDisplayName('und')).toBe('Unknown language');
    expect(transcriptLanguageDisplayName('qqq')).toBe('QQQ');
  });

  it('caption headers never contain parentheses', () => {
    const header = captionHeaderName('sr-latn');
    expect(header).not.toMatch(/[()]/);
    expect(header).toContain('Serbian');
  });
});

describe('detectScriptLanguage', () => {
  it('maps CJK scripts to base tags and ignores Latin text', () => {
    expect(detectScriptLanguage('안녕하세요 오늘은 아키텍처를 이야기합니다')).toBe('ko');
    expect(detectScriptLanguage('こんにちは、今日はいい天気ですね')).toBe('ja');
    expect(detectScriptLanguage('今天我们讨论软件架构的问题')).toBe('zh');
    expect(detectScriptLanguage('Hello and welcome to the show')).toBeUndefined();
  });
});
