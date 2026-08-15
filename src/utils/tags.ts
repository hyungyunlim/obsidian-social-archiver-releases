/**
 * Tag merge utilities for archive-time tagging
 *
 * Case-insensitive deduplication when merging user-selected tags
 * with auto-generated archive tags in frontmatter.
 */
import { TAG_NAME_MAX_LENGTH } from '@/types/tag';

const TAG_WHITESPACE_PATTERN = /\s/;

/** Digits and tag separators only — Obsidian rejects such a tag outright. */
const TAG_DIGITS_ONLY_PATTERN = /^[0-9/_-]+$/;

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
 * Read a frontmatter tag field into a string array.
 *
 * Obsidian accepts `tags` as a YAML list *or* as an inline string
 * (`tags: work` / `tags: work, home`). Reading a scalar as "no tags" and then
 * writing an array back deletes what the user wrote — so every code path that
 * rewrites `tags` must read it through here.
 *
 * @param value - Raw frontmatter value (array, string, or anything else)
 * @returns Tag names, empty when the field is absent or of another type
 */
export function readFrontmatterTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    return value.split(',').map(tag => tag.trim()).filter(Boolean);
  }
  return [];
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
 * Merge any number of tag arrays for display.
 *
 * First-seen casing and order are preserved, while duplicates are removed
 * case-insensitively. Invalid/empty values are ignored.
 */
export function mergeTagListsCaseInsensitive(...tagLists: Array<readonly string[] | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const tagList of tagLists) {
    if (!tagList) continue;

    for (const rawTag of tagList) {
      const tag = normalizeTagName(rawTag);
      if (!tag) continue;

      const lower = tag.toLowerCase();
      if (seen.has(lower)) continue;

      seen.add(lower);
      result.push(tag);
    }
  }

  return result;
}

/**
 * Keep only the names Obsidian will accept as tags.
 *
 * Our own `archiveTags` field holds anything the tag system allows — spaces
 * included, which the mobile app renders fine and 39% of stored tags use. But
 * Obsidian's native `tags` property validates its values, and one it rejects
 * renders struck through in red. So filter at the mirroring boundary only,
 * never on `archiveTags` itself.
 *
 * Deliberately narrow: it drops only what Obsidian definitely rejects (blank,
 * whitespace, nothing but digits and separators). Accents, emoji and CJK stay
 * — over-filtering here would silently drop a valid tag from the user's note,
 * which is worse than the rendering bug.
 *
 * @param names - Raw tag names, typically the server's archive tags
 * @returns The subset Obsidian will render as real tags
 */
export function obsidianSafeTagNames(names: string[]): string[] {
  return names.filter((name) => {
    const tag = normalizeTagName(name);
    if (!tag) return false;
    if (TAG_WHITESPACE_PATTERN.test(tag)) return false;
    // Obsidian requires at least one non-numeric character.
    return !TAG_DIGITS_ONLY_PATTERN.test(tag);
  });
}

/**
 * Mirror archive tags into Obsidian's native `tags` field without replacing
 * unrelated user tags.
 *
 * Previous archive tags are removed first so server replacement semantics do
 * not leave stale mirrored tags behind. Other tags are preserved.
 *
 * Incoming tags are filtered through {@link obsidianSafeTagNames}; removal of
 * previous tags is not, so a tag mirrored before this filter existed still
 * gets cleaned up.
 */
export function mirrorArchiveTagsIntoObsidianTags(
  currentTags: string[],
  previousArchiveTags: string[],
  nextArchiveTags: string[]
): string[] {
  const previousArchiveTagNames = new Set(
    previousArchiveTags
      .map(normalizeTagName)
      .filter(Boolean)
      .map(tag => tag.toLowerCase())
  );

  const preservedTags = currentTags.filter((tag) => {
    const normalized = normalizeTagName(tag);
    return normalized && !previousArchiveTagNames.has(normalized.toLowerCase());
  });

  return mergeTagListsCaseInsensitive(preservedTags, obsidianSafeTagNames(nextArchiveTags));
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
