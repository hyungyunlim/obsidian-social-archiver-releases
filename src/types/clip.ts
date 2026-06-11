import type { PostData } from './post';

/**
 * Browser clip deep-link payload types (anonymous local clip flow).
 *
 * The Chrome extension extracts PostData client-side and hands it to the
 * plugin via `obsidian://social-archive?op=clip` — either inline
 * (`payload=<lz-string compressed envelope>`) or through the clipboard
 * (`via=clipboard`, clipboard text prefixed with {@link CLIP_CLIPBOARD_MARKER})
 * when the URI would exceed safe OS limits.
 *
 * See prd-extension-anonymous-local-mode.md ("Clip payload spec v1").
 */

/** Clip payload schema version understood by this plugin build. */
export const CLIP_PAYLOAD_VERSION = 1;

/**
 * Clipboard handoff marker. Senders write `SA_CLIP_V1:<compressed>` so the
 * plugin never consumes unrelated clipboard content.
 */
export const CLIP_CLIPBOARD_MARKER = 'SA_CLIP_V1:';

type ExtensibleString = string & Record<never, never>;

/** Known clip senders. Extensible so future surfaces don't need a type bump. */
export type ClipSource = 'chrome-extension' | ExtensibleString;

/**
 * How the sender delivered media for this clip.
 *
 * - `remote` (default): `media[].url` are remote CDN URLs — the plugin
 *   downloads them through the normal MediaHandler pipeline.
 * - `local`: the sender already wrote media files into the vault (Channel
 *   B+ folder handoff) and `media[].url` are vault-relative paths — the
 *   plugin must NOT download media; entries that failed sender-side keep
 *   their remote URL and simply render as remote embeds.
 */
export type ClipMediaDelivery = 'remote' | 'local';

/**
 * Wire envelope produced by clip senders, before validation.
 * `postData` stays `unknown` until it passes PostDataSchema.
 */
export interface ClipEnvelopeV1 {
  v: 1;
  source: ClipSource;
  sourceVersion?: string;
  /** ISO 8601 timestamp of when the clip was captured in the browser. */
  clippedAt?: string;
  /** Media delivery mode. Absent means `remote`. */
  mediaDelivery?: ClipMediaDelivery;
  postData: unknown;
}

/** Decoded and validated clip, ready for local import. */
export interface ClipPayload {
  v: 1;
  source: ClipSource;
  sourceVersion?: string;
  clippedAt?: string;
  mediaDelivery: ClipMediaDelivery;
  postData: PostData;
}

export type ClipPayloadErrorReason =
  | 'empty'
  | 'decompress_failed'
  | 'too_large'
  | 'invalid_json'
  | 'invalid_envelope'
  | 'unsupported_version'
  | 'invalid_post_data';

/**
 * Typed decode/validation failure. `reason` drives the user-facing Notice in
 * the protocol handler; `message` carries diagnostic detail for logs.
 */
export class ClipPayloadError extends Error {
  constructor(
    public readonly reason: ClipPayloadErrorReason,
    message?: string
  ) {
    super(message ?? `Invalid clip payload: ${reason}`);
    this.name = 'ClipPayloadError';
  }
}
