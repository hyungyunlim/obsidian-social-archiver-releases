/**
 * AuthorNoteService.createNote collision/idempotency tests
 *
 * Covers the "File already exists." failure class seen during author profile
 * sync: the old collision guard only consulted the vault index
 * (exact-string getFileByPath), so a differently-cased file on a
 * case-insensitive file system — or a concurrent creator winning the race —
 * made vault.create throw on every sync pass.
 */

import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { AuthorNoteService } from '@/services/AuthorNoteService';
import { AUTHOR_NOTE_TYPE, AUTHOR_NOTE_VERSION } from '@/types/author-note';
import type { AuthorNoteData } from '@/types/author-note';
import { TFile } from 'obsidian';
import type { App, MetadataCache, FileManager } from 'obsidian';

// The runtime obsidian mock's TFile constructor takes a path, while the real
// typings declare a 0-arg constructor — construct through a cast so both the
// compiler and the vitest runtime (and instanceof checks) are satisfied.
const TFileCtor = TFile as unknown as new (path: string) => TFile;

function makeTFile(path: string): TFile {
  return new TFileCtor(path);
}

interface MockCtx {
  mockApp: App;
  files: Map<string, TFile>;
  fileCacheMap: Map<string, { frontmatter: Record<string, unknown> }>;
  adapterExists: Mock<[string], Promise<boolean>>;
  create: Mock<[string, string], Promise<TFile>>;
}

function createMockApp(): MockCtx {
  const files = new Map<string, TFile>();
  const fileCacheMap = new Map<string, { frontmatter: Record<string, unknown> }>();

  const adapterExists = vi.fn(async (_path: string) => false);
  const create = vi.fn(async (path: string, _content: string) => {
    const file = makeTFile(path);
    files.set(path, file);
    return file;
  });

  const mockApp = {
    vault: {
      create,
      getFileByPath: vi.fn((path: string) => files.get(path) || null),
      getFolderByPath: vi.fn(() => null),
      createFolder: vi.fn(async () => undefined),
      cachedRead: vi.fn(async () => ''),
      adapter: { exists: adapterExists },
    },
    metadataCache: {
      getFileCache: vi.fn((file: TFile) => fileCacheMap.get(file.path) || null),
    } as unknown as MetadataCache,
    fileManager: {
      processFrontMatter: vi.fn(async () => undefined),
    } as unknown as FileManager,
  } as unknown as App;

  return { mockApp, files, fileCacheMap, adapterExists, create };
}

function createService(mockApp: App): AuthorNoteService {
  return new AuthorNoteService({
    app: mockApp,
    getAuthorNotesPath: () => 'Authors',
    isEnabled: () => true,
  });
}

const AUTHOR_KEY = 'x:url:https://x.com/xguru';

function makeNoteData(overrides?: Partial<AuthorNoteData>): AuthorNoteData {
  return {
    type: AUTHOR_NOTE_TYPE,
    noteVersion: AUTHOR_NOTE_VERSION,
    authorKey: AUTHOR_KEY,
    legacyKeys: [],
    platform: 'x',
    authorName: 'xguru',
    authorUrl: 'https://x.com/xguru',
    authorHandle: 'xguru',
    archiveCount: 0,
    lastSeenAt: '2026-07-01T00:00:00.000Z',
    lastMetadataUpdate: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const PLAIN_PATH = 'Authors/x-xguru.md';
const HASHED_PATH_RE = /^Authors\/x-xguru--[a-z0-9]+\.md$/;

describe('AuthorNoteService.createNote — collision safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the hashed filename when the adapter reports a file the index cannot see', async () => {
    const ctx = createMockApp();
    const service = createService(ctx.mockApp);
    // Case-insensitive FS: 'Authors/X-xguru.md' exists on disk, index lookup
    // for the lowercase path returns null.
    ctx.adapterExists.mockImplementation(async (path: string) => path === PLAIN_PATH);

    const file = await service.createNote(makeNoteData());

    expect(file).not.toBeNull();
    expect(file?.path).toMatch(HASHED_PATH_RE);
    expect(ctx.create).toHaveBeenCalledTimes(1);
    expect(ctx.create.mock.calls[0]?.[0]).toMatch(HASHED_PATH_RE);
  });

  it('adopts the winner when a concurrent creator wins the race for the same author', async () => {
    const ctx = createMockApp();
    const service = createService(ctx.mockApp);
    // vault.create loses the race: throws, and the winner's file (same
    // authorKey — e.g. upsertFromArchive during library sync) is now indexed.
    ctx.create.mockImplementation(async (path: string) => {
      const winner = makeTFile(path);
      ctx.files.set(path, winner);
      ctx.fileCacheMap.set(path, {
        frontmatter: { type: AUTHOR_NOTE_TYPE, authorKey: AUTHOR_KEY, legacyKeys: [] },
      });
      throw new Error('File already exists.');
    });

    const file = await service.createNote(makeNoteData());

    expect(file).not.toBeNull();
    expect(file?.path).toBe(PLAIN_PATH);
    expect(ctx.create).toHaveBeenCalledTimes(1);
  });

  it('returns null with a single warning when every candidate path belongs to another author', async () => {
    const ctx = createMockApp();
    const service = createService(ctx.mockApp);
    const otherAuthor = makeTFile('Authors/occupied.md');
    (ctx.mockApp.vault.getFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(otherAuthor);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const file = await service.createNote(makeNoteData());

    expect(file).toBeNull();
    expect(ctx.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('still creates at the plain path when nothing exists anywhere', async () => {
    const ctx = createMockApp();
    const service = createService(ctx.mockApp);

    const file = await service.createNote(makeNoteData());

    expect(file?.path).toBe(PLAIN_PATH);
    expect(ctx.create).toHaveBeenCalledTimes(1);
  });

  it('adopts an indexed file at the plain path when it already belongs to this author', async () => {
    const ctx = createMockApp();
    const service = createService(ctx.mockApp);
    const existing = makeTFile(PLAIN_PATH);
    ctx.files.set(PLAIN_PATH, existing);
    ctx.fileCacheMap.set(PLAIN_PATH, {
      frontmatter: { type: AUTHOR_NOTE_TYPE, authorKey: AUTHOR_KEY, legacyKeys: [] },
    });

    const file = await service.createNote(makeNoteData());

    expect(file).toBe(existing);
    expect(ctx.create).not.toHaveBeenCalled();
  });

  it('creates the hashed sibling when the plain path is held by a different author in the index', async () => {
    const ctx = createMockApp();
    const service = createService(ctx.mockApp);
    const otherAuthor = makeTFile(PLAIN_PATH);
    ctx.files.set(PLAIN_PATH, otherAuthor);
    ctx.fileCacheMap.set(PLAIN_PATH, {
      frontmatter: { type: AUTHOR_NOTE_TYPE, authorKey: 'x:name:someone-else', legacyKeys: [] },
    });

    const file = await service.createNote(makeNoteData());

    expect(file?.path).toMatch(HASHED_PATH_RE);
  });

  it('survives a missing/failing adapter probe (falls through to vault.create)', async () => {
    const ctx = createMockApp();
    const service = createService(ctx.mockApp);
    ctx.adapterExists.mockRejectedValue(new Error('adapter unavailable'));

    const file = await service.createNote(makeNoteData());

    expect(file?.path).toBe(PLAIN_PATH);
  });
});
