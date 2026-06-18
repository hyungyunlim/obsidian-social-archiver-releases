import { describe, it, expect } from 'vitest';
import { parseArgv, resolveCommand, runCli, helpText, type HostFactory } from '../src/runner';
import { COMMANDS } from '../src/core/flags';
import { MockArchiverCliHost } from '../src/mock-host';

const mockFactory: HostFactory = () => new MockArchiverCliHost({ version: '0.0.1' });

describe('resolveCommand', () => {
  it('maps subcommands to ids', () => {
    expect(resolveCommand(undefined)).toBe(COMMANDS.DEFAULT);
    expect(resolveCommand('status')).toBe(COMMANDS.DEFAULT);
    expect(resolveCommand('archive')).toBe(COMMANDS.ARCHIVE);
    expect(resolveCommand('jobs:check')).toBe(COMMANDS.JOBS_CHECK);
    expect(resolveCommand('tag-create')).toBe(COMMANDS.TAG_CREATE);
    expect(resolveCommand('bogus')).toBeUndefined();
  });
});

describe('parseArgv', () => {
  it('parses --key=value, --key value, and bare flags', () => {
    const r = parseArgv(['archive', '--url=https://x.com/a', '--mode', 'sync', '--comments']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.command).toBe(COMMANDS.ARCHIVE);
    expect(r.value.params.url).toBe('https://x.com/a');
    expect(r.value.params.mode).toBe('sync');
    expect(r.value.params.comments).toBe('true');
  });

  it('selects text format', () => {
    const r = parseArgv(['status', '--format', 'text']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.format).toBe('text');
  });

  it('treats a leading --flag as the default command', () => {
    const r = parseArgv(['--format', 'text']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.command).toBe(COMMANDS.DEFAULT);
    expect(r.value.format).toBe('text');
  });

  it('errors on an unknown subcommand', () => {
    const r = parseArgv(['frobnicate']);
    expect(r.ok).toBe(false);
  });

  it('detects help tokens', () => {
    for (const t of ['help', '--help', '-h']) {
      const r = parseArgv([t]);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.help).toBe(true);
    }
  });
});

describe('runCli', () => {
  it('runs status end-to-end with a mock host', async () => {
    const { output, exitCode } = await runCli(['status'], mockFactory, '0.0.1');
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.client).toBe('mock');
  });

  it('returns exit 1 + structured error on a validation failure', async () => {
    const { output, exitCode } = await runCli(['archive'], mockFactory, '0.0.1');
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGUMENT');
  });

  it('emits SERVICE_NOT_READY when the host factory throws', async () => {
    const failing: HostFactory = () => {
      throw new Error('not wired');
    };
    const { output, exitCode } = await runCli(['status'], failing, '0.0.1');
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(output);
    expect(parsed.error.code).toBe('SERVICE_NOT_READY');
  });

  it('prints help text', async () => {
    const { output, exitCode } = await runCli(['--help'], mockFactory, '0.0.1');
    expect(exitCode).toBe(0);
    expect(output).toContain('social-archiver');
    expect(helpText()).toContain('Commands:');
  });
});
