/**
 * Command registry + dispatcher. Maps a command id to a host-agnostic handler,
 * applies the capability gate, and guarantees every invocation returns a
 * structured `CliResponse` (never throws). This is the desktop analog of the
 * plugin's `CliRegistry`, but free of any host binding.
 */
import { err, ErrorCode } from './response.js';
import { COMMANDS, COMMAND_DESCRIPTIONS } from './flags.js';
import { authorNotesHandler, archiveHandler, jobHandler, jobsCheckHandler, jobsHandler, postHandler, shareHandler, statusHandler, subscribeHandler, syncHandler, searchHandler, bookmarkHandler, tagApplyHandler, tagCreateHandler, tagsHandler, toErrorResponse, } from './handlers.js';
/** Commands implemented in the PR-1/PR-3 vertical slice. */
const HANDLERS = {
    [COMMANDS.DEFAULT]: statusHandler,
    [COMMANDS.ARCHIVE]: archiveHandler,
    [COMMANDS.SUBSCRIBE]: subscribeHandler,
    [COMMANDS.POST]: postHandler,
    [COMMANDS.SHARE]: shareHandler,
    [COMMANDS.JOB]: jobHandler,
    [COMMANDS.JOBS]: jobsHandler,
    [COMMANDS.JOBS_CHECK]: jobsCheckHandler,
    [COMMANDS.SYNC]: syncHandler,
    [COMMANDS.TAGS]: tagsHandler,
    [COMMANDS.TAG_CREATE]: tagCreateHandler,
    [COMMANDS.TAG_APPLY]: tagApplyHandler,
    [COMMANDS.AUTHOR_NOTES]: authorNotesHandler,
    [COMMANDS.SEARCH]: searchHandler,
    [COMMANDS.BOOKMARK]: bookmarkHandler,
};
/** All known command ids (the full surface, even if not yet implemented). */
export const KNOWN_COMMANDS = new Set(Object.values(COMMANDS));
export function isKnownCommand(command) {
    return KNOWN_COMMANDS.has(command);
}
export function describeCommand(command) {
    return COMMAND_DESCRIPTIONS[command];
}
/**
 * Dispatch a command. Always resolves to a `CliResponse`:
 *   - unknown command            → OPERATION_FAILED
 *   - not yet implemented        → SERVICE_NOT_READY (retryable: false override)
 *   - host doesn't support it    → SERVICE_NOT_READY
 *   - handler throws             → mapped via toErrorResponse
 */
export async function dispatch(command, params, ctx) {
    if (!isKnownCommand(command)) {
        return err(command, ctx.version, ErrorCode.OPERATION_FAILED, `Unknown command: ${command}`);
    }
    const handler = HANDLERS[command];
    if (!handler) {
        return err(command, ctx.version, ErrorCode.SERVICE_NOT_READY, `Command '${command}' is defined but not yet implemented in the desktop CLI (see PRD §14 sequencing).`, { retryable: false });
    }
    if (!ctx.host.supports(command)) {
        return err(command, ctx.version, ErrorCode.SERVICE_NOT_READY, `Command '${command}' is not available on host '${ctx.host.client}'.`, { retryable: false });
    }
    try {
        return await handler(params, ctx);
    }
    catch (e) {
        return toErrorResponse(command, ctx.version, e);
    }
}
//# sourceMappingURL=registry.js.map