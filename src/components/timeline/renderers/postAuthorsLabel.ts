/**
 * A composed post's authors as one label (share-web postAuthors.ts
 * joinPostAuthorNames): "Work", "Work, Club", "Work, Club +2".
 */
export function joinPostAuthorNames(names: readonly string[], shown = 2): string {
  const label = names.slice(0, shown).join(', ');
  return names.length > shown ? `${label} +${names.length - shown}` : label;
}
