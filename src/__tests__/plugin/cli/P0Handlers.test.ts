/**
 * Integration tests for P0 CLI handlers wired through CliRegistry.
 *
 * These tests focus on:
 *   - Argument validation (missing required, invalid enum) → INVALID_ARGUMENT.
 *   - Server PAYWALL_REQUIRED mapping → INSUFFICIENT_CREDITS envelope w/
 *     billing fallback message.
 *   - Server INSUFFICIENT_CREDITS string mapping in error message.
 *   - Successful queue-mode archive envelope shape.
 *
 * Mocking strategy mirrors CliRegistry.test.ts: stub `registerCliHandler` to
 * capture the handler functions and invoke them with synthetic CliData.
 */

import { describe, expect, it, vi } from 'vitest';
import { CliRegistry } from '@/plugin/cli/CliRegistry';
import { COMMANDS } from '@/plugin/cli/CliFlags';
import {
  ArchiveCliService,
  type ArchiveCliOptions,
  type EnqueueArchiveResult,
} from '@/plugin/cli/ArchiveCliService';
import type { CliData, CliHandler } from '@/types/obsidian-cli';

type RegisterCall = { command: string; handler: CliHandler };

interface BuildPluginOptions {
  enqueueImpl?: (url: string, opts: ArchiveCliOptions) => Promise<EnqueueArchiveResult>;
  syncImpl?: (url: string, opts: ArchiveCliOptions) => Promise<unknown>;
  getJobImpl?: (id: string, source: string) => Promise<unknown>;
}

function buildPlugin(opts: BuildPluginOptions = {}): { plugin: any; calls: RegisterCall[] } {
  const calls: RegisterCall[] = [];
  const plugin: any = {
    manifest: { id: 'social-archiver', version: '3.6.2' },
    settings: { authToken: 'tok', username: 'demo', enableServerPendingJobs: true },
    app: { vault: { getName: () => 'V' } },
    registerCliHandler: (command: string, _desc: string, _flags: unknown, handler: CliHandler) => {
      calls.push({ command, handler });
    },
  };

  // Inject ArchiveCliService stub via Object.defineProperty getter so handlers
  // resolve it lazily (per CliRegistry contract).
  const stubSvc: Partial<ArchiveCliService> = {
    enqueueArchive: vi.fn(async (url: string, options: ArchiveCliOptions) => {
      if (opts.enqueueImpl) return opts.enqueueImpl(url, options);
      return {
        jobId: 'job-test-1',
        status: 'pending' as const,
        platform: 'x',
        url,
      };
    }),
    runSyncArchive: vi.fn(async (url: string, options: ArchiveCliOptions) => {
      if (opts.syncImpl) return opts.syncImpl(url, options) as Promise<{ success: boolean; creditsUsed: number }>;
      return { success: true, filePath: 'foo.md', creditsUsed: 1 };
    }),
    fetchOnly: vi.fn(async () => ({
      platform: 'x' as const,
      id: 'p1',
      url: 'https://x.com/u/1',
      author: { name: 'A', url: 'https://x.com/a' },
      content: { text: 'hi' },
      media: [],
      metadata: { timestamp: new Date() },
    })),
    getJobStatus: vi.fn(async (id: string, source: string) => {
      if (opts.getJobImpl) return opts.getJobImpl(id, source) as Promise<{ jobId: string; status: string; source: 'local' | 'server' }>;
      return { jobId: id, status: 'completed', source: 'local' as const };
    }),
    listJobs: vi.fn(async () => []),
    runJobsCheck: vi.fn(async () => ({ processedLocal: 0, processedServer: 0 })),
    runSync: vi.fn(async () => ({ target: 'all' as const, ran: ['subscriptions' as const], skipped: [] })),
    scheduleJobsCheck: vi.fn(() => ({ scheduled: true as const, targets: ['local' as const] })),
    scheduleSync: vi.fn(() => ({
      scheduled: true as const,
      targets: ['subscriptions' as const, 'library' as const, 'pending' as const],
      skipped: [] as Array<{ target: 'subscriptions' | 'library' | 'pending'; reason: string }>,
    })),
  };

  Object.defineProperty(plugin, 'archiveCliService', {
    get: () => stubSvc,
  });

  return { plugin, calls };
}

function getHandler(calls: RegisterCall[], command: string): CliHandler {
  const found = calls.find((c) => c.command === command);
  if (!found) throw new Error(`Handler not registered: ${command}`);
  return found.handler;
}

describe('P0 handlers', () => {
  describe('archive', () => {
    it('returns INVALID_ARGUMENT when url is missing', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.ARCHIVE);
      const out = await handler({} as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARGUMENT');
      expect(parsed.error.details?.field).toBe('url');
    });

    it('returns INVALID_ARGUMENT when mode is invalid', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.ARCHIVE);
      const out = await handler({
        url: 'https://x.com/u/1',
        mode: 'bogus',
      } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARGUMENT');
      expect(parsed.error.details?.field).toBe('mode');
    });

    it('returns INVALID_ARGUMENT when media is invalid', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.ARCHIVE);
      const out = await handler({
        url: 'https://x.com/u/1',
        media: 'video-only',
      } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARGUMENT');
    });

    it('returns ok envelope with jobId for queue mode', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.ARCHIVE);
      const out = await handler({
        url: 'https://x.com/u/1',
        mode: 'queue',
      } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.jobId).toBe('job-test-1');
      expect(parsed.data.status).toBe('pending');
    });

    it('maps PAYWALL_REQUIRED error from API to INSUFFICIENT_CREDITS envelope with billing fallback', async () => {
      const apiError = Object.assign(new Error('PAYWALL_REQUIRED'), {
        code: 'PAYWALL_REQUIRED',
        apiError: { code: 'PAYWALL_REQUIRED', message: 'Monthly archive limit reached' },
      });
      const { plugin, calls } = buildPlugin({
        enqueueImpl: () => Promise.reject(apiError),
      });
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.ARCHIVE);
      const out = await handler({
        url: 'https://x.com/u/1',
        mode: 'queue',
      } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INSUFFICIENT_CREDITS');
      // billing fallback message must mention mobile app / license-key path
      expect(parsed.error.message.toLowerCase()).toContain('mobile app');
    });

    it('maps INSUFFICIENT_CREDITS string error to INSUFFICIENT_CREDITS envelope', async () => {
      const { plugin, calls } = buildPlugin({
        enqueueImpl: () => Promise.reject(new Error('INSUFFICIENT_CREDITS: out of quota')),
      });
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.ARCHIVE);
      const out = await handler({
        url: 'https://x.com/u/1',
        mode: 'queue',
      } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.error.code).toBe('INSUFFICIENT_CREDITS');
    });

    it('honors format=text for ok envelopes', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.ARCHIVE);
      const out = await handler({
        url: 'https://x.com/u/1',
        mode: 'queue',
        format: 'text',
      } as CliData);
      expect(out.startsWith('OK')).toBe(true);
      expect(out).toContain('jobId=');
    });
  });

  describe('job', () => {
    it('returns INVALID_ARGUMENT when id is missing', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.JOB);
      const out = await handler({} as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.error.code).toBe('INVALID_ARGUMENT');
      expect(parsed.error.details?.field).toBe('id');
    });

    it('returns INVALID_ARGUMENT when source is invalid', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.JOB);
      const out = await handler({ id: 'j1', source: 'somewhere' } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.error.code).toBe('INVALID_ARGUMENT');
    });

    it('returns ok envelope with job status when found', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.JOB);
      const out = await handler({ id: 'j1' } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.jobId).toBe('j1');
    });
  });

  describe('jobs', () => {
    it('rejects invalid status enum', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.JOBS);
      const out = await handler({ status: 'not-real-status' } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.error.code).toBe('INVALID_ARGUMENT');
    });

    it('returns ok envelope with count and jobs', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.JOBS);
      const out = await handler({} as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(true);
      expect(parsed.data).toMatchObject({ count: 0, jobs: [] });
    });
  });

  describe('jobs:check', () => {
    it('returns scheduled envelope (fire-and-forget per Obsidian CLI 1.12.7 constraint)', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.JOBS_CHECK);
      const out = await handler({} as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.scheduled).toBe(true);
      expect(parsed.data.targets).toContain('local');
    });
  });

  describe('sync', () => {
    it('rejects invalid target', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.SYNC);
      const out = await handler({ target: 'nope' } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.error.code).toBe('INVALID_ARGUMENT');
    });

    it('returns scheduled envelope listing fire-and-forget targets', async () => {
      const { plugin, calls } = buildPlugin();
      new CliRegistry(plugin).boot();
      const handler = getHandler(calls, COMMANDS.SYNC);
      const out = await handler({ target: 'all' } as CliData);
      const parsed = JSON.parse(out);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.scheduled).toBe(true);
      expect(Array.isArray(parsed.data.targets)).toBe(true);
      expect(Array.isArray(parsed.data.skipped)).toBe(true);
    });
  });
});
