/**
 * Plugin TTS Type Definitions — re-export shim.
 *
 * The canonical state-machine types, `VALID_TRANSITIONS`, and the
 * `PluginTTSProvider` contract now live in `@social-archiver/tts-core`
 * (vendored at `src/vendor/tts-core`). The DOM-coupled `TTSState` class stays
 * plugin-local in `./TTSState`. Edit shared types in `packages/tts-core/src/`
 * and re-run `bash scripts/sync-tts-core.sh`.
 *
 * See: .taskmaster/docs/prd-desktop-local-tts-supertonic.md §4.7
 */

export * from '../../vendor/tts-core/types';
