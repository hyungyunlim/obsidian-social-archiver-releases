/**
 * Keeps one `social-archiver executor --watch` child alive for this vault.
 *
 * Why a child process and not a port: cli-runtime is THE local-AI executor
 * (desktop app and standalone CLI share it). Running it here means every
 * provider — including Apple Intelligence on macOS — and every fix reaches
 * the plugin without a second implementation. The plugin's built-in executor
 * stays off while this runs (DesktopCapabilityReporter advertises it as
 * disabled and the job processors are not started).
 *
 * The token travels only through the child's environment, never to disk;
 * the CLI keeps its executor identity under SOCIAL_ARCHIVER_CONFIG_DIR.
 */
import type { StandaloneCliProvider } from '../../utils/standalone-cli';

export type CliExecutorState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'auth_required'
  | 'not_ready'
  | 'crashed';

export interface CliExecutorLaunch {
  binaryPath: string;
  token: string;
  configDir: string;
  outputLanguage: string;
  pollSeconds?: number;
}

export interface CliExecutorSnapshot {
  state: CliExecutorState;
  clientId: string | null;
  provider: string | null;
  providers: StandaloneCliProvider[];
  lastError: string | null;
  lastErrorCode: string | null;
  restarts: number;
  startedAt: number | null;
  binaryPath: string | null;
}

/** The subset of `child_process.ChildProcess` the supervisor touches (tests fake it). */
export interface ChildLike {
  pid?: number;
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface SpawnOptionsLike {
  env: NodeJS.ProcessEnv;
  stdio: ['ignore', 'pipe', 'pipe'];
  windowsHide: boolean;
}

export interface SupervisorDeps {
  spawn: (file: string, args: string[], options: SpawnOptionsLike) => ChildLike;
  schedule: (callback: () => void, delayMs: number) => unknown;
  clearSchedule: (handle: unknown) => void;
  now: () => number;
  /** Base environment for the child (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** PATH the child should see (GUI-launched Obsidian lacks Homebrew etc.). */
  extendedPath?: string;
  registerProcess?: (child: ChildLike) => void;
  onChange?: (snapshot: CliExecutorSnapshot) => void;
  log?: (level: 'debug' | 'warn' | 'error', message: string, data?: unknown) => void;
}

export const DEFAULT_POLL_SECONDS = 15;
export const RESTART_BASE_MS = 5_000;
export const RESTART_MAX_MS = 60_000;
export const NOT_READY_RETRY_MS = 5 * 60_000;
export const STOP_GRACE_MS = 5_000;
const STDERR_KEEP = 2_000;

export function executorArgs(launch: CliExecutorLaunch): string[] {
  return [
    'executor',
    '--watch',
    '--format',
    'json',
    '--language',
    launch.outputLanguage || 'auto',
    '--poll',
    String(launch.pollSeconds ?? DEFAULT_POLL_SECONDS),
  ];
}

export function executorEnv(launch: CliExecutorLaunch, base: NodeJS.ProcessEnv, extendedPath?: string): NodeJS.ProcessEnv {
  return {
    ...base,
    ...(extendedPath ? { PATH: extendedPath } : {}),
    SOCIAL_ARCHIVER_TOKEN: launch.token,
    SOCIAL_ARCHIVER_CONFIG_DIR: launch.configDir,
    // This vault's token is the only credential the child may use; never fall
    // back to the desktop app's stored session on the same machine.
    SOCIAL_ARCHIVER_NO_DESKTOP_CREDENTIALS: '1',
  };
}

export function restartDelayMs(restarts: number): number {
  return Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** Math.max(0, restarts - 1));
}

export class StandaloneCliExecutorSupervisor {
  private child: ChildLike | null = null;
  private launch: CliExecutorLaunch | null = null;
  private stopRequested = false;
  private retryHandle: unknown = null;
  private killHandle: unknown = null;
  private exitWaiters: Array<() => void> = [];
  private stdoutBuffer = '';
  private stderrTail = '';
  private snapshot: CliExecutorSnapshot = {
    state: 'stopped',
    clientId: null,
    provider: null,
    providers: [],
    lastError: null,
    lastErrorCode: null,
    restarts: 0,
    startedAt: null,
    binaryPath: null,
  };

  constructor(private readonly deps: SupervisorDeps) {}

  getSnapshot(): CliExecutorSnapshot {
    return { ...this.snapshot, providers: [...this.snapshot.providers] };
  }

  isActive(): boolean {
    return this.child !== null || this.retryHandle !== null;
  }

  /**
   * Start (or restart, when the token/config/binary changed) the child.
   * A no-op when the same launch is already running or scheduled.
   */
  async start(launch: CliExecutorLaunch): Promise<void> {
    if (this.launch && sameLaunch(this.launch, launch) && (this.child || this.retryHandle)) return;
    if (this.child) await this.stop();
    this.clearRetry();
    this.launch = launch;
    this.stopRequested = false;
    this.update({ restarts: 0, lastError: null, lastErrorCode: null, binaryPath: launch.binaryPath });
    this.spawnChild();
  }

  /** SIGTERM, then SIGKILL after STOP_GRACE_MS; resolves once the child is gone. */
  async stop(): Promise<void> {
    this.stopRequested = true;
    this.clearRetry();
    const child = this.child;
    if (!child) {
      this.update({ state: 'stopped', clientId: null, provider: null, startedAt: null });
      return;
    }
    const exited = new Promise<void>((resolve) => this.exitWaiters.push(resolve));
    try {
      child.kill('SIGTERM');
    } catch (error) {
      this.deps.log?.('warn', 'SIGTERM failed', error);
    }
    this.killHandle = this.deps.schedule(() => {
      this.killHandle = null;
      try {
        this.child?.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }, STOP_GRACE_MS);
    await exited;
  }

  private spawnChild(): void {
    const launch = this.launch;
    if (!launch) return;
    const env = executorEnv(launch, this.deps.env ?? process.env, this.deps.extendedPath);
    let child: ChildLike;
    try {
      child = this.deps.spawn(launch.binaryPath, executorArgs(launch), { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      this.update({ state: 'crashed', lastError: errorMessage(error), lastErrorCode: 'SPAWN_FAILED' });
      this.scheduleRetry();
      return;
    }
    this.child = child;
    this.stdoutBuffer = '';
    this.stderrTail = '';
    this.deps.registerProcess?.(child);
    this.update({ state: 'starting', startedAt: this.deps.now(), clientId: null, provider: null });
    child.stdout?.on('data', (chunk) => this.onStdout(String(chunk)));
    child.stderr?.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + String(chunk)).slice(-STDERR_KEEP);
    });
    child.on('error', (error) => {
      this.update({ lastError: errorMessage(error), lastErrorCode: this.snapshot.lastErrorCode ?? 'SPAWN_FAILED' });
    });
    child.on('exit', (code, signal) => this.onExit(child, code, signal));
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length > 0) this.onLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private onLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const record = parsed as Record<string, unknown>;
    if (record.ok === false) {
      const error = (record.error ?? {}) as Record<string, unknown>;
      this.update({
        lastErrorCode: typeof error.code === 'string' ? error.code : 'UNKNOWN',
        lastError: typeof error.message === 'string' ? error.message : line,
      });
      return;
    }
    switch (record.event) {
      case 'registered':
        this.update({
          clientId: typeof record.clientId === 'string' ? record.clientId : null,
          provider: typeof record.provider === 'string' ? record.provider : null,
          providers: Array.isArray(record.providers) ? (record.providers as StandaloneCliProvider[]) : [],
        });
        return;
      case 'watching':
        this.update({ state: 'running', lastError: null, lastErrorCode: null });
        return;
      case 'failed':
        this.deps.log?.('warn', 'executor job failed', record);
        return;
      default:
        return;
    }
  }

  private onExit(child: ChildLike, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    this.child = null;
    if (this.killHandle !== null) {
      this.deps.clearSchedule(this.killHandle);
      this.killHandle = null;
    }
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    const stderr = this.stderrTail.trim();

    if (this.stopRequested) {
      this.update({ state: 'stopped', clientId: null, provider: null, startedAt: null });
      for (const resolve of waiters) resolve();
      return;
    }

    const code_ = this.snapshot.lastErrorCode;
    const detail = this.snapshot.lastError ?? (stderr.length > 0 ? stderr : `exit ${code ?? signal ?? '?'}`);
    if (code_ === 'AUTH_REQUIRED') {
      // A new token comes through start(); retrying with the same one is noise.
      this.update({ state: 'auth_required', lastError: detail, clientId: null, provider: null });
    } else if (code_ === 'SERVICE_NOT_READY') {
      this.update({ state: 'not_ready', lastError: detail, clientId: null, provider: null });
      this.retryHandle = this.deps.schedule(() => {
        this.retryHandle = null;
        this.spawnChild();
      }, NOT_READY_RETRY_MS);
    } else {
      this.update({
        state: 'crashed',
        restarts: this.snapshot.restarts + 1,
        lastError: detail,
        lastErrorCode: code_ ?? `EXIT_${code ?? signal ?? 'UNKNOWN'}`,
        clientId: null,
        provider: null,
      });
      this.scheduleRetry();
    }
    for (const resolve of waiters) resolve();
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const delay = restartDelayMs(this.snapshot.restarts);
    this.deps.log?.('warn', `executor exited; restarting in ${delay}ms`, { restarts: this.snapshot.restarts });
    this.retryHandle = this.deps.schedule(() => {
      this.retryHandle = null;
      this.spawnChild();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryHandle !== null) {
      this.deps.clearSchedule(this.retryHandle);
      this.retryHandle = null;
    }
  }

  private update(patch: Partial<CliExecutorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.deps.onChange?.(this.getSnapshot());
  }
}

function sameLaunch(a: CliExecutorLaunch, b: CliExecutorLaunch): boolean {
  return (
    a.binaryPath === b.binaryPath &&
    a.token === b.token &&
    a.configDir === b.configDir &&
    a.outputLanguage === b.outputLanguage &&
    (a.pollSeconds ?? DEFAULT_POLL_SECONDS) === (b.pollSeconds ?? DEFAULT_POLL_SECONDS)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
