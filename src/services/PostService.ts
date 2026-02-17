import { App, TFile, Vault, normalizePath } from 'obsidian';
import type { SocialArchiverSettings } from '@/types/settings';
import { TextFormatter } from './markdown/formatters/TextFormatter';
import { LinkPreviewExtractor } from './LinkPreviewExtractor';
import { encodePathForMarkdownLink } from '@/utils/url';

/**
 * Result of posting a note to the timeline
 */
export interface PostResult {
  success: boolean;
  copiedFilePath: string;
  copiedMediaPaths: string[];
  error?: string;
}

/**
 * Options for posting a note
 */
export interface PostOptions {
  /** If true, the note will also be shared after posting */
  generateShareLink?: boolean;
}

/**
 * Supported image extensions for attachment detection
 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif'
]);

/**
 * Supported video extensions for attachment detection
 */
const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'webm', 'avi', 'mkv'
]);

/**
 * PostService - Handles posting user notes to the Social Archiver timeline
 *
 * Single Responsibility: Copy notes and attachments to Social Archives folder
 * with proper frontmatter and path references
 */
export class PostService {
  private textFormatter: TextFormatter;
  private linkPreviewExtractor: LinkPreviewExtractor;

  constructor(
    private app: App,
    private vault: Vault,
    private settings: SocialArchiverSettings
  ) {
    this.textFormatter = new TextFormatter();
    this.linkPreviewExtractor = new LinkPreviewExtractor();
  }

  /**
   * Post a note to the timeline
   *
   * 1. Check for existing post (duplicate detection via originalPath)
   * 2. Copy note to Social Archives/Post/{year}/{month}/
   * 3. Copy attachments to settings.mediaPath/post/{postId}/
   * 4. Update media references in copied note
   * 5. Add/update frontmatter with platform: post, postedAt, originalPath
   */
  async postNote(file: TFile, options?: PostOptions): Promise<PostResult> {
    try {
      // Check for existing post
      const existingPost = this.findExistingPost(file.path);

      if (existingPost) {
        // Update existing post instead of creating new
        return await this.updateExistingPost(existingPost, file, options);
      }

      // Create new post
      return await this.createNewPost(file, options);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[PostService] Failed to post note:', errorMessage);
      return {
        success: false,
        copiedFilePath: '',
        copiedMediaPaths: [],
        error: errorMessage
      };
    }
  }

  /**
   * Create a new post from a note
   */
  private async createNewPost(file: TFile, _options?: PostOptions): Promise<PostResult> {
    const now = new Date();
    const postId = this.generatePostId(file, now);

    // Read source content
    const content = await this.vault.read(file);

    // Extract content without existing frontmatter
    const { body: bodyContent, existingFrontmatter } = this.extractFrontmatter(content);

    // Extract and copy attachments
    const attachmentPaths = this.extractAttachmentPaths(bodyContent);
    const pathMappings = await this.copyAttachments(attachmentPaths, postId, file);

    // Update content with new paths
    const updatedContent = this.updateMediaReferences(bodyContent, pathMappings);

    // Extract link previews
    const extractedLinks = this.linkPreviewExtractor.extractUrls(updatedContent);
    const linkPreviews = extractedLinks.map(l => l.url);

    // Generate frontmatter
    const frontmatter = this.generateFrontmatter({
      platform: 'post',
      postedAt: this.formatPostedAt(now),
      originalPath: file.path,
      author: this.settings.username || 'anonymous',
      archived: this.formatDate(now),
      lastModified: this.formatDate(now),
      tags: [],
      linkPreviews: linkPreviews.length > 0 ? linkPreviews : undefined,
      // Preserve any existing custom frontmatter fields
      ...existingFrontmatter
    });

    // Generate target path
    const targetPath = this.generatePostPath(file, now);

    // Ensure folder exists
    await this.ensureFolderExists(this.getParentPath(targetPath));

    // Build final content
    const finalContent = `---\n${frontmatter}---\n\n${updatedContent}`;

    // Create the file
    await this.vault.create(targetPath, finalContent);

    return {
      success: true,
      copiedFilePath: targetPath,
      copiedMediaPaths: [...pathMappings.values()]
    };
  }

  /**
   * Update an existing post with new content from source
   */
  private async updateExistingPost(
    existingPost: TFile,
    sourceFile: TFile,
    _options?: PostOptions
  ): Promise<PostResult> {
    const now = new Date();
    const postId = this.generatePostId(sourceFile, now);

    // Read source content
    const sourceContent = await this.vault.read(sourceFile);
    const { body: bodyContent } = this.extractFrontmatter(sourceContent);

    // Read existing post to preserve share fields
    const existingContent = await this.vault.read(existingPost);
    const { existingFrontmatter } = this.extractFrontmatter(existingContent);

    // Extract and copy new attachments
    const attachmentPaths = this.extractAttachmentPaths(bodyContent);
    const pathMappings = await this.copyAttachments(attachmentPaths, postId, sourceFile);

    // Update content with new paths
    const updatedContent = this.updateMediaReferences(bodyContent, pathMappings);

    // Extract link previews
    const extractedLinks = this.linkPreviewExtractor.extractUrls(updatedContent);
    const linkPreviews = extractedLinks.map(l => l.url);

    // Generate updated frontmatter (preserve share fields from existing)
    const frontmatter = this.generateFrontmatter({
      platform: 'post',
      postedAt: this.formatPostedAt(now), // Update timestamp
      originalPath: sourceFile.path,
      author: this.settings.username || 'anonymous',
      archived: existingFrontmatter.archived || this.formatDate(now),
      lastModified: this.formatDate(now),
      tags: [],
      linkPreviews: linkPreviews.length > 0 ? linkPreviews : undefined,
      // Preserve share fields from existing post
      share: existingFrontmatter.share,
      shareUrl: existingFrontmatter.shareUrl,
      shareMode: existingFrontmatter.shareMode,
      sharePassword: existingFrontmatter.sharePassword,
      // Preserve other custom fields
      ...existingFrontmatter
    });

    // Build final content
    const finalContent = `---\n${frontmatter}---\n\n${updatedContent}`;

    // Update the file
    await this.vault.modify(existingPost, finalContent);

    return {
      success: true,
      copiedFilePath: existingPost.path,
      copiedMediaPaths: [...pathMappings.values()]
    };
  }

  /**
   * Find existing post by originalPath in frontmatter
   */
  private findExistingPost(originalPath: string): TFile | null {
    const postFolder = `${this.settings.archivePath}/Post`;

    // Filter to Post folder first to avoid scanning entire vault
    const postFiles = this.vault.getMarkdownFiles().filter(f => f.path.startsWith(postFolder));

    for (const file of postFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.originalPath === originalPath) {
        return file;
      }
    }

    return null;
  }

  /**
   * Extract attachment paths from note content
   * Patterns: ![[image.png]], ![[folder/image.jpg]], ![alt](./image.png)
   */
  private extractAttachmentPaths(content: string): string[] {
    const paths: string[] = [];

    // Pattern 1: Wikilinks - ![[image.png]] or ![[folder/image.png]] or ![[image.png|alt]]
    const wikiLinkRegex = /!\[\[([^\]|]+)(?:\|[^\]]*)?]]/g;
    let match;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const path = match[1];
      if (path && this.isMediaFile(path)) {
        paths.push(path);
      }
    }

    // Pattern 2: Markdown images - ![alt](path) or ![](path)
    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = markdownImageRegex.exec(content)) !== null) {
      const path = match[2];
      // Skip external URLs
      if (path && this.isMediaFile(path) && !path.startsWith('http://') && !path.startsWith('https://')) {
        paths.push(path);
      }
    }

    // Deduplicate
    return [...new Set(paths)];
  }

  /**
   * Check if a path is a media file
   */
  private isMediaFile(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
  }

  /**
   * Copy attachments to media folder
   * Returns mapping of original path to new path
   */
  private async copyAttachments(
    attachmentPaths: string[],
    postId: string,
    sourceFile: TFile
  ): Promise<Map<string, string>> {
    const pathMappings = new Map<string, string>();

    for (const attachmentPath of attachmentPaths) {
      try {
        // Resolve path relative to source file
        const resolvedPath = this.resolveAttachmentPath(attachmentPath, sourceFile);
        const sourceAttachment = this.vault.getAbstractFileByPath(resolvedPath);

        if (sourceAttachment && sourceAttachment instanceof TFile) {
          // Generate target path in media folder
          const targetPath = this.generateMediaPath(postId, sourceAttachment.name);

          // Check if target already exists
          const existingFile = this.vault.getAbstractFileByPath(targetPath);
          if (existingFile) {
            // Use existing file path
            pathMappings.set(attachmentPath, targetPath);
            continue;
          }

          // Ensure folder exists
          await this.ensureFolderExists(this.getParentPath(targetPath));

          // Copy file
          const binaryContent = await this.vault.readBinary(sourceAttachment);
          await this.vault.createBinary(targetPath, binaryContent);

          pathMappings.set(attachmentPath, targetPath);
        }
      } catch (error) {
        console.warn(`[PostService] Failed to copy attachment ${attachmentPath}:`, error);
        // Continue with other attachments
      }
    }

    return pathMappings;
  }

  /**
   * Resolve attachment path relative to source file
   */
  private resolveAttachmentPath(path: string, sourceFile: TFile): string {
    // Handle relative paths (./image.png, ../folder/image.png)
    if (path.startsWith('./') || path.startsWith('../')) {
      const sourceDir = this.getParentPath(sourceFile.path);
      return normalizePath(`${sourceDir}/${path}`);
    }

    // Try to resolve via Obsidian's link resolution
    const resolved = this.app.metadataCache.getFirstLinkpathDest(path, sourceFile.path);
    if (resolved) {
      return resolved.path;
    }

    // Return as-is (might be absolute path)
    return normalizePath(path);
  }

  /**
   * Update media references in content
   * Replace original paths with new paths
   */
  private updateMediaReferences(content: string, pathMappings: Map<string, string>): string {
    let updatedContent = content;

    for (const [oldPath, newPath] of pathMappings) {
      // Replace wikilink format: ![[oldPath]] or ![[oldPath|alt]]
      const wikiLinkRegex = new RegExp(
        `!\\[\\[${this.escapeRegex(oldPath)}(\\|[^\\]]*)?]]`,
        'g'
      );
      updatedContent = updatedContent.replace(wikiLinkRegex, `![[${newPath}$1]]`);

      // Replace markdown format: ![alt](oldPath) - match both raw and percent-encoded paths
      const encodedOldPath = encodePathForMarkdownLink(oldPath);
      const markdownPattern = oldPath === encodedOldPath
        ? this.escapeRegex(oldPath)
        : `(?:${this.escapeRegex(oldPath)}|${this.escapeRegex(encodedOldPath)})`;
      const markdownRegex = new RegExp(
        `!\\[([^\\]]*)\\]\\(${markdownPattern}\\)`,
        'g'
      );
      updatedContent = updatedContent.replace(markdownRegex, `![$1](${encodePathForMarkdownLink(newPath)})`);
    }

    return updatedContent;
  }

  /**
   * Generate target path for posted note
   * Format: {archivePath}/Post/{year}/{month}/{original-filename}.md
   */
  private generatePostPath(file: TFile, timestamp: Date): string {
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');

    return normalizePath(
      `${this.settings.archivePath}/Post/${year}/${month}/${file.name}`
    );
  }

  /**
   * Generate media path for attachments
   * Format: {mediaPath}/post/{postId}/{filename}
   */
  private generateMediaPath(postId: string, filename: string): string {
    return normalizePath(
      `${this.settings.mediaPath}/post/${postId}/${filename}`
    );
  }

  /**
   * Generate unique post ID from file and timestamp
   */
  private generatePostId(file: TFile, timestamp: Date): string {
    const dateStr = this.formatDate(timestamp).replace(/-/g, '');
    const fileHash = this.hashString(file.path).slice(0, 6);
    return `${dateStr}-${fileHash}`;
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Format postedAt timestamp as YYYY-MM-DD HH:mm
   */
  private formatPostedAt(date: Date): string {
    const dateStr = this.formatDate(date);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${dateStr} ${hours}:${minutes}`;
  }


  /**
   * Generate YAML frontmatter string
   */
  private generateFrontmatter(data: Record<string, unknown>): string {
    const lines: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${this.formatYamlValue(item)}`);
        }
      } else if (typeof value === 'object') {
        // Skip nested objects for simplicity
        continue;
      } else {
        lines.push(`${key}: ${this.formatYamlValue(value)}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Format a value for YAML
   */
  private formatYamlValue(value: unknown): string {
    if (typeof value === 'string') {
      // Quote strings that contain special characters
      if (value.includes(':') || value.includes('#') || value.includes('"') ||
          value.includes("'") || value.includes('\n') || value.startsWith(' ')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
      return String(value);
    }
    return String(value);
  }

  /**
   * Extract frontmatter and body from content
   */
  private extractFrontmatter(content: string): {
    body: string;
    existingFrontmatter: Record<string, unknown>;
  } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { body: content, existingFrontmatter: {} };
    }

    const frontmatterStr = match[1] ?? '';
    const body = content.slice(match[0].length);

    // Parse simple YAML frontmatter
    const existingFrontmatter: Record<string, unknown> = {};
    const lines = frontmatterStr.split('\n');
    let currentKey: string | null = null;
    let currentArray: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('- ') && currentKey) {
        // Array item
        currentArray.push(trimmed.slice(2));
      } else if (line.includes(':')) {
        // Save previous array if exists
        if (currentKey && currentArray.length > 0) {
          existingFrontmatter[currentKey] = currentArray;
          currentArray = [];
        }

        const colonIndex = line.indexOf(':');
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();

        if (value === '') {
          // Might be start of array
          currentKey = key;
        } else {
          // Simple value
          existingFrontmatter[key] = this.parseYamlValue(value);
          currentKey = null;
        }
      }
    }

    // Save last array if exists
    if (currentKey && currentArray.length > 0) {
      existingFrontmatter[currentKey] = currentArray;
    }

    return { body, existingFrontmatter };
  }

  /**
   * Parse a YAML value
   */
  private parseYamlValue(value: string): unknown {
    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Number
    const num = Number(value);
    if (!isNaN(num) && value !== '') return num;

    return value;
  }

  /**
   * Ensure folder exists, creating parent folders as needed
   */
  private async ensureFolderExists(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);

    // Check if folder already exists
    const existing = this.vault.getFolderByPath(normalizedPath);
    if (existing) return;

    // Create parent folders recursively
    const parentPath = this.getParentPath(normalizedPath);
    if (parentPath && parentPath !== '.') {
      await this.ensureFolderExists(parentPath);
    }

    // Create this folder
    try {
      await this.vault.createFolder(normalizedPath);
    } catch (error) {
      // Folder might have been created by another operation
      const folder = this.vault.getFolderByPath(normalizedPath);
      if (!folder) throw error;
    }
  }

  /**
   * Get parent path from file path
   */
  private getParentPath(path: string): string {
    const parts = path.split('/');
    if (parts.length <= 1) return '.';
    return parts.slice(0, -1).join('/');
  }

  /**
   * Escape string for use in regex
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
