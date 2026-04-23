<script lang="ts">
  /**
   * ImportProgress — progress pane (PRD §5.3).
   *
   * Shows overall progress bar, per-outcome counters, throughput, current
   * item, and pause/resume/cancel controls. Closing the modal keeps the
   * import running — PRD §5.3.1 non-blocking vault requirement.
   */

  import type { ImportJobState } from '../../types/import';

  type Props = {
    job: ImportJobState | null;
    completedItems: number;
    totalItems: number;
    partialMediaItems: number;
    skippedDuplicates: number;
    failedItems: number;
    progressPct: number;
    throughputPerSec: number;
    currentItemPostId: string | null;
    onPause: () => void | Promise<void>;
    onResume: () => void | Promise<void>;
    onCancel: () => void | Promise<void>;
    onClose: () => void;
  };

  let {
    job,
    completedItems,
    totalItems,
    partialMediaItems,
    skippedDuplicates,
    failedItems,
    progressPct,
    throughputPerSec,
    currentItemPostId,
    onPause,
    onResume,
    onCancel,
    onClose,
  }: Props = $props();

  const importedNet = $derived(Math.max(0, completedItems - skippedDuplicates - failedItems - partialMediaItems));
  const isPaused = $derived(job?.status === 'paused');
  const isRunning = $derived(job?.status === 'running');

  const statusLabel = $derived.by(() => {
    if (!job) return 'Starting…';
    if (job.status === 'queued') return 'Queued';
    if (job.status === 'paused') return 'Paused';
    if (job.status === 'running') {
      return currentItemPostId ? `Uploading post ${currentItemPostId}…` : 'Running…';
    }
    if (job.status === 'cancelled') return 'Cancelled';
    if (job.status === 'failed') return `Failed: ${job.lastError ?? 'unknown error'}`;
    return '';
  });
</script>

<div class="sa-ig-progress">
  <div class="sa-ig-progress__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progressPct}>
    <div class="sa-ig-progress__bar-fill" style:width={`${progressPct}%`}></div>
  </div>
  <div class="sa-ig-progress__count">
    {completedItems} / {totalItems} processed
    {#if throughputPerSec > 0}
      <span class="sa-ig-progress__throughput">· {throughputPerSec.toFixed(1)} posts/sec</span>
    {/if}
  </div>

  <div class="sa-ig-progress__counters" aria-live="polite">
    <div class="sa-ig-progress__counter">
      <span class="sa-ig-progress__counter-label">Imported</span>
      <span class="sa-ig-progress__counter-value">{importedNet}</span>
    </div>
    <div class="sa-ig-progress__counter">
      <span class="sa-ig-progress__counter-label">With warnings</span>
      <span class="sa-ig-progress__counter-value">{partialMediaItems}</span>
    </div>
    <div class="sa-ig-progress__counter">
      <span class="sa-ig-progress__counter-label">Duplicates</span>
      <span class="sa-ig-progress__counter-value">{skippedDuplicates}</span>
    </div>
    <div class="sa-ig-progress__counter sa-ig-progress__counter--failed">
      <span class="sa-ig-progress__counter-label">Failed</span>
      <span class="sa-ig-progress__counter-value">{failedItems}</span>
    </div>
  </div>

  <div class="sa-ig-progress__status" aria-live="polite">{statusLabel}</div>

  <div class="sa-ig-progress__actions">
    {#if isPaused}
      <button type="button" class="sa-ig-progress__btn" onclick={onResume}>Resume</button>
    {:else}
      <button type="button" class="sa-ig-progress__btn" onclick={onPause} disabled={!isRunning}>Pause</button>
    {/if}
    <button type="button" class="sa-ig-progress__btn sa-ig-progress__btn--danger" onclick={onCancel}>
      Cancel
    </button>
    <button type="button" class="sa-ig-progress__btn" onclick={onClose}>Close</button>
  </div>

  <p class="sa-ig-progress__note">
    You can close this and the import will keep running. Open the command
    palette and re-run "Import Instagram Saved Export" to view live progress.
  </p>
</div>

<style>
  .sa-ig-progress {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .sa-ig-progress__bar {
    position: relative;
    height: 8px;
    background: var(--background-modifier-border, #e5e7eb);
    border-radius: 999px;
    overflow: hidden;
  }

  .sa-ig-progress__bar-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--interactive-accent, #3b82f6);
    transition: width 240ms ease;
  }

  .sa-ig-progress__count {
    font-size: var(--font-ui-smaller, 0.85rem);
    color: var(--text-muted, #777);
  }

  .sa-ig-progress__throughput {
    margin-left: 0.25rem;
  }

  .sa-ig-progress__counters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.5rem;
  }

  .sa-ig-progress__counter {
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.75rem;
    background: var(--background-secondary, transparent);
    border-radius: var(--radius-s, 4px);
  }

  .sa-ig-progress__counter-label {
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted, #777);
  }

  .sa-ig-progress__counter-value {
    font-size: var(--font-ui-larger, 1.15rem);
    font-weight: var(--font-bold, 600);
  }

  .sa-ig-progress__counter--failed .sa-ig-progress__counter-value {
    color: var(--text-error, #e74c3c);
  }

  .sa-ig-progress__status {
    font-size: var(--font-ui-smaller, 0.85rem);
    color: var(--text-muted, #777);
    font-family: var(--font-monospace, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sa-ig-progress__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .sa-ig-progress__btn {
    min-height: 44px;
    padding: 0 1rem;
    border: 1px solid var(--background-modifier-border, #ccc);
    background: var(--background-primary, transparent);
    color: var(--text-normal, #222);
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
    font-size: var(--font-ui, 0.9rem);
  }

  .sa-ig-progress__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sa-ig-progress__btn--danger {
    color: var(--text-error, #e74c3c);
  }

  .sa-ig-progress__note {
    margin: 0;
    font-size: var(--font-ui-smaller, 0.8rem);
    color: var(--text-muted, #777);
  }
</style>
