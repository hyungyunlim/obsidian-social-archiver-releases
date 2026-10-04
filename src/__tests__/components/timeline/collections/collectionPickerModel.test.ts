import { describe, expect, it } from 'vitest';
import {
  canOfferCreate,
  computeMembership,
  filterCollections,
  membershipChanges,
  toggleMembership,
} from '../../../../components/timeline/collections/collectionPickerModel';

describe('collection picker model', () => {
  const membership: Record<string, string[]> = {
    'arch-1': ['col-a', 'col-b'],
    'arch-2': ['col-a'],
  };
  const collectionsOf = (archiveId: string): string[] => membership[archiveId] ?? [];

  it('marks a collection holding some of the selected posts as "some"', () => {
    const states = computeMembership(['col-a', 'col-b', 'col-c'], ['arch-1', 'arch-2'], collectionsOf);
    expect(Object.fromEntries(states)).toEqual({ 'col-a': 'all', 'col-b': 'some', 'col-c': 'none' });
  });

  it('toggles anything not fully in to "all", and "all" to "none"', () => {
    expect(toggleMembership('none')).toBe('all');
    expect(toggleMembership('some')).toBe('all');
    expect(toggleMembership('all')).toBe('none');
  });

  it('applies only real changes and never a left-alone "some"', () => {
    const initial = new Map([['col-a', 'all'], ['col-b', 'some'], ['col-c', 'none']] as const);
    const current = new Map([['col-a', 'none'], ['col-b', 'some'], ['col-c', 'all']] as const);
    expect(membershipChanges(initial, current)).toEqual([
      { collectionId: 'col-a', include: false },
      { collectionId: 'col-c', include: true },
    ]);
  });

  it('filters by a case-insensitive substring', () => {
    const list = [{ name: 'Kaohsiung trip' }, { name: 'Reading' }];
    expect(filterCollections(list, 'TRIP')).toEqual([{ name: 'Kaohsiung trip' }]);
    expect(filterCollections(list, '  ')).toEqual(list);
  });

  it('offers "Create" unless I already own that name (trim + ASCII case folding)', () => {
    const owned = [{ name: 'Trips' }];
    expect(canOfferCreate(owned, ' trips ')).toBe(false);
    expect(canOfferCreate(owned, 'Trips 2026')).toBe(true);
    expect(canOfferCreate(owned, '   ')).toBe(false);
  });
});
