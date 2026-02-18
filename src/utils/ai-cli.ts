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
  // Cached detection results
  private static detectedClis: Map<AICli, AICliDetectionResult> = new Map();
  private static primaryCli: AICli | null = null;
  private static primaryResult: AICliDetectionResult | null = null;

  // Cache TTL: 5 minutes
  private static cacheTimestamp: number = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000;

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
        '/Applications/Codex.app/Contents/MacOS/codex',
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
   * Detect first available AI CLI with full details
   * Results are cached for 5 minutes
   * @param preferredCli - If specified, try this CLI first
   */
  static async detect(preferredCli?: AICli): Promise<AICliDetectionResult> {
    // Check mobile first
    if (this.isMobile()) {
      return {
        available: false,
        cli: null,
        path: null,
        version: null,
        authenticated: false,
      };
    }

    // Return cached result if valid
    if (this.isCacheValid() && this.primaryResult) {
      // If preferred CLI matches cached, return it
      if (!preferredCli || this.primaryCli === preferredCli) {
        return this.primaryResult;
      }
      // If preferred CLI is different and already detected, return it
      const cachedPreferred = this.detectedClis.get(preferredCli);
      if (cachedPreferred) {
        return cachedPreferred;
      }
    }

    // Reset cache for fresh detection
    this.resetCache();

    try {
      const os = nodeRequire('os') as typeof import('os');
      const platform = os.platform();

      // Build CLI order based on preference
      let clis: AICli[];
      if (preferredCli) {
        clis = [preferredCli, ...(['claude', 'gemini', 'codex'] as AICli[]).filter(c => c !== preferredCli)];
      } else {
        // Default order: claude (most capable), gemini, codex
        clis = ['claude', 'gemini', 'codex'];
      }

      for (const cli of clis) {
        const result = await this.detectCli(cli, platform);
        if (result.available) {
          this.detectedClis.set(cli, result);

          // Set as primary if it's the first available or matches preference
          if (!this.primaryResult || cli === preferredCli) {
            this.primaryCli = cli;
            this.primaryResult = result;
          }
        }
      }

      this.cacheTimestamp = Date.now();

      if (this.primaryResult) {
        return this.primaryResult;
      }

      // No CLI found
      return {
        available: false,
        cli: null,
        path: null,
        version: null,
        authenticated: false,
      };
    } catch (error) {
      console.error('[AICliDetector] Detection failed:', error);
      this.cacheTimestamp = Date.now();

      return {
        available: false,
        cli: null,
        path: null,
        version: null,
        authenticated: false,
      };
    }
  }

  /**
   * Detect all available AI CLIs
   * @returns Map of detected CLIs and their results
   */
  static async detectAll(): Promise<Map<AICli, AICliDetectionResult>> {
    // Check mobile first
    if (this.isMobile()) {
      return new Map();
    }

    // Return cached results if valid
    if (this.isCacheValid() && this.detectedClis.size > 0) {
      return new Map(this.detectedClis);
    }

    // Reset cache for fresh detection
    this.resetCache();

    try {
      const os = nodeRequire('os') as typeof import('os');
      const platform = os.platform();

      const clis: AICli[] = ['claude', 'gemini', 'codex'];

      for (const cli of clis) {
        const result = await this.detectCli(cli, platform);
        if (result.available) {
          this.detectedClis.set(cli, result);

          // Set first available as primary
          if (!this.primaryResult) {
            this.primaryCli = cli;
            this.primaryResult = result;
          }
        }
      }

      this.cacheTimestamp = Date.now();
      return new Map(this.detectedClis);
    } catch (error) {
      console.error('[AICliDetector] DetectAll failed:', error);
      this.cacheTimestamp = Date.now();
      return new Map();
    }
  }

  /**
   * Get list of detected CLI names
   */
  static getDetectedClis(): AICli[] {
    return Array.from(this.detectedClis.keys());
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

    return {
      available: false,
      cli: null,
      path: null,
      version: null,
      authenticated: false,
    };
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
   * Check if cache is still valid
   */
  private static isCacheValid(): boolean {
    if (this.cacheTimestamp === 0) return false;
    return Date.now() - this.cacheTimestamp < this.CACHE_TTL;
  }

  /**
   * Get cached primary CLI path
   */
  static getPath(): string | null {
    return this.primaryResult?.path ?? null;
  }

  /**
   * Get cached primary CLI
   */
  static getCli(): AICli | null {
    return this.primaryCli;
  }

  /**
   * Get cached primary CLI version
   */
  static getVersion(): string | null {
    return this.primaryResult?.version ?? null;
  }

  /**
   * Get cached authentication status
   */
  static isAuthenticated(): boolean {
    return this.primaryResult?.authenticated ?? false;
  }

  /**
   * Get result for a specific CLI
   */
  static getCliResult(cli: AICli): AICliDetectionResult | null {
    return this.detectedClis.get(cli) ?? null;
  }

  /**
   * Reset detection cache
   */
  static resetCache(): void {
    this.detectedClis.clear();
    this.primaryCli = null;
    this.primaryResult = null;
    this.cacheTimestamp = 0;
  }
}
