import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Platform } from 'obsidian';
import { SupertonicProvider } from '@/services/tts/providers/SupertonicProvider';
import type { SupertonicQuality } from '@/services/tts/providers/SupertonicProvider';
import { resetCache } from '@/services/tts/resolveNodeEnv';

// ============================================================================
// Mock Helpers
// ============================================================================

interface MockChildProcess {
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  stdin: { writable: boolean; write: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  _emit: (event: string, ...args: unknown[]) => void;
  _emitStdout: (data: string) => void;
}

function createMockChild(): MockChildProcess {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const stdoutHandlers: Array<(data: Buffer) => void> = [];

  return {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') stdoutHandlers.push(cb);
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    stdin: {
      writable: true,
      write: vi.fn(),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event]!.push(cb);
    }),
    kill: vi.fn(),
    _emit: (event: string, ...args: unknown[]) => {
      for (const cb of (handlers[event] ?? [])) {
        cb(...args);
      }
    },
    _emitStdout: (data: string) => {
      for (const cb of stdoutHandlers) {
        cb(Buffer.from(data));
      }
    },
  };
}

let mockChild: MockChildProcess;
const originalPlatformIsDesktop = Platform.isDesktop;

function setupMocks() {
  mockChild = createMockChild();

  const mockFs = {
    existsSync: vi.fn((p: string) => {
      // Simulate installed state
      if (p.endsWith('.version')) return true;
      if (p.endsWith('helper.js')) return true;
      if (p.endsWith('server.js')) return true;
      return false;
    }),
    readFileSync: vi.fn(() => JSON.stringify({ version: '1.0.0' })),
  };

  const mockPath = {
    join: vi.fn((...args: string[]) => args.join('/')),
  };

  const mockOs = {
    homedir: vi.fn(() => '/mock/home'),
    platform: vi.fn(() => 'darwin'),
    userInfo: vi.fn(() => ({ username: 'test' })),
  };

  const mockCp = {
    spawn: vi.fn(() => mockChild),
    execSync: vi.fn(() => '/usr/bin\n'),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).require = vi.fn((mod: string) => {
    switch (mod) {
      case 'fs': return mockFs;
      case 'path': return mockPath;
      case 'os': return mockOs;
      case 'child_process': return mockCp;
      default: throw new Error(`Unexpected require: ${mod}`);
    }
  });

  Platform.isDesktop = true;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  setupMocks();
});

afterEach(() => {
  Platform.isDesktop = originalPlatformIsDesktop;
  vi.restoreAllMocks();
  // Reset shared module-level cache
  resetCache();
});

// ============================================================================
// Tests
// ============================================================================

describe('SupertonicProvider', () => {
  describe('constructor', () => {
    it('should have id "supertonic"', () => {
      const provider = new SupertonicProvider('/mock/home');
      expect(provider.id).toBe('supertonic');
    });
  });

  describe('isInstalled', () => {
    it('should return false on non-desktop', () => {
      Platform.isDesktop = false;
      const provider = new SupertonicProvider('/mock/home');
      expect(provider.isInstalled()).toBe(false);
    });

    it('should return true when version and runtime files exist', () => {
      const provider = new SupertonicProvider('/mock/home');
      expect(provider.isInstalled()).toBe(true);
    });

    it('should return false when .version does not parse as JSON', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockFs = (window as any).require('fs');
      mockFs.readFileSync.mockReturnValue('not-json');
      const provider = new SupertonicProvider('/mock/home');
      expect(provider.isInstalled()).toBe(false);
    });

    it('should return false when helper.js is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockFs = (window as any).require('fs');
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('helper.js')) return false;
        if (p.endsWith('.version')) return true;
        if (p.endsWith('server.js')) return true;
        return false;
      });
      const provider = new SupertonicProvider('/mock/home');
      expect(provider.isInstalled()).toBe(false);
    });
  });

  describe('isAvailable', () => {
    it('should delegate to isInstalled', async () => {
      const provider = new SupertonicProvider('/mock/home');
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('setQuality', () => {
    it('should accept fast, balanced, high', () => {
      const provider = new SupertonicProvider('/mock/home');
      const qualities: SupertonicQuality[] = ['fast', 'balanced', 'high'];
      for (const q of qualities) {
        provider.setQuality(q);
        // No throw
      }
    });
  });

  describe('ready handshake (FR-04/FR-05)', () => {
    it('should queue requests until ready is received', async () => {
      const provider = new SupertonicProvider('/mock/home');

      // Start synthesis (will spawn process and queue request)
      const synthPromise = provider.synthesize({ text: 'hello' });

      // Process was spawned
      expect(mockChild.stdout.on).toHaveBeenCalled();

      // Simulate server sending ready
      mockChild._emitStdout(JSON.stringify({
        type: 'ready',
        protocolVersion: 1,
        sampleRate: 44100,
      }) + '\n');

      // Now the queued request should be sent
      // Wait a tick for the queue to drain
      await new Promise((r) => setTimeout(r, 10));

      // stdin.write should have been called (the synth request)
      expect(mockChild.stdin.write).toHaveBeenCalled();

      // Simulate audio response for the sent request
      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);

      mockChild._emitStdout(JSON.stringify({
        type: 'audio',
        id: request.id,
        data: btoa('fake-wav-data'),
      }) + '\n');

      const result = await synthPromise;
      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('should reject requests on protocol version mismatch (FR-05)', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'hello' });

      // Let synthesize() pass the await ensureProcess() yield point
      await new Promise((r) => setTimeout(r, 0));

      // Send incompatible protocol version
      mockChild._emitStdout(JSON.stringify({
        type: 'ready',
        protocolVersion: 99,
        sampleRate: 44100,
      }) + '\n');

      await expect(synthPromise).rejects.toThrow('protocol version mismatch');
    });
  });

  describe('quality parameter mapping (FR-06)', () => {
    it('should map fast -> totalStep 2', async () => {
      const provider = new SupertonicProvider('/mock/home');
      provider.setQuality('fast');

      const synthPromise = provider.synthesize({ text: 'test' });

      // Send ready
      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);
      expect(request.totalStep).toBe(2);

      // Resolve synthesis to avoid dangling promise
      mockChild._emitStdout(JSON.stringify({
        type: 'audio', id: request.id, data: btoa('x'),
      }) + '\n');
      await synthPromise;
    });

    it('should map balanced -> totalStep 5', async () => {
      const provider = new SupertonicProvider('/mock/home');
      provider.setQuality('balanced');

      const synthPromise = provider.synthesize({ text: 'test' });

      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);
      expect(request.totalStep).toBe(5);

      mockChild._emitStdout(JSON.stringify({
        type: 'audio', id: request.id, data: btoa('x'),
      }) + '\n');
      await synthPromise;
    });

    it('should map high -> totalStep 10', async () => {
      const provider = new SupertonicProvider('/mock/home');
      provider.setQuality('high');

      const synthPromise = provider.synthesize({ text: 'test' });

      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);
      expect(request.totalStep).toBe(10);

      mockChild._emitStdout(JSON.stringify({
        type: 'audio', id: request.id, data: btoa('x'),
      }) + '\n');
      await synthPromise;
    });
  });

  describe('speed mapping (FR-06)', () => {
    it('should apply rate * 1.05 mapping', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test', rate: 1.0 });

      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);
      expect(request.rate).toBeCloseTo(1.05, 2);

      mockChild._emitStdout(JSON.stringify({
        type: 'audio', id: request.id, data: btoa('x'),
      }) + '\n');
      await synthPromise;
    });

    it('should clamp speed to minimum 0.5', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test', rate: 0.1 });

      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);
      expect(request.rate).toBe(0.5);

      mockChild._emitStdout(JSON.stringify({
        type: 'audio', id: request.id, data: btoa('x'),
      }) + '\n');
      await synthPromise;
    });

    it('should clamp speed to maximum 2.5', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test', rate: 3.0 });

      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);
      expect(request.rate).toBe(2.5);

      mockChild._emitStdout(JSON.stringify({
        type: 'audio', id: request.id, data: btoa('x'),
      }) + '\n');
      await synthPromise;
    });
  });

  describe('supportsLanguage', () => {
    it('should return true for supported languages', () => {
      const provider = new SupertonicProvider('/mock/home');
      expect(provider.supportsLanguage('en-US')).toBe(true);
      expect(provider.supportsLanguage('ko-KR')).toBe(true);
      expect(provider.supportsLanguage('es-ES')).toBe(true);
      expect(provider.supportsLanguage('pt-BR')).toBe(true);
      expect(provider.supportsLanguage('fr-FR')).toBe(true);
    });

    it('should return false for unsupported languages', () => {
      const provider = new SupertonicProvider('/mock/home');
      expect(provider.supportsLanguage('ja-JP')).toBe(false);
      expect(provider.supportsLanguage('zh-CN')).toBe(false);
      expect(provider.supportsLanguage('de-DE')).toBe(false);
    });

    it('should handle short codes', () => {
      const provider = new SupertonicProvider('/mock/home');
      expect(provider.supportsLanguage('en')).toBe(true);
      expect(provider.supportsLanguage('ja')).toBe(false);
    });
  });

  describe('IPC error handling', () => {
    it('should throw on server error response', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test' });

      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);

      mockChild._emitStdout(JSON.stringify({
        type: 'error',
        id: request.id,
        code: 'VOICE_NOT_FOUND',
        message: 'Voice not found: X1',
      }) + '\n');

      await expect(synthPromise).rejects.toThrow('VOICE_NOT_FOUND');
    });

    it('should ignore non-JSON stdout lines', () => {
      const provider = new SupertonicProvider('/mock/home');
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      // Trigger process spawn
      void provider.synthesize({ text: 'test' });

      // Send non-JSON data (should not throw)
      mockChild._emitStdout('Loading model...\n');

      consoleSpy.mockRestore();
    });
  });

  describe('getVoices', () => {
    it('should return voice list with provider tag', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const voicesPromise = provider.getVoices();

      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);

      mockChild._emitStdout(JSON.stringify({
        type: 'voices',
        id: request.id,
        voices: [
          { id: 'M1', name: 'Male 1', lang: 'en', gender: 'male' },
          { id: 'F1', name: 'Female 1', lang: 'en', gender: 'female' },
        ],
      }) + '\n');

      const voices = await voicesPromise;
      expect(voices).toHaveLength(2);
      expect(voices[0]!.provider).toBe('supertonic');
      expect(voices[0]!.id).toBe('M1');
      expect(voices[1]!.provider).toBe('supertonic');
      expect(voices[1]!.gender).toBe('female');
    });
  });

  describe('crash recovery (FR-04)', () => {
    it('should reject pending requests on process crash', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test' });

      // Send ready first
      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      // Simulate crash
      mockChild._emit('close', 1);

      await expect(synthPromise).rejects.toThrow('crashed');
    });

    it('should reject queued requests on process error', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test' });

      // Let synthesize() pass the await ensureProcess() yield point
      await new Promise((r) => setTimeout(r, 0));

      // Simulate error before ready
      mockChild._emit('error', new Error('spawn ENOENT'));

      await expect(synthPromise).rejects.toThrow('spawn ENOENT');
    });
  });

  describe('desktop guard', () => {
    it('should throw on synthesize when not desktop', async () => {
      Platform.isDesktop = false;
      const provider = new SupertonicProvider('/mock/home');
      await expect(provider.synthesize({ text: 'hello' })).rejects.toThrow('only available on desktop');
    });

    it('should throw on getVoices when not desktop', async () => {
      Platform.isDesktop = false;
      const provider = new SupertonicProvider('/mock/home');
      await expect(provider.getVoices()).rejects.toThrow('only available on desktop');
    });
  });

  describe('destroy', () => {
    it('should reject all pending requests', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test' });

      // Send ready
      mockChild._emitStdout(JSON.stringify({
        type: 'ready', protocolVersion: 1, sampleRate: 44100,
      }) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      // Destroy while request is pending
      await provider.destroy();

      await expect(synthPromise).rejects.toThrow('destroyed');
    });

    it('should reject queued requests waiting for ready', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test' });

      // Let synthesize() pass the await ensureProcess() yield point
      await new Promise((r) => setTimeout(r, 0));

      // Destroy before ready
      await provider.destroy();

      await expect(synthPromise).rejects.toThrow('destroyed');
    });
  });

  describe('process buffer parsing', () => {
    it('should handle multiple JSON lines in one chunk', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test' });

      // Send ready + audio in one chunk
      const readyMsg = JSON.stringify({ type: 'ready', protocolVersion: 1, sampleRate: 44100 });

      mockChild._emitStdout(readyMsg + '\n');

      await new Promise((r) => setTimeout(r, 10));

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);

      const audioMsg = JSON.stringify({ type: 'audio', id: request.id, data: btoa('wav') });
      mockChild._emitStdout(audioMsg + '\n');

      const result = await synthPromise;
      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('should handle split JSON lines across chunks', async () => {
      const provider = new SupertonicProvider('/mock/home');

      const synthPromise = provider.synthesize({ text: 'test' });

      // Send ready message split across two chunks
      const readyJson = JSON.stringify({ type: 'ready', protocolVersion: 1, sampleRate: 44100 });
      const half = Math.floor(readyJson.length / 2);

      mockChild._emitStdout(readyJson.slice(0, half));
      mockChild._emitStdout(readyJson.slice(half) + '\n');

      await new Promise((r) => setTimeout(r, 10));

      // Request should now be sent
      expect(mockChild.stdin.write).toHaveBeenCalled();

      const writtenPayload = mockChild.stdin.write.mock.calls[0]?.[0] as string;
      const request = JSON.parse(writtenPayload);

      mockChild._emitStdout(JSON.stringify({
        type: 'audio', id: request.id, data: btoa('x'),
      }) + '\n');

      const result = await synthPromise;
      expect(result).toBeInstanceOf(ArrayBuffer);
    });
  });
});
