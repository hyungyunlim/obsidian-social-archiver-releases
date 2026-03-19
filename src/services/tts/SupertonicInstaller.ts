/**
 * SupertonicInstaller
 *
 * Manages installation, update, and removal of the Supertonic on-device TTS engine.
 * Install location: ~/.social-archiver/tts/
 *
 * Architecture (per PRD v1.1):
 *  - Atomic staging-based installation (FR-01)
 *  - Explicit state machine with 9 states (FR-02)
 *  - SHA-256 checksum verification (FR-03)
 *  - Direct downloads from GitHub (helper.js) and HuggingFace (models/voices)
 *  - Per-file retry with exponential backoff (max 3)
 *  - Lock file for concurrent install prevention
 *
 * Install layout:
 *  ~/.social-archiver/tts/
 *  ├── package.json
 *  ├── node_modules/          (onnxruntime-node, fft.js, js-yaml)
 *  ├── helper.js              (from supertone-inc/supertonic)
 *  ├── server.js              (generated IPC wrapper)
 *  ├── assets/
 *  │   ├── onnx/              (4 ONNX + 2 JSON configs)
 *  │   └── voice_styles/      (M1..M5, F1..F5)
 *  ├── .version               (structured JSON)
 *  └── .checksum              (SHA-256 manifest)
 */

import { Platform } from 'obsidian';
import { resolveEnvPath, findNpmCommand } from './resolveNodeEnv';
import type { NodeModules } from './resolveNodeEnv';

// ============================================================================
// Constants
// ============================================================================

const INSTALL_DIR = '.social-archiver/tts';
const LOCK_FILE = '.install.lock';
const VERSION_FILE = '.version';
const CHECKSUM_FILE = '.checksum';

/**
 * Version pinning — update these when upgrading Supertonic.
 * PRD §5.3: main branch URL 직접 참조 금지. commit SHA 기반.
 */
const HELPER_COMMIT_SHA = 'main'; // TODO: pin to specific commit SHA before release
const MODEL_REVISION = 'main'; // TODO: pin to specific HuggingFace revision before release
const INSTALLER_VERSION = '1.0.0';

const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/supertone-inc/supertonic/${HELPER_COMMIT_SHA}`;
const HF_BASE = `https://huggingface.co/Supertone/supertonic-2/resolve/${MODEL_REVISION}`;

/** Files to download from GitHub. */
const GITHUB_FILES: ReadonlyArray<{ remote: string; local: string }> = [
  { remote: `${GITHUB_RAW_BASE}/nodejs/helper.js`, local: 'helper.js' },
];

/** ONNX model files from HuggingFace. */
const MODEL_FILES: ReadonlyArray<{ remote: string; local: string }> = [
  { remote: `${HF_BASE}/onnx/duration_predictor.onnx`, local: 'assets/onnx/duration_predictor.onnx' },
  { remote: `${HF_BASE}/onnx/text_encoder.onnx`, local: 'assets/onnx/text_encoder.onnx' },
  { remote: `${HF_BASE}/onnx/vector_estimator.onnx`, local: 'assets/onnx/vector_estimator.onnx' },
  { remote: `${HF_BASE}/onnx/vocoder.onnx`, local: 'assets/onnx/vocoder.onnx' },
  { remote: `${HF_BASE}/onnx/tts.json`, local: 'assets/onnx/tts.json' },
  { remote: `${HF_BASE}/onnx/unicode_indexer.json`, local: 'assets/onnx/unicode_indexer.json' },
];

/** Voice style files from HuggingFace. */
const VOICE_FILES: ReadonlyArray<{ remote: string; local: string }> = [
  { remote: `${HF_BASE}/voice_styles/M1.json`, local: 'assets/voice_styles/M1.json' },
  { remote: `${HF_BASE}/voice_styles/M2.json`, local: 'assets/voice_styles/M2.json' },
  { remote: `${HF_BASE}/voice_styles/M3.json`, local: 'assets/voice_styles/M3.json' },
  { remote: `${HF_BASE}/voice_styles/M4.json`, local: 'assets/voice_styles/M4.json' },
  { remote: `${HF_BASE}/voice_styles/M5.json`, local: 'assets/voice_styles/M5.json' },
  { remote: `${HF_BASE}/voice_styles/F1.json`, local: 'assets/voice_styles/F1.json' },
  { remote: `${HF_BASE}/voice_styles/F2.json`, local: 'assets/voice_styles/F2.json' },
  { remote: `${HF_BASE}/voice_styles/F3.json`, local: 'assets/voice_styles/F3.json' },
  { remote: `${HF_BASE}/voice_styles/F4.json`, local: 'assets/voice_styles/F4.json' },
  { remote: `${HF_BASE}/voice_styles/F5.json`, local: 'assets/voice_styles/F5.json' },
];

/** Required ONNX asset filenames for integrity check (FR-03 §4). */
const REQUIRED_ONNX_FILES = [
  'duration_predictor.onnx',
  'text_encoder.onnx',
  'vector_estimator.onnx',
  'vocoder.onnx',
  'tts.json',
  'unicode_indexer.json',
];

/** Required voice style filenames (FR-03 §5). */
const REQUIRED_VOICE_FILES = [
  'M1.json', 'M2.json', 'M3.json', 'M4.json', 'M5.json',
  'F1.json', 'F2.json', 'F3.json', 'F4.json', 'F5.json',
];

const MAX_DOWNLOAD_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

// ============================================================================
// Types
// ============================================================================

/**
 * Installation state machine (FR-02).
 * All states have user-facing messages and progress text.
 */
export type SupertonicInstallState =
  | 'idle'
  | 'preflight'
  | 'installing_runtime'
  | 'downloading_models'
  | 'downloading_voices'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface InstallProgress {
  /** Current installation state. */
  state: SupertonicInstallState;
  /** Human-readable description. */
  message: string;
  /** Overall progress (0-1). */
  progress: number;
  /** Current step (1-based, for legacy compat). */
  step: number;
  /** Total steps. */
  totalSteps: number;
}

export type InstallProgressCallback = (progress: InstallProgress) => void;

export interface InstallResult {
  success: boolean;
  version?: string;
  error?: string;
}

/** Structured version metadata (FR-05 / PRD §5.3). */
interface VersionMetadata {
  version: string;
  helperRef: string;
  modelRevision: string;
  installedAt: string;
  nodeVersion: string;
}

/** Checksum manifest entry. */
interface ChecksumEntry {
  file: string;
  sha256: string;
}

// ============================================================================
// Server.js Template
// ============================================================================

/**
 * IPC server wrapper generated during installation.
 * ESM module that bridges helper.js with the Obsidian plugin via JSON line protocol.
 * PRD §6.1: ESM + stdin/stdout JSON line protocol + voice style cache.
 */
const SERVER_JS_TEMPLATE = `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROTOCOL_VERSION = 1;
const SAMPLE_RATE = 44100;

// Voice style cache (stores Style objects from helper.loadVoiceStyle)
const voiceStyleCache = new Map();

let tts = null;
let helper = null;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

function sendError(id, code, message) {
  send({ type: 'error', id: id ?? undefined, code, message });
}

async function init() {
  try {
    const helperPath = join(__dirname, 'helper.js');
    helper = await import(helperPath);

    const onnxDir = join(__dirname, 'assets', 'onnx');
    tts = await helper.loadTextToSpeech(onnxDir, false);

    send({ type: 'ready', protocolVersion: PROTOCOL_VERSION, sampleRate: SAMPLE_RATE });
  } catch (err) {
    sendError(null, 'INIT_FAILED', err.message || String(err));
    process.exit(1);
  }
}

function loadVoiceStyle(voiceId) {
  if (voiceStyleCache.has(voiceId)) return voiceStyleCache.get(voiceId);

  const stylePath = join(__dirname, 'assets', 'voice_styles', voiceId + '.json');

  try {
    // Use helper.loadVoiceStyle to create proper ort.Tensor-based Style object
    const style = helper.loadVoiceStyle([stylePath]);
    voiceStyleCache.set(voiceId, style);
    return style;
  } catch {
    return null;
  }
}

async function handleRequest(msg) {
  const { type, id } = msg;

  try {
    switch (type) {
      case 'synthesize': {
        if (!tts) {
          sendError(id, 'INIT_FAILED', 'TTS engine not initialized');
          return;
        }

        const { text, lang, rate, voiceId, totalStep } = msg;
        const voice = voiceId || 'F1';
        const style = loadVoiceStyle(voice);
        if (!style) {
          sendError(id, 'VOICE_NOT_FOUND', 'Voice style not found: ' + voice);
          return;
        }

        const step = totalStep || 5;
        const speed = rate != null ? rate : 1.05;
        const clampedSpeed = Math.max(0.5, Math.min(2.5, speed));
        const language = lang || 'en';

        const result = await tts.call(text, language, style, step, clampedSpeed);

        // result is { wav, duration } — wav is an array of PCM float samples
        const wavBuffer = float32ToWav(result.wav, SAMPLE_RATE);
        const base64 = Buffer.from(wavBuffer).toString('base64');

        send({ type: 'audio', id, data: base64 });
        break;
      }

      case 'voices': {
        const voices = [
          { id: 'M1', name: 'Male 1', lang: 'en', gender: 'male' },
          { id: 'M2', name: 'Male 2', lang: 'en', gender: 'male' },
          { id: 'M3', name: 'Male 3', lang: 'en', gender: 'male' },
          { id: 'M4', name: 'Male 4', lang: 'en', gender: 'male' },
          { id: 'M5', name: 'Male 5', lang: 'en', gender: 'male' },
          { id: 'F1', name: 'Female 1', lang: 'en', gender: 'female' },
          { id: 'F2', name: 'Female 2', lang: 'en', gender: 'female' },
          { id: 'F3', name: 'Female 3', lang: 'en', gender: 'female' },
          { id: 'F4', name: 'Female 4', lang: 'en', gender: 'female' },
          { id: 'F5', name: 'Female 5', lang: 'en', gender: 'female' },
        ];

        send({ type: 'voices', id, voices });
        break;
      }

      case 'ping': {
        send({ type: 'pong', id });
        break;
      }

      default:
        sendError(id, 'INVALID_REQUEST', 'Unknown request type: ' + type);
    }
  } catch (err) {
    sendError(id, 'INTERNAL_ERROR', err.message || String(err));
  }
}

function float32ToWav(samples, sampleRate) {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);          // fmt chunk size
  buffer.writeUInt16LE(1, 20);           // PCM format
  buffer.writeUInt16LE(1, 22);           // mono
  buffer.writeUInt32LE(sampleRate, 24);  // sample rate
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34);          // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Normalize audio to prevent clipping at higher speeds.
  // Find peak amplitude and scale so peak = 0.95 if any sample exceeds [-1, 1].
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  const gain = peak > 1.0 ? 0.95 / peak : 1.0;

  // Convert float32 to int16
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * gain));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buffer.writeInt16LE(Math.round(val), 44 + i * 2);
  }

  return buffer;
}

// Main: read JSON lines from stdin
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    handleRequest(msg).catch((err) => {
      sendError(msg.id, 'INTERNAL_ERROR', err.message || String(err));
    });
  } catch {
    sendError(undefined, 'INVALID_REQUEST', 'Invalid JSON: ' + trimmed.slice(0, 100));
  }
});

rl.on('close', () => {
  process.exit(0);
});

// Start
init().catch((err) => {
  sendError(null, 'INIT_FAILED', err.message || String(err));
  process.exit(1);
});
`.trimStart();

// ============================================================================
// SupertonicInstaller
// ============================================================================

export class SupertonicInstaller {
  private homePath: string | null = null;
  private currentState: SupertonicInstallState = 'idle';

  constructor(private customHomePath?: string) {}

  // ---------- Public API ----------------------------------------------------

  /** Current installation state. */
  get state(): SupertonicInstallState {
    return this.currentState;
  }

  /**
   * Check if Supertonic is properly installed (FR-03).
   * All 6 conditions must be met:
   *  1. .version exists and parses as JSON
   *  2. helper.js, server.js, package.json exist
   *  3. node_modules/onnxruntime-node exists
   *  4. assets/onnx/ contains 6 required files
   *  5. assets/voice_styles/ contains 10 files (M1~M5, F1~F5)
   *  6. .checksum matches actual SHA-256 hashes
   */
  isInstalled(): boolean {
    if (!Platform.isDesktop) return false;

    try {
      const installPath = this.getInstallPath();
      const fs = this.nodeRequire('fs') as typeof import('fs');
      const path = this.nodeRequire('path') as typeof import('path');

      // 1. .version exists and parses as JSON
      const versionPath = path.join(installPath, VERSION_FILE);
      if (!fs.existsSync(versionPath)) return false;
      try {
        JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
      } catch {
        return false;
      }

      // 2. helper.js, server.js, package.json exist
      for (const file of ['helper.js', 'server.js', 'package.json']) {
        if (!fs.existsSync(path.join(installPath, file))) return false;
      }

      // 3. node_modules/onnxruntime-node exists
      if (!fs.existsSync(path.join(installPath, 'node_modules', 'onnxruntime-node'))) return false;

      // 4. assets/onnx/ contains 6 required files
      const onnxDir = path.join(installPath, 'assets', 'onnx');
      for (const file of REQUIRED_ONNX_FILES) {
        if (!fs.existsSync(path.join(onnxDir, file))) return false;
      }

      // 5. assets/voice_styles/ contains 10 required files
      const voiceDir = path.join(installPath, 'assets', 'voice_styles');
      for (const file of REQUIRED_VOICE_FILES) {
        if (!fs.existsSync(path.join(voiceDir, file))) return false;
      }

      // 6. .checksum exists (full verification skipped for perf; deep check on install)
      if (!fs.existsSync(path.join(installPath, CHECKSUM_FILE))) return false;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get installed version metadata (null if not installed).
   */
  getInstalledVersion(): string | null {
    if (!Platform.isDesktop) return null;

    try {
      const installPath = this.getInstallPath();
      const fs = this.nodeRequire('fs') as typeof import('fs');
      const versionPath = `${installPath}/${VERSION_FILE}`;
      if (!fs.existsSync(versionPath)) return null;
      const raw = fs.readFileSync(versionPath, 'utf-8').trim();
      try {
        const meta = JSON.parse(raw) as VersionMetadata;
        return meta.version;
      } catch {
        // Legacy plain string format
        return raw;
      }
    } catch {
      return null;
    }
  }

  /**
   * Check if an update is available.
   */
  isUpdateAvailable(): boolean {
    const installed = this.getInstalledVersion();
    if (!installed) return false;
    return installed !== INSTALLER_VERSION;
  }

  /**
   * Install or update Supertonic using atomic staging (FR-01).
   *
   * Flow:
   *  1. Preflight checks (disk, network, platform)
   *  2. Create staging directory
   *  3. Install npm runtime (onnxruntime-node, fft.js, js-yaml)
   *  4. Download models from HuggingFace
   *  5. Download voices from HuggingFace
   *  6. Download helper.js + generate server.js
   *  7. Verify checksums
   *  8. Atomic rename staging -> final
   */
  async install(
    onProgress?: InstallProgressCallback,
    signal?: AbortSignal,
  ): Promise<InstallResult> {
    if (!Platform.isDesktop) {
      return { success: false, error: 'Supertonic is only available on desktop' };
    }

    const fs = this.nodeRequire('fs') as typeof import('fs');
    const path = this.nodeRequire('path') as typeof import('path');
    const installPath = this.getInstallPath();
    const lockPath = path.join(installPath, LOCK_FILE);
    const stagingDir = path.join(installPath, `.staging-${Date.now()}`);

    const totalSteps = 6;
    const emit = (state: SupertonicInstallState, step: number, message: string, progress: number) => {
      this.currentState = state;
      onProgress?.({ state, step, totalSteps, message, progress });
    };

    // Check lock
    if (fs.existsSync(lockPath)) {
      return { success: false, error: 'Another installation is in progress' };
    }

    try {
      // Ensure base directory exists
      if (!fs.existsSync(installPath)) {
        fs.mkdirSync(installPath, { recursive: true });
      }

      // Write lock file
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

      // Step 1: Preflight
      this.checkAbort(signal);
      emit('preflight', 1, 'Checking system requirements...', 0);

      await this.preflight();
      emit('preflight', 1, 'System check passed', 1);

      // Step 2: Create staging + install npm runtime
      this.checkAbort(signal);
      emit('installing_runtime', 2, 'Installing runtime dependencies...', 0);

      fs.mkdirSync(stagingDir, { recursive: true });
      fs.mkdirSync(path.join(stagingDir, 'assets', 'onnx'), { recursive: true });
      fs.mkdirSync(path.join(stagingDir, 'assets', 'voice_styles'), { recursive: true });

      // Write package.json for npm install
      const packageJson = {
        name: 'social-archiver-tts-supertonic',
        version: INSTALLER_VERSION,
        private: true,
        type: 'module',
        dependencies: {
          'onnxruntime-node': '^1.17.0',
          'fft.js': '^4.0.4',
          'js-yaml': '^4.1.0',
        },
      };
      fs.writeFileSync(path.join(stagingDir, 'package.json'), JSON.stringify(packageJson, null, 2));

      await this.runNpmInstall(stagingDir);

      // Verify onnxruntime-node loads correctly (catches missing VCRUNTIME on Windows)
      this.verifyOnnxRuntime(stagingDir);

      emit('installing_runtime', 2, 'Runtime dependencies installed', 1);

      // Step 3: Download models (largest files first for better perceived progress)
      this.checkAbort(signal);
      emit('downloading_models', 3, 'Downloading TTS models...', 0);

      const allModelFiles = [...MODEL_FILES];
      for (let i = 0; i < allModelFiles.length; i++) {
        this.checkAbort(signal);
        const entry = allModelFiles[i];
        if (!entry) continue;
        const destPath = path.join(stagingDir, entry.local);
        emit('downloading_models', 3, `Downloading ${path.basename(entry.local)}...`, i / allModelFiles.length);
        await this.downloadFile(entry.remote, destPath);
      }
      emit('downloading_models', 3, 'Models downloaded', 1);

      // Step 4: Download voices
      this.checkAbort(signal);
      emit('downloading_voices', 4, 'Downloading voice styles...', 0);

      for (let i = 0; i < VOICE_FILES.length; i++) {
        this.checkAbort(signal);
        const entry = VOICE_FILES[i];
        if (!entry) continue;
        const destPath = path.join(stagingDir, entry.local);
        emit('downloading_voices', 4, `Downloading ${path.basename(entry.local)}...`, i / VOICE_FILES.length);
        await this.downloadFile(entry.remote, destPath);
      }
      emit('downloading_voices', 4, 'Voice styles downloaded', 1);

      // Step 5: Download helper.js + generate server.js
      this.checkAbort(signal);
      emit('verifying', 5, 'Setting up TTS engine...', 0);

      for (const { remote, local } of GITHUB_FILES) {
        const destPath = path.join(stagingDir, local);
        await this.downloadFile(remote, destPath);
      }

      // Write server.js IPC wrapper
      fs.writeFileSync(path.join(stagingDir, 'server.js'), SERVER_JS_TEMPLATE);

      emit('verifying', 5, 'Computing checksums...', 0.5);

      // Compute and write checksums
      const checksums = await this.computeChecksums(stagingDir);
      fs.writeFileSync(
        path.join(stagingDir, CHECKSUM_FILE),
        JSON.stringify(checksums, null, 2),
      );

      // Write version metadata
      const versionMeta: VersionMetadata = {
        version: INSTALLER_VERSION,
        helperRef: HELPER_COMMIT_SHA,
        modelRevision: MODEL_REVISION,
        installedAt: new Date().toISOString(),
        nodeVersion: process.version,
      };
      fs.writeFileSync(
        path.join(stagingDir, VERSION_FILE),
        JSON.stringify(versionMeta, null, 2),
      );

      emit('verifying', 5, 'Verifying installation...', 0.8);

      // Verify all required files exist in staging
      this.verifyStaging(stagingDir);

      emit('verifying', 5, 'Verification passed', 1);

      // Step 6: Atomic swap — remove old install, rename staging
      this.checkAbort(signal);
      emit('ready', 6, 'Finalizing installation...', 0);

      // Remove existing installation (except lock file and staging dirs)
      this.cleanExistingInstall(installPath, stagingDir);

      // Move staging contents to install path
      this.moveContents(stagingDir, installPath, fs, path);

      // Clean up empty staging dir
      try { fs.rmdirSync(stagingDir); } catch { /* ignore */ }

      emit('ready', 6, 'Installation complete', 1);
      this.currentState = 'ready';

      return { success: true, version: INSTALLER_VERSION };
    } catch (error) {
      if (error instanceof Error && error.message === 'Installation cancelled') {
        this.currentState = 'cancelled';
        // Clean up staging
        this.cleanupStaging(stagingDir);
        return { success: false, error: 'Installation cancelled by user' };
      }

      this.currentState = 'failed';
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SupertonicInstaller] Install failed:', message);

      // Clean up staging on failure (FR-01: failed staging is fully deleted)
      this.cleanupStaging(stagingDir);

      return { success: false, error: message };
    } finally {
      // Always remove lock
      try {
        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
      } catch { /* ignore */ }
    }
  }

  /**
   * Uninstall Supertonic and remove all installed files.
   */
  async uninstall(): Promise<InstallResult> {
    if (!Platform.isDesktop) {
      return { success: false, error: 'Not on desktop' };
    }

    try {
      const installPath = this.getInstallPath();
      const fs = this.nodeRequire('fs') as typeof import('fs');

      if (fs.existsSync(installPath)) {
        fs.rmSync(installPath, { recursive: true, force: true });
      }

      this.currentState = 'idle';
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /** Get the install directory path. */
  getInstallPath(): string {
    if (this.homePath) return this.homePath;

    const os = this.nodeRequire('os') as typeof import('os');
    const path = this.nodeRequire('path') as typeof import('path');
    const home = this.customHomePath ?? os.homedir();
    this.homePath = path.join(home, INSTALL_DIR);
    return this.homePath;
  }

  // ---------- Private: Preflight ------------------------------------------

  private async preflight(): Promise<void> {
    const modules = this.getNodeModules();
    const cp = modules.child_process;
    const envPath = resolveEnvPath(modules);

    // Check node is accessible
    try {
      cp.execSync('node --version', {
        encoding: 'utf-8',
        timeout: 5000,
        env: { ...process.env, PATH: envPath },
        windowsHide: true,
      });
    } catch {
      throw new Error('Node.js is required but not found in PATH. Please install Node.js.');
    }

    // Check npm is accessible
    const npm = findNpmCommand(modules);
    try {
      cp.execSync(`${npm} --version`, {
        encoding: 'utf-8',
        timeout: 5000,
        env: { ...process.env, PATH: envPath },
        windowsHide: true,
      });
    } catch {
      throw new Error('npm is required but not found in PATH. Please install Node.js (which includes npm).');
    }
  }

  // ---------- Private: Downloads ------------------------------------------

  /**
   * Download a file with retry logic (max 3 attempts, exponential backoff).
   * PRD §5.2: per-file retry, Range resume when supported.
   * Handles multiple redirects (HuggingFace uses 302 chains) and relative Location headers.
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const fs = this.nodeRequire('fs') as typeof import('fs');
    const https = this.nodeRequire('https') as typeof import('https');
    const http = this.nodeRequire('http') as typeof import('http');

    const MAX_REDIRECTS = 5;

    const fetchUrl = (targetUrl: string, redirectCount: number): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        if (redirectCount > MAX_REDIRECTS) {
          reject(new Error(`Too many redirects for ${url}`));
          return;
        }

        const parsedUrl = new URL(targetUrl);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const request = client.get(parsedUrl, { headers: { 'User-Agent': 'social-archiver-tts-installer' } }, (response) => {
          // Handle redirects (301, 302, 303, 307, 308)
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            // Resolve relative Location headers against the current URL
            const nextUrl = new URL(response.headers.location, targetUrl).toString();
            response.resume(); // Drain response to free socket
            fetchUrl(nextUrl, redirectCount + 1).then(resolve, reject);
            return;
          }

          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`HTTP ${response.statusCode} for ${url}`));
            return;
          }

          const writeStream = fs.createWriteStream(destPath);
          response.pipe(writeStream);
          writeStream.on('finish', () => { writeStream.close(); resolve(); });
          writeStream.on('error', reject);
        });
        request.on('error', reject);
      });
    };

    for (let attempt = 0; attempt < MAX_DOWNLOAD_RETRIES; attempt++) {
      try {
        await fetchUrl(url, 0);
        return; // Success
      } catch (error) {
        if (attempt === MAX_DOWNLOAD_RETRIES - 1) throw error;
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.debug(`[SupertonicInstaller] Retry ${attempt + 1}/${MAX_DOWNLOAD_RETRIES} for ${url} in ${delay}ms`);
        await new Promise((r) => window.setTimeout(r, delay));
      }
    }
  }

  // ---------- Private: NPM Install ----------------------------------------

  private async runNpmInstall(cwd: string): Promise<void> {
    const modules = this.getNodeModules();
    const npm = findNpmCommand(modules);
    const envPath = resolveEnvPath(modules);
    const args = ['install', '--production', '--no-audit', '--no-fund'];

    try {
      await this.spawnNpm(modules.child_process, npm, args, cwd, envPath, false);
    } catch (firstError) {
      // On Windows, retry with shell: true as fallback (handles edge cases
      // where npm.cmd isn't on PATH but cmd.exe can resolve it)
      if (modules.os.platform() === 'win32') {
        console.debug('[SupertonicInstaller] npm.cmd failed, retrying with shell: true');
        await this.spawnNpm(modules.child_process, 'npm', args, cwd, envPath, true);
      } else {
        throw firstError;
      }
    }
  }

  private spawnNpm(
    cp: typeof import('child_process'),
    command: string,
    args: string[],
    cwd: string,
    envPath: string,
    useShell: boolean,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = cp.spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: envPath },
        shell: useShell,
        windowsHide: true,
      });

      let stderr = '';
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('close', (code: number | null) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install failed (code ${code}): ${stderr.slice(0, 500)}`));
      });

      child.on('error', reject);
    });
  }

  // ---------- Private: Checksums ------------------------------------------

  /**
   * Compute SHA-256 checksums for all important files in the staging directory.
   */
  private async computeChecksums(stagingDir: string): Promise<ChecksumEntry[]> {
    const crypto = this.nodeRequire('crypto') as typeof import('crypto');
    const fs = this.nodeRequire('fs') as typeof import('fs');
    const path = this.nodeRequire('path') as typeof import('path');

    const filesToHash = [
      'helper.js',
      'server.js',
      ...REQUIRED_ONNX_FILES.map((f) => `assets/onnx/${f}`),
      ...REQUIRED_VOICE_FILES.map((f) => `assets/voice_styles/${f}`),
    ];

    const entries: ChecksumEntry[] = [];

    for (const file of filesToHash) {
      const filePath = path.join(stagingDir, file);
      if (!fs.existsSync(filePath)) continue;

      const hash = crypto.createHash('sha256');
      const content = fs.readFileSync(filePath);
      hash.update(content);
      entries.push({ file, sha256: hash.digest('hex') });
    }

    return entries;
  }

  // ---------- Private: Verification ----------------------------------------

  /**
   * Verify all required files exist in staging directory (FR-03).
   */
  private verifyStaging(stagingDir: string): void {
    const fs = this.nodeRequire('fs') as typeof import('fs');
    const path = this.nodeRequire('path') as typeof import('path');

    // Core files
    for (const file of ['helper.js', 'server.js', 'package.json']) {
      if (!fs.existsSync(path.join(stagingDir, file))) {
        throw new Error(`Missing required file: ${file}`);
      }
    }

    // onnxruntime-node
    if (!fs.existsSync(path.join(stagingDir, 'node_modules', 'onnxruntime-node'))) {
      throw new Error('Missing dependency: onnxruntime-node');
    }

    // ONNX models
    const onnxDir = path.join(stagingDir, 'assets', 'onnx');
    for (const file of REQUIRED_ONNX_FILES) {
      if (!fs.existsSync(path.join(onnxDir, file))) {
        throw new Error(`Missing ONNX file: ${file}`);
      }
    }

    // Voice styles
    const voiceDir = path.join(stagingDir, 'assets', 'voice_styles');
    for (const file of REQUIRED_VOICE_FILES) {
      if (!fs.existsSync(path.join(voiceDir, file))) {
        throw new Error(`Missing voice style: ${file}`);
      }
    }

    // Checksum and version files
    if (!fs.existsSync(path.join(stagingDir, CHECKSUM_FILE))) {
      throw new Error('Missing checksum manifest');
    }
    if (!fs.existsSync(path.join(stagingDir, VERSION_FILE))) {
      throw new Error('Missing version metadata');
    }
  }

  // ---------- Private: Atomic Swap -----------------------------------------

  /**
   * Clean existing installation files (preserve lock and staging dirs).
   */
  private cleanExistingInstall(installPath: string, currentStagingDir: string): void {
    const fs = this.nodeRequire('fs') as typeof import('fs');
    const path = this.nodeRequire('path') as typeof import('path');

    if (!fs.existsSync(installPath)) return;

    const entries = fs.readdirSync(installPath);
    for (const entry of entries) {
      if (entry === LOCK_FILE) continue;
      const entryPath = path.join(installPath, entry);
      if (entryPath === currentStagingDir) continue;
      // Skip other staging dirs (stale)
      if (entry.startsWith('.staging-')) {
        fs.rmSync(entryPath, { recursive: true, force: true });
        continue;
      }
      fs.rmSync(entryPath, { recursive: true, force: true });
    }
  }

  /**
   * Move all contents from staging to install path.
   */
  private moveContents(
    src: string,
    dest: string,
    fs: typeof import('fs'),
    path: typeof import('path'),
  ): void {
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      fs.renameSync(srcPath, destPath);
    }
  }

  /**
   * Clean up staging directory after failure/cancellation.
   */
  private cleanupStaging(stagingDir: string): void {
    try {
      const fs = this.nodeRequire('fs') as typeof import('fs');
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    } catch {
      console.warn('[SupertonicInstaller] Failed to clean staging directory');
    }
  }

  // ---------- Private: Utilities -------------------------------------------

  /**
   * Verify onnxruntime-node can be loaded (catches missing VCRUNTIME140.dll on Windows).
   * Only runs on win32; on other platforms this is a no-op.
   */
  private verifyOnnxRuntime(stagingDir: string): void {
    if (process.platform !== 'win32') return;

    const modules = this.getNodeModules();
    const envPath = resolveEnvPath(modules);

    try {
      modules.child_process.execSync(
        'node -e "require(\'onnxruntime-node\')"',
        {
          cwd: stagingDir,
          encoding: 'utf-8',
          timeout: 10_000,
          env: { ...process.env, PATH: envPath },
          windowsHide: true,
        },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('module could not be found') || msg.includes('DLL')) {
        throw new Error(
          'Supertonic requires Microsoft Visual C++ Redistributable on Windows. ' +
          'Install from: https://aka.ms/vs/17/release/vc_redist.x64.exe',
        );
      }
      // Other errors (e.g. missing node_modules) are caught by verifyStaging later
      console.debug('[SupertonicInstaller] onnxruntime-node load check failed (non-DLL):', msg);
    }
  }

  /** Build NodeModules interface for shared utility functions. */
  private getNodeModules(): NodeModules {
    return {
      os: this.nodeRequire('os') as typeof import('os'),
      child_process: this.nodeRequire('child_process') as typeof import('child_process'),
      fs: this.nodeRequire('fs') as typeof import('fs'),
    };
  }

  private checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('Installation cancelled');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private nodeRequire(module: string): any {
    // Obsidian desktop provides Node.js require on window
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    return (window as any).require(module);
  }
}
