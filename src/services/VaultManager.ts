import type { IService } from './base/IService';
import type { PostData } from '@/types/post';
import type { MarkdownResult } from './MarkdownConverter';
import { App, Vault, TFile, TFolder, normalizePath } from 'obsidian';
import { getPlatformName } from '@/shared/platforms';

/**
 * VaultManager configuration
 */
export interface VaultManagerConfig {
  vault: Vault;
  app?: App;
  basePath?: string;
  organizationStrategy?: 'platform' | 'platform-only' | 'date' | 'flat';
}

/**
 * File save result
 */
export interface SaveResult {
  file: TFile;
  path: string;
  created: boolean;
}

/**
 * Path generator for organizing archived posts
 */
class PathGenerator {
  private basePath: string;
  private strategy: 'platform' | 'platform-only' | 'date' | 'flat';

  constructor(
    basePath: string = 'Social Archives',
    strategy: 'platform' | 'platform-only' | 'date' | 'flat' = 'platform'
  ) {
    this.basePath = basePath;
    this.strategy = strategy;
  }

  /**
   * Generate file path for a post
   */
  generatePath(postData: PostData): string {
    const filename = this.generateFilename(postData);

    switch (this.strategy) {
      case 'platform':
        return this.generatePlatformPath(postData, filename);
      case 'platform-only':
        return this.generatePlatformOnlyPath(postData, filename);
      case 'date':
        return this.generateDatePath(postData, filename);
      case 'flat':
        return this.generateFlatPath(filename);
      default:
        return this.generatePlatformPath(postData, filename);
    }
  }

  /**
   * Generate filename from post data
   * Includes postId suffix for platforms with potentially duplicate titles (Pinterest, etc.)
   */
  private generateFilename(postData: PostData): string {
    const date = this.formatDate(postData.metadata.timestamp);
    const author = this.sanitizeFilename(postData.author.name);

    // For Google Maps: author name IS the place name, so no need for title or postId
    if (postData.platform === 'googlemaps') {
      return `${date} - ${author}.md`;
    }

    // Use postData.title if available (YouTube/TikTok videos), otherwise extract from content
    let title: string;
    if (postData.title && postData.title.trim().length > 0) {
      title = this.sanitizeFilename(postData.title.length > 50
        ? postData.title.substring(0, 50) + '...'
        : postData.title);
    } else {
      // Extract meaningful title from content, skipping lines starting with symbols
      title = this.extractMeaningfulTitle(postData.content.text);
    }

    // Append short postId suffix for uniqueness (especially for Pinterest, Instagram, etc.)
    // Use last 6 characters of postId to avoid conflicts while keeping filename readable
    const postIdSuffix = postData.id ? ` (${postData.id.slice(-6)})` : '';

    return `${date} - ${author} - ${title}${postIdSuffix}.md`;
  }

  /**
   * Extract meaningful title from post content
   * Skips lines starting with symbols (-, •, *, #, @, etc.) or emojis
   */
  private extractMeaningfulTitle(text: string): string {
    const lines = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // Regex to detect lines starting with common symbols or emojis
    const symbolPattern = /^[-•*#@[\](){}<>|/\\`~!+=_.,:;'"…]+\s*/;
    const emojiPattern = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

    // Find first line that doesn't start with symbols or emojis
    for (const line of lines) {
      const cleanedLine = line.replace(symbolPattern, '').trim();

      if (cleanedLine.length === 0) continue; // Skip if only symbols
      if (emojiPattern.test(cleanedLine)) continue; // Skip if starts with emoji

      // Found a meaningful line
      const title = cleanedLine.length > 50
        ? cleanedLine.substring(0, 50) + '...'
        : cleanedLine;

      return this.sanitizeFilename(title);
    }

    // Fallback: use first line if no meaningful line found
    const firstLine = lines[0] || 'Untitled Post';
    const title = firstLine.length > 50
      ? firstLine.substring(0, 50) + '...'
      : firstLine;

    return this.sanitizeFilename(title);
  }

  /**
   * Generate path organized by platform
   * Format: Social Archives/{platform}/{year}/{month}/filename.md
   * Uses publish date from post metadata
   */
  private generatePlatformPath(postData: PostData, filename: string): string {
    const publishDate = typeof postData.metadata.timestamp === 'string'
      ? new Date(postData.metadata.timestamp)
      : postData.metadata.timestamp;
    const year = publishDate.getFullYear();
    const month = String(publishDate.getMonth() + 1).padStart(2, '0');
    // Use displayName from platform definitions (e.g., 'naver-webtoon' -> 'Naver Webtoon')
    const platform = getPlatformName(postData.platform);

    return normalizePath(`${this.basePath}/${platform}/${year}/${month}/${filename}`);
  }

  /**
   * Generate path organized by platform only
   * Format: Social Archives/{platform}/filename.md
   */
  private generatePlatformOnlyPath(postData: PostData, filename: string): string {
    const platform = getPlatformName(postData.platform);
    return normalizePath(`${this.basePath}/${platform}/${filename}`);
  }

  /**
   * Generate path organized by date
   * Format: Social Archives/{year}/{month}/{day}/filename.md
   * Uses publish date from post metadata
   */
  private generateDatePath(postData: PostData, filename: string): string {
    const publishDate = typeof postData.metadata.timestamp === 'string'
      ? new Date(postData.metadata.timestamp)
      : postData.metadata.timestamp;
    const year = publishDate.getFullYear();
    const month = String(publishDate.getMonth() + 1).padStart(2, '0');
    const day = String(publishDate.getDate()).padStart(2, '0');

    return normalizePath(`${this.basePath}/${year}/${month}/${day}/${filename}`);
  }

  /**
   * Generate flat path (all in base directory)
   */
  private generateFlatPath(filename: string): string {
    return normalizePath(`${this.basePath}/${filename}`);
  }

  /**
   * Format date as YYYY-MM-DD
   * Handles both Date objects and ISO string timestamps
   */
  private formatDate(date: Date | string): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Sanitize filename by removing invalid characters
   * Also handles Windows-specific issues like consecutive dots and invisible Unicode characters
   */
  private sanitizeFilename(name: string): string {
    // Remove or replace invalid filename characters
    return name
      // Remove invisible Unicode characters (Zero-Width Space, Non-Breaking Space, etc.)
      .replace(/[\u200B-\u200D\u2060\u00A0\uFEFF\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/[\\/:*?"<>|]/g, '-')
      // Replace consecutive dots (e.g., "...") with a single dash - Windows doesn't like multiple dots
      .replace(/\.{2,}/g, '-')
      // Replace multiple consecutive dashes with single dash
      .replace(/-{2,}/g, '-')
      // Normalize whitespace (including any remaining special spaces)
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/**
 * VaultManager - Handles all Obsidian Vault file operations
 *
 * Single Responsibility: Vault file management
 */
export class VaultManager implements IService {
  private vault: Vault;
  private app: App | undefined;
  private pathGenerator: PathGenerator;

  constructor(config: VaultManagerConfig) {
    this.vault = config.vault;
    this.app = config.app;
    this.pathGenerator = new PathGenerator(
      config.basePath,
      config.organizationStrategy
    );
  }

  async initialize(): Promise<void> {
    // Verify vault is accessible
    try {
      this.vault.getRoot();
    } catch (error) {
      throw new Error('Vault is not accessible');
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Check if service is healthy
   */
  isHealthy(): boolean {
    try {
      this.vault.getRoot();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate file path for a post (without saving)
   * Useful for preliminary document creation
   */
  generateFilePath(postData: PostData, timestamp?: Date): string {
    // Use provided timestamp or current time for temporary files
    const postDataWithTimestamp = timestamp ? {
      ...postData,
      metadata: {
        ...postData.metadata,
        timestamp
      }
    } : postData;

    return this.pathGenerator.generatePath(postDataWithTimestamp);
  }

  /**
   * Save a post to the vault
   */
  async savePost(postData: PostData, markdown: MarkdownResult): Promise<string> {
    // Generate path
    const path = this.pathGenerator.generatePath(postData);

    // Ensure parent folder exists
    await this.ensureFolderExists(this.getParentPath(path));

    // Handle existing file
    const existingFile = this.vault.getFileByPath(path);
    if (existingFile) {
      // Generate unique path
      const uniquePath = await this.generateUniquePath(path);
      const file = await this.createFile(uniquePath, markdown.fullDocument);
      return file.path;
    }

    // Create new file
    const file = await this.createFile(path, markdown.fullDocument);
    return file.path;
  }

  /**
   * Create a file with atomic write
   */
  private async createFile(path: string, content: string): Promise<TFile> {
    try {
      const file = await this.vault.create(path, content);
      return file;
    } catch (error) {
      throw new Error(
        `Failed to create file at ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Update an existing note
   */
  async updateNote(file: TFile, content: string): Promise<void> {
    try {
      await this.vault.modify(file, content);
    } catch (error) {
      throw new Error(
        `Failed to update file ${file.path}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if file exists at path
   */
  async fileExists(path: string): Promise<boolean> {
    return this.vault.getFileByPath(path) !== null;
  }

  /**
   * Create folder if it doesn't exist (recursive)
   */
  async createFolderIfNotExists(path: string): Promise<void> {
    await this.ensureFolderExists(path);
  }

  /**
   * Ensure folder exists, creating parent folders as needed
   */
  private async ensureFolderExists(path: string): Promise<TFolder> {
    const normalizedPath = normalizePath(path);

    // Check if folder already exists
    const existing = this.vault.getFolderByPath(normalizedPath);
    if (existing) {
      return existing;
    }

    // Create parent folders recursively
    const parentPath = this.getParentPath(normalizedPath);
    if (parentPath && parentPath !== '.') {
      await this.ensureFolderExists(parentPath);
    }

    // Create this folder
    try {
      return await this.vault.createFolder(normalizedPath);
    } catch (error) {
      // "Folder already exists" is benign — the folder is there, just swallow it.
      // Obsidian's internal cache may lag behind the filesystem, so getFolderByPath
      // can return null even when createFolder confirms the folder exists.
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Folder already exists')) {
        // Try to return the folder reference if available
        const folder = this.vault.getFolderByPath(normalizedPath);
        if (folder) return folder;
        const abstract = this.vault.getAbstractFileByPath(normalizedPath);
        if (abstract instanceof TFolder) return abstract;
        // Folder exists on disk but Obsidian's cache hasn't caught up — return parent
        const parent = this.vault.getFolderByPath(this.getParentPath(normalizedPath));
        return parent ?? this.vault.getRoot();
      }
      // For other errors, check if folder was created by a concurrent operation
      const folder = this.vault.getFolderByPath(normalizedPath);
      if (folder) return folder;
      throw error;
    }
  }

  /**
   * Generate unique path by appending number
   */
  async generateUniquePath(basePath: string): Promise<string> {
    const extension = '.md';
    const pathWithoutExt = basePath.endsWith(extension)
      ? basePath.slice(0, -extension.length)
      : basePath;

    const pathExists = (path: string): boolean => (
      this.vault.getFileByPath(path) !== null || this.vault.getFolderByPath(path) !== null
    );

    // First check if base path is available (as file or folder)
    if (!pathExists(basePath)) {
      return basePath;
    }

    // Otherwise, append numbers until we find an available path
    let counter = 1;
    let uniquePath = `${pathWithoutExt} ${counter}${extension}`;

    while (pathExists(uniquePath)) {
      counter++;
      uniquePath = `${pathWithoutExt} ${counter}${extension}`;
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
   * Delete a file (respects user's trash preference via fileManager)
   */
  async deleteFile(file: TFile): Promise<void> {
    try {
      if (this.app) {
        await this.app.fileManager.trashFile(file);
      } else {
        await this.vault.delete(file);
      }
    } catch (error) {
      throw new Error(
        `Failed to delete file ${file.path}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Move file to trash (respects user's trash preference via fileManager)
   */
  async trashFile(file: TFile): Promise<void> {
    try {
      if (this.app) {
        await this.app.fileManager.trashFile(file);
      } else {
        await this.vault.trash(file, true);
      }
    } catch (error) {
      throw new Error(
        `Failed to trash file ${file.path}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Read file content
   */
  async readFile(file: TFile): Promise<string> {
    try {
      return await this.vault.read(file);
    } catch (error) {
      throw new Error(
        `Failed to read file ${file.path}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get file by path
   */
  getFileByPath(path: string): TFile | null {
    return this.vault.getFileByPath(path);
  }

  /**
   * List all files in a folder
   */
  async listFiles(folderPath: string): Promise<TFile[]> {
    const folder = this.vault.getFolderByPath(folderPath);
    if (!folder) {
      return [];
    }

    const files: TFile[] = [];
    const traverse = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFile) {
          files.push(child);
        } else if (child instanceof TFolder) {
          traverse(child);
        }
      }
    };

    traverse(folder);
    return files;
  }

  /**
   * Get vault statistics
   */
  async getStats(): Promise<{
    totalFiles: number;
    totalSize: number;
  }> {
    const allFiles = this.vault.getFiles();
    const totalSize = allFiles.reduce((sum, file) => sum + file.stat.size, 0);

    return {
      totalFiles: allFiles.length,
      totalSize,
    };
  }
}
