import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import type { UserArchive, WorkersAPIClient } from '@/services/WorkersAPIClient';
import type { ArchiveLookupService } from '@/services/ArchiveLookupService';
import type { PostData } from '@/types/post';
import { PostDataParser } from '@/components/timeline/parsers/PostDataParser';
import { stripHighlightMarks } from '@/components/timeline/reader/ReaderHighlightManager';
import { convertUserArchiveToPostData } from '@/plugin/mobile/UserArchiveConverter';
import { djb2, readComposedNote } from '@/plugin/sync/composed/composedNote';
import { classifyComposedMigration, ComposedPostMigrationService } from '@/plugin/sync/composed/ComposedPostMigrationService';
import { composedRow, resetRequestUrl, twoWayHarness, type TwoWayHarness } from './twoWayHarness';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  stringifyYaml: (value: unknown): string => `${JSON.stringify(value)}\n`,
  parseYaml: (block: string): unknown => {
    if (block.trim().startsWith('{')) return JSON.parse(block);
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
  },
}));

describe('classifyComposedMigration', () => {
  it('skips a baseline, adopts equal text, pulls an untouched plugin post, else diverged', () => {
    expect(classifyComposedMigration({ hasBaseline: true, textEqual: true, pluginUnchangedSincePush: true })).toBe('skip');
    expect(classifyComposedMigration({ hasBaseline: false, textEqual: true, pluginUnchangedSincePush: false })).toBe('adopt');
    expect(classifyComposedMigration({ hasBaseline: false, textEqual: false, pluginUnchangedSincePush: true })).toBe('pull');
    expect(classifyComposedMigration({ hasBaseline: false, textEqual: false, pluginUnchangedSincePush: false })).toBe('diverged');
  });
});

/** The pre-two-way fingerprint, as 4.11 wrote it into syncedContentHash after a push. */
async function oldFingerprint(h: TwoWayHarness, file: TFile): Promise<string> {
  const parser = new PostDataParser(h.vault, h.app);
  const parsed = await parser.parseFile(file);
  const text = stripHighlightMarks(parser.extractContentText(h.read(file.path))).canonical
    .replace(/(?:(?:^|\n)\s*---)+$/, '')
    .trimEnd();
  return djb2(JSON.stringify([null, text, parsed?.media.map((m) => m.url) ?? []]));
}

/** A note the 4.11 composer wrote and pushed: escaped body, a hash, no revision. */
async function pluginPost(h: TwoWayHarness, id: string, text: string): Promise<TFile> {
  const post = {
    platform: 'post',
    id,
    contentType: 'meeting-note', // the 4.11 writer escaped every post body; a meeting note still gets it
    author: { name: 'tester', url: 'https://social-archive.org/tester', handle: '@tester' },
    content: { text },
    media: [],
    metadata: { timestamp: new Date('2026-10-01T09:00:00.000Z') },
  } as unknown as PostData;
  const { file } = await h.storage.savePost(post, undefined, `Social Archives/Post/${id}.md`);
  const syncedContentHash = await oldFingerprint(h, file);
  await h.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    delete fm['contentType'];
    fm['sourceArchiveId'] = id;
    fm['syncState'] = 'synced';
    fm['syncedContentHash'] = syncedContentHash;
  });
  return file;
}

function migration(h: TwoWayHarness, rows: UserArchive[], failOn?: string, open: ReadonlySet<string> = new Set()): ComposedPostMigrationService {
  const api = {
    getUserArchives: vi.fn(async ({ offset = 0 }: { offset?: number }) => ({
      archives: rows.slice(offset, offset + 2),
      total: rows.length,
      limit: 2,
      offset,
      hasMore: offset + 2 < rows.length,
      serverTime: '2026-11-08T00:00:00.000Z',
    })),
    getUserArchive: (id: string) => h.server.api.getUserArchive(id),
  } as unknown as WorkersAPIClient;
  const byId = (id: string): TFile | null => {
    if (id === failOn) throw new Error('lookup broke');
    return h.vault.getMarkdownFiles().find((file) => h.frontmatter.get(file.path)?.['sourceArchiveId'] === id) ?? null;
  };
  return new ComposedPostMigrationService({
    app: h.app,
    settings: () => h.settings,
    saveSettings: vi.fn(async () => undefined),
    apiClient: () => api,
    lookup: () => ({ findBySourceArchiveId: byId, findByClientPostId: () => null }) as unknown as ArchiveLookupService,
    waitForLookupIndex: async () => undefined,
    withArchiveWriteLocks: h.withLocks,
    pullWriter: h.pullWriter,
    conflictWriter: h.conflictWriter,
    pushNote: (file, opts) => h.sync.pushNote(file, opts),
    isOpen: (path) => open.has(path),
  });
}

function body(h: TwoWayHarness, file: TFile): string {
  return h.read(file.path).replace(/^---\n[\s\S]*?\n---\n/, '');
}

describe('ComposedPostMigrationService', () => {
  afterEach(() => resetRequestUrl());

  it('adopts, pulls or marks diverged, skips baselines and media notes, then sets the flag', async () => {
    const h = twoWayHarness();
    // Another device's post saved before two-way sync: same text, no baseline.
    const sameRow = composedRow('post_same', '# A heading\n1. first');
    h.server.rows.set(sameRow.id, sameRow);
    const same = (await h.storage.savePost(convertUserArchiveToPostData(sameRow))).file;
    await h.app.fileManager.processFrontMatter(same, (fm: Record<string, unknown>) => {
      delete fm['syncedContentRevision'];
    });
    const sameBody = body(h, same);
    // A plugin post untouched since its push; the server moved on.
    const pulled = await pluginPost(h, 'post_pull', '# Mine\n<b>');
    const pullRow = composedRow('post_pull', 'Edited on mobile', { contentRevision: 2 });
    // A plugin post edited after its push, and a different server text.
    const diverged = await pluginPost(h, 'post_div', 'Pushed text');
    await h.vault.process(diverged, (note) => note.replace('Pushed text', 'Edited offline'));
    const divRow = composedRow('post_div', 'Edited on mobile', { contentRevision: 1 });
    // Already on two-way sync.
    const baselineRow = composedRow('post_base', 'Server text', { contentRevision: 3 });
    const baseline = await pluginPost(h, 'post_base', 'Vault text');
    await h.app.fileManager.processFrontMatter(baseline, (fm: Record<string, unknown>) => {
      fm['syncedContentRevision'] = 3;
    });
    const baselineBody = body(h, baseline);
    const meetingRow = composedRow('post_meet', 'Notes', { contentType: 'meeting-note' });
    for (const row of [pullRow, divRow, baselineRow]) h.server.rows.set(row.id, row);

    await migration(h, [sameRow, pullRow, divRow, baselineRow, meetingRow]).runIfNeeded();

    expect(body(h, same)).toBe(sameBody);
    expect(h.frontmatter.get(same.path)).toMatchObject({ syncedContentRevision: 0, syncState: 'synced', postOrigin: 'composer' });
    expect(readComposedNote(h.read(pulled.path)).text).toBe('Edited on mobile');
    expect(h.frontmatter.get(pulled.path)).toMatchObject({ syncedContentRevision: 2 });
    expect(readComposedNote(h.read(diverged.path)).text).toBe('Edited offline');
    expect(h.frontmatter.get(diverged.path)).toMatchObject({ syncState: 'diverged', clientPostId: 'post_div', sourceArchiveId: 'post_div' });
    expect(h.frontmatter.get(diverged.path)).not.toHaveProperty('syncedContentRevision');
    expect(body(h, baseline)).toBe(baselineBody);
    expect(h.settings.composedPostMigrationDoneFor).toBe('tester');
    expect(h.server.puts).toHaveLength(0);
  });

  it('never rewrites a note open in an editor: that row waits for the next load', async () => {
    const h = twoWayHarness();
    const file = await pluginPost(h, 'post_open', 'Pushed text');
    const pullRow = composedRow('post_open', 'Edited on mobile', { contentRevision: 1 });
    h.server.rows.set(pullRow.id, pullRow);

    await migration(h, [pullRow], undefined, new Set([file.path])).runIfNeeded();
    expect(readComposedNote(h.read(file.path)).text).not.toBe('Edited on mobile');
    expect(h.settings.composedPostMigrationDoneFor).toBeUndefined();

    await migration(h, [pullRow]).runIfNeeded();
    expect(readComposedNote(h.read(file.path)).text).toBe('Edited on mobile');
    expect(h.settings.composedPostMigrationDoneFor).toBe('tester');
  });

  it('sets the flag only after a run with no failed row', async () => {
    const h = twoWayHarness();
    const rows = [composedRow('post_x', 'Text')];
    await migration(h, rows, 'post_x').runIfNeeded();
    expect(h.settings.composedPostMigrationDoneFor).toBeUndefined();

    await migration(h, rows).runIfNeeded();
    expect(h.settings.composedPostMigrationDoneFor).toBe('tester');
  });

  it('resolves a diverged note either way', async () => {
    const h = twoWayHarness();
    for (const id of ['post_srv', 'post_vault']) {
      h.server.rows.set(id, composedRow(id, 'Server text', { contentRevision: 1 }));
      const file = await pluginPost(h, id, 'Vault text');
      await h.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm['postOrigin'] = 'composer';
        fm['clientPostId'] = id;
        fm['syncState'] = 'diverged';
      });
    }
    const service = migration(h, []);
    expect(service.listDivergedNotes().map((file) => file.path)).toEqual(['Social Archives/Post/post_srv.md', 'Social Archives/Post/post_vault.md']);
    const [useServer, sendVault] = service.listDivergedNotes();

    await service.useServerVersion(useServer!);
    expect(readComposedNote(h.read(useServer!.path)).text).toBe('Server text');
    expect([...h.files.keys()].filter((path) => path.includes('post_srv (conflict '))).toHaveLength(1);

    await service.sendVaultVersion(sendVault!);
    expect(h.server.puts).toEqual([{ archiveId: 'post_vault', body: expect.objectContaining({ fullContent: 'Vault text', quoteRefs: true }) }]);
    expect(h.server.puts[0]?.body).not.toHaveProperty('baseContentRevision');
    expect(h.frontmatter.get(sendVault!.path)).toMatchObject({ syncState: 'synced', syncedContentRevision: 2 });
    expect(service.listDivergedNotes()).toEqual([]);
  });
});
