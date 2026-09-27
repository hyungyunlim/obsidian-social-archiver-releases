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

const STORY_MESSAGE =
  'Instagram Stories can only be archived while signed in to Instagram. Open the Story in Chrome and save it with the Social Archiver extension.';

function makeJob(): PendingJob {
  return {
    id: 'job-1',
    url: 'https://www.instagram.com/stories/example/3456789012345678901/',
    platform: 'instagram',
    status: 'processing',
    timestamp: 1,
    retryCount: 0,
    metadata: {},
  };
}

function makeDeps(job: PendingJob): ArchiveCompletionServiceDeps {
  return {
    app: {} as ArchiveCompletionServiceDeps['app'],
    settings: () => ({}) as ReturnType<ArchiveCompletionServiceDeps['settings']>,
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

describe('ArchiveCompletionService terminal failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails a server-declared terminal code once, with the full message and no retry', async () => {
    const job = makeJob();
    const deps = makeDeps(job);
    const service = new ArchiveCompletionService(deps);

    await service.processFailedJob(job, STORY_MESSAGE, 'ARCHIVE_INSTAGRAM_STORY_LOGIN_REQUIRED');

    expect(deps.archiveJobTracker.markRetrying).not.toHaveBeenCalled();
    expect(deps.pendingJobsManager.updateJob).toHaveBeenCalledTimes(1);
    expect(deps.pendingJobsManager.updateJob).toHaveBeenCalledWith(job.id, {
      status: 'failed',
      retryCount: 0,
      metadata: { lastError: STORY_MESSAGE, failedAt: expect.any(Number) },
    });
    expect(deps.archiveJobTracker.failJob).toHaveBeenCalledWith(job.id, STORY_MESSAGE);
    expect(deps.pendingJobsManager.removeJob).toHaveBeenCalledWith(job.id);
    expect(noticeMock).toHaveBeenCalledTimes(1);
    expect(noticeMock).toHaveBeenCalledWith(STORY_MESSAGE, 10000);
  });

  it('does not retry an RSS feed link and shows the whole subscription hint', async () => {
    const feedMessage =
      'This is an RSS feed, not a web page. To follow this site, add it as a subscription instead.';
    const job = makeJob();
    const deps = makeDeps(job);
    const service = new ArchiveCompletionService(deps);

    await service.processFailedJob(job, feedMessage, 'ARCHIVE_FEED_URL');

    expect(deps.archiveJobTracker.markRetrying).not.toHaveBeenCalled();
    expect(noticeMock).toHaveBeenCalledWith(feedMessage, 10000);
  });

  it('still retries a generic failure, even when it carries a non-terminal code', async () => {
    const job = makeJob();
    const deps = makeDeps(job);
    const service = new ArchiveCompletionService(deps);

    await service.processFailedJob(job, 'This archive could not be completed. Please try again.', 'ARCHIVE_FAILED');

    expect(deps.pendingJobsManager.updateJob).toHaveBeenCalledWith(job.id, {
      status: 'pending',
      retryCount: 1,
      metadata: { lastError: 'This archive could not be completed. Please try again.' },
    });
    expect(deps.archiveJobTracker.markRetrying).toHaveBeenCalledWith(job.id, 1);
    expect(deps.archiveJobTracker.failJob).not.toHaveBeenCalled();
    expect(deps.pendingJobsManager.removeJob).not.toHaveBeenCalled();
    expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining('retrying... (1/3)'), 4000);
  });
});
