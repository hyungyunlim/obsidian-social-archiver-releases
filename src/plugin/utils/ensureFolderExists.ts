import { normalizePath, type App } from 'obsidian';

/**
 * Recursively ensure that all segments of a folder path exist in the vault.
 * Creates any missing intermediate folders, tolerating race-condition
 * "already exists" errors from concurrent operations.
 */
export async function ensureFolderExists(app: App, path: string): Promise<void> {
  const normalizedPath = normalizePath(path).replace(/^\/+|\/+$/g, '');
  if (!normalizedPath) {
    return;
  }

  const parts = normalizedPath.split('/').filter(Boolean);
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;

    const existing = app.vault.getFolderByPath(currentPath);
    if (!existing) {
      try {
        await app.vault.createFolder(currentPath);
      } catch (error) {
        const errorMessage = String(error).toLowerCase();
        if (errorMessage.includes('already exists') || errorMessage.includes('eexist')) {
          continue;
        }
        // Folder might have been created by another operation
        const folder = app.vault.getFolderByPath(currentPath);
        if (!folder) {
          throw error;
        }
      }
    }
  }
}
