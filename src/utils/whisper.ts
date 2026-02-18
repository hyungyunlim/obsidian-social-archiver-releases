/**
 * WhisperDetector - Detects locally installed Whisper variants for audio transcription
 *
 * Supports:
 * - faster-whisper (CTranslate2 backend, recommended)
 * - whisper.cpp (C++ implementation)
 * - openai-whisper (Original Python implementation)
 */

import nodeRequire from './nodeRequire';

export type WhisperVariant = 'faster-whisper' | 'whisper.cpp' | 'openai-whisper';
export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large' | 'large-v2' | 'large-v3';

export interface WhisperDetectionResult {
  available: boolean;
  variant: WhisperVariant | null;
  path: string | null;
  version: string | null;
  installedModels: WhisperModel[];
}

export interface WhisperModelInfo {
  name: WhisperModel;
  size: string;
  vramRequired: string;
  estimatedSpeed: string; // relative to audio length
}

export const WHISPER_MODEL_INFO: Record<WhisperModel, WhisperModelInfo> = {
  'tiny': { name: 'tiny', size: '74MB', vramRequired: '~1GB', estimatedSpeed: '~32x' },
  'base': { name: 'base', size: '142MB', vramRequired: '~1GB', estimatedSpeed: '~16x' },
  'small': { name: 'small', size: '466MB', vramRequired: '~2GB', estimatedSpeed: '~6x' },
  'medium': { name: 'medium', size: '1.5GB', vramRequired: '~5GB', estimatedSpeed: '~2x' },
  'large': { name: 'large', size: '2.9GB', vramRequired: '~10GB', estimatedSpeed: '~1x' },
  'large-v2': { name: 'large-v2', size: '2.9GB', vramRequired: '~10GB', estimatedSpeed: '~1x' },
  'large-v3': { name: 'large-v3', size: '2.9GB', vramRequired: '~10GB', estimatedSpeed: '~1x' },
};

 
export class WhisperDetector {
  // Cached detection results
  private static whisperAvailable: boolean | null = null;
  private static whisperVariant: WhisperVariant | null = null;
  private static whisperPath: string | null = null;
  private static whisperVersion: string | null = null;
  private static installedModels: WhisperModel[] | null = null;
  private static cachedPreference: 'auto' | WhisperVariant | null = null;

  // Cache TTL: 5 minutes
  private static cacheTimestamp: number = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000;

  /**
   * Detection paths for each Whisper variant by platform
   */
  private static readonly DETECTION_PATHS: Record<WhisperVariant, Record<string, string[]>> = {
    'faster-whisper': {
      darwin: [
        '/opt/homebrew/bin/faster-whisper',
        '/usr/local/bin/faster-whisper',
        // pipx / pip installs
        '~/.local/bin/faster-whisper',
        '~/.local/pipx/venvs/faster-whisper/bin/faster-whisper',
        // pyenv
        '~/.pyenv/shims/faster-whisper',
      ],
      linux: [
        '/usr/bin/faster-whisper',
        '/usr/local/bin/faster-whisper',
        '~/.local/bin/faster-whisper',
        '~/.local/pipx/venvs/faster-whisper/bin/faster-whisper',
      ],
      win32: [
        '%LOCALAPPDATA%\\Programs\\Python\\Python311\\Scripts\\faster-whisper.exe',
        '%LOCALAPPDATA%\\Programs\\Python\\Python310\\Scripts\\faster-whisper.exe',
        '%APPDATA%\\Python\\Python311\\Scripts\\faster-whisper.exe',
        '%APPDATA%\\Python\\Python310\\Scripts\\faster-whisper.exe',
        '%USERPROFILE%\\.local\\bin\\faster-whisper.exe',
      ],
    },
    'whisper.cpp': {
      darwin: [
        '/opt/homebrew/bin/whisper-cli',  // Homebrew installs as whisper-cli
        '/opt/homebrew/bin/whisper-cpp',
        '/opt/homebrew/bin/whisper',
        '/usr/local/bin/whisper-cli',
        '/usr/local/bin/whisper-cpp',
        '/usr/local/bin/whisper',
        '~/whisper.cpp/main',
        '~/whisper.cpp/build/bin/main',
        '~/whisper.cpp/build/bin/whisper-cli',
      ],
      linux: [
        '/usr/bin/whisper-cli',
        '/usr/bin/whisper-cpp',
        '/usr/local/bin/whisper-cli',
        '/usr/local/bin/whisper-cpp',
        '~/whisper.cpp/main',
        '~/whisper.cpp/build/bin/main',
        '~/whisper.cpp/build/bin/whisper-cli',
      ],
      win32: [
        '%USERPROFILE%\\whisper.cpp\\build\\bin\\Release\\main.exe',
        '%USERPROFILE%\\whisper.cpp\\build\\bin\\Release\\whisper-cli.exe',
        '%USERPROFILE%\\whisper.cpp\\main.exe',
        'C:\\whisper.cpp\\main.exe',
      ],
    },
    'openai-whisper': {
      darwin: [
        '/opt/homebrew/bin/whisper',
        '/usr/local/bin/whisper',
        '~/.local/bin/whisper',
        '~/.local/pipx/venvs/openai-whisper/bin/whisper',
        '~/.pyenv/shims/whisper',
      ],
      linux: [
        '/usr/bin/whisper',
        '/usr/local/bin/whisper',
        '~/.local/bin/whisper',
        '~/.local/pipx/venvs/openai-whisper/bin/whisper',
      ],
      win32: [
        '%LOCALAPPDATA%\\Programs\\Python\\Python311\\Scripts\\whisper.exe',
        '%LOCALAPPDATA%\\Programs\\Python\\Python310\\Scripts\\whisper.exe',
        '%APPDATA%\\Python\\Python311\\Scripts\\whisper.exe',
        '%APPDATA%\\Python\\Python310\\Scripts\\whisper.exe',
      ],
    },
  };

  /**
   * Check if any Whisper variant is available
   */
  static async isAvailable(): Promise<boolean> {
    const result = await this.detect();
    return result.available;
  }

  /**
   * Detect Whisper installation with full details
   * Results are cached for 5 minutes
   * @param preferredVariant - If specified (not 'auto'), try this variant first
   * @param customPath - If specified, try this path first before auto-detection
   * @param forceEnable - If true with customPath, skip validation (for ARM64/edge cases)
   */
  static async detect(preferredVariant?: 'auto' | WhisperVariant, customPath?: string, forceEnable?: boolean): Promise<WhisperDetectionResult> {
    const effectivePreference = preferredVariant || 'auto';

    // If customPath is provided, always try it first (bypass cache for custom paths)
    if (customPath) {
      // Force enable mode: skip validation, just check file exists
      if (forceEnable) {
        const forceResult = this.forceEnableCustomPath(customPath, preferredVariant);
        if (forceResult) {
          console.debug(`[WhisperDetector] Force enabled custom path: ${customPath}`);
          // Update cache with force-enabled result
          this.whisperAvailable = true;
          this.whisperVariant = forceResult.variant;
          this.whisperPath = forceResult.path;
          this.whisperVersion = forceResult.version;
          this.installedModels = this.detectModels(forceResult.variant, forceResult.path);
          this.cachedPreference = effectivePreference;
          this.cacheTimestamp = Date.now();

          return {
            available: true,
            variant: forceResult.variant,
            path: forceResult.path,
            version: forceResult.version,
            installedModels: this.installedModels,
          };
        }
      }

      // Normal validation
      const customResult = await this.validateCustomPath(customPath);
      if (customResult) {
        // Update cache with custom path result
        this.whisperAvailable = true;
        this.whisperVariant = customResult.variant;
        this.whisperPath = customResult.path;
        this.whisperVersion = customResult.version;
        this.installedModels = this.detectModels(customResult.variant, customResult.path);
        this.cachedPreference = effectivePreference;
        this.cacheTimestamp = Date.now();

        return {
          available: true,
          variant: customResult.variant,
          path: customResult.path,
          version: customResult.version,
          installedModels: this.installedModels,
        };
      }
      // Custom path validation failed - continue with auto-detection
      console.warn(`[WhisperDetector] Custom path validation failed: ${customPath}`);
    }

    // Return cached result only if:
    // 1. Cache is valid (not expired)
    // 2. The cached preference matches the current request
    //    - 'auto' cache can only be used for 'auto' requests
    //    - specific variant cache can only be used for same variant requests
    const cacheMatchesRequest = this.cachedPreference === effectivePreference;

    if (this.isCacheValid() && cacheMatchesRequest) {
      return {
        available: this.whisperAvailable ?? false,
        variant: this.whisperVariant,
        path: this.whisperPath,
        version: this.whisperVersion,
        installedModels: this.installedModels || [],
      };
    }

    // Reset cache for fresh detection
    this.resetCache();

    try {
      const os = nodeRequire('os') as typeof import('os');
      const platform = os.platform();

      // Check if running on Apple Silicon Mac
      const isAppleSilicon = platform === 'darwin' && os.arch() === 'arm64';

      // Build variant order based on preference
      let variants: WhisperVariant[];
      if (preferredVariant && preferredVariant !== 'auto') {
        // User specified a variant: try it first, then fall back to others
        variants = [preferredVariant, ...(['faster-whisper', 'whisper.cpp', 'openai-whisper'] as WhisperVariant[]).filter(v => v !== preferredVariant)];
      } else if (isAppleSilicon) {
        // Apple Silicon Mac: whisper.cpp first (Metal GPU acceleration)
        variants = ['whisper.cpp', 'faster-whisper', 'openai-whisper'];
      } else {
        // Other systems: faster-whisper first (easiest setup)
        variants = ['faster-whisper', 'whisper.cpp', 'openai-whisper'];
      }

      for (const variant of variants) {
        const result = await this.detectVariant(variant, platform);
        if (result) {
          this.whisperAvailable = true;
          this.whisperVariant = variant;
          this.whisperPath = result.path;
          this.whisperVersion = result.version;
          this.installedModels = this.detectModels(variant, result.path);
          this.cachedPreference = effectivePreference;
          this.cacheTimestamp = Date.now();

          return {
            available: true,
            variant,
            path: result.path,
            version: result.version,
            installedModels: this.installedModels,
          };
        }
      }

      // No Whisper found
      this.whisperAvailable = false;
      this.cachedPreference = effectivePreference;
      this.cacheTimestamp = Date.now();

      return {
        available: false,
        variant: null,
        path: null,
        version: null,
        installedModels: [],
      };
    } catch (error) {
      console.error('[WhisperDetector] Detection failed:', error);
      this.whisperAvailable = false;
      this.cacheTimestamp = Date.now();

      return {
        available: false,
        variant: null,
        path: null,
        version: null,
        installedModels: [],
      };
    }
  }

  /**
   * Validate a custom Whisper path provided by the user
   * Tries to detect which variant it is and verify it works
   * @param customPath - User-provided path to a Whisper binary
   */
  private static async validateCustomPath(
    customPath: string
  ): Promise<{ path: string; version: string; variant: WhisperVariant } | null> {
    const { exec } = nodeRequire('child_process') as typeof import('child_process');
    const { promisify } = nodeRequire('util') as typeof import('util');
    const execAsync = promisify(exec);
    const fs = nodeRequire('fs') as typeof import('fs');
    const path = nodeRequire('path') as typeof import('path');
    const os = nodeRequire('os') as typeof import('os');

    // Normalize path for Windows (handle both forward and backward slashes)
    let normalizedPath = customPath.trim();
    if (os.platform() === 'win32') {
      // Convert forward slashes to backslashes for Windows
      normalizedPath = normalizedPath.replace(/\//g, '\\');
    }

    // Expand environment variables and home directory
    normalizedPath = this.expandPath(normalizedPath, os);

    // Check if the file exists
    try {
      if (!fs.existsSync(normalizedPath)) {
        console.warn(`[WhisperDetector] Custom path file not found: ${normalizedPath}`);
        return null;
      }
    } catch (error) {
      console.warn(`[WhisperDetector] Error checking custom path: ${String(error)}`);
      return null;
    }

    // Determine expected variant based on filename
    const baseName = path.basename(normalizedPath).toLowerCase();
    let variantsToTry: WhisperVariant[];

    if (baseName.includes('faster-whisper') || baseName === 'faster-whisper.exe') {
      variantsToTry = ['faster-whisper', 'openai-whisper', 'whisper.cpp'];
    } else if (baseName.includes('whisper-cli') || baseName.includes('whisper.cpp') || baseName === 'main.exe') {
      variantsToTry = ['whisper.cpp', 'openai-whisper', 'faster-whisper'];
    } else {
      // Generic 'whisper' or 'whisper.exe' - could be any variant
      variantsToTry = ['openai-whisper', 'faster-whisper', 'whisper.cpp'];
    }

    // Try each variant to identify what this binary is
    for (const variant of variantsToTry) {
      try {
        const versionCommand = this.getVersionCommand(variant, normalizedPath);
        const { stdout, stderr } = await execAsync(versionCommand, { timeout: 15000 });
        const output = stdout || stderr;

        if (output) {
          const version = this.parseVersion(variant, output);
          if (version) {
            console.debug(`[WhisperDetector] Custom path validated as ${variant}: ${normalizedPath}`);
            return { path: normalizedPath, version, variant };
          }
        }
      } catch (error: unknown) {
        // Node.js exec throws on non-zero exit code, but error object contains stdout/stderr
        // Try to parse output even from failed commands (e.g., --help may exit with code 1 on some systems)
        const execError = error as { stdout?: string; stderr?: string; message?: string };
        const output = execError.stdout || execError.stderr || '';

        if (output) {
          const version = this.parseVersion(variant, output);
          if (version) {
            console.debug(`[WhisperDetector] Custom path validated as ${variant} (from error output): ${normalizedPath}`);
            return { path: normalizedPath, version, variant };
          }
        }

        // Log for debugging ARM64/Windows issues
        const errorMessage = execError.message || String(error);
        console.debug(`[WhisperDetector] Variant ${variant} check failed for ${normalizedPath}: ${errorMessage.slice(0, 100)}`);
        // Continue trying other variants
      }
    }

    console.warn(`[WhisperDetector] Could not validate custom path as any known Whisper variant: ${normalizedPath}`);
    return null;
  }

  /**
   * Force enable a custom Whisper path without full validation
   * Only checks if file exists and determines variant from filename/user preference
   * Use this for ARM64, Windows, or other edge cases where --help validation fails
   * @param customPath - User-provided path to a Whisper binary
   * @param preferredVariant - User's preferred variant (helps determine the variant type)
   */
  private static forceEnableCustomPath(
    customPath: string,
    preferredVariant?: 'auto' | WhisperVariant
  ): { path: string; version: string; variant: WhisperVariant } | null {
    const fs = nodeRequire('fs') as typeof import('fs');
    const path = nodeRequire('path') as typeof import('path');
    const os = nodeRequire('os') as typeof import('os');

    // Normalize path for Windows (handle both forward and backward slashes)
    let normalizedPath = customPath.trim();
    if (os.platform() === 'win32') {
      normalizedPath = normalizedPath.replace(/\//g, '\\');
    }

    // Expand environment variables and home directory
    normalizedPath = this.expandPath(normalizedPath, os);

    // Check if the file exists
    try {
      if (!fs.existsSync(normalizedPath)) {
        console.warn(`[WhisperDetector] Force enable failed - file not found: ${normalizedPath}`);
        return null;
      }
    } catch (error) {
      console.warn(`[WhisperDetector] Force enable failed - error checking path: ${String(error)}`);
      return null;
    }

    // Determine variant from filename or user preference
    const baseName = path.basename(normalizedPath).toLowerCase();
    let variant: WhisperVariant;

    if (preferredVariant && preferredVariant !== 'auto') {
      // Use user's explicit preference
      variant = preferredVariant;
    } else if (baseName.includes('faster-whisper') || baseName === 'faster-whisper.exe') {
      variant = 'faster-whisper';
    } else if (baseName.includes('whisper-cli') || baseName.includes('whisper.cpp') || baseName === 'main.exe') {
      variant = 'whisper.cpp';
    } else {
      // Default to openai-whisper for generic 'whisper' or 'whisper.exe'
      variant = 'openai-whisper';
    }

    console.debug(`[WhisperDetector] Force enabled ${variant} at: ${normalizedPath}`);
    return {
      path: normalizedPath,
      version: 'force-enabled', // Indicate this was force-enabled without validation
      variant,
    };
  }

  /**
   * Detect a specific Whisper variant
   */
  private static async detectVariant(
    variant: WhisperVariant,
    platform: string
  ): Promise<{ path: string; version: string } | null> {
    const { exec } = nodeRequire('child_process') as typeof import('child_process');
    const { promisify } = nodeRequire('util') as typeof import('util');
    const execAsync = promisify(exec);
    const os = nodeRequire('os') as typeof import('os');

    const paths = this.DETECTION_PATHS[variant][platform] || [];
    const expandedPaths = paths.map(p => this.expandPath(p, os));

    // Also try PATH lookup (multiple binary names)
    const pathBinaries = this.getPathBinaryNames(variant, platform);
    for (const pathBinary of pathBinaries) {
      expandedPaths.unshift(pathBinary);
    }

    for (const whisperPath of expandedPaths) {
      try {
        const versionCommand = this.getVersionCommand(variant, whisperPath);
        const { stdout, stderr } = await execAsync(versionCommand, { timeout: 10000 });
        const output = stdout || stderr;

        if (output) {
          const version = this.parseVersion(variant, output);
          // Only accept if parseVersion confirmed this is the correct variant
          // (version will be null if the help output doesn't match expected patterns)
          if (version) {
            return { path: whisperPath, version };
          }
        }
      } catch (error: unknown) {
        // Node.js exec throws on non-zero exit code, but error object contains stdout/stderr
        // Try to parse output even from failed commands (e.g., --help may exit with code 1 on some systems)
        const execError = error as { stdout?: string; stderr?: string; message?: string };
        const output = execError.stdout || execError.stderr || '';

        if (output) {
          const version = this.parseVersion(variant, output);
          if (version) {
            return { path: whisperPath, version };
          }
        }

        // Log at debug level for troubleshooting
        const errorMessage = execError.message || String(error);
        console.debug(`[WhisperDetector] Path ${whisperPath} check failed: ${errorMessage.slice(0, 100)}`);
        // Continue to next path
      }
    }

    return null;
  }

  /**
   * Get binary names for PATH lookup (returns array to try multiple names)
   */
  private static getPathBinaryNames(variant: WhisperVariant, platform: string): string[] {
    const isWindows = platform === 'win32';

    switch (variant) {
      case 'faster-whisper':
        return isWindows ? ['faster-whisper.exe'] : ['faster-whisper'];
      case 'whisper.cpp':
        // Homebrew installs as whisper-cli, source builds as main or whisper
        return isWindows
          ? ['whisper-cli.exe', 'whisper.exe']
          : ['whisper-cli', 'whisper-cpp', 'whisper'];
      case 'openai-whisper':
        return isWindows ? ['whisper.exe'] : ['whisper'];
      default:
        return [];
    }
  }

  /**
   * Get version check command for each variant
   */
  private static getVersionCommand(variant: WhisperVariant, path: string): string {
    switch (variant) {
      case 'faster-whisper':
        return `"${path}" --version`;
      case 'whisper.cpp':
        // whisper.cpp doesn't have --version, use --help
        return `"${path}" --help`;
      case 'openai-whisper':
        // openai-whisper doesn't have --version, use --help (shows usage)
        return `"${path}" --help`;
      default:
        return `"${path}" --version`;
    }
  }

  /**
   * Parse version string from output
   */
  private static parseVersion(variant: WhisperVariant, output: string): string | null {
    switch (variant) {
      case 'faster-whisper': {
        // faster-whisper 0.10.0 or "faster-whisper (version unknown)"
        if (output.includes('faster-whisper')) {
          const match = output.match(/faster-whisper\s+([\d.]+)/i);
          return match?.[1] ?? 'detected';
        }
        return null;
      }
      case 'whisper.cpp': {
        // Look for version in help output
        const match = output.match(/whisper(?:\.cpp)?\s+(?:version\s+)?([\d.]+)/i);
        if (match?.[1]) return match[1];
        // whisper.cpp detected but version unknown
        if (output.includes('usage:') || output.includes('options:')) {
          return 'detected';
        }
        return null;
      }
      case 'openai-whisper': {
        // openai-whisper help output contains "--model MODEL" (uppercase MODEL) and "output_format"
        // whisper.cpp uses "--model FNAME" (uppercase FNAME), so check specifically for MODEL
        // Also verify it doesn't look like whisper.cpp (which has "usage:" and specific flags like "-m FNAME")
        const isWhisperCpp = output.includes('usage:') && (output.includes('-m FNAME') || output.includes('--model FNAME'));
        if (isWhisperCpp) {
          return null; // This is whisper.cpp, not openai-whisper
        }

        if (output.includes('--model MODEL') || output.includes('output_format')) {
          return 'detected';
        }

        // openai-whisper might also have "Transcribe" in help
        if (output.includes('Transcribe audio') || output.includes('openai-whisper')) {
          return 'detected';
        }

        return null;
      }
      default:
        return null;
    }
  }

  /**
   * Detect installed Whisper models
   */
  private static detectModels(
    variant: WhisperVariant,
    _whisperPath: string
  ): WhisperModel[] {
    const os = nodeRequire('os') as typeof import('os');
    const path = nodeRequire('path') as typeof import('path');
    const fs = nodeRequire('fs') as typeof import('fs');

    const models: WhisperModel[] = [];
    const modelNames: WhisperModel[] = ['tiny', 'base', 'small', 'medium', 'large', 'large-v2', 'large-v3'];

    try {
      // Common model directories
      const modelDirs: string[] = [];

      switch (variant) {
        case 'faster-whisper':
          // faster-whisper stores models in ~/.cache/huggingface/hub
          modelDirs.push(
            path.join(os.homedir(), '.cache', 'huggingface', 'hub'),
            path.join(os.homedir(), '.cache', 'whisper')
          );
          break;

        case 'whisper.cpp':
          // whisper.cpp models are typically in ./models or ~/whisper.cpp/models
          modelDirs.push(
            path.join(os.homedir(), 'whisper.cpp', 'models'),
            path.join(os.homedir(), '.cache', 'whisper'),
            './models'
          );
          break;

        case 'openai-whisper':
          // openai-whisper stores in ~/.cache/whisper
          modelDirs.push(
            path.join(os.homedir(), '.cache', 'whisper')
          );
          break;
      }

      for (const dir of modelDirs) {
        if (!fs.existsSync(dir)) continue;

        const files = fs.readdirSync(dir);

        for (const modelName of modelNames) {
          // Check for model files/directories
          const hasModel = files.some((file: string) => {
            const lower = file.toLowerCase();
            // Match patterns like:
            // - ggml-medium.bin (whisper.cpp)
            // - medium.pt (openai-whisper)
            // - Systran--faster-whisper-medium (faster-whisper)
            return lower.includes(modelName) && (
              lower.endsWith('.bin') ||
              lower.endsWith('.pt') ||
              lower.includes('faster-whisper') ||
              fs.statSync(path.join(dir, file)).isDirectory()
            );
          });

          if (hasModel && !models.includes(modelName)) {
            models.push(modelName);
          }
        }
      }
    } catch (error) {
      console.debug('[WhisperDetector] Model detection error:', error);
    }

    // If no models detected, assume common models are available
    // (they will be downloaded on first use)
    if (models.length === 0) {
      return ['tiny', 'base', 'small', 'medium'];
    }

    return models;
  }

  /**
   * Expand path variables like ~ and %USERPROFILE%
   * Uses actual environment variables on Windows for correct paths
   */
  private static expandPath(pathStr: string, os: typeof import('os')): string {
    const homedir = os.homedir();
    const username = os.userInfo().username;
    const isWindows = os.platform() === 'win32';

    // Use actual environment variables on Windows, fallback to constructed paths
    const localAppData = process.env.LOCALAPPDATA || (isWindows ? `${homedir}\\AppData\\Local` : `${homedir}/.local`);
    const appData = process.env.APPDATA || (isWindows ? `${homedir}\\AppData\\Roaming` : `${homedir}/.config`);

    let expanded = pathStr
      .replace(/^~/, homedir)
      .replace(/%USERPROFILE%/gi, homedir)
      .replace(/%LOCALAPPDATA%/gi, localAppData)
      .replace(/%APPDATA%/gi, appData)
      .replace(/%USERNAME%/gi, username);

    // Normalize path separators for the current platform
    if (isWindows) {
      expanded = expanded.replace(/\//g, '\\');
    }

    return expanded;
  }

  /**
   * Check if cache is still valid
   */
  private static isCacheValid(): boolean {
    if (this.whisperAvailable === null) return false;
    return Date.now() - this.cacheTimestamp < this.CACHE_TTL;
  }

  /**
   * Get cached detection result
   */
  static getPath(): string | null {
    return this.whisperPath;
  }

  /**
   * Get cached variant
   */
  static getVariant(): WhisperVariant | null {
    return this.whisperVariant;
  }

  /**
   * Get cached version
   */
  static getVersion(): string | null {
    return this.whisperVersion;
  }

  /**
   * Get cached installed models
   */
  static getInstalledModels(): WhisperModel[] {
    return this.installedModels || [];
  }

  /**
   * Get recommended model based on available models
   * Preference: medium > small > base > tiny
   */
  static getRecommendedModel(): WhisperModel {
    const models = this.installedModels || [];
    const preference: WhisperModel[] = ['medium', 'small', 'base', 'tiny'];

    for (const model of preference) {
      if (models.includes(model)) {
        return model;
      }
    }

    return 'medium'; // Default recommendation
  }

  /**
   * Estimate transcription time based on audio duration and model
   * @param audioDurationSeconds Audio duration in seconds
   * @param model Whisper model to use
   * @returns Estimated time in seconds
   */
  static estimateTranscriptionTime(audioDurationSeconds: number, model: WhisperModel, variant?: WhisperVariant | null): number {
    // Speed multipliers vary by Whisper implementation and hardware
    // Multiplier = how many times faster than real-time
    // e.g., 25x means 37min audio takes ~1.5min

    const fasterWhisperMultipliers: Record<WhisperModel, number> = {
      'tiny': 40,      // Very fast
      'base': 20,
      'small': 8,      // Benchmark: ~7.6x on CPU
      'medium': 4,
      'large': 2,
      'large-v2': 2,
      'large-v3': 2,
    };

    // whisper.cpp on CPU (no GPU acceleration)
    const whisperCppCpuMultipliers: Record<WhisperModel, number> = {
      'tiny': 20,
      'base': 10,
      'small': 4,
      'medium': 2,
      'large': 1,
      'large-v2': 1,
      'large-v3': 1,
    };

    // whisper.cpp on Apple Silicon with Metal GPU acceleration
    // Based on M1 Max benchmarks: 37min audio in ~1.5min = ~25x for small model
    const whisperCppMetalMultipliers: Record<WhisperModel, number> = {
      'tiny': 80,      // Very fast with Metal
      'base': 50,
      'small': 25,     // Benchmark: ~25x on M1 Max
      'medium': 15,
      'large': 8,
      'large-v2': 8,
      'large-v3': 8,
    };

    const openaiWhisperMultipliers: Record<WhisperModel, number> = {
      'tiny': 10,
      'base': 5,
      'small': 2,      // Benchmark: ~1.9x
      'medium': 1,
      'large': 0.5,    // Slower than real-time
      'large-v2': 0.5,
      'large-v3': 0.5,
    };

    // Check if running on Apple Silicon (for Metal GPU acceleration)
    const os = nodeRequire('os') as typeof import('os');
    const isAppleSilicon = os.platform() === 'darwin' && os.arch() === 'arm64';

    // Select multipliers based on variant (default to faster-whisper)
    const activeVariant = variant ?? this.whisperVariant ?? 'faster-whisper';
    let multipliers: Record<WhisperModel, number>;

    switch (activeVariant) {
      case 'faster-whisper':
        multipliers = fasterWhisperMultipliers;
        break;
      case 'whisper.cpp':
        // Use Metal-accelerated multipliers on Apple Silicon
        multipliers = isAppleSilicon ? whisperCppMetalMultipliers : whisperCppCpuMultipliers;
        break;
      case 'openai-whisper':
        multipliers = openaiWhisperMultipliers;
        break;
      default:
        multipliers = fasterWhisperMultipliers;
    }

    const multiplier = multipliers[model] || 4;
    return Math.ceil(audioDurationSeconds / multiplier);
  }

  /**
   * Format estimated time for display
   */
  static formatEstimatedTime(seconds: number): string {
    if (seconds < 60) {
      return `~${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.ceil(seconds / 60);
      return `~${minutes} min`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.ceil((seconds % 3600) / 60);
      return `~${hours}h ${minutes}m`;
    }
  }

  /**
   * Reset detection cache
   */
  static resetCache(): void {
    this.whisperAvailable = null;
    this.whisperVariant = null;
    this.whisperPath = null;
    this.whisperVersion = null;
    this.installedModels = null;
    this.cachedPreference = null;
    this.cacheTimestamp = 0;
  }
}
