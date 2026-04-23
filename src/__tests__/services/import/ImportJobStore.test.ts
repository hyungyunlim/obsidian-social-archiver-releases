/**
 * Unit tests for ImportJobStore — in-memory + retention.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Vault } from 'obsidian';
import { ImportJobStore } from '@/services/import/ImportJobStore';
import type { ImportItem, ImportJobState } from '@/types/import';

function fakeVault(initial?: string): { vault: Vault; store: Map<string, string> } {
  const store = new Map<string, string>();
  if (initial) store.set('.obsidian/plugins/test/import-jobs.json', initial);
  const vault = {
    adapter: {
      read: vi.fn(async (path: string) => {
        const v = store.get(path);
        if (v === undefined) throw new Error('ENOENT');
        return v;
      }),
      write: vi.fn(async (path: string, content: string) => {
        store.set(path, content);
      }),
    },
  } as unknown as Vault;
  return { vault, store };
}

function mkJob(id: string, overrides: Partial<ImportJobState> = {}): ImportJobState {
  return {
    jobId: id,
    status: 'queued',
    createdAt: Date.now(),
    sourceFiles: [],
    totalItems: 1,
    completedItems: 0,
    failedItems: 0,
    partialMediaItems: 0,
    skippedDuplicates: 0,
    rateLimitPerSec: 1,
    destination: 'inbox',
    tags: [],
    ...overrides,
  };
}

function mkItem(jobId: string, postId: string): ImportItem {
  return {
    jobId,
    postId,
    shortcode: postId,
    collectionId: 'c1',
    partFilename: 'a.zip',
    status: 'pending',
    retryCount: 0,
  };
}

describe('ImportJobStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('load() starts empty when file is absent', async () => {
    const { vault } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    expect(store.listJobs()).toEqual([]);
    expect(store.getActiveJobId()).toBeNull();
  });

  it('createJob + getJob round-trips', async () => {
    const { vault } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    const job = mkJob('j1');
    store.createJob(job, [mkItem('j1', 'p1')]);
    expect(store.getJob('j1')).toEqual(job);
    expect(store.getItems('j1')).toHaveLength(1);
  });

  it('updateJob replaces state', async () => {
    const { vault } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    store.createJob(mkJob('j1'), []);
    store.updateJob({ ...mkJob('j1'), status: 'running', completedItems: 5 });
    expect(store.getJob('j1')?.status).toBe('running');
  });

  it('updateJob throws when job does not exist', async () => {
    const { vault } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    expect(() => store.updateJob(mkJob('missing'))).toThrow(/not found/);
  });

  it('createJob rejects duplicate id', async () => {
    const { vault } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    store.createJob(mkJob('j1'), []);
    expect(() => store.createJob(mkJob('j1'), [])).toThrow(/already exists/);
  });

  it('deleteJob removes the record and clears active pointer if matched', async () => {
    const { vault } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    store.createJob(mkJob('j1'), []);
    store.setActiveJobId('j1');
    store.deleteJob('j1');
    expect(store.getJob('j1')).toBeNull();
    expect(store.getActiveJobId()).toBeNull();
  });

  it('listActiveJobs filters by status', async () => {
    const { vault } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    store.createJob(mkJob('j1', { status: 'running' }), []);
    store.createJob(mkJob('j2', { status: 'completed' }), []);
    store.createJob(mkJob('j3', { status: 'paused' }), []);
    const active = store.listActiveJobs();
    expect(active.map((j) => j.jobId).sort()).toEqual(['j1', 'j3']);
  });

  it('flush persists to adapter', async () => {
    const { vault, store: backing } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    store.createJob(mkJob('j1'), [mkItem('j1', 'p1')]);
    await store.flush();
    const raw = backing.get('.obsidian/plugins/test/import-jobs.json');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.jobs.j1.jobId).toBe('j1');
    expect(parsed.items.j1).toHaveLength(1);
  });

  it('survives a reload cycle (Obsidian restart simulation)', async () => {
    const { vault, store: backing } = fakeVault();
    const first = new ImportJobStore(vault, '.obsidian/plugins/test');
    await first.load();
    first.createJob(mkJob('j1', { status: 'paused' }), [mkItem('j1', 'p1')]);
    await first.flush();

    const second = new ImportJobStore(vault, '.obsidian/plugins/test');
    await second.load();
    expect(second.getJob('j1')?.status).toBe('paused');
    expect(second.getItems('j1')).toHaveLength(1);

    // Belt-and-suspenders: data is truly in the adapter blob.
    expect(backing.get('.obsidian/plugins/test/import-jobs.json')).toBeTruthy();
  });

  it('prunes expired completed jobs on load', async () => {
    const ancient: ImportJobState = mkJob('j-old', {
      status: 'completed',
      completedAt: Date.now() - 1000 * 60 * 60 * 24 * 100,
    });
    const initial = JSON.stringify({
      version: 1,
      jobs: { 'j-old': ancient },
      items: { 'j-old': [] },
      activeJobId: null,
    });
    const { vault } = fakeVault(initial);
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    expect(store.getJob('j-old')).toBeNull();
  });

  it('keeps recently completed jobs', async () => {
    const recent: ImportJobState = mkJob('j-recent', {
      status: 'completed',
      completedAt: Date.now() - 1000 * 60 * 60,
    });
    const initial = JSON.stringify({
      version: 1,
      jobs: { 'j-recent': recent },
      items: { 'j-recent': [] },
      activeJobId: null,
    });
    const { vault } = fakeVault(initial);
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    expect(store.getJob('j-recent')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Schema migration v1 → v2 (gallery PRD §9.7) + Set serialization
  // -------------------------------------------------------------------------

  it('migrates a v1 snapshot to v2 without data loss', async () => {
    // Build a v1 file by hand. v1 jobs have no `gallerySelection` field —
    // that's the whole point: v2 just makes the field available, existing
    // rows stay structurally valid.
    const recent = mkJob('j-legacy', {
      status: 'paused',
      completedAt: Date.now() - 1000 * 60,
    });
    const initial = JSON.stringify({
      version: 1,
      jobs: { 'j-legacy': recent },
      items: { 'j-legacy': [mkItem('j-legacy', 'p1')] },
      activeJobId: 'j-legacy',
    });
    const { vault, store: backing } = fakeVault(initial);
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();

    // Original job survives.
    expect(store.getJob('j-legacy')?.status).toBe('paused');
    expect(store.getItems('j-legacy')).toHaveLength(1);
    expect(store.getActiveJobId()).toBe('j-legacy');

    // Drain the debounced save and verify the on-disk version was bumped.
    await store.flush();
    const rewritten = JSON.parse(backing.get('.obsidian/plugins/test/import-jobs.json')!);
    expect(rewritten.version).toBe(2);
    expect(rewritten.jobs['j-legacy']).toBeDefined();
  });

  it('round-trips gallerySelection through Set ↔ Array', async () => {
    const { vault, store: backing } = fakeVault();
    const first = new ImportJobStore(vault, '.obsidian/plugins/test');
    await first.load();

    const job = mkJob('j-sel', {
      gallerySelection: { mode: 'only', ids: new Set(['a', 'b', 'c']) },
    });
    first.createJob(job, []);
    await first.flush();

    // The on-disk encoding stores ids as an array (Set is not JSON-native).
    const onDisk = JSON.parse(backing.get('.obsidian/plugins/test/import-jobs.json')!);
    expect(onDisk.jobs['j-sel'].gallerySelection.mode).toBe('only');
    expect(Array.isArray(onDisk.jobs['j-sel'].gallerySelection.ids)).toBe(true);
    expect((onDisk.jobs['j-sel'].gallerySelection.ids as string[]).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);

    // After re-load, the Set instance is restored.
    const second = new ImportJobStore(vault, '.obsidian/plugins/test');
    await second.load();
    const reloaded = second.getJob('j-sel');
    expect(reloaded?.gallerySelection?.mode).toBe('only');
    expect(reloaded?.gallerySelection?.ids).toBeInstanceOf(Set);
    expect(Array.from(reloaded!.gallerySelection!.ids).sort()).toEqual(['a', 'b', 'c']);
  });

  it('omits gallerySelection on disk when the job has none', async () => {
    const { vault, store: backing } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    store.createJob(mkJob('j-plain'), []);
    await store.flush();
    const onDisk = JSON.parse(backing.get('.obsidian/plugins/test/import-jobs.json')!);
    expect(onDisk.jobs['j-plain'].gallerySelection).toBeUndefined();
  });

  it('updateJob clears gallerySelection when omitted', async () => {
    const { vault } = fakeVault();
    const store = new ImportJobStore(vault, '.obsidian/plugins/test');
    await store.load();
    store.createJob(
      mkJob('j-clr', {
        gallerySelection: { mode: 'all-except', ids: new Set(['x']) },
      }),
      [],
    );
    expect(store.getJob('j-clr')?.gallerySelection).toBeDefined();

    // Replacement state without the field — used by orchestrator's
    // terminal-event cleanup (PRD F3.6).
    const { gallerySelection: _drop, ...rest } = store.getJob('j-clr')!;
    store.updateJob(rest);
    expect(store.getJob('j-clr')?.gallerySelection).toBeUndefined();
  });
});
