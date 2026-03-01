<script lang="ts">
/**
 * CrossPostResult - Post-submission results display
 *
 * Shows the outcome for each platform after cross-posting:
 * - Success: "Threads: Posted — [Open]" link
 * - Failure: "Threads: Failed — {error}" + [Retry] button
 *
 * Features:
 * - Dismiss (×) button in top-right
 * - Fade-in entry animation
 * - Callout/notice box styled with Obsidian CSS variables
 * - Respects prefers-reduced-motion
 */

import type { CrossPostResponse, CrossPostPlatformResult } from '@/types/crosspost';

/**
 * Component props
 *
 * CrossPostPanel passes:
 *   result: CrossPostResponse      — the full API response
 *   onRetry?: () => void           — called when user taps Retry (panel resets result)
 *   onDismiss?: () => void         — called when user taps ×
 */
interface Props {
  result: CrossPostResponse;
  onRetry?: () => void;
  onDismiss?: () => void;
}

let {
  result,
  onRetry,
  onDismiss
}: Props = $props();

/**
 * Platform display metadata
 */
const PLATFORM_META: Record<string, { icon: string; label: string }> = {
  threads: { icon: '🧵', label: 'Threads' }
};

/**
 * Derive an ordered list of result entries for iteration
 */
const resultEntries = $derived(
  (Object.entries(result.results) as [string, CrossPostPlatformResult | undefined][])
    .filter((entry): entry is [string, CrossPostPlatformResult] => entry[1] !== undefined)
    .map(([key, platformResult]) => ({
      platformKey: key,
      meta: PLATFORM_META[key] ?? { icon: '●', label: key },
      platformResult
    }))
);

/**
 * True when at least one platform succeeded
 */
const hasAnySuccess = $derived(
  resultEntries.some(e => e.platformResult.status === 'posted')
);

/**
 * True when at least one platform failed
 */
const hasAnyFailure = $derived(
  resultEntries.some(e => e.platformResult.status === 'failed')
);

/**
 * Determine overall callout variant for the left-border accent
 */
const calloutVariant = $derived((): 'success' | 'error' | 'mixed' => {
  if (hasAnySuccess && hasAnyFailure) return 'mixed';
  if (hasAnyFailure)                  return 'error';
  return 'success';
});
</script>

<!-- Fade-in callout box -->
<div
  class="crosspost-result"
  class:variant-success={calloutVariant() === 'success'}
  class:variant-error={calloutVariant() === 'error'}
  class:variant-mixed={calloutVariant() === 'mixed'}
  role="status"
  aria-label="Cross-post results"
  aria-live="polite"
>
  <!-- ── Header ──────────────────────────────────────────────── -->
  <div class="result-header">
    <span class="result-title">
      {#if calloutVariant() === 'success'}
        ✅ Posted successfully
      {:else if calloutVariant() === 'error'}
        ❌ Posting failed
      {:else}
        ⚠️ Partial success
      {/if}
    </span>

    <!-- Dismiss button -->
    {#if onDismiss}
      <button
        class="dismiss-btn"
        onclick={onDismiss}
        aria-label="Dismiss cross-post results"
        type="button"
        title="Dismiss"
      >
        ×
      </button>
    {/if}
  </div>

  <!-- ── Platform result rows ────────────────────────────────── -->
  <ul class="result-list" role="list">
    {#each resultEntries as { platformKey, meta, platformResult } (platformKey)}
      <li
        class="result-item"
        class:item-success={platformResult.status === 'posted'}
        class:item-failed={platformResult.status === 'failed'}
      >
        <!-- Status icon -->
        <span class="item-status-icon" aria-hidden="true">
          {platformResult.status === 'posted' ? '✅' : '❌'}
        </span>

        <!-- Platform identity -->
        <span class="item-platform" aria-hidden="true">
          {meta.icon} {meta.label}
        </span>

        <!-- Separator -->
        <span class="item-sep" aria-hidden="true">—</span>

        <!-- Message + action -->
        {#if platformResult.status === 'posted'}
          <span class="item-message success-message">Posted</span>
          {#if platformResult.postUrl}
            <a
              class="open-link"
              href={platformResult.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open {meta.label} post in browser"
            >
              Open ↗
            </a>
          {/if}
        {:else}
          <span
            class="item-message error-message"
            title={platformResult.error ?? 'Unknown error'}
          >
            {platformResult.error ?? 'Unknown error'}
          </span>
          {#if onRetry}
            <button
              class="retry-btn"
              onclick={onRetry}
              type="button"
              aria-label="Retry posting to {meta.label}"
            >
              Retry
            </button>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  /* ── Wrapper — fade-in on mount ────────────────────────────── */
  .crosspost-result {
    padding: 10px 14px;
    border-radius: 6px;
    border-left: 3px solid var(--interactive-accent);
    background: var(--background-secondary);
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: fade-in 0.2s ease both;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Colour variants for the left-border accent */
  .variant-success {
    border-left-color: var(--color-green, #4ade80);
    background: var(--background-modifier-success, var(--background-secondary));
  }

  .variant-error {
    border-left-color: var(--text-error);
    background: var(--background-modifier-error, var(--background-secondary));
  }

  .variant-mixed {
    border-left-color: var(--color-yellow, #fbbf24);
    background: var(--background-modifier-warning, var(--background-secondary));
  }

  /* ── Header ────────────────────────────────────────────────── */
  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 24px;
  }

  .result-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
  }

  /* Dismiss "×" button — extend touch area without inflating layout */
  .dismiss-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    padding: 0;
    margin: -8px -4px -8px 0;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 18px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    /* Extend visible click area without impacting layout */
    position: relative;
  }

  .dismiss-btn::before {
    content: '';
    position: absolute;
    inset: -8px;
    min-width: 44px;
    min-height: 44px;
  }

  .dismiss-btn:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  /* ── Result list ───────────────────────────────────────────── */
  .result-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    flex-wrap: wrap;
    min-height: 24px;
  }

  .item-status-icon {
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1;
  }

  .item-platform {
    font-weight: 500;
    color: var(--text-normal);
    flex-shrink: 0;
  }

  .item-sep {
    color: var(--text-faint);
    flex-shrink: 0;
  }

  /* ── Success row ───────────────────────────────────────────── */
  .success-message {
    color: var(--text-muted);
  }

  .open-link {
    color: var(--interactive-accent);
    text-decoration: none;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }

  .open-link:hover {
    text-decoration: underline;
    color: var(--interactive-accent-hover);
  }

  /* ── Error row ─────────────────────────────────────────────── */
  .error-message {
    color: var(--text-error);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .retry-btn {
    flex-shrink: 0;
    padding: 2px 8px;
    min-height: 28px;
    background: none;
    border: 1px solid var(--text-error);
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-error);
    cursor: pointer;
    transition: background 0.15s;
  }

  .retry-btn:hover {
    background: var(--background-modifier-error);
  }

  /* ── Mobile responsive ─────────────────────────────────────── */
  @media (max-width: 480px) {
    .result-item {
      gap: 4px;
    }

    .retry-btn {
      min-height: 44px; /* iOS HIG touch target */
      padding: 0 12px;
    }

    .error-message {
      max-width: 140px;
    }
  }

  /* ── Reduced motion ────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .crosspost-result {
      animation: none;
    }

    .retry-btn {
      transition: none;
    }
  }
</style>
