/**
 * The host injects the network: the core never touches `fetch` globals.
 * Obsidian uses `requestUrl` (no CORS, no stream) or `window.fetch`
 * (streaming), Expo uses `expo/fetch`, the desktop webview its own `fetch`.
 */

export interface ByokHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Ask for a streamed body; a host that cannot stream returns `body: null`. */
  stream?: boolean;
}

export interface ByokHttpResponse {
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
}

export type ByokTransport = (req: ByokHttpRequest) => Promise<ByokHttpResponse>;
