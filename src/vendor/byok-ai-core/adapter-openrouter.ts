/**
 * OpenRouter, OpenAI-compatible `POST /api/v1/chat/completions` (docs checked
 * 2026-11-04). Web search = the `web` plugin (native search for Anthropic,
 * Google, OpenAI models, Exa for the rest), results as `url_citation`
 * annotations. A failure after the 200 is committed arrives as a chunk with a
 * top-level `error`; `: OPENROUTER PROCESSING` keep-alive comments are skipped
 * by the SSE parser; usage comes in the last chunk.
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
import { promptToMessages } from './chat';
import { normalizeProviderError } from './errors';
import { readSseFrames } from './sse';

function requestBody(req: ByokGenerateRequest) {
  return {
    model: req.model,
    messages: promptToMessages({ system: req.system, context: req.context ?? '', messages: [...req.messages] }),
    max_completion_tokens: outputTokenLimit(req),
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    stream: Boolean(req.stream),
    ...(req.webSearch ? { plugins: [{ id: 'web' }] } : {}),
  };
}

export const openrouterAdapter: ByokAdapter = {
  async generate(ctx, req, handlers) {
    const res = await send(ctx, request(ctx, 'POST', '/chat/completions', requestBody(req), req));
    const report = streamReporter(handlers);
    const answer = completionAccumulator(ctx.provider, report.text);
    if (req.stream) {
      await readSseFrames(ctx.provider, res, (frame) => answer.add(frameJson(frame), 'delta'), req.signal);
    } else {
      answer.add(asRecord(await readJson(ctx, res)), 'message');
    }
    return answer.result(req.model);
  },
};

/** Stream chunks (`delta`) or one completion (`message`) → result. */
function completionAccumulator(provider: ByokProviderId, onText: (text: string) => void) {
  const citations = citationCollector();
  let text = '';
  let finishReason: string | undefined;
  let usage: JsonRecord | undefined;
  let model: string | undefined;
  return {
    add(chunk: JsonRecord | undefined, key: 'delta' | 'message'): void {
      if (!chunk) return; // `[DONE]`
      if (chunk.error) {
        const error = asRecord(chunk.error);
        throw normalizeProviderError(provider, num(error?.code) ?? 200, JSON.stringify({ error: error ?? {} }));
      }
      model = str(chunk.model) ?? model;
      usage = asRecord(chunk.usage) ?? usage;
      const choice = records(chunk.choices)[0];
      if (!choice) return;
      const part = asRecord(choice[key]);
      const piece = str(part?.content);
      if (piece) {
        text += piece;
        onText(piece);
      }
      for (const annotation of records(part?.annotations)) {
        const citation = asRecord(annotation.url_citation);
        if (annotation.type === 'url_citation') citations.add(citation?.url, citation?.title);
      }
      finishReason = str(choice.finish_reason) ?? finishReason;
    },
    result(requestedModel: string): ByokGenerateResult {
      return finishResult(provider, {
        text,
        model: model ?? requestedModel,
        usage: usageOf({
          inputTokens: num(usage?.prompt_tokens),
          outputTokens: num(usage?.completion_tokens),
          cachedInputTokens: num(asRecord(usage?.prompt_tokens_details)?.cached_tokens),
          webSearchCalls: num(asRecord(usage?.server_tool_use_details)?.web_search_requests),
        }),
        citations: citations.list(),
        finishReason:
          finishReason === 'stop' || finishReason === 'length' || finishReason === 'content_filter' ? finishReason : 'other',
      });
    },
  };
}
