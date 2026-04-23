<script lang="ts">
  /**
   * ImportCompletion — final summary pane (PRD §5.3).
   *
   * Shows imported / warnings / skipped / failed counts and surfaces a deep
   * link to the most recently imported archive note.
   */

  type Summary = {
    imported: number;
    importedWithWarnings: number;
    skippedDuplicates: number;
    failed: number;
    /**
     * Posts the user explicitly opted out of via the Review Gallery
     * (PRD prd-instagram-import-gallery.md F4.5). Absent / 0 for the
     * `Skip review` path.
     */
    intentionallyExcluded?: number;
  };

  type Props = {
    summary: Summary | null;
    hasDeepLink: boolean;
    hasFailed: boolean;
    onOpenLastArchive: () => void;
    onViewFailed: () => void | Promise<void>;
    onImportAnother: () => void;
    onDone: () => void;
  };

  let {
    summary,
    hasDeepLink,
    hasFailed,
    onOpenLastArchive,
    onViewFailed,
    onImportAnother,
    onDone,
  }: Props = $props();

  // "Delete source .zip files" opt-in per PRD §5.3.1 — we surface the checkbox
  // only; actual cleanup is owned by the orchestrator. Default is unchecked.
  let deleteSources = $state(false);
</script>

<div class="sa-ig-completion">
  <h3 class="sa-ig-completion__title">Import complete</h3>

  {#if summary}
    <div class="sa-ig-completion__stats">
      <div class="sa-ig-completion__stat">
        <span class="sa-ig-completion__stat-label">Imported</span>
        <span class="sa-ig-completion__stat-value">{summary.imported}</span>
      </div>
      <div class="sa-ig-completion__stat">
        <span class="sa-ig-completion__stat-label">With warnings</span>
        <span class="sa-ig-completion__stat-value">{summary.importedWithWarnings}</span>
      </div>
      <div class="sa-ig-completion__stat">
        <span class="sa-ig-completion__stat-label">Duplicates</span>
        <span class="sa-ig-completion__stat-value">{summary.skippedDuplicates}</span>
      </div>
      <div
        class="sa-ig-completion__stat"
        class:sa-ig-completion__stat--failed={summary.failed > 0}
      >
        <span class="sa-ig-completion__stat-label">Failed</span>
        <span class="sa-ig-completion__stat-value">{summary.failed}</span>
      </div>
    </div>
    {#if (summary.intentionallyExcluded ?? 0) > 0}
      <p class="sa-ig-completion__excluded" aria-live="polite">
        {summary.intentionallyExcluded} posts intentionally excluded by you
      </p>
    {/if}
  {:else}
    <div class="sa-ig-completion__empty">No summary available.</div>
  {/if}

  <label class="sa-ig-completion__delete-opt">
    <input type="checkbox" bind:checked={deleteSources} />
    Delete source .zip files when I click Done
  </label>

  <div class="sa-ig-completion__actions">
    {#if hasDeepLink}
      <button type="button" class="sa-ig-completion__btn" onclick={onOpenLastArchive}>
        Open most recent imported archive
      </button>
    {/if}
    {#if hasFailed}
      <button type="button" class="sa-ig-completion__btn" onclick={onViewFailed}>
        View failed items
      </button>
    {/if}
    <button type="button" class="sa-ig-completion__btn" onclick={onImportAnother}>
      Import another
    </button>
    <button type="button" class="sa-ig-completion__btn sa-ig-completion__btn--cta" onclick={onDone}>
      Done
    </button>
  </div>
</div>

<style>
  .sa-ig-completion {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .sa-ig-completion__title {
    margin: 0;
    font-size: var(--font-ui, 1rem);
    font-weight: var(--font-bold, 600);
  }

  .sa-ig-completion__stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 0.5rem;
  }

  .sa-ig-completion__stat {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.75rem;
    background: var(--background-secondary, transparent);
    border-radius: var(--radius-s, 4px);
  }

  .sa-ig-completion__stat-label {
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted, #777);
  }

  .sa-ig-completion__stat-value {
    font-size: var(--font-ui-larger, 1.15rem);
    font-weight: var(--font-bold, 600);
  }

  .sa-ig-completion__stat--failed .sa-ig-completion__stat-value {
    color: var(--text-error, #e74c3c);
  }

  .sa-ig-completion__empty {
    color: var(--text-muted, #777);
  }

  .sa-ig-completion__excluded {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--background-secondary, transparent);
    border-radius: var(--radius-s, 4px);
    color: var(--text-muted, #777);
    font-size: var(--font-ui-smaller, 0.85rem);
  }

  .sa-ig-completion__delete-opt {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: var(--font-ui-smaller, 0.85rem);
    color: var(--text-muted, #777);
  }

  .sa-ig-completion__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .sa-ig-completion__btn {
    min-height: 44px;
    padding: 0 1rem;
    border: 1px solid var(--background-modifier-border, #ccc);
    background: var(--background-primary, transparent);
    color: var(--text-normal, #222);
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
    font-size: var(--font-ui, 0.9rem);
  }

  .sa-ig-completion__btn--cta {
    background: var(--interactive-accent, #3b82f6);
    border-color: var(--interactive-accent, #3b82f6);
    color: var(--text-on-accent, #fff);
  }
</style>
