import { describe, it, expect } from 'vitest';
import {
	findSentenceRange,
	normaliseForMatch,
	resolveNodeOffset,
	getBlockAncestor,
} from '@/services/tts/TTSHighlight';

// ============================================================================
// findSentenceRange
// ============================================================================

describe('findSentenceRange', () => {
	it('should return null for empty inputs', () => {
		expect(findSentenceRange('', 'hello')).toBeNull();
		expect(findSentenceRange('hello', '')).toBeNull();
	});

	it('should find exact substring match (fast path)', () => {
		const domText = 'Hello world, this is a test.';
		const result = findSentenceRange(domText, 'this is a test.');
		expect(result).toEqual({ domStart: 13, domEnd: 28 });
	});

	it('should find match at beginning', () => {
		const domText = 'Hello world.';
		const result = findSentenceRange(domText, 'Hello world.');
		expect(result).toEqual({ domStart: 0, domEnd: 12 });
	});

	// --- The core fix: missing whitespace between block elements ---

	it('should match when domText has no space between paragraphs', () => {
		// <p>First para.</p><p>Second para.</p> -> "First para.Second para."
		const domText = 'First para.Second para.';
		const sentenceText = 'Second para.';
		const result = findSentenceRange(domText, sentenceText);
		expect(result).not.toBeNull();
		// Exact match works because "Second para." is a substring
		expect(result!.domStart).toBe(11);
	});

	it('should match sentence spanning paragraphs without spaces', () => {
		// Cleaned text has space between paragraphs, DOM does not
		const domText = 'how to understand reasoning patterns and form them,how arguments are structured,how to generate new combinations of ideas.';
		const sentenceText =
			'how to understand reasoning patterns and form them, how arguments are structured, how to generate new combinations of ideas.';

		const result = findSentenceRange(domText, sentenceText);
		expect(result).not.toBeNull();
		expect(domText.slice(result!.domStart, result!.domEnd)).toBe(domText);
	});

	it('should match title + body text without space (heading boundary)', () => {
		// <h2>AI Hurtles Ahead</h2><p>When I was preparing...</p>
		const domText = 'AI Hurtles AheadWhen I was preparing to write.';
		const sentenceText = 'AI Hurtles Ahead When I was preparing to write.';

		const result = findSentenceRange(domText, sentenceText);
		expect(result).not.toBeNull();
		expect(result!.domStart).toBe(0);
	});

	it('should match with extra whitespace in domText', () => {
		const domText = 'Hello   world,  this   is a test.';
		const sentenceText = 'Hello world, this is a test.';

		const result = findSentenceRange(domText, sentenceText);
		expect(result).not.toBeNull();
	});

	it('should match with zero-width characters in domText', () => {
		const domText = 'Hello\u200Bworld.'; // zero-width space
		const sentenceText = 'Helloworld.';

		const result = findSentenceRange(domText, sentenceText);
		expect(result).not.toBeNull();
	});

	it('should handle smart quotes correctly', () => {
		const domText = 'The second phase is \u201Cinference.\u201D Once the model has been built.';
		const sentenceText = 'The second phase is \u201Cinference.\u201D Once the model has been built.';

		const result = findSentenceRange(domText, sentenceText);
		expect(result).not.toBeNull();
		expect(result!.domStart).toBe(0);
	});

	it('should match comma-separated list items across paragraphs', () => {
		// Real-world case: list items rendered as separate <p> elements
		const domText = [
			'how to understand reasoning patterns and form them,',
			'how arguments are structured,',
			'how to generate new combinations of ideas, and',
			'how to apply learned reasoning patterns to novel situations.',
		].join(''); // no spaces between paragraphs in DOM

		const sentenceText = [
			'how to understand reasoning patterns and form them,',
			'how arguments are structured,',
			'how to generate new combinations of ideas, and',
			'how to apply learned reasoning patterns to novel situations.',
		].join(' '); // spaces between paragraphs in cleaned text

		const result = findSentenceRange(domText, sentenceText);
		expect(result).not.toBeNull();
		expect(result!.domStart).toBe(0);
		expect(result!.domEnd).toBe(domText.length);
	});

	it('should return null when sentence is genuinely not present', () => {
		const domText = 'Hello world.';
		const sentenceText = 'Completely different text.';
		expect(findSentenceRange(domText, sentenceText)).toBeNull();
	});

	it('should handle Korean text', () => {
		const domText = '첫 번째 문장입니다.두 번째 문장입니다.';
		const sentenceText = '첫 번째 문장입니다. 두 번째 문장입니다.';

		const result = findSentenceRange(domText, sentenceText);
		expect(result).not.toBeNull();
	});

	it('should handle multiple sentences with paragraph breaks', () => {
		// Three paragraphs, no spaces between them in DOM
		const domText = 'First sentence.Second sentence.Third sentence.';
		const sentenceText = 'Second sentence.';

		const result = findSentenceRange(domText, sentenceText);
		expect(result).not.toBeNull();
		// Exact match should work here
		expect(result!.domStart).toBe(15);
		expect(result!.domEnd).toBe(31);
	});
});

// ============================================================================
// normaliseForMatch
// ============================================================================

describe('normaliseForMatch', () => {
	it('should strip whitespace', () => {
		const result = normaliseForMatch('hello world');
		expect(result.stripped).toBe('helloworld');
	});

	it('should strip tabs and newlines', () => {
		const result = normaliseForMatch('hello\tworld\nfoo');
		expect(result.stripped).toBe('helloworldfoo');
	});

	it('should strip zero-width characters', () => {
		const result = normaliseForMatch('hello\u200Bworld');
		expect(result.stripped).toBe('helloworld');
	});

	it('should strip soft hyphens', () => {
		const result = normaliseForMatch('auto\u00ADmatic');
		expect(result.stripped).toBe('automatic');
	});

	it('should preserve normal punctuation', () => {
		const result = normaliseForMatch('Hello, world! How are you?');
		expect(result.stripped).toBe('Hello,world!Howareyou?');
	});

	it('should preserve smart quotes', () => {
		const result = normaliseForMatch('\u201CHello\u201D');
		expect(result.stripped).toBe('\u201CHello\u201D');
	});

	it('should build correct posMap', () => {
		const result = normaliseForMatch('a b c');
		// stripped: "abc"
		// posMap: [0, 2, 4, 5] (5 is sentinel for original length)
		expect(result.stripped).toBe('abc');
		expect(result.posMap).toEqual([0, 2, 4, 5]);
	});

	it('should build correct posMap with leading whitespace', () => {
		const result = normaliseForMatch('  hello');
		expect(result.stripped).toBe('hello');
		expect(result.posMap[0]).toBe(2); // 'h' is at index 2 in original
	});

	it('should handle empty string', () => {
		const result = normaliseForMatch('');
		expect(result.stripped).toBe('');
		expect(result.posMap).toEqual([0]);
	});

	it('should handle nbsp', () => {
		const result = normaliseForMatch('hello\u00A0world');
		expect(result.stripped).toBe('helloworld');
	});
});

// ============================================================================
// resolveNodeOffset
// ============================================================================

describe('resolveNodeOffset', () => {
	// Helper to create mock DomNodeRange
	function mockNodeRanges(
		...ranges: Array<[string, number, number]>
	): Array<{ node: Text; start: number; end: number }> {
		return ranges.map(([text, start, end]) => ({
			node: { textContent: text } as unknown as Text,
			start,
			end,
		}));
	}

	it('should resolve index within a single node', () => {
		const ranges = mockNodeRanges(['Hello World', 0, 11]);
		const result = resolveNodeOffset(5, ranges, 'start');
		expect(result).not.toBeNull();
		expect(result!.offset).toBe(5);
	});

	it('should resolve index at start of node', () => {
		const ranges = mockNodeRanges(['Hello', 0, 5], ['World', 6, 11]);
		const result = resolveNodeOffset(6, ranges, 'start');
		expect(result).not.toBeNull();
		expect(result!.node.textContent).toBe('World');
		expect(result!.offset).toBe(0);
	});

	it('should resolve index at end of node', () => {
		const ranges = mockNodeRanges(['Hello', 0, 5], ['World', 6, 11]);
		const result = resolveNodeOffset(5, ranges, 'end');
		expect(result).not.toBeNull();
		expect(result!.node.textContent).toBe('Hello');
		expect(result!.offset).toBe(5);
	});

	it('should snap forward when start index falls in separator gap', () => {
		// Gap between ranges at index 5 (synthetic separator space)
		const ranges = mockNodeRanges(['Hello', 0, 5], ['World', 6, 11]);

		const result = resolveNodeOffset(5, ranges, 'start');
		expect(result).not.toBeNull();
		// domIdx=5 is at the boundary (end of first node), should resolve to first node offset 5
		expect(result!.node.textContent).toBe('Hello');
		expect(result!.offset).toBe(5);
	});

	it('should snap backward when end index falls in separator gap', () => {
		// Gap at position 5 (separator)
		const ranges = mockNodeRanges(['Hello', 0, 5], ['World', 7, 12]);

		// domIdx=6 is in the gap between 5 and 7
		const result = resolveNodeOffset(6, ranges, 'end');
		expect(result).not.toBeNull();
		expect(result!.node.textContent).toBe('Hello');
		expect(result!.offset).toBe(5); // end of "Hello"
	});

	it('should resolve past all nodes to end of last', () => {
		const ranges = mockNodeRanges(['Hello', 0, 5]);
		const result = resolveNodeOffset(10, ranges, 'end');
		expect(result).not.toBeNull();
		expect(result!.offset).toBe(5);
	});

	it('should return null for empty nodeRanges', () => {
		expect(resolveNodeOffset(0, [], 'start')).toBeNull();
	});

	it('should handle three nodes with two gaps', () => {
		// "Hello World Foo" with separators at positions 5 and 11
		const ranges = mockNodeRanges(
			['Hello', 0, 5],
			['World', 6, 11],
			['Foo', 12, 15],
		);

		// Start of third node
		const result = resolveNodeOffset(12, ranges, 'start');
		expect(result).not.toBeNull();
		expect(result!.node.textContent).toBe('Foo');
		expect(result!.offset).toBe(0);
	});
});

// ============================================================================
// getBlockAncestor (pure logic, tested with mock DOM)
// ============================================================================

describe('getBlockAncestor', () => {
	function createMockDOM(): {
		container: HTMLElement;
		p1Text: Text;
		p2Text: Text;
		spanText: Text;
	} {
		const container = document.createElement('div');

		const p1 = document.createElement('p');
		const p1Text = document.createTextNode('Hello');
		p1.appendChild(p1Text);
		container.appendChild(p1);

		const p2 = document.createElement('p');
		const span = document.createElement('span');
		const spanText = document.createTextNode('World');
		span.appendChild(spanText);
		p2.appendChild(span);
		container.appendChild(p2);

		const p2Text = document.createTextNode(' directly in p2');
		p2.appendChild(p2Text);

		return { container, p1Text, p2Text: p2Text, spanText };
	}

	it('should return the nearest block ancestor', () => {
		const { container, p1Text } = createMockDOM();
		const block = getBlockAncestor(p1Text, container);
		expect(block?.tagName).toBe('P');
	});

	it('should skip inline elements', () => {
		const { container, spanText } = createMockDOM();
		const block = getBlockAncestor(spanText, container);
		// span is inline, so it should return the parent <p>
		expect(block?.tagName).toBe('P');
	});

	it('should return different blocks for nodes in different paragraphs', () => {
		const { container, p1Text, p2Text } = createMockDOM();
		const block1 = getBlockAncestor(p1Text, container);
		const block2 = getBlockAncestor(p2Text, container);
		expect(block1).not.toBe(block2);
	});

	it('should return container when no block ancestor found', () => {
		const container = document.createElement('div');
		const text = document.createTextNode('Hello');
		container.appendChild(text);
		const block = getBlockAncestor(text, container);
		expect(block).toBe(container);
	});
});
