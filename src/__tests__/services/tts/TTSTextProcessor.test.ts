import { describe, it, expect } from 'vitest';
import {
	extractText,
	cleanTextForTTS,
	countWords,
	isSpeakable,
	buildOffsetMap,
	MIN_SPEAKABLE_WORDS,
} from '@/services/tts/TTSTextProcessor';

describe('TTSTextProcessor', () => {
	describe('cleanTextForTTS', () => {
		it('should return empty string for empty input', () => {
			expect(cleanTextForTTS('')).toBe('');
			expect(cleanTextForTTS(null as unknown as string)).toBe('');
		});

		it('should remove URLs', () => {
			const text = 'Check out https://example.com and www.test.org for more.';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('https://');
			expect(result).not.toContain('www.');
			expect(result).toContain('Check out');
			expect(result).toContain('for more.');
		});

		it('should remove emojis', () => {
			const text = 'Hello 🌍 World 🎉 Test';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('🌍');
			expect(result).not.toContain('🎉');
			expect(result).toContain('Hello');
			expect(result).toContain('World');
		});

		it('should remove fenced code blocks', () => {
			const text = 'Before\n```javascript\nconst x = 1;\n```\nAfter';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('const x');
			expect(result).toContain('Before');
			expect(result).toContain('After');
		});

		it('should remove inline code', () => {
			const text = 'Use the `console.log` function.';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('console.log');
			expect(result).toContain('Use the');
			expect(result).toContain('function.');
		});

		it('should keep markdown link text but remove URL', () => {
			const text = 'Visit [My Site](https://example.com) today.';
			const result = cleanTextForTTS(text);
			expect(result).toContain('My Site');
			expect(result).not.toContain('https://example.com');
			expect(result).not.toContain('[');
			expect(result).not.toContain(']');
		});

		it('should remove markdown images entirely', () => {
			const text = 'Look at ![alt text](https://img.com/pic.png) this.';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('alt text');
			expect(result).not.toContain('https://img');
		});

		it('should strip ATX headers', () => {
			const text = '## Section Title\nSome content.';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('##');
			expect(result).toContain('Section Title');
		});

		it('should remove bold markers but keep text', () => {
			const text = 'This is **bold text** here.';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('**');
			expect(result).toContain('bold text');
		});

		it('should remove italic markers but keep text', () => {
			const text = 'This is *italic* and _also italic_ here.';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('*');
			expect(result).toContain('italic');
			expect(result).toContain('also italic');
		});

		it('should normalize hashtags to plain text', () => {
			const text = 'Check #CamelCase and #한국어해시.';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('#');
			expect(result).toContain('CamelCase');
			expect(result).toContain('한국어해시');
		});

		it('should normalize mentions to plain text', () => {
			const text = 'Hey @username, check this out.';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('@');
			expect(result).toContain('username');
		});

		it('should remove blockquote markers', () => {
			const text = '> This is quoted.\n> Second line.';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('>');
			expect(result).toContain('This is quoted.');
		});

		it('should remove list markers', () => {
			const text = '- Item one\n* Item two\n+ Item three';
			const result = cleanTextForTTS(text);
			expect(result).not.toMatch(/^[-*+]\s/);
			expect(result).toContain('Item one');
		});

		it('should remove horizontal rules', () => {
			const text = 'Before\n---\nAfter';
			const result = cleanTextForTTS(text);
			expect(result).not.toMatch(/^---$/);
			expect(result).toContain('Before');
			expect(result).toContain('After');
		});

		it('should collapse whitespace and trim', () => {
			const text = '  Hello    World   ';
			const result = cleanTextForTTS(text);
			expect(result).toBe('Hello World');
		});

		it('should normalize newlines to spaces', () => {
			const text = 'Line one\nLine two\r\nLine three';
			const result = cleanTextForTTS(text);
			expect(result).not.toContain('\n');
			expect(result).not.toContain('\r');
			expect(result).toContain('Line one');
			expect(result).toContain('Line two');
		});
	});

	describe('countWords', () => {
		it('should return 0 for empty string', () => {
			expect(countWords('')).toBe(0);
			expect(countWords('   ')).toBe(0);
		});

		it('should count English words', () => {
			expect(countWords('Hello world')).toBe(2);
			expect(countWords('one two three four five')).toBe(5);
		});

		it('should count Korean characters (2 chars per word)', () => {
			// 4 Korean chars = 2 words
			expect(countWords('안녕하세')).toBe(2);
			// 5 Korean chars = 3 words (ceil)
			expect(countWords('안녕하세요')).toBe(3);
		});

		it('should count mixed Korean and English', () => {
			// "Hello" = 1 English word, "안녕" = 1 Korean word (2 chars)
			const result = countWords('Hello 안녕');
			expect(result).toBeGreaterThanOrEqual(2);
		});
	});

	describe('isSpeakable', () => {
		it('should return false for short text', () => {
			expect(isSpeakable('Hello')).toBe(false);
			expect(isSpeakable('one two three')).toBe(false);
		});

		it('should return true for long enough text', () => {
			const words = Array.from({ length: MIN_SPEAKABLE_WORDS }, (_, i) => `word${i}`);
			expect(isSpeakable(words.join(' '))).toBe(true);
		});

		it('should respect custom minimum', () => {
			expect(isSpeakable('Hello world', 2)).toBe(true);
			expect(isSpeakable('Hello', 2)).toBe(false);
		});
	});

	describe('extractText', () => {
		it('should prefer fullContent over previewText and title', () => {
			const post = {
				fullContent: 'Full content here',
				previewText: 'Preview text',
				title: 'Title',
			};
			const result = extractText(post);
			expect(result.rawText).toBe('Full content here');
		});

		it('should fall back to previewText if fullContent is empty', () => {
			const post = {
				fullContent: '',
				previewText: 'Preview text here',
				title: 'Title',
			};
			const result = extractText(post);
			expect(result.rawText).toBe('Preview text here');
		});

		it('should fall back to title if fullContent and previewText are empty', () => {
			const post = {
				fullContent: null,
				previewText: null,
				title: 'Title text here',
			};
			const result = extractText(post);
			expect(result.rawText).toBe('Title text here');
		});

		it('should return empty rawText if all fields are empty', () => {
			const post = { fullContent: '', previewText: '', title: '' };
			const result = extractText(post);
			expect(result.rawText).toBe('');
			expect(result.isSpeakable).toBe(false);
		});

		it('should handle null/undefined fields gracefully', () => {
			const post = {};
			const result = extractText(post);
			expect(result.rawText).toBe('');
			expect(result.cleanedText).toBe('');
			expect(result.wordCount).toBe(0);
			expect(result.isSpeakable).toBe(false);
		});

		it('should clean text and calculate word count', () => {
			const longText = 'This is a longer piece of text with enough words to be considered speakable by the text processor system.';
			const post = { fullContent: longText };
			const result = extractText(post);
			expect(result.cleanedText).toBe(longText);
			expect(result.wordCount).toBeGreaterThan(0);
			expect(result.isSpeakable).toBe(true);
		});

		it('should provide offsetMap for non-empty text', () => {
			const text = 'Hello world this is a test sentence with enough words to be speakable for sure.';
			const post = { fullContent: text };
			const result = extractText(post);
			expect(result.offsetMap).not.toBeNull();
			if (result.offsetMap) {
				expect(result.offsetMap.length).toBe(result.cleanedText.length + 1);
			}
		});
	});

	describe('buildOffsetMap', () => {
		it('should return null for empty inputs', () => {
			expect(buildOffsetMap('', '')).toBeNull();
			expect(buildOffsetMap('hello', '')).toBeNull();
			expect(buildOffsetMap('', 'hello')).toBeNull();
		});

		it('should map identical strings 1:1', () => {
			const text = 'Hello World';
			const map = buildOffsetMap(text, text);
			expect(map).not.toBeNull();
			if (map) {
				expect(map.length).toBe(text.length + 1);
				for (let i = 0; i < text.length; i++) {
					expect(map[i]).toBe(i);
				}
			}
		});

		it('should map cleaned text back to raw text with removed content', () => {
			const raw = 'Hello **world** test';
			const cleaned = 'Hello world test';
			const map = buildOffsetMap(raw, cleaned);
			expect(map).not.toBeNull();
			if (map) {
				// 'H' in cleaned at 0 -> 'H' in raw at 0
				expect(map[0]).toBe(0);
				// 'w' in cleaned at 6 -> 'w' in raw at 8 (after **)
				expect(map[6]).toBe(8);
			}
		});

		it('should handle markdown link text extraction', () => {
			const raw = 'Click [here](https://example.com) now';
			const cleaned = 'Click here now';
			const map = buildOffsetMap(raw, cleaned);
			expect(map).not.toBeNull();
			if (map) {
				// 'h' in cleaned at 6 -> 'h' in raw at 7 (after [)
				expect(map[6]).toBe(7);
			}
		});

		it('should produce monotonic non-decreasing values', () => {
			const raw = 'Hello @user, check #topic and visit https://url.com please.';
			const cleaned = cleanTextForTTS(raw);
			const map = buildOffsetMap(raw, cleaned);
			if (map) {
				for (let i = 1; i < map.length; i++) {
					expect(map[i]!).toBeGreaterThanOrEqual(map[i - 1]!);
				}
			}
		});
	});
});
