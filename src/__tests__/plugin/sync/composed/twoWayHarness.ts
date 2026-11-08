/**
 * Test harness for composed-post two-way sync: an in-memory vault behind the
 * real VaultStorageService / MarkdownConverter, and a fake server with the
 * routes of workers/src/handlers/user-posts-composed.ts (revision
 * compare-and-swap on PUT, server-picked upload index, sha dedupe) plus
 * GET /api/user/archives/:id, behind requestUrl.
 *
 * Test files that use it mock obsidian's parseYaml/stringifyYaml (JSON in,
 * JSON or `key: value` lines out); see ComposedPostTwoWay.fakeServer.test.ts.
 */

import { vi } from 'vitest';
import * as ObsidianMock from 'obsidian';
import { TFile, type App, type RequestUrlParam, type RequestUrlResponse, type Vault } from 'obsidian';
import { WorkersAPIClient, type UserArchive } from '@/services/WorkersAPIClient';
import type { MediaResult } from '@/services/MediaHandler';
import { VaultStorageService } from '@/services/VaultStorageService';
import { MarkdownConverter } from '@/services/MarkdownConverter';
import type { VaultManager } from '@/services/VaultManager';
import type { SocialArchiverSettings } from '@/types/settings';
import { LocalLockRegistry } from '@/plugin/locks/LocalLockRegistry';
import { ComposedPostSyncService } from '@/plugin/sync/ComposedPostSyncService';
import { ComposedPostPullWriter } from '@/plugin/sync/composed/ComposedPostPullWriter';
import { ComposedConflictCopyWriter } from '@/plugin/sync/composed/ComposedConflictCopyWriter';
import { ComposedPostReconciler } from '@/plugin/sync/composed/ComposedPostReconciler';
import type { EditorPresence } from '@/plugin/sync/composed/EditorPresence';
import { convertUserArchiveToPostData } from '@/plugin/mobile/UserArchiveConverter';
import { splitArchiveRefLines } from '@/utils/note-mentions';

// Test-only hook of test/mocks/obsidian.ts; real Obsidian typings lack it.
const { __setRequestUrlHandler } = ObsidianMock as unknown as {
  __setRequestUrlHandler: (handler: ((request: RequestUrlParam) => Promise<RequestUrlResponse>) | null) => void;
};

export const API = 'https://social-archiver-api.social-archive.org';

export function resetRequestUrl(): void {
  __setRequestUrlHandler(null);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function response(status: number, json: unknown): RequestUrlResponse {
  return { status, headers: {}, text: JSON.stringify(json), json, arrayBuffer: new ArrayBuffer(0) };
}

/** A note's frontmatter as savePost (`key: value`) or processFrontMatter/updatePost (JSON) wrote it. */
export function readFrontmatterBlock(block: string): Record<string, unknown> {
  if (block.trim().startsWith('{')) return JSON.parse(block) as Record<string, unknown>;
  const fm: Record<string, unknown> = {};
  for (const [, key, value] of block.matchAll(/^(\w+): (.*)$/gm)) {
    if (!key || value === undefined) continue;
    try {
      fm[key] = JSON.parse(value);
    } catch {
      fm[key] = value;
    }
  }
  return fm;
}

export interface FakeServer {
  api: WorkersAPIClient;
  rows: Map<string, UserArchive>;
  uploads: Array<Record<string, unknown>>;
  puts: Array<{ archiveId: string; body: Record<string, unknown> }>;
  /** Another device edits the post: the row moves to the next revision. */
  editElsewhere: (archiveId: string, patch: Partial<Pick<UserArchive, 'fullContent' | 'title' | 'media' | 'embeddedArchives'>>) => void;
}

/** The server row for a composed post: what POST /api/user/posts stores. */
export function composedRow(id: string, fullContent: string, extra: Partial<UserArchive> = {}): UserArchive {
  return {
    id,
    userId: 'tester',
    platform: 'post',
    postId: id,
    originalUrl: `https://social-archive.org/tester/post/${id}`,
    title: null,
    authorName: 'tester',
    authorUrl: null,
    authorHandle: 'tester',
    authorAvatarUrl: null,
    previewText: fullContent.slice(0, 500),
    fullContent,
    thumbnailUrl: null,
    thumbnailUrls: null,
    media: [],
    postedAt: '2026-11-01T09:00:00.000Z',
    archivedAt: '2026-11-01T09:00:00.000Z',
    likesCount: null,
    commentCount: null,
    sharesCount: null,
    viewsCount: null,
    metadata: null,
    isLiked: false,
    isBookmarked: false,
    isArchived: false,
    isShared: false,
    archiveSource: 'composed',
    contentRevision: 0,
    ...extra,
  };
}

/** The server's ref extraction: trailing archive-mention lines become embeddedArchives. */
function storeRefs(fullContent: string): Pick<UserArchive, 'fullContent' | 'embeddedArchives'> {
  const { body, refs } = splitArchiveRefLines(fullContent);
  return {
    fullContent: body,
    embeddedArchives: refs.map((ref) => ({
      id: `p-${ref.archiveId}`, archiveId: ref.archiveId, platform: 'x', title: ref.label, authorName: null, originalUrl: null,
    })),
  };
}

export function fakeServer(): FakeServer {
  const rows = new Map<string, UserArchive>();
  const uploads: FakeServer['uploads'] = [];
  const puts: FakeServer['puts'] = [];
  const objects = new Map<string, Map<string, { index: number; ext: string }>>();
  const ok = (status: number, data: unknown): RequestUrlResponse => response(status, { success: true, data });

  __setRequestUrlHandler(async ({ url, method, body }) => {
    const path = new URL(url).pathname;
    const json = JSON.parse(typeof body === 'string' ? body : '{}') as Record<string, unknown>;

    if (method === 'POST' && path === '/api/user/posts/media') {
      uploads.push(json);
      const clientPostId = String(json['clientPostId']);
      const data = String(json['data']);
      const stored = objects.get(clientPostId) ?? new Map<string, { index: number; ext: string }>();
      objects.set(clientPostId, stored);
      let object = stored.get(data);
      if (!object) {
        const next = Math.max(-1, ...[...stored.values()].map((o) => o.index)) + 1;
        if (next > 24) return response(400, { success: false, error: { code: 'MEDIA_LIMIT_REACHED', message: 'No upload index left' } });
        object = { index: next, ext: String(json['ext']) };
        stored.set(data, object);
      }
      return ok(201, {
        r2Url: `${API}/media/archives/tester/${clientPostId}/${object.index}.${object.ext}`,
        r2Key: `archives/tester/${clientPostId}/media/${object.index}.${object.ext}`,
        index: object.index,
        type: json['type'],
        contentType: json['contentType'],
        size: atob(data).length,
      });
    }

    if (method === 'POST' && path === '/api/user/posts') {
      const id = String(json['clientPostId']);
      rows.set(id, composedRow(id, '', {
        ...storeRefs(text(json['fullContent'])),
        title: (json['title'] as string | null | undefined) ?? null,
        media: (json['media'] as UserArchive['media']) ?? [],
      }));
      return ok(201, { archiveId: id, createdAt: '2026-11-01T09:00:01.000Z' });
    }

    const putId = /^\/api\/user\/posts\/([^/]+)$/.exec(path)?.[1];
    if (method === 'PUT' && putId) {
      const archiveId = decodeURIComponent(putId);
      puts.push({ archiveId, body: json });
      const row = rows.get(archiveId);
      if (!row) return response(404, { success: false, error: { code: 'NOT_FOUND', message: 'Archive not found' } });
      const revision = row.contentRevision ?? 0;
      const base = json['baseContentRevision'];
      if (typeof base === 'number' && base !== revision) {
        return response(409, {
          success: false,
          error: { code: 'POST_EDIT_CONFLICT', message: 'The post was edited on another device' },
          data: { contentRevision: revision },
        });
      }
      rows.set(archiveId, {
        ...row,
        ...(json['quoteRefs'] === true ? storeRefs(text(json['fullContent'])) : { fullContent: text(json['fullContent']) }),
        title: (json['title'] as string | null | undefined) ?? null,
        media: (json['media'] as UserArchive['media']) ?? row.media,
        contentRevision: revision + 1,
      });
      return ok(200, { success: true, updatedAt: '2026-11-01T10:00:00.000Z', contentRevision: revision + 1 });
    }

    const getId = /^\/api\/user\/archives\/([^/]+)$/.exec(path)?.[1];
    if (method === 'GET' && getId) {
      const row = rows.get(decodeURIComponent(getId));
      return row ? ok(200, { archive: row }) : response(404, { success: false, error: { code: 'ARCHIVE_NOT_FOUND', message: 'nope' } });
    }

    throw new Error(`Unexpected ${method} ${path}`);
  });

  const api = new WorkersAPIClient({ endpoint: API, authToken: 'token' });
  api.initialize();
  const editElsewhere: FakeServer['editElsewhere'] = (archiveId, patch) => {
    const row = rows.get(archiveId);
    if (!row) throw new Error(`No row ${archiveId}`);
    rows.set(archiveId, { ...row, ...patch, contentRevision: (row.contentRevision ?? 0) + 1 });
  };
  return { api, rows, uploads, puts, editElsewhere };
}

export interface TwoWayHarness {
  app: App;
  vault: Vault;
  settings: SocialArchiverSettings;
  storage: VaultStorageService;
  server: FakeServer;
  sync: ComposedPostSyncService;
  reconciler: ComposedPostReconciler;
  pullWriter: ComposedPostPullWriter;
  conflictWriter: ComposedConflictCopyWriter;
  locks: LocalLockRegistry;
  withLocks: <T>(archiveId: string, fn: () => Promise<T>) => Promise<T>;
  frontmatter: Map<string, Record<string, unknown>>;
  files: Map<string, string>;
  /** Paths open in an editor; `leave` fires the presence leave hook. */
  open: Set<string>;
  leave: (path: string) => void;
  /** MetadataCache re-indexed the note: fires 'changed'. */
  indexed: (path: string) => void;
  read: (path: string) => string;
  /** Files the fake media handler wrote, by URL. */
  downloads: string[];
}

export function twoWayHarness(): TwoWayHarness {
  const files = new Map<string, string>();
  const binaries = new Map<string, ArrayBuffer>();
  const frontmatter = new Map<string, Record<string, unknown>>();
  const changedListeners = new Set<(file: TFile) => void>();
  const leaveListeners = new Set<(path: string) => void>();
  const open = new Set<string>();
  const downloads: string[] = [];
  const fileAt = (path: string): TFile => {
    const file = new (TFile as unknown as new (p: string) => TFile)(path);
    const name = path.split('/').pop() ?? path;
    Object.assign(file, {
      basename: name.replace(/\.[^.]+$/, ''),
      extension: name.includes('.') ? (name.split('.').pop() ?? '') : '',
      parent: { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' },
    });
    return file;
  };

  const write = (path: string, content: string): void => {
    files.set(path, content);
    const block = /^---\n([\s\S]*?)\n---\n/.exec(content)?.[1];
    frontmatter.set(path, block !== undefined ? readFrontmatterBlock(block) : {});
  };
  const read = vi.fn(async (file: TFile) => files.get(file.path) ?? '');

  const vault = {
    getFileByPath: (path: string) => (files.has(path) || binaries.has(path) ? fileAt(path) : null),
    getAbstractFileByPath: (path: string) => (files.has(path) || binaries.has(path) ? fileAt(path) : null),
    getMarkdownFiles: () => [...files.keys()].map(fileAt),
    create: vi.fn(async (path: string, content: string) => {
      write(path, content);
      return fileAt(path);
    }),
    createBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
      binaries.set(path, data);
      return fileAt(path);
    }),
    process: vi.fn(async (file: TFile, fn: (current: string) => string) => {
      write(file.path, fn(files.get(file.path) ?? ''));
      return files.get(file.path);
    }),
    modify: vi.fn(async (file: TFile, content: string) => write(file.path, content)),
    read,
    cachedRead: read,
    readBinary: vi.fn(async (file: TFile) => binaries.get(file.path) ?? new ArrayBuffer(0)),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Vault;

  const app = {
    vault,
    workspace: { getLeaf: () => ({ openFile: vi.fn(async () => undefined) }) },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter.get(file.path) }),
      getFirstLinkpathDest: () => null,
      on: vi.fn((_name: 'changed', listener: (file: TFile) => void) => {
        changedListeners.add(listener);
        return listener;
      }),
      offref: vi.fn((listener: (file: TFile) => void) => changedListeners.delete(listener)),
    },
    fileManager: {
      // Like Obsidian, rewrites the note's YAML (as JSON, see stringifyYaml).
      processFrontMatter: vi.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm = { ...(frontmatter.get(file.path) ?? {}) };
        fn(fm);
        const body = (files.get(file.path) ?? '').replace(/^---\n[\s\S]*?\n---\n/, '');
        write(file.path, `---\n${JSON.stringify(fm)}\n---\n${body}`);
      }),
      trashFile: vi.fn(async (file: TFile) => {
        binaries.delete(file.path);
      }),
    },
  } as unknown as App;

  const settings = {
    archivePath: 'Social Archives',
    mediaPath: 'attachments/social-archives',
    username: 'tester',
    pendingComposedPostSyncs: [],
  } as unknown as SocialArchiverSettings;

  const storage = new VaultStorageService({
    app,
    vault,
    settings,
    vaultManager: { createFolderIfNotExists: vi.fn(async () => undefined) } as unknown as VaultManager,
    markdownConverter: new MarkdownConverter(),
  });

  const server = fakeServer();
  const locks = new LocalLockRegistry();
  const withLocks = <T>(archiveId: string, fn: () => Promise<T>): Promise<T> =>
    locks.withLocks([{ kind: 'archiveMaterialization', archiveId }, { kind: 'markdownWrite', archiveId }], fn);

  const presence = {
    isOpen: (path: string) => open.has(path),
    onLeave: (listener: (path: string) => void) => {
      leaveListeners.add(listener);
      return () => leaveListeners.delete(listener);
    },
  } as unknown as EditorPresence;

  const pullWriter = new ComposedPostPullWriter({
    app,
    settings: () => settings,
    apiClient: () => server.api,
    convert: convertUserArchiveToPostData,
    createMediaHandler: () => ({
      downloadMedia: async (media, _platform, postId, _author, _progress, startIndex = 0): Promise<MediaResult[]> =>
        media.map((item, i) => {
          const localPath = `attachments/social-archives/post/${postId}/${startIndex + i + 1}.png`;
          binaries.set(localPath, new TextEncoder().encode(`bytes of ${item.url}`).buffer);
          downloads.push(item.url);
          return { originalUrl: item.url, localPath, type: item.type, size: 1, file: fileAt(localPath), sourceIndex: i, fallbackKind: 'none' };
        }),
    }),
  });
  const conflictWriter = new ComposedConflictCopyWriter(app);
  let sync: ComposedPostSyncService | undefined;
  const reconciler = new ComposedPostReconciler({
    app,
    presence,
    pullWriter,
    conflictWriter,
    apiClient: () => server.api,
    withArchiveWriteLocks: withLocks,
    requestPush: (file) => sync?.notifyNoteChanged(file),
  });
  sync = new ComposedPostSyncService(app, vault, settings, server.api, vi.fn(async () => undefined), {
    reconciler: () => reconciler,
    presence: () => presence,
    withArchiveWriteLocks: withLocks,
  });

  return {
    app,
    vault,
    settings,
    storage,
    server,
    sync,
    reconciler,
    pullWriter,
    conflictWriter,
    locks,
    withLocks,
    frontmatter,
    files,
    open,
    leave: (path) => {
      for (const listener of [...leaveListeners]) listener(path);
    },
    indexed: (path) => {
      for (const listener of changedListeners) listener(fileAt(path));
    },
    read: (path) => files.get(path) ?? '',
    downloads,
  };
}
