<script lang="ts">
  /**
   * ImportGallery — root review-pane component for the Instagram Import
   * Review Gallery (PRD prd-instagram-import-gallery.md §5.3, §9.5).
   *
   * Single-responsibility: own the per-job `ImportSelectionStore` lifetime
   * + lay out the four review-pane regions (header, context, toolbar, body,
   * footer). Bulk actions, persistence, and media URL extraction are
   * delegated to dedicated components / services.
   *
   * --------------------------------------------------------------------------
   * Author-grouped layout (design-overhaul revision)
   * --------------------------------------------------------------------------
   * The flat grid + author dropdown filter has been replaced with a sectioned
   * layout — each distinct author becomes a labelled section followed by their
   * posts. We derive `groupedVisiblePosts` from the visible-posts slice (still
   * filtered by collection) and hand the buckets to the container. The
   * container renders the section headers and the per-author "Select all by
   * this author" button, which calls back into our `handleSelectAllByAuthor`
   * → `selectionStore.selectAllByAuthor(...)`.
   *
   * Reactivity bridge
   * -----------------
   * `ImportSelectionStore` is plain TypeScript (see its source for rationale).
   * We translate its `onChange` signal into a Svelte 5 rune by bumping a
   * `bumpVersion: number` cell on every change. Derived expressions that
   * read selection state must touch `bumpVersion` so the compiler knows to
   * re-evaluate them. The pattern is:
   *
   *   const selectedCount = $derived.by(() => {
   *     void bumpVersion;
   *     return selectionStore.getSelectedCount();
   *   });
   *
   * Lifecycle
   * ---------
   * - `onMount`: subscribe to `selectionStore.onChange`.
   * - `onDestroy`: unsubscribe AND call
   *   `mediaPreviewService.clearForJob('preview')` to revoke every blob URL
   *   the gallery acquired. Sentinel jobId per Layer-1 contract.
   *
   * Bulk-action scope
   * -----------------
   * Per PRD F2.3 + §5.4: `selectionStore.selectAll()`, `clear()`, `invert()`
   * operate on the FULL universe by default. When a collection filter
   * narrows the visible set, we pass `{ visibleIds }` to scope the operation
   * to the visible subset WITHOUT mutating the universe. Off-screen
   * selection is preserved across filter changes — switching back to "All
   * collections" still shows the user's prior off-screen choices intact.
   *
   * (Earlier revisions wrapped these calls in a `withVisibleUniverse` helper
   * that called `updateUniverse(visibleIds)` then `updateUniverse(fullIds)`.
   * That pattern silently dropped off-screen ids from `state.ids` — the very
   * bug PRD §5.4 forbids — because `updateUniverse` filters out any id not
   * in the new universe. Removed.)
   *
   * Testing surface (manual):
   *   - Open gallery → header reads `Review imports — N of M selected`.
   *   - Click "Clear" with no filter → all checkboxes unchecked, footer
   *     button disabled.
   *   - Apply a collection filter, click "Select all" → only visible cards
   *     become selected; switch back to "All collections" → previously
   *     deselected cards in OTHER collections remain deselected.
   *   - Click any section's "Select all by this author" → every post by that
   *     author becomes selected (additive — does NOT clear others).
   *   - Click footer "Import N selected" → onImportSelected(selection) fires
   *     with the dual-mode `GallerySelection` payload.
   *   - Close modal → mediaPreviewService.getStats().size returns to 0
   *     (every URL revoked).
   */

  import { onMount, onDestroy } from 'svelte';
  import type {
    GallerySelection,
    ImportDestination,
    ImportPostPreview,
    ImportPreflightResult,
    StartImportFile,
  } from '@/types/import';
  import {
    ImportSelectionStore,
    type MediaPreviewService,
  } from '@/services/import-gallery';
  import ImportGalleryToolbar from './ImportGalleryToolbar.svelte';
  import ImportGalleryContainer, { type AuthorGroup } from './ImportGalleryContainer.svelte';

  type Props = {
    /** Result of `orchestrator.loadGallery(...)` — has `parts[].posts` populated. */
    preflight: ImportPreflightResult;
    /** Live source ZIPs — kept alive by the parent for the gallery lifetime. */
    files: StartImportFile[];
    /** Display-only context — surfaced in the header strip. */
    destination: ImportDestination;
    /** Display-only context — already normalized list of YAML tags. */
    tagsPreview: string[];
    /**
     * Optional — when undefined, media renders as placeholders. Required for
     * production but tests may omit. Owned by the orchestrator.
     */
    mediaPreviewService: MediaPreviewService | undefined;
    /** Back to preflight — selection MUST be preserved by the caller. */
    onBack: () => void;
    /** Forward to import — caller spawns startImport with this selection. */
    onImportSelected: (selection: GallerySelection) => void;
    /** Close modal entirely. */
    onCancel: () => void;
  };

  let {
    preflight,
    files,
    destination,
    tagsPreview,
    mediaPreviewService,
    onBack,
    onImportSelected,
    onCancel,
  }: Props = $props();

  // ---------------------------------------------------------------------------
  // Sentinel jobId — pre-import gallery has no job yet. The Layer-1
  // contract directs us to use the literal `'preview'` so multiple gallery
  // sessions in the same plugin lifetime can share the cache key namespace
  // and we can bulk-revoke on unmount.
  // ---------------------------------------------------------------------------
  const PREVIEW_JOB_ID = 'preview' as const;

  // ---------------------------------------------------------------------------
  // Flatten preflight → preview structures
  //
  // `preflight.parts[].posts` is populated when the orchestrator calls
  // `loadGallery()` (vs plain `preflight()`). Defensive: if parts arrived
  // without `posts`, treat them as empty.
  // ---------------------------------------------------------------------------

  const allPosts = $derived(
    preflight.parts.flatMap((p) => p.posts ?? []) as ImportPostPreview[],
  );

  const duplicateIds = $derived(
    new Set<string>(allPosts.filter((p) => p.isDuplicate).map((p) => p.postId)),
  );

  const collectionByPostId = $derived(
    new Map<string, string>(allPosts.map((p) => [p.postId, p.collectionId])),
  );

  /**
   * Stable author key per post. Prefer `username` (handle without @) → fall
   * back to `handle` → fall back to `name`. The display name can change or
   * include emojis; the handle/username is the most reliable identity.
   * Posts without any author identity are omitted from the map (and thus
   * skipped by the per-author bulk action and by the section grouping below).
   */
  const authorByPostId = $derived(
    new Map<string, string>(
      allPosts
        .map((p): [string, string] => [
          p.postId,
          p.postData.author?.username
            || p.postData.author?.handle
            || p.postData.author?.name
            || '',
        ])
        .filter(([, key]) => key !== ''),
    ),
  );

  /** Unique collections for the toolbar filter dropdown. */
  const collections = $derived.by(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const part of preflight.parts) {
      const c = part.collection;
      if (!c) continue;
      if (!seen.has(c.id)) seen.set(c.id, { id: c.id, name: c.name });
    }
    return Array.from(seen.values());
  });

  /** Active collection filter — null means "show all collections". */
  let collectionFilter = $state<string | null>(null);

  /**
   * Free-text search query (case-insensitive). Empty string disables the
   * filter. Matched against:
   *   - caption text (postData.content.text)
   *   - author display name + handle + username
   *   - shortcode (the on-card identifier)
   *   - collection name (so users can search "summer-trip" without flipping
   *     the collection dropdown)
   *
   * Hashtag/mention tokens already live inside `content.text`, so the
   * caption substring match catches them naturally — no extra parsing
   * needed. PRD §5.4: search narrows the visible universe but never mutates
   * `state.ids`, so off-screen selection is preserved on query changes
   * (same contract as the collection filter).
   */
  let searchQuery = $state('');

  /** Map collectionId → name for the search filter. */
  const collectionNameById = $derived.by(() => {
    const map = new Map<string, string>();
    for (const part of preflight.parts) {
      const c = part.collection;
      if (c && !map.has(c.id)) map.set(c.id, c.name);
    }
    return map;
  });

  function matchesSearch(p: ImportPostPreview, q: string): boolean {
    if (q === '') return true;
    const needle = q.toLowerCase();
    const text = p.postData.content?.text ?? '';
    if (text.toLowerCase().includes(needle)) return true;
    const author = p.postData.author;
    if (author) {
      if (author.name && author.name.toLowerCase().includes(needle)) return true;
      if (author.handle && author.handle.toLowerCase().includes(needle)) return true;
      if (author.username && author.username.toLowerCase().includes(needle)) return true;
    }
    if (p.shortcode && p.shortcode.toLowerCase().includes(needle)) return true;
    const collectionName = collectionNameById.get(p.collectionId);
    if (collectionName && collectionName.toLowerCase().includes(needle)) return true;
    return false;
  }

  const visiblePosts = $derived(
    allPosts.filter(
      (p) =>
        (collectionFilter === null || p.collectionId === collectionFilter) &&
        matchesSearch(p, searchQuery.trim()),
    ),
  );

  /**
   * Bucket the visible posts by author identity for the section layout. Sort
   * sections alphabetically by display name; preserve original post order
   * inside each section.
   *
   * Posts without any author identity are dropped from the section grid (they
   * would render under a blank header and be impossible to bulk-select). In
   * practice every Instagram post has at least an owner username; this guard
   * only matters for malformed fixtures.
   */
  const groupedVisiblePosts = $derived.by((): AuthorGroup[] => {
    const map = new Map<string, AuthorGroup>();
    for (const post of visiblePosts) {
      const key = post.postData.author?.username
        || post.postData.author?.handle
        || post.postData.author?.name
        || '';
      if (!key) continue;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          name: post.postData.author?.name || key,
          handle: post.postData.author?.handle || post.postData.author?.username,
          posts: [],
        };
        map.set(key, group);
      }
      group.posts.push(post);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  });

  const totalReady = $derived(allPosts.filter((p) => !p.isDuplicate).length);
  const totalDuplicates = $derived(allPosts.filter((p) => p.isDuplicate).length);

  // ---------------------------------------------------------------------------
  // Selection store — instantiated once per `allPosts` identity. We DO NOT
  // pass `bumpVersion` into the store; the store is plain TS and notifies
  // via `onChange`.
  // ---------------------------------------------------------------------------

  const selectionStore = new ImportSelectionStore({
    availablePostIds: new Set(allPosts.map((p) => p.postId)),
    duplicatePostIds: duplicateIds,
    collectionByPostId,
    authorByPostId,
    // Default state = every ready post selected (PRD §5.4 opt-out).
    // The orchestrator may later seed an `initialState` from a persisted
    // job; for v1 of this layer we always start fresh.
  });

  /**
   * Reactivity bridge — bumped on every `selectionStore.onChange`. Read
   * inside derived expressions to subscribe.
   */
  let bumpVersion = $state(0);

  // CRITICAL: wire the onChange listener at script-body time, NOT in
  // onMount. The selectionStore can be mutated during component setup
  // (e.g. by the $effect below calling updateUniverse), and any notifies
  // fired before onMount runs would be lost — leaving `bumpVersion` stale
  // while the store has the correct state. Wiring at script body ensures
  // every notify reaches the derived expressions that depend on bumpVersion.
  const _selectionUnsubscribe = selectionStore.onChange(() => {
    bumpVersion++;
  });

  // ---------------------------------------------------------------------------
  // Reactive recomputation when `allPosts` identity changes
  //
  // The store was built once with the initial `allPosts`. If the parent
  // somehow swaps `preflight` mid-flight (e.g. user re-runs preflight in
  // some future flow), we update the store's universe so it stays in sync.
  // ---------------------------------------------------------------------------

  $effect(() => {
    // Touch reactive dependencies.
    const ids = new Set(allPosts.map((p) => p.postId));
    selectionStore.updateUniverse(ids, duplicateIds, collectionByPostId, authorByPostId);
    // updateUniverse may have notified — that already bumps bumpVersion via
    // the onChange listener.
  });

  // ---------------------------------------------------------------------------
  // Subscriber wiring + cleanup
  // ---------------------------------------------------------------------------

  // Unsubscribe handle from the script-body onChange wiring above. Cleared
  // in onDestroy to avoid leaking a closure over the dead store.
  let unsubscribe: (() => void) | null = _selectionUnsubscribe;

  // ---------------------------------------------------------------------------
  // Esc key — return to preflight without losing selection (PRD §5.3 + §5.6).
  //
  // Obsidian's default modal handler closes the entire modal on Esc, which
  // would drop all gallery state. We attach a document-level keydown listener
  // (capture phase) that intercepts Esc whenever focus is anywhere within the
  // gallery's root and routes to `onBack()` instead. `stopImmediatePropagation`
  // ensures Obsidian's own listener never sees the event.
  // ---------------------------------------------------------------------------
  let galleryRootEl: HTMLDivElement | undefined = $state();

  function handleEscapeKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    const root = galleryRootEl;
    if (!root) return;
    // Intercept whenever focus is inside the gallery (any card body, the
    // sidebar, footer button, or the root itself). When focus is on the
    // document body we treat that as "inside" too, since the gallery owns
    // the modal contents.
    const active = document.activeElement;
    const focusInside =
      active === document.body ||
      active === null ||
      (active instanceof Node && root.contains(active));
    if (!focusInside) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    onBack();
  }

  onMount(() => {
    // The selectionStore.onChange listener is wired at script-body time
    // (see _selectionUnsubscribe declaration above). Here we only attach
    // the document-level keydown listener for Esc handling.
    // Capture phase so we run before Obsidian's modal handler.
    document.addEventListener('keydown', handleEscapeKey, true);
    // Force a bumpVersion kick so any $derived that read bumpVersion
    // before mutations during component setup recomputes against the
    // current store state.
    bumpVersion++;
  });

  onDestroy(() => {
    document.removeEventListener('keydown', handleEscapeKey, true);
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    // Per Layer-1 MediaPreviewService contract: clearForJob('preview') on
    // unmount revokes every blob URL acquired during the gallery session.
    try {
      mediaPreviewService?.clearForJob(PREVIEW_JOB_ID);
    } catch (err) {
      // Defensive — never let cleanup break unmount.
      console.error('[ImportGallery] clearForJob failed', err);
    }
  });

  // ---------------------------------------------------------------------------
  // Bulk action helpers
  //
  // When a collection filter is active, scope the bulk action to the visible
  // subset by passing `{ visibleIds }`. The store mutates only those entries
  // in `state.ids` and leaves off-visible posts alone — preserving PRD §5.4
  // "Selection survives filter narrowing".
  //
  // When no filter is active, omit the option so the operation applies to
  // the full universe (and the store can use its optimal encoding shortcut
  // for selectAll/clear).
  // ---------------------------------------------------------------------------

  function visibleScope(): { visibleIds: Set<string> } | undefined {
    // The author filter dropdown was retired in favour of the per-section
    // "Select all by this author" button. Visible scope now narrows when
    // EITHER the collection filter OR the search query is active. PRD
    // §5.4 — off-screen selection is preserved across filter changes
    // (same applies to search).
    const hasFilter = collectionFilter !== null || searchQuery.trim() !== '';
    if (!hasFilter) return undefined;
    return { visibleIds: new Set(visiblePosts.map((p) => p.postId)) };
  }

  function handleSelectAll(): void {
    selectionStore.selectAll(visibleScope());
  }

  function handleClear(): void {
    selectionStore.clear(visibleScope());
  }

  function handleInvert(): void {
    selectionStore.invert(visibleScope());
  }

  function handleSelectAllInCollection(collectionId: string): void {
    // selectAllInCollection iterates the store's collectionByPostId so it
    // naturally restricts to that collection regardless of any visible
    // filter — no extra scoping needed here.
    selectionStore.selectAllInCollection(collectionId);
  }

  function handleSelectAllByAuthor(authorKey: string): void {
    // Mirrors handleSelectAllInCollection: the store iterates its own
    // authorByPostId map so the bulk addition is by author identity, not
    // by current visible scope. Additive — never deselects other authors.
    // Wired from each section header's "Select all" toggle button when
    // not all of the author's posts are currently selected.
    selectionStore.selectAllByAuthor(authorKey);
  }

  function handleDeselectAllByAuthor(authorKey: string): void {
    // The toggle counterpart of handleSelectAllByAuthor — fires when the
    // user clicks the section's "Deselect all" button (label flips when
    // every post by that author is already selected). Subtracts only the
    // matching author's posts from the selection; other authors' selections
    // remain untouched.
    selectionStore.deselectAllByAuthor(authorKey);
  }

  function handleCollectionChange(id: string | null): void {
    collectionFilter = id;
  }

  function handleSearchChange(q: string): void {
    searchQuery = q;
  }

  // ---------------------------------------------------------------------------
  // Header / footer derived state
  // ---------------------------------------------------------------------------

  const selectedCount = $derived.by(() => {
    void bumpVersion;
    return selectionStore.getSelectedCount();
  });

  const importEnabled = $derived(selectedCount > 0);

  const destinationLabel = $derived(destination === 'archive' ? 'Archive' : 'Inbox');

  const tagsLabel = $derived(
    tagsPreview.length === 0 ? '—' : tagsPreview.map((t) => `#${t}`).join(' '),
  );

  function handleImportClick(): void {
    if (!importEnabled) return;
    const selection = selectionStore.getState();
    onImportSelected(selection);
  }
</script>

<div class="sa-ig-gallery" bind:this={galleryRootEl}>
  <header class="sa-ig-gallery__header">
    <div class="sa-ig-gallery__title">
      Review imports — <strong>{selectedCount}</strong> of <strong>{totalReady}</strong> selected
    </div>
    {#if totalDuplicates > 0}
      <div class="sa-ig-gallery__subtitle">
        {totalDuplicates} already in your archive will be skipped
      </div>
    {/if}
  </header>

  <div class="sa-ig-gallery__context" aria-label="Import context">
    <div class="sa-ig-gallery__context-text">
      <span><strong>Importing to:</strong> {destinationLabel}</span>
      <span aria-hidden="true">·</span>
      <span><strong>Tags:</strong> {tagsLabel}</span>
    </div>
    <button
      type="button"
      class="sa-ig-gallery__edit-link"
      onclick={onBack}
      aria-label="Edit destination and tags (return to preflight)"
    >Edit</button>
  </div>

  <ImportGalleryToolbar
    selectedCount={selectedCount}
    totalReady={totalReady}
    duplicateCount={totalDuplicates}
    collections={collections}
    selectedCollectionId={collectionFilter}
    searchQuery={searchQuery}
    onSelectAll={handleSelectAll}
    onClear={handleClear}
    onInvert={handleInvert}
    onCollectionChange={handleCollectionChange}
    onSelectAllInCollection={handleSelectAllInCollection}
    onSearchChange={handleSearchChange}
  />

  <div class="sa-ig-gallery__body">
    <ImportGalleryContainer
      groups={groupedVisiblePosts}
      bumpVersion={bumpVersion}
      selectionStore={selectionStore}
      files={files}
      mediaPreviewService={mediaPreviewService}
      onSelectAllByAuthor={handleSelectAllByAuthor}
      onDeselectAllByAuthor={handleDeselectAllByAuthor}
    />
  </div>

  <footer class="sa-ig-gallery__footer">
    <div class="sa-ig-gallery__footer-left">
      <button
        type="button"
        class="sa-ig-gallery__btn sa-ig-gallery__btn--ghost"
        onclick={onCancel}
      >Cancel</button>
      <button
        type="button"
        class="sa-ig-gallery__btn sa-ig-gallery__btn--ghost"
        onclick={onBack}
      >Back to preflight</button>
    </div>
    <button
      type="button"
      class="sa-ig-gallery__btn sa-ig-gallery__btn--cta"
      disabled={!importEnabled}
      onclick={handleImportClick}
    >Import {selectedCount} selected</button>
  </footer>
</div>

<style>
  .sa-ig-gallery {
    /* Gallery anchors its own scroll bound to the viewport instead of
       relying on parent's `height: 100%` — that resolution path requires
       the parent modal-content to have an explicit height, which we
       deliberately do NOT enforce (preflight needs to size to its small
       content). The gallery view is the only state that needs viewport
       height; this max-height ensures the inner `.sa-ig-gallery__body`
       (the actual scroll container) has a bounded box to scroll within. */
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    min-height: 0;
    max-height: calc(90vh - 120px);
  }

  /* When the modal is maximized the gallery should fill the viewport. */
  :global(.sa-ig-import-modal--maximized) .sa-ig-gallery {
    max-height: calc(100dvh - 120px);
  }

  .sa-ig-gallery__header {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .sa-ig-gallery__title {
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-normal, #222);
  }

  .sa-ig-gallery__title strong {
    /* Use --text-normal so the counts read as plain emphasis, not as a
       coral/pink accent. The previous styling pulled focus away from the
       footer CTA. */
    color: var(--text-normal, #222);
    font-weight: var(--font-semibold, 600);
  }

  .sa-ig-gallery__subtitle {
    font-size: 0.825rem;
    color: var(--text-muted, #777);
  }

  .sa-ig-gallery__context {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--background-secondary, transparent);
    /* Quiet container — drop the hard 1px border that made it look like a
       stamped-out chip. */
    border: none;
    border-radius: var(--radius-s, 4px);
    font-size: 0.825rem;
  }

  .sa-ig-gallery__context-text {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    color: var(--text-muted, #777);
  }

  .sa-ig-gallery__context-text strong {
    color: var(--text-normal, #222);
    font-weight: var(--font-semibold, 600);
  }

  /* Borderless ghost — matches the rest of the secondary actions in the
     gallery surface. Double-class spec bump for Obsidian's button defaults. */
  .sa-ig-gallery__edit-link.sa-ig-gallery__edit-link {
    appearance: none;
    min-height: 32px;
    padding: 6px 12px;
    font-size: 0.825rem;
    background: transparent;
    color: var(--interactive-accent, #3b82f6);
    border: none;
    box-shadow: none;
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
    font-weight: 500;
  }

  .sa-ig-gallery__edit-link.sa-ig-gallery__edit-link:hover {
    background: var(--background-modifier-hover, rgba(0, 0, 0, 0.06));
    border: none;
    box-shadow: none;
  }

  .sa-ig-gallery__edit-link.sa-ig-gallery__edit-link:focus-visible {
    outline: 2px solid var(--interactive-accent, #3b82f6);
    outline-offset: 2px;
    border: none;
  }

  .sa-ig-gallery__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem 0;
  }

  .sa-ig-gallery__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--background-modifier-border, #ccc);
  }

  .sa-ig-gallery__footer-left {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .sa-ig-gallery__btn {
    appearance: none;
    min-height: 44px;
    padding: 0 1rem;
    border: 1px solid var(--background-modifier-border, #ccc);
    background: var(--background-primary, transparent);
    color: var(--text-normal, #222);
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
    font-size: var(--font-ui, 0.9rem);
    font-weight: 500;
    transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
  }

  .sa-ig-gallery__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Borderless ghost variant — for Cancel / Back to preflight.
     Double-class specificity bump so we beat Obsidian's core
     `.modal button` defaults that win over a single class selector. */
  .sa-ig-gallery__btn--ghost.sa-ig-gallery__btn--ghost {
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted, #777);
  }

  .sa-ig-gallery__btn--ghost.sa-ig-gallery__btn--ghost:hover:not(:disabled) {
    background: var(--background-modifier-hover, rgba(0, 0, 0, 0.06));
    color: var(--text-normal, #222);
    border: none;
    box-shadow: none;
  }

  .sa-ig-gallery__btn--ghost.sa-ig-gallery__btn--ghost:focus-visible {
    outline: 2px solid var(--interactive-accent, #3b82f6);
    outline-offset: 2px;
    border: none;
  }

  .sa-ig-gallery__btn--cta {
    background: var(--interactive-accent, #3b82f6);
    border-color: var(--interactive-accent, #3b82f6);
    color: var(--text-on-accent, #fff);
    padding: 0 1.25rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .sa-ig-gallery__btn--cta:hover:not(:disabled) {
    background: var(--interactive-accent-hover, var(--interactive-accent, #3b82f6));
    border-color: var(--interactive-accent-hover, var(--interactive-accent, #3b82f6));
  }

  .sa-ig-gallery__btn--cta:focus-visible {
    outline: 2px solid var(--text-on-accent, #fff);
    outline-offset: -4px;
  }
</style>
