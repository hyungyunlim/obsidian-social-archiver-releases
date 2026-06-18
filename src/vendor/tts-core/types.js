/**
 * Plugin TTS Type Definitions
 *
 * Core interfaces and types for the Obsidian plugin TTS system.
 * Unlike the mobile app (streaming `speak()` API), the plugin uses
 * a `synthesize() -> ArrayBuffer` pattern:
 *   - Supertonic: WAV via stdio child process
 *   - Azure Speech: MP3 via REST API
 * Both are decoded and played through the Web Audio API.
 */
/** Valid state transitions. */
export const VALID_TRANSITIONS = {
    idle: ['loading'],
    loading: ['synthesizing', 'error', 'idle'],
    synthesizing: ['playing', 'error', 'idle'],
    playing: ['paused', 'idle', 'error', 'synthesizing'],
    paused: ['playing', 'idle', 'error'],
    error: ['idle'],
};
//# sourceMappingURL=types.js.map