/**
 * TTSSentenceParser
 *
 * Parses cleaned text into sentence-level chunks for TTS playback.
 * Supports English and Korean sentence boundaries with character offset tracking
 * for text highlighting.
 *
 * Ported from mobile-app/src/services/tts/TTSSentenceParser.ts (100% identical logic).
 *
 * Design principles:
 * - Single responsibility: parsing only (no TTS engine interaction)
 * - Immutable output: Sentence objects are plain data records
 * - No external dependencies: pure TypeScript logic
 */
/**
 * A single parsed sentence with positional metadata.
 */
export interface Sentence {
    /** The sentence text, trimmed of leading/trailing whitespace. */
    text: string;
    /** Character offset in the original text where this sentence begins (inclusive). */
    startOffset: number;
    /** Character offset in the original text where this sentence ends (exclusive). */
    endOffset: number;
    /** Zero-based index of this sentence in the result array. */
    index: number;
}
/**
 * Parse text into sentences with character offsets.
 *
 * Rules applied:
 * 1. Split on sentence-ending punctuation: `.` `!` `?`
 * 2. Split on CJK ideographic full stop `。`
 * 3. Split on double newlines (paragraph breaks)
 * 4. Do NOT split on single newlines (treated as soft break -> space)
 * 5. Do NOT split on abbreviations (Mr. Dr. etc.)
 * 6. Do NOT split on decimal numbers (3.14, 1.5x)
 * 7. Segments shorter than 3 chars are merged with the adjacent sentence
 * 8. Sentences exceeding 500 chars are split at clause boundaries or hard-split
 */
export declare function parseSentences(text: string): Sentence[];
/**
 * Find the sentence that contains `charOffset` in the original text.
 */
export declare function getSentenceAtOffset(sentences: Sentence[], charOffset: number): Sentence | null;
/**
 * Retrieve a sentence by its zero-based index.
 */
export declare function getSentenceByIndex(sentences: Sentence[], index: number): Sentence | null;
//# sourceMappingURL=TTSSentenceParser.d.ts.map