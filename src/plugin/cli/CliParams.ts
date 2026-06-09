/**
 * CliParams — single-responsibility helpers that parse Obsidian CLI flag
 * values (`Record<string, string | undefined>` per the official
 * `CliData` type) into typed shapes for downstream handlers.
 *
 * Conventions:
 *   - Bare flags arrive as the literal string `'true'`.
 *   - Missing flags are `undefined`.
 *   - All parsers throw `CliValidationError` on bad input so handlers can
 *     surface a structured `INVALID_ARGUMENT` response.
 */

import type { App, TAbstractFile } from 'obsidian';
import { ErrorCode } from './CliResponse';

/**
 * Shape of an individual flag value as received from Obsidian's CLI bridge.
 *
 * Per `CliData` in `obsidian.d.ts` (>=1.12.2): values are either string
 * payloads (`key=value` form), the literal `'true'` (bare boolean flag), or
 * absent.
 */
export type CliParamValue = string | undefined;

/**
 * Map of params — matches the official `CliData` shape but tolerates a
 * `command` key being stripped before parsing (some wrappers split that out).
 */
export type CliParams = Record<string, CliParamValue>;

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

/**
 * Parse a flag whose presence implies `true`. Accepts string variants
 * ("true"/"false"/"1"/"0"/"yes"/"no") for tolerance.
 *
 * - `undefined`              → `default` (or `false` if not provided)
 * - `'true'` (bare flag)     → `true`
 * - "true"/"1"/"yes"/"on"/"" → `true`
 * - "false"/"0"/"no"/"off"   → `false`
 * - anything else            → throws CliValidationError
 */
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

/**
 * Parse a flag against a fixed list of allowed string values.
 */
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
    if (raw === 'true') {
      // Bare flag with no value supplied — treat as missing for enum context.
    }
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
 * Parse a comma-separated string flag into a string[]. Trims whitespace,
 * drops empty entries.
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

export interface ParseVaultPathOptions {
  required?: boolean;
  mustExist?: boolean;
  default?: string;
}

/**
 * Parse a flag as a vault-relative path. Rejects `..` traversal segments and
 * normalizes path separators to `/`. When `mustExist=true`, asserts the path
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
  const normalized = normalizeVaultPath(raw);
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
  /** If true, throws unless `obsidian.Platform.isDesktopApp` is detected. */
  desktopOnly?: boolean;
}

/**
 * Parse a flag as an absolute filesystem path. Used by desktop-only commands
 * (e.g. Instagram ZIP import). Does not touch the filesystem here — that
 * responsibility belongs to the import service.
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

/**
 * Normalize a vault path: collapse `\` to `/`, collapse repeated slashes,
 * strip trailing slashes (except for root). Does NOT resolve `..` — callers
 * must reject traversal via `containsTraversal()`.
 */
export function normalizeVaultPath(input: string): string {
  let s = input.replace(/\\/g, '/');
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export function containsTraversal(path: string): boolean {
  const segments = path.split('/');
  return segments.some((seg) => seg === '..');
}
