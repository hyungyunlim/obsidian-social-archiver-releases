/**
 * @social-archiver/cli-core — host-agnostic CLI contract.
 *
 * Shared by the desktop app and the Obsidian plugin. Zero dependencies on
 * Obsidian, Tauri, the DOM, or any client — every host binds via the
 * `ArchiverCliHost` interface. See docs/specs/desktop-cli-agent-skill-prd.md §6.
 */
export * from './core/response.js';
export * from './core/params.js';
export * from './core/flags.js';
export * from './core/host.js';
export * from './core/handlers.js';
export * from './core/registry.js';
export * from './runner.js';
export * from './mock-host.js';
//# sourceMappingURL=index.js.map