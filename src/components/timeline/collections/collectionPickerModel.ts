import { normalizeCollectionName } from '../../../services/collections/CollectionStore';
import type { LocalCollection } from '../../../types/collections';

/**
 * Picker state, kept apart from the DOM (prd-collections-obsidian-plugin §4.2).
 * With several posts selected a collection can hold some of them: shown as
 * "some", and a click makes it "all" (desktop/mobile tri-state behaviour).
 */

export type MembershipState = 'all' | 'some' | 'none';

export function computeMembership(
  collectionIds: readonly string[],
  archiveIds: readonly string[],
  collectionsOf: (archiveId: string) => readonly string[],
): Map<string, MembershipState> {
  const counts = new Map<string, number>();
  for (const archiveId of archiveIds) {
    for (const collectionId of collectionsOf(archiveId)) counts.set(collectionId, (counts.get(collectionId) ?? 0) + 1);
  }
  const states = new Map<string, MembershipState>();
  for (const id of collectionIds) {
    const count = counts.get(id) ?? 0;
    states.set(id, count === 0 ? 'none' : count === archiveIds.length ? 'all' : 'some');
  }
  return states;
}

/** A click: anything not fully in becomes fully in; fully in becomes out. */
export function toggleMembership(state: MembershipState): MembershipState {
  return state === 'all' ? 'none' : 'all';
}

/** What to apply on Done. "some" left untouched applies nothing. */
export function membershipChanges(
  initial: ReadonlyMap<string, MembershipState>,
  current: ReadonlyMap<string, MembershipState>,
): Array<{ collectionId: string; include: boolean }> {
  const changes: Array<{ collectionId: string; include: boolean }> = [];
  for (const [collectionId, state] of current) {
    if (state === 'some' || state === initial.get(collectionId)) continue;
    changes.push({ collectionId, include: state === 'all' });
  }
  return changes;
}

export function filterCollections<T extends Pick<LocalCollection, 'name'>>(collections: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...collections];
  return collections.filter((collection) => collection.name.toLowerCase().includes(needle));
}

/** Offer "Create …" unless one of MY collections already has this name (shared ones don't count). */
export function canOfferCreate(owned: readonly Pick<LocalCollection, 'name'>[], query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  const key = normalizeCollectionName(trimmed);
  return !owned.some((collection) => normalizeCollectionName(collection.name) === key);
}
