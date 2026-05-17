/**
 * Obsidian CLI type augmentation.
 *
 * Obsidian 1.12.2+ ships `Plugin.registerCliHandler`, `CliHandler`, `CliFlags`,
 * `CliFlag`, and `CliData` in `obsidian.d.ts`. This file exists as an
 * insurance layer so that:
 *
 *   1. Future minor drift in the official headers (e.g. a renamed optional
 *      field) does not silently break our handlers at type-check time.
 *   2. Builds against older `node_modules/obsidian` checkouts (e.g. a stale
 *      developer machine or a stripped CI cache) still find the symbols.
 *
 * We deliberately only declare symbols that may be missing in older type
 * bundles. If the upstream headers already export an identifier we leave the
 * augmentation alone to avoid duplicate-identifier errors.
 *
 * The runtime guard in `CliRegistry.boot()` (`typeof plugin.registerCliHandler
 * === 'function'`) is the authoritative compatibility check — the type system
 * is purely advisory.
 */

// The actual canonical types live in `obsidian.d.ts` (>=1.12.2). We re-export
// convenience aliases here so consumers in this repo can import them from a
// single, stable path without depending on the upstream symbol layout.
import type {
  CliData as ObsidianCliData,
  CliFlag as ObsidianCliFlag,
  CliFlags as ObsidianCliFlags,
  CliHandler as ObsidianCliHandler,
} from 'obsidian';

export type CliData = ObsidianCliData;
export type CliFlag = ObsidianCliFlag;
export type CliFlags = ObsidianCliFlags;
export type CliHandler = ObsidianCliHandler;

// Note: We intentionally do NOT re-declare `Plugin.registerCliHandler` here
// when the upstream types already include it. Declaring it again under a
// `declare module 'obsidian'` block produces a duplicate-identifier error in
// TypeScript 5.x when the upstream interface is already present.
//
// If a future upstream removes the method, restore the augmentation below:
//
//   declare module 'obsidian' {
//     interface Plugin {
//       registerCliHandler(
//         command: string,
//         description: string,
//         flags: CliFlags | null,
//         handler: CliHandler,
//       ): void;
//     }
//   }
