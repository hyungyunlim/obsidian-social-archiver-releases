/**
 * Media conversion utilities for edit mode
 *
 * Converts Vault TFile objects to browser File/Blob objects
 * for PostComposer preview and editing.
 */

import { TFile, Vault } from 'obsidian';

/**
 * Convert TFile to Blob for preview
 *
 * @param vault - Obsidian Vault instance
 * @param file - TFile to convert
 * @returns Promise<Blob> - Blob object for preview
 */
export async function convertTFileToBlob(vault: Vault, file: TFile): Promise<Blob> {
  try {
    // Read binary data from vault
    const arrayBuffer = await vault.readBinary(file);

    // Determine MIME type from file extension
    const mimeType = getMimeTypeFromExtension(file.extension);

    // Create Blob with appropriate MIME type
    const blob = new Blob([arrayBuffer], { type: mimeType });

    return blob;
  } catch (error) {
    throw new Error(`Failed to convert file ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert TFile to browser File object
 *
 * @param vault - Obsidian Vault instance
 * @param file - TFile to convert
 * @returns Promise<File> - File object for form submission
 */
export async function convertTFileToFile(vault: Vault, file: TFile): Promise<File> {
  try {
    const blob = await convertTFileToBlob(vault, file);

    // Create File object from Blob
    const browserFile = new File([blob], file.name, {
      type: blob.type,
      lastModified: file.stat.mtime
    });

    return browserFile;
  } catch (error) {
    throw new Error(`Failed to convert file ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create object URL for blob preview
 *
 * @param blob - Blob to create URL for
 * @returns string - Object URL for preview
 */
export function createObjectURL(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * Revoke object URL to prevent memory leaks
 *
 * @param url - Object URL to revoke
 */
export function revokeObjectURL(url: string): void {
  URL.revokeObjectURL(url);
}

/**
 * Get MIME type from file extension
 *
 * @param extension - File extension (without dot)
 * @returns string - MIME type
 */
function getMimeTypeFromExtension(extension: string): string {
  const mimeTypes: Record<string, string> = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'ico': 'image/x-icon',

    // Videos
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'ogv': 'video/ogg',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',

    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'oga': 'audio/ogg',
    'm4a': 'audio/mp4',

    // Default
    '': 'application/octet-stream'
  };

  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * Load media files from vault for edit mode
 *
 * @param vault - Obsidian Vault instance
 * @param mediaPaths - Array of media file paths
 * @returns Promise<MediaLoadResult[]> - Array of loaded media with preview URLs
 */
export interface MediaLoadResult {
  path: string;
  file: File | null;
  previewUrl: string | null;
  error?: string;
}

export async function loadMediaFiles(
  vault: Vault,
  mediaPaths: string[]
): Promise<MediaLoadResult[]> {
  const results: MediaLoadResult[] = [];

  for (const path of mediaPaths) {
    try {
      // Normalize path: remove leading "../" prefixes (obsidian markdown relative paths)
      // Convert: ../../../../attachments/... -> attachments/...
      const normalizedPath = path.replace(/^(\.\.\/)+/, '');

      const tfile = vault.getFileByPath(normalizedPath);

      if (!tfile) {
        // File not found - provide placeholder
        results.push({
          path,
          file: null,
          previewUrl: null,
          error: 'File not found in vault'
        });
        continue;
      }

      // Convert to File object
      const file = await convertTFileToFile(vault, tfile);

      // Create preview URL
      const previewUrl = createObjectURL(file);

      results.push({
        path,
        file,
        previewUrl
      });
    } catch (error) {
      results.push({
        path,
        file: null,
        previewUrl: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
}

/**
 * Cleanup all preview URLs to prevent memory leaks
 *
 * @param results - Array of MediaLoadResult with preview URLs
 */
export function cleanupMediaPreviews(results: MediaLoadResult[]): void {
  for (const result of results) {
    if (result.previewUrl) {
      revokeObjectURL(result.previewUrl);
    }
  }
}
