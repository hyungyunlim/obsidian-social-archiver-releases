import type { App, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AICommentJobProcessor } from '../../../plugin/ai-comment/AICommentJobProcessor';
import type { AIActionExecutorJob, WorkersAPIClient } from '../../../services/WorkersAPIClient';
import type { AICommentResult } from '../../../types/ai-comment';
import type { SocialArchiverSettings } from '../../../types/settings';

const serviceMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  generateComment: vi.fn<() => Promise<AICommentResult>>(),
}));

vi.mock('../../../services/AICommentService', () => ({
  AICommentService: vi.fn().mockImplementation(() => ({
    cancel: serviceMocks.cancel,
    generateComment: serviceMocks.generateComment,
  })),
}));

describe('AICommentJobProcessor AI action comment jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.generateComment.mockResolvedValue({
      content: '### Kubernetes\n\nContainer orchestration platform.',
      meta: {
        id: 'generated-id',
        cli: 'claude',
        type: 'glossary',
        generatedAt: '2026-07-02T00:00:00.000Z',
        processingTime: 1200,
        contentHash: 'generated-hash',
      },
    });
  });

  it('uploads comment.glossary AI action results instead of failing as unknown', async () => {
    const file = { path: 'Social Archives/Web/post.md' } as TFile;
    let markdown = [
      '---',
      'sourceArchiveId: archive-1',
      '---',
      '# Archive title',
      '',
      'Kubernetes schedules containers across a cluster.',
    ].join('\n');

    const actionJob = {
      jobId: 'job-1',
      archiveId: 'archive-1',
      targetClientId: 'client-1',
      status: 'claimed',
      actionType: 'comment.glossary',
      resultKind: 'comment',
      provider: 'claude',
      outputLanguage: 'en',
      archiveSnapshot: {
        archive: {
          title: 'Archive title',
          previewText: 'Kubernetes schedules containers.',
        },
      },
      updatedAt: '2026-07-02T00:00:00.000Z',
      createdAt: '2026-07-02T00:00:00.000Z',
    } satisfies AIActionExecutorJob;

    let lockTokenVersion = 1;
    const claimAIActionJob = vi.fn<WorkersAPIClient['claimAIActionJob']>(async () => ({
      jobId: 'job-1',
      lockToken: 'lock-1',
      lockTokenVersion,
      leaseExpiresAt: '2026-07-02T00:10:00.000Z',
      job: actionJob,
    }));
    const updateAIActionJobProgress = vi.fn<WorkersAPIClient['updateAIActionJobProgress']>(
      async (_jobId, request) => {
        lockTokenVersion += 1;
        return {
          job: {
            jobId: 'job-1',
            archiveId: 'archive-1',
            targetClientId: 'client-1',
            actionType: 'comment.glossary',
            resultKind: 'comment',
            status: request.status,
            progress: request.progress,
            progressMessage: request.progressMessage,
            updatedAt: '2026-07-02T00:00:01.000Z',
          },
          lockToken: `lock-${lockTokenVersion}`,
          lockTokenVersion,
          leaseExpiresAt: '2026-07-02T00:10:00.000Z',
        };
      },
    );
    const uploadAIActionJobResult = vi.fn<WorkersAPIClient['uploadAIActionJobResult']>(async () => ({
      job: {
        jobId: 'job-1',
        archiveId: 'archive-1',
        targetClientId: 'client-1',
        actionType: 'comment.glossary',
        resultKind: 'comment',
        status: 'completed',
        progress: 100,
        updatedAt: '2026-07-02T00:00:02.000Z',
      },
    }));
    const failAIActionJob = vi.fn<WorkersAPIClient['failAIActionJob']>(async () => ({
      job: {
        jobId: 'job-1',
        archiveId: 'archive-1',
        targetClientId: 'client-1',
        actionType: 'comment.glossary',
        resultKind: 'comment',
        status: 'failed',
        updatedAt: '2026-07-02T00:00:02.000Z',
      },
    }));

    const app = {
      vault: {
        read: vi.fn(async () => markdown),
        process: vi.fn(async (_file: TFile, updater: (content: string) => string) => {
          markdown = updater(markdown);
        }),
        getMarkdownFiles: vi.fn(() => [file]),
      },
      metadataCache: {
        getFileCache: vi.fn(() => ({ frontmatter: { sourceArchiveId: 'archive-1' } })),
      },
      fileManager: {
        processFrontMatter: vi.fn(async (_file: TFile, updater: (frontmatter: Record<string, unknown>) => void) => {
          updater({});
        }),
      },
    } as unknown as App;

    const settings = {
      syncClientId: 'client-1',
      authToken: 'token',
      aiCommentPendingUploads: {},
    } as SocialArchiverSettings;

    const processor = new AICommentJobProcessor({
      app,
      apiClient: () => ({
        claimAIActionJob,
        updateAIActionJobProgress,
        uploadAIActionJobResult,
        failAIActionJob,
      } as unknown as WorkersAPIClient),
      settings: () => settings,
      saveSettings: vi.fn(async () => undefined),
      archiveLookupService: () => ({
        findBySourceArchiveId: vi.fn(() => file),
      } as never),
      ingestRemoteArchive: vi.fn(async () => 'existing'),
      isArchiveLibrarySyncRunning: () => false,
      refreshTimelineView: vi.fn(),
      schedule: vi.fn(),
      clearSchedule: vi.fn(),
      notify: vi.fn(),
    });

    await processor.handleRequestedAIActionJob('job-1', 'client-1');

    expect(serviceMocks.generateComment).toHaveBeenCalledWith(
      expect.stringContaining('Kubernetes schedules containers'),
      expect.objectContaining({
        cli: 'claude',
        type: 'glossary',
        outputLanguage: 'en',
      }),
    );
    expect(uploadAIActionJobResult).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        result: expect.objectContaining({
          kind: 'comment',
          comment: expect.objectContaining({
            content: '### Kubernetes\n\nContainer orchestration platform.',
            meta: expect.objectContaining({
              cli: 'claude',
              type: 'glossary',
            }),
          }),
        }),
      }),
    );
    expect(markdown).toContain('Container orchestration platform.');
    expect(failAIActionJob).not.toHaveBeenCalled();
  });
});
