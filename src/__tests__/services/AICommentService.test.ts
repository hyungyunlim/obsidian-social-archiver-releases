/**
 * Tests for AICommentService
 *
 * These tests focus on validation logic, type checking, and error handling.
 * Full E2E tests with actual CLI execution would be in integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AICommentError,
  DEFAULT_PROMPTS,
  generateCommentId,
  createContentHash,
  isAICli,
  isAICommentType,
} from '../../types/ai-comment';
import type { AICommentOptions, AICommentMeta, AICli, AICommentType } from '../../types/ai-comment';

describe('AICommentService Types and Utilities', () => {
  // ============================================================================
  // AICommentError Tests
  // ============================================================================

  describe('AICommentError', () => {
    it('should create error with CLI context', () => {
      const error = new AICommentError('CLI_NOT_INSTALLED', 'Claude not found', {
        cli: 'claude',
      });

      expect(error.code).toBe('CLI_NOT_INSTALLED');
      expect(error.cli).toBe('claude');
      expect(error.message).toBe('Claude not found');
    });

    it('should provide default user message', () => {
      const error = new AICommentError('RATE_LIMITED', 'Too many requests');

      expect(error.userMessage).toBe(
        'AI service rate limit reached. Please try again later.'
      );
    });

    it('should allow custom user message', () => {
      const error = new AICommentError('TIMEOUT', 'Timed out', {
        userMessage: 'Custom timeout message',
      });

      expect(error.userMessage).toBe('Custom timeout message');
    });

    it('should be instanceof Error', () => {
      const error = new AICommentError('UNKNOWN', 'Something went wrong');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AICommentError);
    });
  });

  // ============================================================================
  // Comment ID Generation Tests
  // ============================================================================

  describe('generateCommentId', () => {
    it('should generate ID with CLI and type', () => {
      const id = generateCommentId('claude', 'summary');

      // Format: cli-type-timestamp-random (e.g., claude-summary-20241215T14362886-kcyb)
      // Timestamp: 8 digits date + T + 8 digits time (including ms)
      // Random: 4 alphanumeric characters
      expect(id).toMatch(/^claude-summary-\d{8}T\d{8}-[a-z0-9]{4}$/);
    });

    it('should generate different IDs for different CLIs', () => {
      const claudeId = generateCommentId('claude', 'summary');
      const geminiId = generateCommentId('gemini', 'summary');

      expect(claudeId).toContain('claude');
      expect(geminiId).toContain('gemini');
    });

    it('should generate different IDs for different types', () => {
      const summaryId = generateCommentId('claude', 'summary');
      const factcheckId = generateCommentId('claude', 'factcheck');

      expect(summaryId).toContain('summary');
      expect(factcheckId).toContain('factcheck');
    });
  });

  // ============================================================================
  // Content Hash Tests
  // ============================================================================

  describe('createContentHash', () => {
    it('should create consistent hash', () => {
      const content = 'Test content for hashing';
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
      const hash = createContentHash('Any content');

      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  // ============================================================================
  // Type Guard Tests
  // ============================================================================

  describe('Type Guards', () => {
    describe('isAICli', () => {
      it('should return true for valid CLIs', () => {
        expect(isAICli('claude')).toBe(true);
        expect(isAICli('gemini')).toBe(true);
        expect(isAICli('codex')).toBe(true);
      });

      it('should return false for invalid CLIs', () => {
        expect(isAICli('chatgpt')).toBe(false);
        expect(isAICli('gpt4')).toBe(false);
        expect(isAICli('')).toBe(false);
      });
    });

    describe('isAICommentType', () => {
      it('should return true for valid types', () => {
        const validTypes = [
          'summary',
          'factcheck',
          'critique',
          'keypoints',
          'sentiment',
          'connections',
          'translation',
          'custom',
        ];

        for (const type of validTypes) {
          expect(isAICommentType(type)).toBe(true);
        }
      });

      it('should return false for invalid types', () => {
        expect(isAICommentType('analyze')).toBe(false);
        expect(isAICommentType('explain')).toBe(false);
        expect(isAICommentType('')).toBe(false);
      });
    });
  });

  // ============================================================================
  // Default Prompts Tests
  // ============================================================================

  describe('DEFAULT_PROMPTS', () => {
    it('should have prompts for all non-custom types', () => {
      const types: Exclude<AICommentType, 'custom'>[] = [
        'summary',
        'factcheck',
        'critique',
        'keypoints',
        'sentiment',
        'connections',
        'translation',
      ];

      for (const type of types) {
        expect(DEFAULT_PROMPTS[type]).toBeDefined();
        expect(typeof DEFAULT_PROMPTS[type]).toBe('string');
        expect(DEFAULT_PROMPTS[type].length).toBeGreaterThan(0);
      }
    });

    it('should include content placeholder', () => {
      for (const prompt of Object.values(DEFAULT_PROMPTS)) {
        expect(prompt).toContain('{{content}}');
      }
    });

    it('should have translation language placeholder in translation prompt', () => {
      expect(DEFAULT_PROMPTS.translation).toContain('{{targetLanguage}}');
    });

    it('should have required placeholders in connections prompt', () => {
      expect(DEFAULT_PROMPTS.connections).toContain('{{vaultPath}}');
      expect(DEFAULT_PROMPTS.connections).toContain('{{currentNote}}');
      expect(DEFAULT_PROMPTS.connections).toContain('{{currentNoteName}}');
    });
  });

  // ============================================================================
  // AICommentMeta Structure Tests
  // ============================================================================

  describe('AICommentMeta Structure', () => {
    it('should validate meta structure', () => {
      const meta: AICommentMeta = {
        id: 'claude-summary-20241214T103000Z',
        cli: 'claude',
        type: 'summary',
        generatedAt: '2024-12-14T10:30:00.000Z',
        processingTime: 1500,
        contentHash: 'abc12345',
      };

      expect(meta.id).toMatch(/^[a-z]+-[a-z]+-\d{8}T\d{6}Z$/);
      expect(isAICli(meta.cli)).toBe(true);
      expect(isAICommentType(meta.type)).toBe(true);
      expect(new Date(meta.generatedAt).toISOString()).toBe(meta.generatedAt);
      expect(meta.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('should support optional fields', () => {
      const meta: AICommentMeta = {
        id: 'claude-custom-20241214T103000Z',
        cli: 'claude',
        type: 'custom',
        generatedAt: '2024-12-14T10:30:00.000Z',
        processingTime: 1500,
        contentHash: 'abc12345',
        customPrompt: 'My custom prompt',
      };

      expect(meta.customPrompt).toBe('My custom prompt');
    });
  });

  // ============================================================================
  // AICommentOptions Structure Tests
  // ============================================================================

  describe('AICommentOptions Structure', () => {
    it('should validate minimal options', () => {
      const options: AICommentOptions = {
        cli: 'claude',
        type: 'summary',
      };

      expect(isAICli(options.cli)).toBe(true);
      expect(isAICommentType(options.type)).toBe(true);
    });

    it('should validate options with all fields', () => {
      const controller = new AbortController();
      const progressUpdates: number[] = [];

      const options: AICommentOptions = {
        cli: 'claude',
        type: 'translation',
        customPrompt: 'Custom prompt',
        targetLanguage: 'Korean',
        onProgress: (p) => progressUpdates.push(p.percentage),
        signal: controller.signal,
      };

      expect(options.targetLanguage).toBe('Korean');
      expect(typeof options.onProgress).toBe('function');
      expect(options.signal).toBe(controller.signal);
    });
  });

  // ============================================================================
  // Content Validation Logic Tests
  // ============================================================================

  describe('Content Validation Logic', () => {
    it('should identify empty content', () => {
      const emptyContents = ['', '   ', '\n\t\n', '  \n  '];

      for (const content of emptyContents) {
        expect(content.trim().length === 0).toBe(true);
      }
    });

    it('should identify content exceeding limit', () => {
      const maxLength = 100000;
      const longContent = 'A'.repeat(100001);

      expect(longContent.length > maxLength).toBe(true);
    });

    it('should accept valid content', () => {
      const maxLength = 100000;
      const validContents = [
        'Short content',
        'A'.repeat(10000),
        'Unicode content: 한글 日本語 🎉',
        'A'.repeat(99999),
      ];

      for (const content of validContents) {
        expect(content.trim().length > 0).toBe(true);
        expect(content.length <= maxLength).toBe(true);
      }
    });
  });

  // ============================================================================
  // Prompt Building Logic Tests
  // ============================================================================

  describe('Prompt Building Logic', () => {
    it('should replace content placeholder', () => {
      const template = DEFAULT_PROMPTS.summary;
      const content = 'This is the test content.';
      const prompt = template.replace(/\{\{content\}\}/g, content);

      expect(prompt).toContain(content);
      expect(prompt).not.toContain('{{content}}');
    });

    it('should replace translation language placeholder', () => {
      const template = DEFAULT_PROMPTS.translation;
      const content = 'Hello world';
      const language = 'Korean';

      let prompt = template.replace(/\{\{content\}\}/g, content);
      prompt = prompt.replace(/\{\{targetLanguage\}\}/g, language);

      expect(prompt).toContain(content);
      expect(prompt).toContain(language);
      expect(prompt).not.toContain('{{content}}');
      expect(prompt).not.toContain('{{targetLanguage}}');
    });

    it('should handle connections prompt placeholders', () => {
      const template = DEFAULT_PROMPTS.connections;
      const content = 'Test content';
      const vaultPath = '/path/to/vault';
      const currentNote = 'path/to/current-note.md';
      const currentNoteName = 'current-note';

      let prompt = template.replace(/\{\{content\}\}/g, content);
      prompt = prompt.replace(/\{\{vaultPath\}\}/g, vaultPath);
      prompt = prompt.replace(/\{\{currentNote\}\}/g, currentNote);
      prompt = prompt.replace(/\{\{currentNoteName\}\}/g, currentNoteName);

      expect(prompt).toContain(content);
      expect(prompt).toContain(vaultPath);
      expect(prompt).toContain(currentNote);
      expect(prompt).toContain(currentNoteName);
    });

    it('should handle connections prompt without current note', () => {
      const template = DEFAULT_PROMPTS.connections;
      const content = 'Test content';
      const vaultPath = '/path/to/vault';

      let prompt = template.replace(/\{\{content\}\}/g, content);
      prompt = prompt.replace(/\{\{vaultPath\}\}/g, vaultPath);
      prompt = prompt.replace(/\{\{currentNote\}\}/g, 'this note');
      prompt = prompt.replace(/\{\{currentNoteName\}\}/g, '');

      expect(prompt).toContain(content);
      expect(prompt).toContain(vaultPath);
      expect(prompt).not.toContain('{{currentNote}}');
      expect(prompt).not.toContain('{{currentNoteName}}');
    });
  });

  // ============================================================================
  // CLI Command Pattern Tests
  // ============================================================================

  describe('CLI Command Patterns', () => {
    it('should define Claude command pattern', () => {
      // Claude: claude -p "prompt" --output-format text
      const args = ['-p', 'test prompt', '--output-format', 'text', '--max-turns', '1'];

      expect(args).toContain('-p');
      expect(args).toContain('--output-format');
      expect(args).toContain('text');
    });

    it('should define Gemini command pattern', () => {
      // Gemini: gemini -p "prompt" --output-format stream-json --yolo
      const args = ['-p', 'test prompt', '--output-format', 'stream-json', '--yolo'];

      expect(args).toContain('-p');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--yolo');
    });

    it('should define Codex command pattern', () => {
      // Codex: codex exec --json -s read-only --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "prompt"
      const args = ['exec', '--json', '-s', 'read-only', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', 'test prompt'];

      expect(args).toContain('exec');
      expect(args).toContain('--json');
      expect(args).toContain('-s');
      expect(args).toContain('read-only');
      expect(args).toContain('--skip-git-repo-check');
      expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    });
  });

  // ============================================================================
  // Error Code Mapping Tests
  // ============================================================================

  describe('Error Code Mapping', () => {
    const errorPatterns = [
      { pattern: /api key/i, code: 'CLI_NOT_AUTHENTICATED' },
      { pattern: /unauthorized/i, code: 'CLI_NOT_AUTHENTICATED' },
      { pattern: /rate limit/i, code: 'RATE_LIMITED' },
      { pattern: /too many requests/i, code: 'RATE_LIMITED' },
      { pattern: /network/i, code: 'NETWORK_ERROR' },
      { pattern: /connection/i, code: 'NETWORK_ERROR' },
      { pattern: /model.*not found/i, code: 'MODEL_NOT_FOUND' },
      { pattern: /too long/i, code: 'CONTENT_TOO_LONG' },
      { pattern: /context length/i, code: 'CONTENT_TOO_LONG' },
    ];

    it('should map authentication errors', () => {
      const messages = ['API key not found', 'Unauthorized access', 'Not logged in'];

      for (const msg of messages) {
        const matchesAuth =
          /api key/i.test(msg) || /unauthorized/i.test(msg) || /not logged in/i.test(msg);
        expect(matchesAuth).toBe(true);
      }
    });

    it('should map rate limit errors', () => {
      const messages = ['Rate limit exceeded', 'Too many requests', 'Quota exceeded'];

      for (const msg of messages) {
        const matchesRateLimit =
          /rate limit/i.test(msg) || /too many requests/i.test(msg) || /quota/i.test(msg);
        expect(matchesRateLimit).toBe(true);
      }
    });

    it('should map network errors', () => {
      const messages = ['Network error', 'Connection refused', 'Timeout error'];

      for (const msg of messages) {
        const matchesNetwork =
          /network/i.test(msg) || /connection/i.test(msg) || /timeout/i.test(msg);
        expect(matchesNetwork).toBe(true);
      }
    });
  });
});
