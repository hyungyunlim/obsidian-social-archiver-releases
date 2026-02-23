/**
 * Tag merge utilities for archive-time tagging
 *
 * Case-insensitive deduplication when merging user-selected tags
 * with auto-generated archive tags in frontmatter.
 */

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

  // Add existing tags first (preserving their casing)
  for (const tag of existingTags) {
    const lower = tag.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(tag);
    }
  }

  // Add selected tags only if not already present (case-insensitive)
  for (const tag of selectedTags) {
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
    .map(t => t.trim())
    .filter(t => t.length > 0);
}
