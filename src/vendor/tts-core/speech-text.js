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
export const TTS_CHUNK_MAX_CHARS = 280;
// ---------------------------------------------------------------------------
// Markdown → plain text
// ---------------------------------------------------------------------------
/** Fenced code blocks (``` ... ```), including the optional language hint. */
const FENCED_CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
/** Inline code spans: `code`. */
const INLINE_CODE_REGEX = /`[^`\n]+`/g;
/** Image syntax ![alt](url) — removed before the generic link pattern. */
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\([^)]*\)/g;
/** Hyperlink syntax [text](url) — replaced with the display text. */
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\([^)]*\)/g;
/** Bare http/https/www URLs (incl. autolink leftovers). */
const URL_REGEX = /(?:https?:\/\/|www\.)[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;
/** Simple HTML tags occasionally embedded in archived markdown. */
const HTML_TAG_REGEX = /<\/?[a-zA-Z][^<>]*>/g;
/** ATX headers (# through ######) — marker stripped, text kept. */
const MARKDOWN_HEADER_REGEX = /^#{1,6}\s+/gm;
/** Bold markers (**text** / __text__). */
const MARKDOWN_BOLD_REGEX = /(\*\*|__)(.*?)\1/g;
/** Italic markers — underscore variant guarded against intra-word `_`. */
const MARKDOWN_ITALIC_ASTERISK_REGEX = /\*(.*?)\*/g;
const MARKDOWN_ITALIC_UNDERSCORE_REGEX = /(?<!\w)_(.*?)_(?!\w)/g;
/** Blockquote markers (possibly nested: "> > quote"). */
const MARKDOWN_BLOCKQUOTE_REGEX = /^(?:>\s*)+/gm;
/** Unordered (-, *, +) and ordered (1. / 1)) list markers. */
const MARKDOWN_LIST_REGEX = /^\s*(?:[-*+]|\d+[.)])\s+/gm;
/** Horizontal rules (---, ***, ___). */
const MARKDOWN_HORIZONTAL_RULE_REGEX = /^(?:[-*_]\s*){3,}$/gm;
/** Table delimiter rows (| --- | :---: |). */
const MARKDOWN_TABLE_DELIMITER_REGEX = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gm;
/** Hashtag token — # stripped, word kept (Latin extended / Cyrillic / Hangul). */
const HASHTAG_REGEX = /#([\wÀ-ɏЀ-ӿ가-힣]+)/gu;
/** Mention token — @ stripped, handle kept. */
const MENTION_REGEX = /@([\w.]+)/g;
/**
 * Emoji and pictographs. `Extended_Pictographic` covers emoji without
 * pulling in the emoji-regex dependency the mobile app uses; ZWJ and
 * variation selectors are removed separately so joined sequences leave no
 * residue.
 */
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const EMOJI_JOINER_REGEX = /\u200D|\uFE0E|\uFE0F/g;
/**
 * Convert reader markdown into clean plain text for speech.
 *
 * Newlines are preserved (collapsed to single `\n` between non-empty lines)
 * so headings and list items act as sentence boundaries during chunking even
 * when they lack terminal punctuation.
 */
export function extractSpeechText(markdown) {
    if (!markdown)
        return '';
    let result = markdown.replace(/\r\n?/g, '\n');
    // Order matters: images/links before URL removal, bold before italic,
    // mentions before underscore-italic (see mobile TTSTextProcessor).
    result = result.replace(FENCED_CODE_BLOCK_REGEX, ' ');
    result = result.replace(INLINE_CODE_REGEX, ' ');
    result = result.replace(MARKDOWN_IMAGE_REGEX, ' ');
    result = result.replace(MARKDOWN_LINK_REGEX, '$1');
    result = result.replace(URL_REGEX, ' ');
    result = result.replace(HTML_TAG_REGEX, ' ');
    result = result.replace(MARKDOWN_HEADER_REGEX, '');
    result = result.replace(MARKDOWN_BOLD_REGEX, '$2');
    result = result.replace(MENTION_REGEX, '$1');
    result = result.replace(MARKDOWN_ITALIC_ASTERISK_REGEX, '$1');
    result = result.replace(MARKDOWN_ITALIC_UNDERSCORE_REGEX, '$1');
    result = result.replace(MARKDOWN_BLOCKQUOTE_REGEX, '');
    result = result.replace(MARKDOWN_TABLE_DELIMITER_REGEX, '');
    result = result.replace(MARKDOWN_HORIZONTAL_RULE_REGEX, '');
    result = result.replace(MARKDOWN_LIST_REGEX, '');
    result = result.replace(HASHTAG_REGEX, '$1');
    result = result.replace(EMOJI_REGEX, '');
    result = result.replace(EMOJI_JOINER_REGEX, '');
    // Table pipes → spaces so cell text reads as separate words.
    result = result.replace(/\|/g, ' ');
    // Collapse horizontal whitespace per line, drop empty lines.
    const lines = result
        .split('\n')
        .map((line) => line.replace(/[ \t\u00A0]+/g, ' ').trim())
        .filter((line) => line.length > 0);
    return lines.join('\n');
}
// ---------------------------------------------------------------------------
// Sentence splitting + chunk grouping
// ---------------------------------------------------------------------------
/**
 * Sentence terminators.
 * - Western `.` `!` `?` require following whitespace/end-of-line so decimals
 *   (3.14) and most intra-word dots survive. (Unlike mobile we skip the
 *   abbreviation table — a split after "Mr." only shifts a chunk boundary,
 *   which is inaudible once sentences are re-grouped into ~280-char chunks.)
 * - CJK `。．？！` and ellipsis `…` terminate anywhere (no spaces in CJK prose).
 */
const SENTENCE_TERMINATOR_REGEX = /[.!?]+(?=[\s"')\]]|$)|[。．？！…]+/g;
/** Clause boundaries used when hard-splitting an over-long sentence. */
const CLAUSE_BOUNDARY_REGEX = /[,;:、，；：—]/g;
/** Split one line/paragraph into sentence fragments (terminators kept). */
function splitSentences(segment) {
    const fragments = [];
    let lastIndex = 0;
    SENTENCE_TERMINATOR_REGEX.lastIndex = 0;
    let match;
    while ((match = SENTENCE_TERMINATOR_REGEX.exec(segment)) !== null) {
        const end = match.index + match[0].length;
        fragments.push(segment.slice(lastIndex, end));
        lastIndex = end;
    }
    if (lastIndex < segment.length) {
        fragments.push(segment.slice(lastIndex));
    }
    return fragments.map((f) => f.trim()).filter((f) => f.length > 0);
}
/**
 * Split a sentence longer than `maxChars` at the last clause boundary inside
 * the window, falling back to the last whitespace, then to a hard cut.
 * The whitespace fallback matters for unpunctuated CJK runs.
 */
function splitLongSentence(sentence, maxChars) {
    if (sentence.length <= maxChars)
        return [sentence];
    const parts = [];
    let remaining = sentence;
    while (remaining.length > maxChars) {
        const window = remaining.slice(0, maxChars);
        let splitAt = -1;
        CLAUSE_BOUNDARY_REGEX.lastIndex = 0;
        let clauseMatch;
        while ((clauseMatch = CLAUSE_BOUNDARY_REGEX.exec(window)) !== null) {
            splitAt = clauseMatch.index + 1;
        }
        if (splitAt <= 0) {
            const lastSpace = window.lastIndexOf(' ');
            splitAt = lastSpace > 0 ? lastSpace : maxChars;
        }
        parts.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }
    if (remaining.length > 0)
        parts.push(remaining);
    return parts.filter((p) => p.length > 0);
}
/**
 * Chunk plain text into utterance-sized strings.
 *
 * 1. Split on newlines (headings/list items become boundaries).
 * 2. Split each line into sentences (CJK-aware).
 * 3. Hard-split sentences longer than `maxChars`.
 * 4. Greedily re-group consecutive sentences up to `maxChars` per chunk so
 *    the engine is not called once per short sentence (audible gaps).
 */
export function chunkSpeechText(text, maxChars = TTS_CHUNK_MAX_CHARS) {
    if (!text)
        return [];
    const budget = Math.max(1, Math.floor(maxChars));
    const sentences = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        for (const sentence of splitSentences(trimmed)) {
            sentences.push(...splitLongSentence(sentence, budget));
        }
    }
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        if (current.length === 0) {
            current = sentence;
        }
        else if (current.length + 1 + sentence.length <= budget) {
            current = `${current} ${sentence}`;
        }
        else {
            chunks.push(current);
            current = sentence;
        }
    }
    if (current.length > 0)
        chunks.push(current);
    return chunks;
}
/**
 * Build the full utterance list for an archive: title first, then body.
 * Title chunks are built separately so the title is always its own
 * utterance — the inter-utterance gap doubles as a natural pause.
 */
export function buildSpeechChunks(title, content, maxChars = TTS_CHUNK_MAX_CHARS) {
    const titleChunks = chunkSpeechText(extractSpeechText(title), maxChars);
    const bodyChunks = chunkSpeechText(extractSpeechText(content), maxChars);
    return [...titleChunks, ...bodyChunks];
}
//# sourceMappingURL=speech-text.js.map