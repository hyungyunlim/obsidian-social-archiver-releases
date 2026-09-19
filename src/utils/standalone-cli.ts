/**
 * Standalone Social Archiver CLI (`social-archiver`) discovery.
 *
 * The plugin hands local AI execution to `social-archiver executor` when the
 * CLI is installed (StandaloneCliExecutorSupervisor) instead of running its
 * own provider port. This module only answers "is it here, which version, and
 * what does its executor see" — it never starts the executor.
 *
 * Desktop only. Probes go through the shell with the same extended PATH the
 * AI CLI detection uses, so Homebrew / ~/.local/bin / npm-global installs
 * resolve from a GUI-launched Obsidian whose PATH is minimal.
 */
import { Platform } from 'obsidian';
import nodeRequire from './nodeRequire';
import { buildExtendedPath } from './ai-cli';

/** First CLI that ships the Apple on-device helper and the executor contract this integration relies on. */
export const STANDALONE_CLI_MIN_VERSION = '0.1.15';
export const STANDALONE_CLI_GUIDE_URL = 'https://docs.social-archive.org/en/guide/cli';
export const STANDALONE_CLI_BREW_COMMAND = 'brew install hyungyunlim/tap/social-archiver-cli';
/**
 * The desktop app bundles the same CLI (beside its Apple Intelligence helper,
 * which the CLI finds next to itself), so a Mac with the app installed has it
 * even without Homebrew.
 */
export const DESKTOP_BUNDLE_CLI_PATH =
  '/Applications/Social Archiver Desktop.app/Contents/Resources/binaries/social-archiver';

export interface StandaloneCliDetection {
  available: boolean;
  path: string | null;
  version: string | null;
  /** false when the CLI is present but older than STANDALONE_CLI_MIN_VERSION. */
  supported: boolean;
}

/** One row of `social-archiver executor --providers`. */
export interface StandaloneCliProvider {
  id: string;
  available: boolean;
  authenticated: boolean;
  version?: string;
  path?: string;
  /** Apple on-device only: modelNotReady, appleIntelligenceNotEnabled, osTooOld, deviceNotEligible, helper_missing… */
  reason?: string;
  contextSize?: number;
}

export type ShellExec = (
  command: string,
  options: { env: NodeJS.ProcessEnv; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface StandaloneCliDetectorDeps {
  platform?: NodeJS.Platform;
  homedir?: string;
  env?: NodeJS.ProcessEnv;
  exec?: ShellExec;
  /** Manual path from settings; empty = find it on PATH. */
  overridePath?: string;
  exists?: (path: string) => boolean;
}

const UNAVAILABLE: StandaloneCliDetection = { available: false, path: null, version: null, supported: false };
const VERSION_TIMEOUT_MS = 10_000;
const PROVIDERS_TIMEOUT_MS = 45_000;

export function parseCliVersion(output: string): string | null {
  const match = /(?:^|\s)social-archiver\s+v?(\d+\.\d+\.\d+)/m.exec(output);
  return match?.[1] ?? null;
}

/** `compareVersions('0.1.15', '0.1.9') > 0`; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function quote(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

function defaultExec(): ShellExec {
  const { exec } = nodeRequire('child_process') as typeof import('child_process');
  const { promisify } = nodeRequire('util') as typeof import('util');
  const execAsync = promisify(exec);
  return async (command, options) => {
    const result = await execAsync(command, { env: options.env, timeout: options.timeout, windowsHide: true });
    return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
  };
}

function defaultExists(): (path: string) => boolean {
  const fs = nodeRequire('fs') as typeof import('fs');
  return (path) => {
    try {
      return fs.statSync(path).isFile();
    } catch {
      return false;
    }
  };
}

function isMobile(): boolean {
  try {
    return Platform.isMobile;
  } catch {
    return false;
  }
}

/** Every `social-archiver` on the (extended) PATH in PATH order, plus the desktop bundle copy on macOS. */
export function cliCandidates(platform: NodeJS.Platform, extendedPath: string, exists: (path: string) => boolean): string[] {
  const windows = platform === 'win32';
  const names = windows ? ['social-archiver.exe', 'social-archiver.cmd'] : ['social-archiver'];
  const sep = windows ? '\\' : '/';
  const seen = new Set<string>();
  for (const dir of extendedPath.split(windows ? ';' : ':')) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
      if (!seen.has(candidate) && exists(candidate)) seen.add(candidate);
    }
  }
  if (platform === 'darwin' && exists(DESKTOP_BUNDLE_CLI_PATH)) seen.add(DESKTOP_BUNDLE_CLI_PATH);
  return [...seen];
}

export class StandaloneCliDetector {
  static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static cache: { at: number; result: StandaloneCliDetection; key: string } | null = null;

  static resetCache(): void {
    this.cache = null;
  }

  /** Cached for CACHE_TTL_MS per override path; `forceRefresh` bypasses it. */
  static async detect(deps: StandaloneCliDetectorDeps = {}, forceRefresh = false): Promise<StandaloneCliDetection> {
    const key = deps.overridePath ?? '';
    const cached = this.cache;
    if (!forceRefresh && cached && cached.key === key && Date.now() - cached.at < this.CACHE_TTL_MS) {
      return cached.result;
    }
    const result = await this.probe(deps);
    this.cache = { at: Date.now(), result, key };
    return result;
  }

  private static async probe(deps: StandaloneCliDetectorDeps): Promise<StandaloneCliDetection> {
    if (isMobile()) return UNAVAILABLE;
    const platform = deps.platform ?? process.platform;
    const homedir = deps.homedir ?? (nodeRequire('os') as typeof import('os')).homedir();
    const env = deps.env ?? process.env;
    const exec = deps.exec ?? defaultExec();
    const exists = deps.exists ?? defaultExists();
    const probeEnv: NodeJS.ProcessEnv = { ...env, PATH: buildExtendedPath(platform, homedir, env.PATH ?? '') };

    // An explicit path is exclusive: a typo must surface as "not found", not
    // as a silently different binary. Otherwise every install on the extended
    // PATH is a candidate and the NEWEST wins — a stale Homebrew copy ahead of
    // a fresh ~/.local/bin one must not shadow it (seen 0.1.7 vs 0.1.14).
    const override = deps.overridePath?.trim();
    const candidates = override ? [override] : cliCandidates(platform, probeEnv.PATH ?? '', exists);

    const found = await Promise.all(
      candidates.map(async (candidate): Promise<StandaloneCliDetection | null> => {
        try {
          const { stdout, stderr } = await exec(`${quote(candidate)} --version`, { env: probeEnv, timeout: VERSION_TIMEOUT_MS });
          const version = parseCliVersion(stdout || stderr);
          if (!version) return null;
          return { available: true, path: candidate, version, supported: compareVersions(version, STANDALONE_CLI_MIN_VERSION) >= 0 };
        } catch {
          return null;
        }
      }),
    );
    let best: StandaloneCliDetection | null = null;
    for (const entry of found) {
      if (entry && (!best || compareVersions(entry.version ?? '0', best.version ?? '0') > 0)) best = entry;
    }
    return best ?? UNAVAILABLE;
  }

  /** `executor --providers` — presence and readiness per provider, never key material. */
  static async probeProviders(cliPath: string, deps: StandaloneCliDetectorDeps = {}): Promise<StandaloneCliProvider[]> {
    if (isMobile()) return [];
    const platform = deps.platform ?? process.platform;
    const homedir = deps.homedir ?? (nodeRequire('os') as typeof import('os')).homedir();
    const env = deps.env ?? process.env;
    const exec = deps.exec ?? defaultExec();
    const probeEnv: NodeJS.ProcessEnv = { ...env, PATH: buildExtendedPath(platform, homedir, env.PATH ?? '') };
    try {
      const { stdout } = await exec(`${quote(cliPath)} executor --providers --format json`, {
        env: probeEnv,
        timeout: PROVIDERS_TIMEOUT_MS,
      });
      return parseProvidersOutput(stdout);
    } catch {
      return [];
    }
  }
}

/** The envelope is `{ ok, data: { providers: [...] } }`; anything else is "no information". */
export function parseProvidersOutput(stdout: string): StandaloneCliProvider[] {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('{'))
    .pop();
  if (!line) return [];
  try {
    const parsed = JSON.parse(line) as { ok?: boolean; data?: { providers?: unknown } };
    const providers = parsed.data?.providers;
    if (!parsed.ok || !Array.isArray(providers)) return [];
    return providers.flatMap((entry): StandaloneCliProvider[] => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Record<string, unknown>;
      if (typeof row.id !== 'string') return [];
      return [{
        id: row.id,
        available: row.available === true,
        authenticated: row.authenticated === true,
        ...(typeof row.version === 'string' ? { version: row.version } : {}),
        ...(typeof row.path === 'string' ? { path: row.path } : {}),
        ...(typeof row.reason === 'string' ? { reason: row.reason } : {}),
        ...(typeof row.contextSize === 'number' ? { contextSize: row.contextSize } : {}),
      }];
    });
  } catch {
    return [];
  }
}
