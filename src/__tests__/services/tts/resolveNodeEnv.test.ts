import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveEnvPath,
  findNodeBinary,
  findNpmCommand,
  resetCache,
} from '@/services/tts/resolveNodeEnv';
import type { NodeModules } from '@/services/tts/resolveNodeEnv';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockModules(platform: 'darwin' | 'win32' | 'linux' = 'darwin'): {
  modules: NodeModules;
  mocks: {
    execSync: ReturnType<typeof vi.fn>;
    existsSync: ReturnType<typeof vi.fn>;
    readdirSync: ReturnType<typeof vi.fn>;
    homedir: ReturnType<typeof vi.fn>;
    platform: ReturnType<typeof vi.fn>;
    userInfo: ReturnType<typeof vi.fn>;
  };
} {
  const execSync = vi.fn();
  const existsSync = vi.fn(() => false);
  const readdirSync = vi.fn(() => [] as string[]);
  const homedir = vi.fn(() => platform === 'win32' ? 'C:\\Users\\test' : '/home/test');
  const platformFn = vi.fn(() => platform);
  const userInfo = vi.fn(() => ({ username: 'test' }));

  return {
    modules: {
      os: { homedir, platform: platformFn, userInfo } as unknown as typeof import('os'),
      child_process: { execSync } as unknown as typeof import('child_process'),
      fs: { existsSync, readdirSync } as unknown as typeof import('fs'),
    },
    mocks: {
      execSync,
      existsSync,
      readdirSync,
      homedir,
      platform: platformFn,
      userInfo,
    },
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  resetCache();
});

// ============================================================================
// Tests: resolveEnvPath
// ============================================================================

describe('resolveEnvPath', () => {
  describe('macOS/Linux', () => {
    it('should resolve PATH from login shell', () => {
      const { modules, mocks } = createMockModules('darwin');
      mocks.execSync.mockReturnValue('/usr/local/bin:/usr/bin:/bin\n');

      const result = resolveEnvPath(modules);
      expect(result).toBe('/usr/local/bin:/usr/bin:/bin');
    });

    it('should filter non-PATH lines from shell output', () => {
      const { modules, mocks } = createMockModules('darwin');
      mocks.execSync.mockReturnValue(
        'Last login: Mon Mar 1 10:00:00\n/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin\n',
      );

      const result = resolveEnvPath(modules);
      expect(result).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
    });

    it('should use fallback paths when shell exec fails', () => {
      const { modules, mocks } = createMockModules('darwin');
      mocks.execSync.mockImplementation(() => { throw new Error('shell failed'); });

      const originalPath = process.env.PATH;
      process.env.PATH = '/usr/bin:/bin';
      try {
        const result = resolveEnvPath(modules);
        expect(result).toContain('/opt/homebrew/bin');
        expect(result).toContain('/usr/local/bin');
        expect(result).toContain('/usr/bin');
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('should not duplicate paths already in PATH', () => {
      const { modules, mocks } = createMockModules('darwin');
      mocks.execSync.mockImplementation(() => { throw new Error('fail'); });

      const originalPath = process.env.PATH;
      process.env.PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
      try {
        const result = resolveEnvPath(modules);
        expect(result).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
      } finally {
        process.env.PATH = originalPath;
      }
    });
  });

  describe('Windows', () => {
    it('should return current PATH when no extra locations exist', () => {
      const { modules, mocks } = createMockModules('win32');
      mocks.existsSync.mockReturnValue(false);

      const originalPath = process.env.PATH;
      process.env.PATH = 'C:\\Windows\\system32;C:\\Windows';
      try {
        const result = resolveEnvPath(modules);
        expect(result).toBe('C:\\Windows\\system32;C:\\Windows');
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('should append standard nodejs path when it exists', () => {
      const { modules, mocks } = createMockModules('win32');
      mocks.existsSync.mockImplementation((p: string) => {
        return p === 'C:\\Program Files\\nodejs';
      });

      const originalPath = process.env.PATH;
      process.env.PATH = 'C:\\Windows\\system32';
      try {
        const result = resolveEnvPath(modules);
        expect(result).toContain('C:\\Program Files\\nodejs');
        expect(result).toContain('C:\\Windows\\system32');
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('should not duplicate paths already in PATH (case-insensitive)', () => {
      const { modules, mocks } = createMockModules('win32');
      mocks.existsSync.mockReturnValue(true);

      const originalPath = process.env.PATH;
      process.env.PATH = 'C:\\Program Files\\nodejs;C:\\Windows\\system32';
      try {
        const result = resolveEnvPath(modules);
        // Should not have duplicate C:\Program Files\nodejs
        const parts = result.split(';');
        const nodejsCount = parts.filter((p) => p.toLowerCase() === 'c:\\program files\\nodejs').length;
        expect(nodejsCount).toBeLessThanOrEqual(1);
      } finally {
        process.env.PATH = originalPath;
      }
    });

    it('should probe nvm-windows versions', () => {
      const originalAppData = process.env.APPDATA;
      process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';

      const { modules, mocks } = createMockModules('win32');
      mocks.readdirSync.mockImplementation((dir: string) => {
        if (dir.endsWith('\\nvm')) return ['v18.17.0', 'v20.10.0'];
        return [];
      });
      mocks.existsSync.mockImplementation((p: string) => {
        if (p.includes('nvm')) return true;
        return false;
      });

      const originalPath = process.env.PATH;
      process.env.PATH = 'C:\\Windows\\system32';
      try {
        const result = resolveEnvPath(modules);
        expect(result).toContain('nvm');
      } finally {
        process.env.PATH = originalPath;
        process.env.APPDATA = originalAppData;
      }
    });
  });

  describe('caching', () => {
    it('should cache resolved PATH across calls', () => {
      const { modules, mocks } = createMockModules('darwin');
      mocks.execSync.mockReturnValue('/usr/local/bin:/usr/bin\n');

      const result1 = resolveEnvPath(modules);
      const result2 = resolveEnvPath(modules);

      expect(result1).toBe(result2);
      // execSync should only be called once due to caching
      expect(mocks.execSync).toHaveBeenCalledTimes(1);
    });

    it('should reset cache with resetCache()', () => {
      const { modules, mocks } = createMockModules('darwin');
      mocks.execSync.mockReturnValue('/first/path:/usr/bin\n');
      resolveEnvPath(modules);

      resetCache();
      mocks.execSync.mockReturnValue('/second/path:/usr/bin\n');
      const result = resolveEnvPath(modules);

      expect(result).toBe('/second/path:/usr/bin');
      expect(mocks.execSync).toHaveBeenCalledTimes(2);
    });
  });
});

// ============================================================================
// Tests: findNodeBinary
// ============================================================================

describe('findNodeBinary', () => {
  describe('macOS/Linux', () => {
    it('should return "node"', () => {
      const { modules } = createMockModules('darwin');
      expect(findNodeBinary(modules)).toBe('node');
    });
  });

  describe('Windows', () => {
    it('should use where.exe to find node', () => {
      const { modules, mocks } = createMockModules('win32');
      mocks.execSync.mockReturnValue('C:\\Program Files\\nodejs\\node.exe\n');

      const result = findNodeBinary(modules);
      expect(result).toBe('C:\\Program Files\\nodejs\\node.exe');
    });

    it('should probe standard paths when where.exe fails', () => {
      const { modules, mocks } = createMockModules('win32');
      mocks.execSync.mockImplementation(() => { throw new Error('not found'); });
      mocks.existsSync.mockImplementation((p: string) => {
        return p === 'C:\\Program Files\\nodejs\\node.exe';
      });

      const result = findNodeBinary(modules);
      expect(result).toBe('C:\\Program Files\\nodejs\\node.exe');
    });

    it('should fallback to "node" when nothing is found', () => {
      const { modules, mocks } = createMockModules('win32');
      mocks.execSync.mockImplementation(() => { throw new Error('not found'); });
      mocks.existsSync.mockReturnValue(false);

      const result = findNodeBinary(modules);
      expect(result).toBe('node');
    });

    it('should cache the result', () => {
      const { modules, mocks } = createMockModules('win32');
      mocks.execSync.mockReturnValue('C:\\Program Files\\nodejs\\node.exe\n');

      findNodeBinary(modules);
      findNodeBinary(modules);

      // where.exe should only be called once
      expect(mocks.execSync).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// Tests: findNpmCommand
// ============================================================================

describe('findNpmCommand', () => {
  it('should return "npm" on macOS/Linux', () => {
    const { modules } = createMockModules('darwin');
    expect(findNpmCommand(modules)).toBe('npm');
  });

  it('should return "npm" on Linux', () => {
    const { modules } = createMockModules('linux');
    expect(findNpmCommand(modules)).toBe('npm');
  });

  it('should return "npm.cmd" on Windows', () => {
    const { modules } = createMockModules('win32');
    expect(findNpmCommand(modules)).toBe('npm.cmd');
  });
});
