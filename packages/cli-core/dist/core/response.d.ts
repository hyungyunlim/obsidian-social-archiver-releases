/**
 * CliResponse — single-responsibility module for:
 *   - Building the standard CLI response envelope (success/error).
 *   - Mapping error codes to a `retryable` flag.
 *   - Recursive redaction of sensitive fields prior to serialization.
 *   - Formatting envelopes as JSON or short human-readable text.
 *
 * Host-agnostic: this module has ZERO dependencies on Obsidian, Tauri,
 * plugin/desktop services, or settings reads. It is the canonical home of the
 * CLI response contract shared by every host adapter.
 *
 * Ported verbatim from `src/plugin/cli/CliResponse.ts` (Obsidian plugin) as the
 * shared `cli-core` contract per docs/specs/desktop-cli-agent-skill-prd.md §6.
 */
export declare const ErrorCode: {
    readonly CLI_UNAVAILABLE: "CLI_UNAVAILABLE";
    readonly AUTH_REQUIRED: "AUTH_REQUIRED";
    readonly INVALID_ARGUMENT: "INVALID_ARGUMENT";
    readonly UNSUPPORTED_PLATFORM: "UNSUPPORTED_PLATFORM";
    readonly SERVICE_NOT_READY: "SERVICE_NOT_READY";
    readonly PAYWALL_REQUIRED: "PAYWALL_REQUIRED";
    readonly INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS";
    readonly RATE_LIMITED: "RATE_LIMITED";
    readonly JOB_NOT_FOUND: "JOB_NOT_FOUND";
    readonly NETWORK_ERROR: "NETWORK_ERROR";
    readonly TIMEOUT_ERROR: "TIMEOUT_ERROR";
    readonly CIRCUIT_OPEN: "CIRCUIT_OPEN";
    readonly DOC_ID_STALE: "DOC_ID_STALE";
    readonly OPERATION_FAILED: "OPERATION_FAILED";
};
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
/**
 * Whether each error code is safe for an agent to retry. Used to populate
 * `error.retryable` so agents have a uniform signal regardless of which
 * handler produced the response.
 */
export declare const RETRYABLE_BY_CODE: Readonly<Record<ErrorCodeValue, boolean>>;
/**
 * Billing fallback message. Re-used by handlers that surface
 * `INSUFFICIENT_CREDITS` or `PAYWALL_REQUIRED` so wording stays consistent
 * with `CLAUDE_MEMORIZE.md` §"Billing Fallback 운영 규칙".
 *
 * NOTE: the desktop CLI wording will likely diverge from the plugin's ("apply a
 * license key in plugin settings") — see PRD Open Questions. Kept identical for
 * now so cli-core stays a single source of truth.
 */
export declare const BILLING_FALLBACK_MESSAGE = "Insufficient credits. Upgrade or restore via the mobile app using the same account, or apply a license key in plugin settings.";
export interface CliResponseSuccess<T> {
    ok: true;
    command: string;
    version: string;
    data: T;
    warnings?: string[];
}
export interface CliResponseError {
    ok: false;
    command: string;
    version: string;
    error: {
        code: string;
        message: string;
        retryable: boolean;
        details?: Record<string, unknown>;
    };
    warnings?: string[];
}
export type CliResponse<T> = CliResponseSuccess<T> | CliResponseError;
export interface OkOptions {
    warnings?: string[];
}
export interface ErrOptions {
    /** Override the default `retryable` mapping for this code. */
    retryable?: boolean;
    /** Optional structured details. Will be redacted before serialization. */
    details?: Record<string, unknown>;
    warnings?: string[];
}
/**
 * Build a success envelope. Caller passes the current host version so this
 * module stays decoupled from any specific host.
 */
export declare function ok<T>(command: string, version: string, data: T, opts?: OkOptions): CliResponseSuccess<T>;
/**
 * Build an error envelope. `code` should be one of `ErrorCode.*`. Unknown
 * codes are accepted (forward-compat) but receive `retryable: false` by default.
 */
export declare function err(command: string, version: string, code: string, message: string, opts?: ErrOptions): CliResponseError;
/**
 * Recursively redact sensitive values inside an arbitrary structure. Returns a
 * deep-cloned, scrubbed copy — the input is never mutated.
 */
export declare function redact<T>(value: T): T;
export type CliFormat = 'json' | 'text';
/**
 * Serialize an envelope for output. JSON is pretty-printed; text mode produces
 * a single short line (<=200 chars) summary.
 */
export declare function format<T>(response: CliResponse<T>, mode?: CliFormat): string;
//# sourceMappingURL=response.d.ts.map