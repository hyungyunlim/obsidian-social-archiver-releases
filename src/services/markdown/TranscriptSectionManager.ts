/**
 * TranscriptSectionManager
 *
 * Single Responsibility: Insert, detect, and remove transcript sections in
 * markdown files, and resolve which language each section is in.  Also keeps
 * frontmatter `transcriptLanguages` in sync.
 *
 * Section kinds (T11/T12):
 * - original — unlabeled `## Transcript`, written at archive time
 * - caption  — `<!-- social-archiver-caption:start language=ko kind=asr -->` block
 *              (server caption variants; the only kind sync adds or removes)
 * - whisper  — `<!-- social-archiver-transcript:start resultMarkerId=… -->` block
 * - ai       — unmarked `## Transcript (Korean)`, written by AI translation
 *
 * Shared by main.ts (Whisper append), PostCardRenderer (inline transcription),
 * PostDataParser and CaptionVariantSyncService so that the same
 * duplicate/placement rules apply everywhere.
 */

import {
  TRANSCRIPT_HEADER_REGEX,
  captionHeaderName,
  detectScriptLanguage,
  knownTranscriptLanguage,
  languageCodeToName,
  languageNameToCode,
  normalizeTranscriptLanguage,
} from '../../constants/languages';
import type { TranscriptTabSource } from '../../types/post';
import type { TranscriptKind } from '../../types/transcript-languages';

// ─── Types ──────────────────────────────────────────────

export interface TranscriptSection {
  /** Language ISO code (e.g., 'en', 'ko') */
  languageCode: string;
  /** Display name from the header (e.g., 'Korean'). Empty string for unlabeled headers */
  languageName: string;
  /** Where the section came from */
  source: TranscriptTabSource;
  /** Caption track kind (caption sections only) */
  captionKind?: TranscriptKind;
  /** Start index (the start marker for marked sections, else the `## Transcript` header) */
  start: number;
  /** End index (exclusive — after the end marker, or the next section / footer / EOF) */
  end: number;
  /** The raw body text between the header and the section end */
  body: string;
}

/** Languages for the two unlabeled section kinds. */
export interface TranscriptLanguageDefaults {
  original?: string;
  whisper?: string;
}

/** A plain string is the original-section language (legacy signature). */
export type TranscriptLanguageDefaultsInput = string | TranscriptLanguageDefaults | undefined;

export interface CaptionSectionInput {
  language: string;
  kind: TranscriptKind;
  /** Formatted timestamp lines (body only, no heading) */
  lines: string;
}

export interface TranscriptSegmentLine {
  id: number;
  start: number;
  end: number;
  text: string;
}

// ─── Markers ────────────────────────────────────────────

const CAPTION_START_BEFORE_HEADER = /<!--\s*social-archiver-caption:start\s+language=([^\s>]+)(?:\s+kind=([^\s>]+))?\s*-->\s*$/;
const WHISPER_START_BEFORE_HEADER = /<!--\s*social-archiver-transcript:start\s+resultMarkerId=[^>]*-->\s*$/;
const WHISPER_END = /<!--\s*social-archiver-transcript:end\b[^>]*-->/;
/**
 * A whole caption block: the end marker must name the start's language
 * (backreference) and no other block may start in between, so a lost end
 * marker never lets a block swallow the sections that follow it.
 */
const CAPTION_BLOCK =
  /<!--\s*social-archiver-caption:start\s+language=([^\s>]+)(?:\s+kind=([^\s>]+))?\s*-->(?:(?!<!--\s*social-archiver-caption:start)[\s\S])*?<!--\s*social-archiver-caption:end\s+language=\1\s*-->/gi;

function captionEndPattern(language: string): RegExp {
  const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<!--\\s*social-archiver-caption:end\\s+language=${escaped}\\s*-->`, 'i');
}

/** How far before a header to look for its start marker. */
const MARKER_LOOKBEHIND = 300;

function toKind(value: string | undefined): TranscriptKind | undefined {
  return value === 'manual' || value === 'asr' ? value : undefined;
}

function toDefaults(input: TranscriptLanguageDefaultsInput): { original: string; whisper: string } {
  const defaults = typeof input === 'string' ? { original: input } : input ?? {};
  const original = normalizeTranscriptLanguage(defaults.original) ?? 'en';
  return { original, whisper: normalizeTranscriptLanguage(defaults.whisper) ?? original };
}

// ─── Public API ─────────────────────────────────────────

/**
 * Parse all transcript sections from markdown content.
 * Returns an array of sections in document order.
 */
export function parseTranscriptSections(
  markdown: string,
  defaults?: TranscriptLanguageDefaultsInput
): TranscriptSection[] {
  const { original, whisper } = toDefaults(defaults);

  // Reset regex state
  TRANSCRIPT_HEADER_REGEX.lastIndex = 0;

  const headers: Array<{
    start: number;
    headerEnd: number;
    langName: string | undefined;
    source: TranscriptTabSource;
    caption?: { language: string; kind?: TranscriptKind };
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = TRANSCRIPT_HEADER_REGEX.exec(markdown)) !== null) {
    const lookStart = Math.max(0, m.index - MARKER_LOOKBEHIND);
    const before = markdown.slice(lookStart, m.index);
    const captionMarker = CAPTION_START_BEFORE_HEADER.exec(before);
    const whisperMarker = captionMarker ? null : WHISPER_START_BEFORE_HEADER.exec(before);
    const marker = captionMarker ?? whisperMarker;
    headers.push({
      start: marker ? lookStart + marker.index : m.index,
      headerEnd: m.index + m[0].length,
      langName: m[1],
      source: captionMarker ? 'caption' : whisperMarker ? 'whisper' : m[1] ? 'ai' : 'original',
      caption: captionMarker?.[1]
        ? { language: captionMarker[1], kind: toKind(captionMarker[2]) }
        : undefined,
    });
  }

  return headers.map((header, i) => {
    const next = headers[i + 1];

    // Default end: the next section, else the next H2 / metadata footer / EOF.
    let defaultEnd: number;
    if (next) {
      defaultEnd = next.start;
    } else {
      const afterHeader = markdown.substring(header.headerEnd);
      const nextH2Match = afterHeader.match(/\n##\s/m);
      // Footer pattern example:
      // ---
      //
      // **Platform:** youtube
      const metadataFooterMatch = afterHeader.match(
        /\n---\s*\n+\*\*(?:Platform|Original URL|Author|Published):\*\*/m
      );
      const candidateEnds: number[] = [markdown.length];
      if (nextH2Match?.index !== undefined) candidateEnds.push(header.headerEnd + nextH2Match.index);
      if (metadataFooterMatch?.index !== undefined) candidateEnds.push(header.headerEnd + metadataFooterMatch.index);
      defaultEnd = Math.min(...candidateEnds);
    }

    // Marked sections stop at their own end marker.
    let bodyEnd = defaultEnd;
    let end = defaultEnd;
    const endPattern = header.source === 'caption' && header.caption
      ? captionEndPattern(header.caption.language)
      : header.source === 'whisper' ? WHISPER_END : null;
    if (endPattern) {
      const endMatch = endPattern.exec(markdown.slice(header.headerEnd, defaultEnd));
      if (endMatch) {
        bodyEnd = header.headerEnd + endMatch.index;
        end = bodyEnd + endMatch[0].length;
      }
    }

    const body = markdown.substring(header.headerEnd, bodyEnd).replace(/^\n+/, '').replace(/\n+$/, '');

    let languageCode: string;
    if (header.source === 'caption' && header.caption) {
      languageCode = normalizeTranscriptLanguage(header.caption.language) ?? header.caption.language.toLowerCase();
    } else if (header.source === 'whisper') {
      languageCode = whisper;
    } else if (header.source === 'ai' && header.langName) {
      const code = languageNameToCode(header.langName) || header.langName.toLowerCase();
      languageCode = normalizeTranscriptLanguage(code) ?? code;
    } else {
      languageCode = original;
    }

    const section: TranscriptSection = {
      languageCode,
      languageName: header.langName ?? '',
      source: header.source,
      start: header.start,
      end,
      body,
    };
    if (header.caption?.kind) section.captionKind = header.caption.kind;
    return section;
  });
}

/**
 * Parse `[MM:SS] text` / `[MM:SS](url) text` lines of a section body into
 * segments. End times are refined from the next segment's start.
 */
export function parseSectionSegments(body: string): TranscriptSegmentLine[] {
  const cleaned = body
    .split('\n')
    .map((line) => line.replace(/^>\s?/, '')) // Strip callout prefixes
    .join('\n');

  const segments: TranscriptSegmentLine[] = [];
  const lineRegex = /\[(\d+:)?\d{1,2}:\d{2}\](?:\([^)]*\))?\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(cleaned)) !== null) {
    const text = match[2]?.trim();
    if (!text) continue;
    const start = timestampToSeconds(match[0].match(/\[([^\]]+)\]/)?.[1] || '0:00');
    segments.push({ id: segments.length, start, end: start + 8, text });
  }
  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    if (current && next) current.end = next.start;
  }
  return segments;
}

function timestampToSeconds(str: string): number {
  const parts = str.split(':').map(Number);
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/** Script detection reads at most this much of the original section. */
const SCRIPT_SAMPLE_CHARS = 6000;

/**
 * Languages of the note's unlabeled sections (T10):
 * original = `transcriptLanguage` → `transcriptionLanguage` → script of the
 * original section's text → `en`; whisper = `transcriptionLanguage` → original.
 *
 * `transcriptionLanguage` describes Whisper output, so it only labels the
 * original section when no Whisper-marked section exists (legacy local
 * transcriptions wrote Whisper text into the unlabeled section).
 */
export function resolveNoteTranscriptLanguages(
  frontmatter: Record<string, unknown> | null | undefined,
  markdown: string,
  /** Already-parsed sections of `markdown` (any defaults) — saves a parse. */
  parsedSections?: TranscriptSection[]
): { original: string; whisper: string } {
  const transcription = frontmatter?.transcription;
  const transcriptionLanguage =
    knownTranscriptLanguage(frontmatter?.transcriptionLanguage) ??
    (transcription && typeof transcription === 'object'
      ? knownTranscriptLanguage((transcription as Record<string, unknown>).language)
      : undefined);

  const explicit = knownTranscriptLanguage(frontmatter?.transcriptLanguage);
  let original = explicit;
  if (!original) {
    const sections = parsedSections ?? parseTranscriptSections(markdown);
    if (!sections.some((s) => s.source === 'whisper')) original = transcriptionLanguage;
    if (!original) {
      const originalSection = sections.find((s) => s.source === 'original');
      if (originalSection) {
        const text = parseSectionSegments(originalSection.body.slice(0, SCRIPT_SAMPLE_CHARS))
          .map((s) => s.text)
          .join(' ');
        original = detectScriptLanguage(text);
      }
    }
  }
  const resolvedOriginal = original ?? 'en';
  return { original: resolvedOriginal, whisper: transcriptionLanguage ?? resolvedOriginal };
}

/** Re-label already-parsed sections with the note's original / Whisper languages. */
export function withSectionLanguages(
  sections: TranscriptSection[],
  defaults: TranscriptLanguageDefaultsInput
): TranscriptSection[] {
  const { original, whisper } = toDefaults(defaults);
  return sections.map((section) =>
    section.source === 'original' ? { ...section, languageCode: original }
      : section.source === 'whisper' ? { ...section, languageCode: whisper }
        : section);
}

/**
 * Check if a transcript section already exists for the given language.
 */
export function hasTranscriptLanguage(
  markdown: string,
  languageCode: string,
  defaults?: TranscriptLanguageDefaultsInput
): boolean {
  const target = normalizeTranscriptLanguage(languageCode) ?? languageCode;
  return parseTranscriptSections(markdown, defaults).some((s) => s.languageCode === target);
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
  defaults?: TranscriptLanguageDefaultsInput
): string | null {
  if (hasTranscriptLanguage(markdown, languageCode, defaults)) {
    return null; // Already exists — caller should show notice
  }
  const displayName = languageCodeToName(languageCode);
  return insertAtTranscriptPlacement(
    markdown,
    `\n\n## Transcript (${displayName})\n\n${translatedLines.trim()}\n`
  );
}

/**
 * Insert the unlabeled original `## Transcript` — the shape an archive-time
 * transcript has — for a primary that arrived after the note was written.
 * Placement follows `insertTranscriptSection`.
 */
export function insertOriginalTranscriptSection(markdown: string, lines: string): string {
  return insertAtTranscriptPlacement(markdown, `\n\n## Transcript\n\n${lines.trim()}\n`);
}

function insertAtTranscriptPlacement(markdown: string, sectionText: string): string {
  const sections = parseTranscriptSections(markdown);
  const lastSection = sections[sections.length - 1];
  if (lastSection) {
    return markdown.slice(0, lastSection.end) + sectionText + markdown.slice(lastSection.end);
  }

  // No transcript sections — insert before AI Comments or at EOF
  const aiCommentsIndex = markdown.indexOf('## AI Comments');
  if (aiCommentsIndex !== -1) {
    return (
      markdown.slice(0, aiCommentsIndex).trimEnd() +
      '\n' +
      sectionText +
      '\n' +
      markdown.slice(aiCommentsIndex)
    );
  }

  return markdown.trimEnd() + sectionText;
}

/**
 * Remove an AI-translated transcript section for the given language.
 * Never touches original, Whisper or caption sections.
 * Returns the updated markdown, or null if the section was not found.
 */
export function removeTranscriptSection(
  markdown: string,
  languageCode: string,
  defaults?: TranscriptLanguageDefaultsInput
): string | null {
  const target = normalizeTranscriptLanguage(languageCode) ?? languageCode;
  const section = parseTranscriptSections(markdown, defaults).find(
    (s) => s.languageCode === target && s.source === 'ai'
  );
  if (!section) return null;

  const before = markdown.slice(0, section.start).replace(/\n+$/, '');
  return before + markdown.slice(section.end);
}

/**
 * Extract the list of language ISO codes present in the markdown.
 * Used to update frontmatter `transcriptLanguages`.
 */
export function extractTranscriptLanguages(
  markdown: string,
  defaults?: TranscriptLanguageDefaultsInput
): string[] {
  return [...new Set(parseTranscriptSections(markdown, defaults).map((s) => s.languageCode))];
}

// ─── Caption marker sections (T11) ──────────────────────

function findCaptionBlocks(markdown: string): Array<{ language: string; kind: TranscriptKind | null; start: number; end: number }> {
  const blocks: Array<{ language: string; kind: TranscriptKind | null; start: number; end: number }> = [];
  CAPTION_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CAPTION_BLOCK.exec(markdown)) !== null) {
    const raw = m[1] ?? '';
    blocks.push({
      language: normalizeTranscriptLanguage(raw) ?? raw.toLowerCase(),
      kind: toKind(m[2]) ?? null,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return blocks;
}

function renderCaptionBlock(language: string, kind: TranscriptKind, lines: string): string {
  return [
    `<!-- social-archiver-caption:start language=${language} kind=${kind} -->`,
    `## Transcript (${captionHeaderName(language)})`,
    '',
    lines.trim(),
    `<!-- social-archiver-caption:end language=${language} -->`,
  ].join('\n');
}

/** Caption marker blocks in document order. */
export function listCaptionSections(markdown: string): Array<{ language: string; kind: TranscriptKind | null }> {
  return findCaptionBlocks(markdown).map(({ language, kind }) => ({ language, kind }));
}

/**
 * Insert a caption marker block. An existing block of the same language is
 * replaced in place; otherwise placement follows `insertTranscriptSection`.
 */
export function insertCaptionSection(markdown: string, input: CaptionSectionInput): string {
  const language = normalizeTranscriptLanguage(input.language) ?? input.language.toLowerCase();
  const block = renderCaptionBlock(language, input.kind, input.lines);
  const existing = findCaptionBlocks(markdown).find((b) => b.language === language);
  if (existing) {
    return markdown.slice(0, existing.start) + block + markdown.slice(existing.end);
  }
  return insertAtTranscriptPlacement(markdown, `\n\n${block}\n`);
}

/**
 * Remove the caption marker block of a language (never AI/original/Whisper
 * sections). Returns null when no such block exists.
 */
export function removeCaptionSection(markdown: string, language: string): string | null {
  const target = normalizeTranscriptLanguage(language) ?? language.toLowerCase();
  const block = findCaptionBlocks(markdown).find((b) => b.language === target);
  if (!block) return null;

  // Exact inverse of the insertion: up to two leading and one trailing newline.
  let start = block.start;
  for (let i = 0; i < 2 && markdown[start - 1] === '\n'; i++) start--;
  const end = markdown[block.end] === '\n' ? block.end + 1 : block.end;
  return markdown.slice(0, start) + markdown.slice(end);
}

/**
 * An unmarked (AI translation or original) section in `language` — a caption
 * insert for that language would duplicate it.
 */
export function findUnmarkedSection(
  markdown: string,
  language: string,
  defaults?: TranscriptLanguageDefaultsInput
): TranscriptSection | undefined {
  const target = normalizeTranscriptLanguage(language) ?? language.toLowerCase();
  return parseTranscriptSections(markdown, defaults).find(
    (s) => (s.source === 'ai' || s.source === 'original') && s.languageCode === target
  );
}
