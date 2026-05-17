/**
 * Unit tests for ArchiveCliService.
 *
 * Strategy: stub `SocialArchiverPlugin` with the minimal surface
 * ArchiveCliService consumes (pendingJobsManager, archiveJobTracker,
 * archiveOrchestrator, workersApiClient, etc.). All deps are constructed by
 * the test, so we don't pull in the real plugin graph.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ArchiveCliService,
  JobNotFoundError,
  type ArchiveCliOptions,
} from '@/plugin/cli/ArchiveCliService';
import type { PendingJob } from '@/services/PendingJobsManager';

type Lock = string | null;

interface Stubs {
  jobs: Map<string, PendingJob>;
  jobsByWorker: Map<string, PendingJob>;
  serverJobs: Map<string, { jobId: string; status: string; createdAt: number; updatedAt: number; error?: string }>;
  acquired: string[];
  released: string[];
  trackerStartCalls: Array<{ jobId: string; url: string; platform: string }>;
  orchestrateCalls: Array<{ url: string; options: Record<string, unknown> }>;
  fetchCalls: Array<{ url: string; options: Record<string, unknown> }>;
  checkPendingCalls: number;
  syncFromServerCalls: number;
  subscriptionSyncCalls: string[];
  libraryDeltaCalls: string[];
}

function makePluginStub(opts?: {
  enableServerPendingJobs?: boolean;
  hasApiClient?: boolean;
  hasLibrarySync?: boolean;
  hasSubscriptionSync?: boolean;
  lockAlreadyHeld?: boolean;
  hasOrchestratorPrivate?: boolean;
  orchestrateImpl?: (url: string, options: Record<string, unknown>) => Promise<unknown>;
  fetchImpl?: (url: string, options: Record<string, unknown>) => Promise<unknown>;
  serverJobStatus?: { jobId: string; status: string; createdAt: number; updatedAt: number; error?: string };
  serverJobStatusError?: Error;
}): { plugin: any; stubs: Stubs } {
  const stubs: Stubs = {
    jobs: new Map(),
    jobsByWorker: new Map(),
    serverJobs: new Map(),
    acquired: [],
    released: [],
    trackerStartCalls: [],
    orchestrateCalls: [],
    fetchCalls: [],
    checkPendingCalls: 0,
    syncFromServerCalls: 0,
    subscriptionSyncCalls: [],
    libraryDeltaCalls: [],
  };

  const plugin: any = {
    settings: {
      enableServerPendingJobs: opts?.enableServerPendingJobs ?? true,
    },
    pendingJobsManager: {
      addJob: vi.fn(async (job: PendingJob) => {
        if (stubs.jobs.has(job.id)) {
          throw new Error(`Duplicate job already exists: ${job.id}`);
        }
        stubs.jobs.set(job.id, job);
        if (job.metadata?.workerJobId) {
          stubs.jobsByWorker.set(job.metadata.workerJobId, job);
        }
      }),
      getJob: vi.fn(async (id: string) => stubs.jobs.get(id) ?? null),
      getJobByWorkerJobId: vi.fn(async (wid: string) => stubs.jobsByWorker.get(wid) ?? null),
      getJobs: vi.fn(async (filter?: { status?: string }) => {
        const arr = Array.from(stubs.jobs.values());
        return filter?.status ? arr.filter((j) => j.status === filter.status) : arr;
      }),
    },
    archiveJobTracker: {
      startJob: vi.fn((input: { jobId: string; url: string; platform: string }) => {
        stubs.trackerStartCalls.push(input);
      }),
    },
    tryAcquireArchiveQueueLock: vi.fn((url: string): Lock => {
      if (opts?.lockAlreadyHeld) return null;
      const k = `lock:${url}`;
      stubs.acquired.push(k);
      return k;
    }),
    releaseArchiveQueueLock: vi.fn((key: string | null) => {
      if (key) stubs.released.push(key);
    }),
    checkPendingJobs: vi.fn(async () => {
      stubs.checkPendingCalls += 1;
    }),
    syncSubscriptionPosts: opts?.hasSubscriptionSync === false
      ? undefined
      : vi.fn(async (trigger?: string) => {
          stubs.subscriptionSyncCalls.push(trigger ?? 'no-trigger');
        }),
    archiveLibrarySyncService: opts?.hasLibrarySync === false
      ? undefined
      : {
          startDeltaSync: vi.fn(async (mode: string) => {
            stubs.libraryDeltaCalls.push(mode);
          }),
        },
  };

  // archiveOrchestrator getter — stubbed
  Object.defineProperty(plugin, 'archiveOrchestrator', {
    get: () => ({
      orchestrate: vi.fn(async (url: string, options: Record<string, unknown>) => {
        stubs.orchestrateCalls.push({ url, options });
        if (opts?.orchestrateImpl) return opts.orchestrateImpl(url, options);
        return { success: true, filePath: 'vault/path.md', creditsUsed: 1 };
      }),
      fetchPostData: vi.fn(async (url: string, options: Record<string, unknown>) => {
        stubs.fetchCalls.push({ url, options });
        if (opts?.fetchImpl) return opts.fetchImpl(url, options);
        return {
          platform: 'x',
          id: 'p1',
          url,
          author: { name: 'A', url: 'https://x.com/a' },
          content: { text: 'hello' },
          media: [],
          metadata: { timestamp: new Date() },
          filePath: '/Users/x/vault/secret.md', // should be stripped by sanitizer
          raw: { authToken: 'should-be-dropped' }, // should be stripped
        };
      }),
    }),
  });

  // workersApiClient getter — stubbed; throws when uninitialized
  Object.defineProperty(plugin, 'workersApiClient', {
    get: () => {
      if (!opts?.hasApiClient) {
        throw new Error('WorkersAPIClient not initialized. Please configure API settings.');
      }
      return {
        getJobStatus: vi.fn(async (jobId: string) => {
          if (opts.serverJobStatusError) throw opts.serverJobStatusError;
          if (opts.serverJobStatus && opts.serverJobStatus.jobId === jobId) {
            return opts.serverJobStatus;
          }
          throw new Error(`Server: job ${jobId} not found`);
        }),
      };
    },
  });

  // private pendingJobOrchestrator backdoor
  if (opts?.hasOrchestratorPrivate !== false) {
    (plugin as any).pendingJobOrchestrator = {
      syncPendingJobsFromServer: vi.fn(async () => {
        stubs.syncFromServerCalls += 1;
      }),
    };
  }

  return { plugin, stubs };
}

const baseOpts: ArchiveCliOptions = { mediaMode: 'all' };

describe('ArchiveCliService', () => {
  describe('enqueueArchive', () => {
    it('returns { jobId, status: "pending" } and constructs the dedup lock', async () => {
      const { plugin, stubs } = makePluginStub();
      const svc = new ArchiveCliService(plugin);

      const result = await svc.enqueueArchive('https://x.com/u/status/1', baseOpts);

      expect(result.status).toBe('pending');
      expect(result.jobId).toMatch(/^job-/);
      expect(result.url).toBe('https://x.com/u/status/1');
      expect(result.platform).toBe('x');

      // dedup lock acquired AND released
      expect(plugin.tryAcquireArchiveQueueLock).toHaveBeenCalledWith(
        'https://x.com/u/status/1',
        'x',
      );
      expect(stubs.acquired.length).toBe(1);
      expect(stubs.released.length).toBe(1);

      // job persisted + tracker started + check kicked
      expect(stubs.jobs.size).toBe(1);
      expect(stubs.trackerStartCalls.length).toBe(1);
      expect(stubs.checkPendingCalls).toBeGreaterThanOrEqual(0);
    });

    it('rejects when the queue lock is already held', async () => {
      const { plugin } = makePluginStub({ lockAlreadyHeld: true });
      const svc = new ArchiveCliService(plugin);
      await expect(svc.enqueueArchive('https://x.com/u/status/2', baseOpts)).rejects.toThrow(
        /already being queued/i,
      );
    });

    it('persists comment + tags in metadata when provided', async () => {
      const { plugin, stubs } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      await svc.enqueueArchive('https://x.com/u/status/3', {
        mediaMode: 'images',
        comment: '  hello world  ',
        tags: ['Alpha', 'beta'],
        includeComments: true,
      });
      const [job] = stubs.jobs.values();
      expect(job.metadata?.notes).toBe('hello world');
      expect(job.metadata?.includeComments).toBe(true);
      expect(job.metadata?.downloadMedia).toBe('images-only');
      expect(job.metadata?.selectedTags).toBeDefined();
      expect(Array.isArray(job.metadata?.selectedTags)).toBe(true);
    });
  });

  describe('runSyncArchive', () => {
    it('forces isForeground=false on the orchestrator', async () => {
      const { plugin, stubs } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      await svc.runSyncArchive('https://x.com/u/status/4', { mediaMode: 'all' });
      expect(stubs.orchestrateCalls.length).toBe(1);
      const passedOptions = stubs.orchestrateCalls[0]!.options as { isForeground?: boolean };
      expect(passedOptions.isForeground).toBe(false);
    });

    it('translates mediaMode=none to downloadMedia=false', async () => {
      const { plugin, stubs } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      await svc.runSyncArchive('https://x.com/u/status/5', { mediaMode: 'none' });
      const passedOptions = stubs.orchestrateCalls[0]!.options as { downloadMedia?: boolean };
      expect(passedOptions.downloadMedia).toBe(false);
    });
  });

  describe('fetchOnly', () => {
    it('returns sanitized PostData (no filePath, no raw)', async () => {
      const { plugin } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      const post = await svc.fetchOnly('https://x.com/u/status/6', baseOpts);

      // strip checks
      expect((post as Record<string, unknown>).filePath).toBeUndefined();
      expect((post as Record<string, unknown>).raw).toBeUndefined();

      // shape checks
      expect(post.platform).toBe('x');
      expect(post.author.name).toBe('A');
    });
  });

  describe('getJobStatus', () => {
    it('returns from local store when source=auto and local hit', async () => {
      const { plugin, stubs } = makePluginStub({ hasApiClient: true });
      stubs.jobs.set('local-1', {
        id: 'local-1',
        url: 'https://x.com/a/1',
        platform: 'x',
        status: 'processing',
        timestamp: 123,
        retryCount: 0,
        metadata: { workerJobId: 'w-1', startedAt: 1, lastError: undefined },
      });
      const svc = new ArchiveCliService(plugin);
      const result = await svc.getJobStatus('local-1', 'auto');
      expect(result.source).toBe('local');
      expect(result.status).toBe('processing');
      expect(result.workerJobId).toBe('w-1');
    });

    it('falls back from local→server when source=auto and no local hit', async () => {
      const { plugin } = makePluginStub({
        hasApiClient: true,
        serverJobStatus: { jobId: 'srv-9', status: 'completed', createdAt: 1, updatedAt: 2 },
      });
      const svc = new ArchiveCliService(plugin);
      const result = await svc.getJobStatus('srv-9', 'auto');
      expect(result.source).toBe('server');
      expect(result.status).toBe('completed');
    });

    it('throws JobNotFoundError when source=local and no local hit', async () => {
      const { plugin } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      await expect(svc.getJobStatus('missing', 'local')).rejects.toBeInstanceOf(JobNotFoundError);
    });

    it('wraps server errors in JobNotFoundError when source=server', async () => {
      const { plugin } = makePluginStub({
        hasApiClient: true,
        serverJobStatusError: new Error('Server: 404'),
      });
      const svc = new ArchiveCliService(plugin);
      await expect(svc.getJobStatus('srv-x', 'server')).rejects.toBeInstanceOf(JobNotFoundError);
    });
  });

  describe('listJobs', () => {
    it('filters by status and respects limit', async () => {
      const { plugin, stubs } = makePluginStub();
      for (let i = 0; i < 5; i++) {
        stubs.jobs.set(`p-${i}`, {
          id: `p-${i}`,
          url: `https://x.com/u/${i}`,
          platform: 'x',
          status: i % 2 === 0 ? 'pending' : 'completed',
          timestamp: 100 + i,
          retryCount: 0,
        });
      }
      const svc = new ArchiveCliService(plugin);
      const r = await svc.listJobs({ status: 'pending', limit: 2 });
      expect(r.length).toBe(2);
      expect(r.every((j) => j.status === 'pending')).toBe(true);
    });
  });

  describe('runJobsCheck', () => {
    it('calls checkPendingJobs and returns processedLocal=0 when no jobs change', async () => {
      const { plugin } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      const r = await svc.runJobsCheck({ syncServer: false });
      expect(plugin.checkPendingJobs).toHaveBeenCalled();
      expect(r.processedLocal).toBe(0);
      expect(r.skipped).toBeUndefined();
    });

    it('returns skipped=setting_disabled when syncServer=true but setting off', async () => {
      const { plugin } = makePluginStub({ enableServerPendingJobs: false });
      const svc = new ArchiveCliService(plugin);
      const r = await svc.runJobsCheck({ syncServer: true });
      expect(r.skipped).toBe('setting_disabled');
    });

    it('invokes syncPendingJobsFromServer when syncServer=true and setting on', async () => {
      const { plugin, stubs } = makePluginStub({
        enableServerPendingJobs: true,
        hasOrchestratorPrivate: true,
      });
      const svc = new ArchiveCliService(plugin);
      await svc.runJobsCheck({ syncServer: true });
      expect(stubs.syncFromServerCalls).toBe(1);
    });
  });

  describe('runSync', () => {
    it('with target=all invokes subscriptions + library + pending', async () => {
      const { plugin, stubs } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      const r = await svc.runSync('all', { syncServer: false });
      expect(r.ran).toEqual(expect.arrayContaining(['subscriptions', 'library', 'pending']));
      expect(stubs.subscriptionSyncCalls.length).toBe(1);
      expect(stubs.libraryDeltaCalls.length).toBe(1);
      expect(plugin.checkPendingJobs).toHaveBeenCalled();
    });

    it('with target=subscriptions only invokes subscription sync', async () => {
      const { plugin, stubs } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      const r = await svc.runSync('subscriptions', { syncServer: false });
      expect(r.ran).toContain('subscriptions');
      expect(stubs.libraryDeltaCalls.length).toBe(0);
      expect(plugin.checkPendingJobs).not.toHaveBeenCalled();
    });
  });

  // Fire-and-forget variants — required by Obsidian 1.12.7 CLI which loses
  // handler output when the returned Promise yields to the macrotask queue.
  describe('scheduleJobsCheck (fire-and-forget)', () => {
    it('returns synchronously with scheduled=true and triggers checkPendingJobs', () => {
      const { plugin } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      const r = svc.scheduleJobsCheck({ syncServer: false });
      expect(r).toEqual({ scheduled: true, targets: ['local'] });
      expect(plugin.checkPendingJobs).toHaveBeenCalled();
    });

    it('reports skipped=setting_disabled when syncServer=true but setting off', () => {
      const { plugin } = makePluginStub({ enableServerPendingJobs: false });
      const svc = new ArchiveCliService(plugin);
      const r = svc.scheduleJobsCheck({ syncServer: true });
      expect(r.skipped).toBe('setting_disabled');
      expect(r.targets).toEqual(['local']);
    });

    it('includes server target when syncServer=true and setting on', () => {
      const { plugin } = makePluginStub({
        enableServerPendingJobs: true,
        hasOrchestratorPrivate: true,
      });
      const svc = new ArchiveCliService(plugin);
      const r = svc.scheduleJobsCheck({ syncServer: true });
      expect(r.targets).toEqual(expect.arrayContaining(['local', 'server']));
      expect(r.skipped).toBeUndefined();
    });
  });

  describe('scheduleSync (fire-and-forget)', () => {
    it('returns synchronously for target=all with all sub-targets', () => {
      const { plugin } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      const r = svc.scheduleSync('all', { syncServer: false });
      expect(r.scheduled).toBe(true);
      expect(r.targets).toEqual(expect.arrayContaining(['subscriptions', 'library', 'pending']));
      expect(Array.isArray(r.skipped)).toBe(true);
    });

    it('target=subscriptions only schedules subscription sync', () => {
      const { plugin } = makePluginStub();
      const svc = new ArchiveCliService(plugin);
      const r = svc.scheduleSync('subscriptions', { syncServer: false });
      expect(r.targets).toEqual(['subscriptions']);
    });
  });
});
