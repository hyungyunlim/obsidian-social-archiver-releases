/**
 * TranscriptSectionManager
 *
 * Single Responsibility: Insert, detect, and remove translated transcript
 * sections in markdown files.  Also keeps frontmatter `transcriptLanguages`
 * in sync.
 *
 * Shared by main.ts (Whisper append) and PostCardRenderer (inline transcription)
 * so that the same duplicate/placement rules apply everywhere.
 */

import {
  TRANSCRIPT_HEADER_REGEX,
  languageCodeToName,
  languageNameToCode,
} from '../../constants/languages';

// ─── Types ──────────────────────────────────────────────

export interface TranscriptSection {
  /** Language ISO code (e.g., 'en', 'ko'). 'default' for the original ## Transcript */
  languageCode: string;
  /** Display name (e.g., 'Korean'). Empty string for original */
  languageName: string;
  /** Start index in the markdown string (first char of `## Transcript...`) */
  start: number;
  /** End index (exclusive — first char of the next section or EOF) */
  end: number;
  /** The raw body text between the header and the next section */
  body: string;
}

// ─── Public API ─────────────────────────────────────────

/**
 * Parse all transcript sections from markdown content.
 * Returns an array of sections in document order.
 */
export function parseTranscriptSections(
  markdown: string,
  defaultLanguageCode?: string
): TranscriptSection[] {
  const sections: TranscriptSection[] = [];

  // Reset regex state
  TRANSCRIPT_HEADER_REGEX.lastIndex = 0;

  const matches: Array<{ index: number; langName: string | undefined; fullMatch: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = TRANSCRIPT_HEADER_REGEX.exec(markdown)) !== null) {
    matches.push({ index: m.index, langName: m[1], fullMatch: m[0] });
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const nextMatch = matches[i + 1];

    const headerEnd = match.index + match.fullMatch.length;

    // Body extends to just before the next transcript header, or until next ## / --- / EOF
    let bodyEnd: number;
    if (nextMatch) {
      bodyEnd = nextMatch.index;
    } else {
      // Find the next section marker after this header
      const afterHeader = markdown.substring(headerEnd);
      const nextSectionMatch = afterHeader.match(/\n(?=## |---\s*$)/m);
      bodyEnd = nextSectionMatch
        ? headerEnd + nextSectionMatch.index!
        : markdown.length;
    }

    const body = markdown.substring(headerEnd, bodyEnd).replace(/^\n+/, '').replace(/\n+$/, '');

    let languageCode: string;
    let languageName: string;

    if (!match.langName) {
      // Original transcript (## Transcript)
      languageCode = defaultLanguageCode || 'en';
      languageName = '';
    } else {
      // Translated transcript (## Transcript (Korean))
      languageName = match.langName;
      languageCode = languageNameToCode(match.langName) || match.langName.toLowerCase();
    }

    sections.push({
      languageCode,
      languageName,
      start: match.index,
      end: bodyEnd,
      body,
    });
  }

  return sections;
}

/**
 * Check if a translated transcript section already exists for the given language.
 */
export function hasTranscriptLanguage(
  markdown: string,
  languageCode: string,
  defaultLanguageCode?: string
): boolean {
  const sections = parseTranscriptSections(markdown, defaultLanguageCode);
  return sections.some((s) => s.languageCode === languageCode);
}

/**
 * Insert a translated transcript section into markdown.
 *
 * Placement rules (PRD §5.4):
 *   1. After the last existing transcript section
 *   2. Before `## 🤖 AI Comments` (if no transcript sections)
 *   3. At the end of the file (fallback)
 *
 * Returns null if the language already exists (skip + notice per PRD §5.3).
 */
export function insertTranscriptSection(
  markdown: string,
  languageCode: string,
  translatedLines: string,
  defaultLanguageCode?: string
): string | null {
  // Check duplicate
  if (hasTranscriptLanguage(markdown, languageCode, defaultLanguageCode)) {
    return null; // Already exists — caller should show notice
  }

  const displayName = languageCodeToName(languageCode);
  const sectionText = `\n\n## Transcript (${displayName})\n\n${translatedLines.trim()}\n`;

  // Find insertion point
  const sections = parseTranscriptSections(markdown, defaultLanguageCode);

  if (sections.length > 0) {
    // Insert after the last transcript section
    const lastSection = sections[sections.length - 1]!;
    const insertPos = lastSection.end;
    return markdown.slice(0, insertPos) + sectionText + markdown.slice(insertPos);
  }

  // No transcript sections — insert before AI Comments or at EOF
  const aiCommentsIndex = markdown.indexOf('## AI Comments');
  if (aiCommentsIndex !== -1) {
    // Insert before AI Comments section (with separator)
    return (
      markdown.slice(0, aiCommentsIndex).trimEnd() +
      '\n' +
      sectionText +
      '\n' +
      markdown.slice(aiCommentsIndex)
    );
  }

  // Fallback: append at end
  return markdown.trimEnd() + sectionText;
}

/**
 * Remove a translated transcript section for the given language.
 * Returns the updated markdown, or null if the section was not found.
 */
export function removeTranscriptSection(
  markdown: string,
  languageCode: string,
  defaultLanguageCode?: string
): string | null {
  const sections = parseTranscriptSections(markdown, defaultLanguageCode);
  const target = sections.find(
    (s) => s.languageCode === languageCode && s.languageName !== '' // Never remove the original
  );

  if (!target) return null;

  // Remove the section including its header and trailing whitespace
  const before = markdown.slice(0, target.start).replace(/\n+$/, '');
  const after = markdown.slice(target.end);
  return before + after;
}

/**
 * Extract the list of language ISO codes present in the markdown.
 * Used to update frontmatter `transcriptLanguages`.
 */
export function extractTranscriptLanguages(
  markdown: string,
  defaultLanguageCode?: string
): string[] {
  const sections = parseTranscriptSections(markdown, defaultLanguageCode);
  // Deduplicate and preserve order
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of sections) {
    if (!seen.has(s.languageCode)) {
      seen.add(s.languageCode);
      result.push(s.languageCode);
    }
  }
  return result;
}
