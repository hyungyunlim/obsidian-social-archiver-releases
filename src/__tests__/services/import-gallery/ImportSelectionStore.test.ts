/**
 * Unit tests for ImportSelectionStore.
 *
 * PRD: `.taskmaster/docs/prd-instagram-import-gallery.md` §9.4
 *
 * Coverage focus:
 *  - Default state semantics (opt-out: everything selected)
 *  - Mode-flip rule: smaller-encoding-wins, with tie = no flip
 *  - Duplicates are structurally unselectable in every code path
 *  - getSelectedIds() materializes correctly under both modes
 *  - selectAllInCollection only touches the requested collection
 *  - updateUniverse drops stale ids
 *  - onChange fires only on real state changes (no-op suppression)
 *  - Round-trip: getState() → constructor initialState yields equivalent store
 */

import { describe, it, expect, vi } from 'vitest';
import { ImportSelectionStore } from '@/services/import-gallery/ImportSelectionStore';
import { createDefaultGallerySelection, type GallerySelection } from '@/types/import';

const ids = (...xs: string[]) => new Set(xs);

function mkStore(opts: {
  available: string[];
  duplicates?: string[];
  byCollection?: Record<string, string>;
  byAuthor?: Record<string, string>;
  initialState?: GallerySelection;
}) {
  return new ImportSelectionStore({
    availablePostIds: ids(...opts.available),
    duplicatePostIds: ids(...(opts.duplicates ?? [])),
    collectionByPostId: new Map(Object.entries(opts.byCollection ?? {})),
    authorByPostId: new Map(Object.entries(opts.byAuthor ?? {})),
    initialState: opts.initialState,
  });
}

// =============================================================================
// Defaults
// =============================================================================

describe('ImportSelectionStore — default state', () => {
  it('factory default = mode "all-except", empty ids, everything selected', () => {
    const store = mkStore({ available: ['a', 'b', 'c'] });

    expect(store.getState()).toEqual({ mode: 'all-except', ids: new Set() });
    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(true);
    expect(store.isSelected('c')).toBe(true);
    expect(store.getSelectedCount()).toBe(3);
    expect(store.getSelectedIds()).toEqual(ids('a', 'b', 'c'));
  });

  it('duplicates are filtered from default selected set', () => {
    const store = mkStore({ available: ['a', 'b', 'c'], duplicates: ['b'] });

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(false);
    expect(store.isSelected('c')).toBe(true);
    expect(store.getSelectedIds()).toEqual(ids('a', 'c'));
    expect(store.getSelectedCount()).toBe(2);
  });

  it('isSelected returns false for postIds outside the universe', () => {
    const store = mkStore({ available: ['a'] });
    expect(store.isSelected('zzz')).toBe(false);
  });

  it('factory function `createDefaultGallerySelection` matches default state', () => {
    const store = mkStore({ available: ['a'] });
    expect(store.getState()).toEqual(createDefaultGallerySelection());
  });

  it('empty universe is valid — selected count is 0', () => {
    const store = mkStore({ available: [] });
    expect(store.getSelectedCount()).toBe(0);
    expect(store.getSelectedIds()).toEqual(new Set());
  });
});

// =============================================================================
// toggle
// =============================================================================

describe('ImportSelectionStore — toggle', () => {
  it('toggling a selected post in default state keeps mode "all-except"', () => {
    // 5 posts, deselect 1. all-except size = 1, only size = 4. 1 < 4 → stay.
    const store = mkStore({ available: ['a', 'b', 'c', 'd', 'e'] });

    expect(store.toggle('b')).toBe(false);

    expect(store.isSelected('b')).toBe(false);
    expect(store.isSelected('a')).toBe(true);
    expect(store.getState().mode).toBe('all-except');
    expect(store.getState().ids).toEqual(ids('b'));
    expect(store.getSelectedIds()).toEqual(ids('a', 'c', 'd', 'e'));
  });

  it('flips mode to "only" once deselected count exceeds half', () => {
    // 4 posts. Deselect a, b, c → onlySize=1, allExceptSize=3 → flip to only.
    const store = mkStore({ available: ['a', 'b', 'c', 'd'] });
    store.toggle('a');
    store.toggle('b');
    store.toggle('c');

    expect(store.getState().mode).toBe('only');
    // Encoded ids should be {d} — the one still-selected post.
    expect(store.getState().ids).toEqual(ids('d'));
    expect(store.getSelectedIds()).toEqual(ids('d'));
  });

  it('flips back to "all-except" when re-selecting brings count back', () => {
    const store = mkStore({ available: ['a', 'b', 'c', 'd'] });
    store.toggle('a');
    store.toggle('b');
    store.toggle('c');
    expect(store.getState().mode).toBe('only');

    // Re-select a, b → 3 selected of 4. allExceptSize=1, onlySize=3 → flip.
    store.toggle('a');
    store.toggle('b');

    expect(store.getState().mode).toBe('all-except');
    expect(store.getSelectedIds()).toEqual(ids('a', 'b', 'd'));
  });

  it('toggle on a duplicate is a no-op and returns false', () => {
    const store = mkStore({ available: ['a', 'b'], duplicates: ['b'] });
    const before = store.getState();

    expect(store.toggle('b')).toBe(false);

    expect(store.isSelected('b')).toBe(false);
    expect(store.getState()).toEqual(before);
  });

  it('toggle on an unknown postId is a no-op', () => {
    const store = mkStore({ available: ['a'] });
    const before = store.getState();

    expect(store.toggle('zzz')).toBe(false);

    expect(store.getState()).toEqual(before);
  });

  it('returns the new selected state for a real toggle', () => {
    const store = mkStore({ available: ['a'] });
    expect(store.isSelected('a')).toBe(true);
    expect(store.toggle('a')).toBe(false); // now deselected
    expect(store.toggle('a')).toBe(true); // selected again
  });

  it('tied counts (50/50) keep the current mode (no thrash)', () => {
    // 4 posts, deselect 2. allExceptSize=2, onlySize=2 → keep "all-except".
    const store = mkStore({ available: ['a', 'b', 'c', 'd'] });
    store.toggle('a');
    store.toggle('b');

    expect(store.getState().mode).toBe('all-except');
    expect(store.getState().ids).toEqual(ids('a', 'b'));
  });
});

// =============================================================================
// selectAll / clear / invert
// =============================================================================

describe('ImportSelectionStore — selectAll', () => {
  it('selects everything and uses the smaller "all-except" encoding', () => {
    const store = mkStore({ available: ['a', 'b', 'c'] });
    store.toggle('a');
    store.toggle('b');
    expect(store.getState().mode).toBe('only');

    store.selectAll();

    expect(store.getState()).toEqual({ mode: 'all-except', ids: new Set() });
    expect(store.getSelectedIds()).toEqual(ids('a', 'b', 'c'));
  });

  it('selectAll respects duplicates (they remain unselected)', () => {
    const store = mkStore({ available: ['a', 'b'], duplicates: ['b'] });
    store.selectAll();
    expect(store.getSelectedIds()).toEqual(ids('a'));
  });
});

describe('ImportSelectionStore — clear', () => {
  it('deselects everything via mode "only" with empty ids (smallest encoding)', () => {
    const store = mkStore({ available: ['a', 'b', 'c'] });
    store.clear();

    expect(store.getState()).toEqual({ mode: 'only', ids: new Set() });
    expect(store.getSelectedCount()).toBe(0);
    expect(store.getSelectedIds()).toEqual(new Set());
  });
});

describe('ImportSelectionStore — invert', () => {
  it('inverts selection over (universe \\ duplicates)', () => {
    const store = mkStore({
      available: ['a', 'b', 'c', 'd'],
      duplicates: ['c'],
    });
    store.toggle('a'); // deselect a; b, d still selected; c locked.

    store.invert();

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(false);
    expect(store.isSelected('c')).toBe(false); // duplicate stays locked
    expect(store.isSelected('d')).toBe(false);
    expect(store.getSelectedIds()).toEqual(ids('a'));
  });

  it('invert twice is identity (over selectable posts)', () => {
    const store = mkStore({ available: ['a', 'b', 'c'] });
    store.toggle('a');
    const before = store.getSelectedIds();

    store.invert();
    store.invert();

    expect(store.getSelectedIds()).toEqual(before);
  });

  it('invert on empty universe is a no-op', () => {
    const store = mkStore({ available: [] });
    const cb = vi.fn();
    store.onChange(cb);

    store.invert();

    expect(cb).not.toHaveBeenCalled();
  });
});

// =============================================================================
// selectAllInCollection
// =============================================================================

describe('ImportSelectionStore — selectAllInCollection', () => {
  it('only touches posts in the given collection', () => {
    const store = mkStore({
      available: ['a', 'b', 'c', 'd'],
      byCollection: { a: 'col1', b: 'col1', c: 'col2', d: 'col2' },
    });
    // Start by clearing everything so we can measure additions.
    store.clear();

    store.selectAllInCollection('col1');

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(true);
    expect(store.isSelected('c')).toBe(false);
    expect(store.isSelected('d')).toBe(false);
  });

  it('skips duplicates within the collection', () => {
    const store = mkStore({
      available: ['a', 'b', 'c'],
      duplicates: ['b'],
      byCollection: { a: 'col1', b: 'col1', c: 'col1' },
    });
    store.clear();

    store.selectAllInCollection('col1');

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(false); // duplicate locked
    expect(store.isSelected('c')).toBe(true);
  });

  it('is a no-op when the collection is already fully selected', () => {
    const store = mkStore({
      available: ['a', 'b'],
      byCollection: { a: 'col1', b: 'col1' },
    });
    const cb = vi.fn();
    store.onChange(cb);

    store.selectAllInCollection('col1');

    expect(cb).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown collection id', () => {
    const store = mkStore({
      available: ['a'],
      byCollection: { a: 'col1' },
    });
    store.clear();
    const cb = vi.fn();
    store.onChange(cb);

    store.selectAllInCollection('nonexistent');

    expect(cb).not.toHaveBeenCalled();
    expect(store.isSelected('a')).toBe(false);
  });
});

// =============================================================================
// selectAllByAuthor
// =============================================================================

describe('ImportSelectionStore — selectAllByAuthor', () => {
  it('only selects posts whose author key matches', () => {
    const store = mkStore({
      available: ['a', 'b', 'c', 'd'],
      byAuthor: { a: 'alice', b: 'alice', c: 'bob', d: 'bob' },
    });
    store.clear();

    store.selectAllByAuthor('alice');

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(true);
    expect(store.isSelected('c')).toBe(false);
    expect(store.isSelected('d')).toBe(false);
  });

  it('skips duplicates within the matching author set', () => {
    const store = mkStore({
      available: ['a', 'b', 'c'],
      duplicates: ['b'],
      byAuthor: { a: 'alice', b: 'alice', c: 'alice' },
    });
    store.clear();

    store.selectAllByAuthor('alice');

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(false); // duplicate locked
    expect(store.isSelected('c')).toBe(true);
  });

  it('is a no-op (no notify, no state change) when no posts match', () => {
    const store = mkStore({
      available: ['a', 'b'],
      byAuthor: { a: 'alice', b: 'bob' },
    });
    store.clear();
    const before = store.getState();
    const cb = vi.fn();
    store.onChange(cb);

    store.selectAllByAuthor('charlie');

    expect(cb).not.toHaveBeenCalled();
    expect(store.getState()).toEqual(before);
  });

  it('is additive — does NOT deselect prior selections from other authors', () => {
    const store = mkStore({
      available: ['a', 'b', 'c', 'd'],
      byAuthor: { a: 'alice', b: 'alice', c: 'bob', d: 'bob' },
    });
    store.clear();
    // Pre-select one bob post manually.
    store.toggle('c');
    expect(store.isSelected('c')).toBe(true);

    // Now bulk-select alice. Bob's existing 'c' selection must survive.
    store.selectAllByAuthor('alice');

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(true);
    expect(store.isSelected('c')).toBe(true); // preserved from before
    expect(store.isSelected('d')).toBe(false);
  });

  it('is a silent no-op when the author is already fully selected', () => {
    const store = mkStore({
      available: ['a', 'b'],
      byAuthor: { a: 'alice', b: 'alice' },
    });
    // Default state = everything selected.
    const cb = vi.fn();
    store.onChange(cb);

    store.selectAllByAuthor('alice');

    expect(cb).not.toHaveBeenCalled();
  });
});

// =============================================================================
// deselectAllByAuthor (toggle counterpart of selectAllByAuthor)
// =============================================================================

describe('ImportSelectionStore — deselectAllByAuthor', () => {
  it('deselects every post matching the author key', () => {
    const store = mkStore({
      available: ['a', 'b', 'c', 'd'],
      byAuthor: { a: 'alice', b: 'alice', c: 'bob', d: 'bob' },
    });
    // Default = all selected.
    expect(store.getSelectedIds()).toEqual(new Set(['a', 'b', 'c', 'd']));

    store.deselectAllByAuthor('alice');

    expect(store.isSelected('a')).toBe(false);
    expect(store.isSelected('b')).toBe(false);
    // Bob's posts unaffected — additive semantics.
    expect(store.isSelected('c')).toBe(true);
    expect(store.isSelected('d')).toBe(true);
  });

  it('skips duplicates (which were never selectable)', () => {
    const store = mkStore({
      available: ['a', 'b', 'c'],
      duplicates: ['b'],
      byAuthor: { a: 'alice', b: 'alice', c: 'alice' },
    });
    store.deselectAllByAuthor('alice');
    expect(store.isSelected('a')).toBe(false);
    expect(store.isSelected('b')).toBe(false); // duplicate, never selected
    expect(store.isSelected('c')).toBe(false);
  });

  it('is additive — does not affect other authors', () => {
    const store = mkStore({
      available: ['a', 'b', 'c', 'd'],
      byAuthor: { a: 'alice', b: 'alice', c: 'bob', d: 'bob' },
    });
    store.clear();
    store.toggle('a');
    store.toggle('b');
    store.toggle('c');
    // Now selected = {a, b, c}.
    store.deselectAllByAuthor('alice');
    expect(store.isSelected('a')).toBe(false);
    expect(store.isSelected('b')).toBe(false);
    expect(store.isSelected('c')).toBe(true); // bob — preserved
  });

  it('is a silent no-op when the author has nothing selected', () => {
    const store = mkStore({
      available: ['a', 'b'],
      byAuthor: { a: 'alice', b: 'alice' },
    });
    store.clear();
    const cb = vi.fn();
    store.onChange(cb);

    store.deselectAllByAuthor('alice');

    expect(cb).not.toHaveBeenCalled();
  });

  it('toggles correctly when paired with selectAllByAuthor', () => {
    const store = mkStore({
      available: ['a', 'b'],
      byAuthor: { a: 'alice', b: 'alice' },
    });
    // start: all selected (default)
    expect(store.getSelectedIds().size).toBe(2);

    store.deselectAllByAuthor('alice');
    expect(store.getSelectedIds().size).toBe(0);

    store.selectAllByAuthor('alice');
    expect(store.getSelectedIds().size).toBe(2);
  });
});

// =============================================================================
// Visible-scoped bulk actions (PRD §5.4 — selection survives filter narrowing)
// =============================================================================

describe('ImportSelectionStore — visible-scoped bulk actions', () => {
  it('selectAll({visibleIds}) only selects within visible, leaves off-visible state.ids untouched', () => {
    // Universe = 5 posts (a..e). Start by clearing everything → all deselected.
    // Then selectAll restricted to {a, b, c}. d and e must stay deselected.
    const store = mkStore({ available: ['a', 'b', 'c', 'd', 'e'] });
    store.clear();
    expect(store.getSelectedIds()).toEqual(new Set());

    store.selectAll({ visibleIds: ids('a', 'b', 'c') });

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(true);
    expect(store.isSelected('c')).toBe(true);
    // d, e were deselected before the visible-scoped call and must remain so.
    expect(store.isSelected('d')).toBe(false);
    expect(store.isSelected('e')).toBe(false);
    expect(store.getSelectedIds()).toEqual(ids('a', 'b', 'c'));
  });

  it('clear({visibleIds}) only deselects within visible, leaves off-visible alone', () => {
    // Default state: everything selected.
    const store = mkStore({ available: ['a', 'b', 'c', 'd', 'e'] });

    store.clear({ visibleIds: ids('a', 'b') });

    expect(store.isSelected('a')).toBe(false);
    expect(store.isSelected('b')).toBe(false);
    // c, d, e were selected before; visible-scoped clear must not touch them.
    expect(store.isSelected('c')).toBe(true);
    expect(store.isSelected('d')).toBe(true);
    expect(store.isSelected('e')).toBe(true);
    expect(store.getSelectedIds()).toEqual(ids('c', 'd', 'e'));
  });

  it('invert({visibleIds}) only flips within visible, leaves off-visible alone', () => {
    // Universe = a..e. Deselect a so initial state is a:F, b:T, c:T, d:T, e:T.
    const store = mkStore({ available: ['a', 'b', 'c', 'd', 'e'] });
    store.toggle('a');
    expect(store.isSelected('a')).toBe(false);

    // Visible = {a, b, c}. Invert → a:T, b:F, c:F. d, e untouched (still T).
    store.invert({ visibleIds: ids('a', 'b', 'c') });

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(false);
    expect(store.isSelected('c')).toBe(false);
    expect(store.isSelected('d')).toBe(true);
    expect(store.isSelected('e')).toBe(true);
  });

  it('reviewer scenario: filter → bulk → unfilter survives off-screen selection', () => {
    // Mirrors the exact failure mode from the QA review:
    //   1. User has 6 posts across two collections (col1: a,b,c, col2: d,e,f).
    //   2. With NO filter active, user deselects 'd' (off-screen later).
    //   3. User filters to col1 → visible = {a,b,c}.
    //   4. User clicks "Clear" (visible-scoped) → a,b,c become deselected.
    //   5. User switches back to All collections.
    //   → Expected: a:F, b:F, c:F (just deselected), d:F (deselected in step 2),
    //     e:T, f:T (untouched throughout). Old `withVisibleUniverse` lost d.
    const store = mkStore({
      available: ['a', 'b', 'c', 'd', 'e', 'f'],
      byCollection: {
        a: 'col1', b: 'col1', c: 'col1',
        d: 'col2', e: 'col2', f: 'col2',
      },
    });

    // Step 2: deselect d while no filter is active.
    store.toggle('d');
    expect(store.isSelected('d')).toBe(false);

    // Step 4: visible-scoped clear (col1).
    store.clear({ visibleIds: ids('a', 'b', 'c') });

    // Step 5: verify the post-unfilter view.
    expect(store.isSelected('a')).toBe(false);
    expect(store.isSelected('b')).toBe(false);
    expect(store.isSelected('c')).toBe(false);
    // The critical assertion — off-screen 'd' must remain deselected.
    expect(store.isSelected('d')).toBe(false);
    expect(store.isSelected('e')).toBe(true);
    expect(store.isSelected('f')).toBe(true);
    expect(store.getSelectedIds()).toEqual(ids('e', 'f'));
  });

  it('visible-scoped operations skip duplicates and unknown ids', () => {
    const store = mkStore({
      available: ['a', 'b', 'c'],
      duplicates: ['b'],
    });
    store.clear();

    // Visible includes a duplicate (b) and an unknown id (zzz). selectAll
    // must skip both — only 'a' becomes selected.
    store.selectAll({ visibleIds: ids('a', 'b', 'zzz') });

    expect(store.isSelected('a')).toBe(true);
    expect(store.isSelected('b')).toBe(false); // duplicate
    expect(store.isSelected('zzz')).toBe(false); // outside universe
  });

  it('visible-scoped no-op does not notify subscribers', () => {
    // a is already selected (default). Visible-scoped selectAll on {a} is a no-op.
    const store = mkStore({ available: ['a', 'b'] });
    const cb = vi.fn();
    store.onChange(cb);

    store.selectAll({ visibleIds: ids('a') });

    expect(cb).not.toHaveBeenCalled();
  });

  it('visible-scoped operation re-runs the mode-flip heuristic', () => {
    // 5 posts, default = all-except / ids={}. Visible-scoped clear of 4
    // visible posts leaves only 1 selected (e). 1 selected vs 4 deselected →
    // smaller encoding is `only` with ids={e}.
    const store = mkStore({ available: ['a', 'b', 'c', 'd', 'e'] });

    store.clear({ visibleIds: ids('a', 'b', 'c', 'd') });

    expect(store.getState().mode).toBe('only');
    expect(store.getState().ids).toEqual(ids('e'));
    expect(store.getSelectedIds()).toEqual(ids('e'));
  });
});

// =============================================================================
// updateUniverse
// =============================================================================

describe('ImportSelectionStore — updateUniverse', () => {
  it('drops stale ids from the persisted ids set', () => {
    const store = mkStore({ available: ['a', 'b', 'c'] });
    store.toggle('a'); // ids = {a}
    expect(store.getState().ids).toEqual(ids('a'));

    // Remove 'a' from universe.
    store.updateUniverse(ids('b', 'c'));

    expect(store.getState().ids).toEqual(new Set());
    expect(store.isSelected('a')).toBe(false);
    expect(store.isSelected('b')).toBe(true);
    expect(store.isSelected('c')).toBe(true);
  });

  it('promoting a post to duplicate removes it from selection', () => {
    const store = mkStore({ available: ['a', 'b'] });
    expect(store.isSelected('b')).toBe(true);

    store.updateUniverse(ids('a', 'b'), ids('b'));

    expect(store.isSelected('b')).toBe(false);
    expect(store.getSelectedIds()).toEqual(ids('a'));
  });

  it('keeps the user’s existing selection on universe expansion', () => {
    const store = mkStore({ available: ['a', 'b'] });
    store.toggle('a'); // deselected a

    store.updateUniverse(ids('a', 'b', 'c'));

    expect(store.isSelected('a')).toBe(false);
    expect(store.isSelected('b')).toBe(true);
    expect(store.isSelected('c')).toBe(true); // newly added defaults to selected
  });

  it('updates the authorByPostId map when supplied (4th arg)', () => {
    // Start with author map: a→alice. Without an updated map, a bulk-by-bob
    // would do nothing for a fresh universe id 'd'.
    const store = mkStore({
      available: ['a', 'b'],
      byAuthor: { a: 'alice', b: 'alice' },
    });
    store.clear();

    // Expand universe + provide a new author map that puts 'd' under 'bob'.
    store.updateUniverse(
      ids('a', 'b', 'c', 'd'),
      undefined,
      undefined,
      new Map([
        ['a', 'alice'],
        ['b', 'alice'],
        ['c', 'bob'],
        ['d', 'bob'],
      ]),
    );

    store.selectAllByAuthor('bob');

    expect(store.isSelected('a')).toBe(false);
    expect(store.isSelected('b')).toBe(false);
    expect(store.isSelected('c')).toBe(true);
    expect(store.isSelected('d')).toBe(true);
  });
});

// =============================================================================
// onChange notifications
// =============================================================================

describe('ImportSelectionStore — onChange', () => {
  it('fires after a real toggle', () => {
    const store = mkStore({ available: ['a'] });
    const cb = vi.fn();
    store.onChange(cb);

    store.toggle('a');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire on a no-op toggle (duplicate)', () => {
    const store = mkStore({ available: ['a'], duplicates: ['a'] });
    const cb = vi.fn();
    store.onChange(cb);

    store.toggle('a');

    expect(cb).not.toHaveBeenCalled();
  });

  it('does NOT fire on selectAll() when already all-selected', () => {
    const store = mkStore({ available: ['a', 'b'] });
    const cb = vi.fn();
    store.onChange(cb);

    store.selectAll();

    expect(cb).not.toHaveBeenCalled();
  });

  it('does NOT fire on clear() when already empty', () => {
    const store = mkStore({ available: ['a'] });
    store.clear();
    const cb = vi.fn();
    store.onChange(cb);

    store.clear();

    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe handle removes the listener', () => {
    const store = mkStore({ available: ['a'] });
    const cb = vi.fn();
    const off = store.onChange(cb);

    off();
    store.toggle('a');

    expect(cb).not.toHaveBeenCalled();
  });

  it('subscriber errors do not break sibling subscribers', () => {
    const store = mkStore({ available: ['a'] });
    const broken = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    store.onChange(broken);
    store.onChange(ok);

    expect(() => store.toggle('a')).not.toThrow();
    expect(broken).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// getState round-trip
// =============================================================================

describe('ImportSelectionStore — round-trip via getState/initialState', () => {
  it('feeding getState() into a new store preserves selection', () => {
    const a = mkStore({ available: ['p1', 'p2', 'p3', 'p4', 'p5'] });
    a.toggle('p2');
    a.toggle('p4');
    const snapshot = a.getState();

    const b = mkStore({
      available: ['p1', 'p2', 'p3', 'p4', 'p5'],
      initialState: snapshot,
    });

    expect(b.getSelectedIds()).toEqual(a.getSelectedIds());
    expect(b.getState()).toEqual(snapshot);
  });

  it('returned ids set is a defensive copy (mutations do not leak in)', () => {
    const store = mkStore({ available: ['a', 'b'] });
    store.toggle('a');
    const snapshot = store.getState();
    snapshot.ids.add('b'); // mutate the returned set

    expect(store.isSelected('b')).toBe(true); // unaffected
    expect(store.getState().ids).toEqual(ids('a'));
  });

  it('constructor filters duplicates and stale ids out of initialState', () => {
    const init: GallerySelection = {
      mode: 'only',
      ids: ids('valid', 'duplicate', 'stale'),
    };
    const store = mkStore({
      available: ['valid', 'duplicate', 'other'],
      duplicates: ['duplicate'],
      initialState: init,
    });

    expect(store.getState().ids.has('stale')).toBe(false);
    expect(store.getState().ids.has('duplicate')).toBe(false);
    expect(store.isSelected('valid')).toBe(true);
    expect(store.isSelected('duplicate')).toBe(false);
    expect(store.isSelected('other')).toBe(false); // mode "only" with ids={valid}
  });

  it('constructor normalizes a sub-optimal mode encoding', () => {
    // Hand-craft a wasteful "only" encoding that lists 4 of 5 posts as
    // selected — should be flipped to "all-except" with ids={p3}.
    const init: GallerySelection = {
      mode: 'only',
      ids: ids('p1', 'p2', 'p4', 'p5'),
    };
    const store = mkStore({
      available: ['p1', 'p2', 'p3', 'p4', 'p5'],
      initialState: init,
    });

    expect(store.getState().mode).toBe('all-except');
    expect(store.getState().ids).toEqual(ids('p3'));
    expect(store.getSelectedIds()).toEqual(ids('p1', 'p2', 'p4', 'p5'));
  });
});
