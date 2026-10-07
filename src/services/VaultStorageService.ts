/**
 * VaultStorageService
 *
 * Handles storage operations for user-created posts (platform: 'post').
 * Responsible for:
 * - File path generation for posts and media
 * - Saving media attachments to Vault
 * - Converting PostData to Markdown and saving to Vault
 *
 * Single Responsibility: User post storage operations
 */

import type { PostData, Media } from '../types/post';
import { getVaultOrganizationStrategy, type SocialArchiverSettings } from '../types/settings';
import type { MediaResult } from './MediaHandler';
import { VaultManager } from './VaultManager';
import { MarkdownConverter } from './MarkdownConverter';
import { COMPOSED_POST_SYNC_FRONTMATTER_FIELDS, USER_CONTROLLED_FRONTMATTER_FIELDS } from './markdown/frontmatter/constants';
import { firstArchivePerUrl, splitEmbeddedArchiveBlocks } from './markdown/EmbeddedArchiveBlocks';
import { App, Vault, TFile, normalizePath, stringifyYaml } from 'obsidian';

/**
 * Carry user-owned frontmatter forward onto a freshly regenerated block.
 *
 * Every writer that overwrites an existing note has to run this, because
 * regeneration rebuilds frontmatter from `PostData` — and `PostData` does not
 * carry the user's tags, share state, or per-URL media decisions. Whatever is
 * not merged back is not "reset to a default", it is gone.
 *
 * Extracted rather than copied a third time: this logic already exists twice
 * (here and, unreachably, in FrontmatterGenerator), and the copy that was
 * missing from `savePost` is precisely how the replace path came to destroy
 * user data.
 */
export function mergeUserControlledFrontmatter<T extends Record<string, unknown>>(
  next: T,
  existing: Record<string, unknown> | undefined,
): T {
  if (!existing) return { ...next };

  // Widened for the write, narrowed once on return — keeps the cast in here
  // rather than at all three call sites.
  const merged: Record<string, unknown> = { ...next };
  for (const field of USER_CONTROLLED_FRONTMATTER_FIELDS) {
    if (existing[field] !== undefined) {
      merged[field] = existing[field];
    }
  }
  return merged as T;
}

/** One archive of a note's "Referenced Social Media Posts" section. */
interface SectionArchive {
  /** Its Original URL, as PostDataParser reads it back. */
  url: string;
  /** Its markdown: through its Original URL line, then its comments. */
  text: string;
}

/** `text` without the blank lines and dividers around it. */
function trimRules(text: string): string {
  return text.replace(/^(?:[ \t]*(?:---)?[ \t]*(?:\n|$))+/, '').replace(/(?:\n[ \t]*(?:---)?[ \t]*)+$/, '');
}

/**
 * What `text` holds beyond the copies of `known` it starts with. Copies a
 * re-save made come one after another, with rules and the section heading
 * between them; they are compared line by line, without the blank lines a
 * re-save collapses or the `<` it escapes.
 */
function beyondCopies(text: string, known: readonly string[]): string {
  const plain = (line: string): string => line.replaceAll('&lt;', '<').trim();
  const copies = known.map((copy) => copy.split('\n').map(plain).filter(Boolean)).filter((copy) => copy.length > 0);
  const lines = text.split('\n');
  let start = 0;
  for (;;) {
    while (start < lines.length && /^[ \t]*(?:---)?[ \t]*$|^## (?:📦 )?Referenced Social Media Posts$/.test(lines[start] ?? '')) start++;
    const rest = lines.slice(start).map((line, index) => ({ line: plain(line), at: start + index })).filter(({ line }) => line);
    const copied = Math.max(0, ...copies
      .filter((copy) => copy.length <= rest.length && copy.every((line, index) => line === rest[index]?.line))
      .map((copy) => copy.length));
    if (copied === 0) return trimRules(lines.slice(start).join('\n'));
    start = (rest[copied - 1]?.at ?? lines.length) + 1;
  }
}

/**
 * Split a note's body (what precedes its interaction bar) at the embedded
 * archives section, which has no end marker, the way
 * PostDataParser.extractEmbeddedArchives reads it: from the heading to the
 * interaction bar, one archive per block, the first of each URL. Null when
 * there is no section the parser would read.
 *
 * `strays` is what else the section holds, none of which the parser reads
 * back, each once: what follows an archive's Original URL line other than its
 * comments, where updates before 1aec2c16e left what had followed the
 * interaction bar. A later copy of an archive (see splitEmbeddedArchiveBlocks)
 * is not written again, so all that follows its Original URL line, comments
 * too, is a stray, but for what copies text the note keeps: comments run on to
 * the next archive, and a PostComposer edit's section ended with a copy, whose
 * comments then hold what was moved after them.
 */
function readArchivesSection(body: string): { before: string; archives: SectionArchive[]; strays: string[] } | null {
  const heading = /(?:\n---\n\s*)?## (?:📦 )?Referenced Social Media Posts\n\n/.exec(body);
  if (!heading) return null;

  const blocks = splitEmbeddedArchiveBlocks(body.slice(heading.index + heading[0].length))
    .filter((block) => block.trim())
    .map((block) => {
      // An archive's metadata follows its last rule + "**Platform:**"; without
      // one, the parser reads the whole block as the archive's text
      const metadataStart = block.lastIndexOf('\n---\n\n**Platform:**');
      const metadata = metadataStart < 0 ? block : block.slice(metadataStart);
      const url = /\*\*Original URL:\*\* (.+)/.exec(metadata)?.[1]?.trim() ?? '';
      if (metadataStart < 0) return { url, text: block, head: trimRules(block), after: '', stray: '' };

      const lastLine = /\*\*Original URL:\*\*.*/.exec(metadata) ?? /\*\*Platform:\*\*.*/.exec(metadata);
      const end = metadataStart + (lastLine ? lastLine.index + lastLine[0].length : 0);
      const rest = block.slice(end);
      const comments = rest.indexOf('## 💬 Comments\n\n');
      return {
        url,
        text: comments < 0 ? block.slice(0, end) : `${block.slice(0, end)}\n\n---\n\n${rest.slice(comments)}`,
        // Its header and text, which a later copy's comments may hold
        head: trimRules(block.slice(0, metadataStart)),
        after: trimRules(rest),
        stray: trimRules(comments < 0 ? rest : rest.slice(0, comments)),
      };
    });

  const archives = firstArchivePerUrl(blocks);
  const known: string[] = [];
  const strays: string[] = [];
  for (const block of blocks) {
    const kept = archives.includes(block);
    const stray = beyondCopies(kept ? block.stray : block.after, known);
    if (stray) strays.push(stray);
    known.push(stray, ...(kept ? [block.head, block.after] : []));
  }

  return { before: body.slice(0, heading.index), archives, strays };
}

/**
 * Media file save result
 */
export interface MediaSaveResult {
  originalFile: File;
  savedPath: string;
  url: string;
  error?: string;
}

/**
 * Post save result
 */
export interface PostSaveResult {
  file: TFile;
  path: string;
  mediaSaved: MediaSaveResult[];
}

/**
 * Update post options
 */
export interface UpdatePostOptions {
  filePath: string;
  postData: PostData;
  mediaFiles?: File[];
  deletedMediaPaths?: string[];
  existingMedia?: Media[];
  /**
   * Rebuild the body (text, media, embedded archives) from `postData`, as a
   * PostComposer edit needs. By default the body is kept and only the embedded
   * archives are regenerated, for callers whose PostData was parsed back out of
   * the note (adding an embedded archive): re-rendering that text would
   * rewrite the user's markdown.
   */
  replaceBody?: boolean;
}

/**
 * Media change detection result
 */
interface MediaChanges {
  toDelete: string[];      // Vault paths of media to delete
  toKeep: Media[];         // Existing media to preserve
  toAdd: File[];           // New media files to save
}

/**
 * VaultStorageService configuration
 */
export interface VaultStorageServiceConfig {
  app: App;
  vault: Vault;
  settings: SocialArchiverSettings;
  vaultManager?: VaultManager;
  markdownConverter?: MarkdownConverter;
}

/**
 * VaultStorageService class
 */
export class VaultStorageService {
  private app: App;
  private vault: Vault;
  private settings: SocialArchiverSettings;
  private vaultManager: VaultManager;
  private markdownConverter: MarkdownConverter;

  constructor(config: VaultStorageServiceConfig) {
    this.app = config.app;
    this.vault = config.vault;
    this.settings = config.settings;

    // Create VaultManager if not provided
    this.vaultManager = config.vaultManager || new VaultManager({
      vault: config.vault,
      basePath: config.settings.archivePath,
      organizationStrategy: getVaultOrganizationStrategy(config.settings.archiveOrganization),
    });

    // Create MarkdownConverter if not provided
    this.markdownConverter = config.markdownConverter || new MarkdownConverter({
      frontmatterSettings: config.settings.frontmatter,
      includeHashtagsAsObsidianTags: config.settings.includeHashtagsAsObsidianTags,
    });
  }

  /**
   * Generate file path for user-created post
   * Format: Social Archives/Post/{YYYY}/{MM}/{YYYY-MM-DD-HHmmss}.md
   */
  generateFilePath(postData: PostData): string {
    const timestamp = postData.metadata.timestamp instanceof Date
      ? postData.metadata.timestamp
      : new Date(postData.metadata.timestamp);

    const { year, month, dateSegment, timeSegment } = this.getTimestampParts(
      timestamp,
      postData.metadata.timestamp
    );
    const fileName = `${dateSegment}-${timeSegment}.md`;

    return normalizePath(`${this.settings.archivePath}/Post/${year}/${month}/${fileName}`);
  }

  /**
   * Generate media file path
   * Format: attachments/social-archives/post/{postId}/{filename}
   *
   * @param timestamp - Post creation timestamp
   * @param filename - Original filename
   * @param originalTimestamp - Original timestamp value for deterministic formatting
   */
  generateMediaPath(
    timestamp: Date,
    filename: string,
    postId?: string,
    originalTimestamp?: Date | string
  ): string {
    const sanitizedFilename = this.sanitizeFilename(filename);

    // Use provided postId or fall back to YYYY-MM-DD date segment
    const { dateSegment } = this.getTimestampParts(timestamp, originalTimestamp);
    const mediaFolder = postId || dateSegment;

    // Format: post/{postId} (consistent with other platforms)
    return normalizePath(`${this.settings.mediaPath}/post/${mediaFolder}/${sanitizedFilename}`);
  }

  /**
   * Sanitize filename by removing invalid characters
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '_')
      .trim();
  }

  /**
   * Save media file to Vault
   *
   * @param file - Browser File object from MediaAttacher
   * @param timestamp - Post creation timestamp
   * @param postId - Unique post identifier for folder naming
   * @returns Media save result with vault path
   */
  async saveMedia(
    file: File,
    timestamp: Date,
    postId?: string,
    originalTimestamp?: Date | string
  ): Promise<MediaSaveResult> {
    try {
      // Read file as ArrayBuffer
      let arrayBuffer = await file.arrayBuffer();

      // Detect and convert HEIC files
      let finalFileName = file.name;
      const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';

      if (file.type.includes('heic') || file.type.includes('heif') ||
          fileExtension === 'heic' || fileExtension === 'heif') {
        const { detectAndConvertHEIC } = await import('../utils/heic');
        const result = await detectAndConvertHEIC(arrayBuffer, fileExtension, 0.95);

        // Update data and filename if conversion occurred
        arrayBuffer = result.data;
        if (result.extension !== fileExtension) {
          finalFileName = file.name.replace(/\.(heic|heif)$/i, `.${result.extension}`);
        }
      }

      // Generate media file path with final filename
      const mediaPath = this.generateMediaPath(timestamp, finalFileName, postId, originalTimestamp);

      // Ensure parent folder exists
      const parentPath = this.getParentPath(mediaPath);
      await this.vaultManager.createFolderIfNotExists(parentPath);

      // Check if file already exists
      const existingFile = this.vault.getFileByPath(mediaPath);
      if (existingFile) {
        // Generate unique path
        const uniquePath = this.generateUniqueMediaPath(mediaPath);
        const savedFile = await this.vault.createBinary(uniquePath, arrayBuffer);

        return {
          originalFile: file,
          savedPath: savedFile.path,
          url: savedFile.path,
        };
      }

      // Create new binary file
      const savedFile = await this.vault.createBinary(mediaPath, arrayBuffer);

      return {
        originalFile: file,
        savedPath: savedFile.path,
        url: savedFile.path,
      };
    } catch (error) {
      return {
        originalFile: file,
        savedPath: '',
        url: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate unique media path by appending counter
   */
  private generateUniqueMediaPath(basePath: string): string {
    const extension = basePath.substring(basePath.lastIndexOf('.'));
    const pathWithoutExt = basePath.substring(0, basePath.lastIndexOf('.'));

    let counter = 1;
    let uniquePath = `${pathWithoutExt}_${counter}${extension}`;

    while (this.vault.getFileByPath(uniquePath) !== null) {
      counter++;
      uniquePath = `${pathWithoutExt}_${counter}${extension}`;
    }

    return uniquePath;
  }

  /**
   * Get parent path from file path
   */
  private getParentPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 1) {
      return '.';
    }
    return parts.slice(0, -1).join('/');
  }

  /**
   * Save user-created post to Vault
   *
   * 1. Save media files if provided
   * 2. Update PostData with saved media paths
   * 3. Convert PostData to Markdown
   * 4. Save markdown file to Vault
   *
   * @param postData - Post data generated by PostCreationService
   * @param mediaFiles - Media files from MediaAttacher (optional)
   * @param targetFilePath - Optional explicit file path (for subscription posts)
   * @param externalMediaResults - Pre-downloaded media results (for subscription posts with inline images)
   * @returns Post save result
   */
  async savePost(
    postData: PostData,
    mediaFiles?: File[],
    targetFilePath?: string,
    externalMediaResults?: MediaResult[]
  ): Promise<PostSaveResult> {
    const timestamp = postData.metadata.timestamp instanceof Date
      ? postData.metadata.timestamp
      : new Date(postData.metadata.timestamp);

    const mediaSaved: MediaSaveResult[] = [];

    // Use date segment for consistent media folder naming across attachments
    const { dateSegment } = this.getTimestampParts(timestamp, postData.metadata.timestamp);

    // Save media files if provided and replace postData.media with saved media
    if (mediaFiles && mediaFiles.length > 0) {
      const savedMediaArray: Media[] = [];

      for (const file of mediaFiles) {
        const result = await this.saveMedia(
          file,
          timestamp,
          dateSegment,
          postData.metadata.timestamp
        );
        mediaSaved.push(result);

        // Only add to media array if save succeeded
        if (!result.error) {
          const media: Media = {
            type: file.type.startsWith('video/') ? 'video' : 'image',
            url: result.url,
            altText: file.name,
            size: file.size,
            mimeType: file.type,
          };

          savedMediaArray.push(media);
        }
      }

      // Replace postData.media with saved media (don't push, replace!)
      postData.media = savedMediaArray;
    }

    // Build MediaResult array for MarkdownConverter (maps saved media to format expected by MediaFormatter)
    // Use externalMediaResults if provided (subscription posts with pre-downloaded media),
    // otherwise build from mediaSaved (user-created posts with File objects)
    const mediaResults: MediaResult[] = externalMediaResults ?? mediaSaved
      .filter(result => !result.error)
      .map((result, index) => {
        // Get the TFile from vault
        const file = this.vault.getFileByPath(result.savedPath);

        return {
          originalUrl: result.url,
          localPath: result.savedPath,
          type: result.originalFile.type.startsWith('video/') ? 'video' as const : 'image' as const,
          size: result.originalFile.size,
          file: file as import('obsidian').TFile,
          sourceIndex: index,
          fallbackKind: 'none' as const,
        };
      });

    // Generate file path (use explicit targetFilePath, then PostData.url, then generate)
    // For subscription posts, targetFilePath is provided to avoid using URL as path
    const filePath = targetFilePath || (postData.url && !postData.url.startsWith('http') ? postData.url : this.generateFilePath(postData));

    // Convert PostData to Markdown with media results
    // IMPORTANT: convert() signature is (postData, customTemplate?, mediaResults?, options?)
    // Pass undefined for customTemplate to use default, then mediaResults
    const markdown = this.markdownConverter.convert(postData, undefined, mediaResults, { outputFilePath: filePath });

    // Overwriting an existing note (subscription limited-archive upgrade, media
    // enrichment, preliminary-file replacement) regenerates frontmatter from
    // PostData — which carries none of the user's tags, share state, or media
    // decisions. Without this merge the upgrade silently destroys them, and a
    // published shareUrl stops resolving. New files skip it: nothing to keep.
    const existingFile = this.vault.getFileByPath(filePath);
    const documentToWrite = existingFile
      ? this.markdownConverter.updateFullDocument({
          ...markdown,
          frontmatter: mergeUserControlledFrontmatter(
            markdown.frontmatter,
            this.app.metadataCache.getFileCache(existingFile)?.frontmatter,
          ),
        }).fullDocument
      : markdown.fullDocument;

    // Ensure parent folder exists
    const parentPath = this.getParentPath(filePath);
    await this.vaultManager.createFolderIfNotExists(parentPath);

    // Save markdown file
    const file = await this.createOrUpdateFile(filePath, documentToWrite);

    // Inject composed-post sync contract fields for user-created posts
    if (postData.platform === 'post' && postData.id) {
      try {
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          fm['postOrigin'] = 'composer';
          fm['clientPostId'] = postData.id;
          fm['syncState'] = 'pending';
        });
      } catch {
        // Non-fatal: sync fields missing means ComposedPostSyncService will skip this file
      }
    }

    return {
      file,
      path: file.path,
      mediaSaved,
    };
  }

  /**
   * Create or update file in Vault
   */
  private async createOrUpdateFile(path: string, content: string): Promise<TFile> {
    const existingFile = this.vault.getFileByPath(path);

    if (existingFile) {
      // Update existing file
      await this.vault.process(existingFile, () => content);
      return existingFile;
    }

    // Create new file
    return await this.vault.create(path, content);
  }

  /**
   * Delete media files (cleanup on error)
   */
  async cleanupMedia(mediaSaved: MediaSaveResult[]): Promise<void> {
    for (const result of mediaSaved) {
      if (!result.error && result.savedPath) {
        try {
          const file = this.vault.getFileByPath(result.savedPath);
          if (file) {
            await this.app.fileManager.trashFile(file);
          }
        } catch {
          // best-effort cleanup, ignore errors
        }
      }
    }
  }

  /**
   * Detect media changes between existing and new media
   *
   * @param existingMedia - Current media in the post
   * @param deletedMediaPaths - Paths explicitly marked for deletion
   * @param newMediaFiles - New media files to add
   * @returns Media change detection result
   */
  private detectMediaChanges(
    existingMedia: Media[] = [],
    deletedMediaPaths: string[] = [],
    newMediaFiles: File[] = []
  ): MediaChanges {
    const changes: MediaChanges = {
      toDelete: [],
      toKeep: [],
      toAdd: []
    };

    // Process deletions: media marked for deletion
    const deletedSet = new Set(deletedMediaPaths);

    for (const media of existingMedia) {
      if (deletedSet.has(media.url)) {
        // Mark for deletion
        changes.toDelete.push(media.url);
      } else {
        // Keep existing media
        changes.toKeep.push(media);
      }
    }

    // Process additions: all new media files
    changes.toAdd = newMediaFiles;

    return changes;
  }

  /**
   * Update markdown content with new media references
   *
   * This method regenerates markdown content using the MarkdownConverter
   * while ensuring media references are properly updated.
   * Preserves existing frontmatter fields (especially share-related fields).
   *
   * @param postData - Updated post data
   * @param keptMedia - Existing media to preserve
   * @param addedMedia - Newly added media with save results
   * @param existingFile - Existing file to read frontmatter from
   * @param replaceBody - Write the body from `postData` instead of keeping it
   * @returns Updated markdown content
   */
  private async updateMarkdownContent(
    postData: PostData,
    keptMedia: Media[],
    addedMedia: MediaSaveResult[],
    existingFile: TFile,
    replaceBody: boolean
  ): Promise<{ fullDocument: string }> {
    // Combine kept media with successfully added media
    const allMedia: Media[] = [...keptMedia];

    // Add newly saved media to the media array
    for (const result of addedMedia) {
      if (!result.error) {
        const media: Media = {
          type: result.originalFile.type.startsWith('video/') ? 'video' : 'image',
          url: result.url,
          altText: result.originalFile.name,
          size: result.originalFile.size,
          mimeType: result.originalFile.type,
        };
        allMedia.push(media);
      }
    }

    // Update postData with combined media array
    postData.media = allMedia;

    // Build MediaResult array for MarkdownConverter
    const mediaResults: MediaResult[] = addedMedia
      .filter(result => !result.error)
      .map((result, index) => {
        const file = this.vault.getFileByPath(result.savedPath);
        return {
          originalUrl: result.url,
          localPath: result.savedPath,
          type: result.originalFile.type.startsWith('video/') ? 'video' as const : 'image' as const,
          size: result.originalFile.size,
          file: file as import('obsidian').TFile,
          sourceIndex: index,
          fallbackKind: 'none' as const,
        };
      });

    // Also add kept media to mediaResults for proper markdown generation
    const keptMediaResults: MediaResult[] = keptMedia.map((media, index) => {
      const file = this.vault.getFileByPath(media.url);
      return {
        originalUrl: media.url,
        localPath: media.url,
        type: media.type,
        size: media.size || 0,
        file: file as import('obsidian').TFile,
        sourceIndex: index,
        fallbackKind: 'none' as const,
      };
    });

    const allMediaResults: MediaResult[] = [...keptMediaResults, ...mediaResults];

    // Read existing file content: its body (unless replaced) and whatever
    // follows the interaction bar are kept
    const existingContent = await this.vault.read(existingFile);

    // Read existing frontmatter to preserve share-related fields
    const fileCache = this.app.metadataCache.getFileCache(existingFile);
    const existingFrontmatter = fileCache?.frontmatter || {};

    // Convert PostData to Markdown with updated media references
    // Pass undefined for customTemplate to use default
    const markdown = this.markdownConverter.convert(postData, undefined, allMediaResults, { outputFilePath: existingFile.path });

    // Merge existing frontmatter with new frontmatter
    // Preserve user-controlled fields (share state, per-URL download decisions,
    // detach markers, etc.) so re-archive/update doesn't clobber user intent.
    // See USER_CONTROLLED_FRONTMATTER_FIELDS in frontmatter/constants.ts.
    const mergedFrontmatter = mergeUserControlledFrontmatter(
      markdown.frontmatter,
      existingFrontmatter,
    );

    // Editing a note is not re-archiving it. This path (composed-post edits,
    // adding an embedded archive to a host note) never carries a server archive
    // time, so the generator falls back to `now` and the original date would be
    // lost. Only fill from the existing note when nothing better was supplied —
    // a caller that does know the real archive time must still win.
    if (!postData.archivedDate && typeof existingFrontmatter['archived'] === 'string') {
      mergedFrontmatter.archived = existingFrontmatter['archived'];
    }
    // Nor does it change which server row the note belongs to.
    const merged: Record<string, unknown> = mergedFrontmatter;
    for (const field of COMPOSED_POST_SYNC_FRONTMATTER_FIELDS) {
      const existing: unknown = existingFrontmatter[field];
      if (merged[field] === undefined && existing !== undefined) {
        merged[field] = existing;
      }
    }

    // Pattern: frontmatter -> body (text, [media], [embedded archives]) ->
    // interaction bar ("**Author:** … | **Published:** …") -> whatever other
    // writers appended later (AI comments, transcripts, place/product blocks,
    // annotations, downloaded-video embeds)
    const frontmatterEndMatch = existingContent.match(/^---\n[\s\S]*?\n---\n/);
    if (!frontmatterEndMatch) {
      throw new Error('Could not find frontmatter in existing file');
    }

    const frontmatterEndIndex = frontmatterEndMatch[0].length;
    const contentAfterFrontmatter = existingContent.substring(frontmatterEndIndex);

    // Find interaction bar ("---\n\n**Author:**")
    const interactionBarMatch = contentAfterFrontmatter.match(/\n---\n\n\*\*Author:\*\*/);
    if (!interactionBarMatch) {
      throw new Error('Could not find interaction bar in existing file');
    }

    // Extract user's post body (everything before interaction bar, excluding the divider)
    const contentBeforeInteractionBar = contentAfterFrontmatter.substring(0, interactionBarMatch.index);

    // Remove trailing divider (---) and whitespace from body
    const existingBody = contentBeforeInteractionBar.replace(/\n---\n\s*$/, '\n');

    // Everything after the interaction bar line stays after it. It used to be
    // moved above the bar behind a new `---`: a stray divider on every update
    // (a plain note has only "\n" there), and appended blocks pulled into the body.
    const interactionBarEndIndex = (interactionBarMatch.index ?? 0) + interactionBarMatch[0].length;
    const contentAfterInteractionBar = contentAfterFrontmatter.substring(interactionBarEndIndex);
    const interactionBarLineEnd = contentAfterInteractionBar.indexOf('\n');
    const afterInteractionBar = interactionBarLineEnd === -1
      ? ''
      : contentAfterInteractionBar.substring(interactionBarLineEnd + 1);

    // Extract embedded archives and interaction bar from newly generated markdown
    const newContentWithoutFrontmatter = markdown.fullDocument.replace(/^---\n[\s\S]*?\n---\n/, '');

    // Find "## Referenced Social Media Posts" section (or "## Embedded Archives")
    const referencedPostsMatch = newContentWithoutFrontmatter.match(/\n---\n\n## Referenced Social Media Posts\n[\s\S]*?(?=\n---\n\n\*\*Author:\*\*)/);
    const embeddedArchivesMatch = newContentWithoutFrontmatter.match(/\n---\n\n## Embedded Archives\n[\s\S]*?(?=\n---\n\n\*\*Author:\*\*)/);
    // The regenerated note ends at its author line. What convert() appends
    // below it (place and product blocks, transcript) is rebuilt from PostData
    // parsed out of this very note, so afterInteractionBar already has it —
    // taking both doubled it on every update.
    const newInteractionBarMatch = /\n---\n\n\*\*Author:\*\*[^\n]*/.exec(newContentWithoutFrontmatter);
    const regenerated = newInteractionBarMatch
      ? newContentWithoutFrontmatter.slice(0, newInteractionBarMatch.index + newInteractionBarMatch[0].length)
      : newContentWithoutFrontmatter;

    // Build new embedded archives section
    let newEmbeddedArchives = '';
    if (referencedPostsMatch) {
      newEmbeddedArchives = referencedPostsMatch[0];
    } else if (embeddedArchivesMatch) {
      newEmbeddedArchives = embeddedArchivesMatch[0];
    }

    // Build interaction bar
    let newInteractionBar = '';
    if (newInteractionBarMatch) {
      newInteractionBar = newInteractionBarMatch[0];
    }

    // The note's own archives section gives way to the regenerated one (with
    // none regenerated, it stays), which a kept body would otherwise repeat
    // below it. An archive this PostData lacks stays too, after the regenerated
    // ones: another job's, written after this PostData was parsed; a composer
    // edit drops what it dropped. Text in the section that is no archive's goes
    // back below the interaction bar.
    const section = replaceBody || newEmbeddedArchives ? readArchivesSection(existingBody) : null;
    const parsedUrls = new Set((postData.embeddedArchives ?? []).map((archive) => archive.url));
    const lacking = replaceBody ? [] : (section?.archives ?? []).filter((archive) => !parsedUrls.has(archive.url));
    const archivesSection = lacking.length === 0
      ? newEmbeddedArchives
      : `${[newEmbeddedArchives.trimEnd(), ...lacking.map((archive) => archive.text.trim())].join('\n\n---\n\n')}\n`;
    const strays = (section?.strays ?? []).join('\n\n');

    // Replaced: the regenerated note (edited text, kept + added media, embedded
    // archives, interaction bar). Kept: existing body + new embedded archives +
    // new interaction bar (newEmbeddedArchives already starts with '\n---\n').
    // ponytail: "replaced" is what the parser surfaced to the composer. A
    // section hand-added between the media and the author line never reaches
    // it, so an edit drops it; keep unrecognised sections if that bites.
    const throughInteractionBar = replaceBody
      ? regenerated
      : (section?.before ?? existingBody).trimEnd() + '\n' + archivesSection + newInteractionBar;
    const finalContent = `${throughInteractionBar.trimEnd()}\n${strays ? `\n${strays}\n` : ''}${afterInteractionBar}`;

    // Generate new frontmatter YAML
    const frontmatterYaml = stringifyYaml(mergedFrontmatter);

    const fullDocument = `---\n${frontmatterYaml}---\n${finalContent}`;

    return { fullDocument };
  }

  /**
   * Update frontmatter atomically using Obsidian API
   *
   * Uses app.fileManager.processFrontMatter for atomic operations
   * to prevent frontmatter corruption during concurrent updates.
   *
   * @param file - TFile to update
   * @param updates - Frontmatter fields to update
   */
  private async updateFrontmatter(
    file: TFile,
    updates: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        // Apply all updates to frontmatter
        for (const [key, value] of Object.entries(updates)) {
          frontmatter[key] = value;
        }
      });
    } catch (error) {
      throw new Error(
        `Failed to update frontmatter: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Update an existing post with new content and media
   *
   * This method orchestrates all update operations with transaction-like behavior:
   * 1. Validate inputs and get existing file
   * 2. Detect media changes (deletions and additions)
   * 3. Process media deletions from vault
   * 4. Save new media files
   * 5. Update markdown content with new media references
   * 6. Save updated content to file
   * 7. Update frontmatter with lastModified timestamp
   *
   * On failure, attempts to rollback media deletions.
   *
   * @param options - Update post options
   * @returns PostSaveResult with updated file and media information
   */
  async updatePost(options: UpdatePostOptions): Promise<PostSaveResult> {
    const { filePath, postData, mediaFiles = [], deletedMediaPaths = [], existingMedia = [], replaceBody = false } = options;

    // Step 1: Validate inputs and get existing file
    const existingFile = this.vault.getFileByPath(filePath);
    if (!existingFile) {
      throw new Error(`Post file not found: ${filePath}`);
    }

    // Track deleted files for potential rollback
    const deletedFiles: { path: string; content: ArrayBuffer }[] = [];
    const mediaSaved: MediaSaveResult[] = [];

    try {
      // Step 2: Detect media changes
      const changes = this.detectMediaChanges(existingMedia, deletedMediaPaths, mediaFiles);

      // Step 3: Process media deletions (backup for rollback)
      for (const mediaPath of changes.toDelete) {
        const file = this.vault.getFileByPath(mediaPath);
        if (file) {
          // Backup file content before deletion
          const content = await this.vault.readBinary(file);
          deletedFiles.push({ path: mediaPath, content });

          // Delete the file
          await this.app.fileManager.trashFile(file);
        }
      }

      // Step 4: Save new media files
      const timestamp = postData.metadata.timestamp instanceof Date
        ? postData.metadata.timestamp
        : new Date(postData.metadata.timestamp);

      // Extract postId from existing media path or generate new one
      let postId: string | undefined;
      if (existingMedia.length > 0 && existingMedia[0]) {
        // Extract postId from first media path (e.g., "attachments/social-archives/post/20251102-143052/image.png")
        const firstMediaPath = existingMedia[0].url;
        const match = firstMediaPath.match(/post\/([^/]+)\//);
        if (match) {
          postId = match[1];
        }
      }

      for (const file of changes.toAdd) {
        const result = await this.saveMedia(
          file,
          timestamp,
          postId,
          postData.metadata.timestamp
        );
        mediaSaved.push(result);

        if (result.error) {
          throw new Error(`Failed to save media ${file.name}: ${result.error}`);
        }
      }

      // Step 5: Update markdown content with new media references
      const markdown = await this.updateMarkdownContent(postData, changes.toKeep, mediaSaved, existingFile, replaceBody);

      // Step 6: Save updated content to file
      await this.vault.process(existingFile, () => markdown.fullDocument);

      // Step 7: Update frontmatter with lastModified timestamp
      await this.updateFrontmatter(existingFile, {
        lastModified: new Date().toISOString()
      });


      return {
        file: existingFile,
        path: existingFile.path,
        mediaSaved
      };

    } catch (error: unknown) {

      // Rollback: Restore deleted media files
      for (const deleted of deletedFiles) {
        try {
          await this.vault.createBinary(deleted.path, deleted.content);
        } catch {
          // best-effort rollback, ignore errors
        }
      }

      // Cleanup: Delete newly saved media files
      await this.cleanupMedia(mediaSaved);

      throw new Error(
        `Failed to update post: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Extract common timestamp parts for consistent formatting
   */
  private getTimestampParts(
    timestamp: Date,
    original?: Date | string
  ): {
    year: string;
    month: string;
    day: string;
    dateSegment: string;
    timeSegment: string;
  } {
    if (original && typeof original === 'string') {
      const match = original.match(
        /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/
      );

      if (match) {
        const [, rawYear = '', rawMonth = '', rawDay = '', rawHour = '', rawMinute = '', rawSecond = ''] = match;
        return {
          year: rawYear,
          month: rawMonth,
          day: rawDay,
          dateSegment: `${rawYear}-${rawMonth}-${rawDay}`,
          timeSegment: `${rawHour}${rawMinute}${rawSecond}`,
        };
      }
    }

    const m = window.moment(timestamp);

    return {
      year: m.format('YYYY'),
      month: m.format('MM'),
      day: m.format('DD'),
      dateSegment: m.format('YYYY-MM-DD'),
      timeSegment: m.format('HHmmss'),
    };
  }
}
