/**
 * Host-agnostic CLI handlers. Each handler follows the same shape as the
 * Obsidian plugin's CliRegistry handlers — parse flags → delegate to the host →
 * format via CliResponse — but against the injected `ArchiverCliHost` instead
 * of `this.plugin`. This is the body that moves into cli-core (PRD §6.2).
 *
 * Vertical slice for PR-1/PR-3: status, archive, job, jobs, jobs:check, sync,
 * tags, tag-create, tag-apply. Server-backed follow-ups wire subscribe, post,
 * share, and author-notes. Remaining commands are registered as not-yet-
 * implemented in `registry.ts` until their host methods land.
 */
import { type CliResponse } from './response';
import { type CliParams } from './params';
import { type ArchiverCliHost } from './host';
export interface HandlerContext {
    host: ArchiverCliHost;
    version: string;
}
export type Handler = (params: CliParams, ctx: HandlerContext) => Promise<CliResponse<unknown>>;
/**
 * Map any thrown value to a structured error envelope.
 *   - CliValidationError → INVALID_ARGUMENT (+ field detail)
 *   - HostError with a known code → that code (billing codes get the shared message)
 *   - anything else → OPERATION_FAILED
 */
export declare function toErrorResponse(command: string, version: string, e: unknown): CliResponse<never>;
export declare const statusHandler: Handler;
export declare const archiveHandler: Handler;
export declare const subscribeHandler: Handler;
export declare const postHandler: Handler;
export declare const shareHandler: Handler;
export declare const jobHandler: Handler;
export declare const jobsHandler: Handler;
export declare const jobsCheckHandler: Handler;
export declare const syncHandler: Handler;
export declare const tagsHandler: Handler;
export declare const tagCreateHandler: Handler;
export declare const tagApplyHandler: Handler;
export declare const authorNotesHandler: Handler;
export declare const searchHandler: Handler;
export declare const bookmarkHandler: Handler;
//# sourceMappingURL=handlers.d.ts.map