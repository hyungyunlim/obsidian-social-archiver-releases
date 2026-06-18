/**
 * argv layer for the standalone `social-archiver` Node CLI.
 *
 * Pure + testable: `parseArgv` turns process args into a command + params,
 * `runCli` dispatches through cli-core and returns the formatted output and an
 * exit code. The executable shim (`desktop-app/cli/social-archiver.ts`) only
 * wires stdout/exit and constructs the host.
 */
import { type CommandId } from './core/flags';
import { type CliFormat } from './core/response';
import type { CliParams } from './core/params';
import type { ArchiverCliHost } from './core/host';
export interface ParsedArgv {
    command: CommandId;
    params: CliParams;
    format: CliFormat;
    help: boolean;
}
/**
 * Resolve a user-facing subcommand to a full command id.
 *   (none) / "status"     → social-archiver
 *   "archive"             → social-archiver:archive
 *   "jobs:check"          → social-archiver:jobs:check
 *   "tag-create"          → social-archiver:tag-create
 * Returns undefined for an unknown subcommand.
 */
export declare function resolveCommand(sub: string | undefined): CommandId | undefined;
/** Parse `process.argv.slice(2)` into a command + params. */
export declare function parseArgv(args: string[]): {
    ok: true;
    value: ParsedArgv;
} | {
    ok: false;
    error: string;
};
export declare function helpText(): string;
export type HostFactory = () => ArchiverCliHost | Promise<ArchiverCliHost>;
export interface RunResult {
    output: string;
    exitCode: number;
}
/**
 * Run the CLI end-to-end. Never throws — host-factory failures and dispatch
 * errors are returned as structured envelopes with a non-zero exit code.
 */
export declare function runCli(args: string[], hostFactory: HostFactory, version: string): Promise<RunResult>;
//# sourceMappingURL=runner.d.ts.map