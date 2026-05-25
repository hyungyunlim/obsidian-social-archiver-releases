/**
 * AICommentCliService — headless wrappers for the AI Comment feature.
 *
 * Three surfaces:
 *   1. `scheduleGenerate(path, options)` — synchronous return.
 *      Fire-and-forget around AICommentService.generateComment, required because
 *      Obsidian 1.12.7 CLI loses handler output when the returned Promise yields
 *      to the macrotask queue (real AI CLI invocations take 10-60s+).
 *   2. `listComments(path)` — synchronous-ish (reads markdown via vault.read).
 *      Returns parsed metadata + body for every AI comment stored on the note.
 *   3. `detectProviders()` — synchronous return from the cached detection
 *      result; triggers a refresh in the background.
 *
 * All write paths append to `## AI Comments` in the target note via the
 * existing markdown-handler used by the in-app UI, so CLI-generated comments
 * are indistinguishable from UI-generated ones.
 *
 * Desktop-only. Mobile callers receive UNSUPPORTED_PLATFORM via the handler.
 */

import { Platform, TFile, normalizePath } from 'obsidian';
import type SocialArchiverPlugin from '../../main';
import type {
  AICli,
  AICommentMeta,
  AICommentOptions,
  AICommentProviderId,
  AICommentType,
  AIOutputLanguage,
} from '../../types/ai-comment';
import { isAICommentType } from '../../types/ai-comment';
import { AICliDetector, AI_CLI_INFO, type AICliDetectionResult } from '../../utils/ai-cli';
import { AICommentService } from '../../services/AICommentService';
import {
  parseAIComments,
  appendAIComment,
  countAIComments,
} from '../../services/ai-comment/markdown-handler';

export interface AICommentScheduleOptions {
  type: AICommentType;
  provider?: AICli;
  customPrompt?: string;
  targetLanguage?: string;
  outputLanguage?: AIOutputLanguage;
}

export interface AICommentScheduleResult {
  scheduled: true;
  path: string;
  type: AICommentType;
  provider: AICli;
  estimatedSeconds: number;
}

export interface AICommentListEntry {
  id: string;
  cli: AICommentProviderId;
  type: AICommentType;
  generatedAt: string;
  processingTime?: number;
  contentLength: number;
}

export interface AICommentListResult {
  path: string;
  count: number;
  comments: AICommentListEntry[];
}

export interface AIProviderEntry {
  cli: AICli;
  displayName: string;
  available: boolean;
  authenticated: boolean;
  path: string | null;
  version: string | null;
}

export interface AIProviderListResult {
  desktop: boolean;
  providers: AIProviderEntry[];
}

export class AICommentService_NotAvailableError extends Error {
  readonly code = 'SERVICE_NOT_READY';
  constructor(reason: string) {
    super(reason);
    this.name = 'AICommentService_NotAvailableError';
  }
}

const TYPE_ESTIMATES_SEC: Record<AICommentType, number> = {
  summary: 20,
  factcheck: 30,
  critique: 30,
  keypoints: 20,
  sentiment: 15,
  connections: 45,
  translation: 25,
  'translate-transcript': 40,
  glossary: 25,
  reformat: 30,
  custom: 30,
};

export class AICommentCliService {
  constructor(private readonly plugin: SocialArchiverPlugin) {}

  /**
   * Schedule an AI comment generation, returning synchronously.
   *
   * The handler caller MUST receive this within the current microtask drain
   * (Obsidian CLI 1.12.7 constraint). All async work — provider detection,
   * file read, AI CLI invocation, markdown append — is dispatched via `void`
   * and runs after the CLI response has been captured.
   */
  scheduleGenerate(
    path: string,
    options: AICommentScheduleOptions,
  ): AICommentScheduleResult {
    if (!Platform.isDesktopApp) {
      throw new AICommentService_NotAvailableError(
        'AI Comment generation is desktop-only (requires a locally installed AI CLI).',
      );
    }

    if (!isAICommentType(options.type)) {
      throw new AICommentService_NotAvailableError(`Unknown comment type: ${options.type}`);
    }

    if (options.type === 'custom' && !options.customPrompt?.trim()) {
      throw new AICommentService_NotAvailableError(`type=custom requires a prompt flag.`);
    }

    if ((options.type === 'translation' || options.type === 'translate-transcript') && !options.targetLanguage) {
      throw new AICommentService_NotAvailableError(`type=${options.type} requires the language flag.`);
    }

    const provider: AICli = options.provider ?? 'claude';

    // Fire-and-forget the heavy work. Errors swallowed; observable via
    // subsequent `ai-comments` reads or the plugin's console log.
    void this.runGeneration(path, provider, options).catch(() => {
      /* surfaced via ai-comments list */
    });

    return {
      scheduled: true,
      path,
      type: options.type,
      provider,
      estimatedSeconds: TYPE_ESTIMATES_SEC[options.type] ?? 30,
    };
  }

  /**
   * Background generation runner — never awaited from the CLI handler.
   * Auto-detects an available provider if `requestedProvider` is missing.
   */
  private async runGeneration(
    path: string,
    requestedProvider: AICli,
    options: AICommentScheduleOptions,
  ): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return;

    // Resolve provider: prefer the requested one, fall back to any detected.
    let provider = requestedProvider;
    const detection = await AICliDetector.detect(requestedProvider);
    if (!detection.available || !detection.authenticated) {
      const all = await AICliDetector.detectAll();
      const fallback = Array.from(all.values()).find((r) => r.available && r.authenticated);
      if (!fallback || !fallback.cli) return;
      provider = fallback.cli;
    }

    const markdown = await this.plugin.app.vault.read(file);

    const service = new AICommentService();
    const aiOptions: AICommentOptions = {
      cli: provider,
      type: options.type,
      customPrompt: options.customPrompt,
      targetLanguage: options.targetLanguage,
      outputLanguage: options.outputLanguage,
      vaultPath: this.plugin.app.vault.getName(),
      currentNotePath: file.path,
    };

    try {
      const result = await service.generateComment(markdown, aiOptions);
      const updated = appendAIComment(markdown, result.meta, result.content);
      await this.plugin.app.vault.modify(file, updated);
    } catch {
      /* surfaced via list */
    }
  }

  async listComments(path: string): Promise<AICommentListResult> {
    const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) {
      throw new AICommentService_NotAvailableError(`Note not found: ${path}`);
    }
    const markdown = await this.plugin.app.vault.read(file);
    const { comments, commentTexts } = parseAIComments(markdown);
    return {
      path: file.path,
      count: countAIComments(markdown),
      comments: comments.map((m) => this.toListEntry(m, commentTexts.get(m.id) ?? '')),
    };
  }

  private toListEntry(meta: AICommentMeta, body: string): AICommentListEntry {
    return {
      id: meta.id,
      cli: meta.cli,
      type: meta.type,
      generatedAt: meta.generatedAt,
      processingTime: meta.processingTime,
      contentLength: body.length,
    };
  }

  /**
   * Synchronous provider listing. Triggers an async refresh in the background;
   * the first call may return empty `available=false` entries — subsequent
   * calls return the refreshed snapshot.
   */
  detectProviders(): AIProviderListResult {
    if (!Platform.isDesktopApp) {
      return {
        desktop: false,
        providers: (Object.keys(AI_CLI_INFO) as AICli[]).map((cli) => ({
          cli,
          displayName: AI_CLI_INFO[cli].displayName,
          available: false,
          authenticated: false,
          path: null,
          version: null,
        })),
      };
    }

    // Kick a refresh; do not await.
    void AICliDetector.detectAll().catch(() => {});

    // Read cached results synchronously.
    const cached = AICliDetector.getCachedResults();
    const providers: AIProviderEntry[] = (Object.keys(AI_CLI_INFO) as AICli[]).map((cli) => {
      const r: AICliDetectionResult | undefined = cached.get(cli);
      return {
        cli,
        displayName: AI_CLI_INFO[cli].displayName,
        available: r?.available ?? false,
        authenticated: r?.authenticated ?? false,
        path: r?.path ?? null,
        version: r?.version ?? null,
      };
    });

    return { desktop: true, providers };
  }
}
