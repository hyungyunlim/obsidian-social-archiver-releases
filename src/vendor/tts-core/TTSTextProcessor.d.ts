/**
 * TTSTextProcessor
 *
 * Extracts and cleans text from post objects for Text-to-Speech playback.
 * Ported from mobile-app/src/services/tts/TTSTextProcessor.ts with one change:
 *   - `emoji-regex` npm package replaced with inline `/\p{Extended_Pictographic}/gu`
 *
 * Responsibilities (SRP):
 *  - Extract speakable text via fallback chain (fullContent -> previewText -> title)
 *  - Clean raw text: strip URLs, emojis, markdown syntax, hashtags, mentions
 *  - Build offset map from cleaned text indices back to original text
 *  - Count words with Korean-aware estimation
 *  - Determine if text meets minimum length threshold for TTS
 */
/**
 * Minimum word count required for text to be considered speakable.
 * Texts below this threshold are skipped in queue logic.
 */
export declare const MIN_SPEAKABLE_WORDS = 10;
export interface TextExtractionResult {
    /** Original text extracted from the post (before any cleaning). */
    rawText: string;
    /** Text after all cleaning steps (ready for TTS engine input). */
    cleanedText: string;
    /** Word count of the cleaned text. */
    wordCount: number;
    /** True when wordCount >= MIN_SPEAKABLE_WORDS. */
    isSpeakable: boolean;
    /**
     * Maps each cleanedText character index to its corresponding rawText index.
     * Length is `cleanedText.length + 1` (last entry is a sentinel for exclusive
     * endOffset conversion). `null` when alignment fails — callers should fall
     * back to the existing best-effort highlight behaviour.
     */
    offsetMap: number[] | null;
}
/** Minimal post shape required for text extraction. */
interface PostLike {
    fullContent?: string | null;
    previewText?: string | null;
    title?: string | null;
}
/**
 * Extract speakable text from raw Markdown content.
 *
 * Wraps cleanTextForTTS + buildOffsetMap + countWords without the
 * PostLike fallback chain. Used by EditorTTSController for arbitrary
 * Markdown documents (not necessarily social media posts).
 *
 * @param rawContent - Raw Markdown body (YAML frontmatter already stripped).
 */
export declare function extractTextFromMarkdown(rawContent: string): TextExtractionResult;
/**
 * Extract speakable text from a PostData-compatible object.
 *
 * Fallback chain (first non-empty string wins):
 *   1. `fullContent`
 *   2. `previewText`
 *   3. `title`
 *   4. `""` (empty string — results in isSpeakable: false)
 */
export declare function extractText(post: PostLike): TextExtractionResult;
/**
 * Build an offset map from cleanedText character indices to rawText indices.
 *
 * Algorithm:
 *  1. Walk `cleanedText` left-to-right with a forward-only pointer in `rawText`.
 *  2. For non-space chars, scan rawText until the same char is found.
 *  3. For spaces, map to the next raw whitespace run (then collapse the run).
 *  4. Append a sentinel at index `cleanedText.length`.
 *  5. Validate monotonic non-decreasing order and per-character correctness.
 *     Return `null` on any failure so callers fall back gracefully.
 *
 * @returns Array of length `cleanedText.length + 1`, or `null` on failure.
 */
export declare function buildOffsetMap(rawText: string, cleanedText: string): number[] | null;
/**
 * Clean raw text for TTS consumption.
 *
 * 16-step cleaning pipeline (order matters):
 *  1.  Remove fenced code blocks
 *  2.  Remove inline code spans
 *  3.  Remove markdown images
 *  4.  Strip markdown links (keep text)
 *  5.  Remove URLs
 *  6.  Remove emojis
 *  7.  Remove ATX headers
 *  8.  Remove bold markers
 *  9.  Normalize mentions (@user -> user)
 * 10.  Remove italic markers
 * 11.  Remove blockquote markers
 * 12.  Remove list markers
 * 13.  Remove horizontal rules
 * 14.  Remove repeated placeholder blanks (＿＿＿, ___, ----)
 * 15.  Normalize hashtags (#tag -> tag)
 * 16.  Normalize newlines to spaces
 * 17.  Collapse whitespace and trim
 */
export declare function cleanTextForTTS(text: string): string;
/**
 * Count words with Korean-aware estimation.
 * Korean characters are estimated at 2 chars per word.
 */
export declare function countWords(text: string): number;
/**
 * Check whether text meets the minimum word count for TTS playback.
 */
export declare function isSpeakable(text: string, minWords?: number): boolean;
export {};
//# sourceMappingURL=TTSTextProcessor.d.ts.map