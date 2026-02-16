/**
 * Tag system types for user-defined post categorization
 *
 * Tags are stored in:
 * - Plugin data.json: Tag definitions (name, color, sortOrder)
 * - YAML frontmatter: Tag names in the `tags` array per post
 */

/** Predefined tag color palette (matches mobile app) */
export const TAG_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
] as const;

export type TagColor = typeof TAG_COLORS[number];

/** Tag definition stored in plugin data */
export interface TagDefinition {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Tag definition with archive count (for display) */
export interface TagWithCount extends TagDefinition {
  archiveCount: number;
}

/** Max tag name length */
export const TAG_NAME_MAX_LENGTH = 30;
