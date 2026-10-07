import { describe, it, expect, vi, afterEach } from 'vitest';
import * as ObsidianMock from 'obsidian';
import { TFile, type App, type RequestUrlParam, type RequestUrlResponse, type Vault } from 'obsidian';
import { VaultStorageService } from '@/services/VaultStorageService';
import { MarkdownConverter } from '@/services/MarkdownConverter';
import type { VaultManager } from '@/services/VaultManager';
import { ComposedPostSyncService, createComposedPostId } from '@/plugin/sync/ComposedPostSyncService';
import { LinkRelationSyncService } from '@/plugin/sync/LinkRelationSyncService';
import { WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { ArchiveLookupService } from '@/services/ArchiveLookupService';
import { HighlightBodyMarker } from '@/services/HighlightBodyMarker';
import { AnnotationSectionManager } from '@/services/AnnotationSectionManager';
import { AnnotationRenderer } from '@/services/AnnotationRenderer';
import { LinkedArchivesSectionManager } from '@/services/LinkedArchivesSectionManager';
import {
  LINKED_ARCHIVES_END_MARKER,
  LINKED_ARCHIVES_START_MARKER,
  LinkedArchivesRenderer,
} from '@/services/LinkedArchivesRenderer';
import { replaceCommentsSection } from '@/services/markdown/CommentSectionManager';
import type { PostData } from '@/types/post';
import type { TextHighlight } from '@/types/annotations';
import type { RelationWithSummary } from '@/types/link-relations';
import type { SocialArchiverSettings } from '@/types/settings';

/**
 * The composer → vault → sync queue → server chain, with the real
 * VaultStorageService, MarkdownConverter, ComposedPostSyncService and
 * WorkersAPIClient.
 *
 * PostComposer used to hand over a PostData with no id, so savePost skipped the
 * sync frontmatter and the queue sent `clientPostId: undefined` — which JSON
 * drops and the server rejects. Not one plugin post ever reached the server.
 */

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  // updatePost writes frontmatter with stringifyYaml. JSON is valid YAML and
  // reads back without a YAML parser.
  stringifyYaml: (value: unknown): string => `${JSON.stringify(value)}\n`,
}));

// Test-only hook of test/mocks/obsidian.ts; real Obsidian typings lack it.
const { __setRequestUrlHandler } = ObsidianMock as unknown as {
  __setRequestUrlHandler: (handler: ((request: RequestUrlParam) => Promise<RequestUrlResponse>) | null) => void;
};

const API = 'https://social-archiver-api.social-archive.org';

/** What PostComposer hands onPostCreated, minus the id. */
function composerPost(text: string, timestamp = '2026-10-06T09:30:00.000Z'): PostData {
  return {
    platform: 'post',
    author: { name: 'tester', url: 'https://social-archive.org/tester', handle: '@tester' },
    content: { text },
    media: [],
    metadata: { timestamp: new Date(timestamp) },
    linkPreviews: [],
    processedUrls: [],
  } as unknown as PostData;
}

/** An image the composer attached. jsdom's File has no arrayBuffer(); savePost needs only these. */
function attachment(name: string, type: string, bytes: number[]): File {
  return { name, type, size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer } as unknown as File;
}

interface FakeServer {
  api: WorkersAPIClient;
  uploads: Array<Record<string, unknown>>;
  creates: Array<Record<string, unknown>>;
  updates: Array<{ archiveId: string; body: Record<string, unknown> }>;
  /** What GET /api/user/archives/:id/link-relations answers, by archive id. */
  relations: Map<string, RelationWithSummary[]>;
}

function response(status: number, json: unknown): RequestUrlResponse {
  return { status, headers: {}, text: JSON.stringify(json), json, arrayBuffer: new ArrayBuffer(0) };
}

/**
 * The routes of workers/src/handlers/user-posts-composed.ts behind requestUrl,
 * signed in as `tester`. Uploads are validated like UploadMediaRequestSchema.
 */
function fakeServer(): FakeServer {
  const uploads: FakeServer['uploads'] = [];
  const creates: FakeServer['creates'] = [];
  const updates: FakeServer['updates'] = [];
  const relations: FakeServer['relations'] = new Map();
  const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const ok = (status: number, data: unknown): RequestUrlResponse => response(status, { success: true, data });
  const invalid = (field: string): RequestUrlResponse =>
    response(400, { success: false, error: { code: 'VALIDATION_ERROR', message: `${field} Required` } });

  __setRequestUrlHandler(async ({ url, method, body }) => {
    const path = new URL(url).pathname;
    const json = JSON.parse(typeof body === 'string' ? body : '{}') as Record<string, unknown>;

    if (method === 'POST' && path === '/api/user/posts/media') {
      const { clientPostId, index, ext, contentType, data, type } = json;
      if (!isId(clientPostId)) return invalid('clientPostId');
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 24) return invalid('index');
      if (typeof ext !== 'string' || !/^[a-zA-Z0-9]{1,10}$/.test(ext)) return invalid('ext');
      if (typeof contentType !== 'string' || !contentType) return invalid('contentType');
      if (typeof data !== 'string' || !data) return invalid('data');
      if (type !== 'image' && type !== 'video') return invalid('type');
      uploads.push(json);
      return ok(201, {
        r2Url: `${API}/media/archives/tester/${clientPostId}/${index}.${ext}`,
        r2Key: `archives/tester/${clientPostId}/media/${index}.${ext}`,
        type,
        contentType,
        size: atob(data).length,
      });
    }

    if (method === 'POST' && path === '/api/user/posts') {
      const clientPostId = json['clientPostId'];
      if (!isId(clientPostId)) return invalid('clientPostId');
      creates.push(json);
      // insertComposedPost uses the clientPostId as the new row's id.
      return ok(201, { archiveId: clientPostId, createdAt: '2026-10-06T09:30:01.000Z' });
    }

    const archiveId = /^\/api\/user\/posts\/([^/]+)$/.exec(path)?.[1];
    if (method === 'PUT' && archiveId) {
      updates.push({ archiveId: decodeURIComponent(archiveId), body: json });
      return ok(200, { success: true, updatedAt: '2026-10-06T09:40:00.000Z' });
    }

    const relationsOf = /^\/api\/user\/archives\/([^/]+)\/link-relations$/.exec(path)?.[1];
    if (method === 'GET' && relationsOf) {
      return ok(200, { relations: relations.get(decodeURIComponent(relationsOf)) ?? [] });
    }

    throw new Error(`Unexpected ${method} ${path}`);
  });

  const api = new WorkersAPIClient({ endpoint: API, authToken: 'token' });
  api.initialize();
  return { api, uploads, creates, updates, relations };
}

/** savePost writes `key: value` lines; updatePost writes JSON (stringifyYaml above). */
function readFrontmatter(block: string): Record<string, unknown> {
  if (block.startsWith('{')) return JSON.parse(block) as Record<string, unknown>;
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

function harness(): {
  app: App;
  vault: Vault;
  storage: VaultStorageService;
  sync: ComposedPostSyncService;
  server: FakeServer;
  settings: SocialArchiverSettings;
  frontmatter: Map<string, Record<string, unknown>>;
  /** MetadataCache re-indexed the note: fires 'changed'. */
  indexed: (path: string) => void;
} {
  const files = new Map<string, string>();
  const binaries = new Map<string, ArrayBuffer>();
  /** What MetadataCache would report: the note's frontmatter, then every processFrontMatter write. */
  const frontmatter = new Map<string, Record<string, unknown>>();
  const changedListeners = new Set<(file: TFile) => void>();
  const fileAt = (path: string): TFile => new (TFile as unknown as new (p: string) => TFile)(path);

  const write = (path: string, content: string): void => {
    files.set(path, content);
    const block = /^---\n([\s\S]*?)\n---\n/.exec(content)?.[1];
    if (block !== undefined) frontmatter.set(path, readFrontmatter(block));
  };
  const read = vi.fn(async (file: TFile) => files.get(file.path) ?? '');

  const vault = {
    getFileByPath: (path: string) => (files.has(path) || binaries.has(path) ? fileAt(path) : null),
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
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter.get(file.path) }),
      on: vi.fn((_name: 'changed', listener: (file: TFile) => void) => {
        changedListeners.add(listener);
        return listener;
      }),
      offref: vi.fn((listener: (file: TFile) => void) => changedListeners.delete(listener)),
    },
    fileManager: {
      // Like Obsidian, rewrites the note's YAML (as JSON, see stringifyYaml above).
      processFrontMatter: vi.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm = frontmatter.get(file.path) ?? {};
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
  const sync = new ComposedPostSyncService(app, vault, settings, server.api, vi.fn(async () => undefined));
  const indexed = (path: string): void => {
    for (const listener of changedListeners) listener(fileAt(path));
  };

  return { app, vault, storage, sync, server, settings, frontmatter, indexed };
}

describe('composed post sync — PostComposer to server', () => {
  afterEach(() => {
    __setRequestUrlHandler(null);
    vi.useRealTimers();
  });

  it('sends the clientPostId the note was stamped with', async () => {
    const h = harness();
    const post = { ...composerPost('Hello from the composer'), id: createComposedPostId() } as PostData;

    const { path } = await h.storage.savePost(post);
    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();

    expect(h.server.creates).toHaveLength(1);
    expect(h.server.creates[0]?.['clientPostId']).toBe(post.id);
    expect(h.frontmatter.get(path)).toMatchObject({
      postOrigin: 'composer',
      clientPostId: post.id,
      sourceArchiveId: post.id,
      syncState: 'synced',
    });
    expect(h.settings.pendingComposedPostSyncs).toHaveLength(0);
  });

  it('sends the post text and its uploaded images, not the note markdown', async () => {
    const h = harness();
    const post = { ...composerPost('Hello from the composer'), id: createComposedPostId() } as PostData;
    // The note ends up as: text, `---`, `![…](vault/path)` embeds, `---`, **Author:** footer.
    const { path } = await h.storage.savePost(post, [
      attachment('Screenshot (1).png', 'image/png', [1, 2, 3]),
      attachment('cat.jpg', 'image/jpeg', [4, 5]),
    ]);

    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();

    expect(h.server.uploads).toEqual([
      { clientPostId: post.id, index: 0, ext: 'png', contentType: 'image/png', type: 'image', data: btoa('\x01\x02\x03') },
      { clientPostId: post.id, index: 1, ext: 'jpg', contentType: 'image/jpeg', type: 'image', data: btoa('\x04\x05') },
    ]);
    const png = `${API}/media/archives/tester/${post.id}/0.png`;
    const jpg = `${API}/media/archives/tester/${post.id}/1.jpg`;
    expect(h.server.creates).toEqual([{
      clientPostId: post.id,
      title: null,
      previewText: 'Hello from the composer',
      fullContent: 'Hello from the composer',
      thumbnailUrl: png,
      media: [{ url: png, type: 'image' }, { url: jpg, type: 'image' }],
    }]);

    // The note keeps what it synced, by content, and the next unused index.
    const fm = h.frontmatter.get(path) ?? {};
    expect((fm['syncedMedia'] as string[]).map((entry) => entry.replace(/^[0-9a-f]{64}:/, ''))).toEqual([png, jpg]);
    expect(fm['syncedMediaNext']).toBe(2);

    // An update sends the same content and uploads nothing: the server has both images.
    await h.sync.enqueueUpdate(path, post.id, post.id);
    await h.sync.flush();

    const { clientPostId: _id, ...content } = h.server.creates[0] ?? {};
    expect(h.server.updates).toEqual([{ archiveId: post.id, body: content }]);
    expect(h.server.uploads).toHaveLength(2);
  });

  it('sends a post with an archived link as its text alone', async () => {
    const h = harness();
    const post = {
      ...composerPost('A post with an archived link'),
      id: createComposedPostId(),
      embeddedArchives: [{
        platform: 'x',
        id: '1',
        url: 'https://x.com/someone/status/1',
        author: { name: 'someone', url: 'https://x.com/someone' },
        content: { text: 'The archived post' },
        media: [],
        metadata: { timestamp: new Date('2026-10-01T00:00:00.000Z') },
      }],
    } as unknown as PostData;
    const { path } = await h.storage.savePost(post);
    // The note: text, `---`, the embedded archive, `---`, **Author:** footer.
    expect(await h.vault.read(h.vault.getFileByPath(path) as TFile)).toContain('## Referenced Social Media Posts');

    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();

    expect(h.server.creates).toEqual([{
      clientPostId: post.id,
      title: null,
      previewText: 'A post with an archived link',
      fullContent: 'A post with an archived link',
      thumbnailUrl: null,
      media: [],
    }]);
  });

  it('after a restart, sends nothing for what inbound sync writes into the note', async () => {
    const h = harness();
    const text = 'Hello from the composer';
    const post = { ...composerPost(text), id: createComposedPostId() } as PostData;
    const { path } = await h.storage.savePost(post);
    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();

    vi.useFakeTimers();
    const sync = new ComposedPostSyncService(h.app, h.vault, h.settings, h.server.api, vi.fn(async () => undefined));
    await sync.onPluginLoad();
    const file = h.vault.getFileByPath(path) as TFile;

    // The post annotated on mobile, as the inbound services write it: a
    // highlight marked in the text (its offsets count the server's text), a
    // note, a linked archive, a comment above the footer.
    const highlight: TextHighlight = {
      id: 'hl_1',
      text: 'from the composer',
      startOffset: 6,
      endOffset: text.length,
      contextBefore: 'Hello ',
      contextAfter: '',
      color: 'yellow',
      createdAt: '2026-10-06T10:00:00.000Z',
      updatedAt: '2026-10-06T10:00:00.000Z',
    };
    const note = { id: 'note_1', content: 'Read later', createdAt: '2026-10-06T10:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' };
    await h.vault.process(file, (current) => {
      const highlighted = new HighlightBodyMarker().reconcile(current, [highlight]);
      const annotated = new AnnotationSectionManager().upsert(
        highlighted,
        new AnnotationRenderer().render({ notes: [note], highlights: [highlight] }),
      );
      const linked = new LinkedArchivesSectionManager().upsert(
        annotated,
        `${LINKED_ARCHIVES_START_MARKER}\n## Linked archives\n\n- [[Another archive]]\n${LINKED_ARCHIVES_END_MARKER}`,
      );
      return replaceCommentsSection(linked, '**@friend** · 2026-10-06 10:00\nNice post');
    });
    const annotated = await h.vault.read(file);
    expect(annotated).toContain('Hello ==from the composer==');
    expect(annotated).toContain('## 💬 Comments');
    h.indexed(path);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.server.updates).toHaveLength(0);

    // An edit to the text itself still goes out, without any of it.
    await h.vault.process(file, (current) => current.replace('Hello', 'Hello again'));
    h.indexed(path);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.server.updates).toEqual([{
      archiveId: post.id,
      body: expect.objectContaining({
        previewText: 'Hello again from the composer',
        fullContent: 'Hello again from the composer',
      }),
    }]);
  });

  it('sends nothing when a link in the post connects to an archive, and keeps its URL', async () => {
    const h = harness();
    const url = 'https://x.com/someone/status/1';
    const text = `Read [this thread](${url}) or ${url}`;
    const post = { ...composerPost(text), id: createComposedPostId() } as PostData;
    const { path } = await h.storage.savePost(post);
    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();
    expect(h.server.creates[0]?.['fullContent']).toBe(text);

    // The link gets archived (from mobile's link candidates, say) and the
    // server connects the post to it. That archive has a note here too.
    const thread = await h.vault.create('Social Archives/X/2026/10/2026-10-06 - someone - The thread.md', 'The thread\n');
    h.server.relations.set(post.id, [{
      relation: {
        id: 'rel_1',
        sourceArchiveId: post.id,
        targetArchiveId: 'archive_thread',
        targetUrl: url,
        normalizedTargetUrl: url,
        relationType: 'inline_markdown',
        anchorText: 'this thread',
        status: 'connected',
        createdAt: '2026-10-06T10:00:00.000Z',
        updatedAt: '2026-10-06T10:00:00.000Z',
      },
      otherArchive: {
        id: 'archive_thread',
        platform: 'x',
        originalUrl: url,
        title: null,
        authorName: 'someone',
        authorHandle: 'someone',
        contentText: 'The thread',
      },
    }]);
    const notes = new Map([[post.id, h.vault.getFileByPath(path)], ['archive_thread', thread]]);
    const relationSync = new LinkRelationSyncService({
      app: h.app,
      apiClient: (): WorkersAPIClient => h.server.api,
      archiveLookup: (): ArchiveLookupService =>
        ({ findBySourceArchiveId: (id: string) => notes.get(id) ?? null }) as unknown as ArchiveLookupService,
      renderer: new LinkedArchivesRenderer({
        resolveArchiveLink: (id, alias): string | null =>
          (id === 'archive_thread' ? `[[${thread.basename}|${alias}]]` : null),
      }),
      sectionManager: new LinkedArchivesSectionManager(),
      settings: (): SocialArchiverSettings => ({ enableLinkedArchivesSection: true }) as SocialArchiverSettings,
      saveSettings: vi.fn(async () => undefined),
    });

    vi.useFakeTimers();
    await h.sync.onPluginLoad();
    await relationSync.applyForArchive(post.id);
    h.indexed(path);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(h.server.updates).toHaveLength(0);
    const file = h.vault.getFileByPath(path) as TFile;
    const note = await h.vault.read(file);
    expect(note).toContain(text);
    // The Linked archives block links it instead.
    expect(note).toContain(`[[${thread.basename}|`);

    // An edit goes out with the links as written.
    await h.vault.process(file, (current) => current.replace('Read [this', 'Do read [this'));
    h.indexed(path);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.server.updates).toEqual([{
      archiveId: post.id,
      body: expect.objectContaining({ fullContent: `Do read [this thread](${url}) or ${url}` }),
    }]);
  });

  it('heals entries queued without a clientPostId, one id per post', async () => {
    const h = harness();
    // Exactly what the composer produced before this fix.
    const first = composerPost('Queued before the fix', '2026-10-01T08:00:00.000Z');
    const second = composerPost('Also queued before the fix', '2026-10-02T08:00:00.000Z');
    const firstPath = (await h.storage.savePost(first)).path;
    const secondPath = (await h.storage.savePost(second)).path;
    expect(h.frontmatter.get(firstPath)?.['clientPostId']).toBeUndefined();

    await h.sync.enqueueCreate(firstPath, first.id);
    await h.sync.enqueueCreate(secondPath, second.id);
    // data.json drops the undefined key, so a reloaded entry has none at all.
    h.settings.pendingComposedPostSyncs = JSON.parse(JSON.stringify(h.settings.pendingComposedPostSyncs));
    await h.sync.flush();

    const ids = h.server.creates.map((body) => body['clientPostId']);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(h.frontmatter.get(firstPath)).toMatchObject({ postOrigin: 'composer', clientPostId: ids[0], sourceArchiveId: ids[0] });
    expect(h.frontmatter.get(secondPath)).toMatchObject({ postOrigin: 'composer', clientPostId: ids[1], sourceArchiveId: ids[1] });
    expect(h.settings.pendingComposedPostSyncs).toHaveLength(0);
  });

  it('keeps an edited note bound to its server row', async () => {
    const h = harness();
    const post = { ...composerPost('First draft'), id: createComposedPostId() } as PostData;
    const { path } = await h.storage.savePost(post);
    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();

    // Edit mode rebuilds PostData from scratch: no id, no sourceArchiveId.
    await h.storage.updatePost({ filePath: path, postData: composerPost('Second draft'), existingMedia: [], replaceBody: true });

    const fm = h.frontmatter.get(path) ?? {};
    expect(fm).toMatchObject({
      postOrigin: 'composer',
      clientPostId: post.id,
      sourceArchiveId: post.id,
      syncState: 'synced',
    });

    // TimelineContainer enqueues the update only when both ids survive the rewrite.
    await h.sync.enqueueUpdate(path, fm['clientPostId'] as string, fm['sourceArchiveId'] as string);
    await h.sync.flush();
    expect(h.server.updates.map((update) => update.archiveId)).toEqual([post.id]);
    // The update reads the note, so it carries the edit only if the note does.
    expect(h.server.updates[0]?.body['fullContent']).toBe('Second draft');
  });

  it('after a restart, resends a synced note only when the post itself changes', async () => {
    const h = harness();
    const post = { ...composerPost('Hello from the composer'), id: createComposedPostId() } as PostData;
    const { path } = await h.storage.savePost(post, [attachment('cat.jpg', 'image/jpeg', [4, 5])]);
    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();
    expect(h.server.uploads).toHaveLength(1);

    // Obsidian restarts: a new instance, nothing in memory but the note.
    vi.useFakeTimers();
    const sync = new ComposedPostSyncService(h.app, h.vault, h.settings, h.server.api, vi.fn(async () => undefined));
    await sync.onPluginLoad();
    const file = h.vault.getFileByPath(path) as TFile;

    // A like or archive toggle (here, or inbound from mobile) rewrites only frontmatter.
    await h.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm['like'] = true;
      fm['archive'] = true;
    });
    h.indexed(path);
    await vi.advanceTimersByTimeAsync(5_000);
    // Hashing the image resolves outside fake time: let any flush the watcher started finish.
    await sync.flush();
    expect(h.server.updates).toHaveLength(0);
    expect(h.server.uploads).toHaveLength(1);

    // Editing the text is an edit: one PUT, with the image the server already has.
    await h.vault.process(file, (note) => note.replace('Hello from the composer', 'Hello again'));
    h.indexed(path);
    await vi.advanceTimersByTimeAsync(5_000);
    await sync.flush();
    expect(h.server.updates).toEqual([
      { archiveId: post.id, body: expect.objectContaining({ fullContent: 'Hello again', media: h.server.creates[0]?.['media'] }) },
    ]);
    expect(h.server.uploads).toHaveLength(1);
  });

  it('uploads only the image an edit adds, under an index no upload has used', async () => {
    // Every embed used to be uploaded again by position. Removing the first
    // image put the second's bytes under the first's URL, which mobile, desktop
    // and share-web cache as immutable: they kept showing the removed image.
    const h = harness();
    const post = { ...composerPost('Two pictures'), id: createComposedPostId() } as PostData;
    const { path, mediaSaved } = await h.storage.savePost(post, [
      attachment('cat.jpg', 'image/jpeg', [1, 2]),
      attachment('dog.jpg', 'image/jpeg', [3, 4]),
    ]);
    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();
    const [cat, dog] = mediaSaved.map((saved) => ({ type: 'image' as const, url: saved.savedPath }));
    const dogUrl = `${API}/media/archives/tester/${post.id}/1.jpg`;

    // PostComposer's edit: the cat removed, a bird added.
    await h.storage.updatePost({
      filePath: path,
      postData: composerPost('Two pictures'),
      mediaFiles: [attachment('bird.jpg', 'image/jpeg', [5, 6])],
      deletedMediaPaths: [cat!.url],
      existingMedia: [cat!, dog!],
      replaceBody: true,
    });
    await h.sync.enqueueUpdate(path, post.id, post.id);
    await h.sync.flush();

    // The dog is not uploaded again, and the bird takes index 2, not the cat's 0.
    expect(h.server.uploads.slice(2).map((upload) => [upload['index'], upload['data']])).toEqual([[2, btoa('\x05\x06')]]);
    const birdUrl = `${API}/media/archives/tester/${post.id}/2.jpg`;
    expect(h.server.updates).toEqual([{
      archiveId: post.id,
      body: expect.objectContaining({
        thumbnailUrl: dogUrl,
        media: [{ url: dogUrl, type: 'image' }, { url: birdUrl, type: 'image' }],
      }),
    }]);
    expect(h.frontmatter.get(path)?.['syncedMediaNext']).toBe(3);
  });

  it('gives an image saved under a removed image\'s path its own URL', async () => {
    // updatePost trashes the removed image before it saves the added one, so a
    // pasted image.png takes the path of the image.png it replaces.
    const h = harness();
    const post = { ...composerPost('A screenshot'), id: createComposedPostId() } as PostData;
    const { path, mediaSaved: [first] } = await h.storage.savePost(post, [attachment('image.png', 'image/png', [1])]);
    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();

    const { mediaSaved: [second] } = await h.storage.updatePost({
      filePath: path,
      postData: composerPost('A better screenshot'),
      mediaFiles: [attachment('image.png', 'image/png', [2])],
      deletedMediaPaths: [first!.savedPath],
      existingMedia: [{ type: 'image', url: first!.savedPath }],
      replaceBody: true,
    });
    expect(second?.savedPath).toBe(first?.savedPath);
    await h.sync.enqueueUpdate(path, post.id, post.id);
    await h.sync.flush();

    expect(h.server.uploads.map((upload) => upload['index'])).toEqual([0, 1]);
    expect(h.server.updates[0]?.body['media']).toEqual([{ url: `${API}/media/archives/tester/${post.id}/1.png`, type: 'image' }]);
  });

  it('leaves an added image in the vault only once every upload index is spent', async () => {
    const h = harness();
    const post = { ...composerPost('Edited a lot'), id: createComposedPostId() } as PostData;
    const { path, mediaSaved: [first] } = await h.storage.savePost(post, [attachment('a.jpg', 'image/jpeg', [1])]);
    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();
    // As if 24 more images had been added and removed since.
    await h.app.fileManager.processFrontMatter(h.vault.getFileByPath(path) as TFile, (fm: Record<string, unknown>) => {
      fm['syncedMediaNext'] = 25;
    });

    await h.storage.updatePost({
      filePath: path,
      postData: composerPost('Edited a lot'),
      mediaFiles: [attachment('b.jpg', 'image/jpeg', [2])],
      existingMedia: [{ type: 'image', url: first!.savedPath }],
      replaceBody: true,
    });
    await h.sync.enqueueUpdate(path, post.id, post.id);
    await h.sync.flush();

    expect(h.server.uploads).toHaveLength(1);
    expect(h.server.updates[0]?.body['media']).toEqual([{ url: `${API}/media/archives/tester/${post.id}/0.jpg`, type: 'image' }]);
  });
});
