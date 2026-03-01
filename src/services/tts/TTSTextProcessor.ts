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

// ============================================================================
// Constants
// ============================================================================

/**
 * Minimum word count required for text to be considered speakable.
 * Texts below this threshold are skipped in queue logic.
 */
export const MIN_SPEAKABLE_WORDS = 10;

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Regex constants — compiled once for performance
// ============================================================================

const URL_REGEX =
  /(?:https?:\/\/|www\.)[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

const FENCED_CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_REGEX = /`[^`]+`/g;
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\([^)]*\)/g;
const MARKDOWN_HEADER_REGEX = /^#{1,6}\s+/gm;
const MARKDOWN_BOLD_REGEX = /(\*\*|__)(.*?)\1/g;
const MARKDOWN_ITALIC_ASTERISK_REGEX = /\*(.*?)\*/g;
const MARKDOWN_ITALIC_UNDERSCORE_REGEX = /(?<!\w)_(.*?)_(?!\w)/g;
const MARKDOWN_BLOCKQUOTE_REGEX = /^>\s*/gm;
const MARKDOWN_LIST_REGEX = /^[-*+]\s+/gm;
const MARKDOWN_HORIZONTAL_RULE_REGEX = /^(?:[-*_]){3,}\s*$/gm;
const HASHTAG_REGEX = /#([\w\u00C0-\u024F\u0400-\u04FF\uAC00-\uD7A3]+)/gu;
const MENTION_REGEX = /@([\w.]+)/g;
const EXCESSIVE_WHITESPACE_REGEX = /\s{2,}/g;

/**
 * Inline emoji pattern — replaces `emoji-regex` npm package.
 * Uses Unicode property escape supported in modern JS engines (ES2018+).
 */
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

// Korean character range: U+AC00-U+D7A3 (Hangul Syllables)
const KOREAN_CHAR_REGEX = /[\uAC00-\uD7A3]/g;
const KOREAN_CHARS_PER_WORD = 2;

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract speakable text from raw Markdown content.
 *
 * Wraps cleanTextForTTS + buildOffsetMap + countWords without the
 * PostLike fallback chain. Used by EditorTTSController for arbitrary
 * Markdown documents (not necessarily social media posts).
 *
 * @param rawContent - Raw Markdown body (YAML frontmatter already stripped).
 */
export function extractTextFromMarkdown(rawContent: string): TextExtractionResult {
  const rawText = rawContent.trim();
  const cleanedText = cleanTextForTTS(rawText);
  const wc = countWords(cleanedText);
  const offsetMap = buildOffsetMap(rawText, cleanedText);

  return {
    rawText,
    cleanedText,
    wordCount: wc,
    isSpeakable: wc >= MIN_SPEAKABLE_WORDS,
    offsetMap,
  };
}

/**
 * Extract speakable text from a PostData-compatible object.
 *
 * Fallback chain (first non-empty string wins):
 *   1. `fullContent`
 *   2. `previewText`
 *   3. `title`
 *   4. `""` (empty string — results in isSpeakable: false)
 */
export function extractText(post: PostLike): TextExtractionResult {
  const rawText =
    (post.fullContent ?? '').trim() ||
    (post.previewText ?? '').trim() ||
    (post.title ?? '').trim();

  const cleanedText = cleanTextForTTS(rawText);
  const wc = countWords(cleanedText);
  const offsetMap = buildOffsetMap(rawText, cleanedText);

  return {
    rawText,
    cleanedText,
    wordCount: wc,
    isSpeakable: wc >= MIN_SPEAKABLE_WORDS,
    offsetMap,
  };
}

/**
 * Build an offset map from cleanedText character indices to rawText indices.
 *
 * Algorithm:
 *  1. Tokenise cleanedText into words and single-space separators.
 *  2. For each word token, try `rawText.indexOf(word, fi)` (fast path).
 *     Falls back to per-character alignment when indexOf fails.
 *  3. For each space token, advance past non-whitespace in rawText.
 *  4. Append a sentinel at index `cleanedText.length`.
 *  5. Validate monotonic non-decreasing order and per-character correctness.
 *     Return `null` on any failure so callers fall back gracefully.
 *
 * @returns Array of length `cleanedText.length + 1`, or `null` on failure.
 */
export function buildOffsetMap(
  rawText: string,
  cleanedText: string,
): number[] | null {
  if (!cleanedText || !rawText) return null;

  const map: number[] = new Array(cleanedText.length + 1);
  let fi = 0;

  // Tokenise cleanedText into words and single spaces
  const tokens: Array<{ text: string; startCi: number; isSpace: boolean }> = [];
  let ci = 0;
  while (ci < cleanedText.length) {
    if (cleanedText[ci] === ' ') {
      tokens.push({ text: ' ', startCi: ci, isSpace: true });
      ci++;
    } else {
      const start = ci;
      while (ci < cleanedText.length && cleanedText[ci] !== ' ') ci++;
      tokens.push({ text: cleanedText.slice(start, ci), startCi: start, isSpace: false });
    }
  }

  // Map each token to its position in rawText
  for (const token of tokens) {
    if (token.isSpace) {
      while (fi < rawText.length && !/\s/.test(rawText[fi] ?? '')) fi++;
      if (fi >= rawText.length) {
        console.debug('[buildOffsetMap] No whitespace found for space token');
        return null;
      }
      map[token.startCi] = fi;
      fi++;
      while (fi < rawText.length && /\s/.test(rawText[fi] ?? '')) fi++;
    } else {
      const idx = rawText.indexOf(token.text, fi);
      if (idx !== -1) {
        for (let i = 0; i < token.text.length; i++) {
          map[token.startCi + i] = idx + i;
        }
        fi = idx + token.text.length;
      } else {
        // Slow path: character-by-character alignment
        for (let i = 0; i < token.text.length; i++) {
          const target = token.text[i];
          let found = false;
          while (fi < rawText.length) {
            if (rawText[fi] === target) {
              map[token.startCi + i] = fi;
              fi++;
              found = true;
              break;
            }
            fi++;
          }
          if (!found) {
            console.debug('[buildOffsetMap] Char alignment failed at ci', token.startCi + i);
            return null;
          }
        }
      }
    }
  }

  // Sentinel (exclusive end)
  map[cleanedText.length] = Math.min(fi, rawText.length);

  // Validation: monotonic non-decreasing
  for (let i = 1; i <= cleanedText.length; i++) {
    const curr = map[i] ?? 0;
    const prev = map[i - 1] ?? 0;
    if (curr < prev) {
      console.debug('[buildOffsetMap] Non-monotonic at index', i);
      return null;
    }
  }

  // Validation: per-character correctness
  for (let i = 0; i < cleanedText.length; i++) {
    const cc = cleanedText[i];
    const mapIdx = map[i];
    if (cc === undefined || mapIdx === undefined) {
      console.debug('[buildOffsetMap] Missing map entry at ci', i);
      return null;
    }
    const fc = rawText[mapIdx];
    if (cc === ' ' ? !/\s/.test(fc ?? '') : cc !== fc) {
      console.debug('[buildOffsetMap] Character mismatch at ci', i, ':', cc, '!=', fc);
      return null;
    }
  }

  return map;
}

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
 * 14.  Normalize hashtags (#tag -> tag)
 * 15.  Normalize newlines to spaces
 * 16.  Collapse whitespace and trim
 */
export function cleanTextForTTS(text: string): string {
  if (!text) return '';

  let result = text;

  // 1. Fenced code blocks
  result = result.replace(FENCED_CODE_BLOCK_REGEX, '');

  // 2. Inline code spans
  result = result.replace(INLINE_CODE_REGEX, '');

  // 3. Markdown images (before URL removal)
  result = result.replace(MARKDOWN_IMAGE_REGEX, '');

  // 4. Markdown links — keep display text
  result = result.replace(MARKDOWN_LINK_REGEX, '$1');

  // 5. URLs
  result = result.replace(URL_REGEX, '');

  // 6. Emojis — inline Unicode property pattern (no npm dependency)
  result = result.replace(EMOJI_REGEX, '');

  // 7. ATX headers
  result = result.replace(MARKDOWN_HEADER_REGEX, '');

  // 8. Bold markers
  result = result.replace(MARKDOWN_BOLD_REGEX, '$2');

  // 9. Mentions: @username -> "username" (before italic removal)
  result = result.replace(MENTION_REGEX, '$1');

  // 10. Italic markers
  result = result.replace(MARKDOWN_ITALIC_ASTERISK_REGEX, '$1');
  result = result.replace(MARKDOWN_ITALIC_UNDERSCORE_REGEX, '$1');

  // 11. Blockquote markers
  result = result.replace(MARKDOWN_BLOCKQUOTE_REGEX, '');

  // 12. List markers
  result = result.replace(MARKDOWN_LIST_REGEX, '');

  // 13. Horizontal rules
  result = result.replace(MARKDOWN_HORIZONTAL_RULE_REGEX, '');

  // 14. Hashtags: #CamelCase -> "CamelCase"
  result = result.replace(HASHTAG_REGEX, '$1');

  // 15. Normalise newlines to single space
  result = result.replace(/\r\n|\r|\n/g, ' ');

  // 16. Collapse consecutive whitespace and trim
  result = result.replace(EXCESSIVE_WHITESPACE_REGEX, ' ').trim();

  return result;
}

/**
 * Count words with Korean-aware estimation.
 * Korean characters are estimated at 2 chars per word.
 */
export function countWords(text: string): number {
  if (!text.trim()) return 0;

  const koreanMatches = text.match(KOREAN_CHAR_REGEX);
  const koreanCharCount = koreanMatches ? koreanMatches.length : 0;
  const koreanWordEstimate = Math.ceil(koreanCharCount / KOREAN_CHARS_PER_WORD);

  const nonKoreanText = text.replace(KOREAN_CHAR_REGEX, ' ');
  const nonKoreanWords = nonKoreanText
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  return koreanWordEstimate + nonKoreanWords.length;
}

/**
 * Check whether text meets the minimum word count for TTS playback.
 */
export function isSpeakable(
  text: string,
  minWords: number = MIN_SPEAKABLE_WORDS,
): boolean {
  return countWords(text) >= minWords;
}
