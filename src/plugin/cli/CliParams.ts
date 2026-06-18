/**
 * CliParams — host-agnostic primitives are re-exported from the shared
 * `@social-archiver/cli-core` package; the Obsidian-specific path helpers
 * (`parseVaultPath` resolves against `App.vault`) stay local here.
 *
 * Single source of truth for flag parsing, shared with the desktop CLI.
 */

import type { App, TAbstractFile } from 'obsidian';
import {
  CliValidationError,
  containsTraversal,
  normalizeWorkspacePath,
  parseString,
  type CliParams,
} from '@social-archiver/cli-core';

// Re-export the host-agnostic surface (unchanged for existing importers).
export {
  CliValidationError,
  parseBool,
  parseEnum,
  parseNumber,
  parseCsv,
  parseString,
  containsTraversal,
  // Obsidian/legacy alias for the workspace-path normalizer.
  normalizeWorkspacePath as normalizeVaultPath,
} from '@social-archiver/cli-core';

export type {
  CliParamValue,
  CliParams,
  ParseEnumOptions,
  ParseNumberOptions,
  ParseStringOptions,
} from '@social-archiver/cli-core';

// ---------------------------------------------------------------------------
// Obsidian-specific path parsers (App / vault) — kept local.
// ---------------------------------------------------------------------------

export interface ParseVaultPathOptions {
  required?: boolean;
  mustExist?: boolean;
  default?: string;
}

/**
 * Parse a flag as a vault-relative path. Rejects `..` traversal and absolute
 * paths, normalizes separators. When `mustExist=true`, asserts the path
 * resolves against the supplied Obsidian `App` vault.
 */
export function parseVaultPath(
  p: CliParams,
  key: string,
  app: App,
  opts: ParseVaultPathOptions & { required: true },
): string;
export function parseVaultPath(
  p: CliParams,
  key: string,
  app: App,
  opts?: ParseVaultPathOptions,
): string | undefined;
export function parseVaultPath(
  p: CliParams,
  key: string,
  app: App,
  opts: ParseVaultPathOptions = {},
): string | undefined {
  const raw = parseString(p, key, { required: opts.required, default: opts.default });
  if (raw === undefined) return undefined;
  const normalized = normalizeWorkspacePath(raw);
  if (normalized.startsWith('/')) {
    throw new CliValidationError(key, `'${key}' must be a vault-relative path, not an absolute path.`);
  }
  if (containsTraversal(normalized)) {
    throw new CliValidationError(key, `'${key}' contains parent-directory traversal ('..'), refusing.`);
  }
  if (opts.mustExist) {
    const file: TAbstractFile | null = app.vault.getAbstractFileByPath(normalized);
    if (!file) {
      throw new CliValidationError(key, `Vault path '${normalized}' does not exist.`);
    }
  }
  return normalized;
}

export interface ParseAbsolutePathOptions {
  required?: boolean;
  default?: string;
  /** Reserved option (no-op); desktop-only enforcement happens in services. */
  desktopOnly?: boolean;
}

/**
 * Parse a flag as an absolute filesystem path (e.g. Instagram ZIP import).
 * Does not touch the filesystem.
 */
export function parseAbsolutePath(
  p: CliParams,
  key: string,
  opts: ParseAbsolutePathOptions = {},
): string | undefined {
  const raw = parseString(p, key, { required: opts.required, default: opts.default });
  if (raw === undefined) return undefined;
  const normalized = raw.replace(/\\/g, '/');
  const isUnixAbs = normalized.startsWith('/');
  const isWinAbs = /^[A-Za-z]:[\\/]/.test(raw);
  if (!isUnixAbs && !isWinAbs) {
    throw new CliValidationError(key, `'${key}' must be an absolute path (got '${raw}').`);
  }
  return raw;
}
