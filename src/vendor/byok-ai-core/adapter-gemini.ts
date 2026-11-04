/**
 * Gemini, key in the `x-goog-api-key` header only (docs checked 2026-11-04).
 * Runs: `models/{model}:generateContent`, or `:streamGenerateContent?alt=sse`
 * whose chunks are partial GenerateContentResponses (grounding chunks
 * included only once). Web search = `googleSearch` + `urlContext` tools;
 * caching is implicit. No `temperature`: Gemini 3.6+ ignore it and the docs
 * announce a 400 for it.
 * Deep research: Interactions API, `POST /v1beta/interactions` with the agent
 * and `background: true` (store defaults to true, which background requires),
 * polled `GET /interactions/{id}`, cancelled `POST /interactions/{id}/cancel`.
 * No `Api-Revision` header: the API ignores it since 2026-06-08 and browsers
 * fail the CORS preflight when it is sent.
 */
import type { ByokGenerateRequest, ByokGenerateResult } from './client';
import type { ByokProviderId } from './providers';
import {
  type ByokAdapter,
  type JsonRecord,
  asRecord,
  citationCollector,
  finishResult,
  frameJson,
  joinParts,
  num,
  outputTokenLimit,
  readJson,
  records,
  request,
  send,
  str,
  streamReporter,
  usageOf,
} from './adapter-shared';
import { ByokError, normalizeProviderError } from './errors';
import { readSseFrames } from './sse';

const BLOCKED = new Set([
  'SAFETY',
  'RECITATION',
  'LANGUAGE',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
]);

function requestBody(req: ByokGenerateRequest) {
  const system = [req.system, req.context].filter(Boolean).map((text) => ({ text }));
  return {
    ...(system.length > 0 ? { systemInstruction: { parts: system } } : {}),
    contents: req.messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    generationConfig: { maxOutputTokens: outputTokenLimit(req) },
    ...(req.webSearch ? { tools: [{ googleSearch: {} }, { urlContext: {} }] } : {}),
  };
}

export const geminiAdapter: ByokAdapter = {
  async generate(ctx, req, handlers) {
    const method = req.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const res = await send(ctx, request(ctx, 'POST', `/models/${encodeURIComponent(req.model)}:${method}`, requestBody(req), req));
    const report = streamReporter(handlers);
    const answer = answerAccumulator(ctx.provider, report.text);
    if (req.stream) {
      await readSseFrames(ctx.provider, res, (frame) => answer.add(frameJson(frame)), req.signal);
    } else {
      answer.add(asRecord(await readJson(ctx, res)));
    }
    return answer.result(req.model);
  },

  deepResearch: {
    async start(ctx, req) {
      const body = {
        agent: req.model,
        input: joinParts(req.system, req.context, req.prompt),
        background: true,
        agent_config: { type: 'deep-research', visualization: 'off' },
      };
      const interaction = asRecord(await readJson(ctx, await send(ctx, request(ctx, 'POST', '/interactions', body, req))));
      const id = str(interaction?.id);
      if (!id) throw new ByokError('unknown', 'Gemini did not return an interaction id.', { provider: ctx.provider });
      return { provider: 'gemini', id, model: req.model, startedAt: Date.now() };
    },

    async poll(ctx, handle) {
      const path = `/interactions/${encodeURIComponent(handle.id)}`;
      const interaction = asRecord(await readJson(ctx, await send(ctx, request(ctx, 'GET', path)))) ?? {};
      const { provider } = ctx;
      switch (interaction.status) {
        case 'completed':
        case 'incomplete':
          try {
            return { status: 'completed', result: interactionResult(provider, interaction, handle.model) };
          } catch (error) {
            if (error instanceof ByokError) return { status: 'failed', error };
            throw error;
          }
        case 'failed':
          return {
            status: 'failed',
            error: normalizeProviderError(provider, 200, JSON.stringify({ error: asRecord(interaction.error) ?? {} })),
          };
        case 'cancelled':
          return { status: 'cancelled', error: new ByokError('cancelled', 'The research was cancelled.', { provider }) };
        case 'requires_action':
        case 'requires_continuation':
          return {
            status: 'failed',
            error: new ByokError('unknown', 'The research stopped to wait for input this app cannot give.', { provider }),
          };
        default:
          return { status: 'running' };
      }
    },

    async cancel(ctx, handle) {
      await send(ctx, request(ctx, 'POST', `/interactions/${encodeURIComponent(handle.id)}/cancel`));
    },
  },
};

/** GenerateContentResponse chunks (one when not streamed) → result. */
function answerAccumulator(provider: ByokProviderId, onText: (text: string) => void) {
  const citations = citationCollector();
  const queries = new Set<string>();
  let text = '';
  let finishReason: string | undefined;
  let blockReason: string | undefined;
  let usage: JsonRecord | undefined;
  let modelVersion: string | undefined;
  return {
    add(chunk: JsonRecord | undefined): void {
      if (!chunk) return;
      if (chunk.error) {
        const error = asRecord(chunk.error);
        throw normalizeProviderError(provider, num(error?.code) ?? 200, JSON.stringify(chunk));
      }
      blockReason = str(asRecord(chunk.promptFeedback)?.blockReason) ?? blockReason;
      usage = asRecord(chunk.usageMetadata) ?? usage;
      modelVersion = str(chunk.modelVersion) ?? modelVersion;
      const candidate = records(chunk.candidates)[0];
      if (!candidate) return;
      for (const part of records(asRecord(candidate.content)?.parts)) {
        const piece = part.thought === true ? undefined : str(part.text);
        if (!piece) continue;
        text += piece;
        onText(piece);
      }
      finishReason = str(candidate.finishReason) ?? finishReason;
      const grounding = asRecord(candidate.groundingMetadata);
      for (const source of records(grounding?.groundingChunks)) {
        const web = asRecord(source.web);
        citations.add(web?.uri, web?.title);
      }
      for (const query of Array.isArray(grounding?.webSearchQueries) ? grounding.webSearchQueries : []) {
        if (typeof query === 'string') queries.add(query);
      }
    },
    result(requestedModel: string): ByokGenerateResult {
      if (blockReason && !text.trim()) {
        throw new ByokError('content_blocked', `Gemini blocked the prompt (${blockReason}).`, { provider });
      }
      const input = (num(usage?.promptTokenCount) ?? 0) + (num(usage?.toolUsePromptTokenCount) ?? 0);
      const output = (num(usage?.candidatesTokenCount) ?? 0) + (num(usage?.thoughtsTokenCount) ?? 0);
      return finishResult(provider, {
        text,
        model: modelVersion ?? requestedModel,
        usage: usageOf({
          inputTokens: usage ? input : undefined,
          outputTokens: usage ? output : undefined,
          cachedInputTokens: num(usage?.cachedContentTokenCount),
          webSearchCalls: queries.size || undefined,
        }),
        citations: citations.list(),
        finishReason:
          finishReason === 'STOP'
            ? 'stop'
            : finishReason === 'MAX_TOKENS' || finishReason === 'CONTINUATION'
              ? 'length'
              : finishReason && BLOCKED.has(finishReason)
                ? 'content_filter'
                : 'other',
      });
    },
  };
}

/** A finished Interaction → result: the report is the last `model_output` step. */
function interactionResult(provider: ByokProviderId, interaction: JsonRecord, requestedModel: string): ByokGenerateResult {
  const outputs = records(interaction.steps).filter((step) => step.type === 'model_output');
  const citations = citationCollector();
  let text = '';
  let gap = false;
  for (const part of records(outputs[outputs.length - 1]?.content)) {
    const piece = part.type === 'text' ? str(part.text) : undefined;
    if (!piece) {
      gap = true; // an image or other non-text part splits the report
      continue;
    }
    text += text && gap ? `\n\n${piece}` : piece;
    gap = false;
    for (const annotation of records(part.annotations)) {
      if (annotation.type === 'url_citation') citations.add(annotation.url, annotation.title);
    }
  }
  const usage = asRecord(interaction.usage);
  const searches = records(usage?.grounding_tool_count).find((count) => count.type === 'google_search');
  return finishResult(provider, {
    text,
    model: str(interaction.model) ?? requestedModel,
    usage: usageOf({
      inputTokens: num(usage?.total_input_tokens),
      outputTokens: usage ? (num(usage.total_output_tokens) ?? 0) + (num(usage.total_thought_tokens) ?? 0) : undefined,
      cachedInputTokens: num(usage?.total_cached_tokens),
      webSearchCalls: num(searches?.count),
    }),
    citations: citations.list(),
    finishReason: interaction.status === 'completed' ? 'stop' : 'length',
  });
}
