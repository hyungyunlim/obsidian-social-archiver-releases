/**
 * One AI comment with the user's own provider key: the same prompt the CLIs
 * get (research: the shared research prompt), web search for fact checks and
 * research, and for a custom comment only when the user asked on that run
 * (`web`: the web-access note on the prompt, the provider's sources listed
 * under the comment). Model resolution and recovery through ByokService.
 * Provider failures come back as AICommentError carrying the ByokError code.
 */
import {
  COMMENT_SYSTEM_INSTRUCTIONS,
  ByokError,
  RESEARCH_MAX_OUTPUT_TOKENS,
  buildArticleContext,
  buildResearchPrompt,
  formatResearchReport,
  fromStoredProviderId,
  withSourceLinks,
  withWebAccessRequest,
  type ByokErrorCode,
  type ByokGenerateRequest,
  type ByokRunStatus,
  type ByokStoredProviderId,
} from '../../vendor/byok-ai-core';
import {
  AICommentError,
  createContentHash,
  generateCommentId,
  type AICommentErrorCode,
  type AICommentMeta,
  type AICommentOptions,
  type AICommentResult,
} from '../../types/ai-comment';
import { buildAICommentPrompt } from '../ai-comment/prompt-builder';
import type { ByokService } from './ByokService';
import { byokErrorMessage } from './byokText';

/**
 * Answer budgets (the adapters add room for reasoning). ponytail: two fixed
 * tiers; the stored comment is capped at 20k chars either way.
 */
const COMMENT_MAX_OUTPUT_TOKENS = 3_000;
const LONG_COMMENT_MAX_OUTPUT_TOKENS = 8_000;
const LONG_OUTPUT_TYPES = new Set(['translation', 'translate-transcript', 'reformat', 'custom']);

export async function generateByokComment(
  byok: ByokService,
  content: string,
  options: AICommentOptions & { cli: ByokStoredProviderId },
  run: { signal: AbortSignal; timeoutMs: number },
): Promise<AICommentResult> {
  const provider = fromStoredProviderId(options.cli);
  if (options.type === 'connections') {
    // Reads the vault: CLI only (the provider sees just the post).
    throw new AICommentError('INVALID_PROMPT', 'Note connections need a local AI CLI');
  }
  const startedAt = Date.now();
  const research = options.type === 'research';
  // A custom comment searches only when the user asked on this run.
  const web = options.type === 'custom' && options.web === true;
  const progress = (percentage: number, status: string, phase: 'preparing' | 'generating' | 'complete'): void => {
    options.onProgress?.({ percentage, status, cli: options.cli, phase });
  };

  const prompt = research ? '' : buildAICommentPrompt(content, options, null);
  const request: Omit<ByokGenerateRequest, 'model' | 'signal'> = research
    ? {
        ...buildResearchPrompt({
          context: buildArticleContext({ ...options.researchContext, body: content }),
          focus: options.customPrompt,
          outputLanguage: options.outputLanguage,
          depth: 'quick',
        }),
        maxOutputTokens: RESEARCH_MAX_OUTPUT_TOKENS,
        webSearch: true,
      }
    : {
        system: COMMENT_SYSTEM_INSTRUCTIONS,
        messages: [{ role: 'user', content: web ? withWebAccessRequest(prompt) : prompt }],
        maxOutputTokens: LONG_OUTPUT_TYPES.has(options.type) ? LONG_COMMENT_MAX_OUTPUT_TOKENS : COMMENT_MAX_OUTPUT_TOKENS,
        webSearch: options.type === 'factcheck' || web,
      };

  const timeout = withTimeout(run.signal, run.timeoutMs);
  progress(10, 'Preparing...', 'preparing');
  try {
    const result = await byok.run({
      provider,
      task: research ? 'research' : 'comment',
      interactive: options.interactive !== false,
      ...(options.model?.trim() ? { preferred: options.model.trim() } : {}),
      run: (client, model) =>
        client.generate(
          { ...request, model, signal: timeout.signal },
          {
            onStatus: (status) => {
              const [percentage, message] = statusProgress(status);
              progress(percentage, message, 'generating');
            },
          },
        ),
    });
    const text = research
      ? formatResearchReport({ text: result.value.text, citations: result.value.citations })
      : web
        ? withSourceLinks(result.value.text, result.value.citations)
        : result.value.text;
    const meta: AICommentMeta = {
      id: generateCommentId(options.cli, options.type),
      cli: options.cli,
      model: result.model,
      ...(result.value.model ? { executedModel: result.value.model } : {}),
      type: options.type,
      generatedAt: new Date().toISOString(),
      processingTime: Date.now() - startedAt,
      contentHash: createContentHash(content),
      ...(options.type === 'custom' && options.customPrompt ? { customPrompt: options.customPrompt } : {}),
      ...(options.type === 'translate-transcript' && options.targetLanguage ? { targetLanguage: options.targetLanguage } : {}),
    };
    progress(100, 'Complete!', 'complete');
    return { content: text, meta };
  } catch (error) {
    if (timeout.timedOut()) {
      throw new AICommentError('TIMEOUT', 'BYOK request timed out');
    }
    if (error instanceof ByokError) {
      throw new AICommentError(COMMENT_ERROR_BY_BYOK_CODE[error.code], error.message, {
        userMessage: byokErrorMessage(error, provider),
        byokCode: error.code,
      });
    }
    throw error;
  } finally {
    timeout.clear();
  }
}

const COMMENT_ERROR_BY_BYOK_CODE: Record<ByokErrorCode, AICommentErrorCode> = {
  invalid_key: 'CLI_NOT_AUTHENTICATED',
  insufficient_credit: 'RATE_LIMITED',
  rate_limited: 'RATE_LIMITED',
  model_not_found: 'MODEL_NOT_FOUND',
  region_blocked: 'UNKNOWN',
  content_blocked: 'UNKNOWN',
  context_too_long: 'CONTENT_TOO_LONG',
  provider_unavailable: 'NETWORK_ERROR',
  network: 'NETWORK_ERROR',
  cancelled: 'CANCELLED',
  unknown: 'UNKNOWN',
};

function statusProgress(status: ByokRunStatus): [number, string] {
  switch (status.phase) {
    case 'requesting':
      return [20, 'Sending to the provider...'];
    case 'searching':
      return [40, 'Searching the web...'];
    case 'generating':
      return [60, 'Writing...'];
  }
}

/** `signal` plus a deadline; `timedOut()` tells a deadline from a cancel. */
function withTimeout(signal: AbortSignal, ms: number): { signal: AbortSignal; timedOut(): boolean; clear(): void } {
  const controller = new AbortController();
  let expired = false;
  const abort = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    timedOut: () => expired,
    clear: (): void => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    },
  };
}
