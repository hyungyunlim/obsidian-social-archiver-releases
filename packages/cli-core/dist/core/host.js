/**
 * ArchiverCliHost — the host-agnostic capability contract that cli-core
 * handlers call instead of reaching into a specific app (Obsidian plugin /
 * Tauri desktop). Each client provides an adapter:
 *   - ObsidianCliHost  (wraps the plugin services; future PR-1 refactor)
 *   - DesktopCliHost   (wraps DesktopApiClient / sync / repositories)
 *   - MockArchiverCliHost (tests)
 *
 * Per docs/specs/desktop-cli-agent-skill-prd.md §6.2. The method set below is
 * the PR-1/PR-3 vertical slice (status, archive, jobs, sync, tags) plus the
 * server-backed desktop follow-ups (subscribe, post, share, author-notes).
 * Remaining commands are gated through `supports()` until their host methods
 * land.
 */
// -----------------------------------------------------------------------------
// Host error
// -----------------------------------------------------------------------------
/**
 * Hosts throw `HostError` with one of `ErrorCode.*` so cli-core can map it to a
 * structured error envelope without knowing host internals. Billing codes
 * (`INSUFFICIENT_CREDITS`, `PAYWALL_REQUIRED`) trigger the shared billing
 * fallback message in the handler layer.
 */
export class HostError extends Error {
    code;
    retryable;
    details;
    constructor(code, message, opts = {}) {
        super(message);
        this.name = 'HostError';
        this.code = code;
        this.retryable = opts.retryable;
        this.details = opts.details;
    }
}
//# sourceMappingURL=host.js.map