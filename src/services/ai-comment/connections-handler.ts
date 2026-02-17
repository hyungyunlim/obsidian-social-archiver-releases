/**
 * Connections Comment Type Handler
 *
 * Integrates VaultContextCollector with the 'connections' comment type
 * to generate wikilink suggestions based on vault content.
 */

import type { App } from 'obsidian';
import type { AICommentSettings } from '../../types/ai-comment';
import { DEFAULT_PROMPTS } from '../../types/ai-comment';
import {
  VaultContextCollector,
  getRelevantVaultContext,
  type VaultContext,
} from '../VaultContextCollector';

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed connection from AI response
 */
export interface ParsedConnection {
  /** Wikilink target (note name without [[]]) */
  link: string;
  /** Description or reason for the connection */
  description: string;
  /** Whether the note exists in the vault */
  exists?: boolean;
}

/**
 * Parsed wikilink output from AI
 */
export interface WikilinkOutput {
  /** Related notes that exist in vault */
  relatedNotes: ParsedConnection[];
  /** Suggested new notes to create */
  suggestedNotes: ParsedConnection[];
  /** Suggested tags */
  tags: string[];
  /** Raw AI response */
  rawResponse: string;
}

/**
 * Connection validation result
 */
export interface ValidationResult {
  /** Map of link -> exists in vault */
  linkStatus: Map<string, boolean>;
  /** Notes that exist */
  existingNotes: string[];
  /** Notes that don't exist */
  missingNotes: string[];
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the connections prompt with vault context
 *
 * @param app - Obsidian App instance
 * @param content - Content to analyze
 * @param settings - AI Comment settings
 * @returns Prompt string with vault context
 */
export async function buildConnectionsPrompt(
  app: App,
  content: string,
  settings: AICommentSettings
): Promise<string> {
  const vaultSettings = settings.vaultContext;

  // Check if vault context is enabled
  if (!vaultSettings.enabled) {
    return DEFAULT_PROMPTS.connections.replace(
      '{{vaultContext}}',
      '\n(Vault context disabled - suggest general connections based on content only)\n'
    );
  }

  // Get vault context based on settings
  let vaultContext: VaultContext;

  if (vaultSettings.smartFiltering) {
    // Use smart filtering to select relevant notes
    vaultContext = await getRelevantVaultContext(app, content, {
      excludePaths: vaultSettings.excludePaths,
      maxTokens: 15000, // Increased for better vault context coverage
      minScore: 0.1,
    });
  } else {
    // Collect all vault context
    const collector = new VaultContextCollector(app);
    vaultContext = await collector.collectContext({
      excludePaths: vaultSettings.excludePaths,
      maxFiles: vaultSettings.maxContextNotes || 50,
    });
  }

  // Format vault context for prompt
  const vaultSummary = formatVaultContextForPrompt(vaultContext);

  // Build final prompt
  const prompt = DEFAULT_PROMPTS.connections.replace(
    '{{vaultContext}}',
    vaultSummary
  );

  return prompt;
}

/**
 * Format vault context for inclusion in prompt
 */
function formatVaultContextForPrompt(context: VaultContext): string {
  if (context.files.length === 0) {
    return '\n(No relevant notes found in vault)\n';
  }

  const lines = context.files.map(file => {
    const parts: string[] = [`- [[${file.name}]]`];

    // Add aliases
    if (file.aliases.length > 0) {
      parts.push(`(aliases: ${file.aliases.join(', ')})`);
    }

    // Add tags
    if (file.tags.length > 0) {
      parts.push(`[${file.tags.join(' ')}]`);
    }

    // Add excerpt if available
    if (file.excerpt) {
      const truncatedExcerpt = file.excerpt.length > 100
        ? file.excerpt.slice(0, 100) + '...'
        : file.excerpt;
      parts.push(`"${truncatedExcerpt}"`);
    }

    return parts.join(' ');
  });

  return `
---
VAULT CONTEXT (${context.totalNotes} notes total, showing ${context.files.length} relevant notes):

${lines.join('\n')}
---
`;
}

// ============================================================================
// Output Parsing
// ============================================================================

/**
 * Parse AI response to extract wikilinks and connections
 *
 * @param aiResponse - Raw AI response text
 * @returns Parsed wikilink output
 */
export function parseWikilinkOutput(aiResponse: string): WikilinkOutput {
  const result: WikilinkOutput = {
    relatedNotes: [],
    suggestedNotes: [],
    tags: [],
    rawResponse: aiResponse,
  };

  // Extract all wikilinks from response
  const wikilinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;

  // Parse sections
  const sections = splitIntoSections(aiResponse);

  // Parse Related Notes section
  if (sections.relatedNotes) {
    const connections = parseConnectionsSection(sections.relatedNotes);
    result.relatedNotes = connections;
  }

  // Parse Suggested Notes section
  if (sections.suggestedNotes) {
    const suggestions = parseConnectionsSection(sections.suggestedNotes);
    result.suggestedNotes = suggestions;
  }

  // Parse Tags section
  if (sections.tags) {
    result.tags = parseTagsSection(sections.tags);
  }

  // If no structured sections found, extract all wikilinks as related notes
  if (result.relatedNotes.length === 0 && result.suggestedNotes.length === 0) {
    while ((match = wikilinkPattern.exec(aiResponse)) !== null) {
      const linkText = match[1];
      if (linkText && !result.relatedNotes.some(n => n.link === linkText)) {
        result.relatedNotes.push({
          link: linkText,
          description: 'Found in AI response',
        });
      }
    }
  }

  return result;
}

/**
 * Split AI response into sections
 */
function splitIntoSections(text: string): {
  relatedNotes?: string;
  suggestedNotes?: string;
  tags?: string;
} {
  const result: { relatedNotes?: string; suggestedNotes?: string; tags?: string } = {};

  // Pattern for section headers
  const relatedPattern = /#+\s*(?:Related|Existing)\s*Notes?\s*\n([\s\S]*?)(?=#+|$)/i;
  const suggestedPattern = /#+\s*(?:Suggested|New|Create)\s*Notes?\s*\n([\s\S]*?)(?=#+|$)/i;
  const tagsPattern = /#+\s*(?:Topics?|Tags?)\s*(?:&\s*Tags?)?\s*\n([\s\S]*?)(?=#+|$)/i;

  const relatedMatch = text.match(relatedPattern);
  if (relatedMatch) {
    result.relatedNotes = relatedMatch[1]?.trim();
  }

  const suggestedMatch = text.match(suggestedPattern);
  if (suggestedMatch) {
    result.suggestedNotes = suggestedMatch[1]?.trim();
  }

  const tagsMatch = text.match(tagsPattern);
  if (tagsMatch) {
    result.tags = tagsMatch[1]?.trim();
  }

  return result;
}

/**
 * Parse a connections section (bullet list with wikilinks)
 */
function parseConnectionsSection(sectionText: string): ParsedConnection[] {
  const connections: ParsedConnection[] = [];
  const lines = sectionText.split('\n');

  for (const line of lines) {
    // Match wikilink on the line
    const wikilinkMatch = line.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
    if (!wikilinkMatch) continue;

    const link = wikilinkMatch[1];
    if (!link) continue;

    // Get description - everything after the wikilink
    let description = line.replace(wikilinkMatch[0], '').trim();
    // Clean up common separators
    description = description.replace(/^[-–—:•*]\s*/, '').trim();

    connections.push({
      link,
      description: description || 'Related note',
    });
  }

  return connections;
}

/**
 * Parse tags section
 */
function parseTagsSection(sectionText: string): string[] {
  const tags: string[] = [];

  // Match #tag patterns
  const tagPattern = /#([\w/-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(sectionText)) !== null) {
    const tag = match[1];
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return tags;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate wikilinks against vault
 *
 * @param app - Obsidian App instance
 * @param links - Array of link targets to validate
 * @returns Validation result with link status
 */
export function validateWikilinks(
  app: App,
  links: string[]
): ValidationResult {
  const linkStatus = new Map<string, boolean>();
  const existingNotes: string[] = [];
  const missingNotes: string[] = [];

  for (const link of links) {
    // Try to find the note
    const file = app.metadataCache.getFirstLinkpathDest(link, '');

    if (file) {
      linkStatus.set(link, true);
      existingNotes.push(link);
    } else {
      linkStatus.set(link, false);
      missingNotes.push(link);
    }
  }

  return {
    linkStatus,
    existingNotes,
    missingNotes,
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format connections output for display in markdown
 *
 * @param output - Parsed wikilink output
 * @param validation - Validation results
 * @returns Formatted markdown string
 */
export function formatConnectionsOutput(
  output: WikilinkOutput,
  validation: ValidationResult
): string {
  const lines: string[] = [];

  // Related Notes section
  if (output.relatedNotes.length > 0) {
    lines.push('### Related Notes');
    for (const note of output.relatedNotes) {
      const exists = validation.linkStatus.get(note.link) ?? false;
      const marker = exists ? '' : ' ⚠️ (not found)';
      lines.push(`- [[${note.link}]]${marker} - ${note.description}`);
    }
    lines.push('');
  }

  // Suggested Notes section
  if (output.suggestedNotes.length > 0) {
    lines.push('### Suggested Notes to Create');
    for (const note of output.suggestedNotes) {
      lines.push(`- [[${note.link}]] - ${note.description}`);
    }
    lines.push('');
  }

  // Tags section
  if (output.tags.length > 0) {
    lines.push('### Related Tags');
    lines.push(output.tags.map(t => `#${t}`).join(' '));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Process a connections comment from raw AI response
 *
 * @param app - Obsidian App instance
 * @param aiResponse - Raw AI response
 * @returns Formatted connections comment
 */
export function processConnectionsComment(
  app: App,
  aiResponse: string
): string {
  // Parse the AI response
  const parsed = parseWikilinkOutput(aiResponse);

  // Get all unique links
  const allLinks = [
    ...parsed.relatedNotes.map(n => n.link),
    ...parsed.suggestedNotes.map(n => n.link),
  ];

  // Validate against vault
  const validation = validateWikilinks(app, allLinks);

  // Format output
  return formatConnectionsOutput(parsed, validation);
}
