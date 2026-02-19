/**
 * Compute a vault-relative media path from the output file's location.
 *
 * Obsidian notes live at varying depths inside the vault
 * (e.g. `Social Archives/Facebook/2026/02/file.md` = 4 levels,
 *  `Social Archives/Subscriptions/Facebook/2026/02/file.md` = 5 levels).
 * This helper produces the correct number of `../` prefixes so that
 * `![img](../../../attachments/...)` always resolves back to vault root.
 *
 * @param mediaPath     - Vault-root-relative media path (e.g. `attachments/social-archives/...`)
 * @param outputFilePath - Vault-root-relative path of the markdown file being written.
 *                         When omitted the legacy 4-level fallback (`../../../../`) is used.
 * @returns A relative path string suitable for embedding in markdown.
 */
export function toRelativeMediaPath(
  mediaPath: string,
  outputFilePath?: string,
): string {
  // Only rewrite paths that live under the vault's attachments folder.
  // External URLs and other references pass through unchanged.
  if (!mediaPath.startsWith('attachments/')) return mediaPath;

  if (!outputFilePath) {
    // Legacy fallback — assumes the default 4-level layout.
    return `../../../../${mediaPath}`;
  }

  // Number of directory segments = total segments minus the filename.
  const depth = outputFilePath.split('/').length - 1;
  const prefix = '../'.repeat(depth);
  return `${prefix}${mediaPath}`;
}
