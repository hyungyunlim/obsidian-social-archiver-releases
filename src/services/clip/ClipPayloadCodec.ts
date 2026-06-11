import { decompressFromEncodedURIComponent } from 'lz-string';
import { PostDataSchema } from '@/types/post';
import type { PostData } from '@/types/post';
import {
  CLIP_CLIPBOARD_MARKER,
  CLIP_PAYLOAD_VERSION,
  ClipPayloadError,
  type ClipEnvelopeV1,
  type ClipPayload,
} from '@/types/clip';

/**
 * ClipPayloadCodec — decode and validate browser clip payloads.
 *
 * Single Responsibility: transport decoding (lz-string), envelope/version
 * checks, and PostData sanitization. No vault or network access — the import
 * workflow lives in LocalClipService, protocol plumbing in main.ts.
 *
 * Senders encode with
 * `compressToEncodedURIComponent(JSON.stringify(envelope))` and deliver the
 * result either as the `payload` query param of
 * `obsidian://social-archive?op=clip` or via the clipboard prefixed with
 * {@link CLIP_CLIPBOARD_MARKER} when the URI would exceed safe OS limits.
 *
 * Deep links are untrusted input: any web page can open them. Validation is
 * therefore strict — zod's default strip mode drops unknown keys, sizes are
 * capped, and required identity fields are enforced.
 */
export class ClipPayloadCodec {
  /**
   * Decompressed JSON budget. Comment-heavy posts measure ~200–500 KB raw,
   * so 2 MiB is generous headroom while still bounding hostile payloads.
   */
  static readonly MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;

  /** Decode an inline `payload` query param value. */
  decode(compressed: string | undefined | null): ClipPayload {
    const input = (compressed ?? '').trim();
    if (!input) {
      throw new ClipPayloadError('empty', 'Clip payload is empty');
    }

    let json: string | null;
    try {
      // decompressFromEncodedURIComponent internally restores ' ' -> '+',
      // so payloads survive query-string plus-as-space parsing.
      json = decompressFromEncodedURIComponent(input);
    } catch {
      json = null;
    }
    if (!json) {
      throw new ClipPayloadError(
        'decompress_failed',
        'Could not decompress clip payload'
      );
    }
    if (json.length > ClipPayloadCodec.MAX_DECOMPRESSED_BYTES) {
      throw new ClipPayloadError(
        'too_large',
        `Clip payload exceeds ${ClipPayloadCodec.MAX_DECOMPRESSED_BYTES} bytes after decompression`
      );
    }

    return this.parseEnvelopeJson(json);
  }

  /** Decode a clipboard handoff (`via=clipboard` deep links). */
  decodeClipboardText(text: string | undefined | null): ClipPayload {
    const input = (text ?? '').trim();
    if (!input) {
      throw new ClipPayloadError('empty', 'Clipboard is empty');
    }
    if (!input.startsWith(CLIP_CLIPBOARD_MARKER)) {
      throw new ClipPayloadError(
        'invalid_envelope',
        'Clipboard does not contain a Social Archiver clip'
      );
    }
    return this.decode(input.slice(CLIP_CLIPBOARD_MARKER.length));
  }

  private parseEnvelopeJson(json: string): ClipPayload {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new ClipPayloadError('invalid_json', 'Clip payload is not valid JSON');
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ClipPayloadError('invalid_envelope', 'Clip envelope must be an object');
    }

    const envelope = raw as Partial<ClipEnvelopeV1>;

    if (envelope.v !== CLIP_PAYLOAD_VERSION) {
      throw new ClipPayloadError(
        'unsupported_version',
        `Unsupported clip payload version: ${String(envelope.v)}`
      );
    }
    if (typeof envelope.source !== 'string' || !envelope.source.trim()) {
      throw new ClipPayloadError('invalid_envelope', 'Clip envelope is missing source');
    }
    if (!envelope.postData || typeof envelope.postData !== 'object') {
      throw new ClipPayloadError('invalid_envelope', 'Clip envelope is missing postData');
    }

    const postData = this.sanitizePostData(envelope.postData as Record<string, unknown>);

    return {
      v: CLIP_PAYLOAD_VERSION,
      source: envelope.source,
      sourceVersion:
        typeof envelope.sourceVersion === 'string' ? envelope.sourceVersion : undefined,
      clippedAt: typeof envelope.clippedAt === 'string' ? envelope.clippedAt : undefined,
      // Anything other than an explicit 'local' is treated as remote — an
      // unknown future mode must not accidentally suppress downloads.
      mediaDelivery: envelope.mediaDelivery === 'local' ? 'local' : 'remote',
      postData,
    };
  }

  /**
   * Validate against PostDataSchema. Zod's default strip mode drops unknown
   * keys, which doubles as sanitization for externally supplied payloads.
   * Date-typed fields arrive as ISO strings over JSON and are revived first.
   */
  private sanitizePostData(candidate: Record<string, unknown>): PostData {
    this.reviveDates(candidate);

    let parsed: PostData;
    try {
      parsed = PostDataSchema.parse(candidate);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message.split('\n').slice(0, 3).join(' ') : undefined;
      throw new ClipPayloadError('invalid_post_data', detail);
    }

    if (!parsed.id.trim() || !parsed.url.trim()) {
      throw new ClipPayloadError(
        'invalid_post_data',
        'postData.id and postData.url are required'
      );
    }

    return parsed;
  }

  /**
   * PostDataSchema declares some fields as `z.date()`, which JSON cannot
   * carry. Revive the ones senders may legitimately provide and drop the
   * ones the plugin re-derives at archive time.
   */
  private reviveDates(candidate: Record<string, unknown>): void {
    for (const key of ['publishedDate', 'archivedDate'] as const) {
      const value = candidate[key];
      if (typeof value === 'string') {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          delete candidate[key];
        } else {
          candidate[key] = date;
        }
      }
    }

    // author.lastMetadataUpdate is set by enrichAuthorMetadata at archive
    // time — a string value would fail z.date(), so drop it everywhere.
    this.dropStringMetadataUpdate(candidate['author']);

    const quoted = candidate['quotedPost'];
    if (quoted && typeof quoted === 'object') {
      this.dropStringMetadataUpdate((quoted as Record<string, unknown>)['author']);
    }

    const comments = candidate['comments'];
    if (Array.isArray(comments)) {
      for (const comment of comments) {
        this.reviveCommentAuthor(comment);
      }
    }

    const embedded = candidate['embeddedArchives'];
    if (Array.isArray(embedded)) {
      for (const entry of embedded) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          this.reviveDates(entry as Record<string, unknown>);
        }
      }
    }
  }

  private reviveCommentAuthor(comment: unknown): void {
    if (!comment || typeof comment !== 'object') return;
    const record = comment as Record<string, unknown>;
    this.dropStringMetadataUpdate(record['author']);
    const replies = record['replies'];
    if (Array.isArray(replies)) {
      for (const reply of replies) {
        this.reviveCommentAuthor(reply);
      }
    }
  }

  private dropStringMetadataUpdate(author: unknown): void {
    if (!author || typeof author !== 'object') return;
    const record = author as Record<string, unknown>;
    if (typeof record['lastMetadataUpdate'] === 'string') {
      delete record['lastMetadataUpdate'];
    }
  }
}
