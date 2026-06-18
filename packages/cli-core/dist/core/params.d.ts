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
export type CliParamValue = string | undefined;
export type CliParams = Record<string, CliParamValue>;
/**
 * Resolves whether a workspace-relative path exists. Host-provided so the
 * parser never imports Obsidian/Tauri/fs directly.
 */
export interface PathResolver {
    exists(normalizedPath: string): boolean;
}
export declare class CliValidationError extends Error {
    readonly code: "INVALID_ARGUMENT";
    readonly field: string;
    constructor(field: string, message: string);
}
export declare function parseBool(p: CliParams, key: string, defaultValue?: boolean): boolean;
export interface ParseEnumOptions<T extends string> {
    required?: boolean;
    default?: T;
}
export declare function parseEnum<T extends string>(p: CliParams, key: string, values: readonly T[], opts: ParseEnumOptions<T> & {
    required: true;
}): T;
export declare function parseEnum<T extends string>(p: CliParams, key: string, values: readonly T[], opts?: ParseEnumOptions<T>): T | undefined;
export interface ParseNumberOptions {
    required?: boolean;
    default?: number;
    min?: number;
    max?: number;
    integer?: boolean;
}
export declare function parseNumber(p: CliParams, key: string, opts?: ParseNumberOptions): number | undefined;
/**
 * Parse a comma-separated string flag into a string[]. Trims whitespace, drops
 * empty entries.
 */
export declare function parseCsv(p: CliParams, key: string): string[];
export interface ParseStringOptions {
    required?: boolean;
    default?: string;
    maxLength?: number;
    allowBareFlag?: boolean;
}
export declare function parseString(p: CliParams, key: string, opts: ParseStringOptions & {
    required: true;
}): string;
export declare function parseString(p: CliParams, key: string, opts?: ParseStringOptions): string | undefined;
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
export declare function parseWorkspacePath(p: CliParams, key: string, opts: ParseWorkspacePathOptions & {
    required: true;
}, resolver?: PathResolver): string;
export declare function parseWorkspacePath(p: CliParams, key: string, opts?: ParseWorkspacePathOptions, resolver?: PathResolver): string | undefined;
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
export declare function parseAbsolutePath(p: CliParams, key: string, opts?: ParseAbsolutePathOptions): string | undefined;
export declare function normalizeWorkspacePath(input: string): string;
export declare function containsTraversal(path: string): boolean;
//# sourceMappingURL=params.d.ts.map