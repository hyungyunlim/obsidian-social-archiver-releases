/**
 * OpenAI Responses API, `POST /v1/responses` (docs checked 2026-11-04).
 * No `temperature`: GPT-5.x and GPT-6 are reasoning models. `store: false`
 * for runs; prompt caching is automatic for the stable instructions prefix.
 * Deep research (no deep-research model since 2026-07-23) is a web-search
 * model in background mode with `store: true`, since background responses
 * stored without it are deleted after about 10 minutes; polled
 * `GET /v1/responses/{id}`, cancelled `POST /v1/responses/{id}/cancel`.
 */
import type { ByokGenerateRequest, ByokGenerateResult } from './client';
import type { ByokProviderId } from './providers';
import {
  type ByokAdapter,
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

const WEB_SEARCH = [{ type: 'web_search' }];

function requestBody(req: ByokGenerateRequest) {
  return {
    model: req.model,
    instructions: joinParts(req.system, req.context),
    input: req.messages.map((message) => ({ role: message.role, content: message.content })),
    max_output_tokens: outputTokenLimit(req),
    store: false,
    stream: Boolean(req.stream),
    ...(req.webSearch ? { tools: WEB_SEARCH } : {}),
  };
}

export const openaiAdapter: ByokAdapter = {
  async generate(ctx, req, handlers) {
    const res = await send(ctx, request(ctx, 'POST', '/responses', requestBody(req), req));
    if (!req.stream) return responseResult(ctx.provider, await readJson(ctx, res), req.model);
    const report = streamReporter(handlers);
    let final: unknown;
    await readSseFrames(
      ctx.provider,
      res,
      (frame) => {
        const event = frameJson(frame);
        switch (event?.type) {
          case 'response.web_search_call.in_progress':
            report.searching();
            return;
          case 'response.output_text.delta':
            report.text(str(event.delta) ?? '');
            return;
          case 'response.completed':
          case 'response.incomplete':
            final = event.response;
            return;
          case 'response.failed':
            throw responseError(ctx.provider, asRecord(event.response)?.error);
          case 'error':
            throw normalizeProviderError(ctx.provider, 200, frame.data);
        }
      },
      req.signal,
    );
    if (final === undefined) {
      throw new ByokError('network', 'The OpenAI stream ended before the answer was complete.', { provider: ctx.provider });
    }
    return responseResult(ctx.provider, final, req.model);
  },

  deepResearch: {
    async start(ctx, req) {
      const body = {
        model: req.model,
        instructions: joinParts(req.system, req.context),
        input: [{ role: 'user', content: req.prompt }],
        background: true,
        store: true,
        tools: WEB_SEARCH,
      };
      const response = asRecord(await readJson(ctx, await send(ctx, request(ctx, 'POST', '/responses', body, req))));
      const id = str(response?.id);
      if (!id) throw new ByokError('unknown', 'OpenAI did not return a response id.', { provider: ctx.provider });
      return { provider: 'openai', id, model: str(response?.model) ?? req.model, startedAt: Date.now() };
    },

    async poll(ctx, handle) {
      const path = `/responses/${encodeURIComponent(handle.id)}`;
      const response = asRecord(await readJson(ctx, await send(ctx, request(ctx, 'GET', path)))) ?? {};
      switch (response.status) {
        case 'queued':
          return { status: 'queued' };
        case 'completed':
        case 'incomplete':
          try {
            return { status: 'completed', result: responseResult(ctx.provider, response, handle.model) };
          } catch (error) {
            if (error instanceof ByokError) return { status: 'failed', error };
            throw error;
          }
        case 'failed':
          return { status: 'failed', error: responseError(ctx.provider, response.error) };
        case 'cancelled':
          return {
            status: 'cancelled',
            error: new ByokError('cancelled', 'The research was cancelled.', { provider: ctx.provider }),
          };
        default:
          return { status: 'running' };
      }
    },

    async cancel(ctx, handle) {
      await send(ctx, request(ctx, 'POST', `/responses/${encodeURIComponent(handle.id)}/cancel`));
    },
  },
};

/** A Response object (non-streamed body, `response.completed`, or a finished background poll) → result. */
function responseResult(provider: ByokProviderId, value: unknown, requestedModel: string): ByokGenerateResult {
  const response = asRecord(value) ?? {};
  const citations = citationCollector();
  const texts: string[] = [];
  let refused = false;
  let searches = 0;
  for (const item of records(response.output)) {
    if (item.type === 'web_search_call' && (asRecord(item.action)?.type ?? 'search') === 'search') searches++;
    if (item.type !== 'message') continue;
    let text = '';
    for (const part of records(item.content)) {
      if (part.type === 'refusal') refused = true;
      if (part.type !== 'output_text') continue;
      text += str(part.text) ?? '';
      for (const annotation of records(part.annotations)) {
        if (annotation.type === 'url_citation') citations.add(annotation.url, annotation.title);
      }
    }
    texts.push(text);
  }
  const usage = asRecord(response.usage);
  const reason = asRecord(response.incomplete_details)?.reason;
  return finishResult(provider, {
    text: joinParts(...texts),
    model: str(response.model) ?? requestedModel,
    usage: usageOf({
      inputTokens: num(usage?.input_tokens),
      outputTokens: num(usage?.output_tokens),
      cachedInputTokens: num(asRecord(usage?.input_tokens_details)?.cached_tokens),
      webSearchCalls: searches || undefined,
    }),
    citations: citations.list(),
    finishReason:
      refused || reason === 'content_filter'
        ? 'content_filter'
        : response.status === 'completed'
          ? 'stop'
          : reason === 'max_output_tokens'
            ? 'length'
            : 'other',
  });
}

/** `response.error` ({code, message}) of a failed response → ByokError. */
function responseError(provider: ByokProviderId, error: unknown): ByokError {
  return normalizeProviderError(provider, 200, JSON.stringify({ error: asRecord(error) ?? {} }));
}
