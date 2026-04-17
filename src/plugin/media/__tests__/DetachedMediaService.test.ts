/**
 * DetachedMediaService Tests
 *
 * Covers:
 *   - canDetach / canDetachSync eligibility matrix.
 *   - canRedownload / canRedownloadSync eligibility matrix.
 *   - detach():
 *       * Body rewrite replaces local embeds with remote renders.
 *       * User body is not touched beyond the matched embeds.
 *       * app.fileManager.trashFile() is used for each attachment.
 *       * Frontmatter updated: mediaDetached=true, markers swapped from
 *         `downloaded:` to `declined:`.
 *       * Partial delete failure increments failedCount, does not throw.
 *       * Legacy note without mediaSourceUrls throws.
 *   - redownload():
 *       * Guard prompt invoked when wired; 'detach' aborts, 'download' proceeds.
 *       * Body rewrite swaps remote URLs to local embeds.
 *       * Frontmatter flipped: mediaDetached removed/false, markers swapped
 *         from `declined:` back to `downloaded:`.
 *       * suppressPromptForArchive sets mediaPromptSuppressed.
 *       * Guard probe failure fails open (proceeds with redownload).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DetachedMediaService } from '../DetachedMediaService';
import type { LargeMediaGuardService } from '../LargeMediaGuardService';
import type { MediaHandler } from '@/services/MediaHandler';
import type { Logger } from '@/services/Logger';
import type { SocialArchiverSettings } from '@/types/settings';
import { TFile, type App } from 'obsidian';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

interface MockFileSystem {
  fileCache: Map<string, { frontmatter: Record<string, unknown> }>;
  fileContent: Map<string, string>;
  abstractFiles: Map<string, TFile>;
  trashed: string[];
  trashFailures: Set<string>;
}

interface MockContext {
  app: App;
  fs: MockFileSystem;
  mediaHandler: MediaHandler;
  // Typed loosely to accommodate vi.fn() generic inference across versions.
  redownloadSpy: ReturnType<typeof vi.fn>;
  guard: LargeMediaGuardService;
  inspectSpy: ReturnType<typeof vi.fn>;
  promptSpy: ReturnType<typeof vi.fn>;
}

function installFile(
  fs: MockFileSystem,
  path: string,
  content: string,
  frontmatter: Record<string, unknown>
): TFile {
  const tfile = new TFile(path);
  fs.fileCache.set(path, { frontmatter: { ...frontmatter } });
  fs.fileContent.set(path, content);
  fs.abstractFiles.set(path, tfile);
  return tfile;
}

function makeContext(): MockContext {
  const fs: MockFileSystem = {
    fileCache: new Map(),
    fileContent: new Map(),
    abstractFiles: new Map(),
    trashed: [],
    trashFailures: new Set(),
  };

  const app = {
    vault: {
      read: vi.fn(async (file: TFile) => fs.fileContent.get(file.path) ?? ''),
      modify: vi.fn(async (file: TFile, content: string) => {
        fs.fileContent.set(file.path, content);
      }),
      getAbstractFileByPath: vi.fn((path: string) => fs.abstractFiles.get(path) ?? null),
    },
    metadataCache: {
      getFileCache: vi.fn((file: TFile) => fs.fileCache.get(file.path) ?? null),
    },
    fileManager: {
      trashFile: vi.fn(async (file: TFile) => {
        if (fs.trashFailures.has(file.path)) {
          throw new Error('simulated trash failure');
        }
        fs.trashed.push(file.path);
        fs.abstractFiles.delete(file.path);
      }),
      processFrontMatter: vi.fn(
        async (file: TFile, updater: (fm: Record<string, unknown>) => void) => {
          const cache = fs.fileCache.get(file.path);
          const fm = cache?.frontmatter ? { ...cache.frontmatter } : {};
          updater(fm);
          fs.fileCache.set(file.path, { frontmatter: fm });
        }
      ),
    },
  } as unknown as App;

  const redownloadSpy = vi.fn();
  redownloadSpy.mockImplementation(async (...args: unknown[]) => {
    const expired = args[0] as { originalUrl: string };
    const idx = args[4] as number;
    const safe = expired.originalUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
    return `attachments/social-archives/x/testuser/media${idx}_${safe}.mp4`;
  });
  const mediaHandler = {
    redownloadExpiredMedia: redownloadSpy,
  } as unknown as MediaHandler;

  const inspectSpy = vi.fn();
  inspectSpy.mockResolvedValue({
    oversizedVideoUrls: [] as string[],
    estimatedBytesByUrl: new Map<string, number>(),
  });
  const promptSpy = vi.fn();
  promptSpy.mockResolvedValue(null);
  const guard = {
    inspectTopLevelMedia: inspectSpy,
    promptIfNeeded: promptSpy,
  } as unknown as LargeMediaGuardService;

  return { app, fs, mediaHandler, redownloadSpy, guard, inspectSpy, promptSpy };
}

function makeSettings(
  overrides: Partial<SocialArchiverSettings> = {}
): SocialArchiverSettings {
  return {
    largeVideoPromptThresholdMB: 100,
    ...overrides,
  } as unknown as SocialArchiverSettings;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

describe('DetachedMediaService: eligibility', () => {
  describe('canDetach / canDetachSync', () => {
    it('returns false when frontmatter has no mediaSourceUrls', async () => {
      const ctx = makeContext();
      const file = installFile(ctx.fs, 'note.md', '', {});
      const service = new DetachedMediaService({
        app: ctx.app,
        mediaHandler: ctx.mediaHandler,
        logger: makeLogger(),
      });
      expect(await service.canDetach(file)).toBe(false);
      expect(service.canDetachSync(file)).toBe(false);
    });

    it('returns false when mediaSourceUrls is empty', async () => {
      const ctx = makeContext();
      const file = installFile(ctx.fs, 'note.md', '', { mediaSourceUrls: [] });
      const service = new DetachedMediaService({
        app: ctx.app,
        mediaHandler: ctx.mediaHandler,
        logger: makeLogger(),
      });
      expect(await service.canDetach(file)).toBe(false);
      expect(service.canDetachSync(file)).toBe(false);
    });

    it('returns false when already detached', async () => {
      const ctx = makeContext();
      const file = installFile(ctx.fs, 'note.md', '', {
        mediaSourceUrls: ['https://example.com/x.mp4'],
        mediaDetached: true,
      });
      const service = new DetachedMediaService({
        app: ctx.app,
        mediaHandler: ctx.mediaHandler,
        logger: makeLogger(),
      });
      expect(await service.canDetach(file)).toBe(false);
      expect(service.canDetachSync(file)).toBe(false);
    });

    it('returns true when mediaSourceUrls present and not yet detached', async () => {
      const ctx = makeContext();
      const file = installFile(ctx.fs, 'note.md', '', {
        mediaSourceUrls: ['https://example.com/x.mp4'],
      });
      const service = new DetachedMediaService({
        app: ctx.app,
        mediaHandler: ctx.mediaHandler,
        logger: makeLogger(),
      });
      expect(await service.canDetach(file)).toBe(true);
      expect(service.canDetachSync(file)).toBe(true);
    });
  });

  describe('canRedownload / canRedownloadSync', () => {
    it('returns true only when mediaDetached is true AND sourceUrls present', async () => {
      const ctx = makeContext();
      const file = installFile(ctx.fs, 'note.md', '', {
        mediaSourceUrls: ['https://example.com/x.mp4'],
        mediaDetached: true,
      });
      const service = new DetachedMediaService({
        app: ctx.app,
        mediaHandler: ctx.mediaHandler,
        logger: makeLogger(),
      });
      expect(await service.canRedownload(file)).toBe(true);
      expect(service.canRedownloadSync(file)).toBe(true);
    });

    it('returns false when mediaDetached is not true', async () => {
      const ctx = makeContext();
      const file = installFile(ctx.fs, 'note.md', '', {
        mediaSourceUrls: ['https://example.com/x.mp4'],
      });
      const service = new DetachedMediaService({
        app: ctx.app,
        mediaHandler: ctx.mediaHandler,
        logger: makeLogger(),
      });
      expect(await service.canRedownload(file)).toBe(false);
      expect(service.canRedownloadSync(file)).toBe(false);
    });

    it('returns false when mediaSourceUrls is empty even if detached', async () => {
      const ctx = makeContext();
      const file = installFile(ctx.fs, 'note.md', '', {
        mediaSourceUrls: [],
        mediaDetached: true,
      });
      const service = new DetachedMediaService({
        app: ctx.app,
        mediaHandler: ctx.mediaHandler,
        logger: makeLogger(),
      });
      expect(await service.canRedownload(file)).toBe(false);
      expect(service.canRedownloadSync(file)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// detach()
// ---------------------------------------------------------------------------

describe('DetachedMediaService.detach', () => {
  const notePath = 'Social Archives/X/2026/04/note.md';
  const video1 = 'https://video.twimg.com/ext/v1.mp4';
  const video2 = 'https://video.twimg.com/ext/v2.mp4';
  // Real attachment naming: {date}-{username}-{postId}-{1-based index}.{ext}
  // The trailing `-1`/`-2` maps to mediaSourceUrls[0] / mediaSourceUrls[1].
  const localEmbed1 =
    'attachments/social-archives/x/testuser/20260417-testuser-post123-1.mp4';
  const localEmbed2 =
    'attachments/social-archives/x/testuser/20260417-testuser-post123-2.mp4';

  const baseBody = [
    '---',
    '---',
    '',
    'User-authored body text that must not be disturbed.',
    '',
    `![[${localEmbed1}]]`,
    '',
    `![alt](${localEmbed2})`,
    '',
    '## Comments',
    '',
    'A comment that mentions attachments/social-archives/x/other/other.mp4 by name only.',
  ].join('\n');

  function setup(extraFrontmatter: Record<string, unknown> = {}) {
    const ctx = makeContext();
    const file = installFile(ctx.fs, notePath, baseBody, {
      mediaSourceUrls: [video1, video2],
      downloadedUrls: [`downloaded:${video1}`, `downloaded:${video2}`],
      platform: 'x',
      author: 'testuser',
      ...extraFrontmatter,
    });
    // Install the vault files that will be trashed.
    installFile(ctx.fs, localEmbed1, '', {});
    installFile(ctx.fs, localEmbed2, '', {});
    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    return { ctx, file, service };
  }

  it('rewrites local embeds to remote URLs and preserves user body', async () => {
    const { ctx, file, service } = setup();
    const result = await service.detach(file);

    expect(result.rewrittenCount).toBe(2);
    const newBody = ctx.fs.fileContent.get(notePath) ?? '';
    // Both local embeds replaced with remote references to the source URLs.
    expect(newBody).toContain(video1);
    expect(newBody).toContain(video2);
    expect(newBody).not.toContain(`![[${localEmbed1}]]`);
    expect(newBody).not.toContain(`![alt](${localEmbed2})`);
    // User body and comment section are untouched.
    expect(newBody).toContain('User-authored body text that must not be disturbed.');
    expect(newBody).toContain('## Comments');
    expect(newBody).toContain(
      'A comment that mentions attachments/social-archives/x/other/other.mp4 by name only.'
    );
  });

  it('trashes each local attachment via fileManager.trashFile', async () => {
    const { ctx, file, service } = setup();
    const result = await service.detach(file);
    expect(result.deletedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(ctx.fs.trashed).toEqual(expect.arrayContaining([localEmbed1, localEmbed2]));
    // trashFile, not vault.delete
    expect(ctx.app.fileManager.trashFile).toHaveBeenCalledTimes(2);
  });

  it('sets mediaDetached=true and swaps downloaded: markers to declined:', async () => {
    const { ctx, file, service } = setup();
    await service.detach(file);
    const fm = ctx.fs.fileCache.get(notePath)?.frontmatter ?? {};
    expect(fm.mediaDetached).toBe(true);
    expect(fm.downloadedUrls).toEqual(
      expect.arrayContaining([`declined:${video1}`, `declined:${video2}`])
    );
    const urls = (fm.downloadedUrls as string[]) ?? [];
    expect(urls.some((u) => u === `downloaded:${video1}`)).toBe(false);
    expect(urls.some((u) => u === `downloaded:${video2}`)).toBe(false);
  });

  it('continues when one attachment fails to trash and returns accurate counts', async () => {
    const { ctx, file, service } = setup();
    ctx.fs.trashFailures.add(localEmbed2);
    const result = await service.detach(file);
    expect(result.deletedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    // Body rewrite still succeeded.
    const fm = ctx.fs.fileCache.get(notePath)?.frontmatter ?? {};
    expect(fm.mediaDetached).toBe(true);
  });

  it('throws when note lacks mediaSourceUrls (legacy note)', async () => {
    const ctx = makeContext();
    const file = installFile(ctx.fs, notePath, baseBody, {});
    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    await expect(service.detach(file)).rejects.toThrow(/mediaSourceUrls/i);
  });

  it('throws when note is already detached', async () => {
    const ctx = makeContext();
    const file = installFile(ctx.fs, notePath, baseBody, {
      mediaSourceUrls: [video1],
      mediaDetached: true,
    });
    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    await expect(service.detach(file)).rejects.toThrow(/already detached/i);
  });

  // -------------------------------------------------------------------------
  // Filename-index matching robustness (QA fix)
  //
  // Previous ordinal-index implementation would map the N-th matched embed to
  // mediaSourceUrls[N], which breaks when the user edits the body. These tests
  // verify the fix: filename-index extraction, with defensive fallbacks.
  // -------------------------------------------------------------------------

  const video3 = 'https://video.twimg.com/ext/v3.mp4';
  const localEmbed3 =
    'attachments/social-archives/x/testuser/20260417-testuser-post123-3.mp4';

  it('maps filename index correctly when user removed a middle embed', async () => {
    // Body has embed-1 and embed-3 (user deleted embed-2). mediaSourceUrls
    // still has 3 entries. Expect URL[0] at embed-1 position and URL[2] at
    // embed-3 position; URL[1] never appears because its embed is gone.
    const ctx = makeContext();
    const body = [
      '---',
      '---',
      '',
      'Body copy.',
      '',
      `![[${localEmbed1}]]`,
      '',
      `![[${localEmbed3}]]`,
    ].join('\n');
    const file = installFile(ctx.fs, notePath, body, {
      mediaSourceUrls: [video1, video2, video3],
      downloadedUrls: [
        `downloaded:${video1}`,
        `downloaded:${video2}`,
        `downloaded:${video3}`,
      ],
      platform: 'x',
      author: 'testuser',
    });
    installFile(ctx.fs, localEmbed1, '', {});
    installFile(ctx.fs, localEmbed3, '', {});

    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    const result = await service.detach(file);

    expect(result.rewrittenCount).toBe(2);
    const newBody = ctx.fs.fileContent.get(notePath) ?? '';
    expect(newBody).toContain(video1);
    expect(newBody).toContain(video3);
    // Crucial: URL[1] must NOT be substituted anywhere — its embed is gone.
    expect(newBody).not.toContain(video2);
  });

  it('maps filename index correctly when embeds are reordered', async () => {
    // Body has embed-3 appearing before embed-1. With ordinal matching this
    // would map embed-3 → URL[0] and embed-1 → URL[1]. Filename-index matching
    // correctly maps each embed to its own URL regardless of order.
    const ctx = makeContext();
    const body = [
      '---',
      '---',
      '',
      `![[${localEmbed3}]]`,
      '',
      `![[${localEmbed1}]]`,
    ].join('\n');
    const file = installFile(ctx.fs, notePath, body, {
      mediaSourceUrls: [video1, video2, video3],
      downloadedUrls: [
        `downloaded:${video1}`,
        `downloaded:${video2}`,
        `downloaded:${video3}`,
      ],
      platform: 'x',
      author: 'testuser',
    });
    installFile(ctx.fs, localEmbed1, '', {});
    installFile(ctx.fs, localEmbed3, '', {});

    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    await service.detach(file);

    const newBody = ctx.fs.fileContent.get(notePath) ?? '';
    // Expect URL[2] (video3) to appear BEFORE URL[0] (video1) — matching the
    // reordered embeds, not the ordinal of the matches.
    const idx3 = newBody.indexOf(video3);
    const idx1 = newBody.indexOf(video1);
    expect(idx3).toBeGreaterThanOrEqual(0);
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx3).toBeLessThan(idx1);
    expect(newBody).not.toContain(video2);
  });

  it('skips embeds whose filename does not match the index pattern', async () => {
    // One embed has a legacy/renamed filename that does not end in -{N}.{ext}.
    // Expect it to be left intact (no URL substituted, no wrong mapping).
    const ctx = makeContext();
    const legacyEmbed =
      'attachments/social-archives/x/testuser/custom_name_no_index.mp4';
    const body = [
      '---',
      '---',
      '',
      `![[${localEmbed1}]]`,
      '',
      `![[${legacyEmbed}]]`,
    ].join('\n');
    const file = installFile(ctx.fs, notePath, body, {
      mediaSourceUrls: [video1, video2],
      downloadedUrls: [`downloaded:${video1}`, `downloaded:${video2}`],
      platform: 'x',
      author: 'testuser',
    });
    installFile(ctx.fs, localEmbed1, '', {});
    installFile(ctx.fs, legacyEmbed, '', {});

    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    const result = await service.detach(file);

    // Only the well-named embed is rewritten; the legacy one is preserved.
    expect(result.rewrittenCount).toBe(1);
    const newBody = ctx.fs.fileContent.get(notePath) ?? '';
    expect(newBody).toContain(video1);
    expect(newBody).toContain(`![[${legacyEmbed}]]`); // intact
    // Wrong-mapping guard: video2 (URL[1]) must not be substituted into the
    // legacy embed's position.
    expect(newBody).not.toContain(video2);
  });

  it('skips embed when parsed filename index is out of bounds for sourceUrls', async () => {
    // Embed filename claims index 5 (→ array index 4) but mediaSourceUrls has
    // only 2 entries. Expect no substitution for that embed.
    const ctx = makeContext();
    const outOfBoundsEmbed =
      'attachments/social-archives/x/testuser/20260417-testuser-post123-5.mp4';
    const body = [
      '---',
      '---',
      '',
      `![[${localEmbed1}]]`,
      '',
      `![[${outOfBoundsEmbed}]]`,
    ].join('\n');
    const file = installFile(ctx.fs, notePath, body, {
      mediaSourceUrls: [video1, video2],
      downloadedUrls: [`downloaded:${video1}`, `downloaded:${video2}`],
      platform: 'x',
      author: 'testuser',
    });
    installFile(ctx.fs, localEmbed1, '', {});
    installFile(ctx.fs, outOfBoundsEmbed, '', {});

    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    const result = await service.detach(file);

    expect(result.rewrittenCount).toBe(1);
    const newBody = ctx.fs.fileContent.get(notePath) ?? '';
    expect(newBody).toContain(video1);
    // Out-of-bounds embed preserved; neither URL substituted into its slot.
    expect(newBody).toContain(`![[${outOfBoundsEmbed}]]`);
  });
});

// ---------------------------------------------------------------------------
// redownload()
// ---------------------------------------------------------------------------

describe('DetachedMediaService.redownload', () => {
  const notePath = 'Social Archives/X/2026/04/note.md';
  const video1 = 'https://video.twimg.com/ext/v1.mp4';
  const video2 = 'https://video.twimg.com/ext/v2.mp4';

  // Detached body: remote references to the source URLs.
  const detachedBody = [
    '---',
    '---',
    '',
    'User-authored body text.',
    '',
    `[Media (detached)](${video1})`,
    '',
    `[Media (detached)](${video2})`,
  ].join('\n');

  function setup(extraFm: Record<string, unknown> = {}) {
    const ctx = makeContext();
    const file = installFile(ctx.fs, notePath, detachedBody, {
      mediaSourceUrls: [video1, video2],
      mediaDetached: true,
      downloadedUrls: [`declined:${video1}`, `declined:${video2}`],
      platform: 'x',
      author: 'testuser',
      ...extraFm,
    });
    return { ctx, file };
  }

  it('skips guard when settings / guard / threshold not configured (fail-open)', async () => {
    const { ctx, file } = setup();
    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    const result = await service.redownload(file);
    expect(result.downloadedCount).toBe(2);
    expect(ctx.redownloadSpy).toHaveBeenCalledTimes(2);
  });

  it("aborts when guard prompt returns 'detach'", async () => {
    const { ctx, file } = setup();
    ctx.inspectSpy.mockResolvedValueOnce({
      oversizedVideoUrls: [video1],
      estimatedBytesByUrl: new Map([[video1, 500 * 1024 * 1024]]),
    });
    ctx.promptSpy.mockResolvedValueOnce({ action: 'detach', suppressPromptForArchive: false });

    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      largeMediaGuard: ctx.guard,
      settings: makeSettings(),
      logger: makeLogger(),
    });
    const result = await service.redownload(file);
    expect(result).toEqual({ downloadedCount: 0, failedCount: 0 });
    expect(ctx.redownloadSpy).not.toHaveBeenCalled();
    const fm = ctx.fs.fileCache.get(notePath)?.frontmatter ?? {};
    expect(fm.mediaDetached).toBe(true); // still detached
  });

  it("proceeds when guard prompt returns 'download'", async () => {
    const { ctx, file } = setup();
    ctx.inspectSpy.mockResolvedValueOnce({
      oversizedVideoUrls: [video1],
      estimatedBytesByUrl: new Map([[video1, 500 * 1024 * 1024]]),
    });
    ctx.promptSpy.mockResolvedValueOnce({ action: 'download', suppressPromptForArchive: false });

    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      largeMediaGuard: ctx.guard,
      settings: makeSettings(),
      logger: makeLogger(),
    });
    const result = await service.redownload(file);
    expect(result.downloadedCount).toBe(2);
    expect(ctx.redownloadSpy).toHaveBeenCalledTimes(2);
  });

  it('swaps declined: markers back to downloaded: and clears mediaDetached', async () => {
    const { ctx, file } = setup();
    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    await service.redownload(file);

    const fm = ctx.fs.fileCache.get(notePath)?.frontmatter ?? {};
    // All URLs restored → mediaDetached flipped to false (not removed) per impl.
    expect(fm.mediaDetached).toBe(false);
    const urls = (fm.downloadedUrls as string[]) ?? [];
    expect(urls).toEqual(
      expect.arrayContaining([`downloaded:${video1}`, `downloaded:${video2}`])
    );
    expect(urls.some((u) => u === `declined:${video1}`)).toBe(false);
    expect(urls.some((u) => u === `declined:${video2}`)).toBe(false);
  });

  it('rewrites remote references back to local embeds for successful downloads', async () => {
    const { ctx, file } = setup();
    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    await service.redownload(file);

    const body = ctx.fs.fileContent.get(notePath) ?? '';
    // Remote [Media (detached)](url) is swapped to ![...](localPath)
    expect(body).not.toContain(`[Media (detached)](${video1})`);
    expect(body).not.toContain(`[Media (detached)](${video2})`);
    expect(body).toMatch(/!\[Media \(detached\)\]\([^)]+v1[^)]+\)/);
    expect(body).toMatch(/!\[Media \(detached\)\]\([^)]+v2[^)]+\)/);
  });

  it('respects suppressPromptForArchive by persisting mediaPromptSuppressed', async () => {
    const { ctx, file } = setup();
    ctx.inspectSpy.mockResolvedValueOnce({
      oversizedVideoUrls: [video1],
      estimatedBytesByUrl: new Map([[video1, 500 * 1024 * 1024]]),
    });
    ctx.promptSpy.mockResolvedValueOnce({ action: 'download', suppressPromptForArchive: true });

    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      largeMediaGuard: ctx.guard,
      settings: makeSettings(),
      logger: makeLogger(),
    });
    await service.redownload(file);

    const fm = ctx.fs.fileCache.get(notePath)?.frontmatter ?? {};
    expect(fm.mediaPromptSuppressed).toBe(true);
  });

  it('fails open when guard probe throws (continues with redownload)', async () => {
    const { ctx, file } = setup();
    ctx.inspectSpy.mockRejectedValueOnce(new Error('probe boom'));

    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      largeMediaGuard: ctx.guard,
      settings: makeSettings(),
      logger: makeLogger(),
    });
    const result = await service.redownload(file);
    expect(result.downloadedCount).toBe(2);
    expect(ctx.redownloadSpy).toHaveBeenCalledTimes(2);
  });

  it('returns zero when every URL fails to download and leaves note in detached state', async () => {
    const { ctx, file } = setup();
    ctx.redownloadSpy.mockResolvedValue(null); // all fail
    const service = new DetachedMediaService({
      app: ctx.app,
      mediaHandler: ctx.mediaHandler,
      logger: makeLogger(),
    });
    const result = await service.redownload(file);
    expect(result.downloadedCount).toBe(0);
    expect(result.failedCount).toBe(2);
    const fm = ctx.fs.fileCache.get(notePath)?.frontmatter ?? {};
    expect(fm.mediaDetached).toBe(true); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Shared teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // No global state to reset — each test constructs its own context.
  // Placeholder to make the file runnable under strict hook validation.
});
