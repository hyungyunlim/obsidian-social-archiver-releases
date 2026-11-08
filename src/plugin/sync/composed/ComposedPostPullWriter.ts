/**
 * Writes the server version of a composed post into its note, and stamps the
 * two-way sync baseline (prd-plugin-my-posts-two-way-sync §5.1, §5.3).
 *
 * Only the post part is rewritten (title, body, gallery, author line);
 * frontmatter user fields and plugin-owned sections stay. The baseline is
 * always fingerprinted from the note as written afterwards, so the watcher
 * reads a pulled note as unchanged and never pushes it back.
 *
 * Takes no locks: callers hold `archiveMaterialization` + `markdownWrite`
 * (LocalLockRegistry is not re-entrant).
 */

import type { App, TFile } from 'obsidian';
import type { UserArchive, WorkersAPIClient } from '../../../services/WorkersAPIClient';
import type { SocialArchiverSettings } from '../../../types/settings';
import type { Media, PostData } from '../../../types/post';
import { MediaHandler } from '../../../services/MediaHandler';
import { VaultStorageService } from '../../../services/VaultStorageService';
import { PostDataParser } from '../../../components/timeline/parsers/PostDataParser';
import { composedFingerprint, readComposedNote, readNoteFrontmatter, readSyncedMedia, sha256Hex } from './composedNote';

const LOG_PREFIX = '[Social Archiver] [ComposedPostPull]';

export type DownloadedComposedMedia = ReadonlyArray<{ url: string; localPath: string }>;

export interface ComposedPostPullWriterDeps {
  app: App;
  settings: () => SocialArchiverSettings;
  apiClient: () => WorkersAPIClient | undefined;
  /** convertUserArchiveToPostData: verbatim body plus ref lines. */
  convert: (a: UserArchive) => PostData;
  /** Test seam; defaults to MediaHandler. */
  createMediaHandler?: () => Pick<MediaHandler, 'downloadMedia'>;
}

/** The upload index in a composed post's attachment URL (`…/media/archives/{user}/{post}/{n}.{ext}`). */
export function r2IndexFromUrl(url: string): number | null {
  const match = /\/media\/archives\/[^/]+\/[^/]+\/(\d+)\.[a-z0-9]+(?:[?#].*)?$/i.exec(url);
  return match ? Number(match[1]) : null;
}

/** Above any array position a Tier-3 save uses (attachments are 0..24). */
const PULL_INDEX_OFFSET = 100;

/** The MediaHandler start index a pull downloads `url` under. */
export function pullFileIndex(url: string, position: number): number {
  const r2Index = r2IndexFromUrl(url);
  return r2Index === null ? 1000 + position : PULL_INDEX_OFFSET + r2Index;
}

export class ComposedPostPullWriter {
  constructor(private readonly deps: ComposedPostPullWriterDeps) {}

  /** §5.3: rewrite title/body/gallery/author line from the server, then stamp the baseline. */
  async write(file: TFile, archive: UserArchive): Promise<void> {
    const { app } = this.deps;
    const raw = await app.vault.read(file);

    // Files already in the vault, by content: kept, never downloaded again.
    const localBySha = new Map<string, string>();
    for (const attachment of readComposedNote(raw).attachments) {
      if (attachment.remote) continue;
      const local = app.metadataCache.getFirstLinkpathDest(attachment.target, file.path)
        ?? app.vault.getFileByPath(attachment.target);
      if (local) localBySha.set(await sha256Hex(await app.vault.readBinary(local)), local.path);
    }
    const fm: Record<string, unknown> | undefined = readNoteFrontmatter(raw) ?? app.metadataCache.getFileCache(file)?.frontmatter;
    const shaByUrl = new Map([...readSyncedMedia(fm)].map(([sha, url]) => [url, sha]));

    const postData = this.deps.convert(archive);
    const media: Media[] = [];
    const syncedMedia: string[] = [];
    let handler: Pick<MediaHandler, 'downloadMedia'> | null = null;
    for (const [i, item] of (archive.media ?? []).entries()) {
      const type = item.type === 'video' ? 'video' : 'image';
      const knownSha = shaByUrl.get(item.url);
      const reused = knownSha ? localBySha.get(knownSha) : undefined;
      if (knownSha && reused) {
        media.push({ type, url: reused });
        syncedMedia.push(`${knownSha}:${item.url}`);
        continue;
      }
      if (this.mayDownload(type)) handler ??= this.mediaHandler();
      const localPath = handler && this.mayDownload(type) ? await this.download(handler, item.url, type, archive, postData, i) : null;
      const downloaded = localPath ? app.vault.getFileByPath(localPath) : null;
      if (localPath && downloaded) {
        const sha = await sha256Hex(await app.vault.readBinary(downloaded));
        media.push({ type, url: localPath });
        syncedMedia.push(`${sha}:${item.url}`);
        // The server dedupes identical bytes, so one URL can appear twice in a post.
        shaByUrl.set(item.url, sha);
        localBySha.set(sha, localPath);
      } else {
        // Stays remote in the gallery; push passes this user's R2 URLs through.
        media.push({ type, url: item.url });
      }
    }

    postData.media = media;
    // F8: the note's own "Referenced Social Media Posts" section stays vault-only.
    const embedded = (await new PostDataParser(app.vault, app).parseFile(file))?.embeddedArchives;
    postData.embeddedArchives = embedded && embedded.length > 0 ? embedded : undefined;
    const previews = Array.isArray(fm?.['linkPreviews']) ? (fm['linkPreviews'] as unknown[]) : [];
    postData.linkPreviews = previews.filter((url): url is string => typeof url === 'string' && postData.content.text.includes(url));

    // Missing files are never deleted (§5.3): no deletedMediaPaths.
    await new VaultStorageService({ app, vault: app.vault, settings: this.deps.settings() }).updatePost({
      filePath: file.path,
      postData,
      existingMedia: media,
      mediaFiles: [],
      deletedMediaPaths: [],
      replaceBody: true,
    });
    await this.stamp(file, archive, syncedMedia);
  }

  /**
   * Baseline only (adopt, fresh Tier-3/WS save): identity, revision, the note's
   * fingerprint as written, coAuthors, and syncedMedia from `downloaded` when
   * given (else kept). One processFrontMatter.
   */
  async stampBaseline(file: TFile, archive: UserArchive, downloaded?: DownloadedComposedMedia): Promise<void> {
    let syncedMedia: string[] | undefined;
    if (downloaded) {
      syncedMedia = [];
      for (const { url, localPath } of downloaded) {
        const local = this.deps.app.vault.getFileByPath(localPath);
        if (local) syncedMedia.push(`${await sha256Hex(await this.deps.app.vault.readBinary(local))}:${url}`);
      }
    }
    await this.stamp(file, archive, syncedMedia);
  }

  private async stamp(file: TFile, archive: UserArchive, syncedMedia?: string[]): Promise<void> {
    const { app } = this.deps;
    const syncedContentHash = composedFingerprint(readComposedNote(await app.vault.read(file)));
    const coAuthors = (archive.postAuthors ?? []).slice(1).map((author) => author.name.trim()).filter(Boolean);
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm['postOrigin'] = 'composer';
      fm['clientPostId'] = archive.postId;
      fm['sourceArchiveId'] = archive.id;
      fm['syncState'] = 'synced';
      fm['syncedContentRevision'] = archive.contentRevision ?? 0;
      fm['syncedContentHash'] = syncedContentHash;
      if (coAuthors.length > 0) fm['coAuthors'] = coAuthors;
      else delete fm['coAuthors'];
      if (syncedMedia) fm['syncedMedia'] = syncedMedia;
      delete fm['syncedMediaNext'];
    });
  }

  /** The media download setting, as Tier 3 applies it: text-only keeps every item remote. */
  private mayDownload(type: 'image' | 'video'): boolean {
    const mode = this.deps.settings().downloadMedia;
    if (mode === 'text-only') return false;
    return type === 'image' || mode !== 'images-only';
  }

  private mediaHandler(): Pick<MediaHandler, 'downloadMedia'> | null {
    if (this.deps.createMediaHandler) return this.deps.createMediaHandler();
    const workersClient = this.deps.apiClient();
    if (!workersClient) return null;
    return new MediaHandler({
      vault: this.deps.app.vault,
      app: this.deps.app,
      workersClient,
      basePath: this.deps.settings().mediaPath || 'attachments/social-archives',
      optimizeImages: true,
      imageQuality: 0.8,
      maxImageDimension: 2048,
    });
  }

  /**
   * One item per call, numbered by its R2 index (F13): never collides with
   * another item's file. MediaHandler reuses whatever file already sits at the
   * generated name, and a Tier-3 save named its files by array position, so a
   * pull names files PULL_INDEX_OFFSET + R2 index: an R2 index never names
   * other bytes, an array position does once photos are reordered or removed.
   */
  private async download(
    handler: Pick<MediaHandler, 'downloadMedia'>,
    url: string,
    type: 'image' | 'video',
    archive: UserArchive,
    postData: PostData,
    position: number,
  ): Promise<string | null> {
    try {
      const [result] = await handler.downloadMedia(
        [{ type, url }],
        'post',
        archive.postId,
        postData.author.handle || postData.author.name || 'unknown',
        undefined,
        pullFileIndex(url, position),
      );
      // A video that only got its thumbnail would push back as a new image.
      return result && result.fallbackKind !== 'thumbnail' ? result.localPath : null;
    } catch (error) {
      console.warn(`${LOG_PREFIX} Download failed, keeping the remote URL: ${url}`, error);
      return null;
    }
  }
}
