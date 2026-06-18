/**
 * tts-text — plain-text extraction + chunking for the reader's read-aloud
 * (TTS) feature.
 *
 * Adapted from the mobile app's TTSTextProcessor / TTSSentenceParser with a
 * pragmatic desktop scope:
 * - `extractSpeechText` strips markdown/URLs/emoji from the reader's rendered
 *   article source so the speech engine reads prose only.
 * - `chunkSpeechText` splits text into sentence-grouped chunks of bounded
 *   length because `window.speechSynthesis` stalls (or silently drops audio)
 *   on very long utterances. CJK-aware: 。．？！ terminate sentences without
 *   requiring trailing whitespace.
 * - `buildSpeechChunks` produces the final utterance list: title chunks first
 *   (always their own utterance so the engine pauses after the title), then
 *   body chunks.
 *
 * Pure functions, no DOM access — unit-testable in the node environment.
 */
/** Maximum characters per speech chunk (~1-2 sentences of prose). */
export declare const TTS_CHUNK_MAX_CHARS = 280;
/**
 * Convert reader markdown into clean plain text for speech.
 *
 * Newlines are preserved (collapsed to single `\n` between non-empty lines)
 * so headings and list items act as sentence boundaries during chunking even
 * when they lack terminal punctuation.
 */
export declare function extractSpeechText(markdown: string | null | undefined): string;
/**
 * Chunk plain text into utterance-sized strings.
 *
 * 1. Split on newlines (headings/list items become boundaries).
 * 2. Split each line into sentences (CJK-aware).
 * 3. Hard-split sentences longer than `maxChars`.
 * 4. Greedily re-group consecutive sentences up to `maxChars` per chunk so
 *    the engine is not called once per short sentence (audible gaps).
 */
export declare function chunkSpeechText(text: string | null | undefined, maxChars?: number): string[];
/**
 * Build the full utterance list for an archive: title first, then body.
 * Title chunks are built separately so the title is always its own
 * utterance — the inter-utterance gap doubles as a natural pause.
 */
export declare function buildSpeechChunks(title: string | null | undefined, content: string | null | undefined, maxChars?: number): string[];
//# sourceMappingURL=speech-text.d.ts.map