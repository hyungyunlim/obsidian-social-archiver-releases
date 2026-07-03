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

/**
 * Drive a `tags.suggest_apply` AI action job end-to-end and return the
 * `customPrompt` (the tag instruction text) that reached AICommentService.
 * The tag/translate path runs through the type:'custom' branch where the
 * outputLanguage option is a NO-OP, so the language directive must live in the
 * instruction text — that is exactly what we assert here.
 */
async function runTagJobAndCapturePrompt(outputLanguage: string | null): Promise<string> {
  const file = { path: 'Social Archives/Web/post.md' } as TFile;
  let markdown = [
    '---',
    'sourceArchiveId: archive-1',
    '---',
    '# Archive title',
    '',
    '쿠버네티스는 컨테이너 오케스트레이션 플랫폼입니다.',
  ].join('\n');

  const actionJob = {
    jobId: 'job-1',
    archiveId: 'archive-1',
    targetClientId: 'client-1',
    status: 'claimed',
    actionType: 'tags.suggest_apply',
    resultKind: 'tag_patch',
    provider: 'claude',
    outputLanguage,
    archiveSnapshot: {
      archive: {
        title: 'Archive title',
        previewText: '쿠버네티스는 컨테이너 오케스트레이션 플랫폼입니다.',
      },
    },
    updatedAt: '2026-07-02T00:00:00.000Z',
    createdAt: '2026-07-02T00:00:00.000Z',
  } as unknown as AIActionExecutorJob;

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
          actionType: 'tags.suggest_apply',
          resultKind: 'tag_patch',
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
      actionType: 'tags.suggest_apply',
      resultKind: 'tag_patch',
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
      actionType: 'tags.suggest_apply',
      resultKind: 'tag_patch',
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

  expect(failAIActionJob).not.toHaveBeenCalled();
  expect(uploadAIActionJobResult).toHaveBeenCalledWith(
    'job-1',
    expect.objectContaining({
      result: expect.objectContaining({ kind: 'tag_patch' }),
    }),
  );
  expect(serviceMocks.generateComment).toHaveBeenCalledTimes(1);
  const call = serviceMocks.generateComment.mock.calls[0];
  const options = call?.[1] as { type?: string; customPrompt?: string } | undefined;
  expect(options?.type).toBe('custom');
  return options?.customPrompt ?? '';
}

describe('AICommentJobProcessor tag-language instruction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // AICommentService returns a JSON tag payload for the tag prompt.
    serviceMocks.generateComment.mockResolvedValue({
      content: '{"addTags":["쿠버네티스"],"removeTags":[]}',
      meta: {
        id: 'generated-id',
        cli: 'claude',
        type: 'custom',
        generatedAt: '2026-07-02T00:00:00.000Z',
        processingTime: 1200,
        contentHash: 'generated-hash',
      },
    });
  });

  it('embeds an explicit auto directive when the job language is "auto"', async () => {
    const prompt = await runTagJobAndCapturePrompt('auto');
    expect(prompt).toContain('Write every tag in the same language as the archive content.');
    expect(prompt).toContain('Do not use English tags just because these instructions are written in English.');
    expect(prompt).toContain('Use natural word spacing for that language; do not use kebab-case.');
    // Never emits a concrete "Write every tag in <Language>." sentence for auto.
    expect(prompt).not.toMatch(/Write every tag in (?!the same language)/);
  });

  it('embeds an explicit auto directive when the job language is null', async () => {
    const prompt = await runTagJobAndCapturePrompt(null);
    expect(prompt).toContain('Write every tag in the same language as the archive content.');
  });

  it('embeds an explicit auto directive for an unknown language code', async () => {
    const prompt = await runTagJobAndCapturePrompt('xx');
    expect(prompt).toContain('Write every tag in the same language as the archive content.');
    expect(prompt).not.toContain('Write every tag in xx.');
  });

  it('embeds a strengthened concrete directive for a known language code', async () => {
    const prompt = await runTagJobAndCapturePrompt('ko');
    expect(prompt).toContain('Write every tag in Korean.');
    expect(prompt).toContain('Translate source-language concepts into Korean tags when needed.');
    expect(prompt).toContain('Do not use English tags unless Korean is English or the term is a proper noun, product name, or code token.');
  });

  it('maps the newly supported codes (it/vi/th/id/ru/ar/hi) to language names', async () => {
    const cases: Array<[string, string]> = [
      ['it', 'Italian'],
      ['vi', 'Vietnamese'],
      ['th', 'Thai'],
      ['id', 'Indonesian'],
      ['ru', 'Russian'],
      ['ar', 'Arabic'],
      ['hi', 'Hindi'],
    ];
    for (const [code, name] of cases) {
      vi.clearAllMocks();
      serviceMocks.generateComment.mockResolvedValue({
        content: '{"addTags":["tag"],"removeTags":[]}',
        meta: {
          id: 'generated-id',
          cli: 'claude',
          type: 'custom',
          generatedAt: '2026-07-02T00:00:00.000Z',
          processingTime: 1200,
          contentHash: 'generated-hash',
        },
      });
      const prompt = await runTagJobAndCapturePrompt(code);
      expect(prompt).toContain(`Write every tag in ${name}.`);
    }
  });

  it('parses a primary-subtag language code (e.g. "ko-KR") to the base language', async () => {
    const prompt = await runTagJobAndCapturePrompt('ko-KR');
    expect(prompt).toContain('Write every tag in Korean.');
  });
});
