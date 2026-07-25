import type { App } from 'obsidian';
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

function placeJob(extractionInput?: string): AIActionExecutorJob {
  return {
    jobId: 'place-job-1',
    archiveId: 'archive-1',
    targetClientId: 'client-1',
    status: 'claimed',
    actionType: 'places.extract_candidates',
    resultKind: 'place_candidates',
    provider: 'claude',
    outputLanguage: 'auto',
    archiveSnapshot: {
      archive: {
        title: '맛집 모음',
        ...(extractionInput === undefined ? {} : { extractionInput }),
      },
    },
    updatedAt: '2026-07-25T00:00:00.000Z',
    createdAt: '2026-07-25T00:00:00.000Z',
  } as AIActionExecutorJob;
}

function createProcessor(job: AIActionExecutorJob) {
  let lockTokenVersion = 1;
  const claimAIActionJob = vi.fn<WorkersAPIClient['claimAIActionJob']>(async () => ({
    jobId: job.jobId,
    lockToken: 'lock-1',
    lockTokenVersion,
    leaseExpiresAt: '2026-07-25T00:10:00.000Z',
    job,
  }));
  const updateAIActionJobProgress = vi.fn<WorkersAPIClient['updateAIActionJobProgress']>(
    async (_jobId, request) => {
      lockTokenVersion += 1;
      return {
        job: {
          jobId: job.jobId,
          archiveId: job.archiveId,
          targetClientId: 'client-1',
          actionType: job.actionType,
          resultKind: 'place_candidates',
          status: request.status,
          progress: request.progress,
          progressMessage: request.progressMessage,
          updatedAt: '2026-07-25T00:00:01.000Z',
        },
        lockToken: `lock-${lockTokenVersion}`,
        lockTokenVersion,
        leaseExpiresAt: '2026-07-25T00:10:00.000Z',
      };
    },
  );
  const uploadAIActionJobResult = vi.fn<WorkersAPIClient['uploadAIActionJobResult']>(async () => ({
    job: {
      jobId: job.jobId,
      archiveId: job.archiveId,
      targetClientId: 'client-1',
      actionType: job.actionType,
      resultKind: 'place_candidates',
      status: 'completed',
      progress: 100,
      updatedAt: '2026-07-25T00:00:02.000Z',
    },
  }));
  const failAIActionJob = vi.fn<WorkersAPIClient['failAIActionJob']>(async (_jobId, request) => ({
    job: {
      jobId: job.jobId,
      archiveId: job.archiveId,
      targetClientId: 'client-1',
      actionType: job.actionType,
      resultKind: 'place_candidates',
      status: 'failed',
      errorCode: request.errorCode,
      updatedAt: '2026-07-25T00:00:02.000Z',
    },
  }));
  const vaultRead = vi.fn();
  const app = {
    vault: {
      read: vaultRead,
      getMarkdownFiles: vi.fn(() => []),
    },
    metadataCache: { getFileCache: vi.fn() },
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
    archiveLookupService: () => undefined,
    ingestRemoteArchive: vi.fn(async () => {
      throw new Error('Place extraction must not materialize live vault content');
    }),
    isArchiveLibrarySyncRunning: () => false,
    refreshTimelineView: vi.fn(),
    schedule: vi.fn(),
    clearSchedule: vi.fn(),
    notify: vi.fn(),
  });
  return {
    processor,
    uploadAIActionJobResult,
    failAIActionJob,
    vaultRead,
  };
}

describe('AICommentJobProcessor local place extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses frozen OCR/comment input and uploads normalized place candidates', async () => {
    const extractionInput = [
      '## Body',
      '합정 교다이야와 희우를 추천합니다.',
      '## Image text',
      '서울 마포구 주소',
      '## Comments',
      '피코일도 좋아요.',
    ].join('\n');
    const rawCandidates = Array.from({ length: 22 }, (_, index) => ({
      name: `장소 ${index}`,
      addressText: null,
      cityHint: '합정',
      role: index === 0 ? 'recommended' : 'mentioned',
      placeKind: index === 0 ? 'restaurant' : 'not-a-kind',
      placeKindConfidence: 'high',
      evidenceOrigin: index === 21 ? 'comment' : 'body',
      evidenceSpan: index === 0 ? '교다이야' : `장소 ${index}`,
      confidence: 'medium',
      contextSpan: '가'.repeat(600),
      contextTags: ['menu', 'wait', 'quality', 'other'],
    }));
    serviceMocks.generateComment.mockResolvedValue({
      content: JSON.stringify({ candidates: rawCandidates }),
      meta: {
        id: 'generated-id',
        cli: 'claude',
        type: 'custom',
        generatedAt: '2026-07-25T00:00:00.000Z',
        processingTime: 1200,
        contentHash: 'generated-hash',
      },
    });
    const setup = createProcessor(placeJob(extractionInput));

    await setup.processor.handleRequestedAIActionJob('place-job-1', 'client-1');

    expect(serviceMocks.generateComment).toHaveBeenCalledWith(
      extractionInput,
      expect.objectContaining({
        type: 'custom',
        timeoutMs: 5 * 60 * 1000,
        customPrompt: expect.stringContaining('Do not stop after only the first 3, 5, or 8 places.'),
      }),
    );
    const payload = vi.mocked(setup.uploadAIActionJobResult).mock.calls[0]?.[1]
      .result as { kind: string; candidates: Array<Record<string, unknown>> };
    expect(payload.kind).toBe('place_candidates');
    expect(payload.candidates).toHaveLength(20);
    expect(payload.candidates[0]).toMatchObject({
      name: '장소 0',
      role: 'recommended',
      placeKind: 'restaurant',
      contextTags: ['menu', 'wait', 'quality'],
    });
    expect(payload.candidates[0]?.contextSpan).toHaveLength(500);
    expect(payload.candidates[1]?.placeKind).toBeNull();
    expect(setup.vaultRead).not.toHaveBeenCalled();
    expect(setup.failAIActionJob).not.toHaveBeenCalled();
  });

  it('fails before invoking AI when the frozen extraction input is missing', async () => {
    serviceMocks.generateComment.mockResolvedValue({} as AICommentResult);
    const setup = createProcessor(placeJob());

    await setup.processor.handleRequestedAIActionJob('place-job-1', 'client-1');

    expect(serviceMocks.generateComment).not.toHaveBeenCalled();
    expect(setup.uploadAIActionJobResult).not.toHaveBeenCalled();
    expect(setup.vaultRead).not.toHaveBeenCalled();
    expect(setup.failAIActionJob).toHaveBeenCalledWith(
      'place-job-1',
      expect.objectContaining({
        errorCode: 'EXTRACTION_INPUT_MISSING',
        retryable: false,
      }),
    );
  });
});
