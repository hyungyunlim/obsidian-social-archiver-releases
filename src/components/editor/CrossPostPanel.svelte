<script lang="ts">
/**
 * CrossPostPanel - Collapsible cross-posting panel for PostComposer
 *
 * Sits between the editor body and footer in PostComposer.
 * Provides a compact, collapsible UI for cross-posting to social platforms.
 *
 * Responsibilities:
 * - Expand / collapse toggle state
 * - Deriving transformedText and effectiveText from markdownContent
 * - Aggregating child state into CrossPostPanelState for the parent
 * - Conditionally rendering PlatformToggle, CrossPostPreview, CrossPostResult
 *
 * Single Responsibility: Panel orchestration only. Individual platform
 * concerns live in PlatformToggle and CrossPostPreview.
 */

import { untrack } from 'svelte';
import type { ThreadsReplyControl, CrossPostResponse } from '@/types/crosspost';
import PlatformToggle from './PlatformToggle.svelte';
import CrossPostPreview from './CrossPostPreview.svelte';
import { ContentTransformerClient } from '@/utils/ContentTransformerClient';

// ─── Exported types ──────────────────────────────────────────────────────────

/**
 * Aggregated panel state that PostComposer reads to:
 * 1. Decide whether to show the "Post & Publish to Threads" button label
 * 2. Pass platform options to the cross-post API call
 */
export interface CrossPostPanelState {
  hasEnabledPlatforms: boolean;
  /** Ordered list of enabled platform ids, e.g. ['threads'] */
  enabledPlatforms: string[];
  threadsEnabled: boolean;
  /** Set only when the user has edited the platform text */
  threadsCustomText?: string;
  threadsReplyControl: ThreadsReplyControl;
  /** false when any enabled platform exceeds its character limit */
  isValid: boolean;
}

// ─── Component props ──────────────────────────────────────────────────────────

interface Props {
  /** Raw markdown string from MarkdownEditor */
  markdownContent: string;

  /** Threads OAuth connection state */
  threadsConnected: boolean;
  threadsUsername?: string;
  threadsTokenStatus?: 'valid' | 'expiring_soon' | 'expired' | 'error';

  /** Called when user taps the "Connect" prompt for a platform */
  onConnect?: (platform: string) => void;

  /**
   * Fired on every state change so PostComposer can update the submit button
   * label and include cross-post options in the post request.
   */
  onStateChange?: (state: CrossPostPanelState) => void;
}

let {
  markdownContent = '',
  threadsConnected = false,
  threadsUsername,
  threadsTokenStatus = 'valid',
  onConnect,
  onStateChange,
}: Props = $props();

// ─── Panel-level state ───────────────────────────────────────────────────────

/** Whether the panel body is visible */
let isExpanded = $state(false);

/** Threads platform enabled toggle */
let threadsEnabled = $state(false);

/**
 * Platform-specific custom text override.
 * - undefined  → Synced mode: use auto-transformed text
 * - string     → Customized mode: user has edited the text
 */
let threadsCustomText = $state<string | undefined>(undefined);

/** Whether the user has provided a custom override */
const isCustomized = $derived(threadsCustomText !== undefined);

/** Reply / audience control for Threads */
let threadsReplyControl = $state<ThreadsReplyControl>('everyone');

/** Result stored after a successful or failed cross-post */
let postResult = $state<CrossPostResponse | null>(null);

// ─── Character-count constants ────────────────────────────────────────────────

const THREADS_MAX_CHARS = 500;

// ─── Derived text values ──────────────────────────────────────────────────────

/**
 * Plain-text conversion of the markdown content.
 * Recalculated reactively whenever markdownContent changes.
 */
const transformedText = $derived(
  ContentTransformerClient.stripMarkdown(markdownContent)
);

/**
 * The text that will actually be posted:
 * custom text if the user overrode it, otherwise the auto-transformed version.
 */
const effectiveText = $derived(
  isCustomized ? (threadsCustomText ?? '') : transformedText
);

/** Current character count of what will be posted */
const characterCount = $derived(effectiveText.length);

/** true while within the Threads 500-char limit (or Threads is not enabled) */
const isValid = $derived(
  !threadsEnabled || characterCount <= THREADS_MAX_CHARS
);

// ─── Aggregated state ─────────────────────────────────────────────────────────

const enabledPlatforms = $derived<string[]>(
  threadsEnabled ? ['threads'] : []
);

const hasEnabledPlatforms = $derived(enabledPlatforms.length > 0);

// ─── Collapsed-header summary ─────────────────────────────────────────────────

/**
 * One-line summary shown inside the header when collapsed.
 * Returns empty string when no platforms are enabled.
 */
const collapsedSummary = $derived((): string => {
  if (!threadsEnabled) return '';
  const over = characterCount > THREADS_MAX_CHARS;
  const countLabel = over
    ? `${characterCount}/${THREADS_MAX_CHARS} ⚠`
    : `${characterCount}/${THREADS_MAX_CHARS}`;
  return `🧵 Threads ✓  ${countLabel}`;
});

// ─── State propagation to parent ─────────────────────────────────────────────

/**
 * Keep the parent in sync any time panel state changes.
 * untrack is used on the callback invocation to avoid re-triggering when the
 * parent swaps the callback reference during its own render cycle.
 */
$effect(() => {
  const state: CrossPostPanelState = {
    hasEnabledPlatforms,
    enabledPlatforms,
    threadsEnabled,
    threadsCustomText: isCustomized ? threadsCustomText : undefined,
    threadsReplyControl,
    isValid,
  };
  untrack(() => onStateChange?.(state));
});

// ─── Event handlers ───────────────────────────────────────────────────────────

function toggleExpanded(): void {
  isExpanded = !isExpanded;
}

/**
 * Handle toggle from PlatformToggle.
 * If the user tries to enable Threads when it's not connected, delegate to
 * the parent's connect flow instead of enabling.
 */
function handleThreadsToggle(enabled: boolean): void {
  if (enabled && !threadsConnected) {
    onConnect?.('threads');
    return;
  }
  threadsEnabled = enabled;
}

/** Store custom text from CrossPostPreview textarea */
function handleCustomTextChange(text: string): void {
  threadsCustomText = text;
}

/** Reset custom text — switch back to auto-synced mode */
function handleResetToAuto(): void {
  threadsCustomText = undefined;
}
</script>

<!-- ─── Template ──────────────────────────────────────────────────────────── -->

<div class="crosspost-panel">
  <!-- ── Header row (always visible) ─────────────────────────────────────── -->
  <button
    type="button"
    class="crosspost-header"
    onclick={toggleExpanded}
    aria-expanded={isExpanded}
    aria-controls="crosspost-body"
  >
    <!-- Decorative label -->
    <span class="header-label">Cross-Post</span>

    <!-- One-line summary — visible only when collapsed and at least one platform is on -->
    {#if !isExpanded && collapsedSummary()}
      <span
        class="collapsed-summary"
        class:over-limit={characterCount > THREADS_MAX_CHARS}
      >
        {collapsedSummary()}
      </span>
    {/if}

    <!-- Spacer pushes chevron to the right -->
    <span class="header-spacer" aria-hidden="true"></span>

    <!-- Expand / collapse chevron -->
    <span class="header-chevron" aria-hidden="true">
      {#if isExpanded}
        <!-- Up chevron -->
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m18 15-6-6-6 6"/>
        </svg>
      {:else}
        <!-- Down chevron -->
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      {/if}
    </span>
  </button>

  <!-- ── Expandable body ────────────────────────────────────────────────── -->
  {#if isExpanded}
    <div id="crosspost-body" class="crosspost-body">

      <!-- Threads platform row -->
      <PlatformToggle
        platform="threads"
        enabled={threadsEnabled}
        connected={threadsConnected}
        username={threadsUsername}
        tokenStatus={threadsTokenStatus}
        {characterCount}
        maxCharacters={THREADS_MAX_CHARS}
        {isCustomized}
        onToggle={handleThreadsToggle}
        onConnect={() => onConnect?.('threads')}
      />

      <!-- Preview + inline editor — only when Threads is enabled -->
      {#if threadsEnabled}
        <CrossPostPreview
          platform="threads"
          {transformedText}
          {effectiveText}
          maxCharacters={THREADS_MAX_CHARS}
          {isCustomized}
          onTextChange={handleCustomTextChange}
          onReset={handleResetToAuto}
        />
      {/if}

      <!-- Post result — shown inline after a cross-post completes -->
      {#if postResult}
        <div class="result-section">
          {#if postResult.results.threads}
            {#if postResult.results.threads.status === 'posted'}
              <div class="result-row result-success">
                <span class="result-icon" aria-hidden="true">✅</span>
                <span class="result-label">Threads: Posted</span>
                {#if postResult.results.threads.postUrl}
                  <a
                    href={postResult.results.threads.postUrl}
                    class="result-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open
                  </a>
                {/if}
              </div>
            {:else}
              <div class="result-row result-error">
                <span class="result-icon" aria-hidden="true">❌</span>
                <span class="result-label">
                  Threads: {postResult.results.threads.error ?? 'Failed'}
                </span>
                <button
                  type="button"
                  class="btn-retry"
                  onclick={() => { postResult = null; }}
                >
                  Retry
                </button>
              </div>
            {/if}
          {/if}
        </div>
      {/if}

    </div>
  {/if}
</div>

<!-- ─── Styles ─────────────────────────────────────────────────────────────── -->

<style>
  /* ── Container ─────────────────────────────────────────────────────────── */
  .crosspost-panel {
    display: flex;
    flex-direction: column;
    /* Visually separates from the editor body above and footer below */
    border-top: 1px solid var(--background-modifier-border);
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
  }

  /* ── Header button ──────────────────────────────────────────────────────── */
  .crosspost-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    /* Reset browser button styles */
    background: none;
    border: none;
    padding: 5px 12px;
    cursor: pointer;
    /* Adequate touch target */
    min-height: 32px;
    text-align: left;
    transition: background 0.12s ease;
    color: inherit;
  }

  .crosspost-header:hover {
    background: var(--background-modifier-hover);
  }

  .crosspost-header:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: -2px;
    border-radius: 3px;
  }

  /* Section divider label */
  .header-label {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  /* One-line summary when collapsed */
  .collapsed-summary {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
  }

  .collapsed-summary.over-limit {
    color: var(--text-error);
    font-weight: 500;
  }

  /* Push chevron flush right */
  .header-spacer {
    flex: 1;
  }

  .header-chevron {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-faint);
    opacity: 0.7;
  }

  /* ── Expandable body ─────────────────────────────────────────────────────── */
  .crosspost-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px 10px;
    background: var(--background-secondary);
    /* Subtle entrance animation */
    animation: cp-slide-in 0.14s ease;
  }

  @keyframes cp-slide-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* ── Inline result section ─────────────────────────────────────────────── */
  .result-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
    padding: 8px 10px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 5px;
  }

  .result-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }

  .result-icon {
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1;
  }

  .result-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-success .result-label {
    color: var(--text-normal);
  }

  .result-error .result-label {
    color: var(--text-error);
  }

  .result-link {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--interactive-accent);
    text-decoration: none;
  }

  .result-link:hover {
    text-decoration: underline;
  }

  .btn-retry {
    flex-shrink: 0;
    padding: 2px 8px;
    background: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    min-height: 28px;
    transition: border-color 0.12s, color 0.12s;
  }

  .btn-retry:hover {
    border-color: var(--interactive-accent);
    color: var(--interactive-accent);
  }

  /* ── Reduced motion ─────────────────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .crosspost-body {
      animation: none;
    }
    .crosspost-header,
    .btn-retry {
      transition: none;
    }
  }
</style>
