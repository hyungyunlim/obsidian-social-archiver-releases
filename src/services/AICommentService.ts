/**
 * AICommentService - Orchestrates AI comment generation using local CLI tools
 *
 * Supports:
 * - Claude Code (Anthropic CLI)
 * - Gemini CLI (Google)
 * - OpenAI Codex
 *
 * Single Responsibility: Generate AI comments via CLI tools with process management
 */

// Type-only import replaced with inline interface
interface ChildProcess {
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'close', listener: (code: number | null) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}
import type {
  AICommentResult,
  AICommentOptions,
  AICommentProgress,
  AICommentMeta,
  AICommentType,
  MultiAIGenerationResult,
  AIOutputLanguage,
} from '../types/ai-comment';
import type { AICli } from '../utils/ai-cli';
import nodeRequire from '../utils/nodeRequire';
import {
  AICommentError,
  DEFAULT_PROMPTS,
  generateCommentId,
  createContentHash,
  getLanguageInstruction,
  getFactCheckFormatSection,
  getGlossaryFormatSection,
  getCritiqueFormatSection,
  getKeyPointsFormatSection,
  getSentimentFormatSection,
  getSummaryFormatSection,
  getConnectionsFormatSection,
  getTimestampInstruction,
} from '../types/ai-comment';
import { AICliDetector } from '../utils/ai-cli';
import { ProcessManager } from './ProcessManager';

// ============================================================================
// Types for Claude Stream-JSON
// ============================================================================

/** Claude stream-json event types */
interface ClaudeStreamEvent {
  type: 'system' | 'assistant' | 'user' | 'result';
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      text?: string;
    }>;
  };
  result?: string;
  subtype?: string;
}

/** Tool name to progress message mapping */
const TOOL_PROGRESS_MESSAGES: Record<string, { percentage: number; message: string }> = {
  WebSearch: { percentage: 35, message: 'Searching the web...' },
  WebFetch: { percentage: 45, message: 'Reading web content...' },
  Read: { percentage: 40, message: 'Reading files...' },
  Grep: { percentage: 30, message: 'Searching code...' },
  Glob: { percentage: 30, message: 'Finding files...' },
};

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for AI generation (5 minutes) */
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

/** Maximum content length (characters) */
const MAX_CONTENT_LENGTH = 100000;

/** Temp file prefix */
const TEMP_FILE_PREFIX = 'ai_comment_';

// ============================================================================
// AICommentService
// ============================================================================

export class AICommentService {
  private currentProcess: ChildProcess | null = null;
  private isCancelled = false;
  private lastReportedPercentage = 0;
  private static shellPath: string | null = null;
  private static shellPathPromise: Promise<string | null> | null = null;

  /**
   * Get essential paths from the user's login shell.
   * GUI apps on macOS don't inherit the PATH from dotfiles (.zshrc, etc.)
   * This function spawns a login shell to get the actual PATH, then filters to essential paths.
   * On Windows, returns the current PATH as-is since Windows handles this differently.
   */
  private static async getShellPath(): Promise<string | null> {
    // Return cached value if available
    if (AICommentService.shellPath !== null) {
      return AICommentService.shellPath;
    }

    // Return pending promise if already fetching
    if (AICommentService.shellPathPromise !== null) {
      return AICommentService.shellPathPromise;
    }

    AICommentService.shellPathPromise = new Promise((resolve) => {
      try {
        const os = nodeRequire('os') as typeof import('os');
        const isWindows = os.platform() === 'win32';

        // On Windows, use the current PATH directly
        // Windows GUI apps inherit PATH properly from the system environment
        if (isWindows) {
          const currentPath = process.env.PATH || process.env.Path || '';
          if (currentPath) {
            AICommentService.shellPath = currentPath;
            console.debug('[AICommentService] Using Windows PATH:', currentPath.slice(0, 200));
            resolve(currentPath);
          } else {
            resolve(null);
          }
          return;
        }

        // Unix-specific: Get PATH from login shell
        const { execSync } = nodeRequire('child_process') as typeof import('child_process');

        // Determine the user's default shell
        const shell = process.env.SHELL || '/bin/zsh';

        // Execute a login shell to get the PATH
        // -l: login shell (sources profile files)
        // -i: interactive (sources rc files)
        // -c: execute command
        const result = execSync(`${shell} -lic 'echo $PATH'`, {
          encoding: 'utf-8',
          timeout: 5000,
          env: {
            HOME: os.homedir(),
            USER: os.userInfo().username,
          },
        });

        // The shell might output startup messages, so find the actual PATH line
        // PATH should be a colon-separated list of absolute paths (starting with /)
        const lines = result.trim().split('\n');
        let fullShellPath = '';
        for (const line of lines) {
          const trimmed = line.trim();
          // PATH line should start with / and contain colons
          if (trimmed.startsWith('/') && trimmed.includes(':')) {
            fullShellPath = trimmed;
            break;
          }
        }

        if (fullShellPath && fullShellPath.length > 0) {
          // Filter PATH to essential directories to avoid ENAMETOOLONG error
          // Keep: system paths, homebrew, npm global, and common CLI tool locations
          const pathParts = fullShellPath.split(':');
          const filteredPaths = pathParts.filter(p => {
            // Always include system paths
            if (p.startsWith('/usr/') || p === '/bin' || p === '/sbin') return true;
            // Include homebrew
            if (p.startsWith('/opt/homebrew/')) return true;
            // Include user local bin
            if (p.includes('/.local/bin')) return true;
            // Include npm global
            if (p.includes('.npm')) return true;
            // Include nvm node
            if (p.includes('.nvm/versions/node')) return true;
            // Include cargo
            if (p.includes('.cargo/bin')) return true;
            return false;
          });

          // Ensure we have the basics even if not found
          const basics = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
          for (const basic of basics) {
            if (!filteredPaths.includes(basic)) {
              filteredPaths.push(basic);
            }
          }

          const shellPath = filteredPaths.join(':');
          AICommentService.shellPath = shellPath;
          console.debug('[AICommentService] Got shell PATH (filtered):', shellPath.slice(0, 200));
          resolve(shellPath);
        } else {
          resolve(null);
        }
      } catch (error) {
        console.warn('[AICommentService] Failed to get shell PATH:', error);
        resolve(null);
      }
    });

    return AICommentService.shellPathPromise;
  }

  /**
   * Generate an AI comment for the given content
   *
   * @param content - The content to analyze
   * @param options - Generation options
   * @returns Generated comment result
   */
  async generateComment(
    content: string,
    options: AICommentOptions
  ): Promise<AICommentResult> {
    this.isCancelled = false;
    this.lastReportedPercentage = 0;

    const startTime = Date.now();

    // 1. Validate content
    this.validateContent(content);

    // 2. Validate CLI is available
    const cliResult = await AICliDetector.detect(options.cli);
    if (!cliResult.available || !cliResult.path) {
      throw new AICommentError(
        'CLI_NOT_INSTALLED',
        `${options.cli} CLI not found`,
        { cli: options.cli }
      );
    }

    // 3. Check authentication
    if (!cliResult.authenticated) {
      throw new AICommentError(
        'CLI_NOT_AUTHENTICATED',
        `${options.cli} CLI not authenticated`,
        { cli: options.cli }
      );
    }

    // 4. Build prompt
    const prompt = this.buildPrompt(content, options);

    // 5. Report initial progress
    options.onProgress?.({
      percentage: 0,
      status: 'Preparing...',
      cli: options.cli,
      phase: 'preparing',
    });

    // 6. Prepare content file (for large content)
    const tempFile = await this.prepareContentFile(content);

    try {
      // 7. Build command
      const { command, args, stdinPrompt } = this.buildCommand(
        options.cli,
        cliResult.path,
        prompt,
        tempFile,
        options
      );

      // 8. Execute command
      const output = await this.executeCommand(
        command,
        args,
        options,
        DEFAULT_TIMEOUT,
        stdinPrompt
      );

      // 9. Parse result
      const processingTime = Date.now() - startTime;
      const contentHash = createContentHash(content);
      const commentId = generateCommentId(options.cli, options.type);

      const meta: AICommentMeta = {
        id: commentId,
        cli: options.cli,
        type: options.type,
        generatedAt: new Date().toISOString(),
        processingTime,
        contentHash,
        customPrompt: options.type === 'custom' ? options.customPrompt : undefined,
      };

      // 10. Report completion
      options.onProgress?.({
        percentage: 100,
        status: 'Complete!',
        cli: options.cli,
        phase: 'complete',
      });

      return {
        content: output.trim(),
        meta,
        rawResponse: output,
      };
    } finally {
      // 11. Cleanup temp file
      await this.cleanupTempFile(tempFile);
    }
  }

  /**
   * Cancel ongoing generation
   */
  cancel(): void {
    this.isCancelled = true;
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }

  /**
   * Check if generation is in progress
   */
  isRunning(): boolean {
    return this.currentProcess !== null;
  }

  // ============================================================================
  // Multi-AI Generation
  // ============================================================================

  /**
   * Generate comments from multiple AI CLIs in parallel
   *
   * @param content - Content to analyze
   * @param clis - Array of CLIs to use
   * @param options - Base options (cli will be overridden for each)
   * @returns Array of results with status for each CLI
   */
  async generateMultiAIComments(
    content: string,
    clis: AICli[],
    options: Omit<AICommentOptions, 'cli'>
  ): Promise<MultiAIGenerationResult[]> {
    if (clis.length === 0) {
      return [];
    }

    const startTime = Date.now();

    // Prepare content file once for all CLIs
    const tempFile = await this.prepareContentFile(content);

    try {
      // Create promises for each CLI
      const promises = clis.map(async (cli): Promise<MultiAIGenerationResult> => {
        try {
          const result = await this.generateComment(content, {
            ...options,
            cli,
            // Create per-CLI progress callback
            onProgress: options.onProgress
              ? (progress) => {
                  options.onProgress?.({
                    ...progress,
                    cli,
                  });
                }
              : undefined,
          });

          return {
            status: 'fulfilled' as const,
            cli,
            result,
          };
        } catch (error) {
          return {
            status: 'rejected' as const,
            cli,
            error: error instanceof AICommentError
              ? error
              : new AICommentError(
                  'UNKNOWN',
                  error instanceof Error ? error.message : String(error),
                  { cli }
                ),
          };
        }
      });

      // Execute all in parallel
      return await Promise.all(promises);
    } finally {
      // Cleanup temp file after all complete
      await this.cleanupTempFile(tempFile);
    }
  }

  /**
   * Cancel all ongoing multi-AI generation
   */
  cancelAll(): void {
    this.cancel();
    // ProcessManager will handle killing all registered ai-comment processes
    ProcessManager.killByType('ai-comment');
  }

  // ============================================================================
  // Private Methods - Validation
  // ============================================================================

  /**
   * Validate content before processing
   */
  private validateContent(content: string): void {
    if (!content || content.trim().length === 0) {
      throw new AICommentError('CONTENT_EMPTY', 'No content provided');
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      throw new AICommentError(
        'CONTENT_TOO_LONG',
        `Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`
      );
    }
  }

  // ============================================================================
  // Private Methods - Prompt Building
  // ============================================================================

  /**
   * Build the prompt for the AI CLI
   */
  private buildPrompt(content: string, options: AICommentOptions): string {
    let template: string;

    if (options.type === 'custom' && options.customPrompt) {
      // For custom prompts, wrap with content if {{content}} placeholder is not present
      // This ensures the AI always has the content to analyze
      if (options.customPrompt.includes('{{content}}')) {
        template = options.customPrompt;
      } else {
        // Append content automatically if user didn't include placeholder
        template = `${options.customPrompt}

Content:
{{content}}`;
      }
    } else if (options.type === 'custom') {
      throw new AICommentError('INVALID_PROMPT', 'Custom prompt required for custom type');
    } else {
      template = DEFAULT_PROMPTS[options.type];
    }

    // Replace placeholders
    let prompt = template.replace(/\{\{content\}\}/g, content);

    if ((options.type === 'translation' || options.type === 'translate-transcript') && options.targetLanguage) {
      prompt = prompt.replace(/\{\{targetLanguage\}\}/g, options.targetLanguage);
    }

    // Get output language setting
    const outputLanguage: AIOutputLanguage = options.outputLanguage || 'auto';

    // Handle language instruction (skip for translation/translate-transcript - they have own language handling)
    if (options.type !== 'translation' && options.type !== 'translate-transcript') {
      const languageInstruction = getLanguageInstruction(outputLanguage);
      prompt = prompt.replace(/\{\{languageInstruction\}\}/g, languageInstruction);
    } else {
      // Remove the placeholder for translation types
      prompt = prompt.replace(/\{\{languageInstruction\}\}/g, '');
    }

    // Handle localized format sections based on output language
    // Fact check format section
    if (options.type === 'factcheck') {
      const factCheckFormat = getFactCheckFormatSection(outputLanguage);
      prompt = prompt.replace(/\{\{factCheckFormat\}\}/g, factCheckFormat);
    } else {
      prompt = prompt.replace(/\{\{factCheckFormat\}\}/g, '');
    }

    // Glossary format section
    if (options.type === 'glossary') {
      const glossaryFormat = getGlossaryFormatSection(outputLanguage);
      prompt = prompt.replace(/\{\{glossaryFormat\}\}/g, glossaryFormat);
    } else {
      prompt = prompt.replace(/\{\{glossaryFormat\}\}/g, '');
    }

    // Critique format section
    if (options.type === 'critique') {
      const critiqueFormat = getCritiqueFormatSection(outputLanguage);
      prompt = prompt.replace(/\{\{critiqueFormat\}\}/g, critiqueFormat);
    } else {
      prompt = prompt.replace(/\{\{critiqueFormat\}\}/g, '');
    }

    // Key points format section
    if (options.type === 'keypoints') {
      const keyPointsFormat = getKeyPointsFormatSection(outputLanguage);
      prompt = prompt.replace(/\{\{keyPointsFormat\}\}/g, keyPointsFormat);
    } else {
      prompt = prompt.replace(/\{\{keyPointsFormat\}\}/g, '');
    }

    // Sentiment format section
    if (options.type === 'sentiment') {
      const sentimentFormat = getSentimentFormatSection(outputLanguage);
      prompt = prompt.replace(/\{\{sentimentFormat\}\}/g, sentimentFormat);
    } else {
      prompt = prompt.replace(/\{\{sentimentFormat\}\}/g, '');
    }

    // Summary format section (with dynamic length based on content)
    if (options.type === 'summary') {
      const summaryFormat = getSummaryFormatSection(outputLanguage, content.length);
      prompt = prompt.replace(/\{\{summaryFormat\}\}/g, summaryFormat);
    } else {
      prompt = prompt.replace(/\{\{summaryFormat\}\}/g, '');
    }

    // Connections format section
    if (options.type === 'connections') {
      const connectionsFormat = getConnectionsFormatSection(outputLanguage);
      prompt = prompt.replace(/\{\{connectionsFormat\}\}/g, connectionsFormat);
    } else {
      prompt = prompt.replace(/\{\{connectionsFormat\}\}/g, '');
    }

    // Timestamp instruction (for podcast/video transcripts with timestamps)
    // Only added if content contains timestamps like [12:34] or [1:23:45]
    const timestampInstruction = getTimestampInstruction(content);
    prompt = prompt.replace(/\{\{timestampInstruction\}\}/g, timestampInstruction);

    // Handle vault path for connections type
    if (options.type === 'connections' && options.vaultPath) {
      prompt = prompt.replace(/\{\{vaultPath\}\}/g, options.vaultPath);
    } else {
      prompt = prompt.replace(/\{\{vaultPath\}\}/g, '');
    }

    // Handle current note path for connections type (to exclude self-reference)
    if (options.type === 'connections' && options.currentNotePath) {
      const path = nodeRequire('path') as typeof import('path');
      const noteName = path.basename(options.currentNotePath, '.md');
      prompt = prompt.replace(/\{\{currentNote\}\}/g, options.currentNotePath);
      prompt = prompt.replace(/\{\{currentNoteName\}\}/g, noteName);
    } else {
      prompt = prompt.replace(/\{\{currentNote\}\}/g, 'this note');
      prompt = prompt.replace(/\{\{currentNoteName\}\}/g, '');
    }

    return prompt;
  }

  // ============================================================================
  // Private Methods - Content File Management
  // ============================================================================

  /**
   * Prepare content in a temp file for large content
   * Returns null if content is small enough to pass directly
   */
  private async prepareContentFile(content: string): Promise<string | null> {
    // For smaller content, we can pass it directly
    if (content.length < 10000) {
      return null;
    }

    const os = nodeRequire('os') as typeof import('os');
    const fs = (nodeRequire('fs') as typeof import('fs')).promises;
    const path = nodeRequire('path') as typeof import('path');

    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `${TEMP_FILE_PREFIX}${Date.now()}.txt`);

    await fs.writeFile(tempFile, content, 'utf-8');
    return tempFile;
  }

  /**
   * Cleanup temp file
   */
  private async cleanupTempFile(tempFile: string | null): Promise<void> {
    if (!tempFile) return;

    try {
      const fs = (nodeRequire('fs') as typeof import('fs')).promises;
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  // ============================================================================
  // Private Methods - Command Building
  // ============================================================================

  /**
   * Build CLI-specific command
   * Returns command, args, and optionally stdinPrompt for Windows compatibility
   */
  private buildCommand(
    cli: AICli,
    cliPath: string,
    prompt: string,
    contentFile: string | null,
    options: AICommentOptions
  ): { command: string; args: string[]; stdinPrompt?: string } {
    // For file-based content, modify the prompt
    const finalPrompt = contentFile
      ? `${prompt}\n\n[Content is in file: ${contentFile}]`
      : prompt;

    // Check if we're on Windows - use stdin for prompts to avoid shell escaping issues
    const os = nodeRequire('os') as typeof import('os');
    const isWindows = os.platform() === 'win32';

    switch (cli) {
      case 'claude':
        return this.buildClaudeCommand(cliPath, finalPrompt, options.type, isWindows);

      case 'gemini':
        return this.buildGeminiCommand(cliPath, finalPrompt, isWindows);

      case 'codex':
        return this.buildCodexCommand(cliPath, finalPrompt, options.type, isWindows);

      default:
        throw new AICommentError('CLI_NOT_INSTALLED', `Unknown CLI: ${cli}`);
    }
  }

  /**
   * Build Claude CLI command
   * Claude Code: claude -p "prompt" --output-format stream-json --verbose
   * Note: stream-json provides real-time tool use events for progress tracking
   * Note: max-turns varies by comment type (factcheck/glossary needs more for web search)
   * Note: dangerously-skip-permissions to allow file access without prompts
   * On Windows: Use stdin for prompt to avoid shell escaping issues
   */
  private buildClaudeCommand(
    cliPath: string,
    prompt: string,
    commentType: AICommentType,
    isWindows: boolean
  ): { command: string; args: string[]; stdinPrompt?: string } {
    // Set max-turns based on comment type and content length
    // - factcheck: needs web searches + response generation, allow 10 turns
    // - glossary: needs multiple web searches (one per term) + response, allow 20 turns
    // - connections: needs to explore vault files (Glob, Grep, Read), allow 20 turns
    // - custom: user prompts may need web search for research, allow 15 turns
    // - others: simple text generation, but long content (podcasts) may need more turns
    let maxTurns: string;
    if (commentType === 'connections') {
      maxTurns = '20';
    } else if (commentType === 'glossary') {
      maxTurns = '20';
    } else if (commentType === 'factcheck') {
      maxTurns = '10';
    } else if (commentType === 'custom') {
      maxTurns = '15'; // Custom prompts may need web search
    } else {
      // For simple types (summary, critique, keypoints, sentiment), adjust based on content length
      // Long podcast transcripts may need more turns to process
      const contentLength = prompt.length;
      if (contentLength > 20000) {
        maxTurns = '5'; // Very long content (long podcasts)
      } else if (contentLength > 10000) {
        maxTurns = '4'; // Long content
      } else if (contentLength > 5000) {
        maxTurns = '3'; // Medium-long content
      } else {
        maxTurns = '2'; // Short content
      }
    }

    // On Windows, pass prompt via stdin to avoid shell escaping issues
    if (isWindows) {
      return {
        command: cliPath,
        args: [
          '--output-format', 'stream-json',
          '--verbose',
          '--max-turns', maxTurns,
          '--dangerously-skip-permissions',
        ],
        stdinPrompt: prompt,
      };
    }

    return {
      command: cliPath,
      args: [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--max-turns', maxTurns,
        '--dangerously-skip-permissions',
      ],
    };
  }

  /**
   * Build Gemini CLI command
   * Gemini: gemini -p "prompt" --output-format stream-json --yolo
   * Uses stream-json for real-time JSONL events (init, message, tool_use, tool_result, result)
   * --yolo auto-approves all actions for faster execution
   * On Windows: Use stdin for prompt to avoid shell escaping issues
   */
  private buildGeminiCommand(
    cliPath: string,
    prompt: string,
    isWindows: boolean
  ): { command: string; args: string[]; stdinPrompt?: string } {
    // On Windows, pass prompt via stdin to avoid shell escaping issues
    if (isWindows) {
      return {
        command: cliPath,
        args: [
          '--output-format', 'stream-json',
          '--yolo',
        ],
        stdinPrompt: prompt,
      };
    }

    return {
      command: cliPath,
      args: [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--yolo',
      ],
    };
  }

  /**
   * Build Codex CLI command
   * Codex: codex exec --json -s <sandbox> --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "prompt"
   * Uses exec mode for non-interactive execution with JSON streaming output
   * -s/--sandbox sets access level: read-only | workspace-write | danger-full-access
   * --skip-git-repo-check allows running outside of git repositories (e.g., Obsidian vaults)
   * --dangerously-bypass-approvals-and-sandbox (or --yolo) skips approvals for faster execution
   * Note: Codex uses shell commands (curl) for web search, which requires danger-full-access sandbox
   * On Windows: Use stdin for prompt to avoid shell escaping issues
   */
  private buildCodexCommand(
    cliPath: string,
    prompt: string,
    commentType: AICommentType,
    isWindows: boolean
  ): { command: string; args: string[]; stdinPrompt?: string } {
    // factcheck and glossary need network access for curl-based web searches
    // danger-full-access allows shell commands including network requests
    const sandboxMode = (commentType === 'factcheck' || commentType === 'glossary') ? 'danger-full-access' : 'read-only';

    // On Windows, pass prompt via stdin to avoid shell escaping issues
    // Note: Codex exec may need the prompt as positional arg, so we still include it
    // but also provide stdinPrompt as fallback
    if (isWindows) {
      return {
        command: cliPath,
        args: [
          'exec',
          '--json',
          '-s', sandboxMode,
          '--skip-git-repo-check',
          '--dangerously-bypass-approvals-and-sandbox',
        ],
        stdinPrompt: prompt,
      };
    }

    return {
      command: cliPath,
      args: [
        'exec',
        '--json',
        '-s', sandboxMode,
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        prompt,
      ],
    };
  }

  // ============================================================================
  // Private Methods - Command Execution
  // ============================================================================

  /**
   * Execute CLI command and return output
   * @param stdinPrompt - Optional prompt to send via stdin (used on Windows to avoid shell escaping issues)
   */
  private async executeCommand(
    command: string,
    args: string[],
    options: AICommentOptions,
    timeout: number,
    stdinPrompt?: string
  ): Promise<string> {
    const { spawn } = nodeRequire('child_process') as typeof import('child_process');

    // Report generating progress
    options.onProgress?.({
      percentage: 10,
      status: 'Generating...',
      cli: options.cli,
      phase: 'generating',
    });

    // Get the user's shell PATH (cached after first call)
    // GUI apps on macOS don't inherit PATH from dotfiles, so we need to get it from the shell
    const shellPath = await AICommentService.getShellPath();

    return new Promise((resolve, reject) => {

      // Build environment with shell PATH
      const os = nodeRequire('os') as typeof import('os');
      const isWindows = os.platform() === 'win32';
      const pathSeparator = isWindows ? ';' : ':';
      const env = { ...process.env };

      if (shellPath) {
        // Use the shell PATH which includes user's custom paths
        env.PATH = shellPath;
      } else {
        // Fallback: ensure PATH includes common binary locations
        const currentPath = env.PATH || env.Path || '';

        if (isWindows) {
          // Windows: Common binary locations
          const additionalPaths = [
            process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs\\claude-code`,
            process.env.APPDATA && `${process.env.APPDATA}\\npm`,
            'C:\\Program Files\\nodejs',
            'C:\\Program Files (x86)\\nodejs',
          ].filter(Boolean) as string[];

          const pathsToAdd = additionalPaths.filter(p => !currentPath.toLowerCase().includes(p.toLowerCase()));
          if (pathsToAdd.length > 0) {
            env.PATH = [...pathsToAdd, currentPath].join(pathSeparator);
          }
        } else {
          // Unix: Common binary locations
          const additionalPaths = [
            '/opt/homebrew/bin',  // Homebrew on Apple Silicon
            '/usr/local/bin',     // Homebrew on Intel / local binaries
            '/usr/bin',           // System binaries (curl, grep, etc.)
            '/bin',               // Core system binaries
            '/usr/sbin',          // System admin binaries
            '/sbin',              // Core system admin binaries
          ];
          const pathsToAdd = additionalPaths.filter(p => !currentPath.includes(p));
          if (pathsToAdd.length > 0) {
            env.PATH = [...pathsToAdd, currentPath].join(pathSeparator);
          }
        }
      }

      // Ensure HOME and USER are set for shell config loading
      if (!env.HOME) {
        env.HOME = os.homedir();
      }
      if (!env.USER && !isWindows) {
        env.USER = os.userInfo().username;
      }

      // Spawn options - Windows needs shell:true for proper executable resolution
      const spawnOptions: { stdio: ['pipe', 'pipe', 'pipe']; env: typeof env; shell?: boolean } = {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      };

      // On Windows, use shell to help find executables in PATH
      // Quote command and args that contain spaces to handle paths like "C:\Program Files\..."
      let processedCommand = command;
      let processedArgs = args;
      if (isWindows) {
        spawnOptions.shell = true;
        // Quote command if it contains spaces
        if (command.includes(' ') && !command.startsWith('"') && !command.startsWith("'")) {
          processedCommand = `"${command}"`;
        }
        // Quote arguments that contain spaces
        processedArgs = args.map(arg => {
          if (arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
            return `"${arg}"`;
          }
          return arg;
        });
      }

      const childProcess = spawn(processedCommand, processedArgs, spawnOptions);

      // If stdinPrompt is provided (Windows), write it to stdin then close
      // Otherwise, close stdin immediately to signal we're not sending any input
      if (stdinPrompt && childProcess.stdin) {
        childProcess.stdin.write(stdinPrompt);
        childProcess.stdin.end();
      } else {
        childProcess.stdin?.end();
      }

      this.currentProcess = childProcess;

      // Register with ProcessManager for cleanup
      const processId = ProcessManager.register(
        childProcess,
        'ai-comment',
        `${options.cli} ${options.type} comment`
      );

      // Setup timeout
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          this.isCancelled = true;
          childProcess.kill('SIGTERM');
          reject(new AICommentError(
            'TIMEOUT',
            `AI comment generation timed out after ${Math.round(timeout / 1000 / 60)} minutes`,
            { cli: options.cli }
          ));
        }, timeout);
      }

      // Handle abort signal
      if (options.signal) {
        const abortHandler = () => {
          this.isCancelled = true;
          childProcess.kill('SIGTERM');
          reject(new AICommentError('CANCELLED', 'AI comment generation cancelled by user'));
        };

        options.signal.addEventListener('abort', abortHandler);

        childProcess.on('close', () => {
          options.signal?.removeEventListener('abort', abortHandler);
        });
      }

      let stdoutData = '';
      let stderrData = '';
      let streamJsonBuffer = ''; // Buffer for incomplete JSON lines
      let streamJsonResult = ''; // Final result extracted from stream-json
      let accumulatedText = ''; // Accumulated text from assistant messages
      const isClaudeStreamJson = options.cli === 'claude';
      const isCodexJson = options.cli === 'codex';
      const isGeminiStreamJson = options.cli === 'gemini';

      // Gemini CLI doesn't emit events during thinking phase (can be 30-60+ seconds)
      // Use a timer to show "Thinking..." progress after init event
      let geminiThinkingTimer: ReturnType<typeof setTimeout> | null = null;
      let geminiThinkingInterval: ReturnType<typeof setInterval> | null = null;

      const startGeminiThinkingProgress = () => {
        if (!isGeminiStreamJson || !options.onProgress) return;

        // Start showing "Thinking..." after 3 seconds of silence
        geminiThinkingTimer = setTimeout(() => {
          if (this.lastReportedPercentage < 20) {
            this.lastReportedPercentage = 20;
            options.onProgress?.({
              percentage: 20,
              status: 'AI is thinking...',
              cli: options.cli,
              phase: 'generating',
            });
          }

          // Gradually increase progress every 5 seconds to show activity
          let thinkingProgress = 20;
          geminiThinkingInterval = setInterval(() => {
            if (this.lastReportedPercentage < 30 && thinkingProgress < 30) {
              thinkingProgress += 2;
              this.lastReportedPercentage = thinkingProgress;
              options.onProgress?.({
                percentage: thinkingProgress,
                status: 'AI is thinking...',
                cli: options.cli,
                phase: 'generating',
              });
            }
          }, 5000);
        }, 3000);
      };

      const stopGeminiThinkingProgress = () => {
        if (geminiThinkingTimer) {
          clearTimeout(geminiThinkingTimer);
          geminiThinkingTimer = null;
        }
        if (geminiThinkingInterval) {
          clearInterval(geminiThinkingInterval);
          geminiThinkingInterval = null;
        }
      };

      childProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        stdoutData += output;

        if (isClaudeStreamJson) {
          // Parse stream-json format for Claude CLI
          streamJsonBuffer += output;
          // Handle both Unix (\n) and Windows (\r\n) line endings
          const lines = streamJsonBuffer.replace(/\r\n/g, '\n').split('\n');
          // Keep incomplete last line in buffer
          streamJsonBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              const parsed = this.parseStreamJsonEvent(trimmed, options);
              if (parsed.result) {
                streamJsonResult = parsed.result;
              }
              if (parsed.text) {
                accumulatedText += parsed.text;
              }
            }
          }
        } else if (isGeminiStreamJson) {
          // Parse stream-json format for Gemini CLI
          streamJsonBuffer += output;
          // Handle both Unix (\n) and Windows (\r\n) line endings
          const lines = streamJsonBuffer.replace(/\r\n/g, '\n').split('\n');
          streamJsonBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              const parsed = this.parseGeminiStreamJsonEvent(trimmed, options);
              if (parsed.text) {
                accumulatedText += parsed.text;
              }

              // Control thinking timer based on event type
              // Start timer after init, stop when actual activity happens
              if (parsed.eventType === 'init') {
                startGeminiThinkingProgress();
              } else if (parsed.eventType === 'tool_use' || parsed.eventType === 'tool_result' ||
                         parsed.eventType === 'message' || parsed.eventType === 'result') {
                stopGeminiThinkingProgress();
              }
            }
          }
        } else if (isCodexJson) {
          // Parse JSONL format for Codex CLI
          streamJsonBuffer += output;
          // Handle both Unix (\n) and Windows (\r\n) line endings
          const lines = streamJsonBuffer.replace(/\r\n/g, '\n').split('\n');
          streamJsonBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              const parsed = this.parseCodexJsonEvent(trimmed, options);
              if (parsed.text) {
                accumulatedText += parsed.text;
              }
            }
          }
        } else {
          // Parse and report progress for other CLIs
          this.parseProgress(output, options);
        }
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        stderrData += output;
        // Some CLIs output to stderr (Codex exec mode outputs progress to stderr)
        if (isCodexJson) {
          // Codex exec mode outputs progress info to stderr
          this.parseCodexStderrProgress(output, options);
        } else if (!isClaudeStreamJson && !isGeminiStreamJson) {
          this.parseProgress(output, options);
        }
      });

      childProcess.on('close', (code: number | null) => {
        this.currentProcess = null;

        // Clear timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        // Clear Gemini thinking timer
        stopGeminiThinkingProgress();

        if (this.isCancelled) {
          return; // Already rejected
        }

        // Process any remaining buffer for Claude stream-json
        if (isClaudeStreamJson && streamJsonBuffer.trim()) {
          const parsed = this.parseStreamJsonEvent(streamJsonBuffer.trim(), options);
          if (parsed.result) {
            streamJsonResult = parsed.result;
          }
          if (parsed.text) {
            accumulatedText += parsed.text;
          }
        }

        // Process any remaining buffer for Gemini stream-json
        if (isGeminiStreamJson && streamJsonBuffer.trim()) {
          const parsed = this.parseGeminiStreamJsonEvent(streamJsonBuffer.trim(), options);
          if (parsed.text) {
            accumulatedText += parsed.text;
          }
        }

        // Process any remaining buffer for Codex JSONL
        if (isCodexJson && streamJsonBuffer.trim()) {
          const parsed = this.parseCodexJsonEvent(streamJsonBuffer.trim(), options);
          if (parsed.text) {
            accumulatedText += parsed.text;
          }
        }

        // Report parsing phase
        options.onProgress?.({
          percentage: 90,
          status: 'Processing response...',
          cli: options.cli,
          phase: 'parsing',
        });

        if (code === 0) {
          // Success - return output
          let output: string;

          if (isClaudeStreamJson) {
            // For Claude stream-json, prefer result field, fallback to accumulated text
            if (streamJsonResult) {
              output = streamJsonResult;
            } else if (accumulatedText) {
              output = accumulatedText;
            } else if (stdoutData.trim()) {
              // Fallback: try to extract text from raw stdout if stream-json parsing failed
              output = stdoutData.trim();
            } else {
              // No result found - likely hit max turns before generating response
              reject(new AICommentError(
                'TIMEOUT',
                'AI generation incomplete - reached maximum turns limit. Try again or use a simpler analysis type.',
                { cli: options.cli }
              ));
              return;
            }
          } else if (isGeminiStreamJson || isCodexJson) {
            // For Gemini/Codex stream-json, use accumulated text from message events
            if (accumulatedText) {
              output = accumulatedText;
            } else {
              // Fallback to raw stdout if no messages parsed
              output = stdoutData.trim();
            }
          } else {
            // Fallback to raw stdout for other CLIs
            output = stdoutData.trim();
          }

          if (output) {
            resolve(this.cleanOutput(output, options.cli));
          } else {
            reject(new AICommentError(
              'PARSE_ERROR',
              'No output from AI CLI',
              { cli: options.cli }
            ));
          }
        } else {
          // Error - parse stderr
          console.error(
            `[AICommentService] Process failed. Exit code: ${code}, stderr: ${stderrData.slice(0, 500)}`
          );
          reject(this.parseError(stderrData, code, options.cli));
        }
      });

      childProcess.on('error', (error: Error) => {
        console.error('[AICommentService] Process spawn error:', error);
        this.currentProcess = null;
        reject(new AICommentError(
          'CLI_NOT_INSTALLED',
          `Failed to start ${options.cli} CLI: ${error.message}`,
          { cli: options.cli }
        ));
      });
    });
  }

  // ============================================================================
  // Private Methods - Output Processing
  // ============================================================================

  /**
   * Parse Claude stream-json event and extract progress/result/text
   * Returns { result, text } if found, empty object otherwise
   */
  private parseStreamJsonEvent(
    jsonLine: string,
    options: AICommentOptions
  ): { result?: string; text?: string } {
    try {
      const event: ClaudeStreamEvent = JSON.parse(jsonLine);

      // Handle result event - extract final output
      if (event.type === 'result' && event.result) {
        return { result: event.result };
      }

      // Handle assistant message - check for tool use and text content
      if (event.type === 'assistant' && event.message?.content) {
        let textContent = '';

        for (const content of event.message.content) {
          // Tool use event - update progress based on tool name
          if (content.type === 'tool_use' && content.name) {
            const toolProgress = TOOL_PROGRESS_MESSAGES[content.name];
            if (toolProgress && options.onProgress) {
              const clamped = Math.min(89, Math.max(10, toolProgress.percentage));
              if (clamped > this.lastReportedPercentage) {
                this.lastReportedPercentage = clamped;
                options.onProgress({
                  percentage: clamped,
                  status: toolProgress.message,
                  cli: options.cli,
                  phase: 'generating',
                });
              }
            }
          }

          // Text content - accumulate for result
          if (content.type === 'text' && content.text) {
            textContent += content.text;
            // Update progress to show we're generating
            if (options.onProgress && this.lastReportedPercentage < 70) {
              this.lastReportedPercentage = 70;
              options.onProgress({
                percentage: 70,
                status: 'Generating response...',
                cli: options.cli,
                phase: 'generating',
              });
            }
          }
        }

        if (textContent) {
          return { text: textContent };
        }
      }

      return {};
    } catch {
      // Invalid JSON line - ignore
      return {};
    }
  }

  /**
   * Parse Gemini stream-json event format
   * Gemini -p --output-format stream-json outputs JSONL events
   * Event types: init, message, tool_use, tool_result, error, result
   * Returns { text, eventType } - eventType used for thinking timer control
   */
  private parseGeminiStreamJsonEvent(
    jsonLine: string,
    options: AICommentOptions
  ): { text?: string; eventType?: string } {
    try {
      const event = JSON.parse(jsonLine);

      // Handle init event - update progress
      if (event.type === 'init') {
        if (options.onProgress && this.lastReportedPercentage < 15) {
          this.lastReportedPercentage = 15;
          options.onProgress({
            percentage: 15,
            status: 'Session started...',
            cli: options.cli,
            phase: 'generating',
          });
        }
        return { eventType: 'init' };
      }

      // Handle message events - extract assistant content
      if (event.type === 'message') {
        // Update progress based on role
        if (event.role === 'assistant' && options.onProgress && this.lastReportedPercentage < 70) {
          this.lastReportedPercentage = 70;
          options.onProgress({
            percentage: 70,
            status: 'Generating response...',
            cli: options.cli,
            phase: 'generating',
          });
        }

        // Extract text content from assistant messages
        if (event.role === 'assistant' && event.content) {
          return { text: event.content, eventType: 'message' };
        }
        return { eventType: 'message' };
      }

      // Handle tool_use events - update progress
      if (event.type === 'tool_use') {
        if (event.tool_name && options.onProgress) {
          const toolName = event.tool_name.toLowerCase();
          if (toolName.includes('search') || toolName.includes('web')) {
            if (this.lastReportedPercentage < 35) {
              this.lastReportedPercentage = 35;
              options.onProgress({
                percentage: 35,
                status: 'Searching the web...',
                cli: options.cli,
                phase: 'generating',
              });
            }
          } else if (toolName.includes('read') || toolName.includes('fetch')) {
            if (this.lastReportedPercentage < 45) {
              this.lastReportedPercentage = 45;
              options.onProgress({
                percentage: 45,
                status: 'Reading content...',
                cli: options.cli,
                phase: 'generating',
              });
            }
          } else {
            if (this.lastReportedPercentage < 40) {
              this.lastReportedPercentage = 40;
              options.onProgress({
                percentage: 40,
                status: `Using ${event.tool_name}...`,
                cli: options.cli,
                phase: 'generating',
              });
            }
          }
        }
        return { eventType: 'tool_use' };
      }

      // Handle tool_result events
      if (event.type === 'tool_result') {
        if (options.onProgress && this.lastReportedPercentage < 55) {
          this.lastReportedPercentage = 55;
          options.onProgress({
            percentage: 55,
            status: 'Processing tool results...',
            cli: options.cli,
            phase: 'generating',
          });
        }
        return { eventType: 'tool_result' };
      }

      // Handle result event - final stats
      if (event.type === 'result') {
        if (options.onProgress) {
          options.onProgress({
            percentage: 85,
            status: 'Finalizing...',
            cli: options.cli,
            phase: 'generating',
          });
        }
        return { eventType: 'result' };
      }

      return {};
    } catch {
      // Invalid JSON line - ignore
      return {};
    }
  }

  /**
   * Parse Codex JSONL event format
   * Codex exec --json outputs newline-delimited JSON events
   * Event types include: thread.started, turn.started, item.completed, turn.completed, etc.
   * item.completed contains: { item: { type: "agent_message", text: "..." } }
   * Returns { text } if message content found
   */
  private parseCodexJsonEvent(
    jsonLine: string,
    options: AICommentOptions
  ): { text?: string } {
    try {
      const event = JSON.parse(jsonLine);

      // Handle thread.started - update progress
      if (event.type === 'thread.started' && options.onProgress) {
        if (this.lastReportedPercentage < 20) {
          this.lastReportedPercentage = 20;
          options.onProgress({
            percentage: 20,
            status: 'Thread started...',
            cli: options.cli,
            phase: 'generating',
          });
        }
      }

      // Handle turn.started - update progress
      if (event.type === 'turn.started' && options.onProgress) {
        if (this.lastReportedPercentage < 25) {
          this.lastReportedPercentage = 25;
          options.onProgress({
            percentage: 25,
            status: 'Processing...',
            cli: options.cli,
            phase: 'generating',
          });
        }
      }

      // Handle item.started - show real-time progress for reasoning, command execution, etc.
      if (event.type === 'item.started' && event.item && options.onProgress) {
        const itemType = event.item.type;

        if (itemType === 'reasoning') {
          if (this.lastReportedPercentage < 35) {
            this.lastReportedPercentage = 35;
            options.onProgress({
              percentage: 35,
              status: 'Thinking...',
              cli: options.cli,
              phase: 'generating',
            });
          }
        } else if (itemType === 'command_execution') {
          const cmd = event.item.command || '';
          let statusMsg = 'Running command...';

          // Show more descriptive message based on command
          if (cmd.includes('curl')) {
            if (cmd.includes('google')) {
              statusMsg = 'Searching Google...';
            } else if (cmd.includes('bing')) {
              statusMsg = 'Searching Bing...';
            } else if (cmd.includes('duckduckgo')) {
              statusMsg = 'Searching DuckDuckGo...';
            } else if (cmd.includes('wikipedia')) {
              statusMsg = 'Looking up Wikipedia...';
            } else {
              statusMsg = 'Fetching web data...';
            }
          } else if (cmd.includes('grep')) {
            statusMsg = 'Parsing results...';
          }

          options.onProgress({
            percentage: Math.min(55, this.lastReportedPercentage + 3),
            status: statusMsg,
            cli: options.cli,
            phase: 'generating',
          });
        } else if (itemType === 'function_call') {
          const funcName = event.item.name || 'tool';
          if (this.lastReportedPercentage < 45) {
            this.lastReportedPercentage = 45;
            options.onProgress({
              percentage: 45,
              status: `Calling ${funcName}...`,
              cli: options.cli,
              phase: 'generating',
            });
          }
        } else if (itemType === 'web_search' || itemType === 'web_search_call') {
          if (this.lastReportedPercentage < 40) {
            this.lastReportedPercentage = 40;
            options.onProgress({
              percentage: 40,
              status: 'Searching the web...',
              cli: options.cli,
              phase: 'generating',
            });
          }
        }
      }

      // Handle item.updated - show streaming progress
      if (event.type === 'item.updated' && event.item && options.onProgress) {
        const itemType = event.item.type;

        if (itemType === 'reasoning' && event.item.text) {
          // Show first few words of reasoning
          const preview = event.item.text.slice(0, 30).replace(/\n/g, ' ');
          options.onProgress({
            percentage: Math.min(50, this.lastReportedPercentage + 5),
            status: `Thinking: ${preview}...`,
            cli: options.cli,
            phase: 'generating',
          });
        }
      }

      // Handle item.completed - extract agent_message text and show progress for other types
      if (event.type === 'item.completed' && event.item) {
        const itemType = event.item.type;

        // Show progress for completed reasoning
        if (itemType === 'reasoning' && options.onProgress) {
          if (this.lastReportedPercentage < 55) {
            this.lastReportedPercentage = 55;
            options.onProgress({
              percentage: 55,
              status: 'Analysis complete...',
              cli: options.cli,
              phase: 'generating',
            });
          }
        }

        // Show progress for completed command execution
        if (itemType === 'command_execution' && options.onProgress) {
          const exitCode = event.item.exit_code;
          if (exitCode === 0) {
            // Success - show what succeeded
            const cmd = event.item.command || '';
            let statusMsg = 'Command completed';
            if (cmd.includes('curl') && cmd.includes('bing')) {
              statusMsg = 'Bing search completed';
            } else if (cmd.includes('curl') && cmd.includes('wikipedia')) {
              statusMsg = 'Wikipedia lookup completed';
            } else if (cmd.includes('curl')) {
              statusMsg = 'Web request completed';
            }
            this.lastReportedPercentage = Math.min(65, this.lastReportedPercentage + 5);
            options.onProgress({
              percentage: this.lastReportedPercentage,
              status: `${statusMsg}...`,
              cli: options.cli,
              phase: 'generating',
            });
          } else {
            // Failed - indicate retrying
            options.onProgress({
              percentage: this.lastReportedPercentage,
              status: 'Trying another approach...',
              cli: options.cli,
              phase: 'generating',
            });
          }
        }

        // Show progress for completed web search
        if ((itemType === 'web_search' || itemType === 'web_search_call') && options.onProgress) {
          if (this.lastReportedPercentage < 55) {
            this.lastReportedPercentage = 55;
            options.onProgress({
              percentage: 55,
              status: 'Web search complete...',
              cli: options.cli,
              phase: 'generating',
            });
          }
        }

        // agent_message type contains the response text
        if (itemType === 'agent_message' && event.item.text) {
          if (options.onProgress && this.lastReportedPercentage < 75) {
            this.lastReportedPercentage = 75;
            options.onProgress({
              percentage: 75,
              status: 'Response received...',
              cli: options.cli,
              phase: 'generating',
            });
          }
          return { text: event.item.text };
        }

        // Handle other item types with content
        if (event.item.content) {
          if (typeof event.item.content === 'string') {
            return { text: event.item.content };
          }
          if (Array.isArray(event.item.content)) {
            const textParts = event.item.content
              .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
              .map((c: { text: string }) => c.text);
            if (textParts.length > 0) {
              return { text: textParts.join('') };
            }
          }
        }
      }

      // Handle turn.completed - update progress
      if (event.type === 'turn.completed' && options.onProgress) {
        if (this.lastReportedPercentage < 85) {
          this.lastReportedPercentage = 85;
          options.onProgress({
            percentage: 85,
            status: 'Finalizing...',
            cli: options.cli,
            phase: 'generating',
          });
        }
      }

      // Legacy: Handle message events (older format) - extract text content
      if (event.type === 'message' && event.content) {
        if (options.onProgress && this.lastReportedPercentage < 70) {
          this.lastReportedPercentage = 70;
          options.onProgress({
            percentage: 70,
            status: 'Generating response...',
            cli: options.cli,
            phase: 'generating',
          });
        }

        if (typeof event.content === 'string') {
          return { text: event.content };
        }
        if (Array.isArray(event.content)) {
          const textParts = event.content
            .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
            .map((c: { text: string }) => c.text);
          if (textParts.length > 0) {
            return { text: textParts.join('') };
          }
        }
      }

      // Handle function_call events - update progress
      if (event.type === 'function_call' && event.name && options.onProgress) {
        const toolName = event.name;
        if (toolName.includes('search') || toolName.includes('web')) {
          this.lastReportedPercentage = 35;
          options.onProgress({
            percentage: 35,
            status: 'Searching the web...',
            cli: options.cli,
            phase: 'generating',
          });
        } else if (toolName.includes('read') || toolName.includes('fetch')) {
          this.lastReportedPercentage = 45;
          options.onProgress({
            percentage: 45,
            status: 'Reading content...',
            cli: options.cli,
            phase: 'generating',
          });
        }
      }

      // Handle reasoning events - update progress
      if (event.type === 'reasoning' && options.onProgress && this.lastReportedPercentage < 30) {
        this.lastReportedPercentage = 30;
        options.onProgress({
          percentage: 30,
          status: 'Thinking...',
          cli: options.cli,
          phase: 'generating',
        });
      }

      return {};
    } catch {
      // Invalid JSON line - ignore
      return {};
    }
  }

  /**
   * Parse Codex stderr progress output
   * Codex exec mode outputs progress info to stderr
   */
  private parseCodexStderrProgress(output: string, options: AICommentOptions): void {
    if (!options.onProgress) return;

    const lowerOutput = output.toLowerCase();

    // Check for various progress indicators
    if (lowerOutput.includes('thinking') || lowerOutput.includes('reasoning')) {
      if (this.lastReportedPercentage < 30) {
        this.lastReportedPercentage = 30;
        options.onProgress({
          percentage: 30,
          status: 'Thinking...',
          cli: options.cli,
          phase: 'generating',
        });
      }
    } else if (lowerOutput.includes('searching') || lowerOutput.includes('web_search')) {
      if (this.lastReportedPercentage < 40) {
        this.lastReportedPercentage = 40;
        options.onProgress({
          percentage: 40,
          status: 'Searching the web...',
          cli: options.cli,
          phase: 'generating',
        });
      }
    } else if (lowerOutput.includes('reading') || lowerOutput.includes('fetching')) {
      if (this.lastReportedPercentage < 50) {
        this.lastReportedPercentage = 50;
        options.onProgress({
          percentage: 50,
          status: 'Reading content...',
          cli: options.cli,
          phase: 'generating',
        });
      }
    } else if (lowerOutput.includes('generating') || lowerOutput.includes('writing')) {
      if (this.lastReportedPercentage < 60) {
        this.lastReportedPercentage = 60;
        options.onProgress({
          percentage: 60,
          status: 'Generating response...',
          cli: options.cli,
          phase: 'generating',
        });
      }
    }
  }

  /**
   * Parse progress from CLI output
   */
  private parseProgress(output: string, options: AICommentOptions): void {
    if (!options.onProgress) return;

    // Helper to report progress (allow same percentage with different status)
    const reportProgress = (percentage: number, status: string, forceUpdate = false) => {
      const clamped = Math.min(89, Math.max(10, percentage));
      if (forceUpdate || clamped > this.lastReportedPercentage) {
        this.lastReportedPercentage = Math.max(this.lastReportedPercentage, clamped);
        options.onProgress?.({
          percentage: clamped,
          status,
          cli: options.cli,
          phase: 'generating',
        });
      }
    };

    // Check for various progress indicators
    const lowerOutput = output.toLowerCase();

    // Claude CLI specific patterns (web search, tool use)
    if (lowerOutput.includes('websearch') || lowerOutput.includes('web_search') ||
        lowerOutput.includes('searching the web') || lowerOutput.includes('search:')) {
      reportProgress(35, 'Searching the web...', true);
    } else if (lowerOutput.includes('reading') || lowerOutput.includes('fetching') ||
               lowerOutput.includes('loading')) {
      reportProgress(45, 'Reading search results...', true);
    } else if (lowerOutput.includes('tool') && lowerOutput.includes('result')) {
      reportProgress(55, 'Processing tool results...', true);
    } else if (lowerOutput.includes('verifying') || lowerOutput.includes('checking')) {
      reportProgress(60, 'Verifying facts...', true);
    } else if (lowerOutput.includes('comparing') || lowerOutput.includes('cross-referencing')) {
      reportProgress(65, 'Cross-referencing sources...', true);
    }
    // Generic progress patterns
    else if (lowerOutput.includes('thinking') || lowerOutput.includes('processing')) {
      reportProgress(30, 'Thinking...');
    } else if (lowerOutput.includes('generating') || lowerOutput.includes('writing')) {
      reportProgress(70, 'Generating response...');
    } else if (lowerOutput.includes('analyzing')) {
      reportProgress(40, 'Analyzing content...');
    } else if (lowerOutput.includes('summarizing') || lowerOutput.includes('summarising')) {
      reportProgress(50, 'Summarizing...');
    }
  }

  /**
   * Clean CLI output to extract just the response
   */
  private cleanOutput(output: string, cli: AICli): string {
    let cleaned = output;

    // If output looks like stream-json (multiple JSON lines), try to extract text content
    if (output.includes('{"type":')) {
      const extractedText = this.extractTextFromStreamJson(output);
      if (extractedText) {
        cleaned = extractedText;
      }
    }

    // Remove common CLI prefixes/suffixes
    switch (cli) {
      case 'claude':
        // Claude Code may include metadata lines
        cleaned = this.removeMetadataLines(cleaned);
        break;

      case 'gemini':
        // Gemini may include prompt echoes
        cleaned = this.removePromptEcho(cleaned);
        break;

      case 'codex':
        // Codex may include headers
        cleaned = this.removeHeaders(cleaned);
        break;
    }

    return cleaned.trim();
  }

  /**
   * Extract text content from raw stream-json output
   * Useful as fallback when regular parsing fails
   * Throws AICommentError for error results like max_turns exceeded
   */
  private extractTextFromStreamJson(output: string): string | null {
    const lines = output.replace(/\r\n/g, '\n').split('\n');
    let result = '';
    let accumulatedText = '';
    let errorResult: { subtype?: string; is_error?: boolean } | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);

        // Check for error results (e.g., max_turns exceeded)
        if (event.type === 'result') {
          if (event.subtype === 'error_max_turns' || event.is_error) {
            errorResult = event;
          }
          if (event.result) {
            result = event.result;
          }
        }

        // Extract text from assistant messages
        if (event.type === 'assistant' && event.message?.content) {
          for (const content of event.message.content) {
            if (content.type === 'text' && content.text) {
              accumulatedText += content.text;
            }
          }
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    // Prefer result field, fallback to accumulated text
    if (result) return result;
    if (accumulatedText) return accumulatedText;

    // If we hit an error result without any text, throw an error
    if (errorResult) {
      if (errorResult.subtype === 'error_max_turns') {
        throw new AICommentError(
          'TIMEOUT',
          'AI exceeded maximum turns. Try a simpler request or increase max-turns.'
        );
      }
      throw new AICommentError(
        'UNKNOWN',
        'AI generation failed with an error result'
      );
    }

    return null;
  }

  /**
   * Remove metadata lines from output
   */
  private removeMetadataLines(output: string): string {
    const lines = output.split('\n');
    const contentLines = lines.filter(line => {
      const trimmed = line.trim();
      // Skip empty lines at start/end, metadata markers, etc.
      if (trimmed.startsWith('---') || trimmed.startsWith('===')) return false;
      if (trimmed.match(/^(Model|Time|Tokens):/i)) return false;
      return true;
    });
    return contentLines.join('\n').trim();
  }

  /**
   * Remove prompt echo from output
   */
  private removePromptEcho(output: string): string {
    // Some CLIs echo the prompt - find where response starts
    const markers = ['Response:', 'Answer:', 'Output:'];
    for (const marker of markers) {
      const idx = output.indexOf(marker);
      if (idx !== -1) {
        return output.substring(idx + marker.length).trim();
      }
    }
    return output;
  }

  /**
   * Remove headers from output
   */
  private removeHeaders(output: string): string {
    const lines = output.split('\n');
    let startIndex = 0;

    // Skip header lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() || '';
      if (line.startsWith('#') || line === '' || line.startsWith('```')) {
        startIndex = i + 1;
      } else {
        break;
      }
    }

    return lines.slice(startIndex).join('\n').trim();
  }

  // ============================================================================
  // Private Methods - Error Handling
  // ============================================================================

  /**
   * Parse error from stderr and exit code
   */
  private parseError(stderr: string, exitCode: number | null, cli: AICli): AICommentError {
    const lowerStderr = stderr.toLowerCase();

    // Authentication errors
    if (
      lowerStderr.includes('api key') ||
      lowerStderr.includes('unauthorized') ||
      lowerStderr.includes('authentication') ||
      lowerStderr.includes('not logged in')
    ) {
      return new AICommentError(
        'CLI_NOT_AUTHENTICATED',
        `${cli} authentication failed: ${stderr.slice(0, 200)}`,
        { cli }
      );
    }

    // Rate limiting
    if (
      lowerStderr.includes('rate limit') ||
      lowerStderr.includes('too many requests') ||
      lowerStderr.includes('quota')
    ) {
      return new AICommentError(
        'RATE_LIMITED',
        `${cli} rate limited: ${stderr.slice(0, 200)}`,
        { cli }
      );
    }

    // Network errors
    if (
      lowerStderr.includes('network') ||
      lowerStderr.includes('connection') ||
      lowerStderr.includes('timeout') ||
      lowerStderr.includes('econnrefused')
    ) {
      return new AICommentError(
        'NETWORK_ERROR',
        `Network error with ${cli}: ${stderr.slice(0, 200)}`,
        { cli }
      );
    }

    // Model not found
    if (
      lowerStderr.includes('model') &&
      (lowerStderr.includes('not found') || lowerStderr.includes('does not exist'))
    ) {
      return new AICommentError(
        'MODEL_NOT_FOUND',
        `Model not found: ${stderr.slice(0, 200)}`,
        { cli }
      );
    }

    // Content too long
    if (
      lowerStderr.includes('too long') ||
      lowerStderr.includes('exceeds') ||
      lowerStderr.includes('context length')
    ) {
      return new AICommentError(
        'CONTENT_TOO_LONG',
        `Content too long for ${cli}: ${stderr.slice(0, 200)}`,
        { cli }
      );
    }

    // Generic error
    return new AICommentError(
      'UNKNOWN',
      `${cli} failed with exit code ${exitCode}: ${stderr.slice(0, 200)}`,
      { cli }
    );
  }
}
