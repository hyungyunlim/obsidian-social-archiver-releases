<script lang="ts">
  /**
   * ImportPreflight — pre-flight pane (PRD §5.3).
   *
   * Shows validated part summaries, aggregate counts, rate-limit slider,
   * disclaimer, and Start Import button.
   */

  import type {
    ImportDestination,
    ImportPreflightResult,
    StartImportFile,
  } from '../../types/import';
  import ImportFilePicker from './ImportFilePicker.svelte';

  type Props = {
    files: StartImportFile[];
    preflight: ImportPreflightResult | null;
    isRunningPreflight: boolean;
    error: string | null;
    destination: ImportDestination;
    tagsInput: string;
    importButtonEnabled: boolean;
    /**
     * True while the orchestrator is loading per-post previews for the
     * Review pane (PRD §5.1, F1.1). Disables the Review/Skip buttons and
     * surfaces a `Loading…` label on the Review CTA so the user does not
     * double-click and queue two `loadGallery` calls.
     */
    isLoadingGallery?: boolean;
    onFilesSelected: (files: StartImportFile[]) => void | Promise<void>;
    onRemoveFile: (filename: string) => void;
    onDestinationChange: (v: ImportDestination) => void;
    onTagsInputChange: (v: string) => void;
    /** Primary CTA — open the review gallery (PRD §5.1). */
    onReviewPosts: () => void | Promise<void>;
    /**
     * Secondary CTA — bypass the gallery and import every ready post in the
     * selection (PRD §5.1, "Skip review and import all"). Equivalent to the
     * legacy single-button flow.
     */
    onSkipReview: () => void | Promise<void>;
    onCancel: () => void;
  };

  let {
    files,
    preflight,
    isRunningPreflight,
    error,
    destination,
    tagsInput,
    importButtonEnabled,
    isLoadingGallery = false,
    onFilesSelected,
    onRemoveFile,
    onDestinationChange,
    onTagsInputChange,
    onReviewPosts,
    onSkipReview,
    onCancel,
  }: Props = $props();

  function handleDestinationInput(next: ImportDestination): void {
    if (next !== destination) onDestinationChange(next);
  }

  function handleTagsInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    onTagsInputChange(target.value);
  }

  /**
   * Preview tokens as the user types — same normalization rules the
   * orchestrator applies (trim, strip leading `#`, drop empties, de-dupe
   * case-insensitively). Shown as chips so the user can see what will
   * actually be written to frontmatter.
   */
  const tagPreview = $derived.by(() => {
    if (!tagsInput) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tagsInput.split(',')) {
      const trimmed = raw.trim().replace(/^#+/, '').trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  });
</script>

<div class="sa-ig-preflight">
  {#if files.length === 0}
    <ImportFilePicker {onFilesSelected} />
    <p class="sa-ig-preflight__disclaimer">
      Pick one or more .zip parts exported by the Social Archiver Chrome extension.
      Files are read locally; media uploads only start after you click Import.
    </p>
  {:else}
    <div class="sa-ig-preflight__files" aria-label="Selected files">
      {#each files as file (file.name)}
        {@const match = preflight?.parts.find((p) => p.filename === file.name) ?? null}
        {@const fileError = preflight?.errors.find((err) => err.filename === file.name) ?? null}
        <div class="sa-ig-preflight__file">
          <div class="sa-ig-preflight__file-head">
            <div class="sa-ig-preflight__file-name" title={file.name}>{file.name}</div>
            <button
              type="button"
              class="sa-ig-preflight__file-remove"
              onclick={() => onRemoveFile(file.name)}
              aria-label={`Remove ${file.name}`}
            >Remove</button>
          </div>
          {#if fileError}
            <div class="sa-ig-preflight__file-error" role="alert">{fileError.message}</div>
          {:else if match}
            <div class="sa-ig-preflight__file-meta">
              <span>{match.collection.name}</span>
              <span aria-hidden="true">·</span>
              <span>Part {match.partNumber}/{match.totalParts}</span>
              <span aria-hidden="true">·</span>
              <span>{match.counts.postsInPart} posts</span>
              {#if match.counts.partialMedia > 0}
                <span aria-hidden="true">·</span>
                <span class="sa-ig-preflight__warn">{match.counts.partialMedia} partial media</span>
              {/if}
              {#if !match.integrityOk}
                <span class="sa-ig-preflight__warn-badge" title="Checksum file missing or mismatch">
                  integrity not verified
                </span>
              {/if}
            </div>
            {#if match.warnings.length > 0}
              <ul class="sa-ig-preflight__warnings">
                {#each match.warnings as warning (warning)}
                  <li>{warning}</li>
                {/each}
              </ul>
            {/if}
          {:else if isRunningPreflight}
            <div class="sa-ig-preflight__file-meta" aria-live="polite">Validating…</div>
          {/if}
        </div>
      {/each}
    </div>

    {#if preflight && preflight.parts.length > 0}
      <div class="sa-ig-preflight__summary" aria-live="polite">
        <div class="sa-ig-preflight__stat">
          <span class="sa-ig-preflight__stat-value">{preflight.totalPostsInSelection}</span>
          <span class="sa-ig-preflight__stat-label">in selection</span>
        </div>
        <div class="sa-ig-preflight__stat-sep" aria-hidden="true"></div>
        <div class="sa-ig-preflight__stat">
          <span class="sa-ig-preflight__stat-value">{preflight.duplicateCount}</span>
          <span class="sa-ig-preflight__stat-label">already archived</span>
        </div>
        <div class="sa-ig-preflight__stat-sep" aria-hidden="true"></div>
        <div class="sa-ig-preflight__stat sa-ig-preflight__stat--accent">
          <span class="sa-ig-preflight__stat-value">{preflight.readyToImport}</span>
          <span class="sa-ig-preflight__stat-label">ready to import</span>
        </div>
        {#if preflight.partialMedia > 0}
          <div class="sa-ig-preflight__stat-sep" aria-hidden="true"></div>
          <div class="sa-ig-preflight__stat sa-ig-preflight__stat--warn">
            <span class="sa-ig-preflight__stat-value">{preflight.partialMedia}</span>
            <span class="sa-ig-preflight__stat-label">with warnings</span>
          </div>
        {/if}
      </div>
    {/if}

    {#if error}
      <div class="sa-ig-preflight__error" role="alert">{error}</div>
    {/if}

    <fieldset class="sa-ig-preflight__group" aria-label="Import destination">
      <legend class="sa-ig-preflight__group-label">Import to</legend>
      <div class="sa-ig-preflight__radio-row">
        <label class="sa-ig-preflight__radio">
          <input
            type="radio"
            name="sa-ig-destination"
            value="inbox"
            checked={destination === 'inbox'}
            onchange={() => handleDestinationInput('inbox')}
          />
          <span>
            <strong>Inbox</strong>
            <span class="sa-ig-preflight__radio-hint">Visible in the default timeline.</span>
          </span>
        </label>
        <label class="sa-ig-preflight__radio">
          <input
            type="radio"
            name="sa-ig-destination"
            value="archive"
            checked={destination === 'archive'}
            onchange={() => handleDestinationInput('archive')}
          />
          <span>
            <strong>Archive</strong>
            <span class="sa-ig-preflight__radio-hint">Hidden from Inbox, reachable in Archive/All tabs.</span>
          </span>
        </label>
      </div>
    </fieldset>

    <div class="sa-ig-preflight__group">
      <label for="sa-ig-tags" class="sa-ig-preflight__group-label">
        Tags <span class="sa-ig-preflight__group-hint">(comma separated — applied to every imported post)</span>
      </label>
      <input
        id="sa-ig-tags"
        type="text"
        class="sa-ig-preflight__tags-input"
        placeholder="e.g. ig/saved, inspiration, travel"
        value={tagsInput}
        oninput={handleTagsInput}
        autocomplete="off"
        spellcheck="false"
      />
      {#if tagPreview.length > 0}
        <div class="sa-ig-preflight__tag-chips" aria-live="polite">
          {#each tagPreview as tag (tag)}
            <span class="sa-ig-preflight__tag-chip">#{tag}</span>
          {/each}
        </div>
      {/if}
    </div>

    <p class="sa-ig-preflight__disclaimer">
      Keep the source .zip files in place until the import completes. You can
      close this window and the job will continue in the background.
    </p>

    {#if importButtonEnabled || isRunningPreflight}
      {@const readyCount = preflight?.readyToImport ?? 0}
      <div class="sa-ig-preflight__actions">
        <button
          type="button"
          class="sa-ig-preflight__btn sa-ig-preflight__btn--ghost"
          onclick={onCancel}
        >Cancel</button>
        <div class="sa-ig-preflight__actions-cta">
          <button
            type="button"
            class="sa-ig-preflight__btn sa-ig-preflight__btn--ghost"
            disabled={!importButtonEnabled || isLoadingGallery}
            onclick={onSkipReview}
          >
            {isRunningPreflight
              ? 'Validating…'
              : `Skip review · Import all ${readyCount}`}
          </button>
          <button
            type="button"
            class="sa-ig-preflight__btn sa-ig-preflight__btn--cta"
            disabled={!importButtonEnabled || isLoadingGallery}
            onclick={onReviewPosts}
          >
            {isLoadingGallery ? 'Loading…' : 'Review posts'}
          </button>
        </div>
      </div>
    {:else if preflight}
      <div class="sa-ig-preflight__actions">
        <button
          type="button"
          class="sa-ig-preflight__btn sa-ig-preflight__btn--cta"
          onclick={onCancel}
        >
          Close
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .sa-ig-preflight {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .sa-ig-preflight__files {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 40vh;
    overflow-y: auto;
  }

  .sa-ig-preflight__file {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--background-modifier-border, #ccc);
    border-radius: var(--radius-s, 4px);
    background: var(--background-primary, transparent);
  }

  .sa-ig-preflight__file-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .sa-ig-preflight__file-name {
    font-family: var(--font-monospace, monospace);
    font-size: var(--font-ui-smaller, 0.85rem);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .sa-ig-preflight__file-remove.sa-ig-preflight__file-remove {
    appearance: none;
    min-height: 28px;
    padding: 4px 10px;
    font-size: 0.8rem;
    background: transparent;
    border: none;
    box-shadow: none;
    border-radius: var(--radius-s, 4px);
    color: var(--text-muted, #777);
    cursor: pointer;
    font-weight: 500;
    transition: background 100ms ease, color 100ms ease;
  }

  .sa-ig-preflight__file-remove.sa-ig-preflight__file-remove:hover {
    color: var(--text-error, #e74c3c);
    background: var(--background-modifier-hover, rgba(0, 0, 0, 0.06));
    border: none;
    box-shadow: none;
  }

  .sa-ig-preflight__file-remove.sa-ig-preflight__file-remove:focus-visible {
    outline: 2px solid var(--interactive-accent, #3b82f6);
    outline-offset: 2px;
    border: none;
  }

  .sa-ig-preflight__file-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    font-size: var(--font-ui-smaller, 0.85rem);
    color: var(--text-muted, #777);
  }

  .sa-ig-preflight__warn {
    color: var(--text-warning, #f0932b);
  }

  .sa-ig-preflight__warn-badge {
    margin-left: 0.25rem;
    padding: 0 0.375rem;
    border-radius: 999px;
    background: var(--background-modifier-error-hover, rgba(240, 147, 43, 0.15));
    color: var(--text-warning, #f0932b);
    font-size: var(--font-ui-smaller, 0.75rem);
  }

  .sa-ig-preflight__warnings {
    margin: 0;
    padding-left: 1rem;
    font-size: var(--font-ui-smaller, 0.85rem);
    color: var(--text-muted, #777);
  }

  .sa-ig-preflight__file-error {
    color: var(--text-error, #e74c3c);
    font-size: var(--font-ui-smaller, 0.85rem);
  }

  .sa-ig-preflight__summary {
    padding: 0.5rem 0.75rem;
    background: var(--background-secondary, transparent);
    border-radius: var(--radius-s, 4px);
    font-size: var(--font-ui, 0.9rem);
  }

  .sa-ig-preflight__error {
    color: var(--text-error, #e74c3c);
    font-size: var(--font-ui-smaller, 0.85rem);
  }

  .sa-ig-preflight__group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    border: none;
    padding: 0;
    margin: 0;
  }

  .sa-ig-preflight__group-label {
    font-size: var(--font-ui-smaller, 0.85rem);
    font-weight: var(--font-semibold, 600);
  }

  .sa-ig-preflight__group-hint {
    color: var(--text-muted, #777);
    font-weight: var(--font-normal, 400);
  }

  .sa-ig-preflight__radio-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .sa-ig-preflight__radio {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    flex: 1 1 200px;
    min-height: 44px;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--background-modifier-border, #ccc);
    border-radius: var(--radius-s, 4px);
    background: var(--background-primary, transparent);
    cursor: pointer;
    font-size: var(--font-ui-smaller, 0.85rem);
  }

  .sa-ig-preflight__radio input[type="radio"] {
    margin-top: 0.15rem;
  }

  .sa-ig-preflight__radio-hint {
    display: block;
    color: var(--text-muted, #777);
    font-weight: var(--font-normal, 400);
    margin-top: 0.125rem;
  }

  .sa-ig-preflight__tags-input {
    width: 100%;
    min-height: 40px;
    padding: 0 0.625rem;
    border: 1px solid var(--background-modifier-border, #ccc);
    border-radius: var(--radius-s, 4px);
    background: var(--background-primary, transparent);
    color: var(--text-normal, #222);
    font-size: var(--font-ui, 0.9rem);
  }

  .sa-ig-preflight__tag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .sa-ig-preflight__tag-chip {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--background-modifier-hover, rgba(0, 0, 0, 0.05));
    color: var(--text-muted, #777);
    font-size: var(--font-ui-smaller, 0.8rem);
    font-family: var(--font-monospace, monospace);
  }

  .sa-ig-preflight__disclaimer {
    margin: 0;
    font-size: var(--font-ui-smaller, 0.8rem);
    color: var(--text-muted, #777);
  }

  .sa-ig-preflight__actions {
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
  }

  .sa-ig-preflight__actions-cta {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-left: auto;
  }

  .sa-ig-preflight__btn {
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

  .sa-ig-preflight__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Borderless ghost variant — Cancel + Skip review. The filled accent is
     reserved for the primary "Review posts" CTA so the focal action is
     unambiguous. Double-class spec bump beats Obsidian button defaults. */
  .sa-ig-preflight__btn--ghost.sa-ig-preflight__btn--ghost {
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted, #777);
  }

  .sa-ig-preflight__btn--ghost.sa-ig-preflight__btn--ghost:hover:not(:disabled) {
    background: var(--background-modifier-hover, rgba(0, 0, 0, 0.06));
    color: var(--text-normal, #222);
    border: none;
    box-shadow: none;
  }

  .sa-ig-preflight__btn--ghost.sa-ig-preflight__btn--ghost:focus-visible {
    outline: 2px solid var(--interactive-accent, #3b82f6);
    outline-offset: 2px;
    border: none;
  }

  .sa-ig-preflight__btn--cta {
    background: var(--interactive-accent, #3b82f6);
    border-color: var(--interactive-accent, #3b82f6);
    color: var(--text-on-accent, #fff);
    padding: 0 1.25rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .sa-ig-preflight__btn--cta:hover:not(:disabled) {
    background: var(--interactive-accent-hover, var(--interactive-accent, #3b82f6));
    border-color: var(--interactive-accent-hover, var(--interactive-accent, #3b82f6));
  }

  .sa-ig-preflight__btn--cta:focus-visible {
    outline: 2px solid var(--text-on-accent, #fff);
    outline-offset: -4px;
  }
</style>
