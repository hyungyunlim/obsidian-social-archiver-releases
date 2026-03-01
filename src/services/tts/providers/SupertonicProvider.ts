/**
 * SupertonicProvider
 *
 * On-device TTS provider using the Supertonic speech synthesis engine.
 * Communicates via JSON stdio IPC with a Node.js child process (server.js).
 *
 * Architecture (per PRD v1.1):
 *  - Protocol versioning with ready handshake (FR-04/FR-05)
 *  - Request queue before ready gate
 *  - Quality parameter mapping: fast=2, balanced=5, high=10 (FR-06)
 *  - Speed mapping: rate * 1.05, clamped [0.5, 2.5] (FR-06)
 *  - Crash recovery: max 3 auto-restarts per session (FR-04)
 *  - Idle timeout: 5 minutes graceful shutdown (FR-04)
 *  - Synthesis timeout: 30 seconds per request (FR-04)
 *  - Desktop-only (Platform.isDesktop guard)
 *
 * IPC Protocol v1 (JSON over stdin/stdout, newline-delimited):
 *   Server -> Client: { type: 'ready', protocolVersion, sampleRate }
 *   Client -> Server: { type: 'synthesize', id, text, lang, rate, voiceId, totalStep }
 *   Server -> Client: { type: 'audio', id, data (base64 wav) }
 *   Client -> Server: { type: 'voices', id }
 *   Server -> Client: { type: 'voices', id, voices }
 *   Client -> Server: { type: 'ping', id }
 *   Server -> Client: { type: 'pong', id }
 *   Server -> Client: { type: 'error', id?, code?, message }
 */

import { Platform } from 'obsidian';
import { ProcessManager } from '../../ProcessManager';
import { resolveEnvPath, findNodeBinary } from '../resolveNodeEnv';
import type { NodeModules } from '../resolveNodeEnv';
import type { PluginTTSProvider, TTSSynthesizeOptions, TTSVoice } from '../types';

// ============================================================================
// Constants
// ============================================================================

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SYNTH_TIMEOUT_MS = 30 * 1000;    // 30 seconds
const READY_TIMEOUT_MS = 10 * 1000;    // 10 seconds for ready handshake
const MAX_CRASH_RESTARTS = 3;
const INSTALL_DIR = '.social-archiver/tts';
const SUPPORTED_PROTOCOL_VERSION = 1;

/** Languages supported by the Supertonic engine. */
const SUPPORTED_LANGUAGES = new Set(['en', 'ko', 'es', 'pt', 'fr']);

/** Quality -> totalStep mapping (FR-06). */
const QUALITY_MAP: Record<SupertonicQuality, number> = {
  fast: 2,
  balanced: 5,
  high: 10,
};

// ============================================================================
// Types
// ============================================================================

export type SupertonicQuality = 'fast' | 'balanced' | 'high';

/** Error codes from server.js (PRD §6.3). */
export type SupertonicErrorCode =
  | 'INIT_FAILED'
  | 'VOICE_NOT_FOUND'
  | 'SYNTH_TIMEOUT'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

interface IPCRequest {
  type: 'synthesize' | 'voices' | 'ping';
  id: number;
  text?: string;
  lang?: string;
  rate?: number;
  voiceId?: string;
  totalStep?: number;
}

interface IPCReadyResponse {
  type: 'ready';
  protocolVersion: number;
  sampleRate: number;
}

interface IPCAudioResponse {
  type: 'audio';
  id: number;
  data: string; // base64-encoded WAV
}

interface IPCVoicesResponse {
  type: 'voices';
  id: number;
  voices: Array<{
    id: string;
    name: string;
    lang: string;
    gender?: 'male' | 'female';
  }>;
}

interface IPCPongResponse {
  type: 'pong';
  id: number;
}

interface IPCErrorResponse {
  type: 'error';
  id?: number;
  code?: SupertonicErrorCode;
  message: string;
}

type IPCResponse = IPCReadyResponse | IPCAudioResponse | IPCVoicesResponse | IPCPongResponse | IPCErrorResponse;

interface PendingRequest {
  resolve: (value: IPCResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ============================================================================
// SupertonicProvider
// ============================================================================

export class SupertonicProvider implements PluginTTSProvider {
  readonly id = 'supertonic' as const;

  private process: ReturnType<typeof import('child_process').spawn> | null = null;
  private processId: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private crashCount = 0;
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private requestCounter = 0;
  private buffer = '';
  private installPath: string | null = null;

  /** Whether the server has sent `ready` with a compatible protocol version. */
  private isReady = false;
  /** Queued requests waiting for `ready` (FR-04 §2). */
  private readyQueue: Array<{ request: IPCRequest; timeoutMs: number; resolve: (v: IPCResponse) => void; reject: (e: Error) => void }> = [];
  /** Quality setting (maps to totalStep). */
  private quality: SupertonicQuality = 'balanced';

  constructor(private homePath?: string) {}

  // ---------- Configuration ------------------------------------------------

  /** Set quality level (FR-06). */
  setQuality(quality: SupertonicQuality): void {
    this.quality = quality;
  }

  // ---------- PluginTTSProvider interface -----------------------------------

  supportsLanguage(lang: string): boolean {
    const short = lang.split('-')[0]!;
    return SUPPORTED_LANGUAGES.has(short);
  }

  async synthesize(options: TTSSynthesizeOptions): Promise<ArrayBuffer> {
    this.assertDesktop();

    const started = await this.ensureProcess();
    if (!started) throw new Error('Failed to start Supertonic process');

    this.resetIdleTimer();

    // Supertonic expects short language codes: en, ko, es, pt, fr
    // Strip region suffix from BCP-47 codes (e.g., ko-KR → ko, en-US → en)
    const lang = options.lang ? options.lang.split('-')[0]! : undefined;

    // Pass rate to Supertonic for pitch-preserving time stretch.
    // Supertonic server.js applies: rate * 1.05, clamped [0.5, 2.5].
    // When rate is undefined, the server uses its default (1.05x).
    const response = await this.sendRequest({
      type: 'synthesize',
      id: 0, // will be assigned in sendRequest
      text: options.text,
      lang,
      rate: options.rate,
      voiceId: options.voiceId,
      totalStep: QUALITY_MAP[this.quality],
    }, SYNTH_TIMEOUT_MS);

    if (response.type === 'error') {
      const code = (response as IPCErrorResponse).code ?? 'INTERNAL_ERROR';
      throw new Error(`Supertonic synthesis error [${code}]: ${response.message}`);
    }

    if (response.type !== 'audio') {
      throw new Error(`Unexpected response type: ${response.type}`);
    }

    // Decode base64 WAV to ArrayBuffer
    const binary = atob((response as IPCAudioResponse).data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async getVoices(lang?: string): Promise<TTSVoice[]> {
    this.assertDesktop();

    const started = await this.ensureProcess();
    if (!started) return [];

    this.resetIdleTimer();

    const response = await this.sendRequest({
      type: 'voices',
      id: 0,
      lang,
    }, 10_000);

    if (response.type !== 'voices') return [];

    return (response as IPCVoicesResponse).voices.map((v) => ({
      id: v.id,
      name: v.name,
      lang: v.lang,
      gender: v.gender,
      provider: 'supertonic' as const,
    }));
  }

  /**
   * Synchronous check whether Supertonic is properly installed.
   * Checks .version marker AND that helper.js + server.js exist.
   */
  isInstalled(): boolean {
    if (!Platform.isDesktop) return false;

    try {
      const installDir = this.getInstallPath();
      const fs = this.nodeRequire('fs') as typeof import('fs');
      const pathMod = this.nodeRequire('path') as typeof import('path');

      // Check .version marker (must be valid JSON per FR-03)
      const versionPath = pathMod.join(installDir, '.version');
      if (!fs.existsSync(versionPath)) return false;
      try {
        JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
      } catch {
        return false;
      }

      // Check essential runtime files
      if (!fs.existsSync(pathMod.join(installDir, 'helper.js'))) return false;
      if (!fs.existsSync(pathMod.join(installDir, 'server.js'))) return false;

      return true;
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.isInstalled();
  }

  /**
   * Cancel all in-flight synthesis requests.
   *
   * Called on skip/stop so stale synthesis requests don't block the IPC pipeline.
   * The server may still finish processing the current request, but the client
   * rejects all pending promises and subsequent server responses are silently
   * dropped (no matching entry in pendingRequests).
   */
  cancelPendingSynthesis(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Synthesis cancelled'));
      this.pendingRequests.delete(id);
    }
  }

  async destroy(): Promise<void> {
    this.clearIdleTimer();
    this.killProcess();

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Provider destroyed'));
    }
    this.pendingRequests.clear();

    // Reject ready queue
    for (const queued of this.readyQueue) {
      queued.reject(new Error('Provider destroyed'));
    }
    this.readyQueue = [];
  }

  // ---------- Process management --------------------------------------------

  private async ensureProcess(): Promise<boolean> {
    if (this.process && this.isReady) {
      // Health check via ping
      try {
        await this.sendRequest({ type: 'ping', id: 0 }, 5000);
        return true;
      } catch {
        this.killProcess();
      }
    }

    if (this.crashCount >= MAX_CRASH_RESTARTS) {
      console.warn('[SupertonicProvider] Max crash restarts reached');
      return false;
    }

    return this.spawnProcess();
  }

  private spawnProcess(): boolean {
    try {
      const cp = this.nodeRequire('child_process') as typeof import('child_process');
      const installPath = this.getInstallPath();
      const modules = this.getNodeModules();
      const nodeBin = findNodeBinary(modules);
      const envPath = resolveEnvPath(modules);

      this.isReady = false;

      const child = cp.spawn(nodeBin, ['--experimental-vm-modules', 'server.js'], {
        cwd: installPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production', PATH: envPath },
        windowsHide: true,
      });

      this.process = child;
      this.processId = ProcessManager.register(
        child as unknown as Parameters<typeof ProcessManager.register>[0],
        'tts',
        'supertonic',
      );
      this.buffer = '';

      child.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      child.stderr?.on('data', (data: Buffer) => {
        console.debug('[SupertonicProvider] stderr:', data.toString().trim());
      });

      child.on('close', (code: number | null) => {
        console.debug(`[SupertonicProvider] Process exited with code ${code}`);
        this.process = null;
        this.processId = null;
        this.isReady = false;

        if (code !== 0 && code !== null) {
          this.crashCount++;
        }

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`Supertonic process crashed (code ${code})`));
          this.pendingRequests.delete(id);
        }

        // Reject ready queue
        for (const queued of this.readyQueue) {
          queued.reject(new Error(`Supertonic process crashed (code ${code})`));
        }
        this.readyQueue = [];
      });

      child.on('error', (err: Error) => {
        console.error('[SupertonicProvider] Process error:', err);
        this.crashCount++;
        this.process = null;
        this.processId = null;
        this.isReady = false;

        for (const [, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(err);
        }
        this.pendingRequests.clear();

        for (const queued of this.readyQueue) {
          queued.reject(err);
        }
        this.readyQueue = [];
      });

      // Set up ready timeout (FR-04 §1: max 10s wait)
      const readyTimer = setTimeout(() => {
        if (!this.isReady) {
          console.error('[SupertonicProvider] Ready timeout after 10s');
          this.killProcess();
        }
      }, READY_TIMEOUT_MS);

      // Store readyTimer cleanup (cleared when ready is received)
      const originalIsReady = this.isReady;
      const checkReady = setInterval(() => {
        if (this.isReady !== originalIsReady || !this.process) {
          clearInterval(checkReady);
          clearTimeout(readyTimer);
        }
      }, 100);

      this.resetIdleTimer();
      return true;
    } catch (error) {
      console.error('[SupertonicProvider] Failed to spawn:', error);
      return false;
    }
  }

  private killProcess(): void {
    if (this.processId) {
      ProcessManager.kill(this.processId);
    } else if (this.process) {
      try { this.process.kill('SIGTERM'); } catch { /* ignore */ }
    }
    this.process = null;
    this.processId = null;
    this.buffer = '';
    this.isReady = false;
  }

  // ---------- IPC -----------------------------------------------------------

  /**
   * Send a request over IPC. If not ready yet, queue it (FR-04 §2).
   */
  private sendRequest(request: IPCRequest, timeoutMs: number): Promise<IPCResponse> {
    const id = ++this.requestCounter;
    request.id = id;

    if (!this.isReady && request.type !== 'ping') {
      // Queue until ready
      return new Promise((resolve, reject) => {
        this.readyQueue.push({ request: { ...request, id }, timeoutMs, resolve, reject });
      });
    }

    return this.sendRequestDirect(request, timeoutMs);
  }

  private sendRequestDirect(request: IPCRequest, timeoutMs: number): Promise<IPCResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('Process not available'));
        return;
      }

      const id = request.id;
      const payload = JSON.stringify(request) + '\n';

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Supertonic request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });

      this.process.stdin.write(payload);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // Keep incomplete last line in buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed) as IPCResponse & { id?: number };

        // Handle `ready` message (FR-04/FR-05)
        if (response.type === 'ready') {
          this.handleReady(response as IPCReadyResponse);
          continue;
        }

        const id = response.id;
        if (id !== undefined && this.pendingRequests.has(id)) {
          const pending = this.pendingRequests.get(id)!;
          this.pendingRequests.delete(id);
          pending.resolve(response);
        }
      } catch {
        console.debug('[SupertonicProvider] Non-JSON output:', trimmed);
      }
    }
  }

  /**
   * Handle ready handshake from server (FR-05).
   * Verify protocol version compatibility, then drain the ready queue.
   */
  private handleReady(response: IPCReadyResponse): void {
    if (response.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
      console.error(
        `[SupertonicProvider] Protocol version mismatch: got ${response.protocolVersion}, expected ${SUPPORTED_PROTOCOL_VERSION}`,
      );
      // FR-05: unsupported version -> terminate immediately, no infinite retry
      this.killProcess();

      for (const queued of this.readyQueue) {
        queued.reject(new Error(
          `Supertonic protocol version mismatch (got ${response.protocolVersion}, expected ${SUPPORTED_PROTOCOL_VERSION}). Please reinstall Supertonic.`,
        ));
      }
      this.readyQueue = [];
      return;
    }

    console.debug(`[SupertonicProvider] Ready (protocol v${response.protocolVersion}, ${response.sampleRate}Hz)`);
    this.isReady = true;

    // Drain queued requests (FR-04 §2: no request loss before ready)
    const queue = [...this.readyQueue];
    this.readyQueue = [];

    for (const { request, timeoutMs, resolve, reject } of queue) {
      this.sendRequestDirect(request, timeoutMs).then(resolve, reject);
    }
  }

  // ---------- Idle timeout --------------------------------------------------

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      console.debug('[SupertonicProvider] Idle timeout, killing process');
      this.killProcess();
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ---------- Helpers -------------------------------------------------------

  private assertDesktop(): void {
    if (!Platform.isDesktop) {
      throw new Error('Supertonic TTS is only available on desktop');
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

  private getInstallPath(): string {
    if (this.installPath) return this.installPath;

    const os = this.nodeRequire('os') as typeof import('os');
    const path = this.nodeRequire('path') as typeof import('path');
    const home = this.homePath ?? os.homedir();
    this.installPath = path.join(home, INSTALL_DIR);
    return this.installPath;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private nodeRequire(module: string): any {
    // Obsidian desktop provides Node.js require on window
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    return (window as any).require(module);
  }
}
