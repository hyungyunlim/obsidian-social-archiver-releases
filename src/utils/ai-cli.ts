/**
 * AICliDetector - Detects locally installed AI CLI tools for AI-powered comment generation
 *
 * Supports:
 * - Claude Code (Anthropic CLI)
 * - Gemini CLI (Google)
 * - OpenAI Codex
 */

import { Platform } from 'obsidian';
import nodeRequire from './nodeRequire';

export type AICli = 'claude' | 'gemini' | 'codex';

export interface AICliDetectionResult {
  available: boolean;
  cli: AICli | null;
  path: string | null;
  version: string | null;
  authenticated: boolean;
}

export interface AICliInfo {
  name: AICli;
  displayName: string;
  description: string;
  installUrl: string;
}

export const AI_CLI_INFO: Record<AICli, AICliInfo> = {
  claude: {
    name: 'claude',
    displayName: 'Claude Code',
    description: 'Anthropic CLI for Claude AI',
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  gemini: {
    name: 'gemini',
    displayName: 'Gemini CLI',
    description: 'Google Gemini CLI',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  codex: {
    name: 'codex',
    displayName: 'OpenAI Codex',
    description: 'OpenAI Codex CLI',
    installUrl: 'https://github.com/openai/codex',
  },
};

export class AICliDetector {
  private static readonly SUPPORTED_CLIS: AICli[] = ['claude', 'gemini', 'codex'];

  // Cached per-CLI detection results (includes unavailable results)
  private static detectedClis: Map<AICli, AICliDetectionResult> = new Map();
  private static cliCacheTimestamps: Map<AICli, number> = new Map();
  private static primaryCli: AICli | null = null;
  private static primaryResult: AICliDetectionResult | null = null;

  // Full scan cache TTL: 5 minutes
  private static fullCacheTimestamp: number = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000;

  // In-flight detection dedupe
  private static inFlightDetectAll: Promise<Map<AICli, AICliDetectionResult>> | null = null;
  private static inFlightCliDetections: Map<AICli, Promise<AICliDetectionResult>> = new Map();

  // Incremented on reset to prevent stale async commits from repopulating cache
  private static cacheGeneration = 0;

  /**
   * Detection paths for each AI CLI tool by platform
   */
  private static readonly DETECTION_PATHS: Record<AICli, Record<string, string[]>> = {
    claude: {
      darwin: [
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        '~/.npm-global/bin/claude',
        '~/.local/bin/claude',
        // npm global installs
        '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.mjs',
      ],
      linux: [
        '/usr/bin/claude',
        '/usr/local/bin/claude',
        '~/.npm-global/bin/claude',
        '~/.local/bin/claude',
      ],
      win32: [
        '%APPDATA%\\npm\\claude.cmd',
        '%LOCALAPPDATA%\\npm\\claude.cmd',
        '%USERPROFILE%\\.npm-global\\claude.cmd',
      ],
    },
    gemini: {
      darwin: [
        '/opt/homebrew/bin/gemini',
        '/usr/local/bin/gemini',
        '~/.npm-global/bin/gemini',
        '~/.local/bin/gemini',
      ],
      linux: [
        '/usr/bin/gemini',
        '/usr/local/bin/gemini',
        '~/.npm-global/bin/gemini',
        '~/.local/bin/gemini',
      ],
      win32: [
        '%APPDATA%\\npm\\gemini.cmd',
        '%LOCALAPPDATA%\\npm\\gemini.cmd',
        '%USERPROFILE%\\.npm-global\\gemini.cmd',
      ],
    },
    codex: {
      darwin: [
        '/opt/homebrew/bin/codex',
        '/usr/local/bin/codex',
        '~/.npm-global/bin/codex',
        '~/.local/bin/codex',
        '~/.bun/bin/codex',
      ],
      linux: [
        '/usr/bin/codex',
        '/usr/local/bin/codex',
        '~/.npm-global/bin/codex',
        '~/.local/bin/codex',
        '~/.bun/bin/codex',
      ],
      win32: [
        '%APPDATA%\\npm\\codex.cmd',
        '%LOCALAPPDATA%\\npm\\codex.cmd',
        '%USERPROFILE%\\.npm-global\\codex.cmd',
        '%LOCALAPPDATA%\\Programs\\Codex\\codex.exe',
      ],
    },
  };

  /**
   * Check if any AI CLI is available
   */
  static async isAvailable(): Promise<boolean> {
    const result = await this.detect();
    return result.available;
  }

  /**
   * Check if this feature is desktop only
   */
  static isDesktopOnly(): boolean {
    return true;
  }

  /**
   * Check if running on mobile (where AI CLI is not available)
   */
  static isMobile(): boolean {
    return Platform.isMobile;
  }

  /**
   * Detect first available AI CLI with full details.
   * Results are cached for 5 minutes
   * @param preferredCli - If specified, detect only that CLI
   */
  static async detect(preferredCli?: AICli): Promise<AICliDetectionResult> {
    if (this.isMobile()) {
      return this.createUnavailableResult();
    }

    this.pruneExpiredCache();

    // No target specified: use a full scan and return the primary available CLI.
    if (!preferredCli) {
      await this.detectAll();
      return this.primaryResult ?? this.createUnavailableResult();
    }

    const cachedResult = this.getValidCachedCliResult(preferredCli);
    if (cachedResult) {
      return cachedResult;
    }

    // If a full scan is already running, wait for it instead of starting duplicate probes.
    if (this.inFlightDetectAll) {
      await this.inFlightDetectAll;
      this.pruneExpiredCache();
      return this.getValidCachedCliResult(preferredCli) ?? this.createUnavailableResult();
    }

    const inFlight = this.inFlightCliDetections.get(preferredCli);
    if (inFlight) {
      return inFlight;
    }

    const generation = this.cacheGeneration;
    const promise = (async () => {
      try {
        const os = nodeRequire('os') as typeof import('os');
        const platform = os.platform();
        const result = await this.detectCli(preferredCli, platform);

        this.commitCliResult(preferredCli, result, generation);
        return result;
      } catch (error) {
        console.error('[AICliDetector] Detection failed:', error);
        return this.createUnavailableResult();
      } finally {
        this.inFlightCliDetections.delete(preferredCli);
      }
    })();

    this.inFlightCliDetections.set(preferredCli, promise);
    return promise;
  }

  /**
   * Detect all available AI CLIs
   * @returns Map of detected CLIs and their results
   */
  static async detectAll(): Promise<Map<AICli, AICliDetectionResult>> {
    if (this.isMobile()) {
      return new Map();
    }

    this.pruneExpiredCache();

    if (this.isTimestampValid(this.fullCacheTimestamp)) {
      return this.getAvailableResults();
    }

    if (this.inFlightDetectAll) {
      return this.inFlightDetectAll;
    }

    const generation = this.cacheGeneration;
    this.inFlightDetectAll = (async () => {
      try {
        const os = nodeRequire('os') as typeof import('os');
        const platform = os.platform();
        const results = new Map<AICli, AICliDetectionResult>();

        for (const cli of this.SUPPORTED_CLIS) {
          const inFlightCli = this.inFlightCliDetections.get(cli);
          const result = inFlightCli
            ? await inFlightCli
            : await this.detectCli(cli, platform);
          results.set(cli, result);
        }

        this.commitAllResults(results, generation);
        return this.getAvailableResults();
      } catch (error) {
        console.error('[AICliDetector] DetectAll failed:', error);
        return this.getAvailableResults();
      } finally {
        this.inFlightDetectAll = null;
      }
    })();

    return this.inFlightDetectAll;
  }

  /**
   * Get list of detected CLI names
   */
  static getDetectedClis(): AICli[] {
    this.pruneExpiredCache();
    return this.SUPPORTED_CLIS.filter(cli => this.detectedClis.get(cli)?.available);
  }

  /**
   * Detect a specific AI CLI
   */
  private static async detectCli(
    cli: AICli,
    platform: string
  ): Promise<AICliDetectionResult> {
    const { exec } = nodeRequire('child_process') as typeof import('child_process');
    const { promisify } = nodeRequire('util') as typeof import('util');
    const execAsync = promisify(exec);
    const os = nodeRequire('os') as typeof import('os');

    const paths = this.DETECTION_PATHS[cli][platform] || [];
    const expandedPaths = paths.map((p: string) => this.expandPath(p, os));

    // Also try PATH lookup
    const pathBinary = this.getPathBinaryName(cli, platform);
    expandedPaths.unshift(pathBinary);

    // Extended PATH for Obsidian environment
    const isWindows = platform === 'win32';
    const pathSeparator = isWindows ? ';' : ':';
    const homedir = os.homedir();

    const extendedPathDirs = isWindows
      ? [
          // Windows common paths
          `${homedir}\\AppData\\Roaming\\npm`,
          `${homedir}\\AppData\\Local\\npm`,
          `${homedir}\\.npm-global`,
          `${homedir}\\.bun\\bin`,
          'C:\\Program Files\\nodejs',
          'C:\\Program Files (x86)\\nodejs',
          process.env.PATH || '',
        ]
      : [
          // macOS/Linux common paths
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
          `${homedir}/.local/bin`,
          `${homedir}/.npm-global/bin`,
          `${homedir}/.bun/bin`,
          process.env.PATH || '',
        ];
    const extendedPath = extendedPathDirs.join(pathSeparator);

    for (const cliPath of expandedPaths) {
      try {
        const versionCommand = this.getVersionCommand(cli, cliPath);

        // Use extended PATH for command execution
        const { stdout, stderr } = await execAsync(versionCommand, {
          timeout: 10000,
          env: { ...process.env, PATH: extendedPath }
        });
        const output = stdout || stderr;

        if (output) {
          const version = this.parseVersion(cli, output);
          if (version) {
            // Check authentication status
            const authenticated = this.checkAuthentication(cli, cliPath);

            return {
              available: true,
              cli,
              path: cliPath,
              version,
              authenticated,
            };
          }
        }
      } catch {
        // Continue to next path
      }
    }

    return this.createUnavailableResult();
  }

  /**
   * Get binary name for PATH lookup
   */
  private static getPathBinaryName(cli: AICli, platform: string): string {
    const isWindows = platform === 'win32';

    switch (cli) {
      case 'claude':
        return isWindows ? 'claude.cmd' : 'claude';
      case 'gemini':
        return isWindows ? 'gemini.cmd' : 'gemini';
      case 'codex':
        return isWindows ? 'codex.exe' : 'codex';
      default:
        return cli;
    }
  }

  /**
   * Get version check command for each CLI
   */
  private static getVersionCommand(cli: AICli, path: string): string {
    switch (cli) {
      case 'claude':
        return `"${path}" --version`;
      case 'gemini':
        return `"${path}" --version`;
      case 'codex':
        return `"${path}" --version`;
      default:
        return `"${path}" --version`;
    }
  }

  /**
   * Parse version string from output
   */
  private static parseVersion(cli: AICli, output: string): string | null {
    switch (cli) {
      case 'claude': {
        // Claude Code outputs: "2.0.69 (Claude Code)" or "claude-code 1.0.0"
        // Try version at start: "2.0.69 (Claude Code)"
        const versionFirst = output.match(/^([\d.]+)\s+\(Claude/i);
        if (versionFirst?.[1]) return versionFirst[1];
        // Try "claude-code 1.0.0" pattern
        const match = output.match(/claude(?:-code)?\s+([\d.]+)/i);
        if (match?.[1]) return match[1];
        // If output contains "claude" it's detected
        if (output.toLowerCase().includes('claude')) return 'detected';
        return null;
      }
      case 'gemini': {
        // Gemini CLI outputs: "gemini version X.Y.Z" or just "X.Y.Z"
        const match = output.match(/gemini\s+(?:version\s+)?([\d.]+)/i);
        if (match?.[1]) return match[1];
        // Some versions just output the version number directly
        const versionOnly = output.trim().match(/^(\d+\.\d+\.\d+)$/);
        if (versionOnly?.[1]) return versionOnly[1];
        if (output.toLowerCase().includes('gemini')) return 'detected';
        return null;
      }
      case 'codex': {
        // Codex outputs: "codex X.Y.Z" or "codex-cli X.Y.Z"
        const match = output.match(/codex(?:-cli)?\s+([\d.]+)/i);
        if (match?.[1]) return match[1];
        if (output.toLowerCase().includes('codex') || output.toLowerCase().includes('openai')) return 'detected';
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * Check authentication status for a CLI
   * Uses environment variables and config files for quick check
   */
  private static checkAuthentication(cli: AICli, _cliPath: string): boolean {
    try {
      const os = nodeRequire('os') as typeof import('os');
      const fs = nodeRequire('fs') as typeof import('fs');
      const path = nodeRequire('path') as typeof import('path');
      const homeDir = os.homedir();

      // Helper to check if any of the given paths exist
      const anyPathExists = (paths: string[]): boolean => {
        return paths.some(p => {
          try {
            return fs.existsSync(p);
          } catch {
            return false;
          }
        });
      };

      switch (cli) {
        case 'claude': {
          // Claude Code: check env var or OAuth credentials
          if (process.env.ANTHROPIC_API_KEY) return true;
          return anyPathExists([
            path.join(homeDir, '.claude'),
            path.join(homeDir, '.config', 'claude'),
          ]);
        }
        case 'gemini': {
          // Gemini CLI: check env vars or config files
          if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) return true;
          return anyPathExists([
            path.join(homeDir, '.gemini'),
            path.join(homeDir, '.config', 'gemini'),
          ]);
        }
        case 'codex': {
          // Codex CLI: check env var or config files
          if (process.env.OPENAI_API_KEY) return true;
          return anyPathExists([
            path.join(homeDir, '.codex'),
            path.join(homeDir, '.config', 'codex'),
          ]);
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Expand path variables like ~ and %USERPROFILE%
   */
  private static expandPath(pathStr: string, os: typeof import('os')): string {
    const homedir = os.homedir();
    const isWindowsPath = pathStr.includes('%') || pathStr.includes('\\');

    // Use backslashes for Windows paths
    const sep = isWindowsPath ? '\\' : '/';
    const homedirNormalized = isWindowsPath ? homedir.replace(/\//g, '\\') : homedir;

    return pathStr
      .replace(/^~/, homedirNormalized)
      .replace(/%USERPROFILE%/gi, homedirNormalized)
      .replace(/%LOCALAPPDATA%/gi, `${homedirNormalized}${sep}AppData${sep}Local`)
      .replace(/%APPDATA%/gi, `${homedirNormalized}${sep}AppData${sep}Roaming`);
  }

  /**
   * Create an unavailable detection result
   */
  private static createUnavailableResult(): AICliDetectionResult {
    return {
      available: false,
      cli: null,
      path: null,
      version: null,
      authenticated: false,
    };
  }

  /**
   * Check whether a cached timestamp is still valid
   */
  private static isTimestampValid(timestamp: number): boolean {
    if (timestamp === 0) return false;
    return Date.now() - timestamp < this.CACHE_TTL;
  }

  /**
   * Get a valid cached result for a specific CLI (available or unavailable)
   */
  private static getValidCachedCliResult(cli: AICli): AICliDetectionResult | null {
    const timestamp = this.cliCacheTimestamps.get(cli);
    if (!timestamp || !this.isTimestampValid(timestamp)) {
      return null;
    }

    return this.detectedClis.get(cli) ?? this.createUnavailableResult();
  }

  /**
   * Get only available results for callers that need detected CLIs
   */
  private static getAvailableResults(): Map<AICli, AICliDetectionResult> {
    const results = new Map<AICli, AICliDetectionResult>();
    for (const cli of this.SUPPORTED_CLIS) {
      const result = this.detectedClis.get(cli);
      if (result?.available) {
        results.set(cli, result);
      }
    }
    return results;
  }

  /**
   * Commit a single CLI detection result into cache if the generation matches.
   */
  private static commitCliResult(
    cli: AICli,
    result: AICliDetectionResult,
    generation: number
  ): void {
    if (generation !== this.cacheGeneration) {
      return;
    }

    const now = Date.now();
    this.detectedClis.set(cli, result);
    this.cliCacheTimestamps.set(cli, now);
    this.recomputePrimary();
  }

  /**
   * Commit a full detection pass into cache atomically.
   */
  private static commitAllResults(
    results: Map<AICli, AICliDetectionResult>,
    generation: number
  ): void {
    if (generation !== this.cacheGeneration) {
      return;
    }

    const now = Date.now();
    for (const cli of this.SUPPORTED_CLIS) {
      this.detectedClis.set(cli, results.get(cli) ?? this.createUnavailableResult());
      this.cliCacheTimestamps.set(cli, now);
    }

    this.fullCacheTimestamp = now;
    this.recomputePrimary();
  }

  /**
   * Remove expired per-CLI cache entries and keep primary selection consistent.
   */
  private static pruneExpiredCache(): void {
    const now = Date.now();

    for (const cli of this.SUPPORTED_CLIS) {
      const timestamp = this.cliCacheTimestamps.get(cli);
      if (!timestamp) continue;
      if (now - timestamp >= this.CACHE_TTL) {
        this.cliCacheTimestamps.delete(cli);
        this.detectedClis.delete(cli);
      }
    }

    if (!this.isTimestampValid(this.fullCacheTimestamp)) {
      this.fullCacheTimestamp = 0;
    }

    this.recomputePrimary();
  }

  /**
   * Keep primary CLI/result deterministic based on fixed CLI priority.
   */
  private static recomputePrimary(): void {
    this.primaryCli = null;
    this.primaryResult = null;

    for (const cli of this.SUPPORTED_CLIS) {
      const result = this.detectedClis.get(cli);
      if (result?.available) {
        this.primaryCli = cli;
        this.primaryResult = result;
        return;
      }
    }
  }

  /**
   * Get cached primary CLI path
   */
  static getPath(): string | null {
    this.pruneExpiredCache();
    return this.primaryResult?.path ?? null;
  }

  /**
   * Get cached primary CLI
   */
  static getCli(): AICli | null {
    this.pruneExpiredCache();
    return this.primaryCli;
  }

  /**
   * Get cached primary CLI version
   */
  static getVersion(): string | null {
    this.pruneExpiredCache();
    return this.primaryResult?.version ?? null;
  }

  /**
   * Get cached authentication status
   */
  static isAuthenticated(): boolean {
    this.pruneExpiredCache();
    return this.primaryResult?.authenticated ?? false;
  }

  /**
   * Get result for a specific CLI
   */
  static getCliResult(cli: AICli): AICliDetectionResult | null {
    this.pruneExpiredCache();
    const result = this.detectedClis.get(cli);
    return result?.available ? result : null;
  }

  /**
   * Reset detection cache
   */
  static resetCache(): void {
    this.cacheGeneration += 1;
    this.detectedClis.clear();
    this.cliCacheTimestamps.clear();
    this.primaryCli = null;
    this.primaryResult = null;
    this.fullCacheTimestamp = 0;
    this.inFlightDetectAll = null;
    this.inFlightCliDetections.clear();
  }
}
