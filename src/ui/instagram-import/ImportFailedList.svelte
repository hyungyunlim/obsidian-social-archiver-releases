<script lang="ts">
  /**
   * ImportFailedList — per-item detail of failed and warning items (PRD §5.3).
   *
   * Surfaced from the completion pane via the "View failed items" button.
   */

  import type { ImportItem } from '../../types/import';

  type Props = {
    items: ImportItem[];
    loading: boolean;
    onBack: () => void;
    onRetryItem: (postId: string) => void | Promise<void>;
  };

  let { items, loading, onBack, onRetryItem }: Props = $props();

  const problemItems = $derived(
    items.filter((item) => item.status === 'failed' || item.status === 'imported_with_warnings'),
  );
</script>

<div class="sa-ig-failed">
  <div class="sa-ig-failed__head">
    <button type="button" class="sa-ig-failed__back" onclick={onBack} aria-label="Back to summary">
      &larr; Back
    </button>
    <h3 class="sa-ig-failed__title">Items needing attention</h3>
  </div>

  {#if loading}
    <div class="sa-ig-failed__loading" aria-live="polite">Loading items…</div>
  {:else if problemItems.length === 0}
    <div class="sa-ig-failed__empty">No failed or warning items. Nice.</div>
  {:else}
    <ul class="sa-ig-failed__list">
      {#each problemItems as item (item.postId)}
        <li class="sa-ig-failed__item">
          <div class="sa-ig-failed__item-head">
            <div class="sa-ig-failed__item-id">
              <span class="sa-ig-failed__item-shortcode">{item.shortcode}</span>
              <span
                class="sa-ig-failed__item-badge"
                class:sa-ig-failed__item-badge--fail={item.status === 'failed'}
                class:sa-ig-failed__item-badge--warn={item.status === 'imported_with_warnings'}
              >{item.status === 'failed' ? 'failed' : 'warnings'}</span>
            </div>
            {#if item.status === 'failed'}
              <button type="button" class="sa-ig-failed__retry" onclick={() => onRetryItem(item.postId)}>
                Retry
              </button>
            {/if}
          </div>
          {#if item.errorMessage}
            <div class="sa-ig-failed__item-error">{item.errorMessage}</div>
          {/if}
          <div class="sa-ig-failed__item-meta">
            <span>Part: {item.partFilename}</span>
            {#if item.retryCount > 0}
              <span aria-hidden="true">·</span>
              <span>Retries: {item.retryCount}</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .sa-ig-failed {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .sa-ig-failed__head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .sa-ig-failed__back {
    min-height: 36px;
    padding: 0 0.5rem;
    background: transparent;
    border: 1px solid var(--background-modifier-border, #ccc);
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
    font-size: var(--font-ui-smaller, 0.85rem);
  }

  .sa-ig-failed__title {
    margin: 0;
    font-size: var(--font-ui, 1rem);
    font-weight: var(--font-bold, 600);
  }

  .sa-ig-failed__loading,
  .sa-ig-failed__empty {
    padding: 1rem;
    text-align: center;
    color: var(--text-muted, #777);
  }

  .sa-ig-failed__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-height: 55vh;
    overflow-y: auto;
  }

  .sa-ig-failed__item {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--background-modifier-border, #ccc);
    border-radius: var(--radius-s, 4px);
  }

  .sa-ig-failed__item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .sa-ig-failed__item-id {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .sa-ig-failed__item-shortcode {
    font-family: var(--font-monospace, monospace);
  }

  .sa-ig-failed__item-badge {
    padding: 0 0.375rem;
    border-radius: 999px;
    font-size: var(--font-ui-smaller, 0.75rem);
    background: var(--background-modifier-border, #eee);
  }

  .sa-ig-failed__item-badge--fail {
    background: var(--background-modifier-error, rgba(231, 76, 60, 0.15));
    color: var(--text-error, #e74c3c);
  }

  .sa-ig-failed__item-badge--warn {
    background: rgba(240, 147, 43, 0.15);
    color: var(--text-warning, #f0932b);
  }

  .sa-ig-failed__retry {
    min-height: 32px;
    padding: 0 0.5rem;
    background: var(--background-primary, transparent);
    border: 1px solid var(--background-modifier-border, #ccc);
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
    font-size: var(--font-ui-smaller, 0.85rem);
  }

  .sa-ig-failed__item-error {
    margin-top: 0.25rem;
    color: var(--text-error, #e74c3c);
    font-size: var(--font-ui-smaller, 0.85rem);
  }

  .sa-ig-failed__item-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    margin-top: 0.25rem;
    color: var(--text-muted, #777);
    font-size: var(--font-ui-smaller, 0.8rem);
  }
</style>
