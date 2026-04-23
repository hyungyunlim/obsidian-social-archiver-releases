<script lang="ts">
  /**
   * ImportGalleryContainer — virtualized review-card list for the Instagram
   * Import Review Gallery (PRD prd-instagram-import-gallery.md §9.5).
   *
   * Single-responsibility: take an `AuthorGroup[]` and present each group as a
   * labelled section (avatar + name + handle + counts + per-author "Select all"
   * action) followed by a grid of review cards. Each card carries:
   *   - per-card selection overlay (`<ImportPostCardOverlay>`)
   *   - lazy-loaded `blob:` URLs for media (`MediaPreviewService`)
   *   - viewport-aware mount/unmount (custom IntersectionObserver — see
   *     "Renderer reuse gap" note below)
   *
   * Reactive bridge: the `selectionStore` is plain TypeScript (not `$state`),
   * so the parent passes a `bumpVersion` rune that increments when the store
   * mutates. We read `bumpVersion` inside `$derived` so checkbox state
   * re-evaluates after each store change.
   *
   * --------------------------------------------------------------------------
   * Author-grouped layout (design-overhaul revision)
   * --------------------------------------------------------------------------
   * The previous flat-grid + author dropdown filter has been replaced with a
   * sectioned layout. Each section is one author; its cards live in a grid
   * underneath. Per-author "Select all" buttons live on the section header,
   * call `selectionStore.selectAllByAuthor(key)`, and additively select every
   * post by that author regardless of any active collection filter.
   *
   * Rationale (user feedback): a single dropdown was hostile because the user
   * couldn't see who else was in the package without flipping through values.
   * A sectioned layout surfaces every author at once and makes per-author bulk
   * selection a single click on the visible row.
   *
   * --------------------------------------------------------------------------
   * Card body renderer (PRD §0 — "no new post-card component", "WYSIWYG")
   * --------------------------------------------------------------------------
   * Each card body is rendered through `PreviewableCardRenderer`, the SAME
   * class that any future preview surface (X bookmarks, Bluesky bookmarks,
   * etc.) will use. The renderer:
   *
   *   - Consumes raw `PostData` (the unified data contract — Layer 2 emits
   *     `PostData` unchanged from Layer 0 types).
   *   - Emits the SAME CSS class names that `PostCardRenderer` emits in the
   *     vault timeline (`pcr-card`, `pcr-header`, `pcr-author-name`,
   *     `pcr-time-row`, `pcr-platform-link`, `pcr-interactions`,
   *     `pcr-action-btn`, …) so `src/styles/components/post-card.css`
   *     applies unchanged. WYSIWYG is structural — the gallery card and the
   *     timeline card share the same stylesheet.
   *   - Accepts an optional `app`/`component` pair for full Obsidian
   *     markdown rendering. We deliberately omit them here (no vault file
   *     yet — wikilinks would resolve to nothing, and pulling the App
   *     handle through `Props` would expand the locked contract). The
   *     renderer's plain-text fallback preserves line breaks so the
   *     caption is fully readable.
   *
   * `PostCardRenderer` is intentionally NOT touched in this PR. Refactoring
   * its 9k-line vault-coupled implementation to delegate visual chrome to
   * `PreviewableCardRenderer` is high-value but high-risk (1,200 active
   * users on the timeline) and out of scope for the gallery feature. A
   * follow-up PR can rewire `PostCardRenderer.render` to compose the new
   * renderer for header/caption/media without changing its public API.
   *
   * `IntersectionObserverManager` is reused as-is for lazy-load + DOM
   * recycling. (See PRD §10 reuse table.)
   *
   * --------------------------------------------------------------------------
   * Media URL handling
   * --------------------------------------------------------------------------
   * `ImportPostPreview.postData` carries ZIP-relative paths in
   * `media[].url`, `media[].thumbnail`, `author.avatar`. The Layer-2 contract
   * is explicit that we MUST NOT mutate those — other components may share
   * the reference, and PRD §9.3 forbids eager rewriting.
   *
   * We use a side-channel `Map<postId, ResolvedMedia>` keyed by post id.
   * On viewport-enter we:
   *   1. Pull bytes via `extractMediaBytes(blob, relativePath)` once per
   *      (postId, relativePath).
   *   2. Hand the bytes to `mediaPreviewService.acquire(...)` to get a
   *      `blob:` URL.
   *   3. Store the URL in the side-channel map and bump a `mediaVersion`
   *      rune so the card re-renders with the resolved URL.
   * On viewport-leave we call `mediaPreviewService.release(...)` for every
   * acquired URL, but keep the map entry around — the LRU service serves
   * future acquires for free if the entry is still cached.
   *
   * Testing surface (manual):
   *   - Render with `groups=[]` → empty container, no observer activity.
   *   - Render with mixed selectable + duplicate posts → duplicates are
   *     rendered with the overlay's duplicate styling.
   *   - Scroll a card into view → media URL flips from undefined to a
   *     `blob:` URL; checkbox toggles call `selectionStore.toggle(postId)`.
   *
   * --------------------------------------------------------------------------
   * Visual layout — design-overhaul revision (uniform card heights ×1.5 +
   * generous spacing between author sections)
   * --------------------------------------------------------------------------
   * Section header:
   *   - Avatar initials (32px circle) + display name + handle + "{N} posts ·
   *     {M} selected" + per-author Select all (borderless ghost button).
   *   - Bottom border via `--background-modifier-border-hover` for a quiet
   *     separator that aligns with the grid edge.
   *
   * Grid (per section):
   *   - `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
   *   - `gap: 1rem`
   *   - `grid-auto-rows: minmax(720px, auto)` — cards in the same row align
   *     to the tallest. Default 720 px (1.5× the previous 480 px) gives the
   *     caption room to breathe; rows naturally grow when "See more" expands
   *     a long caption.
   *
   * Card layout (inside the overlay's `.sa-ig-card`):
   *   - Card is `display: flex; flex-direction: column;` so children stack
   *     and `min-height: 0` lets long captions push the card height up
   *     without overflowing.
   *   - `.sa-ig-pc` (the article element) carries NO horizontal padding —
   *     the media tile (`.pcr-media-hero`/`.pcr-media-carousel`) goes
   *     edge-to-edge. Header / caption / interactions / footer rows each
   *     carry their own padding so the visual rhythm reads as a tight
   *     column with the media as the anchor.
   *   - Captions are NOT clamped. The renderer's existing "See more…" /
   *     "See less" toggle (PreviewableContentRenderer) already exists for
   *     captions over its truncation budget; we honour it. Short captions
   *     simply leave whitespace at the bottom of the caption row.
   *
   * Manual visual verification checklist (design-overhaul):
   *   1. Open the gallery on a job with 12+ mixed posts spanning multiple
   *      authors. Each author is its own labelled section; sections are
   *      sorted alphabetically by display name; section headers carry an
   *      avatar initials chip, the display name, the handle, the "{N}
   *      posts · {M} selected" line, and a borderless "Select all by this
   *      author" button on the right.
   *   2. Card heights default to 720 px (1.5× the previous 480 px). Cards
   *      in the same row align to the tallest card in that row.
   *   3. Captions render in full unless they hit the renderer's truncation
   *      budget — in that case a "See more…" pseudo-link appears under the
   *      caption and toggles between summary / full text without scrolling
   *      the surrounding gallery.
   *   4. Square hero media goes edge-to-edge (no horizontal padding gap
   *      between the card border and the media tile).
   *   5. Header (avatar + author + date) sits flush against the top of
   *      the card with comfortable padding (~12 px top / 14 px sides).
   *   6. Selected checkbox accent border reads cleanly along the new
   *      flush-left/flush-right media tile.
   *   7. Footer shortcode does not wrap; it ellipses if the shortcode is
   *      unusually long.
   */

  import { onMount, onDestroy } from 'svelte';
  import type { ImportPostPreview, StartImportFile } from '@/types/import';
  import {
    extractMediaBytes,
    type ImportSelectionStore,
    type MediaPreviewService,
  } from '@/services/import-gallery';
  import { IntersectionObserverManager } from '@/components/timeline/managers/IntersectionObserverManager';
  import {
    PreviewableCardRenderer,
    type PreviewContext,
  } from '@/components/timeline/renderers/PreviewableCardRenderer';
  import { computeInitials } from '@/components/timeline/renderers/PreviewableHelpers';
  import ImportPostCardOverlay from './ImportPostCardOverlay.svelte';

  /**
   * One author's posts collected for the section layout. The parent (`ImportGallery`)
   * derives this from `visiblePosts`; we only render. `key` is the stable identity
   * (handle / username / display name fallback) used by `selectAllByAuthor`.
   */
  export type AuthorGroup = {
    key: string;
    name: string;
    handle: string | undefined;
    posts: ImportPostPreview[];
  };

  type Props = {
    /** Visible posts pre-bucketed by author, sorted alphabetically by display name. */
    groups: AuthorGroup[];
    /** Reactive bridge — read inside derived expressions to trigger re-eval. */
    bumpVersion: number;
    /** Plain-TS selection store. Container only reads / toggles. */
    selectionStore: ImportSelectionStore;
    /** Source ZIPs (looked up by name to extract media bytes). */
    files: StartImportFile[];
    /**
     * Optional — when undefined, media simply renders as broken placeholders.
     * The pre-import gallery always passes one, but unit tests may omit.
     */
    mediaPreviewService: MediaPreviewService | undefined;
    /** Per-section bulk action: select every post by `groups[i].key`. */
    onSelectAllByAuthor: (authorKey: string) => void;
    /** Per-section bulk action: deselect every post by `groups[i].key`. */
    onDeselectAllByAuthor: (authorKey: string) => void;
  };

  let {
    groups,
    bumpVersion,
    selectionStore,
    files,
    mediaPreviewService,
    onSelectAllByAuthor,
    onDeselectAllByAuthor,
  }: Props = $props();

  // ---------------------------------------------------------------------------
  // Sentinel jobId — pre-import previews don't have a real jobId yet. The
  // parent (`ImportGallery`) is responsible for calling
  // `mediaPreviewService.clearForJob('preview')` on unmount; we DO NOT call
  // it here so the owner controls lifetime.
  // ---------------------------------------------------------------------------
  const PREVIEW_JOB_ID = 'preview' as const;

  // ---------------------------------------------------------------------------
  // Derived lookups
  // ---------------------------------------------------------------------------

  /** Files keyed by name — quick lookup for media extraction. */
  const filesByName = $derived(new Map(files.map((f) => [f.name, f])));

  /** Per-post zipKey: stable identity for MediaPreviewService cache key. */
  function makeZipKey(file: StartImportFile): string {
    return `${file.name}:${file.blob.size}`;
  }

  /**
   * Per-section selected count — read inside the section header. Touches
   * `bumpVersion` so it re-evaluates on any selection mutation.
   */
  function selectedCountForGroup(group: AuthorGroup): number {
    void bumpVersion;
    let n = 0;
    for (const post of group.posts) {
      if (selectionStore.isSelected(post.postId)) n++;
    }
    return n;
  }

  // ---------------------------------------------------------------------------
  // Side-channel media resolution
  //
  // Map<postId, Map<relativePath, blobUrl>>. Mutated outside reactive runes;
  // we use `mediaVersion` to opt cards into re-render when entries change.
  // ---------------------------------------------------------------------------

  const resolvedMedia = new Map<string, Map<string, string>>();
  let mediaVersion = $state(0);

  /** Currently-acquired (postId, relativePath) pairs — for symmetric release. */
  const acquired = new Map<string, Set<string>>();
  /** Per-post in-flight extraction (so concurrent observer fires dedupe). */
  const inflight = new Map<string, Promise<void>>();

  function getResolvedUrl(postId: string, relativePath: string): string | undefined {
    // Reading mediaVersion inside a $derived caller subscribes to changes;
    // here we are inside a normal function so callers must do the touch.
    return resolvedMedia.get(postId)?.get(relativePath);
  }

  /**
   * Collect every ZIP-relative path that appears in `postData` (media + thumbnails
   * + author avatar). Network URLs (http/https/blob/data) are skipped — they
   * already work in <img src=>.
   */
  function collectRelativePaths(post: ImportPostPreview): string[] {
    const out = new Set<string>();
    const consider = (val: string | undefined | null): void => {
      if (!val) return;
      if (/^(?:https?:|data:|blob:)/i.test(val)) return;
      // Normalize leading "./" — ZipReader stores entries without it.
      const normalized = val.replace(/^\.\//, '');
      if (normalized) out.add(normalized);
    };
    for (const m of post.postData.media ?? []) {
      consider(m.url);
      consider(m.thumbnail);
      consider(m.thumbnailUrl);
    }
    consider(post.postData.author?.avatar);
    return Array.from(out);
  }

  async function ensureMediaForPost(post: ImportPostPreview): Promise<void> {
    if (!mediaPreviewService) return;
    const file = filesByName.get(post.partFilename);
    if (!file) return;
    const zipKey = makeZipKey(file);
    const paths = collectRelativePaths(post);
    if (paths.length === 0) return;

    // Dedup concurrent calls for the same post.
    const existing = inflight.get(post.postId);
    if (existing) return existing;

    const work = (async () => {
      const map = resolvedMedia.get(post.postId) ?? new Map<string, string>();
      const acquiredSet = acquired.get(post.postId) ?? new Set<string>();
      let touched = false;

      for (const rel of paths) {
        if (map.has(rel)) {
          // Already resolved — but we still need to bump retain count if we
          // released earlier on viewport-leave. We track per-acquire, so a
          // repeat enter ALWAYS calls acquire (LRU service handles dedup).
          if (!acquiredSet.has(rel)) {
            try {
              const url = await mediaPreviewService.acquire(
                PREVIEW_JOB_ID,
                zipKey,
                rel,
                file.blob,
              );
              map.set(rel, url);
              acquiredSet.add(rel);
              touched = true;
            } catch {
              // Ignore — broken media already shows placeholder.
            }
          }
          continue;
        }
        try {
          const bytes = await extractMediaBytes(file.blob, rel);
          if (!bytes) continue; // Missing media → leave placeholder.
          const url = await mediaPreviewService.acquire(
            PREVIEW_JOB_ID,
            zipKey,
            rel,
            new Blob([bytes]),
          );
          map.set(rel, url);
          acquiredSet.add(rel);
          touched = true;
        } catch {
          // Swallow — placeholder is acceptable per PRD F1.4.
        }
      }

      if (touched) {
        resolvedMedia.set(post.postId, map);
        acquired.set(post.postId, acquiredSet);
        mediaVersion++;
      }
    })();

    inflight.set(post.postId, work);
    try {
      await work;
    } finally {
      inflight.delete(post.postId);
    }
  }

  function releaseMediaForPost(post: ImportPostPreview): void {
    if (!mediaPreviewService) return;
    const file = filesByName.get(post.partFilename);
    if (!file) return;
    const zipKey = makeZipKey(file);
    const acquiredSet = acquired.get(post.postId);
    if (!acquiredSet) return;
    for (const rel of acquiredSet) {
      try {
        mediaPreviewService.release(PREVIEW_JOB_ID, zipKey, rel);
      } catch {
        // No-op — release is documented as defensive.
      }
    }
    acquired.delete(post.postId);
    // Keep `resolvedMedia` so the URL is reused on next acquire — the LRU
    // service still owns the lifetime, so it MAY have already revoked, but
    // ensureMediaForPost re-acquires anyway.
  }

  // ---------------------------------------------------------------------------
  // IntersectionObserver wiring
  //
  // We use a fresh `IntersectionObserverManager` per mount. The manager's
  // `observe()` API takes a `PostData`, which we fabricate as a thin wrapper
  // referring back to the preview. We do not enable DOM recycling — the
  // gallery is a single-page snapshot, not a long-lived feed.
  //
  // RE-ARM PATTERN (QA Critical Issue #3):
  //   IntersectionObserverManager fires its enter callback ONCE per
  //   `observe()` call ("Auto-unobserves after successful render", see
  //   manager.ts §284-307). Because the gallery's `MediaPreviewService` has
  //   a 150-entry LRU cache, scroll-out → release → eviction → revoke is
  //   expected for any user with more than ~30 cards. We must therefore
  //   re-call `observerManager.observe(...)` in `handleLeave` so the next
  //   viewport entry re-triggers `acquire`. See `handleLeave` for the
  //   guard conditions and the design rationale.
  // ---------------------------------------------------------------------------

  // CRITICAL: these MUST be created at script-body time, NOT inside onMount.
  // Svelte 5 runs child mounts (and `use:` actions) BEFORE onMount fires on
  // the parent. If we deferred construction to onMount, every `bindCard` call
  // would see `null` and skip observation entirely → IntersectionObserver
  // never fires → media never resolves (cards stuck at "Preview loading…").
  let observerManager: IntersectionObserverManager | null =
    new IntersectionObserverManager();
  let leaveObserver: IntersectionObserver | null = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          handleLeave(entry.target as HTMLElement);
        }
      }
    },
    {
      root: null,
      // Match IntersectionObserverManager.RECYCLE_ROOT_MARGIN (desktop 600px)
      // so cards leaving the viewport release their blob URLs before LRU pressure.
      rootMargin: '600px',
      threshold: 0,
    },
  );
  // postId → element, so we can rewire after `groups` changes.
  const cardElements = new Map<string, HTMLElement>();
  const cardPosts = new Map<string, ImportPostPreview>();

  function handleEnter(element: HTMLElement, postId: string): void {
    const post = cardPosts.get(postId);
    if (!post) return;
    void ensureMediaForPost(post);
  }

  function handleLeave(element: HTMLElement): void {
    const postId = element.dataset.importPostId;
    if (!postId) return;
    const post = cardPosts.get(postId);
    if (!post) return;
    releaseMediaForPost(post);
    // ---------------------------------------------------------------------
    // Re-arm the enter observer so the next viewport entry re-acquires
    // the URL.
    //
    // PRD §9.2 + QA Critical Issue #3: `IntersectionObserverManager.observe`
    // auto-unobserves after the enter callback fires (manager.ts §284-307,
    // "Auto-unobserves after successful render"). Without re-arming here,
    // scroll-out → release decrements retain to 0 → LRU may evict and
    // revoke the `blob:` URL (cache cap is 150, ~5 media per card → breaks
    // after ~30 cards). When the user scrolls back in the manager will not
    // fire again, leaving a broken `blob:` placeholder.
    //
    // Guards:
    //   - `element.isConnected`: skip cards Svelte is about to unmount
    //     (keyed each block reactivity may rip the node out concurrently
    //     with this leave callback firing on the old element).
    //   - `observerManager`: race against `onDestroy` which nulls the
    //     reference. The manager itself also has an `isDestroyed` guard,
    //     but checking here avoids the noisy console.warn.
    //
    // `handleEnter` is idempotent: `ensureMediaForPost` dedupes concurrent
    // calls via the per-post `inflight` map and the LRU service treats a
    // repeated `acquire` for an already-cached entry as a free retain bump.
    //
    // Manual smoke test (per QA review):
    //   1. Build a fixture with 50+ posts.
    //   2. Open the gallery, scroll all the way to the bottom.
    //   3. Scroll back to the top — first-batch thumbnails must still
    //      render (no broken-image icons).
    //   4. In DevTools console, `mediaPreviewService.getStats()` should
    //      report cache size <= 150.
    //
    // Out of scope: a future `observePersistent()` API on the manager
    // would express this contract directly. Tracked separately so this
    // PR keeps PRD §0 commitment ("no fork of timeline renderer").
    // ---------------------------------------------------------------------
    if (observerManager && element.isConnected) {
      observerManager.observe(element, post.postData, () => {
        handleEnter(element, post.postId);
      });
    }
  }

  onMount(() => {
    // Observers are created at script-body time (see comment above) so they
    // are already wired by the time `bindCard` actions ran on initial mount.
    // We additionally trigger an eager media load for any card already in
    // viewport, because IntersectionObserver does NOT fire its callback for
    // elements that intersect at observation time within Obsidian's modal
    // (the modal contentEl is created off-document then attached, which can
    // confuse the observer's initial intersection detection).
    for (const [postId, element] of cardElements.entries()) {
      const post = cardPosts.get(postId);
      if (!post) continue;
      // Best-effort kick: even if IO fires correctly we'll just dedup via
      // the per-post `inflight` map.
      void ensureMediaForPost(post);
      // Re-arm the manager observer in case the initial observe() call's
      // synchronous intersection check missed.
      if (observerManager && element.isConnected) {
        observerManager.observe(element, post.postData, () => {
          handleEnter(element, post.postId);
        });
      }
    }
  });

  onDestroy(() => {
    if (observerManager) {
      observerManager.destroy();
      observerManager = null;
    }
    if (leaveObserver) {
      leaveObserver.disconnect();
      leaveObserver = null;
    }
    cardElements.clear();
    cardPosts.clear();
    inflight.clear();
    // Note: we DO NOT call mediaPreviewService.clearForJob('preview') — the
    // parent (ImportGallery) owns that lifecycle so the URL cache survives
    // pane round-trips (back to preflight and forward again).
  });

  /**
   * Use Svelte action to capture each card root element and wire the
   * observers. Re-runs when `groups` is reassigned so observers stay in sync
   * after a filter change.
   */
  function bindCard(element: HTMLElement, post: ImportPostPreview): { destroy: () => void } {
    cardElements.set(post.postId, element);
    cardPosts.set(post.postId, post);
    if (observerManager) {
      // Observer manager wants a PostData — pass the preview's postData.
      observerManager.observe(element, post.postData, () => {
        handleEnter(element, post.postId);
      });
    }
    if (leaveObserver) {
      leaveObserver.observe(element);
    }
    return {
      destroy() {
        if (observerManager) observerManager.unobserve(element);
        if (leaveObserver) leaveObserver.unobserve(element);
        cardElements.delete(post.postId);
        cardPosts.delete(post.postId);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Card body — rendered by `PreviewableCardRenderer`, the same class that any
  // future preview surface (X bookmarks, Bluesky bookmarks, …) will use. See
  // the "Card body renderer" header note above for the WYSIWYG rationale.
  // ---------------------------------------------------------------------------

  /**
   * Resolve a raw media URL string from `PostData` to something an `<img src>`
   * / `<video src>` attribute can render. Network/blob/data URLs pass through
   * unchanged; ZIP-relative paths are looked up in the side-channel map (which
   * is populated by `ensureMediaForPost` on viewport entry).
   *
   * NOTE: this function intentionally does NOT close over `mediaVersion`. The
   * `PreviewableCardRenderer` is re-invoked imperatively from `mountPreview`
   * whenever `mediaVersion` changes, so re-rendering picks up newly resolved
   * URLs. Reading `mediaVersion` here would be a no-op outside a $derived.
   */
  function resolveMediaUrl(postId: string, raw: string | undefined | null): string | undefined {
    if (!raw) return undefined;
    if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
    const normalized = raw.replace(/^\.\//, '');
    return getResolvedUrl(postId, normalized);
  }

  /**
   * Mount a `PreviewableCardRenderer` into the action node and re-render it
   * whenever `mediaVersion` changes (so the URL placeholders flip to real
   * blob: URLs after the IntersectionObserver acquires bytes).
   *
   * This is a Svelte action: returns `update`/`destroy` so we can re-render
   * imperatively without depending on Svelte's reactive declaration system to
   * thread our side-channel `Map` through the template.
   */
  function mountPreview(
    node: HTMLElement,
    args: { post: ImportPostPreview; version: number },
  ): { update: (next: { post: ImportPostPreview; version: number }) => void; destroy: () => void } {
    let currentPost = args.post;
    const renderer = new PreviewableCardRenderer({
      // The renderer asks "give me a renderable URL for this raw value" —
      // we resolve through our side-channel `Map`. We close over `currentPost`
      // (NOT `args.post`) so the renderer always uses the latest postId after
      // an `update`.
      resolveMediaUrl: (raw) => resolveMediaUrl(currentPost.postId, raw),
      // No `app`/`component`: we don't have a vault file context yet — the
      // renderer's plain-text caption fallback is the correct behavior.
      // No `onCardClick`: per PRD §5.3 the gallery card body is non-interactive
      // (selection happens through the overlay checkbox layer).
      //
      // captionMaxChars: leave at the renderer's default (300 chars). With the
      // ×1.5 card height + the harsh `-webkit-line-clamp: 3` CSS removed,
      // captions ≤ 300 chars render in full; longer captions render the 300-
      // char summary plus the renderer's "See more…" toggle (which expands the
      // full caption inline and grows the card row to fit). Honours the user
      // request: "글들을 잘리개 하지말고, shot more로 펼쳐지게 해서 본문 내용 확인하게
      // 해주고" — don't hard-truncate, use See more to reveal full content.
    } satisfies PreviewContext);

    const draw = (): void => {
      node.innerHTML = '';
      void renderer.render(node, currentPost.postData);
    };

    draw();

    return {
      update(next) {
        currentPost = next.post;
        // Re-render on every `version` bump so newly resolved blob: URLs flow
        // through. Re-render on `post` change as well (filter changes can
        // re-key the each block but the action node may be reused).
        draw();
      },
      destroy() {
        node.innerHTML = '';
      },
    };
  }
</script>

{#if groups.length === 0}
  <div class="sa-ig-gc__empty" role="status">No posts to review.</div>
{:else}
  <div class="sa-ig-gc__sections">
    {#each groups as group (group.key)}
      <!-- bumpVersion read explicitly in the comma expression so Svelte 5
           establishes the dependency before the function call. Mirrors the
           per-card `isSelected` pattern below. -->
      {@const groupSelected = (bumpVersion, selectedCountForGroup(group))}
      {@const allSelected = groupSelected === group.posts.length && group.posts.length > 0}
      <section class="sa-ig-group" aria-label={`Posts by ${group.name}`}>
        <header class="sa-ig-group__header">
          <div class="sa-ig-group__author">
            <div class="sa-ig-group__avatar" aria-hidden="true">
              {computeInitials(group.name)}
            </div>
            <div class="sa-ig-group__identity">
              <strong class="sa-ig-group__name">{group.name}</strong>
              {#if group.handle}
                <span class="sa-ig-group__handle">@{group.handle}</span>
              {/if}
            </div>
          </div>
          <div class="sa-ig-group__meta">
            <span class="sa-ig-group__count" aria-live="polite">
              {group.posts.length} {group.posts.length === 1 ? 'post' : 'posts'} · {groupSelected} selected
            </span>
            <button
              type="button"
              class="sa-ig-group__select"
              onclick={() => allSelected
                ? onDeselectAllByAuthor(group.key)
                : onSelectAllByAuthor(group.key)}
            >{allSelected ? 'Deselect all' : 'Select all'}</button>
          </div>
        </header>

        <div class="sa-ig-gc">
          {#each group.posts as post (post.postId)}
            <!-- Subscribe to bumpVersion BEFORE calling selectionStore.isSelected
                 so Svelte 5 establishes the dependency. The two reads must happen
                 in the same reactive scope; combining them in a single $derived-style
                 expression guarantees the subscription is recorded before the call. -->
            {@const isSelected = (bumpVersion, selectionStore.isSelected(post.postId))}
            <div class="sa-ig-gc__cell" use:bindCard={post}>
              <ImportPostCardOverlay
                postId={post.postId}
                isSelected={isSelected}
                isDuplicate={post.isDuplicate}
                shortcode={post.shortcode}
                onToggle={() => selectionStore.toggle(post.postId)}
              >
                <!--
                  Render the actual `PreviewableCardRenderer` into this node. Re-runs
                  whenever `mediaVersion` increments so newly resolved blob: URLs
                  replace placeholders. The shortcode footer is appended after the
                  renderer so the gallery still surfaces the per-post identifier
                  without overloading the renderer with gallery-only chrome.
                -->
                <article class="sa-ig-pc">
                  <div class="sa-ig-pc__renderer" use:mountPreview={{ post, version: mediaVersion }}></div>
                  <footer class="sa-ig-pc__foot">
                    <span class="sa-ig-pc__shortcode">{post.shortcode}</span>
                  </footer>
                </article>
              </ImportPostCardOverlay>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}

<style>
  /* ----------------------------------------------------------------------
     Sections wrapper — generous vertical rhythm between author groups so
     the layout feels intentional, not crammed.
     ---------------------------------------------------------------------- */
  .sa-ig-gc__sections {
    display: flex;
    flex-direction: column;
    gap: 32px;
    width: 100%;
  }

  /* ----------------------------------------------------------------------
     Author section header
     ---------------------------------------------------------------------- */
  .sa-ig-group {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
  }

  .sa-ig-group__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 4px 4px 12px;
    border-bottom: 1px solid var(--background-modifier-border-hover, rgba(0, 0, 0, 0.08));
  }

  .sa-ig-group__author {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .sa-ig-group__avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--background-modifier-hover, rgba(0, 0, 0, 0.08));
    color: var(--text-muted, #777);
    font-size: var(--font-ui-smaller, 0.78rem);
    font-weight: var(--font-semibold, 600);
    letter-spacing: 0.02em;
    flex: 0 0 auto;
  }

  .sa-ig-group__identity {
    display: inline-flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }

  .sa-ig-group__name {
    font-size: 0.95rem;
    font-weight: var(--font-semibold, 600);
    color: var(--text-normal, #222);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 28ch;
  }

  .sa-ig-group__handle {
    font-size: 0.825rem;
    color: var(--text-muted, #777);
    font-weight: var(--font-normal, 400);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 28ch;
  }

  .sa-ig-group__meta {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-left: auto;
  }

  .sa-ig-group__count {
    font-size: 0.825rem;
    color: var(--text-muted, #777);
  }

  /* Borderless ghost button — Obsidian-idiomatic. The full-bleed CTA chrome
     is reserved for the footer "Import N selected" action.
     Double-class spec bump beats Obsidian's `.modal button` defaults. */
  .sa-ig-group__select.sa-ig-group__select {
    appearance: none;
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--text-normal, #222);
    font-size: 0.85rem;
    font-weight: 500;
    padding: 8px 14px;
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
    transition: background 100ms ease, color 100ms ease;
  }

  .sa-ig-group__select.sa-ig-group__select:hover {
    background: var(--background-modifier-hover, rgba(0, 0, 0, 0.06));
    color: var(--interactive-accent, #3b82f6);
    border: none;
    box-shadow: none;
  }

  .sa-ig-group__select.sa-ig-group__select:focus-visible {
    outline: 2px solid var(--interactive-accent, #3b82f6);
    outline-offset: 2px;
    border: none;
  }

  /* ----------------------------------------------------------------------
     Grid — wider columns + bigger gap + ×1.5 card height baseline. Cards in
     the same row align to the tallest, so long-caption "See more" expansion
     simply grows the row.
     ---------------------------------------------------------------------- */
  .sa-ig-gc {
    display: grid;
    /* Wider columns (~280 px) → 3-4 columns at typical modal width. */
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    /* `minmax(640px, auto)` is the new baseline — wider cards (340 px from
       lets the row grow when "See more" expands a long caption. Cards in the
       same row align to the tallest. */
    grid-auto-rows: minmax(640px, auto);
    gap: 1rem;
    width: 100%;
  }

  .sa-ig-gc__cell {
    /* Card is a flex column so the overlay (`.sa-ig-card`) can stretch to
       100% height of the cell and its inner article can take the remaining
       vertical space. */
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }

  /* Stretch the overlay wrapper to fill the cell so all cards align.
     Specificity: chain `.sa-ig-card` with the body selector so this
     reliably wins over the overlay component's scoped rule (same
     single-class specificity but order-of-stylesheets is not
     guaranteed across components). */
  .sa-ig-gc__cell > :global(.sa-ig-card) {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    transition: border-color 120ms ease, box-shadow 160ms ease, transform 120ms ease;
  }

  .sa-ig-gc__cell > :global(.sa-ig-card:hover) {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }

  .sa-ig-gc__cell :global(.sa-ig-card .sa-ig-card__body) {
    /* Body owns the article — it must flex so its children fill height. */
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .sa-ig-gc__empty {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--text-muted, #777);
    font-size: var(--font-ui, 0.9rem);
  }

  /* ----------------------------------------------------------------------
     Card body — edge-to-edge media + per-row padding.
     The card body's visual chrome (header, caption, media, interactions) is
     produced by `PreviewableCardRenderer` and styled by the vault's
     `post-card.css` (matching `pcr-*` class names) — see the WYSIWYG note
     at the top of this file. The styles below are gallery-only:
       - `.sa-ig-pc`: per-card layout shell (flex column, no padding)
       - `.sa-ig-pc__renderer`: scope so the renderer's output lives inside,
         and so we can re-pad header/caption/interactions per-row.
       - `.sa-ig-pc__foot/__shortcode`: gallery-only identifier strip
     ---------------------------------------------------------------------- */

  .sa-ig-pc {
    display: flex;
    flex-direction: column;
    gap: 0;
    /* No outer padding — media tile goes edge-to-edge. Per-row padding is
       applied below to header, caption, interactions, and footer. */
    padding: 0;
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
  }

  .sa-ig-pc__renderer {
    /* The renderer paints into this node imperatively. Width must collapse
       gracefully so grid cells stay tight. The renderer is also a flex
       column so the media tile sits flush below the header/caption rows
       and the interactions row sits flush below the media. */
    display: flex;
    flex-direction: column;
    min-width: 0;
    width: 100%;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* Per-row padding inside the renderer output. We scope each rule to
     `.sa-ig-pc__renderer` so the global timeline cards in the vault are
     untouched. Renderer emits `.pcr-card > .post-content-area > {pcr-header,
     pcr-content, pcr-media-hero|pcr-media-carousel, pcr-interactions}`. */
  .sa-ig-pc__renderer :global(.pcr-card) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
  }

  .sa-ig-pc__renderer :global(.pcr-card .post-content-area) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
  }

  /* ----------------------------------------------------------------------
     Media-anchored visual order (Instagram-style)
     ----------------------------------------------------------------------
     The renderer emits children in DOM order:
       1. .pcr-header
       2. .pcr-content    (caption, contains its own "See more" toggle)
       3. .pcr-media-hero | .pcr-media-carousel
       4. .pcr-interactions
     We want media anchored right after the header so the tile sits at the
     SAME y-offset on every card regardless of caption length — matching the
     Instagram feed rhythm. We achieve this with `order:` on the flex
     children (DOM is left untouched, only paint order changes). Header
     height is fixed (avatar + 2 lines) so anchoring after it gives a
     consistent media position grid-wide.

     Specificity: every selector is anchored to `.sa-ig-pc__renderer` so
     these `order` rules are scoped to the gallery only — the timeline
     cards in the vault keep the original DOM/visual order. The same
     `.sa-ig-pc__renderer :global(...)` pattern below already wins against
     the post-card.css globals (single class on each side, our selector
     adds the `.sa-ig-pc__renderer` ancestor → strictly higher
     specificity). */
  .sa-ig-pc__renderer :global(.pcr-header) {
    order: 1;
  }
  .sa-ig-pc__renderer :global(.pcr-media-hero),
  .sa-ig-pc__renderer :global(.pcr-media-carousel) {
    order: 2;
  }
  .sa-ig-pc__renderer :global(.pcr-content) {
    order: 3;
  }
  .sa-ig-pc__renderer :global(.pcr-interactions) {
    order: 4;
  }

  .sa-ig-pc__renderer :global(.pcr-header) {
    /* Header sits flush against the card's top edge with comfortable
       horizontal padding. The right side is reserved for the per-card
       selection checkbox overlay (`.sa-ig-card__checkbox`, top: 8px /
       right: 8px / 24x24), so we leave extra inline-end padding to keep
       header content from sliding underneath it. */
    padding: 12px 44px 8px 14px;
    flex: 0 0 auto;
  }

  /* The renderer emits a top-right platform link (Instagram glyph) inside
     the header. In the gallery the per-card selection checkbox already
     occupies the same corner, so the platform glyph is redundant chrome
     and visually collides with the checkbox at narrow widths. Hide it in
     gallery scope only — the timeline cards in the vault keep showing it. */
  .sa-ig-pc__renderer :global(.pcr-platform-link) {
    display: none;
  }

  /* Caption: NO clamp. The renderer's "See more…" toggle handles overflow
     when the caption exceeds its budget. Short captions simply leave
     whitespace at the bottom of the caption row. The card may grow taller
     than the 720 px baseline; the row aligns to the tallest card.

     Caption now sits BELOW the media tile (visual `order: 3`) — give it a
     top padding so it doesn't butt directly against the bottom edge of
     the media. */
  .sa-ig-pc__renderer :global(.pcr-content) {
    padding: 10px 14px 10px;
    flex: 0 0 auto;
  }

  .sa-ig-pc__renderer :global(.pcr-content > p) {
    margin: 0 0 6px;
    line-height: 1.45;
  }

  .sa-ig-pc__renderer :global(.pcr-content > p:last-child) {
    margin-bottom: 0;
  }

  /* "See more…" / "See less" toggle emitted by PreviewableContentRenderer.
     Style as a quiet inline link so it doesn't compete with the card chrome. */
  .sa-ig-pc__renderer :global(.pcr-see-more-btn) {
    display: inline-block;
    padding: 4px 14px 0;
    font-size: 0.825rem;
    color: var(--interactive-accent, #3b82f6);
    cursor: pointer;
    user-select: none;
  }

  .sa-ig-pc__renderer :global(.pcr-see-more-btn:hover) {
    text-decoration: underline;
  }

  /* The media tile is the visual anchor — full width, no padding around it.
     A1's renderer enforces aspect-ratio: 1 / 1 on the wrapper, so the
     media wants to be a perfect square sized to the column width. We
     deliberately do NOT override aspect-ratio here (per A1 contract).
     With `flex: 0 1 auto` + `min-height: 0` the flex column can let the
     media shrink if the fixed-height cell can't fit the full square
     (extreme case: very long captions on the smallest column width). */
  .sa-ig-pc__renderer :global(.pcr-media-hero),
  .sa-ig-pc__renderer :global(.pcr-media-carousel) {
    width: 100%;
    margin: 0;
    flex: 0 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  /* Subtle separator between the media tile and the interactions strip,
     to echo the visual rhythm of the timeline cards without the extra
     padding-induced gap that the old layout had. */
  .sa-ig-pc__renderer :global(.pcr-interactions) {
    padding: 8px 14px;
    border-top: 1px solid var(--background-modifier-border, rgba(0, 0, 0, 0.08));
    flex: 0 0 auto;
  }

  .sa-ig-pc__foot {
    padding: 8px 14px 10px;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-faint, var(--text-muted, #777));
    font-family: var(--font-monospace, monospace);
    flex: 0 0 auto;
    overflow: hidden;
  }

  .sa-ig-pc__shortcode {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-block;
    max-width: 100%;
  }
</style>
