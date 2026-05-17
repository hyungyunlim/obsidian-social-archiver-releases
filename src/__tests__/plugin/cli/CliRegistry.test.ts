import { describe, expect, it, vi } from 'vitest';
import { CliRegistry } from '@/plugin/cli/CliRegistry';
import { COMMANDS } from '@/plugin/cli/CliFlags';
import type { CliData, CliHandler } from '@/types/obsidian-cli';

type RegisterCall = {
  command: string;
  description: string;
  flags: unknown;
  handler: CliHandler;
};

function makePlugin(opts: {
  hasCli: boolean;
  authToken?: string;
  username?: string;
  vaultName?: string;
}): {
  plugin: any;
  calls: RegisterCall[];
} {
  const calls: RegisterCall[] = [];
  const plugin: any = {
    manifest: { id: 'social-archiver', version: '3.6.2' },
    settings: { authToken: opts.authToken, username: opts.username },
    app: {
      vault: { getName: () => opts.vaultName ?? 'TestVault' },
    },
  };
  if (opts.hasCli) {
    plugin.registerCliHandler = (
      command: string,
      description: string,
      flags: unknown,
      handler: CliHandler,
    ) => {
      calls.push({ command, description, flags, handler });
    };
  }
  return { plugin, calls };
}

describe('CliRegistry', () => {
  it('returns CLI_UNAVAILABLE when registerCliHandler is missing', () => {
    const { plugin } = makePlugin({ hasCli: false });
    const registry = new CliRegistry(plugin);
    const result = registry.boot();
    expect(result.registered).toBe(false);
    expect(result.reason).toBe('CLI_UNAVAILABLE');
  });

  it('registers the default `social-archiver` command when CLI is available', () => {
    const { plugin, calls } = makePlugin({ hasCli: true });
    const registry = new CliRegistry(plugin);
    const result = registry.boot();
    expect(result.registered).toBe(true);
    expect(calls.map((c) => c.command)).toContain(COMMANDS.DEFAULT);
  });

  it('default handler returns a valid envelope with auth/vault data', async () => {
    const { plugin, calls } = makePlugin({
      hasCli: true,
      authToken: 'token-redacted',
      username: 'demo',
      vaultName: 'Research',
    });
    new CliRegistry(plugin).boot();
    const defaultCall = calls.find((c) => c.command === COMMANDS.DEFAULT);
    expect(defaultCall).toBeDefined();

    const out = await defaultCall!.handler({ format: 'json' } as CliData);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe(COMMANDS.DEFAULT);
    expect(parsed.version).toBe('3.6.2');
    expect(parsed.data.pluginId).toBe('social-archiver');
    expect(parsed.data.vault).toBe('Research');
    expect(parsed.data.authenticated).toBe(true);
    expect(parsed.data.username).toBe('demo');
    expect(parsed.data.features).toMatchObject({
      archive: true,
      profileCrawl: true,
    });
  });

  it('default handler reports unauthenticated when settings are blank', async () => {
    const { plugin, calls } = makePlugin({ hasCli: true });
    new CliRegistry(plugin).boot();
    const defaultCall = calls.find((c) => c.command === COMMANDS.DEFAULT)!;
    const out = await defaultCall.handler({} as CliData);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.authenticated).toBe(false);
    expect(parsed.data.username).toBeUndefined();
  });

  it('default handler honors format=text', async () => {
    const { plugin, calls } = makePlugin({ hasCli: true, vaultName: 'V' });
    new CliRegistry(plugin).boot();
    const defaultCall = calls.find((c) => c.command === COMMANDS.DEFAULT)!;
    const out = await defaultCall.handler({ format: 'text' } as CliData);
    expect(out.startsWith('OK')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it('caught handler errors surface as OPERATION_FAILED envelopes, not throws', async () => {
    const { plugin, calls } = makePlugin({ hasCli: true });
    // Force the status collector to throw by clobbering app.vault.getName.
    plugin.app.vault.getName = () => {
      throw new Error('vault gone');
    };
    new CliRegistry(plugin).boot();
    const defaultCall = calls.find((c) => c.command === COMMANDS.DEFAULT)!;
    const out = await defaultCall.handler({} as CliData);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('OPERATION_FAILED');
    expect(parsed.error.message).toContain('vault gone');
  });

  it('does not throw when plugin load happens twice with missing CLI', () => {
    const { plugin } = makePlugin({ hasCli: false });
    const registry = new CliRegistry(plugin);
    expect(() => registry.boot()).not.toThrow();
    expect(() => registry.boot()).not.toThrow();
  });
});
