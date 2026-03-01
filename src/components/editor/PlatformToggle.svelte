<script lang="ts">
/**
 * PlatformToggle - Single platform row with toggle, status indicator, and character counter
 *
 * Displays a compact single-line row (~40px) for one cross-post destination:
 * - Platform icon + name
 * - Toggle switch (mirrors ShareOptions pattern)
 * - Connection status: dot + @username when connected, "Connect" link when not
 * - Character progress bar + count with over-limit warning
 * - "Custom" / "Auto" badge to indicate whether text has been customized
 */

/**
 * Token status for the connected account
 */
type TokenStatus = 'valid' | 'expiring_soon' | 'expired' | 'error';

/**
 * Threads-specific reply control options
 */
type ThreadsReplyControl = 'everyone' | 'accounts_you_follow' | 'mentioned_only';

/**
 * Component props
 */
interface Props {
  platform: 'threads';
  enabled: boolean;
  connected: boolean;
  username?: string;
  tokenStatus?: TokenStatus;
  characterCount: number;
  maxCharacters: number;
  /** User-entered custom text (undefined = synced/auto mode) */
  customText?: string;
  isCustomized: boolean;
  /** Threads-specific reply audience control */
  replyControl?: ThreadsReplyControl;
  onToggle?: (enabled: boolean) => void;
  onConnect?: () => void;
  onReplyControlChange?: (control: ThreadsReplyControl) => void;
}

let {
  platform,
  enabled,
  connected,
  username,
  tokenStatus = 'valid',
  characterCount,
  maxCharacters,
  customText,
  isCustomized,
  replyControl = 'everyone',
  onToggle,
  onConnect,
  onReplyControlChange
}: Props = $props();

/**
 * Platform metadata lookup
 */
const PLATFORM_META: Record<string, { icon: string; label: string }> = {
  threads: { icon: '🧵', label: 'Threads' }
};

const meta = $derived(PLATFORM_META[platform] ?? { icon: '●', label: platform });

/**
 * Character counter derived state
 */
const isOverLimit = $derived(characterCount > maxCharacters);
const progressPercent = $derived(
  Math.min(100, Math.round((characterCount / maxCharacters) * 100))
);

/**
 * Token status dot colour class
 */
const tokenDotClass = $derived((): string => {
  switch (tokenStatus) {
    case 'valid':         return 'dot-green';
    case 'expiring_soon': return 'dot-yellow';
    case 'expired':
    case 'error':         return 'dot-red';
    default:              return 'dot-green';
  }
});

/**
 * Accessible label for the token status dot
 */
const tokenStatusLabel = $derived((): string => {
  switch (tokenStatus) {
    case 'valid':         return 'Connected';
    case 'expiring_soon': return 'Token expiring soon';
    case 'expired':       return 'Token expired';
    case 'error':         return 'Connection error';
    default:              return 'Connected';
  }
});

/**
 * Handle toggle click — flip and notify parent
 */
function handleToggle() {
  if (onToggle) {
    onToggle(!enabled);
  }
}

/**
 * Handle connect link click
 */
function handleConnect(e: MouseEvent) {
  e.stopPropagation();
  if (onConnect) {
    onConnect();
  }
}
</script>

<!-- Single compact row for one cross-post destination -->
<div
  class="platform-row"
  class:disabled={!enabled}
  role="row"
  aria-label="{meta.label} cross-post settings"
>
  <!-- Left: Icon + Platform name -->
  <span class="platform-identity" aria-hidden="true">
    <span class="platform-icon">{meta.icon}</span>
    <span class="platform-label">{meta.label}</span>
  </span>

  <!-- Middle-left: Toggle switch -->
  <button
    class="toggle-btn"
    class:on={enabled}
    onclick={handleToggle}
    aria-label="Toggle {meta.label} cross-posting"
    aria-pressed={enabled}
    type="button"
  >
    <span class="toggle-track" class:on={enabled}>
      <span class="toggle-thumb"></span>
    </span>
  </button>

  <!-- Middle-right: Connection status / username -->
  <span class="connection-status">
    {#if connected}
      <!-- Status dot -->
      <span
        class="status-dot {tokenDotClass()}"
        title={tokenStatusLabel()}
        role="img"
        aria-label={tokenStatusLabel()}
      ></span>
      {#if username}
        <span class="username">@{username}</span>
      {/if}
    {:else}
      <!-- Connect link when account not linked -->
      <button
        class="connect-link"
        onclick={handleConnect}
        type="button"
        aria-label="Connect {meta.label} account"
      >
        Connect
      </button>
    {/if}
  </span>

  <!-- Right: Customization badge -->
  <span
    class="badge"
    class:badge-custom={isCustomized}
    class:badge-auto={!isCustomized}
    title={isCustomized ? 'Using custom text for this platform' : 'Auto-synced from original post'}
  >
    {isCustomized ? 'Custom' : 'Auto'}
  </span>

  <!-- Reply control (Threads-specific, shown when enabled and connected) -->
  {#if enabled && connected && onReplyControlChange}
    <select
      class="reply-control"
      value={replyControl}
      onchange={(e) => onReplyControlChange?.((e.target as HTMLSelectElement).value as ThreadsReplyControl)}
      aria-label="Who can reply"
      title="Who can reply"
    >
      <option value="everyone">Everyone</option>
      <option value="accounts_you_follow">Following</option>
      <option value="mentioned_only">Mentioned</option>
    </select>
  {/if}

  <!-- Far-right: Character counter + progress bar -->
  <span
    class="char-counter"
    class:over-limit={isOverLimit}
    aria-label="{characterCount} of {maxCharacters} characters used"
  >
    <span class="char-numbers">
      {characterCount}/{maxCharacters}
    </span>
    <span class="char-bar-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
      <span
        class="char-bar-fill"
        class:bar-warning={progressPercent >= 80 && !isOverLimit}
        class:bar-over={isOverLimit}
        style="width: {progressPercent}%"
      ></span>
    </span>
  </span>
</div>

<style>
  /* ── Row container ─────────────────────────────────────────── */
  .platform-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px; /* iOS HIG touch target */
    padding: 4px 0;
    transition: opacity 0.2s ease;
  }

  .platform-row.disabled {
    opacity: 0.5;
  }

  /* ── Platform icon + label ─────────────────────────────────── */
  .platform-identity {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 90px;
    flex-shrink: 0;
  }

  .platform-icon {
    font-size: 16px;
    line-height: 1;
  }

  .platform-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-normal);
    white-space: nowrap;
  }

  /* ── Toggle switch ─────────────────────────────────────────── */
  .toggle-btn {
    flex-shrink: 0;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    min-width: 44px;  /* touch target width */
    min-height: 44px;
    justify-content: center;
  }

  .toggle-track {
    position: relative;
    width: 36px;
    height: 20px;
    background: var(--background-modifier-border);
    border-radius: 10px;
    transition: background 0.25s ease;
    display: block;
    flex-shrink: 0;
  }

  .toggle-track.on {
    background: var(--interactive-accent);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 8px;
    transition: transform 0.25s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .toggle-track.on .toggle-thumb {
    transform: translateX(16px);
  }

  /* ── Connection status ─────────────────────────────────────── */
  .connection-status {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0; /* allow truncation */
  }

  /* Status dot */
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
  }

  .dot-green  { background: var(--color-green, #4ade80); }
  .dot-yellow { background: var(--color-yellow, #fbbf24); }
  .dot-red    { background: var(--color-red, #f87171); }

  .username {
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connect-link {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    color: var(--interactive-accent);
    cursor: pointer;
    text-decoration: underline;
    min-height: 44px; /* touch target */
    display: flex;
    align-items: center;
  }

  .connect-link:hover {
    color: var(--interactive-accent-hover);
  }

  /* ── Customization badge ───────────────────────────────────── */
  .badge {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .badge-auto {
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }

  .badge-custom {
    background: var(--interactive-accent);
    color: white;
  }

  /* ── Reply control select ─────────────────────────────────── */
  .reply-control {
    flex-shrink: 0;
    font-size: 11px;
    padding: 2px 4px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-muted);
    cursor: pointer;
    min-height: 24px;
    max-width: 80px;
  }

  .reply-control:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  /* ── Character counter ─────────────────────────────────────── */
  .char-counter {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    flex-shrink: 0;
    min-width: 60px;
  }

  .char-numbers {
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .char-counter.over-limit .char-numbers {
    color: var(--text-error);
    font-weight: 600;
  }

  /* Progress bar */
  .char-bar-track {
    width: 56px;
    height: 3px;
    background: var(--background-modifier-border);
    border-radius: 2px;
    overflow: hidden;
    display: block;
  }

  .char-bar-fill {
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 2px;
    transition: width 0.2s ease, background 0.2s ease;
    max-width: 100%;
  }

  .char-bar-fill.bar-warning {
    background: var(--color-yellow, #fbbf24);
  }

  .char-bar-fill.bar-over {
    background: var(--text-error);
    width: 100% !important; /* always full-width when over limit */
  }

  /* ── Reduced motion ────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .toggle-track,
    .toggle-thumb,
    .char-bar-fill {
      transition: none;
    }
  }
</style>
