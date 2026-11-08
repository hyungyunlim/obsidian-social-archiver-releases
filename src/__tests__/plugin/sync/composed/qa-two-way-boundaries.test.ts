import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import type { UserArchive } from '@/services/WorkersAPIClient';
import type { PostData } from '@/types/post';
import { convertUserArchiveToPostData } from '@/plugin/mobile/UserArchiveConverter';
import { djb2, readComposedNote } from '@/plugin/sync/composed/composedNote';
import { ComposedPostMigrationService } from '@/plugin/sync/composed/ComposedPostMigrationService';
import { PostDataParser } from '@/components/timeline/parsers/PostDataParser';
import { stripHighlightMarks } from '@/components/timeline/reader/ReaderHighlightManager';
import { composedRow, resetRequestUrl, twoWayHarness, type TwoWayHarness } from './twoWayHarness';

/**
 * QA (prd-plugin-my-posts-two-way-sync): boundary requirements the
 * implementation's own tests do not pin down.
 */

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

async function tier3Note(h: TwoWayHarness, row: UserArchive): Promise<TFile> {
  h.server.rows.set(row.id, row);
  const { file } = await h.storage.savePost(convertUserArchiveToPostData(row));
  await h.reconciler.stampNew(file, row);
  return file;
}

function row(h: TwoWayHarness, id: string): UserArchive {
  const found = h.server.rows.get(id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

async function runMigration(h: TwoWayHarness, serverRow: UserArchive, file: TFile): Promise<void> {
  const api = {
    getUserArchives: vi.fn(async () => ({ archives: [serverRow], total: 1, limit: 100, offset: 0, hasMore: false, serverTime: '' })),
    getUserArchive: (id: string) => h.server.api.getUserArchive(id),
  };
  await new ComposedPostMigrationService({
    app: h.app,
    settings: () => h.settings,
    saveSettings: vi.fn(async () => undefined),
    apiClient: () => api as never,
    lookup: () => ({ findBySourceArchiveId: () => file, findByClientPostId: () => null }) as never,
    waitForLookupIndex: async () => undefined,
    withArchiveWriteLocks: h.withLocks,
    pullWriter: h.pullWriter,
    conflictWriter: h.conflictWriter,
    pushNote: (f, opts) => h.sync.pushNote(f, opts),
  }).runIfNeeded();
}

/** The 4.11 fingerprint (same oracle as ComposedPostMigrationService.test.ts). */
async function oldFingerprint(h: TwoWayHarness, file: TFile): Promise<string> {
  const parser = new PostDataParser(h.vault, h.app);
  const parsed = await parser.parseFile(file);
  const text = stripHighlightMarks(parser.extractContentText(h.read(file.path))).canonical
    .replace(/(?:(?:^|\n)\s*---)+$/, '')
    .trimEnd();
  return djb2(JSON.stringify([null, text, parsed?.media.map((m) => m.url) ?? []]));
}

function conflictCopies(h: TwoWayHarness): string[] {
  return [...h.files.keys()].filter((path) => path.includes(' (conflict '));
}

describe('QA: composed two-way sync boundaries', () => {
  afterEach(() => {
    resetRequestUrl();
    vi.useRealTimers();
  });

  // PRD §3 / §7 "같은 수정 동시 push → 409 후 adopt, 사본 없음". A note open in an
  // editor is pushed after 30 s of rest, so the 409 usually lands while it is
  // still open; the deferred retry must adopt equal text, not copy it.
  it('a 409 on an open note with the same text adopts after leave, no conflict copy', async () => {
    const h = twoWayHarness();
    const file = await tier3Note(h, composedRow('post_open', 'Before'));
    h.reconciler.start();
    h.open.add(file.path);
    await h.vault.process(file, (note) => note.replace('Before', 'Same edit'));
    h.server.editElsewhere('post_open', { fullContent: 'Same edit' });

    await h.sync.enqueueUpdate(file.path, 'post_open', 'post_open');
    await h.sync.flush();
    expect(h.server.puts).toHaveLength(1);

    h.open.delete(file.path);
    h.leave(file.path);
    await vi.waitFor(() => expect(h.frontmatter.get(file.path)?.['syncedContentRevision']).toBe(1));
    expect(conflictCopies(h)).toEqual([]);
  });

  // PRD §8 (Obsidian Sync across devices): the note text arrives on device B
  // before device A's baseline stamp. Same text on both sides is no conflict.
  it('reconcile adopts when note and server changed to the same text (no copy)', async () => {
    const h = twoWayHarness();
    const file = await tier3Note(h, composedRow('post_sync', 'Before'));
    await h.vault.process(file, (note) => note.replace('Before', 'Synced edit'));
    h.server.editElsewhere('post_sync', { fullContent: 'Synced edit' });

    await h.withLocks('post_sync', () => h.reconciler.reconcile(file, row(h, 'post_sync')));
    expect(conflictCopies(h)).toEqual([]);
    expect(h.frontmatter.get(file.path)).toMatchObject({ syncedContentRevision: 1 });
  });

  // PRD §3: only the post part goes to the server; plugin-owned sections
  // (annotations, AI comments, linked archives, place blocks) never do. A note
  // whose author line the user deleted must not leak them as fullContent.
  it('never pushes plugin-owned EOF blocks when the author line is missing', async () => {
    const h = twoWayHarness();
    const file = await tier3Note(h, composedRow('post_nofooter', 'Body'));
    await h.vault.process(file, (note) => `${note
      .replace(/\n---\n\n\*\*Author:\*\*[^\n]*\n?/, '\n')
      .replace('Body', 'Body edited')}\n## 🤖 AI Comments\n\nsecret ai\n\n<!-- social-archiver:linked-archives:start -->\nlinked\n<!-- social-archiver:linked-archives:end -->\n\n%% sa:locations\n{"v":1,"locations":[]}\n%%\n`);

    await h.sync.enqueueUpdate(file.path, 'post_nofooter', 'post_nofooter');
    await h.sync.flush();
    const sent = h.server.puts.map((put) => String(put.body['fullContent'] ?? ''));
    for (const fullContent of sent) {
      expect(fullContent).not.toContain('AI Comments');
      expect(fullContent).not.toContain('social-archiver:linked-archives');
      expect(fullContent).not.toContain('sa:locations');
    }
  });

  // §5.5 "composed post에는 MarkdownConverter 이스케이프를 적용하지 않는다" and
  // §5.6 adopt. A note the pre-two-way writer saved for another device's post
  // holds `\#`, `1\.`, `&lt;` that the server text never had; adopting it as is
  // makes the next Obsidian edit push those escapes to every other client.
  it('an adopted Tier-3 note with old writer escapes does not push the escapes on its next edit', async () => {
    const h = twoWayHarness();
    const serverRow = composedRow('post_old', '# Heading\n1. first\n<책>', { contentRevision: 2 });
    h.server.rows.set(serverRow.id, serverRow);
    // 4.11 escaped every post body; a meeting note still gets that escaping.
    const old = { ...convertUserArchiveToPostData(serverRow), contentType: 'meeting-note' } as PostData;
    const { file } = await h.storage.savePost(old);
    await h.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      delete fm['contentType'];
    });
    expect(h.read(file.path)).toContain('\\# Heading');

    await runMigration(h, serverRow, file);
    expect(h.frontmatter.get(file.path)).toMatchObject({ syncedContentRevision: 2 });

    await h.vault.process(file, (note) => note.replace('first', 'first!'));
    await h.sync.enqueueUpdate(file.path, 'post_old', 'post_old');
    await h.sync.flush();
    expect(h.server.puts).toHaveLength(1);
    expect(h.server.puts[0]?.body['fullContent']).toBe('# Heading\n1. first!\n<책>');
  });

  // §5.6 pull + PRD §3 "볼트 쪽 글은 사본으로 남긴다": the pre-two-way extractor
  // never sent a leading heading (or text after a mid-body media section), so a
  // heading typed later left syncedContentHash unchanged. The migration then
  // classifies the note "unchanged since push" and the pull must not erase text
  // the server never had without keeping a copy.
  it('migration pull keeps vault-only text the old sync never sent (copy or kept)', async () => {
    const h = twoWayHarness();
    const post = {
      platform: 'post', id: 'post_head', contentType: 'meeting-note',
      author: { name: 'tester', url: 'https://social-archive.org/tester', handle: '@tester' },
      content: { text: 'Body' }, media: [], metadata: { timestamp: new Date('2026-10-01T09:00:00.000Z') },
    } as unknown as PostData;
    const { file } = await h.storage.savePost(post, undefined, 'Social Archives/Post/post_head.md');
    // The user typed a heading on top in Obsidian; the old extractor dropped it.
    await h.vault.process(file, (note) => note.replace('\nBody', '\n## Only in the vault\n\nBody'));
    const syncedContentHash = await oldFingerprint(h, file);
    await h.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      delete fm['contentType'];
      fm['sourceArchiveId'] = 'post_head';
      fm['syncState'] = 'synced';
      fm['syncedContentHash'] = syncedContentHash;
    });
    const serverRow = composedRow('post_head', 'Body edited on mobile', { contentRevision: 1 });
    h.server.rows.set(serverRow.id, serverRow);

    await runMigration(h, serverRow, file);

    const kept = readComposedNote(h.read(file.path)).text.includes('Only in the vault')
      || conflictCopies(h).some((path) => h.read(path).includes('Only in the vault'));
    expect(kept).toBe(true);
  });

  // Phase 4 checkpoint 6: meeting/audio notes, non-composed `post` notes,
  // `postOrigin: shared` notes, CRLF notes and notes without a baseline are never PUT.
  it('never PUTs a note outside the participant gate, whatever the watcher sees', async () => {
    const h = twoWayHarness();
    const base = { platform: 'post', sourceArchiveId: 'srv', clientPostId: 'cid', syncedContentHash: 'stale', syncedContentRevision: 0 };
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['audio.md', { ...base, postOrigin: 'composer', contentType: 'audio-note' }, '\n'],
      ['meeting.md', { ...base, postOrigin: 'composer', contentType: 'meeting-note' }, '\n'],
      ['plain-post.md', { ...base }, '\n'],
      ['shared.md', { ...base, postOrigin: 'shared' }, '\n'],
      ['no-baseline.md', { ...base, postOrigin: 'composer', syncedContentRevision: undefined }, '\n'],
      ['crlf.md', { ...base, postOrigin: 'composer' }, '\r\n'],
    ];
    vi.useFakeTimers();
    await h.sync.onPluginLoad();
    for (const [path, fm, eol] of cases) {
      const json = JSON.stringify(fm);
      h.files.set(path, `---${eol}${json}${eol}---${eol}Edited text${eol}${eol}---${eol}${eol}**Author:** tester${eol}`);
      h.frontmatter.set(path, JSON.parse(json) as Record<string, unknown>);
      h.indexed(path);
      await h.sync.enqueueUpdate(path, `cid-${path}`, 'srv');
    }
    await vi.advanceTimersByTimeAsync(30_000);
    await h.sync.flush();
    expect(h.server.puts).toHaveLength(0);
  });

  it('the push watcher ignores a conflict copy', async () => {
    const h = twoWayHarness();
    const file = await tier3Note(h, composedRow('post_c', 'Before'));
    await h.vault.process(file, (note) => note.replace('Before', 'Vault edit'));
    h.server.editElsewhere('post_c', { fullContent: 'Server edit' });
    expect(await h.withLocks('post_c', () => h.reconciler.reconcile(file, row(h, 'post_c')))).toBe('conflict');
    const [copyPath] = conflictCopies(h);
    expect(copyPath).toBeDefined();
    const copyFm = h.frontmatter.get(copyPath!) ?? {};
    for (const field of ['sourceArchiveId', 'clientPostId', 'postOrigin', 'originalUrl', 'syncedContentRevision']) {
      expect(copyFm).not.toHaveProperty(field);
    }

    vi.useFakeTimers();
    await h.sync.onPluginLoad();
    h.indexed(copyPath!);
    h.indexed(file.path);
    await vi.advanceTimersByTimeAsync(30_000);
    await h.sync.flush();
    expect(h.server.puts).toHaveLength(0);
  });
});
