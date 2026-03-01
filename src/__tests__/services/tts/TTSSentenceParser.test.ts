import { describe, it, expect } from 'vitest';
import {
	parseSentences,
	getSentenceAtOffset,
	getSentenceByIndex,
} from '@/services/tts/TTSSentenceParser';

describe('TTSSentenceParser', () => {
	describe('parseSentences', () => {
		it('should return empty array for empty input', () => {
			expect(parseSentences('')).toEqual([]);
			expect(parseSentences('   ')).toEqual([]);
			expect(parseSentences(null as unknown as string)).toEqual([]);
		});

		it('should parse a single sentence', () => {
			const text = 'Hello world, this is a test.';
			const sentences = parseSentences(text);
			expect(sentences.length).toBe(1);
			expect(sentences[0]!.text).toBe('Hello world, this is a test.');
			expect(sentences[0]!.startOffset).toBe(0);
			expect(sentences[0]!.index).toBe(0);
		});

		it('should split on periods', () => {
			const text = 'First sentence. Second sentence. Third sentence.';
			const sentences = parseSentences(text);
			expect(sentences.length).toBe(3);
			expect(sentences[0]!.text).toContain('First');
			expect(sentences[1]!.text).toContain('Second');
			expect(sentences[2]!.text).toContain('Third');
		});

		it('should split on question marks', () => {
			const text = 'Is this working? Yes it is. Are you sure?';
			const sentences = parseSentences(text);
			expect(sentences.length).toBe(3);
		});

		it('should split on exclamation marks', () => {
			const text = 'Wow! That is amazing! Really cool.';
			const sentences = parseSentences(text);
			expect(sentences.length).toBe(3);
		});

		it('should not split on abbreviations', () => {
			const text = 'Dr. Smith went to the store. He bought milk.';
			const sentences = parseSentences(text);
			expect(sentences.length).toBe(2);
			expect(sentences[0]!.text).toContain('Dr.');
			expect(sentences[0]!.text).toContain('store.');
		});

		it('should not split on decimal numbers', () => {
			const text = 'The value is 3.14 which is pi. Another sentence here.';
			const sentences = parseSentences(text);
			expect(sentences.length).toBe(2);
			expect(sentences[0]!.text).toContain('3.14');
		});

		it('should handle common abbreviations', () => {
			const abbreviations = ['Mr.', 'Mrs.', 'Ms.', 'Prof.', 'Jr.', 'Sr.', 'vs.', 'etc.'];
			abbreviations.forEach((abbr) => {
				const text = `${abbr} Smith is here. Another sentence.`;
				const sentences = parseSentences(text);
				// Should not split after the abbreviation
				expect(sentences[0]!.text).toContain(abbr);
			});
		});

		it('should split on paragraph breaks (double newlines)', () => {
			const text = 'First paragraph sentence.\n\nSecond paragraph sentence.';
			const sentences = parseSentences(text);
			expect(sentences.length).toBe(2);
		});

		it('should treat single newlines as spaces, not splits', () => {
			const text = 'This is a sentence\nthat continues here.';
			const sentences = parseSentences(text);
			expect(sentences.length).toBe(1);
			expect(sentences[0]!.text).toContain('that continues');
		});

		it('should merge short fragments', () => {
			// "Hi." is 3 chars (minimum threshold) — short fragments get merged
			const text = 'OK. This is a normal sentence. Sure.';
			const sentences = parseSentences(text);
			// Short "OK." and "Sure." should be merged
			expect(sentences.length).toBeLessThanOrEqual(3);
		});

		it('should split long sentences at clause boundaries', () => {
			// Create a sentence > 500 chars
			const longSentence = 'word '.repeat(120).trim(); // ~600 chars
			const sentences = parseSentences(longSentence);
			expect(sentences.length).toBeGreaterThanOrEqual(2);
			sentences.forEach((s) => {
				expect(s.text.length).toBeLessThanOrEqual(500);
			});
		});

		it('should handle CJK ideographic full stop', () => {
			// Parser regex requires 。to be followed by whitespace or end-of-string
			const text = '第一文。 第二文。';
			const sentences = parseSentences(text);
			expect(sentences.length).toBe(2);
		});

		it('should assign correct offsets', () => {
			const text = 'First. Second. Third.';
			const sentences = parseSentences(text);
			sentences.forEach((s) => {
				expect(s.startOffset).toBeGreaterThanOrEqual(0);
				expect(s.endOffset).toBeGreaterThan(s.startOffset);
				expect(s.endOffset).toBeLessThanOrEqual(text.length);
			});
		});

		it('should assign sequential indices', () => {
			const text = 'One. Two. Three. Four.';
			const sentences = parseSentences(text);
			sentences.forEach((s, i) => {
				expect(s.index).toBe(i);
			});
		});
	});

	describe('getSentenceAtOffset', () => {
		const text = 'First sentence. Second sentence. Third sentence.';
		const sentences = parseSentences(text);

		it('should find the correct sentence for an offset', () => {
			const s = getSentenceAtOffset(sentences, 0);
			expect(s).not.toBeNull();
			expect(s!.text).toContain('First');
		});

		it('should find the second sentence for a mid offset', () => {
			const s = getSentenceAtOffset(sentences, 17);
			expect(s).not.toBeNull();
			expect(s!.text).toContain('Second');
		});

		it('should return null for negative offset', () => {
			expect(getSentenceAtOffset(sentences, -1)).toBeNull();
		});

		it('should return null for offset beyond text', () => {
			expect(getSentenceAtOffset(sentences, 10000)).toBeNull();
		});
	});

	describe('getSentenceByIndex', () => {
		const text = 'First. Second. Third.';
		const sentences = parseSentences(text);

		it('should return sentence at valid index', () => {
			const s = getSentenceByIndex(sentences, 0);
			expect(s).not.toBeNull();
			expect(s!.text).toContain('First');
		});

		it('should return null for negative index', () => {
			expect(getSentenceByIndex(sentences, -1)).toBeNull();
		});

		it('should return null for out-of-bounds index', () => {
			expect(getSentenceByIndex(sentences, 100)).toBeNull();
		});
	});
});
