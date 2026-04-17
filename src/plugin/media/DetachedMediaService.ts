import { App, Notice, TFile } from 'obsidian';
import type { MediaHandler, MediaResult } from '../../services/MediaHandler';
import type { MarkdownConverter } from '../../services/MarkdownConverter';
import type { Logger } from '../../services/Logger';
import type { Media, Platform, PostData } from '../../types/post';
import type { SocialArchiverSettings } from '../../types/settings';
import type { LargeMediaGuardService } from './LargeMediaGuardService';
import { encodePathForMarkdownLink } from '../../utils/url';

/**
 * Per-URL download state encoded in `downloadedUrls` frontmatter.
 *
 * - `downloaded:<url>` — user retained a local copy of this source URL.
 * - `declined:<url>`   — user opted out of local download for this URL.
 * - plain URL (legacy) — read-only backward compatibility; treated as
 *   `downloaded:<url>` on read, rewritten to the prefixed form on every write.
 */
const DOWNLOADED_PREFIX = 'downloaded:';
const DECLINED_PREFIX = 'declined:';

/** Attachment root marker used to detect "this post's local media" embeds. */
const MEDIA_ROOT_FRAGMENT = '/social-archives/';

export interface DetachResult {
  /** Number of local attachment files removed. */
  deletedCount: number;
  /** Number of local attachments that could not be deleted (best-effort). */
  failedCount: number;
  /** Number of body references swapped to remote render. */
  rewrittenCount: number;
}

export interface RedownloadResult {
  /** Source URLs successfully downloaded and re-embedded. */
  downloadedCount: number;
  /** Source URLs that failed to download. */
  failedCount: number;
}

/**
 * Narrow dependency interface for {@link DetachedMediaService}.
 *
 * Kept as a constructor-injected bundle so the service can be instantiated
 * independently of the plugin class and tested in isolation.
 */
export interface DetachedMediaServiceDeps {
  app: App;
  mediaHandler: MediaHandler;
  /** Reserved for future full-note rewrites. Not used in MVP in-place rewrite. */
  markdownConverter?: MarkdownConverter;
  /** Optional — Stream B may not have instantiated the guard yet at load time. */
  largeMediaGuard?: LargeMediaGuardService;
  /** Optional settings accessor — required for redownload threshold prompt (Flow C). */
  settings?: SocialArchiverSettings;
  logger: Logger;
}

/**
 * DetachedMediaService - Orchestrates "detach local media" and
 * "re-download detached media" flows for a single archive note.
 *
 * Responsibility: user-initiated transitions between local-embed and
 * remote-render forms of a note's main top-level media, while preserving
 * note-level user content and non-media sections.
 *
 * @see {@link file://../../../.taskmaster/docs/prd-large-media-guard.md}
 */
export class DetachedMediaService {
  private readonly app: App;
  private readonly mediaHandler: MediaHandler;
  private readonly _markdownConverter?: MarkdownConverter;
  private readonly largeMediaGuard?: LargeMediaGuardService;
  private readonly settings?: SocialArchiverSettings;
  private readonly logger: Logger;

  constructor(deps: DetachedMediaServiceDeps) {
    this.app = deps.app;
    this.mediaHandler = deps.mediaHandler;
    this._markdownConverter = deps.markdownConverter;
    this.largeMediaGuard = deps.largeMediaGuard;
    this.settings = deps.settings;
    this.logger = deps.logger;
  }

  // ─── Eligibility ─────────────────────────────────────────────────────

  /**
   * True when the note has the metadata required to detach and has not
   * already been detached. Scope: main post only (MVP).
   */
  async canDetach(file: TFile): Promise<boolean> {
    const fm = this.readFrontmatter(file);
    if (!fm) return false;
    if (fm.mediaDetached === true) return false;
    const sourceUrls = this.normalizeStringArray(fm.mediaSourceUrls);
    return sourceUrls.length > 0;
  }

  /**
   * True when the note is in detached state and has source URLs available
   * for reconstruction.
   */
  async canRedownload(file: TFile): Promise<boolean> {
    const fm = this.readFrontmatter(file);
    if (!fm) return false;
    if (fm.mediaDetached !== true) return false;
    const sourceUrls = this.normalizeStringArray(fm.mediaSourceUrls);
    return sourceUrls.length > 0;
  }

  // ─── Detach ──────────────────────────────────────────────────────────

  /**
   * Detach local media from the note:
   * 1. Collect local attachments referenced under `attachments/social-archives/`.
   * 2. Rewrite the body so each local embed becomes a remote render/link using
   *    `mediaSourceUrls` as the source-of-truth URL list.
   * 3. Move local attachments to trash (reversible by Obsidian).
   * 4. Update `downloadedUrls` markers (`downloaded:` → `declined:`) and set
   *    `mediaDetached: true`.
   *
   * Partial-failure policy: if body rewrite succeeds but some attachment
   * deletions fail, we log and continue — the body already points at remote
   * render, so the note is in a consistent "detached" state; the leftover
   * files are cosmetically stale but safe to delete manually.
   */
  async detach(file: TFile): Promise<DetachResult> {
    const fm = this.readFrontmatter(file);
    if (!fm) {
      throw new Error('Cannot read frontmatter');
    }
    if (fm.mediaDetached === true) {
      throw new Error('Note is already detached');
    }

    const sourceUrls = this.normalizeStringArray(fm.mediaSourceUrls);
    if (sourceUrls.length === 0) {
      throw new Error('No mediaSourceUrls — detach is only supported on notes archived after Large Media Guard');
    }

    const originalBody = await this.app.vault.read(file);
    const { rewritten, rewrittenCount } = this.rewriteBodyForDetach(
      originalBody,
      sourceUrls,
      file.path,
    );

    // Step 1: body rewrite first — if this fails we haven't touched attachments
    if (rewrittenCount > 0) {
      await this.app.vault.modify(file, rewritten);
    }

    // Step 2: delete local attachments (best-effort)
    const { deletedCount, failedCount } = await this.deleteLocalAttachments(originalBody, file.path);

    // Step 3: update frontmatter markers
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.mediaDetached = true;
      frontmatter.downloadedUrls = this.swapMarkers(
        this.normalizeStringArray(frontmatter.downloadedUrls),
        sourceUrls,
        /* from */ DOWNLOADED_PREFIX,
        /* to   */ DECLINED_PREFIX,
      );
    });

    this.logger.info('[DetachedMedia] Detached local media', {
      filePath: file.path,
      rewrittenCount,
      deletedCount,
      failedCount,
    });

    return { deletedCount, failedCount, rewrittenCount };
  }

  // ─── Redownload ──────────────────────────────────────────────────────

  /**
   * Re-download previously detached media:
   * 1. Optionally run the large-media threshold prompt (if guard is wired).
   * 2. Download each source URL via `MediaHandler`.
   * 3. Rewrite the body so each remote render becomes a local embed.
   * 4. Update `downloadedUrls` markers (`declined:` → `downloaded:`), clear
   *    `mediaDetached`, and optionally mark `mediaPromptSuppressed`.
   *
   * If zero downloads succeed, leaves the note in its detached state and
   * surfaces the failure to the caller.
   */
  async redownload(file: TFile): Promise<RedownloadResult> {
    const fm = this.readFrontmatter(file);
    if (!fm) {
      throw new Error('Cannot read frontmatter');
    }
    if (fm.mediaDetached !== true) {
      throw new Error('Note is not in detached state');
    }

    const sourceUrls = this.normalizeStringArray(fm.mediaSourceUrls);
    if (sourceUrls.length === 0) {
      throw new Error('No mediaSourceUrls to restore');
    }

    const platform = this.resolvePlatform(fm);
    const postId = this.derivePostId(fm, file);
    const authorUsername = this.deriveAuthorUsername(fm);

    // Large Media Guard (Flow C) — re-run the threshold prompt when re-download
    // is requested. If the user picks "Keep note only" again, abort without
    // downloading anything. Skipped when guard/settings are not wired, the
    // threshold is disabled, or `mediaPromptSuppressed === true`.
    if (
      this.largeMediaGuard &&
      this.settings &&
      (this.settings.largeVideoPromptThresholdMB ?? 0) > 0 &&
      fm.mediaPromptSuppressed !== true
    ) {
      try {
        const probeMedia: Media[] = sourceUrls.map((url) => ({
          type: this.looksLikeImageUrl(url) ? 'image' : 'video',
          url,
        }));
        const oversizedInfo = await this.largeMediaGuard.inspectTopLevelMedia(
          probeMedia,
          this.settings.largeVideoPromptThresholdMB,
        );
        if (oversizedInfo.oversizedVideoUrls.length > 0) {
          // Build a minimal PostData carrier for the prompt — only the
          // mediaPromptSuppressed flag is read, but we pass the real mirror of
          // frontmatter state so future additions stay consistent.
          const carrier = {
            mediaPromptSuppressed: fm.mediaPromptSuppressed === true,
          } as unknown as PostData;
          const decision = await this.largeMediaGuard.promptIfNeeded(oversizedInfo, carrier);
          if (decision && decision.action === 'detach') {
            this.logger.info('[DetachedMedia] Redownload aborted by user (kept detached)', {
              filePath: file.path,
            });
            // Optionally persist suppression so next re-download skips the prompt.
            if (decision.suppressPromptForArchive) {
              await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter.mediaPromptSuppressed = true;
              });
            }
            return { downloadedCount: 0, failedCount: 0 };
          }
          // decision === 'download' (or null) → fall through to the download loop.
          if (decision && decision.suppressPromptForArchive) {
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
              frontmatter.mediaPromptSuppressed = true;
            });
          }
        }
      } catch (err) {
        // Fail open — guard failure should not block the user-initiated redownload.
        this.logger.warn('[DetachedMedia] Large media guard probe failed; continuing', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Step 1: download each source URL in order
    const results: Array<{ url: string; localPath: string | null }> = [];
    for (let i = 0; i < sourceUrls.length; i++) {
      const url = sourceUrls[i] ?? '';
      if (!url) {
        results.push({ url, localPath: null });
        continue;
      }
      try {
        const localPath = await this.mediaHandler.redownloadExpiredMedia(
          {
            type: this.looksLikeImageUrl(url) ? 'image' : 'video',
            originalUrl: url,
            reason: 'download_failed',
            detectedAt: new Date().toISOString(),
          },
          platform,
          postId,
          authorUsername,
          i,
        );
        results.push({ url, localPath });
      } catch (err) {
        this.logger.warn('[DetachedMedia] Redownload failed', {
          url,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({ url, localPath: null });
      }
    }

    const successful = results.filter((r): r is { url: string; localPath: string } => !!r.localPath);
    if (successful.length === 0) {
      return { downloadedCount: 0, failedCount: sourceUrls.length };
    }

    // Step 2: body rewrite — swap remote placeholders back to local embeds
    const originalBody = await this.app.vault.read(file);
    const rewritten = this.rewriteBodyForRedownload(originalBody, successful, file.path);
    await this.app.vault.modify(file, rewritten);

    // Step 3: update frontmatter markers
    const successUrls = new Set(successful.map(r => r.url));
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      // Partial success: if at least one URL failed, we keep mediaDetached: true
      // so the user can retry redownload. Already-succeeded local embeds stay in
      // the body (self-consistent). This trades "clean all-or-nothing semantics"
      // for "progress is never lost on retry".
      if (successful.length === sourceUrls.length) {
        frontmatter.mediaDetached = false;
      }
      frontmatter.downloadedUrls = this.swapMarkers(
        this.normalizeStringArray(frontmatter.downloadedUrls),
        [...successUrls],
        /* from */ DECLINED_PREFIX,
        /* to   */ DOWNLOADED_PREFIX,
      );
    });

    this.logger.info('[DetachedMedia] Redownloaded media', {
      filePath: file.path,
      downloadedCount: successful.length,
      failedCount: sourceUrls.length - successful.length,
    });

    return {
      downloadedCount: successful.length,
      failedCount: sourceUrls.length - successful.length,
    };
  }

  // ─── Body rewrite helpers ────────────────────────────────────────────

  /**
   * Replace local media embeds that reference the archive's attachment folder
   * with remote render/link equivalents.
   *
   * Matching:
   * - `![[<path>]]` Obsidian embed where `<path>` contains `/social-archives/`
   * - `![alt](<path>)` markdown image where `<path>` contains `/social-archives/`
   *
   * URL mapping strategy: filename-index extraction. Attachment filenames follow
   * `{date}-{username}-{postId}-{N}.{ext}` where `N` is 1-based and corresponds
   * to the original position in `postData.media` (and therefore the index into
   * `mediaSourceUrls` after subtracting 1). This is robust against manual edits
   * that remove or reorder embeds — each embed is matched to its own URL by
   * filename, not by document-order position.
   *
   * Fallback posture (defensive, matches the pre-existing "leave extras intact"
   * rule):
   * - Filename doesn't match the `-{digits}.{ext}` pattern → skip replacement
   *   for that embed, log warn. Legacy/renamed files are preserved as-is.
   * - Parsed index is out of bounds → skip replacement, log warn. We never
   *   substitute a wrong URL for an embed whose index we cannot resolve.
   */
  private rewriteBodyForDetach(
    body: string,
    sourceUrls: string[],
    notePath: string,
  ): { rewritten: string; rewrittenCount: number } {
    let count = 0;

    // Single combined regex: either ![[...]] or ![alt](...)
    const pattern = /(!\[\[([^\]]+)\]\])|(!\[([^\]]*)\]\(([^)]+)\))/g;

    const rewritten = body.replace(pattern, (match, _wiki, wikiPath, _md, mdAlt, mdPath) => {
      const targetPath: string | undefined = wikiPath ?? mdPath;
      if (!targetPath) return match;

      // Cheap scope filter: only rewrite embeds inside the archive media root.
      const cleanPath = targetPath.split('|')[0]?.trim() ?? '';
      if (!cleanPath.includes(MEDIA_ROOT_FRAGMENT)) return match;

      const arrayIndex = this.extractMediaArrayIndex(cleanPath);
      if (arrayIndex === null) {
        // Filename doesn't match the `-{digits}.{ext}` convention — legacy
        // naming or manually renamed file. Do not substitute a URL we cannot
        // confidently map; leave the embed intact for the user to fix.
        this.logger.warn('[DetachedMedia] Embed filename does not match index pattern — skipping', {
          path: cleanPath,
          notePath,
        });
        return match;
      }

      const url = sourceUrls[arrayIndex];
      if (!url) {
        // Parsed index is out of bounds for the source URL list — skip rather
        // than risk a wrong mapping.
        this.logger.warn('[DetachedMedia] Embed index out of bounds for mediaSourceUrls — skipping', {
          path: cleanPath,
          arrayIndex,
          sourceUrlsLength: sourceUrls.length,
          notePath,
        });
        return match;
      }

      count++;
      return this.renderRemotePlaceholder(url, typeof mdAlt === 'string' ? mdAlt : undefined);
    });

    return { rewritten, rewrittenCount: count };
  }

  /**
   * Extract the 0-based media array index from an attachment path whose
   * filename follows the `{date}-{username}-{postId}-{N}.{ext}` convention,
   * where `N` is 1-based.
   *
   * Returns null when the filename does not match the pattern (legacy naming,
   * manually renamed files).
   */
  private extractMediaArrayIndex(attachmentPath: string): number | null {
    const filename = attachmentPath.split('/').pop() ?? attachmentPath;
    // Trailing `-{digits}.{ext}` — capture the digits. Extension must not
    // contain hyphens (they don't in practice), so the last hyphen before the
    // final dot reliably delimits the index.
    const match = /-(\d+)\.[^./-]+$/.exec(filename);
    if (!match) return null;
    const raw = match[1];
    if (!raw) return null;
    const oneBased = Number.parseInt(raw, 10);
    if (!Number.isFinite(oneBased) || oneBased < 1) return null;
    return oneBased - 1;
  }

  /**
   * Reverse of {@link rewriteBodyForDetach}. Swap remote placeholders that
   * match successfully-downloaded source URLs back to local embeds.
   *
   * Matches `[...](<url>)` and `![...](<url>)` whose URL is in the success
   * set, or bare `<url>` on its own line.
   */
  private rewriteBodyForRedownload(
    body: string,
    successful: Array<{ url: string; localPath: string }>,
    notePath: string,
  ): string {
    let rewritten = body;
    for (const { url, localPath } of successful) {
      const relativePath = this.toRelativeMediaPath(localPath, notePath);
      const encoded = encodePathForMarkdownLink(relativePath);
      const escapedUrl = this.escapeForRegex(url);

      // ![alt](<url>) → ![alt](<localPath>)
      const mdImageRe = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedUrl}\\)`, 'g');
      rewritten = rewritten.replace(mdImageRe, (_m, alt) => `![${alt}](${encoded})`);

      // [label](<url>) → ![label](<localPath>)  (common for video link fallback)
      const mdLinkRe = new RegExp(`\\[([^\\]]*)\\]\\(${escapedUrl}\\)`, 'g');
      rewritten = rewritten.replace(mdLinkRe, (_m, label) => `![${label}](${encoded})`);
    }
    return rewritten;
  }

  /** Remote placeholder for a detached media item. */
  private renderRemotePlaceholder(sourceUrl: string, altText?: string): string {
    const alt = altText && altText.trim().length > 0 ? altText : 'Media (detached)';
    // Use markdown image syntax when source URL looks like an image; otherwise
    // plain link. Obsidian renders both; the important property is that the
    // note has no local file reference.
    if (this.looksLikeImageUrl(sourceUrl)) {
      return `![${alt}](${sourceUrl})`;
    }
    return `[${alt}](${sourceUrl})`;
  }

  private looksLikeImageUrl(url: string): boolean {
    return /\.(?:jpe?g|png|gif|webp|svg|bmp|heic|heif|avif)(?:\?|#|$)/i.test(url);
  }

  // ─── Attachment deletion ─────────────────────────────────────────────

  /**
   * Delete local attachments referenced in the body that live under the
   * archive media root. Prefers `app.fileManager.trashFile()` for
   * reversibility. Never throws — returns counts.
   */
  private async deleteLocalAttachments(
    body: string,
    notePath: string,
  ): Promise<{ deletedCount: number; failedCount: number }> {
    const candidates = this.extractLocalMediaPaths(body);
    let deletedCount = 0;
    let failedCount = 0;

    for (const candidate of candidates) {
      const resolved = this.resolveVaultPath(candidate, notePath);
      if (!resolved) continue;

      const abstract = this.app.vault.getAbstractFileByPath(resolved);
      if (!(abstract instanceof TFile)) continue;

      try {
        await this.app.fileManager.trashFile(abstract);
        deletedCount++;
      } catch (err) {
        failedCount++;
        this.logger.warn('[DetachedMedia] Failed to trash attachment', {
          path: resolved,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { deletedCount, failedCount };
  }

  private extractLocalMediaPaths(body: string): string[] {
    const paths = new Set<string>();
    const pattern = /(!\[\[([^\]]+)\]\])|(!\[[^\]]*\]\(([^)]+)\))/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const raw = match[2] ?? match[4];
      if (!raw) continue;
      const clean = raw.split('|')[0]?.trim() ?? '';
      if (!clean) continue;
      if (clean.startsWith('http://') || clean.startsWith('https://')) continue;
      if (!clean.includes(MEDIA_ROOT_FRAGMENT)) continue;
      paths.add(clean);
    }
    return [...paths];
  }

  private resolveVaultPath(mediaPath: string, notePath: string): string | null {
    try {
      const decoded = decodeURIComponent(mediaPath);
      // Handle vault-relative and note-relative paths.
      if (decoded.startsWith('/')) {
        return decoded.replace(/^\/+/, '');
      }
      if (decoded.startsWith('../') || decoded.startsWith('./')) {
        const base = notePath.split('/').slice(0, -1);
        const parts = decoded.split('/');
        for (const part of parts) {
          if (part === '' || part === '.') continue;
          if (part === '..') {
            base.pop();
          } else {
            base.push(part);
          }
        }
        return base.join('/');
      }
      return decoded;
    } catch {
      return mediaPath;
    }
  }

  // ─── Frontmatter helpers ─────────────────────────────────────────────

  private readFrontmatter(file: TFile): Record<string, unknown> | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm || typeof fm !== 'object') return null;
    return fm as Record<string, unknown>;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((v): v is string => typeof v === 'string')
      .map(v => v.trim())
      .filter(v => v.length > 0);
  }

  /**
   * Set per-URL markers in `downloadedUrls` to `to` for the given URL set,
   * regardless of their previous marker state. Unrelated entries are
   * preserved; legacy plain URLs are normalized to the prefixed form.
   *
   * @param from - Documented for intent; the previous marker for the target
   *   URLs. Not read during the swap because we unconditionally overwrite.
   */
  private swapMarkers(
    existing: string[],
    urls: string[],
    from: string,
    to: string,
  ): string[] {
    void from; // documented parameter, intentionally unused at the write step
    const urlSet = new Set(urls);
    const out: string[] = [];
    const seen = new Set<string>();

    const push = (entry: string) => {
      if (seen.has(entry)) return;
      seen.add(entry);
      out.push(entry);
    };

    for (const entry of existing) {
      const parsed = this.parseMarker(entry);
      if (!parsed) continue;
      if (urlSet.has(parsed.url)) {
        // Skip any existing entries for target URLs — we'll append the new markers below.
        continue;
      }
      // Normalize legacy plain URLs to `downloaded:` prefix on write.
      push(`${parsed.prefix}${parsed.url}`);
    }

    // Append the flipped markers for the target URLs.
    for (const url of urls) {
      if (!url) continue;
      push(`${to}${url}`);
    }

    return out;
  }

  private parseMarker(entry: string): { prefix: string; url: string } | null {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith(DOWNLOADED_PREFIX)) {
      return { prefix: DOWNLOADED_PREFIX, url: trimmed.slice(DOWNLOADED_PREFIX.length) };
    }
    if (trimmed.startsWith(DECLINED_PREFIX)) {
      return { prefix: DECLINED_PREFIX, url: trimmed.slice(DECLINED_PREFIX.length) };
    }
    // Legacy plain URL entry — treat as downloaded on read.
    if (/^https?:\/\//i.test(trimmed)) {
      return { prefix: DOWNLOADED_PREFIX, url: trimmed };
    }
    return null;
  }

  // ─── Platform / path helpers ─────────────────────────────────────────

  private resolvePlatform(fm: Record<string, unknown>): Platform {
    const candidate = typeof fm.platform === 'string' ? fm.platform.toLowerCase() : 'web';
    return candidate as Platform;
  }

  private derivePostId(fm: Record<string, unknown>, file: TFile): string {
    // Prefer sourceArchiveId / existing media folder hint if available;
    // otherwise fall back to the note basename.
    if (typeof fm.sourceArchiveId === 'string' && fm.sourceArchiveId.trim()) {
      return fm.sourceArchiveId.trim();
    }
    return file.basename;
  }

  private deriveAuthorUsername(fm: Record<string, unknown>): string {
    if (typeof fm.author === 'string' && fm.author.trim()) {
      return fm.author.trim().replace(/\s+/g, '_');
    }
    return 'unknown';
  }

  private escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Convert an absolute vault path to a note-relative path. Lightweight
   * local implementation to avoid importing the larger path util which
   * pulls in unrelated dependencies.
   */
  private toRelativeMediaPath(mediaPath: string, notePath: string): string {
    const noteDir = notePath.split('/').slice(0, -1);
    const mediaParts = mediaPath.split('/');
    let common = 0;
    while (
      common < noteDir.length &&
      common < mediaParts.length &&
      noteDir[common] === mediaParts[common]
    ) {
      common++;
    }
    const up = noteDir.length - common;
    const down = mediaParts.slice(common);
    const rel = [...Array(up).fill('..'), ...down].join('/');
    return rel || mediaPath;
  }

  // ─── Public UX helpers ───────────────────────────────────────────────

  /**
   * Run `detach` with user-facing Notice wrapper. Useful from command-palette
   * and menu callers that want uniform feedback.
   */
  async detachWithUserFeedback(file: TFile): Promise<void> {
    try {
      if (!(await this.canDetach(file))) {
        new Notice('Detach is only available for notes archived after Large Media Guard — no mediaSourceUrls found.');
        return;
      }
      const { deletedCount, failedCount } = await this.detach(file);
      if (failedCount > 0) {
        new Notice(`Detached ${deletedCount} attachment(s). ${failedCount} failed — see console.`);
      } else {
        new Notice(`Detached ${deletedCount} local attachment(s).`);
      }
    } catch (err) {
      this.logger.error('[DetachedMedia] Detach failed', err instanceof Error ? err : undefined, {
        filePath: file.path,
      });
      new Notice(`Detach failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  /** Run `redownload` with user-facing Notice wrapper. */
  async redownloadWithUserFeedback(file: TFile): Promise<void> {
    try {
      if (!(await this.canRedownload(file))) {
        new Notice('Re-download is only available for notes with detached media.');
        return;
      }
      const { downloadedCount, failedCount } = await this.redownload(file);
      if (downloadedCount === 0) {
        new Notice('No media could be re-downloaded — see console.');
      } else if (failedCount > 0) {
        new Notice(`Re-downloaded ${downloadedCount} item(s). ${failedCount} failed.`);
      } else {
        new Notice(`Re-downloaded ${downloadedCount} item(s).`);
      }
    } catch (err) {
      this.logger.error('[DetachedMedia] Redownload failed', err instanceof Error ? err : undefined, {
        filePath: file.path,
      });
      new Notice(`Re-download failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  /**
   * Synchronous eligibility probe for command-palette `checkCallback`.
   * Reads metadata cache only (no disk I/O), accepting false negatives on
   * first open when cache is cold — Obsidian will re-evaluate as the cache
   * warms up.
   */
  canDetachSync(file: TFile): boolean {
    const fm = this.readFrontmatter(file);
    if (!fm) return false;
    if (fm.mediaDetached === true) return false;
    return this.normalizeStringArray(fm.mediaSourceUrls).length > 0;
  }

  /** Sync variant of {@link canRedownload}. */
  canRedownloadSync(file: TFile): boolean {
    const fm = this.readFrontmatter(file);
    if (!fm) return false;
    if (fm.mediaDetached !== true) return false;
    return this.normalizeStringArray(fm.mediaSourceUrls).length > 0;
  }
}
