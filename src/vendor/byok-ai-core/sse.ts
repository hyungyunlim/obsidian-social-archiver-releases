/**
 * Server-sent events off a provider response (port of
 * chrome-extension/src/shared/reader/ai-sse.ts). A host that cannot stream
 * (Obsidian `requestUrl`) returns `body: null`, and the whole text is parsed at once.
 */
import type { ByokProviderId } from './providers';
import type { ByokHttpResponse } from './transport';
import { ByokError } from './errors';
import { BYOK_PROVIDERS } from './providers';

export interface SseFrame {
  /** `message` when the frame names no event. */
  event: string;
  /** The frame's `data:` lines joined with `\n`. */
  data: string;
}

/** Incremental: feed decoded text in any chunking, get every completed frame. */
export class ByokSseParser {
  private buffer = '';
  /** A chunk ended in `\r`: it may be the first half of a `\r\n` split across chunks. */
  private pendingCR = false;

  push(chunk: string): SseFrame[] {
    let text = this.pendingCR ? `\r${chunk}` : chunk;
    this.pendingCR = text.endsWith('\r');
    if (this.pendingCR) text = text.slice(0, -1);
    this.buffer += text.replace(/\r\n?/g, '\n');
    const frames: SseFrame[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = parseFrame(this.buffer.slice(0, boundary));
      if (frame) frames.push(frame);
      this.buffer = this.buffer.slice(boundary + 2);
      boundary = this.buffer.indexOf('\n\n');
    }
    return frames;
  }

  /** The frame a stream ended without terminating, if any. */
  end(): SseFrame[] {
    const frames = this.push(this.pendingCR ? '\n' : '');
    const frame = parseFrame(this.buffer);
    this.buffer = '';
    return frame ? [...frames, frame] : frames;
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue; // comments, e.g. `: OPENROUTER PROCESSING`
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // One space after the colon is part of the syntax, more are content.
    const value = colon === -1 ? '' : line.slice(colon + (line[colon + 1] === ' ' ? 2 : 1));
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length === 0 && event === 'message' ? null : { event, data: data.join('\n') };
}

/**
 * Feeds every frame of `res` to `onFrame` (which may throw to stop the stream).
 * Aborting `signal` cancels the read and rejects with a `cancelled` ByokError;
 * a dropped connection rejects with `network`.
 */
export async function readSseFrames(
  provider: ByokProviderId,
  res: ByokHttpResponse,
  onFrame: (frame: SseFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  const parser = new ByokSseParser();
  const label = BYOK_PROVIDERS[provider].label;
  const cancelled = () => new ByokError('cancelled', `The ${label} request was cancelled.`, { provider });
  const dropped = (): never => {
    throw signal?.aborted ? cancelled() : new ByokError('network', `The connection to ${label} dropped.`, { provider });
  };
  if (!res.body) {
    const text = await res.text().catch(dropped);
    if (signal?.aborted) throw cancelled();
    for (const frame of [...parser.push(text), ...parser.end()]) onFrame(frame);
    return;
  }
  const reader = res.body.getReader();
  const stop = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', stop, { once: true });
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read().catch(dropped);
      if (signal?.aborted) throw cancelled();
      if (chunk.done) break;
      for (const frame of parser.push(decoder.decode(chunk.value, { stream: true }))) onFrame(frame);
    }
    for (const frame of [...parser.push(decoder.decode()), ...parser.end()]) onFrame(frame);
  } catch (error) {
    stop();
    throw error;
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}
