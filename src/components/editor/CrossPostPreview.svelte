<script lang="ts">
/**
 * CrossPostPreview - Real-time preview of the transformed cross-post text
 *
 * Features:
 * - Collapsible "Preview ▼ / ▲" header
 * - Shows transformedText (auto) or customText (when user has edited)
 * - Click "Edit for <Platform>" to switch to editable textarea mode
 * - "Reset to auto" reverts customisation
 * - Character count indicator with truncation notice
 * - No hardcoded colours — only Obsidian CSS variables
 */

/**
 * Component props
 *
 * Note: CrossPostPanel passes:
 *   - transformedText  (auto, for reference)
 *   - effectiveText    (what is actually sent: custom if customised, else transformed)
 *   - isCustomized
 *   - maxCharacters
 *   - onTextChange     (fires with the new custom text on every keystroke)
 *   - onReset          (fires when user resets to auto)
 */
interface Props {
  /** Auto-transformed plain-text (markdown stripped) */
  transformedText: string;
  /** The text actually shown/previewed — custom override if isCustomized, else transformedText */
  effectiveText: string;
  maxCharacters: number;
  platform?: 'threads';
  isCustomized: boolean;
  onTextChange?: (text: string) => void;
  onReset?: () => void;
}

let {
  transformedText,
  effectiveText,
  maxCharacters,
  platform = 'threads',
  isCustomized,
  onTextChange,
  onReset
}: Props = $props();

/**
 * Platform display name lookup
 */
const PLATFORM_LABEL: Record<string, string> = {
  threads: 'Threads'
};

const platformLabel = $derived(PLATFORM_LABEL[platform] ?? platform);

/**
 * Local UI state
 */
let isExpanded = $state(true);
let isEditing  = $state(false);
let editBuffer = $state('');

/**
 * Character metrics derived from effectiveText (parent owns the source of truth)
 */
const charCount    = $derived(effectiveText.length);
const isOverLimit  = $derived(charCount > maxCharacters);
const isTruncated  = $derived(charCount > maxCharacters);

/**
 * Enter edit mode — pre-fill buffer with the currently effective text
 */
function startEditing() {
  editBuffer = effectiveText;
  isEditing  = true;
}

/**
 * Propagate textarea changes to parent
 */
function handleInput(e: Event) {
  editBuffer = (e.target as HTMLTextAreaElement).value;
  onTextChange?.(editBuffer);
}

/**
 * Leave edit mode (keep changes — parent already received them via handleInput)
 */
function stopEditing() {
  isEditing = false;
}

/**
 * Reset to auto-transformed text
 */
function handleReset() {
  isEditing  = false;
  editBuffer = '';
  onReset?.();
}

/**
 * Toggle collapse
 */
function toggleExpand() {
  isExpanded = !isExpanded;
  if (!isExpanded) {
    isEditing = false;
  }
}
</script>

<div class="crosspost-preview" class:expanded={isExpanded}>
  <!-- ── Collapsible header ──────────────────────────────────── -->
  <button
    class="preview-header"
    onclick={toggleExpand}
    aria-expanded={isExpanded}
    aria-controls="preview-body"
    type="button"
  >
    <span class="header-title">
      Preview
      {#if isCustomized}
        <span class="customized-indicator" title="Using custom text">✏️</span>
      {/if}
    </span>
    <span class="header-chevron" aria-hidden="true">{isExpanded ? '▲' : '▼'}</span>
  </button>

  <!-- ── Collapsible body ───────────────────────────────────── -->
  {#if isExpanded}
    <div class="preview-body" id="preview-body">

      {#if isEditing}
        <!-- ── Edit mode: textarea ─────────────────────────── -->
        <div class="edit-mode">
          <textarea
            class="edit-textarea"
            class:over-limit={isOverLimit}
            value={editBuffer}
            oninput={handleInput}
            aria-label="Custom text for {platformLabel}"
            rows={5}
          ></textarea>
          <div class="edit-actions">
            <button
              class="btn-reset"
              onclick={handleReset}
              type="button"
              title="Revert to auto-transformed text"
            >
              Reset to auto
            </button>
            <button
              class="btn-done"
              onclick={stopEditing}
              type="button"
            >
              Done
            </button>
          </div>
        </div>
      {:else}
        <!-- ── Read mode: preview box ──────────────────────── -->
        <div
          class="preview-box"
          role="region"
          aria-label="{platformLabel} post preview"
        >
          <p class="preview-text">
            {#if isTruncated}
              {effectiveText.slice(0, maxCharacters)}<span class="truncation-ellipsis">…</span>
            {:else}
              {effectiveText || '(empty)'}
            {/if}
          </p>

          {#if isTruncated}
            <span class="truncation-badge" role="alert">
              Truncated at {maxCharacters} characters
            </span>
          {/if}
        </div>

        <!-- Edit button -->
        <button
          class="btn-edit"
          onclick={startEditing}
          type="button"
          aria-label="Edit text for {platformLabel}"
        >
          Edit for {platformLabel}
        </button>
      {/if}

      <!-- ── Character count footer ──────────────────────────── -->
      <div class="char-footer" class:over-limit={isOverLimit}>
        <span class="char-count" aria-live="polite" aria-atomic="true">
          {charCount} / {maxCharacters}
        </span>
        {#if isOverLimit}
          <span class="over-limit-label" role="alert">
            {charCount - maxCharacters} over limit
          </span>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Wrapper ───────────────────────────────────────────────── */
  .crosspost-preview {
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--background-secondary);
  }

  /* ── Header button ─────────────────────────────────────────── */
  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    min-height: 44px; /* iOS HIG touch target */
    gap: 8px;
  }

  .preview-header:hover {
    background: var(--background-modifier-hover);
  }

  .header-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .customized-indicator {
    font-size: 10px;
  }

  .header-chevron {
    font-size: 10px;
    color: var(--text-faint);
    flex-shrink: 0;
  }

  /* ── Body ──────────────────────────────────────────────────── */
  .preview-body {
    padding: 0 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ── Read mode preview box ─────────────────────────────────── */
  .preview-box {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 10px 12px;
    min-height: 64px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .preview-text {
    margin: 0;
    font-size: 13px;
    color: var(--text-normal);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .truncation-ellipsis {
    color: var(--text-muted);
    font-weight: 600;
  }

  .truncation-badge {
    display: inline-block;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--background-modifier-error);
    color: var(--text-error);
    align-self: flex-start;
  }

  /* ── Edit button ───────────────────────────────────────────── */
  .btn-edit {
    align-self: flex-start;
    padding: 4px 10px;
    min-height: 30px;
    background: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .btn-edit:hover {
    border-color: var(--interactive-accent);
    color: var(--interactive-accent);
  }

  /* ── Edit mode ─────────────────────────────────────────────── */
  .edit-mode {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .edit-textarea {
    width: 100%;
    min-height: 100px;
    padding: 8px 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 13px;
    line-height: 1.55;
    resize: vertical;
    font-family: inherit;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .edit-textarea:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .edit-textarea.over-limit {
    border-color: var(--text-error);
  }

  .edit-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .btn-reset {
    padding: 4px 10px;
    min-height: 30px;
    background: none;
    border: none;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .btn-reset:hover {
    color: var(--text-normal);
  }

  .btn-done {
    padding: 4px 14px;
    min-height: 30px;
    background: var(--interactive-accent);
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    color: white;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-done:hover {
    background: var(--interactive-accent-hover);
  }

  /* ── Character count footer ────────────────────────────────── */
  .char-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .char-count {
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .char-footer.over-limit .char-count {
    color: var(--text-error);
    font-weight: 600;
  }

  .over-limit-label {
    font-size: 11px;
    color: var(--text-error);
    font-weight: 500;
  }

  /* ── Mobile responsive ─────────────────────────────────────── */
  @media (max-width: 480px) {
    .btn-edit,
    .btn-reset,
    .btn-done {
      min-height: 44px; /* iOS HIG touch target */
    }

    .edit-actions {
      flex-direction: column-reverse;
      align-items: stretch;
    }

    .btn-done {
      text-align: center;
    }
  }

  /* ── Reduced motion ────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .btn-edit,
    .edit-textarea,
    .btn-done {
      transition: none;
    }
  }
</style>
