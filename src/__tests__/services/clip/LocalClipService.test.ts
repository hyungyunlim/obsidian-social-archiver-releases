import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalClipService } from '@/services/clip/LocalClipService';
import type { ArchiveOrchestrator } from '@/services/ArchiveOrchestrator';
import type { ClipPayload } from '@/types/clip';
import type { PostData } from '@/types/post';

function makePostData(overrides: Partial<PostData> = {}): PostData {
  return {
    platform: 'instagram',
    id: 'DEMO123',
    url: 'https://www.instagram.com/p/DEMO123/',
    author: { name: 'Demo User', url: 'https://www.instagram.com/demo/' },
    content: { text: 'Hello from a clipped post' },
    media: [],
    metadata: { timestamp: '2026-06-01T12:00:00.000Z' },
    ...overrides,
  };
}

function makePayload(postData: PostData, overrides: Partial<ClipPayload> = {}): ClipPayload {
  return {
    v: 1,
    source: 'chrome-extension',
    sourceVersion: '1.7.0',
    clippedAt: '2026-06-10T09:00:00.000Z',
    mediaDelivery: 'remote',
    postData,
    ...overrides,
  };
}

describe('LocalClipService', () => {
  let mockOrchestrator: ArchiveOrchestrator;
  let orchestrateFromPostData: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    orchestrateFromPostData = vi.fn().mockResolvedValue({
      success: true,
      filePath: 'Social Archives/Instagram/2026/06/note.md',
      creditsUsed: 0,
    });
    mockOrchestrator = {
      orchestrateFromPostData,
    } as unknown as ArchiveOrchestrator;
  });

  it('imports a clip through the orchestrator and returns the file path', async () => {
    const service = new LocalClipService({ getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator });
    const result = await service.importClip(makePayload(makePostData()));

    expect(result.filePath).toBe('Social Archives/Instagram/2026/06/note.md');
    expect(orchestrateFromPostData).toHaveBeenCalledTimes(1);
  });

  it('marks local-only provenance on the post data', async () => {
    const postData = makePostData({ sourceArchiveId: 'should-be-removed' });
    const service = new LocalClipService({ getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator });

    await service.importClip(makePayload(postData));

    expect(postData.metadata.socialArchiverImportMode).toBe('local-only');
    expect(postData.metadata.socialArchiverImportSource).toBe('browser-clip:chrome-extension');
    expect(postData.metadata.socialArchiverServerArchiveId).toBe('none');
    expect(postData.sourceArchiveId).toBeUndefined();
  });

  it('sets archivedDate from clippedAt when absent', async () => {
    const postData = makePostData();
    const service = new LocalClipService({ getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator });

    await service.importClip(makePayload(postData, { clippedAt: '2026-06-10T09:00:00.000Z' }));

    expect(postData.archivedDate).toBeInstanceOf(Date);
    expect(postData.archivedDate?.toISOString()).toBe('2026-06-10T09:00:00.000Z');
  });

  it('falls back to now when clippedAt is missing or invalid, and preserves an existing archivedDate', async () => {
    const service = new LocalClipService({ getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator });

    const withoutClippedAt = makePostData();
    await service.importClip(makePayload(withoutClippedAt, { clippedAt: undefined }));
    expect(withoutClippedAt.archivedDate).toBeInstanceOf(Date);

    const existing = new Date('2026-01-01T00:00:00.000Z');
    const withExisting = makePostData({ archivedDate: existing });
    await service.importClip(makePayload(withExisting));
    expect(withExisting.archivedDate).toBe(existing);
  });

  it('passes background-safe, credit-free options to the orchestrator', async () => {
    const service = new LocalClipService({ getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator });
    await service.importClip(makePayload(makePostData()));

    const options = orchestrateFromPostData.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      enableAI: false,
      deepResearch: false,
      generateShareLink: false,
      downloadMedia: true,
      isForeground: false,
    });
  });

  it('honors downloadMedia: false from config', async () => {
    const service = new LocalClipService({
      getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator,
      downloadMedia: false,
    });
    await service.importClip(makePayload(makePostData()));

    const options = orchestrateFromPostData.mock.calls[0]?.[1];
    expect(options.downloadMedia).toBe(false);
  });

  it('skips media download for local media delivery (Channel B+ folder handoff)', async () => {
    const service = new LocalClipService({ getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator });
    await service.importClip(makePayload(makePostData(), { mediaDelivery: 'local' }));

    const options = orchestrateFromPostData.mock.calls[0]?.[1];
    expect(options.downloadMedia).toBe(false);
  });

  it('keeps media download enabled for remote media delivery', async () => {
    const service = new LocalClipService({ getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator });
    await service.importClip(makePayload(makePostData(), { mediaDelivery: 'remote' }));

    const options = orchestrateFromPostData.mock.calls[0]?.[1];
    expect(options.downloadMedia).toBe(true);
  });

  it('throws when the orchestrator is not yet available', async () => {
    const service = new LocalClipService({ getOrchestrator: (): undefined => undefined });
    await expect(service.importClip(makePayload(makePostData()))).rejects.toThrow(
      /still initializing/
    );
    expect(orchestrateFromPostData).not.toHaveBeenCalled();
  });

  it('surfaces orchestrator failures as errors', async () => {
    orchestrateFromPostData.mockResolvedValue({
      success: false,
      error: 'Disk full',
      creditsUsed: 0,
    });
    const service = new LocalClipService({ getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator });

    await expect(service.importClip(makePayload(makePostData()))).rejects.toThrow('Disk full');
  });

  it('throws a generic error when the orchestrator fails without a message', async () => {
    orchestrateFromPostData.mockResolvedValue({ success: false, creditsUsed: 0 });
    const service = new LocalClipService({ getOrchestrator: (): ArchiveOrchestrator => mockOrchestrator });

    await expect(service.importClip(makePayload(makePostData()))).rejects.toThrow(
      'Clip import failed'
    );
  });
});
