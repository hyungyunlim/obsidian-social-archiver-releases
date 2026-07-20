/**
 * LocalNoteCliService — path-based wrappers around the existing
 * post/share/tag/media/author-notes/transcribe services for the CLI.
 *
 * Why a new service instead of reusing `PostShareService` etc. directly?
 *   - The interactive services depend on `app.workspace.getActiveFile()` and
 *     show user-facing `Notice`s. CLI callers need to operate on an explicit
 *     vault path (provided by the agent) and want structured return values
 *     instead of side-effectful UI.
 *   - Keeping CLI-specific glue in one Single-Responsibility module isolates
 *     the CLI surface from changes to the interactive flows.
 *
 * Conventions:
 *   - `pathOrActive` is either an already-validated vault-relative path
 *     (validated upstream by `parseVaultPath`) or the literal string
 *     `'active'`. The handler layer is responsible for path validation;
 *     this service only re-resolves to a `TFile`.
 *   - Every method throws {@link CliValidationError} for INVALID_ARGUMENT
 *     conditions (missing file, missing service, bad action) so the
 *     handler can map directly to the standard error envelope.
 */
import { TFile, type App } from 'obsidian';
import type SocialArchiverPlugin from '../../main';
import type { TagDefinition } from '../../types/tag';
import type { PostData } from '../../types/post';
import { CliValidationError } from './CliParams';
import {
  snapshotTranscriptionStatus,
  type BatchTranscriptionStatusDto,
} from '../services/BatchTranscriptionStatusDto';

// ─── Public result DTOs ───────────────────────────────────────────────

export interface PostResultDto {
  filePath: string;
  postedAt: string;
  mediaCount: number;
}

export interface ShareResultDto {
  filePath: string;
  shareUrl: string;
  shareUrlCopied: boolean;
  expiresAt?: string;
}

export interface TagApplyResultDto {
  filePath: string;
  tag: string;
  action: 'add' | 'remove' | 'toggle';
  result: 'added' | 'removed' | 'noop';
  appliedTags: string[];
}

export interface TagsListResultDto {
  definitions: TagDefinition[];
  discovered: TagDefinition[];
  counts?: Record<string, number>;
}

export interface MediaResultDto {
  filePath: string;
  action: 'redownload-expired' | 'detach' | 'redownload-detached';
  affectedMedia: number;
}

export interface AuthorNotesResultDto {
  created: number;
  skipped: number;
  failed: number;
  paths: string[];
}

export type TranscribeAction = 'start' | 'pause' | 'resume' | 'cancel' | 'status';

export interface TranscribeResultDto {
  action: TranscribeAction;
  status: BatchTranscriptionStatusDto;
}

// ─── Service ───────────────────────────────────────────────────────────

export class LocalNoteCliService {
  constructor(private readonly plugin: SocialArchiverPlugin) {}

  // ─── post ───────────────────────────────────────────────────────────

  async post(pathOrActive: string): Promise<PostResultDto> {
    const file = this.resolveFile(pathOrActive, 'path');
    // Use PostService directly so we never depend on the active editor's
    // current file. This mirrors what the interactive PostShareService does
    // internally, but with the file injected explicitly.
    const { PostService } = await import('../../services/PostService');
    const postService = new PostService(this.plugin.app, this.plugin.app.vault, this.plugin.settings);
    const result = await postService.postNote(file);
    if (!result.success) {
      throw new Error(result.error || 'Failed to post note');
    }
    this.refreshTimelineSafely();
    return {
      filePath: result.copiedFilePath,
      postedAt: new Date().toISOString(),
      mediaCount: result.copiedMediaPaths.length,
    };
  }

  // ─── share ──────────────────────────────────────────────────────────

  async share(
    pathOrActive: string,
    opts: { reader: boolean },
  ): Promise<ShareResultDto> {
    const file = this.resolveFile(pathOrActive, 'path');
    const settings = this.plugin.settings;
    if (!settings.workerUrl || !settings.authToken) {
      throw new CliValidationError(
        'auth',
        'Share requires authentication. Configure the plugin in Settings before using `share`.',
      );
    }

    const { PostService } = await import('../../services/PostService');
    const postService = new PostService(this.plugin.app, this.plugin.app.vault, settings);
    const postResult = await postService.postNote(file);
    if (!postResult.success) {
      throw new Error(postResult.error || 'Failed to post note prior to share');
    }

    const postedFile = this.plugin.app.vault.getFileByPath(postResult.copiedFilePath);
    if (!postedFile) {
      throw new Error(`Failed to read posted file: ${postResult.copiedFilePath}`);
    }

    const content = await this.plugin.app.vault.read(postedFile);
    const cache = this.plugin.app.metadataCache.getFileCache(postedFile);
    const frontmatter: Record<string, unknown> = cache?.frontmatter || {};

    const media = this.buildMediaFromPaths(postResult.copiedMediaPaths);

    const existingArchiveId =
      typeof frontmatter.sourceArchiveId === 'string' ? frontmatter.sourceArchiveId : undefined;
    const isReshare = !!existingArchiveId;

    const { ShareAPIClient } = await import('../../services/ShareAPIClient');
    const shareClient = new ShareAPIClient({
      baseURL: settings.workerUrl,
      apiKey: settings.authToken,
      vault: this.plugin.app.vault,
      pluginVersion: this.plugin.manifest.version,
    });

    const shareOptions: {
      username?: string;
      tier?: typeof settings.tier;
      shareId?: string;
      sourceArchiveId?: string;
    } = {
      username: settings.username,
      tier: settings.tier,
    };
    if (isReshare && existingArchiveId) {
      shareOptions.shareId = existingArchiveId;
      shareOptions.sourceArchiveId = existingArchiveId;
    }

    const postData: PostData = {
      platform: 'post',
      id:
        (typeof frontmatter.originalPath === 'string' ? frontmatter.originalPath : null) ||
        postedFile.path,
      url: '',
      title: postedFile.basename,
      author: { name: settings.username || 'anonymous', url: '' },
      content: {
        text: this.extractBodyContent(content),
        hashtags: Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [],
      },
      media,
      metadata: {
        timestamp: new Date(
          typeof frontmatter.postedAt === 'string' || typeof frontmatter.postedAt === 'number'
            ? frontmatter.postedAt
            : Date.now(),
        ),
        likes: 0,
        comments: 0,
        shares: 0,
      },
    };

    // Todo 17 (PRD AD-3): first shares declare a durable post-import linkage
    // intent so create/media/import replay stable identities across retries
    // and restarts. Re-shares are archive-backed and skip the linkage flow.
    const createRequest = {
      postData: { ...postData, media: [] },
      options: shareOptions,
    };
    const createResponse = !isReshare && settings.username
      ? await shareClient.createShare(createRequest, {
          intentKey: `${settings.username}:${postData.id}`,
        })
      : await shareClient.createShare(createRequest);

    let shareResponse = createResponse;
    if (media.length > 0) {
      shareResponse = await shareClient.updateShareWithMedia(
        createResponse.shareId,
        postData,
        shareOptions,
      );
    }

    // Persist share URL + identity onto the posted note frontmatter so
    // subsequent operations (sync, library) see the same identity that the
    // interactive flow would produce.
    const fmUpdates: Record<string, unknown> = {
      share: true,
      shareUrl: shareResponse.shareUrl,
      shareMode: settings.shareMode,
    };
    if (!isReshare) {
      try {
        const importResult = await shareClient.importShareArchive(shareResponse.shareId);
        fmUpdates.sourceArchiveId = importResult.archiveId;
        fmUpdates.clientPostId =
          typeof frontmatter.clientPostId === 'string'
            ? frontmatter.clientPostId
            : crypto.randomUUID();
        fmUpdates.postOrigin = 'shared';
      } catch (importError) {
        // Fail-open: share itself succeeded; import retried later. Mirror
        // the warning telemetry shape used by PostShareService.
        console.warn(
          '[Social Archiver][M3] CLI import-share failed (share itself succeeded, orphan candidate):',
          {
            shareId: shareResponse.shareId,
            shareUrl: shareResponse.shareUrl,
            error: importError instanceof Error ? importError.message : String(importError),
            orphanSource: 'cli-import-share-failure',
          },
          importError,
        );
      }
    }
    await this.plugin.app.fileManager.processFrontMatter(postedFile, (fm: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(fmUpdates)) fm[k] = v;
    });

    // Clipboard copy is best-effort — desktop has navigator.clipboard, but
    // headless CLI invocations may not. We report whether the copy succeeded.
    let shareUrlCopied = false;
    try {
      const { getShareUrlForClipboard } = await import('../../utils/shareUrl');
      const clipboardUrl = getShareUrlForClipboard(shareResponse.shareUrl, opts.reader);
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clipboardUrl);
        shareUrlCopied = true;
      }
    } catch {
      // Clipboard failure is non-fatal for the CLI surface.
    }

    this.refreshTimelineSafely();

    // Compose response. The reader-mode URL is returned in `shareUrl` when
    // the caller asked for it, otherwise the canonical URL is returned.
    const responseUrl = opts.reader
      ? await this.toReaderUrl(shareResponse.shareUrl)
      : shareResponse.shareUrl;

    return {
      filePath: postedFile.path,
      shareUrl: responseUrl,
      shareUrlCopied,
    };
  }

  // ─── tagApply ───────────────────────────────────────────────────────

  async tagApply(
    pathOrActive: string,
    tag: string,
    action: 'add' | 'remove' | 'toggle',
  ): Promise<TagApplyResultDto> {
    const file = this.resolveFile(pathOrActive, 'path');
    const tagStore = this.plugin.tagStore;
    if (!tagStore) {
      throw new CliValidationError('tag', 'Tag store is not initialized.');
    }

    let result: 'added' | 'removed' | 'noop' = 'noop';
    const before = tagStore.getDisplayTagsForPost(file.path);
    const hasBefore = before.some((t) => t.toLowerCase() === tag.toLowerCase());

    if (action === 'add') {
      if (!hasBefore) {
        await tagStore.addArchiveTagToPost(file.path, tag);
        result = 'added';
      }
    } else if (action === 'remove') {
      if (hasBefore) {
        await tagStore.removeDisplayTagFromPost(file.path, tag);
        result = 'removed';
      }
    } else {
      const added = await tagStore.toggleDisplayTagOnPost(file.path, tag);
      result = added ? 'added' : 'removed';
    }

    const after = tagStore.getDisplayTagsForPost(file.path);
    return {
      filePath: file.path,
      tag,
      action,
      result,
      appliedTags: after,
    };
  }

  // ─── tagsList ───────────────────────────────────────────────────────

  tagsList(opts: { counts: boolean }): TagsListResultDto {
    const tagStore = this.plugin.tagStore;
    if (!tagStore) {
      throw new CliValidationError('tags', 'Tag store is not initialized.');
    }
    const definitions = tagStore.getTagDefinitions();
    const all = tagStore.getAllDiscoveredTags();
    const definedIds = new Set(definitions.map((d) => d.id));
    const discovered = all.filter((t) => !definedIds.has(t.id));

    const out: TagsListResultDto = { definitions, discovered };
    if (opts.counts) {
      const withCounts = tagStore.getTagsWithCounts();
      const counts: Record<string, number> = {};
      for (const t of withCounts) counts[t.name] = t.archiveCount;
      out.counts = counts;
    }
    return out;
  }

  // ─── tagCreate ──────────────────────────────────────────────────────

  async tagCreate(name: string, color?: string): Promise<TagDefinition> {
    const tagStore = this.plugin.tagStore;
    if (!tagStore) {
      throw new CliValidationError('tag', 'Tag store is not initialized.');
    }
    return await tagStore.createTag(name, color ?? null);
  }

  // ─── media ──────────────────────────────────────────────────────────

  async media(
    pathOrActive: string,
    action: 'redownload-expired' | 'detach' | 'redownload-detached',
  ): Promise<MediaResultDto> {
    const file = this.resolveFile(pathOrActive, 'path');

    if (action === 'detach') {
      const svc = this.plugin.detachedMediaService;
      if (!svc) {
        throw new CliValidationError('media', 'Detached media service not initialized.');
      }
      const res = await svc.detach(file);
      return {
        filePath: file.path,
        action,
        affectedMedia: res.deletedCount,
      };
    }

    if (action === 'redownload-detached') {
      const svc = this.plugin.detachedMediaService;
      if (!svc) {
        throw new CliValidationError('media', 'Detached media service not initialized.');
      }
      const res = await svc.redownload(file);
      return {
        filePath: file.path,
        action,
        affectedMedia: res.downloadedCount,
      };
    }

    // 'redownload-expired'
    const affected = await this.redownloadExpiredOnFile(file);
    return {
      filePath: file.path,
      action,
      affectedMedia: affected,
    };
  }

  // ─── authorNotes ────────────────────────────────────────────────────

  async authorNotes(opts: { dryRun: boolean; limit?: number }): Promise<AuthorNotesResultDto> {
    const noteService = this.plugin.getAuthorNoteService();
    const settings = this.plugin.settings;
    if (!noteService || !settings.enableAuthorNotes) {
      throw new CliValidationError(
        'authorNotes',
        'Author Notes feature is not enabled. Enable it in Settings → Author Notes.',
      );
    }

    const { AuthorVaultScanner } = await import('../../services/AuthorVaultScanner');
    const { AuthorDeduplicator } = await import('../../services/AuthorDeduplicator');

    const scanner = new AuthorVaultScanner({
      app: this.plugin.app,
      archivePath: settings.archivePath,
      includeEmbeddedArchives: true,
    });
    const scanResult = await scanner.scanVault();
    const deduplicator = new AuthorDeduplicator();
    const dedupeResult = deduplicator.deduplicate(scanResult.authors, new Map());

    let authors = dedupeResult.authors;
    if (typeof opts.limit === 'number' && opts.limit >= 0) {
      authors = authors.slice(0, opts.limit);
    }

    if (opts.dryRun) {
      return {
        created: 0,
        skipped: 0,
        failed: 0,
        paths: authors.map((a) => `${a.platform}:${a.authorName}`),
      };
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const paths: string[] = [];
    for (const author of authors) {
      try {
        const tfile = await noteService.upsertFromCatalogEntry(author);
        if (tfile) {
          created++;
          paths.push(tfile.path);
        } else {
          skipped++;
        }
      } catch (err) {
        failed++;
        console.warn('[LocalNoteCliService] author note upsert failed', err);
      }
    }

    return { created, skipped, failed, paths };
  }

  // ─── transcribe ─────────────────────────────────────────────────────

  async transcribe(opts: {
    mode?: 'transcribe-only' | 'download-and-transcribe';
    action: TranscribeAction;
  }): Promise<TranscribeResultDto> {
    const manager = this.plugin.batchTranscriptionManager;
    if (!manager) {
      throw new CliValidationError(
        'transcribe',
        'Batch transcription manager is not available (desktop only).',
      );
    }

    const currentStatus = manager.getStatus();

    switch (opts.action) {
      case 'status': {
        return { action: 'status', status: snapshotTranscriptionStatus(manager) };
      }
      case 'start': {
        if (!opts.mode) {
          throw new CliValidationError(
            'mode',
            "'start' requires mode=transcribe-only|download-and-transcribe.",
          );
        }
        if (currentStatus === 'running' || currentStatus === 'scanning') {
          throw new CliValidationError(
            'action',
            `Cannot start: batch is already ${currentStatus}.`,
          );
        }
        // Fire-and-forget — start() runs the whole process loop and we'd
        // otherwise block the CLI for minutes. Errors surface via subsequent
        // status calls.
        void manager.start(opts.mode).catch((err) => {
          console.error('[LocalNoteCliService] batch transcribe start failed:', err);
        });
        return { action: 'start', status: snapshotTranscriptionStatus(manager) };
      }
      case 'pause': {
        if (currentStatus !== 'running' && currentStatus !== 'scanning') {
          throw new CliValidationError(
            'action',
            `Cannot pause: batch is ${currentStatus} (expected running or scanning).`,
          );
        }
        manager.pause();
        return { action: 'pause', status: snapshotTranscriptionStatus(manager) };
      }
      case 'resume': {
        if (currentStatus !== 'paused') {
          throw new CliValidationError(
            'action',
            `Cannot resume: batch is ${currentStatus} (expected paused).`,
          );
        }
        void manager.resume().catch((err) => {
          console.error('[LocalNoteCliService] batch transcribe resume failed:', err);
        });
        return { action: 'resume', status: snapshotTranscriptionStatus(manager) };
      }
      case 'cancel': {
        if (currentStatus === 'idle' || currentStatus === 'completed' || currentStatus === 'cancelled') {
          throw new CliValidationError(
            'action',
            `Cannot cancel: batch is ${currentStatus}.`,
          );
        }
        manager.cancel();
        return { action: 'cancel', status: snapshotTranscriptionStatus(manager) };
      }
      default: {
        // The enum is closed at compile time; runtime guard for safety.
        throw new CliValidationError(
          'action',
          `Unknown transcribe action: ${String(opts.action)}.`,
        );
      }
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────

  /**
   * Resolve a vault path or the literal 'active' string to a `TFile`.
   *
   * The caller (handler) must have already validated the path against
   * traversal via {@link parseVaultPath}; this method only verifies that
   * the path resolves to an existing markdown file.
   */
  private resolveFile(pathOrActive: string, field: string): TFile {
    const app: App = this.plugin.app;
    if (pathOrActive === 'active') {
      const active = app.workspace.getActiveFile();
      if (!active) {
        throw new CliValidationError(field, 'No active note in the current workspace.');
      }
      return active;
    }
    const abstract = app.vault.getAbstractFileByPath(pathOrActive);
    if (!abstract) {
      throw new CliValidationError(field, `Vault path '${pathOrActive}' does not exist.`);
    }
    if (!(abstract instanceof TFile)) {
      throw new CliValidationError(field, `Vault path '${pathOrActive}' is not a file.`);
    }
    return abstract;
  }

  private refreshTimelineSafely(): void {
    try {
      const fn = (this.plugin as unknown as { refreshTimelineView?: () => void }).refreshTimelineView;
      if (typeof fn === 'function') fn.call(this.plugin);
    } catch {
      // best-effort; timeline refresh failures should not bubble up the CLI.
    }
  }

  private buildMediaFromPaths(
    paths: string[],
  ): Array<{ type: 'image' | 'video' | 'audio' | 'document'; url: string }> {
    const IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif']);
    const VIDEO = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv']);
    return paths.map((p) => {
      const ext = p.split('.').pop()?.toLowerCase() || '';
      let type: 'image' | 'video' | 'audio' | 'document' = 'document';
      if (IMAGE.has(ext)) type = 'image';
      else if (VIDEO.has(ext)) type = 'video';
      return { type, url: p };
    });
  }

  private extractBodyContent(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  }

  private async toReaderUrl(url: string): Promise<string> {
    const { toReaderModeShareUrl } = await import('../../utils/shareUrl');
    return toReaderModeShareUrl(url);
  }

  /**
   * Re-download expired media within a specific file. Mirrors the logic
   * in `main.ts#redownloadExpiredMedia` but operates on the file passed
   * in (instead of `app.workspace.getActiveFile`). Returns the number of
   * placeholders recovered.
   */
  private async redownloadExpiredOnFile(file: TFile): Promise<number> {
    const { MediaPlaceholderGenerator } = await import('../../services/MediaPlaceholderGenerator');
    let content = await this.plugin.app.vault.read(file);
    const placeholders = MediaPlaceholderGenerator.findAllPlaceholders(content);
    if (placeholders.length === 0) return 0;

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter || {};
    const platformRaw = typeof fm.platform === 'string' ? fm.platform : 'unknown';
    const authorHandle = (typeof fm.authorHandle === 'string' ? fm.authorHandle : 'unknown').replace(/^@/, '');
    const postId = file.basename.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60) || 'unknown';

    const { MediaHandler } = await import('../../services/MediaHandler');
    // `workersApiClient` throws when settings aren't configured. The expired
    // media re-download flow can work without it (direct fetch), so we tolerate
    // a missing client by leaving `workersClient` undefined.
    let workersClient: import('../../services/WorkersAPIClient').WorkersAPIClient | undefined;
    try {
      workersClient = this.plugin.workersApiClient;
    } catch {
      workersClient = undefined;
    }
    const mediaHandler = new MediaHandler({
      vault: this.plugin.app.vault,
      app: this.plugin.app,
      ...(workersClient ? { workersClient } : {}),
      basePath: this.plugin.settings.mediaPath || 'attachments/social-archives',
      optimizeImages: true,
      imageQuality: 0.8,
      maxImageDimension: 2048,
    });

    let recovered = 0;
    for (let i = 0; i < placeholders.length; i++) {
      const ph = placeholders[i];
      if (!ph) continue;
      const localPath = await mediaHandler.redownloadExpiredMedia(
        ph.result,
        platformRaw as import('../../types/post').Platform,
        postId,
        authorHandle,
        i,
      );
      if (localPath) {
        content = MediaPlaceholderGenerator.replacePlaceholderWithEmbed(content, ph.blockText, localPath);
        recovered++;
      }
    }
    if (recovered > 0) await this.plugin.app.vault.modify(file, content);
    return recovered;
  }
}
