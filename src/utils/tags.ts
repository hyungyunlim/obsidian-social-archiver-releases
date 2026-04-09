/**
 * Tag merge utilities for archive-time tagging
 *
 * Case-insensitive deduplication when merging user-selected tags
 * with auto-generated archive tags in frontmatter.
 */
import { TAG_NAME_MAX_LENGTH } from '@/types/tag';

const TAG_WHITESPACE_PATTERN = /\s/;

/**
 * Normalize a raw tag name: trim whitespace and strip leading `#` characters.
 *
 * Obsidian uses `#` as a tag prefix in rendered markdown, but the stored
 * tag name should never include it.  Without this normalisation users can
 * end up with both `#work` and `work` stored as separate tags.
 *
 * @param name - Raw tag input (e.g. `#work`, `##design`, `  travel `)
 * @returns Cleaned tag name without leading `#` (e.g. `work`, `design`, `travel`)
 */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/^#+/, '');
}

/**
 * Validate tag name against app rules.
 *
 * The name is normalised first (trimmed, `#` prefix stripped) before
 * validation so that user input like `#work` passes correctly.
 *
 * Rules:
 * - 1..TAG_NAME_MAX_LENGTH chars after normalising
 * - no whitespace characters (Obsidian tag compatibility)
 *
 * @param name - Raw tag name
 * @returns Error message when invalid, otherwise null
 */
export function validateTagName(name: string): string | null {
  const normalised = normalizeTagName(name);
  if (!normalised || normalised.length > TAG_NAME_MAX_LENGTH) {
    return `Tag name must be 1-${TAG_NAME_MAX_LENGTH} characters`;
  }
  if (TAG_WHITESPACE_PATTERN.test(normalised)) {
    return 'Tag name cannot contain spaces';
  }
  return null;
}

/**
 * Check whether a tag name is valid.
 *
 * @param name - Raw tag name
 * @returns True when valid
 */
export function isValidTagName(name: string): boolean {
  return validateTagName(name) === null;
}

/**
 * Merge selected tags into existing frontmatter tags with case-insensitive deduplication.
 *
 * Rules:
 * - Existing tags keep their original casing
 * - New tags are only added if no case-insensitive match exists
 * - Order: existing tags first, then new tags
 *
 * @param existingTags - Current frontmatter tags array (may include auto archive tags)
 * @param selectedTags - User-selected tags from ArchiveModal
 * @returns Merged tags array with no case-insensitive duplicates
 */
export function mergeTagsCaseInsensitive(
  existingTags: string[],
  selectedTags: string[]
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  // Add existing tags first (preserving their casing, normalising # prefix)
  for (const rawTag of existingTags) {
    const tag = normalizeTagName(rawTag);
    if (!tag) continue;
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(tag);
    }
  }

  // Add selected tags only if not already present (case-insensitive)
  for (const rawTag of selectedTags) {
    const tag = normalizeTagName(rawTag);
    if (!tag) continue;
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(tag);
    }
  }

  return result;
}

/**
 * Sanitize tag names for safe storage.
 * Trims whitespace, removes empty strings.
 *
 * @param tags - Raw tag name array
 * @returns Cleaned tag names
 */
export function sanitizeTagNames(tags: string[]): string[] {
  return tags
    .map(normalizeTagName)
    .filter(t => t.length > 0 && isValidTagName(t));
}
