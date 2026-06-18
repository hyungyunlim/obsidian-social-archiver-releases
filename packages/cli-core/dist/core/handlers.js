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
import { BILLING_FALLBACK_MESSAGE, ErrorCode, err, ok, } from './response';
import { CliValidationError, parseBool, parseCsv, parseEnum, parseNumber, parseString, parseWorkspacePath, } from './params';
import { COMMANDS } from './flags';
import { HostError } from './host';
// -----------------------------------------------------------------------------
// Error mapping
// -----------------------------------------------------------------------------
const KNOWN_CODES = new Set(Object.values(ErrorCode));
/**
 * Map any thrown value to a structured error envelope.
 *   - CliValidationError → INVALID_ARGUMENT (+ field detail)
 *   - HostError with a known code → that code (billing codes get the shared message)
 *   - anything else → OPERATION_FAILED
 */
export function toErrorResponse(command, version, e) {
    if (e instanceof CliValidationError) {
        return err(command, version, ErrorCode.INVALID_ARGUMENT, e.message, {
            details: { field: e.field },
        });
    }
    if (e instanceof HostError) {
        const code = KNOWN_CODES.has(e.code) ? e.code : ErrorCode.OPERATION_FAILED;
        const isBilling = code === ErrorCode.INSUFFICIENT_CREDITS || code === ErrorCode.PAYWALL_REQUIRED;
        const message = isBilling ? BILLING_FALLBACK_MESSAGE : e.message;
        return err(command, version, code, message, {
            retryable: e.retryable,
            details: e.details,
        });
    }
    const message = e instanceof Error ? e.message : String(e);
    return err(command, version, ErrorCode.OPERATION_FAILED, message);
}
// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------
export const statusHandler = async (_params, { host, version }) => {
    const status = await host.collectStatus();
    return ok(COMMANDS.DEFAULT, version, status);
};
export const archiveHandler = async (params, { host, version }) => {
    const url = parseString(params, 'url', { required: true });
    const mode = (parseEnum(params, 'mode', ['queue', 'sync', 'fetch'], {
        default: 'queue',
    }) ?? 'queue');
    const mediaMode = (parseEnum(params, 'media', ['all', 'images', 'none'], {
        default: 'all',
    }) ?? 'all');
    const includeComments = params['comments'] !== undefined ? parseBool(params, 'comments', false) : undefined;
    const includeTranscript = params['transcript'] !== undefined ? parseBool(params, 'transcript', false) : undefined;
    const includeFormattedTranscript = params['formattedTranscript'] !== undefined ? parseBool(params, 'formattedTranscript', false) : undefined;
    const tags = parseCsv(params, 'tags');
    const comment = parseString(params, 'comment');
    const wait = params['wait'] !== undefined ? parseBool(params, 'wait', false) : undefined;
    const result = await host.archive(url, {
        mode,
        mediaMode,
        includeComments,
        includeTranscript,
        includeFormattedTranscript,
        tags: tags.length > 0 ? tags : undefined,
        comment,
        wait,
    });
    // Surface host warnings (e.g. flags accepted but not honored) at the envelope.
    return ok(COMMANDS.ARCHIVE, version, result, result.warnings ? { warnings: result.warnings } : {});
};
export const subscribeHandler = async (params, { host, version }) => {
    const url = parseString(params, 'url', { required: true });
    const hour = parseNumber(params, 'hour', { integer: true, min: 0, max: 23 });
    const folder = parseString(params, 'folder');
    const naverCookie = parseString(params, 'naverCookie');
    const naverSubscriptionType = parseEnum(params, 'naverSubscriptionType', [
        'blog',
        'cafe-member',
    ]);
    const result = await host.subscribe({
        url,
        ...(typeof hour === 'number' ? { hour } : {}),
        ...(folder ? { folder } : {}),
        ...(naverCookie ? { naverCookie } : {}),
        ...(naverSubscriptionType ? { naverSubscriptionType } : {}),
    });
    return ok(COMMANDS.SUBSCRIBE, version, result, result.warnings ? { warnings: result.warnings } : {});
};
function parseNoteTarget(params) {
    const active = params['active'] !== undefined ? parseBool(params, 'active', false) : false;
    const path = parseString(params, 'path');
    if (active && path) {
        throw new CliValidationError('path', "Pass exactly one of '--path <file>' or '--active', not both.");
    }
    if (!active && !path) {
        throw new CliValidationError('path', "Provide '--path <file>' or the bare '--active' flag.");
    }
    return { ...(path ? { path } : {}), active };
}
export const postHandler = async (params, { host, version }) => {
    const result = await host.postNote(parseNoteTarget(params));
    return ok(COMMANDS.POST, version, result);
};
export const shareHandler = async (params, { host, version }) => {
    const target = parseNoteTarget(params);
    const reader = parseBool(params, 'reader', false);
    const result = await host.shareNote({ ...target, reader });
    return ok(COMMANDS.SHARE, version, result);
};
export const jobHandler = async (params, { host, version }) => {
    const id = parseString(params, 'id', { required: true });
    const source = (parseEnum(params, 'source', ['local', 'server', 'auto'], {
        default: 'auto',
    }) ?? 'auto');
    const job = await host.getJob(id, source);
    return ok(COMMANDS.JOB, version, job);
};
export const jobsHandler = async (params, { host, version }) => {
    const status = parseString(params, 'status');
    const limit = parseNumber(params, 'limit', { default: 20, min: 1, max: 200, integer: true }) ?? 20;
    const jobs = await host.listJobs({ status, limit });
    return ok(COMMANDS.JOBS, version, { count: jobs.length, jobs });
};
export const jobsCheckHandler = async (params, { host, version }) => {
    const syncServer = parseBool(params, 'syncServer', false);
    const result = await host.checkJobs({ syncServer });
    return ok(COMMANDS.JOBS_CHECK, version, result);
};
export const syncHandler = async (params, { host, version }) => {
    const target = (parseEnum(params, 'target', ['subscriptions', 'library', 'pending', 'all'], {
        default: 'all',
    }) ?? 'all');
    const syncServer = parseBool(params, 'syncServer', false);
    const result = await host.sync({ target, syncServer });
    return ok(COMMANDS.SYNC, version, result);
};
export const tagsHandler = async (params, { host, version }) => {
    const counts = parseBool(params, 'counts', false);
    const tags = await host.listTags({ counts });
    return ok(COMMANDS.TAGS, version, { count: tags.length, tags });
};
export const tagCreateHandler = async (params, { host, version }) => {
    const name = parseString(params, 'name', { required: true });
    const color = parseString(params, 'color');
    const tag = await host.createTag({ name, color });
    return ok(COMMANDS.TAG_CREATE, version, tag);
};
export const tagApplyHandler = async (params, { host, version }) => {
    const path = parseWorkspacePath(params, 'path', { required: true }, host.pathResolver);
    const tag = parseString(params, 'tag', { required: true });
    const action = (parseEnum(params, 'action', ['add', 'remove', 'toggle'], {
        default: 'toggle',
    }) ?? 'toggle');
    const result = await host.applyTag({ path, tag, action });
    return ok(COMMANDS.TAG_APPLY, version, result);
};
export const authorNotesHandler = async (params, { host, version }) => {
    const dryRun = parseBool(params, 'dryRun', false);
    const limit = parseNumber(params, 'limit', { integer: true, min: 0, max: 10000 });
    const result = await host.authorNotes({
        dryRun,
        ...(typeof limit === 'number' ? { limit } : {}),
    });
    return ok(COMMANDS.AUTHOR_NOTES, version, result);
};
export const searchHandler = async (params, { host, version }) => {
    const q = parseString(params, 'q', { required: true });
    const limit = parseNumber(params, 'limit', { integer: true, min: 1, max: 50 });
    const platform = parseString(params, 'platform');
    const platforms = parseCsv(params, 'platforms');
    const since = parseString(params, 'since');
    const until = parseString(params, 'until');
    const match = parseCsv(params, 'match');
    const cursor = parseString(params, 'cursor');
    const result = await host.search({
        q,
        ...(typeof limit === 'number' ? { limit } : {}),
        ...(platform ? { platform } : {}),
        ...(platforms.length > 0 ? { platforms } : {}),
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
        ...(match.length > 0 ? { match } : {}),
        ...(cursor ? { cursor } : {}),
    });
    return ok(COMMANDS.SEARCH, version, result);
};
export const bookmarkHandler = async (params, { host, version }) => {
    const archiveIds = parseCsv(params, 'ids');
    if (archiveIds.length === 0) {
        throw new CliValidationError('ids', '--ids is required (comma-separated archive IDs)');
    }
    const off = parseBool(params, 'off', false);
    const result = await host.bookmark({ archiveIds, bookmarked: !off });
    return ok(COMMANDS.BOOKMARK, version, result);
};
//# sourceMappingURL=handlers.js.map