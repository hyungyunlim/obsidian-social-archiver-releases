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
  workersApiClient?: unknown;
  runGoogleMapsBatch?: (links: string[], path?: string) => Promise<unknown>;
  archivePath?: string;
  vaultRead?: (path: string) => Promise<string> | string;
  vaultHasFile?: boolean;
}): { plugin: any; calls: RegisterCall[] } {
  const calls: RegisterCall[] = [];
  const plugin: any = {
    manifest: { id: 'social-archiver', version: '3.6.2' },
    settings: { authToken: 't', username: 'u', archivePath: opts.archivePath ?? 'Social Archives' },
    app: {
      vault: {
        getName: () => 'V',
        getAbstractFileByPath: () => (opts.vaultHasFile === false ? null : { extension: 'md', path: 'Notes/foo.md' }),
        read: async () => (opts.vaultRead ? opts.vaultRead('Notes/foo.md') : 'content'),
      },
    },
    workersApiClient: opts.workersApiClient,
    runGoogleMapsBatch: opts.runGoogleMapsBatch,
    pendingJobsManager: { getJobs: async () => [] },
  };
  plugin.registerCliHandler = (
    command: string,
    description: string,
    flags: unknown,
    handler: CliHandler,
  ) => {
    calls.push({ command, description, flags, handler });
  };
  return { plugin, calls };
}

function findHandler(calls: RegisterCall[], command: string): CliHandler {
  const found = calls.find((c) => c.command === command);
  if (!found) throw new Error(`No handler registered for ${command}`);
  return found.handler;
}

describe('P1 CLI handlers', () => {
  it('profile-crawl without url returns INVALID_ARGUMENT', async () => {
    const { plugin, calls } = makePlugin({});
    new CliRegistry(plugin).boot();
    const handler = findHandler(calls, COMMANDS.PROFILE_CRAWL);
    const out = await handler({} as CliData);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGUMENT');
  });

  it('googlemaps without yes returns dry-run with extractedLinks', async () => {
    const { plugin, calls } = makePlugin({});
    new CliRegistry(plugin).boot();
    const handler = findHandler(calls, COMMANDS.GOOGLEMAPS);
    const content = 'Visit https://maps.app.goo.gl/abc123 and https://maps.app.goo.gl/def456 please';
    const out = await handler({ content } as CliData);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dryRun).toBe(true);
    expect(parsed.data.wouldArchive).toBe(2);
    expect(parsed.data.extractedLinks).toEqual([
      'https://maps.app.goo.gl/abc123',
      'https://maps.app.goo.gl/def456',
    ]);
  });

  it('googlemaps with yes runs the batch via plugin.runGoogleMapsBatch', async () => {
    const runGoogleMapsBatch = vi.fn().mockResolvedValue({
      batchJobId: 'b-1',
      urlCount: 2,
      createdDocCount: 2,
      failedCount: 0,
      createdPaths: ['a.md', 'b.md'],
    });
    const { plugin, calls } = makePlugin({ runGoogleMapsBatch });
    new CliRegistry(plugin).boot();
    const handler = findHandler(calls, COMMANDS.GOOGLEMAPS);
    const out = await handler({
      content: 'https://maps.app.goo.gl/a https://maps.app.goo.gl/b',
      yes: 'true',
    } as CliData);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.batchJobId).toBe('b-1');
    expect(parsed.data.createdDocCount).toBe(2);
    expect(runGoogleMapsBatch).toHaveBeenCalledTimes(1);
  });

  it('googlemaps with no source returns INVALID_ARGUMENT', async () => {
    const { plugin, calls } = makePlugin({});
    new CliRegistry(plugin).boot();
    const handler = findHandler(calls, COMMANDS.GOOGLEMAPS);
    const out = await handler({} as CliData);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGUMENT');
  });

  it('import-instagram without files returns INVALID_ARGUMENT', async () => {
    const { plugin, calls } = makePlugin({});
    new CliRegistry(plugin).boot();
    const handler = findHandler(calls, COMMANDS.IMPORT_INSTAGRAM);
    const out = await handler({} as CliData);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    // Either UNSUPPORTED_PLATFORM or INVALID_ARGUMENT depending on Platform mock.
    expect(['INVALID_ARGUMENT', 'UNSUPPORTED_PLATFORM']).toContain(parsed.error.code);
  });

  it('subscribe handler returns INVALID_ARGUMENT when url is missing', async () => {
    const { plugin, calls } = makePlugin({});
    new CliRegistry(plugin).boot();
    const handler = findHandler(calls, COMMANDS.SUBSCRIBE);
    const out = await handler({} as CliData);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGUMENT');
  });
});
