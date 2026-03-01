/**
 * resolveNodeEnv
 *
 * Cross-platform Node.js environment resolution for spawning child processes.
 * GUI apps (Electron/Obsidian) on macOS don't inherit PATH from login shells,
 * and Windows has multiple possible Node.js install locations (MSI, nvm-windows, fnm).
 *
 * Shared by SupertonicInstaller and SupertonicProvider to avoid SRP violation.
 */

// ============================================================================
// Types
// ============================================================================

/** Abstraction over Node.js built-in modules for testability. */
export interface NodeModules {
  os: typeof import('os');
  child_process: typeof import('child_process');
  fs: typeof import('fs');
}

// ============================================================================
// Module-level cache
// ============================================================================

let cachedEnvPath: string | null = null;
let cachedNodeBinary: string | null = null;

/** Reset cached values (for testing). */
export function resetCache(): void {
  cachedEnvPath = null;
  cachedNodeBinary = null;
}

// ============================================================================
// resolveEnvPath
// ============================================================================

/**
 * Resolve a PATH string that includes the user's full shell paths.
 *
 * - macOS/Linux: runs a login shell to capture `$PATH` from dotfiles,
 *   with fallback to common binary directories.
 * - Windows: probes common Node.js install locations (standard MSI,
 *   nvm-windows, fnm) and appends them to the existing PATH.
 *
 * Result is cached at module level for the lifetime of the process.
 */
export function resolveEnvPath(modules: NodeModules): string {
  if (cachedEnvPath) return cachedEnvPath;

  const platform = modules.os.platform();

  if (platform === 'win32') {
    cachedEnvPath = resolveWindowsPath(modules);
  } else {
    cachedEnvPath = resolvePosixPath(modules);
  }

  return cachedEnvPath;
}

// ============================================================================
// findNodeBinary
// ============================================================================

/**
 * Returns the best available Node.js binary path.
 *
 * - macOS/Linux: returns `'node'` (relies on resolved PATH).
 * - Windows: tries `where.exe node`, then probes standard install locations,
 *   falls back to `'node'`.
 *
 * Result is cached at module level.
 */
export function findNodeBinary(modules: NodeModules): string {
  if (cachedNodeBinary) return cachedNodeBinary;

  const platform = modules.os.platform();

  if (platform !== 'win32') {
    cachedNodeBinary = 'node';
    return cachedNodeBinary;
  }

  // Windows: try where.exe first
  try {
    const result = modules.child_process.execSync('where.exe node', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    const firstLine = result.trim().split('\n')[0]?.trim();
    if (firstLine && firstLine.endsWith('.exe')) {
      cachedNodeBinary = firstLine;
      return cachedNodeBinary;
    }
  } catch {
    // where.exe failed — try probing standard paths
  }

  // Probe standard Windows Node.js locations
  const probePaths = getWindowsNodeProbePaths(modules);
  for (const candidate of probePaths) {
    const nodePath = `${candidate}\\node.exe`;
    try {
      if (modules.fs.existsSync(nodePath)) {
        cachedNodeBinary = nodePath;
        return cachedNodeBinary;
      }
    } catch {
      // Continue probing
    }
  }

  // Fallback: hope it's on PATH
  cachedNodeBinary = 'node';
  return cachedNodeBinary;
}

// ============================================================================
// findNpmCommand
// ============================================================================

/**
 * Returns the npm command appropriate for the current platform.
 *
 * - macOS/Linux: `'npm'`
 * - Windows: `'npm.cmd'`
 */
export function findNpmCommand(modules: NodeModules): string {
  return modules.os.platform() === 'win32' ? 'npm.cmd' : 'npm';
}

// ============================================================================
// Internal: Platform-specific PATH resolution
// ============================================================================

function resolvePosixPath(modules: NodeModules): string {
  // Try to get full PATH from the user's login shell
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const result = modules.child_process.execSync(`${shell} -lic 'echo $PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { HOME: modules.os.homedir(), USER: modules.os.userInfo().username },
    });

    const lines = result.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('/') && trimmed.includes(':')) {
        return trimmed;
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: append common binary locations to current PATH
  const currentPath = process.env.PATH || '';
  const additional = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const toAdd = additional.filter((p) => !currentPath.includes(p));
  return toAdd.length > 0 ? [...toAdd, currentPath].join(':') : currentPath;
}

function resolveWindowsPath(modules: NodeModules): string {
  const currentPath = process.env.PATH || process.env.Path || '';
  const additional = getWindowsNodeProbePaths(modules);

  // Only add paths that exist and aren't already in PATH
  const toAdd: string[] = [];
  for (const candidate of additional) {
    if (currentPath.toLowerCase().includes(candidate.toLowerCase())) continue;
    try {
      if (modules.fs.existsSync(candidate)) {
        toAdd.push(candidate);
      }
    } catch {
      // Skip inaccessible paths
    }
  }

  return toAdd.length > 0 ? [currentPath, ...toAdd].join(';') : currentPath;
}

/**
 * Standard Windows directories where Node.js may be installed.
 * Covers: standard MSI installer, nvm-windows, fnm.
 */
function getWindowsNodeProbePaths(modules: NodeModules): string[] {
  const paths: string[] = [];
  const home = modules.os.homedir();

  // Standard MSI install location
  paths.push('C:\\Program Files\\nodejs');

  // nvm-windows: %APPDATA%\nvm\<version>\ and symlink at %APPDATA%\nvm\
  const appData = process.env.APPDATA;
  if (appData) {
    const nvmDir = `${appData}\\nvm`;
    paths.push(nvmDir);
    // Also check for a current symlink which nvm-windows creates
    try {
      const entries = modules.fs.readdirSync(nvmDir);
      for (const entry of entries) {
        if (entry.startsWith('v') || /^\d+\./.test(entry)) {
          paths.push(`${nvmDir}\\${entry}`);
        }
      }
    } catch {
      // nvm not installed or not accessible
    }
  }

  // fnm: %LOCALAPPDATA%\fnm\node-versions\<version>\installation\
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const fnmDir = `${localAppData}\\fnm\\node-versions`;
    try {
      const entries = modules.fs.readdirSync(fnmDir);
      for (const entry of entries) {
        paths.push(`${fnmDir}\\${entry}\\installation`);
      }
    } catch {
      // fnm not installed
    }
  }

  // Scoop
  paths.push(`${home}\\scoop\\apps\\nodejs\\current`);
  paths.push(`${home}\\scoop\\apps\\nodejs-lts\\current`);

  return paths;
}
