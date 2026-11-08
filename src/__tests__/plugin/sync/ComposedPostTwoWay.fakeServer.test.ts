import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import type { UserArchive } from '@/services/WorkersAPIClient';
import type { PostData } from '@/types/post';
import { convertUserArchiveToPostData } from '@/plugin/mobile/UserArchiveConverter';
import { createComposedPostId } from '@/plugin/sync/ComposedPostSyncService';
import { readComposedNote } from '@/plugin/sync/composed/composedNote';
import { API, composedRow, resetRequestUrl, twoWayHarness, type TwoWayHarness } from './composed/twoWayHarness';

/**
 * Composed-post two-way sync end to end (prd-plugin-my-posts-two-way-sync §7):
 * the real reconciler, writers and ComposedPostSyncService against a fake
 * server with revision compare-and-swap.
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

const IMAGE = `${API}/media/archives/tester/post_a/0.png`;

/** Another device's post, saved by library sync's Tier 3 and given its baseline. */
async function tier3Note(h: TwoWayHarness, row: UserArchive): Promise<TFile> {
  h.server.rows.set(row.id, row);
  const { file } = await h.storage.savePost(convertUserArchiveToPostData(row));
  await h.reconciler.stampNew(file, row);
  return file;
}

function postText(h: TwoWayHarness, file: TFile): string {
  return readComposedNote(h.read(file.path)).text;
}

function row(h: TwoWayHarness, id: string): UserArchive {
  const found = h.server.rows.get(id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

describe('composed post two-way sync — fake server', () => {
  afterEach(() => {
    resetRequestUrl();
    vi.useRealTimers();
  });

  it('pulls a mobile edit once, reuses the downloaded image, and never PUTs it back', async () => {
    const h = twoWayHarness();
    const file = await tier3Note(h, composedRow('post_a', 'First version', { media: [{ type: 'image', url: IMAGE }] }));
    expect(h.frontmatter.get(file.path)).toMatchObject({ postOrigin: 'composer', syncedContentRevision: 0, syncState: 'synced' });

    vi.useFakeTimers();
    await h.sync.onPluginLoad();

    h.server.editElsewhere('post_a', { fullContent: 'Edited on mobile\n\nwith a second paragraph' });
    expect(await h.withLocks('post_a', () => h.reconciler.reconcile(file, row(h, 'post_a')))).toBe('pulled');
    expect(postText(h, file)).toBe('Edited on mobile\n\nwith a second paragraph');
    expect(h.downloads).toEqual([IMAGE]);
    expect(h.frontmatter.get(file.path)).toMatchObject({ syncedContentRevision: 1 });

    // The rewrite is not an edit: the watcher sends nothing, even after 30 s.
    h.indexed(file.path);
    await vi.advanceTimersByTimeAsync(30_000);
    await h.sync.flush();
    expect(h.server.puts).toHaveLength(0);
    expect(await h.withLocks('post_a', () => h.reconciler.reconcile(file, row(h, 'post_a')))).toBe('none');

    // A second mobile edit keeps the image already in the vault.
    h.server.editElsewhere('post_a', { fullContent: 'Third version' });
    expect(await h.withLocks('post_a', () => h.reconciler.reconcile(file, row(h, 'post_a')))).toBe('pulled');
    expect(h.downloads).toEqual([IMAGE]);
    expect(readComposedNote(h.read(file.path)).attachments).toEqual([
      { target: 'attachments/social-archives/post/post_a/101.png', remote: false },
    ]);
    h.indexed(file.path);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.server.puts).toHaveLength(0);
  });

  it('sends an Obsidian edit once, with its base revision, and the image the server already has', async () => {
    const h = twoWayHarness();
    const file = await tier3Note(h, composedRow('post_a', 'Written on mobile', { media: [{ type: 'image', url: IMAGE }] }));
    vi.useFakeTimers();
    await h.sync.onPluginLoad();

    await h.vault.process(file, (note) => note.replace('Written on mobile', 'Written on mobile, fixed in Obsidian'));
    h.indexed(file.path);
    await vi.advanceTimersByTimeAsync(5_000);
    await h.sync.flush();

    expect(h.server.puts).toEqual([{
      archiveId: 'post_a',
      body: expect.objectContaining({
        fullContent: 'Written on mobile, fixed in Obsidian',
        baseContentRevision: 0,
        quoteRefs: true,
        media: [{ url: IMAGE, type: 'image' }],
      }),
    }]);
    expect(h.server.uploads).toHaveLength(0);
    expect(h.frontmatter.get(file.path)).toMatchObject({ syncedContentRevision: 1, syncState: 'synced' });
    expect(row(h, 'post_a').fullContent).toBe('Written on mobile, fixed in Obsidian');
  });

  it('keeps the vault text as one conflict copy when both sides edited, and the note takes the server version', async () => {
    const h = twoWayHarness();
    const file = await tier3Note(h, composedRow('post_a', 'Original'));
    await h.vault.process(file, (note) => note.replace('Original', 'Changed in the vault'));
    h.server.editElsewhere('post_a', { fullContent: 'Changed on mobile' });

    expect(await h.withLocks('post_a', () => h.reconciler.reconcile(file, row(h, 'post_a')))).toBe('conflict');

    expect(postText(h, file)).toBe('Changed on mobile');
    const copies = [...h.files.keys()].filter((path) => path.includes('(conflict '));
    expect(copies).toHaveLength(1);
    const copy = h.read(copies[0]!);
    expect(copy).toContain('Changed in the vault');
    expect(h.frontmatter.get(copies[0]!)).toMatchObject({ conflictOf: `[[${file.basename}]]` });
    expect(h.frontmatter.get(copies[0]!)).not.toHaveProperty('sourceArchiveId');
    expect(h.frontmatter.get(copies[0]!)).not.toHaveProperty('postOrigin');
    expect(h.server.puts).toHaveLength(0);
  });

  it('adopts a 409 when another device already sent the same edit, with no copy', async () => {
    const h = twoWayHarness();
    const file = await tier3Note(h, composedRow('post_a', 'Before'));
    h.server.editElsewhere('post_a', { fullContent: 'Same edit on both' });
    await h.vault.process(file, (note) => note.replace('Before', 'Same edit on both'));

    await h.sync.enqueueUpdate(file.path, 'post_a', 'post_a');
    await h.sync.flush();

    expect(h.server.puts).toHaveLength(1);
    expect(h.server.puts[0]?.body['baseContentRevision']).toBe(0);
    expect([...h.files.keys()].some((path) => path.includes('(conflict '))).toBe(false);
    expect(h.frontmatter.get(file.path)).toMatchObject({ syncedContentRevision: 1, syncState: 'synced' });
    expect(h.settings.pendingComposedPostSyncs).toHaveLength(0);
  });

  it('defers a pull while the note is open, and applies it once the user leaves', async () => {
    const h = twoWayHarness();
    const file = await tier3Note(h, composedRow('post_a', 'Before'));
    h.reconciler.start();
    h.open.add(file.path);
    h.server.editElsewhere('post_a', { fullContent: 'Edited on mobile' });

    expect(await h.withLocks('post_a', () => h.reconciler.reconcile(file, row(h, 'post_a')))).toBe('deferred');
    expect(postText(h, file)).toBe('Before');

    h.open.delete(file.path);
    h.leave(file.path);
    await vi.waitFor(() => expect(postText(h, file)).toBe('Edited on mobile'));
    expect(h.server.puts).toHaveLength(0);
  });

  it('creates a composer post without sending upload indexes, at revision 0', async () => {
    const h = twoWayHarness();
    const post = {
      platform: 'post',
      id: createComposedPostId(),
      author: { name: 'tester', url: 'https://social-archive.org/tester', handle: '@tester' },
      content: { text: 'A post with a picture\n\n1. not escaped\n<tag>' },
      media: [],
      metadata: { timestamp: new Date('2026-11-01T09:00:00.000Z') },
    } as unknown as PostData;
    const picture = { name: 'cat.png', type: 'image/png', size: 2, arrayBuffer: async () => new Uint8Array([1, 2]).buffer } as unknown as File;
    const { path } = await h.storage.savePost(post, [picture]);

    await h.sync.enqueueCreate(path, post.id);
    await h.sync.flush();

    expect(h.server.uploads).toHaveLength(1);
    expect(h.server.uploads[0]).not.toHaveProperty('index');
    expect(row(h, post.id).fullContent).toBe('A post with a picture\n\n1. not escaped\n<tag>');
    expect(h.frontmatter.get(path)).toMatchObject({ syncedContentRevision: 0, syncState: 'synced' });
  });
});

describe('composed post two-way sync — client-sync queue path and notes without a baseline', () => {
  afterEach(() => {
    resetRequestUrl();
  });

  it('a queue-saved new note gets its baseline; a queue save of an existing note pulls', async () => {
    const h = twoWayHarness();
    const serverRow = composedRow('post_q', 'Posted on mobile', { media: [{ type: 'image', url: IMAGE }] });
    h.server.rows.set(serverRow.id, serverRow);
    const { file } = await h.storage.savePost(convertUserArchiveToPostData(serverRow));
    const media = [{ url: IMAGE, localPath: 'attachments/social-archives/post/post_q/1.png' }];
    await h.vault.createBinary(media[0]!.localPath, new Uint8Array([7]).buffer);

    await h.reconciler.afterQueueSave({ status: 'created', file, media }, serverRow);
    expect(h.frontmatter.get(file.path)).toMatchObject({ syncedContentRevision: 0, syncState: 'synced' });
    expect(h.frontmatter.get(file.path)?.['syncedMedia']).toEqual([expect.stringMatching(new RegExp(`^[0-9a-f]{64}:${IMAGE}$`))]);

    h.server.editElsewhere('post_q', { fullContent: 'Edited on mobile' });
    await h.reconciler.afterQueueSave({ status: 'existing', file }, row(h, 'post_q'));
    expect(postText(h, file)).toBe('Edited on mobile');
    expect(h.server.puts).toHaveLength(0);
  });

  it('a composed note with no baseline joins on the same text, and waits for the user otherwise', async () => {
    const h = twoWayHarness();
    const same = composedRow('post_same', 'Same everywhere');
    const differs = composedRow('post_diff', 'Older text', { postedAt: '2026-11-02T09:00:00.000Z' });
    const notes: TFile[] = [];
    for (const serverRow of [same, differs]) {
      h.server.rows.set(serverRow.id, serverRow);
      notes.push((await h.storage.savePost(convertUserArchiveToPostData(serverRow))).file);
    }
    h.server.editElsewhere('post_diff', { fullContent: 'Edited on mobile' });

    expect(await h.reconciler.reconcile(notes[0]!, row(h, 'post_same'))).toBe('none');
    expect(h.frontmatter.get(notes[0]!.path)).toMatchObject({ syncedContentRevision: 0, syncState: 'synced' });
    expect(await h.reconciler.reconcile(notes[1]!, row(h, 'post_diff'))).toBe('skipped');
    expect(h.frontmatter.get(notes[1]!.path)).toMatchObject({ syncState: 'diverged', sourceArchiveId: 'post_diff' });
    expect(postText(h, notes[1]!)).toBe('Older text');
  });

  it('pulls nothing to disk when media downloads are off', async () => {
    const h = twoWayHarness();
    (h.settings as { downloadMedia?: string }).downloadMedia = 'text-only';
    const file = await tier3Note(h, composedRow('post_t', 'Text', { media: [{ type: 'image', url: IMAGE }] }));
    h.server.editElsewhere('post_t', { fullContent: 'Text, edited' });

    expect(await h.reconciler.reconcile(file, row(h, 'post_t'))).toBe('pulled');
    expect(h.downloads).toEqual([]);
    expect(readComposedNote(h.read(file.path)).attachments).toEqual([{ target: IMAGE, remote: true }]);
  });
});
