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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_SENTENCE_LENGTH = 3;
const MAX_SENTENCE_LENGTH = 500;

const ABBREVIATIONS: readonly string[] = [
  'Mr',
  'Mrs',
  'Ms',
  'Dr',
  'Prof',
  'Jr',
  'Sr',
  'vs',
  'etc',
  'e\\.g',
  'i\\.e',
  'approx',
  'dept',
  'est',
  'govt',
  'inc',
  'corp',
  'ltd',
  'co',
  'U\\.S',
  'U\\.K',
  'E\\.U',
];

const PLACEHOLDER = '\x00';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hideAbbreviations(text: string): string {
  const pattern = new RegExp(
    `\\b(${ABBREVIATIONS.join('|')})\\.(?=\\s|$)`,
    'gi',
  );
  return text.replace(pattern, (_, abbr: string) => `${abbr}${PLACEHOLDER}`);
}

function hideDecimalNumbers(text: string): string {
  return text.replace(/(\d)\.(\d)/g, `$1${PLACEHOLDER}$2`);
}

function hideInitialisms(text: string): string {
  return text.replace(/\b([A-Z])\.(?=[A-Z]\.)/g, `$1${PLACEHOLDER}`);
}

function restorePlaceholders(text: string): string {
  return text.replace(new RegExp(PLACEHOLDER, 'g'), '.');
}

function splitIntoRawFragments(text: string): string[] {
  const terminatorRe = /[.!?。]+(?=\s|$)/g;
  const fragments: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = terminatorRe.exec(text)) !== null) {
    const end = match.index + match[0].length;
    fragments.push(text.slice(lastIndex, end));
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    fragments.push(text.slice(lastIndex));
  }

  return fragments.filter((f) => f.trim().length > 0);
}

function splitParagraph(paragraph: string): string[] {
  let processed = hideAbbreviations(paragraph);
  processed = hideDecimalNumbers(processed);
  processed = hideInitialisms(processed);

  const rawFragments = splitIntoRawFragments(processed);
  return rawFragments.map(restorePlaceholders);
}

function mergeShortFragments(fragments: string[]): string[] {
  if (fragments.length === 0) return [];

  const result: string[] = [];

  for (const fragment of fragments) {
    const trimmed = fragment.trim();
    const last = result[result.length - 1];
    if (trimmed.length < MIN_SENTENCE_LENGTH && result.length > 0) {
      result[result.length - 1] = `${last ?? ''} ${trimmed}`;
    } else if (trimmed.length < MIN_SENTENCE_LENGTH && result.length === 0) {
      result.push(trimmed);
    } else {
      if (result.length > 0 && (last ?? '').trim().length < MIN_SENTENCE_LENGTH) {
        result[result.length - 1] = `${last ?? ''} ${trimmed}`;
      } else {
        result.push(trimmed);
      }
    }
  }

  return result.filter((s) => s.trim().length > 0);
}

function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= MAX_SENTENCE_LENGTH) return [sentence];

  const parts: string[] = [];
  let remaining = sentence;

  while (remaining.length > MAX_SENTENCE_LENGTH) {
    const window = remaining.slice(0, MAX_SENTENCE_LENGTH);
    const clauseRe = /[,;:\u2014]/g;
    let lastClauseIndex = -1;
    let clauseMatch: RegExpExecArray | null;
    while ((clauseMatch = clauseRe.exec(window)) !== null) {
      lastClauseIndex = clauseMatch.index;
    }

    const splitAt = lastClauseIndex > 0 ? lastClauseIndex + 1 : MAX_SENTENCE_LENGTH;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts.filter((p) => p.length > 0);
}

function buildSentencesWithOffsets(
  sentenceTexts: string[],
  originalText: string,
): Sentence[] {
  const sentences: Sentence[] = [];
  let searchStart = 0;

  for (let i = 0; i < sentenceTexts.length; i++) {
    const sentenceText = sentenceTexts[i];
    if (sentenceText === undefined) continue;

    const matchIndex = originalText.indexOf(sentenceText, searchStart);

    if (matchIndex === -1) {
      const start = searchStart;
      const end = Math.min(start + sentenceText.length, originalText.length);
      sentences.push({ text: sentenceText, startOffset: start, endOffset: end, index: i });
      searchStart = end;
    } else {
      const start = matchIndex;
      const end = matchIndex + sentenceText.length;
      sentences.push({ text: sentenceText, startOffset: start, endOffset: end, index: i });
      searchStart = end;
    }
  }

  return sentences;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
export function parseSentences(text: string): Sentence[] {
  if (!text || text.trim().length === 0) return [];

  const normalised = text.replace(/\r\n?/g, '\n');
  const paragraphs = normalised.split(/\n\n+/);
  const paragraphTexts = paragraphs.map((p) => p.replace(/\n/g, ' ').trim());

  const allFragments: string[] = [];
  for (const para of paragraphTexts) {
    if (!para) continue;
    const fragments = splitParagraph(para);
    allFragments.push(...fragments);
  }

  const merged = mergeShortFragments(allFragments);

  const sentenceTexts: string[] = [];
  for (const s of merged) {
    sentenceTexts.push(...splitLongSentence(s));
  }

  return buildSentencesWithOffsets(sentenceTexts, text);
}

/**
 * Find the sentence that contains `charOffset` in the original text.
 */
export function getSentenceAtOffset(
  sentences: Sentence[],
  charOffset: number,
): Sentence | null {
  if (charOffset < 0) return null;
  for (const sentence of sentences) {
    if (charOffset >= sentence.startOffset && charOffset < sentence.endOffset) {
      return sentence;
    }
  }
  return null;
}

/**
 * Retrieve a sentence by its zero-based index.
 */
export function getSentenceByIndex(
  sentences: Sentence[],
  index: number,
): Sentence | null {
  if (index < 0 || index >= sentences.length) return null;
  return sentences[index] ?? null;
}
