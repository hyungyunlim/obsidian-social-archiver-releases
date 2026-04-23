/**
 * ImportSelectionStore — dual-mode reactive selection store for the
 * Instagram Import Review Gallery.
 *
 * PRD: `.taskmaster/docs/prd-instagram-import-gallery.md` §9.4
 *
 * --------------------------------------------------------------------------
 * Why dual-mode?
 *
 * A single export package may contain hundreds (sometimes thousands) of
 * posts. The two common selection patterns are:
 *
 *   1. "Keep defaults, deselect a few"     → store the deselected ids.
 *   2. "Deselect almost everything, keep a handful" → store the selected ids.
 *
 * Persisting the alternative would mean writing 495 ids when 5 changed.
 * Instead we encode selection as ONE of two equivalent representations and
 * automatically flip whenever the OTHER one would be smaller.
 *
 *   - `mode: 'all-except'` — every non-duplicate post in the universe is
 *     selected EXCEPT those listed in `ids` (the "deselected" set).
 *   - `mode: 'only'`       — only the posts listed in `ids` are selected.
 *
 * Duplicates are NEVER selectable and are filtered out at materialize-time
 * (see {@link ImportSelectionStore.getSelectedIds}). They are not tracked
 * in the persisted `ids` set under either mode.
 *
 * --------------------------------------------------------------------------
 * Reactivity decision (Svelte 5 Runes)
 *
 * The PRD calls for a "reactive Svelte 5 `$state`-based store". `$state` is
 * a compiler rune available only inside `.svelte` / `.svelte.ts` modules.
 * Using it in a `.ts` service module is awkward and couples the store to
 * the Svelte runtime, which makes it untestable from vitest's plain Node
 * environment.
 *
 * Instead we expose a plain `onChange(callback)` subscription. Consumers
 * (the gallery container Svelte component) wrap calls in their own `$state`
 * cell and bump it from the callback — a one-liner pattern, see
 * `ImportGalleryContainer.svelte` (PRD §9.5). This keeps the store
 * pure-TypeScript, deterministically testable, and side-effect-free toward
 * persistence. The orchestrator wires `onChange` to the debounced job-store
 * save (PRD §9.4 "persistence is debounced through the existing job-store
 * save mechanism").
 *
 * --------------------------------------------------------------------------
 * Platform-agnostic
 *
 * Nothing here knows it is talking about Instagram posts. The store
 * operates on opaque `postId` strings + `collectionId` strings. PRD §0
 * non-negotiable.
 */

import {
  createDefaultGallerySelection,
  type GallerySelection,
} from '@/types/import';

export type ImportSelectionStoreOptions = {
  /**
   * Every post id the user could potentially select from. Required at
   * construction so {@link ImportSelectionStore.selectAll} and
   * {@link ImportSelectionStore.invert} have a well-defined universe.
   *
   * Pass an empty Set for an empty package — the store still works.
   */
  availablePostIds: Set<string>;
  /**
   * Subset of `availablePostIds` that are server-confirmed duplicates.
   * Duplicates are never selectable. Toggles on a duplicate are no-ops.
   */
  duplicatePostIds?: Set<string>;
  /**
   * Maps each postId to its collection id. Required only if the consumer
   * intends to call {@link ImportSelectionStore.selectAllInCollection}.
   * Posts missing from this map are simply skipped by that operation.
   */
  collectionByPostId?: Map<string, string>;
  /**
   * Maps each postId to a stable author key (e.g. `username` / `handle` /
   * `name` — caller decides). Required only if the consumer intends to call
   * {@link ImportSelectionStore.selectAllByAuthor}. Posts missing from this
   * map are simply skipped by that operation.
   */
  authorByPostId?: Map<string, string>;
  /**
   * Optional initial state — typically a previously persisted
   * {@link GallerySelection} from {@link ImportSelectionStore.getState}.
   * Stale ids (postIds no longer in `availablePostIds`) are filtered out.
   * Defaults to {@link createDefaultGallerySelection} (everything selected).
   */
  initialState?: GallerySelection;
};

/**
 * Dual-mode persisted selection store.
 *
 * Mutating methods always run the mode-flip heuristic AFTER applying the
 * change. {@link ImportSelectionStore.onChange} subscribers fire only when
 * the externally observable selection actually changed (no-op toggles do
 * not fire).
 */
export class ImportSelectionStore {
  private state: GallerySelection;
  private universe: Set<string>;
  private duplicates: Set<string>;
  private collectionByPostId: Map<string, string>;
  private authorByPostId: Map<string, string>;
  private listeners = new Set<() => void>();

  constructor(opts: ImportSelectionStoreOptions) {
    this.universe = new Set(opts.availablePostIds);
    this.duplicates = new Set(opts.duplicatePostIds ?? []);
    this.collectionByPostId = new Map(opts.collectionByPostId ?? []);
    this.authorByPostId = new Map(opts.authorByPostId ?? []);

    const initial = opts.initialState ?? createDefaultGallerySelection();
    // Defensive copy + drop ids that are not in the current universe (or
    // are duplicates — duplicates must never appear in `ids` under either
    // mode, regardless of what callers persisted).
    this.state = {
      mode: initial.mode,
      ids: new Set(
        Array.from(initial.ids).filter(
          (id) => this.universe.has(id) && !this.duplicates.has(id),
        ),
      ),
    };
    // Normalize encoding even on construction so a hand-crafted
    // `initialState` with the wrong mode is still optimal.
    this.maybeFlipMode();
  }

  // ------------------------------------------------------------------ reads

  /**
   * True iff `postId` is currently selected. Duplicates always return
   * false. Posts outside the universe always return false.
   */
  isSelected(postId: string): boolean {
    if (!this.universe.has(postId)) return false;
    if (this.duplicates.has(postId)) return false;
    return this.state.mode === 'all-except'
      ? !this.state.ids.has(postId)
      : this.state.ids.has(postId);
  }

  /**
   * Materialized selected set — duplicates and stale ids are filtered out.
   * Call only at import-start (or for selection-summary UI) — O(n) over
   * the universe.
   */
  getSelectedIds(): Set<string> {
    const out = new Set<string>();
    if (this.state.mode === 'all-except') {
      for (const id of this.universe) {
        if (this.duplicates.has(id)) continue;
        if (!this.state.ids.has(id)) out.add(id);
      }
    } else {
      for (const id of this.state.ids) {
        if (!this.universe.has(id)) continue;
        if (this.duplicates.has(id)) continue;
        out.add(id);
      }
    }
    return out;
  }

  /**
   * Snapshot of the current persisted form. Suitable for storing in
   * {@link ImportJobState.gallerySelection}. The returned `ids` Set is a
   * defensive copy — mutating it has no effect on the store.
   */
  getState(): GallerySelection {
    return { mode: this.state.mode, ids: new Set(this.state.ids) };
  }

  /**
   * Number of currently selected posts (excluding duplicates). O(1) when
   * mode is 'all-except' and no duplicates exist; otherwise O(universe).
   */
  getSelectedCount(): number {
    return this.computeSelectedCount();
  }

  // ------------------------------------------------------------ subscription

  /**
   * Register a change subscriber. Fires AFTER any mutation that actually
   * changed the externally observable selection (true no-ops do not fire,
   * e.g. toggling a duplicate, selectAll() when already all-selected).
   *
   * Returns an unsubscribe handle.
   */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // -------------------------------------------------------------- mutations

  /**
   * Flip selection of `postId`. No-op (returns false) if `postId` is a
   * duplicate or outside the universe.
   *
   * @returns the new selected state of the post, or `false` for a no-op.
   */
  toggle(postId: string): boolean {
    if (!this.universe.has(postId)) return false;
    if (this.duplicates.has(postId)) {
      // Selection of duplicates is structurally impossible. Silently
      // ignore to keep callers simple (toolbar, click handler).
      return false;
    }
    const wasSelected = this.isSelected(postId);
    if (this.state.mode === 'all-except') {
      if (wasSelected) {
        // Selected → deselect: add to deselect set.
        this.state.ids.add(postId);
      } else {
        // Deselected → select: remove from deselect set.
        this.state.ids.delete(postId);
      }
    } else {
      if (wasSelected) {
        this.state.ids.delete(postId);
      } else {
        this.state.ids.add(postId);
      }
    }
    this.maybeFlipMode();
    this.notify();
    return !wasSelected;
  }

  /**
   * Select every non-duplicate post in the universe. Optimal encoding is
   * always `mode: 'all-except'` with empty `ids`.
   *
   * @param opts - When `visibleIds` is provided, scope the operation to the
   *   visible subset (only those posts become selected). Off-visible posts
   *   are NOT touched — their selected/deselected state in `state.ids` is
   *   preserved. This implements PRD §5.4 "Selection survives filter
   *   narrowing": a filter-then-bulk-then-unfilter sequence keeps off-screen
   *   selection intact.
   */
  selectAll(opts?: { visibleIds: Set<string> }): void {
    if (opts?.visibleIds) {
      this.applyToVisible(opts.visibleIds, /* select */ true);
      return;
    }
    const wasAllSelected =
      this.state.mode === 'all-except' && this.state.ids.size === 0;
    this.state = { mode: 'all-except', ids: new Set() };
    if (!wasAllSelected) this.notify();
  }

  /**
   * Deselect everything. Optimal encoding is `mode: 'only'` with empty
   * `ids` (size 0 vs `universe - duplicates` ids for `'all-except'`).
   *
   * @param opts - When `visibleIds` is provided, scope the operation to the
   *   visible subset (only those posts become deselected). Off-visible posts
   *   are NOT touched. PRD §5.4 — selection in other filter views survives.
   */
  clear(opts?: { visibleIds: Set<string> }): void {
    if (opts?.visibleIds) {
      this.applyToVisible(opts.visibleIds, /* select */ false);
      return;
    }
    const wasEmpty = this.computeSelectedCount() === 0;
    this.state = { mode: 'only', ids: new Set() };
    if (!wasEmpty) this.notify();
  }

  /**
   * Invert selection over `(universe \ duplicates)`. Duplicates remain
   * unselected. The mode itself flips (`'all-except'` ↔ `'only'`) and the
   * ids set is reused as-is — no per-id iteration required.
   *
   * @param opts - When `visibleIds` is provided, only the visible (and
   *   non-duplicate) posts have their selection state flipped. Off-visible
   *   posts are NOT touched. PRD §5.4 — selection in other filter views
   *   survives.
   */
  invert(opts?: { visibleIds: Set<string> }): void {
    if (opts?.visibleIds) {
      this.invertVisible(opts.visibleIds);
      return;
    }
    // The dual-mode encoding has a beautiful property: swapping the mode
    // bit while keeping the same `ids` set IS the inverse selection over
    // (universe \ duplicates). Proof:
    //   all-except + ids={X}  ⇒ selected = U \ D \ {X}
    //   only       + ids={X}  ⇒ selected = U \ D ∩ {X} = {X} \ D
    // Inversion of (U \ D \ {X}) over (U \ D) is exactly {X} \ D.
    // (`ids` is already filtered so it never contains duplicates.)
    const nonDup = this.universe.size - this.intersectionSize(this.universe, this.duplicates);
    if (nonDup === 0) {
      // Nothing to invert. No-op.
      return;
    }
    this.state = {
      mode: this.state.mode === 'all-except' ? 'only' : 'all-except',
      ids: new Set(this.state.ids),
    };
    this.maybeFlipMode();
    this.notify();
  }

  // -------------------------------------------------- visible-scoped helpers

  /**
   * Set the selected state for every visible post to `select`, leaving
   * off-visible posts untouched. Duplicates and posts outside the universe
   * are skipped. After the in-place mutation the mode-flip heuristic runs
   * so the encoding stays optimal.
   *
   * Per PRD §5.4 this MUST NOT mutate the universe — off-visible state.ids
   * entries survive across filter changes.
   */
  private applyToVisible(visibleIds: Set<string>, select: boolean): void {
    let changed = false;
    for (const postId of visibleIds) {
      if (!this.universe.has(postId)) continue;
      if (this.duplicates.has(postId)) continue;
      const wasSelected = this.isSelected(postId);
      if (wasSelected === select) continue;
      if (this.state.mode === 'all-except') {
        // selected ⇔ NOT in ids
        if (select) this.state.ids.delete(postId);
        else this.state.ids.add(postId);
      } else {
        // selected ⇔ in ids
        if (select) this.state.ids.add(postId);
        else this.state.ids.delete(postId);
      }
      changed = true;
    }
    if (!changed) return;
    this.maybeFlipMode();
    this.notify();
  }

  /**
   * Flip selection of every visible non-duplicate post in place. Off-visible
   * posts are untouched. We cannot use the mode-swap shortcut from
   * {@link invert} because that inverts over the entire universe, not a
   * subset.
   */
  private invertVisible(visibleIds: Set<string>): void {
    let changed = false;
    for (const postId of visibleIds) {
      if (!this.universe.has(postId)) continue;
      if (this.duplicates.has(postId)) continue;
      const wasSelected = this.isSelected(postId);
      if (this.state.mode === 'all-except') {
        if (wasSelected) this.state.ids.add(postId);
        else this.state.ids.delete(postId);
      } else {
        if (wasSelected) this.state.ids.delete(postId);
        else this.state.ids.add(postId);
      }
      changed = true;
    }
    if (!changed) return;
    this.maybeFlipMode();
    this.notify();
  }

  /**
   * Select every non-duplicate post belonging to `collectionId`. Other
   * posts are unchanged. Re-running on a fully selected collection is a
   * silent no-op.
   *
   * If `collectionByPostId` was not supplied (or has no entry for a given
   * post), that post is skipped.
   */
  selectAllInCollection(collectionId: string): void {
    let changed = false;
    for (const [postId, cid] of this.collectionByPostId) {
      if (cid !== collectionId) continue;
      if (!this.universe.has(postId)) continue;
      if (this.duplicates.has(postId)) continue;
      if (this.isSelected(postId)) continue;
      // Make this post selected under the current encoding.
      if (this.state.mode === 'all-except') {
        this.state.ids.delete(postId);
      } else {
        this.state.ids.add(postId);
      }
      changed = true;
    }
    if (!changed) return;
    this.maybeFlipMode();
    this.notify();
  }

  /**
   * Select every non-duplicate post belonging to the given author key.
   * Posts without a known author key (i.e. not present in
   * `authorByPostId`) are skipped. Re-running on an already fully-selected
   * author is a silent no-op.
   *
   * Mirrors {@link selectAllInCollection} — purely additive: it never
   * deselects existing selections from other authors. PRD §5.3 (collection
   * filter pattern) extended symmetrically to author scope.
   */
  selectAllByAuthor(authorKey: string): void {
    let changed = false;
    for (const [postId, key] of this.authorByPostId) {
      if (key !== authorKey) continue;
      if (!this.universe.has(postId)) continue;
      if (this.duplicates.has(postId)) continue;
      if (this.isSelected(postId)) continue;
      // Make this post selected under the current encoding.
      if (this.state.mode === 'all-except') {
        this.state.ids.delete(postId);
      } else {
        this.state.ids.add(postId);
      }
      changed = true;
    }
    if (!changed) return;
    this.maybeFlipMode();
    this.notify();
  }

  /**
   * Deselect every post belonging to the given author key — the toggle
   * counterpart of {@link selectAllByAuthor}. The gallery section header
   * uses these two together: the per-author button label flips between
   * "Select all" and "Deselect all" based on the current selected count
   * for that author, and routes to whichever method matches the action.
   *
   * Mirrors the additive semantics of {@link selectAllByAuthor} — only
   * the matching author's posts are touched; other authors' selections
   * are preserved.
   */
  deselectAllByAuthor(authorKey: string): void {
    let changed = false;
    for (const [postId, key] of this.authorByPostId) {
      if (key !== authorKey) continue;
      if (!this.universe.has(postId)) continue;
      if (this.duplicates.has(postId)) continue;
      if (!this.isSelected(postId)) continue;
      // Make this post deselected under the current encoding.
      if (this.state.mode === 'all-except') {
        this.state.ids.add(postId);
      } else {
        this.state.ids.delete(postId);
      }
      changed = true;
    }
    if (!changed) return;
    this.maybeFlipMode();
    this.notify();
  }

  // ---------------------------------------------------------- universe edit

  /**
   * Replace the universe and/or duplicate set (e.g. when a UI filter
   * removes posts from the visible set, or a fresh preflight returns a
   * different duplicate set). Stale ids are dropped from the persisted
   * `ids` set.
   *
   * NOTE for UI consumers: this only changes what the store CONSIDERS
   * selectable. Toolbar operations like {@link selectAll} act on the full
   * universe — if a filter narrows the visible set and you want
   * "select all visible", call {@link updateUniverse} with the visible
   * set as the new universe BEFORE calling {@link selectAll}.
   */
  updateUniverse(
    availablePostIds: Set<string>,
    duplicatePostIds?: Set<string>,
    collectionByPostId?: Map<string, string>,
    authorByPostId?: Map<string, string>,
  ): void {
    this.universe = new Set(availablePostIds);
    this.duplicates = new Set(duplicatePostIds ?? []);
    if (collectionByPostId) {
      this.collectionByPostId = new Map(collectionByPostId);
    }
    if (authorByPostId) {
      this.authorByPostId = new Map(authorByPostId);
    }
    // Drop any persisted ids that are no longer valid (not in universe,
    // or are now duplicates).
    const filtered = new Set<string>();
    for (const id of this.state.ids) {
      if (this.universe.has(id) && !this.duplicates.has(id)) filtered.add(id);
    }
    const sizeChanged = filtered.size !== this.state.ids.size;
    this.state.ids = filtered;
    this.maybeFlipMode();
    if (sizeChanged) this.notify();
  }

  // ------------------------------------------------------------- internals

  /**
   * Mode-flip rule (precise):
   *
   *   Let N = |universe \ duplicates|         (count of selectable posts)
   *   Let S = current selected count          (N - ids when 'all-except';
   *                                            ids ∩ (universe \ dup) when 'only')
   *
   *   allExceptSize := N - S    (size of `ids` if encoded as 'all-except')
   *   onlySize      := S        (size of `ids` if encoded as 'only')
   *
   *   Flip to 'only' when      onlySize < allExceptSize
   *   Flip to 'all-except' when allExceptSize < onlySize
   *   Tie (both equal)         keep current mode (avoid thrashing at 50/50)
   *
   * The flip itself is materializing: switching from one encoding to the
   * other requires rebuilding the `ids` set against the universe.
   */
  private maybeFlipMode(): void {
    const nonDupCount = this.computeNonDupUniverseSize();
    const selected = this.computeSelectedCount();
    const allExceptSize = nonDupCount - selected;
    const onlySize = selected;

    if (this.state.mode === 'all-except' && onlySize < allExceptSize) {
      // Convert: ids must become the explicit selected set.
      const next = new Set<string>();
      for (const id of this.universe) {
        if (this.duplicates.has(id)) continue;
        if (!this.state.ids.has(id)) next.add(id);
      }
      this.state = { mode: 'only', ids: next };
    } else if (this.state.mode === 'only' && allExceptSize < onlySize) {
      // Convert: ids must become the explicit deselected set.
      const next = new Set<string>();
      for (const id of this.universe) {
        if (this.duplicates.has(id)) continue;
        if (!this.state.ids.has(id)) next.add(id);
      }
      this.state = { mode: 'all-except', ids: next };
    }
  }

  private computeSelectedCount(): number {
    if (this.state.mode === 'all-except') {
      // Selected = (universe \ duplicates) \ ids.
      // Note: `ids` may not be a strict subset of (universe \ duplicates)
      // immediately after construction with a stale initialState — but
      // the constructor + updateUniverse already filter those out, so
      // here we can subtract directly.
      return this.computeNonDupUniverseSize() - this.state.ids.size;
    }
    // mode === 'only': selected = ids ∩ (universe \ duplicates).
    let count = 0;
    for (const id of this.state.ids) {
      if (this.universe.has(id) && !this.duplicates.has(id)) count++;
    }
    return count;
  }

  private computeNonDupUniverseSize(): number {
    return this.universe.size - this.intersectionSize(this.universe, this.duplicates);
  }

  private intersectionSize(a: Set<string>, b: Set<string>): number {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let count = 0;
    for (const id of small) if (large.has(id)) count++;
    return count;
  }

  private notify(): void {
    // Snapshot listeners so an unsubscribe inside a callback does not
    // skip the next listener.
    for (const cb of Array.from(this.listeners)) {
      try {
        cb();
      } catch {
        // Subscriber errors must not break sibling subscribers or the
        // mutation that caused the notification. Swallow.
      }
    }
  }
}
