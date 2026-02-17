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
import { App, Vault, TFile, normalizePath } from 'obsidian';

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
        const uniquePath = await this.generateUniqueMediaPath(mediaPath);
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
  private async generateUniqueMediaPath(basePath: string): Promise<string> {
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
      .map(result => {
        // Get the TFile from vault
        const file = this.vault.getFileByPath(result.savedPath);

        return {
          originalUrl: result.url,
          localPath: result.savedPath,
          type: result.originalFile.type.startsWith('video/') ? 'video' as const : 'image' as const,
          size: result.originalFile.size,
          file: file!,
        };
      });

    // Convert PostData to Markdown with media results
    // IMPORTANT: convert() signature is (postData, customTemplate?, mediaResults?, options?)
    // Pass undefined for customTemplate to use default, then mediaResults
    const markdown = await this.markdownConverter.convert(postData, undefined, mediaResults);

    // Generate file path (use explicit targetFilePath, then PostData.url, then generate)
    // For subscription posts, targetFilePath is provided to avoid using URL as path
    const filePath = targetFilePath || (postData.url && !postData.url.startsWith('http') ? postData.url : this.generateFilePath(postData));

    // Ensure parent folder exists
    const parentPath = this.getParentPath(filePath);
    await this.vaultManager.createFolderIfNotExists(parentPath);

    // Save markdown file
    const file = await this.createOrUpdateFile(filePath, markdown.fullDocument);

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
      await this.vault.modify(existingFile, content);
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
        } catch (error) {
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
   * @returns Updated markdown content
   */
  private async updateMarkdownContent(
    postData: PostData,
    keptMedia: Media[],
    addedMedia: MediaSaveResult[],
    existingFile: TFile
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
    const mediaResults = addedMedia
      .filter(result => !result.error)
      .map(result => {
        const file = this.vault.getFileByPath(result.savedPath);
        return {
          originalUrl: result.url,
          localPath: result.savedPath,
          type: result.originalFile.type.startsWith('video/') ? 'video' as const : 'image' as const,
          size: result.originalFile.size,
          file: file!,
        };
      });

    // Also add kept media to mediaResults for proper markdown generation
    const keptMediaResults = keptMedia.map(media => {
      const file = this.vault.getFileByPath(media.url);
      return {
        originalUrl: media.url,
        localPath: media.url,
        type: media.type as 'image' | 'video',
        size: media.size || 0,
        file: file!,
      };
    });

    const allMediaResults = [...keptMediaResults, ...mediaResults];

    // Read existing file content to preserve user's post body
    const existingContent = await this.vault.read(existingFile);

    // Read existing frontmatter to preserve share-related fields
    const fileCache = this.app.metadataCache.getFileCache(existingFile);
    const existingFrontmatter = fileCache?.frontmatter || {};

    // Convert PostData to Markdown with updated media references
    // Pass undefined for customTemplate to use default
    const markdown = await this.markdownConverter.convert(postData, undefined, allMediaResults);

    // Merge existing frontmatter with new frontmatter
    // Preserve share-related fields AND download tracking (processedUrls comes from new data)
    const preservedFields = ['share', 'shareId', 'shareUrl', 'sharePassword', 'downloadedUrls', 'transcribedUrls'];
    const mergedFrontmatter: Record<string, any> = { ...markdown.frontmatter };

    for (const field of preservedFields) {
      if (existingFrontmatter[field] !== undefined) {
        mergedFrontmatter[field] = existingFrontmatter[field];
      }
    }

    // Extract existing body content and media gallery
    // Pattern: frontmatter -> body -> [embedded archives] -> media gallery -> interaction bar
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

    // Extract media gallery (everything after interaction bar line, before end of file)
    // Pattern: **Author:** ... \n\n [media gallery content]
    const interactionBarEndIndex = interactionBarMatch.index! + interactionBarMatch[0].length;
    const contentAfterInteractionBar = contentAfterFrontmatter.substring(interactionBarEndIndex);

    // Find where interaction bar content ends (after the "**Author: ... | Published: ..." line)
    // This is typically followed by blank lines and then media embeds
    const interactionBarLineEnd = contentAfterInteractionBar.indexOf('\n');
    let existingMediaGallery = '';
    if (interactionBarLineEnd !== -1) {
      existingMediaGallery = contentAfterInteractionBar.substring(interactionBarLineEnd);
    }

    // Extract embedded archives and interaction bar from newly generated markdown
    const newContentWithoutFrontmatter = markdown.fullDocument.replace(/^---\n[\s\S]*?\n---\n/, '');

    // Find "## Referenced Social Media Posts" section (or "## Embedded Archives")
    const referencedPostsMatch = newContentWithoutFrontmatter.match(/\n---\n\n## Referenced Social Media Posts\n[\s\S]*?(?=\n---\n\n\*\*Author:\*\*)/);
    const embeddedArchivesMatch = newContentWithoutFrontmatter.match(/\n---\n\n## Embedded Archives\n[\s\S]*?(?=\n---\n\n\*\*Author:\*\*)/);
    const newInteractionBarMatch = newContentWithoutFrontmatter.match(/\n---\n\n\*\*Author:\*\*[\s\S]*/);

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

    // Combine: existing body + new embedded archives + existing media gallery + new interaction bar
    // Note: newEmbeddedArchives already starts with '\n---\n'
    // If there's media gallery, we need a divider before it
    // If not, the interaction bar divider from newInteractionBar is used
    const finalContent = existingBody.trimEnd() + '\n' +
      (newEmbeddedArchives || '') +
      (existingMediaGallery ? '\n---\n' + existingMediaGallery.trimEnd() + '\n' : '') +
      newInteractionBar;

    // Generate new frontmatter YAML
    const frontmatterYaml = Object.entries(mergedFrontmatter)
      .map(([key, value]) => {
        if (typeof value === 'string') {
          // Escape quotes and wrap in quotes if contains special chars
          const needsQuotes = value.includes(':') || value.includes('#') || value.includes('\n');
          return `${key}: ${needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value}`;
        } else if (Array.isArray(value)) {
          return `${key}:\n${value.map(v => `  - ${v}`).join('\n')}`;
        } else if (typeof value === 'object' && value !== null) {
          return `${key}: ${JSON.stringify(value)}`;
        }
        return `${key}: ${value}`;
      })
      .join('\n');

    const fullDocument = `---\n${frontmatterYaml}\n---\n${finalContent}`;

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
    updates: Record<string, any>
  ): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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
    const { filePath, postData, mediaFiles = [], deletedMediaPaths = [], existingMedia = [] } = options;

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
      const markdown = await this.updateMarkdownContent(postData, changes.toKeep, mediaSaved, existingFile);

      // Step 6: Save updated content to file
      await this.vault.modify(existingFile, markdown.fullDocument);

      // Step 7: Update frontmatter with lastModified timestamp
      await this.updateFrontmatter(existingFile, {
        lastModified: new Date().toISOString()
      });


      return {
        file: existingFile,
        path: existingFile.path,
        mediaSaved
      };

    } catch (error) {

      // Rollback: Restore deleted media files
      for (const deleted of deletedFiles) {
        try {
          await this.vault.createBinary(deleted.path, deleted.content);
        } catch {
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

    const year = timestamp.getFullYear().toString();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getDate()).padStart(2, '0');
    const hours = String(timestamp.getHours()).padStart(2, '0');
    const minutes = String(timestamp.getMinutes()).padStart(2, '0');
    const seconds = String(timestamp.getSeconds()).padStart(2, '0');

    return {
      year,
      month,
      day,
      dateSegment: `${year}-${month}-${day}`,
      timeSegment: `${hours}${minutes}${seconds}`,
    };
  }
}
// @ts-nocheck
