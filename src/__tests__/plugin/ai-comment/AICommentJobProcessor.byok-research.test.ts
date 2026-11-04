import type { App, TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AICommentJobProcessor } from '../../../plugin/ai-comment/AICommentJobProcessor';
import type { AIActionExecutorJob, AICommentExecutorJob, WorkersAPIClient } from '../../../services/WorkersAPIClient';
import { AICommentError, type AICommentResult } from '../../../types/ai-comment';
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

const file = { path: 'Social Archives/Web/post.md' } as TFile;

function tooLarge(): Error {
  return Object.assign(new Error('This archive has too much AI comment text. Delete some AI comments and try again.'), {
    code: 'AI_COMMENTS_TOO_LARGE',
    status: 409,
  });
}

function harness(api: Partial<Record<keyof WorkersAPIClient, unknown>>, settingsOverrides: Partial<SocialArchiverSettings> = {}) {
  let markdown = ['---', 'sourceArchiveId: archive-1', '---', '# Kubernetes', '', 'Kubernetes was released in 2014.'].join('\n');
  const app = {
    vault: {
      read: vi.fn(async () => markdown),
      process: vi.fn(async (_file: TFile, updater: (content: string) => string) => {
        markdown = updater(markdown);
      }),
      getMarkdownFiles: vi.fn(() => [file]),
    },
    metadataCache: { getFileCache: vi.fn(() => ({ frontmatter: { sourceArchiveId: 'archive-1' } })) },
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
    ...settingsOverrides,
  } as SocialArchiverSettings;
  const saveSettings = vi.fn(async () => undefined);
  const processor = new AICommentJobProcessor({
    app,
    apiClient: () => api as unknown as WorkersAPIClient,
    settings: () => settings,
    saveSettings,
    archiveLookupService: () => ({ findBySourceArchiveId: vi.fn(() => file) }) as never,
    ingestRemoteArchive: vi.fn(async () => 'existing'),
    isArchiveLibrarySyncRunning: () => false,
    refreshTimelineView: vi.fn(),
    notify: vi.fn(),
  });
  return { processor, settings, saveSettings, markdown: () => markdown };
}

const researchJob = {
  jobId: 'job-1',
  archiveId: 'archive-1',
  targetClientId: 'client-1',
  status: 'claimed',
  actionType: 'comment.research',
  resultKind: 'comment',
  provider: 'anthropic-api',
  model: 'claude-sonnet-5-5',
  outputLanguage: 'ko',
  customPrompt: 'the release year',
  archiveSnapshot: { archive: { title: 'Kubernetes', authorName: 'Ada', platform: 'web', previewText: 'Kubernetes…' } },
  updatedAt: '2026-11-04T00:00:00.000Z',
  createdAt: '2026-11-04T00:00:00.000Z',
} satisfies AIActionExecutorJob;

function actionApi(overrides: Partial<Record<keyof WorkersAPIClient, unknown>> = {}) {
  return {
    claimAIActionJob: vi.fn(async () => ({
      jobId: 'job-1',
      lockToken: 'lock-1',
      lockTokenVersion: 1,
      leaseExpiresAt: '2026-11-04T00:10:00.000Z',
      job: researchJob,
    })),
    updateAIActionJobProgress: vi.fn(async (_jobId: string, request: { status: string }) => ({
      job: { jobId: 'job-1', archiveId: 'archive-1', status: request.status, updatedAt: '2026-11-04T00:00:01.000Z' },
      lockToken: 'lock-2',
      lockTokenVersion: 2,
      leaseExpiresAt: '2026-11-04T00:10:00.000Z',
    })),
    uploadAIActionJobResult: vi.fn(async () => ({
      job: { jobId: 'job-1', archiveId: 'archive-1', status: 'completed', updatedAt: '2026-11-04T00:00:02.000Z' },
    })),
    failAIActionJob: vi.fn(async () => ({ job: { jobId: 'job-1', status: 'failed' } })),
    ...overrides,
  };
}

describe('AICommentJobProcessor research and BYOK jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.generateComment.mockResolvedValue({
      content: '#### Summary\nReleased in 2014.',
      meta: {
        id: 'generated',
        cli: 'anthropic-api',
        model: 'claude-sonnet-5-5',
        executedModel: 'claude-sonnet-5-5-20261001',
        type: 'research',
        generatedAt: '2026-11-04T00:00:00.000Z',
        processingTime: 900,
        contentHash: 'hash',
      },
    });
  });

  it('runs comment.research on the job\'s BYOK provider unattended and uploads a research comment', async () => {
    const api = actionApi();
    const { processor, markdown } = harness(api);

    await processor.handleRequestedAIActionJob('job-1', 'client-1');

    expect(serviceMocks.generateComment).toHaveBeenCalledWith(
      expect.stringContaining('Kubernetes was released in 2014.'),
      expect.objectContaining({
        cli: 'anthropic-api',
        model: 'claude-sonnet-5-5',
        type: 'research',
        outputLanguage: 'ko',
        customPrompt: 'the release year',
        researchContext: { title: 'Kubernetes', authorName: 'Ada', platform: 'web' },
        interactive: false,
      }),
    );
    expect(api.uploadAIActionJobResult).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        result: expect.objectContaining({
          kind: 'comment',
          comment: expect.objectContaining({
            content: '#### Summary\nReleased in 2014.',
            meta: expect.objectContaining({ cli: 'anthropic-api', type: 'research', executedModel: 'claude-sonnet-5-5-20261001' }),
          }),
        }),
      }),
    );
    expect(markdown()).toContain('### ⚡ Anthropic API · Research');
    expect(api.failAIActionJob).not.toHaveBeenCalled();
  });

  it('reports a provider failure with the BYOK job error code', async () => {
    serviceMocks.generateComment.mockRejectedValue(
      new AICommentError('RATE_LIMITED', 'Your credit balance is too low', { byokCode: 'insufficient_credit' }),
    );
    const api = actionApi();
    const { processor } = harness(api);

    await processor.handleRequestedAIActionJob('job-1', 'client-1');

    expect(api.failAIActionJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ errorCode: 'PROVIDER_QUOTA_EXCEEDED', retryable: false }),
    );
  });

  it('neither fails nor reruns a job whose result the server refused as too large', async () => {
    const api = actionApi({ uploadAIActionJobResult: vi.fn(async () => Promise.reject(tooLarge())) });
    const { processor } = harness(api);

    await processor.handleRequestedAIActionJob('job-1', 'client-1');

    expect(api.uploadAIActionJobResult).toHaveBeenCalledTimes(1);
    expect(api.failAIActionJob).not.toHaveBeenCalled();
    expect(serviceMocks.generateComment).toHaveBeenCalledTimes(1);
    expect(processor.getBannerState()).toMatchObject({ jobId: 'job-1', status: 'failed', errorCode: 'AI_COMMENTS_TOO_LARGE' });
  });

  it('drops a legacy pending upload refused as too large instead of retrying it', async () => {
    const legacyJob = {
      jobId: 'job-2',
      archiveId: 'archive-1',
      targetClientId: 'client-1',
      status: 'dispatched',
      type: 'summary',
      provider: 'openai-api',
      outputLanguage: 'auto',
      updatedAt: '2026-11-04T00:00:00.000Z',
      createdAt: '2026-11-04T00:00:00.000Z',
    } satisfies AICommentExecutorJob;
    const api = {
      getAICommentJob: vi.fn(async () => ({ job: legacyJob })),
      claimAICommentJob: vi.fn(async () => ({
        jobId: 'job-2',
        lockToken: 'lock-1',
        lockTokenVersion: 1,
        leaseExpiresAt: '2026-11-04T00:10:00.000Z',
        archiveId: 'archive-1',
        type: 'summary',
        provider: 'openai-api',
        outputLanguage: 'auto',
      })),
      updateAICommentJobProgress: vi.fn(async (_jobId: string, request: { status: string }) => ({
        job: { jobId: 'job-2', archiveId: 'archive-1', status: request.status, updatedAt: '2026-11-04T00:00:01.000Z' },
        lockToken: 'lock-2',
        lockTokenVersion: 2,
        leaseExpiresAt: '2026-11-04T00:10:00.000Z',
      })),
      uploadAICommentJobResult: vi.fn(async () => Promise.reject(tooLarge())),
      failAICommentJob: vi.fn(async () => ({ job: { jobId: 'job-2', status: 'failed' } })),
    };
    serviceMocks.generateComment.mockResolvedValue({
      content: 'A summary.',
      meta: {
        id: 'generated',
        cli: 'openai-api',
        type: 'summary',
        generatedAt: '2026-11-04T00:00:00.000Z',
        processingTime: 100,
        contentHash: 'hash',
      },
    });
    const { processor, settings } = harness(api);

    await processor.handleRequestedJob('job-2', 'client-1');

    expect(api.uploadAICommentJobResult).toHaveBeenCalledTimes(1);
    expect(api.failAICommentJob).not.toHaveBeenCalled();
    expect(settings.aiCommentPendingUploads['job-2']).toBeUndefined();
    expect(serviceMocks.generateComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cli: 'openai-api', interactive: false }),
    );
  });
});
