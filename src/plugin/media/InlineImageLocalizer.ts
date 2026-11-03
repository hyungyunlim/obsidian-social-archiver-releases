/**
 * InlineImageLocalizer
 *
 * Makes a web article note's body images local (inline image preservation
 * PRD §6.3). The server preserves body images to R2 and reports them in
 * `UserArchive.inlineMediaPreserved`, keyed by the URL text exactly as stored
 * in `fullContent`. This downloads each R2 copy into the note's media folder
 * and points the matching image target at the vault file.
 *
 * Links are written as `![alt](encoded path)`, never `![[...]]`:
 * `SubscriptionSyncService.countRenderedMediaItems` counts only `![..](..)`,
 * so a wikilink embed would make `hasRicherMediaReplacement` rewrite the note
 * on every sync.
 *
 * Idempotent and fail-soft: once localized, no record key is left in the body,
 * so a re-run reads the note and returns without a write. Callers own the
 * archive's markdown write lock.
 *
 * Single Responsibility: localize a note's preserved body images.
 */

import { requestUrl, TFile, type App } from 'obsidian';
import type { InlinePreservedImage, UserArchive } from '../../services/WorkersAPIClient';
import type { SocialArchiverSettings } from '../../types/settings';
import { MediaPathGenerator } from '../../services/MediaHandler';
import { convertUserArchiveToPostData } from '../mobile/UserArchiveConverter';
import { isWebLanePlatform } from '@/shared/platforms';
import { encodePathForMarkdownLink } from '../../utils/url';
import { ensureFolderExists } from '../utils/ensureFolderExists';

/** Same scan as the server extractor: `![alt](url "title")`, `![alt](<url>)`. */
const MARKDOWN_IMAGE_PATTERN = /(!\[[^\]]*\]\(\s*)(<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?\s*\))/g;
const HTML_IMG_TAG_PATTERN = /<img\b[^>]*>/gi;
const HTML_SRC_ATTR_PATTERN = /(\bsrc\s*=\s*)(["'])([^"']+)\2/gi;
/** Server-generated R2 file name (`inline/i-{16hex}.{ext}`); anything else is not trusted as a path. */
const INLINE_FILENAME_PATTERN = /^i-[0-9a-f]{16}\.[a-z0-9]{2,5}$/i;

export interface InlineImageLocalizerDeps {
  app: App;
  settings: () => SocialArchiverSettings;
}

/**
 * Replace every markdown image destination (title kept) and `<img src>` value
 * for which `resolve` returns a replacement. Everything else stays byte-for-byte.
 */
export function rewriteImageTargets(
  text: string,
  resolve: (target: string) => string | undefined,
): string {
  const withMarkdown = text.replace(
    MARKDOWN_IMAGE_PATTERN,
    (match, prefix: string, target: string, suffix: string) => {
      const bracketed = target.startsWith('<');
      const replacement = resolve(bracketed ? target.slice(1, -1) : target);
      if (replacement === undefined) return match;
      return `${prefix}${bracketed ? `<${replacement}>` : replacement}${suffix}`;
    },
  );

  return withMarkdown.replace(HTML_IMG_TAG_PATTERN, (tag) =>
    tag.replace(HTML_SRC_ATTR_PATTERN, (attr, prefix: string, quote: string, value: string) => {
      const replacement = resolve(value);
      return replacement === undefined ? attr : `${prefix}${quote}${replacement}${quote}`;
    }),
  );
}

/** Record key and its `&amp;`-decoded form → record (PRD §5). */
function buildRecordMap(records: readonly InlinePreservedImage[]): Map<string, InlinePreservedImage> {
  const map = new Map<string, InlinePreservedImage>();
  for (const record of records) {
    if (typeof record?.originalUrl !== 'string' || !record.originalUrl) continue;
    if (typeof record.r2Url !== 'string' || !/^https?:\/\//i.test(record.r2Url)) continue;
    if (!INLINE_FILENAME_PATTERN.test(inlineFilename(record))) continue;
    map.set(record.originalUrl, record);
    map.set(record.originalUrl.replaceAll('&amp;', '&'), record);
  }
  return map;
}

function inlineFilename(record: InlinePreservedImage): string {
  return typeof record.r2Key === 'string' ? (record.r2Key.split('/').pop() ?? '') : '';
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? (headers[key] ?? '') : '';
}

export class InlineImageLocalizer {
  constructor(private readonly deps: InlineImageLocalizerDeps) {}

  /**
   * Localize the note's preserved body images. Resolves `true` when the note
   * was rewritten, `false` when there was nothing to do (or anything failed).
   * Never throws.
   */
  async reconcile(file: TFile, archive: UserArchive): Promise<boolean> {
    try {
      return await this.reconcileUnsafe(file, archive);
    } catch (error) {
      console.warn('[Social Archiver] [InlineImages] reconcile failed', {
        archiveId: archive.id,
        path: file.path,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async reconcileUnsafe(file: TFile, archive: UserArchive): Promise<boolean> {
    const settings = this.deps.settings();
    if (settings.downloadMedia === 'text-only') return false;
    if (!isWebLanePlatform(archive.platform)) return false;
    if (!archive.inlineMediaPreserved?.length) return false;

    const records = buildRecordMap(archive.inlineMediaPreserved);
    if (records.size === 0) return false;

    const { vault } = this.deps.app;
    const pending = this.findPendingRecords(await vault.cachedRead(file), records);
    if (pending.length === 0) return false;

    // The hero's own folder: library sync saves through
    // SubscriptionSyncService, which downloads hero media with
    // `MediaPathGenerator(mediaPath).generatePath(post.platform, post.id, …)`
    // on this same converted post.
    const post = convertUserArchiveToPostData(archive);
    const pathGenerator = new MediaPathGenerator(settings.mediaPath || 'attachments/social-archives');
    const localLinkByR2Key = new Map<string, string>();
    for (const record of pending) {
      const localPath = pathGenerator.generatePath(post.platform, post.id, inlineFilename(record));
      if (await this.ensureLocalCopy(record, localPath)) {
        localLinkByR2Key.set(record.r2Key, encodePathForMarkdownLink(localPath));
      }
    }
    if (localLinkByR2Key.size === 0) return false;

    let changed = false;
    await vault.process(file, (content) => {
      const next = rewriteImageTargets(content, (target) => {
        const record = records.get(target);
        return record ? localLinkByR2Key.get(record.r2Key) : undefined;
      });
      changed = next !== content;
      return next;
    });
    return changed;
  }

  /** Distinct records whose key still occurs as an image target in the note. */
  private findPendingRecords(
    content: string,
    records: ReadonlyMap<string, InlinePreservedImage>,
  ): InlinePreservedImage[] {
    const pending = new Map<string, InlinePreservedImage>();
    // A resolver that never replaces turns the rewrite into a scan over the
    // exact same targets the write pass will touch.
    rewriteImageTargets(content, (target) => {
      const record = records.get(target);
      if (record) pending.set(record.r2Key, record);
      return undefined;
    });
    return [...pending.values()];
  }

  /** Reuse the file when present; otherwise download the R2 copy. */
  private async ensureLocalCopy(record: InlinePreservedImage, localPath: string): Promise<boolean> {
    const { vault } = this.deps.app;
    if (vault.getAbstractFileByPath(localPath) instanceof TFile) return true;

    const data = await this.download(record.r2Url);
    if (!data) return false;

    const folder = localPath.slice(0, localPath.lastIndexOf('/'));
    try {
      await ensureFolderExists(this.deps.app, folder);
      await vault.createBinary(localPath, data);
      return true;
    } catch (error) {
      // A concurrent writer (or an unindexed file on disk) got there first.
      if (await vault.adapter.exists(localPath)) return true;
      console.warn('[Social Archiver] [InlineImages] write failed', {
        path: localPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async download(url: string): Promise<ArrayBuffer | null> {
    try {
      const response = await requestUrl({ url, method: 'GET', throw: false });
      const contentType = headerValue(response.headers, 'content-type').toLowerCase();
      if (response.status < 200 || response.status >= 300 || !contentType.startsWith('image/')) {
        console.warn('[Social Archiver] [InlineImages] download rejected', {
          url,
          status: response.status,
          contentType,
        });
        return null;
      }
      const data = response.arrayBuffer;
      return data && data.byteLength > 0 ? data : null;
    } catch (error) {
      console.warn('[Social Archiver] [InlineImages] download failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
