import { Notice, TFile } from 'obsidian';
import type { App } from 'obsidian';
import { PostService } from '../../services/PostService';
import type { PostData, Platform, Media } from '../../types/post';
import { TimelineView, VIEW_TYPE_TIMELINE } from '../../views/TimelineView';
import { getShareUrlForClipboard } from '../../utils/shareUrl';
import type { SocialArchiverSettings } from '../../types/settings';

// ─── Deps ────────────────────────────────────────────────────────────

export interface PostShareServiceDeps {
  app: App;
  settings: () => SocialArchiverSettings;
  manifest: { version: string };
  refreshTimelineView: () => void;
}

// ─── PostShareService ────────────────────────────────────────────────

export class PostShareService {
  private readonly deps: PostShareServiceDeps;

  constructor(deps: PostShareServiceDeps) {
    this.deps = deps;
  }

  /**
   * Post current note to the timeline (local only)
   */
  async postCurrentNote(): Promise<void> {
    const activeFile = this.deps.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active note to post');
      return;
    }

    try {
      const postService = new PostService(
        this.deps.app,
        this.deps.app.vault,
        this.deps.settings()
      );
      const result = await postService.postNote(activeFile);

      if (result.success) {
        new Notice('Posted to timeline');
        await this.refreshOpenTimelines();
      } else {
        new Notice(`Failed to post: ${result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Failed to post: ${errorMessage}`);
      console.error('[Social Archiver] Post failed:', error);
    }
  }

  /**
   * Post and share current note
   */
  async postAndShareCurrentNote(): Promise<void> {
    const activeFile = this.deps.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active note to post');
      return;
    }

    try {
      const settings = this.deps.settings();
      const postService = new PostService(
        this.deps.app,
        this.deps.app.vault,
        settings
      );
      const postResult = await postService.postNote(activeFile);

      if (!postResult.success) {
        new Notice(`Failed to post: ${postResult.error}`);
        return;
      }

      const postedFile = this.deps.app.vault.getFileByPath(postResult.copiedFilePath);
      if (!postedFile) {
        new Notice('Failed to find posted file');
        return;
      }

      const content = await this.deps.app.vault.read(postedFile);
      const cache = this.deps.app.metadataCache.getFileCache(postedFile);
      const frontmatter = cache?.frontmatter || {};

      const media = this.buildMediaFromPaths(postResult.copiedMediaPaths);

      // Detect re-share: if sourceArchiveId already exists, reuse the same identity
      const existingArchiveId = typeof frontmatter.sourceArchiveId === 'string'
        ? frontmatter.sourceArchiveId
        : undefined;
      const isReshare = !!existingArchiveId;

      const postData: PostData = {
        platform: 'post' as Platform,
        id: (typeof frontmatter.originalPath === 'string' ? frontmatter.originalPath : null) || postedFile.path,
        url: '',
        title: postedFile.basename,
        author: {
          name: settings.username || 'anonymous',
          url: '',
        },
        content: {
          text: this.extractBodyContent(content),
          hashtags: Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [],
        },
        media,
        metadata: {
          timestamp: new Date(typeof frontmatter.postedAt === 'string' || typeof frontmatter.postedAt === 'number' ? frontmatter.postedAt : Date.now()),
          likes: 0,
          comments: 0,
          shares: 0,
        },
      };

      const { ShareAPIClient } = await import('../../services/ShareAPIClient');
      const shareClient = new ShareAPIClient({
        baseURL: settings.workerUrl,
        apiKey: settings.authToken,
        vault: this.deps.app.vault,
        pluginVersion: this.deps.manifest.version,
      });

      // Build share options — for re-shares, pass sourceArchiveId as shareId
      // so the same public URL / archive identity is reused
      const shareOptions: { username?: string; tier?: typeof settings.tier; shareId?: string } = {
        username: settings.username,
        tier: settings.tier,
      };
      if (isReshare && existingArchiveId) {
        shareOptions.shareId = existingArchiveId;
      }

      const postDataWithoutMedia = { ...postData, media: [] };
      const createResponse = await shareClient.createShare({
        postData: postDataWithoutMedia,
        options: shareOptions,
      });

      let shareResponse = createResponse;
      if (media.length > 0) {
        shareResponse = await shareClient.updateShareWithMedia(
          createResponse.shareId,
          postData,
          shareOptions,
        );
      }

      // Build frontmatter updates
      const frontmatterUpdates: Record<string, unknown> = {
        share: true,
        shareUrl: shareResponse.shareUrl,
        shareMode: settings.shareMode,
      };

      // For first-time shares: import into D1 to create archive-backed identity
      // For re-shares: archive already exists, skip import
      if (!isReshare) {
        try {
          const importResult = await shareClient.importShareArchive(shareResponse.shareId);

          // Backfill stable identity fields
          frontmatterUpdates.sourceArchiveId = importResult.archiveId;
          frontmatterUpdates.clientPostId = typeof frontmatter.clientPostId === 'string'
            ? frontmatter.clientPostId
            : crypto.randomUUID();
          frontmatterUpdates.postOrigin = 'shared';
        } catch (importError) {
          // Import failure must NOT break the share flow
          // The share itself succeeded — user can still access the shared link
          // Archive import can be retried on next share or via on-demand migration
          console.warn(
            '[Social Archiver] import-share failed (share itself succeeded):',
            importError
          );
        }
      }

      await this.updatePostFrontmatter(postedFile, content, frontmatterUpdates);

      const clipboardShareUrl = getShareUrlForClipboard(
        shareResponse.shareUrl,
        settings.copyShareLinkAsReaderMode
      );
      await navigator.clipboard.writeText(clipboardShareUrl);
      new Notice('Shared! URL copied to clipboard');

      await this.refreshOpenTimelines();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Failed to share: ${errorMessage}`);
      console.error('[Social Archiver] Post and share failed:', error);
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  /**
   * Extract body content from markdown (remove frontmatter)
   */
  private extractBodyContent(content: string): string {
    const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
    return content.replace(frontmatterRegex, '').trim();
  }

  /**
   * Build Media array from copied media paths
   */
  private buildMediaFromPaths(mediaPaths: string[]): Media[] {
    const IMAGE_EXTS = new Set([
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif'
    ]);
    const VIDEO_EXTS = new Set([
      'mp4', 'mov', 'webm', 'avi', 'mkv'
    ]);

    return mediaPaths.map(path => {
      const ext = path.split('.').pop()?.toLowerCase() || '';
      let type: 'image' | 'video' | 'audio' | 'document' = 'document';

      if (IMAGE_EXTS.has(ext)) {
        type = 'image';
      } else if (VIDEO_EXTS.has(ext)) {
        type = 'video';
      }

      return {
        type,
        url: path,
      };
    });
  }

  /**
   * Update frontmatter of a posted file
   */
  private async updatePostFrontmatter(
    file: TFile,
    _content: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    await this.deps.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(updates)) {
        frontmatter[key] = value;
      }
    });
  }

  /**
   * Refresh all open timeline views
   */
  private async refreshOpenTimelines(): Promise<void> {
    const timelineLeaves = this.deps.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    for (const leaf of timelineLeaves) {
      const view = leaf.view;
      if (view instanceof TimelineView) {
        await view.refresh();
      }
    }
  }
}
