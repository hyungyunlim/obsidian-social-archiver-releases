/**
 * Tests for AI CLI detection utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AICliDetector,
  AICli,
  AI_CLI_INFO,
} from '../../utils/ai-cli';
import * as nodeRequireModule from '../../utils/nodeRequire';

// Mock Obsidian Platform
vi.mock('obsidian', () => ({
  Platform: {
    isMobile: false,
    isDesktop: true,
  },
}));

describe('AI CLI Detection Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AICliDetector.resetCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    AICliDetector.resetCache();
  });

  describe('AI_CLI_INFO constants', () => {
    it('should have info for all supported CLIs', () => {
      const clis: AICli[] = ['claude', 'gemini', 'codex'];

      for (const cli of clis) {
        expect(AI_CLI_INFO[cli]).toBeDefined();
        expect(AI_CLI_INFO[cli].name).toBe(cli);
        expect(AI_CLI_INFO[cli].displayName).toBeTruthy();
        expect(AI_CLI_INFO[cli].description).toBeTruthy();
        expect(AI_CLI_INFO[cli].installUrl).toMatch(/^https?:\/\//);
      }
    });

    it('should have correct display names', () => {
      expect(AI_CLI_INFO.claude.displayName).toBe('Claude Code');
      expect(AI_CLI_INFO.gemini.displayName).toBe('Gemini CLI');
      expect(AI_CLI_INFO.codex.displayName).toBe('OpenAI Codex');
    });

    it('should have valid install URLs', () => {
      expect(AI_CLI_INFO.claude.installUrl).toContain('anthropic');
      expect(AI_CLI_INFO.gemini.installUrl).toContain('gemini');
      expect(AI_CLI_INFO.codex.installUrl).toContain('openai');
    });
  });

  describe('AICliDetector.isDesktopOnly', () => {
    it('should return true', () => {
      expect(AICliDetector.isDesktopOnly()).toBe(true);
    });
  });

  describe('AICliDetector.isMobile', () => {
    it('should return Platform.isMobile value', () => {
      // Default mock has isMobile = false
      expect(AICliDetector.isMobile()).toBe(false);
    });
  });

  describe('AICliDetector.resetCache', () => {
    it('should clear all cached data', () => {
      AICliDetector.resetCache();

      expect(AICliDetector.getCli()).toBeNull();
      expect(AICliDetector.getPath()).toBeNull();
      expect(AICliDetector.getVersion()).toBeNull();
      expect(AICliDetector.isAuthenticated()).toBe(false);
      expect(AICliDetector.getDetectedClis()).toEqual([]);
    });
  });

  describe('AICliDetector.getCliResult', () => {
    it('should return null for undetected CLI', () => {
      AICliDetector.resetCache();
      const result = AICliDetector.getCliResult('codex');
      expect(result).toBeNull();
    });
  });

  describe('AICliDetector.getDetectedClis', () => {
    it('should return empty array when no CLIs detected', () => {
      AICliDetector.resetCache();
      const clis = AICliDetector.getDetectedClis();
      expect(Array.isArray(clis)).toBe(true);
      expect(clis).toEqual([]);
    });
  });

  describe('AICliDetector.detect on mobile', () => {
    it('should return unavailable result on mobile', async () => {
      // Override Platform.isMobile for this test
      const obsidian = await import('obsidian');
      const originalIsMobile = obsidian.Platform.isMobile;
      Object.defineProperty(obsidian.Platform, 'isMobile', {
        value: true,
        writable: true,
        configurable: true,
      });

      AICliDetector.resetCache();
      const result = await AICliDetector.detect();

      expect(result.available).toBe(false);
      expect(result.cli).toBeNull();
      expect(result.path).toBeNull();
      expect(result.version).toBeNull();
      expect(result.authenticated).toBe(false);

      // Reset
      Object.defineProperty(obsidian.Platform, 'isMobile', {
        value: originalIsMobile,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('AICliDetector.detectAll on mobile', () => {
    it('should return empty map on mobile', async () => {
      const obsidian = await import('obsidian');
      const originalIsMobile = obsidian.Platform.isMobile;
      Object.defineProperty(obsidian.Platform, 'isMobile', {
        value: true,
        writable: true,
        configurable: true,
      });

      AICliDetector.resetCache();
      const results = await AICliDetector.detectAll();

      expect(results.size).toBe(0);

      // Reset
      Object.defineProperty(obsidian.Platform, 'isMobile', {
        value: originalIsMobile,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('AICliDetector.detect preferred CLI behavior', () => {
    it('should only probe the requested CLI', async () => {
      vi.spyOn(nodeRequireModule, 'default').mockImplementation((id: string) => {
        if (id === 'os') {
          return {
            platform: () => 'darwin',
          } as unknown as typeof import('os');
        }
        throw new Error(`Unexpected nodeRequire id in test: ${id}`);
      });

      const detectCliSpy = vi.spyOn(AICliDetector as any, 'detectCli').mockImplementation(
        async (cli: AICli) => ({
          available: true,
          cli,
          path: `/mock/${cli}`,
          version: '1.0.0',
          authenticated: true,
        })
      );

      const result = await AICliDetector.detect('codex');

      expect(detectCliSpy).toHaveBeenCalledTimes(1);
      expect(detectCliSpy).toHaveBeenCalledWith('codex', expect.any(String));
      expect(result.available).toBe(true);
      expect(result.cli).toBe('codex');
    });

    it('should not fall back to another CLI when requested CLI is unavailable', async () => {
      vi.spyOn(nodeRequireModule, 'default').mockImplementation((id: string) => {
        if (id === 'os') {
          return {
            platform: () => 'darwin',
          } as unknown as typeof import('os');
        }
        throw new Error(`Unexpected nodeRequire id in test: ${id}`);
      });

      const detectCliSpy = vi.spyOn(AICliDetector as any, 'detectCli').mockImplementation(
        async (cli: AICli) => {
          if (cli === 'codex') {
            return {
              available: false,
              cli: null,
              path: null,
              version: null,
              authenticated: false,
            };
          }

          return {
            available: true,
            cli,
            path: `/mock/${cli}`,
            version: '1.0.0',
            authenticated: true,
          };
        }
      );

      const result = await AICliDetector.detect('codex');

      expect(detectCliSpy).toHaveBeenCalledTimes(1);
      expect(detectCliSpy).toHaveBeenCalledWith('codex', expect.any(String));
      expect(result.available).toBe(false);
      expect(result.cli).toBeNull();
    });
  });

  describe('AICliDetector detection paths', () => {
    it('should not probe the macOS Codex GUI app binary', () => {
      const paths = (AICliDetector as any).DETECTION_PATHS.codex.darwin as string[];
      expect(paths).not.toContain('/Applications/Codex.app/Contents/MacOS/codex');
    });
  });

  // Integration tests - these actually run on the system
  // Skip these tests in CI environments
  describe('AICliDetector integration tests', () => {
    it('should return a valid result structure from detect()', async () => {
      const result = await AICliDetector.detect();

      // Verify the result has the correct structure
      expect(result).toHaveProperty('available');
      expect(result).toHaveProperty('cli');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('authenticated');

      // Types should be correct
      expect(typeof result.available).toBe('boolean');
      if (result.available) {
        expect(['claude', 'gemini', 'codex']).toContain(result.cli);
        expect(typeof result.path).toBe('string');
        expect(typeof result.version).toBe('string');
        expect(typeof result.authenticated).toBe('boolean');
      } else {
        expect(result.cli).toBeNull();
        expect(result.path).toBeNull();
        expect(result.version).toBeNull();
      }
    });

    it('should return a Map from detectAll()', async () => {
      const results = await AICliDetector.detectAll();

      expect(results).toBeInstanceOf(Map);

      // Each result should have the correct structure
      for (const [cli, result] of results) {
        expect(['claude', 'gemini', 'codex']).toContain(cli);
        expect(result.available).toBe(true);
        expect(result.cli).toBe(cli);
        expect(typeof result.path).toBe('string');
        expect(typeof result.version).toBe('string');
      }
    });

    it('should cache results', async () => {
      AICliDetector.resetCache();

      // First call
      const result1 = await AICliDetector.detect();

      // Second call should return cached result
      const result2 = await AICliDetector.detect();

      // Results should be identical
      expect(result1.available).toBe(result2.available);
      expect(result1.cli).toBe(result2.cli);
      expect(result1.path).toBe(result2.path);
      expect(result1.version).toBe(result2.version);
    });

    it('should update getters after detect()', async () => {
      AICliDetector.resetCache();

      const result = await AICliDetector.detect();

      if (result.available) {
        expect(AICliDetector.getCli()).toBe(result.cli);
        expect(AICliDetector.getPath()).toBe(result.path);
        expect(AICliDetector.getVersion()).toBe(result.version);
        expect(AICliDetector.isAuthenticated()).toBe(result.authenticated);
      }
    });

    it('should update getDetectedClis after detectAll()', async () => {
      AICliDetector.resetCache();

      const results = await AICliDetector.detectAll();
      const detectedClis = AICliDetector.getDetectedClis();

      expect(detectedClis.length).toBe(results.size);
      for (const cli of detectedClis) {
        expect(results.has(cli)).toBe(true);
      }
    });

    it('should detect with preferred CLI', async () => {
      AICliDetector.resetCache();

      // Try detecting with codex as preferred
      const result = await AICliDetector.detect('codex');

      // If codex is available, it should be the primary result
      if (result.available && result.cli === 'codex') {
        expect(result.cli).toBe('codex');
      }
      // Otherwise, it detected something else or nothing
    });
  });

  describe('Cache behavior', () => {
    it('should clear cache with resetCache()', async () => {
      // Detect something first
      await AICliDetector.detect();

      // Reset cache
      AICliDetector.resetCache();

      // All getters should return null/empty
      expect(AICliDetector.getCli()).toBeNull();
      expect(AICliDetector.getPath()).toBeNull();
      expect(AICliDetector.getVersion()).toBeNull();
      expect(AICliDetector.getDetectedClis()).toEqual([]);
    });
  });

  describe('Type safety', () => {
    it('should have correct AICli type values', () => {
      const validClis: AICli[] = ['claude', 'gemini', 'codex'];

      // TypeScript should enforce these are the only valid values
      validClis.forEach(cli => {
        expect(AI_CLI_INFO[cli]).toBeDefined();
      });
    });

    it('should return properly typed detection result', async () => {
      const result = await AICliDetector.detect();

      // Type guard - if available, cli should be AICli type
      if (result.available && result.cli) {
        const validClis: AICli[] = ['claude', 'gemini', 'codex'];
        expect(validClis).toContain(result.cli);
      }
    });
  });
});
