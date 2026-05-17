import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';
import { ImportCliError, ImportCliService } from '@/plugin/cli/ImportCliService';
import type { ImportOrchestrator } from '@/types/import';

function makeOrchestrator(overrides: Partial<ImportOrchestrator> = {}): ImportOrchestrator {
  const base: ImportOrchestrator = {
    preflight: vi.fn().mockResolvedValue({
      parts: [
        {
          filename: '/Users/me/instagram-export.zip',
          exportId: 'exp-1',
          partNumber: 1,
          totalParts: 1,
          collection: { id: 'saved', name: 'Saved' },
          counts: { postsInPart: 5, postsInExport: 5, readyToImport: 5, partialMedia: 0, failedPosts: 0 },
          integrityOk: true,
          warnings: [],
        },
      ],
      totalPostsInSelection: 5,
      duplicateCount: 0,
      duplicatePostIds: new Set<string>(),
      readyToImport: 5,
      partialMedia: 0,
      failedPosts: 0,
      errors: [],
    }),
    loadGallery: vi.fn(),
    startImport: vi.fn().mockResolvedValue({ jobId: 'job-abc' }),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue({
      jobId: 'job-abc',
      status: 'running',
      createdAt: Date.now(),
      sourceFiles: [],
      totalItems: 10,
      completedItems: 3,
      failedItems: 0,
      partialMediaItems: 0,
      skippedDuplicates: 0,
      rateLimitPerSec: 1,
      destination: 'inbox',
      tags: [],
    }),
    getItems: vi.fn().mockResolvedValue([]),
    listActiveJobs: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
  return base;
}

function makeService(orchestrator?: ImportOrchestrator): {
  service: ImportCliService;
  orchestrator: ImportOrchestrator;
  readFileAsBlob: ReturnType<typeof vi.fn>;
} {
  const orch = orchestrator ?? makeOrchestrator();
  const readFileAsBlob = vi.fn().mockResolvedValue(new Blob([new Uint8Array([0x50, 0x4b])]));
  const service = new ImportCliService({
    getOrchestrator: async () => orch,
    readFileAsBlob,
  });
  return { service, orchestrator: orch, readFileAsBlob };
}

describe('ImportCliService — platform gate', () => {
  const originalDesktopApp = (Platform as Record<string, unknown>).isDesktopApp;
  const originalIsDesktop = Platform.isDesktop;

  afterEach(() => {
    (Platform as Record<string, unknown>).isDesktopApp = originalDesktopApp;
    (Platform as Record<string, unknown>).isDesktop = originalIsDesktop;
  });

  it('rejects mobile callers with UNSUPPORTED_PLATFORM', async () => {
    (Platform as Record<string, unknown>).isDesktopApp = false;
    (Platform as Record<string, unknown>).isDesktop = false;
    const { service } = makeService();
    await expect(service.preflight(['/abs/path/x.zip'])).rejects.toBeInstanceOf(ImportCliError);
    await expect(service.preflight(['/abs/path/x.zip'])).rejects.toMatchObject({
      code: 'UNSUPPORTED_PLATFORM',
    });
  });
});

describe('ImportCliService — preflight + start', () => {
  beforeEach(() => {
    (Platform as Record<string, unknown>).isDesktopApp = true;
    (Platform as Record<string, unknown>).isDesktop = true;
  });

  it('preflight calls orchestrator.preflight but does NOT start a job', async () => {
    const { service, orchestrator } = makeService();
    const result = await service.preflight(['/abs/file.zip']);
    expect(orchestrator.preflight).toHaveBeenCalledTimes(1);
    expect(orchestrator.startImport).not.toHaveBeenCalled();
    expect(result.totalPostsInSelection).toBe(5);
  });

  it('preflight redacts absolute paths to filename by default', async () => {
    const { service } = makeService();
    const result = await service.preflight(['/Users/me/instagram-export.zip']);
    expect(result.parts[0]!.filename).toBe('instagram-export.zip');
  });

  it('preflight verbose=true preserves absolute paths', async () => {
    const { service } = makeService();
    const result = await service.preflight(['/Users/me/instagram-export.zip'], { verbose: true });
    expect(result.parts[0]!.filename).toBe('/Users/me/instagram-export.zip');
  });

  it('start returns jobId immediately and does not await completion', async () => {
    const { service, orchestrator } = makeService();
    const { jobId } = await service.start(['/abs/file.zip'], { destination: 'inbox' });
    expect(jobId).toBe('job-abc');
    expect(orchestrator.startImport).toHaveBeenCalledTimes(1);
  });

  it('throws INVALID_ARGUMENT when files array is empty', async () => {
    const { service } = makeService();
    await expect(service.preflight([])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('getJob throws JOB_NOT_FOUND when the orchestrator returns null', async () => {
    const orch = makeOrchestrator({ getJob: vi.fn().mockResolvedValue(null) });
    const { service } = makeService(orch);
    await expect(service.getJob('unknown')).rejects.toMatchObject({
      code: 'JOB_NOT_FOUND',
    });
  });

  it('control forwards pause/resume/cancel correctly', async () => {
    const { service, orchestrator } = makeService();
    await service.control('job-abc', 'pause');
    expect(orchestrator.pause).toHaveBeenCalledWith('job-abc');
    await service.control('job-abc', 'resume');
    expect(orchestrator.resume).toHaveBeenCalledWith('job-abc');
    await service.control('job-abc', 'cancel');
    expect(orchestrator.cancel).toHaveBeenCalledWith('job-abc');
  });
});
