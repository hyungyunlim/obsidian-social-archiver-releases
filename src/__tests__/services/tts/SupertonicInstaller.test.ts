import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { SupertonicInstaller } from '@/services/tts/SupertonicInstaller';
import type { SupertonicInstallState, InstallProgress } from '@/services/tts/SupertonicInstaller';

// ============================================================================
// Mock Helpers
// ============================================================================

/** In-memory filesystem for testing. */
function createMockFs() {
  const files = new Map<string, string | Buffer>();
  const dirs = new Set<string>();

  return {
    _files: files,
    _dirs: dirs,
    existsSync: vi.fn((p: string) => files.has(p) || dirs.has(p)),
    readFileSync: vi.fn((p: string, encoding?: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      if (encoding === 'utf-8' || encoding === 'utf8') return content.toString();
      return Buffer.isBuffer(content) ? content : Buffer.from(content);
    }),
    writeFileSync: vi.fn((p: string, data: string | Buffer) => {
      files.set(p, data);
      // auto-create parent dir
      const parent = p.substring(0, p.lastIndexOf('/'));
      if (parent) dirs.add(parent);
    }),
    mkdirSync: vi.fn((_p: string, _opts?: object) => {
      dirs.add(_p);
    }),
    unlinkSync: vi.fn((p: string) => {
      files.delete(p);
    }),
    rmSync: vi.fn((p: string, _opts?: object) => {
      // Remove all files/dirs under p
      for (const key of [...files.keys()]) {
        if (key === p || key.startsWith(p + '/')) files.delete(key);
      }
      for (const key of [...dirs]) {
        if (key === p || key.startsWith(p + '/')) dirs.delete(key);
      }
    }),
    rmdirSync: vi.fn((p: string) => {
      dirs.delete(p);
    }),
    readdirSync: vi.fn((p: string) => {
      const entries = new Set<string>();
      const prefix = p.endsWith('/') ? p : p + '/';
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const first = rest.split('/')[0];
          if (first) entries.add(first);
        }
      }
      for (const key of dirs) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const first = rest.split('/')[0];
          if (first) entries.add(first);
        }
      }
      return [...entries];
    }),
    renameSync: vi.fn((src: string, dest: string) => {
      const content = files.get(src);
      if (content !== undefined) {
        files.set(dest, content);
        files.delete(src);
      }
    }),
    createWriteStream: vi.fn(() => ({
      on: vi.fn((_event: string, cb: () => void) => {
        if (_event === 'finish') setTimeout(cb, 0);
        return { on: vi.fn() };
      }),
      close: vi.fn(),
    })),
  };
}

function createMockPath() {
  return {
    join: vi.fn((...args: string[]) => args.join('/')),
    basename: vi.fn((p: string) => {
      const parts = p.split('/');
      return parts[parts.length - 1] ?? '';
    }),
  };
}

function createMockOs() {
  return {
    homedir: vi.fn(() => '/mock/home'),
    platform: vi.fn(() => 'darwin'),
    userInfo: vi.fn(() => ({ username: 'testuser' })),
  };
}

function createMockChildProcess() {
  return {
    spawn: vi.fn(() => {
      const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
      const child = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn((_: string, cb: (data: Buffer) => void) => { cb(Buffer.from('')); }) },
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event]!.push(cb);
          // Auto-resolve close with 0 for npm install
          if (event === 'close') setTimeout(() => cb(0), 10);
        }),
        kill: vi.fn(),
        stdin: { writable: true, write: vi.fn() },
        _handlers: handlers,
      };
      return child;
    }),
    execSync: vi.fn(() => '/usr/bin:/usr/local/bin\n'),
  };
}

function createMockCrypto() {
  return {
    createHash: vi.fn(() => ({
      update: vi.fn(),
      digest: vi.fn(() => 'abc123def456'),
    })),
  };
}

function createMockHttp() {
  return {
    get: vi.fn((_url: string, _opts: object, cb: (res: object) => void) => {
      const response = {
        statusCode: 200,
        pipe: vi.fn((ws: { on: (e: string, cb: () => void) => void }) => {
          // Simulate write completion
          setTimeout(() => {
            const finishHandlers = (ws as any)._finishHandlers || [];
            finishHandlers.forEach((h: () => void) => h());
          }, 5);
        }),
        headers: {},
      };
      setTimeout(() => cb(response), 0);
      return { on: vi.fn() };
    }),
  };
}

// ============================================================================
// Setup
// ============================================================================

let mockFs: ReturnType<typeof createMockFs>;
let mockPath: ReturnType<typeof createMockPath>;
let mockOs: ReturnType<typeof createMockOs>;
let mockCp: ReturnType<typeof createMockChildProcess>;
let mockCrypto: ReturnType<typeof createMockCrypto>;
let mockHttp: ReturnType<typeof createMockHttp>;

// Save original
const originalPlatformIsDesktop = Platform.isDesktop;

beforeEach(() => {
  mockFs = createMockFs();
  mockPath = createMockPath();
  mockOs = createMockOs();
  mockCp = createMockChildProcess();
  mockCrypto = createMockCrypto();
  mockHttp = createMockHttp();

  Platform.isDesktop = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).require = vi.fn((mod: string) => {
    switch (mod) {
      case 'fs': return mockFs;
      case 'path': return mockPath;
      case 'os': return mockOs;
      case 'child_process': return mockCp;
      case 'crypto': return mockCrypto;
      case 'https': return mockHttp;
      case 'http': return mockHttp;
      default: throw new Error(`Unexpected require: ${mod}`);
    }
  });
});

afterEach(() => {
  Platform.isDesktop = originalPlatformIsDesktop;
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('SupertonicInstaller', () => {
  describe('initial state', () => {
    it('should start in idle state', () => {
      const installer = new SupertonicInstaller('/mock/home');
      expect(installer.state).toBe('idle');
    });
  });

  describe('isInstalled', () => {
    it('should return false on non-desktop', () => {
      Platform.isDesktop = false;
      const installer = new SupertonicInstaller('/mock/home');
      expect(installer.isInstalled()).toBe(false);
    });

    it('should return false when .version file is missing', () => {
      const installer = new SupertonicInstaller('/mock/home');
      expect(installer.isInstalled()).toBe(false);
    });

    it('should return false when .version is not valid JSON', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._files.set(`${basePath}/.version`, 'not-json');
      expect(installer.isInstalled()).toBe(false);
    });

    it('should return false when helper.js is missing', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._files.set(`${basePath}/.version`, JSON.stringify({ version: '1.0.0' }));
      mockFs._files.set(`${basePath}/server.js`, 'x');
      mockFs._files.set(`${basePath}/package.json`, '{}');
      expect(installer.isInstalled()).toBe(false);
    });

    it('should return false when onnxruntime-node is missing', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._files.set(`${basePath}/.version`, JSON.stringify({ version: '1.0.0' }));
      mockFs._files.set(`${basePath}/helper.js`, 'x');
      mockFs._files.set(`${basePath}/server.js`, 'x');
      mockFs._files.set(`${basePath}/package.json`, '{}');
      // Missing node_modules/onnxruntime-node
      expect(installer.isInstalled()).toBe(false);
    });

    it('should return false when ONNX model files are incomplete', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._files.set(`${basePath}/.version`, JSON.stringify({ version: '1.0.0' }));
      mockFs._files.set(`${basePath}/helper.js`, 'x');
      mockFs._files.set(`${basePath}/server.js`, 'x');
      mockFs._files.set(`${basePath}/package.json`, '{}');
      mockFs._dirs.add(`${basePath}/node_modules/onnxruntime-node`);
      // Only partial ONNX files
      mockFs._files.set(`${basePath}/assets/onnx/duration_predictor.onnx`, 'x');
      mockFs._files.set(`${basePath}/assets/onnx/text_encoder.onnx`, 'x');
      // Missing: vector_estimator.onnx, vocoder.onnx, tts.json, unicode_indexer.json
      expect(installer.isInstalled()).toBe(false);
    });

    it('should return false when voice style files are incomplete', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      setupCompleteInstall(basePath, { skipVoices: true });
      // Only partial voices
      mockFs._files.set(`${basePath}/assets/voice_styles/M1.json`, 'x');
      expect(installer.isInstalled()).toBe(false);
    });

    it('should return false when .checksum is missing', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      setupCompleteInstall(basePath, { skipChecksum: true });
      expect(installer.isInstalled()).toBe(false);
    });

    it('should return true when all 6 conditions are met (FR-03)', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      setupCompleteInstall(basePath);
      expect(installer.isInstalled()).toBe(true);
    });
  });

  describe('getInstalledVersion', () => {
    it('should return null on non-desktop', () => {
      Platform.isDesktop = false;
      const installer = new SupertonicInstaller('/mock/home');
      expect(installer.getInstalledVersion()).toBeNull();
    });

    it('should return null when not installed', () => {
      const installer = new SupertonicInstaller('/mock/home');
      expect(installer.getInstalledVersion()).toBeNull();
    });

    it('should parse structured JSON version metadata', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._files.set(`${basePath}/.version`, JSON.stringify({
        version: '1.0.0',
        helperRef: 'abc123',
        modelRevision: 'main',
        installedAt: '2026-02-28T00:00:00Z',
        nodeVersion: 'v20.0.0',
      }));
      expect(installer.getInstalledVersion()).toBe('1.0.0');
    });

    it('should handle legacy plain string format', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._files.set(`${basePath}/.version`, '0.9.0');
      expect(installer.getInstalledVersion()).toBe('0.9.0');
    });
  });

  describe('isUpdateAvailable', () => {
    it('should return false when not installed', () => {
      const installer = new SupertonicInstaller('/mock/home');
      expect(installer.isUpdateAvailable()).toBe(false);
    });

    it('should return true when installed version differs', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._files.set(`${basePath}/.version`, JSON.stringify({ version: '0.9.0' }));
      expect(installer.isUpdateAvailable()).toBe(true);
    });

    it('should return false when version matches', () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._files.set(`${basePath}/.version`, JSON.stringify({ version: '1.0.0' }));
      expect(installer.isUpdateAvailable()).toBe(false);
    });
  });

  describe('install', () => {
    it('should return error on non-desktop', async () => {
      Platform.isDesktop = false;
      const installer = new SupertonicInstaller('/mock/home');
      const result = await installer.install();
      expect(result.success).toBe(false);
      expect(result.error).toContain('desktop');
    });

    it('should return error when lock file exists', async () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._files.set(`${basePath}/.install.lock`, 'locked');
      const result = await installer.install();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Another installation');
    });

    it('should emit progress callbacks with state machine states (FR-02)', async () => {
      const installer = new SupertonicInstaller('/mock/home');
      const states: SupertonicInstallState[] = [];
      const messages: string[] = [];

      // This will fail at preflight since execSync is mocked
      await installer.install((progress: InstallProgress) => {
        states.push(progress.state);
        messages.push(progress.message);
      });

      // Should have at least started with preflight
      expect(states.length).toBeGreaterThan(0);
      expect(states[0]).toBe('preflight');
      // All progress callbacks should include step/totalSteps
      expect(messages.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
    });

    it('should handle cancellation via AbortSignal', async () => {
      const installer = new SupertonicInstaller('/mock/home');
      const abortController = new AbortController();
      abortController.abort(); // Pre-abort

      const result = await installer.install(undefined, abortController.signal);
      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
      expect(installer.state).toBe('cancelled');
    });

    it('should set state to failed on error', async () => {
      const installer = new SupertonicInstaller('/mock/home');
      // Mock preflight to throw
      mockCp.execSync.mockImplementation(() => {
        throw new Error('node not found');
      });

      const result = await installer.install();
      expect(result.success).toBe(false);
      expect(installer.state).toBe('failed');
    });

    it('should always remove lock file after install attempt', async () => {
      const installer = new SupertonicInstaller('/mock/home');
      // Force preflight failure
      mockCp.execSync.mockImplementation(() => {
        throw new Error('no node');
      });

      await installer.install();

      // Lock should be cleaned up
      const basePath = '/mock/home/.social-archiver/tts';
      expect(mockFs._files.has(`${basePath}/.install.lock`)).toBe(false);
    });
  });

  describe('uninstall', () => {
    it('should return error on non-desktop', async () => {
      Platform.isDesktop = false;
      const installer = new SupertonicInstaller('/mock/home');
      const result = await installer.uninstall();
      expect(result.success).toBe(false);
    });

    it('should remove install directory', async () => {
      const installer = new SupertonicInstaller('/mock/home');
      const basePath = '/mock/home/.social-archiver/tts';
      mockFs._dirs.add(basePath);
      mockFs._files.set(`${basePath}/helper.js`, 'x');

      const result = await installer.uninstall();
      expect(result.success).toBe(true);
      expect(mockFs.rmSync).toHaveBeenCalledWith(basePath, { recursive: true, force: true });
    });

    it('should reset state to idle after uninstall', async () => {
      const installer = new SupertonicInstaller('/mock/home');
      const result = await installer.uninstall();
      expect(result.success).toBe(true);
      expect(installer.state).toBe('idle');
    });

    it('should succeed even if directory does not exist', async () => {
      const installer = new SupertonicInstaller('/mock/home');
      const result = await installer.uninstall();
      expect(result.success).toBe(true);
    });
  });

  describe('getInstallPath', () => {
    it('should return path based on homedir', () => {
      const installer = new SupertonicInstaller('/custom/home');
      expect(installer.getInstallPath()).toBe('/custom/home/.social-archiver/tts');
    });

    it('should cache the path after first call', () => {
      const installer = new SupertonicInstaller('/custom/home');
      const first = installer.getInstallPath();
      const second = installer.getInstallPath();
      expect(first).toBe(second);
    });
  });
});

// ============================================================================
// Helper: Setup a complete valid installation in mock filesystem
// ============================================================================

function setupCompleteInstall(
  basePath: string,
  options?: { skipVoices?: boolean; skipChecksum?: boolean },
): void {
  // 1. .version (valid JSON)
  mockFs._files.set(`${basePath}/.version`, JSON.stringify({
    version: '1.0.0',
    helperRef: 'abc123',
    modelRevision: 'main',
    installedAt: '2026-02-28T00:00:00Z',
    nodeVersion: 'v20.0.0',
  }));

  // 2. Core files
  mockFs._files.set(`${basePath}/helper.js`, 'module.exports = {}');
  mockFs._files.set(`${basePath}/server.js`, 'import ...');
  mockFs._files.set(`${basePath}/package.json`, '{}');

  // 3. onnxruntime-node directory
  mockFs._dirs.add(`${basePath}/node_modules/onnxruntime-node`);

  // 4. ONNX model files
  const onnxFiles = [
    'duration_predictor.onnx', 'text_encoder.onnx',
    'vector_estimator.onnx', 'vocoder.onnx',
    'tts.json', 'unicode_indexer.json',
  ];
  for (const f of onnxFiles) {
    mockFs._files.set(`${basePath}/assets/onnx/${f}`, 'data');
  }

  // 5. Voice style files
  if (!options?.skipVoices) {
    const voices = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5'];
    for (const v of voices) {
      mockFs._files.set(`${basePath}/assets/voice_styles/${v}.json`, '{}');
    }
  }

  // 6. Checksum file
  if (!options?.skipChecksum) {
    mockFs._files.set(`${basePath}/.checksum`, '[]');
  }
}
