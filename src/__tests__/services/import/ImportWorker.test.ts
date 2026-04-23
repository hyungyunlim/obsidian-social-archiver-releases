/**
 * Unit tests for ImportWorker — state transitions, retries, and vault hook.
 *
 * No ZIP / network I/O — every dependency is injected as a fake.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Vault } from 'obsidian';
import { ImportJobStore } from '@/services/import/ImportJobStore';
import { ImportProgressBus } from '@/services/import/ImportProgressBus';
import { ImportWorker } from '@/services/import/ImportWorker';
import type {
  ImportAPIClient,
  ImportItem,
  ImportJobState,
  ImportLogger,
  ImportProgressEvent,
} from '@/types/import';
import type { PostData } from '@/types/post';

function makeVault(): Vault {
  const m = new Map<string, string>();
  return {
    adapter: {
      read: vi.fn(async (path: string) => {
        const v = m.get(path);
        if (v === undefined) throw new Error('ENOENT');
        return v;
      }),
      write: vi.fn(async (path: string, content: string) => {
        m.set(path, content);
      }),
    },
  } as unknown as Vault;
}

function makeLogger(): ImportLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePostData(id: string): PostData {
  return {
    platform: 'instagram',
    id,
    url: `https://instagram.com/p/${id}/`,
    author: { name: 'a', url: 'https://x', handle: '@a' },
    content: { text: '' },
    media: [],
    metadata: { timestamp: new Date('2026-01-01T00:00:00Z') },
  } as PostData;
}

function makeJob(overrides: Partial<ImportJobState> = {}): ImportJobState {
  return {
    jobId: 'job1',
    status: 'queued',
    createdAt: Date.now(),
    sourceFiles: [
      {
        filename: 'a.zip',
        size: 1,
        exportId: 'exp1',
        partNumber: 1,
        totalParts: 1,
      },
    ],
    totalItems: 0,
    completedItems: 0,
    failedItems: 0,
    partialMediaItems: 0,
    skippedDuplicates: 0,
    rateLimitPerSec: 100, // max rate so tests are fast
    destination: 'inbox',
    tags: [],
    ...overrides,
  };
}

function makeItem(postId: string, overrides: Partial<ImportItem> = {}): ImportItem {
  return {
    jobId: 'job1',
    postId,
    shortcode: postId,
    collectionId: 'c1',
    partFilename: 'a.zip',
    status: 'pending',
    retryCount: 0,
    ...overrides,
  };
}

describe('ImportWorker', () => {
  let store: ImportJobStore;
  let bus: ImportProgressBus;
  let logger: ImportLogger;
  let events: ImportProgressEvent[];

  beforeEach(async () => {
    store = new ImportJobStore(makeVault(), '.obsidian/plugins/test');
    await store.load();
    bus = new ImportProgressBus();
    events = [];
    bus.subscribe((e) => events.push(e));
    logger = makeLogger();
  });

  afterEach(async () => {
    await store.flush();
  });

  function makeAPI(overrides: Partial<ImportAPIClient> = {}): ImportAPIClient {
    return {
      preflight: vi.fn(async () => ({ duplicates: [], accepted: 0 })),
      createArchiveFromImport: vi.fn(async ({ clientPostData }) => ({
        archiveId: `arch-${clientPostData.id}`,
        skippedDuplicate: false,
      })),
      uploadArchiveMedia: vi.fn(async () => ({ uploaded: 0, failed: [] })),
      finalizeImportJob: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('marks items uploaded on happy path and emits completion summary', async () => {
    store.createJob(makeJob({ totalItems: 2 }), [makeItem('p1'), makeItem('p2')]);
    const api = makeAPI();
    const postData = new Map([
      ['p1', makePostData('p1')],
      ['p2', makePostData('p2')],
    ]);

    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => undefined,
      postDataFor: (id) => postData.get(id),
    });
    await worker.start();

    const items = store.getItems('job1');
    expect(items.every((it) => it.status === 'uploaded')).toBe(true);
    expect(store.getJob('job1')?.status).toBe('completed');

    const completion = events.find((e) => e.type === 'job.completed');
    expect(completion).toBeDefined();
    if (completion && completion.type === 'job.completed') {
      expect(completion.summary.imported).toBe(2);
      expect(completion.summary.failed).toBe(0);
    }
    expect(api.finalizeImportJob).toHaveBeenCalledTimes(1);
  });

  it('retries archive creation up to MAX_ITEM_RETRIES, then fails the item', async () => {
    store.createJob(makeJob({ totalItems: 1 }), [makeItem('p1')]);
    let attempts = 0;
    const api = makeAPI({
      createArchiveFromImport: vi.fn(async () => {
        attempts++;
        throw new Error('server down');
      }),
    });
    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => undefined,
      postDataFor: () => makePostData('p1'),
    });
    await worker.start();
    // 1 initial + 3 retries = 4 attempts per worker pass.
    expect(attempts).toBeGreaterThanOrEqual(4);
    const item = store.getItems('job1')[0]!;
    expect(item.status).toBe('failed');
    expect(item.errorMessage).toContain('server down');
    expect(store.getJob('job1')?.status).toBe('completed');
  });

  it('records skipped_duplicate when server reports dupe', async () => {
    store.createJob(makeJob({ totalItems: 1 }), [makeItem('p1')]);
    const api = makeAPI({
      createArchiveFromImport: vi.fn(async () => ({
        archiveId: 'arch-p1',
        skippedDuplicate: true,
      })),
    });
    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => undefined,
      postDataFor: () => makePostData('p1'),
    });
    await worker.start();
    expect(store.getItems('job1')[0]!.status).toBe('skipped_duplicate');
  });

  it('applies destination=archive and merged tags to PostData before archive + vault hook', async () => {
    store.createJob(
      makeJob({
        totalItems: 1,
        destination: 'archive',
        tags: ['ig/saved', 'travel'],
      }),
      [makeItem('p1')],
    );
    const createCalls: Array<{ archive: boolean | undefined; tags: string[] | undefined }> = [];
    const api = makeAPI({
      createArchiveFromImport: vi.fn(async ({ clientPostData }) => {
        createCalls.push({
          archive: clientPostData.archive,
          tags: clientPostData.tags ? [...clientPostData.tags] : undefined,
        });
        return { archiveId: `arch-${clientPostData.id}`, skippedDuplicate: false };
      }),
    });
    const hookCalls: Array<{ archive: boolean | undefined; tags: string[] | undefined }> = [];
    const onArchiveCreated = vi.fn(async (_archiveId: string, postData: PostData) => {
      hookCalls.push({
        archive: postData.archive,
        tags: postData.tags ? [...postData.tags] : undefined,
      });
    });

    // PostData already carries one pre-existing tag — ensure merge dedupes
    // case-insensitively and preserves the first-seen casing.
    const seed = makePostData('p1');
    (seed as PostData & { tags?: string[] }).tags = ['Travel'];

    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => undefined,
      postDataFor: () => seed,
      onArchiveCreated,
    });
    await worker.start();

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]!.archive).toBe(true);
    expect(createCalls[0]!.tags).toEqual(['Travel', 'ig/saved']);
    expect(hookCalls).toHaveLength(1);
    expect(hookCalls[0]!.archive).toBe(true);
    expect(hookCalls[0]!.tags).toEqual(['Travel', 'ig/saved']);
    expect(store.getItems('job1')[0]!.status).toBe('uploaded');
  });

  it('defaults destination to inbox (archive=false) and leaves tags untouched when job has none', async () => {
    store.createJob(makeJob({ totalItems: 1 }), [makeItem('p1')]);
    let seenArchive: boolean | undefined = undefined;
    let seenTags: string[] | undefined = undefined;
    const api = makeAPI({
      createArchiveFromImport: vi.fn(async ({ clientPostData }) => {
        seenArchive = clientPostData.archive;
        seenTags = clientPostData.tags ? [...clientPostData.tags] : undefined;
        return { archiveId: `arch-${clientPostData.id}`, skippedDuplicate: false };
      }),
    });
    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => undefined,
      postDataFor: () => makePostData('p1'),
    });
    await worker.start();
    expect(seenArchive).toBe(false);
    // makePostData does not set tags; worker should leave it unset.
    expect(seenTags).toBeUndefined();
  });

  it('writes media bytes to vault and rewrites postData URLs before onArchiveCreated', async () => {
    store.createJob(makeJob({ totalItems: 1 }), [
      makeItem('p1', {
        mediaPaths: [
          'media/C7WFj5WuiVm/00-video.mp4',
          'media/C7WFj5WuiVm/00-video-thumb.jpg',
          'media/C7WFj5WuiVm/avatar.jpg',
        ],
      }),
    ]);

    const writtenPaths: string[] = [];
    const fakeVault = {
      adapter: {
        exists: vi.fn(async () => true),
        writeBinary: vi.fn(async (path: string) => {
          writtenPaths.push(path);
        }),
      },
      createFolder: vi.fn(async () => undefined),
    } as unknown as import('obsidian').Vault;

    const seed = makePostData('p1');
    seed.media = [
      {
        type: 'video',
        url: './media/C7WFj5WuiVm/00-video.mp4',
        thumbnail: './media/C7WFj5WuiVm/00-video-thumb.jpg',
      },
    ];
    seed.author = { ...seed.author, avatar: './media/C7WFj5WuiVm/avatar.jpg' };
    (seed as unknown as { raw: { code: string } }).raw = { code: 'C7WFj5WuiVm' };

    const fakeReader = {
      extractMediaFile: vi.fn(async (_rel: string) => new ArrayBuffer(16)),
    } as unknown as import('@/services/import/ImportZipReader').ImportZipReader;

    const api = makeAPI();
    const hookSnapshots: Array<{
      url: string | undefined;
      thumbnail: string | undefined;
      avatar: string | undefined;
      localAvatar: string | undefined;
    }> = [];
    const onArchiveCreated = vi.fn(async (_archiveId: string, postData: PostData) => {
      hookSnapshots.push({
        url: postData.media[0]?.url,
        thumbnail: postData.media[0]?.thumbnail,
        avatar: postData.author.avatar,
        localAvatar: (postData.author as { localAvatar?: string }).localAvatar,
      });
    });

    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => fakeReader,
      postDataFor: () => seed,
      onArchiveCreated,
      vault: fakeVault,
      mediaBasePath: 'attachments/social-archives',
    });
    await worker.start();

    // All three files written into the vault under the platform + shortcode folder.
    expect(writtenPaths).toEqual([
      'attachments/social-archives/instagram/C7WFj5WuiVm/00-video.mp4',
      'attachments/social-archives/instagram/C7WFj5WuiVm/00-video-thumb.jpg',
      'attachments/social-archives/instagram/C7WFj5WuiVm/avatar.jpg',
    ]);

    // URLs in postData were rewritten before the note-creation hook fired.
    expect(hookSnapshots).toHaveLength(1);
    const snap = hookSnapshots[0]!;
    expect(snap.url).toBe('attachments/social-archives/instagram/C7WFj5WuiVm/00-video.mp4');
    expect(snap.thumbnail).toBe('attachments/social-archives/instagram/C7WFj5WuiVm/00-video-thumb.jpg');
    expect(snap.avatar).toBe('attachments/social-archives/instagram/C7WFj5WuiVm/avatar.jpg');
    expect(snap.localAvatar).toBe('attachments/social-archives/instagram/C7WFj5WuiVm/avatar.jpg');

    expect(store.getItems('job1')[0]!.status).toBe('uploaded');
  });

  it('downgrades to imported_with_warnings when vault hook throws', async () => {
    store.createJob(makeJob({ totalItems: 1 }), [makeItem('p1')]);
    const api = makeAPI();
    const onArchiveCreated = vi.fn().mockRejectedValue(new Error('vault write failed'));
    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => undefined,
      postDataFor: () => makePostData('p1'),
      onArchiveCreated,
    });
    await worker.start();
    expect(store.getItems('job1')[0]!.status).toBe('imported_with_warnings');
    expect(store.getJob('job1')?.status).toBe('completed');
    expect(onArchiveCreated).toHaveBeenCalled();
  });

  it('pause() stops the loop; resume() finishes the remaining items', async () => {
    // 3 items, pause after the first completes.
    store.createJob(makeJob({ totalItems: 3, rateLimitPerSec: 10 }), [
      makeItem('p1'),
      makeItem('p2'),
      makeItem('p3'),
    ]);
    const api = makeAPI();
    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => undefined,
      postDataFor: (id) => makePostData(id),
    });

    // Pause immediately after starting — at least one item will be processed
    // before the loop re-checks the paused flag; that's the intended behavior.
    const p = worker.start();
    await worker.pause();
    await p;
    const pausedItems = store.getItems('job1');
    expect(pausedItems.some((it) => it.status === 'pending')).toBe(true);
    expect(store.getJob('job1')?.status).toBe('paused');

    // Resume and finish.
    await worker.resume();
    const job = store.getJob('job1');
    expect(job?.status).toBe('completed');
    expect(store.getItems('job1').every((it) => it.status === 'uploaded')).toBe(true);
  });

  it('cancel() marks job cancelled and does not dispatch more items', async () => {
    store.createJob(makeJob({ totalItems: 5, rateLimitPerSec: 0.5 }), [
      makeItem('p1'),
      makeItem('p2'),
      makeItem('p3'),
      makeItem('p4'),
      makeItem('p5'),
    ]);
    const api = makeAPI();
    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => undefined,
      postDataFor: (id) => makePostData(id),
    });
    const started = worker.start();
    await worker.cancel();
    await started;
    expect(store.getJob('job1')?.status).toBe('cancelled');
    // Not every item will have been processed.
    const uploaded = store.getItems('job1').filter((it) => it.status === 'uploaded').length;
    expect(uploaded).toBeLessThan(5);
  });

  it('fails gracefully when postData is missing', async () => {
    store.createJob(makeJob({ totalItems: 1 }), [makeItem('p1')]);
    const api = makeAPI();
    const worker = new ImportWorker('job1', {
      apiClient: api,
      jobStore: store,
      progressBus: bus,
      logger,
      zipReaderFor: () => undefined,
      postDataFor: () => undefined, // simulates closed ZIP
    });
    await worker.start();
    const item = store.getItems('job1')[0]!;
    expect(item.status).toBe('failed');
    expect(item.errorMessage).toContain('post data not available');
  });
});
