/**
 * TTSTextProcessor — re-export shim.
 *
 * The implementation now lives in the shared `@social-archiver/tts-core`
 * package (vendored at `src/vendor/tts-core` because the Obsidian release repo
 * forbids external npm packages). This file preserves the original import path
 * (`./TTSTextProcessor` / `@/services/tts/TTSTextProcessor`) so existing call
 * sites are unchanged. Edit the logic in `packages/tts-core/src/` and re-run
 * `bash scripts/sync-tts-core.sh`.
 *
 * See: .taskmaster/docs/prd-desktop-local-tts-supertonic.md §4.7
 */

export * from '../../vendor/tts-core/TTSTextProcessor';
