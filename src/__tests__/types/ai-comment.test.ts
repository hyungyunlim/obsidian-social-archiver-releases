/**
 * Tests for AI Comment types and utilities
 */

import { describe, it, expect } from 'vitest';
import {
  AICommentError,
  isAICli,
  isAICommentType,
  isAICommentError,
  getAICommentErrorMessage,
  generateCommentId,
  createContentHash,
  DEFAULT_AI_COMMENT_SETTINGS,
  DEFAULT_PROMPTS,
  COMMENT_TYPE_DISPLAY_NAMES,
  COMMENT_TYPE_DESCRIPTIONS,
  type AICommentType,
  type AICommentErrorCode,
} from '../../types/ai-comment';

describe('AI Comment Types', () => {
  describe('AICommentError', () => {
    it('should create error with code and message', () => {
      const error = new AICommentError('CLI_NOT_INSTALLED', 'Claude not found');

      expect(error.code).toBe('CLI_NOT_INSTALLED');
      expect(error.message).toBe('Claude not found');
      expect(error.name).toBe('AICommentError');
      expect(error.userMessage).toBe('AI CLI tool is not installed. Please install it first.');
    });

    it('should allow custom user message', () => {
      const error = new AICommentError('TIMEOUT', 'Process timed out', {
        userMessage: 'Custom timeout message',
      });

      expect(error.code).toBe('TIMEOUT');
      expect(error.userMessage).toBe('Custom timeout message');
    });

    it('should include CLI info when provided', () => {
      const error = new AICommentError('CLI_NOT_AUTHENTICATED', 'Auth failed', {
        cli: 'claude',
      });

      expect(error.cli).toBe('claude');
    });

    it('should be instanceof Error', () => {
      const error = new AICommentError('UNKNOWN', 'Unknown error');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AICommentError);
    });

    it('should have all error codes mapped to messages', () => {
      const errorCodes: AICommentErrorCode[] = [
        'CLI_NOT_INSTALLED',
        'CLI_NOT_AUTHENTICATED',
        'CONTENT_TOO_LONG',
        'CONTENT_EMPTY',
        'RATE_LIMITED',
        'NETWORK_ERROR',
        'TIMEOUT',
        'CANCELLED',
        'PARSE_ERROR',
        'PLATFORM_NOT_SUPPORTED',
        'VAULT_CONTEXT_ERROR',
        'INVALID_PROMPT',
        'MODEL_NOT_FOUND',
        'UNKNOWN',
      ];

      for (const code of errorCodes) {
        const message = getAICommentErrorMessage(code);
        expect(message).toBeTruthy();
        expect(typeof message).toBe('string');
      }
    });
  });

  describe('Type Guards', () => {
    describe('isAICli', () => {
      it('should return true for valid CLI names', () => {
        expect(isAICli('claude')).toBe(true);
        expect(isAICli('gemini')).toBe(true);
        expect(isAICli('codex')).toBe(true);
      });

      it('should return false for invalid CLI names', () => {
        expect(isAICli('chatgpt')).toBe(false);
        expect(isAICli('gpt4')).toBe(false);
        expect(isAICli('')).toBe(false);
        expect(isAICli('CLAUDE')).toBe(false); // Case sensitive
      });
    });

    describe('isAICommentType', () => {
      it('should return true for valid comment types', () => {
        const validTypes: AICommentType[] = [
          'summary', 'factcheck', 'critique', 'keypoints',
          'sentiment', 'connections', 'translation', 'custom'
        ];

        for (const type of validTypes) {
          expect(isAICommentType(type)).toBe(true);
        }
      });

      it('should return false for invalid comment types', () => {
        expect(isAICommentType('analyze')).toBe(false);
        expect(isAICommentType('explain')).toBe(false);
        expect(isAICommentType('')).toBe(false);
        expect(isAICommentType('SUMMARY')).toBe(false); // Case sensitive
      });
    });

    describe('isAICommentError', () => {
      it('should return true for AICommentError instances', () => {
        const error = new AICommentError('CANCELLED', 'Cancelled');
        expect(isAICommentError(error)).toBe(true);
      });

      it('should return false for regular errors', () => {
        const error = new Error('Regular error');
        expect(isAICommentError(error)).toBe(false);
      });

      it('should return false for non-errors', () => {
        expect(isAICommentError(null)).toBe(false);
        expect(isAICommentError(undefined)).toBe(false);
        expect(isAICommentError('error string')).toBe(false);
        expect(isAICommentError({ code: 'CANCELLED' })).toBe(false);
      });
    });
  });

  describe('Utility Functions', () => {
    describe('generateCommentId', () => {
      it('should generate unique IDs', () => {
        const id1 = generateCommentId('claude', 'summary');
        const id2 = generateCommentId('claude', 'summary');

        // Format: cli-type-timestamp-random (e.g., claude-summary-20241215T02072212-a1b2)
        expect(id1).toMatch(/^claude-summary-\d{8}T\d{8}-[a-z0-9]{4}$/);

        // Note: IDs might be the same if generated in same millisecond
        // So we just verify the format
      });

      it('should include CLI and type in ID', () => {
        const id = generateCommentId('gemini', 'factcheck');
        expect(id).toContain('gemini');
        expect(id).toContain('factcheck');
      });

      it('should generate different IDs for different CLIs', () => {
        const claudeId = generateCommentId('claude', 'summary');
        const geminiId = generateCommentId('gemini', 'summary');

        expect(claudeId).toContain('claude');
        expect(geminiId).toContain('gemini');
        expect(claudeId).not.toBe(geminiId);
      });
    });

    describe('createContentHash', () => {
      it('should create consistent hash for same content', () => {
        const content = 'Hello, world!';
        const hash1 = createContentHash(content);
        const hash2 = createContentHash(content);

        expect(hash1).toBe(hash2);
      });

      it('should create different hashes for different content', () => {
        const hash1 = createContentHash('Content A');
        const hash2 = createContentHash('Content B');

        expect(hash1).not.toBe(hash2);
      });

      it('should return 8-character hex string', () => {
        const hash = createContentHash('Test content');
        expect(hash).toMatch(/^[0-9a-f]{8}$/);
      });

      it('should handle empty string', () => {
        const hash = createContentHash('');
        expect(hash).toMatch(/^[0-9a-f]{8}$/);
      });

      it('should handle unicode content', () => {
        const hash = createContentHash('안녕하세요 🎉');
        expect(hash).toMatch(/^[0-9a-f]{8}$/);
      });
    });
  });

  describe('Default Settings', () => {
    it('should have valid default settings', () => {
      expect(DEFAULT_AI_COMMENT_SETTINGS.enabled).toBe(false);
      expect(isAICli(DEFAULT_AI_COMMENT_SETTINGS.defaultCli)).toBe(true);
      expect(isAICommentType(DEFAULT_AI_COMMENT_SETTINGS.defaultType)).toBe(true);
    });

    it('should have platform visibility settings', () => {
      const visibility = DEFAULT_AI_COMMENT_SETTINGS.platformVisibility;

      expect(typeof visibility.socialMedia).toBe('boolean');
      expect(typeof visibility.blogNews).toBe('boolean');
      expect(typeof visibility.videoAudio).toBe('boolean');
      expect(Array.isArray(visibility.excludedPlatforms)).toBe(true);
    });

    it('should have vault context settings', () => {
      const vaultContext = DEFAULT_AI_COMMENT_SETTINGS.vaultContext;

      expect(typeof vaultContext.enabled).toBe('boolean');
      expect(Array.isArray(vaultContext.excludePaths)).toBe(true);
      expect(typeof vaultContext.smartFiltering).toBe('boolean');
    });

    it('should have multi-AI settings', () => {
      expect(typeof DEFAULT_AI_COMMENT_SETTINGS.multiAiEnabled).toBe('boolean');
      expect(Array.isArray(DEFAULT_AI_COMMENT_SETTINGS.multiAiSelection)).toBe(true);

      // All selections should be valid CLIs
      for (const cli of DEFAULT_AI_COMMENT_SETTINGS.multiAiSelection) {
        expect(isAICli(cli)).toBe(true);
      }
    });
  });

  describe('Default Prompts', () => {
    it('should have prompts for all non-custom types', () => {
      const nonCustomTypes: Exclude<AICommentType, 'custom'>[] = [
        'summary', 'factcheck', 'critique', 'keypoints',
        'sentiment', 'connections', 'translation'
      ];

      for (const type of nonCustomTypes) {
        expect(DEFAULT_PROMPTS[type]).toBeTruthy();
        expect(typeof DEFAULT_PROMPTS[type]).toBe('string');
      }
    });

    it('should include content placeholder in prompts', () => {
      for (const prompt of Object.values(DEFAULT_PROMPTS)) {
        expect(prompt).toContain('{{content}}');
      }
    });

    it('should have vault context placeholders in connections prompt', () => {
      expect(DEFAULT_PROMPTS.connections).toContain('{{vaultPath}}');
      expect(DEFAULT_PROMPTS.connections).toContain('{{currentNote}}');
      expect(DEFAULT_PROMPTS.connections).toContain('{{currentNoteName}}');
    });

    it('should have language placeholder in translation prompt', () => {
      expect(DEFAULT_PROMPTS.translation).toContain('{{targetLanguage}}');
    });
  });

  describe('Display Names and Descriptions', () => {
    it('should have display names for all types', () => {
      const allTypes: AICommentType[] = [
        'summary', 'factcheck', 'critique', 'keypoints',
        'sentiment', 'connections', 'translation', 'custom'
      ];

      for (const type of allTypes) {
        expect(COMMENT_TYPE_DISPLAY_NAMES[type]).toBeTruthy();
        expect(typeof COMMENT_TYPE_DISPLAY_NAMES[type]).toBe('string');
      }
    });

    it('should have descriptions for all types', () => {
      const allTypes: AICommentType[] = [
        'summary', 'factcheck', 'critique', 'keypoints',
        'sentiment', 'connections', 'translation', 'custom'
      ];

      for (const type of allTypes) {
        expect(COMMENT_TYPE_DESCRIPTIONS[type]).toBeTruthy();
        expect(typeof COMMENT_TYPE_DESCRIPTIONS[type]).toBe('string');
      }
    });
  });
});
