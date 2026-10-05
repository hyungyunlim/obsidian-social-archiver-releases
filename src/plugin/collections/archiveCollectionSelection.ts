import type { LocalCollection } from '../../types/collections';

/**
 * Archive-time collection choice (prd-archive-into-collections A6): nothing
 * is pre-selected and the most recently used collections come first. The
 * server bumps `updatedAt` on every item change, so it stands in for "used".
 */

export function orderForArchivePicker<T extends Pick<LocalCollection, 'updatedAt' | 'name'>>(collections: readonly T[]): T[] {
  return [...collections].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

/** The picker reports changes; fold them into the current selection. */
export function applySelectionChanges(
  selected: readonly string[],
  changes: ReadonlyArray<{ collectionId: string; include: boolean }>,
): string[] {
  const next = new Set(selected);
  for (const { collectionId, include } of changes) {
    if (include) next.add(collectionId);
    else next.delete(collectionId);
  }
  return [...next];
}
