<script lang="ts">
  /**
   * ImportGalleryToolbar — sticky bulk-action bar for the Instagram Import
   * Review Gallery (PRD prd-instagram-import-gallery.md §5.3).
   *
   * Single-responsibility: render bulk actions + the optional collection
   * filter. The toolbar is purely presentational — every action it offers is
   * implemented by the parent (`ImportGallery`) which knows how to call into
   * `ImportSelectionStore` correctly (specifically: it calls
   * `selectionStore.updateUniverse(visible)` BEFORE bulk operations so they
   * apply to the visible subset, per PRD F2.3).
   *
   * --------------------------------------------------------------------------
   * Author filter retired (design-overhaul revision)
   * --------------------------------------------------------------------------
   * The author dropdown + "Select all by {author}" button were removed in
   * favour of the per-section "Select all by this author" button rendered by
   * `ImportGalleryContainer`. The container now groups visible posts by
   * author and exposes the bulk action right next to each author's row, which
   * is more discoverable than a single dropdown.
   *
   * The collection filter stays — it narrows the visible universe (and
   * therefore the rendered author sections), and it is still a useful pivot
   * when a single import contains multiple Instagram saved-collections.
   *
   * Testing surface (manual):
   *   - With 0 collections: filter dropdown is hidden, "Select all in this
   *     collection" hidden.
   *   - With 1 collection: dropdown hidden (same reasoning — there's no
   *     filtering choice to make).
   *   - With ≥2 collections: dropdown shown; selecting a non-null id reveals
   *     the per-collection select-all action.
   *   - Counts are display-only; props always render verbatim.
   */

  type Collection = { id: string; name: string };

  type Props = {
    selectedCount: number;
    totalReady: number;
    duplicateCount: number;
    /** Distinct collections present in the current package. */
    collections: Collection[];
    /** `null` means "show all collections". */
    selectedCollectionId: string | null;
    /**
     * Free-text query that the parent uses to narrow `visiblePosts` (PRD
     * §5.4 "selection survives filter narrowing" — same rules as collection
     * filter). Empty string means "no filter". The toolbar owns only the
     * input chrome; the actual matching happens in `ImportGallery`.
     */
    searchQuery: string;
    onSelectAll: () => void;
    onClear: () => void;
    onInvert: () => void;
    onCollectionChange: (id: string | null) => void;
    onSelectAllInCollection: (id: string) => void;
    onSearchChange: (q: string) => void;
  };

  let {
    selectedCount,
    totalReady,
    duplicateCount,
    collections,
    selectedCollectionId,
    searchQuery,
    onSelectAll,
    onClear,
    onInvert,
    onCollectionChange,
    onSelectAllInCollection,
    onSearchChange,
  }: Props = $props();

  const showFilter = $derived(collections.length > 1);
  const showInCollection = $derived(showFilter && selectedCollectionId !== null);

  function handleFilterChange(e: Event): void {
    const target = e.target as HTMLSelectElement;
    const next = target.value === '' ? null : target.value;
    onCollectionChange(next);
  }

  function handleSelectAllInCollection(): void {
    if (selectedCollectionId !== null) {
      onSelectAllInCollection(selectedCollectionId);
    }
  }

  function handleSearchInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    onSearchChange(target.value);
  }

  function handleSearchClear(): void {
    onSearchChange('');
  }
</script>

<div class="sa-ig-toolbar" role="toolbar" aria-label="Selection actions">
  <div class="sa-ig-toolbar__counts" aria-live="polite">
    <strong>{selectedCount}</strong>
    <span class="sa-ig-toolbar__counts-sep">of</span>
    <strong>{totalReady}</strong>
    <span class="sa-ig-toolbar__counts-label">selected</span>
    {#if duplicateCount > 0}
      <span class="sa-ig-toolbar__counts-dup" aria-label="{duplicateCount} duplicates excluded">
        · {duplicateCount} already archived
      </span>
    {/if}
  </div>

  <div class="sa-ig-toolbar__actions">
    <label class="sa-ig-toolbar__search">
      <span class="sa-ig-toolbar__search-icon" aria-hidden="true">
        <!-- Lucide search glyph (inline so we don't pull setIcon into the
             toolbar component). 16x16 to match the ghost button height. -->
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
             stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.3-4.3"></path>
        </svg>
      </span>
      <input
        type="search"
        class="sa-ig-toolbar__search-input"
        placeholder="Search…"
        aria-label="Search posts (caption, author, hashtag, mention, collection, shortcode)"
        title="Search caption, author, #tag, @mention, collection, shortcode"
        value={searchQuery}
        oninput={handleSearchInput}
      />
      {#if searchQuery !== ''}
        <button
          type="button"
          class="sa-ig-toolbar__search-clear"
          onclick={handleSearchClear}
          aria-label="Clear search"
          title="Clear search"
        >×</button>
      {/if}
    </label>

    <button type="button" class="sa-ig-toolbar__btn" onclick={onSelectAll}>
      Select all
    </button>
    <button type="button" class="sa-ig-toolbar__btn" onclick={onClear}>
      Clear
    </button>
    <button type="button" class="sa-ig-toolbar__btn" onclick={onInvert}>
      Invert
    </button>

    {#if showFilter}
      <label class="sa-ig-toolbar__filter">
        <span class="sa-ig-toolbar__filter-label">Collection</span>
        <select
          class="sa-ig-toolbar__filter-select"
          value={selectedCollectionId ?? ''}
          onchange={handleFilterChange}
        >
          <option value="">All collections</option>
          {#each collections as c (c.id)}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
      </label>
      {#if showInCollection}
        <button
          type="button"
          class="sa-ig-toolbar__btn"
          onclick={handleSelectAllInCollection}
        >
          Select all in this collection
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .sa-ig-toolbar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    /* Quiet container — no hard 1px border, just the secondary background
       tint. Keeps the toolbar visually distinct without competing with the
       author section dividers below it. */
    padding: 0.5rem 0.75rem;
    background: var(--background-secondary, transparent);
    border: none;
    border-radius: var(--radius-s, 4px);
  }

  .sa-ig-toolbar__counts {
    display: inline-flex;
    align-items: baseline;
    gap: 0.25rem;
    font-size: var(--font-ui, 0.9rem);
    color: var(--text-normal, #222);
  }

  .sa-ig-toolbar__counts strong {
    /* Plain emphasis — no accent color. The accent stays reserved for the
       footer "Import N selected" CTA. */
    color: var(--text-normal, #222);
    font-weight: var(--font-semibold, 600);
  }

  .sa-ig-toolbar__counts-sep,
  .sa-ig-toolbar__counts-label {
    color: var(--text-muted, #777);
    font-weight: var(--font-normal, 400);
  }

  .sa-ig-toolbar__counts-dup {
    color: var(--text-muted, #777);
    font-size: 0.825rem;
    margin-left: 0.25rem;
  }

  .sa-ig-toolbar__actions {
    /* `display: flex` + `flex: 1 1 auto` so this row fills the remaining
       toolbar width AFTER counts. With the previous `display: inline-flex`
       + `flex-wrap: wrap`, the container's intrinsic min-content was just
       its largest child (≈ search input width), so the parent allocated
       only that much — forcing actions to wrap internally even when
       plenty of toolbar width remained.

       `min-width: 0` lets the row shrink past its intrinsic min-content
       in narrow viewports so the search input shrinks (per its own
       `flex: 0 1 200px`) instead of forcing an internal wrap. The buttons
       only wrap when content genuinely exceeds available width.

       `justify-content: flex-end` keeps the row right-aligned (replacing
       the old `margin-left: auto` trick, which is redundant once we have
       `flex: 1 1 auto`). */
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0.25rem 0.5rem;
    min-width: 0;
  }

  /* Borderless ghost button — Obsidian-idiomatic.
     Double-class spec bump beats Obsidian's `.modal button` defaults. */
  .sa-ig-toolbar__btn.sa-ig-toolbar__btn {
    appearance: none;
    min-height: 32px;
    padding: 6px 12px;
    font-size: 0.825rem;
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--text-normal, #222);
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
    font-weight: 500;
    transition: background 100ms ease, color 100ms ease;
  }

  .sa-ig-toolbar__btn.sa-ig-toolbar__btn:hover {
    background: var(--background-modifier-hover, rgba(0, 0, 0, 0.06));
    color: var(--interactive-accent, #3b82f6);
    border: none;
    box-shadow: none;
  }

  .sa-ig-toolbar__btn.sa-ig-toolbar__btn:focus-visible {
    outline: 2px solid var(--interactive-accent, #3b82f6);
    outline-offset: 2px;
    border: none;
  }

  /* ----------------------------------------------------------------------
     Search input
     ----------------------------------------------------------------------
     Mirrors the borderless ghost-button visual language: bottom-border
     only, no surrounding box. The double-class `.sa-ig-toolbar__search-input.sa-ig-toolbar__search-input`
     spec bump beats Obsidian's `.modal input` defaults (which add a 1px
     border + background-secondary fill that look heavy in this toolbar). */
  .sa-ig-toolbar__search {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    /* Sized to coexist with the bulk-action buttons on a single row at the
       default modal width (~1300 px). Aggressive `flex: 1 1` was pushing
       the last button (Invert) to a second row; tighter min/basis keeps
       everything inline. The search will collapse first when the toolbar
       still can't fit, since it's the only flexible element here. */
    min-width: 160px;
    flex: 0 1 200px;
    max-width: 260px;
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--background-modifier-border, #ccc);
    color: var(--text-muted, #777);
    transition: border-color 100ms ease;
  }

  .sa-ig-toolbar__search:focus-within {
    border-bottom-color: var(--interactive-accent, #3b82f6);
    color: var(--text-normal, #222);
  }

  .sa-ig-toolbar__search-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: inherit;
    flex: 0 0 auto;
  }

  .sa-ig-toolbar__search-input.sa-ig-toolbar__search-input {
    flex: 1 1 auto;
    min-width: 0;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    border: none;
    box-shadow: none;
    outline: none;
    color: var(--text-normal, #222);
    font-size: 0.825rem;
    font-family: inherit;
    line-height: 1.4;
    padding: 6px 0;
    height: auto;
    min-height: 32px;
  }

  .sa-ig-toolbar__search-input.sa-ig-toolbar__search-input:focus,
  .sa-ig-toolbar__search-input.sa-ig-toolbar__search-input:focus-visible {
    border: none;
    box-shadow: none;
    outline: none;
  }

  /* Suppress the native browser clear/cancel button — we render our own
     `×` so the layout stays consistent across browsers. */
  .sa-ig-toolbar__search-input.sa-ig-toolbar__search-input::-webkit-search-cancel-button,
  .sa-ig-toolbar__search-input.sa-ig-toolbar__search-input::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
    display: none;
  }

  .sa-ig-toolbar__search-input.sa-ig-toolbar__search-input::placeholder {
    color: var(--text-faint, var(--text-muted, #777));
    opacity: 1;
  }

  /* `×` clear — matches the borderless ghost-button language. Double-class
     bump beats Obsidian's `.modal button` defaults. */
  .sa-ig-toolbar__search-clear.sa-ig-toolbar__search-clear {
    appearance: none;
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted, #777);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 100ms ease, color 100ms ease;
  }

  .sa-ig-toolbar__search-clear.sa-ig-toolbar__search-clear:hover {
    background: var(--background-modifier-hover, rgba(0, 0, 0, 0.06));
    color: var(--text-normal, #222);
    border: none;
    box-shadow: none;
  }

  .sa-ig-toolbar__search-clear.sa-ig-toolbar__search-clear:focus-visible {
    outline: 2px solid var(--interactive-accent, #3b82f6);
    outline-offset: 1px;
    border: none;
  }

  .sa-ig-toolbar__filter {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.825rem;
    color: var(--text-muted, #777);
    padding-left: 0.5rem;
  }

  .sa-ig-toolbar__filter-label {
    font-weight: var(--font-semibold, 600);
  }

  /* Borderless select — bottom-border only, mirrors the ghost button style.
     Native <select> chrome stays (caret arrow) so it still reads as
     interactive. */
  .sa-ig-toolbar__filter-select {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    min-height: 32px;
    padding: 4px 22px 4px 4px;
    border: none;
    border-bottom: 1px solid var(--background-modifier-border, #ccc);
    background: transparent;
    color: var(--text-normal, #222);
    border-radius: 0;
    font-size: 0.825rem;
    cursor: pointer;
    background-image:
      linear-gradient(45deg, transparent 50%, var(--text-muted, #777) 50%),
      linear-gradient(135deg, var(--text-muted, #777) 50%, transparent 50%);
    background-position:
      calc(100% - 12px) 50%,
      calc(100% - 7px) 50%;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
  }

  .sa-ig-toolbar__filter-select:hover {
    border-bottom-color: var(--interactive-accent, #3b82f6);
  }

  .sa-ig-toolbar__filter-select:focus-visible {
    outline: none;
    border-bottom-color: var(--interactive-accent, #3b82f6);
  }
</style>
