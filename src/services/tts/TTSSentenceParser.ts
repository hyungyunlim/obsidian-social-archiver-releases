/**
 * TTSSentenceParser — re-export shim.
 *
 * Implementation moved to `@social-archiver/tts-core` (vendored at
 * `src/vendor/tts-core`). Edit logic in `packages/tts-core/src/` and re-run
 * `bash scripts/sync-tts-core.sh`.
 *
 * See: .taskmaster/docs/prd-desktop-local-tts-supertonic.md §4.7
 */

export * from '../../vendor/tts-core/TTSSentenceParser';
