/**
 * Command registry + dispatcher. Maps a command id to a host-agnostic handler,
 * applies the capability gate, and guarantees every invocation returns a
 * structured `CliResponse` (never throws). This is the desktop analog of the
 * plugin's `CliRegistry`, but free of any host binding.
 */
import { type CliResponse } from './response';
import type { CliParams } from './params';
import { type CommandId } from './flags';
import { type HandlerContext } from './handlers';
/** All known command ids (the full surface, even if not yet implemented). */
export declare const KNOWN_COMMANDS: Set<string>;
export declare function isKnownCommand(command: string): command is CommandId;
export declare function describeCommand(command: CommandId): string;
/**
 * Dispatch a command. Always resolves to a `CliResponse`:
 *   - unknown command            → OPERATION_FAILED
 *   - not yet implemented        → SERVICE_NOT_READY (retryable: false override)
 *   - host doesn't support it    → SERVICE_NOT_READY
 *   - handler throws             → mapped via toErrorResponse
 */
export declare function dispatch(command: string, params: CliParams, ctx: HandlerContext): Promise<CliResponse<unknown>>;
//# sourceMappingURL=registry.d.ts.map