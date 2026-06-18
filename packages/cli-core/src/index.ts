/**
 * @social-archiver/cli-core — host-agnostic CLI contract.
 *
 * Shared by the desktop app and the Obsidian plugin. Zero dependencies on
 * Obsidian, Tauri, the DOM, or any client — every host binds via the
 * `ArchiverCliHost` interface. See docs/specs/desktop-cli-agent-skill-prd.md §6.
 */

export * from './core/response';
export * from './core/params';
export * from './core/flags';
export * from './core/host';
export * from './core/handlers';
export * from './core/registry';
export * from './runner';
export * from './mock-host';
