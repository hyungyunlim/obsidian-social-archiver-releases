/**
 * AI Comment Markdown Handler
 *
 * Single Responsibility: Parse and persist AI comments in markdown files.
 * Handles the markdown section format with proper markers and formatting.
 */

import type { App, TFile } from 'obsidian';
import type { AICommentMeta, AICommentType, AICli } from '../../types/ai-comment';
import { COMMENT_TYPE_DISPLAY_NAMES } from '../../types/ai-comment';

// ============================================================================
// Constants
// ============================================================================

/** Section title - used as both marker and display */
const AI_COMMENT_SECTION_TITLE = '## AI Comments';

/** Legacy markers for backwards compatibility (parsing only) */
const LEGACY_SECTION_START = '<!-- AI_COMMENT_SECTION_START -->';
const LEGACY_SECTION_END = '<!-- AI_COMMENT_SECTION_END -->';

/** CLI display icons */
const CLI_ICONS: Record<AICli, string> = {
  claude: '🤖',
  gemini: '✨',
  codex: '💡',
};

/** CLI display names */
const CLI_NAMES: Record<AICli, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  codex: 'Codex',
};

// ============================================================================
// Types
// ============================================================================

/**
 * Result of parsing AI comments from markdown
 */
export interface ParsedAIComments {
  /** Array of comment metadata */
  comments: AICommentMeta[];
  /** Map of comment ID to comment text content */
  commentTexts: Map<string, string>;
}

/**
 * Header parsing result
 */
interface ParsedHeader {
  id: string;
  cli: AICli;
  type: AICommentType;
  date: string;
}

// ============================================================================
// Parsing Functions
// ============================================================================

// Note: AI comment header pattern for future use:
// /^### (?:🤖|✨|💡|🦙)\s*\w+\s*·\s*.+\s*·\s*.+$/gm

/**
 * Parse existing AI comments from markdown content
 * Supports both new format (## AI Comments header) and legacy format (HTML markers)
 *
 * @param markdown - The full markdown content
 * @returns Parsed comments and their text content
 */
export function parseAIComments(markdown: string): ParsedAIComments {
  const comments: AICommentMeta[] = [];
  const commentTexts = new Map<string, string>();

  // Try legacy format first (HTML markers)
  let sectionContent: string | null = null;
  const legacyStartIdx = markdown.indexOf(LEGACY_SECTION_START);
  const legacyEndIdx = markdown.indexOf(LEGACY_SECTION_END);

  if (legacyStartIdx !== -1 && legacyEndIdx !== -1 && legacyStartIdx < legacyEndIdx) {
    sectionContent = markdown.substring(
      legacyStartIdx + LEGACY_SECTION_START.length,
      legacyEndIdx
    );
  } else {
    // Try new format (just ## AI Comments header)
    const titleIdx = markdown.indexOf(AI_COMMENT_SECTION_TITLE);
    if (titleIdx !== -1) {
      // Find the end - either next ## header (not part of comment content) or end of file
      // We need to be careful: comment content may contain ## headers
      // So we look for ## headers that are NOT followed by typical comment content patterns
      const afterTitle = markdown.substring(titleIdx + AI_COMMENT_SECTION_TITLE.length);
      // For now, take until end of file - the section is typically at the end
      sectionContent = afterTitle;
    }
  }

  if (!sectionContent) {
    return { comments, commentTexts };
  }

  // Find all AI comment headers (with specific emoji + CLI + · + Type + · + Date pattern)
  const headerMatches: { header: string; fullMatch: string; index: number }[] = [];
  const headerRegex = /^### ((?:🤖|✨|💡|🦙)\s*\w+\s*·\s*.+\s*·\s*.+)$/gm;
  let match;

  while ((match = headerRegex.exec(sectionContent)) !== null) {
    const header = match[1];
    if (header) {
      headerMatches.push({
        header,
        fullMatch: match[0],
        index: match.index,
      });
    }
  }

  // Parse each comment - content is from after header to next AI comment header or end
  for (let i = 0; i < headerMatches.length; i++) {
    const current = headerMatches[i];
    if (!current) continue;

    const contentStartIdx = current.index + current.fullMatch.length;
    const next = headerMatches[i + 1];
    const contentEndIdx = next ? next.index : sectionContent.length;

    // Extract text content
    let textContent = sectionContent
      .substring(contentStartIdx, contentEndIdx)
      .trim();

    // Remove trailing --- divider if present
    if (textContent.endsWith('---')) {
      textContent = textContent.slice(0, -3).trim();
    }

    // Parse header to extract metadata
    const parsedHeader = parseCommentHeader(current.header);
    if (!parsedHeader) continue;

    // Try to find ID comment in the text (flexible pattern)
    const idMatch = textContent.match(/<!-- id: ([^\s]+) -->/);
    const commentId = idMatch?.[1] ?? parsedHeader.id;

    // Remove ID comment from displayed text
    const displayText = textContent.replace(/<!-- id: [^>]+ -->\s*/, '').trim();

    // Create metadata
    const meta: AICommentMeta = {
      id: commentId,
      cli: parsedHeader.cli,
      type: parsedHeader.type,
      generatedAt: parsedHeader.date,
      processingTime: 0, // Not stored in markdown
      contentHash: '', // Not stored in markdown
    };

    comments.push(meta);
    commentTexts.set(commentId, displayText);
  }

  return { comments, commentTexts };
}

/**
 * Parse a comment header string
 *
 * Format: "{icon} {CLI} · {Type} · {date}"
 * Example: "🤖 Claude · Summary · Dec 14, 2024"
 *
 * @param header - The header string (without ###)
 * @returns Parsed header data or null if invalid
 */
function parseCommentHeader(header: string): ParsedHeader | null {
  // Match pattern: {icon} {CLI} · {Type} · {date}
  // Allow various whitespace and separators
  const parts = header.split(/\s*·\s*/);

  if (parts.length < 3) {
    return null;
  }

  // Extract CLI from first part (icon + name)
  const cliPart = parts[0]?.trim();
  if (!cliPart) return null;

  // Remove emoji and get CLI name
  const cliNameMatch = cliPart.match(/(?:🤖|✨|💡|🦙)?\s*(\w+)/);
  const cliName = cliNameMatch?.[1]?.toLowerCase();

  if (!cliName || !isValidCli(cliName)) {
    return null;
  }

  // Extract type from second part
  const typePart = parts[1]?.trim();
  if (!typePart) return null;

  const type = findCommentType(typePart);
  if (!type) {
    return null;
  }

  // Extract date from third part
  const datePart = parts[2]?.trim();
  if (!datePart) return null;

  // Convert display date to ISO format (approximate)
  const isoDate = parseDisplayDate(datePart);

  // Generate ID from parsed data
  const timestamp = new Date(isoDate).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const id = `${cliName}-${type}-${timestamp}`;

  return {
    id,
    cli: cliName,
    type,
    date: isoDate,
  };
}

/**
 * Check if a string is a valid CLI name
 * Note: 🦙 (Ollama) kept in regex patterns for backwards compatibility with existing comments
 */
function isValidCli(value: string): value is AICli {
  return ['claude', 'gemini', 'codex'].includes(value);
}

/**
 * Find comment type from display name
 */
function findCommentType(displayName: string): AICommentType | null {
  const normalizedInput = displayName.toLowerCase().trim();

  for (const [type, name] of Object.entries(COMMENT_TYPE_DISPLAY_NAMES)) {
    if (name.toLowerCase() === normalizedInput) {
      return type as AICommentType;
    }
  }

  // Direct match for type names
  const types: AICommentType[] = [
    'summary', 'factcheck', 'critique', 'keypoints',
    'sentiment', 'connections', 'translation', 'translate-transcript',
    'glossary', 'reformat', 'custom'
  ];

  if (types.includes(normalizedInput as AICommentType)) {
    return normalizedInput as AICommentType;
  }

  return null;
}

/**
 * Parse display date to ISO format
 *
 * Handles formats like:
 * - "Dec 14, 2024"
 * - "December 14, 2024"
 * - "2024-12-14"
 */
function parseDisplayDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch {
    // Fall through to return current date
  }

  return new Date().toISOString();
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format comment header for markdown
 *
 * @param meta - Comment metadata
 * @returns Formatted header string (without ### prefix)
 */
export function formatCommentHeader(meta: AICommentMeta): string {
  const icon = CLI_ICONS[meta.cli] || '🤖';
  const cliName = CLI_NAMES[meta.cli] || meta.cli;
  const typeLabel = COMMENT_TYPE_DISPLAY_NAMES[meta.type] || meta.type;
  const date = formatDisplayDate(meta.generatedAt);

  return `${icon} ${cliName} · ${typeLabel} · ${date}`;
}

/**
 * Format ISO date to display format
 *
 * @param isoDate - ISO date string
 * @returns Formatted date like "Dec 14, 2024"
 */
function formatDisplayDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

/**
 * Format a single comment for markdown
 * Includes hidden ID comment for reliable parsing
 *
 * @param meta - Comment metadata
 * @param commentText - The comment text content
 * @returns Formatted markdown string
 */
function formatComment(meta: AICommentMeta, commentText: string): string {
  const header = formatCommentHeader(meta);

  // Include ID as hidden comment for reliable parsing (header date is only day-level)
  return `### ${header}
<!-- id: ${meta.id} -->

${commentText.trim()}`;
}

// ============================================================================
// Modification Functions
// ============================================================================

/**
 * Append a new AI comment to markdown content
 *
 * @param markdown - The full markdown content
 * @param meta - Comment metadata
 * @param commentText - The comment text content
 * @returns Updated markdown with the new comment
 */
export function appendAIComment(
  markdown: string,
  meta: AICommentMeta,
  commentText: string
): string {
  const formattedComment = formatComment(meta, commentText);

  // Check if legacy section exists (with HTML markers)
  const legacyStartIdx = markdown.indexOf(LEGACY_SECTION_START);
  const legacyEndIdx = markdown.indexOf(LEGACY_SECTION_END);

  if (legacyStartIdx !== -1 && legacyEndIdx !== -1 && legacyStartIdx < legacyEndIdx) {
    // Legacy section exists - convert to new format by removing markers
    // The legacy format had explicit end markers, so we just remove them
    // and append at the end (same as new format behavior)
    const cleanedMarkdown = markdown
      .replace(LEGACY_SECTION_START, '')
      .replace(LEGACY_SECTION_END, '');

    // Just append at the end since AI Comments section is always at the end
    return `${cleanedMarkdown.trimEnd()}\n\n${formattedComment}`;
  }

  // Check if new-style section exists (just ## AI Comments header)
  const titleIdx = markdown.indexOf(AI_COMMENT_SECTION_TITLE);
  if (titleIdx !== -1) {
    // AI Comments section is always at the end of the file by design
    // Just append the new comment at the end
    // Note: We don't try to detect "end of section" by looking for ## headers
    // because AI-generated content often contains ## headers (e.g., "## 요약")
    return `${markdown.trimEnd()}\n\n${formattedComment}`;
  }

  // Section doesn't exist - create it at the end
  const newSection = createAICommentSection([formattedComment]);

  // Add section at the end of the document
  const trimmedMarkdown = markdown.trimEnd();
  return `${trimmedMarkdown}\n\n${newSection}`;
}

/**
 * Remove an AI comment from markdown content
 * Supports both legacy (HTML markers) and new format (just ## AI Comments)
 *
 * @param markdown - The full markdown content
 * @param commentId - ID of the comment to remove
 * @returns Updated markdown without the comment
 */
export function removeAIComment(markdown: string, commentId: string): string {
  // Parse existing comments
  const { comments, commentTexts } = parseAIComments(markdown);

  // Filter out the comment to remove
  const remainingComments = comments.filter(c => c.id !== commentId);

  // Find section boundaries - check legacy format first
  const legacyStartIdx = markdown.indexOf(LEGACY_SECTION_START);
  const legacyEndIdx = markdown.indexOf(LEGACY_SECTION_END);
  const hasLegacySection = legacyStartIdx !== -1 && legacyEndIdx !== -1 && legacyStartIdx < legacyEndIdx;

  // Find new format section
  const titleIdx = markdown.indexOf(AI_COMMENT_SECTION_TITLE);
  const hasTitleSection = titleIdx !== -1;

  if (!hasLegacySection && !hasTitleSection) {
    return markdown; // No section found
  }

  // Determine section boundaries
  let sectionStartIdx: number;
  let sectionEndIdx: number;

  if (hasLegacySection) {
    sectionStartIdx = legacyStartIdx;
    sectionEndIdx = legacyEndIdx + LEGACY_SECTION_END.length;
  } else {
    sectionStartIdx = titleIdx;
    // AI Comments section is typically at the end of the file
    // Take everything until end of file to avoid cutting off content with ## headers inside
    sectionEndIdx = markdown.length;
  }

  // If no comments left, remove the entire section
  if (remainingComments.length === 0) {
    const beforeSection = markdown.substring(0, sectionStartIdx).trimEnd();
    const afterSection = markdown.substring(sectionEndIdx).trimStart();

    if (afterSection) {
      return `${beforeSection}\n\n${afterSection}`;
    }
    return beforeSection;
  }

  // Rebuild section with remaining comments (always use new format)
  const formattedComments = remainingComments.map(comment => {
    const text = commentTexts.get(comment.id) || '';
    return formatComment(comment, text);
  });

  const newSection = createAICommentSection(formattedComments);

  // Replace old section with new
  const beforeSection = markdown.substring(0, sectionStartIdx).trimEnd();
  const afterSection = markdown.substring(sectionEndIdx);

  if (afterSection.trim()) {
    return `${beforeSection}\n\n${newSection}${afterSection}`;
  }
  return `${beforeSection}\n\n${newSection}`;
}

/**
 * Create AI comment section with formatted comments
 * Uses clean format without HTML markers
 *
 * @param formattedComments - Array of already formatted comment strings
 * @returns Complete section string
 */
function createAICommentSection(formattedComments: string[]): string {
  const commentsContent = formattedComments.join('\n\n---\n\n');

  return `${AI_COMMENT_SECTION_TITLE}

${commentsContent}`;
}

// ============================================================================
// Frontmatter Functions
// ============================================================================

/**
 * Update YAML frontmatter with AI comment IDs
 * Uses simple string array format for better Obsidian compatibility
 *
 * @param app - Obsidian App instance
 * @param file - The file to update
 * @param comments - Array of comment metadata to store
 */
export async function updateFrontmatterAIComments(
  app: App,
  file: TFile,
  comments: AICommentMeta[]
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    if (comments.length === 0) {
      // Remove aiComments if empty
      Reflect.deleteProperty(fm, 'aiComments');
    } else {
      // Store just IDs as simple string array (Obsidian-friendly format)
      // ID format: {cli}-{type}-{timestamp} e.g. "claude-summary-20251215T020722Z"
      fm['aiComments'] = comments.map(c => c.id);
    }
  });
}

/**
 * Read AI comment metadata from frontmatter
 * Supports both legacy (object array) and new (string array) formats
 *
 * @param app - Obsidian App instance
 * @param file - The file to read from
 * @returns Array of comment metadata (partial, without processingTime and contentHash)
 */
export function readFrontmatterAIComments(
  app: App,
  file: TFile
): AICommentMeta[] {
  const cache = app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter;

  if (!frontmatter?.aiComments || !Array.isArray(frontmatter.aiComments)) {
    return [];
  }

  return frontmatter.aiComments.map((item: string | Record<string, unknown>) => {
    // Handle legacy object format
    if (typeof item === 'object' && item !== null) {
      return {
        id: String(item.id || ''),
        cli: (item.cli as AICli) || 'claude',
        type: (item.type as AICommentType) || 'summary',
        generatedAt: String(item.generatedAt || new Date().toISOString()),
        processingTime: 0,
        contentHash: '',
      };
    }

    // Handle new string ID format: {cli}-{type}-{timestamp}
    const id = String(item);
    const parts = id.split('-');
    const cli = (parts[0] as AICli) || 'claude';
    const type = (parts[1] as AICommentType) || 'summary';
    // Reconstruct timestamp from remaining parts
    const timestampPart = parts.slice(2).join('-');
    const generatedAt = parseIdTimestamp(timestampPart);

    return {
      id,
      cli,
      type,
      generatedAt,
      processingTime: 0,
      contentHash: '',
    };
  });
}

/**
 * Parse timestamp from ID format (e.g., "20251215T020722Z")
 * @param timestampPart - The timestamp portion of the ID
 * @returns ISO date string
 */
function parseIdTimestamp(timestampPart: string): string {
  try {
    // Format: 20251215T020722Z -> 2025-12-15T02:07:22Z
    if (timestampPart.length >= 15) {
      const year = timestampPart.slice(0, 4);
      const month = timestampPart.slice(4, 6);
      const day = timestampPart.slice(6, 8);
      const hour = timestampPart.slice(9, 11);
      const minute = timestampPart.slice(11, 13);
      const second = timestampPart.slice(13, 15);
      return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
    }
  } catch {
    // Fall through
  }
  return new Date().toISOString();
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if markdown contains AI comment section
 * Supports both legacy (HTML markers) and new format (just ## AI Comments)
 *
 * @param markdown - The markdown content
 * @returns true if section exists
 */
export function hasAICommentSection(markdown: string): boolean {
  // Check for legacy format (HTML markers)
  const hasLegacy = markdown.includes(LEGACY_SECTION_START) && markdown.includes(LEGACY_SECTION_END);
  // Check for new format (just the title)
  const hasNewFormat = markdown.includes(AI_COMMENT_SECTION_TITLE);

  return hasLegacy || hasNewFormat;
}

/**
 * Get the number of AI comments in markdown
 *
 * @param markdown - The markdown content
 * @returns Number of comments
 */
export function countAIComments(markdown: string): number {
  const { comments } = parseAIComments(markdown);
  return comments.length;
}

/**
 * Check if a specific comment exists
 *
 * @param markdown - The markdown content
 * @param commentId - The comment ID to check
 * @returns true if comment exists
 */
export function hasComment(markdown: string, commentId: string): boolean {
  const { comments } = parseAIComments(markdown);
  return comments.some(c => c.id === commentId);
}
