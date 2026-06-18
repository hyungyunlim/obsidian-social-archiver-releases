/**
 * CliParams — host-agnostic helpers that parse CLI flag values
 * (`Record<string, string | undefined>`) into typed shapes for handlers.
 *
 * Ported from `src/plugin/cli/CliParams.ts`. The ONE Obsidian coupling in the
 * plugin version — `parseVaultPath(p, key, app, opts)` resolving existence
 * against `App.vault` — is replaced here by an injected `PathResolver` so the
 * contract stays free of any host. The Node CLI supplies a filesystem/DB-backed
 * resolver; tests supply an in-memory one.
 *
 * Conventions:
 *   - Bare flags arrive as the literal string `'true'`.
 *   - Missing flags are `undefined`.
 *   - All parsers throw `CliValidationError` on bad input so handlers can
 *     surface a structured `INVALID_ARGUMENT` response.
 */

import { ErrorCode } from './response';

export type CliParamValue = string | undefined;
export type CliParams = Record<string, CliParamValue>;

/**
 * Resolves whether a workspace-relative path exists. Host-provided so the
 * parser never imports Obsidian/Tauri/fs directly.
 */
export interface PathResolver {
  exists(normalizedPath: string): boolean;
}

// -----------------------------------------------------------------------------
// Error type
// -----------------------------------------------------------------------------

export class CliValidationError extends Error {
  readonly code = ErrorCode.INVALID_ARGUMENT;
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'CliValidationError';
    this.field = field;
  }
}

// -----------------------------------------------------------------------------
// Primitive parsers
// -----------------------------------------------------------------------------

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on', '']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

export function parseBool(p: CliParams, key: string, defaultValue = false): boolean {
  const raw = p[key];
  if (raw === undefined) return defaultValue;
  const lower = String(raw).toLowerCase().trim();
  if (TRUE_VALUES.has(lower)) return true;
  if (FALSE_VALUES.has(lower)) return false;
  throw new CliValidationError(
    key,
    `Expected boolean for '${key}', got '${raw}'. Use true/false/1/0/yes/no or pass the flag bare.`,
  );
}

export interface ParseEnumOptions<T extends string> {
  required?: boolean;
  default?: T;
}

export function parseEnum<T extends string>(
  p: CliParams,
  key: string,
  values: readonly T[],
  opts: ParseEnumOptions<T> & { required: true },
): T;
export function parseEnum<T extends string>(
  p: CliParams,
  key: string,
  values: readonly T[],
  opts?: ParseEnumOptions<T>,
): T | undefined;
export function parseEnum<T extends string>(
  p: CliParams,
  key: string,
  values: readonly T[],
  opts: ParseEnumOptions<T> = {},
): T | undefined {
  const raw = p[key];
  if (raw === undefined || raw === 'true') {
    if (opts.required) {
      throw new CliValidationError(key, `Flag '${key}' is required (one of: ${values.join(', ')}).`);
    }
    return opts.default;
  }
  const v = String(raw) as T;
  if (!values.includes(v)) {
    throw new CliValidationError(
      key,
      `Invalid value '${raw}' for '${key}'. Allowed: ${values.join(', ')}.`,
    );
  }
  return v;
}

export interface ParseNumberOptions {
  required?: boolean;
  default?: number;
  min?: number;
  max?: number;
  integer?: boolean;
}

export function parseNumber(p: CliParams, key: string, opts: ParseNumberOptions = {}): number | undefined {
  const raw = p[key];
  if (raw === undefined || raw === 'true') {
    if (opts.required) {
      throw new CliValidationError(key, `Flag '${key}' requires a numeric value.`);
    }
    return opts.default;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new CliValidationError(key, `Expected number for '${key}', got '${raw}'.`);
  }
  if (opts.integer && !Number.isInteger(n)) {
    throw new CliValidationError(key, `Expected integer for '${key}', got '${raw}'.`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new CliValidationError(key, `'${key}' must be >= ${opts.min} (got ${n}).`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new CliValidationError(key, `'${key}' must be <= ${opts.max} (got ${n}).`);
  }
  return n;
}

/**
 * Parse a comma-separated string flag into a string[]. Trims whitespace, drops
 * empty entries.
 */
export function parseCsv(p: CliParams, key: string): string[] {
  const raw = p[key];
  if (raw === undefined || raw === 'true') return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface ParseStringOptions {
  required?: boolean;
  default?: string;
  maxLength?: number;
  allowBareFlag?: boolean;
}

export function parseString(p: CliParams, key: string, opts: ParseStringOptions & { required: true }): string;
export function parseString(p: CliParams, key: string, opts?: ParseStringOptions): string | undefined;
export function parseString(p: CliParams, key: string, opts: ParseStringOptions = {}): string | undefined {
  const raw = p[key];
  if (raw === undefined) {
    if (opts.required) {
      throw new CliValidationError(key, `Flag '${key}' is required.`);
    }
    return opts.default;
  }
  if (raw === 'true' && !opts.allowBareFlag) {
    throw new CliValidationError(key, `Flag '${key}' requires a string value.`);
  }
  const s = String(raw);
  if (opts.maxLength !== undefined && s.length > opts.maxLength) {
    throw new CliValidationError(
      key,
      `'${key}' exceeds max length ${opts.maxLength} (got ${s.length}).`,
    );
  }
  return s;
}

// -----------------------------------------------------------------------------
// Path parsers
// -----------------------------------------------------------------------------

export interface ParseWorkspacePathOptions {
  required?: boolean;
  mustExist?: boolean;
  default?: string;
}

/**
 * Parse a flag as a workspace-relative path (the desktop analog of the plugin's
 * vault-relative path). Rejects `..` traversal and absolute paths, normalizes
 * separators to `/`. When `mustExist=true`, asserts via the injected resolver.
 */
export function parseWorkspacePath(
  p: CliParams,
  key: string,
  opts: ParseWorkspacePathOptions & { required: true },
  resolver?: PathResolver,
): string;
export function parseWorkspacePath(
  p: CliParams,
  key: string,
  opts?: ParseWorkspacePathOptions,
  resolver?: PathResolver,
): string | undefined;
export function parseWorkspacePath(
  p: CliParams,
  key: string,
  opts: ParseWorkspacePathOptions = {},
  resolver?: PathResolver,
): string | undefined {
  const raw = parseString(p, key, { required: opts.required, default: opts.default });
  if (raw === undefined) return undefined;
  const normalized = normalizeWorkspacePath(raw);
  if (normalized.startsWith('/')) {
    throw new CliValidationError(key, `'${key}' must be a workspace-relative path, not an absolute path.`);
  }
  if (containsTraversal(normalized)) {
    throw new CliValidationError(key, `'${key}' contains parent-directory traversal ('..'), refusing.`);
  }
  if (opts.mustExist) {
    if (!resolver) {
      throw new CliValidationError(key, `Cannot verify '${key}' exists: no path resolver supplied.`);
    }
    if (!resolver.exists(normalized)) {
      throw new CliValidationError(key, `Workspace path '${normalized}' does not exist.`);
    }
  }
  return normalized;
}

export interface ParseAbsolutePathOptions {
  required?: boolean;
  default?: string;
}

/**
 * Parse a flag as an absolute filesystem path. Used by commands that read host
 * files (e.g. Instagram ZIP import). Does not touch the filesystem here.
 *
 * The plugin's `desktopOnly` guard (via `Platform.isDesktopApp`) is dropped: a
 * standalone Node CLI is inherently a filesystem-capable host.
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

export function normalizeWorkspacePath(input: string): string {
  let s = input.replace(/\\/g, '/');
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export function containsTraversal(path: string): boolean {
  const segments = path.split('/');
  return segments.some((seg) => seg === '..');
}
