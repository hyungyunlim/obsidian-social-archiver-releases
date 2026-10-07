import { describe, expect, it, vi } from 'vitest';
import { TFile, type App, type Vault } from 'obsidian';
import { PostService } from '@/services/PostService';
import type { SocialArchiverSettings } from '@/types/settings';

/**
 * "Post current note", "Post and share current note" and the CLI's post/share
 * copy a note into the timeline. A composer note already is a timeline post:
 * its copy landed on the note itself within the month, and otherwise carried
 * its clientPostId into a second note whose share import-share turned into a
 * second server row.
 */

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  stringifyYaml: (value: unknown): string => `${JSON.stringify(value)}\n`,
}));

/** The test mock's TFile takes a path; obsidian's typings don't. */
const fileAt = (path: string): TFile => new (TFile as unknown as new (p: string) => TFile)(path);

function harness(frontmatter: Record<string, unknown> | undefined, content: string) {
  const vault = {
    read: vi.fn(async () => content),
    create: vi.fn(async (path: string) => fileAt(path)),
    getMarkdownFiles: () => [],
    getFolderByPath: () => ({}),
  } as unknown as Vault;
  const app = {
    metadataCache: { getFileCache: () => (frontmatter ? { frontmatter } : null) },
  } as unknown as App;
  const settings = {
    archivePath: 'Social Archives',
    mediaPath: 'attachments/social-archives',
    username: 'owner',
  } as unknown as SocialArchiverSettings;
  return { service: new PostService(app, vault, settings), vault };
}

describe('PostService.postNote', () => {
  it('leaves a composer note where it is', async () => {
    const { service, vault } = harness(
      { postOrigin: 'composer', clientPostId: 'post_4f1c2a9e-7b3d-4c55-9a10-2e8f6d7c1b00', syncState: 'pending' },
      '---\npostOrigin: composer\n---\n\nHello from the composer',
    );

    const result = await service.postNote(fileAt('Social Archives/Post/2026/10/2026-10-06-183000.md'));

    expect(result.success).toBe(false);
    expect(result.error).toBe('This note is already on the timeline. Share it from its post card.');
    expect(vault.create).not.toHaveBeenCalled();
  });

  it('still copies any other note into the timeline', async () => {
    const { service, vault } = harness(undefined, 'Just an idea');

    const result = await service.postNote(fileAt('Notes/idea.md'));

    expect(result.success).toBe(true);
    expect(vault.create).toHaveBeenCalledTimes(1);
  });
});
