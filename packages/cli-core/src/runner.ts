/**
 * argv layer for the standalone `social-archiver` Node CLI.
 *
 * Pure + testable: `parseArgv` turns process args into a command + params,
 * `runCli` dispatches through cli-core and returns the formatted output and an
 * exit code. The executable shim (`desktop-app/cli/social-archiver.ts`) only
 * wires stdout/exit and constructs the host.
 */

import { COMMANDS, COMMAND_DESCRIPTIONS, type CommandId } from './core/flags.js';
import { dispatch, isKnownCommand } from './core/registry.js';
import { err, ErrorCode, format, type CliFormat } from './core/response.js';
import type { CliParams } from './core/params.js';
import type { ArchiverCliHost } from './core/host.js';

export interface ParsedArgv {
  command: CommandId;
  params: CliParams;
  format: CliFormat;
  help: boolean;
}

const HELP_TOKENS = new Set(['help', '--help', '-h']);

/**
 * Resolve a user-facing subcommand to a full command id.
 *   (none) / "status"     → social-archiver
 *   "archive"             → social-archiver:archive
 *   "jobs:check"          → social-archiver:jobs:check
 *   "tag-create"          → social-archiver:tag-create
 * Returns undefined for an unknown subcommand.
 */
export function resolveCommand(sub: string | undefined): CommandId | undefined {
  if (sub === undefined || sub === '' || sub === 'status') return COMMANDS.DEFAULT;
  const full = sub.startsWith('social-archiver') ? sub : `social-archiver:${sub}`;
  return isKnownCommand(full) ? full : undefined;
}

/** Parse `process.argv.slice(2)` into a command + params. */
export function parseArgv(args: string[]): { ok: true; value: ParsedArgv } | { ok: false; error: string } {
  if (args.length > 0 && args[0] !== undefined && HELP_TOKENS.has(args[0])) {
    return { ok: true, value: { command: COMMANDS.DEFAULT, params: {}, format: 'json', help: true } };
  }

  const sub = args[0];
  let command: CommandId;
  let flagStart: number;
  if (sub === undefined || sub === 'status') {
    command = COMMANDS.DEFAULT;
    flagStart = sub === undefined ? 0 : 1;
  } else if (sub.startsWith('--')) {
    // No subcommand given, straight into flags → default status command.
    command = COMMANDS.DEFAULT;
    flagStart = 0;
  } else {
    const resolved = resolveCommand(sub);
    if (resolved === undefined) {
      return { ok: false, error: `Unknown command: ${sub}` };
    }
    command = resolved;
    flagStart = 1;
  }

  const params: CliParams = {};
  const flagArgs = args.slice(flagStart);
  for (let i = 0; i < flagArgs.length; i++) {
    const tok = flagArgs[i];
    if (tok === undefined || !tok.startsWith('--')) continue;
    const body = tok.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      params[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    // `--key value` (value is the next non-flag token) or bare `--flag`.
    const next = flagArgs[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      params[body] = next;
      i++;
    } else {
      params[body] = 'true';
    }
  }

  const fmt: CliFormat = params['format'] === 'text' ? 'text' : 'json';
  return { ok: true, value: { command, params, format: fmt, help: false } };
}

export function helpText(): string {
  const lines: string[] = [
    'social-archiver — Social Archiver desktop CLI (scaffold)',
    '',
    'Usage: social-archiver <command> [--flag value] [--flag=value] [--bare-flag]',
    '',
    'Commands:',
  ];
  for (const id of Object.values(COMMANDS)) {
    const sub = id === COMMANDS.DEFAULT ? 'status' : id.replace('social-archiver:', '');
    lines.push(`  ${sub.padEnd(20)} ${COMMAND_DESCRIPTIONS[id]}`);
  }
  lines.push('', 'Global flags:', '  --format <json|text>   Output format (default json)');
  return lines.join('\n');
}

export type HostFactory = () => ArchiverCliHost | Promise<ArchiverCliHost>;

export interface RunResult {
  output: string;
  exitCode: number;
}

/**
 * Run the CLI end-to-end. Never throws — host-factory failures and dispatch
 * errors are returned as structured envelopes with a non-zero exit code.
 */
export async function runCli(args: string[], hostFactory: HostFactory, version: string): Promise<RunResult> {
  const parsed = parseArgv(args);
  if (!parsed.ok) {
    const envelope = err('social-archiver', version, ErrorCode.INVALID_ARGUMENT, parsed.error);
    return { output: format(envelope, 'json'), exitCode: 1 };
  }

  const { command, params, format: fmt, help } = parsed.value;
  if (help) {
    return { output: helpText(), exitCode: 0 };
  }

  let host: ArchiverCliHost;
  try {
    host = await hostFactory();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const envelope = err(command, version, ErrorCode.SERVICE_NOT_READY, `Host not available: ${message}`, {
      retryable: false,
    });
    return { output: format(envelope, fmt), exitCode: 1 };
  }

  const response = await dispatch(command, params, { host, version });
  return { output: format(response, fmt), exitCode: response.ok ? 0 : 1 };
}
