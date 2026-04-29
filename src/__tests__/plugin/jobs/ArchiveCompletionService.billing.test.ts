import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingJob } from '@/services/PendingJobsManager';

const { noticeMock } = vi.hoisted(() => ({
  noticeMock: vi.fn(),
}));

vi.mock('obsidian', () => ({
  Notice: noticeMock,
  TFile: class TFile {},
  normalizePath: (path: string) => path,
  requestUrl: vi.fn(),
}));

import { ArchiveCompletionService } from '@/plugin/jobs/ArchiveCompletionService';
import type { ArchiveCompletionServiceDeps } from '@/plugin/jobs/ArchiveCompletionService';

function makeJob(overrides: Partial<PendingJob> = {}): PendingJob {
  return {
    id: 'job-1',
    url: 'https://x.com/example/status/1',
    platform: 'x',
    status: 'processing',
    timestamp: 1,
    retryCount: 0,
    metadata: {},
    ...overrides,
  };
}

function makeDeps(job: PendingJob): ArchiveCompletionServiceDeps {
  return {
    app: {} as ArchiveCompletionServiceDeps['app'],
    settings: () => ({
      downloadAuthorAvatars: false,
      updateAuthorMetadata: false,
    }) as unknown as ReturnType<ArchiveCompletionServiceDeps['settings']>,
    pendingJobsManager: {
      getJob: vi.fn().mockResolvedValue(job),
      updateJob: vi.fn().mockResolvedValue(undefined),
      removeJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as ArchiveCompletionServiceDeps['pendingJobsManager'],
    archiveJobTracker: {
      failJob: vi.fn(),
      markRetrying: vi.fn(),
    } as unknown as ArchiveCompletionServiceDeps['archiveJobTracker'],
    apiClient: () => undefined,
    authorAvatarService: () => undefined,
    authorNoteService: () => undefined,
    tagStore: {} as ArchiveCompletionServiceDeps['tagStore'],
    refreshTimelineView: vi.fn(),
    refreshCredits: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ArchiveCompletionService billing failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks PAYWALL_REQUIRED as failed without retrying', async () => {
    const job = makeJob();
    const deps = makeDeps(job);
    const service = new ArchiveCompletionService(deps);

    await service.processFailedJob(job, 'Monthly archive limit reached (10/10 used). Upgrade your Social Archiver plan, then retry.');

    expect(deps.archiveJobTracker.markRetrying).not.toHaveBeenCalled();
    expect(deps.archiveJobTracker.failJob).toHaveBeenCalledWith(
      job.id,
      'Monthly archive limit reached (10/10 used). Upgrade your Social Archiver plan, then retry.'
    );
    expect(deps.pendingJobsManager.updateJob).toHaveBeenCalledWith(job.id, {
      status: 'failed',
      retryCount: 0,
      metadata: {
        lastError: 'Monthly archive limit reached (10/10 used). Upgrade your Social Archiver plan, then retry.',
        failedAt: expect.any(Number),
      },
    });
    expect(deps.pendingJobsManager.removeJob).toHaveBeenCalledWith(job.id);
    expect(noticeMock).toHaveBeenCalledWith(
      'Monthly archive limit reached (10/10 used). Upgrade your Social Archiver plan, then retry.',
      10000
    );
  });

  it('keeps existing retry behavior for transient failures', async () => {
    const job = makeJob();
    const deps = makeDeps(job);
    const service = new ArchiveCompletionService(deps);

    await service.processFailedJob(job, 'Network timeout');

    expect(deps.archiveJobTracker.markRetrying).toHaveBeenCalledWith(job.id, 1);
    expect(deps.archiveJobTracker.failJob).not.toHaveBeenCalled();
    expect(deps.pendingJobsManager.removeJob).not.toHaveBeenCalled();
  });
});
