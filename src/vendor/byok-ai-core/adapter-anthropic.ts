/**
 * Anthropic Messages API, `POST /v1/messages` (docs checked 2026-11-04).
 * Never `temperature`: Claude 4.7+ answer a non-default value with a 400.
 * The article context is its own system block with `cache_control`, so a
 * chat re-reads it from the cache (silently uncached below the model's
 * minimum, 512 tokens on the 5.x models). Web search and fetch are the basic
 * tool versions, the ones every Claude model, platform and ZDR setting accepts.
 * A server-tool turn that pauses (`stop_reason: 'pause_turn'`) is resent with
 * the paused content, at most 3 times.
 */
import type { ByokGenerateRequest } from './client';
import type { ByokHttpResponse } from './transport';
import {
  type AdapterContext,
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
import { normalizeProviderError } from './errors';
import { readSseFrames } from './sse';

const MAX_CONTINUATIONS = 3;
const WEB_TOOLS = [
  { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5 },
];

type Reporter = ReturnType<typeof streamReporter>;

function requestBody(req: ByokGenerateRequest, paused: readonly JsonRecord[]) {
  const system = [
    ...(req.system ? [{ type: 'text', text: req.system }] : []),
    ...(req.context ? [{ type: 'text', text: req.context, cache_control: { type: 'ephemeral' } }] : []),
  ];
  return {
    model: req.model,
    max_tokens: outputTokenLimit(req),
    ...(system.length > 0 ? { system } : {}),
    messages: [
      ...req.messages.map((message) => ({ role: message.role, content: message.content })),
      // Every paused response goes back unchanged, in order (thinking signatures, encrypted search results).
      ...(paused.length > 0 ? [{ role: 'assistant', content: paused }] : []),
    ],
    ...(req.stream ? { stream: true } : {}),
    ...(req.webSearch ? { tools: WEB_TOOLS } : {}),
  };
}

export const anthropicAdapter: ByokAdapter = {
  async generate(ctx, req, handlers) {
    const report = streamReporter(handlers);
    const text = textJoiner(report);
    const content: JsonRecord[] = [];
    const usage = { input: 0, output: 0, cached: 0, searches: 0 };
    let model = req.model;
    let stopReason: string | undefined;
    for (let continuation = 0; ; continuation++) {
      const res = await send(ctx, request(ctx, 'POST', '/messages', requestBody(req, content), req));
      const message = req.stream ? await readMessageStream(ctx, res, req.signal, report, text) : asRecord(await readJson(ctx, res)) ?? {};
      content.push(...records(message.content));
      const counts = asRecord(message.usage);
      const cacheRead = num(counts?.cache_read_input_tokens) ?? 0;
      usage.input += (num(counts?.input_tokens) ?? 0) + (num(counts?.cache_creation_input_tokens) ?? 0) + cacheRead;
      usage.output += num(counts?.output_tokens) ?? 0;
      usage.cached += cacheRead;
      usage.searches += num(asRecord(counts?.server_tool_use)?.web_search_requests) ?? 0;
      model = str(message.model) ?? model;
      stopReason = str(message.stop_reason);
      if (stopReason !== 'pause_turn' || continuation >= MAX_CONTINUATIONS) break;
    }
    const citations = citationCollector();
    for (const block of content) {
      for (const citation of records(block.citations)) {
        if (citation.type === 'web_search_result_location') citations.add(citation.url, citation.title);
      }
    }
    return finishResult(ctx.provider, {
      text: joinText(content),
      model,
      usage: usageOf({
        inputTokens: usage.input,
        outputTokens: usage.output,
        cachedInputTokens: usage.cached,
        webSearchCalls: usage.searches || undefined,
      }),
      citations: citations.list(),
      finishReason:
        stopReason === 'end_turn' || stopReason === 'stop_sequence'
          ? 'stop'
          : stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded'
            ? 'length'
            : stopReason === 'refusal'
              ? 'content_filter'
              : 'other',
    });
  },
};

/**
 * Text blocks in order. Blocks that follow each other are one passage (Claude
 * splits text at citations); text resumed after a tool call or thinking starts
 * a new paragraph.
 */
function joinText(content: readonly JsonRecord[]): string {
  let out = '';
  let gap = false;
  for (const block of content) {
    if (block.type !== 'text') {
      gap = true;
      continue;
    }
    const text = str(block.text);
    if (!text) continue;
    out += out && gap ? `\n\n${text}` : text;
    gap = false;
  }
  return out;
}

/** joinText for streamed deltas, so the streamed text matches the result. */
function textJoiner(report: Reporter): { block(isText: boolean): void; delta(text: string): void } {
  let emitted = false;
  let gap = false;
  return {
    block(isText) {
      if (!isText) gap = true;
    },
    delta(text) {
      if (!text) return;
      report.text(emitted && gap ? `\n\n${text}` : text);
      emitted = true;
      gap = false;
    },
  };
}

/** One streamed response rebuilt as the Message the non-streamed call returns. */
async function readMessageStream(
  ctx: AdapterContext,
  res: ByokHttpResponse,
  signal: AbortSignal | undefined,
  report: Reporter,
  text: ReturnType<typeof textJoiner>,
): Promise<JsonRecord> {
  let message: JsonRecord = {};
  const blocks: JsonRecord[] = [];
  const partialJson = new Map<number, string>();
  await readSseFrames(
    ctx.provider,
    res,
    (frame) => {
      const event = frameJson(frame);
      const index = num(event?.index) ?? -1;
      switch (event?.type) {
        case 'message_start':
          message = { ...asRecord(event.message) };
          return;
        case 'content_block_start': {
          const block = { ...asRecord(event.content_block) };
          blocks[index] = block;
          text.block(block.type === 'text');
          if (block.type === 'server_tool_use') report.searching();
          return;
        }
        case 'content_block_delta':
          applyDelta(blocks[index], asRecord(event.delta), (json) => partialJson.set(index, (partialJson.get(index) ?? '') + json), text);
          return;
        case 'content_block_stop': {
          const json = partialJson.get(index);
          const block = blocks[index];
          if (json !== undefined && block) block.input = parseJson(json);
          return;
        }
        case 'message_delta': {
          const delta = asRecord(event.delta);
          if (delta && 'stop_reason' in delta) message.stop_reason = delta.stop_reason;
          // Counts in message_delta are cumulative.
          message.usage = { ...asRecord(message.usage), ...asRecord(event.usage) };
          return;
        }
        case 'error':
          throw normalizeProviderError(ctx.provider, 200, frame.data);
      }
    },
    signal,
  );
  return { ...message, content: blocks.filter(Boolean) };
}

function applyDelta(
  block: JsonRecord | undefined,
  delta: JsonRecord | undefined,
  addJson: (json: string) => void,
  text: ReturnType<typeof textJoiner>,
): void {
  if (!block || !delta) return;
  switch (delta.type) {
    case 'text_delta': {
      const piece = str(delta.text) ?? '';
      block.text = `${str(block.text) ?? ''}${piece}`;
      text.delta(piece);
      return;
    }
    case 'citations_delta':
      block.citations = [...(Array.isArray(block.citations) ? block.citations : []), delta.citation];
      return;
    case 'input_json_delta':
      addJson(str(delta.partial_json) ?? '');
      return;
    case 'thinking_delta':
      block.thinking = `${str(block.thinking) ?? ''}${str(delta.thinking) ?? ''}`;
      return;
    case 'signature_delta':
      block.signature = delta.signature;
      return;
  }
}

function parseJson(json: string): unknown {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}
